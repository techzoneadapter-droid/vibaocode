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
  const [previewUrl, setPreviewUrl] = useState("");
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
    const saved = sessionStorage.getItem("vibaocode.settings");
    if (!saved) return;
    try {
      const data = JSON.parse(saved);
      if (data.repo) setRepo(data.repo);
      if (data.branch) setBranch(data.branch);
      if (data.githubToken) setGithubToken(data.githubToken);
      if (data.openAIKey) setOpenAIKey(data.openAIKey);
      if (data.model) setModel(data.model);
      if (data.previewUrl) setPreviewUrl(data.previewUrl);
    } catch {
      // Ignore malformed session data.
    }
  }, []);

  const tree = useMemo(() => buildTree(treeItems), [treeItems]);
  const dirty = Boolean(selected) && editorContent !== originalContent;
  const aiReady = Boolean(selected && prompt.trim() && editorContent);

  const saveSettings = () => {
    sessionStorage.setItem(
      "vibaocode.settings",
      JSON.stringify({ repo, branch, githubToken, openAIKey, model, previewUrl })
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

  function applyProposal() {
    if (!proposal) return;
    setEditorContent(proposal);
    setProposal("");
    setProposalSummary("");
    setTab("code");
    setNotice("Đã áp dụng đề xuất vào bản nháp. Chưa push GitHub.");
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
                  onClick={() => setTab("diff")}
                  disabled={!selected}
                  type="button"
                >
                  <Eye size={14} /> Review
                </button>
              </div>
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
            </div>

            <div
              className="phone-frame"
              style={{ aspectRatio: `${device.width} / ${device.height}` }}
            >
              <div className="phone-speaker" />
              {previewMode === "html" && htmlPreview ? (
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
          </div>

          <div className="ai-card">
            <div className="panel-heading">
              <div>
                <span className="eyebrow">AI CODER</span>
                <strong>Prompt sửa code</strong>
              </div>
              <span className="provider-chip">{model}</span>
            </div>

            <div className="ai-target">
              <Bot size={15} />
              <span>{selected?.path || "Chưa chọn file"}</span>
            </div>

            <textarea
              className="prompt-box"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Ví dụ: Làm giao diện mobile đẹp hơn, giữ nguyên logic hiện tại và không thêm dependency mới…"
            />

            <div className="ai-foot">
              <button className="ghost-button" onClick={() => setSettingsOpen(true)} type="button">
                <KeyRound size={14} />
                API
              </button>
              <button className="ai-button" onClick={askAI} disabled={!aiReady || aiLoading} type="button">
                {aiLoading ? <Loader2 className="spin" size={16} /> : <Sparkles size={16} />}
                Tạo bản sửa
              </button>
            </div>

            <p className="privacy-note">
              AI chỉ nhận file đang mở và PROJECT.md. Thay đổi luôn được review trước khi push.
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
              <div className="settings-title"><Sparkles size={17} /><strong>OpenAI</strong></div>
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
            </div>

            <div className="settings-group">
              <div className="settings-title"><MonitorSmartphone size={17} /><strong>Preview</strong></div>
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
