"""User progress and preferences tools for the learning platform.

Enables the agent to track learning progress per course, record quiz scores,
flashcard reviews, checklist completions, and manage user preferences.
All data persisted in DynamoDB via the dynamo_client module.
"""

import json
from datetime import date
from decimal import Decimal
from strands import tool

from lib import dynamo_client
from lib.user_context import get_user_id as _ctx_get_user_id


# --- Helpers ---

def _get_user_id() -> str | None:
    """Return user_id or None if not authenticated.

    Uses the resilient get_user_id() helper which tries the ContextVar first,
    then falls back to the module-level variable set during request processing.
    This ensures user_id is available even when ContextVar doesn't propagate
    across async tool call boundaries.
    """
    uid = _ctx_get_user_id()
    return uid if uid else None


def _decimal_default(obj):
    """JSON serializer for Decimal types from DynamoDB."""
    if isinstance(obj, Decimal):
        if obj % 1 == 0:
            return int(obj)
        return float(obj)
    raise TypeError(f"Object of type {type(obj)} is not JSON serializable")


def _to_json(data) -> str:
    return json.dumps(data, default=_decimal_default)


_AUTH_ERROR = json.dumps({"error": "User not authenticated. Please sign in to track progress."})


# --- @tool wrappers ---

@tool
def get_progress(course_id: str) -> str:
    """Get the current user's learning progress for a specific course.
    Args:
        course_id: The course identifier to get progress for
    """
    user_id = _get_user_id()
    if not user_id:
        return _AUTH_ERROR
    try:
        progress = dynamo_client.get_user_progress(user_id, course_id)
        if not progress:
            return _to_json({
                "course_id": course_id,
                "status": "not_started",
                "current_subtopic": None,
                "completion_percentage": 0,
                "quizzes": [],
                "flashcards_reviewed": 0,
                "checklist_completion": 0,
            })
        return _to_json(progress)
    except Exception as e:
        return _to_json({"error": str(e)})


@tool
def update_progress(course_id: str, subtopic_id: str, activity_type: str, score: float = 0.0, quiz_items: str = "") -> str:
    """Record a learning activity for the current user on a course.
    Args:
        course_id: The course identifier
        subtopic_id: The subtopic where the activity occurred
        activity_type: One of: quiz, flashcard, checklist, assessment
        score: Score or percentage (0.0-1.0 for quiz/assessment, percentage for checklist)
        quiz_items: Optional JSON array of per-question items for quiz tracking, e.g. [{"question_hash":"abc","correct":true,"concept":"event sources"}]
    """
    user_id = _get_user_id()
    if not user_id:
        return _AUTH_ERROR
    try:
        today = date.today().isoformat()

        # Fetch existing progress to merge updates
        existing = dynamo_client.get_user_progress(user_id, course_id) or {}

        updates = {
            "current_subtopic": subtopic_id,
            "last_activity_date": today,
            "last_activity_type": activity_type,
        }

        if activity_type == "quiz":
            quizzes = existing.get("quizzes", [])
            quiz_entry = {
                "subtopic_id": subtopic_id,
                "score": Decimal(str(score)),
                "date": today,
            }
            # Attach per-question items if provided
            if quiz_items:
                try:
                    items = json.loads(quiz_items) if isinstance(quiz_items, str) else quiz_items
                    quiz_entry["items"] = items
                except (json.JSONDecodeError, TypeError):
                    pass
            quizzes.append(quiz_entry)
            updates["quizzes"] = quizzes

        elif activity_type == "flashcard":
            reviewed = existing.get("flashcards_reviewed", 0)
            if isinstance(reviewed, Decimal):
                reviewed = int(reviewed)
            updates["flashcards_reviewed"] = reviewed + 1

        elif activity_type == "checklist":
            updates["checklist_completion"] = Decimal(str(score))

        elif activity_type == "assessment":
            assessments = existing.get("assessments", [])
            assessments.append({
                "subtopic_id": subtopic_id,
                "score": Decimal(str(score)),
                "date": today,
            })
            updates["assessments"] = assessments

        else:
            return _to_json({"error": f"Unknown activity_type: {activity_type}. Use quiz, flashcard, checklist, or assessment."})

        result = dynamo_client.update_user_progress(user_id, course_id, updates)
        return _to_json({"updated": True, "course_id": course_id, "activity_type": activity_type, "progress": result})
    except Exception as e:
        return _to_json({"error": str(e)})


@tool
def get_all_progress() -> str:
    """Get the current user's learning progress across all courses."""
    user_id = _get_user_id()
    if not user_id:
        return _AUTH_ERROR
    try:
        progress_list = dynamo_client.list_user_progress(user_id)
        return _to_json({"user_id": user_id, "courses": progress_list})
    except Exception as e:
        return _to_json({"error": str(e)})


@tool
def get_preferences() -> str:
    """Get the current user's learning preferences."""
    user_id = _get_user_id()
    if not user_id:
        return _AUTH_ERROR
    try:
        prefs = dynamo_client.get_user_preferences(user_id)
        if not prefs:
            return _to_json({
                "user_id": user_id,
                "preferred_content_type": "text",
                "difficulty_level": "intermediate",
                "quiz_style": "multiple_choice",
            })
        return _to_json(prefs)
    except Exception as e:
        return _to_json({"error": str(e)})


@tool
def update_preferences(preferred_content_type: str = "", difficulty_level: str = "", quiz_style: str = "") -> str:
    """Update the current user's learning preferences. Only non-empty fields are updated.
    Args:
        preferred_content_type: Preferred content format (e.g. text, video, interactive)
        difficulty_level: Preferred difficulty (e.g. beginner, intermediate, advanced)
        quiz_style: Preferred quiz format (e.g. multiple_choice, true_false, open_ended)
    """
    user_id = _get_user_id()
    if not user_id:
        return _AUTH_ERROR
    try:
        updates = {}
        if preferred_content_type:
            updates["preferred_content_type"] = preferred_content_type
        if difficulty_level:
            updates["difficulty_level"] = difficulty_level
        if quiz_style:
            updates["quiz_style"] = quiz_style

        if not updates:
            return _to_json({"error": "No preferences provided to update."})

        result = dynamo_client.update_user_preferences(user_id, updates)
        return _to_json({"updated": True, "preferences": result})
    except Exception as e:
        return _to_json({"error": str(e)})
