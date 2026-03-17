"""Async-safe user context extracted from the Cognito JWT.

Usage in tools:
    from lib.user_context import current_user_id, get_user_id
    user_id = get_user_id()  # preferred — tries ContextVar then module-level fallback
"""

from contextvars import ContextVar

# The Cognito `sub` claim (UUID) of the authenticated user.
# Set in main.py /invocations handler before each agent run.
current_user_id: ContextVar[str] = ContextVar('current_user_id', default='')

# Module-level fallback for when ContextVar doesn't propagate across async boundaries.
# Set alongside the ContextVar in the /invocations handler.
_fallback_user_id: str = ''

# User's app mode ('training' or 'self-study'), looked up from DynamoDB per request.
_current_mode: str = 'training'


def set_user_id(user_id: str) -> None:
    """Set user_id in both ContextVar and module-level fallback."""
    global _fallback_user_id
    current_user_id.set(user_id)
    _fallback_user_id = user_id


def get_user_id() -> str:
    """Get user_id from ContextVar first, then module-level fallback.

    ContextVars may not propagate across all async tool call boundaries,
    so the module-level fallback ensures we always have the user_id that
    was set at request start.
    """
    uid = current_user_id.get()
    if uid:
        return uid
    return _fallback_user_id


def set_user_mode(mode: str) -> None:
    """Set the user's app mode for the current request."""
    global _current_mode
    _current_mode = mode


def get_user_mode() -> str:
    """Get the user's app mode for the current request."""
    return _current_mode


# Turn-level citation counter.
# Tracks how many KB sources have been numbered in the current agent turn so
# that multiple search_knowledge_base calls in the same turn produce globally
# unique source IDs (source_1..source_5, source_6..source_10, …).
# Reset at the start of every HTTP request in main.py.
_citation_counter: int = 0


def reset_citation_counter() -> None:
    """Reset the citation counter to 0 at the start of each agent turn."""
    global _citation_counter
    _citation_counter = 0


def next_citation_index() -> int:
    """Return the next citation index (1-based) and advance the counter."""
    global _citation_counter
    _citation_counter += 1
    return _citation_counter
