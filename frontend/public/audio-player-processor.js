/**
 * AudioWorklet processor for gapless streaming audio playback.
 * Based on the AWS sample-sonic-cdk-agent pattern.
 *
 * Uses an expandable ring buffer that accumulates ~1s of audio before
 * starting playback, then reads continuously with no gaps.
 */

class ExpandableBuffer {
  constructor() {
    this.buffer = new Float32Array(24000); // 1s at 24kHz
    this.readIndex = 0;
    this.writeIndex = 0;
    this.isInitialBuffering = true;
    this.initialBufferLength = 24000; // Buffer 1 second before starting playback
  }

  write(samples) {
    if (this.writeIndex + samples.length <= this.buffer.length) {
      // Enough space
    } else if (samples.length <= this.readIndex) {
      // Shift to reclaim space
      const sub = this.buffer.subarray(this.readIndex, this.writeIndex);
      this.buffer.set(sub);
      this.writeIndex -= this.readIndex;
      this.readIndex = 0;
    } else {
      // Grow buffer
      const newLen = (samples.length + this.writeIndex - this.readIndex) * 2;
      const newBuf = new Float32Array(newLen);
      newBuf.set(this.buffer.subarray(this.readIndex, this.writeIndex));
      this.buffer = newBuf;
      this.writeIndex -= this.readIndex;
      this.readIndex = 0;
    }
    this.buffer.set(samples, this.writeIndex);
    this.writeIndex += samples.length;
    if (this.writeIndex - this.readIndex >= this.initialBufferLength) {
      this.isInitialBuffering = false;
    }
  }

  read(destination) {
    let len = 0;
    if (!this.isInitialBuffering) {
      len = Math.min(destination.length, this.writeIndex - this.readIndex);
    }
    destination.set(this.buffer.subarray(this.readIndex, this.readIndex + len));
    this.readIndex += len;
    if (len < destination.length) {
      destination.fill(0, len); // Silence for underflow
    }
    if (len === 0) {
      this.isInitialBuffering = true; // Refill before playing more
    }
  }

  clear() {
    this.readIndex = 0;
    this.writeIndex = 0;
    this.isInitialBuffering = true;
  }
}

class AudioPlayerProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buf = new ExpandableBuffer();
    this.port.onmessage = (e) => {
      if (e.data.type === "audio") this.buf.write(e.data.samples);
      else if (e.data.type === "clear") this.buf.clear();
    };
  }
  process(_inputs, outputs) {
    const out = outputs[0][0];
    if (out) this.buf.read(out);
    return true;
  }
}

registerProcessor("audio-player-processor", AudioPlayerProcessor);
