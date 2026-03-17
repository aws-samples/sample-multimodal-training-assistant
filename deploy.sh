#!/bin/bash
set -e  # Exit on error

# Deployment script for Multimedia RAG Chat Assistant
# Architecture: Browser → AgentCore Runtime (JWT auth, CORS, streaming)

# Configuration with defaults
ENV="dev"
PROFILE="${AWS_PROFILE:-default}"
REGION=$(aws configure get region || echo "us-east-1")
SKIP_INFRASTRUCTURE="false"
LOCAL_CONFIG_ONLY="false"
AGENTCORE_ENABLED="true"
AGENTCORE_RUNTIME_ONLY="false"
LTM_ENABLED="true"
MEMORY_EXPIRY_DAYS="30"
DEPLOY_FRONTEND="false"
TAVILY_KEY=""

# Model IDs — single source of truth for all deployment paths
RUNTIME_MODEL_ID="us.anthropic.claude-sonnet-4-6"
LOCAL_MODEL_ID="us.anthropic.claude-sonnet-4-6"
VOICE_MODEL_ID="amazon.nova-sonic-v1:0"
VOICE_NAME="tiffany"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

print_status() { echo -e "${BLUE}[INFO]${NC} $1"; }
print_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
print_warning() { echo -e "${YELLOW}[WARNING]${NC} $1"; }
print_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# Parse command line options
while getopts ":e:r:p:m:si-:h" opt; do
  case $opt in
    e) ENV="$OPTARG" ;;
    r) REGION="$OPTARG" ;;
    p) PROFILE="$OPTARG" ;;
    m) MEMORY_EXPIRY_DAYS="$OPTARG" ;;
    s) SKIP_INFRASTRUCTURE="true" ;;
    i) LOCAL_CONFIG_ONLY="true" ;;
    -)
      case "${OPTARG}" in
        agentcore-runtime)
          AGENTCORE_RUNTIME_ONLY="true"
          ;;
        memory)
          val="${!OPTIND}"; OPTIND=$(( $OPTIND + 1 ))
          if [ "$val" = "disable" ]; then
            AGENTCORE_ENABLED="false"
          fi
          ;;
        ltm)
          val="${!OPTIND}"; OPTIND=$(( $OPTIND + 1 ))
          if [ "$val" = "disable" ]; then
            LTM_ENABLED="false"
          fi
          ;;
        frontend)
          DEPLOY_FRONTEND="true"
          ;;
        tavily-key)
          TAVILY_KEY="${!OPTIND}"; OPTIND=$(( $OPTIND + 1 ))
          ;;
        *)
          echo "Invalid option: --${OPTARG}" >&2
          exit 1
          ;;
      esac
      ;;
    h)
      echo "Usage: ./deploy.sh [options]"
      echo ""
      echo "Options:"
      echo "  -e ENV           Environment name (default: dev)"
      echo "  -r REGION        AWS region (default: from AWS CLI config)"
      echo "  -p PROFILE       AWS profile name to use (default: default)"
      echo "  -m DAYS          Memory expiry duration in days (default: 30)"
      echo "  -s               Skip infrastructure (config only)"
      echo "  -i               Generate local configuration only (no deployment)"
      echo "  --agentcore-runtime  Update AgentCore Runtime agent code only"
      echo "  --memory disable Disable AgentCore Memory (enabled by default)"
      echo "  --ltm disable    Disable Long-Term Memory, use STM only"
      echo "  --tavily-key KEY Store Tavily API key in SSM (enables web research in Self-Study mode)"
      echo "  --frontend       Build and deploy static Next.js frontend to S3/CloudFront"
      echo "  -h               Show this help"
      echo ""
      echo "Examples:"
      echo "  ./deploy.sh -e prod -r us-west-2              # Deploy all infrastructure"
      echo "  ./deploy.sh --agentcore-runtime               # Update agent code only"
      echo "  ./deploy.sh --frontend -e prod                # Build & deploy Next.js frontend"
      echo "  ./deploy.sh -i                                # Generate local config only"
      exit 0
      ;;
    \?)
      echo "Invalid option: -$OPTARG" >&2
      exit 1
      ;;
    :)
      echo "Option -$OPTARG requires an argument." >&2
      exit 1
      ;;
  esac
done

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# =============================================================================
# STORE TAVILY API KEY IN SSM (if provided)
# =============================================================================

if [ -n "$TAVILY_KEY" ]; then
  print_status "Storing Tavily API key in SSM..."
  aws ssm put-parameter \
    --name "/multimedia-rag/${ENV}/tavily-api-key" \
    --type SecureString \
    --value "$TAVILY_KEY" \
    --overwrite \
    --region "$REGION" \
    --profile "$PROFILE" > /dev/null
  print_success "Tavily API key stored in SSM: /multimedia-rag/${ENV}/tavily-api-key"
fi

# =============================================================================
# AGENTCORE RUNTIME ONLY MODE - Early Exit
# =============================================================================

