import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 120;

const schema = {
  type: "object",
  properties: {
    plan: { type: "string" },
    codexPrompt: { type: "string" },
    reviewChecklist: {
      type: "array",
      items: { type: "string" },
      maxItems: 12,
    },
  },
  required: ["plan","codexPrompt","reviewChecklist"],
  additionalProperties: false,
};

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

function ghHeaders(token: string) {
  const headers: Record<string,string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "vibaocode",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const apiKey = String(body.apiKey || "").trim() || process.env.OPENAI_API_KEY || "";
    const model = String(body.model || "gpt-6-astra").trim();
    const reasoning = String(body.reasoning || "high").trim().toLowerCase();
    const repo = String(body.repo || "").trim();
    const branch = String(body.branch || "main").trim();
    const githubToken = String(body.githubToken || "").trim();
    const prompt = String(body.prompt || "").trim();
    const projectContext = String(body.projectContext || "").slice(0, 20000);
    const referenceText = String(body.referenceText || "").slice(0, 24000);

    if (!apiKey) {
      return NextResponse.json({ error: "Hybrid mode cần OpenAI API key." }, { status: 401 });
    }
    if (!/^[A-Za-z0-9._:-]+$/.test(model)) {
      return NextResponse.json({ error: "Tên model OpenAI không hợp lệ." }, { status: 400 });
    }
    if (!["none","low","medium","high","xhigh","max"].includes(reasoning)) {
      return NextResponse.json({ error: "Reasoning OpenAI không hợp lệ." }, { status: 400 });
    }
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo) || !prompt) {
      return NextResponse.json({ error: "Thiếu repo hoặc prompt." }, { status: 400 });
    }

    let fileList = "";
    try {
      const treeResponse = await fetch(
        `https://api.github.com/repos/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
        { headers: ghHeaders(githubToken), cache: "no-store" },
      );
      const treeData = await treeResponse.json();
      if (treeResponse.ok) {
        fileList = (Array.isArray(treeData.tree) ? treeData.tree : [])
          .filter((item: any) => item?.type === "blob" && typeof item?.path === "string")
          .map((item: any) => String(item.path))
          .filter((path: string) => !/(node_modules|dist|build|\.git|coverage)\//.test(path))
          .slice(0, 600)
          .join("\n");
      }
    } catch {
      // The director can still work from user/project context if the tree lookup fails.
    }

    const instructions = [
      "You are the ChatGPT Director inside Vibaocode.",
      "Your job is NOT to edit code directly.",
      "Turn the user's request into an execution prompt for a separate Codex coding agent.",
      "Preserve user intent, constraints, reference-image scope, current architecture and QA requirements.",
      "Be concrete about what Codex should inspect, change, preserve, test and verify.",
      "Do not invent files that are not in the repository list when a list is available.",
      "Avoid unnecessary rewrites.",
      "The Codex prompt must be self-contained and execution-oriented, not a discussion.",
      "Ask Codex to work in the current workspace and not discard existing local work.",
      "Return concise but sufficient content; do not waste tokens.",
    ].join("\n");

    const input = [
      `PROJECT: ${repo}@${branch}`,
      `PROJECT CONTEXT:\n${projectContext || "(none)"}`,
      referenceText ? `REFERENCE METADATA:\n${referenceText}` : "",
      `USER REQUEST:\n${prompt}`,
      fileList ? `REPOSITORY FILES:\n${fileList}` : "",
    ].filter(Boolean).join("\n\n");

    const requestBody: any = {
      model,
      instructions,
      input,
      max_output_tokens: 12000,
      text: {
        format: {
          type: "json_schema",
          name: "vibaocode_chatgpt_director",
          strict: true,
          schema,
        },
      },
    };
    if (reasoning !== "none") requestBody.reasoning = { effort: reasoning };

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });
    const data = await response.json();
    if (!response.ok) {
      return NextResponse.json(
        { error: data?.error?.message || "ChatGPT Director request failed." },
        { status: response.status },
      );
    }

    const output = extractOutputText(data);
    if (!output) {
      return NextResponse.json({ error: "ChatGPT Director không trả về nội dung." }, { status: 502 });
    }

    const parsed = JSON.parse(output);
    return NextResponse.json({
      model,
      plan: String(parsed.plan || ""),
      codexPrompt: String(parsed.codexPrompt || prompt),
      reviewChecklist: Array.isArray(parsed.reviewChecklist) ? parsed.reviewChecklist.map(String) : [],
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "ChatGPT Director failed." },
      { status: 500 },
    );
  }
}
