#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { MultimediaRagStack } from '../lib/multimedia-rag-stack';
import { AgentCoreStack } from '../lib/agentcore-stack';
import { DEFAULT_MODEL_ID, DEFAULT_EMBEDDING_MODEL_ID } from '../lib/constants';

const app = new cdk.App();

// Get environment information — these are resolved from the AWS profile during deployment.
// If not set, CDK will resolve them at deploy time from the CLI profile.
const account = process.env.CDK_DEFAULT_ACCOUNT;
const region = process.env.CDK_DEFAULT_REGION;

if (!account || !region) {
  console.log('CDK_DEFAULT_ACCOUNT or CDK_DEFAULT_REGION not set. Run "aws configure" or set your AWS_PROFILE before deploying.');
}

const resourceSuffix = app.node.tryGetContext('resourceSuffix') || 'dev';

// 1. Deploy main infrastructure stack
const mainStack = new MultimediaRagStack(app, `MultimediaRagStack-${resourceSuffix}`, {
  resourceConfig: {
    resourceSuffix: resourceSuffix
  },
  modelId: DEFAULT_MODEL_ID,
  embeddingModelId: DEFAULT_EMBEDDING_MODEL_ID,
  useBedrockDataAutomation: true,
  externalLogBucketArn: app.node.tryGetContext('externalLogBucketArn'),
  env: { 
    account: account, 
    region: region 
  },
  description: 'Multimedia RAG solution for deploying a chatbot that can interact with documents, images, audio, and video (SO9024)'
});

// 2. Deploy AgentCore stack if requested
if (app.node.tryGetContext('deployAgentCore') === 'true') {
  const agentCoreStack = new AgentCoreStack(app, `AgentCoreStack-${resourceSuffix}`, {
    resourceSuffix: resourceSuffix,
    enableLongTermMemory: app.node.tryGetContext('disableLTM') !== 'true',
    memoryExpiryDays: parseInt(app.node.tryGetContext('memoryExpiryDays') || '30'),
    env: {
      account: account,
      region: region
    },
    description: 'AgentCore Memory for multimodal RAG chatbot with conversation persistence'
  });

  new cdk.CfnOutput(agentCoreStack, 'AgentCoreMemoryConfig', {
    value: JSON.stringify({
      memoryId: agentCoreStack.memoryId,
      region: region,
      ltmEnabled: app.node.tryGetContext('disableLTM') !== 'true'
    }),
    description: 'AgentCore Memory configuration for agent'
  });
}
