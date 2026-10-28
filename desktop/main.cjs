const {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  nativeImage,
  screen,
  shell,
  Tray,
} = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { dayKey, fetchCalendarEvents, reminderForEvent } = require("./calendar.cjs");

// Install locations differ per platform, and some apps ship under a localised
// name or a per-user directory, so every plausible path is tried in turn before
// falling back to the app's URL scheme.
const LAUNCHABLE_APPS = {
  wechat: {
    label: "WeChat",
    protocol: "weixin://",
    paths: {
      darwin: ["/Applications/WeChat.app", "/Applications/微信.app"],
      win32: [
        "C:\\Program Files\\Tencent\\WeChat\\WeChat.exe",
        "C:\\Program Files (x86)\\Tencent\\WeChat\\WeChat.exe",
      ],
    },
  },
  spotify: {
    label: "Spotify",
    protocol: "spotify://",
    paths: {
      darwin: ["/Applications/Spotify.app"],
      win32: [
        path.join(process.env.APPDATA ?? "", "Spotify", "Spotify.exe"),
        "C:\\Program Files\\WindowsApps\\SpotifyAB.SpotifyMusic\\Spotify.exe",
      ],
    },
  },
  cursor: {
    label: "Cursor",
    protocol: "cursor://",
    paths: {
      darwin: ["/Applications/Cursor.app"],
      win32: [
        path.join(process.env.LOCALAPPDATA ?? "", "Programs", "Cursor", "Cursor.exe"),
        "C:\\Program Files\\Cursor\\Cursor.exe",
      ],
    },
  },
};

let mainWindow;
let tray;
let isQuitting = false;
let roamingEnabled = true;
let remindersEnabled = true;
let savePositionTimer;
let calendarTimer;
const remindedEvents = new Set();

const WINDOW_SIZE = { width: 113, height: 250 };

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

function settingsPath() {
  return path.join(app.getPath("userData"), "desktop-settings.json");
}

function readSettings() {
  try {
    return JSON.parse(fs.readFileSync(settingsPath(), "utf8"));
  } catch {
    return {};
  }
}

function writeSettings(update) {
  const next = { ...readSettings(), ...update };
  fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
  fs.writeFileSync(settingsPath(), JSON.stringify(next), "utf8");
}

function saveWindowPosition() {
  if (!mainWindow || mainWindow.isDestroyed()) return;

  const { x, y } = mainWindow.getBounds();
  writeSettings({ x, y, ...WINDOW_SIZE });
}

function clampPosition(x, y) {
  const candidate = {
    x: Math.round(Number(x) || 0),
    y: Math.round(Number(y) || 0),
    ...WINDOW_SIZE,
  };
  const { workArea } = screen.getDisplayMatching(candidate);

  return {
    x: Math.max(workArea.x, Math.min(candidate.x, workArea.x + workArea.width - WINDOW_SIZE.width)),
    y: Math.max(
      workArea.y,
      Math.min(candidate.y, workArea.y + workArea.height - WINDOW_SIZE.height),
    ),
  };
}

function initialPosition() {
  const saved = readSettings();
  if (
    Number.isFinite(saved.x) &&
    Number.isFinite(saved.y) &&
    saved.width === WINDOW_SIZE.width &&
    saved.height === WINDOW_SIZE.height
  ) {
    return clampPosition(saved.x, saved.y);
  }

  const { workArea } = screen.getPrimaryDisplay();
  return {
    x: workArea.x + workArea.width - WINDOW_SIZE.width - 28,
    y: workArea.y + workArea.height - WINDOW_SIZE.height - 18,
  };
}

function createPetWindow() {
  const position = initialPosition();

  mainWindow = new BrowserWindow({
    ...WINDOW_SIZE,
    ...position,
    transparent: true,
    backgroundColor: "#00000000",
    frame: false,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.setAlwaysOnTop(true, "floating");
  if (process.platform === "darwin") {
    mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  }

  mainWindow.loadFile(path.join(__dirname, "index.html"));
  mainWindow.once("ready-to-show", () => mainWindow.showInactive());

  mainWindow.on("move", () => {
    clearTimeout(savePositionTimer);
    savePositionTimer = setTimeout(saveWindowPosition, 500);
  });

  mainWindow.on("close", (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
}

function trayImage() {
  const image = nativeImage.createFromPath(path.join(__dirname, "assets", "tray-icon.png"));
  return image.resize({ width: 18, height: 18, quality: "best" });
}

function updateTrayMenu() {
  if (!tray) return;

  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: "显示帽兜",
        click: () => {
          mainWindow.showInactive();
          mainWindow.setAlwaysOnTop(true, "floating");
        },
      },
      {
        label: "Pause wandering",
        type: "checkbox",
        checked: !roamingEnabled,
        click: ({ checked }) => {
          roamingEnabled = !checked;
          mainWindow.webContents.send("pet:set-roaming", roamingEnabled);
          updateTrayMenu();
        },
      },
      { type: "separator" },
      { label: "Open WeChat", click: () => openApp("wechat") },
      { label: "Open Spotify", click: () => openApp("spotify") },
      { label: "Open Cursor", click: () => openApp("cursor") },
      { label: "Feed", click: () => mainWindow.webContents.send("pet:action", "feed") },
      { label: "Play", click: () => mainWindow.webContents.send("pet:action", "play") },
      {
        label: "Sleep / wake",
        click: () => mainWindow.webContents.send("pet:action", "sleep"),
      },
      {
        label: "Turn around",
        click: () => mainWindow.webContents.send("pet:action", "turn"),
      },
      {
        label: "Calendar reminders",
        type: "checkbox",
        checked: remindersEnabled,
        click: ({ checked }) => {
          remindersEnabled = checked;
          writeSettings({ remindersEnabled });
          if (checked) checkCalendarReminders();
          updateTrayMenu();
        },
      },
      { type: "separator" },
      {
        label: "Quit",
        click: () => {
          isQuitting = true;
          app.quit();
        },
      },
    ]),
  );
}

