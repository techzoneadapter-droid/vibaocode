import { NextRequest, NextResponse } from "next/server";
import {
  getWorkspaceSandbox,
  shell,
} from "../../../../lib/workspace-sandbox";

export const maxDuration = 120;

function extractDeviceAuth(log: string) {
  const url =
    log.match(/https:\/\/[A-Za-z0-9./?=_-]*openai[A-Za-z0-9./?=_-]*/i)?.[0] ||
    log.match(/https:\/\/auth\.openai\.com\/codex\/device/i)?.[0] ||
    "";
  const code =
    log.match(/\b[A-Z0-9]{4}-[A-Z0-9]{4}\b/)?.[0] ||
    log.match(/\b[A-Z0-9]{8}\b/)?.[0] ||
    "";
  return { verificationUrl: url, userCode: code };
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
      await shell(
        sandbox,
        "rm -f /tmp/vibaocode-codex-login.log /tmp/vibaocode-codex-login.pid; " +
          "nohup bash -lc 'codex login --device-auth' > /tmp/vibaocode-codex-login.log 2>&1 < /dev/null & " +
          "echo $! > /tmp/vibaocode-codex-login.pid",
      );

      for (let i = 0; i < 12; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        const log = await shell(
          sandbox,
          "cat /tmp/vibaocode-codex-login.log 2>/dev/null || true",
        );
        const auth = extractDeviceAuth(log.stdout);
        if (auth.verificationUrl || auth.userCode) {
          return NextResponse.json({
            status: "waiting",
            ...auth,
            log: log.stdout.slice(-4000),
          });
        }
      }

      const log = await shell(
        sandbox,
        "cat /tmp/vibaocode-codex-login.log 2>/dev/null || true",
      );
      return NextResponse.json({
        status: "starting",
        ...extractDeviceAuth(log.stdout),
        log: log.stdout.slice(-4000),
      });
    }

    if (action === "status") {
      const status = await shell(
        sandbox,
        "codex login status 2>&1 || true",
      );
      const log = await shell(
        sandbox,
        "cat /tmp/vibaocode-codex-login.log 2>/dev/null || true",
      );
      const combined = `${status.stdout}\n${status.stderr}\n${log.stdout}`;
      const connected =
        /logged in|authenticated|chatgpt|plan/i.test(status.stdout) &&
        !/not logged|not authenticated/i.test(status.stdout);

      return NextResponse.json({
        status: connected ? "connected" : "waiting",
        connected,
        ...extractDeviceAuth(combined),
        detail: status.stdout.trim() || log.stdout.slice(-2000),
      });
    }

    if (action === "logout") {
      await shell(sandbox, "codex logout >/tmp/vibaocode-codex-logout.log 2>&1 || true");
      return NextResponse.json({ status: "disconnected" });
    }

    return NextResponse.json({ error: "Action không hỗ trợ." }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Codex auth failed." },
      { status: 500 },
    );
  }
}
