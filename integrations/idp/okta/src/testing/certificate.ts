import { createSign, generateKeyPairSync, type KeyObject } from "node:crypto";

function len(bytes: number): Buffer {
  if (bytes < 0x80) return Buffer.from([bytes]);
  const encoded: number[] = [];
  let remaining = bytes;
  while (remaining > 0) {
    encoded.unshift(remaining & 0xff);
    remaining >>= 8;
  }
  return Buffer.from([0x80 | encoded.length, ...encoded]);
}

function tlv(tag: number, value: Buffer): Buffer {
  return Buffer.concat([Buffer.from([tag]), len(value.length), value]);
}

const seq = (...parts: Buffer[]) => tlv(0x30, Buffer.concat(parts));
const set = (...parts: Buffer[]) => tlv(0x31, Buffer.concat(parts));

function integer(value: Buffer | number): Buffer {
  let body = typeof value === "number" ? Buffer.from([value]) : value;
  // DER integers are signed: a leading byte above 0x7f needs a zero pad or it
  // reads as negative.
  if (body.length > 0 && (body[0] ?? 0) & 0x80) body = Buffer.concat([Buffer.from([0]), body]);
  return tlv(0x02, body);
}

function oid(dotted: string): Buffer {
  const parts = dotted.split(".").map(Number);
  const bytes: number[] = [40 * parts[0] + parts[1]];
  for (const part of parts.slice(2)) {
    const chunk: number[] = [part & 0x7f];
    let rest = part >> 7;
    while (rest > 0) {
      chunk.unshift((rest & 0x7f) | 0x80);
      rest >>= 7;
    }
    bytes.push(...chunk);
  }
  return tlv(0x06, Buffer.from(bytes));
}

const nul = () => tlv(0x05, Buffer.alloc(0));
const utf8 = (value: string) => tlv(0x0c, Buffer.from(value, "utf8"));
const bitString = (value: Buffer) => tlv(0x03, Buffer.concat([Buffer.from([0]), value]));

/** UTCTime, `YYMMDDHHMMSSZ` — valid up to 2049, which every fixture here is. */
function utcTime(date: Date): Buffer {
  const pad = (n: number) => String(n).padStart(2, "0");
  const text =
    pad(date.getUTCFullYear() % 100) +
    pad(date.getUTCMonth() + 1) +
    pad(date.getUTCDate()) +
    pad(date.getUTCHours()) +
    pad(date.getUTCMinutes()) +
    pad(date.getUTCSeconds()) +
    "Z";
  return tlv(0x17, Buffer.from(text, "ascii"));
}

const SHA256_WITH_RSA = "1.2.840.113549.1.1.11";
const COMMON_NAME = "2.5.4.3";

function distinguishedName(commonName: string): Buffer {
  return seq(set(seq(oid(COMMON_NAME), utf8(commonName))));
}

export type GeneratedCertificate = {
  privateKey: KeyObject;
  publicKey: KeyObject;
  privateKeyPem: string;
  /** PEM, with armour — what a verifier wants. */
  certificatePem: string;
  /** Base64 DER with no armour — what a SAML document carries. */
  certificateBody: string;
  notAfter: Date;
};

/** @param lifetimeDays negative for a certificate that has already expired. */
export function generateSelfSignedCertificate(options?: {
  commonName?: string;
  lifetimeDays?: number;
  now?: Date;
}): GeneratedCertificate {
  const commonName = options?.commonName ?? "zenosource-test-idp";
  const now = options?.now ?? new Date();
  const lifetimeDays = options?.lifetimeDays ?? 3650;

  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });

  const notBefore = new Date(now.getTime() - 60_000);
  const notAfter = new Date(now.getTime() + lifetimeDays * 86_400_000);
  // An already-expired fixture still needs notBefore < notAfter.
  const from = lifetimeDays < 0 ? new Date(notAfter.getTime() - 86_400_000) : notBefore;

  const algorithm = seq(oid(SHA256_WITH_RSA), nul());
  const spki = publicKey.export({ type: "spki", format: "der" }) as Buffer;

  const tbs = seq(
    // [0] EXPLICIT version, v3.
    tlv(0xa0, integer(2)),
    integer(Buffer.from([0x01, 0x00, 0x01])),
    algorithm,
    distinguishedName(commonName),
    seq(utcTime(from), utcTime(notAfter)),
    distinguishedName(commonName),
    spki
  );

  const signature = createSign("sha256").update(tbs).sign(privateKey);
  const certificate = seq(tbs, algorithm, bitString(signature));

  const body = certificate.toString("base64");
  const certificatePem = `-----BEGIN CERTIFICATE-----\n${body.replace(/(.{64})/g, "$1\n").replace(/\n$/, "")}\n-----END CERTIFICATE-----`;

  return {
    privateKey,
    publicKey,
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }) as string,
    certificatePem,
    certificateBody: body,
    notAfter,
  };
}
