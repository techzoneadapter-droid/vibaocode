import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 60;

const FALLBACK_MODELS = [
  { id: "grok-4.7", label: "Grok 4.7 — mạnh nhất cho code", reasoning: ["low","medium","high","xhigh"], recommended: true },
  { id: "grok-4.6", label: "Grok 4.6 — frontier coding", reasoning: ["low","medium","high","xhigh"] },
  { id: "grok-4.5", label: "Grok 4.5 — coding/agentic", reasoning: ["low","medium","high"] },
  { id: "grok-4.3", label: "Grok 4.3 — nhanh, context lớn", reasoning: ["none","low","medium","high","xhigh"] },
  { id: "grok-4.20-0309-reasoning", label: "Grok 4.20 Reasoning", reasoning: ["low","medium","high","xhigh"] },
  { id: "grok-4.20-0309-non-reasoning", label: "Grok 4.20 Non-Reasoning", reasoning: [] },
  { id: "grok-4.20-multi-agent-0309", label: "Grok 4.20 Multi-Agent", reasoning: ["low","medium","high","xhigh"] },
  { id: "grok-build-0.1", label: "Grok Build 0.1 — coding", reasoning: [] },
];

function looksLikeLanguageModel(id: string) {
  const value = id.toLowerCase();
  return value.startsWith("grok-") &&
    !/(imagine|image|video|voice|embedding|transcribe|speech|tts|stt)/i.test(value);
}

function reasoningFor(id: string) {
  const fallback = FALLBACK_MODELS.find((item) => item.id === id);
  if (fallback) return fallback.reasoning;
  if (/grok-4\.(7|6)/.test(id)) return ["low","medium","high","xhigh"];
  if (/grok-4\.5/.test(id)) return ["low","medium","high"];
  if (/grok-4\.3/.test(id)) return ["none","low","medium","high","xhigh"];
  if (/multi-agent|reasoning/.test(id)) return ["low","medium","high","xhigh"];
  return [];
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const apiKey = String(body.apiKey || "").trim();

    if (!apiKey) {
      return NextResponse.json({
        connected: false,
        models: FALLBACK_MODELS,
        recommended: "grok-4.7",
        source: "fallback",
      });
    }

    const response = await fetch("https://api.x.ai/v1/models", {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
      cache: "no-store",
    });
    const data = await response.json();

    if (!response.ok) {
      return NextResponse.json(
        { error: data?.error?.message || data?.message || "Không kết nối được xAI API." },
        { status: response.status },
      );
    }

    const raw = Array.isArray(data?.data) ? data.data : [];
    const models = raw
      .filter((item: any) => typeof item?.id === "string" && looksLikeLanguageModel(item.id))
      .map((item: any) => ({
        id: String(item.id),
        label: String(item.id),
        aliases: Array.isArray(item.aliases) ? item.aliases.map(String) : [],
        contextLength: Number(item.context_length || 0) || null,
        created: Number(item.created || 0) || null,
        promptTextTokenPrice: Number(item.prompt_text_token_price || 0) || null,
        cachedPromptTextTokenPrice: Number(item.cached_prompt_text_token_price || 0) || null,
        completionTextTokenPrice: Number(item.completion_text_token_price || 0) || null,
        reasoning: reasoningFor(String(item.id)),
        recommended: String(item.id) === "grok-4.7",
      }))
      .sort((a: any, b: any) => {
        if (a.id === "grok-4.7") return -1;
        if (b.id === "grok-4.7") return 1;
        return Number(b.created || 0) - Number(a.created || 0) || a.id.localeCompare(b.id);
      });

    return NextResponse.json({
      connected: true,
      models: models.length ? models : FALLBACK_MODELS,
      recommended: models.some((item: any) => item.id === "grok-4.7") ? "grok-4.7" : models[0]?.id || "grok-4.7",
      source: models.length ? "xai" : "fallback",
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "xAI model lookup failed." },
      { status: 500 },
    );
  }
}
