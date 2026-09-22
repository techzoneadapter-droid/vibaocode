import { NextRequest, NextResponse } from "next/server";

function headers(token: string | null) {
  const value: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "vibaocode",
  };
  if (token) value.Authorization = `Bearer ${token}`;
  return value;
}

function validRepo(repo: string) {
  return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo);
}

export async function GET(request: NextRequest) {
  const repo = request.nextUrl.searchParams.get("repo")?.trim() || "";
  const path = request.nextUrl.searchParams.get("path")?.trim() || "";
  const branch = request.nextUrl.searchParams.get("branch")?.trim() || "main";
  const token = request.headers.get("x-github-token");

  if (!validRepo(repo) || !path) {
    return NextResponse.json({ error: "Thiếu repo hoặc path." }, { status: 400 });
  }

  const url = `https://api.github.com/repos/${repo}/contents/${path
    .split("/")
    .map(encodeURIComponent)
    .join("/")}?ref=${encodeURIComponent(branch)}`;

  const response = await fetch(url, { headers: headers(token), cache: "no-store" });
  const data = await response.json();

  if (!response.ok) {
    return NextResponse.json(
      { error: data?.message || "Không đọc được file." },
      { status: response.status }
    );
  }

  if (data.type !== "file" || typeof data.content !== "string") {
    return NextResponse.json({ error: "Đường dẫn không phải file văn bản." }, { status: 400 });
  }

  const raw = data.content.replace(/\n/g, "");
  const content = Buffer.from(raw, "base64").toString("utf8");

  return NextResponse.json({
    path: data.path,
    sha: data.sha,
    size: data.size,
    content,
  });
}

export async function POST(request: NextRequest) {
  const token = request.headers.get("x-github-token");
  if (!token) {
    return NextResponse.json(
      { error: "Cần GitHub token để ghi thay đổi." },
      { status: 401 }
    );
  }

  const body = await request.json();
  const repo = String(body.repo || "").trim();
  const path = String(body.path || "").trim();
  const branch = String(body.branch || "main").trim();
  const content = String(body.content ?? "");
  const message = String(body.message || `Update ${path} from Vibaocode`).trim();
  const sha = body.sha ? String(body.sha) : undefined;

  if (!validRepo(repo) || !path) {
    return NextResponse.json({ error: "Thiếu repo hoặc path." }, { status: 400 });
  }

  const url = `https://api.github.com/repos/${repo}/contents/${path
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`;

  const payload: Record<string, unknown> = {
    message,
    branch,
    content: Buffer.from(content, "utf8").toString("base64"),
  };
  if (sha) payload.sha = sha;

  const response = await fetch(url, {
    method: "PUT",
    headers: { ...headers(token), "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await response.json();

  if (!response.ok) {
    return NextResponse.json(
      { error: data?.message || "Không thể ghi thay đổi lên GitHub." },
      { status: response.status }
    );
  }

  return NextResponse.json({
    commitSha: data.commit?.sha,
    contentSha: data.content?.sha,
    htmlUrl: data.content?.html_url,
  });
}
