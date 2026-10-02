import crypto from "node:crypto";
import { Sandbox } from "@vercel/sandbox";

// Keep ordinary preview/control sessions short on Hobby. The filesystem is
// persistent, so a stopped Sandbox resumes from its latest snapshot on demand.
// Long AI jobs extend the session explicitly via reserveLongAgentSession().
const DEFAULT_TIMEOUT = 10 * 60 * 1000;
const SNAPSHOT_EXPIRATION = 24 * 60 * 60 * 1000;
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
      snapshotExpiration: SNAPSHOT_EXPIRATION,
      keepLastSnapshots: {
        count: 1,
        expiration: SNAPSHOT_EXPIRATION,
        deleteEvicted: true,
      },
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

export async function stopSandboxIfIdle(sandbox: Sandbox) {
  // Short Codex metadata calls (status/models/usage) used to leave the VM
  // provisioned for the full session timeout. Stop it immediately when there is
  // no live preview and no long-running Vibaocode/Codex process. Persistent
  // Sandboxes keep the filesystem/auth/dependencies and resume on the next call.
  try {
    const busy = await shell(
      sandbox,
      [
        "set +e",
        "if curl -fsS --max-time 1 http://127.0.0.1:3000 >/dev/null 2>&1; then echo BUSY; exit 0; fi",
        "if ps -eo args= 2>/dev/null | grep -E 'vibaocode-codex-device\\.cjs|vibaocode-codex-runner|codex( |$).*exec|playwright' | grep -v grep >/dev/null 2>&1; then echo BUSY; exit 0; fi",
        "echo IDLE",
      ].join("\n"),
    );

    if (!busy.stdout.includes("IDLE")) {
      return { stopped: false, reason: "busy" as const };
    }

    await sandbox.stop();
    return { stopped: true, reason: "idle" as const };
  } catch {
    return { stopped: false, reason: "error" as const };
  }
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
  options: { forceRemote?: boolean } = {},
) {
  if (!validRepo(repo) || !validBranch(branch)) {
    throw new Error("Repo hoặc branch không hợp lệ.");
  }

  const dir = repoDirectory(repo, branch);
  const reposRoot = "/vercel/sandbox/repos";
  const remoteUrl = `https://github.com/${repo}.git`;
  const fetchMarker = `${dir}/.vibaocode-last-fetch`;

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

  async function clearStaleGitLocks() {
    const result = await shell(
      sandbox,
      [
        `cd ${JSON.stringify(dir)} 2>/dev/null || exit 0`,
        // Only remove locks when no real Git process is alive in this Sandbox.
        `if pgrep -x git >/dev/null 2>&1 || pgrep -x git-remote-http >/dev/null 2>&1 || pgrep -x git-remote-https >/dev/null 2>&1; then echo GIT_BUSY; exit 0; fi`,
        `rm -f .git/shallow.lock .git/index.lock .git/HEAD.lock .git/config.lock .git/packed-refs.lock`,
        `find .git/refs -name '*.lock' -type f -delete 2>/dev/null || true`,
        `echo LOCKS_CLEARED`,
      ].join(" && "),
    );
    return result.stdout.includes("LOCKS_CLEARED");
  }

  async function anonymousFetch() {
    return shell(
      sandbox,
      [
        `cd ${JSON.stringify(dir)}`,
        `git remote set-url origin ${JSON.stringify(remoteUrl)}`,
        `GIT_TERMINAL_PROMPT=0 git fetch origin ${JSON.stringify(branch)} --depth=100`,
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
        `GIT_TERMINAL_PROMPT=0 git -c http.extraHeader=${JSON.stringify(authHeader)} fetch origin ${JSON.stringify(branch)} --depth=100`,
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
    await shell(sandbox, `touch ${JSON.stringify(fetchMarker)}`);
  } else {
    // Avoid repeated network/CPU work when Run → Test → AI happen close together.
    // A forced GitHub refresh always fetches immediately; otherwise refresh the
    // remote tracking ref at most once every two minutes.
    const freshness = await shell(
      sandbox,
      `if [ -f ${JSON.stringify(fetchMarker)} ] && find ${JSON.stringify(fetchMarker)} -mmin -2 -print -quit | grep -q .; then echo FRESH; else echo STALE; fi`,
    );
    const shouldFetch = Boolean(options.forceRemote) || !freshness.stdout.includes("FRESH");

    if (shouldFetch) {
      await clearStaleGitLocks();
      let sync = await anonymousFetch();

      if (
        sync.exitCode !== 0 &&
        /(?:shallow|index|HEAD|config|packed-refs|refs\/.*)\.lock|another git process/i.test(
          `${sync.stderr}\n${sync.stdout}`,
        )
      ) {
        const cleared = await clearStaleGitLocks();
        if (cleared) {
          await new Promise((resolve) => setTimeout(resolve, 250));
          sync = await anonymousFetch();
        }
      }

      if (sync.exitCode !== 0 && authHeader) {
        sync = (await authenticatedFetch()) || sync;
      }

      if (sync.exitCode !== 0) {
        throw new Error(
          `Không đồng bộ được repository trong Cloud Sandbox.\n${(sync.stderr || sync.stdout).slice(-1800)}`,
        );
      }

      await shell(sandbox, `touch ${JSON.stringify(fetchMarker)}`);
    }

    const meaningfulStatus = await shell(
      sandbox,
      [
        `cd ${JSON.stringify(dir)}`,
        "git status --porcelain --untracked-files=all",
        "| grep -vE '^(.. )?(\\.vibaocode-|node_modules/|dist/)' || true",
      ].join(" && "),
    );
    const localHead = await shell(
      sandbox,
      `cd ${JSON.stringify(dir)} && git rev-parse HEAD`,
    );
    const remoteHead = await shell(
      sandbox,
      `cd ${JSON.stringify(dir)} && git rev-parse origin/${JSON.stringify(branch)}`,
    );

    const localSha = localHead.stdout.trim();
    const remoteSha = remoteHead.stdout.trim();
    const localContainsRemote =
      localSha && remoteSha
        ? await shell(
            sandbox,
            `cd ${JSON.stringify(dir)} && git merge-base --is-ancestor origin/${JSON.stringify(branch)} HEAD`,
          )
        : null;

    const hasLocalSourceChanges = Boolean(meaningfulStatus.stdout.trim());
    const hasUnpushedLocalCommit =
      Boolean(localSha && remoteSha && localSha !== remoteSha && localContainsRemote?.exitCode === 0);

    if (!hasLocalSourceChanges && !hasUnpushedLocalCommit && localSha !== remoteSha) {
      const reset = await shell(
        sandbox,
        `cd ${JSON.stringify(dir)} && git reset --hard origin/${JSON.stringify(branch)}`,
      );
      if (reset.exitCode !== 0) {
        throw new Error(
          `Không cập nhật được workspace về origin/${branch}.\n${(reset.stderr || reset.stdout).slice(-1800)}`,
        );
      }
    }
  }

  return dir;
}

export async function checkpointWorkspaceChanges(
  sandbox: Sandbox,
  dir: string,
  message = "checkpoint: preserve current Sandbox changes",
) {
  const statusBefore = await shell(
    sandbox,
    `cd ${JSON.stringify(dir)} && git status --porcelain --untracked-files=all`,
  );
  if (!statusBefore.stdout.trim()) {
    const head = await shell(sandbox, `cd ${JSON.stringify(dir)} && git rev-parse HEAD`);
    return { committed: false, sha: head.stdout.trim(), files: [] as string[] };
  }

  const stage = await shell(
    sandbox,
    [
      `cd ${JSON.stringify(dir)}`,
      // Stage the complete project tree so new files created by Codex are not
      // silently omitted. This is required for Expo/React Native projects where
      // new routes/components commonly live under app/, components/, services/,
      // hooks/, lib/, data/, types/, assets/, and supabase/.
      "git add -A",
      // Never checkpoint Vibaocode runtime state, dependency/build output, or
      // local environment secrets. Re-add .env.example explicitly because the
      // broad .env.* exclusion below would otherwise remove it from the index.
      "git reset -- .vibaocode-* .vibaocode-references node_modules dist .expo web-build coverage .env .env.local .env.* 2>/dev/null || true",
      "if [ -f .env.example ]; then git add -f .env.example; fi",
    ].join(" && "),
  );
  if (stage.exitCode !== 0) {
    throw new Error(
      `Không stage được source changes để tạo checkpoint.\n${(stage.stderr || stage.stdout || "").slice(-1800)}`,
    );
  }

  const staged = await shell(
    sandbox,
    `cd ${JSON.stringify(dir)} && git diff --cached --name-only`,
  );
  const files = staged.stdout.split("\n").map((item) => item.trim()).filter(Boolean);
  if (!files.length) {
    const head = await shell(sandbox, `cd ${JSON.stringify(dir)} && git rev-parse HEAD`);
    return { committed: false, sha: head.stdout.trim(), files };
  }

  const commit = await shell(
    sandbox,
    [
      `cd ${JSON.stringify(dir)}`,
      `git -c user.name=${JSON.stringify("Vibaocode")} -c user.email=${JSON.stringify("vibaocode@local")} commit -m ${JSON.stringify(message)}`,
    ].join(" && "),
  );
  if (commit.exitCode !== 0) {
    throw new Error(
      `Không tạo được local checkpoint.\n${(commit.stderr || commit.stdout || "").slice(-1800)}`,
    );
  }

  const head = await shell(sandbox, `cd ${JSON.stringify(dir)} && git rev-parse HEAD`);
  return { committed: true, sha: head.stdout.trim(), files };
}


function githubRepoFromRemote(remoteUrl: string) {
  const normalized = remoteUrl.trim().replace(/\.git$/, "");
  const match =
    normalized.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)$/i) ||
    normalized.match(/^git@github\.com:([^/]+)\/([^/]+)$/i) ||
    normalized.match(/^ssh:\/\/git@github\.com\/([^/]+)\/([^/]+)$/i);
  if (!match) throw new Error(`Không nhận diện được GitHub repository từ origin: ${remoteUrl.trim()}`);
  return { owner: match[1], repo: match[2] };
}

