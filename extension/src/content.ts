/**
 * Content script (Phase 10.2 autofill detector).
 *
 * Injected on user-granted origins only (see `optional_host_permissions`).
 * Responsibilities:
 *
 *   - Scan the DOM for OTP-shaped inputs:
 *       * `<input autocomplete="one-time-code">` (the spec-blessed hint)
 *       * name/id heuristics: /otp|totp|mfa|2fa|code/ with a numeric-ish
 *         maxlength of 4–8, and type ∈ {text, tel, number}
 *   - Anchor a small floating "Aegis" chip next to each field
 *   - On click, ask the SW for matches for the current host, render a
 *     one-line picker, and either fill the field or copy to clipboard
 *     (with a 30 s auto-clear armed in the SW)
 *
 * Everything renders inside a shadow root so page CSS can't restyle the
 * chip, and the shadow host is `position: absolute` at the field's
 * bounding-box so we never reflow the page.
 */

/// <reference types="chrome" />

interface MatchRow {
  id: string;
  issuer: string;
  label: string;
  score: number;
}

const OTP_NAME_RE = /(^|[_-])(otp|totp|mfa|2fa|code|passcode|token)([_-]|$)/i;
const OTP_ALLOWED_TYPES = new Set(["text", "tel", "number", "password"]);

function looksLikeOtpInput(el: HTMLInputElement): boolean {
  if (el.dataset.aegisAttached === "1") return false;
  if (el.type && !OTP_ALLOWED_TYPES.has(el.type.toLowerCase())) return false;
  const ac = (el.autocomplete || "").toLowerCase();
  if (ac === "one-time-code") return true;
  const ml = el.maxLength;
  const nameMatch = OTP_NAME_RE.test(el.name || "") || OTP_NAME_RE.test(el.id || "");
  const size = el.getAttribute("inputmode") === "numeric" || el.pattern.includes("\\d");
  if (nameMatch && (ml === -1 || (ml >= 4 && ml <= 10))) return true;
  if (size && ml >= 4 && ml <= 10) return true;
  return false;
}

/* --------------------------------------------------------------------- */
/*  Chip UI                                                              */
/* --------------------------------------------------------------------- */

const CHIP_STYLES = `
:host { all: initial; }
.host {
  position: absolute; z-index: 2147483647;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, sans-serif;
  color: #1f1d1a;
}
.chip {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 4px 10px; border-radius: 999px;
  background: #f7f4ed; border: 1px solid #d9d5c8;
  font-size: 11px; font-weight: 500; letter-spacing: 0.2px;
  cursor: pointer; user-select: none;
  box-shadow: 0 1px 3px rgba(0,0,0,0.06);
  transition: background 120ms ease;
}
.chip:hover { background: #efeadd; }
.dot { width: 6px; height: 6px; border-radius: 50%; background: #3c8c5a; }
.dot.locked { background: #b47a2d; }
.picker {
  margin-top: 6px; min-width: 240px; max-width: 320px;
  background: #f7f4ed; border: 1px solid #d9d5c8; border-radius: 12px;
  box-shadow: 0 8px 24px rgba(0,0,0,0.14);
  padding: 6px; display: none;
}
.picker.open { display: block; }
.row {
  padding: 8px 10px; border-radius: 8px; cursor: pointer;
  display: flex; align-items: center; justify-content: space-between; gap: 10px;
}
.row:hover { background: #efeadd; }
.issuer { font-size: 13px; font-weight: 500; }
.label { font-size: 11.5px; color: #6b6862; }
.act { font-size: 11px; color: #6b6862; }
.empty { padding: 10px; font-size: 12px; color: #6b6862; text-align: center; }
`;

class AegisAnchor {
  private el: HTMLElement;
  private shadow: ShadowRoot;
  private chip!: HTMLDivElement;
  private picker!: HTMLDivElement;
  private target: HTMLInputElement;
  private lastRect: DOMRect | null = null;
  private ro?: ResizeObserver;

