"""Voice agent using Strands BidiAgent with Nova Sonic for real-time speech-to-speech."""

import os
import logging
from strands.experimental.bidi import BidiAgent
from strands.experimental.bidi.models import BidiNovaSonicModel
from strands.experimental.bidi.tools import stop_conversation

from agents.orchestrator import search_knowledge_base, update_learning_checklist, get_checklist_progress

logger = logging.getLogger(__name__)

VOICE_SYSTEM_PROMPT = """You are a helpful voice assistant with access to a knowledge base containing videos, PDFs, and documents. Keep your responses concise and conversational - typically 2-3 sentences. You can search the knowledge base to answer questions. When citing sources, just mention the document or video name naturally in speech rather than using formatted citations. If you need to look something up, let the user know briefly. Do not use emojis, markdown, or any text formatting."""


def create_voice_agent(gateway_mcp_client=None):
    """Create a BidiAgent for voice conversations.

    Args:
        gateway_mcp_client: Optional MCPClient for Gateway tools (shared with text agent).

    Returns:
        BidiAgent instance (not started - caller manages lifecycle).
    """
    # Build shared tool list
    tools = [search_knowledge_base, update_learning_checklist, get_checklist_progress, stop_conversation]
    if gateway_mcp_client:
        tools.append(gateway_mcp_client)

    # Configure Nova Sonic model
    model_id = os.getenv('BIDI_MODEL_ID', 'amazon.nova-sonic-v1:0')
    region = os.getenv('BIDI_REGION', 'us-east-1')
    voice = os.getenv('BIDI_VOICE', 'tiffany')

    logger.info(f"[VOICE] Creating BidiAgent: model={model_id}, region={region}, voice={voice}")
    logger.info(f"[VOICE] Tools: {[t.__name__ if hasattr(t, '__name__') else str(t) for t in tools]}")

    model = BidiNovaSonicModel(
        model_id=model_id,
        provider_config={
            "audio": {
                "input_rate": 16000,
                "output_rate": 24000,
                "voice": voice,
                "channels": 1,
                "format": "pcm",
            },
            "inference": {
                "max_tokens": 1024,
                "temperature": 0.7,
                "top_p": 0.9,
            },
        },
        client_config={
            "region": region,
        },
    )

    agent = BidiAgent(
        model=model,
        tools=tools,
        system_prompt=VOICE_SYSTEM_PROMPT,
        name="voice_agent",
        description="Real-time voice assistant with knowledge base access",
    )

    logger.info("[VOICE] BidiAgent created successfully")
    return agent
