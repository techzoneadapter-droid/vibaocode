import { NextRequest, NextResponse } from "next/server";

const textExtensions = new Set([
  "ts","tsx","js","jsx","mjs","cjs","json","md","css","scss","html","htm","txt",
  "yml","yaml","toml","xml","svg","py","go","rs","java","kt","swift","php","rb",
  "vue","svelte","sql","sh","ps1"
]);

const ignoredPrefixes = [
  "node_modules/","vendor/",".next/","dist/","build/","coverage/",".git/",
  "android/app/build/","ios/Pods/"
];

const ignoredFiles = new Set(["package-lock.json","pnpm-lock.yaml","yarn.lock"]);

const planSchema = {
  type: "object",
  properties: {
    files: {
      type: "array",
      minItems: 1,
      maxItems: 6,
      items: { type: "string" }
    },
    plan: { type: "string" }
  },
  required: ["files", "plan"],
  additionalProperties: false
};

const editSchema = {
  type: "object",
  properties: {
    summary: { type: "string" },
    files: {
      type: "array",
      minItems: 1,
      maxItems: 6,
      items: {
        type: "object",
        properties: {
          path: { type: "string" },
          content: { type: "string" },
          reason: { type: "string" }
        },
        required: ["path", "content", "reason"],
        additionalProperties: false
      }
    }
  },
  required: ["summary", "files"],
  additionalProperties: false
};

function ghHeaders(token: string) {
  const headers: Record<string,string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "vibaocode"
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

function validRepo(repo: string) {
  return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo);
}

function isTextPath(path: string) {
  if (ignoredFiles.has(path.split("/").pop() || "")) return false;
  if (ignoredPrefixes.some(prefix => path.startsWith(prefix))) return false;
  const ext = path.includes(".") ? path.split(".").pop()?.toLowerCase() || "" : "";
  return textExtensions.has(ext) || ["Dockerfile","Makefile","Procfile"].includes(path.split("/").pop() || "");
}

function extractOutputText(data: any): string {
  if (typeof data?.output_text === "string") return data.output_text;
  if (!Array.isArray(data?.output)) return "";
  for (const item of data.output) {
    if (!Array.isArray(item?.content)) continue;
    for (const part of item.content) {
      if (part?.type === "output_text" && typeof part?.text === "string") return part.text;
    }
  }
  return "";
}

async function callModel(apiKey: string, model: string, instructions: string, input: string, schemaName: string, schema: any) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      instructions,
      input,
      max_output_tokens: 24000,
      text: {
        format: {
          type: "json_schema",
          name: schemaName,
          strict: true,
          schema
        }
      }
    })
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error?.message || "OpenAI request failed.");
  }

  const output = extractOutputText(data);
  if (!output) throw new Error("AI không trả về structured output.");
  return JSON.parse(output);
}

