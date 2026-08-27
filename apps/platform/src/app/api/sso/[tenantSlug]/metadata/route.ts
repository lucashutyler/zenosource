import { type NextRequest } from "next/server";
import { signInConnectionFor } from "@/lib/auth/broker";
import { resolveTenantBySlug } from "@/lib/auth/tenant-resolution";
import { getIdpConnector } from "@/lib/integrations/connectors";
import { sessionFor } from "@/lib/integrations/connections";
import { ssoCallbackUrl, serviceProviderRef } from "@/lib/auth/urls";

export const runtime = "nodejs";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ tenantSlug: string }> }
) {
  const { tenantSlug } = await params;
  const tenant = await resolveTenantBySlug(tenantSlug);
  if (!tenant) return new Response("Not found", { status: 404 });

  const connection = await signInConnectionFor(tenant.id);
  if (!connection) return new Response("Not found", { status: 404 });

  const connector = getIdpConnector(connection.integrationId);
  if (!connector) return new Response("Not found", { status: 404 });

  const document = await connector.describeServiceProvider(sessionFor(connection), {
    callbackUrl: ssoCallbackUrl(tenant.slug),
    serviceProviderRef: serviceProviderRef(tenant.slug),
  });

  return new Response(document.body, {
    status: 200,
    headers: { "content-type": document.contentType, "cache-control": "no-store" },
  });
}
