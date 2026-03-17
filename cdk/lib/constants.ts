/**
 * Shared constants for the multimedia-rag CDK application.
 */
export const DEFAULT_MODEL_ID = 'us.anthropic.claude-sonnet-4-6-v1';
export const DEFAULT_EMBEDDING_MODEL_ID = 'amazon.titan-embed-text-v2:0';

/**
 * Configuration for resource naming and deployment environment.
 */
export interface ResourceConfig {
  /**
   * Suffix to append to resource names (e.g., dev, test, prod)
   */
  resourceSuffix: string;
}

/**
 * Well-Architected Framework best practices tags for all resources.
 */
export const WAF_TAGS = {
  Project: 'MultimediaRAG',
  'WAF:Pillar:Security': 'Enabled',
  'WAF:Pillar:Reliability': 'Enabled',
  'WAF:Pillar:PerformanceEfficiency': 'Enabled',
  'WAF:Pillar:CostOptimization': 'Enabled',
  'WAF:Pillar:OperationalExcellence': 'Enabled',
  'WAF:Pillar:Sustainability': 'Enabled',
};
