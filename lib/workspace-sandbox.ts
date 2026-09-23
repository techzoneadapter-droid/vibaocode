import crypto from "node:crypto";
import { Sandbox } from "@vercel/sandbox";

const DEFAULT_TIMEOUT = 40 * 60 * 1000;
const PORTS = [3000, 6080, 9222];

export function safeWorkspaceId(value: string) {
  const raw = value.trim() || "default";
  const hash = crypto.createHash("sha256").update(raw).digest("hex").slice(0, 12);
  return `vibaocode-${hash}`;
}

export function projectWorkspaceId(workspaceId: string, repo: string, branch: string) {
  return `${workspaceId.trim()}::${repo.trim()}::${branch.trim()}`;
}

export function repoDirectory(repo: string, branch: string) {
  const hash = crypto
    .createHash("sha256")
    .update(`${repo}#${branch}`)
    .digest("hex")
    .slice(0, 10);
  return `/vercel/sandbox/repos/${hash}`;
}

export async function getWorkspaceSandbox(workspaceId: string) {
  const name = safeWorkspaceId(workspaceId);
  try {
    return await Sandbox.get({ name });
  } catch {
    return await Sandbox.create({
      name,
      persistent: true,
      timeout: DEFAULT_TIMEOUT,
      ports: PORTS,
    });
  }
}

export async function reserveLongAgentSession(sandbox: Sandbox) {
  // Persistent Sandboxes preserve files, not running processes. If the active
  // session hits its timeout, a detached Codex process is terminated and the
  // next status poll resumes a fresh VM with no process/exit code.
  //
  // Extend opportunistically without assuming the user's Vercel plan limit.
  // Hobby historically allows shorter sessions than Pro/Enterprise, so try a
  // large extension first and gracefully fall back to smaller increments.
  const attempts = [30, 15, 5];

  for (const minutes of attempts) {
    try {
      await sandbox.extendTimeout(minutes * 60 * 1000);
      return {
        extended: true,
        minutes,
      };
    } catch {
      // Try a smaller increment if this plan/session is already near its max.
    }
  }

  return {
    extended: false,
    minutes: 0,
  };
}

export async function run(
  sandbox: Sandbox,
  cmd: string,
  args: string[] = [],
) {
  const result = await sandbox.runCommand({ cmd, args });
  return {
    exitCode: result.exitCode,
    stdout: await result.stdout(),
    stderr: await result.stderr(),
  };
}

export async function shell(
  sandbox: Sandbox,
  command: string,
) {
  return run(sandbox, "bash", ["-lc", command]);
}

export async function ensureCodexCli(sandbox: Sandbox) {
  const toolsDir = "/vercel/sandbox/.vibaocode-tools/codex";
  const bin = `${toolsDir}/node_modules/.bin/codex`;
  const runtimeMarker = `${toolsDir}/.runtime-v4`;

  const setup = await shell(
    sandbox,
    `
set -e
mkdir -p ${JSON.stringify(toolsDir)}
cd ${JSON.stringify(toolsDir)}
if [ ! -f package.json ]; then npm init -y >/dev/null 2>&1; fi

# Vibaocode intentionally uses its own managed Codex binary instead of the
# Vercel base-image binary. Persistent Sandboxes can otherwise keep an older
# Codex build for weeks and re-introduce Linux/bwrap regressions.
if [ ! -x node_modules/.bin/codex ] || [ ! -f ${JSON.stringify(runtimeMarker)} ]; then
  npm install --no-audit --no-fund @openai/codex@latest >/tmp/vibaocode-codex-install.log 2>&1
  touch ${JSON.stringify(runtimeMarker)}
fi

printf '%s\n' ${JSON.stringify(bin)}
node_modules/.bin/codex --version
`,
  );

  if (setup.exitCode !== 0) {
    const log = await shell(
      sandbox,
      "tail -n 160 /tmp/vibaocode-codex-install.log 2>/dev/null || true",
    );
    throw new Error(
      `Không cài/cập nhật được Codex CLI do Vibaocode quản lý.\n${log.stdout || setup.stderr || setup.stdout}`,
    );
  }

  const lines = setup.stdout
    .trim()
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  return {
    bin: lines[0] || bin,
    version: lines[lines.length - 1] || "codex",
    codexHome: "/vercel/sandbox/.codex",
    source: "vibaocode-managed-npm" as const,
  };
}

