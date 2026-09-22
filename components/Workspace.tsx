"use client";

import {
  Bot,
  Check,
  ChevronDown,
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
  const [openAIKey, setOpenAIKey] = useState("");
  const [model, setModel] = useState("gpt-5.3-codex");
  const [aiProvider, setAiProvider] = useState<"openai-api" | "codex-account" | "claude-api" | "gemini-api">("openai-api");
  const [anthropicKey, setAnthropicKey] = useState("");
  const [geminiKey, setGeminiKey] = useState("");
  const [previewUrl, setPreviewUrl] = useState("https://vibaocode.vercel.app");
  const [workspaceId, setWorkspaceId] = useState("");
  const [sandboxRunning, setSandboxRunning] = useState(false);
  const [sandboxName, setSandboxName] = useState("");
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
      if (data.githubToken) setGithubToken(data.githubToken);
      if (data.openAIKey) setOpenAIKey(data.openAIKey);
      if (data.model) setModel(data.model);
      if (["codex-account","openai-api","claude-api","gemini-api"].includes(data.aiProvider)) {
        setAiProvider(data.aiProvider);
      }
      if (data.anthropicKey) setAnthropicKey(data.anthropicKey);
      if (data.geminiKey) setGeminiKey(data.geminiKey);
      if (typeof data.autoSync === "boolean") setAutoSync(data.autoSync);
      if (data.previewUrl) setPreviewUrl(data.previewUrl);
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
      setNotice(`Đã mở ${data.path}`);
      if (fileExtension(node.path) === "html") setPreviewMode("html");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không mở được file.");
    } finally {
      setFileLoading(false);
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
      setSandboxRunning(Boolean(data.running));
      setRunLogs(data.logs || "");
      if (data.previewUrl) {
        setPreviewUrl(data.previewUrl);
        setPreviewMode("url");
        setPreviewKey((value) => value + 1);
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
    setNotice("Tester đang chạy lint / test / build / smoke test…");
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
      const lines = (data.checks || []).map(
        (check: any) => `${check.exitCode === 0 ? "✓" : "✗"} ${check.name}\n${(check.stderr || check.stdout || "").slice(-2500)}`
      );
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

      for (let i = 0; i < 90; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 850));
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
  }

  async function connectCodexAccount() {
    if (!workspaceId) return;
    setCodexConnecting(true);
    setError("");
    setNotice("Đang mở đăng nhập ChatGPT cho Codex…");
    try {
      const response = await fetch("/api/agent/codex-auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId, action: "start" }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Không bắt đầu được Codex login.");
      setCodexStatus("waiting");
      setCodexVerificationUrl(data.verificationUrl || "");
      setCodexUserCode(data.userCode || "");
      if (data.verificationUrl) window.open(data.verificationUrl, "_blank", "noopener,noreferrer");

      for (let i = 0; i < 20; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 3000));
        const statusResponse = await fetch("/api/agent/codex-auth", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ workspaceId, action: "status" }),
        });
        const statusData = await statusResponse.json();
        if (statusData.connected) {
          setCodexStatus("connected");
          setAiProvider("codex-account");
          setNotice("Đã kết nối ChatGPT/Codex");
          return;
        }
      }
      setNotice("Đang chờ bạn hoàn tất đăng nhập ChatGPT");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Codex login failed.");
      setCodexStatus("disconnected");
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
      setCodexStatus(data.connected ? "connected" : "waiting");
      if (data.verificationUrl) setCodexVerificationUrl(data.verificationUrl);
      if (data.userCode) setCodexUserCode(data.userCode);
      setNotice(data.connected ? "ChatGPT/Codex đang kết nối" : "Codex chưa đăng nhập xong");
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
    setNotice(`Đang review đề xuất cho ${item.path}`);
  }

  async function applyProposal() {
    if (!proposal) return;
    const nextContent = proposal;
    setEditorContent(nextContent);
    setProposal("");
    setProposalSummary("");
    setTab("code");
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

      <section className="ide-grid">
        <aside className="sidebar">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">PROJECT</span>
              <strong>Repository</strong>
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
            <input value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="owner/repo" />
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
                <p>Bấm <strong>Load</strong> để đọc repository.</p>
                <span>Repo public đọc được không cần token.</span>
              </div>
            )}
          </div>

          <div className="sidebar-foot">
            <span>{treeItems.filter((x) => x.type === "blob").length} files</span>
            <span>{projectContext ? "PROJECT.md ✓" : "No PROJECT.md"}</span>
          </div>
        </aside>

        <section className="editor-panel">
          <div className="editor-head">
            <div className="file-identity">
              {selected ? <FileCode2 size={16} /> : <Code2 size={16} />}
              <span>{selected?.path || "Chọn một file để bắt đầu"}</span>
              {dirty ? <span className="dirty-pill">Modified</span> : null}
            </div>

            <div className="editor-actions">
              <div className="segmented">
                <button className={tab === "code" ? "active" : ""} onClick={() => setTab("code")} type="button">
                  <Code2 size={14} /> Code
                </button>
                <button
                  className={tab === "diff" ? "active" : ""}
                  onClick={openReview}
                  disabled={!selected || runLoading}
                  type="button"
                >
                  <Eye size={14} /> Review
                </button>
              </div>
              <button
                className="ghost-button"
                onClick={runCloudProject}
                disabled={!treeItems.length || runLoading}
                type="button"
              >
                {runLoading ? <Loader2 className="spin" size={14} /> : <Play size={14} />}
                Run
              </button>
              <button
                className="ghost-button"
                onClick={testCloudProject}
                disabled={!treeItems.length || testLoading}
                type="button"
              >
                {testLoading ? <Loader2 className="spin" size={14} /> : <Check size={14} />}
                Auto Test
              </button>
              <button
                className="ghost-button"
                onClick={playTestProject}
                disabled={!treeItems.length || playTestLoading}
                type="button"
              >
                {playTestLoading ? <Loader2 className="spin" size={14} /> : <Bot size={14} />}
                AI Play Test
              </button>
              <button className="ghost-button" onClick={undoDraft} disabled={!dirty && !proposal} type="button">
                <RotateCcw size={14} /> Undo
              </button>
              <button
                className="ghost-button"
                onClick={createReviewBranch}
                disabled={branchLoading || Boolean(reviewBase)}
                title={reviewBase ? `Review branch đang hoạt động: ${branch}` : "Tạo branch an toàn trước khi sửa"}
                type="button"
              >
                {branchLoading ? <Loader2 className="spin" size={14} /> : <GitBranch size={14} />}
                Review branch
              </button>
              <button className="primary-button" onClick={saveToGitHub} disabled={!dirty || saving} type="button">
                {saving ? <Loader2 className="spin" size={15} /> : <Save size={15} />}
                Push
              </button>
              <button
                className="ghost-button"
                onClick={openPullRequest}
                disabled={!reviewBase || prLoading}
                type="button"
              >
                {prLoading ? <Loader2 className="spin" size={14} /> : <GitPullRequest size={14} />}
                PR
              </button>
              {prUrl ? (
                <a className="pr-link" href={prUrl} target="_blank" rel="noreferrer">
                  Mở PR
                </a>
              ) : null}
            </div>
          </div>

          <div className="editor-body">
            {fileLoading ? (
              <div className="empty-state">
                <Loader2 className="spin" size={34} />
                <p>Đang đọc file từ GitHub…</p>
              </div>
            ) : !selected ? (
              <div className="welcome-state">
                <div className="welcome-icon"><Sparkles size={28} /></div>
                <h1>Code ở GitHub. Review như một sản phẩm thật.</h1>
                <p>
                  Chọn repository, mở file, yêu cầu AI chỉnh sửa rồi xem thay đổi trước khi push.
                  Khung mobile bên phải giúp bạn review bằng mắt thay vì phải hiểu toàn bộ code.
                </p>
                <div className="feature-row">
                  <span><Github size={15} /> GitHub source</span>
                  <span><Bot size={15} /> AI edit</span>
                  <span><MonitorSmartphone size={15} /> Mobile preview</span>
                </div>
              </div>
            ) : tab === "code" ? (
              <div className="code-shell">
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
              <div className="review-shell">
                {proposalSummary ? (
                  <div className="ai-summary">
                    <Sparkles size={17} />
                    <div>
                      <strong>AI đề xuất</strong>
                      <p>{proposalSummary}</p>
                    </div>
                    <button className="primary-button compact-button" onClick={applyProposal} type="button">
                      <Check size={14} /> Apply
                    </button>
                  </div>
                ) : null}
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
            )}
          </div>
        </section>

        <aside className="review-panel">
          <div className="preview-card">
            <div className="panel-heading preview-heading">
              <div>
                <span className="eyebrow">REVIEW</span>
                <strong>Mobile Preview</strong>
              </div>
              <button className="icon-button small" onClick={() => setPreviewKey((v) => v + 1)} type="button">
                <RefreshCw size={15} />
              </button>
            </div>

            <div className="preview-controls">
              <select
                value={device.label}
                onChange={(e) => setDevice(devices.find((item) => item.label === e.target.value) || devices[1])}
              >
                {devices.map((item) => (
                  <option key={item.label} value={item.label}>{item.label}</option>
                ))}
              </select>
              <div className="segmented mini">
                <button className={previewMode === "url" ? "active" : ""} onClick={() => setPreviewMode("url")} type="button">
                  URL
                </button>
                <button
                  className={previewMode === "html" ? "active" : ""}
                  onClick={() => setPreviewMode("html")}
                  disabled={!htmlPreview}
                  type="button"
                >
                  HTML
                </button>
              </div>
            </div>

            {previewMode === "url" ? (
              <div className="preview-url-row">
                <input
                  value={previewUrl}
                  onChange={(e) => setPreviewUrl(e.target.value)}
                  placeholder="https://your-preview.vercel.app"
                />
              </div>
            ) : null}

            <div className="device-label">
              <MonitorSmartphone size={14} />
              {device.width} × {device.height}
              {(playScreenshots.length || liveTestImage) ? (
                <span className="preview-view-toggle">
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
                </span>
              ) : null}
            </div>

            <div
              className="phone-frame"
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
                <div className="phone-empty">
                  <MonitorSmartphone size={30} />
                  <strong>Chưa có preview</strong>
                  <span>Dán URL Vercel/GitHub Pages hoặc mở một file HTML.</span>
                </div>
              )}
            </div>

            {playTestLoading && liveTestLabel ? (
              <div className="live-test-status">
                <span className="live-dot" />
                <strong>AI đang test:</strong>
                <span>{liveTestLabel}</span>
              </div>
            ) : null}

            {!playTestLoading && previewView === "replay" && playScreenshots.length ? (
              <div className="replay-controls">
                <button
                  onClick={() => setPlayStep((value) => Math.max(0, value - 1))}
                  disabled={playStep <= 0}
                  type="button"
                >
                  ←
                </button>
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
              <div className="playtest-result">
                <strong>AI Play Test</strong>
                {visualReview ? <p>{visualReview}</p> : null}
                {playReport ? <pre>{playReport}</pre> : null}
              </div>
            ) : null}
          </div>

          <div className="ai-card">
            <div className="panel-heading">
              <div>
                <span className="eyebrow">AI CODER</span>
                <strong>Prompt sửa code</strong>
              </div>
              <span className="provider-chip">
                {aiProvider === "codex-account"
                  ? "ChatGPT / Codex"
                  : aiProvider === "claude-api"
                    ? "Claude Sonnet 4.6"
                    : aiProvider === "gemini-api"
                      ? "Gemini 3.8 Flash"
                      : model}
              </span>
            </div>

            <div className="ai-scope-row">
              <div className="segmented">
                <button
                  className={aiScope === "project" ? "active" : ""}
                  onClick={() => setAiScope("project")}
                  type="button"
                >
                  <Sparkles size={14} /> Project
                </button>
                <button
                  className={aiScope === "file" ? "active" : ""}
                  onClick={() => setAiScope("file")}
                  type="button"
                >
                  <FileCode2 size={14} /> File
                </button>
              </div>
            </div>

            <div className="ai-target">
              <Bot size={15} />
              <span>
                {aiScope === "project"
                  ? treeItems.length
                    ? `Toàn dự án • ${treeItems.filter((item) => item.type === "blob").length} files`
                    : "Hãy Load repository trước"
                  : selected?.path || "Chưa chọn file"}
              </span>
            </div>

            <textarea
              className="prompt-box"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder={
                aiScope === "project"
                  ? "Ví dụ: Làm lại phần đăng nhập đẹp hơn. Tự tìm các file liên quan, không ảnh hưởng chức năng khác…"
                  : "Ví dụ: Làm giao diện mobile đẹp hơn, giữ nguyên logic hiện tại và không thêm dependency mới…"
              }
            />

            {aiScope === "project" && (projectSummary || projectProposals.length) ? (
              <div className="project-agent-result">
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

            <div className="ai-foot">
              <button className="ghost-button" onClick={() => setSettingsOpen(true)} type="button">
                <KeyRound size={14} />
                {aiProvider === "codex-account" ? "Account" : "API"}
              </button>
              <button
                className="ai-button"
                onClick={aiScope === "project" ? askProjectAI : askAI}
                disabled={!aiReady || aiLoading}
                type="button"
              >
                {aiLoading ? <Loader2 className="spin" size={16} /> : <Sparkles size={16} />}
                {aiScope === "project" ? "Phân tích & sửa dự án" : "Tạo bản sửa"}
              </button>
            </div>

            {sandboxRunning && (runLogs || testSummary) ? (
              <div className="runtime-console">
                <div className="runtime-console-head">
                  <strong>Cloud Runtime</strong>
                  <span>{sandboxName || "sandbox"} • live sync {autoSync ? "ON" : "OFF"}</span>
                </div>
                {testSummary ? <pre>{testSummary}</pre> : null}
                {runLogs ? <details><summary>Server logs</summary><pre>{runLogs}</pre></details> : null}
              </div>
            ) : null}

            <p className="privacy-note">
              {aiScope === "project"
                ? "Project Agent tự chọn tối đa 6 file liên quan. Mỗi file vẫn phải được bạn review trước khi Apply/Push."
                : "AI chỉ nhận file đang mở và PROJECT.md. Thay đổi luôn được review trước khi push."}
            </p>
          </div>
        </aside>
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
              <label>
                Repository
                <input value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="owner/repository" />
              </label>
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
              <label>
                Fine-grained token <span>(chỉ cần khi push/private repo)</span>
                <input
                  type="password"
                  value={githubToken}
                  onChange={(e) => setGithubToken(e.target.value)}
                  placeholder="github_pat_…"
                  autoComplete="off"
                />
              </label>
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
                  {codexUserCode ? <p>Mã thiết bị: <code>{codexUserCode}</code></p> : null}
                  {codexVerificationUrl ? (
                    <a href={codexVerificationUrl} target="_blank" rel="noreferrer">Mở trang đăng nhập ChatGPT</a>
                  ) : null}
                  <div className="account-actions">
                    <button className="primary-button" onClick={connectCodexAccount} disabled={codexConnecting} type="button">
                      {codexConnecting ? <Loader2 className="spin" size={14} /> : <KeyRound size={14} />}
                      Kết nối ChatGPT
                    </button>
                    <button className="ghost-button" onClick={checkCodexAccount} type="button">Kiểm tra</button>
                  </div>
                  <p className="settings-hint">
                    Dùng luồng device login chính thức của Codex. Vibaocode không lấy cookie phiên ChatGPT.
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