if [ "$AGENTCORE_RUNTIME_ONLY" = "true" ]; then
  echo ""
  echo "🤖 ============================================"
  echo "🤖 AGENTCORE RUNTIME UPDATE ONLY"
  echo "🤖 ============================================"
  echo ""
  echo "Environment: $ENV"
  echo "Region: $REGION"
  echo "AWS Profile: $PROFILE"
  echo ""
  
  # Get execution role ARN from CloudFormation
  print_status "Getting AgentCore execution role..."
  EXECUTION_ROLE_ARN=$(aws cloudformation describe-stacks \
    --stack-name "AgentCoreStack-$ENV" \
    --query "Stacks[0].Outputs[?OutputKey=='AgentCoreExecutionRoleArn'].OutputValue" \
    --output text \
    --region $REGION \
    --profile $PROFILE 2>/dev/null || echo "")
  
  if [[ -z "$EXECUTION_ROLE_ARN" || "$EXECUTION_ROLE_ARN" == "None" ]]; then
    print_error "Could not find AgentCore execution role. Deploy infrastructure first:"
    echo "   ./deploy.sh -e $ENV -r $REGION"
    exit 1
  fi
  
  # Install AgentCore toolkit using Python 3.12+
  print_status "Installing AgentCore toolkit..."
  PYTHON_CMD=""
  for py in python3.13 python3.12; do
    if command -v $py &> /dev/null; then
      PYTHON_CMD=$py
      break
    fi
  done
  
  if [[ -z "$PYTHON_CMD" ]]; then
    print_error "Requires Python 3.12+. Please install Python 3.12 or later."
    exit 1
  fi
  
  print_status "Using $PYTHON_CMD for installation..."
  $PYTHON_CMD -m pip install --user --upgrade bedrock-agentcore strands-agents ag-ui-strands bedrock-agentcore-starter-toolkit 2>/dev/null || \
  $PYTHON_CMD -m pip install --break-system-packages --upgrade bedrock-agentcore strands-agents ag-ui-strands bedrock-agentcore-starter-toolkit
  
  if ! command -v agentcore &> /dev/null; then
    print_error "AgentCore toolkit installation failed"
    exit 1
  fi
  print_success "AgentCore toolkit installed"
  
  AGENT_DIR="$SCRIPT_DIR/agent"
  cd "$AGENT_DIR"
  
  # Set AWS_PROFILE so agentcore CLI uses the correct profile
  # (agentcore doesn't support --profile flag, uses env var instead)
  export AWS_PROFILE="$PROFILE"
  
  # Get Cognito configuration from SSM
  print_status "Fetching Cognito configuration..."
  COGNITO_POOL_ID=$(aws ssm get-parameter \
    --name "/multimedia-rag/${ENV}/cognito-user-pool-id" \
    --query 'Parameter.Value' --output text \
    --region "$REGION" --profile "$PROFILE" 2>/dev/null || echo "")
  
  COGNITO_CLIENT_ID=$(aws ssm get-parameter \
    --name "/multimedia-rag/${ENV}/cognito-user-pool-client-id" \
    --query 'Parameter.Value' --output text \
    --region "$REGION" --profile "$PROFILE" 2>/dev/null || echo "")
  
  # Configure AgentCore if not already configured
  if [[ ! -f ".bedrock_agentcore.yaml" ]]; then
    print_status "Configuring AgentCore..."
    OAUTH_CONFIG=""
    if [[ -n "$COGNITO_POOL_ID" && -n "$COGNITO_CLIENT_ID" && "$COGNITO_POOL_ID" != "None" ]]; then
      DISCOVERY_URL="https://cognito-idp.${REGION}.amazonaws.com/${COGNITO_POOL_ID}/.well-known/openid-configuration"
      OAUTH_CONFIG="--authorizer-config {\"customJWTAuthorizer\":{\"discoveryUrl\":\"${DISCOVERY_URL}\",\"allowedClients\":[\"${COGNITO_CLIENT_ID}\"]}}"
      print_status "Configuring OAuth with Cognito..."
    fi
    
    agentcore configure \
      --entrypoint main.py \
      --name "multimedia_rag_agent_${ENV}" \
      --execution-role "$EXECUTION_ROLE_ARN" \
      --region "$REGION" \
      --deployment-type container \
      --request-header-allowlist "Authorization" \
      $OAUTH_CONFIG \
      --non-interactive

    if [ $? -ne 0 ]; then
      print_error "AgentCore configure failed"
      exit 1
    fi
  fi
  
  # Get config from SSM
  MEMORY_ID=$(aws ssm get-parameter --name "/multimedia-rag/${ENV}/agentcore-memory-id" \
    --query "Parameter.Value" --output text --region "$REGION" --profile "$PROFILE" 2>/dev/null || echo "")
  
  KB_ID=$(aws ssm get-parameter --name "/multimedia-rag/${ENV}/knowledge-base-id" \
    --query "Parameter.Value" --output text --region "$REGION" --profile "$PROFILE" 2>/dev/null || echo "")
  
  if [[ -z "$KB_ID" || "$KB_ID" == "None" ]]; then
    KB_ID=$(aws cloudformation describe-stacks --stack-name "MultimediaRagStack-$ENV" \
      --query "Stacks[0].Outputs[?OutputKey=='DocumentsKnowledgeBaseId'].OutputValue" \
      --output text --region "$REGION" --profile "$PROFILE" 2>/dev/null || echo "")
  fi
  
  ENV_ARGS="--env AGENT_PORT=8080 --env AGENT_PATH=/invocations --env AWS_REGION=$REGION --env ENV=$ENV --env BEDROCK_MODEL_ID=$RUNTIME_MODEL_ID --env BIDI_ENABLED=true --env BIDI_REGION=us-east-1 --env BIDI_MODEL_ID=$VOICE_MODEL_ID --env BIDI_VOICE=$VOICE_NAME"

  if [[ -n "$COGNITO_POOL_ID" && "$COGNITO_POOL_ID" != "None" ]]; then
    ENV_ARGS="$ENV_ARGS --env COGNITO_USER_POOL_ID=$COGNITO_POOL_ID"
    print_status "Will set COGNITO_USER_POOL_ID=$COGNITO_POOL_ID"
  fi

  if [[ -n "$KB_ID" && "$KB_ID" != "None" ]]; then
    ENV_ARGS="$ENV_ARGS --env KB_ID=$KB_ID"
    print_status "Will set KB_ID=$KB_ID"
  else
    print_warning "KB_ID not found - knowledge base search will not work"
  fi
  
  if [[ -n "$MEMORY_ID" && "$MEMORY_ID" != "None" ]]; then
    ENV_ARGS="$ENV_ARGS --env AGENTCORE_MEMORY_ID=$MEMORY_ID"
    print_status "Will set AGENTCORE_MEMORY_ID=$MEMORY_ID"
  fi
  
  S3_SESSION_BUCKET=$(aws ssm get-parameter --name "/multimedia-rag/${ENV}/session-bucket" \
    --query "Parameter.Value" --output text --region "$REGION" --profile "$PROFILE" 2>/dev/null || echo "")
  
  if [[ -z "$S3_SESSION_BUCKET" || "$S3_SESSION_BUCKET" == "None" ]]; then
    S3_SESSION_BUCKET=$(aws cloudformation describe-stacks --stack-name "AgentCoreStack-$ENV" \
      --query "Stacks[0].Outputs[?OutputKey=='SessionBucketName'].OutputValue" \
      --output text --region "$REGION" --profile "$PROFILE" 2>/dev/null || echo "")
  fi
  
  if [[ -n "$S3_SESSION_BUCKET" && "$S3_SESSION_BUCKET" != "None" ]]; then
    ENV_ARGS="$ENV_ARGS --env S3_SESSION_BUCKET=$S3_SESSION_BUCKET"
    print_status "Will set S3_SESSION_BUCKET=$S3_SESSION_BUCKET"
  fi

  # Tavily API key for web research
  TAVILY_API_KEY=$(aws ssm get-parameter --name "/multimedia-rag/${ENV}/tavily-api-key" \
    --with-decryption --query "Parameter.Value" --output text 2>/dev/null || echo "")
  if [ -n "$TAVILY_API_KEY" ]; then
    ENV_ARGS="$ENV_ARGS --env TAVILY_API_KEY=$TAVILY_API_KEY"
    print_status "Will set TAVILY_API_KEY"
  fi

  # Organized bucket for web research content
  ORGANIZED_BUCKET=$(aws cloudformation describe-stacks --stack-name "MultimediaRagStack-$ENV" \
    --query "Stacks[0].Outputs[?contains(OutputKey,'OrganizedBucket')].OutputValue | [0]" \
    --output text --region "$REGION" --profile "$PROFILE" 2>/dev/null || echo "")
  if [[ -z "$ORGANIZED_BUCKET" || "$ORGANIZED_BUCKET" == "None" ]]; then
    ORGANIZED_BUCKET=$(aws s3api list-buckets --profile "$PROFILE" \
      --query "Buckets[?contains(Name,'organizedbucket')&&contains(Name,'$ENV')].Name | [0]" --output text 2>/dev/null | head -1)
  fi
  if [ -n "$ORGANIZED_BUCKET" ]; then
    ENV_ARGS="$ENV_ARGS --env ORGANIZED_BUCKET=$ORGANIZED_BUCKET"
    print_status "Will set ORGANIZED_BUCKET=$ORGANIZED_BUCKET"
  fi

  # DynamoDB table for learning platform
  DYNAMODB_TABLE=$(aws ssm get-parameter --name "/multimedia-rag/${ENV}/dynamodb-table" \
    --query "Parameter.Value" --output text --region "$REGION" --profile "$PROFILE" 2>/dev/null || echo "")
  if [[ -z "$DYNAMODB_TABLE" || "$DYNAMODB_TABLE" == "None" ]]; then
    DYNAMODB_TABLE=$(aws cloudformation describe-stacks --stack-name "MultimediaRagStack-$ENV" \
      --query "Stacks[0].Outputs[?OutputKey=='DynamoDBTableName'].OutputValue" \
      --output text --region "$REGION" --profile "$PROFILE" 2>/dev/null || echo "")
  fi
  if [[ -n "$DYNAMODB_TABLE" && "$DYNAMODB_TABLE" != "None" ]]; then
    ENV_ARGS="$ENV_ARGS --env DYNAMODB_TABLE=$DYNAMODB_TABLE"
    print_status "Will set DYNAMODB_TABLE=$DYNAMODB_TABLE"
  fi

  # KB Data Source ID for triggering sync
  KB_DATA_SOURCE_ID=$(aws ssm get-parameter --name "/multimedia-rag/${ENV}/kb-data-source-id" \
    --query "Parameter.Value" --output text 2>/dev/null || echo "")
  if [ -z "$KB_DATA_SOURCE_ID" ]; then
    KB_DATA_SOURCE_ID=$(aws bedrock-agent list-data-sources --knowledge-base-id "$KB_ID" \
      --query "dataSourceSummaries[0].dataSourceId" --output text 2>/dev/null || echo "")
  fi
  if [ -n "$KB_DATA_SOURCE_ID" ]; then
    ENV_ARGS="$ENV_ARGS --env KB_DATA_SOURCE_ID=$KB_DATA_SOURCE_ID"
    print_status "Will set KB_DATA_SOURCE_ID=$KB_DATA_SOURCE_ID"
  fi
  
  # --- Text Runtime ---
  print_status "Launching Text AgentCore Runtime..."
  agentcore launch --auto-update-on-conflict $ENV_ARGS

  if [ $? -ne 0 ]; then
    print_error "Text AgentCore launch failed"
    exit 1
  fi

  # Get and store the Text Runtime ARN
  print_status "Retrieving Text Runtime ARN..."
  sleep 5

  AGENTCORE_RUNTIME_ARN=$(aws bedrock-agentcore-control list-agent-runtimes \
    --region "$REGION" --profile "$PROFILE" \
    --query "agentRuntimes[?agentRuntimeName=='multimedia_rag_agent_${ENV}'].agentRuntimeArn | [0]" \
    --output text 2>/dev/null | tr -d '\n' | sed 's/None$//')

  if [[ -n "$AGENTCORE_RUNTIME_ARN" && "$AGENTCORE_RUNTIME_ARN" != "None" ]]; then
    print_success "Text Runtime ARN: $AGENTCORE_RUNTIME_ARN"
    aws ssm put-parameter \
      --name "/multimedia-rag/${ENV}/agentcore-runtime-arn" \
      --value "$AGENTCORE_RUNTIME_ARN" \
      --type "String" --description "AgentCore Runtime ARN" --overwrite \
      --region "$REGION" --profile "$PROFILE" > /dev/null 2>&1
  else
    print_warning "Could not retrieve Text Runtime ARN"
  fi

  # --- Voice Runtime ---
  print_status "Configuring Voice AgentCore Runtime..."

  # Configure voice agent (no JWT authorizer — uses SigV4 via Cognito Identity Pool)
  agentcore configure \
    --entrypoint main.py \
    --name "multimedia_rag_voice_${ENV}" \
    --execution-role "$EXECUTION_ROLE_ARN" \
    --region "$REGION" \
    --deployment-type container \
    --non-interactive

  VOICE_ENV_ARGS="--env AGENT_MODE=voice --env AGENT_PORT=8080 --env AGENT_PATH=/invocations --env AWS_REGION=$REGION --env ENV=$ENV --env BEDROCK_MODEL_ID=$RUNTIME_MODEL_ID --env BIDI_ENABLED=true --env BIDI_REGION=us-east-1 --env BIDI_MODEL_ID=$VOICE_MODEL_ID --env BIDI_VOICE=$VOICE_NAME"

  if [[ -n "$KB_ID" && "$KB_ID" != "None" ]]; then
    VOICE_ENV_ARGS="$VOICE_ENV_ARGS --env KB_ID=$KB_ID"
  fi
  if [[ -n "$S3_SESSION_BUCKET" && "$S3_SESSION_BUCKET" != "None" ]]; then
    VOICE_ENV_ARGS="$VOICE_ENV_ARGS --env S3_SESSION_BUCKET=$S3_SESSION_BUCKET"
  fi

  print_status "Launching Voice AgentCore Runtime..."
  agentcore launch --agent "multimedia_rag_voice_${ENV}" --auto-update-on-conflict $VOICE_ENV_ARGS

  if [ $? -ne 0 ]; then
    print_warning "Voice AgentCore launch failed (voice chat will be unavailable)"
  else
    sleep 5
    VOICE_RUNTIME_ARN=$(aws bedrock-agentcore-control list-agent-runtimes \
      --region "$REGION" --profile "$PROFILE" \
      --query "agentRuntimes[?agentRuntimeName=='multimedia_rag_voice_${ENV}'].agentRuntimeArn | [0]" \
      --output text 2>/dev/null | tr -d '\n' | sed 's/None$//')

    if [[ -n "$VOICE_RUNTIME_ARN" && "$VOICE_RUNTIME_ARN" != "None" ]]; then
      print_success "Voice Runtime ARN: $VOICE_RUNTIME_ARN"
      aws ssm put-parameter \
        --name "/multimedia-rag/${ENV}/voice-runtime-arn" \
        --value "$VOICE_RUNTIME_ARN" \
        --type "String" --description "Voice AgentCore Runtime ARN" --overwrite \
        --region "$REGION" --profile "$PROFILE" > /dev/null 2>&1
      print_success "Voice Runtime ARN stored in SSM"
    else
      print_warning "Could not retrieve Voice Runtime ARN"
    fi
  fi

  # Switch default back to text agent
  agentcore configure set-default "multimedia_rag_agent_${ENV}" 2>/dev/null

  cd "$SCRIPT_DIR"
  echo ""
  print_success "AgentCore Runtimes updated successfully!"
  exit 0