export async function ensureBrowserTester(sandbox: Sandbox) {
  const toolsDir = "/vercel/sandbox/.vibaocode-tools";
  const setup = await shell(
    sandbox,
    `
set -e
mkdir -p ${JSON.stringify(toolsDir)}
cd ${JSON.stringify(toolsDir)}
if [ ! -f package.json ]; then npm init -y >/dev/null 2>&1; fi
if [ ! -d node_modules/playwright ]; then
  npm install --no-audit --no-fund playwright@latest >/tmp/vibaocode-playwright-npm.log 2>&1
fi
if [ ! -f .chromium-ready ]; then
  if npx playwright install chromium >/tmp/vibaocode-playwright-install.log 2>&1; then
    touch .chromium-ready
  else
    npx playwright install --with-deps chromium >>/tmp/vibaocode-playwright-install.log 2>&1
    touch .chromium-ready
  fi
fi
node -e 'const { chromium } = require("playwright"); console.log(chromium.executablePath())'
`,
  );

  if (setup.exitCode !== 0) {
    const npmLog = await shell(
      sandbox,
      "tail -n 100 /tmp/vibaocode-playwright-npm.log 2>/dev/null || true",
    );
    const installLog = await shell(
      sandbox,
      "tail -n 160 /tmp/vibaocode-playwright-install.log 2>/dev/null || true",
    );
    throw new Error(
      `Không chuẩn bị được Chromium tester.\n${installLog.stdout || npmLog.stdout || setup.stderr || setup.stdout}`,
    );
  }

  return toolsDir;
}

export function validRepo(repo: string) {
  return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo);
}

export function validBranch(branch: string) {
  return /^[A-Za-z0-9._\/-]+$/.test(branch) && !branch.includes("..");
}

export function validRelativePath(path: string) {
  if (!path || path.startsWith("/") || path.includes("\0")) return false;
  const parts = path.split("/");
  return !parts.some((part) => part === "..");
}

export async function ensurePublicRepo(
  sandbox: Sandbox,
  repo: string,
  branch: string,
  githubToken = "",
) {
  if (!validRepo(repo) || !validBranch(branch)) {
    throw new Error("Repo hoặc branch không hợp lệ.");
  }

  const dir = repoDirectory(repo, branch);
  const reposRoot = "/vercel/sandbox/repos";
  const remoteUrl = `https://github.com/${repo}.git`;

  const exists = await shell(
    sandbox,
    `test -d ${JSON.stringify(dir + "/.git")} && echo yes || echo no`,
  );

  const authHeader = githubToken
    ? `Authorization: Basic ${Buffer.from(`x-access-token:${githubToken}`).toString("base64")}`
    : "";

  async function anonymousClone() {
    return shell(
      sandbox,
      [
        "GIT_TERMINAL_PROMPT=0",
        "git",
        "clone",
        "--depth 1",
        "--single-branch",
        "--branch",
        JSON.stringify(branch),
        JSON.stringify(remoteUrl),
        JSON.stringify(dir),
      ].join(" "),
    );
  }

  async function authenticatedClone() {
    if (!authHeader) return null;
    return shell(
      sandbox,
      [
        "GIT_TERMINAL_PROMPT=0",
        "git",
        "-c",
        `http.extraHeader=${JSON.stringify(authHeader)}`,
        "clone",
        "--depth 1",
        "--single-branch",
        "--branch",
        JSON.stringify(branch),
        JSON.stringify(remoteUrl),
        JSON.stringify(dir),
      ].join(" "),
    );
  }

  async function anonymousFetch() {
    return shell(
      sandbox,
      [
        `cd ${JSON.stringify(dir)}`,
        `git remote set-url origin ${JSON.stringify(remoteUrl)}`,
        `GIT_TERMINAL_PROMPT=0 git fetch origin ${JSON.stringify(branch)} --depth=1`,
        `git reset --hard origin/${JSON.stringify(branch)}`,
      ].join(" && "),
    );
  }

  async function authenticatedFetch() {
    if (!authHeader) return null;
    return shell(
      sandbox,
      [
        `cd ${JSON.stringify(dir)}`,
        `git remote set-url origin ${JSON.stringify(remoteUrl)}`,
        `GIT_TERMINAL_PROMPT=0 git -c http.extraHeader=${JSON.stringify(authHeader)} fetch origin ${JSON.stringify(branch)} --depth=1`,
        `git reset --hard origin/${JSON.stringify(branch)}`,
      ].join(" && "),
    );
  }

  if (!exists.stdout.includes("yes")) {
    // A failed/interrupted clone can leave a partial directory. Always remove
    // it before retrying so the next clone starts from a clean workspace.
    await shell(
      sandbox,
      `mkdir -p ${JSON.stringify(reposRoot)} && rm -rf ${JSON.stringify(dir)}`,
    );

    // Public repositories must clone anonymously first. Passing an invalid or
    // repo-scoped PAT to GitHub smart HTTP can turn an otherwise-public clone
    // into a 401 and Git then tries to prompt for a username in a headless
    // Sandbox ("could not read Username...").
    let clone = await anonymousClone();

    // Only private/auth-required repos fall back to the connected GitHub token.
    if (clone.exitCode !== 0 && authHeader) {
      await shell(sandbox, `rm -rf ${JSON.stringify(dir)}`);
      clone = (await authenticatedClone()) || clone;
    }

    // One final clean anonymous retry helps with transient sandbox wake/network
    // failures without ever exposing the token in a remote URL.
    if (clone.exitCode !== 0) {
      await shell(sandbox, `rm -rf ${JSON.stringify(dir)}`);
      await new Promise((resolve) => setTimeout(resolve, 900));
      clone = await anonymousClone();
    }

    if (clone.exitCode !== 0) {
      const detail = (clone.stderr || clone.stdout || "git clone failed").trim();
      throw new Error(
        `Không clone được ${repo}@${branch} vào Cloud Sandbox.\n${detail.slice(-1800)}`,
      );
    }
  } else {
    const trackedDirty = await shell(
      sandbox,
      `cd ${JSON.stringify(dir)} && git diff --quiet HEAD -- || echo dirty`,
    );

    if (!trackedDirty.stdout.trim()) {
      let sync = await anonymousFetch();

      if (sync.exitCode !== 0 && authHeader) {
        sync = (await authenticatedFetch()) || sync;
      }

      if (sync.exitCode !== 0) {
        throw new Error(
          `Không đồng bộ được repository trong Cloud Sandbox.\n${(sync.stderr || sync.stdout).slice(-1800)}`,
        );
      }
    }
  }

  return dir;
}

