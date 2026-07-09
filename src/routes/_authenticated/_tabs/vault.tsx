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
  reorderAccounts,
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
import { PRESET_TAGS, TagChip } from "@/components/vault/tags";
import { ExportPassphraseSheet } from "@/components/vault/ExportPassphraseSheet";
import {
  Shield,
  Plus,
  Loader2,
  Search,
  X,
  WifiOff,
  RefreshCw,
  Tags,
  CheckSquare,
  Check,
  Trash2,
  Download,
  Tag as TagIcon,
  MoreHorizontal,
} from "lucide-react";
import { toast } from "sonner";
import {
  BORDER,
  CHARCOAL,
  CREAM_SOFT,
  DANGER,
  IconChip,
  MUTED,
  Notice,
  PrimaryButton,
  soft,
} from "@/components/aegis/chrome";
import {
  typeBadge,
  typeBody,
  typeEyebrow,
  typeSheetTitle,
  typeSheetTitleLg,
  typeSheetTitleSm,
  typeSubLabel,
} from "@/components/aegis/typography";
import { LargeTitle, SectionLabel } from "@/components/aegis/settings";
import { InstallPrompt } from "@/components/aegis/InstallPrompt";
import { UpgradePrompt } from "@/components/aegis/upgrade-prompt";
import { usePlan } from "@/hooks/use-plan";
import { IncomingSharesSection } from "@/components/aegis/sharing-section";
import { useLingui } from "@lingui/react";

// Local i18n helper: falls back to the English literal when a translation
// isn't available for the current locale. Values interpolate placeholders
// like {count} / {query} at call time via Lingui.
function useT() {
  const { i18n } = useLingui();
  return (id: string, fallback: string, values?: Record<string, unknown>): string => {
    const msg = i18n._(id, values ?? {});
    return typeof msg === "string" && msg !== id ? msg : fallback;
  };
}

