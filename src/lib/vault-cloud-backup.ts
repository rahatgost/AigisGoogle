// Encrypted cloud backup — upload/list/restore/delete .avf files in the
// private `vault-backups` storage bucket. The blob is the same
// passphrase-wrapped AES-GCM envelope produced by buildEncryptedExport
// (see vault-export.ts): the server never sees plaintext secrets or the
// export passphrase. Objects live under `<user_id>/<name>.avf`; storage
// RLS enforces that a user can only read their own folder.

import { supabase } from "@/integrations/supabase/client";
import {
  buildEncryptedExport,
  decryptExportedFile,
  serializeExport,
  type EncryptedExportFile,
  type ExportedAccount,
} from "@/lib/vault-export";
import { addAccount, listAccounts, type DecryptedAccount } from "@/lib/vault-accounts";

const BUCKET = "vault-backups";

export interface CloudBackupEntry {
  name: string;              // full object path, e.g. `<uid>/2026-11-05T…-manual.avf`
  fileName: string;          // just the file part, for display
  size: number;
  createdAt: string;
  updatedAt: string;
}

function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

export async function uploadCloudBackup(
  userId: string,
  accounts: DecryptedAccount[],
  passphrase: string,
  opts?: { label?: string },
): Promise<CloudBackupEntry> {
  if (accounts.length === 0) throw new Error("Your vault is empty — nothing to back up.");
  const file = await buildEncryptedExport(accounts, passphrase);
  const json = serializeExport(file);
  const blob = new Blob([json], { type: "application/json" });
  const label = (opts?.label ?? "manual").replace(/[^a-zA-Z0-9-_]/g, "-").slice(0, 32) || "manual";
  const fileName = `${stamp()}-${label}.avf`;
  const path = `${userId}/${fileName}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, blob, {
    contentType: "application/json",
    upsert: false,
  });
  if (error) throw new Error(error.message);
  return {
    name: path,
    fileName,
    size: blob.size,
    createdAt: file.exportedAt,
    updatedAt: file.exportedAt,
  };
}

export async function listCloudBackups(userId: string): Promise<CloudBackupEntry[]> {
  const { data, error } = await supabase.storage.from(BUCKET).list(userId, {
    limit: 100,
    sortBy: { column: "created_at", order: "desc" },
  });
  if (error) throw new Error(error.message);
  return (data ?? [])
    .filter((f) => f.name.endsWith(".avf"))
    .map((f) => ({
      name: `${userId}/${f.name}`,
      fileName: f.name,
      size: f.metadata?.size ?? 0,
      createdAt: f.created_at ?? "",
      updatedAt: f.updated_at ?? f.created_at ?? "",
    }));
}

export async function deleteCloudBackup(path: string): Promise<void> {
  const { error } = await supabase.storage.from(BUCKET).remove([path]);
  if (error) throw new Error(error.message);
}

async function fetchBackupFile(path: string): Promise<EncryptedExportFile> {
  const { data, error } = await supabase.storage.from(BUCKET).download(path);
  if (error) throw new Error(error.message);
  const text = await data.text();
  return JSON.parse(text) as EncryptedExportFile;
}

export async function decryptCloudBackup(
  path: string,
  passphrase: string,
): Promise<ExportedAccount[]> {
  const file = await fetchBackupFile(path);
  return decryptExportedFile(file, passphrase);
}

export interface RestoreSummary {
  restored: number;
  skipped: number;
  failed: number;
}

// Restore backup entries into the live vault. Duplicates (same issuer+label+secret)
// are skipped rather than doubled up.
export async function restoreCloudBackup(
  path: string,
  passphrase: string,
  dek: CryptoKey,
  userId: string,
): Promise<RestoreSummary> {
  const entries = await decryptCloudBackup(path, passphrase);
  const existing = await listAccounts(dek);
  const key = (issuer: string, label: string, secret: string) =>
    `${issuer.toLowerCase()}|${label.toLowerCase()}|${secret.toUpperCase()}`;
  const seen = new Set(existing.map((a) => key(a.issuer, a.label, a.secret)));

  const summary: RestoreSummary = { restored: 0, skipped: 0, failed: 0 };
  for (const e of entries) {
    if (seen.has(key(e.issuer, e.label, e.secret))) {
      summary.skipped++;
      continue;
    }
    try {
      await addAccount(dek, userId, {
        issuer: e.issuer,
        label: e.label,
        secret: e.secret,
        algorithm: e.algorithm,
        digits: e.digits,
        period: e.period,
        otp_type: e.otp_type,
        counter: e.counter,
      });
      seen.add(key(e.issuer, e.label, e.secret));
      summary.restored++;
    } catch {
      summary.failed++;
    }
  }
  return summary;
}

export function formatBackupSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}
