import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Loader2,
  Puzzle,
  Chrome,
  Globe,
  Flame,
  ChevronDown,
  ExternalLink,
  CheckCircle2,
  Activity,
  KeyRound,
  Keyboard,
} from "lucide-react";
import { useLingui } from "@lingui/react";
import { SectionLabel, SettingsGroup, SettingsRow } from "@/components/aegis/settings";
import { supabase } from "@/integrations/supabase/client";
import { getVaultKey, isVaultUnlocked, useVaultUnlocked } from "@/lib/vault-session";
import { readCachedAccountsOnly, syncAccountsFromServer } from "@/lib/vault-accounts";
import {
  syncVaultToExtension,
  isExtensionInstalled,
  pingExtensionState,
  clearExtensionPairing,
  getLocalSyncSeq,
  type ExtensionState,
} from "@/lib/extension-bridge";
import { MUTED, CHARCOAL, BORDER } from "@/components/aegis/chrome";

/**
 * Extension section for the Security page.
 */

const CHROME_ZIP = "/aegis-extension-chrome.zip";
const FIREFOX_ZIP = "/aegis-extension-firefox.zip";

async function downloadZip(url: string, filename: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  const blob = await res.blob();
  const a = document.createElement("a");
  const href = URL.createObjectURL(blob);
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 1_000);
}

type BrowserKey = "chrome" | "edge" | "firefox";

