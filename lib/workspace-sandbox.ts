import crypto from "node:crypto";
import { Sandbox } from "@vercel/sandbox";

const DEFAULT_TIMEOUT = 30 * 60 * 1000;
const PORTS = [3000, 6080, 9222];

export function safeWorkspaceId(value: string) {
  const raw = value.trim() || "default";
  const hash = crypto.createHash("sha256").update(raw).digest("hex").slice(0, 12);
  return `vibaocode-${hash}`;
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
) {
  if (!validRepo(repo) || !validBranch(branch)) {
    throw new Error("Repo hoặc branch không hợp lệ.");
  }

  const dir = repoDirectory(repo, branch);
  const exists = await shell(
    sandbox,
    `test -d ${JSON.stringify(dir + "/.git")} && echo yes || echo no`,
  );

  if (!exists.stdout.includes("yes")) {
    await shell(sandbox, `mkdir -p ${JSON.stringify("/vercel/sandbox/repos")}`);
    const clone = await run(sandbox, "git", [
      "clone",
      "--depth",
      "1",
      "--branch",
      branch,
      `https://github.com/${repo}.git`,
      dir,
    ]);
    if (clone.exitCode !== 0) {
      throw new Error(
        "Không clone được repository vào Sandbox. Run Cloud hiện hỗ trợ repo GitHub public; repo private vẫn có thể đọc/sửa qua GitHub token trong editor.",
      );
    }
  } else {
    const dirty = await shell(
      sandbox,
      `cd ${JSON.stringify(dir)} && git status --porcelain | grep -vE '^\\?\\? \\.vibaocode-' || true`,
    );
    if (!dirty.stdout.trim()) {
      await shell(
        sandbox,
        `cd ${JSON.stringify(dir)} && git fetch origin ${JSON.stringify(branch)} --depth=1 && git reset --hard origin/${JSON.stringify(branch)}`,
      );
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
elif command -v lsof >/dev/null 2>&1; then
  OLD_PORT_PIDS="$(lsof -ti tcp:3000 2>/dev/null || true)"
  if [ -n "$OLD_PORT_PIDS" ]; then kill -9 $OLD_PORT_PIDS >/dev/null 2>&1 || true; fi
elif [ -f .vibaocode-dev.pid ]; then
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
  const checks: Array<{
    name: string;
    exitCode: number;
    stdout: string;
    stderr: string;
  }> = [];

  for (const name of ["lint", "test", "build"]) {
    if (!scripts[name]) continue;
    const result = await shell(
      sandbox,
      `cd ${JSON.stringify(dir)} && npm run ${name}`,
    );
    checks.push({ name, ...result });
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
