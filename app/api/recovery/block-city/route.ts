import { NextResponse } from "next/server";
import { Sandbox } from "@vercel/sandbox";

export const maxDuration = 300;

const SANDBOX_NAME = "vibaocode-fa6c3bed702f";
const REPO_DIR = "/vercel/sandbox/repos/8083cee9e2";

const APPROVED_FILES = [
  "src/scenes/CampaignScene.ts",
  "src/scenes/CityScene.ts",
  "src/scenes/DailyScene.ts",
  "src/scenes/EventScene.ts",
  "src/scenes/HomeScene.ts",
  "src/scenes/ProgressScene.ts",
  "src/scenes/PuzzleScene.ts",
  "src/ui.ts",
] as const;

async function shell(sandbox: Sandbox, command: string) {
  const result = await sandbox.runCommand({
    cmd: "bash",
    args: ["-lc", command],
  });
  return {
    exitCode: result.exitCode,
    stdout: await result.stdout(),
    stderr: await result.stderr(),
  };
}

function lastAgentMessage(jsonl: string) {
  let message = "";
  for (const line of jsonl.split("\n")) {
    const raw = line.trim();
    if (!raw) continue;
    try {
      const event = JSON.parse(raw);
      const item = event?.item;
      if (
        event?.type === "item.completed" &&
        item?.type === "agent_message" &&
        typeof item?.text === "string"
      ) {
        message = item.text;
      }
    } catch {
      // Ignore malformed progress lines.
    }
  }
  return message;
}

export async function GET() {
  try {
    const sandbox = await Sandbox.get({ name: SANDBOX_NAME });

    const status = await shell(
      sandbox,
      [
        `cd ${JSON.stringify(REPO_DIR)}`,
        "git status --short",
        "printf '\\n---DIFFSTAT---\\n'",
        "git diff --stat",
        "printf '\\n---HEAD---\\n'",
        "git rev-parse HEAD",
        "printf '\\n---ORIGIN---\\n'",
        "git rev-parse origin/main",
        "printf '\\n---EXIT---\\n'",
        "cat .vibaocode-codex-exit.txt 2>/dev/null || true",
      ].join(" && "),
    );

    const events = await shell(
      sandbox,
      `cd ${JSON.stringify(REPO_DIR)} && tail -n 500 .vibaocode-codex-events.jsonl 2>/dev/null || true`,
    );

    const files = [];
    for (const relativePath of APPROVED_FILES) {
      const path = `${REPO_DIR}/${relativePath}`;
      const buffer = await sandbox.readFileToBuffer({ path });
      if (!buffer) continue;
      files.push({
        path: relativePath,
        content: buffer.toString("utf8"),
        size: buffer.length,
      });
    }

    return NextResponse.json({
      ok: true,
      sandboxName: SANDBOX_NAME,
      status: status.stdout,
      statusError: status.stderr,
      agentSummary: lastAgentMessage(events.stdout),
      files,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Recovery read failed.",
      },
      { status: 500 },
    );
  }
}
