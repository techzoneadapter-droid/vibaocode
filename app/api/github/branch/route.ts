import { NextRequest, NextResponse } from "next/server";

function headers(token: string) {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "vibaocode",
  };
}

function validRepo(repo: string) {
  return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo);
}

export async function POST(request: NextRequest) {
  const token = request.headers.get("x-github-token") || "";
  if (!token) {
    return NextResponse.json({ error: "Cần GitHub token để tạo branch." }, { status: 401 });
  }

  const body = await request.json();
  const repo = String(body.repo || "").trim();
  const baseBranch = String(body.baseBranch || "main").trim();
  const newBranch = String(body.newBranch || "").trim();

  if (!validRepo(repo) || !baseBranch || !newBranch) {
    return NextResponse.json({ error: "Thiếu repo, baseBranch hoặc newBranch." }, { status: 400 });
  }

  if (!/^[A-Za-z0-9._\/-]+$/.test(newBranch) || newBranch.startsWith("/") || newBranch.endsWith("/")) {
    return NextResponse.json({ error: "Tên branch không hợp lệ." }, { status: 400 });
  }

  const refUrl = `https://api.github.com/repos/${repo}/git/ref/heads/${encodeURIComponent(baseBranch)}`;
  const refResponse = await fetch(refUrl, { headers: headers(token), cache: "no-store" });
  const refData = await refResponse.json();

  if (!refResponse.ok) {
    return NextResponse.json(
      { error: refData?.message || "Không đọc được base branch." },
      { status: refResponse.status }
    );
  }

  const sha = refData?.object?.sha;
  if (!sha) {
    return NextResponse.json({ error: "Không tìm thấy commit của base branch." }, { status: 502 });
  }

  const createResponse = await fetch(`https://api.github.com/repos/${repo}/git/refs`, {
    method: "POST",
    headers: headers(token),
    body: JSON.stringify({
      ref: `refs/heads/${newBranch}`,
      sha,
    }),
  });
  const createData = await createResponse.json();

  if (!createResponse.ok) {
    return NextResponse.json(
      { error: createData?.message || "Không tạo được review branch." },
      { status: createResponse.status }
    );
  }

  return NextResponse.json({
    branch: newBranch,
    baseBranch,
    sha,
  });
}
