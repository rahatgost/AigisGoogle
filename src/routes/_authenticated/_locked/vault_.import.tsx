import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { BrowserQRCodeReader, type IScannerControls } from "@zxing/browser";
import {
  ArrowLeft,
  ClipboardPaste,
  FileUp,
  ImageUp,
  Loader2,
  CheckCircle2,
  Circle,
  DownloadCloud,
  ScanLine,
  Camera,
} from "lucide-react";
import { toast } from "sonner";
import { getVaultKey } from "@/lib/vault-session";
import { addAccount, type ParsedOtpauth } from "@/lib/vault-accounts";
import {
  importFromAvf,
  importFromJson,
  importFromText,
  isAvfJson,
  sourceLabel,
  type ImportSource,
} from "@/lib/vault-import";
import type { EncryptedExportFile } from "@/lib/vault-export";
import { KeyRound } from "lucide-react";
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

export const Route = createFileRoute("/_authenticated/_locked/vault_/import")({
  component: ImportPage,
  errorComponent: ({ error }) => (
    <div className="flex min-h-screen items-center justify-center p-6 text-sm">{error.message}</div>
  ),
  notFoundComponent: () => <div className="p-6 text-sm">Not found</div>,
});

type Stage = "input" | "avf" | "preview";
type Tab = "scan" | "paste" | "file";

interface Preview {
  source: ImportSource;
  entries: ParsedOtpauth[];
  skipped: number;
}

