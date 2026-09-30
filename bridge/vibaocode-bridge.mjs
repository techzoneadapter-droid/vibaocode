import http from "node:http";
import net from "node:net";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawn, spawnSync } from "node:child_process";

const HOST = "127.0.0.1";
const PORT = 43127;
const VERSION = "0.1.1";
const allowedOrigins = new Set([
  "https://vibaocode.vercel.app",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
]);

const projects = new Map();
const agents = new Map();
let authState = { status: "disconnected", url: "", log: "", error: "" };

function send(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(body));
}

function cors(req, res) {
  const origin = req.headers.origin || "";
  if (allowedOrigins.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-GitHub-Token");
  res.setHeader("Access-Control-Allow-Private-Network", "true");
}

async function jsonBody(req) {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 8 * 1024 * 1024) throw new Error("Request too large.");
  }
  return raw ? JSON.parse(raw) : {};
}

function appendLog(current, next, max = 160000) {
  const value = current + String(next || "");
  return value.length > max ? value.slice(-max) : value;
}

function commandExists(name) {
  const cmd = process.platform === "win32" ? "where" : "which";
  return spawnSync(cmd, [name], { windowsHide: true, stdio: "ignore" }).status === 0;
}

function npmCmd() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function npmGlobalRoot() {
  const result = spawnSync(npmCmd(), ["root", "-g"], {
    windowsHide: true,
    encoding: "utf8",
  });
  if (result.status !== 0) return "";
  return String(result.stdout || "").trim();
}

function resolveCodexRunner() {
  const roots = [];
  const globalRoot = npmGlobalRoot();
  if (globalRoot) roots.push(globalRoot);

  if (process.env.APPDATA) {
    roots.push(path.join(process.env.APPDATA, "npm", "node_modules"));
  }
  if (process.env.LOCALAPPDATA) {
    roots.push(path.join(process.env.LOCALAPPDATA, "npm", "node_modules"));
  }

  for (const root of roots) {
    const entry = path.join(root, "@openai", "codex", "bin", "codex.js");
    if (fs.existsSync(entry)) {
      return {
        command: process.execPath,
        argsPrefix: [entry],
        display: entry,
      };
    }
  }

  const locator = spawnSync(process.platform === "win32" ? "where" : "which", ["codex"], {
    windowsHide: true,
    encoding: "utf8",
  });
  if (locator.status === 0) {
    const candidates = String(locator.stdout || "").split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
    for (const candidate of candidates) {
      if (!fs.existsSync(candidate)) continue;
      if (/\.(exe|com)$/i.test(candidate)) {
        return { command: candidate, argsPrefix: [], display: candidate };
      }
    }
  }

  return null;
}

function runCodex(args, options = {}) {
  const runner = resolveCodexRunner();
  if (!runner) {
    const error = new Error("Không tìm thấy Codex CLI sau khi cài đặt. Hãy bấm Cài/Cập nhật Local Bridge lại một lần.");
    error.code = "codex_missing";
    return Promise.reject(error);
  }
  return run(runner.command, [...runner.argsPrefix, ...args], options);
}

function spawnCodex(args, options = {}) {
  const runner = resolveCodexRunner();
  if (!runner) {
    const error = new Error("Không tìm thấy Codex CLI sau khi cài đặt. Hãy bấm Cài/Cập nhật Local Bridge lại một lần.");
    error.code = "codex_missing";
    throw error;
  }
  return spawn(runner.command, [...runner.argsPrefix, ...args], {
    ...options,
    shell: false,
  });
}

function safeName(value) {
  return String(value || "").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "workspace";
}

function validRepo(repo) {
  return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(String(repo || ""));
}

function safeRelative(value) {
  const clean = String(value || "").replace(/\\/g, "/").replace(/^\/+/, "");
  if (!clean || clean.split("/").some((part) => part === "..")) return "";
  return clean;
}

function workspaceRoot() {
  const configured = String(process.env.VIBAO_WORKSPACE_ROOT || "").trim();
  if (configured) return path.resolve(configured);
  const base = process.env.LOCALAPPDATA || path.join(os.homedir(), ".vibaocode");
  return path.join(base, "Vibaocode", "workspaces");
}

