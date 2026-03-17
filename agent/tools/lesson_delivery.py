"""Lesson delivery tool — assembles subtopic context for structured teaching."""
import json
from strands import tool
from lib import dynamo_client
from lib.kb_client import query_kb
from lib.user_context import get_user_id


@tool
def start_lesson(subtopic_id: str, course_id: str) -> str:
    """Retrieve subtopic-scoped KB content, metadata, and user history to build a lesson.

    Call this when a user selects a subtopic or asks to learn about a specific topic
    within a course. Returns a lesson_brief with everything needed to deliver a
    structured lesson (Hook → Concept → Example → Takeaway).

    Args:
        subtopic_id: The subtopic to teach
        course_id: The course containing the subtopic
    """
    user_id = get_user_id()

    # 1. Get course + subtopic metadata
    course = dynamo_client.get_course(course_id)
    if not course:
        return json.dumps({"error": f"Course '{course_id}' not found"})

    subtopic = None
    for st in course.get('subtopics', []):
        if st.get('id') == subtopic_id:
            subtopic = st
            break

    if not subtopic:
        return json.dumps({"error": f"Subtopic '{subtopic_id}' not found in course '{course_id}'"})

    # 2. Search KB scoped to this subtopic's sources
    query = f"{subtopic.get('title', '')} {subtopic.get('description', '')}"
    results = query_kb(query)

    # Filter to subtopic sources if available
    subtopic_sources = set()
    for src in subtopic.get('sources', []):
        fname = src if isinstance(src, str) else src.get('filename', '')
        if fname:
            subtopic_sources.add(fname.lower())

    kb_content = []
    if subtopic_sources and results:
        for r in results:
            source_uri = r.get('metadata', {}).get('x-amz-bedrock-kb-source-uri', '')
            source_name = source_uri.split('/')[-1].lower() if source_uri else ''
            if any(ss in source_name or source_name in ss for ss in subtopic_sources):
                kb_content.append({
                    "text": r['content'][:2000],
                    "source": source_name,
                    "score": r.get('score', 0),
                })

    # Fallback: use unfiltered results if no subtopic-scoped matches
    if not kb_content and results:
        for r in results[:3]:
            source_uri = r.get('metadata', {}).get('x-amz-bedrock-kb-source-uri', '')
            source_name = source_uri.split('/')[-1] if source_uri else ''
            kb_content.append({
                "text": r['content'][:2000],
                "source": source_name,
                "score": r.get('score', 0),
            })

    # 3. Get user's history for this subtopic
    user_history = {"previous_attempts": 0, "previous_scores": [], "last_activity": None}
    if user_id:
        progress = dynamo_client.get_user_progress(user_id, course_id)
        if progress:
            quizzes = progress.get('quizzes', [])
            subtopic_quizzes = [q for q in quizzes if q.get('subtopic_id') == subtopic_id]
            user_history = {
                "previous_attempts": len(subtopic_quizzes),
                "previous_scores": [float(q.get('score', 0)) for q in subtopic_quizzes],
                "last_activity": progress.get('last_activity_date'),
            }

    # 4. Find adjacent subtopics for navigation
    subtopics = course.get('subtopics', [])
    current_order = subtopic.get('order', 0)
    if isinstance(current_order, str):
        current_order = int(current_order)

    prev_subtopic = None
    next_subtopic = None
    for st in subtopics:
        order = st.get('order', 0)
        if isinstance(order, str):
            order = int(order)
        if order == current_order - 1:
            prev_subtopic = st.get('title')
        elif order == current_order + 1:
            next_subtopic = st.get('title')

    return json.dumps({
        "subtopic": {
            "id": subtopic_id,
            "title": subtopic.get('title', ''),
            "description": subtopic.get('description', ''),
            "difficulty": subtopic.get('difficulty', 'intermediate'),
            "order": current_order,
        },
        "course": {
            "id": course_id,
            "title": course.get('title', ''),
        },
        "kb_content": kb_content,
        "user_history": user_history,
        "navigation": {
            "previous_subtopic": prev_subtopic,
            "next_subtopic": next_subtopic,
        },
    }, default=str)