function ImportPage() {
  const navigate = useNavigate();
  const { user } = Route.useRouteContext();
  const [stage, setStage] = useState<Stage>("input");
  const [tab, setTab] = useState<Tab>("scan");
  const [pasteText, setPasteText] = useState("");
  const [notice, setNotice] = useState<{ kind: "error" | "info"; text: string } | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [decoding, setDecoding] = useState(false);
  const [avfPending, setAvfPending] = useState<EncryptedExportFile | null>(null);
  const [avfPass, setAvfPass] = useState("");
  const [avfBusy, setAvfBusy] = useState(false);
  const jsonInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  const showPreview = (p: Preview) => {
    if (p.entries.length === 0) {
      setNotice({
        kind: "error",
        text: "That file didn't contain any TOTP accounts we can import.",
      });
      return;
    }
    setPreview(p);
    setSelected(new Set(p.entries.map((_, i) => i)));
    setStage("preview");
    setNotice(
      p.skipped > 0
        ? {
            kind: "info",
            text: `${p.skipped} entry ${p.skipped === 1 ? "was" : "were"} skipped (not a TOTP link).`,
          }
        : null,
    );
  };

  const handleScanned = (text: string) => {
    setNotice(null);
    try {
      showPreview(importFromText(text));
    } catch (err) {
      setNotice({
        kind: "error",
        text: err instanceof Error ? err.message : "That QR isn't a supported OTP code.",
      });
    }
  };

  const handlePaste = () => {
    setNotice(null);
    try {
      const result = importFromText(pasteText);
      showPreview(result);
    } catch (err) {
      setNotice({
        kind: "error",
        text: err instanceof Error ? err.message : "Couldn't parse that input.",
      });
    }
  };

  const handleJsonFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setNotice(null);
    try {
      const text = await file.text();
      const trimmed = text.trim();
      if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
        const json = JSON.parse(trimmed);
        if (isAvfJson(json)) {
          setAvfPending(json);
          setAvfPass("");
          setStage("avf");
          return;
        }
        showPreview(importFromJson(json));
      } else {
        showPreview(importFromText(trimmed));
      }
    } catch (err) {
      setNotice({
        kind: "error",
        text: err instanceof Error ? err.message : "Couldn't read that file.",
      });
    }
  };

  const submitAvf = async () => {
    if (!avfPending) return;
    setNotice(null);
    setAvfBusy(true);
    try {
      const result = await importFromAvf(avfPending, avfPass);
      setAvfPending(null);
      setAvfPass("");
      showPreview(result);
    } catch (err) {
      setNotice({
        kind: "error",
        text: err instanceof Error ? err.message : "Couldn't decrypt that backup.",
      });
    } finally {
      setAvfBusy(false);
    }
  };


  const handleImageFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setNotice(null);
    setDecoding(true);
    const url = URL.createObjectURL(file);
    try {
      const reader = new BrowserQRCodeReader();
      const decoded = await reader.decodeFromImageUrl(url);
      const text = decoded.getText();
      const result = importFromText(text);
      showPreview(result);
    } catch (err) {
      setNotice({
        kind: "error",
        text: err instanceof Error ? err.message : "Couldn't read a migration QR from that image.",
      });
    } finally {
      URL.revokeObjectURL(url);
      setDecoding(false);
    }
  };

  const toggleAll = () => {
    if (!preview) return;
    setSelected((prev) =>
      prev.size === preview.entries.length ? new Set() : new Set(preview.entries.map((_, i) => i)),
    );
  };

  const commit = async () => {
    if (!preview) return;
    const key = getVaultKey();
    if (!key) {
      navigate({ to: "/lock", search: { redirect: "/vault/import" } });
      return;
    }
    setBusy(true);
    let ok = 0;
    let failed = 0;
    for (let i = 0; i < preview.entries.length; i++) {
      if (!selected.has(i)) continue;
      const e = preview.entries[i];
      try {
        await addAccount(key, user.id, e);
        ok++;
      } catch {
        failed++;
      }
    }
    setBusy(false);
    if (ok > 0) toast.success(`Imported ${ok} account${ok === 1 ? "" : "s"}.`);
    if (failed > 0) toast.error(`${failed} account${failed === 1 ? "" : "s"} couldn't be saved.`);
    navigate({ to: "/vault", replace: true });
  };

  return (
    <AegisScreen>
      <div
        className="aegis-scroll -mx-6 -mt-[max(28px,env(safe-area-inset-top))] flex-1 overflow-y-auto overflow-x-hidden overscroll-contain px-6 pb-[calc(112px+env(safe-area-inset-bottom))]"
        style={{ WebkitOverflowScrolling: "touch" as never }}
      >
        <AppBar
          title="Import accounts"
          trailing={
            <AppBarButton
              label="Back"
              onClick={() => {
                if (stage === "preview") {
                  setStage("input");
                  setPreview(null);
                  setNotice(null);
                } else if (stage === "avf") {
                  setStage("input");
                  setAvfPending(null);
                  setAvfPass("");
                  setNotice(null);
                } else {
                  navigate({ to: "/vault/new" });
                }
              }}
            >
              <ArrowLeft className="h-4 w-4" strokeWidth={1.8} />
            </AppBarButton>
          }
        />

        {stage === "input" ? (
          <>
            <div className="flex flex-col gap-1.5 pt-2 pb-4">
              <h1
                className="text-[26px] leading-[1.1]"
                style={{
                  color: CHARCOAL,
                  fontFamily: "'Sora', sans-serif",
                  fontWeight: 600,
                  letterSpacing: "-0.025em",
                }}
              >
                Bring your codes with you
              </h1>
              <p className="text-[13.5px] leading-[1.4]" style={{ color: MUTED }}>
                Import from Google Authenticator, Aegis, 2FAS, or paste raw{" "}
                <span style={{ fontFamily: "'JetBrains Mono', monospace" }}>otpauth://</span> links.
              </p>
            </div>

            <SegmentedTabs tab={tab} setTab={setTab} />

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
                    <ScanTab
                      onDetected={handleScanned}
                      onError={(msg) => setNotice({ kind: "error", text: msg })}
                      switchToPaste={() => setTab("paste")}
                    />
                  ) : tab === "paste" ? (
                    <PasteTab value={pasteText} onChange={setPasteText} onSubmit={handlePaste} />
                  ) : (
                    <FileTab
                      decoding={decoding}
                      onJsonPick={() => jsonInputRef.current?.click()}
                      onImagePick={() => imageInputRef.current?.click()}
                    />
                  )}
                </motion.div>
              </AnimatePresence>
            </div>

            <input
              ref={jsonInputRef}
              type="file"
              accept="application/json,.json,.txt"
              className="hidden"
              onChange={handleJsonFile}
            />
            <input
              ref={imageInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleImageFile}
            />
          </>
        ) : preview ? (
          <PreviewStage
            preview={preview}
            selected={selected}
            setSelected={setSelected}
            toggleAll={toggleAll}
            notice={notice}
            busy={busy}
            onCommit={commit}
          />
        ) : null}
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
        Scan
      </SegButton>
      <SegButton
        active={tab === "paste"}
        onClick={() => setTab("paste")}
        icon={<ClipboardPaste className="h-3.5 w-3.5" strokeWidth={1.8} />}
      >
        Paste
      </SegButton>
      <SegButton
        active={tab === "file"}
        onClick={() => setTab("file")}
        icon={<FileUp className="h-3.5 w-3.5" strokeWidth={1.8} />}
      >
        File
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
          layoutId="import-tab-pill"
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

