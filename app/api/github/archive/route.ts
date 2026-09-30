import { NextRequest } from "next/server";

function validRepo(repo: string) {
  return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo);
}

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const repo = request.nextUrl.searchParams.get("repo")?.trim() || "";
  const branch = request.nextUrl.searchParams.get("branch")?.trim() || "main";
  const token = request.headers.get("x-github-token")?.trim() || "";

  if (!validRepo(repo) || !branch) {
    return new Response("Repo/branch không hợp lệ.", { status: 400 });
  }

  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "vibaocode",
  };
  if (token) headers.Authorization = "Bearer " + token;

  const url = "https://api.github.com/repos/" + repo + "/zipball/" + encodeURIComponent(branch);
  const response = await fetch(url, { headers, cache: "no-store", redirect: "follow" });

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 1200);
    return new Response(detail || "Không tải được mã nguồn GitHub.", { status: response.status });
  }

  const body = await response.arrayBuffer();
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Cache-Control": "no-store, max-age=0",
      "Content-Disposition": "attachment; filename=\"vibaocode-project.zip\"",
    },
  });
}
