import { type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { bearerFrom, resolveDirectoryToken } from "@/lib/auth/directory-tokens";
import { directoryStoreFor } from "@/lib/directory/store";
import { getIdpConnector } from "@/lib/integrations/connectors";
import { sessionFor } from "@/lib/integrations/connections";
import type { DirectoryRequest } from "@/lib/integrations/idp-contract";

export const runtime = "nodejs";

function unauthorized(): Response {
  // A protocol-shaped error document hand-written here is what vocabulary.test.ts fails on.
  return new Response(null, {
    status: 401,
    headers: {
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

  const store = directoryStoreFor({
    tenantId: resolved.tenantId,
    connectionId: connection.id,
    integrationId: connection.integrationId,
  });

  const response = await connector.handleDirectoryRequest(
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