  constructor(target: HTMLInputElement) {
    this.target = target;
    target.dataset.aegisAttached = "1";
    this.el = document.createElement("div");
    this.el.setAttribute("data-aegis", "");
    this.shadow = this.el.attachShadow({ mode: "closed" });
    const style = document.createElement("style");
    style.textContent = CHIP_STYLES;
    this.shadow.appendChild(style);

    const host = document.createElement("div");
    host.className = "host";
    this.chip = document.createElement("div");
    this.chip.className = "chip";
    this.chip.innerHTML = `<span class="dot"></span><span>Aegis</span>`;
    this.chip.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      void this.togglePicker();
    });
    this.picker = document.createElement("div");
    this.picker.className = "picker";
    host.appendChild(this.chip);
    host.appendChild(this.picker);
    this.shadow.appendChild(host);

    document.body.appendChild(this.el);
    this.reposition();

    window.addEventListener("scroll", this.reposition, { passive: true, capture: true });
    window.addEventListener("resize", this.reposition, { passive: true });
    if ("ResizeObserver" in window) {
      this.ro = new ResizeObserver(() => this.reposition());
      this.ro.observe(document.documentElement);
    }
    // Close picker on outside click.
    document.addEventListener("mousedown", (e) => {
      if (!this.el.contains(e.target as Node)) this.closePicker();
    });
  }

  private reposition = () => {
    const rect = this.target.getBoundingClientRect();
    this.lastRect = rect;
    const top = rect.top + window.scrollY;
    const left = rect.right + window.scrollX + 6;
    const host = this.shadow.querySelector<HTMLDivElement>(".host")!;
    host.style.top = `${top}px`;
    host.style.left = `${left}px`;
  };

  private async togglePicker() {
    if (this.picker.classList.contains("open")) {
      this.closePicker();
      return;
    }
    this.picker.classList.add("open");
    this.picker.innerHTML = `<div class="empty">Loading…</div>`;
    const host = window.location.hostname;
    const res = await sendMessage({ type: "MATCH_HOST", host });
    if (!res.ok) {
      const err = res.error;
      this.picker.innerHTML =
        err === "locked"
          ? `<div class="empty">Aegis is locked — open the popup to sync.</div>`
          : `<div class="empty">Couldn't reach Aegis (${err}).</div>`;
      (this.shadow.querySelector(".dot") as HTMLElement).classList.toggle("locked", err === "locked");
      return;
    }
    const matches = (res.matches as MatchRow[]) ?? [];
    if (matches.length === 0) {
      this.picker.innerHTML = `<div class="empty">No matching accounts for this site.</div>`;
      return;
    }
    this.picker.innerHTML = "";
    for (const m of matches) {
      const row = document.createElement("div");
      row.className = "row";
      row.innerHTML = `
        <div>
          <div class="issuer"></div>
          <div class="label"></div>
        </div>
        <div class="act">Fill</div>
      `;
      row.querySelector(".issuer")!.textContent = m.issuer;
      row.querySelector(".label")!.textContent = m.label || "";
      row.addEventListener("click", async (e) => {
        e.preventDefault();
        e.stopPropagation();
        await this.fill(m.id);
      });
      // Right-click / long-press → copy fallback.
      row.addEventListener("contextmenu", async (e) => {
        e.preventDefault();
        await this.copy(m.id);
      });
      this.picker.appendChild(row);
    }
    const help = document.createElement("div");
    help.className = "empty";
    help.textContent = "Right-click a row to copy instead.";
    this.picker.appendChild(help);
  }

  private closePicker() {
    this.picker.classList.remove("open");
  }

  private async fill(accountId: string) {
    csLog("fill: request", { accountId, host: window.location.hostname });
    const res = await sendMessage({ type: "GET_CODE", accountId });
    if (!res.ok) {
      csLog("fill: SW error", res.error);
      this.picker.innerHTML = `<div class="empty">Couldn't generate code (${res.error}).</div>`;
      return;
    }
    const code = res.code as string;
    const period = res.period as number | undefined;
    csLog("fill: SW ok", {
      codeLen: code.length,
      codeShape: /^\d+$/.test(code) ? "numeric" : "alphanum",
      period,
      target: describeInput(this.target),
    });
    setInputValue(this.target, code);
    const after = this.target.value;
    csLog("fill: applied", {
      matches: after === code,
      afterLen: after.length,
    });
    this.closePicker();
  }

  private async copy(accountId: string) {
    csLog("copy: request", { accountId });
    const res = await sendMessage({ type: "GET_CODE", accountId });
    if (!res.ok) { csLog("copy: SW error", res.error); return; }
    const code = res.code as string;
    try {
      await navigator.clipboard.writeText(code);
      csLog("copy: clipboard ok", { codeLen: code.length });
      const tabIdReq = await sendMessage({ type: "CLIPBOARD_ARMED", tabId: 0, accountId });
      void tabIdReq;
    } catch (e) {
      csLog("copy: clipboard refused", e);
    }
    this.closePicker();
  }
}

const CS_DEBUG = true;
function csLog(...args: unknown[]): void {
  if (CS_DEBUG) console.log("[aegis-cs]", ...args);
}

function describeInput(el: HTMLInputElement) {
  return {
    name: el.name || undefined,
    id: el.id || undefined,
    type: el.type,
    autocomplete: el.autocomplete || undefined,
    maxLength: el.maxLength,
    inputmode: el.getAttribute("inputmode") || undefined,
    pattern: el.pattern || undefined,
  };
}

function setInputValue(el: HTMLInputElement, value: string) {
  const proto = Object.getPrototypeOf(el);
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  if (setter) setter.call(el, value);
  else el.value = value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

function sendMessage(msg: unknown): Promise<{ ok: true; [k: string]: unknown } | { ok: false; error: string }> {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(msg, (res) => {
        if (chrome.runtime.lastError) {
          resolve({ ok: false, error: chrome.runtime.lastError.message ?? "runtime_error" });
          return;
        }
        resolve(res ?? { ok: false, error: "no_response" });
      });
    } catch (e) {
      resolve({ ok: false, error: e instanceof Error ? e.message : "send_failed" });
    }
  });
}

/* --------------------------------------------------------------------- */
/*  Discovery                                                            */
/* --------------------------------------------------------------------- */

function scan(root: ParentNode = document) {
  const inputs = root.querySelectorAll<HTMLInputElement>("input");
  inputs.forEach((el) => {
    if (looksLikeOtpInput(el)) new AegisAnchor(el);
  });
}

// Handle CLEAR_CLIPBOARD from SW.
chrome.runtime.onMessage.addListener((msg: { type: string }) => {
  if (msg.type === "CLEAR_CLIPBOARD") {
    void navigator.clipboard.writeText("").catch(() => {
      /* best-effort */
    });
  }
});

// Initial pass + observe for SPA-added inputs.
scan();
const mo = new MutationObserver((records) => {
  for (const r of records) {
    r.addedNodes.forEach((n) => {
      if (n instanceof HTMLElement) scan(n);
    });
  }
});
mo.observe(document.documentElement, { childList: true, subtree: true });

export {};