async function githubApiJson<T>(token: string, path: string, init: RequestInit = {}) {
  const response = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "Vibaocode",
      ...(init.headers || {}),
    },
  });
  const raw = await response.text();
  let body: any = {};
  try { body = raw ? JSON.parse(raw) : {}; } catch { body = { message: raw }; }
  if (!response.ok) throw new Error(`GitHub API ${response.status}: ${String(body?.message || raw || response.status)}`);
  return body as T;
}

async function pushWorkspaceTreeViaGitHubApi(
  sandbox: Sandbox,
  dir: string,
  branch: string,
  token: string,
  commitMessage: string,
) {
  const remoteResult = await shell(sandbox, `cd ${JSON.stringify(dir)} && git remote get-url origin`);
  if (remoteResult.exitCode !== 0 || !remoteResult.stdout.trim()) {
    throw new Error("Không đọc được origin URL để dùng GitHub API fallback.");
  }
  const { owner, repo } = githubRepoFromRemote(remoteResult.stdout);
  const encodedOwner = encodeURIComponent(owner);
  const encodedRepo = encodeURIComponent(repo);
  const encodedBranch = branch.split("/").map(encodeURIComponent).join("/");

  const ref = await githubApiJson<{ object?: { sha?: string } }>(
    token,
    `/repos/${encodedOwner}/${encodedRepo}/git/ref/heads/${encodedBranch}`,
  );
  const remoteSha = String(ref?.object?.sha || "");
  if (!remoteSha) throw new Error("GitHub API không trả remote branch SHA.");

  const remoteCommit = await githubApiJson<{ tree?: { sha?: string } }>(
    token,
    `/repos/${encodedOwner}/${encodedRepo}/git/commits/${encodeURIComponent(remoteSha)}`,
  );
  const baseTree = String(remoteCommit?.tree?.sha || "");
  if (!baseTree) throw new Error("GitHub API không trả base tree SHA.");

  const diff = await shell(
    sandbox,
    `cd ${JSON.stringify(dir)} && git diff --name-status --no-renames ${JSON.stringify(remoteSha)} HEAD`,
  );
  if (diff.exitCode !== 0) {
    throw new Error(`Không đọc được tree diff cho GitHub API fallback.\n${(diff.stderr || diff.stdout || "").slice(-1600)}`);
  }

  const changes = diff.stdout
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line) => {
      const tab = line.indexOf("\t");
      if (tab < 0) return null;
      return { status: line.slice(0, tab).trim(), path: line.slice(tab + 1) };
    })
    .filter((item): item is { status: string; path: string } => Boolean(item?.path));

  if (!changes.length) {
    return { remoteSha, changedFiles: 0, output: "Remote tree đã trùng Sandbox tree." };
  }

  const treeEntries: Array<{
    path: string;
    mode: "100644" | "100755" | "120000" | "160000";
    type: "blob" | "commit";
    sha: string | null;
  }> = [];

  for (const change of changes) {
    if (change.status.startsWith("D")) {
      treeEntries.push({ path: change.path, mode: "100644", type: "blob", sha: null });
      continue;
    }

    const treeLine = await shell(
      sandbox,
      `cd ${JSON.stringify(dir)} && git ls-tree HEAD -- ${JSON.stringify(change.path)}`,
    );
    const match = treeLine.stdout.match(/^(100644|100755|120000|160000)\s+(blob|commit)\s+([0-9a-f]{40})\t/);
    if (!match) throw new Error(`Git tree mode không được hỗ trợ: ${change.path}`);

    const mode = match[1] as "100644" | "100755" | "120000" | "160000";
    const type = match[2] as "blob" | "commit";
    if (type === "commit") {
      treeEntries.push({ path: change.path, mode, type, sha: match[3] });
      continue;
    }

    const buffer = await sandbox.readFileToBuffer({ path: `${dir}/${change.path}` });
    if (!buffer) throw new Error(`Không đọc được file trong Sandbox: ${change.path}`);

    const blob = await githubApiJson<{ sha?: string }>(
      token,
      `/repos/${encodedOwner}/${encodedRepo}/git/blobs`,
      {
        method: "POST",
        body: JSON.stringify({ content: buffer.toString("base64"), encoding: "base64" }),
      },
    );
    const blobSha = String(blob?.sha || "");
    if (!blobSha) throw new Error(`GitHub không tạo được blob: ${change.path}`);
    treeEntries.push({ path: change.path, mode, type: "blob", sha: blobSha });
  }

  const tree = await githubApiJson<{ sha?: string }>(
    token,
    `/repos/${encodedOwner}/${encodedRepo}/git/trees`,
    { method: "POST", body: JSON.stringify({ base_tree: baseTree, tree: treeEntries }) },
  );
  const treeSha = String(tree?.sha || "");
  if (!treeSha) throw new Error("GitHub API không tạo được tree.");

  const commit = await githubApiJson<{ sha?: string }>(
    token,
    `/repos/${encodedOwner}/${encodedRepo}/git/commits`,
    { method: "POST", body: JSON.stringify({ message: commitMessage, tree: treeSha, parents: [remoteSha] }) },
  );
  const createdCommitSha = String(commit?.sha || "");
  if (!createdCommitSha) throw new Error("GitHub API không tạo được commit.");

  await githubApiJson(
    token,
    `/repos/${encodedOwner}/${encodedRepo}/git/refs/heads/${encodedBranch}`,
    { method: "PATCH", body: JSON.stringify({ sha: createdCommitSha, force: false }) },
  );

  const verifyRef = await githubApiJson<{ object?: { sha?: string } }>(
    token,
    `/repos/${encodedOwner}/${encodedRepo}/git/ref/heads/${encodedBranch}`,
  );
  const verifiedSha = String(verifyRef?.object?.sha || "");
  if (verifiedSha !== createdCommitSha) throw new Error("GitHub API verify branch thất bại.");

  return {
    remoteSha: verifiedSha,
    changedFiles: treeEntries.length,
    output: `GitHub API fallback đã push ${treeEntries.length} file.`,
  };
}

