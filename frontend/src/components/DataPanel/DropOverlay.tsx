"use client";

import { useState, useEffect, useCallback, useRef } from "react";

export function DropOverlay({ onFilesDropped }: {
  onFilesDropped: (files: FileList) => void;
}) {
  const [isVisible, setIsVisible] = useState(false);
  const dragCounterRef = useRef(0);

  const handleDragEnter = useCallback((e: DragEvent) => {
    e.preventDefault();
    dragCounterRef.current++;
    if (e.dataTransfer?.types.includes("Files")) {
      setIsVisible(true);
    }
  }, []);

  const handleDragLeave = useCallback((e: DragEvent) => {
    e.preventDefault();
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) {
      setIsVisible(false);
    }
  }, []);

  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
  }, []);

  const handleDrop = useCallback((e: DragEvent) => {
    e.preventDefault();
    dragCounterRef.current = 0;
    setIsVisible(false);
    if (e.dataTransfer?.files.length) {
      onFilesDropped(e.dataTransfer.files);
    }
  }, [onFilesDropped]);

  useEffect(() => {
    document.addEventListener("dragenter", handleDragEnter);
    document.addEventListener("dragleave", handleDragLeave);
    document.addEventListener("dragover", handleDragOver);
    document.addEventListener("drop", handleDrop);

    return () => {
      document.removeEventListener("dragenter", handleDragEnter);
      document.removeEventListener("dragleave", handleDragLeave);
      document.removeEventListener("dragover", handleDragOver);
      document.removeEventListener("drop", handleDrop);
    };
  }, [handleDragEnter, handleDragLeave, handleDragOver, handleDrop]);

  if (!isVisible) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-indigo-600/20 backdrop-blur-sm">
      <div className="flex flex-col items-center gap-4 p-12 rounded-2xl border-4 border-dashed border-indigo-400 bg-white/90 dark:bg-slate-900/90 shadow-2xl">
        <svg className="w-16 h-16 text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
        </svg>
        <p className="text-xl font-semibold text-slate-700 dark:text-slate-200">
          Drop your training materials here
        </p>
        <p className="text-sm text-slate-500">
          PDFs, videos, audio files, images, and documents
        </p>
      </div>
    </div>
  );
}
