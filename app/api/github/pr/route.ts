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
    return NextResponse.json({ error: "Cần GitHub token để mở pull request." }, { status: 401 });
  }

  const body = await request.json();
  const repo = String(body.repo || "").trim();
  const head = String(body.head || "").trim();
  const base = String(body.base || "main").trim();
  const title = String(body.title || `Vibaocode: review ${head}`).trim();
  const description = String(
    body.body ||
      "Thay đổi được tạo và review trong Vibaocode. Hãy kiểm tra diff trước khi merge."
  );

  if (!validRepo(repo) || !head || !base || head === base) {
    return NextResponse.json(
      { error: "Repo/head/base không hợp lệ hoặc head đang trùng base." },
      { status: 400 }
    );
  }

  const response = await fetch(`https://api.github.com/repos/${repo}/pulls`, {
    method: "POST",
    headers: headers(token),
    body: JSON.stringify({
      title,
      head,
      base,
      body: description,
      draft: false,
    }),
  });
  const data = await response.json();

  if (!response.ok) {
    return NextResponse.json(
      { error: data?.message || "Không mở được pull request." },
      { status: response.status }
    );
  }

  return NextResponse.json({
    number: data.number,
    url: data.html_url,
    title: data.title,
  });
}
