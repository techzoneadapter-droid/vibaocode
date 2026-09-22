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
  const [previewUrl, setPreviewUrl] = useState("");
  const [workspaceId, setWorkspaceId] = useState("");
  const [sandboxRunning, setSandboxRunning] = useState(false);
  const [sandboxName, setSandboxName] = useState("");
  const [sandboxRevision, setSandboxRevision] = useState("");
  const [runLogs, setRunLogs] = useState("");
  const [testSummary, setTestSummary] = useState("");
  const [runLoading, setRunLoading] = useState(false);
  const [testLoading, setTestLoading] = useState(false);
  const [playTestLoading, setPlayTestLoading] = useState(false);
  const [playScreenshots, setPlayScreenshots] = useState<string[]>([]);
  const [liveTestImage, setLiveTestImage] = useState("");
  const [liveTestLabel, setLiveTestLabel] = useState("");
  const [playStep, setPlayStep] = useState(0);
  const [playReport, setPlayReport] = useState("");
  const [visualReview, setVisualReview] = useState("");
  const [previewView, setPreviewView] = useState<"live" | "replay">("live");
  const [autoSync, setAutoSync] = useState(true);
  const [codexStatus, setCodexStatus] = useState<"disconnected" | "waiting" | "connected">("disconnected");
  const [codexVerificationUrl, setCodexVerificationUrl] = useState("");
  const [codexUserCode, setCodexUserCode] = useState("");
  const [codexDetail, setCodexDetail] = useState("");
  const [codexConnecting, setCodexConnecting] = useState(false);
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
    let currentWorkspaceId = sessionStorage.getItem("vibaocode.workspaceId") || "";
    if (!currentWorkspaceId) {
      currentWorkspaceId = crypto.randomUUID();
      sessionStorage.setItem("vibaocode.workspaceId", currentWorkspaceId);
    }
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

  const saveSettings = () => {
    sessionStorage.setItem(
      "vibaocode.settings",
      JSON.stringify({ repo, branch, githubToken, openAIKey, model, aiProvider, anthropicKey, geminiKey, autoSync, previewUrl })
    );
    setSettingsOpen(false);
    setNotice("Đã lưu cài đặt cho phiên trình duyệt này");
  };

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

  async function runCloudProject() {
    if (!workspaceId || !treeItems.length) {
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

      if (data.verificationUrl && data.userCode) {
        window.open(data.verificationUrl, "_blank", "noopener,noreferrer");
        setNotice(`Mã thiết bị ${data.userCode} đã sẵn sàng • hoàn tất đăng nhập trong tab mới`);
      } else {
        setNotice("Codex đang tạo mã thiết bị…");
      }

      for (let i = 0; i < 100; i += 1) {
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

        if (statusData.status === "error") {
          throw new Error(statusData.error || statusData.detail || "Codex login lỗi.");
        }

        if (statusData.connected) {
          setCodexStatus("connected");
          setAiProvider("codex-account");
          setCodexUserCode("");
          setNotice(`Đã kết nối ChatGPT/Codex${statusData.version ? ` • ${statusData.version}` : ""}`);
          return;
        }

        if (statusData.userCode) {
          setCodexStatus("waiting");
          setNotice(`Đang chờ xác nhận mã ${statusData.userCode} trên ChatGPT…`);
        }
      }

      setNotice("Mã đăng nhập đã hết thời gian chờ. Bấm Kết nối ChatGPT để tạo mã mới.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Codex login failed.");
      setCodexStatus("disconnected");
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
    } catch (err) {
      setError(err instanceof Error ? err.message : "Codex status failed.");
    }
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

  async function askProjectAI() {
    if (!aiReady || aiScope !== "project") return;
    setAiLoading(true);
    setError("");
    setProjectProposals([]);
    setProjectSummary("");
    setProjectPlan("");
    setNotice("Project Agent đang tìm file liên quan…");

    try {
      const useCodexAccount = aiProvider === "codex-account";
      const useExternalProvider = aiProvider === "claude-api" || aiProvider === "gemini-api";

      if (useCodexAccount && !sandboxRunning) {
        const started = await runCloudProject();
        if (!started) throw new Error("Không khởi động được Live Preview trước khi Codex sửa code.");
      }

      const endpoint = useCodexAccount
        ? "/api/agent/codex-edit"
        : useExternalProvider
          ? "/api/ai/provider-project"
          : "/api/ai/project";

      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          useCodexAccount
            ? {
                workspaceId,
                repo,
                branch,
                prompt,
              }
            : useExternalProvider
              ? {
                  provider: aiProvider === "claude-api" ? "anthropic" : "gemini",
                  apiKey: aiProvider === "claude-api" ? anthropicKey : geminiKey,
                  repo,
                  branch,
                  githubToken,
                  prompt,
                  projectContext,
                }
              : {
                  repo,
                  branch,
                  githubToken,
                  apiKey: openAIKey,
                  model,
                  prompt,
                  projectContext,
                }
        ),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Project Agent không xử lý được yêu cầu.");

      setProjectProposals(data.files || []);
      setProjectSummary(data.summary || "");
      setProjectPlan(data.plan || "");
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
      setNotice(`Project Agent đề xuất ${data.files?.length || 0} file bằng ${data.model}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Project Agent failed.");
      setNotice("Project Agent gặp lỗi");
    } finally {
      setAiLoading(false);
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
                onClick={runCloudProject}
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
              <button className="primary-button" onClick={saveToGitHub} disabled={!dirty || saving} type="button">
                {saving ? <Loader2 className="spin" size={14} /> : <Save size={14} />}
                Push
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
                          <button className="run-button large" onClick={runCloudProject} disabled={runLoading} type="button">
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
                    {visualReview ? <p>{visualReview}</p> : null}
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
                    ? "ChatGPT / Codex"
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
                  <button onClick={runCloudProject} disabled={!treeItems.length || runLoading} type="button">
                    <Play size={14} /> Run app
                  </button>
                  <button onClick={testCloudProject} disabled={!treeItems.length || testLoading} type="button">
                    <Check size={14} /> Auto test
                  </button>
                  <button onClick={playTestProject} disabled={!treeItems.length || playTestLoading} type="button">
                    <Bot size={14} /> AI play
                  </button>
                  <button onClick={() => setWorkspaceView("changes")} type="button">
                    <Eye size={14} /> Review
                  </button>
                </div>
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
                        <span>Đang tạo mã thiết bị trong Cloud Sandbox…</span>
                      )}
                    </div>
                  ) : null}
                  <div className="account-actions">
                    <button className="primary-button" onClick={connectCodexAccount} disabled={codexConnecting} type="button">
                      {codexConnecting ? <Loader2 className="spin" size={14} /> : <KeyRound size={14} />}
                      {codexStatus === "connected" ? "Đăng nhập lại ChatGPT" : "Kết nối ChatGPT"}
                    </button>
                    <button className="ghost-button" onClick={checkCodexAccount} type="button">Kiểm tra</button>
                  </div>
                  {codexDetail && codexStatus !== "connected" ? (
                    <details className="codex-auth-detail">
                      <summary>Chi tiết Codex CLI</summary>
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
