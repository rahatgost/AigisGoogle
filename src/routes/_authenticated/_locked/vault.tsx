import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { supabase } from "@/integrations/supabase/client";
import { getVaultKey, lockVault, useActivityKeepAlive, useVaultUnlocked } from "@/lib/vault-session";
import { listAccounts, type DecryptedAccount } from "@/lib/vault-accounts";
import { AccountCard } from "@/components/vault/AccountCard";
import { Shield, LogOut, Lock, Plus, Loader2 } from "lucide-react";
import {
  AegisScreen,
  BORDER,
  BrandBar,
  CHARCOAL,
  CREAM_SOFT,
  Display,
  Eyebrow,
  INSET_SHADOW,
  IconChip,
  Lede,
  MUTED,
  Notice,
  PrimaryButton,
  soft,
} from "@/components/aegis/chrome";

export const Route = createFileRoute("/_authenticated/_locked/vault")({
  component: VaultPage,
  errorComponent: ({ error }) => (
    <div className="flex min-h-screen items-center justify-center p-6 text-sm">{error.message}</div>
  ),
  notFoundComponent: () => <div className="p-6 text-sm">Not found</div>,
});

function VaultPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = Route.useRouteContext();
  const unlocked = useVaultUnlocked();

  useActivityKeepAlive();

  const [accounts, setAccounts] = useState<DecryptedAccount[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const key = getVaultKey();
    if (!key) return;
    setError(null);
    listAccounts(key)
      .then((list) => {
        if (!cancelled) setAccounts(list);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load vault.");
      });
    return () => {
      cancelled = true;
    };
  }, [unlocked]);

  const signOut = async () => {
    await queryClient.cancelQueries();
    queryClient.clear();
    lockVault();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  };

  const lockNow = () => {
    lockVault();
    navigate({ to: "/lock" });
  };

  return (
    <AegisScreen>
      <BrandBar
        right={
          <div className="flex items-center gap-1">
            <IconAction onClick={lockNow} icon={<Lock className="h-3.5 w-3.5" strokeWidth={1.8} />} label="Lock" />
            <IconAction onClick={signOut} icon={<LogOut className="h-3.5 w-3.5" strokeWidth={1.8} />} label="Sign out" />
          </div>
        }
      />

      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={soft}
        className="flex flex-col gap-2 pt-2 pb-4"
      >
        <Eyebrow>{user.email ?? "Your vault"}</Eyebrow>
        <div className="flex items-baseline justify-between gap-3">
          <Display>Your codes.</Display>
          {accounts && accounts.length > 0 && (
            <span className="text-[12px]" style={{ color: MUTED }}>
              {accounts.length} {accounts.length === 1 ? "account" : "accounts"}
            </span>
          )}
        </div>
      </motion.div>

      <div className="flex-1 overflow-y-auto pb-24 pr-1">
        {error && <Notice kind="error">{error}</Notice>}

        {accounts === null && !error && (
          <div className="flex items-center justify-center py-12" style={{ color: MUTED }}>
            <Loader2 className="h-4 w-4 animate-spin" />
          </div>
        )}

        {accounts && accounts.length === 0 && <EmptyState onAdd={() => navigate({ to: "/vault/new" })} />}

        {accounts && accounts.length > 0 && (
          <AnimatePresence initial={false}>
            <div className="flex flex-col gap-2.5">
              {accounts.map((a, i) => (
                <motion.div
                  key={a.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ ...soft, delay: Math.min(i * 0.04, 0.24) }}
                >
                  <AccountCard account={a} now={now} />
                </motion.div>
              ))}
            </div>
          </AnimatePresence>
        )}
      </div>

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...soft, delay: 0.1 }}
        className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex justify-center pb-[max(20px,env(safe-area-inset-bottom))]"
      >
        <motion.button
          whileTap={{ scale: 0.97 }}
          onClick={() => navigate({ to: "/vault/new" })}
          className="pointer-events-auto flex h-12 items-center gap-2 rounded-full px-5 text-[13.5px] font-medium"
          style={{
            background: CHARCOAL,
            color: CREAM_SOFT,
            boxShadow: `${INSET_SHADOW}, 0 12px 32px -10px rgba(28,28,28,0.5)`,
          }}
        >
          <Plus className="h-4 w-4" strokeWidth={2} />
          Add account
        </motion.button>
      </motion.div>
    </AegisScreen>
  );
}

function IconAction({ onClick, icon, label }: { onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <motion.button
      whileTap={{ scale: 0.94 }}
      onClick={onClick}
      className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px]"
      style={{ color: MUTED, background: "rgba(28,28,28,0.03)", border: `1px solid ${BORDER}` }}
    >
      {icon}
      {label}
    </motion.button>
  );
}

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={soft}
      className="flex flex-col items-center gap-5 py-16 text-center"
    >
      <IconChip size={56}>
        <Shield className="h-6 w-6" strokeWidth={1.6} />
      </IconChip>
      <div className="flex flex-col items-center gap-2">
        <Display>No codes yet.</Display>
        <Lede>Add your first account — scan a QR from any service or paste a secret manually.</Lede>
      </div>
      <div className="w-full max-w-[240px] pt-1">
        <PrimaryButton onClick={onAdd} icon={<Plus className="h-4 w-4" strokeWidth={2} />}>
          Add your first account
        </PrimaryButton>
      </div>
    </motion.div>
  );
}
