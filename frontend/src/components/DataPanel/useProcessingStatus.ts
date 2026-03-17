import { useEffect, useRef } from "react";
import type { UploadedFile } from "./types";

/**
 * Processing status hook.
 *
 * File status transitions are driven locally:
 *   uploading -> processing (set after S3 upload completes)
 *   processing -> ready (would need EventBridge/WebSocket push in the future)
 *
 * The BDA pipeline triggers automatically via EventBridge when files land in S3.
 * For now, files stay in "processing" until the page is refreshed or the user
 * queries the KB (which will find the newly indexed content).
 */
export function useProcessingStatus(
  files: UploadedFile[],
  onFilesUpdated: (updatedFiles: UploadedFile[]) => void
) {
  // No-op — status is managed locally by useUploadManager.
  // Future enhancement: subscribe to EventBridge/WebSocket for real-time
  // BDA processing status updates.
}
