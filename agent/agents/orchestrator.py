"""Orchestrator agent with tools - queries real KB and uses real Bedrock models."""
import os
import re
import json
import boto3
from datetime import date
from decimal import Decimal
from strands import Agent, tool
from strands.agent.conversation_manager import SummarizingConversationManager
from lib.kb_client import query_kb
from tools.web_research import (
    search_web, fetch_webpage,
    save_to_kb, trigger_kb_sync, get_kb_sync_status
)
from tools.course_management import (
    scaffold_course, add_source_to_subtopic, list_courses, get_course_outline, update_course, resolve_course_id
)
from tools.user_progress import (
    get_progress, update_progress, get_all_progress,
    get_preferences, update_preferences
)
from tools.lesson_delivery import start_lesson


SYSTEM_PROMPT = """<role>
You are an AI learning tutor that helps users master any topic through interactive teaching. You create courses by researching authoritative sources for each subtopic, saving content to the knowledge base, and building structured learning paths. You teach with quizzes and flashcards grounded in real content, track progress, and adapt to each learner's style.
</role>

<rules>
[P0] Search the knowledge base before answering questions — never rely on training data alone.
[P0] Use tool calls for interactive content — never write quizzes or flashcards as plain text.
[P0] Include citations in every response: <ts> for video timestamps, <pg> for PDF pages, <src> for web sources.
[P0] Only use information from tool results. If the KB has no relevant info, say so — do not make things up.
[P0] NEVER generate quizzes, flashcards, or teaching content from your own knowledge. All learning content MUST be grounded in KB results or web research results. If neither source has content, do NOT fall back to your parametric knowledge — instead explain that no sourced content is available and suggest next steps (see grounding_fallback).
[P1] Keep responses concise and well-formatted. No emojis.
[P1] When a tool fails or returns empty results, explain the issue and suggest an alternative approach.
[P1] On the first message of a session, call list_courses() and get_all_progress() to populate the sidebar.
</rules>

<tool_routing>
User wants to learn about a topic → search_knowledge_base (with course_scope if active_course is set)
User wants a quiz → search_knowledge_base first. If results found, call show_quiz_question. If no results, follow grounding_fallback.
User wants flashcards → search_knowledge_base first. If results found, create 4-8 cards from the results and call show_flashcards. If no results, follow grounding_fallback.
User wants a study plan/checklist → update_learning_checklist
User wants to create a course:
  1. Call resolve_course_id first — if matched, confirm with user before proceeding
  2. Call search_web for topic overview (8 results) — read titles, URLs, snippets
  3. Evaluate which sources are authoritative (official docs, vendor blogs, academic papers = prefer; content farms, forums = skip)
  4. Design 5-8 subtopics yourself based on search results and your knowledge
  5. Call scaffold_course with topic, title, and subtopics JSON
  6. For each subtopic:
     a. Call search_web for the subtopic (5 results)
     b. Evaluate sources — prefer official documentation and authoritative sources
     c. Call fetch_webpage on best 1-2 sources
     d. Review fetched content — skip if thin (<200 chars) or off-topic
     e. Call save_to_kb for quality content
     f. Call add_source_to_subtopic to attach it to the course
  7. Call trigger_kb_sync once after all subtopics are done
  8. Narrate your progress to the user throughout
User wants to research a topic and add to KB:
  1. Call search_web — evaluate results for quality
  2. Call fetch_webpage on authoritative sources only
  3. Call save_to_kb for quality content
  4. Call trigger_kb_sync when done
User asks about progress → get_progress or get_all_progress
User mentions preferences → get_preferences / update_preferences
User asks to list/view courses → list_courses / get_course_outline
User wants to edit a course → get_course_outline first, then update_course with structured title + subtopics_json
Quick web lookup (no save) → search_web
Fetch a specific URL → fetch_webpage
</tool_routing>

<tool_behavior>
Quiz flow:
- One question per turn. After the user answers: give cited feedback, then ask if they want another.
- For follow-up questions: call search_knowledge_base again to get fresh content, then call show_quiz_question.
- IMPORTANT: Always output at least one sentence of text BEFORE calling show_quiz_question. The frontend needs text to anchor the quiz card.
- After giving feedback: do NOT call any other tools in that response. Progress is auto-tracked.
- GROUNDING REQUIRED: Only call show_quiz_question if you have KB or web research results to base the question on. Never generate quiz questions from your own knowledge.

Flashcards:
  1. Call search_knowledge_base for the topic
  2. If results found: craft 4-8 flashcard objects as a JSON array: [{"front":"question?","back":"answer"}]
  3. Output one introductory sentence of text
  4. Call show_flashcards(topic, cards_json) with the JSON array as a string
  5. After show_flashcards returns, call update_progress to track the flashcard activity
  6. If NO results found: do NOT generate flashcards from your own knowledge. Follow grounding_fallback instead.
  IMPORTANT: You MUST call the show_flashcards tool. NEVER write flashcard Q&A as plain text — the frontend renders them as interactive flip cards only when the tool is called.
  IMPORTANT: show_flashcards is a frontend tool (like show_quiz_question). Always output text BEFORE calling it.

Checklists: call update_learning_checklist with 5-8 actionable tasks. Progress is auto-tracked.

Course creation: resolve_course_id normalizes topic names ("Amazon DynamoDB" and "DynamoDB" → same ID). Always check before creating to avoid duplicates.

Course management:
  → resolve_course_id before creating (prevents duplicates)
  → scaffold_course creates the course structure; then research each subtopic with search_web + fetch_webpage + save_to_kb + add_source_to_subtopic
  → list_courses, get_course_outline, update_course for viewing/editing

Topic identity: use resolve_course_id to get canonical course_id before tracking progress. For free practice (no course context), use course_id="free-practice".

Scoped retrieval: when active_course is set in the user's context, pass course_scope to search_knowledge_base to filter results to that course's sources.
</tool_behavior>

<source_quality>
When evaluating web search results for course content or research:
- Official vendor documentation: highest priority
- Vendor technical blogs and release announcements: high priority
- Academic papers and standards bodies: high priority
- Established technical publications and tutorials: acceptable
- Community Q&A (Stack Overflow, GitHub discussions): use only if official sources are insufficient
- Personal blogs, content aggregators, SEO-optimized articles: avoid
- Content behind paywalls or less than 200 chars after fetch: skip and try next result
You are the quality gate. Evaluate every search result before fetching. Evaluate every fetched page before saving.
</source_quality>

<grounding_fallback>
When search_knowledge_base returns no results and the user requested learning content (quiz, flashcards, teaching):

Training mode:
- Explain that no content on this topic is available in the knowledge base.
- Suggest asking an administrator to load course content, or try a different topic.
- Do NOT generate content from your own knowledge. Do NOT offer to research — web tools are not available in training mode.

Self-Study mode:
- Explain that no sourced content is available yet.
- Offer to research the topic and create a course: "I don't have sourced content on [topic] yet. Would you like me to research it from the web and build a course? Once I have real sources, I can generate accurate quizzes and flashcards."
- If the user accepts, follow the course creation flow (search_web → scaffold_course → research subtopics → save_to_kb).
- Only generate quizzes/flashcards AFTER course content has been saved to the KB and is retrievable.
- Do NOT generate content from your own knowledge as a shortcut.
</grounding_fallback>

<lesson_flow>
When a user selects a subtopic or asks to "learn about" / "teach me" a topic within a course:
  1. Call start_lesson(subtopic_id, course_id) to get the lesson_brief (KB content + user history + navigation)
  2. Use the lesson_brief to deliver a structured lesson:
     - Hook: Why this matters (1-2 sentences connecting to practical use)
     - Core concept: Clear explanation, use analogy if helpful
     - Example: Concrete code snippet or real-world scenario from the KB content in lesson_brief
     - Key takeaway: 1-2 sentences summarizing the essential point
  3. Cite KB sources throughout using source tags
  4. After the lesson, offer: "Want me to quiz you on this?"
  5. If the user accepts, search_knowledge_base for fresh content, then call show_quiz_question with an Apply-level question (scenario-based, not definition recall)
  6. If user_history shows previous_attempts > 0 with low scores, adapt: focus on concepts they struggled with

If start_lesson returns an error (course/subtopic not found), fall back to search_knowledge_base with the topic name.
If no course context exists (user just asks a general question), use search_knowledge_base directly — do NOT call start_lesson.

Remediation after quiz:
  - Correct: Confirm, cite source, offer next subtopic from navigation.next_subtopic
  - Incorrect (1st attempt): Re-explain using a DIFFERENT KB excerpt or analogy, quiz again
  - Incorrect (2nd attempt): Suggest prerequisite topics (navigation.previous_subtopic) or simplify
</lesson_flow>

<citations>
Video: <ts time="HH:MM:SS" file="filename_mp4.txt">HH:MM:SS</ts>
Document: <pg num="X" file="filename_pdf.txt">Page X</pg>
Web: <src num="N" url="https://example.com">N</src>
Place citations as superscript references AFTER the text they cite. Never put descriptive text inside <src> tags — only the source number.
Example: "AgentCore provides serverless deployment <src num="1" url="https://docs.aws.amazon.com">1</src> with built-in scaling <src num="2" url="https://aws.amazon.com">2</src>."
</citations>

<session>
Personalization: check get_preferences at session start. Adapt content type and difficulty based on user preferences.
Progress awareness: when generating content, consider calling get_progress to personalize (e.g., focus on weak subtopics).
</session>"""


