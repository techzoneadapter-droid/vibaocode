import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 60;

type ModelOption = {
  id: string;
  label: string;
  reasoning: string[];
  recommended?: boolean;
  created?: number | null;
};

const FALLBACK_MODELS: ModelOption[] = [
  { id: "gpt-6-astra", label: "GPT-6 Astra — mạnh nhất", reasoning: ["low","medium","high","xhigh","max"], recommended: true },
  { id: "gpt-6-sol", label: "GPT-6 Sol — mạnh/cân bằng", reasoning: ["low","medium","high","xhigh","max"] },
  { id: "gpt-6-luna", label: "GPT-6 Luna — nhanh/tiết kiệm", reasoning: ["none","low","medium","high","xhigh","max"] },
  { id: "gpt-5.6-sol", label: "GPT-5.6 Sol", reasoning: ["low","medium","high","xhigh"] },
  { id: "gpt-5.6-terra", label: "GPT-5.6 Terra", reasoning: ["low","medium","high"] },
  { id: "gpt-5.6-luna", label: "GPT-5.6 Luna", reasoning: ["none","low","medium","high"] },
  { id: "gpt-5.3-codex", label: "GPT-5.3 Codex", reasoning: ["low","medium","high"] },
];

function looksLikeTextModel(id: string) {
  const value = id.toLowerCase();
  if (!/^(gpt-|o[1-9]|chatgpt)/.test(value)) return false;
  return !/(audio|realtime|transcribe|tts|speech|image|video|embedding|moderation|whisper|dall-e)/.test(value);
}

function reasoningFor(id: string) {
  const fallback = FALLBACK_MODELS.find((item) => item.id === id);
  if (fallback) return fallback.reasoning;
  if (/gpt-6-astra|gpt-6-sol/.test(id)) return ["low","medium","high","xhigh","max"];
  if (/gpt-6-luna/.test(id)) return ["none","low","medium","high","xhigh","max"];
  if (/gpt-5\.6-sol/.test(id)) return ["low","medium","high","xhigh"];
  if (/gpt-5\.6-terra|gpt-5\.3-codex/.test(id)) return ["low","medium","high"];
  if (/gpt-5\.6-luna/.test(id)) return ["none","low","medium","high"];
  return ["low","medium","high"];
}

function labelFor(id: string) {
  const fallback = FALLBACK_MODELS.find((item) => item.id === id);
  return fallback?.label || id;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const apiKey = String(body.apiKey || "").trim() || process.env.OPENAI_API_KEY || "";

    if (!apiKey) {
      return NextResponse.json({
        connected: false,
        models: FALLBACK_MODELS,
        recommended: "gpt-6-astra",
        source: "fallback",
      });
    }

    const response = await fetch("https://api.openai.com/v1/models", {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
      cache: "no-store",
    });
    const data = await response.json();

    if (!response.ok) {
      return NextResponse.json(
        { error: data?.error?.message || "Không kết nối được OpenAI API." },
        { status: response.status },
      );
    }

    const raw = Array.isArray(data?.data) ? data.data : [];
    const models: ModelOption[] = raw
      .filter((item: any) => typeof item?.id === "string" && looksLikeTextModel(item.id))
      .map((item: any) => ({
        id: String(item.id),
        label: labelFor(String(item.id)),
        reasoning: reasoningFor(String(item.id)),
        recommended: String(item.id) === "gpt-6-astra",
        created: Number(item.created || 0) || null,
      }))
      .sort((a: ModelOption, b: ModelOption) => {
        if (a.id === "gpt-6-astra") return -1;
        if (b.id === "gpt-6-astra") return 1;
        if (a.id === "gpt-6-sol") return -1;
        if (b.id === "gpt-6-sol") return 1;
        if (a.id === "gpt-6-luna") return -1;
        if (b.id === "gpt-6-luna") return 1;
        return Number(b.created || 0) - Number(a.created || 0) || a.id.localeCompare(b.id);
      });

    return NextResponse.json({
      connected: true,
      models: models.length ? models : FALLBACK_MODELS,
      recommended: models.some((item) => item.id === "gpt-6-astra")
        ? "gpt-6-astra"
        : models[0]?.id || "gpt-6-astra",
      source: models.length ? "openai" : "fallback",
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "OpenAI model lookup failed." },
      { status: 500 },
    );
  }
}
