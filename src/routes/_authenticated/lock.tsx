import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  createNewVaultKey,
  unwrapVaultKey,
  toBytes,
  toByteaHex,
  KDF_ALGORITHM,
} from "@/lib/vault-crypto";
import { setVaultKey } from "@/lib/vault-session";
import { Shield, Lock, ArrowRight, Loader2, KeyRound } from "lucide-react";

const CREAM = "#f7f4ed";
const CHARCOAL = "#1c1c1a";
const MUTED = "#8a8a86";
const BORDER = "rgba(28,28,26,0.12)";

const searchSchema = z.object({
  redirect: z.string().optional(),
});

export const Route = createFileRoute("/_authenticated/lock")({
  validateSearch: searchSchema,
  component: LockPage,
  errorComponent: ({ error }) => (
    <div className="flex min-h-screen items-center justify-center p-6 text-sm">
      {error.message}
    </div>
  ),
  notFoundComponent: () => <div className="p-6 text-sm">Not found</div>,
});

type Mode = "loading" | "create" | "unlock";

function safeRedirect(target: string | undefined): string {
  if (!target) return "/vault";
  try {
    // Only allow same-origin relative paths that start with a single slash.
    if (target.startsWith("/") && !target.startsWith("//")) return target;
  } catch {
    /* ignore */
  }
  return "/vault";
}