export async function pushWorkspaceHead(
  sandbox: Sandbox,
  dir: string,
  branch: string,
  githubToken: string,
) {
  const token = githubToken.trim();
  if (!token) throw new Error("Thiếu GitHub token để push.");

  const authHeader = `Authorization: Basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}`;

  // Preserve the current source tree before any fetch/rebase/push.
  const checkpoint = await checkpointWorkspaceChanges(sandbox, dir);
  const autoCommitted = checkpoint.committed;
  const autoCommitSha = checkpoint.committed ? checkpoint.sha : "";

  const current = await shell(sandbox, `cd ${JSON.stringify(dir)} && git rev-parse HEAD`);
  const originalLocalSha = current.stdout.trim();
  if (!originalLocalSha) throw new Error("Không đọc được local HEAD trong Sandbox.");

  // Refresh only the remote tracking ref. Never hard-reset the user's local commit.
  const fetch = await shell(
    sandbox,
    [
      `cd ${JSON.stringify(dir)}`,
      `GIT_TERMINAL_PROMPT=0 git -c http.extraHeader=${JSON.stringify(authHeader)} fetch origin ${JSON.stringify(branch)} --depth=100`,
    ].join(" && "),
  );
  if (fetch.exitCode !== 0) {
    throw new Error(`Không fetch được remote trước khi push.\n${(fetch.stderr || fetch.stdout || "").slice(-1800)}`);
  }

  const remoteBefore = await shell(
    sandbox,
    `cd ${JSON.stringify(dir)} && git rev-parse origin/${JSON.stringify(branch)}`,
  );
  const remoteBeforeSha = remoteBefore.stdout.trim();

  if (remoteBeforeSha === originalLocalSha) {
    return {
      localSha: originalLocalSha,
      remoteSha: remoteBeforeSha,
      verified: true,
      reconciled: false,
      stashed: false,
      stashRestored: true,
      autoCommitted,
      autoCommitSha: autoCommitSha || null,
      output: "Remote đã trùng local HEAD.",
    };
  }

  const ancestry = await shell(
    sandbox,
    `cd ${JSON.stringify(dir)} && git merge-base --is-ancestor origin/${JSON.stringify(branch)} HEAD`,
  );

  let reconciled = false;
  let rescueBranch = "";
  let stashRef = "";
  let stashed = false;
  let stashRestored = true;

  async function restoreStash() {
    if (!stashed || !stashRef) return true;
    const restore = await shell(
      sandbox,
      `cd ${JSON.stringify(dir)} && git stash apply --index ${JSON.stringify(stashRef)}`,
    );
    if (restore.exitCode !== 0) return false;

    // Only drop our stash after a successful restore.
    await shell(
      sandbox,
      `cd ${JSON.stringify(dir)} && git stash drop ${JSON.stringify(stashRef)} >/dev/null 2>&1 || true`,
    );
    return true;
  }

  if (ancestry.exitCode !== 0) {
    // Protect the exact local commit before attempting any history reconciliation.
    rescueBranch = `vibaocode-rescue-${originalLocalSha.slice(0, 12)}`;
    const rescue = await shell(
      sandbox,
      `cd ${JSON.stringify(dir)} && git branch -f ${JSON.stringify(rescueBranch)} ${JSON.stringify(originalLocalSha)}`,
    );
    if (rescue.exitCode !== 0) {
      throw new Error(`Không tạo được rescue branch trước khi đồng bộ history.\n${(rescue.stderr || rescue.stdout || "").slice(-1600)}`);
    }

    // Vibaocode runtime/progress files can make the working tree dirty even when
    // the user's source commit is already complete. Preserve every dirty file
    // before rebasing, then restore it after the push. Nothing is discarded.
    const dirty = await shell(
      sandbox,
      `cd ${JSON.stringify(dir)} && git status --porcelain`,
    );
    if (dirty.stdout.trim()) {
      const stash = await shell(
        sandbox,
        `cd ${JSON.stringify(dir)} && git stash push --include-untracked -m ${JSON.stringify(`vibaocode-pre-push-${originalLocalSha.slice(0, 12)}`)}`,
      );
      if (stash.exitCode !== 0) {
        throw new Error(
          [
            "Không thể bảo toàn working tree trước khi rebase.",
            `Code commit vẫn an toàn ở ${originalLocalSha} và rescue branch ${rescueBranch}.`,
            (stash.stderr || stash.stdout || "").slice(-1600),
          ].join("\n"),
        );
      }

      const stashName = await shell(
        sandbox,
        `cd ${JSON.stringify(dir)} && git stash list --format=%gd -1`,
      );
      stashRef = stashName.stdout.trim();
      stashed = Boolean(stashRef);
    }

    const rebase = await shell(
      sandbox,
      [
        `cd ${JSON.stringify(dir)}`,
        `GIT_EDITOR=true git rebase origin/${JSON.stringify(branch)}`,
      ].join(" && "),
    );

    if (rebase.exitCode !== 0) {
      await shell(
        sandbox,
        `cd ${JSON.stringify(dir)} && git rebase --abort >/dev/null 2>&1 || true`,
      );
      stashRestored = await restoreStash();
      throw new Error(
        [
          "Local commit và remote đã phân kỳ; tự động rebase bị conflict.",
          `Code vẫn an toàn ở local commit ${originalLocalSha} và rescue branch ${rescueBranch}.`,
          stashed
            ? (stashRestored
                ? "Các thay đổi chưa commit đã được khôi phục lại."
                : `Các thay đổi chưa commit vẫn an toàn trong ${stashRef}; chưa khôi phục tự động được.`)
            : "",
          (rebase.stderr || rebase.stdout || "").slice(-1800),
        ].filter(Boolean).join("\n"),
      );
    }
    reconciled = true;
  }

  const localAfter = await shell(sandbox, `cd ${JSON.stringify(dir)} && git rev-parse HEAD`);
  const localSha = localAfter.stdout.trim();

  const push = await shell(
    sandbox,
    [
      `cd ${JSON.stringify(dir)}`,
      `GIT_TERMINAL_PROMPT=0 git -c http.extraHeader=${JSON.stringify(authHeader)} push origin HEAD:${JSON.stringify(branch)}`,
    ].join(" && "),
  );

  if (push.exitCode !== 0) {
    let apiFallbackError = "";
    try {
      const fallback = await pushWorkspaceTreeViaGitHubApi(
        sandbox,
        dir,
        branch,
        token,
        "Vibaocode: publish current Sandbox state",
      );

      const refresh = await shell(
        sandbox,
        [
          `cd ${JSON.stringify(dir)}`,
          `GIT_TERMINAL_PROMPT=0 git -c http.extraHeader=${JSON.stringify(authHeader)} fetch origin ${JSON.stringify(branch)} --depth=100`,
        ].join(" && "),
      );

      if (refresh.exitCode === 0) {
        await shell(
          sandbox,
          `cd ${JSON.stringify(dir)} && git reset --hard origin/${JSON.stringify(branch)}`,
        );
      }

      stashRestored = await restoreStash();

      return {
        originalLocalSha,
        localSha: fallback.remoteSha,
        remoteBeforeSha,
        remoteSha: fallback.remoteSha,
        verified: true,
        reconciled: true,
        rescueBranch: rescueBranch || null,
        stashed,
        stashRestored,
        stashRef: stashRestored ? null : (stashRef || null),
        autoCommitted,
        autoCommitSha: autoCommitSha || null,
        apiFallback: true,
        changedFiles: fallback.changedFiles,
        output: fallback.output,
      };
    } catch (error) {
      apiFallbackError =
        error instanceof Error ? error.message : "GitHub API fallback thất bại.";
    }

    stashRestored = await restoreStash();
    throw new Error(
      [
        "GitHub push thất bại sau khi đã fetch/reconcile.",
        `Local HEAD vẫn an toàn: ${localSha || originalLocalSha}`,
        rescueBranch ? `Rescue branch: ${rescueBranch}` : "",
        stashed
          ? (stashRestored
              ? "Các thay đổi chưa commit đã được khôi phục lại."
              : `Các thay đổi chưa commit vẫn an toàn trong ${stashRef}.`)
          : "",
        `Git CLI: ${(push.stderr || push.stdout || "").slice(-1200)}`,
        `GitHub API fallback: ${apiFallbackError}`,
      ].filter(Boolean).join("\\n"),
    );
  }

  const verifyFetch = await shell(
    sandbox,
    [
      `cd ${JSON.stringify(dir)}`,
      `GIT_TERMINAL_PROMPT=0 git -c http.extraHeader=${JSON.stringify(authHeader)} fetch origin ${JSON.stringify(branch)} --depth=100`,
    ].join(" && "),
  );
  if (verifyFetch.exitCode !== 0) {
    stashRestored = await restoreStash();
    throw new Error(`Đã push nhưng không verify được remote.\n${(verifyFetch.stderr || verifyFetch.stdout || "").slice(-1800)}`);
  }

  const remote = await shell(
    sandbox,
    `cd ${JSON.stringify(dir)} && git rev-parse origin/${JSON.stringify(branch)}`,
  );
  const remoteSha = remote.stdout.trim();

  stashRestored = await restoreStash();

  return {
    originalLocalSha,
    localSha,
    remoteBeforeSha,
    remoteSha,
    verified: Boolean(localSha && remoteSha && localSha === remoteSha),
    reconciled,
    rescueBranch: rescueBranch || null,
    stashed,
    stashRestored,
    stashRef: stashRestored ? null : (stashRef || null),
    autoCommitted,
    autoCommitSha: autoCommitSha || null,
    output: push.stdout.trim(),
  };
}

