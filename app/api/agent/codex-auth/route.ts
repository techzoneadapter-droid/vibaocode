import { NextRequest, NextResponse } from "next/server";
import {
  ensureCodexCli,
  getWorkspaceSandbox,
  shell,
} from "../../../../lib/workspace-sandbox";

export const maxDuration = 180;

const STATE_FILE = "/tmp/vibaocode-codex-device.json";
const LOG_FILE = "/tmp/vibaocode-codex-device.log";
const PID_FILE = "/tmp/vibaocode-codex-device.pid";
const SCRIPT_FILE = "/tmp/vibaocode-codex-device.cjs";

function normalizeAuthError(value: string) {
  const log = value || "";

  if (/enable device code authorization|device code authorization.*disabled|device code login is not enabled/i.test(log)) {
    return "ChatGPT đang tắt Device Code Authorization. Vào ChatGPT → Settings → Security, bật Device Code Authorization for Codex rồi bấm Kết nối ChatGPT lại.";
  }

  if (/deviceauth\/usercode|token_exchange_failed|device code exchange failed|error sending request/i.test(log)) {
    return "Codex CLI không kết nối được tới máy chủ đăng nhập OpenAI từ Cloud Sandbox. Hãy bấm Chẩn đoán; Vibaocode sẽ hiển thị lỗi mạng/auth cụ thể.";
  }

  if (/403 forbidden|cf-mitigated|cloudflare|challenge/i.test(log)) {
    return "Kết nối từ Cloud Sandbox tới auth.openai.com đang bị Cloudflare chặn. Đây là lỗi đường truyền đăng nhập, không phải mật khẩu ChatGPT.";
  }

  return log.trim();
}

function deviceRunnerSource() {
  return String.raw`
const fs = require("fs");
const { spawn } = require("child_process");

const bin = process.argv[2];
const codexHome = process.argv[3];
const stateFile = process.argv[4];
const logFile = process.argv[5];

function writeState(next) {
  fs.writeFileSync(
    stateFile,
    JSON.stringify({ updatedAt: new Date().toISOString(), ...next }, null, 2),
  );
}

function log(line) {
  fs.appendFileSync(logFile, String(line) + "\n");
}

writeState({ status: "starting", connected: false, phase: "app-server" });

const child = spawn(bin, ["app-server", "--stdio"], {
  env: { ...process.env, CODEX_HOME: codexHome, RUST_LOG: "warn" },
  stdio: ["pipe", "pipe", "pipe"],
});

let buffer = "";
let initialized = false;
let loginStarted = false;
let finished = false;

function send(message) {
  child.stdin.write(JSON.stringify(message) + "\n");
}

function finish(next) {
  if (finished) return;
  finished = true;
  writeState(next);
  setTimeout(() => {
    try { child.kill("SIGTERM"); } catch {}
    process.exit(next.connected ? 0 : 1);
  }, 1200);
}

child.stdout.on("data", (chunk) => {
  buffer += chunk.toString("utf8");
  const lines = buffer.split(/\r?\n/);
  buffer = lines.pop() || "";

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    log("[stdout] " + line);

    let message;
    try {
      message = JSON.parse(line);
    } catch {
      continue;
    }

    if (message.id === 1 && !initialized) {
      if (message.error) {
        finish({
          status: "error",
          connected: false,
          phase: "initialize",
          error: message.error.message || JSON.stringify(message.error),
        });
        return;
      }

      initialized = true;
      send({ method: "initialized" });
      send({
        method: "account/login/start",
        id: 2,
        params: { type: "chatgptDeviceCode" },
      });
      loginStarted = true;
      writeState({
        status: "starting",
        connected: false,
        phase: "request-device-code",
      });
      continue;
    }

    if (message.id === 2 && loginStarted) {
      if (message.error) {
        finish({
          status: "error",
          connected: false,
          phase: "request-device-code",
          error: message.error.message || JSON.stringify(message.error),
        });
        return;
      }

      const result = message.result || {};
      if (result.type === "chatgptDeviceCode" && result.userCode) {
        writeState({
          status: "waiting",
          connected: false,
          phase: "waiting-user",
          loginId: result.loginId || "",
          verificationUrl: result.verificationUrl || "https://auth.openai.com/codex/device",
          userCode: result.userCode,
        });
      } else {
        finish({
          status: "error",
          connected: false,
          phase: "request-device-code",
          error: "Codex app-server did not return a device code.",
        });
      }
      continue;
    }

    if (message.method === "account/login/completed") {
      const params = message.params || {};
      if (params.success) {
        finish({
          status: "connected",
          connected: true,
          phase: "complete",
          loginId: params.loginId || "",
        });
      } else {
        finish({
          status: "error",
          connected: false,
          phase: "complete",
          error: params.error || "Device login was not completed.",
        });
      }
    }
  }
});

child.stderr.on("data", (chunk) => {
  log("[stderr] " + chunk.toString("utf8").trim());
});

child.on("error", (error) => {
  finish({
    status: "error",
    connected: false,
    phase: "spawn",
    error: error.message,
  });
});

child.on("exit", (code, signal) => {
  if (!finished) {
    finish({
      status: "error",
      connected: false,
      phase: "app-server-exit",
      error: "Codex app-server exited before login completed (code=" + code + ", signal=" + signal + ").",
    });
  }
});

send({
  method: "initialize",
  id: 1,
  params: {
    clientInfo: {
      name: "vibaocode",
      title: "Vibaocode",
      version: "0.1.0",
    },
  },
});

setTimeout(() => {
  if (!finished) {
    finish({
      status: "error",
      connected: false,
      phase: "timeout",
      error: "Device login timed out after 15 minutes. Create a fresh code and try again.",
    });
  }
}, 15 * 60 * 1000);
`;
}

