import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { supabase } from "@/integrations/supabase/client";
import {
  createNewVaultKey,
  unwrapVaultKey,
  upgradeKdfToV2,
  needsKdfUpgrade,
  toBytes,
  toByteaHex,
} from "@/lib/vault-crypto";
import { setVaultKey } from "@/lib/vault-session";
import { runV3Migration } from "@/lib/vault-migrator";
import { ensureUserKeys } from "@/lib/vault-sharing-crypto";
import {
  getFailureCount,
  recordFailure,
  recordSuccess,
  remainingCooldownMs,
} from "@/lib/unlock-throttle";
import {
  disableBiometric,
  enrollBiometric,
  isBiometricEnabled,
  isBiometricPending,
  isBiometricSupported,
  unlockWithBiometric,
} from "@/lib/biometric";
import {
  PIN_MAX_LENGTH,
  PIN_MIN_LENGTH,
  disablePin,
  enrollPin,
  isPinEnabled,
  unlockWithPin,
} from "@/lib/pin";
import { KeyRound, Fingerprint, LogOut, Delete, Loader2 } from "lucide-react";
import { CHARCOAL, MUTED, BORDER, CREAM_SOFT } from "@/components/aegis/chrome";
import {
  FieldGroup,
  InlineNotice,
  StarfieldHeroLayout,
} from "@/components/aegis/starfield-hero";
import { PasswordField, StrengthMeter, scoreStrength } from "@/components/aegis/password-field";
import vaultIllustration from "@/assets/vault-illustration.png.asset.json";

/* Charcoal primary button — matches onboarding's PrimaryButton language. */
const INK_INSET_SHADOW =
  "rgba(255,255,255,0.2) 0 0.5px 0 0 inset, rgba(0,0,0,0.2) 0 0 0 0.5px inset, rgba(0,0,0,0.05) 0 1px 2px 0";

function DarkButton({
  children,
  type = "button",
  loading,
  disabled,
  onClick,
}: {
  children: React.ReactNode;
  type?: "button" | "submit";
  loading?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}) {
  const isDisabled = disabled || loading;
  return (
    <motion.button
      type={type}
      onClick={onClick}
      disabled={isDisabled}
      whileTap={isDisabled ? undefined : { scale: 0.985, opacity: 0.9 }}
      transition={{ type: "spring", stiffness: 260, damping: 30, mass: 0.9 }}
      className="relative flex h-[48px] w-full items-center justify-center rounded-[10px] text-[15px] outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:opacity-60"
      style={{
        background: CHARCOAL,
        color: CREAM_SOFT,
        fontWeight: 500,
        letterSpacing: "-0.005em",
        boxShadow: INK_INSET_SHADOW,
        ["--tw-ring-color" as string]: "rgb(var(--aegis-ink-rgb) / 0.35)",
        ["--tw-ring-offset-color" as string]: "var(--aegis-cream)",
      }}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : children}
    </motion.button>
  );
}

const searchSchema = z.object({ redirect: z.string().optional() });

export const Route = createFileRoute("/_authenticated/lock")({
  validateSearch: searchSchema,
  head: () => ({
    meta: [
      { title: "Unlock your Aegis vault" },
      {
        name: "description",
        content:
          "Enter your passphrase or PIN to decrypt your TOTP codes locally on this device.",
      },
      { name: "robots", content: "noindex, nofollow" },
      { property: "og:title", content: "Unlock your Aegis vault" },
      {
        property: "og:description",
        content: "Passphrase, PIN and biometric unlock for your Aegis vault.",
      },
      { property: "og:url", content: "https://aegis-syed.lovable.app/lock" },
    ],
  }),
  component: LockPage,
  errorComponent: ({ error }) => (
    <div className="flex min-h-screen items-center justify-center p-6 text-sm">{error.message}</div>
  ),
  notFoundComponent: () => <div className="p-6 text-sm">Not found</div>,
});

