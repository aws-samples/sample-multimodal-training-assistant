import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";

const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

export const GET = async () => {
  return NextResponse.json({
    agents: [{
      name: "strands_agent",
      description: "Multimodal RAG assistant with knowledge base, memory, and extensible Gateway tools",
    }],
  });
};

export const POST = async (req: NextRequest) => {
  try {
    const rawBody = await req.text();
    let parsedBody: any;
    try { parsedBody = JSON.parse(rawBody); } catch { parsedBody = {}; }

    const messages = (parsedBody.messages || []).map((msg: any) => ({
      ...msg,
      id: msg.id || randomUUID(),
    }));

    const aguiPayload: any = {
      threadId: parsedBody.threadId || randomUUID(),
      runId: parsedBody.runId || randomUUID(),
      messages,
      tools: parsedBody.tools || [],
      context: parsedBody.context || [],
      state: parsedBody.state || {},
      forwardedProps: parsedBody.forwardedProps || {},
    };

    // Forward Authorization header so the agent can extract user_id from JWT.
    // CopilotKit forwards custom headers set on the provider component via the
    // incoming request headers to the runtime endpoint (/api/copilotkit), which
    // then proxies to this agent-proxy route.
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'text/event-stream',
    };
    const authHeader = req.headers.get('authorization');
    if (authHeader) {
      headers['Authorization'] = authHeader;
    }

    const response = await fetch(AGENT_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify(aguiPayload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return new NextResponse(errorText, { status: response.status, headers: { 'Content-Type': 'application/json' } });
    }

    return new NextResponse(response.body, {
      status: response.status,
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' },
    });
  } catch (error) {
    console.error("agent-proxy error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
};
