import { NextRequest, NextResponse } from "next/server";
import {
  ensurePublicRepo,
  getWorkspaceSandbox,
  installDependencies,
  projectWorkspaceId,
  repoDirectory,
  runProjectChecks,
  shell,
  startDevServer,
  validRelativePath,
  validRepo,
  validBranch,
} from "../../../../lib/workspace-sandbox";

export const maxDuration = 300;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const action = String(body.action || "start");
    const workspaceId = String(body.workspaceId || "").trim();
    const repo = String(body.repo || "").trim();
    const branch = String(body.branch || "main").trim();

    if (!workspaceId || !validRepo(repo) || !validBranch(branch)) {
      return NextResponse.json(
        { error: "Thiếu workspaceId hoặc repo/branch không hợp lệ." },
        { status: 400 },
      );
    }

    const sandbox = await getWorkspaceSandbox(projectWorkspaceId(workspaceId, repo, branch));
    const dir = repoDirectory(repo, branch);

    if (action === "start") {
      const ensuredDir = await ensurePublicRepo(sandbox, repo, branch);
      await installDependencies(sandbox, ensuredDir);
      const server = await startDevServer(sandbox, ensuredDir);
      return NextResponse.json({
        sandboxName: sandbox.name,
        previewUrl: server.previewUrl,
        running: server.ok,
        logs: server.logs,
      });
    }

    if (action === "sync") {
      const files = Array.isArray(body.files) ? body.files : [];
      if (!files.length) {
        return NextResponse.json({ error: "Không có file để sync." }, { status: 400 });
      }

      await ensurePublicRepo(sandbox, repo, branch);
      const writes = [];
      for (const item of files.slice(0, 20)) {
        const path = String(item?.path || "");
        const content = String(item?.content ?? "");
        if (!validRelativePath(path)) continue;
        writes.push({
          path: `${dir}/${path}`,
          content: Buffer.from(content, "utf8"),
        });
      }

      if (!writes.length) {
        return NextResponse.json({ error: "Không có file hợp lệ để sync." }, { status: 400 });
      }

      await sandbox.writeFiles(writes);
      return NextResponse.json({
        sandboxName: sandbox.name,
        previewUrl: sandbox.domain(3000),
        synced: writes.length,
      });
    }

    if (action === "restart") {
      await ensurePublicRepo(sandbox, repo, branch);
      await installDependencies(sandbox, dir);
      const server = await startDevServer(sandbox, dir);
      return NextResponse.json({
        sandboxName: sandbox.name,
        previewUrl: server.previewUrl,
        running: server.ok,
        logs: server.logs,
      });
    }

    if (action === "test") {
      await ensurePublicRepo(sandbox, repo, branch);
      const server = await startDevServer(sandbox, dir);
      const result = await runProjectChecks(sandbox, dir);
      const logs = await shell(
        sandbox,
        `cd ${JSON.stringify(dir)} && tail -n 160 .vibaocode-dev.log 2>/dev/null || true`,
      );
      return NextResponse.json({
        sandboxName: sandbox.name,
        previewUrl: server.previewUrl,
        serverRunning: server.ok,
        ...result,
        serverLogs: logs.stdout,
      });
    }

    if (action === "logs") {
      const logs = await shell(
        sandbox,
        `cd ${JSON.stringify(dir)} && tail -n 220 .vibaocode-dev.log 2>/dev/null || true`,
      );
      return NextResponse.json({
        sandboxName: sandbox.name,
        previewUrl: sandbox.domain(3000),
        logs: logs.stdout,
      });
    }

    return NextResponse.json({ error: "Action không hỗ trợ." }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Sandbox run failed." },
      { status: 500 },
    );
  }
}