function PasteTab({
  value,
  onChange,
  onSubmit,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <SectionLabel>Paste export</SectionLabel>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={8}
        spellCheck={false}
        placeholder={
          "otpauth-migration://offline?data=…\n\nor otpauth://totp/…\n\nor paste a JSON export"
        }
        className="w-full resize-y rounded-[14px] p-3 text-[12.5px] outline-none"
        style={{
          background: CREAM_SOFT,
          border: `1px solid ${BORDER}`,
          color: CHARCOAL,
          fontFamily: "'JetBrains Mono', monospace",
          letterSpacing: "0.01em",
          lineHeight: 1.5,
          boxShadow: "inset 0 1px 0 rgba(255,255,255,0.5)",
        }}
      />
      <PrimaryButton
        onClick={onSubmit}
        icon={<ClipboardPaste className="h-4 w-4" strokeWidth={2} />}
      >
        Read paste
      </PrimaryButton>
      <p className="px-1 pt-1 text-[11.5px]" style={{ color: MUTED, lineHeight: 1.5 }}>
        Google Authenticator: Settings → Transfer accounts → Export → copy the URL from the QR (use
        a scanner app if needed).
      </p>
    </div>
  );
}

function FileTab({
  decoding,
  onJsonPick,
  onImagePick,
}: {
  decoding: boolean;
  onJsonPick: () => void;
  onImagePick: () => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <SectionLabel>Upload</SectionLabel>
      <button
        type="button"
        onClick={onJsonPick}
        className="flex w-full items-center gap-3 rounded-[14px] px-4 py-3.5 text-left transition-colors"
        style={{
          background: CREAM_SOFT,
          border: `1px solid ${BORDER}`,
          color: CHARCOAL,
          boxShadow: "inset 0 1px 0 rgba(255,255,255,0.5)",
        }}
      >
        <FileUp className="h-4 w-4" strokeWidth={1.8} />
        <div className="flex flex-1 flex-col">
          <span className="text-[13.5px]" style={{ fontWeight: 600 }}>
            Aegis or 2FAS JSON
          </span>
          <span className="text-[11.5px]" style={{ color: MUTED }}>
            Export as plain (not encrypted) from the source app.
          </span>
        </div>
      </button>

      <button
        type="button"
        onClick={onImagePick}
        disabled={decoding}
        className="flex w-full items-center gap-3 rounded-[14px] px-4 py-3.5 text-left transition-colors disabled:opacity-60"
        style={{
          background: CREAM_SOFT,
          border: `1px solid ${BORDER}`,
          color: CHARCOAL,
          boxShadow: "inset 0 1px 0 rgba(255,255,255,0.5)",
        }}
      >
        {decoding ? (
          <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.8} />
        ) : (
          <ImageUp className="h-4 w-4" strokeWidth={1.8} />
        )}
        <div className="flex flex-1 flex-col">
          <span className="text-[13.5px]" style={{ fontWeight: 600 }}>
            Migration QR screenshot
          </span>
          <span className="text-[11.5px]" style={{ color: MUTED }}>
            Reads Google Authenticator's transfer QR image.
          </span>
        </div>
      </button>
    </div>
  );
}

