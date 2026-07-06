import { useState } from "react";
import { toast } from "sonner";
import { Loader2, Puzzle } from "lucide-react";
import { SettingsGroup, SettingsRow } from "@/components/aegis/settings";
import { supabase } from "@/integrations/supabase/client";
import { getVaultKey, isVaultUnlocked } from "@/lib/vault-session";
import { readCachedAccountsOnly, syncAccountsFromServer } from "@/lib/vault-accounts";
import { syncVaultToExtension } from "@/lib/extension-bridge";

/**
 * Pushes the unlocked vault to the Aegis browser extension so it can
 * autofill TOTP codes. Requires the vault to be unlocked in this tab.
 */
export function ExtensionSyncSection() {
  const [busy, setBusy] = useState(false);

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
        toast.success(`Synced ${res.accountCount} account${res.accountCount === 1 ? "" : "s"} to extension`);
      } else if (res.reason === "no_extension") {
        toast.error("Chrome extension APIs unavailable in this browser");
      } else if (res.reason === "no_id") {
        toast.error("No extension ID configured");
      } else {
        toast.error(`Sync failed: ${res.detail ?? "unknown"}`);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Sync failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <SettingsGroup>
      <SettingsRow
        icon={
          busy ? (
            <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.8} />
          ) : (
            <Puzzle className="h-4 w-4" strokeWidth={1.8} />
          )
        }
        title="Sync to browser extension"
        description="Send unlocked accounts to the Aegis extension so it can autofill codes. Auto-clears after 5 min of inactivity."
        onClick={busy ? undefined : handleSync}
        disabled={busy}
        chevron
      />
    </SettingsGroup>
  );
}
