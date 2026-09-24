"use client";

import {
  Bot,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Code2,
  Eye,
  FileCode2,
  FileText,
  Folder,
  FolderOpen,
  GitBranch,
  GitPullRequest,
  Github,
  ImagePlus,
  KeyRound,
  Loader2,
  MonitorSmartphone,
  Play,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Settings,
  Sparkles,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

type RepoItem = {
  path: string;
  type: "blob" | "tree";
  size: number;
  sha: string;
};

type TreeNode = {
  name: string;
  path: string;
  type: "file" | "folder";
  size?: number;
  children?: TreeNode[];
};

type FileState = {
  path: string;
  sha: string;
  size: number;
};

type GithubRepoOption = {
  fullName: string;
  name: string;
  private: boolean;
  defaultBranch: string;
  updatedAt: string;
};

type GithubUser = {
  login: string;
  name: string;
  avatarUrl: string;
};

type Device = {
  label: string;
  width: number;
  height: number;
};

type ProjectProposal = {
  path: string;
  content: string;
  reason: string;
  originalContent: string;
  sha: string;
  size: number;
};

type ReferenceImage = {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  path: string;
  kind: "style" | "ui" | "character" | "environment" | "logo-icon" | "other";
  note: string;
  active: boolean;
};

type CodexLimitWindow = {
  usedPercent?: number;
  windowDurationMins?: number | null;
  resetsAt?: number | null;
};

type CodexLimit = {
  limitId?: string;
  limitName?: string | null;
  planType?: string | null;
  primary?: CodexLimitWindow | null;
  secondary?: CodexLimitWindow | null;
};

type CodexModelOption = {
  id: string;
  model: string;
  displayName: string;
  isDefault?: boolean;
  defaultReasoningEffort?: string | null;
  supportedReasoningEfforts?: Array<{
    reasoningEffort: string;
    description?: string;
  }>;
};

type CodexUsageSnapshot = {
  rateLimits?: {
    rateLimits?: CodexLimit | null;
    rateLimitsByLimitId?: Record<string, CodexLimit> | null;
    ordinaryUsageAllowed?: boolean | null;
  } | null;
  usage?: {
    summary?: {
      lifetimeTokens?: number | null;
      peakDailyTokens?: number | null;
      currentStreakDays?: number | null;
    } | null;
    dailyUsageBuckets?: Array<{ startDate: string; tokens: number }> | null;
  } | null;
  error?: string;
};

const devices: Device[] = [
  { label: "Android Small", width: 360, height: 800 },
  { label: "Pixel", width: 390, height: 844 },
  { label: "Android Large", width: 412, height: 915 },
];

const binaryExtensions = new Set([
  "png", "jpg", "jpeg", "gif", "webp", "ico", "pdf", "zip", "rar", "7z",
  "woff", "woff2", "ttf", "otf", "mp3", "wav", "mp4", "mov", "avi", "apk", "aab"
]);

function buildTree(items: RepoItem[]): TreeNode[] {
  const root: TreeNode[] = [];

  for (const item of items) {
    const parts = item.path.split("/");
    let level = root;
    let current = "";

    parts.forEach((part, index) => {
      current = current ? `${current}/${part}` : part;
      const isLast = index === parts.length - 1;
      const wantedType = isLast && item.type === "blob" ? "file" : "folder";
      let node = level.find((entry) => entry.name === part && entry.type === wantedType);

      if (!node) {
        node = {
          name: part,
          path: current,
          type: wantedType,
          size: wantedType === "file" ? item.size : undefined,
          children: wantedType === "folder" ? [] : undefined,
        };
        level.push(node);
      }

      if (node.type === "folder") {
        level = node.children || [];
      }
    });
  }

  const sortNodes = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => {
      if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    nodes.forEach((node) => node.children && sortNodes(node.children));
  };

  sortNodes(root);
  return root;
}

function fileExtension(path: string) {
  return path.split(".").pop()?.toLowerCase() || "";
}

function isTextFile(path: string) {
  return !binaryExtensions.has(fileExtension(path));
}

function formatBytes(bytes = 0) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function TreeBranch({
  nodes,
  selectedPath,
  search,
  onOpen,
}: {
  nodes: TreeNode[];
  selectedPath: string;
  search: string;
  onOpen: (node: TreeNode) => void;
}) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({
    app: true,
    components: true,
    src: true,
  });

  const visible = useMemo(() => {
    if (!search.trim()) return nodes;
    const q = search.toLowerCase();

    const filter = (list: TreeNode[]): TreeNode[] =>
      list
        .map((node) => {
          if (node.type === "file") {
            return node.path.toLowerCase().includes(q) ? node : null;
          }
          const children = filter(node.children || []);
          if (children.length || node.path.toLowerCase().includes(q)) {
            return { ...node, children };
          }
          return null;
        })
        .filter(Boolean) as TreeNode[];

    return filter(nodes);
  }, [nodes, search]);

  const render = (list: TreeNode[], depth = 0) =>
    list.map((node) => {
      if (node.type === "folder") {
        const open = search.trim() ? true : Boolean(expanded[node.path]);
        return (
          <div key={node.path}>
            <button
              className="tree-row tree-folder"
              style={{ paddingLeft: 10 + depth * 14 }}
              onClick={() => setExpanded((prev) => ({ ...prev, [node.path]: !open }))}
              type="button"
            >
              {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              {open ? <FolderOpen size={15} /> : <Folder size={15} />}
              <span>{node.name}</span>
            </button>
            {open && node.children ? render(node.children, depth + 1) : null}
          </div>
        );
      }

      return (
        <button
          key={node.path}
          className={`tree-row tree-file ${selectedPath === node.path ? "active" : ""}`}
          style={{ paddingLeft: 29 + depth * 14 }}
          onClick={() => onOpen(node)}
          type="button"
        >
          {["md", "txt"].includes(fileExtension(node.path)) ? (
            <FileText size={14} />
          ) : (
            <FileCode2 size={14} />
          )}
          <span>{node.name}</span>
        </button>
      );
    });

  return <div className="tree-list">{render(visible)}</div>;
}

export default function Workspace() {
  const [repo, setRepo] = useState("techzoneadapter-droid/vibaocode");
  const [branch, setBranch] = useState("main");
  const [githubToken, setGithubToken] = useState("");
  const [githubUser, setGithubUser] = useState<GithubUser | null>(null);
  const [githubRepos, setGithubRepos] = useState<GithubRepoOption[]>([]);
  const [githubConnecting, setGithubConnecting] = useState(false);
  const [openAIKey, setOpenAIKey] = useState("");
  const [model, setModel] = useState("gpt-5.3-codex");
  const [aiProvider, setAiProvider] = useState<"openai-api" | "codex-account" | "claude-api" | "gemini-api">("openai-api");
  const [anthropicKey, setAnthropicKey] = useState("");
  const [geminiKey, setGeminiKey] = useState("");
  const [vercelCleanupToken, setVercelCleanupToken] = useState("");
  const [sandboxCleanupLoading, setSandboxCleanupLoading] = useState(false);
  const [sandboxCleanupResult, setSandboxCleanupResult] = useState("");
  const [previewUrl, setPreviewUrl] = useState("");
  const [workspaceId, setWorkspaceId] = useState("");
  const [sandboxRunning, setSandboxRunning] = useState(false);
  const [sandboxName, setSandboxName] = useState("");
  const [sandboxRevision, setSandboxRevision] = useState("");
  const [runLogs, setRunLogs] = useState("");
  const [testSummary, setTestSummary] = useState("");
  const [runLoading, setRunLoading] = useState(false);
  const [testLoading, setTestLoading] = useState(false);
  const [sandboxPushLoading, setSandboxPushLoading] = useState(false);
  const [playTestLoading, setPlayTestLoading] = useState(false);
  const [playScreenshots, setPlayScreenshots] = useState<string[]>([]);
  const [liveTestImage, setLiveTestImage] = useState("");
  const [liveTestLabel, setLiveTestLabel] = useState("");
  const [playStep, setPlayStep] = useState(0);
  const [playReport, setPlayReport] = useState("");
  const [visualReview, setVisualReview] = useState("");
  const [visualLoopLoading, setVisualLoopLoading] = useState(false);
  const [visualLoopStage, setVisualLoopStage] = useState("");
  const [previewView, setPreviewView] = useState<"live" | "replay">("live");
  const [autoSync, setAutoSync] = useState(true);
  const [codexStatus, setCodexStatus] = useState<"disconnected" | "waiting" | "connected">("disconnected");
  const [codexVerificationUrl, setCodexVerificationUrl] = useState("");
  const [codexUserCode, setCodexUserCode] = useState("");
  const [codexDetail, setCodexDetail] = useState("");
  const [codexPhase, setCodexPhase] = useState("");
  const [codexConnecting, setCodexConnecting] = useState(false);
  const [codexDiagnosing, setCodexDiagnosing] = useState(false);
  const [codexUsage, setCodexUsage] = useState<CodexUsageSnapshot | null>(null);
  const [codexUsageLoading, setCodexUsageLoading] = useState(false);
  const [codexModels, setCodexModels] = useState<CodexModelOption[]>([]);
  const [codexModelsLoading, setCodexModelsLoading] = useState(false);
  const [codexModel, setCodexModel] = useState("");
  const [codexReasoning, setCodexReasoning] = useState("medium");
  const [aiProgress, setAiProgress] = useState(0);
  const [aiProgressLabel, setAiProgressLabel] = useState("Sẵn sàng");
  const [aiProgressDetail, setAiProgressDetail] = useState("");
  const [aiElapsedSeconds, setAiElapsedSeconds] = useState(0);
  const [aiRunUsage, setAiRunUsage] = useState<Record<string, number> | null>(null);
  const [referenceImages, setReferenceImages] = useState<ReferenceImage[]>([]);
  const [referenceUploading, setReferenceUploading] = useState(false);
  const [referenceDragOver, setReferenceDragOver] = useState(false);
  const [aiScope, setAiScope] = useState<"file" | "project">("project");
  const [projectProposals, setProjectProposals] = useState<ProjectProposal[]>([]);
  const [projectSummary, setProjectSummary] = useState("");
  const [projectPlan, setProjectPlan] = useState("");
  const [reviewBase, setReviewBase] = useState("");
  const [prUrl, setPrUrl] = useState("");
  const [treeItems, setTreeItems] = useState<RepoItem[]>([]);
  const [selected, setSelected] = useState<FileState | null>(null);
  const [editorContent, setEditorContent] = useState("");
  const [originalContent, setOriginalContent] = useState("");
  const [proposal, setProposal] = useState("");
  const [proposalSummary, setProposalSummary] = useState("");
  const [projectContext, setProjectContext] = useState("");
  const [prompt, setPrompt] = useState("");
  const [search, setSearch] = useState("");
  const [device, setDevice] = useState(devices[1]);
  const [previewMode, setPreviewMode] = useState<"url" | "html">("url");
  const [previewKey, setPreviewKey] = useState(0);
  const [tab, setTab] = useState<"code" | "diff">("code");
  const [workspaceView, setWorkspaceView] = useState<"preview" | "code" | "changes">("preview");
  const [rightPanelOpen, setRightPanelOpen] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [repoLoading, setRepoLoading] = useState(false);
  const [fileLoading, setFileLoading] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [branchLoading, setBranchLoading] = useState(false);
  const [prLoading, setPrLoading] = useState(false);
  const [notice, setNotice] = useState("Sẵn sàng");
  const [error, setError] = useState("");

  useEffect(() => {
    // Keep one stable cloud workspace per browser so reopening Vibaocode does
    // not create a brand-new persistent Sandbox (and another snapshot chain).
    // Migrate the previous session-scoped id when available to reuse the
    // Sandbox that this browser is already using.
    let currentWorkspaceId =
      localStorage.getItem("vibaocode.workspaceId") ||
      sessionStorage.getItem("vibaocode.workspaceId") ||
      "";

    if (!currentWorkspaceId) {
      currentWorkspaceId = crypto.randomUUID();
    }

    localStorage.setItem("vibaocode.workspaceId", currentWorkspaceId);
    sessionStorage.setItem("vibaocode.workspaceId", currentWorkspaceId);
    setWorkspaceId(currentWorkspaceId);

    const saved = sessionStorage.getItem("vibaocode.settings");
    if (!saved) return;
    try {
      const data = JSON.parse(saved);
      if (data.repo) setRepo(data.repo);
      if (data.branch) setBranch(data.branch);
      if (data.githubToken) {
        setGithubToken(data.githubToken);
        void loadGithubAccount(data.githubToken, false);
      }
      if (data.openAIKey) setOpenAIKey(data.openAIKey);
      if (data.model) setModel(data.model);
      if (data.codexModel) setCodexModel(data.codexModel);
      if (data.codexReasoning) setCodexReasoning(data.codexReasoning);
      if (["codex-account","openai-api","claude-api","gemini-api"].includes(data.aiProvider)) {
        setAiProvider(data.aiProvider);
      }
      if (data.anthropicKey) setAnthropicKey(data.anthropicKey);
      if (data.geminiKey) setGeminiKey(data.geminiKey);
      if (typeof data.autoSync === "boolean") setAutoSync(data.autoSync);
      if (data.previewUrl && data.previewUrl !== "https://vibaocode.vercel.app") setPreviewUrl(data.previewUrl);
    } catch {
      // Ignore malformed session data.
    }
  }, []);

  const tree = useMemo(() => buildTree(treeItems), [treeItems]);
  const dirty = Boolean(selected) && editorContent !== originalContent;
  const aiReady =
    aiScope === "file"
      ? Boolean(selected && prompt.trim() && editorContent)
      : Boolean(treeItems.length && prompt.trim());

  useEffect(() => {
    if (!autoSync || !sandboxRunning || !dirty || !selected || !workspaceId) return;
    const timer = window.setTimeout(() => {
      void syncDraft(selected.path, editorContent);
    }, 700);
    return () => window.clearTimeout(timer);
  }, [autoSync, sandboxRunning, dirty, selected?.path, editorContent, workspaceId, repo, branch]);

  useEffect(() => {
    if (codexStatus === "connected" && workspaceId) {
      void loadCodexUsage(false);
      void loadCodexModels(false);
    }
  }, [codexStatus, workspaceId]);

  useEffect(() => {
    if (!workspaceId || !repo) return;
    const key = `vibaocode.references.${workspaceId}.${repo}@${branch}`;
    try {
      const saved = sessionStorage.getItem(key);
      const parsed = saved ? JSON.parse(saved) : [];
      setReferenceImages(Array.isArray(parsed) ? parsed : []);
    } catch {
      setReferenceImages([]);
    }
  }, [workspaceId, repo, branch]);

  useEffect(() => {
    if (!workspaceId || !repo) return;
    const key = `vibaocode.references.${workspaceId}.${repo}@${branch}`;
    sessionStorage.setItem(key, JSON.stringify(referenceImages));
  }, [referenceImages, workspaceId, repo, branch]);

  const saveSettings = () => {
    sessionStorage.setItem(
      "vibaocode.settings",
      JSON.stringify({ repo, branch, githubToken, openAIKey, model, codexModel, codexReasoning, aiProvider, anthropicKey, geminiKey, autoSync, previewUrl })
    );
    setSettingsOpen(false);
    setNotice("Đã lưu cài đặt cho phiên trình duyệt này");
  };

  async function cleanupVercelSandbox() {
    setSandboxCleanupLoading(true);
    setSandboxCleanupResult("");
    setError("");
    try {
      const response = await fetch("/api/sandbox/cleanup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: vercelCleanupToken }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) {
        throw new Error(data.error || data.message || "Không dọn được Sandbox.");
      }

      setSandboxCleanupResult(
        `Đã xóa ${data.deletedSandboxes || 0} Sandbox và ${data.deletedSnapshots || 0} Snapshot cũ.`
      );
      setVercelCleanupToken("");
      setSandboxRunning(false);
      setSandboxName("");
      setPreviewUrl("");
      setCodexStatus("disconnected");
      setCodexDetail("");
      setNotice("Đã dọn quota Sandbox. Bấm Run hoặc Kết nối ChatGPT lại.");
    } catch (err) {
      setSandboxCleanupResult("");
      setError(err instanceof Error ? err.message : "Dọn Sandbox thất bại.");
    } finally {
      setSandboxCleanupLoading(false);
    }
  }

  const apiHeaders = () => {
    const headers: Record<string, string> = {};
    if (githubToken) headers["x-github-token"] = githubToken;
    return headers;
  };

  async function loadGithubAccount(token = githubToken, announce = true) {
    if (!token) {
      if (announce) setError("Nhập Fine-grained GitHub token trước.");
      return false;
    }

    setGithubConnecting(true);
    if (announce) {
      setError("");
      setNotice("Đang kết nối GitHub…");
    }

    try {
      const response = await fetch("/api/github/account", {
        headers: { "x-github-token": token },
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Không kết nối được GitHub.");

      setGithubUser(data.user || null);
      setGithubRepos(data.repos || []);
      if (announce) {
        setNotice(`Đã kết nối GitHub @${data.user?.login || ""} • ${data.repos?.length || 0} repositories`);
      }
      return true;
    } catch (err) {
      setGithubUser(null);
      setGithubRepos([]);
      if (announce) {
        setError(err instanceof Error ? err.message : "Không kết nối được GitHub.");
        setNotice("Kết nối GitHub thất bại");
      }
      return false;
    } finally {
      setGithubConnecting(false);
    }
  }

  function chooseGithubRepo(fullName: string) {
    const option = githubRepos.find((item) => item.fullName === fullName);
    setRepo(fullName);
    setBranch(option?.defaultBranch || "main");
    setReviewBase("");
    setPrUrl("");
    setTreeItems([]);
    setSelected(null);
    setEditorContent("");
    setOriginalContent("");
    setProposal("");
    setProposalSummary("");
    setProjectProposals([]);
    setProjectSummary("");
    setProjectPlan("");
    setReferenceImages([]);
    setSandboxRunning(false);
    setPreviewUrl("");
    setNotice(`Đã chọn ${fullName}. Bấm Load để mở dự án.`);
  }

  function disconnectGithub() {
    setGithubToken("");
    setGithubUser(null);
    setGithubRepos([]);
    const saved = sessionStorage.getItem("vibaocode.settings");
    if (saved) {
      try {
        const data = JSON.parse(saved);
        delete data.githubToken;
        sessionStorage.setItem("vibaocode.settings", JSON.stringify(data));
      } catch {
        // Ignore malformed session data.
      }
    }
    setNotice("Đã ngắt kết nối GitHub");
  }

  async function fetchFile(path: string) {
    const query = new URLSearchParams({ repo, branch, path });
    const response = await fetch(`/api/github/file?${query}`, { headers: apiHeaders() });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Không đọc được file.");
    return data;
  }

  async function connectRepo() {
    setRepoLoading(true);
    setError("");
    setSandboxRunning(false);
    setSandboxName("");
    setSandboxRevision("");
    setPreviewUrl("");
    setRunLogs("");
    setTestSummary("");
    setPlayScreenshots([]);
    setLiveTestImage("");
    setPlayReport("");
    setVisualReview("");
    setNotice("Đang đọc repository…");
    try {
      const query = new URLSearchParams({ repo, branch });
      const response = await fetch(`/api/github/tree?${query}`, { headers: apiHeaders() });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Không đọc được repository.");

      setTreeItems(data.items || []);
      setSelected(null);
      setEditorContent("");
      setOriginalContent("");
      setProposal("");
      setProposalSummary("");
      setProjectProposals([]);
      setProjectSummary("");
      setProjectPlan("");
      setNotice(`Đã tải ${data.items?.length || 0} mục từ ${repo}`);

      const projectFile = (data.items || []).find(
        (item: RepoItem) => item.type === "blob" && item.path.toLowerCase() === "project.md"
      );
      if (projectFile) {
        try {
          const context = await fetchFile(projectFile.path);
          setProjectContext(context.content.slice(0, 20000));
        } catch {
          setProjectContext("");
        }
      } else {
        setProjectContext("");
      }

      // "Load" means "open the exact current GitHub branch". Refresh the
      // persistent Sandbox from remote and restart preview immediately so an
      // old Sandbox cannot keep showing stale code after GitHub has advanced.
      setNotice("Đã đọc GitHub • đang đồng bộ Cloud Sandbox về bản mới nhất…");
      await runCloudProject(true, true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không thể kết nối GitHub.");
      setNotice("Kết nối thất bại");
    } finally {
      setRepoLoading(false);
    }
  }

  async function openFile(node: TreeNode) {
    if (node.type !== "file") return;
    if (!isTextFile(node.path)) {
      setError("V1 chỉ mở trực tiếp file văn bản/code. Asset nhị phân sẽ hỗ trợ ở bản sau.");
      return;
    }
    if ((node.size || 0) > 1_500_000) {
      setError("File lớn hơn 1.5 MB, chưa mở trực tiếp để tránh làm nặng trình duyệt.");
      return;
    }

    setFileLoading(true);
    setError("");
    setNotice(`Đang mở ${node.path}…`);
    try {
      const data = await fetchFile(node.path);
      setSelected({ path: data.path, sha: data.sha, size: data.size });
      setEditorContent(data.content);
      setOriginalContent(data.content);
      setProposal("");
      setProposalSummary("");
      setTab("code");
      setWorkspaceView("code");
      setNotice(`Đã mở ${data.path}`);
      if (fileExtension(node.path) === "html") setPreviewMode("html");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không mở được file.");
    } finally {
      setFileLoading(false);
    }
  }

  async function copyCodexCode() {
    if (!codexUserCode) return;
    try {
      await navigator.clipboard.writeText(codexUserCode);
      setNotice(`Đã sao chép mã thiết bị ${codexUserCode}`);
    } catch {
      setNotice(`Mã thiết bị: ${codexUserCode}`);
    }
  }

  async function pushSandboxHead() {
    if (!workspaceId || !repo || !branch) return;
    if (!githubToken) {
      setSettingsOpen(true);
      setError("Thêm Fine-grained GitHub token trong Settings trước khi push Sandbox.");
      return;
    }

    setSandboxPushLoading(true);
    setError("");
    setNotice("Đang push commit hiện tại trong Cloud Sandbox lên GitHub…");
    try {
      const response = await fetch("/api/agent/codex-edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "push",
          workspaceId,
          repo,
          branch,
          githubToken,
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.verified) {
        throw new Error(data.error || "Push Sandbox chưa verify được.");
      }

      setSandboxRevision(String(data.remoteSha || "").slice(0, 12));
      setNotice(`Đã push & verify ${String(data.remoteSha || "").slice(0, 12)} lên ${branch}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không push được Cloud Sandbox.");
      setNotice("Push Sandbox thất bại");
    } finally {
      setSandboxPushLoading(false);
    }
  }

  async function runCloudProject(forceRemote = false, skipLoadedCheck = false) {
    if (!workspaceId || (!skipLoadedCheck && !treeItems.length)) {
      setError("Hãy Load repository trước khi chạy.");
      return false;
    }
    setRunLoading(true);
    setError("");
    setNotice("Cloud Sandbox đang cài và chạy dự án…");
    try {
      const response = await fetch("/api/sandbox/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "start",
          workspaceId,
          repo,
          branch,
          githubToken,
          forceRemote,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Không chạy được dự án.");
      setSandboxName(data.sandboxName || "");
      setSandboxRevision(data.revision || "");
      setSandboxRunning(Boolean(data.running));
      setRunLogs(data.logs || "");
      if (data.previewUrl) {
        setPreviewUrl(data.previewUrl);
        setPreviewMode("url");
        setPreviewKey((value) => value + 1);
        setWorkspaceView("preview");
      }
      setNotice(data.running ? "Dự án đang chạy trong Cloud Sandbox" : "Server chưa sẵn sàng");
      return Boolean(data.running);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Cloud Run failed.");
      setNotice("Cloud Run thất bại");
      return false;
    } finally {
      setRunLoading(false);
    }
  }

  async function syncDraft(path: string, content: string) {
    if (!workspaceId || !sandboxRunning) return;
    try {
      const response = await fetch("/api/sandbox/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "sync",
          workspaceId,
          repo,
          branch,
          githubToken,
          files: [{ path, content }],
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Live sync failed.");
      if (data.previewUrl) setPreviewUrl(data.previewUrl);
      setPreviewKey((value) => value + 1);
      setNotice(`Live Preview đã cập nhật • ${path}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Live sync failed.");
    }
  }

  async function testCloudProject() {
    if (!workspaceId || !treeItems.length) {
      setError("Hãy Load repository trước khi test.");
      return;
    }
    setTestLoading(true);
    setError("");
    setWorkspaceView("preview");
    setNotice("Auto Test đang chuẩn bị dependencies → server → typecheck/lint/test/build → smoke…");
    try {
      const response = await fetch("/api/sandbox/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "test",
          workspaceId,
          repo,
          branch,
          githubToken,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Không chạy được test.");
      setSandboxName(data.sandboxName || sandboxName);
      setSandboxRunning(Boolean(data.serverRunning));
      if (data.previewUrl) {
        setPreviewUrl(data.previewUrl);
        setPreviewMode("url");
        setPreviewKey((value) => value + 1);
      }
      const lines = (data.phases || []).map(
        (phase: any) => `${phase.passed ? "✓" : "✗"} phase: ${phase.name}`
      );
      lines.push(...(data.checks || []).map(
        (check: any) => `${check.exitCode === 0 ? "✓" : "✗"} ${check.name}\n${(check.stderr || check.stdout || "").slice(-2500)}`
      ));
      lines.push(`HTTP smoke: ${data.smokeStatus || "unknown"}`);
      setTestSummary(lines.join("\n\n"));
      setRunLogs(data.serverLogs || runLogs);
      setNotice(data.passed ? "Tester: PASS" : "Tester phát hiện lỗi");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Tester failed.");
      setNotice("Tester gặp lỗi");
    } finally {
      setTestLoading(false);
    }
  }

  async function playTestProject() {
    if (!workspaceId || !treeItems.length) {
      setError("Hãy Load repository trước khi play test.");
      return;
    }
    setPlayTestLoading(true);
    setWorkspaceView("preview");
    setPreviewView("replay");
    setPlayScreenshots([]);
    setLiveTestImage("");
    setLiveTestLabel("Đang khởi động browser tester…");
    setPlayReport("");
    setVisualReview("");
    setError("");
    setNotice("AI đang tự chơi thử — bạn có thể xem trực tiếp trong khung điện thoại…");

    try {
      const startResponse = await fetch("/api/sandbox/playtest-live", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "start",
          workspaceId,
          repo,
          branch,
          githubToken,
        }),
      });
      const startData = await startResponse.json();
      if (!startResponse.ok) {
        throw new Error(startData.error || startData.detail || "Không bắt đầu được live play test.");
      }

      if (startData.previewUrl) {
        setPreviewUrl(startData.previewUrl);
        setSandboxRunning(true);
      }
      setSandboxName(startData.sandboxName || sandboxName);
      setPreviewView("replay");

      const runId = String(startData.runId || "");
      if (!runId) throw new Error("Play tester không trả về runId.");

      let finished = false;
      let finalData: any = null;

      for (let i = 0; i < 180; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        const statusResponse = await fetch("/api/sandbox/playtest-live", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "status",
            workspaceId,
            repo,
            branch,
            runId,
          }),
        });
        const statusData = await statusResponse.json();
        if (!statusResponse.ok) {
          throw new Error(statusData.error || "Không đọc được trạng thái play test.");
        }

        finalData = statusData;
        if (statusData.currentImage) setLiveTestImage(statusData.currentImage);
        if (statusData.state?.label) setLiveTestLabel(statusData.state.label);

        const status = statusData.state?.status;
        if (status === "completed" || status === "failed") {
          finished = true;
          break;
        }
      }

      if (!finished) {
        throw new Error("AI Play Test chạy quá lâu. Bạn có thể thử lại sau.");
      }

      const state = finalData?.state || {};
      const shots = Array.isArray(finalData?.screenshots) ? finalData.screenshots : [];
      setPlayScreenshots(shots);
      setPlayStep(Math.max(0, shots.length - 1));

      const actions = Array.isArray(state.actions) ? state.actions : [];
      const consoleErrors = Array.isArray(state.consoleErrors) ? state.consoleErrors : [];
      const pageErrors = Array.isArray(state.pageErrors) ? state.pageErrors : [];
      setPlayReport(
        [
          `Trạng thái: ${state.status || "unknown"}`,
          `Trang: ${state.title || "(không có title)"}`,
          `Actions: ${actions.length}`,
          `Console errors: ${consoleErrors.length}`,
          `Page errors: ${pageErrors.length}`,
          ...consoleErrors.slice(0, 6).map((item: string) => `console: ${item}`),
          ...pageErrors.slice(0, 6).map((item: string) => `page: ${item}`),
          state.error ? `tester: ${state.error}` : "",
        ].filter(Boolean).join("\n")
      );

      setLiveTestLabel(state.status === "completed" ? "Hoàn tất" : "Tester gặp lỗi");
      setNotice(
        state.status === "completed"
          ? "AI Play Test hoàn tất — bạn có thể xem lại từng bước"
          : "AI Play Test phát hiện lỗi"
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Live play test failed.");
      setNotice("AI Play Test gặp lỗi");
    } finally {
      setPlayTestLoading(false);
    }
  }

  async function openReview() {
    if (!sandboxRunning) await runCloudProject();
    setTab("diff");
    setWorkspaceView("changes");
  }

  async function connectCodexAccount() {
    if (!workspaceId) return;
    setCodexConnecting(true);
    setCodexStatus("waiting");
    setCodexVerificationUrl("");
    setCodexUserCode("");
    setCodexDetail("");
    setCodexPhase("starting");
    setError("");
    setNotice("Đang cài/khởi động Codex CLI và tạo mã thiết bị…");

    try {
      const response = await fetch("/api/agent/codex-auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId, action: "start" }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Không bắt đầu được Codex login.");
      if (data.status === "error") throw new Error(data.error || data.detail || "Codex device login lỗi.");

      if (data.verificationUrl) setCodexVerificationUrl(data.verificationUrl);
      if (data.userCode) setCodexUserCode(data.userCode);
      if (data.detail) setCodexDetail(data.detail);
      if (data.phase) setCodexPhase(data.phase);
      if (data.phase) setCodexPhase(data.phase);

      if (data.verificationUrl && data.userCode) {
        window.open(data.verificationUrl, "_blank", "noopener,noreferrer");
        setNotice(`Mã thiết bị ${data.userCode} đã sẵn sàng • hoàn tất đăng nhập trong tab mới`);
      } else {
        setNotice("Codex đang tạo mã thiết bị…");
      }

      for (let i = 0; i < 290; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 3000));
        const statusResponse = await fetch("/api/agent/codex-auth", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ workspaceId, action: "status" }),
        });
        const statusData = await statusResponse.json();
        if (!statusResponse.ok) {
          throw new Error(statusData.error || "Không kiểm tra được Codex login.");
        }

        if (statusData.verificationUrl) setCodexVerificationUrl(statusData.verificationUrl);
        if (statusData.userCode) setCodexUserCode(statusData.userCode);
        if (statusData.detail) setCodexDetail(statusData.detail);
        if (statusData.phase) setCodexPhase(statusData.phase);

        if (statusData.status === "error") {
          throw new Error(statusData.error || statusData.detail || "Codex login lỗi.");
        }

        if (statusData.connected) {
          setCodexStatus("connected");
          setCodexPhase("complete");
          setAiProvider("codex-account");
          setCodexUserCode("");
          setNotice(`Đã kết nối ChatGPT/Codex${statusData.version ? ` • ${statusData.version}` : ""}`);
          void loadCodexUsage(false);
          void loadCodexModels(false);
          return;
        }

        if (statusData.userCode) {
          setCodexStatus("waiting");
          setNotice(`Đang chờ xác nhận mã ${statusData.userCode} trên ChatGPT…`);
        }
      }

      setCodexPhase("timeout");
      setNotice("Mã đăng nhập đã hết thời gian chờ. Bấm Kết nối ChatGPT để tạo mã mới.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Codex login failed.");
      setCodexStatus("disconnected");
      setCodexPhase("error");
      setNotice("Kết nối ChatGPT/Codex chưa hoàn tất");
    } finally {
      setCodexConnecting(false);
    }
  }

  async function checkCodexAccount() {
    if (!workspaceId) return;
    try {
      const response = await fetch("/api/agent/codex-auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId, action: "status" }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Không kiểm tra được Codex.");
      setCodexStatus(data.connected ? "connected" : data.status === "error" ? "disconnected" : "waiting");
      if (data.verificationUrl) setCodexVerificationUrl(data.verificationUrl);
      if (data.userCode) setCodexUserCode(data.userCode);
      if (data.detail) setCodexDetail(data.detail);
      if (data.status === "error") {
        setError(data.error || data.detail || "Codex login lỗi.");
      }
      setNotice(data.connected ? "ChatGPT/Codex đang kết nối" : data.userCode ? `Đang chờ mã ${data.userCode}` : "Codex chưa đăng nhập xong");
      if (data.connected) {
        void loadCodexUsage(false);
        void loadCodexModels(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Codex status failed.");
    }
  }

  async function loadCodexUsage(announce = false) {
    if (!workspaceId) return;
    setCodexUsageLoading(true);
    try {
      const response = await fetch("/api/agent/codex-auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId, action: "usage" }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Không đọc được hạn mức Codex.");
      setCodexUsage(data);
      if (announce) setNotice("Đã làm mới hạn mức ChatGPT/Codex");
    } catch (err) {
      if (announce) setError(err instanceof Error ? err.message : "Không đọc được hạn mức Codex.");
    } finally {
      setCodexUsageLoading(false);
    }
  }

  async function loadCodexModels(announce = false) {
    if (!workspaceId) return;
    setCodexModelsLoading(true);
    try {
      const response = await fetch("/api/agent/codex-auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId, action: "models" }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Không đọc được danh sách model Codex.");

      const models = Array.isArray(data.models) ? data.models : [];
      setCodexModels(models);

      if (models.length) {
        const current = models.find((item: CodexModelOption) => item.model === codexModel);
        const selected = current || models.find((item: CodexModelOption) => item.isDefault) || models[0];
        if (!current) setCodexModel(selected.model);

        const efforts = Array.isArray(selected.supportedReasoningEfforts)
          ? selected.supportedReasoningEfforts.map((item: any) => item.reasoningEffort)
          : [];

        if (efforts.length && !efforts.includes(codexReasoning)) {
          setCodexReasoning(selected.defaultReasoningEffort || efforts[0]);
        }
      }

      if (announce) setNotice(`Đã tải ${models.length} model Codex khả dụng`);
    } catch (err) {
      if (announce) setError(err instanceof Error ? err.message : "Không đọc được model Codex.");
    } finally {
      setCodexModelsLoading(false);
    }
  }

  function chooseCodexModel(nextModel: string) {
    setCodexModel(nextModel);
    const selected = codexModels.find((item) => item.model === nextModel);
    const efforts = selected?.supportedReasoningEfforts?.map((item) => item.reasoningEffort) || [];
    if (efforts.length && !efforts.includes(codexReasoning)) {
      setCodexReasoning(selected?.defaultReasoningEffort || efforts[0]);
    }
  }

  async function diagnoseCodexAccount() {
    if (!workspaceId) return;
    setCodexDiagnosing(true);
    setError("");
    setNotice("Đang chẩn đoán Codex CLI và kết nối auth.openai.com…");

    try {
      const response = await fetch("/api/agent/codex-auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId, action: "diagnostics" }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Không chạy được chẩn đoán Codex.");

      const lines = [
        data.version ? `Codex: ${data.version}` : "",
        data.source ? `Nguồn CLI: ${data.source}` : "",
        data.state ? `State: ${JSON.stringify(data.state, null, 2)}` : "",
        data.loginStatus ? `Login status:\n${data.loginStatus}` : "",
        data.dns ? `DNS:\n${data.dns}` : "",
        data.connectivity ? `auth.openai.com:\n${data.connectivity}` : "",
        data.log ? `App-server log:\n${data.log}` : "",
      ].filter(Boolean);

      setCodexDetail(lines.join("\n\n"));
      setNotice("Đã chẩn đoán Codex • mở Chi tiết kỹ thuật để xem kết quả");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Codex diagnostics failed.");
      setNotice("Chẩn đoán Codex gặp lỗi");
    } finally {
      setCodexDiagnosing(false);
    }
  }

  function referencePreviewUrl(item: ReferenceImage) {
    const query = new URLSearchParams({
      workspaceId,
      repo,
      branch,
      path: item.path,
    });
    return `/api/sandbox/reference-images?${query.toString()}`;
  }

  async function uploadReferenceFiles(files: File[]) {
    const available = Math.max(0, 5 - referenceImages.length);
    const selectedFiles = files
      .filter((file) => ["image/png", "image/jpeg", "image/webp"].includes(file.type))
      .slice(0, available);

    if (!selectedFiles.length) {
      setError(
        referenceImages.length >= 5
          ? "Tối đa 5 ảnh tham chiếu cho một project."
          : "Chỉ hỗ trợ PNG, JPG/JPEG và WEBP.",
      );
      return;
    }

    setReferenceUploading(true);
    setError("");
    setNotice(`Đang tải ${selectedFiles.length} ảnh tham chiếu…`);

    try {
      const uploaded: ReferenceImage[] = [];
      for (const file of selectedFiles) {
        if (file.size > 4 * 1024 * 1024) {
          throw new Error(`${file.name} lớn hơn 4 MB.`);
        }

        const form = new FormData();
        form.append("workspaceId", workspaceId);
        form.append("repo", repo);
        form.append("branch", branch);
        form.append("file", file);

        const response = await fetch("/api/sandbox/reference-images", {
          method: "POST",
          headers: apiHeaders(),
          body: form,
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || `Không upload được ${file.name}.`);

        uploaded.push({
          id: data.id,
          name: data.name,
          size: data.size,
          mimeType: data.mimeType,
          path: data.path,
          kind: "style",
          note: "",
          active: true,
        });
      }

      setReferenceImages((current) => [...current, ...uploaded].slice(0, 5));
      setNotice(`Đã thêm ${uploaded.length} ảnh tham chiếu • Codex sẽ nhận ảnh trực tiếp`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload ảnh thất bại.");
    } finally {
      setReferenceUploading(false);
      setReferenceDragOver(false);
    }
  }

  function patchReferenceImage(id: string, patch: Partial<ReferenceImage>) {
    setReferenceImages((current) =>
      current.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    );
  }

  async function removeReferenceImage(item: ReferenceImage) {
    setReferenceImages((current) => current.filter((entry) => entry.id !== item.id));
    try {
      await fetch("/api/sandbox/reference-images", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          repo,
          branch,
          path: item.path,
        }),
      });
    } catch {
      // UI removal should still succeed if cleanup in the ephemeral workspace fails.
    }
  }

  async function clearReferenceImages() {
    const items = [...referenceImages];
    setReferenceImages([]);
    await Promise.allSettled(
      items.map((item) =>
        fetch("/api/sandbox/reference-images", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            workspaceId,
            repo,
            branch,
            path: item.path,
          }),
        }),
      ),
    );
    setNotice("Đã xóa ảnh tham chiếu");
  }

  async function askAI() {
    if (!selected || !aiReady) return;
    setAiLoading(true);
    setError("");
    setNotice("AI đang phân tích file…");
    try {
      const response = await fetch("/api/ai/edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: "openai",
          apiKey: openAIKey,
          model,
          prompt,
          filePath: selected.path,
          content: editorContent,
          projectContext,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "AI không xử lý được yêu cầu.");
      setProposal(data.content);
      setProposalSummary(data.summary);
      setTab("diff");
      setWorkspaceView("changes");
      setNotice(`AI đã tạo đề xuất bằng ${data.model}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "AI request failed.");
      setNotice("AI gặp lỗi");
    } finally {
      setAiLoading(false);
    }
  }

  async function runCodexRepairPrompt(
    promptText: string,
    extraReferences: Array<{ path: string; name: string; kind: string; note: string }> = [],
  ) {
    const activeReferences = [
      ...referenceImages.filter((item) => item.active).map((item) => ({
        path: item.path,
        name: item.name,
        kind: item.kind,
        note: item.note,
      })),
      ...extraReferences,
    ].slice(0, 12);

    const startResponse = await fetch("/api/agent/codex-edit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "run",
        workspaceId,
        repo,
        branch,
        githubToken,
        prompt: promptText,
        codexModel,
        codexReasoning,
        referenceImages: activeReferences.map((item) => ({
          path: item.path,
          name: item.name,
          kind: item.kind,
          note: item.note,
        })),
      }),
    });
    const startData = await startResponse.json();
    if (!startResponse.ok) {
      throw new Error(startData.error || "Không khởi động được Codex repair Agent.");
    }

    setAiProgress(Math.max(15, Number(startData.progress?.percent || 15)));
    setAiProgressLabel(startData.progress?.phase || "Codex đang sửa theo Visual Director…");
    setAiProgressDetail(startData.progress?.detail || "");

    let finished = false;
    let consecutivePollErrors = 0;

    for (let i = 0; i < 900; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      try {
        const statusResponse = await fetch("/api/agent/codex-edit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "status",
            workspaceId,
            repo,
            branch,
          }),
        });
        const state = await statusResponse.json();
        if (!statusResponse.ok) {
          consecutivePollErrors += 1;
          if (consecutivePollErrors >= 8) {
            throw new Error(state.error || "Mất kết nối trạng thái Codex.");
          }
          continue;
        }

        consecutivePollErrors = 0;
        if (typeof state.percent === "number") setAiProgress(state.percent);
        if (state.phase) setAiProgressLabel(state.phase);
        setAiProgressDetail(state.detail || "");
        if (typeof state.elapsedSeconds === "number") {
          setAiElapsedSeconds(state.elapsedSeconds);
        }
        if (state.error) throw new Error(state.error);

        if (state.finished) {
          finished = true;
          break;
        }
      } catch (pollError) {
        consecutivePollErrors += 1;
        if (consecutivePollErrors >= 8) throw pollError;
      }
    }

    if (!finished) {
      throw new Error("Codex repair vẫn chạy sau 30 phút.");
    }

    const resultResponse = await fetch("/api/agent/codex-edit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "result",
        workspaceId,
        repo,
        branch,
        githubToken,
        codexModel,
        codexReasoning,
      }),
    });
    const data = await resultResponse.json();
    if (!resultResponse.ok) {
      throw new Error(data.error || "Không lấy được kết quả Visual Repair.");
    }

    setProjectProposals(data.files || []);
    setProjectSummary(data.summary || "");
    setProjectPlan(data.plan || "");
    if (data.usage) setAiRunUsage(data.usage);

    if (data.previewUrl) {
      setPreviewUrl(data.previewUrl);
      setPreviewMode("url");
      setPreviewKey((value) => value + 1);
      setSandboxRunning(Boolean(data.serverRunning ?? true));
    }

    if (data.checks) {
      const lines = (data.checks.checks || []).map(
        (check: any) =>
          `${check.exitCode === 0 ? "✓" : "✗"} ${check.name}\n${(check.stderr || check.stdout || "").slice(-1800)}`,
      );
      if (data.checks.smokeStatus) {
        lines.push(`HTTP smoke: ${data.checks.smokeStatus}`);
      }
      setTestSummary(lines.join("\n\n"));
    }

    return data;
  }

  async function requestVisualAudit() {
    const activeReferences = referenceImages.filter((item) => item.active);
    const response = await fetch("/api/agent/visual-audit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workspaceId,
        repo,
        branch,
        githubToken,
        codexModel,
        codexReasoning,
        referenceImages: activeReferences.map((item) => ({
          path: item.path,
          name: item.name,
          kind: item.kind,
          note: item.note,
        })),
      }),
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || data.detail || "Visual Director audit thất bại.");
    }
    return data;
  }

  async function visualLoopProject() {
    if (!workspaceId || !treeItems.length) {
      setError("Hãy Load repository trước.");
      return;
    }
    if (codexStatus !== "connected") {
      setError("Hãy kết nối ChatGPT/Codex trước khi chạy Visual Loop.");
      return;
    }

    setVisualLoopLoading(true);
    setAiLoading(true);
    setError("");
    setVisualReview("");
    setPlayScreenshots([]);
    setPlayReport("");
    setWorkspaceView("preview");
    setPreviewView("replay");
    setAiProgress(5);
    setAiProgressLabel("Visual Director đang chụp các màn…");
    setAiProgressDetail("");
    setNotice("Visual Loop: chụp app → so reference → sửa → chụp lại…");

    try {
      setVisualLoopStage("Audit vòng 1");
      const before = await requestVisualAudit();

      if (before.previewUrl) {
        setPreviewUrl(before.previewUrl);
        setSandboxRunning(true);
      }
      const beforeShots = Array.isArray(before.screenshots)
        ? before.screenshots.map((item: any) => item.image).filter(Boolean)
        : [];
      if (beforeShots.length) {
        setPlayScreenshots(beforeShots);
        setPlayStep(0);
      }

      setVisualReview(`VISUAL DIRECTOR • VÒNG 1\n\n${before.report || ""}`);

      const runtimeErrors = [
        ...(before.runtime?.consoleErrors || []),
        ...(before.runtime?.pageErrors || []),
      ];

      if (before.verdict === "PASS" && runtimeErrors.length === 0) {
        setAiProgress(100);
        setAiProgressLabel("Visual QA PASS");
        setNotice("Visual Director: PASS • chưa cần sửa thêm");
        return;
      }

      setVisualLoopStage("Codex đang sửa");
      setAiProgress(15);
      setAiProgressLabel("Đang gửi audit cho Codex sửa…");

      const repairPrompt = [
        before.fixPrompt || before.report || "",
        "",
        "ADDITIONAL VIBAOCODE LOOP RULES:",
        "- Work directly in the current repository.",
        "- Preserve all existing gameplay, save data and progression.",
        "- Fix visual/layout/runtime issues from the audit, not unrelated features.",
        "- Reuse the attached reference images according to their category/note.",
        "- Run build/typecheck after editing.",
        "- Do not commit or push.",
      ].join("\n");

      await runCodexRepairPrompt(
        repairPrompt,
        Array.isArray(before.runtimeReferences) ? before.runtimeReferences : [],
      );

      setVisualLoopStage("Audit vòng 2");
      setAiProgress(90);
      setAiProgressLabel("Visual Director đang chụp lại sau khi sửa…");
      setAiProgressDetail("");

      const after = await requestVisualAudit();
      const afterShots = Array.isArray(after.screenshots)
        ? after.screenshots.map((item: any) => item.image).filter(Boolean)
        : [];
      if (afterShots.length) {
        setPlayScreenshots(afterShots);
        setPlayStep(0);
      }

      setVisualReview(
        [
          "VISUAL DIRECTOR • TRƯỚC KHI SỬA",
          before.report || "",
          "",
          "================================================",
          "",
          "VISUAL DIRECTOR • SAU KHI SỬA",
          after.report || "",
        ].join("\n"),
      );

      const afterRuntimeErrors = [
        ...(after.runtime?.consoleErrors || []),
        ...(after.runtime?.pageErrors || []),
      ];

      setAiProgress(100);
      setAiElapsedSeconds(0);
      setAiProgressLabel(
        after.verdict === "PASS" && afterRuntimeErrors.length === 0
          ? "Visual Loop PASS"
          : "Visual Loop xong • còn điểm cần polish",
      );
      setAiProgressDetail(
        after.verdict === "PASS"
          ? "Screenshot vòng 2 đạt"
          : "Visual Director vẫn đề xuất thêm một vòng sửa",
      );
      setNotice(
        after.verdict === "PASS" && afterRuntimeErrors.length === 0
          ? "Visual Loop hoàn tất • PASS"
          : "Visual Loop hoàn tất • xem báo cáo vòng 2",
      );

      if (after.previewUrl) {
        setPreviewUrl(after.previewUrl);
        setPreviewMode("url");
        setPreviewKey((value) => value + 1);
      }

      void loadCodexUsage(false);
    } catch (err) {
      setAiProgress(0);
      setAiProgressLabel("Visual Loop gặp lỗi");
      setAiProgressDetail("");
      setError(err instanceof Error ? err.message : "Visual Loop failed.");
      setNotice("Visual Loop gặp lỗi");
    } finally {
      setVisualLoopLoading(false);
      setAiLoading(false);
      setVisualLoopStage("");
    }
  }

  async function askProjectAI() {
    if (!aiReady || aiScope !== "project") return;
    setAiLoading(true);
    setError("");
    setProjectProposals([]);
    setProjectSummary("");
    setProjectPlan("");
    setAiRunUsage(null);
    setAiProgress(2);
    setAiProgressLabel("Đang chuẩn bị AI Agent…");
    setAiProgressDetail("");
    setAiElapsedSeconds(0);
    setNotice("Project Agent đang chuẩn bị workspace…");

    try {
      const useCodexAccount = aiProvider === "codex-account";
      const useExternalProvider = aiProvider === "claude-api" || aiProvider === "gemini-api";
      const activeReferences = referenceImages.filter((item) => item.active);
      const referenceText = activeReferences.length
        ? "\n\nREFERENCE IMAGE METADATA:\n" +
          activeReferences
            .map(
              (item, index) =>
                `${index + 1}. ${item.name} • type=${item.kind}${item.note ? ` • note=${item.note}` : ""}`,
            )
            .join("\n")
        : "";
      let data: any;

      if (useCodexAccount) {
        if (!sandboxRunning) {
          setAiProgress(4);
          setAiProgressLabel("Đang khởi động Cloud Runtime…");
          const started = await runCloudProject();
          if (!started) throw new Error("Không khởi động được Live Preview trước khi Codex sửa code.");
        }

        setAiProgress(6);
        setAiProgressLabel("Đang gửi công việc cho Codex…");

        const startResponse = await fetch("/api/agent/codex-edit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "run",
            workspaceId,
            repo,
            branch,
            githubToken,
            prompt,
            codexModel,
            codexReasoning,
            referenceImages: activeReferences.map((item) => ({
              path: item.path,
              name: item.name,
              kind: item.kind,
              note: item.note,
            })),
          }),
        });
        const startData = await startResponse.json();
        if (!startResponse.ok) {
          throw new Error(startData.error || "Không khởi động được Codex Agent.");
        }

        setAiProgress(Math.max(15, Number(startData.progress?.percent || 15)));
        setAiProgressLabel(startData.progress?.phase || "Codex đang làm việc trong Cloud Sandbox…");
        setAiProgressDetail(startData.progress?.detail || "");
        setNotice("Codex đang chạy nền • có thể xử lý yêu cầu lớn trong nhiều phút");

        let finished = false;
        let consecutivePollErrors = 0;

        // Codex runs as a background process inside the persistent Sandbox.
        // The browser only polls lightweight status requests, so a long design/
        // refactor task is no longer limited by Vercel's single-request timeout.
        for (let i = 0; i < 900; i += 1) {
          await new Promise((resolve) => setTimeout(resolve, 2000));

          try {
            const statusResponse = await fetch("/api/agent/codex-edit", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                action: "status",
                workspaceId,
                repo,
                branch,
              }),
            });
            if (!statusResponse.ok) {
              consecutivePollErrors += 1;
              if (consecutivePollErrors >= 8) {
                throw new Error("Mất kết nối với trạng thái Codex quá lâu.");
              }
              continue;
            }

            consecutivePollErrors = 0;
            const state = await statusResponse.json();
            if (typeof state.percent === "number") setAiProgress(state.percent);
            if (state.phase) setAiProgressLabel(state.phase);
            setAiProgressDetail(state.detail || "");
            if (typeof state.elapsedSeconds === "number") setAiElapsedSeconds(state.elapsedSeconds);

            if (state.error) {
              throw new Error(state.error);
            }

            if (state.finished) {
              finished = true;
              break;
            }
          } catch (pollError) {
            consecutivePollErrors += 1;
            if (consecutivePollErrors >= 8) throw pollError;
          }
        }

        if (!finished) {
          throw new Error(
            "Codex vẫn đang chạy sau 30 phút. Workspace được giữ nguyên; hãy thử lại hoặc chia tác vụ nếu cần.",
          );
        }

        setAiProgress(72);
        setAiProgressLabel("Codex đã xong • đang dựng preview và chạy test…");

        const resultResponse = await fetch("/api/agent/codex-edit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "result",
            workspaceId,
            repo,
            branch,
            githubToken,
            codexModel,
            codexReasoning,
          }),
        });
        data = await resultResponse.json();
        if (!resultResponse.ok) {
          throw new Error(data.error || "Không lấy được kết quả Codex.");
        }
      } else {
        const endpoint = useExternalProvider
          ? "/api/ai/provider-project"
          : "/api/ai/project";

        setAiProgress(15);
        setAiProgressLabel("AI đang đọc ngữ cảnh dự án…");

        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            useExternalProvider
              ? {
                  provider: aiProvider === "claude-api" ? "anthropic" : "gemini",
                  apiKey: aiProvider === "claude-api" ? anthropicKey : geminiKey,
                  repo,
                  branch,
                  githubToken,
                  prompt: prompt + referenceText,
                  projectContext,
                }
              : {
                  repo,
                  branch,
                  githubToken,
                  apiKey: openAIKey,
                  model,
                  prompt: prompt + referenceText,
                  projectContext,
                }
          ),
        });
        data = await response.json();
        if (!response.ok) throw new Error(data.error || "Project Agent không xử lý được yêu cầu.");
      }

      setAiProgress(96);
      setAiProgressLabel("Đang cập nhật preview và kết quả…");

      setProjectProposals(data.files || []);
      setProjectSummary(data.summary || "");
      setProjectPlan(data.plan || "");
      if (data.usage) setAiRunUsage(data.usage);

      if (data.previewUrl) {
        setPreviewUrl(data.previewUrl);
        setPreviewMode("url");
        setPreviewKey((value) => value + 1);
        setSandboxRunning(Boolean(data.serverRunning ?? true));
      }
      if (data.checks) {
        const result = data.checks;
        const lines = (result.checks || []).map(
          (check: any) => `${check.exitCode === 0 ? "✓" : "✗"} ${check.name}\n${(check.stderr || check.stdout || "").slice(-1800)}`
        );
        if (result.smokeStatus) lines.push(`HTTP smoke: ${result.smokeStatus}`);
        setTestSummary(lines.join("\n\n"));
      }

      setAiProgress(100);
      setAiElapsedSeconds(0);
      setAiProgressLabel(data.checks?.passed === false ? "Hoàn tất • cần review test" : "Hoàn tất");
      setAiProgressDetail(`${data.files?.length || 0} file thay đổi`);
      setNotice(`Project Agent đề xuất ${data.files?.length || 0} file bằng ${data.model || "AI"}`);

      if (useCodexAccount) void loadCodexUsage(false);
    } catch (err) {
      setAiProgress(0);
      setAiProgressLabel("Agent gặp lỗi");
      setAiProgressDetail("");
      setError(err instanceof Error ? err.message : "Project Agent failed.");
      setNotice("Project Agent gặp lỗi");
    } finally {
      setAiLoading(false);
    }
  }

  async function cancelProjectAI() {
    if (!workspaceId || aiProvider !== "codex-account") return;
    try {
      await fetch("/api/agent/codex-edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "cancel",
          workspaceId,
          repo,
          branch,
        }),
      });
      setAiLoading(false);
      setAiProgress(0);
      setAiElapsedSeconds(0);
      setAiProgressLabel("Agent đã được dừng");
      setAiProgressDetail("");
      setNotice("Đã dừng Codex Agent");
    } catch {
      setNotice("Không dừng được Codex Agent");
    }
  }

  function reviewProjectProposal(item: ProjectProposal) {
    setSelected({ path: item.path, sha: item.sha, size: item.size });
    setOriginalContent(item.originalContent);
    setEditorContent(item.originalContent);
    setProposal(item.content);
    setProposalSummary(item.reason);
    setTab("diff");
    setWorkspaceView("changes");
    setNotice(`Đang review đề xuất cho ${item.path}`);
  }

  async function applyProposal() {
    if (!proposal) return;
    const nextContent = proposal;
    setEditorContent(nextContent);
    setProposal("");
    setProposalSummary("");
    setTab("code");
    setWorkspaceView("preview");
    setNotice("Đã áp dụng đề xuất vào bản nháp. Chưa push GitHub.");
    if (selected && sandboxRunning) {
      await syncDraft(selected.path, nextContent);
    }
  }

  function undoDraft() {
    setEditorContent(originalContent);
    setProposal("");
    setProposalSummary("");
    setTab("code");
    setNotice("Đã hoàn tác về phiên bản đang có trên GitHub");
  }

  async function createReviewBranch() {
    if (!githubToken) {
      setSettingsOpen(true);
      setError("Thêm GitHub token trong Settings để tạo review branch.");
      return;
    }
    if (reviewBase) {
      setNotice(`Bạn đang ở review branch ${branch}`);
      return;
    }

    const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 12);
    const newBranch = `vibaocode/review-${stamp}`;
    setBranchLoading(true);
    setError("");
    setNotice("Đang tạo review branch…");

    try {
      const response = await fetch("/api/github/branch", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-github-token": githubToken,
        },
        body: JSON.stringify({
          repo,
          baseBranch: branch,
          newBranch,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Không tạo được review branch.");

      setReviewBase(branch);
      setBranch(data.branch);
      setPrUrl("");
      setNotice(`Đã tạo ${data.branch}. Mọi Push tiếp theo sẽ vào branch này.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không tạo được review branch.");
      setNotice("Tạo branch thất bại");
    } finally {
      setBranchLoading(false);
    }
  }

  async function openPullRequest() {
    if (!githubToken) {
      setSettingsOpen(true);
      setError("Thêm GitHub token trong Settings để mở pull request.");
      return;
    }
    if (!reviewBase || reviewBase === branch) {
      setError("Hãy tạo Review branch trước khi mở pull request.");
      return;
    }

    setPrLoading(true);
    setError("");
    setNotice("Đang mở pull request…");

    try {
      const response = await fetch("/api/github/pr", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-github-token": githubToken,
        },
        body: JSON.stringify({
          repo,
          head: branch,
          base: reviewBase,
          title: `Vibaocode review: ${branch.replace("vibaocode/", "")}`,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Không mở được pull request.");

      setPrUrl(data.url);
      setNotice(`Đã mở PR #${data.number}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không mở được pull request.");
      setNotice("Mở PR thất bại");
    } finally {
      setPrLoading(false);
    }
  }

  async function saveToGitHub() {
    if (!selected || !dirty) return;
    if (!githubToken) {
      setSettingsOpen(true);
      setError("Thêm GitHub token trong Settings để push thay đổi.");
      return;
    }

    setSaving(true);
    setError("");
    setNotice("Đang commit lên GitHub…");
    try {
      const response = await fetch("/api/github/file", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-github-token": githubToken,
        },
        body: JSON.stringify({
          repo,
          branch,
          path: selected.path,
          sha: selected.sha,
          content: editorContent,
          message: `Vibaocode: update ${selected.path}`,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Không push được GitHub.");
      setSelected((prev) =>
        prev ? { ...prev, sha: data.contentSha || prev.sha, size: editorContent.length } : prev
      );
      setOriginalContent(editorContent);
      setNotice(`Đã push commit ${String(data.commitSha || "").slice(0, 7)}`);
      setPreviewKey((value) => value + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không push được GitHub.");
      setNotice("Push thất bại");
    } finally {
      setSaving(false);
    }
  }

  const oldLines = originalContent.split("\n");
  const newLines = (proposal || editorContent).split("\n");
  const maxDiffLines = Math.max(oldLines.length, newLines.length);
  const htmlPreview = selected?.path.endsWith(".html") ? editorContent : "";

  return (
    <main className="workspace">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark"><Code2 size={20} /></div>
          <div>
            <strong>Vibaocode</strong>
            <span>AI review workspace</span>
          </div>
        </div>

        <div className="repo-strip">
          <Github size={16} />
          <span>{repo}</span>
          <GitBranch size={14} />
          <span>{branch}</span>
        </div>

        <div className="top-actions">
          <span className={`status-dot ${error ? "danger" : ""}`} />
          <span className="status-copy">{notice}</span>
          <button className="icon-button" onClick={() => setSettingsOpen(true)} title="Settings" type="button">
            <Settings size={18} />
          </button>
        </div>
      </header>

      {error ? (
        <div className="error-banner">
          <span>{error}</span>
          <button onClick={() => setError("")} type="button"><X size={16} /></button>
        </div>
      ) : null}

      <section className={`builder-grid ${rightPanelOpen ? "" : "right-closed"}`}>
        <aside className="project-sidebar">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">PROJECT</span>
              <strong>GitHub Project</strong>
            </div>
            <button
              className="icon-button small"
              onClick={connectRepo}
              disabled={repoLoading}
              title="Reload repository"
              type="button"
            >
              {repoLoading ? <Loader2 className="spin" size={15} /> : <RefreshCw size={15} />}
            </button>
          </div>

          <div className="repo-quick">
            {githubUser ? (
              <>
                <div className="github-account-mini">
                  {githubUser.avatarUrl ? <img src={githubUser.avatarUrl} alt="" /> : <Github size={17} />}
                  <div>
                    <strong>{githubUser.name}</strong>
                    <span>@{githubUser.login}</span>
                  </div>
                  <button className="icon-button small" onClick={() => setSettingsOpen(true)} title="GitHub settings" type="button">
                    <Settings size={14} />
                  </button>
                </div>
                <label className="repo-select-label">
                  <span>Dự án</span>
                  <select value={repo} onChange={(e) => chooseGithubRepo(e.target.value)}>
                    {!githubRepos.some((item) => item.fullName === repo) ? (
                      <option value={repo}>{repo}</option>
                    ) : null}
                    {githubRepos.map((item) => (
                      <option key={item.fullName} value={item.fullName}>
                        {item.name}{item.private ? " • private" : ""}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            ) : (
              <>
                <button className="github-connect-button" onClick={() => setSettingsOpen(true)} type="button">
                  <Github size={16} />
                  Kết nối GitHub
                </button>
                <input value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="owner/repo" />
              </>
            )}
            <div className="repo-quick-row">
              <input
                value={branch}
                onChange={(e) => {
                  setBranch(e.target.value);
                  setReviewBase("");
                  setPrUrl("");
                }}
                placeholder="main"
              />
              <button onClick={connectRepo} disabled={repoLoading} type="button">
                {repoLoading ? <Loader2 className="spin" size={15} /> : <Play size={15} />}
                Load
              </button>
            </div>
          </div>

          <div className="project-nav">
            <button
              className={workspaceView === "preview" ? "active" : ""}
              onClick={() => setWorkspaceView("preview")}
              type="button"
            >
              <MonitorSmartphone size={15} />
              <span>Preview</span>
            </button>
            <button
              className={workspaceView === "code" ? "active" : ""}
              onClick={() => setWorkspaceView("code")}
              type="button"
            >
              <Code2 size={15} />
              <span>Code</span>
            </button>
            <button
              className={workspaceView === "changes" ? "active" : ""}
              onClick={() => setWorkspaceView("changes")}
              type="button"
            >
              <Eye size={15} />
              <span>Changes</span>
            </button>
          </div>

          <div className="search-box">
            <Search size={14} />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Tìm file…" />
          </div>

          <div className="file-area">
            {tree.length ? (
              <TreeBranch nodes={tree} selectedPath={selected?.path || ""} search={search} onOpen={openFile} />
            ) : (
              <div className="empty-state compact">
                <Github size={26} />
                <p>Bấm <strong>Load</strong> để mở dự án.</p>
                <span>Repo public không cần token.</span>
              </div>
            )}
          </div>

          <div className="sidebar-foot">
            <span>{treeItems.filter((x) => x.type === "blob").length} files</span>
            <span>{sandboxRunning ? "Cloud ✓" : "Cloud idle"}</span>
          </div>
        </aside>

        <section className="builder-main">
          <div className="builder-toolbar">
            <div className="view-tabs">
              <button
                className={workspaceView === "preview" ? "active" : ""}
                onClick={() => setWorkspaceView("preview")}
                type="button"
              >
                <MonitorSmartphone size={14} /> App
              </button>
              <button
                className={workspaceView === "code" ? "active" : ""}
                onClick={() => setWorkspaceView("code")}
                type="button"
              >
                <Code2 size={14} /> Code
              </button>
              <button
                className={workspaceView === "changes" ? "active" : ""}
                onClick={() => setWorkspaceView("changes")}
                type="button"
              >
                <Eye size={14} /> Changes
              </button>
            </div>

            <div className="builder-actions">
              <button
                className="run-button"
                onClick={() => { void runCloudProject(); }}
                disabled={!treeItems.length || runLoading}
                type="button"
              >
                {runLoading ? <Loader2 className="spin" size={15} /> : <Play size={15} />}
                Run
              </button>
              <button
                className="ghost-button"
                onClick={testCloudProject}
                disabled={!treeItems.length || testLoading}
                type="button"
              >
                {testLoading ? <Loader2 className="spin" size={14} /> : <Check size={14} />}
                Test
              </button>
              <button
                className="ghost-button"
                onClick={playTestProject}
                disabled={!treeItems.length || playTestLoading}
                type="button"
              >
                {playTestLoading ? <Loader2 className="spin" size={14} /> : <Bot size={14} />}
                AI Play
              </button>
              <button
                className="ghost-button"
                onClick={createReviewBranch}
                disabled={branchLoading || Boolean(reviewBase)}
                type="button"
              >
                {branchLoading ? <Loader2 className="spin" size={14} /> : <GitBranch size={14} />}
                Branch
              </button>
              <button
                className="primary-button"
                onClick={dirty ? saveToGitHub : pushSandboxHead}
                disabled={dirty ? saving : (!sandboxRunning || sandboxPushLoading)}
                title={dirty ? "Push file đang sửa" : "Push commit hiện tại trong Cloud Sandbox"}
                type="button"
              >
                {dirty ? (
                  saving ? <Loader2 className="spin" size={14} /> : <Save size={14} />
                ) : (
                  sandboxPushLoading ? <Loader2 className="spin" size={14} /> : <Upload size={14} />
                )}
                {dirty ? "Push" : (sandboxPushLoading ? "Pushing…" : "Push Sandbox")}
              </button>
              <button
                className="icon-button small drawer-control"
                onClick={() => setRightPanelOpen((value) => !value)}
                title={rightPanelOpen ? "Đóng AI panel" : "Mở AI panel"}
                type="button"
              >
                {rightPanelOpen ? <ChevronRight size={15} /> : <ChevronLeft size={15} />}
              </button>
            </div>
          </div>

          <div className="builder-stage">
            {workspaceView === "preview" ? (
              <div className="preview-workbench">
                <div className="preview-workbench-head">
                  <div>
                    <span className="stage-kicker">LIVE PREVIEW</span>
                    <strong>{sandboxRunning ? "App đang chạy" : treeItems.length ? "Sẵn sàng chạy" : "Chưa mở dự án"}</strong>
                  </div>
                  <div className="preview-head-actions">
                    <select
                      value={device.label}
                      onChange={(e) => setDevice(devices.find((item) => item.label === e.target.value) || devices[1])}
                    >
                      {devices.map((item) => (
                        <option key={item.label} value={item.label}>{item.label}</option>
                      ))}
                    </select>
                    <button className="icon-button small" onClick={() => setPreviewKey((v) => v + 1)} type="button">
                      <RefreshCw size={15} />
                    </button>
                  </div>
                </div>

                <div className="preview-canvas">
                  <div className="preview-background-glow" />
                  <div
                    className="phone-frame builder-phone"
                    style={{ aspectRatio: `${device.width} / ${device.height}` }}
                  >
                    <div className="phone-speaker" />
                    {previewView === "replay" && (liveTestImage || playScreenshots.length) ? (
                      <img
                        className="replay-image"
                        src={
                          playTestLoading && liveTestImage
                            ? liveTestImage
                            : playScreenshots[Math.min(playStep, playScreenshots.length - 1)] || liveTestImage
                        }
                        alt={playTestLoading ? "Live AI play test" : `Play test step ${playStep + 1}`}
                      />
                    ) : previewMode === "html" && htmlPreview ? (
                      <iframe key={`html-${previewKey}`} title="HTML preview" srcDoc={htmlPreview} />
                    ) : previewUrl ? (
                      <iframe key={`url-${previewKey}`} title="Mobile preview" src={previewUrl} />
                    ) : (
                      <div className="phone-empty builder-empty">
                        <MonitorSmartphone size={38} />
                        <strong>{treeItems.length ? "Bấm Run để mở app" : "Load một GitHub project"}</strong>
                        <span>
                          {treeItems.length
                            ? "Vibaocode sẽ tự chạy code trên cloud và hiển thị app ở đây."
                            : "Sau khi Load, bạn chỉ cần mô tả thay đổi cho AI."}
                        </span>
                        {treeItems.length ? (
                          <button className="run-button large" onClick={() => { void runCloudProject(); }} disabled={runLoading} type="button">
                            {runLoading ? <Loader2 className="spin" size={16} /> : <Play size={16} />}
                            Chạy dự án
                          </button>
                        ) : null}
                      </div>
                    )}
                  </div>
                </div>

                <div className="preview-statusbar">
                  <div>
                    <span className={`runtime-dot ${sandboxRunning ? "on" : ""}`} />
                    <span>{sandboxRunning ? "Cloud runtime online" : "Cloud runtime offline"}</span>
                  </div>
                  <div>
                    <MonitorSmartphone size={13} />
                    <span>{device.width} × {device.height}</span>
                  </div>
                  {(playScreenshots.length || liveTestImage) ? (
                    <div className="preview-view-toggle">
                      <button
                        className={previewView === "live" ? "active" : ""}
                        onClick={() => setPreviewView("live")}
                        type="button"
                      >
                        LIVE
                      </button>
                      <button
                        className={previewView === "replay" ? "active" : ""}
                        onClick={() => setPreviewView("replay")}
                        type="button"
                      >
                        TEST REPLAY
                      </button>
                    </div>
                  ) : null}
                </div>

                {playTestLoading && liveTestLabel ? (
                  <div className="live-test-status wide">
                    <span className="live-dot" />
                    <strong>AI đang test:</strong>
                    <span>{liveTestLabel}</span>
                  </div>
                ) : null}

                {!playTestLoading && previewView === "replay" && playScreenshots.length ? (
                  <div className="replay-controls wide">
                    <button onClick={() => setPlayStep((value) => Math.max(0, value - 1))} disabled={playStep <= 0} type="button">←</button>
                    <span>Bước {playStep + 1}/{playScreenshots.length}</span>
                    <button
                      onClick={() => setPlayStep((value) => Math.min(playScreenshots.length - 1, value + 1))}
                      disabled={playStep >= playScreenshots.length - 1}
                      type="button"
                    >
                      →
                    </button>
                  </div>
                ) : null}

                {(playReport || visualReview) ? (
                  <div className="playtest-result wide">
                    <strong>AI Play Test</strong>
                    {visualReview ? <pre className="visual-review-pre">{visualReview}</pre> : null}
                    {playReport ? <pre>{playReport}</pre> : null}
                  </div>
                ) : null}

                <details className="preview-advanced">
                  <summary>Preview URL thủ công</summary>
                  <div className="preview-url-row">
                    <input
                      value={previewUrl}
                      onChange={(e) => setPreviewUrl(e.target.value)}
                      placeholder="https://preview-url.example"
                    />
                  </div>
                </details>
              </div>
            ) : workspaceView === "code" ? (
              <div className="editor-workbench">
                <div className="editor-workbench-head">
                  <div className="file-identity">
                    {selected ? <FileCode2 size={16} /> : <Code2 size={16} />}
                    <span>{selected?.path || "Chọn file từ Project bên trái"}</span>
                    {dirty ? <span className="dirty-pill">Modified</span> : null}
                  </div>
                  <div className="editor-actions">
                    <button className="ghost-button" onClick={undoDraft} disabled={!dirty && !proposal} type="button">
                      <RotateCcw size={14} /> Undo
                    </button>
                    <button className="primary-button" onClick={saveToGitHub} disabled={!dirty || saving} type="button">
                      {saving ? <Loader2 className="spin" size={14} /> : <Save size={14} />} Push
                    </button>
                  </div>
                </div>
                {fileLoading ? (
                  <div className="empty-state">
                    <Loader2 className="spin" size={34} />
                    <p>Đang đọc file từ GitHub…</p>
                  </div>
                ) : selected ? (
                  <div className="code-shell builder-code-shell">
                    <div className="code-meta">
                      <span>{formatBytes(selected.size)}</span>
                      <span>{editorContent.split("\n").length} lines</span>
                      <span>{fileExtension(selected.path).toUpperCase() || "TEXT"}</span>
                    </div>
                    <textarea
                      className="code-editor"
                      value={editorContent}
                      onChange={(e) => setEditorContent(e.target.value)}
                      spellCheck={false}
                      aria-label="Code editor"
                    />
                  </div>
                ) : (
                  <div className="empty-state builder-no-file">
                    <Code2 size={34} />
                    <p>Code là chế độ phụ.</p>
                    <span>Bạn có thể để AI tự tìm file; chỉ mở code khi cần xem chi tiết.</span>
                  </div>
                )}
              </div>
            ) : (
              <div className="changes-workbench">
                <div className="changes-head">
                  <div>
                    <span className="stage-kicker">REVIEW CHANGES</span>
                    <strong>{selected?.path || "Chưa chọn thay đổi"}</strong>
                  </div>
                  {proposal ? (
                    <button className="primary-button" onClick={applyProposal} type="button">
                      <Check size={14} /> Apply & Preview
                    </button>
                  ) : null}
                </div>

                {proposalSummary ? (
                  <div className="ai-summary changes-summary">
                    <Sparkles size={17} />
                    <div>
                      <strong>AI đề xuất</strong>
                      <p>{proposalSummary}</p>
                    </div>
                  </div>
                ) : null}

                {selected ? (
                  <div className="review-shell builder-review-shell">
                    <div className="diff-head">
                      <span>GitHub hiện tại</span>
                      <span>{proposal ? "AI proposal" : "Bản nháp"}</span>
                    </div>
                    <div className="diff-grid">
                      <pre>
                        {Array.from({ length: maxDiffLines }, (_, index) => {
                          const changed = oldLines[index] !== newLines[index];
                          return (
                            <div className={changed ? "diff-line changed-old" : "diff-line"} key={`old-${index}`}>
                              <span>{index + 1}</span>
                              <code>{oldLines[index] ?? " "}</code>
                            </div>
                          );
                        })}
                      </pre>
                      <pre>
                        {Array.from({ length: maxDiffLines }, (_, index) => {
                          const changed = oldLines[index] !== newLines[index];
                          return (
                            <div className={changed ? "diff-line changed-new" : "diff-line"} key={`new-${index}`}>
                              <span>{index + 1}</span>
                              <code>{newLines[index] ?? " "}</code>
                            </div>
                          );
                        })}
                      </pre>
                    </div>
                  </div>
                ) : (
                  <div className="empty-state builder-no-file">
                    <Eye size={34} />
                    <p>Chưa có thay đổi để review.</p>
                    <span>Nhập yêu cầu ở AI Builder, sau đó xem diff tại đây.</span>
                  </div>
                )}
              </div>
            )}
          </div>
        </section>

        {rightPanelOpen ? (
          <aside className="ai-drawer">
            <div className="ai-drawer-head">
              <div>
                <span className="eyebrow">AI BUILDER</span>
                <strong>What do you want to build?</strong>
              </div>
              <button className="icon-button small" onClick={() => setRightPanelOpen(false)} title="Đóng panel" type="button">
                <ChevronRight size={15} />
              </button>
            </div>

            <div className="ai-drawer-scroll">
              <div className="provider-row">
                <span className="provider-chip">
                  {aiProvider === "codex-account"
                    ? (codexModels.find((item) => item.model === codexModel)?.displayName || codexModel || "ChatGPT / Codex")
                    : aiProvider === "claude-api"
                      ? "Claude Sonnet 4.6"
                      : aiProvider === "gemini-api"
                        ? "Gemini 3.8 Flash"
                        : model}
                </span>
                <button className="text-button" onClick={() => setSettingsOpen(true)} type="button">
                  <Settings size={13} /> Connect
                </button>
              </div>

              {aiProvider === "codex-account" && codexStatus === "connected" ? (
                <div className="codex-model-card">
                  <div className="codex-model-card-head">
                    <span className="eyebrow">CODEX MODEL</span>
                    <button className="text-button" onClick={() => loadCodexModels(true)} disabled={codexModelsLoading} type="button">
                      {codexModelsLoading ? <Loader2 className="spin" size={11} /> : <RefreshCw size={11} />}
                      Làm mới
                    </button>
                  </div>
                  <label>
                    Model
                    <select value={codexModel} onChange={(e) => chooseCodexModel(e.target.value)} disabled={codexModelsLoading || !codexModels.length}>
                      {!codexModels.length ? <option value="">Đang đọc từ Codex…</option> : null}
                      {codexModels.map((item) => (
                        <option key={item.model} value={item.model}>
                          {item.displayName}{item.isDefault ? " • mặc định" : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Reasoning
                    <select
                      value={codexReasoning}
                      onChange={(e) => setCodexReasoning(e.target.value)}
                      disabled={!codexModel}
                    >
                      {(() => {
                        const selected = codexModels.find((item) => item.model === codexModel);
                        const efforts = selected?.supportedReasoningEfforts || [];
                        if (!efforts.length) {
                          return <option value={codexReasoning || "medium"}>{codexReasoning || "medium"}</option>;
                        }
                        return efforts.map((item) => (
                          <option key={item.reasoningEffort} value={item.reasoningEffort}>
                            {item.reasoningEffort}{item.reasoningEffort === selected?.defaultReasoningEffort ? " • mặc định" : ""}
                          </option>
                        ));
                      })()}
                    </select>
                  </label>
                </div>
              ) : null}

              {aiProvider === "codex-account" && codexStatus === "connected" ? (
                <div className="ai-usage-card">
                  <div className="ai-usage-head">
                    <span className="eyebrow">AI USAGE</span>
                    <button className="text-button" onClick={() => loadCodexUsage(true)} disabled={codexUsageLoading} type="button">
                      {codexUsageLoading ? <Loader2 className="spin" size={11} /> : <RefreshCw size={11} />}
                      Làm mới
                    </button>
                  </div>
                  {(() => {
                    const primary = codexUsage?.rateLimits?.rateLimits?.primary;
                    const secondary = codexUsage?.rateLimits?.rateLimits?.secondary;
                    const usedPrimary = Math.max(0, Math.min(100, Number(primary?.usedPercent || 0)));
                    const usedSecondary = Math.max(0, Math.min(100, Number(secondary?.usedPercent || 0)));
                    return (
                      <>
                        <div className="usage-meter-row">
                          <div>
                            <strong>Hạn mức chính</strong>
                            <span>{primary ? `${Math.round(100 - usedPrimary)}% còn lại` : "Đang đọc…"}</span>
                          </div>
                          <div className="usage-meter"><i style={{ width: `${usedPrimary}%` }} /></div>
                          {primary?.resetsAt ? <small>Reset {new Date(primary.resetsAt * 1000).toLocaleString("vi-VN")}</small> : null}
                        </div>
                        {secondary ? (
                          <div className="usage-meter-row secondary">
                            <div>
                              <strong>Hạn mức dài hạn</strong>
                              <span>{Math.round(100 - usedSecondary)}% còn lại</span>
                            </div>
                            <div className="usage-meter"><i style={{ width: `${usedSecondary}%` }} /></div>
                            {secondary.resetsAt ? <small>Reset {new Date(secondary.resetsAt * 1000).toLocaleString("vi-VN")}</small> : null}
                          </div>
                        ) : null}
                        {codexUsage?.usage?.summary?.lifetimeTokens ? (
                          <small className="usage-token-note">
                            Tổng hoạt động: {Number(codexUsage.usage.summary.lifetimeTokens).toLocaleString("vi-VN")} tokens
                          </small>
                        ) : null}
                      </>
                    );
                  })()}
                </div>
              ) : null}

              <div className="ai-scope-row drawer-scope">
                <div className="segmented">
                  <button className={aiScope === "project" ? "active" : ""} onClick={() => setAiScope("project")} type="button">
                    <Sparkles size={14} /> Project
                  </button>
                  <button className={aiScope === "file" ? "active" : ""} onClick={() => setAiScope("file")} type="button">
                    <FileCode2 size={14} /> File
                  </button>
                </div>
              </div>

              <div className="ai-target builder-target">
                <Bot size={15} />
                <span>
                  {aiScope === "project"
                    ? treeItems.length
                      ? `Toàn dự án • ${treeItems.filter((item) => item.type === "blob").length} files`
                      : "Load GitHub project để bắt đầu"
                    : selected?.path || "Chưa chọn file"}
                </span>
              </div>

              <div className="reference-images-card">
                <div className="reference-images-head">
                  <div>
                    <span className="eyebrow">REFERENCE IMAGES</span>
                    <strong>Ảnh tham chiếu</strong>
                  </div>
                  <div className="reference-images-actions">
                    {referenceImages.length ? (
                      <button className="text-button" onClick={clearReferenceImages} type="button">
                        <Trash2 size={11} /> Xóa tất cả
                      </button>
                    ) : null}
                    <label className="reference-upload-button">
                      {referenceUploading ? <Loader2 className="spin" size={12} /> : <ImagePlus size={12} />}
                      Thêm ảnh
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        multiple
                        hidden
                        disabled={referenceUploading || referenceImages.length >= 5}
                        onChange={(event) => {
                          const files = Array.from(event.target.files || []);
                          event.currentTarget.value = "";
                          void uploadReferenceFiles(files);
                        }}
                      />
                    </label>
                  </div>
                </div>

                <div
                  className={`reference-dropzone ${referenceDragOver ? "dragging" : ""} ${referenceImages.length ? "compact" : ""}`}
                  onDragEnter={(event) => {
                    event.preventDefault();
                    setReferenceDragOver(true);
                  }}
                  onDragOver={(event) => {
                    event.preventDefault();
                    setReferenceDragOver(true);
                  }}
                  onDragLeave={(event) => {
                    event.preventDefault();
                    setReferenceDragOver(false);
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    setReferenceDragOver(false);
                    void uploadReferenceFiles(Array.from(event.dataTransfer.files || []));
                  }}
                >
                  <Upload size={16} />
                  <span>
                    {referenceImages.length
                      ? `${referenceImages.filter((item) => item.active).length}/${referenceImages.length} ảnh đang gửi cho AI`
                      : "Kéo ảnh mẫu vào đây • PNG/JPG/WEBP • tối đa 5 ảnh"}
                  </span>
                  <small>Codex nhận ảnh trực tiếp bằng vision; mỗi ảnh tối đa 4 MB.</small>
                </div>

                {referenceImages.length ? (
                  <div className="reference-image-list">
                    {referenceImages.map((item) => (
                      <div className={`reference-image-item ${item.active ? "active" : ""}`} key={item.id}>
                        <button
                          className="reference-thumb"
                          onClick={() => window.open(referencePreviewUrl(item), "_blank", "noopener,noreferrer")}
                          type="button"
                          title="Mở ảnh lớn"
                        >
                          <img src={referencePreviewUrl(item)} alt={item.name} />
                        </button>
                        <div className="reference-image-meta">
                          <div className="reference-image-title">
                            <strong title={item.name}>{item.name}</strong>
                            <span>{formatBytes(item.size)}</span>
                          </div>
                          <div className="reference-image-controls">
                            <select
                              value={item.kind}
                              onChange={(event) =>
                                patchReferenceImage(item.id, {
                                  kind: event.target.value as ReferenceImage["kind"],
                                })
                              }
                            >
                              <option value="style">Style</option>
                              <option value="ui">UI</option>
                              <option value="character">Character</option>
                              <option value="environment">Environment</option>
                              <option value="logo-icon">Logo / Icon</option>
                              <option value="other">Other</option>
                            </select>
                            <label className="reference-toggle">
                              <input
                                type="checkbox"
                                checked={item.active}
                                onChange={(event) =>
                                  patchReferenceImage(item.id, { active: event.target.checked })
                                }
                              />
                              AI
                            </label>
                            <button
                              className="reference-delete"
                              onClick={() => void removeReferenceImage(item)}
                              type="button"
                              title="Xóa ảnh"
                            >
                              <X size={12} />
                            </button>
                          </div>
                          <input
                            className="reference-note"
                            value={item.note}
                            maxLength={180}
                            onChange={(event) =>
                              patchReferenceImage(item.id, { note: event.target.value })
                            }
                            placeholder="Ghi chú: ví dụ phong cách voxel tươi sáng…"
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>

              <div className="prompt-composer">
                <textarea
                  className="prompt-box builder-prompt"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder={
                    aiScope === "project"
                      ? "Mô tả app hoặc thay đổi bạn muốn. Ví dụ: làm màn home hiện đại hơn, sửa toàn bộ file cần thiết và giữ nguyên chức năng…"
                      : "Mô tả thay đổi cho file đang chọn…"
                  }
                />
                <button
                  className="ai-button builder-send"
                  onClick={aiScope === "project" ? askProjectAI : askAI}
                  disabled={!aiReady || aiLoading}
                  type="button"
                >
                  {aiLoading ? <Loader2 className="spin" size={16} /> : <Sparkles size={16} />}
                  {aiLoading ? "AI đang làm…" : "Build with AI"}
                </button>
              </div>

              {(aiLoading || aiProgress > 0) && aiScope === "project" ? (
                <div className={`ai-progress-card ${aiProgress >= 100 ? "complete" : ""}`}>
                  <div className="ai-progress-head">
                    <div>
                      <span className="eyebrow">AGENT PROGRESS</span>
                      <strong>{Math.round(aiProgress)}%</strong>
                    </div>
                    <span>{aiProgressLabel}</span>
                  </div>
                  <div className="ai-progress-track">
                    <i style={{ width: `${Math.max(0, Math.min(100, aiProgress))}%` }} />
                  </div>
                  {aiElapsedSeconds > 0 && aiLoading ? (
                    <div className="agent-heartbeat">
                      <span className="heartbeat-dot" />
                      <strong>Process đang chạy</strong>
                      <span>
                        {Math.floor(aiElapsedSeconds / 60)}:{String(aiElapsedSeconds % 60).padStart(2, "0")}
                      </span>
                    </div>
                  ) : null}
                  {aiProgressDetail ? <small>{aiProgressDetail}</small> : null}
                  {aiLoading && aiProvider === "codex-account" ? (
                    <button className="agent-cancel-button" onClick={cancelProjectAI} type="button">
                      Dừng Agent
                    </button>
                  ) : null}
                  {aiRunUsage ? (
                    <div className="ai-run-usage">
                      <span>Input {Number(aiRunUsage.inputTokens || 0).toLocaleString("vi-VN")}</span>
                      <span>Cached {Number(aiRunUsage.cachedInputTokens || 0).toLocaleString("vi-VN")}</span>
                      <span>Output {Number(aiRunUsage.outputTokens || 0).toLocaleString("vi-VN")}</span>
                    </div>
                  ) : null}
                </div>
              ) : null}

              {aiScope === "project" && (projectSummary || projectProposals.length) ? (
                <div className="project-agent-result drawer-results">
                  {projectSummary ? (
                    <div className="project-agent-summary">
                      <strong>Kế hoạch AI</strong>
                      <p>{projectSummary}</p>
                      {projectPlan ? <span>{projectPlan}</span> : null}
                    </div>
                  ) : null}
                  <div className="project-file-list">
                    {projectProposals.map((item) => (
                      <button key={item.path} onClick={() => reviewProjectProposal(item)} type="button">
                        <FileCode2 size={14} />
                        <span>
                          <strong>{item.path}</strong>
                          <small>{item.reason}</small>
                        </span>
                        <Eye size={14} />
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              <div className="quick-actions-card">
                <span className="eyebrow">QUICK ACTIONS</span>
                <div className="quick-actions-grid">
                  <button onClick={() => { void runCloudProject(); }} disabled={!treeItems.length || runLoading} type="button">
                    <Play size={14} /> Run app
                  </button>
                  <button onClick={testCloudProject} disabled={!treeItems.length || testLoading} type="button">
                    <Check size={14} /> Auto test
                  </button>
                  <button onClick={playTestProject} disabled={!treeItems.length || playTestLoading || visualLoopLoading} type="button">
                    <Bot size={14} /> AI play
                  </button>
                  <button
                    className="visual-loop-action"
                    onClick={visualLoopProject}
                    disabled={!treeItems.length || visualLoopLoading || aiLoading || codexStatus !== "connected"}
                    type="button"
                  >
                    {visualLoopLoading ? <Loader2 className="spin" size={14} /> : <Sparkles size={14} />}
                    {visualLoopLoading ? (visualLoopStage || "Visual Loop…") : "Visual Loop"}
                  </button>
                  <button onClick={() => setWorkspaceView("changes")} type="button">
                    <Eye size={14} /> Review
                  </button>
                  <button
                    onClick={pushSandboxHead}
                    disabled={!treeItems.length || sandboxPushLoading || !sandboxRunning}
                    type="button"
                  >
                    {sandboxPushLoading ? <Loader2 className="spin" size={14} /> : <Upload size={14} />}
                    {sandboxPushLoading ? "Pushing…" : "Push Sandbox"}
                  </button>
                </div>
                {visualLoopLoading ? (
                  <div className="visual-loop-mini-status">
                    <span className="live-dot" />
                    <strong>{visualLoopStage || "Visual Loop"}</strong>
                    <span>Screenshot → Vision audit → Codex repair → screenshot lại</span>
                  </div>
                ) : null}
              </div>

              {sandboxRunning && (runLogs || testSummary) ? (
                <div className="runtime-console drawer-console">
                  <div className="runtime-console-head">
                    <strong>Cloud Runtime</strong>
                    <span>{sandboxName || "sandbox"}{sandboxRevision ? ` • ${sandboxRevision}` : ""} • live sync {autoSync ? "ON" : "OFF"}</span>
                  </div>
                  {testSummary ? <pre>{testSummary}</pre> : null}
                  {runLogs ? <details><summary>Server logs</summary><pre>{runLogs}</pre></details> : null}
                </div>
              ) : null}

              <p className="privacy-note drawer-note">
                Bạn chỉ cần mô tả ý tưởng. AI tự tìm file, sửa code, chạy preview và đưa thay đổi cho bạn duyệt trước khi Push.
              </p>
            </div>
          </aside>
        ) : (
          <button className="ai-drawer-reopen" onClick={() => setRightPanelOpen(true)} type="button">
            <Bot size={17} />
            <span>AI Builder</span>
            <ChevronLeft size={15} />
          </button>
        )}
      </section>

      {settingsOpen ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setSettingsOpen(false)}>
          <section className="settings-modal" role="dialog" aria-modal="true" onMouseDown={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <div>
                <span className="eyebrow">SETTINGS</span>
                <h2>Kết nối của bạn</h2>
              </div>
              <button className="icon-button" onClick={() => setSettingsOpen(false)} type="button"><X size={18} /></button>
            </div>

            <div className="settings-group">
              <div className="settings-title"><Github size={17} /><strong>GitHub</strong></div>

              {githubUser ? (
                <div className="github-account-card">
                  {githubUser.avatarUrl ? <img src={githubUser.avatarUrl} alt="" /> : <Github size={24} />}
                  <div>
                    <strong>{githubUser.name}</strong>
                    <span>@{githubUser.login} • {githubRepos.length} repositories</span>
                  </div>
                  <button className="ghost-button" onClick={disconnectGithub} type="button">Ngắt</button>
                </div>
              ) : null}

              <label>
                Fine-grained token <span>(dùng để kết nối GitHub, repo private và Push)</span>
                <input
                  type="password"
                  value={githubToken}
                  onChange={(e) => setGithubToken(e.target.value)}
                  placeholder="github_pat_…"
                  autoComplete="off"
                />
              </label>

              <button
                className="primary-button github-login-action"
                onClick={() => loadGithubAccount()}
                disabled={!githubToken || githubConnecting}
                type="button"
              >
                {githubConnecting ? <Loader2 className="spin" size={14} /> : <Github size={14} />}
                {githubUser ? "Làm mới danh sách dự án" : "Kết nối GitHub"}
              </button>

              {githubRepos.length ? (
                <label>
                  Dự án
                  <select value={repo} onChange={(e) => chooseGithubRepo(e.target.value)}>
                    {!githubRepos.some((item) => item.fullName === repo) ? <option value={repo}>{repo}</option> : null}
                    {githubRepos.map((item) => (
                      <option key={item.fullName} value={item.fullName}>
                        {item.fullName}{item.private ? " • private" : ""}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <label>
                  Repository
                  <input value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="owner/repository" />
                </label>
              )}

              <label>
                Branch
                <input
                  value={branch}
                  onChange={(e) => {
                    setBranch(e.target.value);
                    setReviewBase("");
                    setPrUrl("");
                  }}
                  placeholder="main"
                />
              </label>

              <p className="settings-hint">
                Vibaocode không nhận mật khẩu GitHub. Dùng Fine-grained token để đăng nhập an toàn hơn; sau khi kết nối, ô Dự án sẽ thành danh sách thả xuống.
              </p>
            </div>

            <div className="settings-group">
              <div className="settings-title"><Sparkles size={17} /><strong>AI Coding Agent</strong></div>
              <label>
                Cách kết nối
                <select
                  value={aiProvider}
                  onChange={(e) =>
                    setAiProvider(
                      e.target.value as "openai-api" | "codex-account" | "claude-api" | "gemini-api"
                    )
                  }
                >
                  <option value="codex-account">ChatGPT / Codex account</option>
                  <option value="openai-api">OpenAI API</option>
                  <option value="claude-api">Claude API</option>
                  <option value="gemini-api">Gemini API</option>
                </select>
              </label>
              {aiProvider === "codex-account" ? (
                <div className="account-connect-card">
                  <div>
                    <strong>ChatGPT / Codex</strong>
                    <span className={`connection-state ${codexStatus}`}>
                      {codexStatus === "connected" ? "Đã kết nối" : codexStatus === "waiting" ? "Đang chờ đăng nhập" : "Chưa kết nối"}
                    </span>
                  </div>
                  {codexStatus === "connected" ? (
                    <div className="codex-settings-model">
                      <label>
                        Codex model
                        <select value={codexModel} onChange={(e) => chooseCodexModel(e.target.value)} disabled={codexModelsLoading || !codexModels.length}>
                          {!codexModels.length ? <option value="">Đang đọc từ Codex…</option> : null}
                          {codexModels.map((item) => (
                            <option key={item.model} value={item.model}>
                              {item.displayName}{item.isDefault ? " • mặc định" : ""}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Reasoning
                        <select value={codexReasoning} onChange={(e) => setCodexReasoning(e.target.value)} disabled={!codexModel}>
                          {(() => {
                            const selected = codexModels.find((item) => item.model === codexModel);
                            const efforts = selected?.supportedReasoningEfforts || [];
                            if (!efforts.length) return <option value={codexReasoning || "medium"}>{codexReasoning || "medium"}</option>;
                            return efforts.map((item) => (
                              <option key={item.reasoningEffort} value={item.reasoningEffort}>
                                {item.reasoningEffort}{item.reasoningEffort === selected?.defaultReasoningEffort ? " • mặc định" : ""}
                              </option>
                            ));
                          })()}
                        </select>
                      </label>
                    </div>
                  ) : null}
                  {codexStatus === "waiting" ? (
                    <div className="codex-device-card">
                      <span className="eyebrow">DEVICE LOGIN</span>
                      {codexUserCode ? (
                        <>
                          <strong className="codex-device-code">{codexUserCode}</strong>
                          <span>Nhập mã này trên trang xác minh Codex.</span>
                          <div className="account-actions">
                            <button className="ghost-button" onClick={copyCodexCode} type="button">Sao chép mã</button>
                            {codexVerificationUrl ? (
                              <a className="primary-button" href={codexVerificationUrl} target="_blank" rel="noreferrer">
                                Mở trang nhập mã
                              </a>
                            ) : null}
                          </div>
                        </>
                      ) : (
                        <>
                          <span>
                            {codexPhase === "request-device-code"
                              ? "Codex đã chạy • đang yêu cầu mã thiết bị từ OpenAI…"
                              : codexPhase === "app-server"
                                ? "Đang khởi động Codex app-server…"
                                : "Đang chuẩn bị luồng đăng nhập Codex…"}
                          </span>
                          <small>Nếu quá khoảng 15 giây mà chưa có mã, bấm Chẩn đoán bên dưới.</small>
                        </>
                      )}
                    </div>
                  ) : null}
                  <div className="account-actions">
                    <button className="primary-button" onClick={connectCodexAccount} disabled={codexConnecting} type="button">
                      {codexConnecting ? <Loader2 className="spin" size={14} /> : <KeyRound size={14} />}
                      {codexStatus === "connected" ? "Đăng nhập lại ChatGPT" : "Kết nối ChatGPT"}
                    </button>
                    <button className="ghost-button" onClick={checkCodexAccount} type="button">Kiểm tra</button>
                    <button className="ghost-button" onClick={diagnoseCodexAccount} disabled={codexDiagnosing} type="button">
                      {codexDiagnosing ? <Loader2 className="spin" size={13} /> : null}
                      Chẩn đoán
                    </button>
                  </div>
                  {codexStatus === "connected" ? (
                    <button className="ghost-button codex-usage-refresh" onClick={() => loadCodexUsage(true)} disabled={codexUsageLoading} type="button">
                      {codexUsageLoading ? <Loader2 className="spin" size={13} /> : <RefreshCw size={13} />}
                      Làm mới hạn mức AI
                    </button>
                  ) : null}
                  {codexDetail && codexStatus !== "connected" ? (
                    <details className="codex-auth-detail" open={codexPhase === "error"}>
                      <summary>Chi tiết kỹ thuật Codex</summary>
                      <pre>{codexDetail.slice(-4000)}</pre>
                    </details>
                  ) : null}
                  <p className="settings-hint">
                    Vibaocode dùng Device Code Authorization chính thức của Codex CLI, không đọc cookie ChatGPT. Nếu không ra mã, hãy bật Device Code Authorization trong ChatGPT → Settings → Security rồi tạo mã mới.
                  </p>
                </div>
              ) : aiProvider === "claude-api" ? (
                <>
                  <label>
                    Claude model
                    <input value="claude-sonnet-4-6" readOnly />
                  </label>
                  <label>
                    Anthropic API key
                    <input
                      type="password"
                      value={anthropicKey}
                      onChange={(e) => setAnthropicKey(e.target.value)}
                      placeholder="sk-ant-…"
                      autoComplete="off"
                    />
                  </label>
                </>
              ) : aiProvider === "gemini-api" ? (
                <>
                  <label>
                    Gemini model
                    <input value="gemini-3.8-flash" readOnly />
                  </label>
                  <label>
                    Gemini API key
                    <input
                      type="password"
                      value={geminiKey}
                      onChange={(e) => setGeminiKey(e.target.value)}
                      placeholder="AIza…"
                      autoComplete="off"
                    />
                  </label>
                  <p className="settings-hint">
                    Với workspace cloud/headless, Gemini chính thức khuyến nghị API key hoặc Vertex AI thay vì đăng nhập Google tương tác.
                  </p>
                </>
              ) : (
                <>
                  <label>
                    Model
                    <select value={model} onChange={(e) => setModel(e.target.value)}>
                      <option value="gpt-5.3-codex">GPT-5.3 Codex — coding</option>
                      <option value="gpt-5.6-luna">GPT-5.6 Luna — tiết kiệm</option>
                      <option value="gpt-5.6-terra">GPT-5.6 Terra — cân bằng</option>
                      <option value="gpt-5.6-sol">GPT-5.6 Sol — mạnh</option>
                      <option value="gpt-6-astra">GPT-6 Astra — cao nhất</option>
                    </select>
                  </label>
                  <label>
                    API key <span>(để trống nếu server đã có OPENAI_API_KEY)</span>
                    <input
                      type="password"
                      value={openAIKey}
                      onChange={(e) => setOpenAIKey(e.target.value)}
                      placeholder="sk-…"
                      autoComplete="off"
                    />
                  </label>
                </>
              )}
            </div>

            <div className="settings-group">
              <div className="settings-title"><MonitorSmartphone size={17} /><strong>Preview</strong></div>
              <label className="toggle-label">
                <input
                  type="checkbox"
                  checked={autoSync}
                  onChange={(e) => setAutoSync(e.target.checked)}
                />
                Live Sync — code đổi tới đâu preview cập nhật tới đó
              </label>
              <label>
                Vercel / GitHub Pages URL
                <input value={previewUrl} onChange={(e) => setPreviewUrl(e.target.value)} placeholder="https://…" />
              </label>
            </div>

            <div className="settings-group">
              <div className="settings-title"><Trash2 size={17} /><strong>Dọn Vercel Sandbox</strong></div>
              <p className="settings-hint">
                Dùng khi Vercel báo lỗi 402 Snapshot Storage. Vibaocode chỉ xóa Sandbox có tên bắt đầu bằng
                <strong> vibaocode-</strong> và Snapshot thuộc chính project hiện tại.
              </p>
              <label>
                Vercel token tạm thời <span>(để trống trước; Vibaocode sẽ thử OIDC của deployment)</span>
                <input
                  type="password"
                  value={vercelCleanupToken}
                  onChange={(e) => setVercelCleanupToken(e.target.value)}
                  placeholder="Chỉ cần nhập nếu nút dọn báo thiếu quyền"
                  autoComplete="off"
                />
              </label>
              <button
                className="ghost-button"
                onClick={cleanupVercelSandbox}
                disabled={sandboxCleanupLoading}
                type="button"
              >
                {sandboxCleanupLoading ? <Loader2 className="spin" size={14} /> : <Trash2 size={14} />}
                {sandboxCleanupLoading ? "Đang dọn…" : "Dọn Sandbox/Snapshot cũ"}
              </button>
              {sandboxCleanupResult ? <p className="settings-hint">{sandboxCleanupResult}</p> : null}
              <p className="settings-hint">
                Token nhập ở đây không được lưu vào sessionStorage/localStorage và được xóa khỏi ô sau khi dọn thành công.
              </p>
            </div>

            <div className="security-callout">
              <KeyRound size={17} />
              <p>
                Token/key nhập tại đây chỉ lưu trong <strong>sessionStorage của trình duyệt</strong> và được gửi cho API khi bạn dùng tính năng tương ứng. Không commit chúng vào GitHub.
              </p>
            </div>

            <div className="modal-actions">
              <button className="ghost-button" onClick={() => setSettingsOpen(false)} type="button">Hủy</button>
              <button className="primary-button" onClick={saveSettings} type="button"><Check size={15} /> Lưu phiên</button>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}
