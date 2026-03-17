import { NextRequest, NextResponse } from "next/server";
import {
  BedrockAgentClient,
  GetIngestionJobCommand,
} from "@aws-sdk/client-bedrock-agent";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  ScanCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";

const REGION = process.env.AWS_REGION || "us-west-2";
const KB_ID = process.env.KB_ID || "";
const KB_DATA_SOURCE_ID = process.env.KB_DATA_SOURCE_ID || "";
const FILE_STATUS_TABLE = process.env.FILE_STATUS_TABLE || `file-status-${process.env.ENV || "dev"}`;

const bedrockAgentClient = new BedrockAgentClient({ region: REGION });
const ddbDocClient = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: REGION })
);

export const GET = async (req: NextRequest) => {
  try {
    const jobId = req.nextUrl.searchParams.get("jobId");
    if (!jobId) {
      return NextResponse.json(
        { error: "jobId query parameter is required" },
        { status: 400 }
      );
    }

    if (!KB_ID || !KB_DATA_SOURCE_ID) {
      return NextResponse.json(
        { error: "KB_ID or KB_DATA_SOURCE_ID not configured" },
        { status: 500 }
      );
    }

    const resp = await bedrockAgentClient.send(
      new GetIngestionJobCommand({
        knowledgeBaseId: KB_ID,
        dataSourceId: KB_DATA_SOURCE_ID,
        ingestionJobId: jobId,
      })
    );

    const job = resp.ingestionJob;
    const status = job?.status || "UNKNOWN";

    // When sync completes, update all 'processed' and 'syncing' files to 'ready'
    if (status === "COMPLETE") {
      await markFilesReady();
    }

    return NextResponse.json({
      status,
      statistics: job?.statistics,
    });
  } catch (error) {
    console.error("sync-status error:", error);
    return NextResponse.json(
      { error: "Failed to check sync status" },
      { status: 500 }
    );
  }
};

async function markFilesReady() {
  const now = new Date().toISOString();

  // Scan for files in 'processed' or 'syncing' state
  const result = await ddbDocClient.send(
    new ScanCommand({
      TableName: FILE_STATUS_TABLE,
      FilterExpression: "#st IN (:processed, :syncing)",
      ExpressionAttributeNames: { "#st": "status" },
      ExpressionAttributeValues: {
        ":processed": "processed",
        ":syncing": "syncing",
      },
    })
  );

  // Update each file to 'ready'
  const updates = (result.Items || []).map((item) =>
    ddbDocClient.send(
      new UpdateCommand({
        TableName: FILE_STATUS_TABLE,
        Key: { s3Key: item.s3Key },
        UpdateExpression: "SET #st = :ready, syncedAt = :now, updatedAt = :now",
        ExpressionAttributeNames: { "#st": "status" },
        ExpressionAttributeValues: { ":ready": "ready", ":now": now },
      })
    )
  );

  await Promise.all(updates);
}