function projectKey(repo, branch) {
  return String(repo) + "#" + String(branch || "main");
}

function projectDir(repo, branch) {
  const [owner, name] = String(repo).split("/");
  return path.join(workspaceRoot(), safeName(owner), safeName(name), safeName(branch || "main"));
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...(options.env || {}) },
      windowsHide: true,
      shell: false,
    });
    let stdout = "";
    let stderr = "";
    const max = options.maxOutput || 100000;
    child.stdout?.on("data", (chunk) => { stdout = appendLog(stdout, chunk, max); });
    child.stderr?.on("data", (chunk) => { stderr = appendLog(stderr, chunk, max); });
    child.on("error", reject);
    let timer = null;
    if (options.timeoutMs) {
      timer = setTimeout(() => {
        killTree(child.pid);
      }, options.timeoutMs);
    }
    child.on("exit", (code) => {
      if (timer) clearTimeout(timer);
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

function killTree(pid) {
  if (!pid) return;
  if (process.platform === "win32") {
    spawn("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
  } else {
    try { process.kill(-pid, "SIGTERM"); } catch {
      try { process.kill(pid, "SIGTERM"); } catch {}
    }
  }
}

async function codexConnected() {
  const runner = resolveCodexRunner();
  if (!runner) return { connected: false, detail: "Codex CLI chưa được cài hoặc chưa tìm thấy npm global path." };
  const result = await runCodex(["login", "status"], { timeoutMs: 12000, maxOutput: 12000 }).catch((error) => ({ code: 1, stdout: "", stderr: error.message }));
  const detail = (result.stdout + "\n" + result.stderr).trim();
  return {
    connected: result.code === 0 && /logged in using chatgpt/i.test(detail),
    detail: detail + (detail ? "\n" : "") + "Codex path: " + runner.display,
  };
}

async function installCodex() {
  if (!commandExists(npmCmd())) throw new Error("Máy chưa có Node.js/npm.");
  const result = await run(npmCmd(), ["install", "-g", "@openai/codex@latest"], { timeoutMs: 300000, maxOutput: 30000 });
  if (result.code !== 0) throw new Error("Không cài được Codex CLI.\n" + (result.stderr || result.stdout));
  const runner = resolveCodexRunner();
  if (!runner) {
    throw new Error("npm báo cài Codex thành công nhưng Bridge chưa tìm thấy file codex.js trong npm global.");
  }
  return (result.stdout || result.stderr || "") + "\nCodex path: " + runner.display;
}

async function startAuth() {
  const status = await codexConnected();
  if (status.connected) return { status: "connected", connected: true, detail: status.detail };
  if (!resolveCodexRunner()) {
    const error = new Error("Codex CLI chưa được cài hoặc Bridge chưa tìm thấy npm global path.");
    error.code = "codex_missing";
    throw error;
  }
  if (["starting", "waiting"].includes(authState.status)) return { ...authState, connected: false };

  authState = { status: "starting", url: "", log: "", error: "" };
  const child = spawnCodex(["login"], {
    windowsHide: false,
    stdio: ["ignore", "pipe", "pipe"],
  });
  authState.status = "waiting";

  const consume = (chunk) => {
    const text = String(chunk);
    authState.log = appendLog(authState.log, text, 40000);
    const match = text.match(/https:\/\/auth\.openai\.com\/[^\s<>"']+/i);
    if (match) authState.url = match[0];
  };
  child.stdout?.on("data", consume);
  child.stderr?.on("data", consume);
  child.on("error", (error) => {
    authState.status = "error";
    authState.error = error.message;
  });
  child.on("exit", async (code) => {
    const next = await codexConnected();
    if (next.connected) {
      authState.status = "connected";
      authState.error = "";
      authState.log = appendLog(authState.log, "\n" + next.detail);
    } else {
      authState.status = code === 0 ? "disconnected" : "error";
      authState.error = code === 0 ? "" : "Codex login exited with code " + code;
    }
  });
  return {
    status: "waiting",
    connected: false,
    url: authState.url,
    detail: "Đang chờ bạn hoàn tất đăng nhập ChatGPT trong trình duyệt.",
  };
}

async function ensureRepo(repo, branch = "main", githubToken = "", forceRemote = false) {
  if (!validRepo(repo)) throw new Error("Repository không hợp lệ.");
  if (!commandExists("git")) throw new Error("Máy chưa có Git.");
  const dir = projectDir(repo, branch);
  await fsp.mkdir(path.dirname(dir), { recursive: true });

  if (!fs.existsSync(path.join(dir, ".git"))) {
    let url = "https://github.com/" + repo + ".git";
    if (githubToken) url = "https://x-access-token:" + encodeURIComponent(githubToken) + "@github.com/" + repo + ".git";
    const clone = await run("git", ["clone", "--branch", branch, "--single-branch", url, dir], { timeoutMs: 240000, maxOutput: 40000 });
    if (clone.code !== 0) throw new Error("Git clone thất bại:\n" + (clone.stderr || clone.stdout));
    if (githubToken) {
      await run("git", ["remote", "set-url", "origin", "https://github.com/" + repo + ".git"], { cwd: dir, timeoutMs: 15000 });
    }
  } else if (forceRemote) {
    const fetchResult = await run("git", ["fetch", "origin", branch], { cwd: dir, timeoutMs: 120000 });
    if (fetchResult.code !== 0) throw new Error("Git fetch thất bại:\n" + fetchResult.stderr);
    const resetResult = await run("git", ["reset", "--hard", "origin/" + branch], { cwd: dir, timeoutMs: 60000 });
    if (resetResult.code !== 0) throw new Error("Git reset thất bại:\n" + resetResult.stderr);
  }
  return dir;
}

async function fingerprint(dir) {
  const hash = crypto.createHash("sha256");
  let found = false;
  for (const name of ["package.json", "package-lock.json", "npm-shrinkwrap.json", "pnpm-lock.yaml", "yarn.lock"]) {
    const file = path.join(dir, name);
    if (!fs.existsSync(file)) continue;
    found = true;
    hash.update(name);
    hash.update(await fsp.readFile(file));
  }
  if (!found) throw new Error("Project không có package.json.");
  return hash.digest("hex");
}

async function installDependencies(dir) {
  if (!commandExists(npmCmd())) throw new Error("Máy chưa có Node.js/npm.");
  const stamp = path.join(dir, "node_modules", ".vibaocode-stamp");
  const next = await fingerprint(dir);
  try {
    if ((await fsp.readFile(stamp, "utf8")).trim() === next) return { skipped: true };
  } catch {}
  const args = fs.existsSync(path.join(dir, "package-lock.json"))
    ? ["ci", "--no-audit", "--no-fund", "--prefer-offline", "--progress=false"]
    : ["install", "--no-audit", "--no-fund", "--prefer-offline", "--progress=false"];
  const result = await run(npmCmd(), args, {
    cwd: dir,
    timeoutMs: 600000,
    maxOutput: 60000,
    env: { NPM_CONFIG_UPDATE_NOTIFIER: "false" },
  });
  if (result.code !== 0) throw new Error("npm install thất bại:\n" + (result.stderr || result.stdout));
  await fsp.mkdir(path.dirname(stamp), { recursive: true });
  await fsp.writeFile(stamp, next, "utf8");
  return { skipped: false };
}

async function freePort(start = 5173) {
  for (let port = start; port < start + 500; port += 1) {
    const available = await new Promise((resolve) => {
      const server = net.createServer();
      server.unref();
      server.once("error", () => resolve(false));
      server.listen(port, HOST, () => server.close(() => resolve(true)));
    });
    if (available) return port;
  }
  throw new Error("Không tìm được port trống.");
}

async function waitPort(port, timeoutMs = 90000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const ok = await new Promise((resolve) => {
      const socket = net.createConnection({ host: HOST, port });
      socket.setTimeout(600);
      socket.once("connect", () => { socket.destroy(); resolve(true); });
      socket.once("timeout", () => { socket.destroy(); resolve(false); });
      socket.once("error", () => resolve(false));
    });
    if (ok) return true;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

async function readPackage(dir) {
  return JSON.parse(await fsp.readFile(path.join(dir, "package.json"), "utf8"));
}

function devArgs(pkg, port) {
  const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  const script = pkg.scripts?.dev ? "dev" : pkg.scripts?.start ? "start" : "";
  if (!script) throw new Error("Project không có script dev/start.");
  if (deps.next) return ["run", script, "--", "--hostname", HOST, "--port", String(port)];
  return ["run", script, "--", "--host", HOST, "--port", String(port)];
}

async function startProject({ repo, branch = "main", githubToken = "", forceRemote = false }) {
  const key = projectKey(repo, branch);
  const current = projects.get(key);
  if (current && current.child?.exitCode == null && !forceRemote) {
    return {
      runtime: "local-bridge",
      sandboxName: "LOCAL BRIDGE",
      running: true,
      previewUrl: "http://" + HOST + ":" + current.port,
      localUrl: "http://" + HOST + ":" + current.port,
      logs: current.logs,
      port: current.port,
    };
  }
  if (current?.child?.pid) killTree(current.child.pid);

  const dir = await ensureRepo(repo, branch, githubToken, forceRemote);
  await installDependencies(dir);
  const pkg = await readPackage(dir);
  const port = await freePort();
  const child = spawn(npmCmd(), devArgs(pkg, port), {
    cwd: dir,
    env: { ...process.env, BROWSER: "none" },
    windowsHide: true,
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const state = { repo, branch, dir, port, child, logs: "", startedAt: Date.now() };
  projects.set(key, state);
  const onLog = (chunk) => { state.logs = appendLog(state.logs, chunk); };
  child.stdout?.on("data", onLog);
  child.stderr?.on("data", onLog);
  child.on("exit", (code) => { state.logs = appendLog(state.logs, "\n[Vibaocode] dev server exited " + code + "\n"); });

  const ready = await waitPort(port);
  if (!ready) throw new Error("Dev server chưa sẵn sàng.\n" + state.logs.slice(-5000));
  return {
    runtime: "local-bridge",
    sandboxName: "LOCAL BRIDGE",
    running: true,
    previewUrl: "http://" + HOST + ":" + port,
    localUrl: "http://" + HOST + ":" + port,
    logs: state.logs,
    port,
  };
}

async function syncFiles({ repo, branch = "main", files = [] }) {
  const state = projects.get(projectKey(repo, branch));
  if (!state) throw new Error("Project local chưa chạy.");
  let written = 0;
  for (const item of files) {
    const rel = safeRelative(item.path);
    if (!rel) continue;
    const target = path.resolve(state.dir, rel);
    if (!target.startsWith(path.resolve(state.dir) + path.sep)) continue;
    await fsp.mkdir(path.dirname(target), { recursive: true });
    await fsp.writeFile(target, String(item.content ?? ""), "utf8");
    written += 1;
  }
  return { synced: written, previewUrl: "http://" + HOST + ":" + state.port };
}

function hasScript(pkg, name) {
  return Boolean(pkg?.scripts?.[name]);
}

async function runChecks(dir) {
  const pkg = await readPackage(dir);
  const names = hasScript(pkg, "qa") ? ["qa"] : hasScript(pkg, "build") ? ["build"] : [];
  const checks = [];
  let passed = true;
  for (const name of names) {
    const result = await run(npmCmd(), ["run", name], { cwd: dir, timeoutMs: 300000, maxOutput: 20000 });
    checks.push({ name, exitCode: result.code, stdout: result.stdout, stderr: result.stderr });
    if (result.code !== 0) { passed = false; break; }
  }
  return { passed, smokeStatus: "ready", checks };
}

async function changedFiles(dir) {
  const status = await run("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: dir, timeoutMs: 30000, maxOutput: 40000 });
  const paths = [];
  for (const line of status.stdout.split(/\r?\n/)) {
    if (line.length < 4) continue;
    let rel = line.slice(3).trim();
    if (rel.includes(" -> ")) rel = rel.split(" -> ").pop().trim();
    rel = rel.replace(/^"|"$/g, "");
    if (!rel || paths.includes(rel)) continue;
    const target = path.join(dir, rel);
    if (fs.existsSync(target) && fs.statSync(target).isFile()) paths.push(rel);
  }
  paths.sort();
  const out = [];
  for (const rel of paths) {
    const target = path.join(dir, rel);
    const content = await fsp.readFile(target, "utf8").catch(() => "");
    const original = await run("git", ["show", "HEAD:" + rel.replace(/\\/g, "/")], { cwd: dir, timeoutMs: 20000, maxOutput: 200000 }).catch(() => ({ stdout: "" }));
    out.push({
      path: rel.replace(/\\/g, "/"),
      originalContent: original.stdout || "",
      content,
      reason: "Codex local change",
      sha: crypto.createHash("sha1").update(content).digest("hex"),
      size: Buffer.byteLength(content),
    });
  }
  return out;
}

function validReasoning(value) {
  return ["low", "medium", "high", "xhigh"].includes(String(value || "").toLowerCase());
}

async function startAgent({ repo, branch = "main", prompt, model = "", reasoning = "" }) {
  const login = await codexConnected();
  if (!login.connected) throw new Error("Codex chưa đăng nhập ChatGPT.");
  const dir = await ensureRepo(repo, branch, "", false);
  const key = projectKey(repo, branch);
  const current = agents.get(key);
  if (current && !current.finished) throw new Error("Codex đang chạy cho project này.");

  const args = ["exec", "--json", "--full-auto", "--skip-git-repo-check", "-C", dir];
  if (model) args.push("--model", model);
  if (validReasoning(reasoning)) args.push("-c", 'model_reasoning_effort="' + reasoning + '"');
  args.push(String(prompt || ""));

  const child = spawnCodex(args, {
    cwd: dir,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const state = {
    status: "running",
    phase: "Codex đang đọc dự án…",
    percent: 15,
    detail: "Dùng ChatGPT account trên máy",
    error: "",
    log: "",
    startedAt: Date.now(),
    finished: false,
    child,
    result: null,
  };
  agents.set(key, state);
  const consume = (chunk) => {
    const text = String(chunk);
    state.log = appendLog(state.log, text);
    if (/turn\.started/.test(text)) { state.percent = Math.max(state.percent, 25); state.phase = "Codex đang phân tích…"; }
    if (/item\.completed/.test(text)) { state.percent = Math.min(82, state.percent + 4); state.phase = "Codex đang sửa code…"; }
  };
  child.stdout?.on("data", consume);
  child.stderr?.on("data", consume);
  child.on("error", (error) => {
    state.status = "error"; state.error = error.message; state.finished = true; state.percent = 100;
  });
  child.on("exit", async (code) => {
    try {
      const files = await changedFiles(dir);
      const checks = await runChecks(dir);
      state.result = {
        summary: "Codex local đã hoàn tất và thay đổi " + files.length + " file.",
        files,
        checks,
        serverRunning: true,
      };
      if (code === 0) {
        state.status = "completed";
        state.phase = "Codex hoàn tất local";
        state.detail = files.length + " file thay đổi";
      } else {
        state.status = "error";
        state.phase = "Codex gặp lỗi";
        state.error = "Codex exited with code " + code;
      }
    } catch (error) {
      state.status = "error";
      state.phase = "Codex gặp lỗi";
      state.error = error instanceof Error ? error.message : String(error);
    } finally {
      state.finished = true;
      state.percent = 100;
    }
  });
  return { started: true, progress: { percent: 15, phase: "Codex đang chạy local…", detail: state.detail } };
}

const server = http.createServer(async (req, res) => {
  cors(req, res);
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

  try {
    const url = new URL(req.url || "/", "http://" + HOST + ":" + PORT);

    if (req.method === "GET" && url.pathname === "/health") {
      const login = await codexConnected();
      send(res, 200, {
        ok: true,
        version: VERSION,
        platform: process.platform,
        codexInstalled: Boolean(resolveCodexRunner()),
        codexConnected: login.connected,
        codexDetail: login.detail,
        nodeInstalled: commandExists("node"),
        npmInstalled: commandExists(npmCmd()),
        gitInstalled: commandExists("git"),
        workspaceRoot: workspaceRoot(),
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/setup/codex") {
      send(res, 200, { ok: true, detail: await installCodex() });
      return;
    }

    if (req.method === "POST" && url.pathname === "/auth/start") {
      send(res, 200, await startAuth());
      return;
    }

    if (req.method === "GET" && url.pathname === "/auth/status") {
      const login = await codexConnected();
      send(res, 200, {
        ...authState,
        connected: login.connected,
        status: login.connected ? "connected" : authState.status,
        detail: login.detail,
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/runtime/start") {
      send(res, 200, await startProject(await jsonBody(req)));
      return;
    }

    if (req.method === "POST" && url.pathname === "/runtime/sync") {
      send(res, 200, await syncFiles(await jsonBody(req)));
      return;
    }

    if (req.method === "POST" && url.pathname === "/runtime/test") {
      const body = await jsonBody(req);
      const dir = await ensureRepo(body.repo, body.branch || "main", body.githubToken || "", false);
      await installDependencies(dir);
      const checks = await runChecks(dir);
      send(res, 200, {
        runtime: "local-bridge",
        sandboxName: "LOCAL BRIDGE",
        serverRunning: true,
        ...checks,
        phases: [
          { name: "dependencies", passed: true },
          { name: "project-checks", passed: checks.passed },
        ],
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/runtime/stop") {
      const body = await jsonBody(req);
      const key = projectKey(body.repo, body.branch || "main");
      const state = projects.get(key);
      if (state?.child?.pid) killTree(state.child.pid);
      projects.delete(key);
      send(res, 200, { ok: true });
      return;
    }

    if (req.method === "POST" && url.pathname === "/agent/start") {
      send(res, 200, await startAgent(await jsonBody(req)));
      return;
    }

    if (req.method === "GET" && url.pathname === "/agent/status") {
      const key = projectKey(url.searchParams.get("repo"), url.searchParams.get("branch") || "main");
      const state = agents.get(key);
      if (!state) { send(res, 404, { error: "Không có agent run." }); return; }
      send(res, 200, {
        status: state.status,
        phase: state.phase,
        percent: state.percent,
        detail: state.detail,
        error: state.error,
        log: state.log,
        finished: state.finished,
        elapsedSeconds: Math.round((Date.now() - state.startedAt) / 1000),
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/agent/result") {
      const key = projectKey(url.searchParams.get("repo"), url.searchParams.get("branch") || "main");
      const state = agents.get(key);
      if (!state) { send(res, 404, { error: "Không có agent run." }); return; }
      if (!state.finished) { send(res, 409, { error: "Agent chưa hoàn tất." }); return; }
      if (!state.result) { send(res, 500, { error: state.error || "Agent không có kết quả." }); return; }
      send(res, 200, state.result);
      return;
    }

    if (req.method === "POST" && url.pathname === "/agent/cancel") {
      const body = await jsonBody(req);
      const key = projectKey(body.repo, body.branch || "main");
      const state = agents.get(key);
      if (state?.child?.pid && !state.finished) killTree(state.child.pid);
      if (state) {
        state.status = "cancelled";
        state.phase = "Agent đã dừng";
        state.finished = true;
        state.percent = 100;
      }
      send(res, 200, { ok: true });
      return;
    }

    send(res, 404, { error: "Not found." });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    send(res, 500, { error: message });
  }
});

server.listen(PORT, HOST, () => {
  console.log("Vibaocode Local Bridge " + VERSION);
  console.log("Listening on http://" + HOST + ":" + PORT);
  console.log("Keep this window open while using Vibaocode.");
});
