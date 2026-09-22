import { NextRequest, NextResponse } from "next/server";
import {
  ensurePublicRepo,
  ensureCodexCli,
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

type ProgressState = {
  percent: number;
  phase: string;
  detail?: string;
  updatedAt: string;
};

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

function usageFromEvents(jsonl: string) {
  const lines = jsonl.split("\n").map((line) => line.trim()).filter(Boolean);
  let usage: Record<string, number> | null = null;

  for (const line of lines) {
    try {
      const event = JSON.parse(line);
      if (event?.type === "turn.completed" && event?.usage) {
        usage = {
          inputTokens: Number(event.usage.input_tokens || 0),
          cachedInputTokens: Number(event.usage.cached_input_tokens || 0),
          outputTokens: Number(event.usage.output_tokens || 0),
          reasoningOutputTokens: Number(event.usage.reasoning_output_tokens || 0),
        };
      }
    } catch {
      // Ignore malformed event lines.
    }
  }

  return usage;
}

function progressFromEvents(jsonl: string) {
  const lines = jsonl.split("\n").map((line) => line.trim()).filter(Boolean);
  let completedItems = 0;
  let phase = "Codex đang đọc dự án và lập kế hoạch…";
  let detail = "";

  for (const line of lines) {
    try {
      const event = JSON.parse(line);
      const item = event?.item;

      if (event?.type === "item.completed") completedItems += 1;

      if (item?.type === "command_execution") {
        phase = "Codex đang chạy lệnh và kiểm tra dự án…";
        detail = String(item?.command || "").slice(0, 180);
      } else if (item?.type === "file_change") {
        phase = "Codex đang sửa code…";
        const changes = Array.isArray(item?.changes) ? item.changes : [];
        detail = changes.map((change: any) => change?.path).filter(Boolean).slice(0, 3).join(", ");
      } else if (item?.type === "agent_message") {
        phase = "Codex đang tổng hợp thay đổi…";
        detail = String(item?.text || "").slice(0, 180);
      }
    } catch {
      // Ignore malformed lines.
    }
  }

  return {
    percent: Math.min(67, 20 + completedItems * 3),
    phase,
    detail,
  };
}

async function writeProgress(
  sandbox: Awaited<ReturnType<typeof getWorkspaceSandbox>>,
  progressPath: string,
  value: Omit<ProgressState, "updatedAt">,
) {
  const state: ProgressState = {
    ...value,
    updatedAt: new Date().toISOString(),
  };
  await sandbox.writeFiles([
    {
      path: progressPath,
      content: Buffer.from(JSON.stringify(state), "utf8"),
    },
  ]);
}

async function readProgress(
  sandbox: Awaited<ReturnType<typeof getWorkspaceSandbox>>,
  progressPath: string,
) {
  try {
    const buffer = await sandbox.readFileToBuffer({ path: progressPath });
    return JSON.parse(buffer.toString("utf8")) as ProgressState;
  } catch {
    return {
      percent: 0,
      phase: "Sẵn sàng",
      updatedAt: new Date().toISOString(),
    } satisfies ProgressState;
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const workspaceId = String(body.workspaceId || "").trim();
    const repo = String(body.repo || "").trim();
    const branch = String(body.branch || "main").trim();
    const prompt = String(body.prompt || "").trim();
    const action = String(body.action || "run");

    if (!workspaceId || !validRepo(repo) || !validBranch(branch)) {
      return NextResponse.json(
        { error: "Thiếu workspaceId hoặc repo/branch không hợp lệ." },
        { status: 400 },
      );
    }

    const sandbox = await getWorkspaceSandbox(workspaceId);
    const dir = repoDirectory(repo, branch);
    const progressPath = `${dir}/.vibaocode-codex-progress.json`;

    if (action === "status") {
      return NextResponse.json(await readProgress(sandbox, progressPath));
    }

    if (!prompt) {
      return NextResponse.json({ error: "Thiếu prompt." }, { status: 400 });
    }

    await writeProgress(sandbox, progressPath, {
      percent: 3,
      phase: "Đang chuẩn bị Cloud Workspace…",
    });

    const ensuredDir = await ensurePublicRepo(sandbox, repo, branch);
    const codex = await ensureCodexCli(sandbox);
    await shell(sandbox, `mkdir -p ${JSON.stringify(codex.codexHome)}`);
    const codexCommand =
      `CODEX_HOME=${JSON.stringify(codex.codexHome)} ${JSON.stringify(codex.bin)}`;

    await writeProgress(sandbox, progressPath, {
      percent: 8,
      phase: "Đang kiểm tra đăng nhập ChatGPT/Codex…",
      detail: codex.version,
    });

    const auth = await shell(sandbox, `${codexCommand} login status 2>&1 || true`);
    const connected =
      /logged in|authenticated|chatgpt|plan/i.test(auth.stdout) &&
      !/not logged|not authenticated/i.test(auth.stdout);

    if (!connected) {
      await writeProgress(sandbox, progressPath, {
        percent: 0,
        phase: "Codex chưa đăng nhập",
      });
      return NextResponse.json(
        {
          error:
            "Codex chưa đăng nhập bằng tài khoản ChatGPT trong workspace này. Hãy bấm Kết nối ChatGPT/Codex trước.",
        },
        { status: 401 },
      );
    }

    const promptPath = `${ensuredDir}/.vibaocode-codex-prompt.txt`;
    const eventsPath = `${ensuredDir}/.vibaocode-codex-events.jsonl`;
    const stderrPath = `${ensuredDir}/.vibaocode-codex-stderr.log`;
    const exitPath = `${ensuredDir}/.vibaocode-codex-exit.txt`;
    const pidPath = `${ensuredDir}/.vibaocode-codex.pid`;

    await sandbox.writeFiles([
      {
        path: promptPath,
        content: Buffer.from(
          [
            "You are working inside the user's repository, which is already isolated by a Vercel Cloud Sandbox.",
            "Implement the request directly in the current repository working tree.",
            "Do not modify files outside this repository.",
            "Do not read or expose credentials, auth files, environment secrets, or files outside the repository.",
            "Preserve unrelated behavior.",
            "Do not commit or push.",
            "After editing, inspect your changes and leave the working tree ready for review.",
            "Prefer maintainable, mobile-friendly changes.",
            "",
            "USER REQUEST:",
            prompt,
          ].join("\n"),
          "utf8",
        ),
      },
    ]);

    await writeProgress(sandbox, progressPath, {
      percent: 15,
      phase: "Codex đang khởi động Agent…",
      detail: "Cloud Sandbox đã cách ly dự án; tắt lớp Linux sandbox lồng nhau để tránh lỗi bwrap.",
    });

    const innerCommand = [
      "set +e",
      `cd ${JSON.stringify(ensuredDir)}`,
      `cat .vibaocode-codex-prompt.txt | ${codexCommand} exec - --dangerously-bypass-approvals-and-sandbox --json > .vibaocode-codex-events.jsonl 2> .vibaocode-codex-stderr.log`,
      "CODE=$?",
      'printf "%s" "$CODE" > .vibaocode-codex-exit.txt',
      "exit 0",
    ].join("; ");

    await shell(
      sandbox,
      [
        `cd ${JSON.stringify(ensuredDir)}`,
        `rm -f ${JSON.stringify(eventsPath)} ${JSON.stringify(stderrPath)} ${JSON.stringify(exitPath)} ${JSON.stringify(pidPath)}`,
        `nohup bash -lc ${JSON.stringify(innerCommand)} > .vibaocode-codex-runner.log 2>&1 < /dev/null &`,
        `echo $! > ${JSON.stringify(pidPath)}`,
      ].join(" && "),
    );

    let finished = false;
    for (let i = 0; i < 68; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 2500));

      const exitCheck = await shell(
        sandbox,
        `test -f ${JSON.stringify(exitPath)} && cat ${JSON.stringify(exitPath)} || true`,
      );

      const eventsNow = await shell(
        sandbox,
        `tail -n 180 ${JSON.stringify(eventsPath)} 2>/dev/null || true`,
      );

      const dynamic = progressFromEvents(eventsNow.stdout);
      await writeProgress(sandbox, progressPath, dynamic);

      if (exitCheck.stdout.trim()) {
        finished = true;
        break;
      }
    }

    if (!finished) {
      await shell(
        sandbox,
        `PID="$(cat ${JSON.stringify(pidPath)} 2>/dev/null || true)"; if [ -n "$PID" ]; then kill "$PID" >/dev/null 2>&1 || true; fi`,
      );
      await writeProgress(sandbox, progressPath, {
        percent: 0,
        phase: "Codex quá thời gian xử lý",
      });
      return NextResponse.json(
        {
          error:
            "Codex chạy quá thời gian cho một lượt Agent. Hãy chia yêu cầu thành một đợt nhỏ hơn hoặc chạy lại.",
        },
        { status: 504 },
      );
    }

    const exitResult = await shell(
      sandbox,
      `cat ${JSON.stringify(exitPath)} 2>/dev/null || printf "1"`,
    );
    const codexExitCode = Number(exitResult.stdout.trim() || "1");

    const events = await shell(
      sandbox,
      `cd ${JSON.stringify(ensuredDir)} && cat .vibaocode-codex-events.jsonl 2>/dev/null || true`,
    );
    const stderr = await shell(
      sandbox,
      `cd ${JSON.stringify(ensuredDir)} && tail -n 240 .vibaocode-codex-stderr.log 2>/dev/null || true`,
    );

    if (/bwrap:|bubblewrap|unexpected capabilities but not setuid/i.test(stderr.stdout)) {
      await writeProgress(sandbox, progressPath, {
        percent: 0,
        phase: "Lỗi Linux sandbox lồng nhau",
        detail: stderr.stdout.slice(-500),
      });
      return NextResponse.json(
        {
          error:
            "Codex vẫn cố khởi động Bubblewrap trong Cloud Sandbox. Vibaocode đã chuyển sang danger-full-access cho lớp Codex; hãy Load lại app để nhận bản runtime mới.",
          codexLog: stderr.stdout.slice(-6000),
        },
        { status: 500 },
      );
    }

    await writeProgress(sandbox, progressPath, {
      percent: 70,
      phase: "Đang thu thập các file Codex đã sửa…",
    });

    const changed = await shell(
      sandbox,
      `cd ${JSON.stringify(ensuredDir)} && { git diff --name-only; git ls-files --others --exclude-standard; } | awk 'NF' | sort -u`,
    );

    const paths = changed.stdout
      .split("\n")
      .map((path) => path.trim())
      .filter(Boolean)
      .filter(validRelativePath)
      .filter((path) => !path.startsWith(".vibaocode-"))
      .slice(0, 40);

    const files = [];
    for (const path of paths) {
      const buffer = await sandbox.readFileToBuffer({ path: `${ensuredDir}/${path}` });
      if (!buffer || buffer.length > 1_500_000) continue;

      const original = await run(sandbox, "git", [
        "-C",
        ensuredDir,
        "show",
        `HEAD:${path}`,
      ]);

      const blobSha = await run(sandbox, "git", [
        "-C",
        ensuredDir,
        "rev-parse",
        `HEAD:${path}`,
      ]);

      files.push({
        path,
        content: buffer.toString("utf8"),
        originalContent: original.exitCode === 0 ? original.stdout : "",
        reason: "Codex đã thay đổi file này trong cloud workspace.",
        sha: blobSha.exitCode === 0 ? blobSha.stdout.trim() : "",
        size: buffer.length,
      });
    }

    await writeProgress(sandbox, progressPath, {
      percent: 77,
      phase: "Đang cài/đồng bộ dependencies…",
      detail: `${files.length} file thay đổi`,
    });

    await installDependencies(sandbox, ensuredDir);

    await writeProgress(sandbox, progressPath, {
      percent: 84,
      phase: "Đang khởi động Live Preview…",
    });

    const server = await startDevServer(sandbox, ensuredDir);

    await writeProgress(sandbox, progressPath, {
      percent: 91,
      phase: "Đang chạy Auto Test…",
    });

    const checks = await runProjectChecks(sandbox, ensuredDir);

    await writeProgress(sandbox, progressPath, {
      percent: 100,
      phase: checks.passed ? "Hoàn tất • Test PASS" : "Hoàn tất • cần review lỗi test",
      detail: `${files.length} file thay đổi`,
    });

    if (codexExitCode !== 0 && files.length === 0) {
      return NextResponse.json(
        {
          error:
            lastAgentMessage(events.stdout) ||
            stderr.stdout.slice(-4000) ||
            "Codex kết thúc với lỗi và không tạo thay đổi.",
          codexExitCode,
        },
        { status: 500 },
      );
    }

    return NextResponse.json({
      model: `codex-chatgpt • ${codex.version}`,
      summary:
        lastAgentMessage(events.stdout) ||
        (codexExitCode === 0
          ? "Codex đã hoàn tất chỉnh sửa."
          : "Codex có cảnh báo; thay đổi đã được giữ lại để review."),
      files,
      previewUrl: server.previewUrl,
      serverRunning: server.ok,
      checks,
      codexExitCode,
      codexLog: stderr.stdout.slice(-12000),
      usage: usageFromEvents(events.stdout),
      progress: await readProgress(sandbox, progressPath),
      sandboxMode: "vercel-isolated + codex-danger-full-access",
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Codex agent failed." },
      { status: 500 },
    );
  }
}
