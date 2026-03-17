"""Bedrock Knowledge Base client - queries YOUR real KB."""
import os
import boto3


def query_kb(query: str, kb_id: str = None, region: str = None):
    """Query Bedrock Knowledge Base with real AWS calls."""
    kb_id = kb_id or os.getenv('KB_ID')
    region = region or os.getenv('AWS_REGION', 'us-west-2')
    
    client = boto3.client('bedrock-agent-runtime', region_name=region)
    
    response = client.retrieve(
        knowledgeBaseId=kb_id,
        retrievalQuery={'text': query},
        retrievalConfiguration={
            'vectorSearchConfiguration': {
                'numberOfResults': 15,
                'rerankingConfiguration': {
                    'type': 'BEDROCK_RERANKING_MODEL',
                    'bedrockRerankingConfiguration': {
                        'numberOfRerankedResults': 5,
                        'modelConfiguration': {
                            'modelArn': f'arn:aws:bedrock:{region}::foundation-model/{os.getenv("RERANK_MODEL_ID", "cohere.rerank-v3-5:0")}'
                        }
                    }
                }
            }
        }
    )
    
    results = []
    for item in response.get('retrievalResults', []):
        results.append({
            'content': item.get('content', {}).get('text', ''),
            'score': item.get('score', 0),
            'metadata': item.get('metadata', {})
        })
    
    return results
