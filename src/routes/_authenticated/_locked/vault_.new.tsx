import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";
import { AnimatePresence, motion } from "framer-motion";
import { getVaultKey } from "@/lib/vault-session";
import { useOnlineStatus } from "@/lib/use-online";
import {
  addAccount,
  isValidBase32Secret,
  parseOtpauthUri,
  type Algorithm,
} from "@/lib/vault-accounts";
import { TagInput } from "@/components/vault/tags";
import { ScanTab } from "@/components/vault/ScanTab";
import {
  ArrowLeft,
  ScanLine,
  PenLine,
  ChevronDown,
  KeyRound,
  WifiOff,
} from "lucide-react";
import {
  AegisScreen,
  BORDER,
  CHARCOAL,
  CREAM_SOFT,
  MUTED,
  Notice,
  PrimaryButton,
  soft,
} from "@/components/aegis/chrome";
import { AppBar, AppBarButton, SectionLabel, SettingsGroup } from "@/components/aegis/settings";
import { BottomTabs } from "@/components/aegis/BottomTabs";

// Phase 6.1: accept an inbound `otpauth://` payload from the PWA
// protocol handler + Web Share Target so a scan/share from another app
// lands straight on Add Account with the URI pre-parsed.
const searchSchema = z.object({
  uri: z.string().optional().catch(undefined),
});

export const Route = createFileRoute("/_authenticated/_locked/vault_/new")({
  validateSearch: searchSchema,
  component: NewAccountPage,
  errorComponent: ({ error }) => (
    <div className="flex min-h-screen items-center justify-center p-6 text-sm">{error.message}</div>
  ),
  notFoundComponent: () => <div className="p-6 text-sm">Not found</div>,
});

type Tab = "scan" | "manual";

