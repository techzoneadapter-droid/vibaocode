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
  required: ["files","plan"],
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
        required: ["path","content","reason"],
        additionalProperties: false
      }
    }
  },
  required: ["summary","files"],
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

async function fetchFile(repo: string, branch: string, path: string, token: string) {
  const encoded = path.split("/").map(encodeURIComponent).join("/");
  const response = await fetch(
    `https://api.github.com/repos/${repo}/contents/${encoded}?ref=${encodeURIComponent(branch)}`,
    { headers: ghHeaders(token), cache: "no-store" }
  );
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

function cleanSchema(schema: any): any {
  if (Array.isArray(schema)) return schema.map(cleanSchema);
  if (!schema || typeof schema !== "object") return schema;
  const result: any = {};
  for (const [key,value] of Object.entries(schema)) {
    if (key === "additionalProperties") continue;
    result[key] = cleanSchema(value);
  }
  return result;
}

async function callAnthropic(apiKey: string, prompt: string, schemaName: string, schema: any) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 20000,
      messages: [{ role: "user", content: prompt }],
      tools: [{
        name: schemaName,
        description: "Return the requested structured result exactly using this tool.",
        input_schema: schema
      }],
      tool_choice: { type: "tool", name: schemaName }
    })
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data?.error?.message || "Claude API request failed.");
  const block = (Array.isArray(data.content) ? data.content : []).find(
    (item: any) => item?.type === "tool_use" && item?.name === schemaName
  );
  if (!block?.input) throw new Error("Claude không trả về structured output.");
  return block.input;
}

function extractXaiOutputText(data: any) {
  if (typeof data?.output_text === "string") return data.output_text;
  if (!Array.isArray(data?.output)) return "";
  for (const item of data.output) {
    if (!Array.isArray(item?.content)) continue;
    for (const content of item.content) {
      if (content?.type === "output_text" && typeof content?.text === "string") {
        return content.text;
      }
    }
  }
  return "";
}

async function callXai(
  apiKey: string,
  model: string,
  reasoning: string,
  prompt: string,
  schemaName: string,
  schema: any,
) {
  const body: any = {
    model: model || "grok-4.7",
    input: prompt,
    text: {
      format: {
        type: "json_schema",
        name: schemaName,
        strict: true,
        schema,
      },
    },
  };
  if (reasoning && reasoning !== "default") {
    body.reasoning = { effort: reasoning };
  }

  const response = await fetch("https://api.x.ai/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error?.message || data?.message || "xAI API request failed.");
  }
  const text = extractXaiOutputText(data);
  if (!text) throw new Error("Grok không trả về structured output.");
  return JSON.parse(text);
}

async function callGemini(apiKey: string, prompt: string, schema: any) {
  const model = "gemini-3.8-flash";
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: cleanSchema(schema),
          maxOutputTokens: 20000
        }
      })
    }
  );
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error?.message || "Gemini API request failed.");
  }
  const text = data?.candidates?.[0]?.content?.parts?.map((part: any) => part?.text || "").join("") || "";
  if (!text) throw new Error("Gemini không trả về structured output.");
  return JSON.parse(text);
}