fi

# =============================================================================
# FULL DEPLOYMENT MODE
# =============================================================================

echo "╔════════════════════════════════════════════════════════════════╗"
echo "║       Multimedia RAG Chat Assistant Deployment                 ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo "Environment: $ENV"
echo "Region: $REGION"
echo "AWS Profile: $PROFILE"
echo "AgentCore Memory: $AGENTCORE_ENABLED"
if [ "$AGENTCORE_ENABLED" = "true" ]; then
  echo "  - Long-Term Memory: $([ "$LTM_ENABLED" = "true" ] && echo "Enabled (LTM)" || echo "Disabled (STM only)")"
  echo "  - Memory Expiry: $MEMORY_EXPIRY_DAYS days"
fi
echo ""

# Deploy Infrastructure Stack (if not skipped)
if [ "$SKIP_INFRASTRUCTURE" = "false" ] && [ "$LOCAL_CONFIG_ONLY" = "false" ]; then
  DEPLOY_CONTEXT="--context resourceSuffix=$ENV"
  
  if [ "$AGENTCORE_ENABLED" = "true" ]; then
    DEPLOY_CONTEXT="$DEPLOY_CONTEXT --context deployAgentCore=true"
    DEPLOY_CONTEXT="$DEPLOY_CONTEXT --context memoryExpiryDays=$MEMORY_EXPIRY_DAYS"
    if [ "$LTM_ENABLED" = "false" ]; then
      DEPLOY_CONTEXT="$DEPLOY_CONTEXT --context disableLTM=true"
    fi
  fi
  
  echo "📦 Deploying MultimediaRagStack..."
  cd cdk
  npm ci
  npm run build
  # Override region env vars so CDK and all AWS SDK calls respect the -r flag
  export AWS_REGION="$REGION"
  export AWS_DEFAULT_REGION="$REGION"
  export CDK_DEFAULT_REGION="$REGION"
  export CDK_DEFAULT_ACCOUNT=$(aws sts get-caller-identity --query Account --output text --profile "$PROFILE" 2>/dev/null)
  npx cdk deploy "MultimediaRagStack-$ENV" $DEPLOY_CONTEXT --profile $PROFILE --region $REGION --require-approval=never
  
  if [ "$AGENTCORE_ENABLED" = "true" ]; then
    echo "📦 Deploying AgentCoreStack..."
    npx cdk deploy "AgentCoreStack-$ENV" $DEPLOY_CONTEXT --profile $PROFILE --region $REGION --require-approval=never
    echo "✅ AgentCore Memory deployed successfully"
  fi
  
  cd ..
