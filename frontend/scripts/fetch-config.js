#!/usr/bin/env node

/**
 * Fetch configuration from AWS SSM Parameter Store
 * Run this during build to populate environment variables
 */

const { SSMClient, GetParameterCommand } = require("@aws-sdk/client-ssm");

const REGION = process.env.AWS_REGION || "us-west-2";
const ENV = process.env.ENVIRONMENT || "dev";

const client = new SSMClient({ region: REGION });

async function getParameter(name) {
  try {
    const command = new GetParameterCommand({ Name: name });
    const response = await client.send(command);
    return response.Parameter.Value;
  } catch (error) {
    console.error(`Failed to fetch ${name}:`, error.message);
    return null;
  }
}

async function main() {
  console.log("Fetching configuration from SSM...");

  const mediaBucket = await getParameter(`/multimodal-rag/${ENV}/MediaBucketName`);
  const kbId = await getParameter(`/multimodal-rag/${ENV}/KnowledgeBaseId`);

  if (!mediaBucket || !kbId) {
    console.error("Failed to fetch required parameters from SSM");
    process.exit(1);
  }

  // Write to .env.local for Next.js
  const fs = require("fs");
  const envContent = `# Auto-generated from SSM - DO NOT EDIT MANUALLY
NEXT_PUBLIC_MEDIA_BUCKET=${mediaBucket}
NEXT_PUBLIC_MEDIA_BUCKET_REGION=${REGION}
NEXT_PUBLIC_KB_ID=${kbId}
`;

  fs.writeFileSync(".env.local", envContent);
  console.log("✅ Configuration written to .env.local");
  console.log(`   Media Bucket: ${mediaBucket}`);
  console.log(`   KB ID: ${kbId}`);
}

main().catch(console.error);
