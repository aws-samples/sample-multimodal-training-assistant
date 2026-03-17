import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as iam from 'aws-cdk-lib/aws-iam';
import { WAF_TAGS } from './constants';

/**
 * Props for the StorageDistStack
 */
export interface StorageDistStackProps extends cdk.NestedStackProps {
  /**
   * Suffix to append to resource names
   */
  resourceSuffix: string;

  /**
   * Cross-account S3 bucket ARN for access logs (Optional - for higher security)
   * If provided, logs will be sent to this external bucket instead of the local log bucket
   */
  externalLogBucketArn?: string;
}

/**
 * Storage and Distribution Stack for multimedia-rag application
 * 
 * This combined stack provisions:
 * - S3 buckets for media files, organized content, multimodal data, and application hosting
 * - CloudFront distribution for delivering web content
 * - Origin access control for S3 buckets
 * - Request policies for query string forwarding
 */
export class StorageDistStack extends cdk.NestedStack {
  /**
   * S3 bucket for media file uploads
   */
  public readonly mediaBucket: s3.Bucket;
  
  /**
   * S3 bucket for organized processed files
   */
  public readonly organizedBucket: s3.Bucket;
  
  /**
   * S3 bucket for multimodal data
   */
  public readonly multimodalBucket: s3.Bucket;
  
  /**
   * S3 bucket for hosting the React application
   */
  public readonly applicationHostBucket: s3.Bucket;
  
  /**
   * S3 bucket for access logs
   */
  public readonly accessLogBucket: s3.Bucket;

  /**
   * CloudFront distribution
   */
  public readonly distribution: cloudfront.Distribution;
  
  /**
   * Origin request policy
   */
  public readonly edgeRequestPolicy: cloudfront.OriginRequestPolicy;
  
  /**
   * Origin access control for S3 buckets
   */
  public readonly originAccessControl: cloudfront.CfnOriginAccessControl;
  
  constructor(scope: Construct, id: string, props: StorageDistStackProps) {
    super(scope, id, props);

    // Add Well-Architected Framework tags to stack
    Object.entries(WAF_TAGS).forEach(([key, value]) => {
      cdk.Tags.of(this).add(key, value);
    });
    
    // Add environment tag
    cdk.Tags.of(this).add('Environment', props.resourceSuffix);
    
    // ======== STORAGE PART ========
    
    // Create a dedicated bucket for access logs with appropriate security settings
    this.accessLogBucket = new s3.Bucket(this, 'AccessLogsBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: true,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_PREFERRED,
      lifecycleRules: [
        {
          enabled: true,
          transitions: [
            {
              storageClass: s3.StorageClass.INFREQUENT_ACCESS,
              transitionAfter: cdk.Duration.days(30)
            },
            {
              storageClass: s3.StorageClass.GLACIER,
              transitionAfter: cdk.Duration.days(90)
            }
          ],
          expiration: cdk.Duration.days(365)
        }
      ]
    });
    
    // Determine which bucket to use for access logging
    let logBucket: s3.IBucket;
    if (props.externalLogBucketArn) {
      logBucket = s3.Bucket.fromBucketArn(this, 'ExternalLogBucket', props.externalLogBucketArn);
    } else {
      logBucket = this.accessLogBucket;
    }
    
    // Create the Media bucket for source files 
    this.mediaBucket = new s3.Bucket(this, 'MediaBucket', {
      eventBridgeEnabled: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      serverAccessLogsBucket: logBucket,
      serverAccessLogsPrefix: 'media-bucket-logs/',
      // CORS is added after CloudFront distribution is created (see addCorsRule below)
    });

    // Create the Organized bucket for processed files
    this.organizedBucket = new s3.Bucket(this, 'OrganizedBucket', {
      eventBridgeEnabled: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      serverAccessLogsBucket: logBucket,
      serverAccessLogsPrefix: 'organized-bucket-logs/',
      lifecycleRules: [
        {
          enabled: true,
          transitions: [
            {
              storageClass: s3.StorageClass.INFREQUENT_ACCESS,
              transitionAfter: cdk.Duration.days(30)
            }
          ]
        },
        {
          enabled: true,
          prefix: 'bda-output/',
          expiration: cdk.Duration.days(7)
        }
      ]
    });

    // Create the Multimodal bucket
    this.multimodalBucket = new s3.Bucket(this, 'MultimodalBucket', {
      eventBridgeEnabled: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      serverAccessLogsBucket: logBucket,
      serverAccessLogsPrefix: 'multimodal-bucket-logs/'
    });