function PreviewStage({
  preview,
  selected,
  setSelected,
  toggleAll,
  notice,
  busy,
  onCommit,
}: {
  preview: Preview;
  selected: Set<number>;
  setSelected: (s: Set<number>) => void;
  toggleAll: () => void;
  notice: { kind: "error" | "info"; text: string } | null;
  busy: boolean;
  onCommit: () => void;
}) {
  const toggle = (i: number) => {
    const next = new Set(selected);
    if (next.has(i)) next.delete(i);
    else next.add(i);
    setSelected(next);
  };
  const allChecked = selected.size === preview.entries.length;

  return (
    <div className="flex flex-col gap-4 pt-2">
      <div className="flex flex-col gap-1.5">
        <h1
          className="text-[26px] leading-[1.1]"
          style={{
            color: CHARCOAL,
            fontFamily: "'Sora', sans-serif",
            fontWeight: 600,
            letterSpacing: "-0.025em",
          }}
        >
          Review {preview.entries.length} account
          {preview.entries.length === 1 ? "" : "s"}
        </h1>
        <p className="text-[13.5px] leading-[1.4]" style={{ color: MUTED }}>
          Found in your {sourceLabel(preview.source)} export. Uncheck anything you'd rather skip.
        </p>
      </div>

      {notice && <Notice kind={notice.kind}>{notice.text}</Notice>}

      <button
        type="button"
        onClick={toggleAll}
        className="self-start text-[12px] underline decoration-[rgba(28,28,28,0.35)] underline-offset-[3px]"
        style={{ color: CHARCOAL, fontWeight: 500 }}
      >
        {allChecked ? "Deselect all" : "Select all"}
      </button>

      <SettingsGroup>
        {preview.entries.map((e, i) => {
          const checked = selected.has(i);
          return (
            <button
              key={i}
              type="button"
              onClick={() => toggle(i)}
              className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors"
              style={{
                background: "transparent",
                borderBottom: i < preview.entries.length - 1 ? `1px solid ${BORDER}` : "none",
              }}
            >
              <span
                className="flex h-5 w-5 items-center justify-center"
                style={{ color: checked ? CHARCOAL : MUTED }}
              >
                {checked ? (
                  <CheckCircle2 className="h-5 w-5" strokeWidth={1.8} />
                ) : (
                  <Circle className="h-5 w-5" strokeWidth={1.8} />
                )}
              </span>
              <div className="flex min-w-0 flex-1 flex-col">
                <span
                  className="truncate text-[13.5px]"
                  style={{ color: CHARCOAL, fontWeight: 600 }}
                >
                  {e.issuer || "Unknown"}
                </span>
                {e.label && (
                  <span className="truncate text-[11.5px]" style={{ color: MUTED }}>
                    {e.label}
                  </span>
                )}
              </div>
              <span
                className="text-[10.5px] uppercase"
                style={{
                  color: MUTED,
                  fontFamily: "'JetBrains Mono', monospace",
                  letterSpacing: "0.15em",
                }}
              >
                {e.algorithm} · {e.digits}
              </span>
            </button>
          );
        })}
      </SettingsGroup>

      <PrimaryButton
        onClick={onCommit}
        disabled={busy || selected.size === 0}
        icon={
          busy ? (
            <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
          ) : (
            <DownloadCloud className="h-4 w-4" strokeWidth={2} />
          )
        }
      >
        {busy ? "Importing…" : `Import ${selected.size} account${selected.size === 1 ? "" : "s"}`}
      </PrimaryButton>
    </div>
  );
}