async function readState(sandbox: Awaited<ReturnType<typeof getWorkspaceSandbox>>) {
  const result = await shell(
    sandbox,
    `cat ${JSON.stringify(STATE_FILE)} 2>/dev/null || true`,
  );

  if (!result.stdout.trim()) return null;

  try {
    return JSON.parse(result.stdout);
  } catch {
    return null;
  }
}

async function readLog(sandbox: Awaited<ReturnType<typeof getWorkspaceSandbox>>) {
  const result = await shell(
    sandbox,
    `tail -n 180 ${JSON.stringify(LOG_FILE)} 2>/dev/null || true`,
  );
  return result.stdout.trim();
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const workspaceId = String(body.workspaceId || "").trim();
    const action = String(body.action || "status");

    if (!workspaceId) {
      return NextResponse.json({ error: "Thiếu workspaceId." }, { status: 400 });
    }

    const sandbox = await getWorkspaceSandbox(workspaceId);

    if (action === "start") {
      const codex = await ensureCodexCli(sandbox);
      await shell(sandbox, `mkdir -p ${JSON.stringify(codex.codexHome)}`);

      const scriptBase64 = Buffer.from(deviceRunnerSource(), "utf8").toString("base64");

      await shell(
        sandbox,
        `
set -e
if [ -f ${JSON.stringify(PID_FILE)} ]; then
  OLD_PID="$(cat ${JSON.stringify(PID_FILE)} 2>/dev/null || true)"
  if [ -n "$OLD_PID" ]; then kill "$OLD_PID" >/dev/null 2>&1 || true; fi
fi
rm -f ${JSON.stringify(STATE_FILE)} ${JSON.stringify(LOG_FILE)} ${JSON.stringify(PID_FILE)}
printf '%s' ${JSON.stringify(scriptBase64)} | base64 -d > ${JSON.stringify(SCRIPT_FILE)}
nohup node ${JSON.stringify(SCRIPT_FILE)} \
  ${JSON.stringify(codex.bin)} \
  ${JSON.stringify(codex.codexHome)} \
  ${JSON.stringify(STATE_FILE)} \
  ${JSON.stringify(LOG_FILE)} \
  >/tmp/vibaocode-codex-runner.out 2>&1 < /dev/null &
echo $! > ${JSON.stringify(PID_FILE)}
`,
      );

      for (let i = 0; i < 15; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 350));
        const state = await readState(sandbox);
        if (!state) continue;

        if (state.status === "waiting" || state.status === "connected" || state.status === "error") {
          return NextResponse.json({
            ...state,
            version: codex.version,
            source: codex.source,
            error: state.error ? normalizeAuthError(String(state.error)) : undefined,
            rawError: state.error || undefined,
          });
        }
      }

      return NextResponse.json({
        status: "starting",
        connected: false,
        phase: "app-server",
        version: codex.version,
        source: codex.source,
      });
    }

    if (action === "status") {
      const state = await readState(sandbox);

      if (state?.status === "connected") {
        const codex = await ensureCodexCli(sandbox);
        const status = await shell(
          sandbox,
          `CODEX_HOME=${JSON.stringify(codex.codexHome)} ${JSON.stringify(codex.bin)} login status 2>&1 || true`,
        );
        const connected = /logged in using chatgpt/i.test(status.stdout + status.stderr);

        return NextResponse.json({
          ...state,
          connected,
          status: connected ? "connected" : "waiting",
          version: codex.version,
          source: codex.source,
          detail: status.stdout.trim() || status.stderr.trim(),
        });
      }

      if (state) {
        return NextResponse.json({
          ...state,
          error: state.error ? normalizeAuthError(String(state.error)) : undefined,
          rawError: state.error || undefined,
          detail: await readLog(sandbox),
        });
      }

      const codex = await ensureCodexCli(sandbox);
      const status = await shell(
        sandbox,
        `CODEX_HOME=${JSON.stringify(codex.codexHome)} ${JSON.stringify(codex.bin)} login status 2>&1 || true`,
      );
      const connected = /logged in using chatgpt/i.test(status.stdout + status.stderr);

      return NextResponse.json({
        status: connected ? "connected" : "disconnected",
        connected,
        phase: connected ? "complete" : "idle",
        version: codex.version,
        source: codex.source,
        detail: status.stdout.trim() || status.stderr.trim(),
      });
    }

    if (action === "logout") {
      const codex = await ensureCodexCli(sandbox);
      await shell(
        sandbox,
        `
if [ -f ${JSON.stringify(PID_FILE)} ]; then
  PID="$(cat ${JSON.stringify(PID_FILE)} 2>/dev/null || true)"
  if [ -n "$PID" ]; then kill "$PID" >/dev/null 2>&1 || true; fi
fi
CODEX_HOME=${JSON.stringify(codex.codexHome)} ${JSON.stringify(codex.bin)} logout >/tmp/vibaocode-codex-logout.log 2>&1 || true
rm -f ${JSON.stringify(STATE_FILE)} ${JSON.stringify(PID_FILE)}
`,
      );

      return NextResponse.json({
        status: "disconnected",
        connected: false,
        phase: "idle",
        version: codex.version,
        source: codex.source,
      });
    }

    if (action === "diagnostics") {
      const codex = await ensureCodexCli(sandbox);
      const status = await shell(
        sandbox,
        `CODEX_HOME=${JSON.stringify(codex.codexHome)} ${JSON.stringify(codex.bin)} login status 2>&1 || true`,
      );
      const dns = await shell(
        sandbox,
        "getent hosts auth.openai.com 2>&1 | head -n 8 || true",
      );
      const auth = await shell(
        sandbox,
        "curl -4 -sS -I --max-time 12 https://auth.openai.com/codex/device 2>&1 | head -n 30 || true",
      );
      const state = await readState(sandbox);
      const log = await readLog(sandbox);

      return NextResponse.json({
        version: codex.version,
        source: codex.source,
        state,
        loginStatus: status.stdout || status.stderr,
        dns: dns.stdout || dns.stderr,
        connectivity: auth.stdout || auth.stderr,
        log,
      });
    }

    return NextResponse.json({ error: "Action không hỗ trợ." }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Codex auth failed." },
      { status: 500 },
    );
  }
}
