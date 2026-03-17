import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as opensearchserverless from 'aws-cdk-lib/aws-opensearchserverless';
import * as cr from 'aws-cdk-lib/custom-resources';
import * as bedrock from 'aws-cdk-lib/aws-bedrock';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { DEFAULT_MODEL_ID, DEFAULT_EMBEDDING_MODEL_ID, WAF_TAGS } from './constants';

/**
 * Props for the ProcessingStack
 */
export interface ProcessingStackProps extends cdk.NestedStackProps {
  /**
   * Suffix to append to resource names
   */
  resourceSuffix: string;
  
  /**
   * The Bedrock model ID to use for inference
   */
  modelId?: string;
  
  /**
   * The Bedrock embedding model ID to use for vector embeddings
   */
  embeddingModelId?: string;
  
  /**
   * Media bucket for source files
   */
  mediaBucket: s3.Bucket;
  
  /**
   * Organized bucket for processed files
   */
  organizedBucket: s3.Bucket;
  
  /**
   * Multimodal bucket for Bedrock Knowledge Base
   */
  multimodalBucket: s3.Bucket;

  /**
   * OpenSearch Serverless Collection
   */
  opensearchCollection: opensearchserverless.CfnCollection;
}

/**
 * Processing Stack for multimedia-rag application
 * 
 * This stack provisions the Lambda functions and Bedrock resources:
 * - BDA Project Creator function
 * - BDA Processing function
 * - Initial Processing function
 * - Retrieval function
 * - Bedrock Knowledge Base and Data Source
 */
export class ProcessingStack extends cdk.NestedStack {
  /**
   * BDA Project ARN
   */
  public readonly bdaProjectArn: string;
  
  /**
   * Retrieval Lambda function
   */
  public readonly retrievalFunction: lambda.Function;
  
  /**
   * Bedrock Knowledge Base
   */
  public readonly knowledgeBase: bedrock.CfnKnowledgeBase;
  
  /**
   * Bedrock Knowledge Base Data Source
   */
  public readonly dataSource: bedrock.CfnDataSource;
  
  /**
   * Bedrock Knowledge Base ID
   */
  public readonly knowledgeBaseId: string;
  
  /**
   * Bedrock Knowledge Base ARN
   */
  public readonly knowledgeBaseArn: string;
  
  /**
   * Bedrock Knowledge Base Data Source ID
   */
  public readonly dataSourceId: string;

  /**
   * Learning Platform DynamoDB Table
   */
  public readonly learningPlatformTable: dynamodb.Table;

  /**
   * File Status DynamoDB Table (tracks upload/processing status)
   */
  public readonly fileStatusTable: dynamodb.Table;