fi

# Generate configurations
if [ "$LOCAL_CONFIG_ONLY" = "true" ] || [ "$SKIP_INFRASTRUCTURE" = "false" ]; then
  echo "⚙️  Generating configurations..."
  
  MEDIA_BUCKET=$(aws cloudformation describe-stacks --stack-name "MultimediaRagStack-$ENV" \
    --query "Stacks[0].Outputs[?OutputKey=='MediaBucketName'].OutputValue" \
    --output text --region $REGION --profile $PROFILE)
  
  USER_POOL_ID=$(aws cloudformation describe-stacks --stack-name "MultimediaRagStack-$ENV" \
    --query "Stacks[0].Outputs[?OutputKey=='CognitoUserPoolId'].OutputValue" \
    --output text --region $REGION --profile $PROFILE)
  
  USER_POOL_CLIENT_ID=$(aws cloudformation describe-stacks --stack-name "MultimediaRagStack-$ENV" \
    --query "Stacks[0].Outputs[?OutputKey=='CognitoUserPoolClientId'].OutputValue" \
    --output text --region $REGION --profile $PROFILE)
  
  IDENTITY_POOL_ID=$(aws cloudformation describe-stacks --stack-name "MultimediaRagStack-$ENV" \
    --query "Stacks[0].Outputs[?OutputKey=='CognitoIdentityPoolId'].OutputValue" \
    --output text --region $REGION --profile $PROFILE)
  
  CLOUDFRONT_DOMAIN_FULL=$(aws cloudformation describe-stacks --stack-name "MultimediaRagStack-$ENV" \
    --query "Stacks[0].Outputs[?OutputKey=='CloudFrontDomainName'].OutputValue" \
    --output text --region $REGION --profile $PROFILE)
  
  KNOWLEDGE_BASE_ID=$(aws cloudformation describe-stacks --stack-name "MultimediaRagStack-$ENV" \
    --query "Stacks[0].Outputs[?OutputKey=='DocumentsKnowledgeBaseId'].OutputValue" \
    --output text --region $REGION --profile $PROFILE)
  
  # Store KB ID in SSM
  if [[ -n "$KNOWLEDGE_BASE_ID" && "$KNOWLEDGE_BASE_ID" != "None" ]]; then
    aws ssm put-parameter --name "/multimedia-rag/${ENV}/knowledge-base-id" \
      --value "$KNOWLEDGE_BASE_ID" --type "String" --overwrite \
      --region "$REGION" --profile "$PROFILE" > /dev/null 2>&1
  fi
  
  # Fetch KB Data Source ID (needed for frontend KB sync)
  KB_DATA_SOURCE_ID=$(aws ssm get-parameter --name "/multimedia-rag/${ENV}/kb-data-source-id" \
    --query "Parameter.Value" --output text --region "$REGION" --profile "$PROFILE" 2>/dev/null || echo "")
  if [[ -z "$KB_DATA_SOURCE_ID" || "$KB_DATA_SOURCE_ID" == "None" ]]; then
    KB_DATA_SOURCE_ID=$(aws bedrock-agent list-data-sources --knowledge-base-id "$KNOWLEDGE_BASE_ID" \
      --query "dataSourceSummaries[0].dataSourceId" --output text --region "$REGION" --profile "$PROFILE" 2>/dev/null || echo "")
  fi

  # Store CloudFront domain and media bucket in SSM
  if [[ -n "$CLOUDFRONT_DOMAIN_FULL" && "$CLOUDFRONT_DOMAIN_FULL" != "None" ]]; then
    aws ssm put-parameter --name "/multimedia-rag/${ENV}/cloudfront-domain" \
      --value "$CLOUDFRONT_DOMAIN_FULL" --type "String" --overwrite \
      --region "$REGION" --profile "$PROFILE" > /dev/null 2>&1
  fi
  
  if [[ -n "$MEDIA_BUCKET" && "$MEDIA_BUCKET" != "None" ]]; then
    aws ssm put-parameter --name "/multimedia-rag/${ENV}/media-bucket" \
      --value "$MEDIA_BUCKET" --type "String" --overwrite \
      --region "$REGION" --profile "$PROFILE" > /dev/null 2>&1
  fi

  # Generate .env.local for frontend
  cat > frontend/.env.local << EOL