    // Create the Application Host bucket for the React frontend
    this.applicationHostBucket = new s3.Bucket(this, 'ApplicationHostBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      serverAccessLogsBucket: logBucket,
      serverAccessLogsPrefix: 'app-host-bucket-logs/',
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true
    });

    // ======== DISTRIBUTION PART ========
    // Create Origin Access Control for S3 buckets
    this.originAccessControl = new cloudfront.CfnOriginAccessControl(this, 'CloudFrontOAC', {
      originAccessControlConfig: {
        name: `multimedia-rag-bucket-oac-${props.resourceSuffix}`,
        description: 'Origin Access Control for S3 Buckets',
        signingBehavior: 'always',
        signingProtocol: 'sigv4',
        originAccessControlOriginType: 's3'
      }
    });
    
    // Create Edge Request Policy for auth query parameter
    this.edgeRequestPolicy = new cloudfront.OriginRequestPolicy(this, 'EdgeRequestPolicy', {
      originRequestPolicyName: `EdgeRequest-${props.resourceSuffix}`,
      comment: 'Origin request policy to forward auth query string',
      headerBehavior: cloudfront.OriginRequestHeaderBehavior.none(),
      queryStringBehavior: cloudfront.OriginRequestQueryStringBehavior.allowList('auth'),
      cookieBehavior: cloudfront.OriginRequestCookieBehavior.none()
    });
    
    // Create S3 origins using OAC (not deprecated S3Origin which creates OAI)
    const mediaBucketS3Origin = origins.S3BucketOrigin.withOriginAccessControl(this.mediaBucket);
    const appBucketS3Origin = origins.S3BucketOrigin.withOriginAccessControl(this.applicationHostBucket);
    
    // Define default cache behavior
    const defaultBehavior: cloudfront.BehaviorOptions = {
      origin: mediaBucketS3Origin,
      viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
      cachedMethods: cloudfront.CachedMethods.CACHE_GET_HEAD_OPTIONS,
      cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
      originRequestPolicy: this.edgeRequestPolicy,
      responseHeadersPolicy: cloudfront.ResponseHeadersPolicy.CORS_ALLOW_ALL_ORIGINS_WITH_PREFLIGHT
    };
    
    // Create additionalBehaviors for static assets
    const additionalBehaviors: Record<string, cloudfront.BehaviorOptions> = {
      '*.html': {
        origin: appBucketS3Origin,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
        cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
        originRequestPolicy: cloudfront.OriginRequestPolicy.CORS_S3_ORIGIN,
        responseHeadersPolicy: cloudfront.ResponseHeadersPolicy.CORS_ALLOW_ALL_ORIGINS_WITH_PREFLIGHT_AND_SECURITY_HEADERS,
        compress: true
      },
      '*.js': {
        origin: appBucketS3Origin,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
        cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
        originRequestPolicy: cloudfront.OriginRequestPolicy.CORS_S3_ORIGIN,
        responseHeadersPolicy: cloudfront.ResponseHeadersPolicy.CORS_ALLOW_ALL_ORIGINS_WITH_PREFLIGHT_AND_SECURITY_HEADERS,
        compress: true
      },
      '*.css': {
        origin: appBucketS3Origin,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
        cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
        originRequestPolicy: cloudfront.OriginRequestPolicy.CORS_S3_ORIGIN,
        responseHeadersPolicy: cloudfront.ResponseHeadersPolicy.CORS_ALLOW_ALL_ORIGINS_WITH_PREFLIGHT_AND_SECURITY_HEADERS,
        compress: true
      }
    };
    
    // Create CloudFront Distribution
    this.distribution = new cloudfront.Distribution(this, 'CloudFrontDistribution', {
      defaultRootObject: 'index.html',
      comment: `Distribution for ${cdk.Aws.ACCOUNT_ID} media and application buckets`,
      defaultBehavior,
      additionalBehaviors,
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
      httpVersion: cloudfront.HttpVersion.HTTP2,
      enableIpv6: true,
      minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
      enableLogging: true,
      logBucket: this.accessLogBucket,
      logFilePrefix: 'cloudfront-logs/',
      logIncludesCookies: false
    });
    
    // OAC is automatically applied by S3BucketOrigin.withOriginAccessControl()
    // Bucket policies for CloudFront access are also auto-created

    // CORS for media bucket — uses wildcard for CloudFront since the domain name
    // isn't known until after deployment. The bucket is not publicly accessible
    // (BlockPublicAccess.BLOCK_ALL), so CORS only applies to authenticated
    // presigned URL requests.
    this.mediaBucket.addCorsRule({
      allowedHeaders: ['*'],
      allowedMethods: [
        s3.HttpMethods.GET,
        s3.HttpMethods.PUT,
        s3.HttpMethods.POST,
        s3.HttpMethods.DELETE
      ],
      allowedOrigins: [
        'https://*.cloudfront.net',
        'http://localhost:3000',
      ],
      exposedHeaders: ['ETag'],
    });

    // ======== OUTPUTS ========
    new cdk.CfnOutput(this, 'OrganizedBucketName', {
      value: this.organizedBucket.bucketName,
      description: 'Organized bucket name',
      exportName: `${id}-OrganizedBucketName`
    });

    new cdk.CfnOutput(this, 'MultimodalBucketName', {
      value: this.multimodalBucket.bucketName,
      description: 'Multimodal bucket name',
      exportName: `${id}-MultimodalBucketName`
    });
    
    new cdk.CfnOutput(this, 'CloudFrontDistributionArn', {
      value: `arn:aws:cloudfront::${cdk.Aws.ACCOUNT_ID}:distribution/${this.distribution.distributionId}`,
      description: 'CloudFront Distribution ARN',
      exportName: `${id}-CloudFrontDistributionArn`
    });
    
    new cdk.CfnOutput(this, 'AccessLogsBucketName', {
      value: this.accessLogBucket.bucketName,
      description: 'S3 Access Logs Bucket Name',
      exportName: `${id}-AccessLogsBucketName`
    });
  }
}
