import { NextResponse } from "next/server";
import {
  BedrockAgentClient,
  StartIngestionJobCommand,
  ListIngestionJobsCommand,
  GetIngestionJobCommand,
} from "@aws-sdk/client-bedrock-agent";

const REGION = process.env.AWS_REGION || "us-west-2";
const KB_ID = process.env.KB_ID || "";
const KB_DATA_SOURCE_ID = process.env.KB_DATA_SOURCE_ID || "";

const bedrockAgentClient = new BedrockAgentClient({ region: REGION });

export const POST = async () => {
  try {
    if (!KB_ID || !KB_DATA_SOURCE_ID) {
      return NextResponse.json(
        { error: "KB_ID or KB_DATA_SOURCE_ID not configured" },
        { status: 500 }
      );
    }

    // Check for in-progress ingestion jobs before starting a new one
    const listResp = await bedrockAgentClient.send(
      new ListIngestionJobsCommand({
        knowledgeBaseId: KB_ID,
        dataSourceId: KB_DATA_SOURCE_ID,
        maxResults: 5,
        sortBy: { attribute: "STARTED_AT", order: "DESCENDING" },
      })
    );

    const activeJobs = (listResp.ingestionJobSummaries || []).filter(
      (job) => job.status === "STARTING" || job.status === "IN_PROGRESS"
    );

    if (activeJobs.length > 0) {
      // Return the existing job ID so the frontend can poll it
      return NextResponse.json({
        ingestionJobId: activeJobs[0].ingestionJobId,
        status: activeJobs[0].status,
        message: "Ingestion job already in progress",
      });
    }

    // Start a new ingestion job
    const startResp = await bedrockAgentClient.send(
      new StartIngestionJobCommand({
        knowledgeBaseId: KB_ID,
        dataSourceId: KB_DATA_SOURCE_ID,
      })
    );

    return NextResponse.json({
      ingestionJobId: startResp.ingestionJob?.ingestionJobId,
      status: startResp.ingestionJob?.status,
    });
  } catch (error) {
    console.error("sync-kb error:", error);
    return NextResponse.json(
      { error: "Failed to start KB sync" },
      { status: 500 }
    );
  }
};
