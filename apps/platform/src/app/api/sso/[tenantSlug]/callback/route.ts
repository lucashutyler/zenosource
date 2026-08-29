import { NextResponse, type NextRequest } from "next/server";
import { completeSignIn } from "@/lib/auth/broker";
import { resolveTenantBySlug } from "@/lib/auth/tenant-resolution";
import { SSO_COOKIE } from "@/lib/auth/sso-request";
import { safeReturnTo } from "@/lib/auth/return-to";
import { createSession } from "@/lib/session";
import type { SignInCallback } from "@/lib/integrations/idp-contract";

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
      // An unreadable body fails verification below anyway.
    }
  }
  return merged;
}

function failed(request: NextRequest, reason: string) {
  const url = new URL("/login", request.nextUrl);
  url.searchParams.set("sso", "failed");
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

  await createSession({ internalUserId: result.userId, tenantId: result.tenantId });

  const response = NextResponse.redirect(
    new URL(safeReturnTo(result.redirectTo), request.nextUrl)
  );
  // `delete(name)` defaults to path "/" and silently misses a cookie scoped to /api/sso.
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
