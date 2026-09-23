import { NextRequest, NextResponse } from "next/server";
import {
  ensurePublicRepo,
  getWorkspaceSandbox,
  repoDirectory,
  validBranch,
  validRepo,
} from "../../../../lib/workspace-sandbox";

export const maxDuration = 60;

const MAX_FILE_BYTES = 4 * 1024 * 1024;
const ALLOWED_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
]);

function safeExtension(file: File) {
  if (file.type === "image/png") return "png";
  if (file.type === "image/webp") return "webp";
  return "jpg";
}

function validReferencePath(path: string) {
  return /^\.vibaocode-references\/[A-Za-z0-9._-]+\.(?:png|jpe?g|webp)$/i.test(path);
}

function contentTypeFor(path: string) {
  const lower = path.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  return "image/jpeg";
}

export async function POST(request: NextRequest) {
  try {
    const form = await request.formData();
    const workspaceId = String(form.get("workspaceId") || "").trim();
    const repo = String(form.get("repo") || "").trim();
    const branch = String(form.get("branch") || "main").trim();
    const file = form.get("file");
    const githubToken = request.headers.get("x-github-token") || "";

    if (!workspaceId || !validRepo(repo) || !validBranch(branch)) {
      return NextResponse.json(
        { error: "Thiếu workspaceId hoặc repo/branch không hợp lệ." },
        { status: 400 },
      );
    }

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Chưa chọn ảnh." }, { status: 400 });
    }

    if (!ALLOWED_TYPES.has(file.type)) {
      return NextResponse.json(
        { error: "Chỉ hỗ trợ PNG, JPG/JPEG và WEBP." },
        { status: 400 },
      );
    }

    if (file.size <= 0 || file.size > MAX_FILE_BYTES) {
      return NextResponse.json(
        { error: "Mỗi ảnh phải nhỏ hơn hoặc bằng 4 MB." },
        { status: 400 },
      );
    }

    const sandbox = await getWorkspaceSandbox(workspaceId);
    const dir = await ensurePublicRepo(sandbox, repo, branch, githubToken);
    const ext = safeExtension(file);
    const id = crypto.randomUUID();
    const relativePath = `.vibaocode-references/${id}.${ext}`;
    const absolutePath = `${dir}/${relativePath}`;
    const bytes = Buffer.from(await file.arrayBuffer());

    await sandbox.runCommand({
      cmd: "mkdir",
      args: ["-p", `${dir}/.vibaocode-references`],
    });

    await sandbox.writeFiles([
      {
        path: absolutePath,
        content: bytes,
      },
    ]);

    return NextResponse.json({
      id,
      name: file.name || `reference.${ext}`,
      size: file.size,
      mimeType: file.type,
      path: relativePath,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Không upload được ảnh." },
      { status: 500 },
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const workspaceId = String(searchParams.get("workspaceId") || "").trim();
    const repo = String(searchParams.get("repo") || "").trim();
    const branch = String(searchParams.get("branch") || "main").trim();
    const path = String(searchParams.get("path") || "").trim();

    if (
      !workspaceId ||
      !validRepo(repo) ||
      !validBranch(branch) ||
      !validReferencePath(path)
    ) {
      return NextResponse.json({ error: "Reference image không hợp lệ." }, { status: 400 });
    }

    const sandbox = await getWorkspaceSandbox(workspaceId);
    const dir = repoDirectory(repo, branch);
    const buffer = await sandbox.readFileToBuffer({ path: `${dir}/${path}` });

    if (!buffer) {
      return NextResponse.json({ error: "Không tìm thấy ảnh." }, { status: 404 });
    }

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "content-type": contentTypeFor(path),
        "cache-control": "private, max-age=60",
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Không đọc được ảnh." },
      { status: 500 },
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json();
    const workspaceId = String(body.workspaceId || "").trim();
    const repo = String(body.repo || "").trim();
    const branch = String(body.branch || "main").trim();
    const path = String(body.path || "").trim();

    if (
      !workspaceId ||
      !validRepo(repo) ||
      !validBranch(branch) ||
      !validReferencePath(path)
    ) {
      return NextResponse.json({ error: "Reference image không hợp lệ." }, { status: 400 });
    }

    const sandbox = await getWorkspaceSandbox(workspaceId);
    const dir = repoDirectory(repo, branch);

    await sandbox.runCommand({
      cmd: "rm",
      args: ["-f", `${dir}/${path}`],
    });

    return NextResponse.json({ deleted: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Không xóa được ảnh." },
      { status: 500 },
    );
  }
}
