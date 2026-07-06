import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DndContext,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { AnimatePresence, motion } from "framer-motion";
import {
  getVaultKey,
  isVaultUnlocked,
  useActivityKeepAlive,
  useVaultUnlocked,
} from "@/lib/vault-session";
import {
  deleteAccount,
  flushPendingTagUpdates,
  flushPendingOutbox,
  pendingOutboxCount,
  readCachedAccountsOnly,
  setAccountFavorite,
  setAccountTags,
  syncAccountsFromServer,
  type DecryptedAccount,
} from "@/lib/vault-accounts";
import {
  hasQueuedTagUpdates,
  listQueuedTagUpdates,
} from "@/lib/vault-tag-queue";
import { useOnlineStatus } from "@/lib/use-online";
import { AccountCard } from "@/components/vault/AccountCard";
import { TagChip } from "@/components/vault/tags";
import { Shield, Plus, Loader2, Search, X, WifiOff, RefreshCw, Tags } from "lucide-react";
import { toast } from "sonner";
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
import { InstallPrompt } from "@/components/aegis/InstallPrompt";

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
  const [reloadKey, setReloadKey] = useState(0);
  const [retrying, setRetrying] = useState(false);
  const [activeTags, setActiveTags] = useState<Set<string>>(() => new Set());
  const [tagManagerOpen, setTagManagerOpen] = useState(false);
  const [pendingTagCount, setPendingTagCount] = useState<number>(
    () => (typeof window === "undefined" ? 0 : listQueuedTagUpdates().length),
  );
  const [pendingOutbox, setPendingOutbox] = useState<number>(
    () => (typeof window === "undefined" ? 0 : pendingOutboxCount()),
  );
  const [syncingTags, setSyncingTags] = useState(false);
  const online = useOnlineStatus();

  const refreshPendingCount = useCallback(() => {
    setPendingTagCount(listQueuedTagUpdates().length);
    setPendingOutbox(pendingOutboxCount());
  }, []);

  const allTags = useMemo(() => {
    if (!accounts) return [] as { tag: string; count: number }[];
    const counts = new Map<string, number>();
    for (const a of accounts) for (const t of a.tags ?? []) counts.set(t, (counts.get(t) ?? 0) + 1);
    return [...counts.entries()]
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
  }, [accounts]);

  const tagNames = useMemo(() => allTags.map((t) => t.tag), [allTags]);

  const toggleTagFilter = (tag: string) => {
    setActiveTags((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });
  };

  const handleTagsChanged = useCallback((id: string, tags: string[]) => {
    setAccounts((prev) => (prev ? prev.map((a) => (a.id === id ? { ...a, tags } : a)) : prev));
    setActiveTags((prev) => {
      // Drop filters that no longer match any account after the edit.
      return prev;
    });
    setPendingTagCount(listQueuedTagUpdates().length);
  }, []);

  const handleDetailsChanged = useCallback(
    (id: string, patch: { issuer: string; label: string }) => {
      setAccounts((prev) =>
        prev
          ? prev.map((a) =>
              a.id === id ? { ...a, issuer: patch.issuer, label: patch.label } : a,
            )
          : prev,
      );
    },
    [],
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
    // Optimistic remove — deleteAccount patches the cache too, and when
    // offline it queues the DELETE for reconnect.
    setAccounts((prev) => (prev ? prev.filter((a) => a.id !== id) : prev));
    try {
      const { queued } = await deleteAccount(id);
      if (queued) {
        setPendingOutbox(pendingOutboxCount());
        toast("Deletion queued — will sync when you're back online.");
      }
    } catch (err) {
      // Server rejected the delete for a non-network reason — surface it
      // and force a reload so the UI matches the server.
      setError(err instanceof Error ? err.message : "Could not delete.");
      setReloadKey((k) => k + 1);
    }
  };

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, []);

  // Phase 6.2: cache-first paint, then background hydrate from the
  // server. Cache resolves synchronously enough on IndexedDB that the
  // vault renders instantly on repeat visits; the server round-trip
  // updates in place when it lands. On offline we simply skip the
  // network hop and lean on the cache.
  useEffect(() => {
    let cancelled = false;
    const key = getVaultKey();
    if (!key) return;
    setError(null);

    // 1) Paint from cache immediately.
    void (async () => {
      try {
        const cached = await readCachedAccountsOnly(key, user.id);
        if (cancelled) return;
        if (cached) {
          setAccounts(cached);
          setSource("cache");
        }
      } catch {
        // Cache read is best-effort — the sync step below still runs.
      }

      // 2) If online, hydrate from the server and swap in the fresh list.
      if (!online) {
        // Offline with no cache = truly empty state.
        if (cancelled) return;
        setAccounts((prev) => prev ?? []);
        setSource((prev) => prev ?? "empty");
        setRetrying(false);
        return;
      }

      try {
        const fresh = await syncAccountsFromServer(key, user.id);
        if (cancelled) return;
        setAccounts(fresh);
        setSource("network");
        setRetrying(false);
      } catch (err) {
        if (cancelled) return;
        // Sync failed but a cache paint may already be on screen —
        // surface a soft error only when there's nothing to show.
        setAccounts((prev) => {
          if (prev) return prev;
          setError(err instanceof Error ? err.message : "Failed to load vault.");
          return [];
        });
        setSource((prev) => prev ?? "cache");
        setRetrying(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [unlocked, user.id, online, reloadKey]);

  // Invalidate on focus / visibility change — a returning user should
  // see fresh codes without a manual refresh.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onFocus = () => {
      if (!navigator.onLine) return;
      setReloadKey((k) => k + 1);
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") onFocus();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  // Auto-flush the offline outbox (delete + edit) when the network comes
  // back. Runs on mount too so pending items from a previous session get
  // replayed as soon as the vault opens.
  useEffect(() => {
    if (!online) return;
    let cancelled = false;
    void (async () => {
      try {
        const n = await flushPendingOutbox();
        if (cancelled) return;
        setPendingOutbox(pendingOutboxCount());
        if (n > 0) {
          toast.success(`Synced ${n} pending change${n === 1 ? "" : "s"}`);
          setReloadKey((k) => k + 1);
        }
      } catch {
        // best-effort; try again on next reconnect
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [online]);

  const retry = useCallback(() => {
    setRetrying(true);
    setReloadKey((k) => k + 1);
  }, []);

  const syncPendingTags = useCallback(async () => {
    if (syncingTags) return;
    setSyncingTags(true);
    try {
      const n = await flushPendingTagUpdates();
      refreshPendingCount();
      if (n > 0) {
        toast.success(`Synced ${n} tag update${n === 1 ? "" : "s"}`);
        setReloadKey((k) => k + 1);
      } else if (hasQueuedTagUpdates()) {
        toast.error("Some tag updates still can't reach the server.");
      }
    } finally {
      setSyncingTags(false);
    }
  }, [refreshPendingCount, syncingTags]);

  // Auto-flush whenever the browser reports we're back online, and when the
  // component mounts online with pending updates.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const flush = () => {
      if (!navigator.onLine) return;
      if (!hasQueuedTagUpdates()) return;
      void syncPendingTags();
    };
    window.addEventListener("online", flush);
    // Fire once at mount too — the app may open online with a queue left
    // from a previous session.
    flush();
    return () => window.removeEventListener("online", flush);
  }, [syncPendingTags]);

  // Keep the pending count fresh whenever the queue may have changed.
  useEffect(() => {
    refreshPendingCount();
  }, [refreshPendingCount, accounts, online, reloadKey]);



  const filtered = useMemo(() => {
    if (!accounts) return null;
    const q = query.trim().toLowerCase();
    const tagFilter = activeTags;
    return accounts.filter((a) => {
      if (tagFilter.size > 0) {
        const has = (a.tags ?? []).some((t) => tagFilter.has(t));
        if (!has) return false;
      }
      if (!q) return true;
      return (
        a.issuer.toLowerCase().includes(q) ||
        a.label.toLowerCase().includes(q) ||
        (a.tags ?? []).some((t) => t.toLowerCase().includes(q))
      );
    });
  }, [accounts, query, activeTags]);

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

      <InstallPrompt />

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
          <WifiOff className="h-3.5 w-3.5 shrink-0" strokeWidth={1.8} />
          <span className="flex-1 truncate">
            {online
              ? "Reconnecting — showing cached codes."
              : pendingOutbox > 0
                ? `You're offline — ${pendingOutbox} change${pendingOutbox === 1 ? "" : "s"} queued for sync.`
                : "You're offline — showing cached codes. Add is disabled."}
          </span>
          <button
            type="button"
            onClick={retry}
            disabled={retrying}
            className="flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[11px] transition-colors disabled:opacity-60"
            style={{
              background: "rgba(28,28,28,0.06)",
              color: CHARCOAL,
              fontWeight: 600,
            }}
            aria-label="Retry loading vault"
          >
            {retrying ? (
              <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2} />
            ) : (
              <RefreshCw className="h-3 w-3" strokeWidth={2} />
            )}
            Retry
          </button>
        </div>
      )}

      {pendingTagCount > 0 && (
        <div
          className="mb-2 mt-1 flex items-center gap-2 rounded-full px-3.5 py-2 text-[12px]"
          style={{
            background: CREAM_SOFT,
            border: `1px solid ${BORDER}`,
            color: CHARCOAL,
            boxShadow: "inset 0 1px 0 rgba(255,255,255,0.5)",
          }}
          role="status"
          aria-live="polite"
        >
          <Tags className="h-3.5 w-3.5 shrink-0" strokeWidth={1.8} />
          <span className="flex-1 truncate">
            {online
              ? `${pendingTagCount} tag update${pendingTagCount === 1 ? "" : "s"} waiting to sync.`
              : `${pendingTagCount} tag update${pendingTagCount === 1 ? "" : "s"} saved locally — will sync when online.`}
          </span>
          {online && (
            <button
              type="button"
              onClick={syncPendingTags}
              disabled={syncingTags}
              className="flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[11px] transition-colors disabled:opacity-60"
              style={{
                background: "rgba(28,28,28,0.06)",
                color: CHARCOAL,
                fontWeight: 600,
              }}
              aria-label="Retry syncing tag updates"
            >
              {syncingTags ? (
                <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2} />
              ) : (
                <RefreshCw className="h-3 w-3" strokeWidth={2} />
              )}
              Sync now
            </button>
          )}
        </div>
      )}




      {accounts && accounts.length > 0 && <SearchField value={query} onChange={setQuery} />}

      {accounts && allTags.length > 0 && (
        <TagFilterRow
          tags={allTags}
          active={activeTags}
          onToggle={toggleTagFilter}
          onClear={() => setActiveTags(new Set())}
          onManage={() => setTagManagerOpen(true)}
        />
      )}

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
            onTagsChanged={handleTagsChanged}
            onDetailsChanged={handleDetailsChanged}
            tagSuggestions={tagNames}
          />
        )}

        {accounts && accounts.length > 0 && filtered && filtered.length === 0 && (
          <div
            className="mt-4 rounded-[14px] px-4 py-6 text-center text-[13px]"
            style={{ background: CREAM_SOFT, border: `1px solid ${BORDER}`, color: MUTED }}
          >
            {activeTags.size > 0
              ? "No account matches the current filters."
              : `No account matches "${query}".`}
          </div>
        )}
      </div>

      {tagManagerOpen && accounts && (
        <TagManagerSheet
          accounts={accounts}
          onClose={() => setTagManagerOpen(false)}
          onLocalChange={(next) => {
            setAccounts(next);
            setActiveTags((prev) => {
              const remaining = new Set<string>();
              const stillExists = new Set<string>();
              for (const a of next) for (const t of a.tags ?? []) stillExists.add(t);
              for (const t of prev) if (stillExists.has(t)) remaining.add(t);
              return remaining;
            });
          }}
        />
      )}
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
  onTagsChanged,
  onDetailsChanged,
  tagSuggestions,
}: {
  favoriteList: DecryptedAccount[];
  otherList: DecryptedAccount[];
  now: number;
  favorites: Set<string>;
  onToggleFavorite: (id: string) => void;
  onDelete: (id: string) => Promise<void>;
  onTagsChanged: (id: string, tags: string[]) => void;
  onDetailsChanged: (id: string, patch: { issuer: string; label: string }) => void;
  tagSuggestions: string[];
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
                  onTagsChanged={onTagsChanged}
                  onDetailsChanged={onDetailsChanged}
                  allTagSuggestions={tagSuggestions}
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

function TagFilterRow({
  tags,
  active,
  onToggle,
  onClear,
  onManage,
}: {
  tags: { tag: string; count: number }[];
  active: Set<string>;
  onToggle: (tag: string) => void;
  onClear: () => void;
  onManage: () => void;
}) {
  const activeCount = active.size;
  // Sort so active filters lead — user always sees what's on first.
  const ordered = [...tags].sort((a, b) => {
    const aOn = active.has(a.tag) ? 0 : 1;
    const bOn = active.has(b.tag) ? 0 : 1;
    if (aOn !== bOn) return aOn - bOn;
    return b.count - a.count || a.tag.localeCompare(b.tag);
  });

  return (
    <div className="mt-2.5">
      {/* Label row */}
      <div className="mb-1.5 flex items-center justify-between px-0.5">
        <div className="flex items-center gap-2">
          <span
            className="text-[9.5px] uppercase"
            style={{
              color: MUTED,
              fontFamily: "'JetBrains Mono', monospace",
              letterSpacing: "0.22em",
              fontWeight: 600,
            }}
          >
            Filter
          </span>
          {activeCount > 0 && (
            <span
              className="rounded-full px-1.5 py-0.5 text-[10px]"
              style={{
                background: CHARCOAL,
                color: CREAM_SOFT,
                fontWeight: 700,
                lineHeight: 1,
                fontFamily: "'JetBrains Mono', monospace",
                letterSpacing: "0.06em",
              }}
            >
              {activeCount}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {activeCount > 0 && (
            <button
              type="button"
              onClick={onClear}
              className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] transition-colors hover:bg-black/5"
              style={{ color: MUTED, fontWeight: 500 }}
              aria-label="Clear tag filters"
            >
              <X className="h-2.5 w-2.5" strokeWidth={2.4} />
              Clear
            </button>
          )}
          <button
            type="button"
            onClick={onManage}
            className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] transition-colors hover:bg-black/5"
            style={{ color: MUTED, fontWeight: 500 }}
            aria-label="Manage tags"
          >
            <Tags className="h-2.5 w-2.5" strokeWidth={2.2} />
            Manage
          </button>
        </div>
      </div>

      {/* Scrollable chip strip with edge-fade masks */}
      <div
        className="relative"
        style={{
          WebkitMaskImage:
            "linear-gradient(to right, transparent 0, #000 14px, #000 calc(100% - 14px), transparent 100%)",
          maskImage:
            "linear-gradient(to right, transparent 0, #000 14px, #000 calc(100% - 14px), transparent 100%)",
        }}
      >
        <div
          className="-mx-1 flex items-center gap-1.5 overflow-x-auto px-3 py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {ordered.map(({ tag, count }) => {
            const isActive = active.has(tag);
            return (
              <button
                key={tag}
                type="button"
                onClick={() => onToggle(tag)}
                aria-pressed={isActive}
                className="group inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[11.5px] transition-all active:scale-[0.97]"
                style={{
                  background: isActive ? CHARCOAL : "#fff",
                  color: isActive ? CREAM_SOFT : CHARCOAL,
                  border: `1px solid ${isActive ? CHARCOAL : BORDER}`,
                  fontWeight: isActive ? 600 : 500,
                  boxShadow: isActive
                    ? "0 1px 2px rgba(28,28,28,0.15)"
                    : "inset 0 1px 0 rgba(255,255,255,0.6)",
                }}
              >
                <span
                  className="h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{
                    background: isActive ? CREAM_SOFT : `hsl(${hashHue(tag)}, 55%, 55%)`,
                    opacity: isActive ? 0.9 : 1,
                  }}
                />
                <span className="truncate">{tag}</span>
                <span
                  className="text-[10px] tabular-nums"
                  style={{
                    color: isActive ? "rgba(247,244,237,0.7)" : MUTED,
                    fontFamily: "'JetBrains Mono', monospace",
                    letterSpacing: "0.04em",
                  }}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** Deterministic hue for a tag — matches the chip color palette. */
function hashHue(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % 360;
}


function TagManagerSheet({
  accounts,
  onClose,
  onLocalChange,
}: {
  accounts: DecryptedAccount[];
  onClose: () => void;
  onLocalChange: (next: DecryptedAccount[]) => void;
}) {
  const [busyTag, setBusyTag] = useState<string | null>(null);
  const [renameFor, setRenameFor] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const tagIndex = useMemo(() => {
    const m = new Map<string, DecryptedAccount[]>();
    for (const a of accounts)
      for (const t of a.tags ?? []) {
        const arr = m.get(t) ?? [];
        arr.push(a);
        m.set(t, arr);
      }
    return [...m.entries()]
      .map(([tag, list]) => ({ tag, count: list.length }))
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
  }, [accounts]);

  const applyTransform = async (transform: (tags: string[]) => string[]) => {
    const next = [...accounts];
    let anyQueued = false;
    for (let i = 0; i < next.length; i++) {
      const current = next[i].tags ?? [];
      const proposed = transform(current);
      const same =
        current.length === proposed.length && current.every((t, idx) => t === proposed[idx]);
      if (same) continue;
      const { tags: saved, queued } = await setAccountTags(next[i].id, proposed);
      if (queued) anyQueued = true;
      next[i] = { ...next[i], tags: saved };
    }
    onLocalChange(next);
    return { anyQueued };
  };

  const doDelete = async (tag: string) => {
    setBusyTag(tag);
    try {
      const { anyQueued } = await applyTransform((tags) => tags.filter((t) => t !== tag));
      toast.success(
        anyQueued
          ? `Removed "${tag}" locally — will sync when online`
          : `Removed tag "${tag}"`,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not remove tag.");
    } finally {
      setBusyTag(null);
    }
  };

  const doRename = async (tag: string, next: string) => {
    const target = next.trim();
    if (!target || target === tag) {
      setRenameFor(null);
      return;
    }
    setBusyTag(tag);
    try {
      const { anyQueued } = await applyTransform((tags) =>
        tags.includes(tag) ? [...tags.filter((t) => t !== tag), target] : tags,
      );
      toast.success(
        anyQueued
          ? `Renamed "${tag}" → "${target}" locally — will sync when online`
          : `Renamed "${tag}" → "${target}"`,
      );
      setRenameFor(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not rename tag.");
    } finally {
      setBusyTag(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <button
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0"
        style={{ background: "rgba(28,28,28,0.35)", backdropFilter: "blur(4px)" }}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Manage tags"
        className="relative z-10 mx-auto flex max-h-[80vh] w-full max-w-[440px] flex-col rounded-t-[22px] px-5 pb-[max(20px,env(safe-area-inset-bottom))] pt-4 sm:rounded-[22px]"
        style={{
          background: CREAM_SOFT,
          border: `1px solid ${BORDER}`,
          boxShadow: "0 -12px 40px -12px rgba(0,0,0,0.25)",
        }}
      >
        <div
          aria-hidden
          className="mx-auto mb-3 h-[4px] w-10 rounded-full"
          style={{ background: "rgba(28,28,28,0.15)" }}
        />
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h3
              className="text-[17px]"
              style={{
                fontFamily: "'Playfair Display', serif",
                fontWeight: 600,
                letterSpacing: "-0.01em",
                color: CHARCOAL,
              }}
            >
              Manage tags
            </h3>
            <p className="text-[11.5px]" style={{ color: MUTED }}>
              Rename or delete tags across every account.
            </p>
          </div>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full"
            style={{ background: "rgba(28,28,28,0.06)", color: CHARCOAL }}
            aria-label="Close"
          >
            <X className="h-4 w-4" strokeWidth={1.8} />
          </button>
        </div>

        {tagIndex.length === 0 ? (
          <div
            className="rounded-[14px] px-4 py-8 text-center text-[13px]"
            style={{ background: "#fff", border: `1px solid ${BORDER}`, color: MUTED }}
          >
            No tags yet. Add one from any account's details sheet.
          </div>
        ) : (
          <div
            className="aegis-scroll flex-1 overflow-y-auto rounded-[14px]"
            style={{ background: "#fff", border: `1px solid ${BORDER}` }}
          >
            <ul className="divide-y" style={{ borderColor: BORDER }}>
              {tagIndex.map(({ tag, count }) => {
                const isBusy = busyTag === tag;
                const isRenaming = renameFor === tag;
                return (
                  <li key={tag} className="flex items-center gap-2 px-3 py-2.5">
                    <div className="flex min-w-0 flex-1 items-center gap-2">
                      <TagChip tag={tag} size="md" />
                      <span className="text-[11.5px]" style={{ color: MUTED }}>
                        {count} account{count === 1 ? "" : "s"}
                      </span>
                    </div>
                    {isRenaming ? (
                      <div className="flex items-center gap-1.5">
                        <input
                          autoFocus
                          value={renameValue}
                          onChange={(e) => setRenameValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") doRename(tag, renameValue);
                            if (e.key === "Escape") setRenameFor(null);
                          }}
                          className="h-7 w-28 rounded-full border px-2.5 text-[12px] outline-none"
                          style={{ borderColor: BORDER, color: CHARCOAL, background: "#fff" }}
                        />
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => doRename(tag, renameValue)}
                          className="rounded-full px-2.5 py-1 text-[11px] disabled:opacity-60"
                          style={{ background: CHARCOAL, color: CREAM_SOFT, fontWeight: 600 }}
                        >
                          Save
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => {
                            setRenameFor(tag);
                            setRenameValue(tag);
                          }}
                          className="rounded-full px-2.5 py-1 text-[11px] disabled:opacity-60"
                          style={{
                            background: "rgba(28,28,28,0.06)",
                            color: CHARCOAL,
                            fontWeight: 600,
                          }}
                        >
                          Rename
                        </button>
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => doDelete(tag)}
                          className="rounded-full px-2.5 py-1 text-[11px] disabled:opacity-60"
                          style={{
                            background: "rgba(178,58,42,0.08)",
                            color: "#b23a2a",
                            fontWeight: 600,
                          }}
                        >
                          {isBusy ? "…" : "Delete"}
                        </button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        <p className="mt-3 px-1 text-[11px]" style={{ color: MUTED }}>
          Renaming to an existing tag merges the two. Deleting removes the tag from every account —
          the accounts themselves stay.
        </p>
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
            fontFamily: "'Geist', ui-sans-serif, system-ui, sans-serif",
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
