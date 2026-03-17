import { SignatureV4 } from "@smithy/signature-v4";
import { HttpRequest } from "@smithy/protocol-http";
import { Sha256 } from "@aws-crypto/sha256-browser";
import { fetchAuthSession } from "aws-amplify/auth";

/**
 * Generates a SigV4 pre-signed WebSocket URL using Cognito Identity Pool
 * credentials entirely client-side.
 *
 * @param runtimeArn - The ARN of the Bedrock AgentCore runtime
 * @param region - The AWS region (e.g. "us-east-1")
 * @returns A fully signed wss:// URL valid for 5 minutes
 */
export async function getSignedWebSocketUrl(
  runtimeArn: string,
  region: string
): Promise<string> {
  const session = await fetchAuthSession();
  const credentials = session.credentials;

  if (!credentials) {
    throw new Error(
      "AWS credentials are not available. Ensure the user is authenticated and the Cognito Identity Pool is configured."
    );
  }

  const encodedArn = encodeURIComponent(runtimeArn);
  const host = `bedrock-agentcore.${region}.amazonaws.com`;
  const path = `/runtimes/${encodedArn}/ws`;

  const request = new HttpRequest({
    method: "GET",
    protocol: "wss:",
    hostname: host,
    path,
    headers: {
      host,
    },
  });

  const signer = new SignatureV4({
    credentials,
    region,
    service: "bedrock-agentcore",
    sha256: Sha256,
  });

  const signed = await signer.presign(request, { expiresIn: 300 });

  const url = new URL(`wss://${host}${path}`);
  for (const [key, value] of Object.entries(signed.query ?? {})) {
    if (typeof value === "string") {
      url.searchParams.set(key, value);
    }
  }

  return url.toString();
}
