import { type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { bearerFrom, resolveDirectoryToken } from "@/lib/auth/directory-tokens";
import { directoryStoreFor } from "@/lib/directory/store";
import { getIdpConnector } from "@/lib/integrations/connectors";
import { sessionFor } from "@/lib/integrations/connections";
import type { DirectoryRequest } from "@/lib/integrations/idp-contract";

// The directory service. The one surface in this product that somebody else's
// system calls, rather than the other way round.
//
// Four things happen here and nothing else: authenticate the bearer, build a
// store already bound to the tenant that bearer belongs to, hand the request
// to the connector, and return what comes back. There is no schema identifier,
// no filter grammar and no patch shape in this file — all of that lives in the
// integration package, which is what keeps a second identity provider a
// subproject rather than a rewrite.
export const runtime = "nodejs";

/**
 * Always the same answer, for every way authentication can fail: no header, a
 * malformed one, an unknown token, a revoked token, a disconnected
 * integration. Telling them apart would tell whoever is probing which of the
 * five they achieved, and no legitimate client needs the distinction.
 */
function unauthorized(): Response {
  // No body. There is no connector to render one — resolving which integration
  // this is *requires* the token that just failed — and writing a
  // protocol-shaped error document here by hand would put the directory
  // protocol's own vocabulary in platform code, which vocabulary.test.ts
  // fails the build over. A bare 401 with a challenge header is what the
  // protocol asks for anyway.
  return new Response(null, {
    status: 401,
    headers: {
      // A directory's provisioning console renders an HTML sign-in page as an
      // opaque failure. proxy.ts is told to leave this prefix alone for that
      // reason; this header is the other half of saying so.
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
      // Same reasoning as the 401: a body we cannot parse is a body no
      // connector has seen, so there is nothing here qualified to describe it
      // in the protocol's own terms.
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

  // The store closes over this tenant and this connection. The connector never
  // learns either — docs/integrations.md calls a directory credential
  // reaching another tenant "a severe multi-tenancy breach", and the defence
  // is that there is no argument here through which it could.
  const store = directoryStoreFor({
    tenantId: resolved.tenantId,
    connectionId: connection.id,
    integrationId: connection.integrationId,
  });

  const response = await connector.handleDirectoryRequest(
    // A directory push carries its own credential, so there is nothing of the
    // connection's to open. Passing an empty session rather than decrypting
    // one keeps an outbound credential off a path that has no use for it.
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
