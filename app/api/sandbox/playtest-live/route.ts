import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  ensurePublicRepo,
  ensureBrowserTester,
  getWorkspaceSandbox,
  installDependencies,
  shell,
  startDevServer,
  validBranch,
  validRepo,
} from "../../../../lib/workspace-sandbox";

export const maxDuration = 300;

function runnerSource() {
  return String.raw`
const { chromium } = require("playwright");
const fs = require("node:fs/promises");

(async () => {
const target = process.argv[2];
const runDir = process.argv[3];
await fs.mkdir(runDir, { recursive: true });

const statePath = runDir + "/state.json";
const screenshots = [];
const actions = [];
const consoleErrors = [];
const pageErrors = [];

async function writeState(extra = {}) {
  const state = {
    status: "running",
    currentStep: screenshots.length,
    screenshots,
    actions,
    consoleErrors,
    pageErrors,
    ...extra,
  };
  await fs.writeFile(statePath, JSON.stringify(state), "utf8");
}

async function pause(ms = 650) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 1,
  isMobile: true,
  hasTouch: true,
});
const page = await context.newPage();

page.on("console", (msg) => {
  if (msg.type() === "error") consoleErrors.push(msg.text());
});
page.on("pageerror", (err) => pageErrors.push(String(err)));

async function snap(label) {
  const file = String(screenshots.length).padStart(2, "0") + "-" + label + ".png";
  const path = runDir + "/" + file;
  await page.screenshot({ path, fullPage: false });
  screenshots.push(file);
  await fs.copyFile(path, runDir + "/current.png");
  await writeState({ label });
}

try {
  await writeState({ label: "opening" });
  await page.goto(target, { waitUntil: "domcontentloaded", timeout: 45000 });
  await pause(1200);
  await snap("start");

  const unsafe = /delete|remove|logout|sign out|purchase|buy|pay|checkout|unsubscribe|destroy|drop|reset data/i;
  const candidates = page.locator('button, [role="button"], a[href], input[type="button"], input[type="submit"]');
  const count = Math.min(await candidates.count(), 12);

  for (let i = 0; i < count && actions.length < 6; i++) {
    const el = candidates.nth(i);
    if (!(await el.isVisible().catch(() => false))) continue;
    const text =
      ((await el.innerText().catch(() => "")) ||
        (await el.getAttribute("aria-label")) ||
        "").trim();
    if (unsafe.test(text)) continue;

    try {
      actions.push({ type: "click", target: text || "interactive element #" + i });
      await writeState({ label: "clicking " + (text || "#" + i) });
      await el.click({ timeout: 3000 });
      await pause(800);
      await snap("click-" + actions.length);
    } catch {}
  }

  const canvas = page.locator("canvas").first();
  if (await canvas.isVisible().catch(() => false)) {
    const box = await canvas.boundingBox();
    if (box) {
      const points = [[0.5,0.5],[0.25,0.7],[0.75,0.7],[0.5,0.25]];
      for (const [rx, ry] of points) {
        actions.push({ type: "canvas-click", x: rx, y: ry });
        await writeState({ label: "testing game canvas" });
        await page.mouse.click(box.x + box.width * rx, box.y + box.height * ry);
        await pause(500);
        await snap("canvas-" + actions.length);
      }

      const drags = [
        [[0.2, 0.81], [0.25, 0.42]],
        [[0.5, 0.81], [0.5, 0.36]],
        [[0.8, 0.81], [0.72, 0.48]],
      ];
      for (const [[sx, sy], [tx, ty]] of drags) {
        actions.push({ type: "canvas-drag", from: [sx, sy], to: [tx, ty] });
        await writeState({ label: "dragging game piece" });
        await page.mouse.move(box.x + box.width * sx, box.y + box.height * sy);
        await page.mouse.down();
        await page.mouse.move(box.x + box.width * tx, box.y + box.height * ty, { steps: 14 });
        await page.mouse.up();
        await pause(700);
        await snap("drag-" + actions.length);
      }
    }
  }

  const title = await page.title();
  const url = page.url();
  const bodyText = (await page.locator("body").innerText().catch(() => "")).slice(0, 4000);
  await browser.close();

  await writeState({
    status: "completed",
    label: "done",
    title,
    url,
    bodyText,
    finishedAt: Date.now(),
  });
} catch (error) {
  try { await browser.close(); } catch {}
  await writeState({
    status: "failed",
    label: "failed",
    error: String(error && (error.stack || error)),
    finishedAt: Date.now(),
  });
  process.exitCode = 1;
}
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
`;
}