function createTray() {
  tray = new Tray(trayImage());
  tray.setToolTip("帽兜");
  tray.on("click", () => tray.popUpContextMenu());
  tray.on("right-click", () => tray.popUpContextMenu());
  updateTrayMenu();
}

async function openApp(appId) {
  const target = LAUNCHABLE_APPS[appId];
  if (!target) return { opened: false, label: appId };

  for (const candidate of target.paths[process.platform] ?? []) {
    if (!candidate || !fs.existsSync(candidate)) continue;
    const failure = await shell.openPath(candidate);
    if (!failure) return { opened: true, label: target.label };
  }

  try {
    await shell.openExternal(target.protocol);
    return { opened: true, label: target.label };
  } catch {
    return { opened: false, label: target.label };
  }
}

function sendCalendarReminder(payload) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.showInactive();
  mainWindow.setAlwaysOnTop(true, "floating");
  mainWindow.webContents.send("pet:calendar-reminder", payload);
}

async function checkCalendarReminders() {
  if (!remindersEnabled || process.platform !== "darwin") return;

  const events = await fetchCalendarEvents();
  const now = Date.now();
  const today = dayKey();

  for (const event of events) {
    const reminder = reminderForEvent(event, now);
    if (!reminder) continue;

    const key = `${event.id}:${reminder.phase}:${today}`;
    if (remindedEvents.has(key)) continue;
    remindedEvents.add(key);
    sendCalendarReminder({
      title: event.title,
      phase: reminder.phase,
      minutes: reminder.minutes,
    });
    break;
  }
}

function startCalendarWatch() {
  if (process.platform !== "darwin") return;
  clearInterval(calendarTimer);
  setTimeout(() => {
    checkCalendarReminders();
    calendarTimer = setInterval(checkCalendarReminders, 45_000);
  }, 2500);
}

function registerIpc() {
  ipcMain.handle("desktop:open-app", (_event, appId) => openApp(appId));

  ipcMain.handle("desktop:get-state", () => {
    const bounds = mainWindow.getBounds();
    const { workArea } = screen.getDisplayMatching(bounds);
    return { bounds, workArea, roamingEnabled };
  });

  ipcMain.on("desktop:move-to", (_event, position) => {
    if (!position || !mainWindow || mainWindow.isDestroyed()) return;
    const next = clampPosition(position.x, position.y);
    mainWindow.setPosition(next.x, next.y, false);
  });

  ipcMain.on("desktop:set-click-through", (_event, shouldIgnore) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.setIgnoreMouseEvents(Boolean(shouldIgnore), { forward: true });
  });

  ipcMain.on("desktop:set-roaming", (_event, enabled) => {
    roamingEnabled = Boolean(enabled);
    mainWindow.webContents.send("pet:set-roaming", roamingEnabled);
    updateTrayMenu();
  });

  ipcMain.on("desktop:hide", () => mainWindow?.hide());

  ipcMain.on("desktop:quit", () => {
    isQuitting = true;
    app.quit();
  });
}

app.on("second-instance", () => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.showInactive();
  mainWindow.setAlwaysOnTop(true, "floating");
});

app.whenReady().then(() => {
  if (!gotLock) return;
  app.setName("帽兜");
  const saved = readSettings();
  if (typeof saved.remindersEnabled === "boolean") {
    remindersEnabled = saved.remindersEnabled;
  }
  registerIpc();
  createPetWindow();
  createTray();
  startCalendarWatch();
});

app.on("before-quit", () => {
  isQuitting = true;
  saveWindowPosition();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (!mainWindow) {
    createPetWindow();
  } else {
    mainWindow.showInactive();
  }
});