function NewAccountPage() {
  const navigate = useNavigate();
  const { user } = Route.useRouteContext();
  const { uri: incomingUri } = Route.useSearch();
  const [tab, setTab] = useState<Tab>("scan");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ kind: "error" | "info"; text: string } | null>(null);
  // Bumped when a QR-triggered save fails so ScanTab can fully re-mount the
  // camera; without this the user is stuck with a frozen preview after any
  // save-side error (offline, expired key, server rejection).
  const [scanAttempt, setScanAttempt] = useState(0);
  const online = useOnlineStatus();
  // Latch so a deep-linked `?uri=` is consumed exactly once per navigation.
  const handledIncomingRef = useRef(false);

  const save = useCallback(
    async (input: {
      issuer: string;
      label: string;
      secret: string;
      algorithm?: Algorithm;
      digits?: number;
      period?: number;
      tags?: string[];
    }): Promise<boolean> => {
      const key = getVaultKey();
      if (!key) {
        navigate({ to: "/lock", search: { redirect: "/vault/new" } });
        return false;
      }
      setSaving(true);
      setNotice(null);
      try {
        const { queued } = await addAccount(key, user.id, input);
        if (queued) {
          toastNoticeQueued();
        }
        navigate({ to: "/vault", replace: true });
        return true;
      } catch (err) {
        setNotice({ kind: "error", text: err instanceof Error ? err.message : "Could not save." });
        return false;
      } finally {
        setSaving(false);
      }
    },
    [user.id, navigate],
  );

  // Small helper so we don't need to import toast up top just for this.
  function toastNoticeQueued() {
    setNotice({
      kind: "info",
      text: "Saved offline — will sync automatically when you reconnect.",
    });
  }

  const handleQrDetected = useCallback(
    async (uri: string) => {
      let parsed;
      try {
        parsed = parseOtpauthUri(uri);
      } catch (err) {
        setNotice({
          kind: "error",
          text: err instanceof Error ? err.message : "That QR isn't a valid otpauth code.",
        });
        setScanAttempt((n) => n + 1);
        return;
      }
      const ok = await save(parsed);
      if (!ok) setScanAttempt((n) => n + 1);
    },
    [save],
  );

  const handleScanError = useCallback((msg: string) => {
    setNotice({ kind: "error", text: msg });
  }, []);

  const switchToManual = useCallback(() => setTab("manual"), []);

  // Phase 6.1: consume an inbound `?uri=otpauth://…` from the PWA
  // protocol handler / Share Target exactly once per navigation. Runs
  // once `save` is stable and only if the URI actually looks like an
  // otpauth payload — a share sheet can dump arbitrary text on us.
  useEffect(() => {
    if (handledIncomingRef.current) return;
    if (!incomingUri) return;
    let decoded: string;
    try {
      decoded = decodeURIComponent(incomingUri);
    } catch {
      decoded = incomingUri;
    }
    if (!decoded.startsWith("otpauth://")) return;
    handledIncomingRef.current = true;
    void handleQrDetected(decoded);
  }, [incomingUri, handleQrDetected]);

  return (
    <AegisScreen>
      <div
        className="aegis-scroll -mx-6 -mt-[max(28px,env(safe-area-inset-top))] flex-1 overflow-y-auto overflow-x-hidden overscroll-contain px-6 pb-[calc(112px+env(safe-area-inset-bottom))]"
        style={{ WebkitOverflowScrolling: "touch" as never }}
      >
        <AppBar
          title="Add account"
          trailing={
            <AppBarButton label="Back" onClick={() => navigate({ to: "/vault" })}>
              <ArrowLeft className="h-4 w-4" strokeWidth={1.8} />
            </AppBarButton>
          }
        />

        {/* Compact hero */}
        <div className="flex flex-col gap-1.5 pt-2 pb-4">
          <h1
            className="text-[26px] leading-[1.1]"
            style={{
              color: CHARCOAL,
              fontFamily: "'Geist', ui-sans-serif, system-ui, sans-serif",
              fontWeight: 600,
              letterSpacing: "-0.025em",
            }}
          >
            {tab === "scan" ? "Scan a code" : "Enter by hand"}
          </h1>
          <p className="text-[13.5px] leading-[1.4]" style={{ color: MUTED }}>
            {tab === "scan"
              ? "Point at the QR shown by any service. We'll do the rest."
              : "Type the secret shown as text on the service's setup screen."}
          </p>
        </div>

        <SegmentedTabs tab={tab} setTab={setTab} />

        <div className="flex items-center justify-between pt-3">
          <span className="text-[11.5px]" style={{ color: MUTED }}>
            Coming from another app?
          </span>
          <button
            type="button"
            onClick={() => navigate({ to: "/vault/import" })}
            className="rounded-full px-3 py-1.5 text-[12px] transition-colors"
            style={{
              background: CREAM_SOFT,
              border: `1px solid ${BORDER}`,
              color: CHARCOAL,
              fontWeight: 600,
              boxShadow: "inset 0 1px 0 rgba(255,255,255,0.5)",
            }}
          >
            Bulk import →
          </button>
        </div>

        {!online && (
          <div
            className="mt-3 flex items-center gap-2 rounded-full px-3.5 py-2 text-[12px]"
            style={{
              background: CREAM_SOFT,
              border: `1px solid ${BORDER}`,
              color: MUTED,
              boxShadow: "inset 0 1px 0 rgba(255,255,255,0.5)",
            }}
          >
            <WifiOff className="h-3.5 w-3.5 shrink-0" strokeWidth={1.8} />
            <span>You're offline — adding an account is disabled until you reconnect.</span>
          </div>
        )}

        {notice && (
          <div className="pt-3">
            <Notice kind={notice.kind}>{notice.text}</Notice>
          </div>
        )}


        <div className="pt-4">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={tab}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={soft}
            >
              {tab === "scan" ? (
                !online ? (
                  <div
                    className="flex flex-col items-center justify-center gap-3 rounded-2xl px-6 py-14 text-center"
                    style={{
                      background: CREAM_SOFT,
                      border: `1px solid ${BORDER}`,
                      color: MUTED,
                    }}
                  >
                    <WifiOff className="h-6 w-6" strokeWidth={1.6} />
                    <div className="text-[13px]" style={{ color: CHARCOAL, fontWeight: 600 }}>
                      Scanner unavailable offline
                    </div>
                    <div className="text-[12px] leading-relaxed max-w-[260px]">
                      QR scanning needs the encrypted vault to reach the server. Reconnect to add a new account.
                    </div>
                  </div>
                ) : (
                  <ScanTab
                    key={scanAttempt}
                    onDetected={handleQrDetected}
                    onError={handleScanError}
                    saving={saving}
                    switchToManual={switchToManual}
                  />
                )
              ) : (
                <ManualTab onSubmit={save} saving={saving} />
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
      <BottomTabs />
    </AegisScreen>
  );
}

function SegmentedTabs({ tab, setTab }: { tab: Tab; setTab: (t: Tab) => void }) {
  return (
    <div
      className="relative flex h-11 rounded-full p-1"
      style={{
        background: CREAM_SOFT,
        border: `1px solid ${BORDER}`,
        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.6), 0 1px 2px rgba(28,28,28,0.04)",
      }}
    >
      <SegButton
        active={tab === "scan"}
        onClick={() => setTab("scan")}
        icon={<ScanLine className="h-3.5 w-3.5" strokeWidth={1.8} />}
      >
        Scan QR
      </SegButton>
      <SegButton
        active={tab === "manual"}
        onClick={() => setTab("manual")}
        icon={<PenLine className="h-3.5 w-3.5" strokeWidth={1.8} />}
      >
        Enter manually
      </SegButton>
    </div>
  );
}