async function callProvider(
  provider: "anthropic" | "gemini" | "xai",
  apiKey: string,
  model: string,
  reasoning: string,
  prompt: string,
  schemaName: string,
  schema: any
) {
  if (provider === "anthropic") {
    return callAnthropic(apiKey, prompt, schemaName, schema);
  }
  if (provider === "xai") {
    return callXai(apiKey, model, reasoning, prompt, schemaName, schema);
  }
  return callGemini(apiKey, prompt, schema);
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const provider = String(body.provider || "") as "anthropic" | "gemini" | "xai";
    const apiKey = String(body.apiKey || "").trim();
    const model = String(body.model || "").trim();
    const reasoning = String(body.reasoning || "default").trim().toLowerCase();
    const repo = String(body.repo || "").trim();
    const branch = String(body.branch || "main").trim();
    const githubToken = String(body.githubToken || "").trim();
    const prompt = String(body.prompt || "").trim();
    const projectContext = String(body.projectContext || "").slice(0, 20000);

    if (!["anthropic","gemini","xai"].includes(provider)) {
      return NextResponse.json({ error: "Provider chưa được hỗ trợ." }, { status: 400 });
    }
    if (!apiKey) {
      return NextResponse.json(
        {
          error:
            provider === "anthropic"
              ? "Chưa có Anthropic API key."
              : provider === "xai"
                ? "Chưa có xAI API key."
                : "Chưa có Gemini API key."
        },
        { status: 401 }
      );
    }
    if (provider === "xai" && model && !/^[A-Za-z0-9._:-]+$/.test(model)) {
      return NextResponse.json({ error: "Tên model Grok không hợp lệ." }, { status: 400 });
    }
    if (provider === "xai" && !["default","none","low","medium","high","xhigh"].includes(reasoning)) {
      return NextResponse.json({ error: "Reasoning Grok không hợp lệ." }, { status: 400 });
    }
    if (!validRepo(repo) || !branch || !prompt) {
      return NextResponse.json({ error: "Thiếu repo, branch hoặc prompt." }, { status: 400 });
    }

    const treeResponse = await fetch(
      `https://api.github.com/repos/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
      { headers: ghHeaders(githubToken), cache: "no-store" }
    );
    const treeData = await treeResponse.json();
    if (!treeResponse.ok) {
      return NextResponse.json(
        { error: treeData?.message || "Không đọc được repository." },
        { status: treeResponse.status }
      );
    }

    const paths: string[] = (Array.isArray(treeData.tree) ? treeData.tree : [])
      .filter((item: any) => item?.type === "blob" && typeof item?.path === "string")
      .map((item: any) => String(item.path))
      .filter(isTextPath)
      .slice(0, 500);

    const planPrompt = [
      "You are Vibaocode's planning agent.",
      "Choose only existing paths from AVAILABLE FILES.",
      "Choose the smallest safe set of files needed for the user's request.",
      "Never choose generated files, lockfiles, secrets, or unrelated files.",
      "Return at most 6 files.",
      "",
      `PROJECT CONTEXT:\n${projectContext || "(none)"}`,
      `USER REQUEST:\n${prompt}`,
      "AVAILABLE FILES:",
      paths.join("\n")
    ].join("\n");

    const plan = await callProvider(
      provider,
      apiKey,
      provider === "xai" ? (model || "grok-4.7") : "",
      provider === "xai" ? reasoning : "default",
      planPrompt,
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
      return NextResponse.json({ error: "AI không chọn được file phù hợp." }, { status: 502 });
    }

    const originals = [];
    let chars = 0;
    for (const path of selectedPaths) {
      const file = await fetchFile(repo, branch, path, githubToken);
      if (file.content.length > 60000) continue;
      if (chars + file.content.length > 170000) break;
      originals.push(file);
      chars += file.content.length;
    }

    if (!originals.length) {
      return NextResponse.json({ error: "Các file được chọn quá lớn." }, { status: 413 });
    }

    const bundle = originals
      .map(file => `===== FILE: ${file.path} =====\n${file.content}`)
      .join("\n\n");

    const editPrompt = [
      "You are Vibaocode's coding agent.",
      "Implement the user's request using only the provided files.",
      "Return only files that actually need changes.",
      "For each changed file return its COMPLETE replacement content.",
      "Preserve unrelated behavior and public APIs.",
      "Do not add secrets, credentials, hidden tracking, destructive code, or unrelated dependencies.",
      "Prefer small, maintainable, mobile-friendly changes.",
      "",
      `PROJECT CONTEXT:\n${projectContext || "(none)"}`,
      `PLAN:\n${String(plan.plan || "")}`,
      `USER REQUEST:\n${prompt}`,
      bundle
    ].join("\n\n");

    const edits = await callProvider(
      provider,
      apiKey,
      provider === "xai" ? (model || "grok-4.7") : "",
      provider === "xai" ? reasoning : "default",
      editPrompt,
      "vibaocode_project_edit",
      editSchema
    );
    const originalByPath = new Map(originals.map(file => [file.path, file]));
    const files = (Array.isArray(edits.files) ? edits.files : [])
      .map((file: any) => ({
        path: String(file.path || ""),
        content: String(file.content ?? ""),
        reason: String(file.reason || "")
      }))
      .filter((file: any) => originalByPath.has(file.path) && file.content)
      .map((file: any) => {
        const original = originalByPath.get(file.path)!;
        return {
          ...file,
          originalContent: original.content,
          sha: original.sha,
          size: original.size
        };
      });

    if (!files.length) {
      return NextResponse.json({ error: "AI không tạo thay đổi hợp lệ." }, { status: 502 });
    }

    return NextResponse.json({
      model:
        provider === "anthropic"
          ? "claude-sonnet-4-6"
          : provider === "xai"
            ? (model || "grok-4.7")
            : "gemini-3.8-flash",
      provider,
      plan: String(plan.plan || ""),
      summary: String(edits.summary || ""),
      files
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Provider agent failed." },
      { status: 500 }
    );
  }
}
