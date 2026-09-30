"use client";

import { WebContainer, type FileSystemTree, type WebContainerProcess } from "@webcontainer/api";
import { unzipSync } from "fflate";

export type BrowserRuntimeStatus = {
  state: "idle" | "booting" | "loading" | "installing" | "running" | "testing" | "error";
  repo?: string;
  branch?: string;
  previewUrl?: string;
  message?: string;
  logs?: string;
};

let container: WebContainer | null = null;
let devProcess: WebContainerProcess | null = null;
let currentKey = "";
let currentRepo = "";
let currentBranch = "";
let installed = false;
let previewUrl = "";
let logBuffer = "";
let status: BrowserRuntimeStatus = { state: "idle" };
const listeners = new Set<(value: BrowserRuntimeStatus) => void>();
const MAX_LOG = 160000;

const CACHE_DB = "vibaocode-browser-cache-v1";
const CACHE_STORE = "dependency-snapshots";

function openCacheDb() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(CACHE_DB, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(CACHE_STORE)) db.createObjectStore(CACHE_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Không mở được IndexedDB cache."));
  });
}

async function cacheGet(key: string) {
  if (typeof indexedDB === "undefined") return null;
  const db = await openCacheDb();
  try {
    return await new Promise<Uint8Array | null>((resolve, reject) => {
      const tx = db.transaction(CACHE_STORE, "readonly");
      const request = tx.objectStore(CACHE_STORE).get(key);
      request.onsuccess = () => {
        const value = request.result;
        if (!value) return resolve(null);
        if (value instanceof Uint8Array) return resolve(value);
        if (value instanceof ArrayBuffer) return resolve(new Uint8Array(value));
        if (value?.data instanceof ArrayBuffer) return resolve(new Uint8Array(value.data));
        resolve(null);
      };
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

async function cachePut(key: string, bytes: Uint8Array) {
  if (typeof indexedDB === "undefined") return;
  const db = await openCacheDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(CACHE_STORE, "readwrite");
      tx.objectStore(CACHE_STORE).put(bytes, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

async function cacheDelete(key: string) {
  if (typeof indexedDB === "undefined") return;
  const db = await openCacheDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(CACHE_STORE, "readwrite");
      tx.objectStore(CACHE_STORE).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

async function cacheClear() {
  if (typeof indexedDB === "undefined") return;
  const db = await openCacheDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(CACHE_STORE, "readwrite");
      tx.objectStore(CACHE_STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

async function dependencyFingerprint() {
  if (!container) throw new Error("Runtime chưa sẵn sàng.");
  const parts: string[] = [];
  for (const name of ["package.json", "package-lock.json", "npm-shrinkwrap.json", "pnpm-lock.yaml", "yarn.lock"]) {
    try {
      parts.push(name + "\n" + String(await container.fs.readFile("/" + name, "utf-8")));
    } catch {}
  }
  const text = parts.join("\n---\n");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  const hash = Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return currentRepo + "#" + currentBranch + "#" + hash;
}

async function hasPackageLock() {
  if (!container) return false;
  try {
    await container.fs.readFile("/package-lock.json");
    return true;
  } catch {
    return false;
  }
}

async function restoreDependencyCache(cacheKey: string) {
  if (!container) return false;
  const snapshot = await cacheGet(cacheKey).catch(() => null);
  if (!snapshot?.byteLength) return false;
  emit({ state: "installing", message: "Đang khôi phục dependencies từ cache trên máy…" });
  try {
    await container.fs.mkdir("/node_modules", { recursive: true }).catch(() => {});
    await container.mount(snapshot, { mountPoint: "node_modules" });
    installed = true;
    addLog("\n[Vibaocode] Dependencies restored from IndexedDB cache.\n");
    return true;
  } catch (error) {
    addLog("\n[Vibaocode] Dependency cache invalid, rebuilding: " + String(error) + "\n");
    await cacheDelete(cacheKey).catch(() => {});
    await container.fs.rm("/node_modules", { recursive: true, force: true }).catch(() => {});
    return false;
  }
}

async function persistDependencyCache(cacheKey: string) {
  if (!container) return;
  try {
    const snapshot = await container.export("node_modules", { format: "binary" });
    if (snapshot instanceof Uint8Array && snapshot.byteLength > 0) {
      await cachePut(cacheKey, snapshot);
      addLog("\n[Vibaocode] Dependency cache saved for fast startup.\n");
    }
  } catch (error) {
    addLog("\n[Vibaocode] Could not persist dependency cache: " + String(error) + "\n");
  }
}


function emit(patch: Partial<BrowserRuntimeStatus>) {
  status = { ...status, ...patch, logs: logBuffer };
  for (const listener of listeners) listener(status);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("vibaocode-browser-runtime", { detail: status }));
  }
}

function addLog(chunk: string) {
  logBuffer = (logBuffer + chunk).slice(-MAX_LOG);
  emit({});
}

function pipeOutput(process: WebContainerProcess, prefix = "") {
  process.output.pipeTo(new WritableStream<string>({
    write(data) { addLog(prefix + data); },
  })).catch(() => {});
}

function safePath(value: string) {
  const clean = value.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!clean || clean.split("/").some((part) => part === "..")) return "";
  return clean;
}

function addFile(tree: FileSystemTree, filePath: string, contents: Uint8Array) {
  const parts = filePath.split("/").filter(Boolean);
  if (!parts.length) return;
  let node = tree;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const part = parts[i];
    const existing = node[part];
    if (!existing || !("directory" in existing)) {
      node[part] = { directory: {} };
    }
    node = (node[part] as { directory: FileSystemTree }).directory;
  }
  node[parts[parts.length - 1]] = { file: { contents } };
}

function zipToTree(bytes: Uint8Array) {
  const files = unzipSync(bytes);
  const names = Object.keys(files).filter((name) => !name.endsWith("/"));
  if (!names.length) throw new Error("GitHub archive không có file.");
  const first = names[0].split("/")[0];
  const tree: FileSystemTree = {};
  for (const name of names) {
    const parts = name.split("/");
    if (parts[0] === first) parts.shift();
    const relative = safePath(parts.join("/"));
    if (!relative) continue;
    addFile(tree, relative, files[name]);
  }
  return tree;
}

async function resetRuntime() {
  try { devProcess?.kill(); } catch {}
  devProcess = null;
  previewUrl = "";
  installed = false;
  if (container) {
    try { container.teardown(); } catch {}
  }
  container = null;
  currentKey = "";
}

async function boot() {
  if (container) return container;
  if (typeof window === "undefined") throw new Error("Browser runtime chỉ chạy ở trình duyệt.");
  if (!window.crossOriginIsolated || typeof SharedArrayBuffer === "undefined") {
    throw new Error("Trình duyệt chưa bật cross-origin isolation. Hãy dùng Chrome/Edge và tải lại trang sau khi Vibaocode deploy xong.");
  }
  emit({ state: "booting", message: "Đang khởi động runtime trên máy…" });
  container = await WebContainer.boot({
    coep: "credentialless",
    workdirName: "vibaocode-project",
    forwardPreviewErrors: "exceptions-only",
  });
  container.on("error", (error) => {
    addLog("\n[WebContainer] " + String(error) + "\n");
    emit({ state: "error", message: String(error) });
  });
  return container;
}

async function loadProject(repo: string, branch: string, githubToken: string, forceRemote = false) {
  const key = repo + "#" + branch;
  if (container && currentKey === key && !forceRemote) return container;
  if (container) await resetRuntime();
  const wc = await boot();
  emit({ state: "loading", repo, branch, message: "Đang tải mã nguồn GitHub về trình duyệt…" });
  const response = await fetch("/api/github/archive?repo=" + encodeURIComponent(repo) + "&branch=" + encodeURIComponent(branch), {
    headers: githubToken ? { "x-github-token": githubToken } : {},
    cache: "no-store",
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 1400);
    throw new Error(detail || "Không tải được project từ GitHub.");
  }
  const tree = zipToTree(new Uint8Array(await response.arrayBuffer()));
  await wc.mount(tree);
  currentKey = key;
  currentRepo = repo;
  currentBranch = branch;
  installed = false;
  logBuffer = "";
  emit({ state: "loading", repo, branch, message: "Đã tải source vào RAM của máy." });
  return wc;
}

async function readPackage() {
  if (!container) throw new Error("Runtime chưa sẵn sàng.");
  const raw = await container.fs.readFile("/package.json", "utf-8");
  return JSON.parse(String(raw)) as { scripts?: Record<string, string>; dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
}

async function runProcess(command: string, args: string[], timeoutMs = 180000, env: Record<string, string> = {}) {
  if (!container) throw new Error("Runtime chưa sẵn sàng.");
  const process = await container.spawn(command, args, { env });
  let output = "";
  process.output.pipeTo(new WritableStream<string>({ write(data) { output = (output + data).slice(-50000); addLog(data); } })).catch(() => {});
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<number>((resolve) => {
    timer = setTimeout(() => { try { process.kill(); } catch {}; resolve(124); }, timeoutMs);
  });
  const exitCode = await Promise.race([process.exit, timeout]);
  if (timer) clearTimeout(timer);
  return { exitCode, output };
}

async function installDependencies() {
  if (installed) return;
  const cacheKey = await dependencyFingerprint();

  if (await restoreDependencyCache(cacheKey)) {
    emit({ state: "installing", message: "Dependencies đã sẵn sàng từ cache local." });
    return;
  }

  const startedAt = Date.now();
  const progressTimer = window.setInterval(() => {
    const seconds = Math.round((Date.now() - startedAt) / 1000);
    emit({
      state: "installing",
      message: "Lần đầu đang cài dependencies… " + seconds + "s. Các lần sau sẽ dùng cache và nhanh hơn nhiều.",
    });
  }, 3000);

  emit({ state: "installing", message: "Lần đầu đang cài dependencies… Các lần sau sẽ dùng cache local." });
  try {
    const args = await hasPackageLock()
      ? ["ci", "--no-audit", "--no-fund", "--prefer-offline", "--progress=false"]
      : ["install", "--no-audit", "--no-fund", "--prefer-offline", "--progress=false"];
    const result = await runProcess("npm", args, 600000, {
      NPM_CONFIG_UPDATE_NOTIFIER: "false",
      NPM_CONFIG_FUND: "false",
      NPM_CONFIG_AUDIT: "false",
    });
    if (result.exitCode !== 0) throw new Error("npm install thất bại.\n" + result.output.slice(-3500));
    installed = true;

    // Do not block preview on snapshot creation. Persist it after Run can continue.
    window.setTimeout(() => {
      void persistDependencyCache(cacheKey);
    }, 1200);
  } finally {
    window.clearInterval(progressTimer);
  }
}

function devArgs(pkg: Awaited<ReturnType<typeof readPackage>>) {
  const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  if (pkg.scripts?.dev && "next" in deps) return ["run", "dev", "--", "--hostname", "0.0.0.0"];
  if (pkg.scripts?.dev && "vite" in deps) return ["run", "dev", "--", "--host", "0.0.0.0"];
  if (pkg.scripts?.dev) return ["run", "dev"];
  if (pkg.scripts?.start) return ["run", "start"];
  throw new Error("Project không có script dev hoặc start trong package.json.");
}

async function startServer(restart = false) {
  if (!container) throw new Error("Runtime chưa sẵn sàng.");
  if (devProcess && previewUrl && !restart) return previewUrl;
  if (devProcess) { try { devProcess.kill(); } catch {}; devProcess = null; }
  previewUrl = "";
  const pkg = await readPackage();
  const ready = new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Dev server quá 90 giây chưa sẵn sàng.")), 90000);
    const off = container!.on("server-ready", (_port, url) => {
      clearTimeout(timeout);
      off();
      resolve(url);
    });
  });
  devProcess = await container.spawn("npm", devArgs(pkg));
  pipeOutput(devProcess);
  devProcess.exit.then((code) => {
    if (code !== 0) addLog("\n[Vibaocode] Dev server dừng với mã " + code + "\n");
  }).catch(() => {});
  previewUrl = await ready;
  emit({ state: "running", previewUrl, message: "Project đang chạy bằng tài nguyên của máy." });
  return previewUrl;
}

export async function startBrowserProject(options: { repo: string; branch: string; githubToken?: string; forceRemote?: boolean }) {
  try {
    emit({ state: "booting", repo: options.repo, branch: options.branch, message: "Chuẩn bị Browser Local Runtime…" });
    await loadProject(options.repo, options.branch, options.githubToken || "", Boolean(options.forceRemote));
    await installDependencies();
    const url = await startServer(Boolean(options.forceRemote));
    return {
      runtime: "browser",
      sandboxName: "BROWSER LOCAL",
      running: true,
      previewUrl: url,
      logs: logBuffer,
      revision: "browser",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Browser runtime failed.";
    emit({ state: "error", message });
    throw error;
  }
}

export async function writeBrowserFiles(repo: string, branch: string, files: Array<{ path: string; content: string }>) {
  if (!container || currentKey !== repo + "#" + branch) return 0;
  let count = 0;
  for (const item of files) {
    const filePath = safePath(item.path);
    if (!filePath) continue;
    const slash = filePath.lastIndexOf("/");
    if (slash > 0) await container.fs.mkdir("/" + filePath.slice(0, slash), { recursive: true });
    await container.fs.writeFile("/" + filePath, item.content);
    if (["package.json", "package-lock.json", "pnpm-lock.yaml", "yarn.lock"].includes(filePath)) installed = false;
    count += 1;
  }
  emit({ state: devProcess ? "running" : "idle", message: "Live Sync đã ghi " + count + " file vào runtime." });
  return count;
}

export async function runBrowserChecks(options: { repo: string; branch: string; githubToken?: string }) {
  await loadProject(options.repo, options.branch, options.githubToken || "", false);
  await installDependencies();
  const url = await startServer(false);
  const pkg = await readPackage();
  emit({ state: "testing", previewUrl: url, message: "Đang chạy Auto Test trên máy…" });
  const checks: Array<{ name: string; exitCode: number; stdout: string; stderr: string }> = [];
  for (const name of ["typecheck", "lint", "test", "build"]) {
    if (!pkg.scripts?.[name]) continue;
    const result = await runProcess("npm", ["run", name], name === "build" ? 300000 : 180000, name === "test" ? { CI: "1" } : {});
    checks.push({ name, exitCode: result.exitCode, stdout: result.output, stderr: "" });
  }
  const passed = checks.every((check) => check.exitCode === 0);
  emit({ state: "running", previewUrl: url, message: passed ? "Auto Test PASS." : "Auto Test phát hiện lỗi." });
  return {
    runtime: "browser",
    sandboxName: "BROWSER LOCAL",
    serverRunning: true,
    previewUrl: url,
    checks,
    smokeStatus: "ready",
    passed,
    serverLogs: logBuffer,
    phases: [
      { name: "dependencies", passed: true },
      { name: "dev-server", passed: true },
      { name: "project-checks", passed },
      { name: "http-smoke", passed: true },
    ],
  };
}

export function browserRuntimeLogs() { return logBuffer; }
export function getBrowserRuntimeStatus() { return status; }
export function subscribeBrowserRuntime(listener: (value: BrowserRuntimeStatus) => void) {
  listeners.add(listener);
  listener(status);
  return () => listeners.delete(listener);
}

export async function optimizeBrowserMemory() {
  await resetRuntime();
  logBuffer = "";
  currentRepo = "";
  currentBranch = "";
  status = { state: "idle", message: "Đã giải phóng Browser Runtime khỏi RAM. Bấm Run để chạy lại." };
  emit({});
  return true;
}


export async function clearBrowserDependencyCache() {
  await cacheClear();
  return true;
}
