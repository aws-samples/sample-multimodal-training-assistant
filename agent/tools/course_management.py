"""Course management tools for the learning platform.

Enables the agent to create structured courses from web research,
list/view courses, and update course outlines — all persisted in DynamoDB.
"""

import re
import json
from strands import tool

from lib import dynamo_client
from lib.user_context import current_user_id


_STRIP_PREFIXES = ["amazon", "aws", "introduction to", "intro to", "getting started with"]


def _normalize_topic_id(text: str) -> str:
    """Normalize a topic string to a consistent DynamoDB-safe ID.
    Strips common prefixes so 'Amazon DynamoDB' and 'DynamoDB' produce the same key."""
    normalized = text.lower().strip()
    for prefix in _STRIP_PREFIXES:
        if normalized.startswith(prefix + " "):
            normalized = normalized[len(prefix):].strip()
    slug = re.sub(r'[^a-z0-9]+', '-', normalized)
    return slug.strip('-')


def _decimal_default(obj):
    """JSON serializer for Decimal types returned by DynamoDB."""
    from decimal import Decimal
    if isinstance(obj, Decimal):
        return float(obj) if obj % 1 else int(obj)
    raise TypeError(f"Object of type {type(obj)} is not JSON serializable")


# --- Internal helpers (plain functions, no @tool decorator) ---

def _list_courses() -> list[dict]:
    """List all courses from DynamoDB."""
    items = dynamo_client.list_courses()
    courses = []
    for item in items:
        pk = item.get('PK', '')
        course_id = pk.replace('COURSE#', '') if pk.startswith('COURSE#') else pk
        courses.append({
            "id": course_id,
            "title": item.get('title', ''),
            "type": item.get('type', ''),
            "subtopic_count": len(item.get('subtopics', [])),
            "created": item.get('created', ''),
        })
    return courses


def _get_course_outline(course_id: str) -> dict:
    """Fetch full course details from DynamoDB."""
    item = dynamo_client.get_course(course_id)
    if not item:
        return {"error": f"Course '{course_id}' not found"}

    pk = item.get('PK', '')
    return {
        "course_id": pk.replace('COURSE#', '') if pk.startswith('COURSE#') else pk,
        "title": item.get('title', ''),
        "type": item.get('type', ''),
        "subtopics": item.get('subtopics', []),
        "created": item.get('created', ''),
        "last_updated": item.get('last_updated', ''),
        "created_by": item.get('created_by', ''),
    }


def _update_course(course_id: str, title: str = "", subtopics_json: str = "") -> dict:
    """Apply structured updates to a course. The agent interprets user intent and passes structured data.

    Args:
        course_id: The course identifier slug.
        title: New title (empty string = keep current).
        subtopics_json: JSON array of updated subtopic objects (empty string = keep current).
    """
    item = dynamo_client.get_course(course_id)
    if not item:
        return {"error": f"Course '{course_id}' not found"}

    updates = {}
    if title:
        updates['title'] = title
    if subtopics_json:
        subtopics = json.loads(subtopics_json) if isinstance(subtopics_json, str) else subtopics_json
        updates['subtopics'] = subtopics

    if not updates:
        return {
            "course_id": course_id,
            "message": "No changes provided",
            "title": item.get('title', ''),
            "subtopics": item.get('subtopics', []),
        }

    result = dynamo_client.update_course(course_id, updates)

    pk = result.get('PK', '')
    return {
        "course_id": pk.replace('COURSE#', '') if pk.startswith('COURSE#') else pk,
        "title": result.get('title', ''),
        "subtopics": result.get('subtopics', []),
        "last_updated": result.get('last_updated', ''),
    }


def _resolve_course_id(topic: str) -> dict:
    """Find the best matching course_id for a topic, or generate one."""
    normalized = _normalize_topic_id(topic)
    existing = dynamo_client.get_course(normalized)
    if existing:
        return {"course_id": normalized, "matched": True, "title": existing.get("title", "")}
    all_courses = dynamo_client.list_courses()
    for course in all_courses:
        pk = course.get('PK', '').replace('COURSE#', '')
        if normalized in pk or pk in normalized:
            return {"course_id": pk, "matched": True, "title": course.get("title", "")}
    return {"course_id": normalized, "matched": False, "title": ""}


def _scaffold_course(topic: str, title: str, subtopics_json: str) -> dict:
    """Create a course record in DynamoDB from agent-supplied structure.

    Does NOT perform any research, LLM calls, or web fetching — that is the
    agent's responsibility. Handles dedup via topic normalization.

    Args:
        topic: Topic string used to derive the course_id slug.
        title: Human-readable course title.
        subtopics_json: JSON array of subtopic objects. Each subtopic should
            contain: id (slug), title, order (int), difficulty
            (beginner/intermediate/advanced), and optionally description.

    Returns:
        {course_id, title, subtopics, already_exists}
    """
    course_id = _normalize_topic_id(topic)
    existing = dynamo_client.get_course(course_id)
    if existing:
        return {
            "course_id": course_id,
            "title": existing.get("title", ""),
            "subtopics": existing.get("subtopics", []),
            "already_exists": True,
        }

    subtopics = json.loads(subtopics_json)
    # Ensure each subtopic has an initialised sources list
    for st in subtopics:
        st.setdefault('sources', [])

    user_id = current_user_id.get() or 'anonymous'
    item = dynamo_client.put_course(
        course_id=course_id,
        title=title,
        subtopics=subtopics,
        course_type='web-researched',
        created_by=user_id,
    )

    pk = item.get('PK', '')
    return {
        "course_id": pk.replace('COURSE#', '') if pk.startswith('COURSE#') else pk,
        "title": item.get('title', ''),
        "subtopics": item.get('subtopics', []),
        "already_exists": False,
    }


