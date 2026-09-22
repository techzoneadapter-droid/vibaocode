import { NextRequest, NextResponse } from "next/server";

function headers(token: string) {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "vibaocode",
  };
}

export async function GET(request: NextRequest) {
  const token = request.headers.get("x-github-token") || "";
  if (!token) {
    return NextResponse.json({ error: "Chưa có GitHub token." }, { status: 401 });
  }

  const [userResponse, repoResponse] = await Promise.all([
    fetch("https://api.github.com/user", {
      headers: headers(token),
      cache: "no-store",
    }),
    fetch("https://api.github.com/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member", {
      headers: headers(token),
      cache: "no-store",
    }),
  ]);

  const user = await userResponse.json();
  const repos = await repoResponse.json();

  if (!userResponse.ok) {
    return NextResponse.json(
      { error: user?.message || "GitHub token không hợp lệ." },
      { status: userResponse.status },
    );
  }

  if (!repoResponse.ok) {
    return NextResponse.json(
      { error: repos?.message || "Không lấy được danh sách repository." },
      { status: repoResponse.status },
    );
  }

  return NextResponse.json({
    user: {
      login: user.login,
      name: user.name || user.login,
      avatarUrl: user.avatar_url || "",
    },
    repos: (Array.isArray(repos) ? repos : []).map((item: any) => ({
      fullName: item.full_name,
      name: item.name,
      private: Boolean(item.private),
      defaultBranch: item.default_branch || "main",
      updatedAt: item.updated_at || "",
    })),
  });
}