function LockPage() {
  const navigate = useNavigate();
  const search = Route.useSearch();
  const { user } = Route.useRouteContext();

  const [mode, setMode] = useState<Mode>("loading");
  const [passphrase, setPassphrase] = useState("");
  const [confirmPass, setConfirmPass] = useState("");
  const [hint, setHint] = useState("");
  const [passphraseHint, setPassphraseHint] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<{ kind: "error" | "info"; text: string } | null>(null);

  // Detect whether vault_meta already exists to pick create vs unlock.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("vault_meta")
        .select("passphrase_hint")
        .eq("user_id", user.id)
        .maybeSingle();
      if (cancelled) return;
      if (error) {
        setNotice({ kind: "error", text: error.message });
        setMode("unlock");
        return;
      }
      if (data) {
        setPassphraseHint(data.passphrase_hint ?? null);
        setMode("unlock");
      } else {
        setMode("create");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user.id]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setNotice(null);
    if (passphrase.length < 10) {
      setNotice({ kind: "error", text: "Use at least 10 characters." });
      return;
    }
    if (passphrase !== confirmPass) {
      setNotice({ kind: "error", text: "The two passphrases don't match." });
      return;
    }
    setLoading(true);
    try {
      const { salt, wrappedKey, wrappedKeyIv, dek, kdfAlgorithm } =
        await createNewVaultKey(passphrase);

      const { error } = await supabase.from("vault_meta").insert({
        user_id: user.id,
        kdf_salt: toByteaHex(salt),
        kdf_algorithm: kdfAlgorithm,
        recovery_wrapped_key: toByteaHex(wrappedKey),
        recovery_wrapped_key_iv: toByteaHex(wrappedKeyIv),
        passphrase_hint: hint.trim() ? hint.trim() : null,
      });
      if (error) throw error;
      setVaultKey(dek);
      navigate({ to: safeRedirect(search.redirect), replace: true });
    } catch (err) {
      setNotice({ kind: "error", text: err instanceof Error ? err.message : "Could not create vault." });
    } finally {
      setLoading(false);
    }
  };

  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    setNotice(null);
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("vault_meta")
        .select("kdf_salt, recovery_wrapped_key, recovery_wrapped_key_iv, kdf_algorithm")
        .eq("user_id", user.id)
        .single();
      if (error) throw error;
      if (data.kdf_algorithm !== KDF_ALGORITHM) {
        throw new Error("Vault was created with a different key algorithm.");
      }
      const dek = await unwrapVaultKey(
        passphrase,
        toBytes(data.kdf_salt),
        toBytes(data.recovery_wrapped_key),
        toBytes(data.recovery_wrapped_key_iv),
      );
      setVaultKey(dek);
      navigate({ to: safeRedirect(search.redirect), replace: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not unlock.";
      // AES-GCM auth failure is generic; surface a friendlier hint.
      setNotice({
        kind: "error",
        text: /operation-specific reason|OperationError|decrypt/i.test(msg)
          ? "That passphrase didn't match."
          : msg,
      });
    } finally {
      setLoading(false);
    }
  };

  if (mode === "loading") {
    return (
      <div
        className="fixed inset-0 flex items-center justify-center"
        style={{ background: CREAM, color: CHARCOAL }}
      >
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  const isCreate = mode === "create";

  return (
    <div className="fixed inset-0 flex flex-col overflow-hidden" style={{ background: CREAM, color: CHARCOAL }}>
      <div className="mx-auto flex h-full w-full max-w-[440px] flex-col px-6 pt-[max(20px,env(safe-area-inset-top))] pb-[max(24px,env(safe-area-inset-bottom))]">
        <div className="flex items-center gap-2 pb-8">
          <Shield className="h-4 w-4" strokeWidth={1.8} />
          <span className="text-[13px] font-medium tracking-tight">Aegis</span>
        </div>

        <div className="flex flex-1 flex-col justify-center gap-6">
          <div className="flex flex-col items-start gap-3">
            <div
              className="flex h-12 w-12 items-center justify-center rounded-2xl"
              style={{ background: "rgba(28,28,26,0.06)" }}
            >
              {isCreate ? (
                <KeyRound className="h-5 w-5" strokeWidth={1.6} />
              ) : (
                <Lock className="h-5 w-5" strokeWidth={1.6} />
              )}
            </div>
            <div className="flex flex-col gap-1.5">
              <h1
                className="text-[32px] leading-[1.05] tracking-tight"
                style={{ fontFamily: "'Instrument Serif', serif" }}
              >
                {isCreate ? "Set your master passphrase." : "Welcome back."}
              </h1>
              <p className="text-[14px] leading-relaxed" style={{ color: MUTED }}>
                {isCreate
                  ? "This key never leaves your device. Aegis can't recover it — remember it well."
                  : "Enter your master passphrase to unlock your codes."}
              </p>
              {!isCreate && passphraseHint && (
                <p className="mt-1 text-[12.5px]" style={{ color: MUTED }}>
                  Hint: <span style={{ color: CHARCOAL }}>{passphraseHint}</span>
                </p>
              )}
            </div>
          </div>

          <form onSubmit={isCreate ? handleCreate : handleUnlock} className="flex flex-col gap-3">
            <Field icon={<Lock className="h-4 w-4" strokeWidth={1.6} />}>
              <input
                type="password"
                autoComplete={isCreate ? "new-password" : "current-password"}
                autoFocus
                required
                minLength={isCreate ? 10 : 1}
                placeholder={isCreate ? "Create a memorable passphrase" : "Master passphrase"}
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                className="w-full bg-transparent text-[15px] outline-none"
                style={{ color: CHARCOAL }}
              />
            </Field>

            {isCreate && (
              <>
                <Field icon={<Lock className="h-4 w-4" strokeWidth={1.6} />}>
                  <input
                    type="password"
                    autoComplete="new-password"
                    required
                    minLength={10}
                    placeholder="Confirm passphrase"
                    value={confirmPass}
                    onChange={(e) => setConfirmPass(e.target.value)}
                    className="w-full bg-transparent text-[15px] outline-none"
                    style={{ color: CHARCOAL }}
                  />
                </Field>
                <Field icon={<KeyRound className="h-4 w-4" strokeWidth={1.6} />}>
                  <input
                    type="text"
                    placeholder="Optional hint (never the passphrase itself)"
                    value={hint}
                    onChange={(e) => setHint(e.target.value)}
                    className="w-full bg-transparent text-[15px] outline-none"
                    style={{ color: CHARCOAL }}
                    maxLength={80}
                  />
                </Field>
              </>
            )}

            {notice && (
              <div
                className="rounded-xl px-3 py-2 text-[12.5px] leading-snug"
                style={{
                  background: notice.kind === "error" ? "rgba(180,40,40,0.08)" : "rgba(28,28,26,0.05)",
                  color: notice.kind === "error" ? "#8a2020" : CHARCOAL,
                }}
              >
                {notice.text}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="mt-1 flex h-[46px] items-center justify-center gap-2 rounded-full text-[14px] font-medium disabled:opacity-60"
              style={{ background: CHARCOAL, color: CREAM }}
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  {isCreate ? "Create vault" : "Unlock"}
                  <ArrowRight className="h-[15px] w-[15px]" strokeWidth={1.8} />
                </>
              )}
            </button>
          </form>

          {isCreate && (
            <p className="text-center text-[11.5px] leading-snug" style={{ color: MUTED }}>
              If you forget this passphrase, your codes cannot be recovered.
              <br />
              A printable recovery sheet is coming in a later step.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div
      className="flex items-center gap-2.5 rounded-2xl border px-3.5 h-[46px]"
      style={{ borderColor: BORDER, background: "rgba(255,255,255,0.55)" }}
    >
      <span style={{ color: MUTED }}>{icon}</span>
      {children}
    </div>
  );
}