export const Route = createFileRoute("/_authenticated/_tabs/vault")({
  beforeLoad: ({ location }) => {
    if (!isVaultUnlocked()) {
      throw redirect({ to: "/lock", search: { redirect: location.href } });
    }
  },
  head: () => ({
    meta: [
      { title: "Your vault — Aegis" },
      {
        name: "description",
        content:
          "Your end-to-end encrypted TOTP vault. Codes decrypt locally on this device only.",
      },
      { name: "robots", content: "noindex, nofollow" },
      { property: "og:title", content: "Your vault — Aegis" },
      {
        property: "og:description",
        content: "End-to-end encrypted TOTP codes, unlocked only on your device.",
      },
      { property: "og:url", content: "https://aegis-syed.lovable.app/vault" },
    ],
  }),
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
  const t = useT();


  useActivityKeepAlive();
  const plan = usePlan();

  const [accounts, setAccounts] = useState<DecryptedAccount[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [query, setQuery] = useState("");
  const [source, setSource] = useState<"network" | "cache" | "empty" | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [retrying, setRetrying] = useState(false);
  const [activeTags, setActiveTags] = useState<Set<string>>(() => new Set());
  const [tagManagerOpen, setTagManagerOpen] = useState(false);
  // Phase 7.3 — bulk selection mode.
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [bulkTagOpen, setBulkTagOpen] = useState(false);
  const [bulkExportOpen, setBulkExportOpen] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState(false);
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

  // Phase 7.2 — DnD reorder. Server flush is debounced per-group so a
  // fast series of drags collapses into one batched write.
  const reorderTimersRef = useRef<Record<string, number>>({});
  const handleReorder = useCallback((group: "fav" | "other", orderedIds: string[]) => {
    setAccounts((prev) => {
      if (!prev) return prev;
      const byId = new Map(prev.map((a) => [a.id, a]));
      const reordered = orderedIds
        .map((id, i) => {
          const acc = byId.get(id);
          return acc ? { ...acc, sort_order: i } : null;
        })
        .filter((a): a is DecryptedAccount => a !== null);
      const orderedSet = new Set(orderedIds);
      const untouched = prev.filter((a) => !orderedSet.has(a.id));
      // Favorites always render first; recombine in that order.
      return group === "fav" ? [...reordered, ...untouched] : [...untouched, ...reordered];
    });

    const timers = reorderTimersRef.current;
    if (timers[group]) window.clearTimeout(timers[group]);
    timers[group] = window.setTimeout(() => {
      void reorderAccounts(orderedIds).catch((err) => {
        setError(err instanceof Error ? err.message : "Could not save the new order.");
      });
      delete timers[group];
    }, 400);
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

  // ---- Phase 7.3: bulk selection helpers ----
  const enterSelection = useCallback((seedId?: string) => {
    setSelectionMode(true);
    if (seedId) setSelectedIds(new Set([seedId]));
  }, []);
  const exitSelection = useCallback(() => {
    setSelectionMode(false);
    setSelectedIds(new Set());
    setBulkTagOpen(false);
    setBulkExportOpen(false);
  }, []);
  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  const selectAllVisible = useCallback((ids: string[]) => {
    setSelectedIds(new Set(ids));
  }, []);

  const runBulkDelete = useCallback(async () => {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    setBulkBusy(true);
    // Optimistic removal from the list.
    setAccounts((prev) => (prev ? prev.filter((a) => !selectedIds.has(a.id)) : prev));
    try {
      const results = await Promise.allSettled(ids.map((id) => deleteAccount(id)));
      const failures = results.filter((r) => r.status === "rejected").length;
      const queued = results.filter(
        (r) => r.status === "fulfilled" && r.value.queued,
      ).length;
      setPendingOutbox(pendingOutboxCount());
      if (failures > 0) {
        toast.error(`${failures} deletion${failures === 1 ? "" : "s"} failed — reloading.`);
        setReloadKey((k) => k + 1);
      } else if (queued > 0) {
        toast(`Queued ${queued} deletion${queued === 1 ? "" : "s"} — will sync when online.`);
      } else {
        toast.success(`Deleted ${ids.length} account${ids.length === 1 ? "" : "s"}.`);
      }
    } finally {
      setBulkBusy(false);
      exitSelection();
    }
  }, [selectedIds, exitSelection]);

  const runBulkAddTag = useCallback(
    async (tag: string) => {
      const ids = [...selectedIds];
      if (ids.length === 0 || !tag) return;
      setBulkBusy(true);
      // Optimistic — union the tag into every selected account.
      setAccounts((prev) =>
        prev
          ? prev.map((a) => {
              if (!selectedIds.has(a.id)) return a;
              const set = new Set(a.tags ?? []);
              set.add(tag);
              return { ...a, tags: [...set] };
            })
          : prev,
      );
      try {
        const results = await Promise.allSettled(
          ids.map(async (id) => {
            const acc = accounts?.find((a) => a.id === id);
            if (!acc) return;
            const next = Array.from(new Set([...(acc.tags ?? []), tag]));
            await setAccountTags(id, next);
          }),
        );
        const failures = results.filter((r) => r.status === "rejected").length;
        refreshPendingCount();
        if (failures > 0) toast.error(`${failures} tag update${failures === 1 ? "" : "s"} failed.`);
        else toast.success(`Tagged ${ids.length} account${ids.length === 1 ? "" : "s"} as “${tag}”.`);
      } finally {
        setBulkBusy(false);
        setBulkTagOpen(false);
        exitSelection();
      }
    },
    [selectedIds, accounts, refreshPendingCount, exitSelection],
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
      setError(err instanceof Error ? err.message : t("vault.error.favorite", "Could not update favorite."));
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
        toast(t("vault.toast.deletionQueued", "Deletion queued — will sync when you're back online."));
      }
    } catch (err) {
      // Server rejected the delete for a non-network reason — surface it
      // and force a reload so the UI matches the server.
      setError(err instanceof Error ? err.message : t("vault.error.delete", "Could not delete."));
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
          setError(err instanceof Error ? err.message : t("vault.error.load", "Failed to load vault."));
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
          toast.success(t(n === 1 ? "vault.toast.syncedChanges.one" : "vault.toast.syncedChanges.other", `Synced ${n} pending change${n === 1 ? "" : "s"}`, { count: n }));
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
        toast.success(t(n === 1 ? "vault.toast.syncedTags.one" : "vault.toast.syncedTags.other", `Synced ${n} tag update${n === 1 ? "" : "s"}`, { count: n }));
        setReloadKey((k) => k + 1);
      } else if (hasQueuedTagUpdates()) {
        toast.error(t("vault.toast.tagSyncStuck", "Some tag updates still can't reach the server."));
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
        title={t("vault.title", "Your codes")}
        subtitle={
          accounts && accounts.length > 0
            ? (accounts.length === 1
                ? t("vault.subtitle.count.one", "{count} account · tap to copy")
                : t("vault.subtitle.count.other", "{count} accounts · tap to copy")
              ).replace("{count}", String(accounts.length))
            : t("vault.subtitle.empty", "One-time codes, encrypted end-to-end.")
        }
      />

      <InstallPrompt />

      {plan.isFree && accounts && accounts.length >= 20 && (
        <div className="mb-2 mt-1">
          <UpgradePrompt
            title={
              accounts.length >= 25
                ? t("vault.freeLimit.hit", `You've hit the Free limit (${accounts.length}/25)`, { count: accounts.length })
                : t("vault.freeLimit.progress", `${accounts.length}/25 accounts used`, { count: accounts.length })
            }
            body={t("vault.freeLimit.body", "Upgrade to Pro for 500 accounts, encrypted cloud backup, and breach monitoring.")}
            tier="Pro"
          />
        </div>
      )}


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
              ? t("vault.offline.reconnecting", "Reconnecting — showing cached codes.")
              : pendingOutbox > 0
                ? t(
                    pendingOutbox === 1 ? "vault.offline.queued.one" : "vault.offline.queued.other",
                    `You're offline — ${pendingOutbox} change${pendingOutbox === 1 ? "" : "s"} queued for sync.`,
                    { count: pendingOutbox },
                  )
                : t("vault.offline.cached", "You're offline — showing cached codes. Add is disabled.")}
          </span>
          <button
            type="button"
            onClick={retry}
            disabled={retrying}
            className="flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[11px] transition-colors disabled:opacity-60"
            style={{
              background: "rgb(var(--aegis-ink-rgb) / 0.06)",
              color: CHARCOAL,
              fontWeight: 600,
            }}
            aria-label={t("vault.offline.retryAria", "Retry loading vault")}
          >
            {retrying ? (
              <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2} />
            ) : (
              <RefreshCw className="h-3 w-3" strokeWidth={2} />
            )}
            {t("vault.offline.retry", "Retry")}
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
              ? t(
                  pendingTagCount === 1 ? "vault.tagSync.pending.one" : "vault.tagSync.pending.other",
                  `${pendingTagCount} tag update${pendingTagCount === 1 ? "" : "s"} waiting to sync.`,
                  { count: pendingTagCount },
                )
              : t(
                  pendingTagCount === 1 ? "vault.tagSync.pendingOffline.one" : "vault.tagSync.pendingOffline.other",
                  `${pendingTagCount} tag update${pendingTagCount === 1 ? "" : "s"} saved locally — will sync when online.`,
                  { count: pendingTagCount },
                )}
          </span>
          {online && (
            <button
              type="button"
              onClick={syncPendingTags}
              disabled={syncingTags}
              className="flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[11px] transition-colors disabled:opacity-60"
              style={{
                background: "rgb(var(--aegis-ink-rgb) / 0.06)",
                color: CHARCOAL,
                fontWeight: 600,
              }}
              aria-label={t("vault.tagSync.retryAria", "Retry syncing tag updates")}
            >
              {syncingTags ? (
                <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2} />
              ) : (
                <RefreshCw className="h-3 w-3" strokeWidth={2} />
              )}
              {t("vault.tagSync.syncNow", "Sync now")}
            </button>
          )}
        </div>
      )}

      {accounts && accounts.length > 0 && !selectionMode && (
        <SearchField
          value={query}
          onChange={setQuery}
          menu={
            <SearchMenu
              onSelect={() => enterSelection()}
              onManageTags={allTags.length > 0 ? () => setTagManagerOpen(true) : undefined}
              onClearFilters={activeTags.size > 0 ? () => setActiveTags(new Set()) : undefined}
              activeFilterCount={activeTags.size}
              tags={allTags}
              activeTags={activeTags}
              onToggleTag={toggleTagFilter}
            />
          }
        />
      )}

      <div className="pt-2">
        <IncomingSharesSection />


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
            dndEnabled={online && !query.trim() && activeTags.size === 0 && !selectionMode}
            onReorder={handleReorder}
            selectionMode={selectionMode}
            selectedIds={selectedIds}
            onSelectToggle={toggleSelect}
          />
        )}

        {accounts && accounts.length > 0 && filtered && filtered.length === 0 && (
          <div
            className="mt-4 rounded-[14px] px-4 py-6 text-center text-[13px]"
            style={{ background: CREAM_SOFT, border: `1px solid ${BORDER}`, color: MUTED }}
          >
            {activeTags.size > 0
              ? t("vault.empty.filters", "No account matches the current filters.")
              : t("vault.empty.query", `No account matches "${query}".`, { query })}
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

      {selectionMode && accounts && (
        <BulkActionsBar
          count={selectedIds.size}
          busy={bulkBusy}
          onSelectAll={() =>
            selectAllVisible((filtered ?? accounts).map((a) => a.id))
          }
          onCancel={exitSelection}
          onDelete={() => setBulkDeleteConfirm(true)}
          onTag={() => setBulkTagOpen(true)}
          onExport={() => setBulkExportOpen(true)}
        />
      )}

      <AnimatePresence>
        {bulkDeleteConfirm && (
          <motion.div
            key="bulk-delete-sheet"
            className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.button
              aria-label={t("common.close", "Close")}
              onClick={() => !bulkBusy && setBulkDeleteConfirm(false)}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0"
              style={{ background: "rgb(var(--aegis-ink-rgb) / 0.35)", backdropFilter: "blur(4px)" }}
            />
            <motion.div
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="bulk-delete-title"
              aria-describedby="bulk-delete-desc"
              initial={{ y: 40, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 40, opacity: 0 }}
              transition={soft}
              className="relative z-10 mx-auto w-full max-w-[440px] rounded-t-[22px] px-5 pb-[max(20px,env(safe-area-inset-bottom))] pt-4 sm:rounded-[22px] focus:outline-none"
              style={{
                background: CREAM_SOFT,
                border: `1px solid ${BORDER}`,
                boxShadow: "0 -12px 40px -12px rgba(0,0,0,0.25)",
              }}
            >
              <div
                aria-hidden
                className="mx-auto mb-3 h-[4px] w-10 rounded-full"
                style={{ background: "rgb(var(--aegis-ink-rgb) / 0.15)" }}
              />
              <div className="mb-3 flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <div
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[13px]"
                    style={{
                      background: "hsl(6, 42%, 92%)",
                      color: DANGER,
                      border: `1px solid ${BORDER}`,
                    }}
                  >
                    <Trash2 className="h-5 w-5" strokeWidth={1.8} />
                  </div>
                  <div className="min-w-0">
                    <div id="bulk-delete-title" className="truncate" style={typeSheetTitleSm}>
                      {t(
                        selectedIds.size === 1 ? "vault.bulkDelete.title.one" : "vault.bulkDelete.title.other",
                        `Remove ${selectedIds.size} account${selectedIds.size === 1 ? "" : "s"}?`,
                        { count: selectedIds.size },
                      )}
                    </div>
                    <div className="mt-0.5 truncate" style={{ ...typeSubLabel, fontSize: 12 }}>
                      {t("vault.bulkDelete.subtitle", "Selected from your vault")}
                    </div>
                  </div>

                </div>
                <motion.button
                  whileTap={{ scale: 0.9 }}
                  onClick={() => !bulkBusy && setBulkDeleteConfirm(false)}
                  disabled={bulkBusy}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
                  style={{ background: "rgb(var(--aegis-ink-rgb) / 0.06)", color: CHARCOAL }}
                  aria-label={t("common.close", "Close")}
                >
                  <X className="h-4 w-4" strokeWidth={1.8} />
                </motion.button>
              </div>

              <p
                id="bulk-delete-desc"
                className="mb-4"
                style={{ ...typeBody, fontSize: 13 }}
              >
                {t(
                  "vault.bulkDelete.body",
                  "The encrypted secrets will be deleted from your vault. You'll need the original QR codes or setup keys to add them back. This can't be undone.",
                )}
              </p>


              <div className="flex flex-col gap-2 pb-1">
                <motion.button
                  whileTap={{ scale: 0.99 }}
                  onClick={async () => {
                    setBulkDeleteConfirm(false);
                    await runBulkDelete();
                  }}
                  disabled={bulkBusy}
                  className="flex items-center justify-center gap-2 rounded-[14px] px-4 py-3.5 text-[14px]"
                  style={{
                    background: DANGER,
                    color: CREAM_SOFT,
                    fontWeight: 600,
                    letterSpacing: "-0.005em",
                    opacity: bulkBusy ? 0.75 : 1,
                  }}
                >
                  {bulkBusy ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      {t("vault.bulkDelete.removing", "Removing…")}
                    </>
                  ) : (
                    <>
                      <Trash2 className="h-4 w-4" strokeWidth={1.9} />
                      {t(
                        selectedIds.size === 1 ? "vault.bulkDelete.confirm.one" : "vault.bulkDelete.confirm.other",
                        `Remove ${selectedIds.size} account${selectedIds.size === 1 ? "" : "s"}`,
                        { count: selectedIds.size },
                      )}
                    </>
                  )}
                </motion.button>
                <motion.button
                  whileTap={{ scale: 0.99 }}
                  onClick={() => !bulkBusy && setBulkDeleteConfirm(false)}
                  disabled={bulkBusy}
                  className="rounded-[14px] px-4 py-3.5 text-[14px]"
                  style={{
                    background: "rgb(var(--aegis-ink-rgb) / 0.03)",
                    color: CHARCOAL,
                    border: `1px solid ${BORDER}`,
                    fontWeight: 500,
                  }}
                >
                  {t("common.cancel", "Cancel")}
                </motion.button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {bulkTagOpen && (
        <BulkTagSheet
          onClose={() => setBulkTagOpen(false)}
          onPick={(tag) => void runBulkAddTag(tag)}
        />
      )}

      {bulkExportOpen && accounts && (
        <ExportPassphraseSheet
          accounts={accounts.filter((a) => selectedIds.has(a.id))}
          onClose={() => setBulkExportOpen(false)}
          onDone={(n) => {
            setBulkExportOpen(false);
            exitSelection();
            toast.success(t(n === 1 ? "vault.toast.exported.one" : "vault.toast.exported.other", `Exported ${n} account${n === 1 ? "" : "s"}.`, { count: n }));
          }}
          title={t("vault.export.selectedTitle", "Export selected")}
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
  dndEnabled,
  onReorder,
  selectionMode,
  selectedIds,
  onSelectToggle,
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
  dndEnabled: boolean;
  onReorder: (group: "fav" | "other", orderedIds: string[]) => void;
  selectionMode: boolean;
  selectedIds: Set<string>;
  onSelectToggle: (id: string) => void;
}) {
  const t = useT();
  const showBothLabels = favoriteList.length > 0 && otherList.length > 0;

  // Long-press activation keeps normal tap-to-copy working: a real drag
  // only starts after the pointer is held for 220ms and moves >8px.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { delay: 220, tolerance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }),
  );

  const favIds = useMemo(() => favoriteList.map((a) => a.id), [favoriteList]);
  const otherIds = useMemo(() => otherList.map((a) => a.id), [otherList]);

  const handleDragEnd = (group: "fav" | "other") => (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const ids = group === "fav" ? favIds : otherIds;
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    onReorder(group, arrayMove(ids, from, to));
  };

  const renderRow = (a: DecryptedAccount, opts: { withTopBorder: boolean }) => (
    <SortableAccountRow
      key={a.id}
      id={a.id}
      enabled={dndEnabled}
      withTopBorder={opts.withTopBorder}
      selectionMode={selectionMode}
      selected={selectedIds.has(a.id)}
      onSelectToggle={onSelectToggle}
    >
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
    </SortableAccountRow>
  );

  return (
    <div className="flex flex-col gap-1.5">
      {favoriteList.length > 0 && <SectionLabel>{t("vault.section.favorites", "Favorites")}</SectionLabel>}
      <div
        className="overflow-hidden rounded-[16px]"
        style={{
          background: CREAM_SOFT,
          border: `1px solid ${BORDER}`,
          boxShadow: "inset 0 1px 0 rgba(255,255,255,0.6)",
        }}
      >
        {favoriteList.length > 0 && (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd("fav")}>
            <SortableContext items={favIds} strategy={verticalListSortingStrategy}>
              <div>{favoriteList.map((a, idx) => renderRow(a, { withTopBorder: idx > 0 }))}</div>
            </SortableContext>
          </DndContext>
        )}
        {showBothLabels && (
          <div className="px-4 pb-1.5 pt-3">
            <SectionLabel>{t("vault.section.all", "All accounts")}</SectionLabel>
          </div>
        )}
        {otherList.length > 0 && (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd("other")}>
            <SortableContext items={otherIds} strategy={verticalListSortingStrategy}>
              <div>{otherList.map((a, idx) => renderRow(a, { withTopBorder: idx > 0 }))}</div>
            </SortableContext>
          </DndContext>
        )}
      </div>
    </div>
  );
}

