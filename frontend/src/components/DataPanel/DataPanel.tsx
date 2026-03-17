"use client";

import { useState, useCallback, useEffect } from "react";
import type { UploadedFile } from "./types";
import { useUploadManager } from "./useUploadManager";
import { UploadZone } from "./UploadZone";
import { FileStatusCard } from "./FileStatusCard";
import { SyncButton } from "./SyncButton";

export function DataPanel({ isCollapsed, onToggleCollapse, onSendMessage }: {
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  onSendMessage: (message: string) => void;
}) {
  const [files, setFiles] = useState<UploadedFile[]>([]);

  const handleFileAdded = useCallback((file: UploadedFile) => {
    setFiles((prev) => {
      // Replace if same s3Key, otherwise add
      const idx = prev.findIndex((f) => f.s3Key === file.s3Key);
      if (idx >= 0) {
        const updated = [...prev];
        updated[idx] = file;
        return updated;
      }
      return [...prev, file];
    });
  }, []);

  const handleFileUpdated = useCallback((s3Key: string, updates: Partial<UploadedFile>) => {
    setFiles((prev) =>
      prev.map((f) => (f.s3Key === s3Key ? { ...f, ...updates } : f))
    );
  }, []);

  const { uploadFiles } = useUploadManager(handleFileAdded, handleFileUpdated);

  // Listen for global drop overlay file uploads
  useEffect(() => {
    const handler = (e: Event) => {
      const files = (e as CustomEvent<FileList>).detail;
      if (files) uploadFiles(files);
    };
    window.addEventListener("datapanel:upload", handler);
    return () => window.removeEventListener("datapanel:upload", handler);
  }, [uploadFiles]);

  const handleFilesSelected = useCallback((fileList: FileList) => {
    uploadFiles(fileList);
  }, [uploadFiles]);

  const handleAskAbout = useCallback((fileName: string) => {
    onSendMessage(`Tell me about ${fileName}`);
  }, [onSendMessage]);

  // Summary counts
  const totalCount = files.length;

  if (isCollapsed) {
    return (
      <div className="flex-shrink-0 border-l border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
        <button
          onClick={onToggleCollapse}
          className="w-12 h-full flex flex-col items-center justify-center gap-2 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
          title="Expand data panel"
        >
          <svg className="w-5 h-5 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
          </svg>
          {totalCount > 0 && (
            <span className="text-xs font-medium text-slate-600 dark:text-slate-400" style={{ writingMode: "vertical-rl" }}>
              {totalCount}
            </span>
          )}
          <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
      </div>
    );
  }

  return (
    <div className="w-80 bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-700 flex flex-col h-full shadow-lg">
      {/* Header */}
      <div className="flex-shrink-0">
        <div className="flex items-center justify-between bg-gradient-to-r from-indigo-600 to-purple-600 px-3 py-2">
          <div className="flex items-center gap-2">
            <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
            <span className="text-sm font-semibold text-white">Training Data</span>
            {totalCount > 0 && (
              <span className="text-xs text-white/60">
                {totalCount}
              </span>
            )}
          </div>
          <button onClick={onToggleCollapse} className="p-1 hover:bg-white/20 rounded transition-colors" title="Collapse panel">
            <svg className="w-4 h-4 text-white/80" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      </div>

      {/* KB sync button — appears when files are processed and ready to index */}
      <SyncButton files={files} onFilesUpdated={setFiles} />

      {/* Upload zone */}
      <UploadZone onFilesSelected={handleFilesSelected} hasFiles={totalCount > 0} />

      {/* File list */}
      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-2">
        {files
          .sort((a, b) => (b.uploadedAt || "").localeCompare(a.uploadedAt || ""))
          .map((file) => (
            <FileStatusCard
              key={file.s3Key}
              file={file}
              onAskAbout={handleAskAbout}
            />
          ))}
      </div>

    </div>
  );
}
