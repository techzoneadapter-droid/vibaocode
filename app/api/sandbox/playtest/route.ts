import { NextRequest, NextResponse } from "next/server";
import {
  ensurePublicRepo,
  getWorkspaceSandbox,
  projectWorkspaceId,
  repoDirectory,
  shell,
  startDevServer,
  validBranch,
  validRepo,
} from "../../../../lib/workspace-sandbox";

export const maxDuration = 300;

function extractOutputText(data: any): string {
  if (typeof data?.output_text === "string") return data.output_text;
  if (!Array.isArray(data?.output)) return "";
  for (const item of data.output) {
    if (!Array.isArray(item?.content)) continue;
    for (const content of item.content) {
      if (content?.type === "output_text" && typeof content?.text === "string") {
        return content.text;
      }
    }
  }
  return "";
}

async function visualReview(
  apiKey: string,
  imageDataUrl: string,
  context: string,
) {
  if (!apiKey) return "";

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-5.6-luna",
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text:
                "You are a mobile app/game QA reviewer. Inspect the screenshot and test context. " +
                "Report visual bugs, clipped UI, unreadable text, broken layout, obvious interaction problems, and the 3 highest-priority fixes. " +
                "Be concise and answer in Vietnamese.\n\nTEST CONTEXT:\n" +
                context.slice(0, 8000),
            },
            {
              type: "input_image",
              image_url: imageDataUrl,
              detail: "auto",
            },
          ],
        },
      ],
      max_output_tokens: 1200,
    }),
  });

  const data = await response.json();
  if (!response.ok) return "";
  return extractOutputText(data);
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const workspaceId = String(body.workspaceId || "").trim();
    const repo = String(body.repo || "").trim();
    const branch = String(body.branch || "main").trim();
    const apiKey =
      String(body.apiKey || "").trim() || process.env.OPENAI_API_KEY || "";

    if (!workspaceId || !validRepo(repo) || !validBranch(branch)) {
      return NextResponse.json(
        { error: "Thiếu workspaceId hoặc repo/branch không hợp lệ." },
        { status: 400 },
      );
    }

    const sandbox = await getWorkspaceSandbox(projectWorkspaceId(workspaceId, repo, branch));
    const dir = await ensurePublicRepo(sandbox, repo, branch);
    const server = await startDevServer(sandbox, dir);

    if (!server.ok) {
      return NextResponse.json(
        {
          error: "Dev server chưa chạy được nên chưa thể play test.",
          serverLogs: server.logs,
        },
        { status: 400 },
      );
    }

    const toolsDir = "/vercel/sandbox/.vibaocode-tools";
    const setup = await shell(
      sandbox,
      `
set -e
mkdir -p ${JSON.stringify(toolsDir)}
cd ${JSON.stringify(toolsDir)}
if [ ! -f package.json ]; then npm init -y >/dev/null 2>&1; fi
if [ ! -d node_modules/playwright ]; then
  npm install playwright >/dev/null 2>&1
fi
if [ ! -f .chromium-ready ]; then
  npx playwright install --with-deps chromium >/tmp/vibaocode-playwright-install.log 2>&1
  touch .chromium-ready
fi
`,
    );

    if (setup.exitCode !== 0) {
      const installLog = await shell(
        sandbox,
        "tail -n 160 /tmp/vibaocode-playwright-install.log 2>/dev/null || true",
      );
      return NextResponse.json(
        {
          error: "Không cài được browser tester trong Sandbox.",
          detail: installLog.stdout || setup.stderr || setup.stdout,
        },
        { status: 500 },
      );
    }

    const scriptPath = `${toolsDir}/playtest.mjs`;
    const script = `
import { chromium } from "playwright";

const target = process.argv[2];
const outDir = process.argv[3];
const fs = await import("node:fs/promises");
await fs.mkdir(outDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 1,
  isMobile: true,
  hasTouch: true,
});
const page = await context.newPage();

const consoleErrors = [];
const pageErrors = [];
page.on("console", (msg) => {
  if (msg.type() === "error") consoleErrors.push(msg.text());
});
page.on("pageerror", (err) => pageErrors.push(String(err)));

const screenshots = [];
const actions = [];
async function snap(label) {
  const path = outDir + "/" + String(screenshots.length).padStart(2, "0") + "-" + label + ".png";
  await page.screenshot({ path, fullPage: false });
  screenshots.push(path);
}

await page.goto(target, { waitUntil: "domcontentloaded", timeout: 45000 });
await page.waitForTimeout(1200);
await snap("start");

const unsafe = /delete|remove|logout|sign out|purchase|buy|pay|checkout|unsubscribe|destroy|drop|reset data/i;
const candidates = page.locator('button, [role="button"], a[href], input[type="button"], input[type="submit"]');
const count = Math.min(await candidates.count(), 10);

for (let i = 0; i < count && actions.length < 5; i++) {
  const el = candidates.nth(i);
  if (!(await el.isVisible().catch(() => false))) continue;
  const text = ((await el.innerText().catch(() => "")) || (await el.getAttribute("aria-label")) || "").trim();
  if (unsafe.test(text)) continue;

  try {
    actions.push({ type: "click", target: text || "interactive element #" + i });
    await el.click({ timeout: 3000 });
    await page.waitForTimeout(700);
    await snap("click-" + actions.length);
  } catch {
    // Skip elements that disappear or cannot be clicked.
  }
}

const canvas = page.locator("canvas").first();
if (await canvas.isVisible().catch(() => false)) {
  const box = await canvas.boundingBox();
  if (box) {
    const points = [
      [0.5, 0.5],
      [0.25, 0.7],
      [0.75, 0.7],
    ];
    for (const [rx, ry] of points) {
      await page.mouse.click(box.x + box.width * rx, box.y + box.height * ry);
      actions.push({ type: "canvas-click", x: rx, y: ry });
      await page.waitForTimeout(650);
      await snap("canvas-" + actions.length);
    }
  }
}

const title = await page.title();
const url = page.url();
const bodyText = (await page.locator("body").innerText().catch(() => "")).slice(0, 4000);

await browser.close();

console.log(JSON.stringify({
  title,
  url,
  actions,
  consoleErrors,
  pageErrors,
  screenshots,
  bodyText,
}));
`;

    await sandbox.writeFiles([
      {
        path: scriptPath,
        content: Buffer.from(script, "utf8"),
      },
    ]);

    const outputDir = `${toolsDir}/runs/${Date.now()}`;
    const result = await shell(
      sandbox,
      `cd ${JSON.stringify(toolsDir)} && node playtest.mjs ${JSON.stringify(server.previewUrl)} ${JSON.stringify(outputDir)}`,
    );

    if (result.exitCode !== 0) {
      return NextResponse.json(
        {
          error: "Browser tester chạy lỗi.",
          detail: result.stderr || result.stdout,
          previewUrl: server.previewUrl,
        },
        { status: 500 },
      );
    }

    let report: any = {};
    try {
      report = JSON.parse(result.stdout.trim());
    } catch {
      report = { raw: result.stdout };
    }

    const screenshots: string[] = [];
    for (const path of Array.isArray(report.screenshots)
      ? report.screenshots.slice(0, 8)
      : []) {
      const buffer = await sandbox.readFileToBuffer({ path });
      if (!buffer) continue;
      screenshots.push(`data:image/png;base64,${buffer.toString("base64")}`);
    }

    const contextText = JSON.stringify({
      title: report.title,
      url: report.url,
      actions: report.actions,
      consoleErrors: report.consoleErrors,
      pageErrors: report.pageErrors,
      bodyText: report.bodyText,
    });

    const review =
      screenshots.length && apiKey
        ? await visualReview(apiKey, screenshots[screenshots.length - 1], contextText)
        : "";

    return NextResponse.json({
      previewUrl: server.previewUrl,
      sandboxName: sandbox.name,
      report: {
        title: report.title || "",
        url: report.url || "",
        actions: report.actions || [],
        consoleErrors: report.consoleErrors || [],
        pageErrors: report.pageErrors || [],
      },
      screenshots,
      visualReview: review,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Play test failed." },
      { status: 500 },
    );
  }
}