# Cognito configuration
NEXT_PUBLIC_COGNITO_REGION=$REGION
NEXT_PUBLIC_COGNITO_USER_POOL_ID=$USER_POOL_ID
NEXT_PUBLIC_COGNITO_USER_POOL_CLIENT_ID=$USER_POOL_CLIENT_ID
NEXT_PUBLIC_COGNITO_IDENTITY_POOL_ID=$IDENTITY_POOL_ID

# AgentCore Runtime URL (browser calls directly)
NEXT_PUBLIC_API_GATEWAY_URL=

# Voice runtime ARN for client-side SigV4 signing
NEXT_PUBLIC_VOICE_RUNTIME_ARN=
NEXT_PUBLIC_AWS_REGION=$REGION

# Media files
NEXT_PUBLIC_CLOUDFRONT_DOMAIN=$CLOUDFRONT_DOMAIN_FULL
NEXT_PUBLIC_MEDIA_BUCKET=$MEDIA_BUCKET
NEXT_PUBLIC_MEDIA_BUCKET_REGION=$REGION

# Knowledge Base (for browser-side KB sync)
NEXT_PUBLIC_KB_ID=$KNOWLEDGE_BASE_ID
NEXT_PUBLIC_KB_DATA_SOURCE_ID=$KB_DATA_SOURCE_ID

# Server-side only (for local dev API routes)
AWS_REGION=$REGION
ENV=$ENV
USE_RUNTIME=true
EOL

  # Backfill AgentCore Runtime URL (direct browser → AgentCore)
  AGENTCORE_RUNTIME_ARN_VAL=$(aws ssm get-parameter --name "/multimedia-rag/${ENV}/agentcore-runtime-arn" \
    --query 'Parameter.Value' --output text --region "$REGION" --profile "$PROFILE" 2>/dev/null || echo "")
  if [[ -n "$AGENTCORE_RUNTIME_ARN_VAL" && "$AGENTCORE_RUNTIME_ARN_VAL" != "None" ]]; then
    ENCODED_ARN=$(python3 -c "import urllib.parse; print(urllib.parse.quote('$AGENTCORE_RUNTIME_ARN_VAL', safe=''))")
    RUNTIME_URL="https://bedrock-agentcore.${REGION}.amazonaws.com/runtimes/${ENCODED_ARN}/invocations?qualifier=DEFAULT"
    sed -i '' "s|NEXT_PUBLIC_API_GATEWAY_URL=|NEXT_PUBLIC_API_GATEWAY_URL=$RUNTIME_URL|" frontend/.env.local
    echo "  Set NEXT_PUBLIC_API_GATEWAY_URL=$RUNTIME_URL (direct AgentCore)"
  fi

  # Backfill Voice Runtime ARN
  VOICE_RUNTIME_ARN=$(aws ssm get-parameter --name "/multimedia-rag/${ENV}/voice-runtime-arn" \
    --query 'Parameter.Value' --output text --region "$REGION" --profile "$PROFILE" 2>/dev/null || echo "")
  if [[ -n "$VOICE_RUNTIME_ARN" && "$VOICE_RUNTIME_ARN" != "None" ]]; then
    sed -i '' "s|NEXT_PUBLIC_VOICE_RUNTIME_ARN=|NEXT_PUBLIC_VOICE_RUNTIME_ARN=$VOICE_RUNTIME_ARN|" frontend/.env.local
  fi

  # Generate .env for agent
  TAVILY_FROM_SSM=$(aws ssm get-parameter --name "/multimedia-rag/${ENV}/tavily-api-key" \
    --with-decryption --query "Parameter.Value" --output text \
    --region "$REGION" --profile "$PROFILE" 2>/dev/null || echo "")

  cat > agent/.env << EOL
AWS_REGION=$REGION
KB_ID=$KNOWLEDGE_BASE_ID
BEDROCK_MODEL_ID=$LOCAL_MODEL_ID
ENV=$ENV
EOL

  if [[ -n "$TAVILY_FROM_SSM" && "$TAVILY_FROM_SSM" != "None" ]]; then
    echo "TAVILY_API_KEY=$TAVILY_FROM_SSM" >> agent/.env
    echo "  Included TAVILY_API_KEY from SSM"
  else
    echo "  No Tavily API key found in SSM (web research disabled). Use --tavily-key to set one."
  fi

  echo "✅ Configuration generated successfully"
fi

# =============================================================================
# AGENTCORE RUNTIME DEPLOYMENT (part of full deploy)
# =============================================================================

