"""DynamoDB client - single-table design for the learning platform."""
import os
import logging
from datetime import date
from decimal import Decimal

import boto3
from botocore.exceptions import ClientError

logger = logging.getLogger(__name__)

_table = None


def _get_table():
    """Lazy-init the DynamoDB Table resource."""
    global _table
    if _table is None:
        table_name = os.getenv('DYNAMODB_TABLE')
        region = os.getenv('AWS_REGION', 'us-west-2')
        dynamodb = boto3.resource('dynamodb', region_name=region)
        _table = dynamodb.Table(table_name)
    return _table


def _safe_get(key: dict) -> dict | None:
    """Get item, return None if table missing or item not found."""
    try:
        resp = _get_table().get_item(Key=key)
        return resp.get('Item')
    except ClientError as e:
        code = e.response['Error']['Code']
        if code == 'ResourceNotFoundException':
            logger.warning("DynamoDB table not found")
            return None
        raise


def _safe_scan(filter_expr: str, expr_values: dict) -> list[dict]:
    """Scan with filter and pagination, return empty list if table missing."""
    try:
        items = []
        table = _get_table()
        resp = table.scan(
            FilterExpression=filter_expr,
            ExpressionAttributeValues=expr_values,
        )
        items.extend(resp.get('Items', []))
        while resp.get('LastEvaluatedKey'):
            resp = table.scan(
                FilterExpression=filter_expr,
                ExpressionAttributeValues=expr_values,
                ExclusiveStartKey=resp['LastEvaluatedKey'],
            )
            items.extend(resp.get('Items', []))
        return items
    except ClientError as e:
        if e.response['Error']['Code'] == 'ResourceNotFoundException':
            logger.warning("DynamoDB table not found")
            return []
        raise


# ---------------------------------------------------------------------------
# Course operations
# ---------------------------------------------------------------------------

def put_course(course_id: str, title: str, subtopics: list,
               course_type: str = "web-researched", **kwargs) -> dict:
    """Create or overwrite a course item."""
    today = date.today().isoformat()
    item = {
        'PK': f'COURSE#{course_id}',
        'title': title,
        'type': course_type,
        'created': today,
        'last_updated': today,
        'subtopics': subtopics,
        **kwargs,
    }
    _get_table().put_item(Item=item)
    return item


def get_course(course_id: str) -> dict | None:
    """Fetch a single course by id."""
    return _safe_get({'PK': f'COURSE#{course_id}'})


def list_courses() -> list[dict]:
    """Scan for all COURSE# items."""
    return _safe_scan('begins_with(PK, :prefix)', {':prefix': 'COURSE#'})


def add_course_source(course_id: str, subtopic_id: str, source_filename: str, source_url: str = "") -> dict:
    """Append a source to a specific subtopic's sources list.

    Uses a read-modify-write pattern: fetches the course, locates the subtopic
    by id, appends the source entry, and writes the updated subtopics list back.

    Args:
        course_id: The course identifier (slug).
        subtopic_id: The subtopic id to attach the source to.
        source_filename: The S3 filename (key basename) of the saved source.
        source_url: Optional original URL for attribution.

    Returns:
        The updated subtopic dict, or an error dict if not found.
    """
    item = get_course(course_id)
    if not item:
        return {"error": f"Course '{course_id}' not found"}

    subtopics = item.get('subtopics', [])
    target = None
    for st in subtopics:
        if st.get('id') == subtopic_id:
            target = st
            break

    if target is None:
        return {"error": f"Subtopic '{subtopic_id}' not found in course '{course_id}'"}

    source_entry: dict = {"filename": source_filename}
    if source_url:
        source_entry["url"] = source_url

    if 'sources' not in target or not isinstance(target['sources'], list):
        target['sources'] = []
    target['sources'].append(source_entry)

    updated = update_course(course_id, {'subtopics': subtopics})
    # Return just the updated subtopic for the tool response
    for st in updated.get('subtopics', []):
        if st.get('id') == subtopic_id:
            return st
    return target


