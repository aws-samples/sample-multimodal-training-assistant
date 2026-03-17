"""Web research tools for the learning platform.

Enables the agent to research topics from the web, fetch content,
save to S3 for KB ingestion, and trigger KB sync.
"""

import os
import json
import time
import re
import boto3
from strands import tool


ORGANIZED_BUCKET = os.getenv('ORGANIZED_BUCKET', '')
KB_ID = os.getenv('KB_ID', '')
KB_DATA_SOURCE_ID = os.getenv('KB_DATA_SOURCE_ID', '')
REGION = os.getenv('AWS_REGION', 'us-west-2')

# Domains that consistently return low-quality or paywalled content
JUNK_DOMAINS = ["pinterest.com", "chegg.com", "coursehero.com", "scribd.com", "quora.com"]


# --- Internal helpers (plain functions, no @tool decorator) ---

def _search_web(query: str, max_results: int = 5) -> dict:
    max_results = max(1, min(max_results, 10))  # Cap to prevent abuse
    from tavily import TavilyClient
    client = TavilyClient(api_key=os.getenv('TAVILY_API_KEY'))
    result = client.search(query=query, search_depth="advanced", max_results=max_results, include_raw_content=False, exclude_domains=JUNK_DOMAINS)
    sources = []
    for r in result.get('results', []):
        sources.append({
            "title": r.get('title', ''),
            "url": r.get('url', ''),
            "snippet": r.get('content', '')[:300],
            "score": r.get('score', 0)
        })
    return {"query": query, "sources": sources, "answer": result.get('answer', '')}


def _fetch_webpage(url: str) -> dict:
    # Validate URL scheme and block internal/metadata endpoints
    from urllib.parse import urlparse
    parsed = urlparse(url)
    if parsed.scheme not in ('http', 'https'):
        return {"url": url, "error": "Only http/https URLs are allowed"}
    if parsed.hostname and (parsed.hostname.startswith('169.254.') or parsed.hostname in ('localhost', '127.0.0.1', '0.0.0.0', '[::]')):
        return {"url": url, "error": "Internal URLs are not allowed"}
    from tavily import TavilyClient
    client = TavilyClient(api_key=os.getenv('TAVILY_API_KEY'))
    result = client.extract(urls=[url], include_raw_content=False)
    if result and result.get('results'):
        content = result['results'][0]
        return {
            "url": url,
            "content": content.get('raw_content', content.get('text', ''))[:5000],
            "title": content.get('title', url)
        }
    return {"url": url, "error": "No content extracted"}


def _save_to_kb(content: str, topic: str, source_name: str, source_url: str = "", source_type: str = "web") -> dict:
    if not ORGANIZED_BUCKET:
        return {"error": "ORGANIZED_BUCKET not configured"}
    safe_topic = re.sub(r'[^a-zA-Z0-9_-]', '_', topic.lower().strip())
    safe_name = re.sub(r'[^a-zA-Z0-9_-]', '_', source_name.lower().strip())
    key = f"Documents/web-research/{safe_topic}/{safe_name}.md"
    s3 = boto3.client('s3', region_name=REGION)
    s3.put_object(
        Bucket=ORGANIZED_BUCKET, Key=key,
        Body=content.encode('utf-8'), ContentType='text/markdown',
        Metadata={
            'source-url': source_url[:512],
            'source-type': source_type,
            'topic': topic[:128],
        }
    )
    return {"saved": True, "bucket": ORGANIZED_BUCKET, "key": key, "size": len(content)}


def _trigger_kb_sync() -> dict:
    """Start a KB ingestion job and return immediately without polling.

    If a job is already in progress, returns its ID with status IN_PROGRESS.
    Use get_kb_sync_status(job_id) to check completion later.
    """
    if not KB_ID or not KB_DATA_SOURCE_ID:
        return {"error": "KB_ID or KB_DATA_SOURCE_ID not configured"}
    client = boto3.client('bedrock-agent', region_name=REGION)
    # Check for any already in-progress jobs — return early rather than stacking
    jobs = client.list_ingestion_jobs(
        knowledgeBaseId=KB_ID, dataSourceId=KB_DATA_SOURCE_ID,
        maxResults=5, sortBy={'attribute': 'STARTED_AT', 'order': 'DESCENDING'}
    )
    for job in jobs.get('ingestionJobSummaries', []):
        if job['status'] in ('STARTING', 'IN_PROGRESS'):
            return {"job_id": job['ingestionJobId'], "status": "IN_PROGRESS"}
    # No in-progress job — start a new one and return immediately
    response = client.start_ingestion_job(knowledgeBaseId=KB_ID, dataSourceId=KB_DATA_SOURCE_ID)
    job_id = response['ingestionJob']['ingestionJobId']
    return {"job_id": job_id, "status": "STARTED"}


