"""Multimodal RAG Agent — supports text (AG-UI) and voice (BidiAgent) modes.

Mode is determined by AGENT_MODE env var:
- "text" (default): AG-UI HTTP agent via create_strands_app (for text runtime with JWT auth)
- "voice": BedrockAgentCoreApp with @app.websocket for BidiAgent (for voice runtime with SigV4 auth)

Both modes share the same orchestrator, tools, and Gateway MCP client.
"""

import os
import sys
import json
import base64
import boto3
from pathlib import Path
from dotenv import load_dotenv

env_path = Path(__file__).parent / '.env'
load_dotenv(env_path)
sys.path.insert(0, os.path.dirname(__file__))

# Mock pyaudio for server environments where it's not installed.
# BidiAgent imports it at module level for BidiAudioIO, but we only use
# WebSocket I/O on the server — pyaudio (local mic/speaker) is not needed.
if 'pyaudio' not in sys.modules:
    import types
    _mock = types.ModuleType('pyaudio')
    _mock.PyAudio = type('PyAudio', (), {})
    _mock.Stream = type('Stream', (), {})
    _mock.paInt16 = 8  # pyaudio constant
    _mock.paContinue = 0
    sys.modules['pyaudio'] = _mock

AGENT_MODE = os.getenv('AGENT_MODE', 'text')  # "text" or "voice"


def get_ssm_param(name: str) -> str:
    try:
        ssm = boto3.client('ssm', region_name=os.getenv('AWS_REGION', 'us-west-2'))
        return ssm.get_parameter(Name=name, WithDecryption=True)['Parameter']['Value']
    except Exception as e:
        print(f"[WARN] Could not get SSM param {name}: {e}")
        return None


def create_gateway_mcp_client():
    env = os.getenv('ENV', 'dev')
    region = os.getenv('AWS_REGION', 'us-west-2')
    gateway_endpoint = get_ssm_param(f"/multimedia-rag/{env}/gateway-endpoint")
    if not gateway_endpoint:
        print("[WARN] Gateway endpoint not found in SSM - running without Gateway tools")
        return None
    print(f"[INFO] Gateway endpoint: {gateway_endpoint}")
    try:
        from strands.tools.mcp import MCPClient
        from mcp_proxy_for_aws.client import aws_iam_streamablehttp_client
        def create_transport():
            return aws_iam_streamablehttp_client(
                endpoint=gateway_endpoint, aws_region=region, aws_service="bedrock-agentcore")
        return MCPClient(create_transport, prefix="gateway")
    except Exception as e:
        print(f"[WARN] Gateway MCPClient failed: {e}")
        return None


# ---------------------------------------------------------------------------
# Shared: orchestrator + session config
# ---------------------------------------------------------------------------
from agents.orchestrator import create_orchestrator, get_tools_for_mode

gateway_client = create_gateway_mcp_client()
orchestrator = create_orchestrator(gateway_mcp_client=gateway_client)

S3_SESSION_BUCKET = os.getenv('S3_SESSION_BUCKET', '')
if not S3_SESSION_BUCKET:
    S3_SESSION_BUCKET = get_ssm_param(f"/multimedia-rag/{os.getenv('ENV', 'dev')}/session-bucket") or ''
print(f"[INFO] S3 session bucket: {S3_SESSION_BUCKET or 'NONE'}", flush=True)
print(f"[INFO] Agent mode: {AGENT_MODE}", flush=True)


