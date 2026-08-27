import { type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { bearerFrom, resolveDirectoryToken } from "@/lib/auth/directory-tokens";
import { directoryStoreFor } from "@/lib/directory/store";
import { getIdpConnector } from "@/lib/integrations/connectors";
import { sessionFor } from "@/lib/integrations/connections";
import type { DirectoryRequest } from "@/lib/integrations/idp-contract";

export const runtime = "nodejs";

/**
 * One answer for every way authentication can fail, so a prober cannot tell
 * an unknown token from a revoked one from a disconnected integration.
 */
function unauthorized(): Response {
  // No body: rendering one needs the token that just failed, and hand-writing a
  // protocol-shaped error document here is what vocabulary.test.ts fails on.
  return new Response(null, {
    status: 401,
    headers: {
      // A directory's provisioning console renders an HTML sign-in page as an
      // opaque failure, so this prefix must challenge rather than redirect.
      "www-authenticate": 'Bearer realm="ZenoSource"',
    },
  });
}

async function handle(
  request: NextRequest,
  segments: string[] | undefined
): Promise<Response> {
  const resolved = await resolveDirectoryToken(bearerFrom(request.headers.get("authorization")));
  if (!resolved) return unauthorized();

  const connection = await db.integrationConnection.findUnique({
    where: { id: resolved.connectionId },
  });
  if (!connection) return unauthorized();

  const connector = getIdpConnector(connection.integrationId);
  if (!connector) return unauthorized();

  let body: unknown = null;
  if (request.method !== "GET" && request.method !== "DELETE") {
    try {
      const text = await request.text();
      body = text ? JSON.parse(text) : null;
    } catch {
      return new Response(JSON.stringify({ detail: "The request body is not valid JSON." }), {
        status: 400,
        headers: { "content-type": "application/json; charset=utf-8" },
      });
    }
  }

  const query: Record<string, string> = {};
  request.nextUrl.searchParams.forEach((value, key) => {
    query[key] = value;
  });

  const directoryRequest: DirectoryRequest = {
    method: request.method,
    segments: segments ?? [],
    query,
    body,
  };

  // The store closes over this tenant and connection and the connector is never
  // told either, so no argument exists through which one tenant reaches another.
  const store = directoryStoreFor({
    tenantId: resolved.tenantId,
    connectionId: connection.id,
    integrationId: connection.integrationId,
  });

  const response = await connector.handleDirectoryRequest(
    // A directory push carries its own credential, so an unsealed connection
    // needs no outbound secret decrypted onto this path.
    connection.secretsSealed ? sessionFor(connection) : { config: {}, secrets: {} },
    directoryRequest,
    store
  );

  return new Response(response.body === null ? null : JSON.stringify(response.body), {
    status: response.status,
    headers: { ...response.headers, "cache-control": "no-store" },
  });
}

type Context = { params: Promise<{ segments?: string[] }> };

export async function GET(request: NextRequest, ctx: Context) {
  return handle(request, (await ctx.params).segments);
}
export async function POST(request: NextRequest, ctx: Context) {
  return handle(request, (await ctx.params).segments);
}
export async function PUT(request: NextRequest, ctx: Context) {
  return handle(request, (await ctx.params).segments);
}
export async function PATCH(request: NextRequest, ctx: Context) {
  return handle(request, (await ctx.params).segments);
}
export async function DELETE(request: NextRequest, ctx: Context) {
  return handle(request, (await ctx.params).segments);
}
