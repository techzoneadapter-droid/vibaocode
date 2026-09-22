import { NextRequest, NextResponse } from "next/server";
import {
  ensureCodexCli,
  getWorkspaceSandbox,
  shell,
} from "../../../../lib/workspace-sandbox";

export const maxDuration = 180;

function extractDeviceAuth(log: string) {
  const url =
    log.match(/https:\/\/auth\.openai\.com\/codex\/device[^\s]*/i)?.[0] ||
    log.match(/https:\/\/[A-Za-z0-9.-]*openai\.com\/[A-Za-z0-9_./?=&%-]*/i)?.[0] ||
    "";

  const code =
    log.match(/(?:code|mã)[^A-Z0-9]{0,20}([A-Z0-9]{4,6}-[A-Z0-9]{4,6})/i)?.[1]?.toUpperCase() ||
    log.match(/\b([A-Z0-9]{4,6}-[A-Z0-9]{4,6})\b/i)?.[1]?.toUpperCase() ||
    "";

  return {
    verificationUrl: url || (code ? "https://auth.openai.com/codex/device" : ""),
    userCode: code,
  };
}

function authProblem(log: string) {
  if (/enable device code authorization|device[- ]code authorization.*disabled/i.test(log)) {
    return "ChatGPT đang tắt Device Code Authorization. Vào ChatGPT → Settings → Security, bật Device Code Authorization for Codex rồi bấm tạo mã mới.";
  }
  if (/cloudflare|cf-mitigated|403 forbidden/i.test(log)) {
    return "Cloud Sandbox đang bị chặn khi kết nối auth.openai.com. Hãy thử tạo lại Sandbox hoặc đăng nhập lại sau.";
  }
  if (/token_exchange_failed|device code exchange failed/i.test(log)) {
    return "Codex nhận được mã nhưng đổi token thất bại. Hãy tạo mã mới và đăng nhập lại.";
  }
  if (/command not found|not found.*codex/i.test(log)) {
    return "Codex CLI chưa sẵn sàng trong Sandbox.";
  }
  return "";
}

function connectedFrom(output: string) {
  return /logged in using chatgpt|logged in.*chatgpt|authenticated.*chatgpt/i.test(output) &&
    !/not logged|not authenticated/i.test(output);
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
    const codex = await ensureCodexCli(sandbox);
    await shell(sandbox, `mkdir -p ${JSON.stringify(codex.codexHome)}`);

    const envPrefix = `CODEX_HOME=${JSON.stringify(codex.codexHome)}`;
    const bin = JSON.stringify(codex.bin);

    if (action === "start") {
      await shell(
        sandbox,
        `
if [ -f /tmp/vibaocode-codex-login.pid ]; then
  OLD_PID="$(cat /tmp/vibaocode-codex-login.pid 2>/dev/null || true)"
  if [ -n "$OLD_PID" ]; then kill "$OLD_PID" >/dev/null 2>&1 || true; fi
fi
rm -f /tmp/vibaocode-codex-login.log /tmp/vibaocode-codex-login.pid
nohup bash -lc '${envPrefix} ${bin} login --device-auth' > /tmp/vibaocode-codex-login.log 2>&1 < /dev/null &
echo $! > /tmp/vibaocode-codex-login.pid
`,
      );

      for (let i = 0; i < 18; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 900));
        const log = await shell(
          sandbox,
          "cat /tmp/vibaocode-codex-login.log 2>/dev/null || true",
        );
        const auth = extractDeviceAuth(log.stdout);
        const problem = authProblem(log.stdout);

        if (problem) {
          return NextResponse.json({
            status: "error",
            connected: false,
            version: codex.version,
            error: problem,
            detail: log.stdout.slice(-5000),
            ...auth,
          });
        }

        if (auth.userCode) {
          return NextResponse.json({
            status: "waiting",
            connected: false,
            version: codex.version,
            ...auth,
            detail: log.stdout.slice(-5000),
          });
        }
      }

      const log = await shell(
        sandbox,
        "cat /tmp/vibaocode-codex-login.log 2>/dev/null || true",
      );
      const problem = authProblem(log.stdout);

      return NextResponse.json({
        status: problem ? "error" : "starting",
        connected: false,
        version: codex.version,
        ...extractDeviceAuth(log.stdout),
        error: problem || undefined,
        detail: log.stdout.slice(-5000),
      });
    }

    if (action === "status") {
      const status = await shell(
        sandbox,
        `${envPrefix} ${bin} login status 2>&1 || true`,
      );
      const log = await shell(
        sandbox,
        "cat /tmp/vibaocode-codex-login.log 2>/dev/null || true",
      );
      const combined = `${status.stdout}\n${status.stderr}\n${log.stdout}`;
      const connected = connectedFrom(combined);
      const problem = connected ? "" : authProblem(combined);

      return NextResponse.json({
        status: connected ? "connected" : problem ? "error" : "waiting",
        connected,
        version: codex.version,
        ...extractDeviceAuth(combined),
        error: problem || undefined,
        detail: (
          status.stdout.trim() ||
          status.stderr.trim() ||
          log.stdout.slice(-4000)
        ),
      });
    }

    if (action === "logout") {
      await shell(
        sandbox,
        `${envPrefix} ${bin} logout >/tmp/vibaocode-codex-logout.log 2>&1 || true`,
      );
      return NextResponse.json({
        status: "disconnected",
        connected: false,
        version: codex.version,
      });
    }

    if (action === "diagnostics") {
      const status = await shell(
        sandbox,
        `${envPrefix} ${bin} login status 2>&1 || true`,
      );
      const connectivity = await shell(
        sandbox,
        "curl -I -L --max-time 12 https://auth.openai.com/codex/device 2>&1 | tail -n 40 || true",
      );
      return NextResponse.json({
        version: codex.version,
        status: status.stdout || status.stderr,
        connectivity: connectivity.stdout || connectivity.stderr,
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
