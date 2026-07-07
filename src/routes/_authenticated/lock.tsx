import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { supabase } from "@/integrations/supabase/client";
import {
  createNewVaultKey,
  unwrapVaultKey,
  toBytes,
  toByteaHex,
  KDF_ALGORITHM,
} from "@/lib/vault-crypto";
import { setVaultKey } from "@/lib/vault-session";
import {
  disableBiometric,
  enrollBiometric,
  isBiometricEnabled,
  isBiometricPending,
  isBiometricSupported,
  unlockWithBiometric,
} from "@/lib/biometric";
import {
  ArrowRight,
  Delete,
  Fingerprint,
  Loader2,
  LogOut,
  Power,
  Wifi,
} from "lucide-react";
import {
  isPinEnabled,
  unlockWithPin,
  PinUnlockError,
  disablePin,
} from "@/lib/pin-unlock";

const searchSchema = z.object({ redirect: z.string().optional() });

export const Route = createFileRoute("/_authenticated/lock")({
  validateSearch: searchSchema,
  head: () => ({
    meta: [
      { title: "Unlock your Aegis vault" },
      {
        name: "description",
        content:
          "Enter your passphrase to decrypt your TOTP codes locally on this device.",
      },
      { name: "robots", content: "noindex, nofollow" },
      { property: "og:title", content: "Unlock your Aegis vault" },
      {
        property: "og:description",
        content: "Passphrase gate that unlocks your Aegis vault on this device.",
      },
      { property: "og:url", content: "https://aegis-syed.lovable.app/lock" },
    ],
  }),
  component: LockPage,
  errorComponent: ({ error }) => (
    <div className="flex min-h-screen items-center justify-center bg-[#0b1a3a] p-6 text-sm text-white/90">
      {error.message}
    </div>
  ),
  notFoundComponent: () => <div className="p-6 text-sm">Not found</div>,
});

type Mode = "loading" | "create" | "unlock";
type UnlockMethod = "pin" | "passphrase";

function safeRedirect(target: string | undefined): string {
  if (!target) return "/vault";
  if (target.startsWith("/") && !target.startsWith("//")) return target;
  return "/vault";
}

// -------------------------------------------------------------
// Windows 11 style backdrop — deep blue, bloom orbs, subtle grain
// -------------------------------------------------------------
function Win11Backdrop() {
  return (
    <>
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-[#0a2456] via-[#123974] to-[#050e26]" />
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background: `
            radial-gradient(60% 45% at 15% 20%, rgba(120,170,255,0.32), transparent 60%),
            radial-gradient(70% 50% at 85% 25%, rgba(180,130,255,0.24), transparent 65%),
            radial-gradient(80% 60% at 50% 100%, rgba(60,120,220,0.32), transparent 60%)
          `,
        }}
      />
      <div
        className="pointer-events-none absolute inset-0 opacity-40 mix-blend-overlay"
        style={{
          backgroundImage:
            "radial-gradient(rgba(255,255,255,0.06) 1px, transparent 1px)",
          backgroundSize: "3px 3px",
        }}
      />
    </>
  );
}

