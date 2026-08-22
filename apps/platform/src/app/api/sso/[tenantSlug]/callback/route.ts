import { NextResponse, type NextRequest } from "next/server";
import { completeSignIn } from "@/lib/auth/broker";
import { resolveTenantBySlug } from "@/lib/auth/tenant-resolution";
import { SSO_COOKIE } from "@/lib/auth/sso-request";
import { safeReturnTo } from "@/lib/auth/return-to";
import { createSession } from "@/lib/session";
import type { SignInCallback } from "@/lib/integrations/idp-contract";

// Where a credential comes back.
//
// One URL per tenant, answering both verbs, because which one an identity
// provider uses is a property of the protocol its admin chose and not
// something a customer should have to configure twice. The query string and
// the form body are merged into one bag of parameters and handed to the
// connector — nothing here reads a protocol parameter by name.
export const runtime = "nodejs";

async function paramsFrom(request: NextRequest): Promise<Record<string, string>> {
  const merged: Record<string, string> = {};
  request.nextUrl.searchParams.forEach((value, key) => {
    merged[key] = value;
  });
  if (request.method === "POST") {
    try {
      const form = await request.formData();
      for (const [key, value] of form.entries()) {
        if (typeof value === "string") merged[key] = value;
      }
    } catch {
      // A body we cannot read is a callback that will not verify. Falling
      // through with what the query string had produces the same generic
      // failure below rather than a stack trace.
    }
  }
  return merged;
}

function failed(request: NextRequest, reason: string) {
  const url = new URL("/login", request.nextUrl);
  url.searchParams.set("sso", "failed");
  // The reason is shown, because every message the broker produces is either
  // "start again" or something a person's own IT admin can act on. None of
  // them distinguishes a wrong handle from an expired one from the wrong
  // browser — those are one message on purpose.
  url.searchParams.set("reason", reason.slice(0, 300));
  return NextResponse.redirect(url);
}

async function handle(request: NextRequest, tenantSlug: string) {
  const tenant = await resolveTenantBySlug(tenantSlug);
  if (!tenant) return failed(request, "That sign-in address doesn't belong to an organization here.");

  const callback: SignInCallback = {
    method: request.method === "POST" ? "POST" : "GET",
    url: request.nextUrl.toString(),
    params: await paramsFrom(request),
  };

  const result = await completeSignIn({
    tenant,
    callback,
    cookieValue: request.cookies.get(SSO_COOKIE)?.value,
  });
  if (!result.ok) return failed(request, result.reason);

  // A fresh session, minted here rather than anywhere the identity provider
  // can influence. Same cookie and same shape as a password sign-in — one
  // session layer, whichever door somebody came through.
  await createSession({ internalUserId: result.userId, tenantId: result.tenantId });

  const response = NextResponse.redirect(
    new URL(safeReturnTo(result.redirectTo), request.nextUrl)
  );
  // The request is spent; so is its binding. Expired at the same path it was
  // set on — `delete(name)` defaults to "/" and silently fails to match a
  // cookie scoped to /api/sso, which leaves it sitting in the browser for the
  // rest of its ten minutes.
  response.cookies.set(SSO_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
    path: "/api/sso",
    maxAge: 0,
  });
  return response;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenantSlug: string }> }
) {
  return handle(request, (await params).tenantSlug);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tenantSlug: string }> }
) {
  return handle(request, (await params).tenantSlug);
}