async function loadState(sandbox: any, runDir: string) {
  const stateResult = await shell(
    sandbox,
    `cat ${JSON.stringify(runDir + "/state.json")} 2>/dev/null || echo '{}'`,
  );
  let state: any = {};
  try {
    state = JSON.parse(stateResult.stdout.trim() || "{}");
  } catch {
    state = {};
  }

  let currentImage = "";
  try {
    const buffer = await sandbox.readFileToBuffer({ path: runDir + "/current.png" });
    if (buffer) currentImage = `data:image/png;base64,${buffer.toString("base64")}`;
  } catch {}

  const screenshots: string[] = [];
  if (["completed", "failed"].includes(state.status) && Array.isArray(state.screenshots)) {
    for (const file of state.screenshots.slice(0, 12)) {
      try {
        const buffer = await sandbox.readFileToBuffer({ path: runDir + "/" + String(file) });
        if (buffer) screenshots.push(`data:image/png;base64,${buffer.toString("base64")}`);
      } catch {}
    }
  }

  return { state, currentImage, screenshots };
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const action = String(body.action || "start");
    const workspaceId = String(body.workspaceId || "").trim();
    const repo = String(body.repo || "").trim();
    const branch = String(body.branch || "main").trim();
    const githubToken = String(body.githubToken || "").trim();
    const runId = String(body.runId || "").replace(/[^A-Za-z0-9_-]/g, "");

    if (!workspaceId || !validRepo(repo) || !validBranch(branch)) {
      return NextResponse.json(
        { error: "Thiếu workspaceId hoặc repo/branch không hợp lệ." },
        { status: 400 },
      );
    }

    const sandbox = await getWorkspaceSandbox(workspaceId);
    const toolsDir = "/vercel/sandbox/.vibaocode-tools";

    if (action === "start") {
      const dir = await ensurePublicRepo(sandbox, repo, branch, githubToken);
      await installDependencies(sandbox, dir);
      const server = await startDevServer(sandbox, dir);
      if (!server.ok) {
        return NextResponse.json(
          { error: "Dev server chưa chạy được.", serverLogs: server.logs },
          { status: 400 },
        );
      }

      await ensureBrowserTester(sandbox);
      const nextRunId = crypto.randomUUID().replace(/-/g, "").slice(0, 20);
      const runDir = `${toolsDir}/live/${nextRunId}`;
      const scriptPath = `${toolsDir}/playtest-live.cjs`;

      await sandbox.writeFiles([
        { path: scriptPath, content: Buffer.from(runnerSource(), "utf8") },
      ]);
      await shell(sandbox, `mkdir -p ${JSON.stringify(runDir)}`);

      const command = await sandbox.runCommand({
        cmd: "bash",
        args: [
          "-lc",
          `cd ${JSON.stringify(toolsDir)} && node playtest-live.cjs ${JSON.stringify(server.previewUrl)} ${JSON.stringify(runDir)} > ${JSON.stringify(runDir + "/runner.log")} 2>&1`,
        ],
        detached: true,
      });
      await sandbox.writeFiles([
        {
          path: runDir + "/runner.command",
          content: Buffer.from(command.cmdId, "utf8"),
        },
      ]);

      return NextResponse.json({
        runId: nextRunId,
        status: "starting",
        previewUrl: server.previewUrl,
        sandboxName: sandbox.name,
        commandId: command.cmdId,
      });
    }

    if (action === "status") {
      if (!runId) {
        return NextResponse.json({ error: "Thiếu runId." }, { status: 400 });
      }
      const runDir = `${toolsDir}/live/${runId}`;
      const loaded = await loadState(sandbox, runDir);
      const log = await shell(
        sandbox,
        `tail -n 100 ${JSON.stringify(runDir + "/runner.log")} 2>/dev/null || true`,
      );

      return NextResponse.json({
        runId,
        ...loaded,
        log: log.stdout,
      });
    }

    return NextResponse.json({ error: "Action không hỗ trợ." }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Live play test failed." },
      { status: 500 },
    );
  }
}
