"use client";

import type { UploadedFile } from "./types";

const FILE_ICONS: Record<string, string> = {
  "application/pdf": "PDF",
  "video/mp4": "MP4",
  "video/webm": "WEBM",
  "audio/mpeg": "MP3",
  "audio/wav": "WAV",
  "audio/mp4": "M4A",
  "image/png": "PNG",
  "image/jpeg": "JPG",
};

function getFileIcon(fileType: string, fileName: string): string {
  if (FILE_ICONS[fileType]) return FILE_ICONS[fileType];
  const ext = fileName.split(".").pop()?.toUpperCase() || "FILE";
  return ext;
}

function getStatusBadge(status: UploadedFile["status"]) {
  switch (status) {
    case "uploading":
      return { text: "Uploading", color: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300" };
    case "uploaded":
      return { text: "Uploaded", color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300" };
    case "processing":
      return { text: "Processing", color: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300" };
    case "processed":
      return { text: "Ready to sync", color: "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300" };
    case "syncing":
      return { text: "Syncing", color: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300" };
    case "ready":
      return { text: "Ready", color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300" };
    case "error":
      return { text: "Error", color: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300" };
  }
}

function getMetadataText(file: UploadedFile): string {
  const parts: string[] = [];
  if (file.metadata?.pages) parts.push(`${file.metadata.pages} pages`);
  if (file.metadata?.durationSeconds) {
    const mins = Math.floor(file.metadata.durationSeconds / 60);
    const secs = file.metadata.durationSeconds % 60;
    parts.push(mins > 0 ? `${mins}m ${secs}s` : `${secs}s`);
  }
  if (file.metadata?.modality) parts.push(file.metadata.modality.toLowerCase());
  return parts.join(" · ");
}

export function FileStatusCard({ file, onAskAbout }: {
  file: UploadedFile;
  onAskAbout?: (fileName: string) => void;
}) {
  const icon = getFileIcon(file.fileType, file.fileName);
  const badge = getStatusBadge(file.status);
  const meta = getMetadataText(file);

  return (
    <div className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50">
      <div className="flex items-start gap-2">
        {/* File type icon */}
        <div className="flex-shrink-0 w-9 h-9 rounded-lg bg-slate-100 dark:bg-slate-700 flex items-center justify-center">
          <span className="text-[9px] font-bold text-slate-500 dark:text-slate-400">{icon}</span>
        </div>

        <div className="flex-1 min-w-0">
          {/* File name */}
          <p className="text-sm font-medium text-slate-700 dark:text-slate-200 truncate">
            {file.fileName}
          </p>

          {/* Status badge + metadata */}
          <div className="flex items-center gap-2 mt-1">
            <span className={`inline-flex items-center px-1.5 py-0.5 text-[10px] font-medium rounded ${badge.color}`}>
              {(file.status === "uploading" || file.status === "processing" || file.status === "syncing") && (
                <svg className="w-3 h-3 mr-1 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              )}
              {(file.status === "ready" || file.status === "uploaded") && (
                <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              )}
              {badge.text}
            </span>
            {meta && <span className="text-[10px] text-slate-400 truncate">{meta}</span>}
          </div>

          {/* Upload progress bar */}
          {file.status === "uploading" && file.progress !== undefined && (
            <div className="mt-1.5 w-full bg-slate-200 dark:bg-slate-700 rounded-full h-1">
              <div
                className="bg-blue-500 h-1 rounded-full transition-all duration-300"
                style={{ width: `${file.progress}%` }}
              />
            </div>
          )}

          {/* Error message */}
          {file.status === "error" && file.errorMessage && (
            <p className="text-[10px] text-red-500 mt-1 truncate">{file.errorMessage}</p>
          )}

          {/* Quick actions for ready files */}
          {(file.status === "ready" || file.status === "uploaded") && onAskAbout && (
            <button
              onClick={() => onAskAbout(file.fileName)}
              className="mt-1.5 text-[10px] font-medium text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300 transition-colors"
            >
              Ask me about this
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
