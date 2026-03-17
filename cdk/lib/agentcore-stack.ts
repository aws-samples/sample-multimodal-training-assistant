import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';

export interface AgentCoreStackProps extends cdk.StackProps {
  resourceSuffix: string;
  enableLongTermMemory?: boolean;
  memoryExpiryDays?: number;
}

export class AgentCoreStack extends cdk.Stack {
  public readonly memoryId: string;
  public readonly memoryArn: string;

  constructor(scope: Construct, id: string, props: AgentCoreStackProps) {
    super(scope, id, props);

    const {
      resourceSuffix,
      enableLongTermMemory = true,
      memoryExpiryDays = 30,
    } = props;

    // IAM role for AgentCore Memory
    const memoryRole = new iam.Role(this, 'MemoryExecutionRole', {
      assumedBy: new iam.ServicePrincipal('bedrock-agentcore.amazonaws.com'),
      description: 'Execution role for AgentCore Memory service',
    });

    // Grant Bedrock permissions — foundation models + cross-region inference profiles
    memoryRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'bedrock:InvokeModel',
        'bedrock:InvokeModelWithResponseStream',
        'bedrock:InvokeModelWithBidirectionalStream',
      ],
      resources: [
        `arn:aws:bedrock:*::foundation-model/*`,
        `arn:aws:bedrock:*::inference-profile/*`,
        `arn:aws:bedrock:*:${this.account}:inference-profile/*`,
      ],
    }));

    // Grant Bedrock Knowledge Base permissions for RAG
    memoryRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'bedrock:Retrieve',
        'bedrock:RetrieveAndGenerate',
      ],
      resources: [
        `arn:aws:bedrock:${this.region}:${this.account}:knowledge-base/*`,
      ],
    }));

    // Grant rerank permission (used by kb_client.py retrieve with reranking config)
    // Rerank requires * resource — not scoped to specific model ARNs
    memoryRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['bedrock:Rerank'],
      resources: ['*'],
    }));

    // Grant ECR auth token (must be * per AWS API)
    memoryRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'ecr:GetAuthorizationToken',
      ],
      resources: ['*'],
    }));

    // Grant ECR image pull — scoped to AgentCore repositories
    memoryRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'ecr:BatchCheckLayerAvailability',
        'ecr:GetDownloadUrlForLayer',
        'ecr:BatchGetImage',
      ],
      resources: [
        `arn:aws:ecr:${this.region}:${this.account}:repository/bedrock-agentcore-*`,
      ],
    }));

    // Grant AgentCore Gateway invoke permission — scoped to account gateways
    memoryRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['bedrock-agentcore:InvokeGateway'],
      resources: [
        `arn:aws:bedrock-agentcore:${this.region}:${this.account}:gateway/*`,
      ],
    }));

    // Grant DynamoDB permissions for course management and user progress
    const dynamoTableArn = `arn:aws:dynamodb:${this.region}:${this.account}:table/learning-platform-${resourceSuffix}`;
    memoryRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'dynamodb:GetItem',
        'dynamodb:PutItem',
        'dynamodb:UpdateItem',
        'dynamodb:DeleteItem',
        'dynamodb:Query',
        'dynamodb:Scan',
      ],
      resources: [
        dynamoTableArn,
        `${dynamoTableArn}/index/*`,
      ],
    }));

    // Grant S3 permissions to write web research content to organized bucket
    memoryRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['s3:PutObject'],
      resources: [`arn:aws:s3:::multimediaragstack-${resourceSuffix}-sto-organizedbucket*/*`],
    }));

    // Grant Bedrock permissions for KB ingestion (sync after web research)
    memoryRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'bedrock:StartIngestionJob',
        'bedrock:ListIngestionJobs',
        'bedrock:GetIngestionJob',
      ],
      resources: [`arn:aws:bedrock:${this.region}:${this.account}:knowledge-base/*`],
    }));

    // S3 bucket for agent session persistence (conversation history)
    const sessionBucket = new s3.Bucket(this, 'AgentSessionBucket', {
      bucketName: `agent-sessions-${resourceSuffix}-${this.account}-${this.region}`,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      lifecycleRules: [{
        expiration: cdk.Duration.days(memoryExpiryDays),
        prefix: 'agent-sessions/',
      }],
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
    });

    // Grant least-privilege S3 access to the execution role
    sessionBucket.grantReadWrite(memoryRole, 'agent-sessions/*');
    sessionBucket.grantRead(memoryRole); // For ListBucket

    // Memory strategies (LTM) - only if enabled
    const memoryStrategies = enableLongTermMemory ? [
      {
        SummaryMemoryStrategy: {
          Name: 'SessionSummarizer',
          Namespaces: [`/summaries/{actorId}/{sessionId}`],
        },
      },
      {
        UserPreferenceMemoryStrategy: {
          Name: 'PreferenceLearner',
          Namespaces: [`/preferences/{actorId}`],
        },
      },
      {
        SemanticMemoryStrategy: {
          Name: 'FactExtractor',
          Namespaces: [`/facts/{actorId}`],
        },
      },
    ] : undefined;

    // AgentCore Memory resource
    const memory = new cdk.CfnResource(this, 'AgentMemory', {
      type: 'AWS::BedrockAgentCore::Memory',
      properties: {
        Name: `MultimodalChatbotMemory${resourceSuffix}`,
        Description: enableLongTermMemory
          ? 'Long-term memory for multimodal RAG chatbot with user preferences, facts, and session summaries'
          : 'Short-term memory for multimodal RAG chatbot conversation persistence',
        EventExpiryDuration: memoryExpiryDays,
        MemoryExecutionRoleArn: memoryRole.roleArn,
        ...(memoryStrategies && { MemoryStrategies: memoryStrategies }),
      },
    });

    // Store outputs
    this.memoryId = memory.getAtt('MemoryId').toString();
    this.memoryArn = memory.getAtt('MemoryArn').toString();

    // Store in SSM for easy access by agent code
    new ssm.StringParameter(this, 'MemoryIdParam', {
      parameterName: `/multimedia-rag/${resourceSuffix}/agentcore-memory-id`,
      stringValue: this.memoryId,
      description: 'AgentCore Memory ID for agent configuration',
    });

    new ssm.StringParameter(this, 'MemoryArnParam', {
      parameterName: `/multimedia-rag/${resourceSuffix}/agentcore-memory-arn`,
      stringValue: this.memoryArn,
      description: 'AgentCore Memory ARN',
    });

    new ssm.StringParameter(this, 'MemoryRegionParam', {
      parameterName: `/multimedia-rag/${resourceSuffix}/agentcore-memory-region`,
      stringValue: this.region,
      description: 'AgentCore Memory region',
    });

    new ssm.StringParameter(this, 'MemoryTypeParam', {
      parameterName: `/multimedia-rag/${resourceSuffix}/agentcore-memory-type`,
      stringValue: enableLongTermMemory ? 'LTM' : 'STM',
      description: 'Memory type (LTM or STM)',
    });

    new ssm.StringParameter(this, 'SessionBucketParam', {
      parameterName: `/multimedia-rag/${resourceSuffix}/session-bucket`,
      stringValue: sessionBucket.bucketName,
      description: 'S3 bucket for agent session persistence',
    });

    // Outputs
    new cdk.CfnOutput(this, 'MemoryId', {
      value: this.memoryId,
      description: 'AgentCore Memory ID for agent configuration',
      exportName: `AgentCoreMemoryId-${resourceSuffix}`,
    });

    new cdk.CfnOutput(this, 'MemoryArn', {
      value: this.memoryArn,
      description: 'AgentCore Memory ARN',
      exportName: `AgentCoreMemoryArn-${resourceSuffix}`,
    });

    new cdk.CfnOutput(this, 'MemoryType', {
      value: enableLongTermMemory ? 'LTM (with strategies)' : 'STM (basic)',
      description: 'Memory type deployed',
    });

    new cdk.CfnOutput(this, 'MemoryExpiryDays', {
      value: memoryExpiryDays.toString(),
      description: 'Event expiry duration in days',
    });

    new cdk.CfnOutput(this, 'AgentCoreExecutionRoleArn', {
      value: memoryRole.roleArn,
      description: 'Execution role ARN for AgentCore Runtime',
      exportName: `AgentCoreExecutionRoleArn-${resourceSuffix}`,
    });

    new cdk.CfnOutput(this, 'SessionBucketName', {
      value: sessionBucket.bucketName,
      description: 'S3 bucket for agent session persistence',
      exportName: `AgentCoreSessionBucket-${resourceSuffix}`,
    });
  }
}
