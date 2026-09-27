import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 300;

type VercelItem = Record<string, unknown>;

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
  if (Array.isArray(direct)) return direct as VercelItem[];

  if (Array.isArray(payload.data)) {
    return payload.data as VercelItem[];
  }

  if (payload.data && typeof payload.data === "object") {
    const nested = (payload.data as Record<string, unknown>)[kind];
    if (Array.isArray(nested)) return nested as VercelItem[];
  }

  return [];
}

function readNext(payload: VercelListResponse) {
  return String(payload.pagination?.next || payload.next || "").trim();
}

function timestamp(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const raw = String(value || "").trim();
  if (!raw) return 0;

  const numeric = Number(raw);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;

  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

function createdAt(item: VercelItem) {
  return Math.max(
    timestamp(item.createdAt),
    timestamp(item.created_at),
    timestamp(item.created),
  );
}

function newestFirst(items: VercelItem[]) {
  return [...items].sort((a, b) => createdAt(b) - createdAt(a));
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
  const items: VercelItem[] = [];
  let cursor = "";

  for (let page = 0; page < 20; page += 1) {
    const extra: Record<string, string> = {
      sortOrder: "desc",
    };
    if (cursor) extra.cursor = cursor;

    // Vercel only allows namePrefix together with sortBy=name.
    // We need creation order so we can safely keep the newest Vibaocode Sandbox,
    // therefore list by createdAt and filter the vibaocode- prefix locally.
    if (endpoint === "sandboxes") {
      extra.sortBy = "createdAt";
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

  return newestFirst(items);
}

function tokenFrom(request: NextRequest, bodyToken = "") {
  return (
    bodyToken.trim() ||
    String(process.env.VERCEL_OIDC_TOKEN || "").trim() ||
    String(request.headers.get("x-vercel-token") || "").trim()
  );
}

function cleanupPlan(sandboxes: VercelItem[], snapshots: VercelItem[]) {
  const vibaocodeSandboxes = newestFirst(
    sandboxes.filter((item) => String(item.name || "").startsWith("vibaocode-")),
  );
  const validSnapshots = newestFirst(
    snapshots.filter((item) => String(item.id || "").startsWith("snap_")),
  );

  const keptSandbox = vibaocodeSandboxes[0] || null;
  const keptSnapshot = validSnapshots[0] || null;

  return {
    keptSandboxName: keptSandbox ? String(keptSandbox.name || "") : "",
    keptSnapshotId: keptSnapshot ? String(keptSnapshot.id || "") : "",
    sandboxNamesToDelete: vibaocodeSandboxes
      .slice(1)
      .map((item) => String(item.name || ""))
      .filter(Boolean),
    snapshotIdsToDelete: validSnapshots
      .slice(1)
      .map((item) => String(item.id || ""))
      .filter(Boolean),
    foundSandboxes: vibaocodeSandboxes.length,
    foundSnapshots: validSnapshots.length,
  };
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
    const plan = cleanupPlan(sandboxes, snapshots);

    return NextResponse.json({
      ok: true,
      project,
      sandboxCount: plan.foundSandboxes,
      snapshotCount: plan.foundSnapshots,
      keptSandboxName: plan.keptSandboxName,
      keptSnapshotId: plan.keptSnapshotId,
      oldSandboxCount: plan.sandboxNamesToDelete.length,
      oldSnapshotCount: plan.snapshotIdsToDelete.length,
      sandboxNames: [
        plan.keptSandboxName,
        ...plan.sandboxNamesToDelete,
      ].filter(Boolean),
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

    const [snapshots, sandboxes] = await Promise.all([
      collect("snapshots", token, project, teamId),
      collect("sandboxes", token, project, teamId),
    ]);
    const plan = cleanupPlan(sandboxes, snapshots);

    let deletedSnapshots = 0;
    let deletedSandboxes = 0;
    const failures: string[] = [];

    // IMPORTANT: Never delete the newest Vibaocode Sandbox.
    // Only delete entries after index 0 in creation-time descending order.
    for (const name of plan.sandboxNamesToDelete) {
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

    // Keep the newest snapshot too. Deleting every snapshot can make the newest
    // persistent Sandbox lose its latest restore point.
    for (const id of plan.snapshotIdsToDelete) {
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
      foundSandboxes: plan.foundSandboxes,
      foundSnapshots: plan.foundSnapshots,
      keptSandboxName: plan.keptSandboxName,
      keptSnapshotId: plan.keptSnapshotId,
      deletedSandboxes,
      deletedSnapshots,
      failures: failures.slice(0, 20),
      message:
        failures.length === 0
          ? plan.keptSandboxName
            ? `Đã dọn Sandbox/Snapshot cũ và giữ lại Sandbox mới nhất: ${plan.keptSandboxName}.`
            : "Không có Sandbox Vibaocode nào để xóa."
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