if [ "$SKIP_INFRASTRUCTURE" = "false" ] && [ "$LOCAL_CONFIG_ONLY" = "false" ]; then
  echo ""
  echo "🤖 Deploying AgentCore Runtime..."
  
  # Get execution role ARN from CloudFormation
  print_status "Getting AgentCore execution role..."
  EXECUTION_ROLE_ARN=$(aws cloudformation describe-stacks \
    --stack-name "AgentCoreStack-$ENV" \
    --query "Stacks[0].Outputs[?OutputKey=='AgentCoreExecutionRoleArn'].OutputValue" \
    --output text \
    --region $REGION \
    --profile $PROFILE 2>/dev/null || echo "")
  
  if [[ -z "$EXECUTION_ROLE_ARN" || "$EXECUTION_ROLE_ARN" == "None" ]]; then
    print_warning "AgentCore execution role not found — skipping AgentCore Runtime deployment."
    print_warning "Run './deploy.sh --agentcore-runtime -e $ENV -r $REGION' manually after fixing."
  else
    # Install AgentCore toolkit using Python 3.12+
    print_status "Installing AgentCore toolkit..."
    PYTHON_CMD=""
    for py in python3.13 python3.12; do
      if command -v $py &> /dev/null; then
        PYTHON_CMD=$py
        break
      fi
    done
    
    if [[ -z "$PYTHON_CMD" ]]; then
      print_error "Requires Python 3.12+. Skipping AgentCore Runtime deployment."
    else
      print_status "Using $PYTHON_CMD for installation..."
      $PYTHON_CMD -m pip install --user --upgrade bedrock-agentcore strands-agents ag-ui-strands bedrock-agentcore-starter-toolkit 2>/dev/null || \
      $PYTHON_CMD -m pip install --break-system-packages --upgrade bedrock-agentcore strands-agents ag-ui-strands bedrock-agentcore-starter-toolkit
      
      if ! command -v agentcore &> /dev/null; then
        print_error "AgentCore toolkit installation failed. Skipping AgentCore Runtime deployment."
      else
        print_success "AgentCore toolkit installed"
        
        AGENT_DIR="$SCRIPT_DIR/agent"
        cd "$AGENT_DIR"
        
        # Set AWS_PROFILE so agentcore CLI uses the correct profile
        export AWS_PROFILE="$PROFILE"
        
        # Get Cognito configuration from SSM
        print_status "Fetching Cognito configuration..."
        COGNITO_POOL_ID=$(aws ssm get-parameter \
          --name "/multimedia-rag/${ENV}/cognito-user-pool-id" \
          --query 'Parameter.Value' --output text \
          --region "$REGION" --profile "$PROFILE" 2>/dev/null || echo "")
        
        COGNITO_CLIENT_ID=$(aws ssm get-parameter \
          --name "/multimedia-rag/${ENV}/cognito-user-pool-client-id" \
          --query 'Parameter.Value' --output text \
          --region "$REGION" --profile "$PROFILE" 2>/dev/null || echo "")
        
        # Configure AgentCore if not already configured
        if [[ ! -f ".bedrock_agentcore.yaml" ]]; then
          print_status "Configuring AgentCore..."
          OAUTH_CONFIG=""
          if [[ -n "$COGNITO_POOL_ID" && -n "$COGNITO_CLIENT_ID" && "$COGNITO_POOL_ID" != "None" ]]; then
            DISCOVERY_URL="https://cognito-idp.${REGION}.amazonaws.com/${COGNITO_POOL_ID}/.well-known/openid-configuration"
            OAUTH_CONFIG="--authorizer-config {\"customJWTAuthorizer\":{\"discoveryUrl\":\"${DISCOVERY_URL}\",\"allowedClients\":[\"${COGNITO_CLIENT_ID}\"]}}"
            print_status "Configuring OAuth with Cognito..."
          fi
          
          agentcore configure \
            --entrypoint main.py \
            --name "multimedia_rag_agent_${ENV}" \
            --execution-role "$EXECUTION_ROLE_ARN" \
            --region "$REGION" \
            --deployment-type container \
            --request-header-allowlist "Authorization" \
            $OAUTH_CONFIG \
            --non-interactive
          
          if [ $? -ne 0 ]; then
            print_error "AgentCore configure failed. Skipping AgentCore Runtime deployment."
            cd "$SCRIPT_DIR"
          fi
        fi
        
        if [[ -f ".bedrock_agentcore.yaml" ]]; then
          # Get config from SSM
          MEMORY_ID=$(aws ssm get-parameter --name "/multimedia-rag/${ENV}/agentcore-memory-id" \
            --query "Parameter.Value" --output text --region "$REGION" --profile "$PROFILE" 2>/dev/null || echo "")
          
          AC_KB_ID=$(aws ssm get-parameter --name "/multimedia-rag/${ENV}/knowledge-base-id" \
            --query "Parameter.Value" --output text --region "$REGION" --profile "$PROFILE" 2>/dev/null || echo "")
          
          if [[ -z "$AC_KB_ID" || "$AC_KB_ID" == "None" ]]; then
            AC_KB_ID=$(aws cloudformation describe-stacks --stack-name "MultimediaRagStack-$ENV" \
              --query "Stacks[0].Outputs[?OutputKey=='DocumentsKnowledgeBaseId'].OutputValue" \
              --output text --region "$REGION" --profile "$PROFILE" 2>/dev/null || echo "")
          fi
          
          ENV_ARGS="--env AGENT_PORT=8080 --env AGENT_PATH=/invocations --env AWS_REGION=$REGION --env ENV=$ENV --env BEDROCK_MODEL_ID=$RUNTIME_MODEL_ID --env BIDI_ENABLED=true --env BIDI_REGION=us-east-1 --env BIDI_MODEL_ID=$VOICE_MODEL_ID --env BIDI_VOICE=$VOICE_NAME"

          if [[ -n "$COGNITO_POOL_ID" && "$COGNITO_POOL_ID" != "None" ]]; then
            ENV_ARGS="$ENV_ARGS --env COGNITO_USER_POOL_ID=$COGNITO_POOL_ID"
          fi

          if [[ -n "$AC_KB_ID" && "$AC_KB_ID" != "None" ]]; then
            ENV_ARGS="$ENV_ARGS --env KB_ID=$AC_KB_ID"
            print_status "Will set KB_ID=$AC_KB_ID"
          fi
          
          if [[ -n "$MEMORY_ID" && "$MEMORY_ID" != "None" ]]; then
            ENV_ARGS="$ENV_ARGS --env AGENTCORE_MEMORY_ID=$MEMORY_ID"
            print_status "Will set AGENTCORE_MEMORY_ID=$MEMORY_ID"
          fi
          
          AC_S3_SESSION_BUCKET=$(aws ssm get-parameter --name "/multimedia-rag/${ENV}/session-bucket" \
            --query "Parameter.Value" --output text --region "$REGION" --profile "$PROFILE" 2>/dev/null || echo "")
          if [[ -z "$AC_S3_SESSION_BUCKET" || "$AC_S3_SESSION_BUCKET" == "None" ]]; then
            AC_S3_SESSION_BUCKET=$(aws cloudformation describe-stacks --stack-name "AgentCoreStack-$ENV" \
              --query "Stacks[0].Outputs[?OutputKey=='SessionBucketName'].OutputValue" \
              --output text --region "$REGION" --profile "$PROFILE" 2>/dev/null || echo "")
          fi
          if [[ -n "$AC_S3_SESSION_BUCKET" && "$AC_S3_SESSION_BUCKET" != "None" ]]; then
            ENV_ARGS="$ENV_ARGS --env S3_SESSION_BUCKET=$AC_S3_SESSION_BUCKET"
          fi

          AC_TAVILY_KEY=$(aws ssm get-parameter --name "/multimedia-rag/${ENV}/tavily-api-key" \
            --with-decryption --query "Parameter.Value" --output text 2>/dev/null || echo "")
          if [ -n "$AC_TAVILY_KEY" ]; then
            ENV_ARGS="$ENV_ARGS --env TAVILY_API_KEY=$AC_TAVILY_KEY"
            print_status "Will set TAVILY_API_KEY"
          fi

          AC_ORGANIZED_BUCKET=$(aws cloudformation describe-stacks --stack-name "MultimediaRagStack-$ENV" \
            --query "Stacks[0].Outputs[?contains(OutputKey,'OrganizedBucket')].OutputValue | [0]" \
            --output text --region "$REGION" --profile "$PROFILE" 2>/dev/null || echo "")
          if [[ -z "$AC_ORGANIZED_BUCKET" || "$AC_ORGANIZED_BUCKET" == "None" ]]; then
            AC_ORGANIZED_BUCKET=$(aws s3api list-buckets --profile "$PROFILE" \
              --query "Buckets[?contains(Name,'organizedbucket')&&contains(Name,'$ENV')].Name | [0]" --output text 2>/dev/null | head -1)
          fi
          if [[ -n "$AC_ORGANIZED_BUCKET" && "$AC_ORGANIZED_BUCKET" != "None" ]]; then
            ENV_ARGS="$ENV_ARGS --env ORGANIZED_BUCKET=$AC_ORGANIZED_BUCKET"
            print_status "Will set ORGANIZED_BUCKET=$AC_ORGANIZED_BUCKET"
          fi

          AC_DYNAMODB_TABLE=$(aws ssm get-parameter --name "/multimedia-rag/${ENV}/dynamodb-table" \
            --query "Parameter.Value" --output text --region "$REGION" --profile "$PROFILE" 2>/dev/null || echo "")
          if [[ -z "$AC_DYNAMODB_TABLE" || "$AC_DYNAMODB_TABLE" == "None" ]]; then
            AC_DYNAMODB_TABLE=$(aws cloudformation describe-stacks --stack-name "MultimediaRagStack-$ENV" \
              --query "Stacks[0].Outputs[?OutputKey=='DynamoDBTableName'].OutputValue" \
              --output text --region "$REGION" --profile "$PROFILE" 2>/dev/null || echo "")
          fi
          if [[ -n "$AC_DYNAMODB_TABLE" && "$AC_DYNAMODB_TABLE" != "None" ]]; then
            ENV_ARGS="$ENV_ARGS --env DYNAMODB_TABLE=$AC_DYNAMODB_TABLE"
          fi

          AC_KB_DATA_SOURCE_ID=$(aws ssm get-parameter --name "/multimedia-rag/${ENV}/kb-data-source-id" \
            --query "Parameter.Value" --output text 2>/dev/null || echo "")
          if [ -z "$AC_KB_DATA_SOURCE_ID" ]; then
            AC_KB_DATA_SOURCE_ID=$(aws bedrock-agent list-data-sources --knowledge-base-id "$AC_KB_ID" \
              --query "dataSourceSummaries[0].dataSourceId" --output text 2>/dev/null || echo "")
          fi
          if [ -n "$AC_KB_DATA_SOURCE_ID" ]; then
            ENV_ARGS="$ENV_ARGS --env KB_DATA_SOURCE_ID=$AC_KB_DATA_SOURCE_ID"
          fi
          
          # --- Text Runtime ---
          print_status "Launching Text AgentCore Runtime..."
          agentcore launch --auto-update-on-conflict $ENV_ARGS

          if [ $? -ne 0 ]; then
            print_error "Text AgentCore launch failed"
          else
            print_status "Retrieving Text Runtime ARN..."
            sleep 5

            AGENTCORE_RUNTIME_ARN=$(aws bedrock-agentcore-control list-agent-runtimes \
              --region "$REGION" --profile "$PROFILE" \
              --query "agentRuntimes[?agentRuntimeName=='multimedia_rag_agent_${ENV}'].agentRuntimeArn | [0]" \
              --output text 2>/dev/null | tr -d '\n' | sed 's/None$//')

            if [[ -n "$AGENTCORE_RUNTIME_ARN" && "$AGENTCORE_RUNTIME_ARN" != "None" ]]; then
              print_success "Text Runtime ARN: $AGENTCORE_RUNTIME_ARN"
              aws ssm put-parameter \
                --name "/multimedia-rag/${ENV}/agentcore-runtime-arn" \
                --value "$AGENTCORE_RUNTIME_ARN" \
                --type "String" --description "AgentCore Runtime ARN" --overwrite \
                --region "$REGION" --profile "$PROFILE" > /dev/null 2>&1

              # Backfill the Runtime URL into frontend/.env.local
              ENCODED_ARN=$(python3 -c "import urllib.parse; print(urllib.parse.quote('$AGENTCORE_RUNTIME_ARN', safe=''))")
              RUNTIME_URL="https://bedrock-agentcore.${REGION}.amazonaws.com/runtimes/${ENCODED_ARN}/invocations?qualifier=DEFAULT"
              sed -i '' "s|NEXT_PUBLIC_API_GATEWAY_URL=.*|NEXT_PUBLIC_API_GATEWAY_URL=$RUNTIME_URL|" "$SCRIPT_DIR/frontend/.env.local"
              print_status "Updated frontend/.env.local with AgentCore Runtime URL"
            else
              print_warning "Could not retrieve Text Runtime ARN"
            fi
          fi

          # --- Voice Runtime ---
          print_status "Configuring Voice AgentCore Runtime..."

          agentcore configure \
            --entrypoint main.py \
            --name "multimedia_rag_voice_${ENV}" \
            --execution-role "$EXECUTION_ROLE_ARN" \
            --region "$REGION" \
            --deployment-type container \
                    --non-interactive

          VOICE_ENV_ARGS="--env AGENT_MODE=voice --env AGENT_PORT=8080 --env AGENT_PATH=/invocations --env AWS_REGION=$REGION --env ENV=$ENV --env BEDROCK_MODEL_ID=$RUNTIME_MODEL_ID --env BIDI_ENABLED=true --env BIDI_REGION=us-east-1 --env BIDI_MODEL_ID=$VOICE_MODEL_ID --env BIDI_VOICE=$VOICE_NAME"

          if [[ -n "$AC_KB_ID" && "$AC_KB_ID" != "None" ]]; then
            VOICE_ENV_ARGS="$VOICE_ENV_ARGS --env KB_ID=$AC_KB_ID"
          fi
          if [[ -n "$AC_S3_SESSION_BUCKET" && "$AC_S3_SESSION_BUCKET" != "None" ]]; then
            VOICE_ENV_ARGS="$VOICE_ENV_ARGS --env S3_SESSION_BUCKET=$AC_S3_SESSION_BUCKET"
          fi

          print_status "Launching Voice AgentCore Runtime..."
          agentcore launch --agent "multimedia_rag_voice_${ENV}" --auto-update-on-conflict $VOICE_ENV_ARGS

          if [ $? -ne 0 ]; then
            print_warning "Voice AgentCore launch failed (voice chat will be unavailable)"
          else
            sleep 5
            VOICE_RUNTIME_ARN=$(aws bedrock-agentcore-control list-agent-runtimes \
              --region "$REGION" --profile "$PROFILE" \
              --query "agentRuntimes[?agentRuntimeName=='multimedia_rag_voice_${ENV}'].agentRuntimeArn | [0]" \
              --output text 2>/dev/null | tr -d '\n' | sed 's/None$//')

            if [[ -n "$VOICE_RUNTIME_ARN" && "$VOICE_RUNTIME_ARN" != "None" ]]; then
              print_success "Voice Runtime ARN: $VOICE_RUNTIME_ARN"
              aws ssm put-parameter \
                --name "/multimedia-rag/${ENV}/voice-runtime-arn" \
                --value "$VOICE_RUNTIME_ARN" \
                --type "String" --description "Voice AgentCore Runtime ARN" --overwrite \
                --region "$REGION" --profile "$PROFILE" > /dev/null 2>&1
              sed -i '' "s|NEXT_PUBLIC_VOICE_RUNTIME_ARN=.*|NEXT_PUBLIC_VOICE_RUNTIME_ARN=$VOICE_RUNTIME_ARN|" "$SCRIPT_DIR/frontend/.env.local"
              print_success "Voice Runtime ARN stored in SSM and frontend config"
            else
              print_warning "Could not retrieve Voice Runtime ARN"
            fi
          fi

          # Switch default back to text agent
          agentcore configure set-default "multimedia_rag_agent_${ENV}" 2>/dev/null
        fi
        
        cd "$SCRIPT_DIR"
      fi
    fi
  fi