  constructor(scope: Construct, id: string, props: ProcessingStackProps) {
    super(scope, id, props);

    // Add Well-Architected Framework tags to stack
    Object.entries(WAF_TAGS).forEach(([key, value]) => {
      cdk.Tags.of(this).add(key, value);
    });
    
    // Add environment tag
    cdk.Tags.of(this).add('Environment', props.resourceSuffix);

    // Create Learning Platform DynamoDB table (single-table design)
    this.learningPlatformTable = new dynamodb.Table(this, 'LearningPlatformTable', {
      tableName: `learning-platform-${props.resourceSuffix}`,
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    new ssm.StringParameter(this, 'LearningPlatformTableParam', {
      parameterName: `/multimedia-rag/${props.resourceSuffix}/dynamodb-table`,
      stringValue: this.learningPlatformTable.tableName,
      description: 'Learning Platform DynamoDB table name',
    });

    new cdk.CfnOutput(this, 'LearningPlatformTableName', {
      value: this.learningPlatformTable.tableName,
      description: 'Learning Platform DynamoDB Table Name',
      exportName: `${id}-LearningPlatformTableName`,
    });

    // Create File Status DynamoDB table (tracks upload/processing/sync status)
    this.fileStatusTable = new dynamodb.Table(this, 'FileStatusTable', {
      tableName: `file-status-${props.resourceSuffix}`,
      partitionKey: { name: 's3Key', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    new ssm.StringParameter(this, 'FileStatusTableParam', {
      parameterName: `/multimedia-rag/${props.resourceSuffix}/file-status-table`,
      stringValue: this.fileStatusTable.tableName,
      description: 'File Status DynamoDB table name',
    });

    new cdk.CfnOutput(this, 'FileStatusTableName', {
      value: this.fileStatusTable.tableName,
      description: 'File Status DynamoDB Table Name',
      exportName: `${id}-FileStatusTableName`,
    });

    // Use provided model IDs or defaults
    const modelId = props.modelId || DEFAULT_MODEL_ID;
    const embeddingModelId = props.embeddingModelId || DEFAULT_EMBEDDING_MODEL_ID;

    // Create BDA (Bedrock Data Automation) resources
    const bdaResources = this.createBdaResources(props);
    this.bdaProjectArn = bdaResources.bdaProjectArn;
    
    // Create Initial Processing Lambda to handle new uploads
    const { initialProcessingFunction } = this.createInitialProcessingFunction(
      props,
      bdaResources.bdaProjectArn,
      bdaResources.bdaProcessingFunction
    );

    // Create file processing rule with shorter name to trigger Initial Processing Lambda
    const fileProcessingRule = new events.Rule(this, 'FileProcessingRule', {
      ruleName: `file-proc-rule-${props.resourceSuffix}`,
      description: 'Rule to process media and non-media files',
      eventPattern: {
        source: ['aws.s3'],
        detailType: ['Object Created'],
        detail: {
          bucket: {
            name: [props.mediaBucket.bucketName]
          }
        }
      }
    });
    
    fileProcessingRule.addTarget(new targets.LambdaFunction(initialProcessingFunction));
    
    // Create Retrieval Lambda function
    this.retrievalFunction = this.createRetrievalFunction(props, modelId);

    // Create Bedrock Knowledge Base resources
    const bedrockResources = this.createBedrockKnowledgeBaseResources(props, embeddingModelId);
    this.knowledgeBase = bedrockResources.knowledgeBase;
    this.dataSource = bedrockResources.dataSource;
    this.knowledgeBaseId = bedrockResources.knowledgeBaseId;
    this.knowledgeBaseArn = bedrockResources.knowledgeBaseArn;
    this.dataSourceId = bedrockResources.dataSourceId;

    // Output resources for cross-stack references
    new cdk.CfnOutput(this, 'RetrievalFunctionArn', {
      value: this.retrievalFunction.functionArn,
      description: 'Retrieval Lambda Function ARN',
      exportName: `${id}-RetrievalFunctionArn`
    });
  }

  /**
   * Create Bedrock Data Automation resources
   */
  private createBdaResources(props: ProcessingStackProps): {
    bdaProjectArn: string;
    bdaProcessingFunction: lambda.Function;
  } {
    // Create BDA Project Creator role with appropriate permissions
    const bdaProjectCreatorRole = new iam.Role(this, 'BDAProjectCreatorRole', {
      roleName: `bda-creator-role-${props.resourceSuffix}`,
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole')
      ],
      inlinePolicies: {
        BDAAccess: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ['bedrock:CreateDataAutomationProject'],
              resources: [`arn:aws:bedrock:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:data-automation-project/*`]
            })
          ]
        })
      }
    });

