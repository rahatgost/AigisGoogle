import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  getVaultKey,
  isVaultUnlocked,
  useActivityKeepAlive,
  useVaultUnlocked,
} from "@/lib/vault-session";
import {
  deleteAccount,
  listAccountsWithCache,
  setAccountFavorite,
  type DecryptedAccount,
} from "@/lib/vault-accounts";
import { AccountCard } from "@/components/vault/AccountCard";
import { Shield, Plus, Loader2, Search, X, WifiOff } from "lucide-react";
import {
  BORDER,
  CHARCOAL,
  CREAM_SOFT,
  IconChip,
  MUTED,
  Notice,
  PrimaryButton,
  soft,
} from "@/components/aegis/chrome";
import { LargeTitle, SectionLabel } from "@/components/aegis/settings";

export const Route = createFileRoute("/_authenticated/_tabs/vault")({
  beforeLoad: ({ location }) => {
    if (!isVaultUnlocked()) {
      throw redirect({ to: "/lock", search: { redirect: location.href } });
    }
  },
  component: VaultPage,
  errorComponent: ({ error }) => (
    <div className="flex min-h-screen items-center justify-center p-6 text-sm">{error.message}</div>
  ),
  notFoundComponent: () => <div className="p-6 text-sm">Not found</div>,
});

function VaultPage() {
  const navigate = useNavigate();
  const unlocked = useVaultUnlocked();
  const { user } = Route.useRouteContext();

  useActivityKeepAlive();

  const [accounts, setAccounts] = useState<DecryptedAccount[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [query, setQuery] = useState("");
  const [source, setSource] = useState<"network" | "cache" | "empty" | null>(null);
  const [online, setOnline] = useState(() =>
    typeof navigator === "undefined" ? true : navigator.onLine,
  );

  const favorites = useMemo(() => {
    const s = new Set<string>();
    if (accounts) for (const a of accounts) if (a.is_favorite) s.add(a.id);
    return s;
  }, [accounts]);

  const toggleFavorite = (id: string) => {
    const target = accounts?.find((a) => a.id === id);
    if (!target) return;
    const nextVal = !target.is_favorite;
    // Optimistic update.
    setAccounts((prev) =>
      prev ? prev.map((a) => (a.id === id ? { ...a, is_favorite: nextVal } : a)) : prev,
    );
    setAccountFavorite(id, nextVal).catch((err) => {
      // Rollback on failure.
      setAccounts((prev) =>
        prev ? prev.map((a) => (a.id === id ? { ...a, is_favorite: !nextVal } : a)) : prev,
      );
      setError(err instanceof Error ? err.message : "Could not update favorite.");
    });
  };

  const handleDelete = async (id: string) => {
    await deleteAccount(id);
    setAccounts((prev) => (prev ? prev.filter((a) => a.id !== id) : prev));
  };

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const key = getVaultKey();
    if (!key) return;
    setError(null);
    listAccountsWithCache(key, user.id)
      .then(({ accounts: list, source: src }) => {
        if (cancelled) return;
        setAccounts(list);
        setSource(src);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load vault.");
      });
    return () => {
      cancelled = true;
    };
  }, [unlocked, user.id, online]);


  const filtered = useMemo(() => {
    if (!accounts) return null;
    const q = query.trim().toLowerCase();
    if (!q) return accounts;
    return accounts.filter(
      (a) => a.issuer.toLowerCase().includes(q) || a.label.toLowerCase().includes(q),
    );
  }, [accounts, query]);

  const { favoriteList, otherList } = useMemo(() => {
    if (!filtered) return { favoriteList: [], otherList: [] };
    const favs: DecryptedAccount[] = [];
    const rest: DecryptedAccount[] = [];
    for (const a of filtered) {
      if (a.is_favorite) favs.push(a);
      else rest.push(a);
    }
    return { favoriteList: favs, otherList: rest };
  }, [filtered]);

  return (
    <>
      <LargeTitle
        title="Your codes"
        subtitle={
          accounts && accounts.length > 0
            ? `${accounts.length} ${accounts.length === 1 ? "account" : "accounts"} · tap to copy`
            : "One-time codes, encrypted end-to-end."
        }
      />

      {(!online || source === "cache") && accounts && (
        <div
          className="mb-2 mt-1 flex items-center gap-2 rounded-full px-3.5 py-2 text-[12px]"
          style={{
            background: CREAM_SOFT,
            border: `1px solid ${BORDER}`,
            color: MUTED,
            boxShadow: "inset 0 1px 0 rgba(255,255,255,0.5)",
          }}
        >
          <WifiOff className="h-3.5 w-3.5" strokeWidth={1.8} />
          <span>
            {online
              ? "Reconnecting — showing cached codes."
              : "You're offline — showing cached codes. Add or edit is disabled."}
          </span>
        </div>
      )}

      {accounts && accounts.length > 0 && <SearchField value={query} onChange={setQuery} />}

      <div className="pt-2">
        {error && <Notice kind="error">{error}</Notice>}

        {accounts === null && !error && (
          <div className="flex items-center justify-center py-16" style={{ color: MUTED }}>
            <Loader2 className="h-4 w-4 animate-spin" />
          </div>
        )}

        {accounts && accounts.length === 0 && (
          <EmptyState onAdd={() => navigate({ to: "/vault/new" })} />
        )}

        {filtered && filtered.length > 0 && (
          <UnifiedAccountList
            favoriteList={favoriteList}
            otherList={otherList}
            now={now}
            favorites={favorites}
            onToggleFavorite={toggleFavorite}
            onDelete={handleDelete}
          />
        )}

        {accounts && accounts.length > 0 && filtered && filtered.length === 0 && (
          <div
            className="mt-4 rounded-[14px] px-4 py-6 text-center text-[13px]"
            style={{ background: CREAM_SOFT, border: `1px solid ${BORDER}`, color: MUTED }}
          >
            No account matches "{query}".
          </div>
        )}
      </div>
    </>
  );
}

