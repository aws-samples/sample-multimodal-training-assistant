"use client";

import { useState, useCallback, useRef } from "react";
import { fetchAuthSession } from "aws-amplify/auth";
import {
  BedrockAgentClient,
  StartIngestionJobCommand,
  GetIngestionJobCommand,
  ListIngestionJobsCommand,
} from "@aws-sdk/client-bedrock-agent";
import type { SyncState, UploadedFile } from "./types";

const POLL_INTERVAL_MS = 5000;
const KB_ID = process.env.NEXT_PUBLIC_KB_ID || "";
const KB_DATA_SOURCE_ID = process.env.NEXT_PUBLIC_KB_DATA_SOURCE_ID || "";
const KB_REGION = process.env.NEXT_PUBLIC_AWS_REGION || "us-east-1";

async function getBedrockAgentClient(): Promise<BedrockAgentClient> {
  const session = await fetchAuthSession();
  const creds = session.credentials;
  if (!creds) throw new Error("Not authenticated");
  return new BedrockAgentClient({ region: KB_REGION, credentials: creds });
}

export function SyncButton({ files, onFilesUpdated }: {
  files: UploadedFile[];
  onFilesUpdated: (files: UploadedFile[]) => void;
}) {
  const [syncState, setSyncState] = useState<SyncState>("idle");
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const processedCount = files.filter((f) => f.status === "processed").length;
  const hasProcessedFiles = processedCount > 0;

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const handleSync = useCallback(async () => {
    setSyncState("syncing");
    setError(null);

    // Mark processed files as syncing in the UI
    const updated = files.map((f) =>
      f.status === "processed" ? { ...f, status: "syncing" as const } : f
    );
    onFilesUpdated(updated);

    try {
      if (!KB_ID || !KB_DATA_SOURCE_ID) {
        throw new Error("Knowledge Base not configured");
      }

      const client = await getBedrockAgentClient();

      // Check for already-running ingestion job
      const listResp = await client.send(new ListIngestionJobsCommand({
        knowledgeBaseId: KB_ID,
        dataSourceId: KB_DATA_SOURCE_ID,
        maxResults: 1,
        sortBy: { attribute: "STARTED_AT", order: "DESCENDING" },
      }));

      const activeJob = listResp.ingestionJobSummaries?.find(
        (j) => j.status === "STARTING" || j.status === "IN_PROGRESS"
      );

      let ingestionJobId: string;

      if (activeJob?.ingestionJobId) {
        ingestionJobId = activeJob.ingestionJobId;
      } else {
        const startResp = await client.send(new StartIngestionJobCommand({
          knowledgeBaseId: KB_ID,
          dataSourceId: KB_DATA_SOURCE_ID,
        }));
        ingestionJobId = startResp.ingestionJob?.ingestionJobId || "";
        if (!ingestionJobId) throw new Error("No ingestion job ID returned");
      }

      // Poll sync status
      pollRef.current = setInterval(async () => {
        try {
          const pollClient = await getBedrockAgentClient();
          const statusResp = await pollClient.send(new GetIngestionJobCommand({
            knowledgeBaseId: KB_ID,
            dataSourceId: KB_DATA_SOURCE_ID,
            ingestionJobId,
          }));

          const status = statusResp.ingestionJob?.status;

          if (status === "COMPLETE") {
            stopPolling();
            setSyncState("complete");

            onFilesUpdated(
              files.map((f) =>
                f.status === "syncing" || f.status === "processed"
                  ? { ...f, status: "ready" as const, syncedAt: new Date().toISOString() }
                  : f
              )
            );

            setTimeout(() => setSyncState("idle"), 5000);
          } else if (status === "FAILED") {
            stopPolling();
            setSyncState("error");
            setError("Knowledge Base sync failed");

            onFilesUpdated(
              files.map((f) =>
                f.status === "syncing" ? { ...f, status: "processed" as const } : f
              )
            );
          }
        } catch {
          // Keep polling on transient errors
        }
      }, POLL_INTERVAL_MS);
    } catch (err) {
      setSyncState("error");
      setError(err instanceof Error ? err.message : "Sync failed");

      onFilesUpdated(
        files.map((f) =>
          f.status === "syncing" ? { ...f, status: "processed" as const } : f
        )
      );
    }
  }, [files, onFilesUpdated, stopPolling]);

  // Always show — users may need to sync after web research saves content to the bucket

  return (
    <div className="px-3 py-2">
      {syncState === "idle" && (
        <button
          onClick={handleSync}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          Sync to Knowledge Base{processedCount > 0 ? ` (${processedCount} new)` : ""}
        </button>
      )}

      {syncState === "syncing" && (
        <div className="flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium text-purple-700 dark:text-purple-300 bg-purple-50 dark:bg-purple-950/30 rounded-lg border border-purple-200 dark:border-purple-800">
          <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          Syncing to Knowledge Base...
        </div>
      )}

      {syncState === "complete" && (
        <div className="flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/30 rounded-lg border border-emerald-200 dark:border-emerald-800">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          All files synced
        </div>
      )}

      {syncState === "error" && (
        <div className="space-y-1">
          <div className="flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-950/30 rounded-lg border border-red-200 dark:border-red-800">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            {error || "Sync failed"}
          </div>
          <button
            onClick={handleSync}
            className="w-full text-xs text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-300 font-medium"
          >
            Retry
          </button>
        </div>
      )}
    </div>
  );
}