    // Create BDA Project Creator function based on chatbot.yaml implementation
    const bdaProjectCreatorFunction = new lambda.Function(this, 'BDAProjectCreatorFunction', {
      functionName: `bda-project-creator-${props.resourceSuffix}`,
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'index.handler',
      code: lambda.Code.fromInline(`
import boto3
import cfnresponse
import os
from botocore.exceptions import ClientError

def handler(event, context):
    try:
        if event['RequestType'] in ['Create', 'Update']:
            # Get stack name and resource suffix from environment variables
            stack_name = os.environ.get('STACK_NAME')
            resource_suffix = os.environ.get('RESOURCE_SUFFIX')
            region = os.environ.get('REGION')
            project_name = f"{stack_name}-bda-project-{resource_suffix}"
            
            # Create Bedrock Data Automation client
            bda_client = boto3.client('bedrock-data-automation', region)
            
            # Define standard output configuration
            standard_output_config = {
                "document": {
                    "extraction": {
                        "granularity": {
                            "types": [
                                "PAGE",
                                "ELEMENT",
                                "WORD"
                            ]
                        },
                        "boundingBox": {
                            "state": "ENABLED"
                        }
                    },
                    "generativeField": {
                        "state": "ENABLED"
                    },
                    "outputFormat": {
                        "textFormat": {
                            "types": [
                                "PLAIN_TEXT"
                            ]
                        },
                        "additionalFileFormat": {
                            "state": "ENABLED"
                        }
                    }
                },
                "image": {
                    "extraction": {
                        "category": {
                            "state": "ENABLED",
                            "types": [
                                "TEXT_DETECTION",
                                "CONTENT_MODERATION"
                            ]
                        },
                        "boundingBox": {
                            "state": "ENABLED"
                        }
                    },
                    "generativeField": {
                        "state": "ENABLED",
                        "types": [
                            "IMAGE_SUMMARY",
                            "IAB"
                        ]
                    }
                },
                "video": {
                    "extraction": {
                        "category": {
                            "state": "ENABLED",
                            "types": [
                                "TRANSCRIPT",
                                "TEXT_DETECTION",
                                "CONTENT_MODERATION"
                            ]
                        },
                        "boundingBox": {
                            "state": "ENABLED"
                        }
                    },
                    "generativeField": {
                        "state": "ENABLED",
                        "types": [
                            "VIDEO_SUMMARY",
                            "CHAPTER_SUMMARY",
                            "IAB"
                        ]
                    }
                },
                "audio": {
                    "extraction": {
                        "category": {
                            "state": "ENABLED",
                            "types": [
                                "TRANSCRIPT",
                                "AUDIO_CONTENT_MODERATION"
                            ]
                        }
                    },
                    "generativeField": {
                        "state": "ENABLED",
                        "types": [
                            "AUDIO_SUMMARY",
                            "TOPIC_SUMMARY"
                        ]
                    }
                }
            }
            
            try:
                # Create the project
                response = bda_client.create_data_automation_project(
                    projectName=project_name,
                    projectDescription=f"Data automation project for {project_name}",
                    projectStage='LIVE',
                    standardOutputConfiguration=standard_output_config,
                    overrideConfiguration={
                        'document': {
                            'splitter': {
                                'state': 'ENABLED'
                            }
                        }
                    }
                )
                
                print(f"Project created successfully with ARN: {response['projectArn']}")
                cfnresponse.send(event, context, cfnresponse.SUCCESS, {
                    'ProjectArn': response['projectArn'],
                    'ProjectName': project_name
                })
            except ClientError as e:
                print(f"Error: {str(e)}")
                cfnresponse.send(event, context, cfnresponse.FAILED, {
                    'Error': str(e)
                })
        else:
            # Handle DELETE request
            cfnresponse.send(event, context, cfnresponse.SUCCESS, {})
    except Exception as e:
        print(f"Error: {str(e)}")
        cfnresponse.send(event, context, cfnresponse.FAILED, {})
      `),
      role: bdaProjectCreatorRole,
      environment: {
        STACK_NAME: cdk.Aws.STACK_NAME,
        RESOURCE_SUFFIX: props.resourceSuffix,
        REGION: cdk.Aws.REGION
      }
    });
    
    // Create a lambda-backed custom resource directly instead of using a provider
    const bdaProjectCreator = new cdk.CustomResource(this, 'BDAProjectCreator', {
      serviceToken: bdaProjectCreatorFunction.functionArn,
      properties: {
        Name: `bda-project-${props.resourceSuffix}`
      }
    });
    
    // Get the project ARN from the custom resource
    const bdaProjectArn = bdaProjectCreator.getAttString('ProjectArn');

