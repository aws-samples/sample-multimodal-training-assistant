"""
AWS Strands Integration for AG-UI — modified version.

Based on ag-ui-strands v0.1.0 (https://pypi.org/project/ag_ui_strands/)
Copyright AG-UI Contributors. Licensed under MIT.
See THIRD-PARTY-LICENSES in the project root for details.

Modifications by Amazon: ToolBehavior config, session_manager_provider,
tools_provider, predict_state mappings, client_proxy_tool.py.
"""
from .agent import StrandsAgent
from .client_proxy_tool import create_proxy_tool, sync_proxy_tools
from .utils import create_strands_app
from .endpoint import add_strands_fastapi_endpoint, add_ping
from .config import (
    StrandsAgentConfig,
    ToolBehavior,
    ToolCallContext,
    ToolResultContext,
    PredictStateMapping,
)

__all__ = [
    "StrandsAgent",
    "create_proxy_tool",
    "sync_proxy_tools",
    "create_strands_app",
    "add_strands_fastapi_endpoint",
    "add_ping",
    "StrandsAgentConfig",
    "ToolBehavior",
    "ToolCallContext",
    "ToolResultContext",
    "PredictStateMapping",
]

