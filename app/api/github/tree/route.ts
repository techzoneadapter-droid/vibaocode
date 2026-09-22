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
  const branch = request.nextUrl.searchParams.get("branch")?.trim() || "main";
  const token = request.headers.get("x-github-token");

  if (!validRepo(repo)) {
    return NextResponse.json({ error: "Repo phải có dạng owner/name." }, { status: 400 });
  }

  const url = `https://api.github.com/repos/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`;
  const response = await fetch(url, { headers: headers(token), cache: "no-store" });
  const data = await response.json();

  if (!response.ok) {
    return NextResponse.json(
      { error: data?.message || "Không đọc được repository." },
      { status: response.status }
    );
  }

  const items = Array.isArray(data.tree)
    ? data.tree.map((item: any) => ({
        path: item.path,
        type: item.type,
        size: item.size ?? 0,
        sha: item.sha,
      }))
    : [];

  return NextResponse.json({ sha: data.sha, truncated: Boolean(data.truncated), items });
}