# ===========================================================================
# TEXT MODE — AG-UI HTTP agent (existing working approach)
# ===========================================================================
if AGENT_MODE == 'text':
    from lib.ag_ui_strands_patched import StrandsAgent, create_strands_app
    from lib.ag_ui_strands_patched.config import StrandsAgentConfig, ToolBehavior, ToolResultContext
    from lib.user_context import set_user_id, get_user_id, set_user_mode, get_user_mode, reset_citation_counter

    def _extract_user_id_from_jwt(auth_header: str) -> str:
        """Decode the Cognito access token and return the `sub` claim."""
        try:
            token = auth_header.split(" ", 1)[1]
            payload = token.split(".")[1]
            payload += "=" * (4 - len(payload) % 4)
            claims = json.loads(base64.urlsafe_b64decode(payload))
            return claims.get("sub", "")
        except Exception as e:
            print(f"[WARN] JWT decode failed: {e}", flush=True)
            return ""

    def _resolve_user_mode(user_id: str, input_data=None) -> str:
        """Resolve user mode: if AG-UI state has requested_mode, persist it and use it.
        Otherwise read from DynamoDB. Defaults to 'training'."""
        from lib import dynamo_client
        # Check if the frontend sent a mode change via shared state
        state = getattr(input_data, 'state', None) or {}
        requested = state.get('requested_mode', '')
        if requested in ('training', 'self-study') and user_id:
            try:
                current = dynamo_client.get_user_mode(user_id)
                if current != requested:
                    dynamo_client.set_user_mode(user_id, requested)
                    print(f"[MODE] Updated {user_id}: {current} → {requested}", flush=True)
                return requested
            except Exception as e:
                print(f"[MODE] set failed: {e}", flush=True)
                return requested
        # No requested_mode in state — read from DynamoDB
        if user_id:
            try:
                return dynamo_client.get_user_mode(user_id)
            except Exception as e:
                print(f"[MODE] lookup failed: {e}", flush=True)
        return 'training'

    def create_session_manager(input_data):
        if not S3_SESSION_BUCKET:
            return None
        try:
            from strands.session.s3_session_manager import S3SessionManager
            return S3SessionManager(
                session_id=input_data.thread_id or "default", bucket=S3_SESSION_BUCKET,
                prefix="agent-sessions/", region_name=os.getenv('AWS_REGION', 'us-west-2'))
        except Exception as e:
            print(f"[WARN] S3SessionManager failed: {e}", flush=True)
            return None

    def build_state_context(input_data, user_message: str) -> str:
        state = getattr(input_data, 'state', None) or {}

        # SECURITY: user_id is ONLY derived from the JWT (set in /invocations handler).
        # Never read user_id from client-controlled AG-UI state.
        user_id = get_user_id()

        # Mode context — tells the model what tools are available (UX hint only,
        # actual enforcement is server-side tool filtering via tools_provider).
        # Read from AG-UI state first, then module-level fallback.
        requested = state.get('requested_mode', '')
        mode = requested if requested in ('training', 'self-study') else get_user_mode()
        mode_ctx = ""
        if mode == 'training':
            mode_ctx = ("\n\nMODE: training\n"
                        "You are in company training mode. You only have access to the knowledge base, "
                        "quizzes, flashcards, checklists, and progress tracking. "
                        "Do NOT attempt to use web search, course creation, or web research tools — they are not available. "
                        "If the user asks to create a course or search the web, explain that these features "
                        "are available in Self-Study mode and offer to help using the knowledge base instead.")
        elif mode == 'self-study':
            mode_ctx = ("\n\nMODE: self-study\n"
                        "You are in self-study mode. You have full access to ALL tools including "
                        "web search, course creation, web research, and knowledge base. "
                        "Use these tools freely when the user asks. "
                        "Ignore any earlier messages that may have said you were in training mode — "
                        "the mode has been switched.")

        checklist = state.get('checklist', [])
        topic = state.get('topic', '')
        keywords = ['progress', 'checklist', 'how am i doing', 'completed', 'remaining', 'status']
        msg_lower = user_message.lower() if isinstance(user_message, str) else ''
        if checklist and any(kw in msg_lower for kw in keywords):
            completed = [i for i in checklist if i.get('completed')]
            remaining = [i for i in checklist if not i.get('completed')]
            return (f"\nCURRENT_CHECKLIST_STATE:\nTopic: {topic}\n"
                    f"Completed ({len(completed)}/{len(checklist)}):\n"
                    + '\n'.join(f'  ✓ {i["task"]}' for i in completed)
                    + f"\nRemaining:\n"
                    + '\n'.join(f'  ○ {i["task"]}' for i in remaining)
                    + mode_ctx
                    + f"\n\nUser message: {user_message}")

        # Inject active course context for scoped KB retrieval
        active_course = state.get('active_course', '')
        active_subtopic = state.get('active_subtopic', '')
        if active_course:
            scope_ctx = f"\n\nACTIVE_COURSE_CONTEXT:\nactive_course: {active_course}"
            if active_subtopic:
                scope_ctx += f"\nactive_subtopic: {active_subtopic}"
            scope_ctx += "\nUse course_scope parameter when calling search_knowledge_base to scope results to this course's sources."
            return user_message + scope_ctx + mode_ctx

        return user_message + mode_ctx

    def checklist_state_from_result(ctx: ToolResultContext) -> dict:
        try:
            result = ctx.result_data
            if isinstance(result, str):
                result = json.loads(result)
            if isinstance(result, dict) and "state_update" in result:
                state_update = result["state_update"]
                # Preserve navigation state from client
                state = getattr(ctx.input_data, 'state', None) or {}
                ac = state.get('active_course', '')
                if ac:
                    state_update['active_course'] = ac
                asub = state.get('active_subtopic', '')
                if asub:
                    state_update['active_subtopic'] = asub
                return state_update
        except (json.JSONDecodeError, TypeError, KeyError):
            pass
        return None

    def progress_state_from_result(ctx: ToolResultContext) -> dict:
        """After recording an activity, push updated progress summary to sidebar."""
        try:
            from lib import dynamo_client
            uid = get_user_id()
            if not uid:
                return None
            all_progress = dynamo_client.list_user_progress(uid)
            courses = []
            total_quizzes = 0
            total_correct = 0
            for p in all_progress:
                pk = p.get('PK', '')
                cid = pk.split('#COURSE#')[-1] if '#COURSE#' in pk else ''
                quizzes = p.get('quizzes', [])
                q_count = len(quizzes)
                q_correct = sum(1 for q in quizzes if float(q.get('score', 0)) >= 0.5)
                total_quizzes += q_count
                total_correct += q_correct
                courses.append({
                    'course_id': cid,
                    'quiz_count': q_count,
                    'flashcards_reviewed': int(p.get('flashcards_reviewed', 0)),
                    'last_activity': p.get('last_activity_date', ''),
                })
            accuracy = round((total_correct / total_quizzes * 100)) if total_quizzes > 0 else 0
            result = {
                'progress_summary': {
                    'courses': courses,
                    'total_quizzes': total_quizzes,
                    'accuracy': accuracy,
                }
            }
            # Preserve navigation state from client
            state = getattr(ctx.input_data, 'state', None) or {}
            ac = state.get('active_course', '')
            if ac:
                result['active_course'] = ac
            asub = state.get('active_subtopic', '')
            if asub:
                result['active_subtopic'] = asub
            return result
        except Exception as e:
            print(f"[PROGRESS] state_from_result failed: {e}", flush=True)
            return None

    def all_progress_state_from_result(ctx: ToolResultContext) -> dict:
        """When get_all_progress returns, push the data to sidebar state."""
        return progress_state_from_result(ctx)

    def courses_state_from_result(ctx: ToolResultContext) -> dict:
        """When list_courses or create_course returns, push courses_summary to sidebar."""
        try:
            from lib import dynamo_client
            courses = dynamo_client.list_courses()
            summary = []
            for c in courses:
                pk = c.get('PK', '')
                cid = pk.replace('COURSE#', '') if pk.startswith('COURSE#') else pk
                summary.append({
                    'id': cid,
                    'title': c.get('title', ''),
                    'subtopics': [{'id': s.get('id',''), 'title': s.get('title',''), 'order': s.get('order',0)} for s in c.get('subtopics', [])],
                    'type': c.get('type', ''),
                })
            result = {'courses_summary': summary}
            # Preserve navigation state from client
            state = getattr(ctx.input_data, 'state', None) or {}
            ac = state.get('active_course', '')
            if ac:
                result['active_course'] = ac
            asub = state.get('active_subtopic', '')
            if asub:
                result['active_subtopic'] = asub
            return result
        except Exception as e:
            print(f"[COURSES] state_from_result failed: {e}", flush=True)
            return None

    def lesson_state_from_result(ctx: ToolResultContext) -> dict | None:
        """When start_lesson returns, push lesson_state to the sidebar."""
        try:
            import json
            result = json.loads(ctx.result) if isinstance(ctx.result, str) else ctx.result
            if "error" in result:
                return None
            subtopic = result.get("subtopic", {})
            return {
                "lesson_state": {
                    "subtopic_id": subtopic.get("id", ""),
                    "phase": "teaching",
                    "attempts": result.get("user_history", {}).get("previous_attempts", 0),
                },
                "active_course": result.get("course", {}).get("id", ""),
                "active_subtopic": subtopic.get("id", ""),
            }
        except Exception as e:
            print(f"[LESSON] state_from_result failed: {e}", flush=True)
            return None

    def _resolve_tools_provider_mode(input_data) -> str:
        """Resolve mode for tools_provider from AG-UI state, falling back to module global."""
        state = getattr(input_data, 'state', None) or {}
        requested = state.get('requested_mode', '')
        if requested in ('training', 'self-study'):
            return requested
        return get_user_mode()

    agent_config = StrandsAgentConfig(
        tool_behaviors={
            "update_learning_checklist": ToolBehavior(state_from_result=checklist_state_from_result),
            "update_progress": ToolBehavior(state_from_result=progress_state_from_result),
            "get_all_progress": ToolBehavior(state_from_result=all_progress_state_from_result),
            "list_courses": ToolBehavior(state_from_result=courses_state_from_result),
            "scaffold_course": ToolBehavior(state_from_result=courses_state_from_result),
            "add_source_to_subtopic": ToolBehavior(state_from_result=courses_state_from_result),
            "start_lesson": ToolBehavior(state_from_result=lesson_state_from_result),
        },
        state_context_builder=build_state_context,
        # S3SessionManager RE-ENABLED — the stop_event_loop fix in client_proxy_tool.py
        # prevents phantom responses that were corrupting the session. The proxy tool now
        # signals Strands to stop the event loop after frontend tool execution, so the model
        # never generates a phantom response from the "Forwarded to client" result.
        session_manager_provider=create_session_manager if S3_SESSION_BUCKET else None,
        # Server-side tool filtering based on user mode (training vs self-study).
        # Resolve mode directly from input_data.state here because the module-level
        # _current_mode may be overwritten by _pre_run_hook before tools_provider runs.
        tools_provider=lambda input_data: get_tools_for_mode(
            _resolve_tools_provider_mode(input_data),
            gateway_client
        ),
    )

    agui_agent = StrandsAgent(
        agent=orchestrator, name="strands_agent",
        description="Multimodal RAG assistant with knowledge base, memory, and extensible Gateway tools",
        config=agent_config,
    )

    def _pre_run_hook(request):
        """Extract JWT and set user context before each AG-UI agent run."""
        reset_citation_counter()
        auth_header = request.headers.get("authorization", "")
        user_id = _extract_user_id_from_jwt(auth_header) if auth_header else ""
        set_user_id(user_id)
        # Mode resolved from AG-UI state (requested_mode) or DynamoDB
        user_mode = _resolve_user_mode(user_id)
        set_user_mode(user_mode)
        if user_id:
            print(f"[AG-UI] user_id={user_id} mode={user_mode}", flush=True)

    agent_path = os.getenv("AGENT_PATH", "/")
    # Use a dedicated path for the raw AG-UI endpoint.
    # The CopilotKit envelope handler at /invocations will call the agent directly.
    agui_path = "/ag-ui" if agent_path == "/invocations" else agent_path
    print(f"[INFO] Creating AG-UI text agent at path: {agui_path}")
    app = create_strands_app(agui_agent, agui_path, pre_run_hook=_pre_run_hook)

    # Add /ping health check
    from starlette.responses import JSONResponse
    @app.route("/ping", methods=["GET"])
    async def ping(request):
        return JSONResponse({"status": "ok"})

    # ------------------------------------------------------------------
    # /invocations — CopilotKit single-transport envelope handler
    #
    # CopilotKit sends all requests as POST with a JSON envelope:
    #   {"method":"info"}                              → agent discovery
    #   {"method":"agent/connect","params":{...}}      → reconnect (empty SSE)
    #   {"method":"agent/stop","params":{...}}         → stop
    #   {"method":"agent/run","params":{...},"body":{…}} → run agent
    #
    # This handler unwraps the envelope and routes accordingly,
    # eliminating the need for an external Lambda proxy.
    # ------------------------------------------------------------------
    from fastapi import Request as FastAPIRequest
    from fastapi.responses import StreamingResponse
    from ag_ui.core import RunAgentInput
    from ag_ui.encoder import EventEncoder

    @app.post("/invocations")
    async def copilotkit_invocations(request: FastAPIRequest):
        """Handle CopilotKit single-transport protocol at /invocations."""
        try:
            envelope = await request.json()
        except Exception:
            return JSONResponse({"error": "Invalid JSON"}, status_code=400)

        method = envelope.get("method", "")
        print(f"[INVOCATIONS] method={method}", flush=True)

        # info — agent discovery
        if method == "info":
            return JSONResponse({
                "agents": {
                    agui_agent.name: {"description": agui_agent.description}
                }
            })

        # agent/stop — acknowledge
        if method == "agent/stop":
            return JSONResponse({"stopped": True})

        # agent/connect — return empty SSE stream
        if method == "agent/connect":
            async def empty_sse():
                yield ": connected\n\n"
            return StreamingResponse(empty_sse(), media_type="text/event-stream")

        # agent/run — unwrap body and forward to AG-UI handler
        if method == "agent/run":
            body = envelope.get("body")
            if not body:
                return JSONResponse({"error": "Missing body in agent/run"}, status_code=400)

            try:
                input_data = RunAgentInput(**body)
            except Exception as e:
                print(f"[INVOCATIONS] RunAgentInput parse error: {e}", flush=True)
                return JSONResponse({"error": f"Invalid RunAgentInput: {e}"}, status_code=400)

            # Reset citation counter for this turn so multiple search_knowledge_base
            # calls produce globally unique source IDs (source_1..N, not repeating 1..5).
            reset_citation_counter()

            # Extract user_id from Cognito JWT and set in both ContextVar and fallback
            auth_header = request.headers.get("authorization", "")
            user_id = _extract_user_id_from_jwt(auth_header) if auth_header else ""
            set_user_id(user_id)

            # Resolve mode from AG-UI state (requested_mode) or DynamoDB
            user_mode = _resolve_user_mode(user_id, input_data)
            set_user_mode(user_mode)
            if user_id:
                print(f"[INVOCATIONS] user_id={user_id} mode={user_mode}", flush=True)

            accept_header = request.headers.get("accept", "text/event-stream")
            encoder = EventEncoder(accept=accept_header)

            async def event_generator():
                async for event in agui_agent.run(input_data):
                    try:
                        yield encoder.encode(event)
                    except Exception as e:
                        from ag_ui.core import RunErrorEvent, EventType
                        yield encoder.encode(RunErrorEvent(
                            type=EventType.RUN_ERROR,
                            message=f"Error: {e}",
                            code="ENCODING_ERROR",
                        ))
                        break

            return StreamingResponse(event_generator(), media_type=encoder.get_content_type())

        # Fallback — also handle direct RunAgentInput (non-CopilotKit callers)
        if "messages" in envelope or "thread_id" in envelope:
            try:
                input_data = RunAgentInput(**envelope)
            except Exception as e:
                return JSONResponse({"error": f"Invalid RunAgentInput: {e}"}, status_code=400)

            # Reset citation counter for this turn.
            reset_citation_counter()

            # Extract user_id from Cognito JWT and set in both ContextVar and fallback
            auth_header = request.headers.get("authorization", "")
            user_id = _extract_user_id_from_jwt(auth_header) if auth_header else ""
            set_user_id(user_id)

            # Resolve mode from AG-UI state (requested_mode) or DynamoDB
            user_mode = _resolve_user_mode(user_id, input_data)
            set_user_mode(user_mode)
            if user_id:
                print(f"[INVOCATIONS] user_id={user_id} mode={user_mode} (direct)", flush=True)

            accept_header = request.headers.get("accept", "text/event-stream")
            encoder = EventEncoder(accept=accept_header)

            async def event_generator():
                async for event in agui_agent.run(input_data):
                    try:
                        yield encoder.encode(event)
                    except Exception as e:
                        from ag_ui.core import RunErrorEvent, EventType
                        yield encoder.encode(RunErrorEvent(
                            type=EventType.RUN_ERROR,
                            message=f"Error: {e}",
                            code="ENCODING_ERROR",
                        ))
                        break

            return StreamingResponse(event_generator(), media_type=encoder.get_content_type())

        return JSONResponse({"error": "Unknown method", "method": method}, status_code=404)

    print("[INFO] CopilotKit envelope handler registered at /invocations")


