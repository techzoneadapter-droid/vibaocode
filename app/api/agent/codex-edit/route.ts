import { NextRequest, NextResponse } from "next/server";
import {
  ensurePublicRepo,
  ensureCodexCli,
  getWorkspaceSandbox,
  installDependencies,
  repoDirectory,
  reserveLongAgentSession,
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
    if (!buffer) throw new Error("Progress state is not available yet.");
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
    const githubToken = String(body.githubToken || "").trim();
    const action = String(body.action || "run");
    const requestedModel = String(body.codexModel || "").trim();
    const requestedReasoning = String(body.codexReasoning || "").trim().toLowerCase();

    if (
      requestedModel &&
      !/^[A-Za-z0-9._:-]+$/.test(requestedModel)
    ) {
      return NextResponse.json({ error: "Codex model không hợp lệ." }, { status: 400 });
    }

    if (
      requestedReasoning &&
      !["minimal", "low", "medium", "high", "xhigh", "max"].includes(requestedReasoning)
    ) {
      return NextResponse.json({ error: "Mức reasoning Codex không hợp lệ." }, { status: 400 });
    }

    if (!workspaceId || !validRepo(repo) || !validBranch(branch)) {
      return NextResponse.json(
        { error: "Thiếu workspaceId hoặc repo/branch không hợp lệ." },
        { status: 400 },
      );
    }

    const sandbox = await getWorkspaceSandbox(workspaceId);
    const dir = repoDirectory(repo, branch);
    const progressPath = `${dir}/.vibaocode-codex-progress.json`;
    const eventsPath = `${dir}/.vibaocode-codex-events.jsonl`;
    const stderrPath = `${dir}/.vibaocode-codex-stderr.log`;
    const exitPath = `${dir}/.vibaocode-codex-exit.txt`;
    const pidPath = `${dir}/.vibaocode-codex.pid`;

    if (action === "status") {
      const state = await readProgress(sandbox, progressPath);
      const exitCheck = await shell(
        sandbox,
        `test -f ${JSON.stringify(exitPath)} && cat ${JSON.stringify(exitPath)} || true`,
      );
      const finished = Boolean(exitCheck.stdout.trim());

      const pidCheck = await shell(
        sandbox,
        `PID="$(cat ${JSON.stringify(pidPath)} 2>/dev/null || true)"; if [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null; then echo running; fi`,
      );
      const running = pidCheck.stdout.includes("running");

      const diagnostics = await shell(
        sandbox,
        [
          `STARTED="$(cat ${JSON.stringify(dir + "/.vibaocode-codex-started.txt")} 2>/dev/null || true)"`,
          `EVENT_SIZE="$(wc -c < ${JSON.stringify(eventsPath)} 2>/dev/null || echo 0)"`,
          `EVENT_MTIME="$(stat -c %Y ${JSON.stringify(eventsPath)} 2>/dev/null || echo 0)"`,
          `STDERR_SIZE="$(wc -c < ${JSON.stringify(stderrPath)} 2>/dev/null || echo 0)"`,
          `printf '%s|%s|%s|%s' "$STARTED" "$EVENT_SIZE" "$EVENT_MTIME" "$STDERR_SIZE"`,
        ].join("; "),
      );
      const [startedRaw, eventSizeRaw, eventMtimeRaw, stderrSizeRaw] =
        diagnostics.stdout.trim().split("|");
      const startedAtMs = Number(startedRaw || 0);
      const eventSize = Number(eventSizeRaw || 0);
      const eventMtimeMs = Number(eventMtimeRaw || 0) * 1000;
      const stderrSize = Number(stderrSizeRaw || 0);
      const elapsedSeconds =
        startedAtMs > 0 ? Math.max(0, Math.floor((Date.now() - startedAtMs) / 1000)) : 0;
      const silentSeconds =
        eventMtimeMs > 0
          ? Math.max(0, Math.floor((Date.now() - eventMtimeMs) / 1000))
          : elapsedSeconds;

      if (!finished && running && eventSize > 0) {
        const eventsNow = await shell(
          sandbox,
          `tail -n 220 ${JSON.stringify(eventsPath)} 2>/dev/null || true`,
        );
        const dynamic = progressFromEvents(eventsNow.stdout);
        await writeProgress(sandbox, progressPath, dynamic);
        const latest = await readProgress(sandbox, progressPath);
        return NextResponse.json({
          ...latest,
          finished: false,
          running: true,
          exitCode: null,
          elapsedSeconds,
          silentSeconds,
          eventSize,
          heartbeat: true,
        });
      }

      if (!finished && running && eventSize === 0) {
        const stderrTail = await shell(
          sandbox,
          `tail -n 100 ${JSON.stringify(stderrPath)} 2>/dev/null || true`,
        );
        const runnerTail = await shell(
          sandbox,
          `tail -n 100 ${JSON.stringify(dir + "/.vibaocode-codex-runner.log")} 2>/dev/null || true`,
        );
        const failureText = `${stderrTail.stdout}\n${runnerTail.stdout}`.trim();

        if (failureText && /error|fatal|invalid|unknown option|not found|denied|failed|bwrap|bubblewrap/i.test(failureText)) {
          await shell(
            sandbox,
            `PID="$(cat ${JSON.stringify(pidPath)} 2>/dev/null || true)"; if [ -n "$PID" ]; then kill "$PID" >/dev/null 2>&1 || true; fi`,
          );
          await writeProgress(sandbox, progressPath, {
            percent: 0,
            phase: "Codex khởi động thất bại",
            detail: failureText.slice(-1200),
          });
          return NextResponse.json({
            percent: 0,
            phase: "Codex khởi động thất bại",
            detail: failureText.slice(-1200),
            finished: true,
            running: false,
            exitCode: null,
            elapsedSeconds,
            error: failureText.slice(-4000),
          });
        }

        // JSON mode normally emits startup events quickly. If absolutely no event
        // is produced for 8 minutes, the process is considered wedged and is
        // stopped automatically so the user does not waste 15–30 minutes.
        if (elapsedSeconds >= 480) {
          await shell(
            sandbox,
            `PID="$(cat ${JSON.stringify(pidPath)} 2>/dev/null || true)"; if [ -n "$PID" ]; then kill "$PID" >/dev/null 2>&1 || true; fi`,
          );
          await writeProgress(sandbox, progressPath, {
            percent: 0,
            phase: "Codex bị treo khi khởi động",
            detail: "Không có event nào sau 8 phút. Agent đã được tự động dừng.",
          });
          return NextResponse.json({
            percent: 0,
            phase: "Codex bị treo khi khởi động",
            detail: "Không có event nào sau 8 phút. Agent đã được tự động dừng.",
            finished: true,
            running: false,
            exitCode: null,
            elapsedSeconds,
            error:
              "Codex không phát bất kỳ event nào trong 8 phút nên Vibaocode đã tự dừng process. Hãy chạy lại; nếu lặp lại, đổi Reasoning từ High xuống Medium để kiểm tra runtime.",
          });
        }

        const elapsedLabel =
          elapsedSeconds >= 60
            ? `${Math.floor(elapsedSeconds / 60)} phút ${elapsedSeconds % 60} giây`
            : `${elapsedSeconds} giây`;

        return NextResponse.json({
          ...state,
          percent: Math.max(15, state.percent || 0),
          phase: "Codex đang khởi động / reasoning…",
          detail: `Process còn sống • ${elapsedLabel} • chưa phát event JSON${stderrSize ? ` • stderr ${stderrSize} bytes` : ""}`,
          finished: false,
          running: true,
          exitCode: null,
          elapsedSeconds,
          silentSeconds,
          eventSize,
          heartbeat: true,
        });
      }

      if (!finished && !running) {
        const stderrTail = await shell(
          sandbox,
          `tail -n 120 ${JSON.stringify(stderrPath)} 2>/dev/null || true`,
        );
        const runnerTail = await shell(
          sandbox,
          `tail -n 120 ${JSON.stringify(dir + "/.vibaocode-codex-runner.log")} 2>/dev/null || true`,
        );
        const commandIdResult = await shell(
          sandbox,
          `cat ${JSON.stringify(dir + "/.vibaocode-codex-command.txt")} 2>/dev/null || true`,
        );
        const failureText =
          (stderrTail.stdout || runnerTail.stdout ||
            `Codex process đã dừng nhưng không ghi exit code. Command ${commandIdResult.stdout.trim() || "unknown"} có thể đã bị kết thúc khi Sandbox session dừng/timeout.`).trim();

        await writeProgress(sandbox, progressPath, {
          percent: 0,
          phase: "Codex dừng bất thường",
          detail: failureText.slice(-1200),
        });

        return NextResponse.json({
          percent: 0,
          phase: "Codex dừng bất thường",
          detail: failureText.slice(-1200),
          finished: true,
          running: false,
          exitCode: null,
          elapsedSeconds,
          error: failureText.slice(-4000),
        });
      }

      if (finished && state.percent < 70) {
        await writeProgress(sandbox, progressPath, {
          percent: 70,
          phase: "Codex đã sửa xong • đang chuẩn bị kết quả…",
        });
      }

      const latest = await readProgress(sandbox, progressPath);
      return NextResponse.json({
        ...latest,
        finished,
        running: false,
        exitCode: finished ? Number(exitCheck.stdout.trim() || "1") : null,
        elapsedSeconds,
        silentSeconds,
        eventSize,
      });
    }

    if (action === "cancel") {
      await shell(
        sandbox,
        `PID="$(cat ${JSON.stringify(pidPath)} 2>/dev/null || true)"; if [ -n "$PID" ]; then kill "$PID" >/dev/null 2>&1 || true; fi`,
      );
      await writeProgress(sandbox, progressPath, {
        percent: 0,
        phase: "Agent đã được dừng",
      });
      return NextResponse.json({ cancelled: true });
    }

    if (action === "result") {
      const repoCheck = await shell(
        sandbox,
        `test -d ${JSON.stringify(dir + "/.git")} && echo yes || true`,
      );
      if (!repoCheck.stdout.includes("yes")) {
        return NextResponse.json(
          { error: "Cloud Workspace không còn repository để lấy kết quả." },
          { status: 409 },
        );
      }

      const exitResult = await shell(
        sandbox,
        `cat ${JSON.stringify(exitPath)} 2>/dev/null || true`,
      );
      if (!exitResult.stdout.trim()) {
        return NextResponse.json(
          { pending: true, error: "Codex vẫn đang xử lý." },
          { status: 409 },
        );
      }

      const codexExitCode = Number(exitResult.stdout.trim() || "1");
      const codex = await ensureCodexCli(sandbox);

      const events = await shell(
        sandbox,
        `cd ${JSON.stringify(dir)} && cat .vibaocode-codex-events.jsonl 2>/dev/null || true`,
      );
      const stderr = await shell(
        sandbox,
        `cd ${JSON.stringify(dir)} && tail -n 240 .vibaocode-codex-stderr.log 2>/dev/null || true`,
      );

      const agentSummary = lastAgentMessage(events.stdout);
      const sandboxFailureText = `${stderr.stdout}\n${events.stdout}\n${agentSummary}`;

      if (/bwrap:|bubblewrap|unexpected capabilities but not setuid|failed rtm_newaddr/i.test(sandboxFailureText)) {
        await writeProgress(sandbox, progressPath, {
          percent: 0,
          phase: "Lỗi Linux sandbox lồng nhau",
          detail: stderr.stdout.slice(-500),
        });
        return NextResponse.json(
          {
            error:
              "Codex runtime vẫn chạm Bubblewrap dù Cloud Sandbox đã cách ly. Hãy chạy lại với deployment Vibaocode mới nhất.",
            codexLog: sandboxFailureText.slice(-8000),
            codexVersion: codex.version,
            requestedModel: requestedModel || null,
          },
          { status: 500 },
        );
      }

      await writeProgress(sandbox, progressPath, {
        percent: 74,
        phase: "Đang thu thập các file Codex đã sửa…",
      });

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
        .slice(0, 60);

      const files = [];
      for (const filePath of paths) {
        const buffer = await sandbox.readFileToBuffer({ path: `${dir}/${filePath}` });
        if (!buffer || buffer.length > 1_500_000) continue;

        const original = await run(sandbox, "git", [
          "-C",
          dir,
          "show",
          `HEAD:${filePath}`,
        ]);

        const blobSha = await run(sandbox, "git", [
          "-C",
          dir,
          "rev-parse",
          `HEAD:${filePath}`,
        ]);

        files.push({
          path: filePath,
          content: buffer.toString("utf8"),
          originalContent: original.exitCode === 0 ? original.stdout : "",
          reason: "Codex đã thay đổi file này trong cloud workspace.",
          sha: blobSha.exitCode === 0 ? blobSha.stdout.trim() : "",
          size: buffer.length,
        });
      }

      await writeProgress(sandbox, progressPath, {
        percent: 80,
        phase: "Đang cài/đồng bộ dependencies…",
        detail: `${files.length} file thay đổi`,
      });

      await installDependencies(sandbox, dir);

      await writeProgress(sandbox, progressPath, {
        percent: 87,
        phase: "Đang khởi động Live Preview…",
      });

      const server = await startDevServer(sandbox, dir);

      await writeProgress(sandbox, progressPath, {
        percent: 93,
        phase: "Đang chạy Auto Test…",
      });

      const checks = await runProjectChecks(sandbox, dir);

      await writeProgress(sandbox, progressPath, {
        percent: 100,
        phase: checks.passed ? "Hoàn tất • Test PASS" : "Hoàn tất • cần review lỗi test",
        detail: `${files.length} file thay đổi`,
      });

      if (codexExitCode !== 0 && files.length === 0) {
        return NextResponse.json(
          {
            error:
              agentSummary ||
              stderr.stdout.slice(-4000) ||
              "Codex kết thúc với lỗi và không tạo thay đổi.",
            codexExitCode,
          },
          { status: 500 },
        );
      }

      return NextResponse.json({
        model: `${requestedModel || "Codex default"} • ${requestedReasoning || "default reasoning"} • ${codex.version}`,
        summary:
          agentSummary ||
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
        sandboxMode: "vercel-isolated + async-codex + latest-codex + ignore-user-config + danger-full-access",
        selectedModel: requestedModel || null,
        selectedReasoning: requestedReasoning || null,
      });
    }

    if (!prompt) {
      return NextResponse.json({ error: "Thiếu prompt." }, { status: 400 });
    }

    await writeProgress(sandbox, progressPath, {
      percent: 3,
      phase: "Đang chuẩn bị Cloud Workspace…",
    });

    const ensuredDir = await ensurePublicRepo(sandbox, repo, branch, githubToken);
    const codex = await ensureCodexCli(sandbox);
    await shell(sandbox, `mkdir -p ${JSON.stringify(codex.codexHome)}`);
    const codexCommand =
      `CODEX_HOME=${JSON.stringify(codex.codexHome)} ${JSON.stringify(codex.bin)}`;
    const modelArgs = [
      requestedModel ? `--model ${JSON.stringify(requestedModel)}` : "",
      requestedReasoning
        ? `--config ${JSON.stringify(`model_reasoning_effort="${requestedReasoning}"`)}`
        : "",
    ].filter(Boolean).join(" ");

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
    const actualEventsPath = `${ensuredDir}/.vibaocode-codex-events.jsonl`;
    const actualStderrPath = `${ensuredDir}/.vibaocode-codex-stderr.log`;
    const actualExitPath = `${ensuredDir}/.vibaocode-codex-exit.txt`;
    const actualPidPath = `${ensuredDir}/.vibaocode-codex.pid`;
    const commandIdPath = `${ensuredDir}/.vibaocode-codex-command.txt`;

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
      detail: "Agent chạy nền trong persistent Cloud Sandbox; yêu cầu lớn không còn bị giới hạn bởi HTTP request.",
    });

    const innerCommand = [
      "set +e",
      `cd ${JSON.stringify(ensuredDir)} || exit 97`,
      `echo $ > ${JSON.stringify(actualPidPath)}`,
      `trap 'CODE=$?; printf "%s" "$CODE" > ${JSON.stringify(actualExitPath)}' EXIT`,
      `cat .vibaocode-codex-prompt.txt | ${codexCommand} exec --ignore-user-config --dangerously-bypass-approvals-and-sandbox --cd ${JSON.stringify(ensuredDir)} ${modelArgs} --json - > .vibaocode-codex-events.jsonl 2> .vibaocode-codex-stderr.log`,
      "CODE=$?",
      `printf "%s" "$CODE" > ${JSON.stringify(actualExitPath)}`,
      "exit $CODE",
    ].join("; ");

    await shell(
      sandbox,
      [
        `cd ${JSON.stringify(ensuredDir)}`,
        `OLD_PID="$(cat ${JSON.stringify(actualPidPath)} 2>/dev/null || true)"; if [ -n "$OLD_PID" ]; then kill "$OLD_PID" >/dev/null 2>&1 || true; fi`,
        `rm -f ${JSON.stringify(actualEventsPath)} ${JSON.stringify(actualStderrPath)} ${JSON.stringify(actualExitPath)} ${JSON.stringify(actualPidPath)} .vibaocode-codex-runner.log`,
        `date +%s%3N > .vibaocode-codex-started.txt`,
      ].join(" && "),
    );

    // A persistent Sandbox preserves the filesystem between sessions, but a
    // session timeout still terminates running processes. Reserve enough live
    // session time before launching a large coding job.
    const sessionBudget = await reserveLongAgentSession(sandbox);

    // Use Vercel Sandbox detached execution, not shell "nohup &". Detached
    // commands are first-class Sandbox commands and remain attached to the
    // active microVM session after this HTTP request returns.
    const detachedCommand = await sandbox.runCommand({
      cmd: "bash",
      args: ["-lc", innerCommand],
      cwd: ensuredDir,
      detached: true,
    });

    await sandbox.writeFiles([
      {
        path: commandIdPath,
        content: Buffer.from(detachedCommand.cmdId, "utf8"),
      },
    ]);

    // Give the runner a short moment to create its PID/exit markers. This
    // catches launch failures immediately instead of making the UI wait for the
    // next status poll with only "dừng bất thường".
    await new Promise((resolve) => setTimeout(resolve, 900));
    const launchProbe = await shell(
      sandbox,
      [
        `PID="$(cat ${JSON.stringify(actualPidPath)} 2>/dev/null || true)"`,
        `EXIT="$(cat ${JSON.stringify(actualExitPath)} 2>/dev/null || true)"`,
        `if [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null; then STATE=running; elif [ -n "$EXIT" ]; then STATE=finished; else STATE=missing; fi`,
        `printf '%s|%s|%s' "$STATE" "$PID" "$EXIT"`,
      ].join("; "),
    );

    const [launchState, launchPid, launchExit] = launchProbe.stdout.trim().split("|");

    if (launchState === "missing") {
      const stderrTail = await shell(
        sandbox,
        `tail -n 160 ${JSON.stringify(actualStderrPath)} 2>/dev/null || true`,
      );
      throw new Error(
        `Codex detached command không khởi động được trong Sandbox. command=${detachedCommand.cmdId}\n${stderrTail.stdout.slice(-3000)}`,
      );
    }

    return NextResponse.json(
      {
        started: true,
        running: launchState === "running",
        finished: launchState === "finished",
        launchPid: launchPid || null,
        launchExitCode: launchExit ? Number(launchExit) : null,
        commandId: detachedCommand.cmdId,
        model: requestedModel || "Codex default",
        reasoning: requestedReasoning || "default",
        version: codex.version,
        sessionBudget,
        progress: await readProgress(sandbox, progressPath),
      },
      { status: 202 },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Codex agent failed." },
      { status: 500 },
    );
  }
}
