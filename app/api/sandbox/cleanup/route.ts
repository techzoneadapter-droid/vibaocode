import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 300;

type VercelListResponse = {
  data?: unknown;
  sandboxes?: unknown[];
  snapshots?: unknown[];
  pagination?: { next?: string | null };
  next?: string | null;
};

function queryParams(project: string, teamId: string, extra: Record<string, string> = {}) {
  const params = new URLSearchParams({ project, limit: "50", ...extra });
  if (teamId) params.set("teamId", teamId);
  return params;
}

function readItems(payload: VercelListResponse, kind: "sandboxes" | "snapshots") {
  const direct = payload[kind];
  if (Array.isArray(direct)) return direct as Record<string, unknown>[];

  if (Array.isArray(payload.data)) {
    return payload.data as Record<string, unknown>[];
  }

  if (payload.data && typeof payload.data === "object") {
    const nested = (payload.data as Record<string, unknown>)[kind];
    if (Array.isArray(nested)) return nested as Record<string, unknown>[];
  }

  return [];
}

function readNext(payload: VercelListResponse) {
  return String(payload.pagination?.next || payload.next || "").trim();
}

async function vercelFetch(url: string, token: string, init?: RequestInit) {
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
    cache: "no-store",
  });

  const text = await response.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!response.ok) {
    const detail =
      typeof data === "string"
        ? data
        : JSON.stringify(data || { status: response.status });
    throw new Error(`Vercel API ${response.status}: ${detail.slice(0, 1200)}`);
  }

  return (data || {}) as VercelListResponse;
}

async function collect(
  endpoint: "sandboxes" | "snapshots",
  token: string,
  project: string,
  teamId: string,
) {
  const items: Record<string, unknown>[] = [];
  let cursor = "";

  for (let page = 0; page < 20; page += 1) {
    const extra: Record<string, string> = {};
    if (cursor) extra.cursor = cursor;
    if (endpoint === "sandboxes") {
      extra.sortBy = "name";
      extra.namePrefix = "vibaocode-";
    }

    const params = queryParams(project, teamId, extra);
    const payload = await vercelFetch(
      `https://api.vercel.com/v2/sandboxes/${endpoint === "snapshots" ? "snapshots" : ""}?${params.toString()}`
        .replace("/sandboxes/?", "/sandboxes?"),
      token,
    );

    items.push(...readItems(payload, endpoint));
    cursor = readNext(payload);
    if (!cursor) break;
  }

  return items;
}

function tokenFrom(request: NextRequest, bodyToken = "") {
  return (
    bodyToken.trim() ||
    String(process.env.VERCEL_OIDC_TOKEN || "").trim() ||
    String(request.headers.get("x-vercel-token") || "").trim()
  );
}

export async function GET(request: NextRequest) {
  try {
    const project = String(process.env.VERCEL_PROJECT_ID || "vibaocode");
    const teamId = String(process.env.VERCEL_ORG_ID || "");
    const token = tokenFrom(request);

    if (!token) {
      return NextResponse.json(
        {
          ok: false,
          needsToken: true,
          error: "Deployment OIDC token is unavailable. Enter a temporary Vercel token in Settings.",
        },
        { status: 401 },
      );
    }

    const [sandboxes, snapshots] = await Promise.all([
      collect("sandboxes", token, project, teamId),
      collect("snapshots", token, project, teamId),
    ]);

    return NextResponse.json({
      ok: true,
      project,
      sandboxCount: sandboxes.length,
      snapshotCount: snapshots.length,
      sandboxNames: sandboxes
        .map((item) => String(item.name || ""))
        .filter((name) => name.startsWith("vibaocode-")),
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Không đọc được Sandbox/Snapshot.",
      },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const providedToken = String(body?.token || "");
    const token = tokenFrom(request, providedToken);
    const project = String(process.env.VERCEL_PROJECT_ID || "vibaocode");
    const teamId = String(process.env.VERCEL_ORG_ID || "");

    if (!token) {
      return NextResponse.json(
        {
          ok: false,
          needsToken: true,
          error: "Thiếu Vercel token. Token chỉ được dùng cho lần dọn này và không được lưu.",
        },
        { status: 401 },
      );
    }

    const snapshots = await collect("snapshots", token, project, teamId);
    const sandboxes = await collect("sandboxes", token, project, teamId);

    const snapshotIds = snapshots
      .map((item) => String(item.id || ""))
      .filter((id) => id.startsWith("snap_"));

    const sandboxNames = sandboxes
      .map((item) => String(item.name || ""))
      .filter((name) => name.startsWith("vibaocode-"));

    let deletedSnapshots = 0;
    let deletedSandboxes = 0;
    const failures: string[] = [];

    // Delete named sandboxes first so they cannot create another snapshot while
    // the old snapshot set is being cleared.
    for (const name of sandboxNames) {
      try {
        const params = new URLSearchParams();
        params.set("projectId", project);
        if (teamId) params.set("teamId", teamId);
        await vercelFetch(
          `https://api.vercel.com/v2/sandboxes/${encodeURIComponent(name)}?${params.toString()}`,
          token,
          { method: "DELETE" },
        );
        deletedSandboxes += 1;
      } catch (error) {
        failures.push(
          `sandbox ${name}: ${error instanceof Error ? error.message : "delete failed"}`,
        );
      }
    }

    for (const id of snapshotIds) {
      try {
        const params = new URLSearchParams();
        if (teamId) params.set("teamId", teamId);
        await vercelFetch(
          `https://api.vercel.com/v2/sandboxes/snapshots/${encodeURIComponent(id)}?${params.toString()}`,
          token,
          { method: "DELETE" },
        );
        deletedSnapshots += 1;
      } catch (error) {
        failures.push(
          `snapshot ${id}: ${error instanceof Error ? error.message : "delete failed"}`,
        );
      }
    }

    return NextResponse.json({
      ok: failures.length === 0,
      project,
      foundSandboxes: sandboxNames.length,
      foundSnapshots: snapshotIds.length,
      deletedSandboxes,
      deletedSnapshots,
      failures: failures.slice(0, 20),
      message:
        failures.length === 0
          ? "Đã dọn Sandbox và Snapshot cũ của Vibaocode."
          : "Đã dọn một phần. Xem failures để biết mục chưa xóa được.",
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Dọn Sandbox thất bại.",
      },
      { status: 500 },
    );
  }
}