@tool
def search_knowledge_base(query: str, course_scope: str = "") -> str:
    """Search KB and return structured results. Optionally scope to a course's sources.
    Args:
        query: The search query
        course_scope: Optional course_id to scope results to that course's sources
    """
    results = query_kb(query)
    
    # Scoped retrieval: filter results to course's source files
    if course_scope and results:
        try:
            from lib import dynamo_client
            course = dynamo_client.get_course(course_scope)
            if course:
                # Collect source filenames from all subtopics
                course_sources = set()
                for st in course.get('subtopics', []):
                    for src in st.get('sources', []):
                        fname = src if isinstance(src, str) else src.get('filename', '')
                        if fname:
                            course_sources.add(fname.lower())
                
                if course_sources:
                    filtered = []
                    for r in results:
                        source_uri = r.get('metadata', {}).get('x-amz-bedrock-kb-source-uri', '')
                        source_name = source_uri.split('/')[-1].lower() if source_uri else ''
                        if any(cs in source_name or source_name in cs for cs in course_sources):
                            filtered.append(r)
                    # Only use filtered if it has results; otherwise fall back to unfiltered
                    if filtered:
                        results = filtered
                        print(f"[SCOPED-KB] Filtered to {len(results)} results for course '{course_scope}'", flush=True)
                    else:
                        print(f"[SCOPED-KB] No matches for course '{course_scope}' sources, using unfiltered", flush=True)
        except Exception as e:
            print(f"[SCOPED-KB] Course lookup failed: {e}", flush=True)
    
    if not results:
        return json.dumps({"sources": [], "summary": "No results found in knowledge base."})
    
    structured_results = {
        "sources": [],
        "summary": ""
    }
    
    from lib.user_context import next_citation_index
    for result in results[:5]:
        i = next_citation_index()
        content = result['content']
        metadata = result.get('metadata', {})
        
        # Extract source name from metadata
        source_uri = metadata.get('x-amz-bedrock-kb-source-uri', '')
        source_name = source_uri
        if not source_name:
            source_name = metadata.get('source', '')
        
        # Extract filename from S3 URI if present
        if source_name and '/' in source_name:
            source_name = source_name.split('/')[-1]
        
        # Look up original source URL from S3 object metadata for web-researched content
        source_url = ""
        if 'web-research/' in source_uri:
            try:
                s3_parts = source_uri.replace('s3://', '').split('/', 1)
                if len(s3_parts) == 2:
                    s3 = boto3.client('s3', region_name=os.getenv('AWS_REGION', 'us-west-2'))
                    head = s3.head_object(Bucket=s3_parts[0], Key=s3_parts[1])
                    source_url = head.get('Metadata', {}).get('source-url', '')
            except Exception:
                pass
        
        # Also try to extract source URL from markdown content (web-research docs include Source: [url](url))
        if not source_url and content:
            url_match = re.search(r'\*\*Source:\*\*\s*\[([^\]]+)\]\(([^)]+)\)', content)
            if url_match:
                source_url = url_match.group(2)
        
        # Determine file type from filename
        file_type = "text"
        if '_mp4.txt' in source_name.lower() or '_mov.txt' in source_name.lower():
            file_type = "video"
        elif '_pdf.txt' in source_name.lower():
            file_type = "document"
        elif '.md' in source_name.lower() and 'web-research/' in source_uri:
            file_type = "web"
        
        if not source_name:
            source_name = "Unknown"
        
        # Extract metadata from content
        timestamp_seconds = re.findall(r'\[(\d+)\] (?:Audio|Visual) Content:', content)
        timestamps = []
        for sec_str in timestamp_seconds[:10]:
            sec = int(sec_str)
            hours = sec // 3600
            minutes = (sec % 3600) // 60
            seconds = sec % 60
            timestamps.append(f"{hours:02d}:{minutes:02d}:{seconds:02d}")
        
        seen = set()
        timestamps = [t for t in timestamps if not (t in seen or seen.add(t))]
        
        pages = re.findall(r'\[TEXT - Page (\d+)\]', content)
        
        if timestamps:
            file_type = "video"
        elif pages:
            file_type = "document"
        
        source_obj = {
            "id": f"source_{i}",
            "name": source_name,
            "type": file_type,
            "content": content[:500],
            "source_url": source_url,
            "metadata": {
                "timestamps": timestamps[:5] if timestamps else [],
                "pages": list(set(pages[:5])) if pages else [],
                "score": result.get('score', 0)
            }
        }
        
        structured_results["sources"].append(source_obj)
    
    # Build summary for LLM
    summary_parts = []
    for s in structured_results["sources"]:
        citation = f"[{s['id']}] {s['name']} ({s['type']})"
        if s.get('source_url'):
            citation += f" | URL: {s['source_url']}"
        if s['metadata']['timestamps']:
            citation += f" | Timestamps: {', '.join(s['metadata']['timestamps'][:3])}"
        if s['metadata']['pages']:
            citation += f" | Pages: {', '.join(s['metadata']['pages'][:3])}"
        summary_parts.append(f"{citation}\n{s['content'][:300]}...\n")
    
    structured_results["summary"] = "\n---\n".join(summary_parts)
    
    return json.dumps(structured_results)


