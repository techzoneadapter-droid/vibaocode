import { NextResponse } from "next/server";
import { Sandbox } from "@vercel/sandbox";

export const maxDuration = 300;

const SANDBOX_NAME = "vibaocode-fa6c3bed702f";
const REPO_DIR = "/vercel/sandbox/repos/8083cee9e2";
const TARGET_COMMIT = "706500a7159e4aa67be58d49cf292d4d798c7581";

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

export async function GET() {
  try {
    const sandbox = await Sandbox.get({ name: SANDBOX_NAME });
    const verify = await shell(
      sandbox,
      `cd ${JSON.stringify(REPO_DIR)} && git cat-file -e ${TARGET_COMMIT}^{commit} && git rev-parse ${TARGET_COMMIT}`,
    );
    if (verify.exitCode !== 0) {
      return NextResponse.json({ ok: false, error: verify.stderr || "Target commit not found." }, { status: 404 });
    }

    const files = [];
    for (const relativePath of APPROVED_FILES) {
      const read = await shell(
        sandbox,
        `cd ${JSON.stringify(REPO_DIR)} && git show ${TARGET_COMMIT}:${JSON.stringify(relativePath)}`,
      );
      if (read.exitCode !== 0) continue;
      files.push({ path: relativePath, content: read.stdout });
    }

    return NextResponse.json({
      ok: true,
      sandboxName: SANDBOX_NAME,
      targetCommit: TARGET_COMMIT,
      files,
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Recovery read failed." },
      { status: 500 },
    );
  }
}