function UnifiedAccountList({
  favoriteList,
  otherList,
  now,
  favorites,
  onToggleFavorite,
  onDelete,
}: {
  favoriteList: DecryptedAccount[];
  otherList: DecryptedAccount[];
  now: number;
  favorites: Set<string>;
  onToggleFavorite: (id: string) => void;
  onDelete: (id: string) => Promise<void>;
}) {
  const showBothLabels = favoriteList.length > 0 && otherList.length > 0;
  const combined = [...favoriteList, ...otherList];
  const dividerAfter = favoriteList.length > 0 ? favoriteList[favoriteList.length - 1].id : null;

  return (
    <div className="flex flex-col gap-1.5">
      {favoriteList.length > 0 && <SectionLabel>Favorites</SectionLabel>}
      {favoriteList.length === 0 && otherList.length > 0 && null}
      <div
        className="overflow-hidden rounded-[16px]"
        style={{
          background: CREAM_SOFT,
          border: `1px solid ${BORDER}`,
          boxShadow: "inset 0 1px 0 rgba(255,255,255,0.6)",
        }}
      >
        <div>
          {combined.map((a, idx) => {
            const isLastFav = a.id === dividerAfter;
            const isFirstOther = showBothLabels && idx === favoriteList.length;
            return (
              <motion.div
                key={a.id}
                layout="position"
                transition={soft}
                style={{
                  borderTop: idx > 0 && !isFirstOther ? `1px solid ${BORDER}` : undefined,
                }}
              >
                {isFirstOther && (
                  <div className="px-4 pb-1.5 pt-3">
                    <SectionLabel>All accounts</SectionLabel>
                  </div>
                )}
                <AccountCard
                  account={a}
                  now={now}
                  isFavorite={favorites.has(a.id)}
                  onToggleFavorite={onToggleFavorite}
                  onDelete={onDelete}
                />
                {isLastFav && showBothLabels && (
                  <div style={{ height: 4, background: "transparent" }} />
                )}
              </motion.div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function AccountGroup({
  items,
  now,
  favorites,
  onToggleFavorite,
  onDelete,
}: {
  items: DecryptedAccount[];
  now: number;
  favorites: Set<string>;
  onToggleFavorite: (id: string) => void;
  onDelete: (id: string) => Promise<void>;
}) {
  return (
    <div
      className="overflow-hidden rounded-[16px]"
      style={{
        background: CREAM_SOFT,
        border: `1px solid ${BORDER}`,
        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.6)",
      }}
    >
      <AnimatePresence initial={false}>
        <div className="divide-y" style={{ borderColor: BORDER }}>
          {items.map((a, i) => (
            <motion.div
              key={a.id}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ ...soft, delay: Math.min(i * 0.03, 0.18) }}
            >
              <AccountCard
                account={a}
                now={now}
                isFavorite={favorites.has(a.id)}
                onToggleFavorite={onToggleFavorite}
                onDelete={onDelete}
              />
            </motion.div>
          ))}
        </div>
      </AnimatePresence>
    </div>
  );
}

function SearchField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div
      className="flex h-11 shrink-0 items-center gap-2 rounded-full px-3.5"
      style={{
        background: CREAM_SOFT,
        border: `1px solid ${BORDER}`,
        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.5)",
      }}
    >
      <Search className="h-4 w-4" strokeWidth={1.8} style={{ color: MUTED }} />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search accounts"
        className="flex-1 bg-transparent text-[13.5px] outline-none placeholder:text-[color:rgba(95,95,93,0.7)]"
        style={{ color: CHARCOAL }}
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange("")}
          className="flex h-6 w-6 items-center justify-center rounded-full"
          style={{ color: MUTED, background: "rgba(28,28,28,0.06)" }}
          aria-label="Clear search"
        >
          <X className="h-3 w-3" strokeWidth={2} />
        </button>
      )}
    </div>
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
      <div className="flex flex-col items-center gap-1.5">
        <h2
          className="text-[20px]"
          style={{
            color: CHARCOAL,
            fontFamily: "'Sora', sans-serif",
            fontWeight: 600,
            letterSpacing: "-0.02em",
          }}
        >
          No codes yet
        </h2>
        <p className="max-w-[260px] text-[13px]" style={{ color: MUTED }}>
          Scan a QR from any service or paste a secret to add your first account.
        </p>
      </div>
      <div className="w-full max-w-[240px] pt-1">
        <PrimaryButton onClick={onAdd} icon={<Plus className="h-4 w-4" strokeWidth={2} />}>
          Add your first account
        </PrimaryButton>
      </div>
    </motion.div>
  );
}
