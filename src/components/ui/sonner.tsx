import { useEffect, useState } from "react";
import { Toaster as Sonner } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

/**
 * Aegis-themed toast surface. We deliberately do NOT pass `richColors` from
 * consumers — sonner's rich colors override our classNames with bright
 * green/red/blue that clash with the warm cream + charcoal palette. Instead
 * we style every variant with our own tokens so success / error / warning /
 * info read as tinted accents on the cream (or ink) surface.
 *
 * `theme` is synced with the `.dark` class on <html> (managed by
 * `src/lib/theme.ts`) so the toast surface flips with the rest of the app.
 */
const Toaster = ({ ...props }: ToasterProps) => {
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    if (typeof document === "undefined") return "light";
    return document.documentElement.classList.contains("dark") ? "dark" : "light";
  });

  useEffect(() => {
    if (typeof document === "undefined") return;
    const el = document.documentElement;
    const sync = () => setTheme(el.classList.contains("dark") ? "dark" : "light");
    sync();
    const obs = new MutationObserver(sync);
    obs.observe(el, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);

  return (
    <Sonner
      theme={theme}
      className="toaster group"
      toastOptions={{
        // Force our styles even when consumers pass `richColors` at the call
        // site — sonner respects the `unstyled` flag per-variant.
        unstyled: false,
        classNames: {
          toast:
            "group toast font-sans rounded-xl border shadow-[0_10px_30px_-12px_rgb(var(--aegis-ink-rgb)/0.25)] " +
            "group-[.toaster]:bg-background group-[.toaster]:text-foreground " +
            "group-[.toaster]:border-[rgb(var(--aegis-ink-rgb)/0.10)] " +
            "backdrop-blur-sm",
          title: "text-[13.5px] font-medium tracking-[-0.005em]",
          description:
            "text-[12.5px] leading-relaxed text-[rgb(var(--aegis-ink-rgb)/0.62)]",
          actionButton:
            "group-[.toast]:bg-[rgb(var(--aegis-ink-rgb))] group-[.toast]:text-background " +
            "group-[.toast]:rounded-md group-[.toast]:text-[12px] group-[.toast]:font-medium",
          cancelButton:
            "group-[.toast]:bg-transparent group-[.toast]:text-[rgb(var(--aegis-ink-rgb)/0.55)] " +
            "group-[.toast]:rounded-md group-[.toast]:text-[12px]",
          closeButton:
            "group-[.toast]:bg-background group-[.toast]:border-[rgb(var(--aegis-ink-rgb)/0.12)] " +
            "group-[.toast]:text-[rgb(var(--aegis-ink-rgb)/0.7)]",
          // Aegis-tinted status variants — a soft left border + faint wash
          // rather than the loud sonner defaults.
          success:
            "group-[.toaster]:border-l-[3px] group-[.toaster]:border-l-[#4a7a5c]",
          error:
            "group-[.toaster]:border-l-[3px] group-[.toaster]:border-l-[#b4553a]",
          warning:
            "group-[.toaster]:border-l-[3px] group-[.toaster]:border-l-[#c08a2e]",
          info:
            "group-[.toaster]:border-l-[3px] group-[.toaster]:border-l-[rgb(var(--aegis-ink-rgb)/0.35)]",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
