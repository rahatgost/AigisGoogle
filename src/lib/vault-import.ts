// Parsers for bulk-import formats. Everything here is pure — no network,
// no Supabase calls — so the actual commit stays on the caller's DEK path.
import * as OTPAuth from "otpauth";
import { parseOtpauthUri, type ParsedOtpauth, type Algorithm } from "@/lib/vault-accounts";
import {
  AVF_FORMAT,
  decryptExportedFile,
  type EncryptedExportFile,
} from "@/lib/vault-export";

export type ImportSource =
  | "otpauth"
  | "otpauth-migration"
  | "aegis"
  | "2fas"
  | "avf"
  | "unknown";

export interface ImportResult {
  source: ImportSource;
  entries: ParsedOtpauth[];
  skipped: number;
}

const ALGO_MAP: Record<number, Algorithm> = {
  0: "SHA1", // unspecified → default
  1: "SHA1",
  2: "SHA256",
  3: "SHA512",
};

const DIGITS_MAP: Record<number, number> = {
  0: 6,
  1: 6,
  2: 8,
};

function normalizeAlgo(a: unknown): Algorithm {
  const s = typeof a === "string" ? a.toUpperCase() : "SHA1";
  return s === "SHA256" || s === "SHA512" ? s : "SHA1";
}

// -- Base64 helpers (URL-safe tolerant) --
function base64ToBytes(input: string): Uint8Array {
  const s = input.replace(/-/g, "+").replace(/_/g, "/");
  const pad = s.length % 4 === 0 ? s : s + "=".repeat(4 - (s.length % 4));
  const bin = atob(pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToBase32(bytes: Uint8Array): string {
  // Delegate to OTPAuth so we get the exact base32 flavour the rest of the
  // app expects (uppercase, no padding).
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const secret = new OTPAuth.Secret({ buffer: buf as ArrayBuffer });
  return secret.base32;
}

// -- Minimal protobuf reader (only what MigrationPayload needs) --
class PbReader {
  pos = 0;
  constructor(private buf: Uint8Array) {}
  eof() {
    return this.pos >= this.buf.length;
  }
  varint(): number {
    let result = 0;
    let shift = 0;
    while (true) {
      if (this.pos >= this.buf.length) throw new Error("Unexpected end of varint");
      const b = this.buf[this.pos++];
      result |= (b & 0x7f) << shift;
      if ((b & 0x80) === 0) break;
      shift += 7;
      if (shift > 35) throw new Error("Varint too long");
    }
    return result >>> 0;
  }
  bytes(len: number): Uint8Array {
    const out = this.buf.subarray(this.pos, this.pos + len);
    this.pos += len;
    return out;
  }
  skip(wire: number) {
    if (wire === 0) this.varint();
    else if (wire === 2) {
      const l = this.varint();
      this.pos += l;
    } else if (wire === 5) this.pos += 4;
    else if (wire === 1) this.pos += 8;
    else throw new Error(`Unsupported wire type ${wire}`);
  }
}

interface OtpParams {
  secret?: Uint8Array;
  name?: string;
  issuer?: string;
  algorithm?: number;
  digits?: number;
  type?: number; // 1=HOTP, 2=TOTP
}

function decodeOtpParameters(reader: PbReader, end: number): OtpParams {
  const out: OtpParams = {};
  const dec = new TextDecoder();
  while (reader.pos < end) {
    const tag = reader.varint();
    const field = tag >>> 3;
    const wire = tag & 0x7;
    if (wire === 2) {
      const len = reader.varint();
      const val = reader.bytes(len);
      if (field === 1) out.secret = new Uint8Array(val);
      else if (field === 2) out.name = dec.decode(val);
      else if (field === 3) out.issuer = dec.decode(val);
    } else if (wire === 0) {
      const v = reader.varint();
      if (field === 4) out.algorithm = v;
      else if (field === 5) out.digits = v;
      else if (field === 6) out.type = v;
    } else {
      reader.skip(wire);
    }
  }
  return out;
}

export function parseGoogleAuthMigrationUri(uri: string): ParsedOtpauth[] {
  const url = new URL(uri);
  if (url.protocol !== "otpauth-migration:") {
    throw new Error("Not an otpauth-migration:// URI.");
  }
  const dataParam = url.searchParams.get("data");
  if (!dataParam) throw new Error("Migration payload missing 'data' parameter.");
  const bytes = base64ToBytes(decodeURIComponent(dataParam));

  const reader = new PbReader(bytes);
  const entries: ParsedOtpauth[] = [];
  while (!reader.eof()) {
    const tag = reader.varint();
    const field = tag >>> 3;
    const wire = tag & 0x7;
    if (field === 1 && wire === 2) {
      const len = reader.varint();
      const sub = decodeOtpParameters(reader, reader.pos + len);
      if (!sub.secret || sub.secret.length === 0) continue;
      if (sub.type !== undefined && sub.type !== 2) continue; // TOTP only
      const secret = bytesToBase32(sub.secret);
      const rawName = sub.name?.trim() ?? "";
      const rawIssuer = sub.issuer?.trim() ?? "";
      // Google often stores "Issuer:label" in name; split when issuer is empty
      let issuer = rawIssuer;
      let label = rawName;
      if (!issuer && rawName.includes(":")) {
        const [maybeIssuer, ...rest] = rawName.split(":");
        issuer = maybeIssuer.trim();
        label = rest.join(":").trim();
      }
      entries.push({
        issuer: issuer || label || "Unknown",
        label,
        secret,
        algorithm: ALGO_MAP[sub.algorithm ?? 1] ?? "SHA1",
        digits: DIGITS_MAP[sub.digits ?? 1] ?? 6,
        period: 30,
      });
    } else {
      reader.skip(wire);
    }
  }
  return entries;
}

// -- Aegis (plaintext export only) --
export function parseAegisJson(json: unknown): ParsedOtpauth[] {
  const root = json as {
    db?: {
      entries?: Array<{
        type?: string;
        name?: string;
        issuer?: string;
        info?: { secret?: string; algo?: string; digits?: number; period?: number };
      }>;
    };
    header?: { slots?: unknown };
  };
  if (!root?.db?.entries) {
    throw new Error(
      "Aegis file is encrypted or not a plain export. Export as 'Plain' from Aegis first.",
    );
  }
  const out: ParsedOtpauth[] = [];
  for (const e of root.db.entries) {
    if ((e.type ?? "").toLowerCase() !== "totp") continue;
    const secret = e.info?.secret;
    if (!secret) continue;
    out.push({
      issuer: (e.issuer || e.name || "Unknown").trim(),
      label: (e.name || "").trim(),
      secret: secret.replace(/\s+/g, "").toUpperCase(),
      algorithm: normalizeAlgo(e.info?.algo),
      digits: e.info?.digits ?? 6,
      period: e.info?.period ?? 30,
    });
  }
  return out;
}

// -- 2FAS --
export function parse2FASJson(json: unknown): ParsedOtpauth[] {
  const root = json as {
    services?: Array<{
      name?: string;
      secret?: string;
      otp?: {
        account?: string;
        issuer?: string;
        algorithm?: string;
        digits?: number;
        period?: number;
        tokenType?: string;
      };
    }>;
    servicesEncrypted?: string;
  };
  if (root?.servicesEncrypted && !root.services) {
    throw new Error(
      "2FAS file is password-protected. Export without a password, or decrypt first.",
    );
  }
  if (!Array.isArray(root?.services)) {
    throw new Error("2FAS file has no 'services' list.");
  }
  const out: ParsedOtpauth[] = [];
  for (const s of root.services) {
    const type = (s.otp?.tokenType ?? "TOTP").toUpperCase();
    if (type !== "TOTP") continue;
    if (!s.secret) continue;
    out.push({
      issuer: (s.otp?.issuer || s.name || "Unknown").trim(),
      label: (s.otp?.account || "").trim(),
      secret: s.secret.replace(/\s+/g, "").toUpperCase(),
      algorithm: normalizeAlgo(s.otp?.algorithm),
      digits: s.otp?.digits ?? 6,
      period: s.otp?.period ?? 30,
    });
  }
  return out;
}

// -- Line-delimited otpauth:// URIs --
export function parseOtpauthList(text: string): { entries: ParsedOtpauth[]; skipped: number } {
  const lines = text
    .split(/[\r\n]+/)
    .map((l) => l.trim())
    .filter((l) => l.startsWith("otpauth://"));
  const out: ParsedOtpauth[] = [];
  let skipped = 0;
  for (const line of lines) {
    try {
      out.push(parseOtpauthUri(line));
    } catch {
      skipped++;
    }
  }
  return { entries: out, skipped };
}

/**
 * Auto-detect a pasted string or parsed JSON blob and return a normalised
 * list of entries. Throws with a human-readable message when nothing
 * matches — the UI surfaces this in a Notice.
 */
export function importFromText(input: string): ImportResult {
  const trimmed = input.trim();
  if (!trimmed) throw new Error("Nothing to import — paste a code or upload a file.");

  if (trimmed.startsWith("otpauth-migration://")) {
    return {
      source: "otpauth-migration",
      entries: parseGoogleAuthMigrationUri(trimmed),
      skipped: 0,
    };
  }

  if (trimmed.startsWith("otpauth://")) {
    const { entries, skipped } = parseOtpauthList(trimmed);
    return { source: "otpauth", entries, skipped };
  }

  // Multiple otpauth:// lines mixed with anything else
  if (trimmed.includes("otpauth://")) {
    const { entries, skipped } = parseOtpauthList(trimmed);
    if (entries.length > 0) return { source: "otpauth", entries, skipped };
  }

  // JSON?
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    let json: unknown;
    try {
      json = JSON.parse(trimmed);
    } catch {
      throw new Error("Couldn't parse that as JSON.");
    }
    return importFromJson(json);
  }

  throw new Error(
    "Format not recognised. Paste an otpauth:// URL, an otpauth-migration:// URL, or an Aegis / 2FAS JSON export.",
  );
}

export function importFromJson(json: unknown): ImportResult {
  const root = json as Record<string, unknown> | null;
  if (root && typeof root === "object") {
    if ("db" in root) {
      return { source: "aegis", entries: parseAegisJson(json), skipped: 0 };
    }
    if ("services" in root || "servicesEncrypted" in root) {
      return { source: "2fas", entries: parse2FASJson(json), skipped: 0 };
    }
    if (isAvfJson(root)) {
      throw new Error(
        "This is an encrypted Aegis backup (.avf). Enter its export passphrase to unlock.",
      );
    }
  }
  throw new Error("JSON doesn't look like an Aegis, 2FAS, or Aegis Vault File export.");
}

/** Detect a passphrase-encrypted Aegis vault file (.avf). */
export function isAvfJson(json: unknown): json is EncryptedExportFile {
  const r = json as { format?: unknown; version?: unknown; kdf?: unknown; cipher?: unknown };
  return (
    !!r &&
    typeof r === "object" &&
    r.format === AVF_FORMAT &&
    typeof r.version === "number" &&
    typeof r.kdf === "object" &&
    typeof r.cipher === "object"
  );
}

/**
 * Decrypt an `.avf` file with the given export passphrase and return the
 * accounts as ParsedOtpauth entries ready for the preview stage.
 */
export async function importFromAvf(
  file: EncryptedExportFile,
  passphrase: string,
): Promise<ImportResult> {
  const accounts = await decryptExportedFile(file, passphrase);
  const entries: ParsedOtpauth[] = accounts.map((a) => ({
    issuer: (a.issuer || a.label || "Unknown").trim(),
    label: (a.label || "").trim(),
    secret: a.secret.replace(/\s+/g, "").toUpperCase(),
    algorithm: normalizeAlgo(a.algorithm),
    digits: a.digits ?? 6,
    period: a.period ?? 30,
  }));
  return { source: "avf", entries, skipped: 0 };
}

export function sourceLabel(s: ImportSource): string {
  switch (s) {
    case "otpauth-migration":
      return "Google Authenticator";
    case "otpauth":
      return "otpauth links";
    case "aegis":
      return "Aegis";
    case "2fas":
      return "2FAS";
    case "avf":
      return "Aegis Vault File";
    default:
      return "Import";
  }
}

