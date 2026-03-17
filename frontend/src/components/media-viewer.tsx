"use client";

import { useState, useRef } from "react";

const MEDIA_BUCKET = process.env.NEXT_PUBLIC_MEDIA_BUCKET || "";
const MEDIA_REGION = process.env.NEXT_PUBLIC_MEDIA_BUCKET_REGION || "us-west-2";
const CLOUDFRONT_DOMAIN = process.env.NEXT_PUBLIC_CLOUDFRONT_DOMAIN || "";

function kbNameToMediaFile(kbName: string): string {
  // Remove .txt suffix
  let name = kbName.replace(/\.txt$/, "");
  // Replace last _ext with .ext (e.g., fire-wifi_mp4 -> fire-wifi.mp4)
  name = name.replace(/_(mp4|pdf|mov|webm|avi|png|jpg|jpeg|mp3|wav)$/, ".$1");
  return name;
}

function getMediaUrl(kbFilename: string): string {
  const mediaFile = kbNameToMediaFile(kbFilename);
  if (CLOUDFRONT_DOMAIN) {
    return `https://${CLOUDFRONT_DOMAIN}/${mediaFile}`;
  }
  if (MEDIA_BUCKET) {
    return `https://${MEDIA_BUCKET}.s3.${MEDIA_REGION}.amazonaws.com/${mediaFile}`;
  }
  return mediaFile;
}

interface MediaViewerProps {
  onSeekVideo?: (time: string, file: string) => void;
  onOpenPDF?: (page: string, file: string) => void;
}

export function MediaViewer({ onSeekVideo, onOpenPDF }: MediaViewerProps) {
  const [currentFile, setCurrentFile] = useState<string | null>(null);
  const [currentType, setCurrentType] = useState<"video" | "pdf" | null>(null);
  const [currentPage, setCurrentPage] = useState<string>("1");
  const videoRef = useRef<HTMLVideoElement>(null);

  const handleSeekVideo = (time: string, file: string) => {
    setCurrentFile(file);
    setCurrentType("video");
    
    // Parse timestamp (HH:MM:SS or MM:SS)
    const parts = time.split(":").map(Number);
    let seconds = 0;
    if (parts.length === 3) {
      seconds = parts[0] * 3600 + parts[1] * 60 + parts[2];
    } else if (parts.length === 2) {
      seconds = parts[0] * 60 + parts[1];
    }

    // Seek video if loaded
    setTimeout(() => {
      if (videoRef.current) {
        videoRef.current.currentTime = seconds;
        videoRef.current.play();
      }
    }, 100);

    onSeekVideo?.(time, file);
  };

  const handleOpenPDF = (page: string, file: string) => {
    setCurrentFile(file);
    setCurrentType("pdf");
    setCurrentPage(page);
    onOpenPDF?.(page, file);
  };

  // Expose handlers globally for citation buttons
  if (typeof window !== "undefined") {
    (window as any).seekVideo = handleSeekVideo;
    (window as any).openPDF = handleOpenPDF;
  }

  if (!currentFile) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setCurrentFile(null)}>
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
            {currentFile ? kbNameToMediaFile(currentFile) : ""}
          </h3>
          <button
            onClick={() => setCurrentFile(null)}
            className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 text-2xl"
          >
            ✕
          </button>
        </div>
        
        <div className="p-4">
          {currentType === "video" && (
            <video
              ref={videoRef}
              controls
              className="w-full rounded"
              src={getMediaUrl(currentFile)}
            >
              Your browser does not support video playback.
            </video>
          )}
          
          {currentType === "pdf" && (
            <iframe
              src={`${getMediaUrl(currentFile)}#page=${currentPage}`}
              className="w-full h-[70vh] rounded"
              title={currentFile}
            />
          )}
        </div>
      </div>
    </div>
  );
}
