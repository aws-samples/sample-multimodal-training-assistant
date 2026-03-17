import { NextResponse } from "next/server";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand } from "@aws-sdk/lib-dynamodb";

const REGION = process.env.AWS_REGION || "us-west-2";
const FILE_STATUS_TABLE = process.env.FILE_STATUS_TABLE || `file-status-${process.env.ENV || "dev"}`;

const ddbDocClient = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: REGION })
);

export const GET = async () => {
  try {
    // Single-user model: return all files (no userId filter)
    const result = await ddbDocClient.send(
      new ScanCommand({
        TableName: FILE_STATUS_TABLE,
      })
    );

    const files = (result.Items || []).map((item) => ({
      s3Key: item.s3Key,
      fileName: item.fileName,
      fileType: item.fileType,
      status: item.status,
      metadata: item.metadata,
      uploadedAt: item.uploadedAt,
      processedAt: item.processedAt,
      syncedAt: item.syncedAt,
      errorMessage: item.errorMessage,
    }));

    return NextResponse.json({ files });
  } catch (error) {
    console.error("upload-status error:", error);
    return NextResponse.json(
      { error: "Failed to fetch upload status" },
      { status: 500 }
    );
  }
};
