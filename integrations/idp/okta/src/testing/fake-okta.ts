import { SignJWT, exportJWK, calculateJwkThumbprint } from "jose";
import { SignedXml } from "xml-crypto";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { generateSelfSignedCertificate, type GeneratedCertificate } from "./certificate";
import type { FetchLike } from "../types";

export type FakeOktaUser = {
  sub: string;
  email: string;
  name: string;
  groups?: string[];
};

const DEFAULT_USERS: FakeOktaUser[] = [
  { sub: "00uSEEDBUYER", email: "buyer@acme.test", name: "Jordan Buyer", groups: ["Procurement"] },
  { sub: "00uSEEDCASEY", email: "casey@acme.test", name: "Casey Buyer", groups: ["Procurement"] },
  { sub: "00uNEWSTARTER", email: "dana@acme.test", name: "Dana Reed", groups: ["Procurement"] },
];

export type FakeOktaOptions = {
  issuer?: string;
  clientId?: string;
  clientSecret?: string;
  users?: FakeOktaUser[];
  certificate?: GeneratedCertificate;
  now?: () => Date;
};

export type FakeOktaCall = { method: string; url: string };

export type SignAssertionOptions = {
  user?: FakeOktaUser;
  inResponseTo: string;
  destination: string;
  audience: string;
  now?: Date;
  notOnOrAfterMinutes?: number;
  signResponse?: boolean;
  signAssertion?: boolean;
  issuer?: string;
  recipient?: string;
  certificate?: GeneratedCertificate;
};

export type FakeOkta = {
  issuer: string;
  clientId: string;
  clientSecret: string;
  jwksUri: string;
  ssoUrl: string;
  certificate: GeneratedCertificate;
  certificateBody: string;
  users: FakeOktaUser[];
  calls: FakeOktaCall[];
  fetchImpl: FetchLike;
  authorize(url: string, options?: { user?: FakeOktaUser }): { code: string; state: string };
  signAssertion(options: SignAssertionOptions): string;
  /** Base64 of the above, as it arrives in a form post. */
  encodeResponse(xml: string): string;
  signIdToken(claims: Record<string, unknown>, options?: { alg?: string; kid?: string }): Promise<string>;
  /** Serve this exact ID token from the next token exchange: the only way to
   * test a token no honest identity provider would mint. */
  serveNextIdToken(token: string): void;
  handler(request: IncomingMessage, response: ServerResponse): void;
};