export async function compactWorkspace(
  sandbox: Sandbox,
  activeDir: string,
  options: { afterPush?: boolean } = {},
) {
  const reposRoot = "/vercel/sandbox/repos";
  const afterPush = Boolean(options.afterPush);
  const result = await shell(
    sandbox,
    `
set +e
mkdir -p ${JSON.stringify(reposRoot)}

# Keep the active repo hot, but evict stale repo workspaces left by old branches
# or projects after six hours. node_modules for the active repo remains cached.
find ${JSON.stringify(reposRoot)} -mindepth 1 -maxdepth 1 -type d \
  ! -path ${JSON.stringify(activeDir)} -mmin +360 -exec rm -rf {} + 2>/dev/null || true

if [ -d ${JSON.stringify(activeDir + "/.git")} ]; then
  cd ${JSON.stringify(activeDir)}

  # Bound transient logs instead of allowing long AI sessions to grow forever.
  for f in .vibaocode-dev.log .vibaocode-codex-events.jsonl .vibaocode-codex-stderr.log .vibaocode-codex-runner.log; do
    if [ -f "$f" ] && [ "$(wc -c < "$f" 2>/dev/null || echo 0)" -gt 2097152 ]; then
      tail -c 1048576 "$f" > "$f.tmp" 2>/dev/null && mv "$f.tmp" "$f"
    fi
  done

  # Old visual-audit frames are disposable. Reference images are deliberately
  # excluded because they are user input reused by future prompts.
  if [ -d .vibaocode-visual ]; then
    find .vibaocode-visual -mindepth 1 -type f -mmin +180 -delete 2>/dev/null || true
    find .vibaocode-visual -depth -type d -empty -delete 2>/dev/null || true
  fi

  # Stale Codex coordination files from previous runs can be removed safely
  # once they are no longer recent.
  find . -maxdepth 1 -type f \
    \( -name '.vibaocode-codex-*' -o -name '.vibaocode-package-hash.tmp' \) \
    -mmin +180 -delete 2>/dev/null || true

  if [ ${afterPush ? "1" : "0"} = "1" ]; then
    git stash clear >/dev/null 2>&1 || true
    git for-each-ref --format='%(refname:short)' refs/heads/vibaocode-rescue-* 2>/dev/null \
      | xargs -r -n1 git branch -D >/dev/null 2>&1 || true
    git reflog expire --expire=7.days --all >/dev/null 2>&1 || true
    git gc --auto >/dev/null 2>&1 || true
  fi
fi
`,
  );

  return result;
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
CURRENT_HASH="$(
  { sha256sum package.json 2>/dev/null; sha256sum package-lock.json pnpm-lock.yaml yarn.lock 2>/dev/null; } \
    | sha256sum | cut -d' ' -f1
)"
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
  options: { restart?: boolean } = {},
) {
  const info = await packageInfo(sandbox, dir);
  const scripts = info.scripts || {};
  const deps = info.deps || {};
  const previewUrl = sandbox.domain(3000);
  const previewHost = new URL(previewUrl).hostname.replace(/[^A-Za-z0-9.-]/g, "");
  if (!options.restart) {
    const healthy = await shell(
      sandbox,
      `cd ${JSON.stringify(dir)} && curl -fsS http://127.0.0.1:3000 >/dev/null 2>&1 && echo READY || true`,
    );
    if (healthy.stdout.includes("READY")) {
      const logResult = await shell(
        sandbox,
        `cd ${JSON.stringify(dir)} && tail -n 80 .vibaocode-dev.log 2>/dev/null || true`,
      );
      return {
        ok: true,
        logs: logResult.stdout,
        previewUrl,
        reused: true,
      };
    }
  }
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
