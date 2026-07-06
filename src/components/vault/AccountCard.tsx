import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import {
  Copy,
  Check,
  Star,
  Trash2,
  Loader2,
  X,
  EyeOff,
  ShieldCheck,
  Clock3,
  Pencil,
  MousePointerClick,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import {
  advanceHotpCounter,
  generateCode,
  setAccountTags,
  updateAccountDetails,
  type DecryptedAccount,
} from "@/lib/vault-accounts";
import { getVaultKey } from "@/lib/vault-session";
import { BORDER, CHARCOAL, CREAM_SOFT, DANGER, FAV, MUTED, soft } from "@/components/aegis/chrome";
import {
  typeBadge,
  typeBody,
  typeCardTitle,
  typeCode,
  typeCodeLg,
  typeCodeNext,
  typeDanger,
  typeEyebrow,
  typeMetaLabel,
  typeMetaValue,
  typeSheetTitle,
  typeSheetTitleSm,
  typeSubLabel,
  typeTimer,
} from "@/components/aegis/typography";

import { logoUrlFor, domainFromIssuer } from "@/lib/issuer-domain";
import { useHideCodes } from "@/lib/vault-privacy";
import { TagChip, TagInput } from "@/components/vault/tags";
import { useLingui } from "@lingui/react";


// Shared edit-mode motion. iOS-style ease with a slightly longer collapse
// than expand so exit feels intentional, not abrupt. Opacity resolves a hair
// before height so content doesn't clip mid-fade.
const EDIT_EASE = [0.32, 0.72, 0, 1] as const;
const EDIT_EXPAND = {
  height: { duration: 0.28, ease: EDIT_EASE },
  opacity: { duration: 0.2, ease: EDIT_EASE, delay: 0.04 },
  y: { duration: 0.28, ease: EDIT_EASE },
  marginBottom: { duration: 0.28, ease: EDIT_EASE },
};
const EDIT_COLLAPSE = {
  height: { duration: 0.24, ease: EDIT_EASE, delay: 0.04 },
  opacity: { duration: 0.16, ease: EDIT_EASE },
  y: { duration: 0.2, ease: EDIT_EASE },
  marginBottom: { duration: 0.24, ease: EDIT_EASE, delay: 0.04 },
};
const ACTION_SWAP = { duration: 0.22, ease: EDIT_EASE } as const;

// Dedupe toast per issuer so the same failing logo doesn't spam notifications.
const notifiedIssuers = new Set<string>();
function notifyLogoIssue(issuer: string, reason: "unmapped" | "error") {
  const key = `${reason}:${issuer.toLowerCase()}`;
  if (notifiedIssuers.has(key)) return;
  notifiedIssuers.add(key);
  const label = issuer || "this account";
  if (reason === "unmapped") {
    toast.message(`No logo found for "${label}"`, {
      description: "Showing initials instead — we couldn't match a website domain.",
    });
  } else {
    toast.error(`Couldn't load logo for "${label}"`, {
      description: "The image failed to load. Showing initials instead.",
    });
  }
}

// Singleton clipboard-clear timer: last copied code wins. After 30s we
// overwrite the clipboard so a forgotten copy doesn't linger.
const CLIPBOARD_CLEAR_MS = 30_000;
let clipboardClearTimer: number | null = null;
let lastCopiedPlain: string | null = null;

function scheduleClipboardClear(plain: string) {
  if (typeof window === "undefined") return;
  lastCopiedPlain = plain;
  if (clipboardClearTimer !== null) window.clearTimeout(clipboardClearTimer);
  clipboardClearTimer = window.setTimeout(async () => {
    clipboardClearTimer = null;
    try {
      // Only clear if we can confirm the clipboard still holds our code —
      // otherwise we'd wipe whatever the user copied afterwards.
      const current = await navigator.clipboard.readText().catch(() => null);
      if (current !== null && current === lastCopiedPlain) {
        await navigator.clipboard.writeText("");
      } else if (current === null) {
        // Permission denied for read: overwrite defensively.
        await navigator.clipboard.writeText("");
      }
    } catch {
      /* ignore */
    } finally {
      lastCopiedPlain = null;
    }
  }, CLIPBOARD_CLEAR_MS);
}

// Modal a11y: Escape to close, focus trap within panel, restore focus on close,
// and lock background scroll while open.
function useModalA11y(
  open: boolean,
  panelRef: React.RefObject<HTMLElement | null>,
  onClose: () => void,
) {
  useEffect(() => {
    if (!open) return;
    if (typeof document === "undefined") return;

    const previouslyFocused = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    // Move focus into the panel after mount.
    const focusFirst = () => {
      const panel = panelRef.current;
      if (!panel) return;
      const focusables = panel.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      (focusables[0] ?? panel).focus();
    };
    const raf = window.requestAnimationFrame(focusFirst);

    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusables = Array.from(
        panel.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => el.offsetParent !== null || el === panel);
      if (focusables.length === 0) {
        e.preventDefault();
        panel.focus();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && (active === first || !panel.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKey);

    return () => {
      window.cancelAnimationFrame(raf);
      document.removeEventListener("keydown", handleKey);
      document.body.style.overflow = prevOverflow;
      // Restore focus to the element that opened the modal.
      if (previouslyFocused && typeof previouslyFocused.focus === "function") {
        previouslyFocused.focus();
      }
    };
  }, [open, onClose, panelRef]);
}

interface Props {
  account: DecryptedAccount;
  now: number;
  isFavorite?: boolean;
  onToggleFavorite?: (id: string) => void;
  onDelete?: (id: string) => Promise<void> | void;
  onTagsChanged?: (id: string, tags: string[]) => void;
  onDetailsChanged?: (id: string, patch: { issuer: string; label: string }) => void;
  allTagSuggestions?: string[];
}

function formatCode(code: string): string {
  const mid = Math.ceil(code.length / 2);
  return `${code.slice(0, mid)} ${code.slice(mid)}`;
}

function initials(source: string): string {
  const s = source.trim();
  if (!s) return "?";
  const parts = s.split(/[\s._-]+/).filter(Boolean);
  const chars = parts.length >= 2 ? parts[0][0] + parts[1][0] : s.slice(0, 2);
  return chars.toUpperCase();
}

function hueFor(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return h % 360;
}

export function AccountCard({
  account,
  now,
  isFavorite,
  onToggleFavorite,
  onDelete,
  onTagsChanged,
  onDetailsChanged,
  allTagSuggestions,
}: Props) {
  const hideCodes = useHideCodes();
  const { i18n } = useLingui();
  const t = (id: string, fallback: string) => {
    const msg = i18n._(id);
    return msg === id ? fallback : msg;
  };
  const [copied, setCopied] = useState(false);
  const [logoFailed, setLogoFailed] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [revealed, setRevealed] = useState(!hideCodes);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [editing, setEditing] = useState(false);
  const [issuerDraft, setIssuerDraft] = useState(account.issuer ?? "");
  const [labelDraft, setLabelDraft] = useState(account.label ?? "");
  const [detailsSaving, setDetailsSaving] = useState(false);
  const [detailsError, setDetailsError] = useState<string | null>(null);
  const [tagsDraft, setTagsDraft] = useState<string[]>(account.tags ?? []);
  const [tagSaving, setTagSaving] = useState(false);
  const [tagError, setTagError] = useState<string | null>(null);
  useEffect(() => {
    setTagsDraft(account.tags ?? []);
  }, [account.tags]);
  useEffect(() => {
    setIssuerDraft(account.issuer ?? "");
    setLabelDraft(account.label ?? "");
  }, [account.issuer, account.label]);

  const dirtyTags = useMemo(() => {
    const a = [...(account.tags ?? [])].sort();
    const b = [...tagsDraft].sort();
    if (a.length !== b.length) return true;
    return a.some((v, i) => v !== b[i]);
  }, [account.tags, tagsDraft]);

  const dirtyDetails = useMemo(() => {
    return (
      issuerDraft.trim() !== (account.issuer ?? "").trim() ||
      labelDraft.trim() !== (account.label ?? "").trim()
    );
  }, [account.issuer, account.label, issuerDraft, labelDraft]);

  const canSaveEdits = (dirtyTags || dirtyDetails) && issuerDraft.trim().length > 0;

  const saveTags = async () => {
    if (!dirtyTags) return;
    setTagSaving(true);
    setTagError(null);
    try {
      const { tags: saved, queued } = await setAccountTags(account.id, tagsDraft);
      onTagsChanged?.(account.id, saved);
      setTagsDraft(saved);
      if (queued) {
        toast.success("Tags saved locally — will sync when you're back online");
      } else {
        toast.success("Tags updated");
      }
    } catch (e) {
      setTagError(e instanceof Error ? e.message : "Could not update tags.");
    } finally {
      setTagSaving(false);
    }
  };

  const saveEdits = async () => {
    if (!canSaveEdits || detailsSaving) return;
    setDetailsSaving(true);
    setDetailsError(null);
    setTagError(null);

    // Run details + tags in parallel so a slow write on one doesn't
    // serialize the other, and so we can report which half (if any)
    // failed instead of silently leaving a partial update behind.
    const detailsPromise = dirtyDetails
      ? updateAccountDetails(account.id, { issuer: issuerDraft, label: labelDraft })
      : Promise.resolve(null);
    const tagsPromise = dirtyTags
      ? setAccountTags(account.id, tagsDraft)
      : Promise.resolve(null);

    const [detailsResult, tagsResult] = await Promise.allSettled([
      detailsPromise,
      tagsPromise,
    ]);

    let queuedTags = false;
    let queuedDetails = false;
    const errors: string[] = [];

    if (detailsResult.status === "fulfilled" && detailsResult.value) {
      const saved = detailsResult.value;
      onDetailsChanged?.(account.id, { issuer: saved.issuer, label: saved.label });
      setIssuerDraft(saved.issuer);
      setLabelDraft(saved.label);
      queuedDetails = saved.queued;
    } else if (detailsResult.status === "rejected") {
      const msg =
        detailsResult.reason instanceof Error
          ? detailsResult.reason.message
          : "Could not update details.";
      setDetailsError(msg);
      errors.push(msg);
    }

    if (tagsResult.status === "fulfilled" && tagsResult.value) {
      const { tags: saved, queued } = tagsResult.value;
      onTagsChanged?.(account.id, saved);
      setTagsDraft(saved);
      queuedTags = queued;
    } else if (tagsResult.status === "rejected") {
      const msg =
        tagsResult.reason instanceof Error
          ? tagsResult.reason.message
          : "Could not update tags.";
      setTagError(msg);
      errors.push(msg);
    }

    setDetailsSaving(false);

    if (errors.length === 0) {
      const anyQueued = queuedTags || queuedDetails;
      toast.success(
        anyQueued ? "Changes saved · will sync when back online" : "Changes saved",
      );
      setEditing(false);
      return;
    }

    // Partial or full failure: keep edit mode open so the user can retry.
    // Drafts already reflect anything that DID persist (via the setters
    // above), so Cancel will correctly restore to the new server truth.
    if (errors.length === 2) {
      toast.error("Couldn't save changes. Please try again.");
    } else {
      toast.error(
        detailsResult.status === "rejected"
          ? "Tags saved, but details couldn't be updated."
          : "Details saved, but tags couldn't be updated.",
      );
    }
  };


  const cancelEdit = () => {
    setIssuerDraft(account.issuer ?? "");
    setLabelDraft(account.label ?? "");
    setTagsDraft(account.tags ?? []);
    setDetailsError(null);
    setTagError(null);
    setEditing(false);
  };

  const pressTimer = useRef<number | null>(null);
  const longPressedRef = useRef(false);
  const detailsPanelRef = useRef<HTMLDivElement | null>(null);
  const confirmPanelRef = useRef<HTMLDivElement | null>(null);
  const editButtonRef = useRef<HTMLButtonElement | null>(null);
  const firstEditFieldRef = useRef<HTMLInputElement | null>(null);
  const wasEditingRef = useRef(false);
  const detailsTitleId = `acc-details-${account.id}`;
  const confirmTitleId = `acc-confirm-${account.id}`;
  const confirmDescId = `acc-confirm-desc-${account.id}`;

  // Reduced-motion: honor the OS pref by removing translation and layout
  // easing, but keep a short opacity crossfade so state changes are still
  // perceivable (WCAG 2.3.3 allows non-essential fades). Height/margin
  // snap instantly to avoid parallax-style movement.
  const prefersReducedMotion = useReducedMotion();
  const zero = { duration: 0 } as const;
  const rmFade = { duration: 0.12, ease: "linear" } as const;
  const expandT = prefersReducedMotion
    ? { height: zero, marginBottom: zero, y: zero, opacity: rmFade }
    : EDIT_EXPAND;
  const collapseT = prefersReducedMotion
    ? { height: zero, marginBottom: zero, y: zero, opacity: rmFade }
    : EDIT_COLLAPSE;
  const actionSwapT = prefersReducedMotion ? { opacity: rmFade, y: zero } : ACTION_SWAP;

  // Keyboard focus management: entering edit mode moves focus to the
  // first editable field; leaving edit mode (Save/Cancel/Esc via close)
  // returns focus to the Edit button so keyboard users don't lose place.
  useEffect(() => {
    if (editing && !wasEditingRef.current) {
      const raf = window.requestAnimationFrame(() => {
        const el = firstEditFieldRef.current;
        if (el) {
          el.focus();
          el.select?.();
        }
      });
      wasEditingRef.current = true;
      return () => window.cancelAnimationFrame(raf);
    }
    if (!editing && wasEditingRef.current) {
      wasEditingRef.current = false;
      const raf = window.requestAnimationFrame(() => {
        editButtonRef.current?.focus();
      });
      return () => window.cancelAnimationFrame(raf);
    }
  }, [editing]);

  useModalA11y(detailsOpen, detailsPanelRef, () => setDetailsOpen(false));
  useModalA11y(confirmOpen, confirmPanelRef, () => {
    if (!deleting) setConfirmOpen(false);
  });

  const isHotp = account.otp_type === "hotp";
  const period = account.period;
  const elapsed = Math.floor(now / 1000) % period;
  // HOTP has no clock — the ring becomes a static ring while a Refresh
  // button drives the counter instead. Set remaining/progress to safe
  // idle values so nothing else in the render tree needs to branch.
  const remaining = isHotp ? period : period - elapsed;
  const progress = isHotp ? 0 : elapsed / period;

  const [hotpBusy, setHotpBusy] = useState(false);
  const [hotpCounter, setHotpCounter] = useState<number>(account.counter ?? 0);
  useEffect(() => {
    if (isHotp) setHotpCounter(account.counter ?? 0);
  }, [account.counter, isHotp]);

  const codeAccount = isHotp ? { ...account, counter: hotpCounter } : account;

  const code = useMemo(() => {
    try {
      return generateCode(codeAccount, now);
    } catch {
      return "------";
    }
  }, [codeAccount, now]);

  // Peek at the next code in the last few seconds so the user can wait
  // for a fresh one instead of copying a code about to expire. HOTP
  // doesn't roll on its own, so the peek is disabled there.
  const showNext = !isHotp && remaining <= 5;
  const nextCode = useMemo(() => {
    if (!showNext) return "";
    try {
      return generateCode(account, now + period * 1000);
    } catch {
      return "";
    }
  }, [account, now, period, showNext]);

  const refreshHotp = async () => {
    if (!isHotp || hotpBusy) return;
    const key = getVaultKey();
    if (!key) {
      toast.error("Unlock your vault to refresh HOTP codes.");
      return;
    }
    setHotpBusy(true);
    try {
      const { counter, queued } = await advanceHotpCounter(key, account.id, hotpCounter);
      setHotpCounter(counter);
      if (typeof navigator.vibrate === "function") navigator.vibrate(6);
      if (queued) toast.message("Next code · will sync when online");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not advance counter.");
    } finally {
      setHotpBusy(false);
    }
  };

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1200);
    return () => clearTimeout(t);
  }, [copied]);

  const copy = async () => {
    if (longPressedRef.current) {
      longPressedRef.current = false;
      return;
    }
    try {
      const plain = code.replace(/\s/g, "");
      await navigator.clipboard.writeText(plain);
      scheduleClipboardClear(plain);
      setCopied(true);
      if (typeof navigator.vibrate === "function") navigator.vibrate(6);
    } catch {
      /* ignore */
    }
  };

  const clearPress = () => {
    if (pressTimer.current !== null) {
      window.clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
  };

  const startPress = () => {
    clearPress();
    longPressedRef.current = false;
    pressTimer.current = window.setTimeout(() => {
      longPressedRef.current = true;
      if (typeof navigator.vibrate === "function") navigator.vibrate(14);
      // Modal opens in the user's default privacy state.
      setRevealed(!hideCodes);
      setDetailsOpen(true);
    }, 500);
  };

  // Keep the modal's reveal state honest as the pref changes while closed.
  useEffect(() => {
    if (!detailsOpen) {
      setRevealed(!hideCodes);
      setEditing(false);
      setDetailsError(null);
    }
  }, [hideCodes, detailsOpen]);

  const openDelete = () => {
    setDetailsOpen(false);
    // Give the details sheet a beat to unmount before the confirm slides in.
    window.setTimeout(() => setConfirmOpen(true), 120);
  };

  const copyFromSheet = async () => {
    try {
      const plain = code.replace(/\s/g, "");
      await navigator.clipboard.writeText(plain);
      scheduleClipboardClear(plain);
      setCopied(true);
      if (typeof navigator.vibrate === "function") navigator.vibrate(6);
      toast.success(`Code copied · clears in 30s`);
    } catch {
      toast.error("Couldn't copy to clipboard.");
    }
  };

  const confirmDelete = async () => {
    if (!onDelete) return;
    setDeleting(true);
    try {
      await onDelete(account.id);
      toast.success(`Removed ${account.issuer || "account"}`);
      setConfirmOpen(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not delete account.");
    } finally {
      setDeleting(false);
    }
  };

  const warn = remaining <= 5;
  const seed = account.issuer || account.label || "?";
  const hue = hueFor(seed);
  const chipBg = `hsl(${hue}, 42%, 92%)`;
  const chipFg = `hsl(${hue}, 40%, 28%)`;
  const logoUrl = useMemo(() => logoUrlFor(account.issuer, 80), [account.issuer]);
  const showLogo = !!logoUrl && !logoFailed;

  useEffect(() => {
    if (!account.issuer) return;
    if (logoUrl) return;
    if (!domainFromIssuer(account.issuer)) {
      notifyLogoIssue(account.issuer, "unmapped");
    }
  }, [account.issuer, logoUrl]);

  return (
    <>
      <motion.button
        onClick={copy}
        onPointerDown={startPress}
        onPointerUp={clearPress}
        onPointerLeave={clearPress}
        onPointerCancel={clearPress}
        onContextMenu={(e) => {
          e.preventDefault();
          longPressedRef.current = true;
          setRevealed(!hideCodes);
          setDetailsOpen(true);
        }}
        whileTap={{ scale: 0.99, backgroundColor: "rgb(var(--aegis-ink-rgb) / 0.03)" }}
        className="group relative flex w-full flex-col gap-2 px-4 py-3 text-left"
        style={{ background: "transparent" }}
      >
        <div className="flex items-center gap-3">
          <div
            className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-[12px] text-[12.5px]"
            style={{
              background: showLogo ? "#fff" : chipBg,
              color: chipFg,
              border: `1px solid ${BORDER}`,
              fontFamily: "'Geist', ui-sans-serif, system-ui, sans-serif",
              fontWeight: 600,
              letterSpacing: "0.02em",
            }}
          >
            {showLogo ? (
              <img
                src={logoUrl!}
                alt=""
                className="h-full w-full object-contain"
                loading="lazy"
                onError={() => {
                  setLogoFailed(true);
                  notifyLogoIssue(account.issuer || seed, "error");
                }}
              />
            ) : (
              initials(seed)
            )}
          </div>

          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex min-w-0 items-center gap-2">
              <div className="truncate" style={typeCardTitle}>
                {account.issuer || "Untitled"}
              </div>
              {account.tags && account.tags.length > 0 && (
                <div className="flex min-w-0 shrink items-center gap-1 overflow-hidden">
                  {account.tags.slice(0, 2).map((t) => (
                    <TagChip key={t} tag={t} size="sm" />
                  ))}
                  {account.tags.length > 2 && (
                    <span
                      className="inline-flex shrink-0 items-center rounded-full px-1.5 py-0.5"
                      style={{
                        ...typeBadge,
                        color: MUTED,
                        background: "rgb(var(--aegis-ink-rgb) / 0.06)",
                        fontSize: 10,
                      }}
                    >
                      +{account.tags.length - 2}
                    </span>
                  )}
                </div>
              )}
            </div>
            {account.label && (
              <div className="truncate" style={typeSubLabel}>
                {account.label}
              </div>
            )}
          </div>



          {onToggleFavorite && (
            <motion.span
              role="button"
              tabIndex={0}
              aria-label={isFavorite ? "Unpin favorite" : "Pin as favorite"}
              aria-pressed={isFavorite}
              whileTap={{ scale: 0.85 }}
              onClick={(e) => {
                e.stopPropagation();
                onToggleFavorite(account.id);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  e.stopPropagation();
                  onToggleFavorite(account.id);
                }
              }}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full cursor-pointer"
              style={{
                color: isFavorite ? FAV : MUTED,
                background: isFavorite ? "rgba(201,154,43,0.12)" : "transparent",
              }}
            >
              <Star className="h-3.5 w-3.5" strokeWidth={1.9} fill={isFavorite ? FAV : "none"} />
            </motion.span>
          )}

          {isHotp ? (
            <HotpRefreshButton onClick={refreshHotp} busy={hotpBusy} counter={hotpCounter} />
          ) : (
            <RingTimer progress={progress} remaining={remaining} warn={warn} />
          )}
        </div>

        <div className="flex items-baseline justify-between gap-3 pl-[52px]">
          <AnimatePresence mode="popLayout" initial={false}>
            {hideCodes ? (
              <motion.div
                key="masked"
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.18 }}
                className="flex min-w-0 items-center gap-2"
                style={{ color: MUTED }}
                aria-label="Code hidden"
              >
                <EyeOff className="h-4 w-4 shrink-0" strokeWidth={1.8} />
                <span className="flex shrink-0 flex-nowrap items-center gap-[6px] whitespace-nowrap">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <span
                      key={i}
                      aria-hidden
                      className="inline-block h-1.5 w-1.5 rounded-full"
                      style={{
                        background: "currentColor",
                        marginLeft: i === 3 ? 6 : 0,
                      }}
                    />
                  ))}
                </span>
              </motion.div>
            ) : (
              <motion.div
                key={code}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.18 }}
                className="tabular-nums"
                style={{ ...typeCode, color: warn ? DANGER : CHARCOAL }}
              >
                {formatCode(code)}
              </motion.div>
            )}
          </AnimatePresence>

          <AnimatePresence mode="wait" initial={false}>
            {copied ? (
              <motion.div
                key="ok"
                initial={{ opacity: 0, scale: 0.85 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.85 }}
                transition={{ type: "spring", stiffness: 500, damping: 26 }}
                className="flex items-center gap-1 rounded-full px-2 py-0.5"
                style={{ ...typeBadge, background: CHARCOAL, fontWeight: 500 }}
              >
                <Check className="h-3 w-3" strokeWidth={2.4} />
                Copied
              </motion.div>
            ) : !hideCodes && showNext && nextCode ? (
              <motion.div
                key="next"
                initial={{ opacity: 0, y: 2 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.18 }}
                className="flex items-baseline gap-1.5 tabular-nums"
                style={{ ...typeCodeNext, color: MUTED, fontWeight: 400 }}
                aria-label={`Next code ${nextCode}`}
              >
                <span style={{ opacity: 0.7 }}>next</span>
                <span style={{ color: CHARCOAL, fontWeight: 600 }}>{formatCode(nextCode)}</span>
              </motion.div>

            ) : (
              <motion.div
                key="copy"
                initial={{ opacity: 0 }}
                animate={{ opacity: 0.6 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
                style={{ color: MUTED }}
              >
                <Copy className="h-3.5 w-3.5" strokeWidth={1.7} />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.button>
      {typeof document !== "undefined" &&
        createPortal(
          <>
            <AnimatePresence>
              {detailsOpen && (
                <motion.div
                  key="details-sheet"
                  className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                >
                  <motion.button
                    aria-label="Close"
                    onClick={() => setDetailsOpen(false)}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="absolute inset-0"
                    style={{ background: "rgb(var(--aegis-ink-rgb) / 0.35)", backdropFilter: "blur(4px)" }}
                  />
                  <motion.div
                    ref={detailsPanelRef}
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby={detailsTitleId}
                    tabIndex={-1}
                    initial={{ y: 40, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    exit={{ y: 40, opacity: 0 }}
                    transition={soft}
                    drag="y"
                    dragDirectionLock
                    dragConstraints={{ top: 0, bottom: 0 }}
                    dragElastic={{ top: 0, bottom: 0.6 }}
                    onDragEnd={(_, info) => {
                      if (info.offset.y > 120 || info.velocity.y > 600) {
                        setDetailsOpen(false);
                      }
                    }}
                    className="relative z-10 mx-auto w-full max-w-[440px] touch-pan-y rounded-t-[22px] px-5 pb-[max(20px,env(safe-area-inset-bottom))] pt-4 sm:rounded-[22px] focus:outline-none"
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

                    {/* Header: chip + eyebrow + issuer + fav + ring */}
                    <div className="mb-4 flex items-center gap-3">
                      <div
                        className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-[13px]"
                        style={{
                          background: showLogo ? "#fff" : chipBg,
                          color: chipFg,
                          border: `1px solid ${BORDER}`,
                          fontFamily: "'Geist', ui-sans-serif, system-ui, sans-serif",
                          fontWeight: 600,
                          fontSize: 13,
                        }}
                      >
                        {showLogo ? (
                          <img src={logoUrl!} alt="" className="h-full w-full object-contain" />
                        ) : (
                          initials(seed)
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div style={{ ...typeEyebrow, letterSpacing: "0.25em" }}>
                          {editing ? "Editing account" : "Current code"}
                        </div>

                        {editing ? (
                          <div className="mt-1 flex flex-col gap-1.5">
                            <input
                              id={detailsTitleId}
                              ref={firstEditFieldRef}
                              value={issuerDraft}
                              onChange={(e) => setIssuerDraft(e.target.value)}
                              placeholder="Service (e.g. Google)"
                              maxLength={80}
                              className="w-full rounded-[10px] px-2.5 py-1.5 text-[15px] outline-none transition-colors focus:border-current"
                              style={{
                                background: CREAM_SOFT,
                                border: `1px solid ${BORDER}`,
                                color: CHARCOAL,
                                fontWeight: 600,
                                letterSpacing: "-0.005em",
                              }}
                            />
                            <input
                              value={labelDraft}
                              onChange={(e) => setLabelDraft(e.target.value)}
                              placeholder="Account (e.g. you@email.com)"
                              maxLength={120}
                              className="w-full rounded-[10px] px-2.5 py-1 text-[12px] outline-none"
                              style={{
                                background: CREAM_SOFT,
                                border: `1px solid ${BORDER}`,
                                color: CHARCOAL,
                              }}
                            />
                          </div>
                        ) : (
                          <>
                            <div id={detailsTitleId} className="truncate" style={typeSheetTitle}>
                              {account.issuer || "Untitled"}
                            </div>
                            {account.label && (
                              <div className="truncate" style={typeSubLabel}>
                                {account.label}
                              </div>
                            )}

                          </>
                        )}
                      </div>
                      {onToggleFavorite && (
                        <motion.span
                          role="button"
                          tabIndex={0}
                          aria-label={isFavorite ? "Unpin favorite" : "Pin as favorite"}
                          whileTap={{ scale: 0.82 }}
                          whileHover={{ scale: 1.08 }}
                          onClick={(e) => {
                            e.stopPropagation();
                            onToggleFavorite(account.id);
                          }}
                          className="relative flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-full"
                          animate={{
                            background: isFavorite ? "rgba(201,154,43,0.14)" : "rgba(201,154,43,0)",
                          }}
                          transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
                        >
                          {/* Radiant glow when active */}
                          <AnimatePresence>
                            {isFavorite && (
                              <motion.span
                                aria-hidden
                                className="absolute inset-0 rounded-full"
                                initial={{ opacity: 0, scale: 0.6 }}
                                animate={{ opacity: 1, scale: 1 }}
                                exit={{ opacity: 0, scale: 0.6 }}
                                transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
                                style={{
                                  background:
                                    "radial-gradient(circle, rgba(201,154,43,0.35), transparent 65%)",
                                  filter: "blur(4px)",
                                }}
                              />
                            )}
                          </AnimatePresence>

                          {/* Burst ring on activation */}
                          <AnimatePresence>
                            {isFavorite && (
                              <motion.span
                                key="burst"
                                aria-hidden
                                className="absolute inset-0 rounded-full"
                                initial={{ opacity: 0.7, scale: 0.5 }}
                                animate={{ opacity: 0, scale: 1.9 }}
                                exit={{ opacity: 0 }}
                                transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
                                style={{ border: `1.5px solid ${FAV}` }}
                              />
                            )}
                          </AnimatePresence>

                          {/* Sparkle particles */}
                          <AnimatePresence>
                            {isFavorite &&
                              [0, 60, 120, 180, 240, 300].map((deg) => (
                                <motion.span
                                  key={`spark-${deg}`}
                                  aria-hidden
                                  className="pointer-events-none absolute left-1/2 top-1/2 h-0.5 w-0.5 rounded-full"
                                  style={{ background: FAV }}
                                  initial={{ x: 0, y: 0, opacity: 0, scale: 0 }}
                                  animate={{
                                    x: Math.cos((deg * Math.PI) / 180) * 16,
                                    y: Math.sin((deg * Math.PI) / 180) * 16,
                                    opacity: [0, 1, 0],
                                    scale: [0, 1.4, 0.6],
                                  }}
                                  exit={{ opacity: 0 }}
                                  transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
                                />
                              ))}
                          </AnimatePresence>

                          <motion.span
                            className="relative flex items-center justify-center"
                            animate={
                              isFavorite
                                ? { scale: [1, 1.35, 0.92, 1.08, 1], rotate: [0, -12, 8, -4, 0] }
                                : { scale: 1, rotate: 0 }
                            }
                            transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
                            style={{ color: isFavorite ? FAV : MUTED }}
                          >
                            <Star
                              className="h-4 w-4"
                              strokeWidth={1.9}
                              fill={isFavorite ? FAV : "none"}
                            />
                          </motion.span>
                        </motion.span>
                      )}
                      {isHotp ? (
                        <HotpRefreshButton
                          onClick={refreshHotp}
                          busy={hotpBusy}
                          counter={hotpCounter}
                        />
                      ) : (
                        <RingTimer progress={progress} remaining={remaining} warn={warn} />
                      )}
                    </div>

                    {/* Code display (revealed or dotted) — tap to toggle */}
                    <motion.button
                      type="button"
                      onClick={() => setRevealed((v) => !v)}
                      whileTap={{ scale: 0.995 }}
                      aria-label={revealed ? "Hide code" : "Reveal code"}
                      aria-pressed={revealed}
                      className="relative mb-2 flex w-full flex-col items-center gap-1.5 overflow-hidden rounded-[16px] py-5 outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-offset-1"
                      style={{
                        background: CREAM_SOFT,
                        border: `1px solid ${BORDER}`,
                        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.6)",
                        cursor: "pointer",
                      }}
                    >
                      <AnimatePresence>
                        {revealed && (
                          <motion.div
                            key={`sweep-${code}`}
                            aria-hidden
                            className="pointer-events-none absolute inset-y-0 w-1/2"
                            initial={{ x: "-120%", opacity: 0 }}
                            animate={{ x: "220%", opacity: 1 }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
                            style={{
                              background:
                                "linear-gradient(90deg, transparent, rgb(var(--aegis-ink-rgb) / 0.06), transparent)",
                            }}
                          />
                        )}
                      </AnimatePresence>

                      <AnimatePresence mode="wait" initial={false}>
                        {revealed ? (
                          <motion.div
                            key={`shown-${code}`}
                            initial={{ opacity: 0, y: 6, filter: "blur(8px)" }}
                            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                            exit={{ opacity: 0, y: -6, filter: "blur(8px)" }}
                            transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
                            className="flex items-center tabular-nums"
                            style={{ ...typeCodeLg, color: warn ? DANGER : CHARCOAL }}

                          >
                            {formatCode(code)
                              .split("")
                              .map((ch, i) => (
                                <motion.span
                                  key={`${code}-${i}`}
                                  initial={{ opacity: 0, y: 10, filter: "blur(6px)" }}
                                  animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                                  transition={{
                                    duration: 0.35,
                                    delay: 0.04 * i,
                                    ease: [0.22, 1, 0.36, 1],
                                  }}
                                  style={{
                                    display: "inline-block",
                                    minWidth: ch === " " ? "0.5em" : undefined,
                                  }}
                                >
                                  {ch === " " ? "\u00A0" : ch}
                                </motion.span>
                              ))}
                          </motion.div>
                        ) : (
                          <motion.div
                            key="hidden"
                            initial={{ opacity: 0, y: -4, filter: "blur(6px)" }}
                            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                            exit={{ opacity: 0, y: 4, filter: "blur(6px)" }}
                            transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
                            className="flex items-center gap-2"
                            style={{ color: MUTED }}
                          >
                            <EyeOff className="h-4 w-4" strokeWidth={1.7} />
                            <motion.span
                              className="text-[22px] tabular-nums"
                              style={{ letterSpacing: "0.32em", fontWeight: 600 }}
                              aria-label="Code hidden"
                              animate={{ opacity: [0.6, 1, 0.6] }}
                              transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
                            >
                              • • •&nbsp;&nbsp;• • •
                            </motion.span>
                          </motion.div>
                        )}
                      </AnimatePresence>

                      <span
                        className="mt-1 inline-flex items-center gap-1 text-[10px]"
                        style={{
                          color: MUTED,
                          fontFamily: "'JetBrains Mono', monospace",
                          letterSpacing: "0.14em",
                        }}
                      >
                        <MousePointerClick className="h-3 w-3" strokeWidth={1.7} />
                        {revealed ? "TAP TO HIDE" : "TAP TO REVEAL"}
                      </span>
                    </motion.button>

                    {/* Copy primary — hidden in edit mode */}
                    {!editing && (
                      <motion.button
                        whileTap={{ scale: 0.99 }}
                        onClick={copyFromSheet}
                        className="mb-3 flex w-full items-center justify-center gap-2 rounded-[14px] px-4 py-3.5 text-[14px]"
                        style={{
                          background: CHARCOAL,
                          color: CREAM_SOFT,
                          fontWeight: 600,
                          letterSpacing: "-0.005em",
                          boxShadow: "inset 0 1px 0 rgba(255,255,255,0.12)",
                        }}
                      >
                        {copied ? (
                          <>
                            <Check className="h-4 w-4" strokeWidth={2.2} />
                            Copied
                          </>
                        ) : (
                          <>
                            <Copy className="h-4 w-4" strokeWidth={1.9} />
                            Copy code
                          </>
                        )}
                      </motion.button>
                    )}

                    {/* Next code preview — hidden in edit mode */}
                    {!editing && (
                      <div
                        className="mb-3 flex items-center gap-3 rounded-[14px] px-4 py-3"
                        style={{
                          background: CREAM_SOFT,
                          border: `1px solid ${BORDER}`,
                          boxShadow: "inset 0 1px 0 rgba(255,255,255,0.6)",
                        }}
                      >
                        <Clock3
                          className="h-4 w-4 shrink-0"
                          strokeWidth={1.7}
                          style={{ color: MUTED }}
                        />
                        <div className="flex flex-1 flex-col leading-tight">
                          <span className="text-[13px]" style={{ color: CHARCOAL, fontWeight: 600 }}>
                            Next code
                          </span>
                          <span className="text-[11px]" style={{ color: MUTED }}>
                            Auto-generated
                          </span>
                        </div>
                        <span
                          className="tabular-nums text-[13px]"
                          style={{
                            color: revealed || warn ? CHARCOAL : MUTED,
                            fontFamily: "'JetBrains Mono', monospace",
                            fontFeatureSettings: "'tnum'",
                            letterSpacing: "0.12em",
                            fontWeight: 600,
                          }}
                        >
                          {revealed && nextCode ? formatCode(nextCode) : "• • •  • • •"}
                        </span>
                      </div>
                    )}

                    {/* Tags editor — only visible inside edit mode */}
                    <AnimatePresence initial={false}>
                      {editing && (
                        <motion.div
                          key="tags-editor"
                          initial={{ opacity: 0, height: 0, marginBottom: 0, y: -4 }}
                          animate={{ opacity: 1, height: "auto", marginBottom: 12, y: 0 }}
                          exit={{ opacity: 0, height: 0, marginBottom: 0, y: -4, transition: collapseT }}
                          transition={expandT}
                          style={{ overflow: "hidden" }}
                        >
                          <div
                            className="rounded-[14px] px-3.5 py-3"
                            style={{
                              background: "rgb(var(--aegis-ink-rgb) / 0.025)",
                              border: `1px solid ${BORDER}`,
                            }}
                          >
                            <div className="mb-2 flex items-center justify-between gap-2">
                              <div className="flex items-center gap-2">
                                <span style={typeEyebrow}>Tags</span>

                                {tagsDraft.length > 0 && (
                                  <span
                                    className="rounded-full px-1.5 py-0.5 text-[10px]"
                                    style={{
                                      background: CHARCOAL,
                                      color: CREAM_SOFT,
                                      fontWeight: 600,
                                      lineHeight: 1,
                                    }}
                                  >
                                    {tagsDraft.length}
                                  </span>
                                )}
                              </div>
                            </div>
                            <TagInput value={tagsDraft} onChange={setTagsDraft} />
                            {tagError && (
                              <p className="mt-1.5 text-[11px]" style={{ color: DANGER }}>
                                {tagError}
                              </p>
                            )}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>



                    {/* Meta trio — hidden in edit mode */}
                    {!editing && (
                      <div className="mb-3 grid grid-cols-3 gap-2">
                        <MetaCell label="Algorithm" value={account.algorithm} />
                        <MetaCell label="Digits" value={String(account.digits)} />
                        <MetaCell label="Period" value={`${account.period}s`} />
                      </div>
                    )}

                    {/* Storage note — hidden in edit mode */}
                    {!editing && (
                      <div
                        className="mb-4 flex items-start gap-3 rounded-[14px] px-4 py-3"
                        style={{
                          background: "rgb(var(--aegis-ink-rgb) / 0.03)",
                          border: `1px solid ${BORDER}`,
                        }}
                      >
                        <ShieldCheck
                          className="mt-0.5 h-4 w-4 shrink-0"
                          strokeWidth={1.7}
                          style={{ color: CHARCOAL }}
                        />
                        <div className="flex flex-col gap-0.5">
                          <span
                            className="text-[12.5px]"
                            style={{ color: CHARCOAL, fontWeight: 600 }}
                          >
                            Stored on this device
                          </span>
                          <span className="text-[11.5px]" style={{ color: MUTED, lineHeight: 1.5 }}>
                            Secret stays inside your encrypted vault. Use Security → Export for a
                            portable backup.
                          </span>
                        </div>
                      </div>
                    )}

                    {/* Edit-mode hint */}
                    <AnimatePresence initial={false}>
                      {editing && (
                        <motion.div
                          key="edit-hint"
                          initial={{ opacity: 0, height: 0, marginBottom: 0, y: -4 }}
                          animate={{ opacity: 1, height: "auto", marginBottom: 16, y: 0 }}
                          exit={{ opacity: 0, height: 0, marginBottom: 0, y: -4, transition: collapseT }}
                          transition={expandT}
                          style={{ overflow: "hidden" }}
                        >
                          <div
                            className="flex items-start gap-3 rounded-[14px] px-4 py-3"
                            style={{
                              background: "rgb(var(--aegis-ink-rgb) / 0.03)",
                              border: `1px dashed ${BORDER}`,
                            }}
                          >
                            <Pencil
                              className="mt-0.5 h-4 w-4 shrink-0"
                              strokeWidth={1.8}
                              style={{ color: CHARCOAL }}
                            />
                            <div className="flex flex-col gap-0.5">
                              <span
                                className="text-[12.5px]"
                                style={{ color: CHARCOAL, fontWeight: 600 }}
                              >
                                Editing account & tags
                              </span>
                              <span className="text-[11.5px]" style={{ color: MUTED, lineHeight: 1.5 }}>
                                Service name and label update instantly. The TOTP secret is never
                                changed here.
                              </span>
                            </div>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>


                    {detailsError && (
                      <p
                        className="mb-2 text-[12px]"
                        style={{ color: DANGER }}
                        role="alert"
                      >
                        {detailsError}
                      </p>
                    )}

                    {/* Action row */}
                    <AnimatePresence mode="wait" initial={false}>
                      {editing ? (
                        <motion.div
                          key="actions-editing"
                          initial={{ opacity: 0, y: 4 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -4 }}
                          transition={actionSwapT}
                          className="grid grid-cols-[1fr_auto] gap-2 pb-1"
                        >
                          <motion.button
                            whileTap={{ scale: 0.98 }}
                            onClick={saveEdits}
                            disabled={!canSaveEdits || detailsSaving}
                            className="flex items-center justify-center gap-2 rounded-[14px] px-3 py-3 text-[13px] disabled:opacity-55"
                            style={{
                              background: CHARCOAL,
                              color: CREAM_SOFT,
                              fontWeight: 600,
                              letterSpacing: "-0.005em",
                              boxShadow: "inset 0 1px 0 rgba(255,255,255,0.12)",
                            }}
                          >
                            {detailsSaving ? (
                              <>
                                <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
                                Saving…
                              </>
                            ) : (
                              <>
                                <Check className="h-4 w-4" strokeWidth={2.1} />
                                Save changes
                              </>
                            )}
                          </motion.button>
                          <motion.button
                            whileTap={{ scale: 0.98 }}
                            onClick={cancelEdit}
                            disabled={detailsSaving}
                            className="flex items-center justify-center gap-2 rounded-[14px] px-4 py-3 text-[13px]"
                            style={{
                              background: CREAM_SOFT,
                              color: CHARCOAL,
                              border: `1px solid ${BORDER}`,
                              fontWeight: 600,
                            }}
                          >
                            Cancel
                          </motion.button>
                        </motion.div>
                      ) : (
                        <motion.div
                          key="actions-idle"
                          initial={{ opacity: 0, y: 4 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -4 }}
                          transition={actionSwapT}
                          className="grid grid-cols-2 gap-2 pb-1"
                        >
                          <motion.button
                            ref={editButtonRef}
                            whileTap={{ scale: 0.98 }}
                            onClick={() => {
                              setEditing(true);
                              setDetailsError(null);
                            }}
                            className="flex items-center justify-center gap-2 rounded-[14px] px-3 py-3 text-[13px]"
                            style={{
                              background: CREAM_SOFT,
                              color: CHARCOAL,
                              border: `1px solid ${BORDER}`,
                              fontWeight: 600,
                              boxShadow: "inset 0 1px 0 rgba(255,255,255,0.6)",
                            }}
                          >
                            <Pencil className="h-4 w-4" strokeWidth={1.9} />
                            Edit
                          </motion.button>
                          <motion.button
                            whileTap={{ scale: 0.98 }}
                            onClick={openDelete}
                            disabled={!onDelete}
                            className="flex items-center justify-center gap-2 rounded-[14px] px-3 py-3 text-[13px] disabled:opacity-50"
                            style={{
                              background: "rgb(var(--aegis-danger-rgb) / 0.06)",
                              color: DANGER,
                              border: `1px solid rgb(var(--aegis-danger-rgb) / 0.25)`,

                              fontWeight: 600,
                            }}
                          >
                            <Trash2 className="h-4 w-4" strokeWidth={1.9} />
                            Remove
                          </motion.button>
                        </motion.div>
                      )}
                    </AnimatePresence>




                  </motion.div>
                </motion.div>
              )}
            </AnimatePresence>
            <AnimatePresence>
              {confirmOpen && (
                <motion.div
                  key="delete-sheet"
                  className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                >
                  <motion.button
                    aria-label="Close"
                    onClick={() => !deleting && setConfirmOpen(false)}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="absolute inset-0"
                    style={{ background: "rgb(var(--aegis-ink-rgb) / 0.35)", backdropFilter: "blur(4px)" }}
                  />
                  <motion.div
                    ref={confirmPanelRef}
                    role="alertdialog"
                    aria-modal="true"
                    aria-labelledby={confirmTitleId}
                    aria-describedby={confirmDescId}
                    tabIndex={-1}
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
                          className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-[13px]"
                          style={{
                            background: showLogo ? "#fff" : chipBg,
                            color: chipFg,
                            border: `1px solid ${BORDER}`,
                            fontFamily: "'Geist', ui-sans-serif, system-ui, sans-serif",
                            fontWeight: 600,
                            fontSize: 13,
                          }}
                        >
                          {showLogo ? (
                            <img src={logoUrl!} alt="" className="h-full w-full object-contain" />
                          ) : (
                            initials(seed)
                          )}
                        </div>
                        <div className="min-w-0">
                          <div id={confirmTitleId} className="truncate" style={typeSheetTitleSm}>
                            Remove {account.issuer || "this account"}?
                          </div>
                          {account.label && (
                            <div className="mt-0.5 truncate" style={{ ...typeSubLabel, fontSize: 12 }}>
                              {account.label}
                            </div>
                          )}

                        </div>
                      </div>
                      <motion.button
                        whileTap={{ scale: 0.9 }}
                        onClick={() => !deleting && setConfirmOpen(false)}
                        disabled={deleting}
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
                        style={{ background: "rgb(var(--aegis-ink-rgb) / 0.06)", color: CHARCOAL }}
                        aria-label="Close"
                      >
                        <X className="h-4 w-4" strokeWidth={1.8} />
                      </motion.button>
                    </div>

                    <p
                      id={confirmDescId}
                      className="mb-4"
                      style={{ ...typeBody, fontSize: 13 }}
                    >
                      The encrypted secret will be deleted from your vault. You'll need the original
                      QR or setup key to add it back. This can't be undone.
                    </p>


                    <div className="flex flex-col gap-2 pb-1">
                      <motion.button
                        whileTap={{ scale: 0.99 }}
                        onClick={confirmDelete}
                        disabled={deleting}
                        className="flex items-center justify-center gap-2 rounded-[14px] px-4 py-3.5 text-[14px]"
                        style={{
                          background: DANGER,
                          color: CREAM_SOFT,
                          fontWeight: 600,
                          letterSpacing: "-0.005em",
                          opacity: deleting ? 0.75 : 1,
                        }}
                      >
                        {deleting ? (
                          <>
                            <Loader2 className="h-4 w-4 animate-spin" />
                            Removing…
                          </>
                        ) : (
                          <>
                            <Trash2 className="h-4 w-4" strokeWidth={1.9} />
                            Remove account
                          </>
                        )}
                      </motion.button>
                      <motion.button
                        whileTap={{ scale: 0.99 }}
                        onClick={() => !deleting && setConfirmOpen(false)}
                        disabled={deleting}
                        className="rounded-[14px] px-4 py-3.5 text-[14px]"
                        style={{
                          background: "rgb(var(--aegis-ink-rgb) / 0.03)",
                          color: CHARCOAL,
                          border: `1px solid ${BORDER}`,
                          fontWeight: 500,
                        }}
                      >
                        Cancel
                      </motion.button>
                    </div>
                  </motion.div>
                </motion.div>
              )}
            </AnimatePresence>
          </>,
          document.body,
        )}
    </>
  );
}

function HotpRefreshButton({
  onClick,
  busy,
  counter,
}: {
  onClick: () => void;
  busy: boolean;
  counter: number;
}) {
  const size = 28;
  return (
    <motion.button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      whileTap={{ scale: 0.9 }}
      aria-label={`Next HOTP code (counter ${counter})`}
      title={`Counter: ${counter}`}
      disabled={busy}
      className="relative flex shrink-0 items-center justify-center rounded-full"
      style={{
        width: size,
        height: size,
        background: CREAM_SOFT,
        border: `1px solid ${BORDER}`,
        color: CHARCOAL,
        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.6)",
      }}
    >
      {busy ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.9} />
      ) : (
        <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.9} />
      )}
    </motion.button>
  );
}

function RingTimer({
  progress,
  remaining,
  warn,
}: {
  progress: number;
  remaining: number;
  warn: boolean;
}) {
  const size = 28;
  const stroke = 2.2;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const dash = c * (1 - progress);
  const color = warn ? DANGER : CHARCOAL;

  return (
    <div
      className="relative flex shrink-0 items-center justify-center"
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={BORDER}
          strokeWidth={stroke}
          fill="none"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={c}
          strokeDashoffset={dash}
          style={{ transition: "stroke-dashoffset 0.24s linear, stroke 0.2s ease" }}
        />
      </svg>
      <span className="absolute tabular-nums" style={{ ...typeTimer, color }}>
        {remaining}
      </span>

    </div>
  );
}

function MetaCell({ label, value }: { label: string; value: string }) {
  return (
    <div
      className="flex flex-col items-center gap-1 rounded-[12px] px-2 py-2.5"
      style={{
        background: CREAM_SOFT,
        border: `1px solid ${BORDER}`,
        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.6)",
      }}
    >
      <span style={typeMetaLabel}>{label}</span>
      <span className="tabular-nums" style={typeMetaValue}>
        {value}
      </span>

    </div>
  );
}
