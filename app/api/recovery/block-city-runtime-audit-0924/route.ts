import { NextResponse } from "next/server";
import { Sandbox } from "@vercel/sandbox";
import {
  ensureBrowserTester,
  installDependencies,
  repoDirectory,
  shell,
  startDevServer,
} from "../../../../lib/workspace-sandbox";

export const maxDuration = 300;

const SANDBOX_NAME = "vibaocode-fa6c3bed702f";
const REPO = "techzoneadapter-droid/block-city-game";
const BRANCH = "main";

const runner = String.raw`
const { chromium } = require("playwright");
const fs = require("node:fs/promises");

(async () => {
  const target = process.argv[2];
  const outDir = process.argv[3];
  await fs.mkdir(outDir, { recursive: true });

  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });

  const shots = [];
  const consoleErrors = [];
  const pageErrors = [];

  async function runViewport(width, height) {
    const context = await browser.newContext({
      viewport: { width, height },
      deviceScaleFactor: 1,
      isMobile: true,
      hasTouch: true,
    });
    const page = await context.newPage();
    page.on("console", (msg) => { if (msg.type() === "error") consoleErrors.push(width + "x" + height + ": " + msg.text()); });
    page.on("pageerror", (err) => pageErrors.push(width + "x" + height + ": " + String(err)));

    async function openHome() {
      await page.goto(target, { waitUntil: "domcontentloaded", timeout: 45000 });
      await page.waitForTimeout(1200);
    }

    async function canvasBox() {
      const canvas = page.locator("canvas").first();
      if (!(await canvas.isVisible().catch(() => false))) return null;
      return await canvas.boundingBox();
    }

    async function clickCanvas(rx, ry) {
      const box = await canvasBox();
      if (!box) return false;
      await page.mouse.click(box.x + box.width * rx, box.y + box.height * ry);
      await page.waitForTimeout(900);
      return true;
    }

    async function snap(label) {
      const canvas = page.locator("canvas").first();
      const path = outDir + "/" + width + "x" + height + "-" + label + ".png";
      if (await canvas.isVisible().catch(() => false)) {
        await canvas.screenshot({ path });
      } else {
        await page.screenshot({ path, fullPage: false });
      }
      shots.push({ label: width + "x" + height + "-" + label, path });
    }

    await openHome();
    await snap("home");

    await openHome();
    await clickCanvas(0.50, 0.80);
    await snap("puzzle");

    // Try a representative tray drag on Puzzle.
    {
      const box = await canvasBox();
      if (box) {
        await page.mouse.move(box.x + box.width * 0.20, box.y + box.height * 0.80);
        await page.mouse.down();
        await page.mouse.move(box.x + box.width * 0.25, box.y + box.height * 0.47, { steps: 14 });
        await page.mouse.up();
        await page.waitForTimeout(700);
        await snap("puzzle-after-drag");
      }
    }

    await openHome();
    await clickCanvas(0.13, 0.93);
    await snap("city");

    // Daily from City secondary nav.
    await clickCanvas(0.69, 0.947);
    await snap("daily");

    await openHome();
    await clickCanvas(0.13, 0.93);
    await clickCanvas(0.88, 0.947);
    await snap("event");

    await openHome();
    await clickCanvas(0.38, 0.93);
    await snap("campaign");

    await openHome();
    await clickCanvas(0.87, 0.93);
    await snap("character-picker");

    await openHome();
    await clickCanvas(0.11, 0.055);
    await snap("progress");

    await context.close();
  }

  await runViewport(390, 844);
  await runViewport(360, 800);

  await browser.close();
  console.log(JSON.stringify({ shots, consoleErrors, pageErrors }));
})().catch((error) => {
  console.error(error && (error.stack || error));
  process.exit(1);
});
`;

export async function GET() {
  try {
    const sandbox = await Sandbox.get({ name: SANDBOX_NAME });
    const dir = repoDirectory(REPO, BRANCH);

    const git = await shell(
      sandbox,
      `cd ${JSON.stringify(dir)} && git rev-parse HEAD && git status --short`,
    );

    const install = await installDependencies(sandbox, dir);
    const build = await shell(
      sandbox,
      `cd ${JSON.stringify(dir)} && npm run build`,
    );

    const server = await startDevServer(sandbox, dir);
    if (!server.ok) {
      return NextResponse.json({ ok: false, error: "dev server failed", git: git.stdout, build: build.stdout + build.stderr, serverLogs: server.logs }, { status: 500 });
    }

    const toolsDir = await ensureBrowserTester(sandbox);
    const runDir = `${toolsDir}/block-city-audit-${Date.now()}`;
    const scriptPath = `${toolsDir}/block-city-runtime-audit.cjs`;

    await sandbox.writeFiles([{ path: scriptPath, content: Buffer.from(runner, "utf8") }]);
    await shell(sandbox, `mkdir -p ${JSON.stringify(runDir)}`);

    const run = await shell(
      sandbox,
      `cd ${JSON.stringify(toolsDir)} && node block-city-runtime-audit.cjs ${JSON.stringify(server.previewUrl)} ${JSON.stringify(runDir)}`,
    );

    if (run.exitCode !== 0) {
      return NextResponse.json({ ok: false, error: "browser audit failed", detail: run.stderr || run.stdout, git: git.stdout, build: build.stdout + build.stderr }, { status: 500 });
    }

    const report = JSON.parse(run.stdout.trim());
    const screenshots = [];
    for (const shot of report.shots || []) {
      const buffer = await sandbox.readFileToBuffer({ path: shot.path });
      if (buffer) screenshots.push({ label: shot.label, image: `data:image/png;base64,${buffer.toString("base64")}` });
    }

    return NextResponse.json({
      ok: true,
      git: git.stdout,
      buildExitCode: build.exitCode,
      build: (build.stdout + "\n" + build.stderr).slice(-8000),
      previewUrl: server.previewUrl,
      consoleErrors: report.consoleErrors || [],
      pageErrors: report.pageErrors || [],
      screenshots,
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "audit failed" },
      { status: 500 },
    );
  }
}
