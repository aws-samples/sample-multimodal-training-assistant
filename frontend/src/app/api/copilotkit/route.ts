import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { HttpAgent } from "@ag-ui/client";
import { NextRequest } from "next/server";

// Local development proxy — forwards CopilotKit requests to the local agent.
// In production, NEXT_PUBLIC_API_GATEWAY_URL points directly at AgentCore Runtime.
const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

// Create a runtime factory that forwards the Authorization header from the
// incoming request to the local agent for JWT-based user_id extraction and
// mode lookup on the agent side.
function createRuntime(authHeader?: string) {
  const headers: Record<string, string> = {};
  if (authHeader) headers["Authorization"] = authHeader;

  return new CopilotRuntime({
    agents: {
      strands_agent: new HttpAgent({ url: AGENT_URL, headers }),
    },
  });
}

export const POST = async (req: NextRequest) => {
  const authHeader = req.headers.get("authorization") || undefined;
  const runtime = createRuntime(authHeader);

  const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
    runtime,
    serviceAdapter: new ExperimentalEmptyAdapter(),
    endpoint: "/api/copilotkit",
  });
  return handleRequest(req);
};
