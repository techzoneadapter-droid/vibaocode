import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  ensureBrowserTester,
  ensureCodexCli,
  ensurePublicRepo,
  getWorkspaceSandbox,
  installDependencies,
  repoDirectory,
  shell,
  startDevServer,
  validBranch,
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
      // Ignore non-JSON lines.
    }
  }
  return message;
}

function captureSource() {
  return String.raw`
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

  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
    isMobile: true,
    hasTouch: true,
  });

  const page = await context.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  const shots = [];

  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => pageErrors.push(String(err)));

  async function pause(ms = 950) {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function snap(label) {
    const path = outDir + "/" + label + ".png";
    await page.screenshot({ path, fullPage: false });
    shots.push({ label, path, url: page.url() });
  }

  async function openHome() {
    await page.goto(target, { waitUntil: "domcontentloaded", timeout: 45000 });
    await pause(1400);
  }

  async function clickCanvas(rx, ry) {
    const canvas = page.locator("canvas").first();
    if (!(await canvas.isVisible().catch(() => false))) return false;
    const box = await canvas.boundingBox();
    if (!box) return false;
    await page.mouse.click(box.x + box.width * rx, box.y + box.height * ry);
    await pause(1200);
    return true;
  }

  try {
    await openHome();
    await snap("01-home");

    const targets = [
      ["02-play", 0.13, 0.92],
      ["03-city", 0.38, 0.92],
      ["04-daily", 0.63, 0.92],
      ["05-event", 0.87, 0.92],
    ];

    for (const [label, rx, ry] of targets) {
      await openHome();
      await clickCanvas(rx, ry);
      await snap(label);
    }

    await openHome();
    const canvas = page.locator("canvas").first();
    if (await canvas.isVisible().catch(() => false)) {
      const box = await canvas.boundingBox();
      if (box) {
        await page.mouse.click(box.x + box.width * 0.13, box.y + box.height * 0.92);
        await pause(900);
        const nextCanvas = page.locator("canvas").first();
        const nextBox = await nextCanvas.boundingBox();
        if (nextBox) {
          const drags = [
            [[0.18, 0.82], [0.28, 0.45]],
            [[0.50, 0.82], [0.52, 0.38]],
          ];
          for (const [[sx, sy], [tx, ty]] of drags) {
            await page.mouse.move(nextBox.x + nextBox.width * sx, nextBox.y + nextBox.height * sy);
            await page.mouse.down();
            await page.mouse.move(nextBox.x + nextBox.width * tx, nextBox.y + nextBox.height * ty, { steps: 12 });
            await page.mouse.up();
            await pause(650);
          }
          await snap("06-puzzle-after-actions");
        }
      }
    }

    const bodyText = (await page.locator("body").innerText().catch(() => "")).slice(0, 6000);
    await browser.close();

    console.log(JSON.stringify({
      shots,
      consoleErrors,
      pageErrors,
      bodyText,
    }));
  } catch (error) {
    try { await browser.close(); } catch {}
    console.error(error && (error.stack || error));
    process.exit(1);
  }
})();
`;
}

function parseVerdict(report: string) {
  const match = report.match(/VERDICT\s*:\s*(PASS|FIX)/i);
  return (match?.[1] || "FIX").toUpperCase() as "PASS" | "FIX";
}