def _get_kb_sync_status(job_id: str) -> dict:
    """Check the status of a KB ingestion job by job_id."""
    if not KB_ID or not KB_DATA_SOURCE_ID:
        return {"error": "KB_ID or KB_DATA_SOURCE_ID not configured"}
    client = boto3.client('bedrock-agent', region_name=REGION)
    response = client.get_ingestion_job(
        knowledgeBaseId=KB_ID, dataSourceId=KB_DATA_SOURCE_ID, ingestionJobId=job_id
    )
    raw_status = response['ingestionJob']['status']
    # Normalise to the three statuses the agent knows about
    if raw_status in ('STARTING', 'IN_PROGRESS'):
        status = 'IN_PROGRESS'
    elif raw_status == 'COMPLETE':
        status = 'COMPLETE'
    else:
        status = 'FAILED'
    return {"job_id": job_id, "status": status}


# --- @tool wrappers (thin wrappers around helpers for Strands agent) ---

@tool
def search_web(query: str, max_results: int = 5) -> str:
    """Search the web for information on a topic using Tavily.
    Args:
        query: The search query
        max_results: Maximum number of results to return (default 5)
    """
    try:
        return json.dumps(_search_web(query, max_results))
    except Exception as e:
        return json.dumps({"query": query, "error": str(e)})


@tool
def fetch_webpage(url: str) -> str:
    """Fetch and extract clean text content from a URL.
    Args:
        url: The URL to fetch content from
    """
    try:
        return json.dumps(_fetch_webpage(url))
    except Exception as e:
        return json.dumps({"url": url, "error": str(e)})


@tool
def save_to_kb(content: str, topic: str, source_name: str, source_url: str = "", source_type: str = "web") -> str:
    """Save text content to S3 for Knowledge Base ingestion.
    Args:
        content: The text content to save
        topic: The topic/course name (used as folder name)
        source_name: Name for the source file (without extension)
        source_url: Original source URL for attribution
        source_type: Type of source (web, youtube, document)
    """
    try:
        return json.dumps(_save_to_kb(content, topic, source_name, source_url, source_type))
    except Exception as e:
        return json.dumps({"error": str(e)})


@tool
def trigger_kb_sync() -> str:
    """Trigger a Knowledge Base sync to ingest new content from S3.
    Returns immediately with {job_id, status}. Status is "STARTED" for a new job
    or "IN_PROGRESS" if a job is already running.
    Use get_kb_sync_status(job_id) to check completion later.
    """
    try:
        return json.dumps(_trigger_kb_sync())
    except Exception as e:
        return json.dumps({"error": str(e)})


@tool
def get_kb_sync_status(job_id: str) -> str:
    """Check the status of a Knowledge Base sync job.
    Args:
        job_id: The ingestion job ID returned by trigger_kb_sync
    Returns {job_id, status} where status is IN_PROGRESS, COMPLETE, or FAILED.
    """
    try:
        return json.dumps(_get_kb_sync_status(job_id))
    except Exception as e:
        return json.dumps({"job_id": job_id, "error": str(e)})


# @tool  — deprecated: replaced by agent-orchestrated atomic tool flow
# The agent now calls search_web, fetch_webpage, save_to_kb, and trigger_kb_sync directly,
# giving it full visibility and control over source selection and quality evaluation.
#
# def research_topic(topic: str) -> str:
#     """Research a topic from the web: search, fetch top sources, save to KB, and sync.
#     Args:
#         topic: The topic to research
#     """
#     results = {"topic": topic, "sources_saved": 0, "errors": []}
#     try:
#         search_result = _search_web(topic, max_results=5)
#     except Exception as e:
#         return json.dumps({"error": f"Web search failed: {str(e)}"})
#
#     for i, source in enumerate(search_result.get("sources", [])[:5]):
#         url = source.get("url", "")
#         title = source.get("title", f"source_{i}")
#         try:
#             fetch_result = _fetch_webpage(url)
#             if "error" in fetch_result:
#                 results["errors"].append(f"{url}: {fetch_result['error']}")
#                 continue
#             content = fetch_result.get("content", "")
#             if not content or len(content) < 100:
#                 results["errors"].append(f"{url}: content too short")
#                 continue
#             full_content = (
#                 f"# {title}\n\n"
#                 f"**Source:** [{url}]({url})  \n"
#                 f"**Type:** Web Article  \n"
#                 f"**Topic:** {topic}  \n\n"
#                 f"---\n\n"
#                 f"{content}"
#             )
#             safe_title = re.sub(r'[^a-zA-Z0-9_-]', '_', title[:50].lower().strip())
#             save_result = _save_to_kb(full_content, topic, safe_title, source_url=url, source_type="web")
#             if save_result.get("saved"):
#                 results["sources_saved"] += 1
#         except Exception as e:
#             results["errors"].append(f"{url}: {str(e)}")
#
#     if results["sources_saved"] > 0:
#         try:
#             results["sync"] = _trigger_kb_sync()
#         except Exception as e:
#             results["errors"].append(f"KB sync failed: {str(e)}")
#
#     return json.dumps(results)
