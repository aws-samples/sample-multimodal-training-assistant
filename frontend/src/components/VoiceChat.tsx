"use client";

import { useState, useRef, useCallback, useEffect } from "react";

interface VoicePanelProps {
  getSignedUrl: () => Promise<string>;
}

interface TranscriptEntry {
  role: "user" | "assistant";
  text: string;
  isFinal: boolean;
}

export function VoicePanel({ getSignedUrl }: VoicePanelProps): React.JSX.Element {
  const [isActive, setIsActive] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [transcripts, setTranscripts] = useState<TranscriptEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const procRef = useRef<ScriptProcessorNode | null>(null);
  const srcRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const playCtxRef = useRef<AudioContext | null>(null);
  const workletRef = useRef<AudioWorkletNode | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [transcripts]);

  const cancelAudio = useCallback(() => {
    workletRef.current?.port.postMessage({ type: "clear" });
  }, []);

  const startMic = useCallback(async (ws: WebSocket) => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    streamRef.current = stream;
    const ctx = new AudioContext({ latencyHint: "interactive" });
    audioCtxRef.current = ctx;
    const source = ctx.createMediaStreamSource(stream);
    srcRef.current = source;
    const proc = ctx.createScriptProcessor(512, 1, 1);
    procRef.current = proc;
    source.connect(proc);
    proc.connect(ctx.destination);
    const rate = 16000;
    proc.onaudioprocess = async (e: AudioProcessingEvent) => {
      if (ws.readyState !== WebSocket.OPEN) return;
      const inp = e.inputBuffer;
      const off = new OfflineAudioContext(1, Math.ceil(inp.duration * rate), rate);
      const s = off.createBufferSource();
      const m = off.createBuffer(1, inp.length, inp.sampleRate);
      m.copyToChannel(inp.getChannelData(0), 0);
      s.buffer = m; s.connect(off.destination); s.start(0);
      const rendered = await off.startRendering();
      const samples = rendered.getChannelData(0);
      const buf = new ArrayBuffer(samples.length * 2);
      const pcm = new DataView(buf);
      for (let i = 0; i < samples.length; i++) {
        const v = Math.max(-1, Math.min(1, samples[i]));
        pcm.setInt16(i * 2, v < 0 ? v * 0x8000 : v * 0x7fff, true);
      }
      let bin = "";
      for (let i = 0; i < pcm.byteLength; i++) bin += String.fromCharCode(pcm.getUint8(i));
      ws.send(JSON.stringify({ type: "bidi_audio_input", audio: btoa(bin), format: "pcm", sample_rate: rate, channels: 1 }));
    };
  }, []);

  const stopMic = useCallback(() => {
    procRef.current?.disconnect(); srcRef.current?.disconnect();
    streamRef.current?.getTracks().forEach(t => t.stop());
    audioCtxRef.current?.close();
    procRef.current = null; srcRef.current = null; streamRef.current = null; audioCtxRef.current = null;
  }, []);

  const startSession = useCallback(async () => {
    setError(null); setIsConnecting(true); setTranscripts([]); cancelAudio();
    try {
      // Init AudioWorklet player
      const pCtx = new AudioContext({ sampleRate: 24000 });
      await pCtx.audioWorklet.addModule("/audio-player-processor.js");
      const wNode = new AudioWorkletNode(pCtx, "audio-player-processor");
      wNode.connect(pCtx.destination);
      playCtxRef.current = pCtx;
      workletRef.current = wNode;

      const signedUrl = await getSignedUrl();
      if (!signedUrl) {
        throw new Error("Voice runtime ARN is not configured. Set NEXT_PUBLIC_VOICE_RUNTIME_ARN.");
      }
      const ws = new WebSocket(signedUrl);
      wsRef.current = ws;
      ws.onopen = async () => { setIsConnecting(false); setIsActive(true); await startMic(ws); };
      ws.onmessage = (msg) => {
        try {
          const data = JSON.parse(msg.data);
          if (data.type === "bidi_audio_stream" && data.audio) {
            // Decode base64 LPCM to Float32 and send to AudioWorklet
            const raw = atob(data.audio);
            const i16 = new Int16Array(raw.length / 2);
            for (let j = 0; j < i16.length; j++) i16[j] = raw.charCodeAt(j * 2) | (raw.charCodeAt(j * 2 + 1) << 8);
            const f32 = new Float32Array(i16.length);
            for (let j = 0; j < i16.length; j++) f32[j] = i16[j] / 32768;
            workletRef.current?.port.postMessage({ type: "audio", samples: f32 });
          } else if (data.type === "bidi_transcript_stream") {
            const role: "user" | "assistant" = data.role === "user" ? "user" : "assistant";
            const txt = String(data.current_transcript || data.text || data.delta || "");
            const final = !!data.is_final;
            setTranscripts(prev => {
              const last = prev[prev.length - 1];
              if (last && last.role === role && !last.isFinal) {
                return [...prev.slice(0, -1), { role, text: txt, isFinal: final }];
              }
              return [...prev, { role, text: txt, isFinal: final }];
            });
          } else if (data.type === "bidi_interruption") { cancelAudio(); }
          else if (data.type === "bidi_error") { setError(String(data.message || "Voice error")); }
        } catch { /* ignore parse errors */ }
      };
      ws.onerror = () => { setError("WebSocket connection error"); setIsConnecting(false); };
      ws.onclose = () => { setIsActive(false); setIsConnecting(false); stopMic(); };
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to start voice session");
      setIsConnecting(false);
    }
  }, [getSignedUrl, startMic, stopMic, cancelAudio]);

  const endSession = useCallback(() => {
    stopMic(); cancelAudio();
    workletRef.current?.disconnect();
    playCtxRef.current?.close().catch(() => {});
    workletRef.current = null; playCtxRef.current = null;
    try {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) wsRef.current.close();
    } catch { /* already closing */ }
    wsRef.current = null; setIsActive(false);
  }, [stopMic, cancelAudio]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {transcripts.length === 0 && !isActive ? (
          <div className="text-center text-slate-400 dark:text-slate-500 text-sm mt-8">
            {"Press the microphone to start a voice conversation"}
          </div>
        ) : null}
        {transcripts.map((t, i) => (
          <div key={i} className={`flex ${t.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[80%] px-3 py-2 rounded-lg text-sm ${
              t.role === "user"
                ? "bg-indigo-100 dark:bg-indigo-900/40 text-indigo-900 dark:text-indigo-100"
                : "bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200"
            } ${!t.isFinal ? "opacity-70" : ""}`}>
              {String(t.text)}
            </div>
          </div>
        ))}
        <div ref={endRef} />
      </div>
      {error ? (
        <div className="mx-4 mb-2 px-3 py-2 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 text-xs rounded-lg">
          {String(error)}
        </div>
      ) : null}
      <div className="flex-shrink-0 border-t border-slate-200 dark:border-slate-700 p-4 flex items-center justify-center gap-4">
        <button
          onClick={isActive ? endSession : startSession}
          disabled={isConnecting}
          className={`w-14 h-14 rounded-full flex items-center justify-center transition-all shadow-lg ${
            isActive ? "bg-red-500 hover:bg-red-600 text-white animate-pulse"
            : isConnecting ? "bg-slate-300 dark:bg-slate-600 text-slate-500 cursor-wait"
            : "bg-indigo-600 hover:bg-indigo-700 text-white"
          }`}
          title={isActive ? "End conversation" : "Start voice conversation"}
        >
          {isActive ? (
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 10a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" />
            </svg>
          ) : (
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
            </svg>
          )}
        </button>
        <span className="text-xs text-slate-500 dark:text-slate-400">
          {isActive ? "Listening..." : isConnecting ? "Connecting..." : "Voice"}
        </span>
      </div>
    </div>
  );
}