async function fetchFile(repo: string, branch: string, path: string, token: string) {
  const encodedPath = path.split("/").map(encodeURIComponent).join("/");
  const url = `https://api.github.com/repos/${repo}/contents/${encodedPath}?ref=${encodeURIComponent(branch)}`;
  const response = await fetch(url, { headers: ghHeaders(token), cache: "no-store" });
  const data = await response.json();

  if (!response.ok || data?.type !== "file" || typeof data?.content !== "string") {
    throw new Error(`Không đọc được ${path}`);
  }

  return {
    path,
    sha: String(data.sha || ""),
    size: Number(data.size || 0),
    content: Buffer.from(data.content.replace(/\n/g, ""), "base64").toString("utf8")
  };
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const repo = String(body.repo || "").trim();
    const branch = String(body.branch || "main").trim();
    const githubToken = String(body.githubToken || "").trim();
    const prompt = String(body.prompt || "").trim();
    const projectContext = String(body.projectContext || "").slice(0, 20000);
    const sessionKey = String(body.apiKey || "").trim();
    const requestedModel = String(body.model || "").trim();

    if (!validRepo(repo) || !branch || !prompt) {
      return NextResponse.json({ error: "Thiếu repo, branch hoặc yêu cầu dự án." }, { status: 400 });
    }

    const apiKey = sessionKey || process.env.OPENAI_API_KEY || "";
    if (!apiKey) {
      return NextResponse.json(
        { error: "Chưa có OpenAI API key. Thêm key trong Settings hoặc OPENAI_API_KEY trên Vercel." },
        { status: 401 }
      );
    }

    const allowedModels = new Set([
      "gpt-5.3-codex",
      "gpt-5.6-luna",
      "gpt-5.6-terra",
      "gpt-5.6-sol",
      "gpt-6-astra"
    ]);
    const configuredModel = requestedModel || process.env.OPENAI_MODEL || "gpt-5.3-codex";
    const model = allowedModels.has(configuredModel) ? configuredModel : "gpt-5.3-codex";

    const treeUrl = `https://api.github.com/repos/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`;
    const treeResponse = await fetch(treeUrl, { headers: ghHeaders(githubToken), cache: "no-store" });
    const treeData = await treeResponse.json();

    if (!treeResponse.ok) {
      return NextResponse.json(
        { error: treeData?.message || "Không đọc được cây repository." },
        { status: treeResponse.status }
      );
    }

    const paths = (Array.isArray(treeData.tree) ? treeData.tree : [])
      .filter((item: any) => item?.type === "blob" && typeof item?.path === "string")
      .map((item: any) => String(item.path))
      .filter(isTextPath)
      .slice(0, 500);

    if (!paths.length) {
      return NextResponse.json({ error: "Không tìm thấy file code/văn bản phù hợp." }, { status: 400 });
    }

    const plan = await callModel(
      apiKey,
      model,
      [
        "You are the planning agent for Vibaocode.",
        "The user may not know which files implement their request.",
        "Choose only existing repository paths from the supplied list.",
        "Choose the smallest set of files that can implement the request safely.",
        "Never select secrets, lockfiles, generated files, or unrelated files.",
        "Return at most 6 files."
      ].join("\n"),
      [
        `PROJECT CONTEXT:\n${projectContext || "(none)"}`,
        `USER REQUEST:\n${prompt}`,
        "AVAILABLE FILES:",
        paths.join("\n")
      ].join("\n\n"),
      "vibaocode_project_plan",
      planSchema
    );

    const selectedPaths: string[] = Array.from(
      new Set<string>(
        (Array.isArray(plan.files) ? plan.files : [])
          .map((path: unknown) => String(path))
          .filter((path: string) => paths.includes(path))
      )
    ).slice(0, 6);

    if (!selectedPaths.length) {
      return NextResponse.json({ error: "AI không chọn được file phù hợp để sửa." }, { status: 502 });
    }

    const originals = [];
    let totalChars = 0;
    for (const path of selectedPaths) {
      const file = await fetchFile(repo, branch, path, githubToken);
      if (file.content.length > 60000) continue;
      if (totalChars + file.content.length > 180000) break;
      originals.push(file);
      totalChars += file.content.length;
    }

    if (!originals.length) {
      return NextResponse.json({ error: "Các file được chọn quá lớn để chỉnh an toàn." }, { status: 413 });
    }

    const bundle = originals
      .map(file => `===== FILE: ${file.path} =====\n${file.content}`)
      .join("\n\n");

    const edits = await callModel(
      apiKey,
      model,
      [
        "You are Vibaocode's project coding agent.",
        "Implement the user's request using only the provided files.",
        "Return only files that actually need changes.",
        "For every changed file, return its complete replacement content.",
        "Preserve unrelated behavior and public APIs unless the request requires a change.",
        "Do not add credentials, tracking, destructive code, or hidden behavior.",
        "Prefer small, maintainable, mobile-friendly changes.",
        "If a requested change cannot be completed with the provided files, make the safest partial change and explain it in the summary."
      ].join("\n"),
      [
        `PROJECT CONTEXT:\n${projectContext || "(none)"}`,
        `PLAN:\n${String(plan.plan || "")}`,
        `USER REQUEST:\n${prompt}`,
        bundle
      ].join("\n\n"),
      "vibaocode_project_edit",
      editSchema
    );

    const originalByPath = new Map(originals.map(file => [file.path, file]));
    const proposedFiles = (Array.isArray(edits.files) ? edits.files : [])
      .map((file: any) => ({
        path: String(file.path || ""),
        content: String(file.content ?? ""),
        reason: String(file.reason || "")
      }))
      .filter((file: any) => originalByPath.has(file.path) && file.content);

    if (!proposedFiles.length) {
      return NextResponse.json({ error: "AI không tạo thay đổi hợp lệ nào." }, { status: 502 });
    }

    return NextResponse.json({
      model,
      plan: String(plan.plan || ""),
      summary: String(edits.summary || ""),
      files: proposedFiles.map((file: any) => {
        const original = originalByPath.get(file.path)!;
        return {
          ...file,
          originalContent: original.content,
          sha: original.sha,
          size: original.size
        };
      })
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Project agent failed." },
      { status: 500 }
    );
  }
}