export async function installDependencies(
  sandbox: Sandbox,
  dir: string,
) {
  const command = `
set -e
cd ${JSON.stringify(dir)}
if [ ! -f package.json ]; then
  exit 0
fi
CURRENT_HASH="$(sha256sum package.json | cut -d' ' -f1)"
OLD_HASH=""
if [ -f .vibaocode-package-hash ]; then OLD_HASH="$(cat .vibaocode-package-hash)"; fi
if [ ! -d node_modules ] || [ "$CURRENT_HASH" != "$OLD_HASH" ]; then
  if [ -f pnpm-lock.yaml ]; then
    corepack enable >/dev/null 2>&1 || true
    pnpm install --frozen-lockfile || pnpm install
  elif [ -f yarn.lock ]; then
    corepack enable >/dev/null 2>&1 || true
    yarn install --frozen-lockfile || yarn install
  else
    npm install
  fi
  printf "%s" "$CURRENT_HASH" > .vibaocode-package-hash
fi
`;
  const result = await shell(sandbox, command);
  if (result.exitCode !== 0) {
    throw new Error(
      `Cài dependencies thất bại.\n${result.stderr || result.stdout}`,
    );
  }
  return result;
}

async function packageInfo(sandbox: Sandbox, dir: string) {
  const result = await shell(
    sandbox,
    `cd ${JSON.stringify(dir)} && node -e 'try{const p=require("./package.json");console.log(JSON.stringify({scripts:p.scripts||{},deps:{...(p.dependencies||{}),...(p.devDependencies||{})}}))}catch(e){console.log("{}")}'`,
  );
  try {
    return JSON.parse(result.stdout.trim() || "{}") as {
      scripts?: Record<string, string>;
      deps?: Record<string, string>;
    };
  } catch {
    return {};
  }
}