const NS = {
  protocol: "urn:oasis:names:tc:SAML:2.0:protocol",
  assertion: "urn:oasis:names:tc:SAML:2.0:assertion",
};

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function createFakeOkta(options: FakeOktaOptions = {}): FakeOkta {
  const issuer = (options.issuer ?? "https://acme.okta.test/oauth2/default").replace(/\/+$/, "");
  const clientId = options.clientId ?? "0oaZENOSOURCE";
  const clientSecret = options.clientSecret ?? "zenosource-dev-secret";
  const users = options.users ?? DEFAULT_USERS;
  const certificate = options.certificate ?? generateSelfSignedCertificate();
  const now = options.now ?? (() => new Date());
  const jwksUri = `${issuer}/v1/keys`;
  const ssoUrl = `${issuer}/sso/saml`;
  const calls: FakeOktaCall[] = [];

  const keyPromise = (async () => {
    const jwk = await exportJWK(certificate.publicKey);
    jwk.alg = "RS256";
    jwk.use = "sig";
    jwk.kid = await calculateJwkThumbprint(jwk);
    return jwk;
  })();

  type Pending = { user: FakeOktaUser; nonce: string; codeChallenge: string };
  const pending = new Map<string, Pending>();
  let nextIdToken: string | null = null;

  async function signIdToken(
    claims: Record<string, unknown>,
    signOptions?: { alg?: string; kid?: string }
  ): Promise<string> {
    const jwk = await keyPromise;
    return new SignJWT(claims)
      .setProtectedHeader({ alg: signOptions?.alg ?? "RS256", kid: signOptions?.kid ?? jwk.kid! })
      .setIssuer(issuer)
      .setAudience(clientId)
      .setIssuedAt(Math.floor(now().getTime() / 1000))
      .setExpirationTime(Math.floor(now().getTime() / 1000) + 300)
      .sign(certificate.privateKey);
  }

  const discovery = () => ({
    issuer,
    authorization_endpoint: `${issuer}/v1/authorize`,
    token_endpoint: `${issuer}/v1/token`,
    jwks_uri: jwksUri,
    response_types_supported: ["code", "id_token"],
    id_token_signing_alg_values_supported: ["RS256"],
    code_challenge_methods_supported: ["S256"],
    scopes_supported: ["openid", "email", "profile", "groups"],
    subject_types_supported: ["public"],
  });

  function authorize(url: string, authorizeOptions?: { user?: FakeOktaUser }) {
    const parsed = new URL(url);
    const hinted = (parsed.searchParams.get("login_hint") ?? "").toLowerCase();
    const state = parsed.searchParams.get("state") ?? "";
    const nonce = parsed.searchParams.get("nonce") ?? "";
    const codeChallenge = parsed.searchParams.get("code_challenge") ?? "";
    const code = `code-${randomBytes(8).toString("hex")}`;
    const chosen =
      authorizeOptions?.user ??
      users.find((u) => u.email.toLowerCase() === hinted) ??
      users[0];
    pending.set(code, { user: chosen, nonce, codeChallenge });
    return { code, state };
  }

  async function token(body: string, authorization: string | undefined) {
    const params = new URLSearchParams(body);
    const code = params.get("code") ?? "";
    const verifier = params.get("code_verifier") ?? "";
    const entry = pending.get(code);
    if (!entry) return { status: 400, body: { error: "invalid_grant" } };
    pending.delete(code);

    const expectedBasic = Buffer.from(
      `${encodeURIComponent(clientId)}:${encodeURIComponent(clientSecret)}`,
      "utf8"
    ).toString("base64");
    if (authorization !== `Basic ${expectedBasic}`) {
      return { status: 401, body: { error: "invalid_client" } };
    }

    const challenge = createHash("sha256").update(verifier, "ascii").digest("base64url");
    if (!verifier || challenge !== entry.codeChallenge) {
      return { status: 400, body: { error: "invalid_grant", error_description: "PKCE check failed" } };
    }

    const accessToken = `at-${randomBytes(16).toString("hex")}`;
    const digest = createHash("sha256").update(accessToken, "ascii").digest();
    const idToken = await signIdToken({
      sub: entry.user.sub,
      email: entry.user.email,
      name: entry.user.name,
      groups: entry.user.groups ?? [],
      nonce: entry.nonce,
      at_hash: digest.subarray(0, digest.length / 2).toString("base64url"),
    });
    const served = nextIdToken;
    nextIdToken = null;
    return {
      status: 200,
      body: {
        token_type: "Bearer",
        access_token: accessToken,
        id_token: served ?? idToken,
        expires_in: 300,
      },
    };
  }

  function signAssertion(assertionOptions: SignAssertionOptions): string {
    const user = assertionOptions.user ?? users[0];
    const at = assertionOptions.now ?? now();
    const cert = assertionOptions.certificate ?? certificate;
    const minutes = assertionOptions.notOnOrAfterMinutes ?? 5;
    const iso = (d: Date) => d.toISOString();
    const notBefore = new Date(at.getTime() - minutes * 60_000);
    const notOnOrAfter = new Date(at.getTime() + minutes * 60_000);
    const assertionId = `_${randomUUID().replace(/-/g, "")}`;
    const responseId = `_${randomUUID().replace(/-/g, "")}`;
    const idpIssuer = assertionOptions.issuer ?? `http://www.okta.test/exkZENOSOURCE`;
    const recipient = assertionOptions.recipient ?? assertionOptions.destination;

    const assertion =
      `<saml:Assertion xmlns:saml="${NS.assertion}" ID="${assertionId}" Version="2.0" IssueInstant="${iso(at)}">` +
      `<saml:Issuer>${escapeXml(idpIssuer)}</saml:Issuer>` +
      `<saml:Subject>` +
      `<saml:NameID Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress">${escapeXml(user.email)}</saml:NameID>` +
      `<saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer">` +
      `<saml:SubjectConfirmationData NotOnOrAfter="${iso(notOnOrAfter)}" Recipient="${escapeXml(recipient)}" InResponseTo="${escapeXml(assertionOptions.inResponseTo)}"/>` +
      `</saml:SubjectConfirmation></saml:Subject>` +
      `<saml:Conditions NotBefore="${iso(notBefore)}" NotOnOrAfter="${iso(notOnOrAfter)}">` +
      `<saml:AudienceRestriction><saml:Audience>${escapeXml(assertionOptions.audience)}</saml:Audience></saml:AudienceRestriction>` +
      `</saml:Conditions>` +
      `<saml:AuthnStatement AuthnInstant="${iso(at)}" SessionIndex="${assertionId}">` +
      `<saml:AuthnContext><saml:AuthnContextClassRef>urn:oasis:names:tc:SAML:2.0:ac:classes:PasswordProtectedTransport</saml:AuthnContextClassRef></saml:AuthnContext>` +
      `</saml:AuthnStatement>` +
      `<saml:AttributeStatement>` +
      `<saml:Attribute Name="email"><saml:AttributeValue>${escapeXml(user.email)}</saml:AttributeValue></saml:Attribute>` +
      `<saml:Attribute Name="displayName"><saml:AttributeValue>${escapeXml(user.name)}</saml:AttributeValue></saml:Attribute>` +
      (user.groups ?? [])
        .map((g) => `<saml:Attribute Name="groups"><saml:AttributeValue>${escapeXml(g)}</saml:AttributeValue></saml:Attribute>`)
        .join("") +
      `</saml:AttributeStatement>` +
      `</saml:Assertion>`;

    const signedAssertion =
      assertionOptions.signAssertion === false
        ? assertion
        : sign(assertion, "//*[local-name(.)='Assertion']", cert);

    const response =
      `<samlp:Response xmlns:samlp="${NS.protocol}" xmlns:saml="${NS.assertion}" ID="${responseId}" Version="2.0"` +
      ` IssueInstant="${iso(at)}" Destination="${escapeXml(assertionOptions.destination)}" InResponseTo="${escapeXml(assertionOptions.inResponseTo)}">` +
      `<saml:Issuer>${escapeXml(idpIssuer)}</saml:Issuer>` +
      `<samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></samlp:Status>` +
      signedAssertion +
      `</samlp:Response>`;

    return assertionOptions.signResponse
      ? sign(response, "//*[local-name(.)='Response']", cert)
      : response;
  }

  function sign(xml: string, xpath: string, cert: GeneratedCertificate): string {
    const signer = new SignedXml({
      privateKey: cert.privateKeyPem,
      publicCert: cert.certificatePem,
      signatureAlgorithm: "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256",
      canonicalizationAlgorithm: "http://www.w3.org/2001/10/xml-exc-c14n#",
    });
    signer.addReference({
      xpath,
      digestAlgorithm: "http://www.w3.org/2001/04/xmlenc#sha256",
      transforms: [
        "http://www.w3.org/2000/09/xmldsig#enveloped-signature",
        "http://www.w3.org/2001/10/xml-exc-c14n#",
      ],
    });
    signer.computeSignature(xml, { location: { reference: xpath, action: "append" } });
    return signer.getSignedXml();
  }

  const fetchImpl: FetchLike = async (input, init) => {
    const method = (init?.method ?? "GET").toUpperCase();
    calls.push({ method, url: input });
    const path = new URL(input).pathname;

    const reply = (status: number, body: unknown) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      });

    if (path.endsWith("/.well-known/openid-configuration")) return reply(200, discovery());
    if (input === jwksUri) return reply(200, { keys: [await keyPromise] });
    if (path.endsWith("/v1/token")) {
      const result = await token(init?.body ?? "", init?.headers?.authorization);
      return reply(result.status, result.body);
    }
    return reply(404, { error: "not_found" });
  };

  function handler(request: IncomingMessage, response: ServerResponse): void {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
    calls.push({ method: request.method ?? "GET", url: url.toString() });

    const send = (status: number, body: unknown, contentType = "application/json") => {
      response.writeHead(status, { "content-type": contentType });
      response.end(typeof body === "string" ? body : JSON.stringify(body));
    };

    if (url.pathname.endsWith("/.well-known/openid-configuration")) {
      // Endpoints are reported relative to the request host, so a dev issuer
      // on http://localhost:3101 discovers endpoints on that same origin.
      const origin = `http://${request.headers.host ?? "localhost"}`;
      return send(200, {
        ...discovery(),
        issuer: origin,
        authorization_endpoint: `${origin}/v1/authorize`,
        token_endpoint: `${origin}/v1/token`,
        jwks_uri: `${origin}/v1/keys`,
      });
    }

    if (url.pathname === "/v1/keys") {
      return void keyPromise.then((jwk) => send(200, { keys: [jwk] }));
    }

    if (url.pathname === "/v1/authorize") {
      const redirectUri = url.searchParams.get("redirect_uri") ?? "";
      const { code, state } = authorize(url.toString());
      const target = new URL(redirectUri);
      target.searchParams.set("code", code);
      target.searchParams.set("state", state);
      response.writeHead(302, { location: target.toString() });
      response.end();
      return;
    }

    if (url.pathname === "/v1/token" && request.method === "POST") {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        void token(Buffer.concat(chunks).toString("utf8"), request.headers.authorization).then(
          (result) => send(result.status, result.body)
        );
      });
      return;
    }

    if (url.pathname === "/sso/saml") {
      const relayState = url.searchParams.get("RelayState") ?? "";
      const acs = url.searchParams.get("acs") ?? "";
      const requestId = url.searchParams.get("rid") ?? "";
      const audience = url.searchParams.get("aud") ?? "";
      const xml = signAssertion({
        inResponseTo: requestId,
        destination: acs,
        audience,
      });
      const form =
        `<!doctype html><html><body onload="document.forms[0].submit()">` +
        `<form method="POST" action="${escapeXml(acs)}">` +
        `<input type="hidden" name="SAMLResponse" value="${escapeXml(Buffer.from(xml, "utf8").toString("base64"))}"/>` +
        `<input type="hidden" name="RelayState" value="${escapeXml(relayState)}"/>` +
        `<noscript><button type="submit">Continue</button></noscript>` +
        `</form></body></html>`;
      return send(200, form, "text/html; charset=utf-8");
    }

    return send(404, { error: "not_found" });
  }

  return {
    issuer,
    clientId,
    clientSecret,
    jwksUri,
    ssoUrl,
    certificate,
    certificateBody: certificate.certificateBody,
    users,
    calls,
    fetchImpl,
    authorize,
    signAssertion,
    encodeResponse: (xml: string) => Buffer.from(xml, "utf8").toString("base64"),
    signIdToken,
    serveNextIdToken: (token: string) => {
      nextIdToken = token;
    },
    handler,
  };
}
