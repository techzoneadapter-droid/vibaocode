import { NextRequest, NextResponse } from "next/server";
import {
  ensurePublicRepo,
  getWorkspaceSandbox,
  installDependencies,
  repoDirectory,
  run,
  runProjectChecks,
  shell,
  startDevServer,
  validBranch,
  validRelativePath,
  validRepo,
} from "../../../../lib/workspace-sandbox";

export const maxDuration = 300;

function lastAgentMessage(jsonl: string) {
  const lines = jsonl.split("\n").map((line) => line.trim()).filter(Boolean);
  let message = "";
  for (const line of lines) {
    try {
      const event = JSON.parse(line);
      const item = event?.item;
      if (
        event?.type === "item.completed" &&
        item?.type === "agent_message" &&
        typeof item?.text === "string"
      ) {
        message = item.text;
      }
    } catch {
      // Ignore non-JSON progress lines.
    }
  }
  return message;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const workspaceId = String(body.workspaceId || "").trim();
    const repo = String(body.repo || "").trim();
    const branch = String(body.branch || "main").trim();
    const prompt = String(body.prompt || "").trim();

    if (
      !workspaceId ||
      !validRepo(repo) ||
      !validBranch(branch) ||
      !prompt
    ) {
      return NextResponse.json(
        { error: "Thiếu workspaceId, repo/branch hoặc prompt." },
        { status: 400 },
      );
    }

    const sandbox = await getWorkspaceSandbox(workspaceId);
    const dir = await ensurePublicRepo(sandbox, repo, branch);

    const auth = await shell(sandbox, "codex login status 2>&1 || true");
    const connected =
      /logged in|authenticated|chatgpt|plan/i.test(auth.stdout) &&
      !/not logged|not authenticated/i.test(auth.stdout);

    if (!connected) {
      return NextResponse.json(
        {
          error:
            "Codex chưa đăng nhập bằng tài khoản ChatGPT trong workspace này. Hãy bấm Kết nối ChatGPT/Codex trước.",
        },
        { status: 401 },
      );
    }

    const promptPath = `${dir}/.vibaocode-codex-prompt.txt`;
    await sandbox.writeFiles([
      {
        path: promptPath,
        content: Buffer.from(
          [
            "You are working inside the user's repository.",
            "Implement the request directly in the working tree.",
            "Preserve unrelated behavior.",
            "Do not commit or push.",
            "After editing, inspect your changes and leave the working tree ready for review.",
            "Prefer small, maintainable, mobile-friendly changes.",
            "",
            "USER REQUEST:",
            prompt,
          ].join("\n"),
          "utf8",
        ),
      },
    ]);

    const exec = await shell(
      sandbox,
      `cd ${JSON.stringify(dir)} && cat .vibaocode-codex-prompt.txt | codex exec - --sandbox workspace-write --json > .vibaocode-codex-events.jsonl 2> .vibaocode-codex-stderr.log`,
    );

    const events = await shell(
      sandbox,
      `cd ${JSON.stringify(dir)} && cat .vibaocode-codex-events.jsonl 2>/dev/null || true`,
    );
    const stderr = await shell(
      sandbox,
      `cd ${JSON.stringify(dir)} && tail -n 200 .vibaocode-codex-stderr.log 2>/dev/null || true`,
    );

    const changed = await shell(
      sandbox,
      `cd ${JSON.stringify(dir)} && { git diff --name-only; git ls-files --others --exclude-standard; } | awk 'NF' | sort -u`,
    );

    const paths = changed.stdout
      .split("\n")
      .map((path) => path.trim())
      .filter(Boolean)
      .filter(validRelativePath)
      .filter((path) => !path.startsWith(".vibaocode-"))
      .slice(0, 20);

    const files = [];
    for (const path of paths) {
      const buffer = await sandbox.readFileToBuffer({ path: `${dir}/${path}` });
      if (!buffer || buffer.length > 1_500_000) continue;

      const original = await run(sandbox, "git", [
        "-C",
        dir,
        "show",
        `HEAD:${path}`,
      ]);

      files.push({
        path,
        content: buffer.toString("utf8"),
        originalContent: original.exitCode === 0 ? original.stdout : "",
        reason: "Codex đã thay đổi file này trong cloud workspace.",
      });
    }

    await installDependencies(sandbox, dir);
    const server = await startDevServer(sandbox, dir);
    const checks = await runProjectChecks(sandbox, dir);

    return NextResponse.json({
      model: "codex-chatgpt",
      summary:
        lastAgentMessage(events.stdout) ||
        (exec.exitCode === 0
          ? "Codex đã hoàn tất chỉnh sửa."
          : "Codex kết thúc với lỗi; hãy xem log."),
      files,
      previewUrl: server.previewUrl,
      serverRunning: server.ok,
      checks,
      codexExitCode: exec.exitCode,
      codexLog: stderr.stdout.slice(-12000),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Codex agent failed." },
      { status: 500 },
    );
  }
}