def _add_source_to_subtopic(course_id: str, subtopic_id: str, source_filename: str, source_url: str = "") -> dict:
    """Attach a saved KB source file to a specific subtopic in DynamoDB.

    Args:
        course_id: The course identifier (slug).
        subtopic_id: The subtopic id to attach the source to.
        source_filename: The S3 filename (key basename) of the saved source.
        source_url: Optional original URL for attribution.

    Returns:
        Updated subtopic dict with sources list, or an error dict.
    """
    return dynamo_client.add_course_source(
        course_id=course_id,
        subtopic_id=subtopic_id,
        source_filename=source_filename,
        source_url=source_url,
    )


# --- @tool wrappers (thin wrappers around helpers for Strands agent) ---

@tool
def scaffold_course(topic: str, title: str, subtopics_json: str) -> str:
    """Create a course record in DynamoDB from an agent-designed curriculum.
    Handles dedup — returns the existing course if the topic already exists.
    Does NOT perform research or fetch content; the agent does that separately.
    Args:
        topic: Topic string used to derive the course_id slug (e.g. "Amazon Bedrock AgentCore")
        title: Human-readable course title (e.g. "Amazon Bedrock AgentCore: Complete Guide")
        subtopics_json: JSON array of subtopic objects. Each must include:
            id (slug), title, order (int), difficulty (beginner/intermediate/advanced).
            Optional: description (1-2 sentences).
            Example: '[{"id": "overview", "title": "Overview", "order": 1, "difficulty": "beginner"}]'
    """
    try:
        return json.dumps(_scaffold_course(topic, title, subtopics_json), default=_decimal_default)
    except Exception as e:
        return json.dumps({"topic": topic, "error": str(e)})


@tool
def add_source_to_subtopic(course_id: str, subtopic_id: str, source_filename: str, source_url: str = "") -> str:
    """Attach a saved KB source file to a specific subtopic in the course record.
    Call this after save_to_kb to link the saved file to the subtopic in DynamoDB.
    The sidebar updates progressively as sources are attached.
    Args:
        course_id: The course identifier slug (e.g. "amazon-bedrock-agentcore")
        subtopic_id: The subtopic id to attach the source to (e.g. "overview")
        source_filename: The S3 filename (key basename) from the save_to_kb result
        source_url: Optional original URL for attribution
    """
    try:
        return json.dumps(_add_source_to_subtopic(course_id, subtopic_id, source_filename, source_url), default=_decimal_default)
    except Exception as e:
        return json.dumps({"course_id": course_id, "subtopic_id": subtopic_id, "error": str(e)})


@tool
def list_courses() -> str:
    """List all available courses with their id, title, type, and subtopic count."""
    try:
        return json.dumps(_list_courses(), default=_decimal_default)
    except Exception as e:
        return json.dumps({"error": str(e)})


@tool
def get_course_outline(course_id: str) -> str:
    """Get the full outline of a course including all subtopics.
    Args:
        course_id: The course identifier (slug), e.g. "amazon-bedrock-agentcore"
    """
    try:
        return json.dumps(_get_course_outline(course_id), default=_decimal_default)
    except Exception as e:
        return json.dumps({"course_id": course_id, "error": str(e)})


@tool
def update_course(course_id: str, title: str = "", subtopics_json: str = "") -> str:
    """Update a course's title and/or subtopics. The agent interprets user intent
    and passes the updated structure directly — no hidden LLM call.
    Call get_course_outline first to see the current state, then apply changes.
    Args:
        course_id: The course identifier (slug), e.g. "amazon-bedrock-agentcore"
        title: New course title (leave empty to keep current)
        subtopics_json: JSON array of the full updated subtopics list. Each subtopic:
            id (slug), title, order (int), difficulty, description.
            Leave empty to keep current subtopics.
            Example: '[{"id":"overview","title":"Introduction","order":1,"difficulty":"beginner","description":"..."}]'
    """
    try:
        return json.dumps(_update_course(course_id, title, subtopics_json), default=_decimal_default)
    except Exception as e:
        return json.dumps({"course_id": course_id, "error": str(e)})


@tool
def resolve_course_id(topic: str) -> str:
    """Find the best matching course_id for a topic, or generate a normalized one.
    Call this before tracking progress to get a consistent ID.
    Args:
        topic: The topic name as the user expressed it
    """
    try:
        return json.dumps(_resolve_course_id(topic), default=_decimal_default)
    except Exception as e:
        return json.dumps({"topic": topic, "error": str(e)})