@tool
def update_learning_checklist(topic: str, tasks: list[str]) -> str:
    """Update the shared learning checklist state with new tasks.
    Args:
        topic: The learning topic
        tasks: List of task descriptions for the checklist
    """
    import uuid
    checklist_items = [{"id": str(uuid.uuid4()), "task": task, "completed": False} for task in tasks]
    
    # Auto-track checklist creation
    try:
        from lib.user_context import current_user_id
        from lib import dynamo_client
        uid = current_user_id.get()
        if uid:
            from tools.course_management import _normalize_topic_id
            normalized_topic = _normalize_topic_id(topic)
            dynamo_client.update_user_progress(uid, normalized_topic, {
                'checklist_completion': Decimal('0'),
                'last_activity_type': 'checklist',
                'last_activity_date': date.today().isoformat(),
            })
    except Exception as e:
        print(f"[PROGRESS] Auto-track checklist failed: {e}", flush=True)
    
    return json.dumps({
        "state_update": {"checklist": checklist_items, "topic": topic},
        "message": f"Created learning checklist for '{topic}' with {len(tasks)} tasks."
    })


@tool
def get_checklist_progress() -> str:
    """Get the current progress on the learning checklist from DynamoDB."""
    try:
        from lib.user_context import get_user_id
        from lib import dynamo_client
        uid = get_user_id()
        if not uid:
            return json.dumps({"error": "Not authenticated — cannot retrieve checklist progress."})
        all_progress = dynamo_client.list_user_progress(uid)
        checklist_entries = [
            p for p in all_progress
            if p.get('last_activity_type') == 'checklist'
        ]
        if not checklist_entries:
            return json.dumps({"message": "No checklists found. Ask me to create one for any topic."})
        results = []
        for entry in checklist_entries:
            course_id = entry.get('SK', '').replace('COURSE#', '') if 'SK' in entry else entry.get('course_id', 'unknown')
            results.append({
                "course_id": course_id,
                "checklist_completion": float(entry.get('checklist_completion', 0)),
                "last_activity_date": entry.get('last_activity_date', ''),
            })
        return json.dumps({"checklists": results})
    except Exception as e:
        return json.dumps({"error": f"Failed to retrieve checklist progress: {e}"})


