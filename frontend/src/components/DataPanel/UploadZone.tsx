"use client";

import { useRef, useState, useCallback } from "react";

export function UploadZone({ onFilesSelected, hasFiles }: {
  onFilesSelected: (files: FileList) => void;
  hasFiles: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files.length > 0) {
      onFilesSelected(e.dataTransfer.files);
    }
  }, [onFilesSelected]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setIsDragOver(false);
  }, []);

  // Compact mode when files exist
  if (hasFiles) {
    return (
      <div className="px-3 pt-3">
        <label
          className="w-full flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/30 hover:bg-indigo-100 dark:hover:bg-indigo-950/50 rounded-lg border border-dashed border-indigo-300 dark:border-indigo-700 transition-colors cursor-pointer"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Add more files
          <input
            ref={inputRef}
            type="file"
            multiple
            className="absolute w-0 h-0 overflow-hidden opacity-0"
            onChange={(e) => e.target.files && onFilesSelected(e.target.files)}
          />
        </label>
      </div>
    );
  }

  return (
    <div className="px-3 pt-3">
      <label
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        className={`flex flex-col items-center justify-center gap-2 p-6 rounded-lg border-2 border-dashed cursor-pointer transition-all ${
          isDragOver
            ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-950/30"
            : "border-slate-300 dark:border-slate-600 hover:border-indigo-400 dark:hover:border-indigo-500 hover:bg-slate-50 dark:hover:bg-slate-800/50"
        }`}
      >
        <svg className="w-8 h-8 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
        </svg>
        <div className="text-center">
          <p className="text-sm font-medium text-slate-600 dark:text-slate-300">
            Drop files here
          </p>
          <p className="text-xs text-slate-400 mt-1">
            or click to browse
          </p>
        </div>
        <p className="text-[10px] text-slate-400">
          PDF, video, audio, images, documents
        </p>
        <input
          ref={inputRef}
          type="file"
          multiple
          className="absolute w-0 h-0 overflow-hidden opacity-0"
          onChange={(e) => e.target.files && onFilesSelected(e.target.files)}
        />
      </label>
    </div>
  );
}
