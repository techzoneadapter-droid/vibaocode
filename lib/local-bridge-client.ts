"use client";

const BRIDGE = "http://127.0.0.1:43127";

export type BridgeHealth = {
  ok: boolean;
  version?: string;
  platform?: string;
  codexInstalled?: boolean;
  codexConnected?: boolean;
  codexDetail?: string;
  nodeInstalled?: boolean;
  npmInstalled?: boolean;
  gitInstalled?: boolean;
  workspaceRoot?: string;
};

async function request(path: string, init?: RequestInit, timeoutMs = 2500) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(BRIDGE + path, {
      ...init,
      mode: "cors",
      cache: "no-store",
      signal: controller.signal,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Local Bridge request failed.");
    return data;
  } finally {
    window.clearTimeout(timer);
  }
}

export async function bridgeHealth(timeoutMs = 900): Promise<BridgeHealth | null> {
  try {
    return await request("/health?t=" + Date.now(), undefined, timeoutMs);
  } catch {
    return null;
  }
}

export async function installBridgeCodex() {
  return request("/setup/codex", { method: "POST" }, 310000);
}

export async function startBridgeAuth() {
  return request("/auth/start", { method: "POST" }, 15000);
}

export async function bridgeAuthStatus() {
  return request("/auth/status?t=" + Date.now(), undefined, 15000);
}

export async function startBridgeProject(body: any) {
  return request("/runtime/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }, 650000);
}

export async function syncBridgeFiles(body: any) {
  return request("/runtime/sync", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }, 30000);
}

export async function testBridgeProject(body: any) {
  return request("/runtime/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }, 320000);
}

export async function stopBridgeProject(body: any) {
  return request("/runtime/stop", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }, 30000);
}

export async function startBridgeAgent(body: any) {
  return request("/agent/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }, 30000);
}

export async function bridgeAgentStatus(repo: string, branch: string) {
  return request(
    "/agent/status?repo=" + encodeURIComponent(repo) + "&branch=" + encodeURIComponent(branch),
    undefined,
    15000,
  );
}

export async function bridgeAgentResult(repo: string, branch: string) {
  return request(
    "/agent/result?repo=" + encodeURIComponent(repo) + "&branch=" + encodeURIComponent(branch),
    undefined,
    30000,
  );
}

export async function cancelBridgeAgent(body: any) {
  return request("/agent/cancel", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }, 15000);
}

export function bridgeInstallerUrl() {
  return "/start-vibaocode-bridge.cmd";
}