def update_course(course_id: str, updates: dict) -> dict:
    """Partial update on a course item. Returns updated attributes."""
    updates['last_updated'] = date.today().isoformat()
    expr_parts, attr_names, attr_values = [], {}, {}
    for i, (k, v) in enumerate(updates.items()):
        alias = f'#k{i}'
        placeholder = f':v{i}'
        expr_parts.append(f'{alias} = {placeholder}')
        attr_names[alias] = k
        attr_values[placeholder] = v

    resp = _get_table().update_item(
        Key={'PK': f'COURSE#{course_id}'},
        UpdateExpression='SET ' + ', '.join(expr_parts),
        ExpressionAttributeNames=attr_names,
        ExpressionAttributeValues=attr_values,
        ReturnValues='ALL_NEW',
    )
    return resp['Attributes']


# ---------------------------------------------------------------------------
# Progress operations
# ---------------------------------------------------------------------------

def _progress_pk(user_id: str, course_id: str) -> str:
    return f'PROGRESS#{user_id}#COURSE#{course_id}'


def get_user_progress(user_id: str, course_id: str) -> dict | None:
    """Fetch progress for a user on a specific course."""
    return _safe_get({'PK': _progress_pk(user_id, course_id)})


def update_user_progress(user_id: str, course_id: str, updates: dict) -> dict:
    """Upsert progress record. Creates if missing, merges if exists."""
    pk = _progress_pk(user_id, course_id)
    # Always ensure identity fields are present
    updates.setdefault('user_id', user_id)
    updates.setdefault('course_id', course_id)
    updates.setdefault('started', date.today().isoformat())

    expr_parts, attr_names, attr_values = [], {}, {}
    for i, (k, v) in enumerate(updates.items()):
        alias = f'#k{i}'
        placeholder = f':v{i}'
        expr_parts.append(f'{alias} = {placeholder}')
        attr_names[alias] = k
        # Convert floats to Decimal for DynamoDB
        if isinstance(v, float):
            v = Decimal(str(v))
        attr_values[placeholder] = v

    resp = _get_table().update_item(
        Key={'PK': pk},
        UpdateExpression='SET ' + ', '.join(expr_parts),
        ExpressionAttributeNames=attr_names,
        ExpressionAttributeValues=attr_values,
        ReturnValues='ALL_NEW',
    )
    return resp['Attributes']


def list_user_progress(user_id: str) -> list[dict]:
    """List all progress records for a user across courses."""
    return _safe_scan(
        'begins_with(PK, :prefix)',
        {':prefix': f'PROGRESS#{user_id}#COURSE#'},
    )


# ---------------------------------------------------------------------------
# Preferences operations
# ---------------------------------------------------------------------------

def get_user_mode(user_id: str) -> str:
    """Get the user's app mode ('training' or 'self-study'). Defaults to 'training'."""
    prefs = _safe_get({'PK': f'PREFERENCES#{user_id}'})
    if prefs:
        return prefs.get('mode', 'training')
    return 'training'


def set_user_mode(user_id: str, mode: str) -> dict:
    """Set the user's app mode. Returns updated preferences."""
    if mode not in ('training', 'self-study'):
        raise ValueError(f"Invalid mode: {mode}. Must be 'training' or 'self-study'.")
    return update_user_preferences(user_id, {'mode': mode})


def get_user_preferences(user_id: str) -> dict | None:
    """Fetch preferences for a user."""
    return _safe_get({'PK': f'PREFERENCES#{user_id}'})


def update_user_preferences(user_id: str, preferences: dict) -> dict:
    """Upsert user preferences."""
    expr_parts, attr_names, attr_values = [], {}, {}
    for i, (k, v) in enumerate(preferences.items()):
        alias = f'#k{i}'
        placeholder = f':v{i}'
        expr_parts.append(f'{alias} = {placeholder}')
        attr_names[alias] = k
        attr_values[placeholder] = v

    resp = _get_table().update_item(
        Key={'PK': f'PREFERENCES#{user_id}'},
        UpdateExpression='SET ' + ', '.join(expr_parts),
        ExpressionAttributeNames=attr_names,
        ExpressionAttributeValues=attr_values,
        ReturnValues='ALL_NEW',
    )
    return resp['Attributes']
