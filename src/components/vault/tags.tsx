// Shared tag primitives for Phase 7.1: normalizer, chip color, chip, input.
// Tags are stored per-account in vault_accounts.tags (text[]). The DB caps
// the array at 20 entries; we enforce the same limit here to keep the
// insert trigger from ever surfacing a raw Postgres error to the user.

import { type KeyboardEvent } from "react";
import { X, Check } from "lucide-react";
import { BORDER, CHARCOAL, MUTED } from "@/components/aegis/chrome";

export const MAX_TAGS_PER_ACCOUNT = 20;
export const MAX_TAG_LENGTH = 24;

/**
 * Curated preset of tag values users can attach to accounts.
 *
 * We intentionally do NOT allow free-form tag creation: an open text field
 * quickly fragments the tag space ("work", "Work", "wrk", "office") and
 * makes filters useless. Presets keep the vocabulary shared across accounts
 * and turn the picker into a one-tap toggle.
 *
 * To add a category, extend this list — no schema or UI change needed.
 */
export const PRESET_TAGS = [
  "work",
  "personal",
  "finance",
  "social",
  "developer",
  "shopping",
  "gaming",
  "entertainment",
  "education",
  "travel",
  "health",
  "other",
] as const;

export type PresetTag = (typeof PRESET_TAGS)[number];

/** Canonicalise a raw tag string: lowercase, trim, collapse spaces to `-`. */
export function normalizeTag(input: string): string {
  const cleaned = input
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9\-_]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return cleaned.slice(0, MAX_TAG_LENGTH);
}

/** Merge + dedupe a list of raw tags into normalised, ordered, capped form. */
export function normalizeTagList(input: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of input) {
    const t = normalizeTag(raw);
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= MAX_TAGS_PER_ACCOUNT) break;
  }
  return out;
}

function hueFor(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return h % 360;
}

export function tagChipColors(tag: string): { bg: string; fg: string; ring: string } {
  const h = hueFor(tag);
  return {
    bg: `hsl(${h}, 46%, 93%)`,
    fg: `hsl(${h}, 42%, 26%)`,
    ring: `hsl(${h}, 42%, 78%)`,
  };
}

interface TagChipProps {
  tag: string;
  size?: "sm" | "md";
  onRemove?: () => void;
  onClick?: () => void;
  active?: boolean;
  as?: "span" | "button";
}

export function TagChip({ tag, size = "sm", onRemove, onClick, active, as }: TagChipProps) {
  const { bg, fg, ring } = tagChipColors(tag);
  const sm = size === "sm";
  const paddingX = sm ? 7 : 10;
  const paddingY = sm ? 2 : 4;
  const fontSize = sm ? 10.5 : 12;
  const Comp = (as ?? (onClick ? "button" : "span")) as "span" | "button";

  const content = (
    <>
      <span className="truncate">{tag}</span>
      {onRemove && (
        <span
          role="button"
          tabIndex={0}
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              e.stopPropagation();
              onRemove();
            }
          }}
          aria-label={`Remove tag ${tag}`}
          className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full"
          style={{ background: "rgba(0,0,0,0.08)", color: fg }}
        >
          <X className="h-2.5 w-2.5" strokeWidth={2.6} />
        </span>
      )}
    </>
  );

  const style: React.CSSProperties = {
    background: active ? fg : bg,
    color: active ? bg : fg,
    border: `1px solid ${active ? fg : ring}`,
    padding: `${paddingY}px ${paddingX}px`,
    fontSize,
    fontWeight: 600,
    letterSpacing: "0.005em",
    lineHeight: 1.15,
    maxWidth: 160,
  };

  if (Comp === "button") {
    return (
      <button
        type="button"
        onClick={onClick}
        className="inline-flex shrink-0 items-center gap-1 rounded-full transition-colors"
        style={style}
      >
        {content}
      </button>
    );
  }
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full" style={style}>
      {content}
    </span>
  );
}

