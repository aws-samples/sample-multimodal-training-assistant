export type FileStatus = "uploading" | "uploaded" | "processing" | "processed" | "syncing" | "ready" | "error";

export type UploadedFile = {
  s3Key: string;
  fileName: string;
  fileType: string;
  status: FileStatus;
  progress?: number; // 0-100, used during upload
  metadata?: {
    modality?: string;
    pages?: number;
    durationSeconds?: number;
  };
  uploadedAt?: string;
  processedAt?: string;
  syncedAt?: string;
  errorMessage?: string;
};

export type SyncState = "idle" | "syncing" | "complete" | "error";