function SortableAccountRow({
  id,
  enabled,
  withTopBorder,
  selectionMode,
  selected,
  onSelectToggle,
  children,
}: {
  id: string;
  enabled: boolean;
  withTopBorder: boolean;
  selectionMode: boolean;
  selected: boolean;
  onSelectToggle: (id: string) => void;
  children: React.ReactNode;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, disabled: !enabled });
  const t = useT();

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    borderTop: withTopBorder ? `1px solid ${BORDER}` : undefined,
    background: isDragging
      ? "rgb(var(--aegis-ink-rgb) / 0.04)"
      : selectionMode && selected
        ? "rgb(var(--aegis-ink-rgb) / 0.05)"
        : undefined,
    zIndex: isDragging ? 5 : undefined,
    boxShadow: isDragging ? "0 6px 18px rgba(0,0,0,0.12)" : undefined,
    touchAction: enabled ? "manipulation" : undefined,
    position: "relative",
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...(enabled ? listeners : {})}
    >
      {children}
      {selectionMode && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onSelectToggle(id);
          }}
          aria-pressed={selected}
          aria-label={selected ? t("vault.select.off", "Deselect account") : t("vault.select.on", "Select account")}
          className="absolute inset-0 flex items-start justify-end p-3"
          style={{
            background: selected ? "rgb(var(--aegis-ink-rgb) / 0.04)" : "transparent",
            cursor: "pointer",
          }}
        >
          <span
            className="flex h-6 w-6 items-center justify-center rounded-full"
            style={{
              background: selected ? CHARCOAL : CREAM_SOFT,
              border: `1px solid ${selected ? CHARCOAL : BORDER}`,
              color: selected ? CREAM_SOFT : "transparent",
            }}
          >
            <Check className="h-3.5 w-3.5" strokeWidth={2.4} />
          </span>
        </button>
      )}
    </div>
  );
}



