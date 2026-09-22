import { NextRequest, NextResponse } from "next/server";

const schema = {
  type: "object",
  properties: {
    content: {
      type: "string",
      description: "Complete replacement contents for the selected file.",
    },
    summary: {
      type: "string",
      description: "A concise Vietnamese summary of what changed and why.",
    },
  },
  required: ["content", "summary"],
  additionalProperties: false,
};

function extractOutputText(data: any): string {
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

export async function POST(request: NextRequest) {
  const body = await request.json();
  const provider = String(body.provider || "openai");
  const prompt = String(body.prompt || "").trim();
  const filePath = String(body.filePath || "").trim();
  const content = String(body.content ?? "");
  const projectContext = String(body.projectContext || "").slice(0, 20000);
  const sessionKey = String(body.apiKey || "").trim();

  if (provider !== "openai") {
    return NextResponse.json({ error: "V1 hiện hỗ trợ OpenAI trước." }, { status: 400 });
  }

  if (!prompt || !filePath) {
    return NextResponse.json({ error: "Thiếu prompt hoặc file đang chỉnh." }, { status: 400 });
  }

  if (content.length > 120000) {
    return NextResponse.json(
      { error: "File quá lớn cho chế độ sửa trực tiếp ở V1." },
      { status: 413 }
    );
  }

  const apiKey = sessionKey || process.env.OPENAI_API_KEY || "";
  if (!apiKey) {
    return NextResponse.json(
      { error: "Chưa có OpenAI API key. Thêm key trong Settings hoặc biến môi trường OPENAI_API_KEY." },
      { status: 401 }
    );
  }

  const model = process.env.OPENAI_MODEL || "gpt-6-astra";
  const instructions = [
    "You are Vibaocode's coding agent.",
    "Edit only the selected file unless the user explicitly asks for a replacement file.",
    "Preserve existing behavior not related to the request.",
    "Do not add secrets, credentials, tracking, or destructive behavior.",
    "Return the full replacement file content and a short Vietnamese summary.",
    "Favor mobile-first, accessible and maintainable code.",
  ].join("\n");

  const input = [
    `PROJECT CONTEXT:\n${projectContext || "(none)"}`,
    `SELECTED FILE: ${filePath}`,
    "CURRENT FILE CONTENT:",
    content,
    "USER REQUEST:",
    prompt,
  ].join("\n\n");

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      instructions,
      input,
      max_output_tokens: 16000,
      text: {
        format: {
          type: "json_schema",
          name: "vibaocode_file_edit",
          strict: true,
          schema,
        },
      },
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    return NextResponse.json(
      { error: data?.error?.message || "OpenAI request failed." },
      { status: response.status }
    );
  }

  const outputText = extractOutputText(data);
  if (!outputText) {
    return NextResponse.json({ error: "AI không trả về nội dung chỉnh sửa." }, { status: 502 });
  }

  try {
    const result = JSON.parse(outputText);
    return NextResponse.json({
      content: String(result.content ?? ""),
      summary: String(result.summary ?? "AI đã tạo bản chỉnh sửa."),
      model,
    });
  } catch {
    return NextResponse.json(
      { error: "Không đọc được structured output từ AI." },
      { status: 502 }
    );
  }
}
