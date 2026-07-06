import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Puzzle, Download } from "lucide-react";
import { SectionLabel, SettingsGroup, SettingsRow } from "@/components/aegis/settings";
import { supabase } from "@/integrations/supabase/client";
import { getVaultKey, isVaultUnlocked, useVaultUnlocked } from "@/lib/vault-session";
import { readCachedAccountsOnly, syncAccountsFromServer } from "@/lib/vault-accounts";
import { syncVaultToExtension, isExtensionInstalled } from "@/lib/extension-bridge";

/**
 * Pushes the unlocked vault to the Aegis browser extension so it can
 * autofill TOTP codes. Auto-detects the extension via a DOM marker
 * planted by the extension's `announce.js` content script — no ID
 * configuration required from the user.
 */
export function ExtensionSyncSection() {
  const [busy, setBusy] = useState(false);
  const [installed, setInstalled] = useState<boolean>(() => isExtensionInstalled());
  const unlocked = useVaultUnlocked();

  // Poll briefly on mount in case the announce script sets the marker
  // slightly after React hydrates.
  useEffect(() => {
    if (installed) return;
    let n = 0;
    const t = setInterval(() => {
      if (isExtensionInstalled()) {
        setInstalled(true);
        clearInterval(t);
      } else if (++n > 20) {
        clearInterval(t);
      }
    }, 250);
    const onReady = () => setInstalled(true);
    window.addEventListener("aegis:extension-ready", onReady);
    return () => {
      clearInterval(t);
      window.removeEventListener("aegis:extension-ready", onReady);
    };
  }, [installed]);

  async function handleSync() {
    if (!isVaultUnlocked()) {
      toast.error("Unlock your vault first");
      return;
    }
    const dek = getVaultKey();
    if (!dek) {
      toast.error("Vault key unavailable — unlock again");
      return;
    }
    setBusy(true);
    try {
      const { data: userRes, error: userErr } = await supabase.auth.getUser();
      if (userErr || !userRes.user) throw new Error("Not signed in");
      const userId = userRes.user.id;

      let accounts = await readCachedAccountsOnly(dek, userId);
      if (!accounts || accounts.length === 0) {
        accounts = await syncAccountsFromServer(dek, userId);
      }
      if (!accounts || accounts.length === 0) {
        toast.error("No accounts to sync");
        return;
      }

      const res = await syncVaultToExtension({ userId, accounts });
      if (res.ok) {
        toast.success(
          `Synced ${res.accountCount} account${res.accountCount === 1 ? "" : "s"} to extension`,
        );
      } else if (res.reason === "no_extension") {
        toast.error("Chrome extension APIs unavailable in this browser");
      } else if (res.reason === "no_id") {
        toast.error("Aegis extension not detected — install it first");
      } else {
        toast.error(`Sync failed: ${res.detail ?? "unknown"}`);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Sync failed");
    } finally {
      setBusy(false);
    }
  }

  const disabled = busy || !installed || !unlocked;
  const description = !installed
    ? "Install the Aegis browser extension, then come back to sync."
    : !unlocked
      ? "Unlock your vault first, then sync accounts to the extension."
      : "Send unlocked accounts to the Aegis extension so it can autofill codes. Auto-clears after 5 min of inactivity.";

  return (
    <>
      <SectionLabel>Browser extension</SectionLabel>
      <SettingsGroup>
        <SettingsRow
          icon={
            busy ? (
              <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.8} />
            ) : installed ? (
              <Puzzle className="h-4 w-4" strokeWidth={1.8} />
            ) : (
              <Download className="h-4 w-4" strokeWidth={1.8} />
            )
          }
          title={installed ? "Sync to browser extension" : "Install browser extension"}
          description={description}
          badge={installed ? "Detected" : undefined}
          onClick={disabled ? undefined : handleSync}
          disabled={disabled}
          chevron
        />
      </SettingsGroup>
    </>
  );
}