function ScanTab({
  onDetected,
  onError,
  switchToPaste,
}: {
  onDetected: (text: string) => void;
  onError: (msg: string) => void;
  switchToPaste: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [starting, setStarting] = useState(true);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const firedRef = useRef(false);

  useEffect(() => {
    let controls: IScannerControls | null = null;
    let cancelled = false;

    (async () => {
      const reader = new BrowserQRCodeReader();
      try {
        controls = await reader.decodeFromVideoDevice(undefined, videoRef.current!, (result) => {
          if (!result || cancelled || firedRef.current) return;
          const text = result.getText();
          if (text.startsWith("otpauth://") || text.startsWith("otpauth-migration://")) {
            firedRef.current = true;
            controls?.stop();
            onDetected(text);
          }
        });
        if (!cancelled) setStarting(false);
      } catch (err) {
        if (cancelled) return;
        setStarting(false);
        const name = (err as { name?: string })?.name ?? "";
        if (name === "NotAllowedError" || name === "SecurityError") {
          setPermissionDenied(true);
        } else {
          onError(err instanceof Error ? err.message : "Could not start camera.");
        }
      }
    })();

    return () => {
      cancelled = true;
      controls?.stop();
    };
  }, [onDetected, onError]);

  return (
    <div className="flex flex-col gap-4">
      <div
        className="relative aspect-square w-full overflow-hidden rounded-[22px]"
        style={{
          border: `1px solid ${BORDER}`,
          background: "#0a0a0a",
          boxShadow: "inset 0 1px 0 rgba(255,255,255,0.06), 0 12px 32px -18px rgba(28,28,28,0.35)",
        }}
      >
        <video ref={videoRef} className="h-full w-full object-cover" playsInline muted />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background: "radial-gradient(closest-side, transparent 55%, rgba(0,0,0,0.55) 100%)",
          }}
        />
        <div className="pointer-events-none absolute inset-8">
          {[
            "top-0 left-0 border-t-2 border-l-2 rounded-tl-[14px]",
            "top-0 right-0 border-t-2 border-r-2 rounded-tr-[14px]",
            "bottom-0 left-0 border-b-2 border-l-2 rounded-bl-[14px]",
            "bottom-0 right-0 border-b-2 border-r-2 rounded-br-[14px]",
          ].map((c, i) => (
            <span
              key={i}
              className={`absolute h-9 w-9 ${c}`}
              style={{
                borderColor: "rgba(247,244,237,0.92)",
                boxShadow: "0 0 12px rgba(247,244,237,0.35)",
              }}
            />
          ))}
          <motion.div
            className="absolute inset-x-2 h-[2px] rounded-full"
            style={{
              background:
                "linear-gradient(90deg, transparent, rgba(247,244,237,0.95), transparent)",
              boxShadow: "0 0 14px rgba(247,244,237,0.55)",
            }}
            animate={{ y: [4, "calc(100% - 4px)", 4] }}
            transition={{ duration: 2.8, repeat: Infinity, ease: "easeInOut" }}
          />
        </div>

        {starting && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/35 backdrop-blur-[2px]">
            <Loader2 className="h-5 w-5 animate-spin" style={{ color: CREAM_SOFT }} />
          </div>
        )}
        {permissionDenied && (
          <div
            className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center"
            style={{ background: "rgba(10,10,10,0.72)", color: CREAM_SOFT }}
          >
            <Camera className="h-6 w-6" strokeWidth={1.6} />
            <p className="max-w-[240px] text-[13px] leading-[1.4]">
              Camera access is blocked. Enable it, upload the QR as an image, or paste the code.
            </p>
            <button
              onClick={switchToPaste}
              className="mt-2 rounded-full px-3 py-1.5 text-[12px]"
              style={{
                background: "rgba(247,244,237,0.14)",
                border: "1px solid rgba(247,244,237,0.25)",
                color: CREAM_SOFT,
                fontWeight: 500,
              }}
            >
              Paste instead
            </button>
          </div>
        )}
      </div>

      <div
        className="flex items-center justify-center gap-2 text-[12.5px]"
        style={{ color: MUTED }}
      >
        <span
          className="inline-flex h-1.5 w-1.5 rounded-full"
          style={{ background: starting ? "#c9a24a" : "#4a8f5a" }}
        />
        <span>
          {starting
            ? "Starting camera…"
            : permissionDenied
              ? "Camera unavailable"
              : "Point at the migration QR — we'll parse it automatically"}
        </span>
      </div>
    </div>
  );
}