interface TagInputProps {
  value: string[];
  onChange: (next: string[]) => void;
  /** Optional extra tags to render alongside the preset list (e.g. legacy
   *  free-form tags that were saved before the preset switch). */
  extras?: string[];
  /** Kept for API compatibility with prior free-form input. Ignored. */
  placeholder?: string;
  suggestions?: string[];
}

/**
 * Preset tag picker. Renders every {@link PRESET_TAGS} value plus any
 * "extra" tags the account already has (so pre-existing custom tags stay
 * removable) as toggleable chips. There is no free-form input — this
 * enforces the shared tag vocabulary.
 */
export function TagInput({ value, onChange, extras }: TagInputProps) {
  const selected = new Set(value);
  // Show presets first, then any extras (legacy or from other accounts)
  // that are not in the preset list, so the user can still de-select them.
  const extraTags = [
    ...new Set([
      ...value.filter((t) => !(PRESET_TAGS as readonly string[]).includes(t)),
      ...(extras ?? []).filter((t) => !(PRESET_TAGS as readonly string[]).includes(t)),
    ]),
  ];
  const options: string[] = [...PRESET_TAGS, ...extraTags];
  const atLimit = value.length >= MAX_TAGS_PER_ACCOUNT;

  const toggle = (tag: string) => {
    if (selected.has(tag)) {
      onChange(value.filter((t) => t !== tag));
    } else {
      if (atLimit) return;
      onChange([...value, tag]);
    }
  };

  const handleKey = (e: KeyboardEvent<HTMLButtonElement>, tag: string) => {
    if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      toggle(tag);
    }
  };

  // Reorder so selected chips lead the strip — the user always sees their
  // current selection first when the row is scrolled to the start.
  const ordered = [...options].sort((a, b) => {
    const aSel = selected.has(a) ? 0 : 1;
    const bSel = selected.has(b) ? 0 : 1;
    return aSel - bSel;
  });

  return (
    <div className="flex flex-col gap-2">
      {/* Horizontal scroll strip of preset chips. Selected chips lead. */}
      <div
        className="-mx-1 flex snap-x snap-mandatory gap-1.5 overflow-x-auto px-1 py-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        role="group"
        aria-label="Select tags"
      >
        {ordered.map((tag) => {
          const isSelected = selected.has(tag);
          const isExtra = !(PRESET_TAGS as readonly string[]).includes(tag);
          const disabled = !isSelected && atLimit;
          return (
            <button
              key={tag}
              type="button"
              aria-pressed={isSelected}
              disabled={disabled}
              onClick={() => toggle(tag)}
              onKeyDown={(e) => handleKey(e, tag)}
              className="inline-flex shrink-0 snap-start items-center gap-1 rounded-full px-3 py-1.5 text-[12px] transition-all active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-40"
              style={{
                background: isSelected ? CHARCOAL : "#fff",
                color: isSelected ? "#fff" : CHARCOAL,
                border: `1px ${isExtra ? "dashed" : "solid"} ${
                  isSelected ? CHARCOAL : BORDER
                }`,
                fontWeight: isSelected ? 600 : 500,
                boxShadow: isSelected
                  ? "0 1px 2px rgb(var(--aegis-ink-rgb) / 0.15)"
                  : "inset 0 1px 0 rgba(255,255,255,0.6)",
              }}
            >
              {isSelected && <Check className="h-2.5 w-2.5" strokeWidth={3} />}
              {tag}
            </button>
          );
        })}
      </div>
      <div className="flex items-center justify-between px-0.5">
        <span className="text-[10.5px]" style={{ color: MUTED }}>
          {atLimit
            ? `${MAX_TAGS_PER_ACCOUNT} tag limit reached`
            : "Swipe to browse · tap to toggle"}
        </span>
        <span
          className="text-[10.5px]"
          style={{
            color: MUTED,
            fontFamily: "'JetBrains Mono', monospace",
            letterSpacing: "0.08em",
          }}
        >
          {value.length}/{MAX_TAGS_PER_ACCOUNT}
        </span>
      </div>
    </div>
  );
}