function TagFilterRow({
  tags,
  active,
  onToggle,
}: {
  tags: { tag: string; count: number }[];
  active: Set<string>;
  onToggle: (tag: string) => void;
}) {
  const activeCount = active.size;
  const t = useT();
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
      <div className="mb-1.5 flex items-center gap-2 px-0.5">
        <span style={typeEyebrow}>{t("vault.filter.label", "Filter")}</span>
        {activeCount > 0 && (
          <span
            className="rounded-full px-1.5 py-0.5"
            style={{
              ...typeBadge,
              background: CHARCOAL,
              fontWeight: 700,
              fontFamily: "var(--font-mono)",
              letterSpacing: "0.06em",
            }}
          >
            {activeCount}
          </span>
        )}
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
                  background: isActive ? CHARCOAL : CREAM_SOFT,
                  color: isActive ? CREAM_SOFT : CHARCOAL,
                  border: `1px solid ${isActive ? CHARCOAL : BORDER}`,
                  fontWeight: isActive ? 600 : 500,
                  boxShadow: isActive
                    ? "0 1px 2px rgb(var(--aegis-ink-rgb) / 0.15)"
                    : "inset 0 1px 0 rgb(255 255 255 / 0.06)",
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
                    color: isActive ? "color-mix(in oklab, var(--aegis-cream-soft) 70%, transparent)" : MUTED,
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
        style={{ background: "rgb(var(--aegis-ink-rgb) / 0.35)", backdropFilter: "blur(4px)" }}
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
          style={{ background: "rgb(var(--aegis-ink-rgb) / 0.15)" }}
        />
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h3 style={typeSheetTitle}>Manage tags</h3>
            <p style={typeSubLabel}>Rename or delete tags across every account.</p>

          </div>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full"
            style={{ background: "rgb(var(--aegis-ink-rgb) / 0.06)", color: CHARCOAL }}
            aria-label="Close"
          >
            <X className="h-4 w-4" strokeWidth={1.8} />
          </button>
        </div>

        {tagIndex.length === 0 ? (
          <div
            className="rounded-[14px] px-4 py-8 text-center text-[13px]"
            style={{ background: CREAM_SOFT, border: `1px solid ${BORDER}`, color: MUTED }}
          >
            No tags yet. Add one from any account's details sheet.
          </div>
        ) : (
          <div
            className="aegis-scroll flex-1 overflow-y-auto rounded-[14px]"
            style={{ background: CREAM_SOFT, border: `1px solid ${BORDER}` }}
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
                          style={{ borderColor: BORDER, color: CHARCOAL, background: CREAM_SOFT }}
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
                            background: "rgb(var(--aegis-ink-rgb) / 0.06)",
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
                            background: "rgb(var(--aegis-danger-rgb) / 0.08)",
                            color: "var(--aegis-danger)",

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

function SearchField({
  value,
  onChange,
  menu,
}: {
  value: string;
  onChange: (v: string) => void;
  menu?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2">
      <div
        className="flex h-11 flex-1 shrink-0 items-center gap-2 rounded-full px-3.5"
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
          className="flex-1 bg-transparent text-[13.5px] outline-none placeholder:text-[color:var(--aegis-placeholder)]"
          style={{ color: CHARCOAL }}
        />
        {value && (
          <button
            type="button"
            onClick={() => onChange("")}
            className="flex h-6 w-6 items-center justify-center rounded-full"
            style={{ color: MUTED, background: "rgb(var(--aegis-ink-rgb) / 0.06)" }}
            aria-label="Clear search"
          >
            <X className="h-3 w-3" strokeWidth={2} />
          </button>
        )}
      </div>
      {menu}
    </div>
  );
}

function SearchMenu({
  onSelect,
  onManageTags,
  onClearFilters,
  activeFilterCount,
  tags,
  activeTags,
  onToggleTag,
}: {
  onSelect: () => void;
  onManageTags?: () => void;
  onClearFilters?: () => void;
  activeFilterCount: number;
  tags: { tag: string; count: number }[];
  activeTags: Set<string>;
  onToggleTag: (tag: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const orderedTags = useMemo(() => {
    return [...tags].sort((a, b) => {
      const aOn = activeTags.has(a.tag) ? 0 : 1;
      const bOn = activeTags.has(b.tag) ? 0 : 1;
      if (aOn !== bOn) return aOn - bOn;
      return b.count - a.count || a.tag.localeCompare(b.tag);
    });
  }, [tags, activeTags]);

  const item = (icon: React.ReactNode, label: string, onClick: () => void, hint?: string) => (
    <button
      type="button"
      onClick={() => {
        setOpen(false);
        onClick();
      }}
      className="flex w-full items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-left text-[13px] transition-colors hover:bg-[rgb(var(--aegis-ink-rgb)/0.06)]"
      style={{ color: CHARCOAL, fontWeight: 500 }}
    >
      <span className="flex h-6 w-6 items-center justify-center" style={{ color: MUTED }}>
        {icon}
      </span>
      <span className="flex-1">{label}</span>
      {hint && (
        <span className="text-[10.5px] tabular-nums" style={{ color: MUTED }}>
          {hint}
        </span>
      )}
    </button>
  );

  return (
    <div ref={wrapRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="More actions"
        className="relative flex h-11 w-11 items-center justify-center rounded-full transition-colors active:scale-[0.97]"
        style={{
          background: CREAM_SOFT,
          border: `1px solid ${BORDER}`,
          boxShadow: "inset 0 1px 0 rgba(255,255,255,0.5)",
          color: CHARCOAL,
        }}
      >
        <MoreHorizontal className="h-4 w-4" strokeWidth={1.8} />
        {activeFilterCount > 0 && (
          <span
            aria-hidden
            className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full"
            style={{ background: CHARCOAL }}
          />
        )}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            initial={{ opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.14, ease: [0.4, 0, 0.2, 1] }}
            className="absolute right-0 top-[calc(100%+6px)] z-30 w-[240px] rounded-[14px] p-1.5"
            style={{
              background: CREAM_SOFT,
              border: `1px solid ${BORDER}`,
              boxShadow:
                "0 8px 24px -8px rgb(var(--aegis-ink-rgb) / 0.18), 0 2px 6px -2px rgb(var(--aegis-ink-rgb) / 0.10)",
            }}
          >
            {item(<CheckSquare className="h-3.5 w-3.5" strokeWidth={1.8} />, "Select multiple", onSelect)}
            {onManageTags &&
              item(<Tags className="h-3.5 w-3.5" strokeWidth={1.8} />, "Manage tags", onManageTags)}
            {onClearFilters &&
              item(
                <X className="h-3.5 w-3.5" strokeWidth={1.8} />,
                "Clear filters",
                onClearFilters,
                String(activeFilterCount),
              )}

            {orderedTags.length > 0 && (
              <>
                <div
                  className="mt-1.5 flex items-center justify-between px-2.5 pb-1 pt-2 text-[10.5px] uppercase tracking-[0.08em]"
                  style={{ color: MUTED, fontWeight: 600 }}
                >
                  <span>Filter by tag</span>
                  {activeFilterCount > 0 && (
                    <span className="tabular-nums normal-case tracking-normal" style={{ color: CHARCOAL }}>
                      {activeFilterCount} on
                    </span>
                  )}
                </div>
                <div className="flex max-h-[220px] flex-wrap gap-1.5 overflow-y-auto px-1.5 pb-1.5">
                  {orderedTags.map(({ tag, count }) => {
                    const isActive = activeTags.has(tag);
                    return (
                      <button
                        key={tag}
                        type="button"
                        onClick={() => onToggleTag(tag)}
                        className="flex max-w-full items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] transition-colors"
                        style={{
                          background: isActive ? CHARCOAL : "rgb(var(--aegis-ink-rgb) / 0.05)",
                          color: isActive ? CREAM_SOFT : CHARCOAL,
                          border: `1px solid ${isActive ? CHARCOAL : BORDER}`,
                          fontWeight: 500,
                        }}
                      >
                        <span
                          aria-hidden
                          className="h-1.5 w-1.5 shrink-0 rounded-full"
                          style={{
                            background: isActive ? CREAM_SOFT : `hsl(${hashHue(tag)}, 55%, 55%)`,
                          }}
                        />
                        <span className="truncate">{tag}</span>
                        <span
                          className="tabular-nums"
                          style={{
                            color: isActive ? "rgb(var(--aegis-cream-rgb) / 0.75)" : MUTED,
                            fontSize: "10.5px",
                          }}
                        >
                          {count}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>
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

// -----------------------------------------------------------------------------
// Phase 7.3 — Bulk selection UI
// -----------------------------------------------------------------------------

function BulkActionsBar({
  count,
  busy,
  onSelectAll,
  onCancel,
  onDelete,
  onTag,
  onExport,
}: {
  count: number;
  busy: boolean;
  onSelectAll: () => void;
  onCancel: () => void;
  onDelete: () => void;
  onTag: () => void;
  onExport: () => void;
}) {
  const disabled = count === 0 || busy;
  return (
    <motion.div
      initial={{ y: 60, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: 60, opacity: 0 }}
      transition={soft}
      role="toolbar"
      aria-label="Bulk actions"
      className="fixed inset-x-0 bottom-0 z-40 mx-auto w-full max-w-[440px] px-3 pb-[max(12px,env(safe-area-inset-bottom))]"
    >
      <div
        className="flex items-center gap-1.5 rounded-[18px] p-2"
        style={{
          background: CREAM_SOFT,
          border: `1px solid ${BORDER}`,
          boxShadow: "0 -8px 32px -12px rgba(0,0,0,0.25)",
        }}
      >
        <button
          type="button"
          onClick={onCancel}
          className="flex h-9 w-9 items-center justify-center rounded-full"
          style={{ background: "rgb(var(--aegis-ink-rgb) / 0.06)", color: CHARCOAL }}
          aria-label="Cancel selection"
        >
          <X className="h-4 w-4" strokeWidth={1.8} />
        </button>
        <div className="flex flex-1 items-center gap-2 px-1 text-[13px]" style={{ color: CHARCOAL }}>
          <span style={{ fontWeight: 600 }}>{count}</span>
          <span style={{ color: MUTED }}>selected</span>
          <button
            type="button"
            onClick={onSelectAll}
            className="ml-auto rounded-full px-2 py-0.5 text-[11px]"
            style={{ background: "rgb(var(--aegis-ink-rgb) / 0.06)", color: CHARCOAL, fontWeight: 600 }}
          >
            All
          </button>
        </div>
        <BulkIconBtn label="Add tag" onClick={onTag} disabled={disabled}>
          <TagIcon className="h-4 w-4" strokeWidth={1.8} />
        </BulkIconBtn>
        <BulkIconBtn label="Export selected" onClick={onExport} disabled={disabled}>
          <Download className="h-4 w-4" strokeWidth={1.8} />
        </BulkIconBtn>
        <BulkIconBtn
          label="Delete selected"
          onClick={onDelete}
          disabled={disabled}
          danger
          loading={busy}
        >
          <Trash2 className="h-4 w-4" strokeWidth={1.8} />
        </BulkIconBtn>
      </div>
    </motion.div>
  );
}

function BulkIconBtn({
  label,
  onClick,
  disabled,
  danger,
  loading,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  loading?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="flex h-9 w-9 items-center justify-center rounded-full transition-opacity disabled:opacity-40"
      style={{
        background: danger ? "rgb(var(--aegis-danger-rgb) / 0.10)" : "rgb(var(--aegis-ink-rgb) / 0.06)",
        color: danger ? "var(--aegis-danger)" : CHARCOAL,

      }}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} /> : children}
    </button>
  );
}

function BulkTagSheet({
  onClose,
  onPick,
}: {
  onClose: () => void;
  onPick: (tag: string) => void;
}) {
  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <motion.button
        aria-label="Close"
        onClick={onClose}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="absolute inset-0"
        style={{ background: "rgb(var(--aegis-ink-rgb) / 0.35)", backdropFilter: "blur(4px)" }}
      />
      <motion.div
        initial={{ y: 40, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 40, opacity: 0 }}
        transition={soft}
        className="relative z-10 mx-auto w-full max-w-[440px] rounded-t-[22px] px-6 pb-[max(24px,env(safe-area-inset-bottom))] pt-5 sm:rounded-[22px]"
        style={{
          background: CREAM_SOFT,
          border: `1px solid ${BORDER}`,
          boxShadow: "0 -12px 40px -12px rgba(0,0,0,0.25)",
        }}
      >
        <div className="mb-3 flex items-start justify-between">
          <div>
            <div style={typeSheetTitleLg}>Add tag</div>
            <div className="mt-1" style={{ ...typeSubLabel, fontSize: 12.5 }}>
              Pick a tag to add to every selected account.
            </div>

          </div>
          <motion.button
            whileTap={{ scale: 0.9 }}
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full"
            style={{ background: "rgb(var(--aegis-ink-rgb) / 0.06)", color: CHARCOAL }}
            aria-label="Close"
          >
            <X className="h-4 w-4" strokeWidth={1.8} />
          </motion.button>
        </div>
        <div className="flex flex-wrap gap-1.5 pt-1">
          {PRESET_TAGS.map((t) => (
            <TagChip key={t} tag={t} onClick={() => onPick(t)} />
          ))}
        </div>
      </motion.div>
    </motion.div>
  );
}