function SegButton({
  active,
  onClick,
  children,
  icon,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  icon: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className="relative flex flex-1 items-center justify-center gap-1.5 rounded-full text-[12.5px]"
      style={{
        color: active ? CHARCOAL : MUTED,
        fontWeight: active ? 600 : 500,
        letterSpacing: "-0.005em",
      }}
    >
      {active && (
        <motion.span
          layoutId="add-tab-pill"
          className="absolute inset-0 rounded-full"
          style={{
            background: "#ffffff",
            border: `1px solid ${BORDER}`,
            boxShadow: "0 1px 2px rgba(28,28,28,0.06), 0 4px 12px -6px rgba(28,28,28,0.12)",
          }}
          transition={{ type: "spring", stiffness: 400, damping: 34 }}
        />
      )}
      <span className="relative flex items-center gap-1.5">
        {icon}
        {children}
      </span>
    </button>
  );
}


function ManualTab({
  onSubmit,
  saving,
}: {
  onSubmit: (v: {
    issuer: string;
    label: string;
    secret: string;
    algorithm: Algorithm;
    digits: number;
    period: number;
    tags: string[];
  }) => void;
  saving: boolean;
}) {
  const [issuer, setIssuer] = useState("");
  const [label, setLabel] = useState("");
  const [secret, setSecret] = useState("");
  const [algorithm, setAlgorithm] = useState<Algorithm>("SHA1");
  const [digits, setDigits] = useState(6);
  const [period, setPeriod] = useState(30);
  const [tags, setTags] = useState<string[]>([]);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [localErr, setLocalErr] = useState<string | null>(null);

  const secretValid = secret.length > 0 && isValidBase32Secret(secret);
  const canSubmit = issuer.trim().length > 0 && secretValid && !saving;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setLocalErr(null);
    if (!issuer.trim()) return setLocalErr("Add an issuer, like 'GitHub'.");
    if (!isValidBase32Secret(secret))
      return setLocalErr("Secret must be base32 (letters A–Z and digits 2–7).");
    onSubmit({ issuer, label, secret, algorithm, digits, period, tags });
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-1">
      <SectionLabel>Account</SectionLabel>
      <SettingsGroup>
        <FieldRow
          label="Issuer"
          value={issuer}
          onChange={setIssuer}
          placeholder="GitHub"
          autoFocus
        />
        <FieldRow label="Account" value={label} onChange={setLabel} placeholder="you@example.com" />
      </SettingsGroup>

      <SectionLabel>Secret</SectionLabel>
      <SettingsGroup>
        <FieldRow
          label="Secret key"
          value={secret}
          onChange={(v) => setSecret(v.toUpperCase().replace(/\s+/g, ""))}
          placeholder="JBSWY3DPEHPK3PXP"
          mono
          icon={<KeyRound className="h-3.5 w-3.5" strokeWidth={1.8} />}
          valid={secretValid}
          invalid={secret.length > 0 && !secretValid}
        />
      </SettingsGroup>
      <p className="px-1 pt-1.5 text-[11.5px]" style={{ color: MUTED }}>
        Base32 only — letters A–Z and digits 2–7. Spaces are removed.
      </p>

      <div className="pt-3">
        <SectionLabel>Tags · optional</SectionLabel>
        <TagInput value={tags} onChange={setTags} placeholder="work, personal, finance…" />
      </div>


      <button
        type="button"
        onClick={() => setShowAdvanced((v) => !v)}
        className="mt-4 flex items-center justify-between rounded-[12px] px-3.5 py-2.5"
        style={{
          background: "transparent",
          border: `1px dashed ${BORDER}`,
          color: CHARCOAL,
        }}
      >
        <span className="text-[12.5px]" style={{ fontWeight: 600, letterSpacing: "-0.005em" }}>
          Advanced options
        </span>
        <motion.span animate={{ rotate: showAdvanced ? 180 : 0 }} transition={{ duration: 0.2 }}>
          <ChevronDown className="h-4 w-4" strokeWidth={1.8} style={{ color: MUTED }} />
        </motion.span>
      </button>

      <AnimatePresence initial={false}>
        {showAdvanced && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.24, ease: [0.4, 0, 0.2, 1] }}
            className="overflow-hidden"
          >
            <div className="pt-2">
              <SettingsGroup>
                <SelectRow
                  label="Algorithm"
                  value={algorithm}
                  onChange={(v) => setAlgorithm(v as Algorithm)}
                  options={["SHA1", "SHA256", "SHA512"]}
                />
                <SelectRow
                  label="Digits"
                  value={String(digits)}
                  onChange={(v) => setDigits(Number(v))}
                  options={["6", "7", "8"]}
                />
                <SelectRow
                  label="Period"
                  value={String(period)}
                  onChange={(v) => setPeriod(Number(v))}
                  options={["30", "60"]}
                />
              </SettingsGroup>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {localErr && (
        <div className="pt-3">
          <Notice kind="error">{localErr}</Notice>
        </div>
      )}

      <div className="pt-6">
        <PrimaryButton type="submit" loading={saving} disabled={!canSubmit}>
          Save account
        </PrimaryButton>
      </div>
    </form>
  );
}