function Win11PinPad({
  value,
  onChange,
  onComplete,
  disabled,
  shake,
}: {
  value: string;
  onChange: (v: string) => void;
  onComplete: (v: string) => void;
  disabled?: boolean;
  shake?: boolean;
}) {
  const dots = Array.from({ length: 6 }, (_, i) => i < value.length);
  const press = (d: string) => {
    if (disabled || value.length >= 6) return;
    const n = value + d;
    onChange(n);
    if (n.length === 6) onComplete(n);
  };
  const back = () => {
    if (disabled || !value.length) return;
    onChange(value.slice(0, -1));
  };
  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "back"];
  return (
    <div className="flex w-full flex-col items-center gap-5">
      <motion.div
        animate={shake ? { x: [0, -8, 8, -6, 6, -3, 3, 0] } : { x: 0 }}
        transition={{ duration: 0.45 }}
        className="flex items-center gap-2.5"
        aria-hidden
      >
        {dots.map((f, i) => (
          <div
            key={i}
            className="h-2.5 w-2.5 rounded-full transition-colors"
            style={{
              background: f ? "#fff" : "transparent",
              border: `1.5px solid ${f ? "#fff" : "rgba(255,255,255,0.45)"}`,
            }}
          />
        ))}
      </motion.div>
      <div className="grid w-full max-w-[248px] grid-cols-3 gap-2">
        {keys.map((k, i) => {
          if (k === "") return <div key={i} />;
          if (k === "back") {
            return (
              <motion.button
                key={i}
                type="button"
                onClick={back}
                disabled={disabled || !value.length}
                whileTap={{ scale: 0.94 }}
                className="flex h-[54px] items-center justify-center rounded-full border border-white/10 bg-white/5 text-white/85 backdrop-blur transition-colors hover:bg-white/10 disabled:opacity-40"
                aria-label="Delete last digit"
              >
                <Delete className="h-[18px] w-[18px]" strokeWidth={1.5} />
              </motion.button>
            );
          }
          return (
            <motion.button
              key={i}
              type="button"
              onClick={() => press(k)}
              disabled={disabled}
              whileTap={{ scale: 0.92 }}
              className="flex h-[54px] items-center justify-center rounded-full border border-white/10 bg-white/5 text-[22px] font-light text-white backdrop-blur transition-colors hover:bg-white/10 disabled:opacity-40"
              aria-label={`Digit ${k}`}
            >
              {k}
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}

const glassInput =
  "w-full rounded-lg border border-white/15 bg-white/10 px-4 py-3 text-[15px] text-white placeholder:text-white/50 outline-none transition-colors focus:border-white/50 focus:bg-white/15";

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
  const [bioAvailable, setBioAvailable] = useState(false);
  const [bioEnrolled, setBioEnrolled] = useState(false);
  const [bioBusy, setBioBusy] = useState(false);
  const [bioAutoTried, setBioAutoTried] = useState(false);
  const [pinEnrolled, setPinEnrolled] = useState<boolean>(() => isPinEnabled(user.id));
  const [pinValue, setPinValue] = useState("");
  const [pinBusy, setPinBusy] = useState(false);
  const [pinShake, setPinShake] = useState(false);
  const [unlockMethod, setUnlockMethod] = useState<UnlockMethod>(() =>
    isPinEnabled(user.id) ? "pin" : "passphrase",
  );
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 20_000);
    return () => window.clearInterval(t);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supported = await isBiometricSupported();
      if (cancelled) return;
      setBioAvailable(supported);
      setBioEnrolled(isBiometricEnabled(user.id));
    })();
    return () => {
      cancelled = true;
    };
  }, [user.id]);

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

  const maybeEnrollBiometric = async (dekBytes: Uint8Array) => {
    if (!isBiometricPending()) return;
    if (!(await isBiometricSupported())) return;
    try {
      await enrollBiometric({ userId: user.id, userEmail: user.email ?? user.id, dekBytes });
      setBioEnrolled(true);
    } catch {
      // Silent: they can enable it later from Security settings.
    }
  };

  const consumeImportIntent = () => {
    try {
      const intent = window.localStorage.getItem("aegis.onboarding.intent");
      if (!intent) return null;
      window.localStorage.removeItem("aegis.onboarding.intent");
      return intent;
    } catch {
      return null;
    }
  };

  const routeAfterUnlock = () => {
    const intent = consumeImportIntent();
    if (intent === "scan" || intent === "manual") {
      navigate({ to: "/vault/new", replace: true });
    } else {
      navigate({ to: safeRedirect(search.redirect), replace: true });
    }
  };

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
      const { salt, wrappedKey, wrappedKeyIv, dek, rawDek, kdfAlgorithm } =
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
      setVaultKey(dek, rawDek);
      await maybeEnrollBiometric(rawDek);
      routeAfterUnlock();
    } catch (err) {
      setNotice({
        kind: "error",
        text: err instanceof Error ? err.message : "Could not create vault.",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    setNotice(null);
    if (!passphrase) {
      setNotice({ kind: "error", text: "Enter your passphrase." });
      return;
    }
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
      try {
        const { dek, rawDek } = await unwrapVaultKey(
          passphrase,
          toBytes(data.kdf_salt),
          toBytes(data.recovery_wrapped_key),
          toBytes(data.recovery_wrapped_key_iv),
        );
        setVaultKey(dek, rawDek);
        await maybeEnrollBiometric(rawDek);
        routeAfterUnlock();
      } catch (cryptoErr) {
        const raw = cryptoErr instanceof Error ? cryptoErr.message : "";
        const name = (cryptoErr as { name?: string })?.name ?? "";
        if (
          !raw ||
          /OperationError|InvalidAccess|decrypt|unwrap|operation-specific/i.test(raw) ||
          /OperationError|InvalidAccessError/i.test(name)
        ) {
          throw new Error("That passphrase didn't match.");
        }
        throw cryptoErr;
      }
    } catch (err) {
      setNotice({
        kind: "error",
        text: err instanceof Error && err.message ? err.message : "Could not unlock.",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleBiometricUnlock = async () => {
    setNotice(null);
    setBioBusy(true);
    try {
      const { dek, rawDek } = await unlockWithBiometric(user.id);
      setVaultKey(dek, rawDek);
      routeAfterUnlock();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Biometric unlock failed.";
      if (/isn't set up|InvalidState/i.test(msg)) {
        disableBiometric(user.id);
        setBioEnrolled(false);
      }
      if (!/NotAllowed|cancell?ed|aborted/i.test(msg)) {
        setNotice({ kind: "error", text: msg });
      }
    } finally {
      setBioBusy(false);
    }
  };

  const handlePinComplete = async (pin: string) => {
    if (pinBusy) return;
    setNotice(null);
    setPinBusy(true);
    try {
      const { dek, rawDek } = await unlockWithPin(user.id, pin);
      setVaultKey(dek, rawDek);
      routeAfterUnlock();
    } catch (err) {
      if (err instanceof PinUnlockError) {
        setPinShake(true);
        window.setTimeout(() => setPinShake(false), 500);
        setPinValue("");
        if (err.code === "locked-out") {
          setPinEnrolled(false);
          setUnlockMethod("passphrase");
        }
        setNotice({ kind: "error", text: err.message });
      } else {
        setNotice({
          kind: "error",
          text: err instanceof Error ? err.message : "PIN unlock failed.",
        });
      }
    } finally {
      setPinBusy(false);
    }
  };

  useEffect(() => {
    if (mode !== "unlock" || !bioAvailable || !bioEnrolled || bioAutoTried) return;
    if (unlockMethod === "pin" && pinEnrolled) return;
    setBioAutoTried(true);
    const t = window.setTimeout(() => {
      void handleBiometricUnlock();
    }, 250);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, bioAvailable, bioEnrolled, bioAutoTried, unlockMethod, pinEnrolled]);

  const displayName = useMemo(() => {
    const email = user.email ?? "";
    const local = email.split("@")[0] ?? "";
    if (!local) return "You";
    return local.charAt(0).toUpperCase() + local.slice(1);
  }, [user.email]);
  const initials = useMemo(() => {
    const parts = displayName.split(/[\s._-]+/).filter(Boolean);
    const chars = parts.slice(0, 2).map((p: string) => p.charAt(0).toUpperCase());
    return chars.join("") || "A";
  }, [displayName]);

  const timeStr = now.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const dateStr = now.toLocaleDateString([], {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  if (mode === "loading") {
    return (
      <div className="relative flex min-h-[100dvh] w-full items-center justify-center overflow-hidden bg-[#0b1a3a]">
        <Win11Backdrop />
        <Loader2 className="relative z-10 h-6 w-6 animate-spin text-white/80" />
      </div>
    );
  }

  const isCreate = mode === "create";

  const cycleSignIn = () => {
    setNotice(null);
    setPassphrase("");
    setPinValue("");
    setUnlockMethod((m) => (m === "pin" ? "passphrase" : "pin"));
  };

  const doReset = async () => {
    const ok = window.confirm(
      "Reset your vault?\n\nThis erases your saved passphrase and every stored code. Only do this if you've lost access.",
    );
    if (!ok) return;
    setLoading(true);
    setNotice(null);
    try {
      const acctRes = await supabase.from("vault_accounts").delete().eq("user_id", user.id);
      if (acctRes.error) throw acctRes.error;
      const metaRes = await supabase.from("vault_meta").delete().eq("user_id", user.id);
      if (metaRes.error) throw metaRes.error;
      disableBiometric(user.id);
      disablePin(user.id);
      setBioEnrolled(false);
      setPinEnrolled(false);
      setPinValue("");
      setUnlockMethod("passphrase");
      setPassphrase("");
      setConfirmPass("");
      setHint("");
      setPassphraseHint(null);
      setBioAutoTried(false);
      setMode("create");
    } catch (err) {
      setNotice({
        kind: "error",
        text: err instanceof Error ? err.message : "Reset failed.",
      });
    } finally {
      setLoading(false);
    }
  };

  const doSignOut = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  };

  const showPin = !isCreate && unlockMethod === "pin" && pinEnrolled;

  return (
    <div className="relative flex min-h-[100dvh] w-full flex-col overflow-hidden bg-[#0b1a3a] text-white">
      <Win11Backdrop />

      {/* Top-left clock (Windows 11 style) */}
      <div className="pointer-events-none absolute left-6 top-6 z-10 sm:left-14 sm:top-12">
        <div
          className="text-[64px] font-extralight leading-none tracking-tight drop-shadow-[0_2px_20px_rgba(0,0,0,0.35)] sm:text-[96px]"
          style={{ fontFeatureSettings: '"tnum"' }}
        >
          {timeStr}
        </div>
        <div className="mt-2 text-[15px] font-light text-white/85 sm:text-[19px]">
          {dateStr}
        </div>
      </div>

      {/* Center sign-in card */}
      <div className="relative z-10 flex flex-1 flex-col items-center justify-end px-5 pb-28 pt-44 sm:justify-center sm:pb-16 sm:pt-24">
        <div className="flex w-full max-w-[380px] flex-col items-center gap-6 rounded-[28px] border border-white/10 bg-white/[0.06] px-6 py-7 shadow-[0_20px_60px_-20px_rgba(0,0,0,0.6)] backdrop-blur-2xl sm:px-8 sm:py-8">
          {/* Avatar */}
          <div className="flex h-[96px] w-[96px] items-center justify-center rounded-full border border-white/20 bg-gradient-to-br from-white/30 to-white/5 text-[30px] font-light shadow-[inset_0_1px_0_rgba(255,255,255,0.35)]">
            {initials}
          </div>

          <div className="flex flex-col items-center gap-1">
            <div className="text-[20px] font-normal tracking-tight">{displayName}</div>
            <div className="text-[11px] font-medium uppercase tracking-[0.22em] text-white/60">
              {isCreate
                ? "Set up your vault"
                : showPin
                  ? "Enter PIN"
                  : "Enter passphrase"}
            </div>
            {!isCreate && passphraseHint && !showPin && (
              <p className="mt-1 text-[12px] text-white/60">
                Hint: <span className="text-white/85">{passphraseHint}</span>
              </p>
            )}
          </div>

          <AnimatePresence mode="wait" initial={false}>
            {showPin ? (
              <motion.div
                key="pin"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.18 }}
                className="w-full"
              >
                <Win11PinPad
                  value={pinValue}
                  onChange={setPinValue}
                  onComplete={handlePinComplete}
                  disabled={pinBusy}
                  shake={pinShake}
                />
              </motion.div>
            ) : (
              <motion.form
                key={isCreate ? "create" : "pass"}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.18 }}
                onSubmit={isCreate ? handleCreate : handleUnlock}
                className="flex w-full flex-col gap-3"
              >
                <div className="relative">
                  <input
                    type="password"
                    value={passphrase}
                    onChange={(e) => setPassphrase(e.target.value)}
                    placeholder={isCreate ? "Create a memorable passphrase" : "Passphrase"}
                    autoComplete={isCreate ? "new-password" : "current-password"}
                    autoFocus={!bioEnrolled}
                    minLength={isCreate ? 10 : 1}
                    className={glassInput + " pr-12"}
                  />
                  {!isCreate && (
                    <button
                      type="submit"
                      disabled={loading || !passphrase}
                      aria-label="Unlock"
                      className="absolute right-1.5 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-md bg-white/90 text-[#0b1a3a] transition-colors hover:bg-white disabled:opacity-40"
                    >
                      {loading ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <ArrowRight className="h-4 w-4" strokeWidth={2} />
                      )}
                    </button>
                  )}
                </div>

                {isCreate && (
                  <>
                    <input
                      type="password"
                      value={confirmPass}
                      onChange={(e) => setConfirmPass(e.target.value)}
                      placeholder="Confirm passphrase"
                      autoComplete="new-password"
                      minLength={10}
                      className={glassInput}
                    />
                    <input
                      type="text"
                      value={hint}
                      onChange={(e) => setHint(e.target.value)}
                      placeholder="Optional hint (never the passphrase)"
                      maxLength={80}
                      className={glassInput}
                    />
                    <button
                      type="submit"
                      disabled={loading || !passphrase || passphrase !== confirmPass}
                      className="mt-1 flex h-11 items-center justify-center gap-2 rounded-lg bg-white/95 text-[14px] font-medium text-[#0b1a3a] transition-colors hover:bg-white disabled:opacity-50"
                    >
                      {loading ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <>Create vault</>
                      )}
                    </button>
                  </>
                )}
              </motion.form>
            )}
          </AnimatePresence>

          {notice && (
            <div
              role="alert"
              className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-center text-[12.5px] text-white/90"
            >
              {notice.text}
            </div>
          )}

          {!isCreate && bioEnrolled && bioAvailable && (
            <button
              type="button"
              onClick={handleBiometricUnlock}
              disabled={bioBusy}
              className="flex items-center gap-1.5 text-[12.5px] text-white/70 transition-colors hover:text-white disabled:opacity-50"
            >
              {bioBusy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Fingerprint className="h-3.5 w-3.5" strokeWidth={1.6} />
              )}
              <span>Use biometrics</span>
            </button>
          )}
        </div>

        {isCreate && (
          <p className="mt-5 max-w-[380px] text-center text-[11.5px] leading-snug text-white/60">
            Your passphrase never leaves this device. If you forget it, your codes cannot be recovered.
          </p>
        )}
      </div>

      {/* Bottom bar — sign-in options (left) + system icons (right) */}
      <div className="relative z-10 flex items-end justify-between gap-3 px-5 pb-5 sm:px-12 sm:pb-8">
        <div className="flex flex-col gap-2">
          {!isCreate && pinEnrolled && (
            <button
              type="button"
              onClick={cycleSignIn}
              className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3.5 py-2 text-[12.5px] text-white/85 backdrop-blur transition-colors hover:bg-white/10"
            >
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-white/70" />
              Sign-in options
            </button>
          )}
          {!isCreate && (
            <button
              type="button"
              onClick={doReset}
              className="text-left text-[11.5px] text-white/50 transition-colors hover:text-white/80"
            >
              Forgot passphrase? Reset vault
            </button>
          )}
        </div>

        <div className="flex items-center gap-2">
          <div
            aria-hidden
            className="hidden h-9 w-9 items-center justify-center rounded-full text-white/70 sm:flex"
          >
            <Wifi className="h-4 w-4" strokeWidth={1.6} />
          </div>
          {!isCreate && (
            <button
              type="button"
              onClick={doSignOut}
              aria-label="Sign out"
              title="Sign out"
              className="flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white/85 backdrop-blur transition-colors hover:bg-white/10"
            >
              <LogOut className="h-4 w-4" strokeWidth={1.6} />
            </button>
          )}
          <div
            aria-hidden
            className="hidden h-9 w-9 items-center justify-center rounded-full text-white/70 sm:flex"
          >
            <Power className="h-4 w-4" strokeWidth={1.6} />
          </div>
        </div>
      </div>
    </div>
  );
}