fi

# =============================================================================
# NEXT.JS STATIC FRONTEND DEPLOYMENT (always in full deploy, or with --frontend flag)
# =============================================================================

if [ "$DEPLOY_FRONTEND" = "true" ] || ([ "$SKIP_INFRASTRUCTURE" = "false" ] && [ "$LOCAL_CONFIG_ONLY" = "false" ]); then
  echo ""
  echo "🖥️  Building Next.js frontend..."

  if [ ! -f frontend/.env.local ]; then
    print_error "frontend/.env.local not found. Run without --frontend first to generate config."
    exit 1
  fi

  cd frontend

  # Move API routes out of static build (only needed for local dev)
  if [ -d "src/app/api" ]; then
    mv src/app/api src/app/_api_backup
    print_status "Moved API routes out of build (not needed for static deployment)"
  fi

  npm install --prefer-offline
  STATIC_EXPORT=true npm run build

  # Restore API routes for local dev
  if [ -d "src/app/_api_backup" ]; then
    mv src/app/_api_backup src/app/api
  fi

  cd ..

  echo "📤 Deploying Next.js frontend to S3..."

  APP_BUCKET=$(aws cloudformation describe-stacks --stack-name "MultimediaRagStack-$ENV" \
    --query "Stacks[0].Outputs[?OutputKey=='ApplicationHostBucketName'].OutputValue" \
    --output text --region $REGION --profile $PROFILE)

  if [ -z "$APP_BUCKET" ]; then
    print_error "Failed to get S3 bucket name"
    exit 1
  fi

  aws s3 sync frontend/out/ s3://$APP_BUCKET/ \
    --profile $PROFILE --delete --cache-control "max-age=3600"

  CF_DIST_ID=$(aws cloudformation describe-stacks --stack-name "MultimediaRagStack-$ENV" \
    --query "Stacks[0].Outputs[?OutputKey=='CloudFrontDistributionId'].OutputValue" \
    --output text --region $REGION --profile $PROFILE)

  if [ ! -z "$CF_DIST_ID" ]; then
    echo "🔄 Invalidating CloudFront cache..."
    aws cloudfront create-invalidation --distribution-id $CF_DIST_ID --paths "/*" --profile $PROFILE
  fi

  print_success "Next.js frontend deployed to S3 and CloudFront invalidated"
fi

echo ""
echo "✅ Deployment complete!"
echo ""

# Show CloudFront URL if available
CF_DOMAIN=$(aws cloudformation describe-stacks --stack-name "MultimediaRagStack-$ENV" \
  --query "Stacks[0].Outputs[?OutputKey=='CloudFrontDomainName'].OutputValue" \
  --output text --region $REGION --profile $PROFILE 2>/dev/null || echo "")
if [[ -n "$CF_DOMAIN" && "$CF_DOMAIN" != "None" ]]; then
  echo "🌐 Application URL: https://$CF_DOMAIN"
  echo ""
fi

echo "To run locally:"
echo "  ./start-local.sh"
echo ""
echo "To update agent code only:"
echo "  ./deploy.sh --agentcore-runtime -e $ENV -r $REGION"
echo ""
echo "To rebuild & redeploy frontend only:"
echo "  ./deploy.sh --frontend -e $ENV"