function extractFixPrompt(report: string) {
  const marker = report.match(/FIX_PROMPT\s*:\s*/i);
  if (!marker || marker.index === undefined) {
    return [
      "Use the following Visual Director audit and fix the UI/UX issues it identified.",
      "Keep gameplay and save/progression behavior unchanged.",
      "",
      report,
    ].join("\n");
  }
  return report.slice(marker.index + marker[0].length).trim();
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const workspaceId = String(body.workspaceId || "").trim();
    const repo = String(body.repo || "").trim();
    const branch = String(body.branch || "main").trim();
    const githubToken = String(body.githubToken || "").trim();
    const requestedModel = String(body.codexModel || "").trim();
    const requestedReasoning = String(body.codexReasoning || "medium").trim().toLowerCase();
    const referenceImages = (Array.isArray(body.referenceImages) ? body.referenceImages : [])
      .map((item: any) => ({
        path: String(item?.path || "").trim(),
        name: String(item?.name || "reference").trim().slice(0, 140),
        kind: String(item?.kind || "style").trim().slice(0, 32),
        note: String(item?.note || "").trim().slice(0, 500),
      }))
      .filter((item: any) =>
        /^\.vibaocode-references\/[A-Za-z0-9._-]+\.(?:png|jpe?g|webp)$/i.test(item.path)
      )
      .slice(0, 5);

    if (!workspaceId || !validRepo(repo) || !validBranch(branch)) {
      return NextResponse.json(
        { error: "Thiếu workspaceId hoặc repo/branch không hợp lệ." },
        { status: 400 },
      );
    }

    if (
      requestedReasoning &&
      !["minimal", "low", "medium", "high", "xhigh", "max"].includes(requestedReasoning)
    ) {
      return NextResponse.json({ error: "Reasoning không hợp lệ." }, { status: 400 });
    }

    const sandbox = await getWorkspaceSandbox(workspaceId);
    const dir = await ensurePublicRepo(sandbox, repo, branch, githubToken);
    await installDependencies(sandbox, dir);
    const server = await startDevServer(sandbox, dir);

    if (!server.ok) {
      return NextResponse.json(
        { error: "Dev server chưa chạy được.", serverLogs: server.logs },
        { status: 400 },
      );
    }

    const toolsDir = await ensureBrowserTester(sandbox);
    const runId = crypto.randomUUID().replace(/-/g, "").slice(0, 18);
    const runDir = `${toolsDir}/visual-audit/${runId}`;
    const capturePath = `${toolsDir}/visual-audit.cjs`;

    await sandbox.writeFiles([
      { path: capturePath, content: Buffer.from(captureSource(), "utf8") },
    ]);
    await shell(sandbox, `mkdir -p ${JSON.stringify(runDir)}`);

    const capture = await shell(
      sandbox,
      `cd ${JSON.stringify(toolsDir)} && node visual-audit.cjs ${JSON.stringify(server.previewUrl)} ${JSON.stringify(runDir)}`,
    );

    if (capture.exitCode !== 0) {
      return NextResponse.json(
        {
          error: "Không chụp được các màn để Visual Director kiểm tra.",
          detail: capture.stderr || capture.stdout,
        },
        { status: 500 },
      );
    }

    let captureReport: any = {};
    try {
      captureReport = JSON.parse(capture.stdout.trim());
    } catch {
      captureReport = { shots: [], consoleErrors: [], pageErrors: [], bodyText: "" };
    }

    const shotPaths = (Array.isArray(captureReport.shots) ? captureReport.shots : [])
      .map((item: any) => String(item?.path || ""))
      .filter(Boolean)
      .slice(0, 8);

    if (!shotPaths.length) {
      return NextResponse.json(
        { error: "Visual Director không có screenshot để đánh giá." },
        { status: 500 },
      );
    }

    const visualDir = `${dir}/.vibaocode-visual/${runId}`;
    await shell(sandbox, `mkdir -p ${JSON.stringify(visualDir)}`);
    const runtimeReferences: Array<{
      path: string;
      name: string;
      kind: string;
      note: string;
    }> = [];

    for (const item of (Array.isArray(captureReport.shots) ? captureReport.shots : []).slice(0, 8)) {
      const source = String(item?.path || "");
      if (!source) continue;
      const label = String(item?.label || "screen").replace(/[^A-Za-z0-9_-]/g, "-");
      const file = `${label}.png`;
      const target = `${visualDir}/${file}`;
      const copy = await shell(
        sandbox,
        `cp ${JSON.stringify(source)} ${JSON.stringify(target)}`,
      );
      if (copy.exitCode !== 0) continue;
      runtimeReferences.push({
        path: `.vibaocode-visual/${runId}/${file}`,
        name: `Current render • ${label}`,
        kind: "current-render",
        note: "Screenshot captured by Visual Director before repair. Fix visible problems in this rendered screen.",
      });
    }

    const codex = await ensureCodexCli(sandbox);
    await shell(sandbox, `mkdir -p ${JSON.stringify(codex.codexHome)}`);
    const codexCommand =
      `CODEX_HOME=${JSON.stringify(codex.codexHome)} ${JSON.stringify(codex.bin)}`;

    const auth = await shell(sandbox, `${codexCommand} login status 2>&1 || true`);
    const connected =
      /logged in|authenticated|chatgpt|plan/i.test(auth.stdout) &&
      !/not logged|not authenticated/i.test(auth.stdout);

    if (!connected) {
      return NextResponse.json(
        { error: "ChatGPT/Codex chưa kết nối nên Visual Director chưa chạy được." },
        { status: 401 },
      );
    }

    const auditReasoning = ["high", "xhigh", "max"].includes(requestedReasoning)
      ? "medium"
      : requestedReasoning || "medium";
    const modelArgs = [
      requestedModel ? `--model ${JSON.stringify(requestedModel)}` : "",
      auditReasoning
        ? `--config ${JSON.stringify(`model_reasoning_effort="${auditReasoning}"`)}`
        : "",
    ].filter(Boolean).join(" ");

    const auditCopy = `${toolsDir}/visual-audit/repo-${runId}`;
    const copyResult = await shell(
      sandbox,
      [
        `rm -rf ${JSON.stringify(auditCopy)}`,
        `mkdir -p ${JSON.stringify(auditCopy)}`,
        `cd ${JSON.stringify(dir)}`,
        `tar --exclude=.git --exclude=node_modules --exclude=.vibaocode-references --exclude='dist' --exclude='.next' -cf - . | (cd ${JSON.stringify(auditCopy)} && tar -xf -)`,
      ].join(" && "),
    );
    if (copyResult.exitCode !== 0) {
      return NextResponse.json(
        {
          error: "Không tạo được bản copy read-only cho Visual Director.",
          detail: copyResult.stderr || copyResult.stdout,
        },
        { status: 500 },
      );
    }

    const imageArgs = [
      ...referenceImages.map((item: any) => `${dir}/${item.path}`),
      ...shotPaths,
    ]
      .map((path) => `--image ${JSON.stringify(path)}`)
      .join(" ");

    const referenceContext = referenceImages.length
      ? referenceImages
          .map(
            (item: any, index: number) =>
              `${index + 1}. ${item.name} • type=${item.kind}${item.note ? ` • ${item.note}` : ""}`,
          )
          .join("\n")
      : "(No explicit reference images attached.)";

    const screenshotContext = (Array.isArray(captureReport.shots) ? captureReport.shots : [])
      .map((item: any, index: number) => `${index + 1}. ${item.label || "screen"}`)
      .join("\n");

    const auditPrompt = [
      "You are the Visual Director and QA reviewer for a mobile game/app.",
      "Analyze only. Do NOT edit any files in this audit pass.",
      "Compare the rendered screenshots against the attached reference images and inspect the copied repository only when needed to identify likely causes.",
      "",
      "IMAGE ORDER:",
      `The first ${referenceImages.length} attached image(s) are the reference images listed below. The following ${shotPaths.length} image(s) are the current rendered screenshots in the rendered-screen order below.`,
      "",
      "REFERENCE IMAGE ROLES:",
      referenceContext,
      "",
      "RENDERED SCREENS:",
      screenshotContext,
      "",
      "RUNTIME SIGNALS:",
      `consoleErrors=${JSON.stringify(captureReport.consoleErrors || [])}`,
      `pageErrors=${JSON.stringify(captureReport.pageErrors || [])}`,
      "",
      "Audit these dimensions:",
      "- visual consistency across scenes",
      "- typography hierarchy/readability",
      "- overflow, overlap, clipping and safe-area problems",
      "- button/card/panel quality",
      "- mobile spacing and information hierarchy",
      "- whether actual rendered assets match the reference art direction",
      "- puzzle board/block polish",
      "- city/environment depth",
      "- character/icon consistency",
      "- interaction/runtime errors visible from the captured flow",
      "",
      "Return in Vietnamese using this exact high-level structure:",
      "VERDICT: PASS or FIX",
      "SUMMARY:",
      "CRITICAL_ISSUES:",
      "MAJOR_ISSUES:",
      "MINOR_ISSUES:",
      "LOGIC_RUNTIME_ISSUES:",
      "SCENE_BY_SCENE:",
      "PRIORITY_ORDER:",
      "FIX_PROMPT:",
      "",
      "FIX_PROMPT must be a self-contained implementation prompt for a coding agent. It must preserve gameplay/save/progression and tell the coding agent exactly what to repair.",
      "Use VERDICT: PASS only if the screenshots are genuinely release-quality relative to the references and there are no meaningful runtime/layout issues.",
    ].join("\n");

    const promptPath = `${runDir}/audit-prompt.txt`;
    const eventsPath = `${runDir}/audit-events.jsonl`;
    const stderrPath = `${runDir}/audit-stderr.log`;
    await sandbox.writeFiles([
      { path: promptPath, content: Buffer.from(auditPrompt, "utf8") },
    ]);

    const audit = await shell(
      sandbox,
      `cat ${JSON.stringify(promptPath)} | ${codexCommand} exec --ignore-user-config --dangerously-bypass-approvals-and-sandbox --cd ${JSON.stringify(auditCopy)} ${modelArgs} ${imageArgs} --json - > ${JSON.stringify(eventsPath)} 2> ${JSON.stringify(stderrPath)}; CODE=$?; cat ${JSON.stringify(eventsPath)} 2>/dev/null || true; exit $CODE`,
    );

    const stderr = await shell(
      sandbox,
      `tail -n 160 ${JSON.stringify(stderrPath)} 2>/dev/null || true`,
    );
    const report = lastAgentMessage(audit.stdout).trim();

    if (!report) {
      return NextResponse.json(
        {
          error: "Visual Director không trả về báo cáo.",
          detail: stderr.stdout || audit.stderr || audit.stdout,
        },
        { status: 500 },
      );
    }

    const screenshots: Array<{ label: string; image: string }> = [];
    for (const item of (Array.isArray(captureReport.shots) ? captureReport.shots : []).slice(0, 8)) {
      try {
        const buffer = await sandbox.readFileToBuffer({ path: String(item.path) });
        if (buffer) {
          screenshots.push({
            label: String(item.label || "screen"),
            image: `data:image/png;base64,${buffer.toString("base64")}`,
          });
        }
      } catch {
        // Keep the rest of the audit if one screenshot cannot be read back.
      }
    }

    const verdict = parseVerdict(report);
    return NextResponse.json({
      verdict,
      needsFix: verdict !== "PASS",
      report,
      fixPrompt: extractFixPrompt(report),
      screenshots,
      previewUrl: server.previewUrl,
      sandboxName: sandbox.name,
      runtime: {
        consoleErrors: captureReport.consoleErrors || [],
        pageErrors: captureReport.pageErrors || [],
      },
      runtimeReferences,
      model: requestedModel || "Codex default",
      reasoning: auditReasoning,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Visual audit failed." },
      { status: 500 },
    );
  }
}
