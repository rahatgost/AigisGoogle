// Aegis Desktop (Electron) — Windows-first wrapper.
// Loads the published Aegis web app so every feature (server functions,
// camera QR scan, clipboard, Supabase sync, push, extension bridge, etc.)
// works exactly like the browser. Window is sized like an Android phone.

const { app, BrowserWindow, session, shell, Menu } = require("electron");
const path = require("path");

const APP_URL = process.env.AEGIS_URL || "https://aegis-syed.lovable.app";

// Android-phone-like frame (Pixel 7-ish CSS px). Fixed aspect, resizable off
// by default so it always feels like a phone on the desktop.
const PHONE_WIDTH = 412;
const PHONE_HEIGHT = 915;

function createWindow() {
  const win = new BrowserWindow({
    width: PHONE_WIDTH,
    height: PHONE_HEIGHT,
    minWidth: 360,
    minHeight: 720,
    maxWidth: 520,
    resizable: true,
    maximizable: false,
    fullscreenable: false,
    autoHideMenuBar: true,
    backgroundColor: "#f7f4ed",
    title: "Aegis Authenticator",
    icon: path.join(__dirname, "icon.png"),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
      spellcheck: false,
    },
  });

  Menu.setApplicationMenu(null);

  // Auto-grant the browser features Aegis needs (camera for QR scan,
  // clipboard read/write, notifications). Everything else is denied.
  const ALLOWED = new Set([
    "media", // getUserMedia (camera/mic)
    "clipboard-read",
    "clipboard-sanitized-write",
    "notifications",
  ]);
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => {
    cb(ALLOWED.has(permission));
  });
  session.defaultSession.setPermissionCheckHandler((_wc, permission) =>
    ALLOWED.has(permission),
  );

  // Open external links (docs, help pages) in the OS browser, keep app links inside.
  win.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const u = new URL(url);
      const same = new URL(APP_URL);
      if (u.origin === same.origin) return { action: "allow" };
      shell.openExternal(url);
    } catch {
      /* ignore */
    }
    return { action: "deny" };
  });

  win.loadURL(APP_URL);
}

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