export function ExtensionSyncSection() {
  const { i18n } = useLingui();
  const t = (id: string, fallback: string, values?: Record<string, unknown>) => {
    const msg = values ? i18n._(id, values) : i18n._(id);
    return msg === id ? fallback : msg;
  };

  const BROWSERS = useMemo(
    () => [
      {
        key: "chrome" as BrowserKey,
        label: t("extSync.browser.chrome", "Install for Chrome"),
        hint: t("extSync.browser.chrome.hint", "Also works in Brave, Arc, Opera"),
        zip: CHROME_ZIP,
        filename: "aegis-extension-chrome.zip",
        extensionsUrl: "chrome://extensions",
        icon: <Chrome className="h-4 w-4" strokeWidth={1.8} />,
      },
      {
        key: "edge" as BrowserKey,
        label: t("extSync.browser.edge", "Install for Microsoft Edge"),
        hint: t("extSync.browser.edge.hint", "Uses the Chromium build"),
        zip: CHROME_ZIP,
        filename: "aegis-extension-chrome.zip",
        extensionsUrl: "edge://extensions",
        icon: <Globe className="h-4 w-4" strokeWidth={1.8} />,
      },
      {
        key: "firefox" as BrowserKey,
        label: t("extSync.browser.firefox", "Install for Firefox"),
        hint: t("extSync.browser.firefox.hint", "MV3 build, Firefox 128+"),
        zip: FIREFOX_ZIP,
        filename: "aegis-extension-firefox.zip",
        extensionsUrl: "about:debugging#/runtime/this-firefox",
        icon: <Flame className="h-4 w-4" strokeWidth={1.8} />,
      },
    ],
    [i18n.locale],
  );

  const [busy, setBusy] = useState(false);
  const [downloading, setDownloading] = useState<BrowserKey | null>(null);
  const [downloadedFor, setDownloadedFor] = useState<Set<BrowserKey>>(new Set());
  const [installed, setInstalled] = useState<boolean>(() => isExtensionInstalled());
  const [showHelp, setShowHelp] = useState(false);
  const unlocked = useVaultUnlocked();

  useEffect(() => {
    if (installed) return;
    let n = 0;
    const iv = setInterval(() => {
      if (isExtensionInstalled()) {
        setInstalled(true);
        clearInterval(iv);
      } else if (++n > 20) {
        clearInterval(iv);
      }
    }, 250);
    const onReady = () => setInstalled(true);
    window.addEventListener("aegis:extension-ready", onReady);
    return () => {
      clearInterval(iv);
      window.removeEventListener("aegis:extension-ready", onReady);
    };
  }, [installed]);

  async function handleDownload(browser: (typeof BROWSERS)[number]) {
    if (downloading) return;
    setDownloading(browser.key);
    try {
      await downloadZip(browser.zip, browser.filename);
      setDownloadedFor((prev) => new Set(prev).add(browser.key));
      setShowHelp(true);
      toast.success(t("extSync.toast.downloaded", "Downloaded {filename}", { filename: browser.filename }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("extSync.error.downloadFailed", "Download failed"));
    } finally {
      setDownloading(null);
    }
  }

  async function handleSync() {
    if (!isVaultUnlocked()) {
      toast.error(t("extSync.error.unlockFirst", "Unlock your vault first"));
      return;
    }
    const dek = getVaultKey();
    if (!dek) {
      toast.error(t("extSync.error.keyUnavailable", "Vault key unavailable — unlock again"));
      return;
    }
    setBusy(true);
    try {
      const { data: userRes, error: userErr } = await supabase.auth.getUser();
      if (userErr || !userRes.user) throw new Error(t("extSync.error.notSignedIn", "Not signed in"));
      const userId = userRes.user.id;

      let accounts = await readCachedAccountsOnly(dek, userId);
      if (!accounts || accounts.length === 0) {
        accounts = await syncAccountsFromServer(dek, userId);
      }
      if (!accounts || accounts.length === 0) {
        toast.error(t("extSync.error.noAccounts", "No accounts to sync"));
        return;
      }

      const res = await syncVaultToExtension({ userId, accounts });
      if (res.ok) {
        toast.success(
          res.accountCount === 1
            ? t("extSync.toast.synced.one", "Synced {count} account to extension", { count: res.accountCount })
            : t("extSync.toast.synced.other", "Synced {count} accounts to extension", { count: res.accountCount }),
        );
      } else if (res.reason === "no_extension") {
        toast.error(t("extSync.error.noExtensionApi", "Browser extension APIs unavailable here"));
      } else if (res.reason === "no_id") {
        toast.error(t("extSync.error.notDetected", "Aegis extension not detected — install it first"));
      } else {
        toast.error(t("extSync.error.syncFailedDetail", "Sync failed: {detail}", { detail: res.detail ?? "unknown" }));
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("extSync.error.syncFailed", "Sync failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <SectionLabel>{t("extSync.section", "Browser extension")}</SectionLabel>
      <SettingsGroup>
        {installed ? (
          <SettingsRow
            icon={
              busy ? (
                <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.8} />
              ) : (
                <Puzzle className="h-4 w-4" strokeWidth={1.8} />
              )
            }
            title={t("extSync.sync", "Sync to browser extension")}
            description={
              !unlocked
                ? t("extSync.sync.locked", "Unlock your vault first, then sync accounts to the extension.")
                : t("extSync.sync.description", "Send unlocked accounts to the Aegis extension so it can autofill codes. Auto-clears after 5 min of inactivity.")
            }
            badge={t("extSync.badge.detected", "Detected")}
            onClick={busy || !unlocked ? undefined : handleSync}
            disabled={busy || !unlocked}
            chevron
          />
        ) : (
          BROWSERS.map((b) => {
            const isBusy = downloading === b.key;
            const done = downloadedFor.has(b.key);
            return (
              <SettingsRow
                key={b.key}
                icon={
                  isBusy ? (
                    <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.8} />
                  ) : done ? (
                    <CheckCircle2 className="h-4 w-4" strokeWidth={1.8} />
                  ) : (
                    b.icon
                  )
                }
                title={b.label}
                description={done ? t("extSync.downloadedHint", "Downloaded — now load unpacked in {url}", { url: b.extensionsUrl }) : b.hint}
                badge={done ? t("extSync.badge.downloaded", "Downloaded") : undefined}
                onClick={downloading ? undefined : () => void handleDownload(b)}
                disabled={!!downloading && !isBusy}
                chevron
              />
            );
          })
        )}
      </SettingsGroup>

      {installed && <ExtensionHealthGroup unlocked={unlocked} />}

      {!installed && (
        <div className="mt-2">
          <button
            type="button"
            onClick={() => setShowHelp((v) => !v)}
            className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-[13px]"
            style={{ color: MUTED }}
          >
            <span className="inline-flex items-center gap-1.5">
              <ChevronDown
                className="h-3.5 w-3.5 transition-transform"
                style={{ transform: showHelp ? "rotate(0deg)" : "rotate(-90deg)" }}
                strokeWidth={2}
              />
              {t("extSync.howToInstall", "How to install")}
            </span>
            <ExternalLink className="h-3 w-3" strokeWidth={2} />
          </button>
          {showHelp && (
            <ol
              className="mt-1 space-y-1.5 rounded-lg border px-4 py-3 text-[12.5px] leading-relaxed"
              style={{ borderColor: BORDER, color: CHARCOAL }}
            >
              <li>{t("extSync.step1", "1. Download the zip above for your browser.")}</li>
              <li>{t("extSync.step2", "2. Unzip the file to a folder you'll keep.")}</li>
              <li>
                {t("extSync.step3.prefix", "3. Open")}{" "}
                <code className="rounded bg-black/5 px-1 py-0.5 text-[11.5px]">chrome://extensions</code>{" "}
                ({t("extSync.step3.or", "or")}{" "}
                <code className="rounded bg-black/5 px-1 py-0.5 text-[11.5px]">edge://extensions</code>,{" "}
                <code className="rounded bg-black/5 px-1 py-0.5 text-[11.5px]">about:debugging</code>{" "}
                {t("extSync.step3.forFirefox", "for Firefox")}).
              </li>
              <li>
                {t("extSync.step4.prefix", "4. Enable")}{" "}
                <strong style={{ color: CHARCOAL }}>{t("extSync.step4.devMode", "Developer mode")}</strong>{" "}
                {t("extSync.step4.suffix", "(top-right).")}
              </li>
              <li>
                {t("extSync.step5.prefix", "5. Click")}{" "}
                <strong style={{ color: CHARCOAL }}>{t("extSync.step5.loadUnpacked", "Load unpacked")}</strong>{" "}
                {t("extSync.step5.middle", "(Chrome/Edge) or")}{" "}
                <strong style={{ color: CHARCOAL }}>{t("extSync.step5.loadTemp", "Load Temporary Add-on")}</strong>{" "}
                {t("extSync.step5.suffix", "(Firefox) and select the unzipped folder.")}
              </li>
              <li>{t("extSync.step6", "6. Return to this page — the sync option will appear automatically.")}</li>
            </ol>
          )}
        </div>
      )}
    </>
  );
}

/* -------------------------------------------------------------------- */
/*  Extension health card                                                */
/* -------------------------------------------------------------------- */

function useRelTime() {
  const { i18n } = useLingui();
  const t = (id: string, fallback: string, values?: Record<string, unknown>) => {
    const msg = values ? i18n._(id, values) : i18n._(id);
    return msg === id ? fallback : msg;
  };
  return (ts: number): string => {
    if (!ts) return t("relTime.never", "never");
    const diff = Date.now() - ts;
    if (diff < 5_000) return t("relTime.justNow", "just now");
    if (diff < 60_000) return t("relTime.seconds", "{count}s ago", { count: Math.round(diff / 1000) });
    if (diff < 3_600_000) return t("relTime.minutes", "{count}m ago", { count: Math.round(diff / 60_000) });
    if (diff < 86_400_000) return t("relTime.hours", "{count}h ago", { count: Math.round(diff / 3_600_000) });
    return t("relTime.days", "{count}d ago", { count: Math.round(diff / 86_400_000) });
  };
}

function ExtensionHealthGroup({ unlocked }: { unlocked: boolean }) {
  const { i18n } = useLingui();
  const t = (id: string, fallback: string, values?: Record<string, unknown>) => {
    const msg = values ? i18n._(id, values) : i18n._(id);
    return msg === id ? fallback : msg;
  };
  const relTime = useRelTime();
  const [state, setState] = useState<ExtensionState | null>(null);
  const [repairing, setRepairing] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const s = await pingExtensionState();
      if (alive) setState(s);
    };
    void load();
    const iv = setInterval(load, 10_000);
    const clock = setInterval(() => setTick((n) => n + 1), 15_000);
    return () => {
      alive = false;
      clearInterval(iv);
      clearInterval(clock);
    };
  }, []);

  void tick;

  const localSeq = getLocalSyncSeq();
  const remoteSeq = state?.ok ? state.syncSeq : 0;
  const stale = state?.ok && state.unlocked && remoteSeq < localSeq;

  async function handleRepair() {
    setRepairing(true);
    try {
      const cleared = clearExtensionPairing();
      if (!cleared) {
        toast.error(t("extSync.error.notDetectedShort", "Extension not detected"));
        return;
      }
      toast.success(t("extSync.toast.repaired", "Pairing key cleared — next sync will re-pair"));
      const s = await pingExtensionState();
      setState(s);
    } finally {
      setRepairing(false);
    }
  }

  const extUnlocked = state?.ok ? state.unlocked : false;
  const accountCount = state?.ok ? state.accountCount : 0;
  const syncedAt = state?.ok ? state.syncedAt : 0;

  const statusDescription = !state
    ? t("extSync.health.checking", "Checking…")
    : !state.ok
      ? t("extSync.health.unreachable", "Couldn't reach extension")
      : extUnlocked
        ? accountCount === 1
          ? t("extSync.health.unlocked.one", "Unlocked · {count} account · synced {time}", { count: accountCount, time: relTime(syncedAt) })
          : t("extSync.health.unlocked.other", "Unlocked · {count} accounts · synced {time}", { count: accountCount, time: relTime(syncedAt) })
        : t("extSync.health.locked", "Locked — sync from this page to unlock it");

  return (
    <div className="mt-4">
      <SectionLabel>{t("extSync.healthSection", "Extension health")}</SectionLabel>
      <SettingsGroup>
        <SettingsRow
          icon={<Activity className="h-4 w-4" strokeWidth={1.8} />}
          title={t("extSync.health.status", "Extension status")}
          description={statusDescription}
          badge={extUnlocked ? t("extSync.badge.unlocked", "Unlocked") : t("extSync.badge.locked", "Locked")}
        />
        <SettingsRow
          icon={<KeyRound className="h-4 w-4" strokeWidth={1.8} />}
          title={stale ? t("extSync.counter.stale", "Sync counter (stale)") : t("extSync.counter", "Sync counter")}
          description={
            stale
              ? t("extSync.counter.staleDetail", "Extension has seq {remote}, this tab has {local}. A resync will bring it up to date.", { remote: remoteSeq, local: localSeq })
              : t("extSync.counter.detail", "local seq {local} · extension seq {remote}", { local: localSeq, remote: remoteSeq })
          }
          badge={stale ? t("extSync.badge.stale", "Stale") : undefined}
        />
        <SettingsRow
          icon={
            repairing ? (
              <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.8} />
            ) : (
              <KeyRound className="h-4 w-4" strokeWidth={1.8} />
            )
          }
          title={t("extSync.repair", "Re-pair extension")}
          description={t("extSync.repair.description", "Wipe the cached pairing key and reissue a handshake on the next sync. Use this only if syncs fail with signature errors.")}
          onClick={repairing ? undefined : handleRepair}
          disabled={repairing || !unlocked}
          chevron
        />
        <SettingsRow
          icon={<Keyboard className="h-4 w-4" strokeWidth={1.8} />}
          title={t("extSync.shortcut", "Keyboard shortcut")}
          description={t("extSync.shortcut.description", "Ctrl + Shift + L (⌘ + Shift + L on Mac) autofills the top-matched OTP into the focused input on any tab.")}
        />
      </SettingsGroup>
    </div>
  );
}
