import { useState, useCallback } from "react";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { fetchAuthSession } from "aws-amplify/auth";
import type { UploadedFile } from "./types";

const MEDIA_BUCKET = process.env.NEXT_PUBLIC_MEDIA_BUCKET || "";
const MEDIA_REGION = process.env.NEXT_PUBLIC_MEDIA_BUCKET_REGION || "us-west-2";

const ALLOWED_EXTENSIONS = new Set([
  ".pdf", ".mp4", ".mp3", ".wav", ".m4a", ".webm",
  ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".tiff",
  ".doc", ".docx", ".txt", ".csv",
]);

const MAX_FILE_SIZE = 500 * 1024 * 1024; // 500MB

export function useUploadManager(
  onFileAdded: (file: UploadedFile) => void,
  onFileUpdated: (s3Key: string, updates: Partial<UploadedFile>) => void
) {
  const [isUploading, setIsUploading] = useState(false);

  const uploadFiles = useCallback(
    async (fileList: FileList | File[]) => {
      const files = Array.from(fileList);
      if (files.length === 0) return;

      setIsUploading(true);

      for (const file of files) {
        const s3Key = file.name;

        try {
          // Validate file extension
          const ext = `.${file.name.split(".").pop()?.toLowerCase()}`;
          if (!ALLOWED_EXTENSIONS.has(ext)) {
            throw new Error(`File type ${ext} is not supported`);
          }

          // Validate file size
          if (file.size > MAX_FILE_SIZE) {
            throw new Error("File size exceeds maximum of 500MB");
          }

          if (!MEDIA_BUCKET) {
            throw new Error("Media bucket not configured");
          }

          // Add file to UI immediately with uploading status
          onFileAdded({
            s3Key,
            fileName: file.name,
            fileType: file.type,
            status: "uploading",
            progress: 0,
            uploadedAt: new Date().toISOString(),
          });

          // Get Cognito Identity Pool credentials
          const session = await fetchAuthSession();
          if (!session.credentials) {
            throw new Error("AWS credentials not available. Please sign in again.");
          }

          const s3Client = new S3Client({
            region: MEDIA_REGION,
            credentials: session.credentials,
          });

          // Upload directly to S3 using Cognito credentials
          onFileUpdated(s3Key, { progress: 50 });

          // Convert File to ArrayBuffer for browser S3 SDK compatibility
          const arrayBuffer = await file.arrayBuffer();

          await s3Client.send(
            new PutObjectCommand({
              Bucket: MEDIA_BUCKET,
              Key: s3Key,
              Body: new Uint8Array(arrayBuffer),
              ContentType: file.type,
            })
          );

          // Upload complete — BDA pipeline auto-triggers via EventBridge
          onFileUpdated(s3Key, { status: "uploaded", progress: 100 });
        } catch (err) {
          console.error(`Upload failed for ${file.name}:`, err);
          onFileAdded({
            s3Key,
            fileName: file.name,
            fileType: file.type,
            status: "error",
            errorMessage: err instanceof Error ? err.message : "Upload failed",
            uploadedAt: new Date().toISOString(),
          });
        }
      }

      setIsUploading(false);
    },
    [onFileAdded, onFileUpdated]
  );

  return { uploadFiles, isUploading };
}
