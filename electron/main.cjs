const { app, BrowserWindow, ipcMain } = require("electron");
const { autoUpdater } = require("electron-updater");
const { spawn } = require("child_process");
const path = require("path");
const http = require("http");

let mainWindow = null;
let serverProcess = null;
let updateRequestedByUser = false;
let shuttingDown = false;
const PORT = 3210;

function sendUpdate(payload) {
  mainWindow?.webContents?.send("vibaocode:update-status", payload);
}

function waitForServer(timeout = 90000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const poll = () => {
      const req = http.get(`http://127.0.0.1:${PORT}`, (res) => {
        res.resume();
        resolve();
      });
      req.setTimeout(800, () => req.destroy());
      req.on("error", () => {
        if (Date.now() - started > timeout) reject(new Error("Vibaocode local server không khởi động được."));
        else setTimeout(poll, 500);
      });
    };
    poll();
  });
}

function startServer() {
  const serverDir = app.isPackaged ? path.join(process.resourcesPath, "server") : path.join(__dirname, "..");
  const serverFile = app.isPackaged
    ? path.join(serverDir, "server.js")
    : path.join(serverDir, "node_modules", "next", "dist", "bin", "next");
  const args = app.isPackaged ? [serverFile] : [serverFile, "dev", "--hostname", "127.0.0.1", "--port", String(PORT)];

  serverProcess = spawn(process.execPath, args, {
    cwd: serverDir,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      PORT: String(PORT),
      HOSTNAME: "127.0.0.1",
      VIBAO_RUNTIME: "local",
      VIBAO_DESKTOP: "1",
      NODE_ENV: app.isPackaged ? "production" : "development",
    },
    stdio: app.isPackaged ? "ignore" : "inherit",
    windowsHide: true,
  });
}

async function stopLocalProjects() {
  return await new Promise((resolve) => {
    const req = http.request(
      { hostname: "127.0.0.1", port: PORT, path: "/api/local/system", method: "POST", headers: { "Content-Type": "application/json" } },
      (res) => { res.resume(); res.on("end", resolve); },
    );
    req.on("error", resolve);
    req.end(JSON.stringify({ action: "stopAll" }));
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1500,
    height: 960,
    minWidth: 1080,
    minHeight: 700,
    backgroundColor: "#090d16",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.loadURL(`http://127.0.0.1:${PORT}`);
}

autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;
autoUpdater.on("checking-for-update", () => sendUpdate({ status: "checking", message: "Đang kiểm tra bản mới…" }));
autoUpdater.on("update-available", (info) => sendUpdate({ status: "available", message: `Có bản mới v${info.version}. Đang tải…` }));
autoUpdater.on("update-not-available", () => {
  sendUpdate({ status: "current", message: "Bạn đang dùng phiên bản mới nhất." });
  updateRequestedByUser = false;
});
autoUpdater.on("download-progress", (p) => sendUpdate({ status: "downloading", message: `Đang tải update ${Math.round(p.percent)}%`, percent: p.percent }));
autoUpdater.on("update-downloaded", () => {
  sendUpdate({ status: "ready", message: "Đã tải xong. Vibaocode sẽ tự cập nhật và khởi động lại." });
  if (updateRequestedByUser) setTimeout(() => autoUpdater.quitAndInstall(false, true), 800);
});
autoUpdater.on("error", (error) => {
  sendUpdate({ status: "error", message: error?.message || "Update thất bại." });
  updateRequestedByUser = false;
});

ipcMain.handle("vibaocode:get-info", () => ({ version: app.getVersion(), platform: process.platform }));
ipcMain.handle("vibaocode:update", async () => {
  if (!app.isPackaged) return { ok: false, message: "Update chỉ dùng trong bản cài đặt Desktop." };
  updateRequestedByUser = true;
  try {
    await autoUpdater.checkForUpdates();
    return { ok: true, message: "Đang kiểm tra và tải phiên bản mới nếu có." };
  } catch (error) {
    updateRequestedByUser = false;
    return { ok: false, message: error?.message || "Không kiểm tra được update." };
  }
});

app.whenReady().then(async () => {
  startServer();
  try {
    await waitForServer();
    createWindow();
  } catch (error) {
    const { dialog } = require("electron");
    dialog.showErrorBox("Vibaocode", error?.message || "Không khởi động được Vibaocode.");
    app.quit();
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", (event) => {
  if (shuttingDown || !serverProcess) return;
  event.preventDefault();
  shuttingDown = true;
  const proc = serverProcess;
  serverProcess = null;
  stopLocalProjects().finally(() => {
    try { proc.kill(); } catch {}
    setTimeout(() => app.exit(0), 250);
  });
});