type Mode = "loading" | "create" | "unlock";
type Tab = "passphrase" | "pin";

function safeRedirect(target: string | undefined): string {
  if (!target) return "/vault";
  if (target.startsWith("/") && !target.startsWith("//")) return target;
  return "/vault";
}

async function finishUnlock(userId: string, dek: CryptoKey, routeAfterUnlock: () => void) {
  await ensureUserKeys(userId, dek);
  void runV3Migration(userId, dek);
  routeAfterUnlock();
}

function LockPage() {
  const navigate = useNavigate();
  const search = Route.useSearch();
  const { user } = Route.useRouteContext();

  const [mode, setMode] = useState<Mode>("loading");
  const [tab, setTab] = useState<Tab>("passphrase");
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

  const [pinEnrolled, setPinEnrolled] = useState(false);
  const [pin, setPin] = useState("");
  const [pinSetup, setPinSetup] = useState<{ step: "choose" | "confirm"; first: string } | null>(
    null,
  );

  const [cooldownLeft, setCooldownLeft] = useState<number>(() =>
    remainingCooldownMs(user.id),
  );

  useEffect(() => {
    if (cooldownLeft <= 0) return;
    const id = window.setInterval(() => {
      setCooldownLeft(remainingCooldownMs(user.id));
    }, 500);
    return () => window.clearInterval(id);
  }, [cooldownLeft, user.id]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supported = await isBiometricSupported();
      if (cancelled) return;
      setBioAvailable(supported);
      setBioEnrolled(isBiometricEnabled(user.id));
      setPinEnrolled(isPinEnabled(user.id));
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

  const maybeEnrollBiometric = async (dek: CryptoKey) => {
    if (!isBiometricPending()) return;
    if (!(await isBiometricSupported())) return;
    try {
      await enrollBiometric({ userId: user.id, userEmail: user.email ?? user.id, dek });
      setBioEnrolled(true);
    } catch {
      /* silent */
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

  /* ---------------- passphrase flows ---------------- */

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
      await maybeEnrollBiometric(dek);
      await finishUnlock(user.id, dek, routeAfterUnlock);
    } catch (err) {
      setNotice({
        kind: "error",
        text: err instanceof Error ? err.message : "Could not create vault.",
      });
    } finally {
      setLoading(false);
    }
  };

  const unlockDekWithPassphrase = async (): Promise<CryptoKey> => {
    const { data, error } = await supabase
      .from("vault_meta")
      .select("kdf_salt, recovery_wrapped_key, recovery_wrapped_key_iv, kdf_algorithm")
      .eq("user_id", user.id)
      .single();
    if (error) throw error;
    const currentAlgo = data.kdf_algorithm;
    const salt = toBytes(data.kdf_salt);
    const wrappedKey = toBytes(data.recovery_wrapped_key);
    const wrappedIv = toBytes(data.recovery_wrapped_key_iv);
    const dek = await unwrapVaultKey(passphrase, salt, wrappedKey, wrappedIv, currentAlgo);
    if (needsKdfUpgrade(currentAlgo)) {
      void (async () => {
        try {
          const upgraded = await upgradeKdfToV2(
            passphrase,
            salt,
            wrappedKey,
            wrappedIv,
            currentAlgo,
          );
          await supabase
            .from("vault_meta")
            .update({
              kdf_salt: toByteaHex(upgraded.salt),
              kdf_algorithm: upgraded.kdfAlgorithm,
              recovery_wrapped_key: toByteaHex(upgraded.wrappedKey),
              recovery_wrapped_key_iv: toByteaHex(upgraded.wrappedKeyIv),
            })
            .eq("user_id", user.id);
        } catch (upgradeErr) {
          console.warn("[vault] KDF upgrade failed, will retry", upgradeErr);
        }
      })();
    }
    return dek;
  };

  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    setNotice(null);
    if (!passphrase) {
      setNotice({ kind: "error", text: "Enter your passphrase." });
      return;
    }
    const waitMs = remainingCooldownMs(user.id);
    if (waitMs > 0) {
      setCooldownLeft(waitMs);
      setNotice({
        kind: "error",
        text: `Too many attempts. Try again in ${Math.ceil(waitMs / 1000)}s.`,
      });
      return;
    }
    setLoading(true);
    try {
      try {
        const dek = await unlockDekWithPassphrase();
        recordSuccess(user.id);
        setCooldownLeft(0);
        setVaultKey(dek);
        await maybeEnrollBiometric(dek);
        await finishUnlock(user.id, dek, routeAfterUnlock);
      } catch (cryptoErr) {
        const raw = cryptoErr instanceof Error ? cryptoErr.message : "";
        const name = (cryptoErr as { name?: string })?.name ?? "";
        if (
          !raw ||
          /OperationError|InvalidAccess|decrypt|unwrap|operation-specific/i.test(raw) ||
          /OperationError|InvalidAccessError/i.test(name)
        ) {
          const cooldown = recordFailure(user.id);
          if (cooldown > 0) {
            setCooldownLeft(cooldown);
            throw new Error(
              `That passphrase didn't match. Try again in ${Math.ceil(cooldown / 1000)}s.`,
            );
          }
          const fails = getFailureCount(user.id);
          throw new Error(
            fails > 1
              ? `That passphrase didn't match. (${fails} attempts)`
              : "That passphrase didn't match.",
          );
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

  /* ---------------- biometric ---------------- */

  const handleBiometricUnlock = async () => {
    setNotice(null);
    setBioBusy(true);
    try {
      const dek = await unlockWithBiometric(user.id);
      setVaultKey(dek);
      await finishUnlock(user.id, dek, routeAfterUnlock);
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

  // Auto-prompt biometric only when the passphrase tab is showing.
  useEffect(() => {
    if (mode !== "unlock" || tab !== "passphrase") return;
    if (!bioAvailable || !bioEnrolled || bioAutoTried) return;
    setBioAutoTried(true);
    const t = window.setTimeout(() => {
      void handleBiometricUnlock();
    }, 250);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, tab, bioAvailable, bioEnrolled, bioAutoTried]);

  /* ---------------- pin ---------------- */

  const handlePinUnlock = async (submitted: string) => {
    setNotice(null);
    const waitMs = remainingCooldownMs(user.id);
    if (waitMs > 0) {
      setCooldownLeft(waitMs);
      setNotice({
        kind: "error",
        text: `Too many attempts. Try again in ${Math.ceil(waitMs / 1000)}s.`,
      });
      return;
    }
    setLoading(true);
    try {
      const dek = await unlockWithPin(user.id, submitted);
      recordSuccess(user.id);
      setCooldownLeft(0);
      setVaultKey(dek);
      await finishUnlock(user.id, dek, routeAfterUnlock);
    } catch (err) {
      const raw = err instanceof Error ? err.message : "";
      const name = (err as { name?: string })?.name ?? "";
      if (
        !raw ||
        /OperationError|InvalidAccess|decrypt|unwrap/i.test(raw) ||
        /OperationError|InvalidAccessError/i.test(name)
      ) {
        const cooldown = recordFailure(user.id);
        setPin("");
        if (cooldown > 0) {
          setCooldownLeft(cooldown);
          setNotice({
            kind: "error",
            text: `Wrong PIN. Try again in ${Math.ceil(cooldown / 1000)}s.`,
          });
        } else {
          setNotice({ kind: "error", text: "Wrong PIN. Try again." });
        }
      } else {
        setNotice({ kind: "error", text: raw || "Could not unlock." });
      }
    } finally {
      setLoading(false);
    }
  };

  const handlePinSetupSubmit = async (submitted: string) => {
    if (!pinSetup) return;
    if (pinSetup.step === "choose") {
      setPinSetup({ step: "confirm", first: submitted });
      setPin("");
      return;
    }
    // confirm step
    if (submitted !== pinSetup.first) {
      setNotice({ kind: "error", text: "PINs don't match. Start over." });
      setPin("");
      setPinSetup({ step: "choose", first: "" });
      return;
    }
    if (!passphrase) {
      setNotice({
        kind: "error",
        text: "Enter your passphrase below to confirm PIN setup.",
      });
      setTab("passphrase");
      return;
    }
    setLoading(true);
    setNotice(null);
    try {
      const dek = await unlockDekWithPassphrase();
      await enrollPin({ userId: user.id, pin: submitted, dek });
      setPinEnrolled(true);
      setPinSetup(null);
      setPin("");
      recordSuccess(user.id);
      setVaultKey(dek);
      await maybeEnrollBiometric(dek);
      await finishUnlock(user.id, dek, routeAfterUnlock);
    } catch (err) {
      setNotice({
        kind: "error",
        text: err instanceof Error && err.message ? err.message : "PIN setup failed.",
      });
      setPin("");
      setPinSetup({ step: "choose", first: "" });
    } finally {
      setLoading(false);
    }
  };

  // Auto-submit PIN once it reaches the max length (or on Enter).
  useEffect(() => {
    if (tab !== "pin") return;
    if (pin.length < PIN_MIN_LENGTH) return;
    if (pinEnrolled) {
      if (pin.length >= PIN_MIN_LENGTH && pin.length <= PIN_MAX_LENGTH) {
        // Wait a tick so the last digit paints before we submit.
        const t = window.setTimeout(() => {
          if (pin.length >= PIN_MIN_LENGTH) void handlePinUnlock(pin);
        }, 120);
        return () => window.clearTimeout(t);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin, tab, pinEnrolled]);

  /* ---------------- render ---------------- */

  if (mode === "loading") {
    return (
      <StarfieldHeroLayout heroKey="loading" heroTitle="Unlock your vault">
        <div className="flex flex-1 items-center justify-center py-10">
          <Loader2 className="h-5 w-5 animate-spin opacity-60" />
        </div>
      </StarfieldHeroLayout>
    );
  }

  const isCreate = mode === "create";

  if (isCreate) {
    return (
      <StarfieldHeroLayout
        heroKey="create"
        heroTitle="Set your passphrase"
        heroSubtitle="This key never leaves your device. Aegis can't recover it — pick something memorable."
      >
        <form onSubmit={handleCreate} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <span
              className="text-[12.5px] font-medium"
              style={{ color: MUTED, letterSpacing: "-0.005em" }}
            >
              Passphrase
            </span>
            <PasswordField
              value={passphrase}
              onChange={setPassphrase}
              autoComplete="new-password"
              autoFocus
              minLength={10}
              placeholder="Create a memorable passphrase"
            />
          </div>
          <StrengthMeter value={passphrase} />
          <div className="flex flex-col gap-1.5">
            <span
              className="text-[12.5px] font-medium"
              style={{ color: MUTED, letterSpacing: "-0.005em" }}
            >
              Confirm
            </span>
            <PasswordField
              value={confirmPass}
              onChange={setConfirmPass}
              autoComplete="new-password"
              minLength={10}
              placeholder="Confirm passphrase"
              delay={0.05}
            />
          </div>
          <FieldGroup label="Hint (optional)">
            <KeyRound className="h-4 w-4" strokeWidth={1.6} style={{ color: MUTED }} />
            <input
              type="text"
              placeholder="Never the passphrase itself"
              value={hint}
              onChange={(e) => setHint(e.target.value)}
              className="w-full bg-transparent text-[15px] outline-none placeholder:text-[color:var(--tw-placeholder,rgba(0,0,0,0.35))]"
              style={{ color: CHARCOAL }}
              maxLength={80}
            />
          </FieldGroup>

          {notice && <InlineNotice kind={notice.kind}>{notice.text}</InlineNotice>}

          <div className="pt-1">
            <DarkButton
              type="submit"
              loading={loading}
              disabled={
                !passphrase ||
                scoreStrength(passphrase) < 2 ||
                passphrase !== confirmPass
              }
            >
              Create vault
            </DarkButton>
          </div>

          <p
            className="pt-1 text-center text-[11.5px] leading-snug"
            style={{ color: MUTED }}
          >
            If you forget this passphrase, your codes can't be recovered.
          </p>
        </form>
      </StarfieldHeroLayout>
    );
  }

  return (
    <StarfieldHeroLayout
      heroKey="unlock"
      heroTitle={<span className="block max-w-[62%] sm:max-w-[70%]">Unlock your vault</span>}
      heroMinVh={22}
      heroAccessory={<VaultIllustration />}
    >
      <SegmentedTabs
        value={tab}
        onChange={(next) => {
          setTab(next);
          setNotice(null);
          setPin("");
          if (next === "pin" && !pinEnrolled && !pinSetup) {
            setPinSetup({ step: "choose", first: "" });
          }
          if (next === "passphrase") {
            setPinSetup(null);
          }
        }}
      />


      <AnimatePresence mode="wait" initial={false}>
        {tab === "passphrase" ? (
          <motion.form
            key="passphrase"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.18 }}
            onSubmit={handleUnlock}
            className="flex flex-col gap-3"
          >
            <div className="flex flex-col gap-1.5">
              <span
                className="text-[12.5px] font-medium"
                style={{ color: MUTED, letterSpacing: "-0.005em" }}
              >
                Passphrase
              </span>
              <PasswordField
                value={passphrase}
                onChange={setPassphrase}
                autoComplete="current-password"
                autoFocus={!bioEnrolled}
                placeholder="Master passphrase"
              />
            </div>

            {passphraseHint && (
              <p className="px-1 text-[12px]" style={{ color: MUTED }}>
                Hint: <span style={{ color: CHARCOAL }}>{passphraseHint}</span>
              </p>
            )}

            {notice && <InlineNotice kind={notice.kind}>{notice.text}</InlineNotice>}

            <DarkButton
              type="submit"
              loading={loading}
              disabled={!passphrase || cooldownLeft > 0}
            >
              {cooldownLeft > 0 ? `Wait ${Math.ceil(cooldownLeft / 1000)}s` : "Unlock vault"}
            </DarkButton>

            {(bioEnrolled && bioAvailable) || pinEnrolled ? <OrDivider /> : null}

            {bioEnrolled && bioAvailable && (
              <SecondaryPill
                onClick={handleBiometricUnlock}
                busy={bioBusy}
                icon={<Fingerprint className="h-4 w-4" strokeWidth={1.8} />}
                label="Continue with Biometrics"
              />
            )}
          </motion.form>
        ) : (
          <motion.div
            key="pin"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.18 }}
            className="flex flex-col gap-3"
          >
            <PinDisplay
              length={pin.length}
              label={
                pinSetup
                  ? pinSetup.step === "choose"
                    ? "Choose a PIN"
                    : "Confirm PIN"
                  : "Enter your PIN"
              }
              busy={loading}
            />

            <Keypad
              onDigit={(d) => {
                setNotice(null);
                setPin((p) => (p.length >= PIN_MAX_LENGTH ? p : p + d));
              }}
              onDelete={() => setPin((p) => p.slice(0, -1))}
              onSubmit={() => {
                if (pin.length < PIN_MIN_LENGTH) return;
                if (pinSetup) void handlePinSetupSubmit(pin);
                else void handlePinUnlock(pin);
              }}
              submitReady={pin.length >= PIN_MIN_LENGTH}
              setupMode={!!pinSetup}
            />

            {notice && <InlineNotice kind={notice.kind}>{notice.text}</InlineNotice>}

            {pinSetup && (
              <p className="text-center text-[11.5px]" style={{ color: MUTED }}>
                {pinSetup.step === "choose"
                  ? `Pick ${PIN_MIN_LENGTH}–${PIN_MAX_LENGTH} digits, then confirm.`
                  : "Re-enter the same PIN. You'll be asked for your passphrase once."}
              </p>
            )}

            {pinEnrolled && (bioEnrolled && bioAvailable) && (
              <>
                <OrDivider />
                <SecondaryPill
                  onClick={handleBiometricUnlock}
                  busy={bioBusy}
                  icon={<Fingerprint className="h-4 w-4" strokeWidth={1.8} />}
                  label="Continue with Biometrics"
                />
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <div className="mt-auto flex flex-col items-center gap-1.5 pt-2">
        <button
          type="button"
          onClick={async () => {
            const ok = window.confirm(
              "Reset your vault?\n\nThis erases your saved passphrase and every stored code. Only do this if you've lost access.",
            );
            if (!ok) return;
            setLoading(true);
            setNotice(null);
            try {
              const acctRes = await supabase
                .from("vault_accounts")
                .delete()
                .eq("user_id", user.id);
              if (acctRes.error) throw acctRes.error;
              const metaRes = await supabase
                .from("vault_meta")
                .delete()
                .eq("user_id", user.id);
              if (metaRes.error) throw metaRes.error;
              disableBiometric(user.id);
              disablePin(user.id);
              setBioEnrolled(false);
              setPinEnrolled(false);
              setPassphrase("");
              setConfirmPass("");
              setHint("");
              setPin("");
              setPinSetup(null);
              setPassphraseHint(null);
              setBioAutoTried(false);
              setMode("create");
              setTab("passphrase");
            } catch (err) {
              setNotice({
                kind: "error",
                text: err instanceof Error ? err.message : "Reset failed.",
              });
            } finally {
              setLoading(false);
            }
          }}
          className="text-[12.5px] underline-offset-4 transition-opacity hover:underline"
          style={{ color: MUTED }}
        >
          Forgot passphrase? Reset vault
        </button>
        <button
          type="button"
          onClick={async () => {
            await supabase.auth.signOut();
            navigate({ to: "/auth", replace: true });
          }}
          className="flex items-center gap-1.5 text-[12.5px] transition-opacity hover:opacity-100"
          style={{ color: MUTED, opacity: 0.75 }}
        >
          <LogOut className="h-3.5 w-3.5" strokeWidth={1.6} />
          <span>Sign out</span>
        </button>
      </div>
    </StarfieldHeroLayout>
  );
}

/* -------------------------------------------------------------------------- */
/*  Sub-components                                                            */
/* -------------------------------------------------------------------------- */

function SegmentedTabs({
  value,
  onChange,
}: {
  value: Tab;
  onChange: (v: Tab) => void;
}) {
  const items: { id: Tab; label: string }[] = [
    { id: "passphrase", label: "Passphrase" },
    { id: "pin", label: "PIN" },
  ];
  return (
    <div
      className="relative grid grid-cols-2 rounded-[12px] p-1"
      style={{
        background: "rgb(var(--aegis-ink-rgb) / 0.05)",
        border: `1px solid ${BORDER}`,
      }}
    >
      {items.map((it) => {
        const active = value === it.id;
        return (
          <button
            key={it.id}
            type="button"
            onClick={() => onChange(it.id)}
            className="relative z-10 h-9 rounded-[9px] text-[13.5px] font-medium transition-colors"
            style={{
              color: active ? CHARCOAL : MUTED,
              letterSpacing: "-0.005em",
            }}
          >
            {active && (
              <motion.span
                layoutId="lock-tab-active"
                className="absolute inset-0 -z-10 rounded-[9px]"
                style={{
                  background: "#ffffff",
                  boxShadow:
                    "0 1px 2px rgba(0,0,0,0.06), 0 4px 10px -6px rgba(0,0,0,0.15)",
                  border: `1px solid ${BORDER}`,
                }}
                transition={{ type: "spring", stiffness: 380, damping: 32 }}
              />
            )}
            {it.label}
          </button>
        );
      })}
    </div>
  );
}

function OrDivider() {
  return (
    <div className="flex items-center gap-3 py-1">
      <div className="h-px flex-1" style={{ background: "rgb(var(--aegis-ink-rgb) / 0.1)" }} />
      <span className="text-[11.5px]" style={{ color: MUTED }}>
        Or
      </span>
      <div className="h-px flex-1" style={{ background: "rgb(var(--aegis-ink-rgb) / 0.1)" }} />
    </div>
  );
}

function SecondaryPill({
  onClick,
  busy,
  icon,
  label,
}: {
  onClick: () => void;
  busy?: boolean;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      disabled={busy}
      whileTap={busy ? undefined : { scale: 0.985 }}
      className="flex h-[48px] w-full items-center justify-center gap-2 rounded-[12px] text-[14.5px] font-medium disabled:opacity-60"
      style={{
        background: "#ffffff",
        border: `1px solid ${BORDER}`,
        color: CHARCOAL,
        boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
      }}
    >
      {busy ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <>
          <span style={{ color: CHARCOAL }}>{icon}</span>
          <span>{label}</span>
        </>
      )}
    </motion.button>
  );
}

function PinDisplay({
  length,
  label,
  busy,
}: {
  length: number;
  label: string;
  busy?: boolean;
}) {
  const dots = Array.from({ length: PIN_MAX_LENGTH });
  return (
    <div className="flex flex-col items-center gap-1.5">
      <span className="text-[12px]" style={{ color: MUTED, letterSpacing: "-0.005em" }}>
        {label}
      </span>
      <div
        className="flex h-[44px] w-full items-center justify-center gap-2 rounded-[12px]"
        style={{
          background: CREAM_SOFT,
          border: `1px solid ${BORDER}`,
          boxShadow: "inset 0 1px 0 rgba(255,255,255,0.5)",
        }}
      >
        {busy ? (
          <Loader2 className="h-4 w-4 animate-spin opacity-60" />
        ) : (
          dots.map((_, i) => {
            const filled = i < length;
            const past = i < PIN_MIN_LENGTH;
            return (
              <motion.span
                key={i}
                animate={{ scale: filled ? 1 : 0.9 }}
                transition={{ type: "spring", stiffness: 500, damping: 24 }}
                className="rounded-full"
                style={{
                  width: filled ? 10 : 7,
                  height: filled ? 10 : 7,
                  background: filled
                    ? CHARCOAL
                    : past
                      ? "rgb(var(--aegis-ink-rgb) / 0.25)"
                      : "rgb(var(--aegis-ink-rgb) / 0.12)",
                }}
              />
            );
          })
        )}
      </div>
    </div>
  );
}

function Keypad({
  onDigit,
  onDelete,
  onSubmit,
  submitReady,
  setupMode,
}: {
  onDigit: (d: string) => void;
  onDelete: () => void;
  onSubmit: () => void;
  submitReady: boolean;
  setupMode: boolean;
}) {
  const btnRef = useRef<HTMLDivElement>(null);
  const keys = useMemo(
    () => [
      "1",
      "2",
      "3",
      "4",
      "5",
      "6",
      "7",
      "8",
      "9",
      setupMode ? "next" : "",
      "0",
      "del",
    ],
    [setupMode],
  );

  // Keyboard support.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (/^[0-9]$/.test(e.key)) {
        e.preventDefault();
        onDigit(e.key);
      } else if (e.key === "Backspace") {
        e.preventDefault();
        onDelete();
      } else if (e.key === "Enter" && submitReady) {
        e.preventDefault();
        onSubmit();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onDigit, onDelete, onSubmit, submitReady]);

  return (
    <div
      ref={btnRef}
      className="grid w-full grid-cols-3 gap-2 sm:gap-2.5"
      style={{ gridAutoRows: "minmax(52px, 1fr)" }}
    >
      {keys.map((k, i) => {
        if (k === "") return <span key={i} />;
        if (k === "del") {
          return (
            <KeypadButton
              key={i}
              onClick={onDelete}
              variant="ghost"
              ariaLabel="Delete"
            >
              <Delete className="h-5 w-5" strokeWidth={1.7} />
            </KeypadButton>
          );
        }
        if (k === "next") {
          return (
            <KeypadButton
              key={i}
              onClick={onSubmit}
              variant="primary"
              disabled={!submitReady}
              ariaLabel="Continue"
            >
              <span className="text-[13px] font-semibold">Next</span>
            </KeypadButton>
          );
        }
        return (
          <KeypadButton key={i} onClick={() => onDigit(k)} ariaLabel={`Digit ${k}`}>
            <span className="text-[20px] font-semibold tabular-nums leading-none">{k}</span>
          </KeypadButton>
        );
      })}
    </div>
  );
}

function VaultIllustration() {
  return (
    <div className="relative h-full w-full" aria-hidden>
      {/* Ambient green glow bleeding into the starfield */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(55% 55% at 65% 55%, rgba(46,196,105,0.32), transparent 72%)",
          filter: "blur(6px)",
        }}
      />
      <motion.div
        initial={{ opacity: 0, x: 20, scale: 0.9 }}
        animate={{ opacity: 1, x: 0, scale: 1 }}
        transition={{ type: "spring", stiffness: 220, damping: 22, mass: 0.9 }}
        className="absolute inset-0 flex items-center justify-center pr-3 sm:pr-5"
      >
        <motion.img
          src={vaultIllustration.url}
          alt=""
          draggable={false}
          animate={{ y: [0, -4, 0], rotate: [0, -1.2, 0] }}
          transition={{ duration: 5.5, repeat: Infinity, ease: "easeInOut" }}
          className="pointer-events-none h-[150px] w-auto select-none sm:h-[180px]"
          style={{
            filter:
              "drop-shadow(0 18px 28px rgba(0,0,0,0.55)) drop-shadow(0 0 28px rgba(46,196,105,0.35))",
          }}
        />
      </motion.div>
    </div>
  );
}


function KeypadButton({
  onClick,
  children,
  variant = "digit",
  disabled,
  ariaLabel,
}: {
  onClick: () => void;
  children: React.ReactNode;
  variant?: "digit" | "ghost" | "primary";
  disabled?: boolean;
  ariaLabel?: string;
}) {
  const base =
    "flex h-full min-h-[52px] w-full items-center justify-center rounded-[16px] outline-none focus-visible:ring-2 focus-visible:ring-offset-1 transition-colors disabled:opacity-40 touch-manipulation select-none";
  const styles: Record<typeof variant, React.CSSProperties> = {
    digit: {
      background: CREAM_SOFT,
      border: `1px solid ${BORDER}`,
      color: CHARCOAL,
      boxShadow: "inset 0 1px 0 rgba(255,255,255,0.5), 0 1px 2px rgba(0,0,0,0.04)",
    },
    ghost: {
      background: "transparent",
      color: CHARCOAL,
    },
    primary: {
      background: CHARCOAL,
      color: CREAM_SOFT,
      boxShadow:
        "rgba(255,255,255,0.2) 0 0.5px 0 0 inset, rgba(0,0,0,0.2) 0 0 0 0.5px inset, 0 6px 14px -8px rgba(0,0,0,0.4)",
    },
  };
  return (
    <motion.button
      type="button"
      onClick={onClick}
      disabled={disabled}
      whileTap={disabled ? undefined : { scale: 0.94 }}
      transition={{ type: "spring", stiffness: 500, damping: 26 }}
      aria-label={ariaLabel}
      className={base}
      style={{
        ...styles[variant],
        WebkitTapHighlightColor: "transparent",
      }}
    >
      {children}
    </motion.button>
  );
}