function FieldRow({
  label,
  value,
  onChange,
  placeholder,
  mono,
  autoFocus,
  icon,
  valid,
  invalid,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
  autoFocus?: boolean;
  icon?: React.ReactNode;
  valid?: boolean;
  invalid?: boolean;
}) {
  return (
    <label className="flex items-center gap-3 px-4 py-3">
      <span
        className="flex w-[76px] shrink-0 items-center gap-1.5 text-[12px]"
        style={{ color: MUTED, fontWeight: 500 }}
      >
        {icon}
        {label}
      </span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        className="min-w-0 flex-1 bg-transparent text-[14.5px] outline-none placeholder:text-[color:rgba(95,95,93,0.55)]"
        style={{
          color: CHARCOAL,
          fontFamily: mono
            ? "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace"
            : undefined,
          letterSpacing: mono ? "0.06em" : "-0.005em",
          fontWeight: 500,
        }}
      />
      {valid && (
        <span
          className="h-1.5 w-1.5 shrink-0 rounded-full"
          style={{ background: "#4a8f5a", boxShadow: "0 0 6px rgba(74,143,90,0.4)" }}
        />
      )}
      {invalid && (
        <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: "#c9a24a" }} />
      )}
    </label>
  );
}

function SelectRow({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
}) {
  return (
    <label className="flex items-center gap-3 px-4 py-3">
      <span className="w-[76px] shrink-0 text-[12px]" style={{ color: MUTED, fontWeight: 500 }}>
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="min-w-0 flex-1 bg-transparent text-[14.5px] outline-none"
        style={{ color: CHARCOAL, fontWeight: 500 }}
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}