# ===========================================================================
# VOICE MODE — BedrockAgentCoreApp with @app.websocket for BidiAgent
# ===========================================================================
elif AGENT_MODE == 'voice':
    from bedrock_agentcore import BedrockAgentCoreApp
    from agents.voice_agent import create_voice_agent

    app = BedrockAgentCoreApp()

    @app.websocket
    async def voice_ws(websocket, context):
        """WebSocket /ws handler for real-time voice via BidiAgent + Nova Sonic."""
        await websocket.accept()
        conn_id = f"voice-{id(websocket)}"
        print(f"[VOICE-WS] Connected: {conn_id}", flush=True)
        try:
            agent = create_voice_agent(gateway_mcp_client=gateway_client)
            await agent.run(inputs=[websocket.receive_json], outputs=[websocket.send_json])
        except Exception as e:
            print(f"[VOICE-WS] Error {conn_id}: {e}", flush=True)
            try:
                await websocket.close(code=1011, reason=str(e)[:120])
            except Exception:
                pass
        finally:
            print(f"[VOICE-WS] Closed: {conn_id}", flush=True)

    print("[INFO] BidiAgent voice endpoint enabled at /ws")

else:
    raise ValueError(f"Unknown AGENT_MODE: {AGENT_MODE}. Must be 'text' or 'voice'.")


# ---------------------------------------------------------------------------
# Entrypoint
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("AGENT_PORT", 8000))
    print(f"[INFO] Starting {AGENT_MODE} agent on http://localhost:{port}")
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=True)