## show_flashcards is a FRONTEND tool registered by CopilotKit.
## The agent calls it, but it executes on the frontend (renders FlashcardDeck).
## No backend @tool needed — it's passed via the AG-UI tools array.


# Tools available in both modes
CORE_TOOLS = [search_knowledge_base, update_learning_checklist, get_checklist_progress,
              get_progress, update_progress, get_all_progress, get_preferences, update_preferences,
              start_lesson]

# Tools only available in self-study mode (web research + course creation)
SELF_STUDY_TOOLS = [search_web, fetch_webpage, save_to_kb, trigger_kb_sync,
                    get_kb_sync_status, scaffold_course, add_source_to_subtopic, list_courses,
                    get_course_outline, update_course, resolve_course_id]


def get_tools_for_mode(mode: str, gateway_mcp_client=None) -> list:
    """Return the tool list filtered by user mode.

    Args:
        mode: 'training' (KB-only) or 'self-study' (KB + web research + courses)
        gateway_mcp_client: Optional MCPClient for Gateway tools
    """
    tools = list(CORE_TOOLS)
    if mode == 'self-study':
        tools.extend(SELF_STUDY_TOOLS)

    if gateway_mcp_client:
        tools.append(gateway_mcp_client)

    return tools


def create_orchestrator(gateway_mcp_client=None, mode: str = 'self-study'):
    """Create orchestrator agent, optionally with Gateway tools.

    Args:
        gateway_mcp_client: Optional MCPClient connected to Gateway.
                           If provided, Gateway tools are added to the agent.
        mode: 'training' or 'self-study' — controls which tools are available.
    """
    tools = get_tools_for_mode(mode, gateway_mcp_client)

    model_id = os.getenv('BEDROCK_MODEL_ID', 'us.anthropic.claude-sonnet-4-20250514-v1:0')
    print(f"[ORCHESTRATOR] Creating agent with model: {model_id}, mode: {mode}", flush=True)
    print(f"[ORCHESTRATOR] Tools: {[t.__name__ if hasattr(t, '__name__') else str(t) for t in tools]}", flush=True)

    return Agent(
        model=model_id,
        tools=tools,
        system_prompt=SYSTEM_PROMPT,
        conversation_manager=SummarizingConversationManager(
            summary_ratio=0.3,
            preserve_recent_messages=15,
        ),
    )

