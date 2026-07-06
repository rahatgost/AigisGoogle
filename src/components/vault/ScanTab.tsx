// QR scan surface for Add Account. Extracted so it can be exercised in
// isolation by tests (see ScanTab.test.tsx). Behavior invariants worth
// preserving:
//
// 1. The camera-init effect runs exactly once per mount. Parent re-renders
//    that swap callback identities must NOT restart the video stream, so
//    handlers live in refs.
// 2. A single detection latch (`handledRef`) guarantees `onDetected`
//    fires at most once per mount — protects against duplicate frames
//    arriving before `controls.stop()` takes effect, and against a rapid
//    second image upload landing during the parent's async save.
// 3. Recovery from a failed save is the parent's job: bump a `key` prop
//    so this component unmounts + remounts (fresh camera, fresh latch).

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import type { IScannerControls } from "@zxing/browser";
import { Loader2, Camera, ImageUp } from "lucide-react";
import { BORDER, CHARCOAL, CREAM_SOFT, MUTED, SCANNER_BG, SUCCESS, WARNING } from "@/components/aegis/chrome";

export interface ScanTabProps {
  onDetected: (uri: string) => void;
  onError: (msg: string) => void;
  saving: boolean;
  switchToManual: () => void;
}

export function ScanTab({ onDetected, onError, saving, switchToManual }: ScanTabProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [starting, setStarting] = useState(true);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [decoding, setDecoding] = useState(false);

  const onDetectedRef = useRef(onDetected);
  const onErrorRef = useRef(onError);
  useEffect(() => {
    onDetectedRef.current = onDetected;
    onErrorRef.current = onError;
  });

  const handledRef = useRef(false);

  const handleImageFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (handledRef.current) return;
    setDecoding(true);
    const url = URL.createObjectURL(file);
    try {
      const { BrowserQRCodeReader } = await import("@zxing/browser");
      const reader = new BrowserQRCodeReader();
      const result = await reader.decodeFromImageUrl(url);
      const text = result.getText();
      if (!text.startsWith("otpauth://")) {
        onErrorRef.current("That image doesn't contain a valid otpauth QR code.");
        return;
      }
      handledRef.current = true;
      onDetectedRef.current(text);
    } catch {
      onErrorRef.current("Couldn't read a QR code from that image. Try a clearer screenshot.");
    } finally {
      URL.revokeObjectURL(url);
      setDecoding(false);
    }
  };

  useEffect(() => {
    let controls: IScannerControls | null = null;
    let cancelled = false;

    (async () => {
      const { BrowserQRCodeReader } = await import("@zxing/browser");
      const reader = new BrowserQRCodeReader();
      try {
        controls = await reader.decodeFromVideoDevice(undefined, videoRef.current!, (result) => {
          if (!result || cancelled || handledRef.current) return;
          const text = result.getText();
          if (!text.startsWith("otpauth://")) return;
          handledRef.current = true;
          controls?.stop();
          onDetectedRef.current(text);
        });
        if (!cancelled) setStarting(false);
      } catch (err) {
        if (cancelled) return;
        setStarting(false);
        const name = (err as { name?: string })?.name ?? "";
        if (name === "NotAllowedError" || name === "SecurityError") setPermissionDenied(true);
        else onErrorRef.current(err instanceof Error ? err.message : "Could not start camera.");
      }
    })();

    return () => {
      cancelled = true;
      controls?.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex flex-col gap-4">
      <div
        className="relative aspect-square w-full overflow-hidden rounded-[22px]"
        style={{
          border: `1px solid ${BORDER}`,
          background: SCANNER_BG,
          boxShadow: "inset 0 1px 0 rgba(255,255,255,0.06), 0 12px 32px -18px rgb(var(--aegis-ink-rgb) / 0.35)",
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

        {(starting || saving || decoding) && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/35 backdrop-blur-[2px]">
            <Loader2 className="h-5 w-5 animate-spin" style={{ color: CREAM_SOFT }} />
            {decoding && (
              <span className="text-[11.5px]" style={{ color: CREAM_SOFT, opacity: 0.85 }}>
                Reading image…
              </span>
            )}
          </div>
        )}
        {permissionDenied && (
          <div
            className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center"
            style={{ background: "rgba(10,10,10,0.72)", color: CREAM_SOFT }}
          >
            <Camera className="h-6 w-6" strokeWidth={1.6} />
            <p className="max-w-[220px] text-[13px] leading-[1.4]">
              Camera access is blocked. Enable it, or add the code by hand.
            </p>
            <button
              onClick={switchToManual}
              className="mt-2 rounded-full px-3 py-1.5 text-[12px]"
              style={{
                background: "rgba(247,244,237,0.14)",
                border: "1px solid rgba(247,244,237,0.25)",
                color: CREAM_SOFT,
                fontWeight: 500,
              }}
            >
              Enter manually
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
          style={{ background: starting ? WARNING : SUCCESS }}
        />
        <span>
          {starting
            ? "Starting camera…"
            : permissionDenied
              ? "Camera unavailable"
              : "Ready — hold steady on the QR"}
        </span>
      </div>

      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        disabled={decoding || saving}
        className="flex w-full items-center justify-center gap-2 rounded-[14px] px-4 py-3 text-[13.5px] transition-colors disabled:opacity-60"
        style={{
          background: CREAM_SOFT,
          border: `1px solid ${BORDER}`,
          color: CHARCOAL,
          fontWeight: 600,
          letterSpacing: "-0.005em",
          boxShadow: "inset 0 1px 0 rgba(255,255,255,0.6)",
        }}
      >
        {decoding ? (
          <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.8} />
        ) : (
          <ImageUp className="h-4 w-4" strokeWidth={1.8} />
        )}
        <span>{decoding ? "Reading image…" : "Upload a screenshot"}</span>
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleImageFile}
      />

      <button
        type="button"
        onClick={switchToManual}
        className="mx-auto text-[13px] underline decoration-[rgb(var(--aegis-ink-rgb) / 0.35)] underline-offset-[3px] transition-colors hover:decoration-[rgb(var(--aegis-ink-rgb) / 0.7)]"
        style={{ color: CHARCOAL, fontWeight: 500 }}
      >
        Can't scan? Enter the key manually
      </button>
    </div>
  );
}