    // Create BDA Processing Function Role
    const bdaProcessingFunctionRole = new iam.Role(this, 'BDAProcessingFunctionRole', {
      roleName: `BDAProcessingFunctionRole-${props.resourceSuffix}`,
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole')
      ],
      inlinePolicies: {
        S3Access: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                's3:PutObject',
                's3:GetObject',
                's3:ListBucket'
              ],
              resources: [
                props.organizedBucket.bucketArn,
                `${props.organizedBucket.bucketArn}/*`
              ]
            })
          ]
        }),
        FileStatusTableAccess: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'dynamodb:PutItem',
                'dynamodb:UpdateItem'
              ],
              resources: [
                this.fileStatusTable.tableArn
              ]
            })
          ]
        })
      }
    });

    // Create BDA Processing Lambda function
    const bdaProcessingDlq = new sqs.Queue(this, 'BDAProcessingDLQ', {
      queueName: `bda-processing-dlq-${props.resourceSuffix}`,
      retentionPeriod: cdk.Duration.days(14),
      encryption: sqs.QueueEncryption.SQS_MANAGED
    });

    const bdaProcessingFunction = new lambda.Function(this, 'BDAProcessingFunction', {
      functionName: `bda-processor-${props.resourceSuffix}`,
      handler: 'index.lambda_handler',
      role: bdaProcessingFunctionRole,
      code: lambda.Code.fromAsset('lambda/bda-processing'),
      runtime: lambda.Runtime.PYTHON_3_12,
      timeout: cdk.Duration.minutes(15),
      memorySize: 256,
      deadLetterQueue: bdaProcessingDlq,
      deadLetterQueueEnabled: true,
      retryAttempts: 2,
      environment: {
        ORGANIZED_BUCKET: props.organizedBucket.bucketName,
        CHUNK_SIZE_MS: '60000',
        FILE_STATUS_TABLE: this.fileStatusTable.tableName
      }
    });

    // Create BDA Event Rule
    const bdaEventRule = new events.Rule(this, 'BDAEventRule', {
      ruleName: `bda-async-rule-${props.resourceSuffix}`,
      description: 'Rule for BDA async API calls',
      eventPattern: {
        source: [
          'aws.bedrock',
          'aws.bedrock-test'
        ],
        detailType: [
          'Bedrock Data Automation Job Succeeded',
          'Bedrock Data Automation Job Failed With Client Error',
          'Bedrock Data Automation Job Failed With Service Error'
        ]
      }
    });
    
    // Add target to the event rule
    bdaEventRule.addTarget(new targets.LambdaFunction(bdaProcessingFunction));

    // Add permission for EventBridge to invoke the Lambda function
    bdaProcessingFunction.addPermission('BDAProcessingFunctionLambdaPermission', {
      principal: new iam.ServicePrincipal('events.amazonaws.com'),
      action: 'lambda:InvokeFunction',
      sourceArn: bdaEventRule.ruleArn
    });

    return { bdaProjectArn, bdaProcessingFunction };
  }

  /**
   * Create Initial Processing Lambda function
   */
  private createInitialProcessingFunction(
    props: ProcessingStackProps,
    bdaProjectArn: string,
    bdaProcessingFunction: lambda.Function
  ): {
    initialProcessingFunction: lambda.Function;
  } {
    // Create Initial Processing Role with shorter name
    const initialProcessingRole = new iam.Role(this, 'InitialProcessingRole', {
      roleName: `init-proc-role-${props.resourceSuffix}`,
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole')
      ],
      inlinePolicies: {
        S3Access: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ['s3:GetObject', 's3:DeleteObject'],
              resources: [`${props.mediaBucket.bucketArn}/*`]
            }),
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ['s3:PutObject'],
              resources: [`${props.organizedBucket.bucketArn}/*`]
            })
          ]
        })
      }
    });

    // BDA invoke permissions
    const bdaInvokePolicy = new iam.Policy(this, 'BDAInvokePolicy', {
      statements: [
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: ['bedrock:InvokeDataAutomationAsync'],
          resources: [
            bdaProjectArn,
            `arn:aws:bedrock:us-east-1:${cdk.Aws.ACCOUNT_ID}:data-automation-profile/us.data-automation-v1`,
            `arn:aws:bedrock:us-east-2:${cdk.Aws.ACCOUNT_ID}:data-automation-profile/us.data-automation-v1`,
            `arn:aws:bedrock:us-west-1:${cdk.Aws.ACCOUNT_ID}:data-automation-profile/us.data-automation-v1`,
            `arn:aws:bedrock:us-west-2:${cdk.Aws.ACCOUNT_ID}:data-automation-profile/us.data-automation-v1`
          ]
        })
      ]
    });
    
    // Attach the policy to the role
    bdaInvokePolicy.attachToRole(initialProcessingRole);

    // Create Initial Processing Lambda function with shorter name
    const initialProcessingFunction = new lambda.Function(this, 'InitialProcessingFunction', {
      functionName: `init-processing-${props.resourceSuffix}`,
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'index.lambda_handler',
      code: lambda.Code.fromInline(`
import json
import boto3
import os

region = os.environ['AWS_REGION']
bedrock_data_automation = boto3.client('bedrock-data-automation-runtime', region_name=region)

def lambda_handler(event, context):
    print('Received event:', json.dumps(event, indent=2))
    account_id = context.invoked_function_arn.split(':')[4]
    source_bucket = event['detail']['bucket']['name']
    key = event['detail']['object']['key']
    target_bucket = os.environ['ORGANIZED_BUCKET']
    
    file_extension = os.path.splitext(key)[1].lower()
    file_name = os.path.splitext(os.path.basename(key))[0]
    file_name_with_extension = f"{file_name}_{file_extension[1:]}"

    try:
        response = bedrock_data_automation.invoke_data_automation_async(
            inputConfiguration={
                's3Uri': f's3://{source_bucket}/{key}'
            },
            outputConfiguration={
                's3Uri': f's3://{target_bucket}/bda-output/{file_name_with_extension}/'
            },
            dataAutomationConfiguration={
                'dataAutomationProjectArn': os.environ['BDA_AUTOMATION_ARN'],
                'stage': 'LIVE'
            },
            notificationConfiguration={
                'eventBridgeConfiguration': {
                    'eventBridgeEnabled': True
                }
            },
            dataAutomationProfileArn=f'arn:aws:bedrock:{region}:{account_id}:data-automation-profile/us.data-automation-v1'
        )
        
        print(f"BDA processing started for {key}")
        return {
            'statusCode': 200,
            'body': json.dumps({'message': 'BDA processing started'})
        }
    except Exception as e:
        print(f"Error invoking BDA for {key}: {str(e)}")
        raise
      `),
      role: initialProcessingRole,
      timeout: cdk.Duration.minutes(15),
      environment: {
        ORGANIZED_BUCKET: props.organizedBucket.bucketName,
        BDA_AUTOMATION_ARN: bdaProjectArn
      }
    });

    return { initialProcessingFunction };
  }

  /**
   * Create Retrieval Lambda function
   */
  private createRetrievalFunction(props: ProcessingStackProps, modelId: string): lambda.Function {
    // Create Retrieval Function Role
    const retrievalFunctionRole = new iam.Role(this, 'RetrievalFunctionRole', {
      roleName: `retrieval-role-${props.resourceSuffix}`,
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      inlinePolicies: {
        BedrockAccess: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'bedrock:InvokeModel',
                'bedrock:Retrieve',
                'bedrock:RetrieveAndGenerate',
                'bedrock-agent-runtime:Retrieve',
                'bedrock-agent-runtime:RetrieveAndGenerate',
                'bedrock-runtime:InvokeModel',
                'bedrock:ApplyGuardrail'
              ],
              resources: [
                `arn:aws:bedrock:${cdk.Aws.REGION}::foundation-model/*`,
                `arn:aws:bedrock:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:knowledge-base/*`,
                `arn:aws:bedrock:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:guardrail/*`,
              ]
            })
          ]
        }),
        CloudWatchLogsAccess: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'logs:CreateLogGroup',
                'logs:CreateLogStream',
                'logs:PutLogEvents'
              ],
              resources: [
                `arn:aws:logs:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:log-group:/aws/lambda/retrieval-fn-${props.resourceSuffix}:*`
              ]
            })
          ]
        })
      }
    });

    // Create Retrieval Lambda function with adequate permissions
    const retrievalFunction = new lambda.Function(this, 'RetrievalFunction', {
      functionName: `retrieval-fn-${props.resourceSuffix}`,
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'index.lambda_handler',
      code: lambda.Code.fromAsset('lambda/retrieval'),
      role: retrievalFunctionRole,
      timeout: cdk.Duration.minutes(15),
      memorySize: 512,
      environment: {
        MODEL_ID: modelId
        // OPS_KNOWLEDGE_BASE_ID will be added after creating the Knowledge Base
      }
    });

    return retrievalFunction;
  }

  /**
   * Create Bedrock Knowledge Base resources
   */
  private createBedrockKnowledgeBaseResources(
    props: ProcessingStackProps,
    embeddingModelId: string
  ): {
    knowledgeBase: bedrock.CfnKnowledgeBase;
    dataSource: bedrock.CfnDataSource;
    knowledgeBaseId: string;
    knowledgeBaseArn: string;
    dataSourceId: string;
  } {
    // Create Bedrock Knowledge Base Role with enhanced permissions
    const bedrockKnowledgeBaseRole = new iam.Role(this, 'BedrockKnowledgeBaseRole', {
      roleName: `kb-role-${props.resourceSuffix}`,
      assumedBy: new iam.ServicePrincipal('bedrock.amazonaws.com'),
      inlinePolicies: {
        BedrockKBAccess: new iam.PolicyDocument({
          statements: [
            // OpenSearch Serverless — scoped to specific collection only
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'aoss:APIAccessAll'
              ],
              resources: [
                props.opensearchCollection.attrArn,
                `${props.opensearchCollection.attrArn}/*`,
              ]
            }),
            // S3 permissions for organized bucket (KB reads source docs, writes during ingestion)
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                's3:GetObject',
                's3:ListBucket',
                's3:PutObject',
                's3:GetBucketLocation'
              ],
              resources: [
                props.organizedBucket.bucketArn,
                `${props.organizedBucket.bucketArn}/*`
              ]
            }),
            // S3 full access for multimodal bucket (supplemental data storage — Bedrock
            // validates read+write+delete at KB creation time)
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                's3:GetObject',
                's3:ListBucket',
                's3:PutObject',
                's3:DeleteObject',
                's3:GetBucketLocation'
              ],
              resources: [
                props.multimodalBucket.bucketArn,
                `${props.multimodalBucket.bucketArn}/*`
              ]
            }),
            // Bedrock model permissions
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'bedrock:ListFoundationModels',
                'bedrock:GetFoundationModel',
                'bedrock:InvokeModel',
                'bedrock:Retrieve',
                // KB management (read-only at runtime)
                'bedrock-agent:GetKnowledgeBase',
                'bedrock-agent:GetDataSource',
                'bedrock-agent:ListDataSources',
                // Ingestion / sync
                'bedrock-agent:StartIngestionJob',
                'bedrock-agent:StopIngestionJob',
                'bedrock-agent:GetIngestionJob',
                'bedrock-agent:ListIngestionJobs',
                'bedrock-agent:IngestKnowledgeBaseDocuments',
                'bedrock-agent:GetKnowledgeBaseDocuments',
                'bedrock-agent:ListKnowledgeBaseDocuments',
                // Retrieval
                'bedrock-agent-runtime:Retrieve'
              ],
              resources: [
                `arn:aws:bedrock:${cdk.Aws.REGION}::foundation-model/*`,
                `arn:aws:bedrock:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:custom-model/*`,
                `arn:aws:bedrock:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:provisioned-model/*`,
                `arn:aws:bedrock:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:knowledge-base/*`
              ]
            }),
            // Rerank requires * resource — not scoped to specific model ARNs
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ['bedrock:Rerank'],
              resources: ['*']
            }),
            // NOTE: DynamoDB access removed from KB role — Bedrock KB service only needs
            // S3 and OpenSearch access for ingestion. DynamoDB is accessed by the agent
            // (via AgentCore Runtime execution role), not the KB service.
          ]
        })
      }
    });

    // Create a delay function to allow OpenSearch collection to fully initialize
    const openSearchDelayFunction = new lambda.Function(this, 'OpenSearchDelayFunction', {
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'index.handler',
      code: lambda.Code.fromInline(`
import time
import cfnresponse

def handler(event, context):
  try:
    # Sleep for 30 seconds to allow OpenSearch collection to be fully ready
    time.sleep(30)
    cfnresponse.send(event, context, cfnresponse.SUCCESS, {})
  except Exception as e:
    print(f"Error: {str(e)}")
    cfnresponse.send(event, context, cfnresponse.FAILED, {})
      `),
      timeout: cdk.Duration.minutes(1),
      role: new iam.Role(this, 'OpenSearchDelayFunctionRole', {
        assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
        managedPolicies: [
          iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole')
        ]
      })
    });
    
    // Create a custom resource for the delay
    const openSearchDelayProvider = new cr.Provider(this, 'OpenSearchDelayProvider', {
      onEventHandler: openSearchDelayFunction
    });
    
    const openSearchDelayResource = new cdk.CustomResource(this, 'OpenSearchDelay', {
      serviceToken: openSearchDelayProvider.serviceToken,
      properties: {
        CollectionArn: props.opensearchCollection.attrArn,
        Timestamp: Date.now().toString() // To force this to run on every deployment
      }
    });
    
    // Create Bedrock Knowledge Base using L1 construct
    const knowledgeBase = new bedrock.CfnKnowledgeBase(this, 'BedrockDocsKnowledgeBase', {
      name: `docs-kb-${props.resourceSuffix}`,
      description: 'Knowledge base for documents',
      knowledgeBaseConfiguration: {
        type: 'VECTOR',
        vectorKnowledgeBaseConfiguration: {
          embeddingModelArn: `arn:aws:bedrock:${cdk.Aws.REGION}::foundation-model/${embeddingModelId}`,
          supplementalDataStorageConfiguration: {
            supplementalDataStorageLocations: [
              {
                supplementalDataStorageLocationType: 'S3',
                s3Location: {
                  uri: `s3://${props.multimodalBucket.bucketName}`
                }
              }
            ]
          }
        }
      },
      storageConfiguration: {
        type: 'OPENSEARCH_SERVERLESS',
        opensearchServerlessConfiguration: {
          collectionArn: props.opensearchCollection.attrArn,
          fieldMapping: {
            vectorField: 'docs-field',
            textField: 'docs-chunk',
            metadataField: 'docs-metadata'
          },
          vectorIndexName: 'docs-index'
        }
      },
      roleArn: bedrockKnowledgeBaseRole.roleArn
    });
    
    // Add explicit dependencies to ensure resources are created in the correct order
    knowledgeBase.node.addDependency(bedrockKnowledgeBaseRole);
    knowledgeBase.node.addDependency(props.opensearchCollection);
    knowledgeBase.node.addDependency(openSearchDelayResource); // Ensure we wait for OpenSearch to be ready

    knowledgeBase.node.addDependency(bedrockKnowledgeBaseRole);
    knowledgeBase.node.addDependency(props.opensearchCollection);
    // Create Bedrock Data Source using L1 construct
    const dataSource = new bedrock.CfnDataSource(this, 'BedrockDocsDataSource', {
      name: `docs-ds-${props.resourceSuffix}`,
      description: 'Data source for documents',
      knowledgeBaseId: knowledgeBase.attrKnowledgeBaseId,
      dataSourceConfiguration: {
        type: 'S3',
        s3Configuration: {
          bucketArn: props.organizedBucket.bucketArn,
          inclusionPrefixes: ['Documents/']
        }
      },
      vectorIngestionConfiguration: {
        chunkingConfiguration: {
          chunkingStrategy: 'HIERARCHICAL',
          hierarchicalChunkingConfiguration: {
            levelConfigurations: [
              { maxTokens: 1000 },
              { maxTokens: 300 }
            ],
            overlapTokens: 60
          }
        }
      }
    });

    // Use the actual Knowledge Base ID and ARN
    const knowledgeBaseId = knowledgeBase.attrKnowledgeBaseId;
    const knowledgeBaseArn = knowledgeBase.attrKnowledgeBaseArn;
    const dataSourceId = dataSource.attrDataSourceId;

    // Add Knowledge Base ID to Retrieval function
    this.retrievalFunction.addEnvironment('OPS_KNOWLEDGE_BASE_ID', knowledgeBaseId);

    return {
      knowledgeBase,
      dataSource,
      knowledgeBaseId,
      knowledgeBaseArn,
      dataSourceId
    };
  }
}