export async function startDevServer(
  sandbox: Sandbox,
  dir: string,
) {
  const info = await packageInfo(sandbox, dir);
  const scripts = info.scripts || {};
  const deps = info.deps || {};
  const previewUrl = sandbox.domain(3000);
  const previewHost = new URL(previewUrl).hostname.replace(/[^A-Za-z0-9.-]/g, "");
  let startCommand = "";

  if (scripts.dev) {
    if (deps.next) {
      startCommand = "npm run dev -- --hostname 0.0.0.0 -p 3000";
    } else if (deps.vite) {
      startCommand =
        `__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS=${previewHost} npm run dev -- --host 0.0.0.0 --port 3000`;
    } else {
      startCommand = "PORT=3000 HOST=0.0.0.0 HOSTNAME=0.0.0.0 npm run dev";
    }
  } else if (scripts.start) {
    if (scripts.build) {
      const build = await shell(
        sandbox,
        `cd ${JSON.stringify(dir)} && npm run build`,
      );
      if (build.exitCode !== 0) {
        throw new Error(`Build trước khi start thất bại.\n${build.stderr || build.stdout}`);
      }
    }
    startCommand =
      "PORT=3000 HOST=0.0.0.0 HOSTNAME=0.0.0.0 npm run start";
  } else {
    startCommand = "python3 -m http.server 3000 --bind 0.0.0.0";
  }

  const command = `
cd ${JSON.stringify(dir)}
if command -v fuser >/dev/null 2>&1; then
  fuser -k 3000/tcp >/dev/null 2>&1 || true
fi
if command -v lsof >/dev/null 2>&1; then
  OLD_PORT_PIDS="$(lsof -ti tcp:3000 2>/dev/null || true)"
  if [ -n "$OLD_PORT_PIDS" ]; then kill -9 $OLD_PORT_PIDS >/dev/null 2>&1 || true; fi
fi
OLD_DEV_PIDS="$(ps -eo pid=,args= 2>/dev/null | awk '
  /vite([[:space:]]|$)|next dev|next start|npm run dev|npm run start|python3 -m http\.server 3000/ && !/awk/ { print $1 }
' | tr '\n' ' ')"
if [ -n "$OLD_DEV_PIDS" ]; then kill -9 $OLD_DEV_PIDS >/dev/null 2>&1 || true; fi
if [ -f .vibaocode-dev.pid ]; then
  OLD_PID="$(cat .vibaocode-dev.pid 2>/dev/null || true)"
  if [ -n "$OLD_PID" ]; then kill -9 "$OLD_PID" >/dev/null 2>&1 || true; fi
fi
sleep 1
nohup bash -lc ${JSON.stringify(startCommand)} > .vibaocode-dev.log 2>&1 < /dev/null &
echo $! > .vibaocode-dev.pid
for i in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:3000 >/dev/null 2>&1; then
    echo READY
    exit 0
  fi
  sleep 1
done
tail -n 120 .vibaocode-dev.log || true
exit 1
`;

  const result = await shell(sandbox, command);
  const logResult = await shell(
    sandbox,
    `cd ${JSON.stringify(dir)} && tail -n 160 .vibaocode-dev.log 2>/dev/null || true`,
  );

  return {
    ok: result.exitCode === 0,
    logs: logResult.stdout || result.stdout || result.stderr,
    previewUrl,
  };
}

export async function runProjectChecks(
  sandbox: Sandbox,
  dir: string,
) {
  const info = await packageInfo(sandbox, dir);
  const scripts = info.scripts || {};
  const deps = info.deps || {};
  const checks: Array<{
    name: string;
    exitCode: number;
    stdout: string;
    stderr: string;
  }> = [];

  for (const name of ["lint", "test", "typecheck", "build"]) {
    if (!scripts[name]) continue;
    const result = await shell(
      sandbox,
      `cd ${JSON.stringify(dir)} && npm run ${name}`,
    );
    checks.push({ name, ...result });
  }

  if (!scripts.typecheck && deps.typescript) {
    const hasTsConfig = await shell(
      sandbox,
      `test -f ${JSON.stringify(dir + "/tsconfig.json")} && echo yes || true`,
    );
    if (hasTsConfig.stdout.includes("yes")) {
      const result = await shell(
        sandbox,
        `cd ${JSON.stringify(dir)} && npx tsc --noEmit`,
      );
      checks.push({ name: "typecheck", ...result });
    }
  }

  if (!checks.length) {
    const syntax = await shell(
      sandbox,
      `cd ${JSON.stringify(dir)} && git status --short && echo "No package test scripts; smoke test only."`,
    );
    checks.push({ name: "workspace", ...syntax });
  }

  const smoke = await shell(
    sandbox,
    `curl -sS -o /dev/null -w "%{http_code}" http://127.0.0.1:3000 || true`,
  );

  return {
    checks,
    smokeStatus: smoke.stdout.trim() || "unavailable",
    passed:
      checks.every((check) => check.exitCode === 0) &&
      !["000", "unavailable", ""].includes(smoke.stdout.trim()),
  };
}
