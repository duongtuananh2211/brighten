import type { NarratorPort, NarrationRequest, Result } from "@brighten/decision-core";
import type { Narration } from "@brighten/decision-core";
import { buildPrompt } from "./prompt.js";

const source = "adapter.llm_narrator";

export interface LlmNarratorDeps {
  readonly fetchFn?: typeof globalThis.fetch;
  readonly apiKey: string;
  readonly baseUrl?: string;
  readonly model?: string;
  readonly temperature?: number;
  readonly maxTokens?: number;
  readonly timeoutMs?: number;
  readonly logger?: (message: string, context?: Readonly<Record<string, unknown>>) => void;
}

const DEFAULT_BASE_URL = "https://api.deepseek.com";
const DEFAULT_MODEL = "deepseek-chat";
const DEFAULT_TEMPERATURE = 0;
const DEFAULT_MAX_TOKENS = 300;
const DEFAULT_TIMEOUT_MS = 8_000;

export function createLlmNarrator(deps: LlmNarratorDeps): NarratorPort {
  const fetchFn = deps.fetchFn ?? globalThis.fetch;
  const baseUrl = deps.baseUrl ?? DEFAULT_BASE_URL;
  const model = deps.model ?? DEFAULT_MODEL;
  const temperature = deps.temperature ?? DEFAULT_TEMPERATURE;
  const maxTokens = deps.maxTokens ?? DEFAULT_MAX_TOKENS;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const logger = deps.logger ?? (() => undefined);

  return {
    async narrate(request: NarrationRequest): Promise<Result<Narration>> {
      const { system, user } = buildPrompt(request);
      const startedAt = Date.now();

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetchFn(`${baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${deps.apiKey}`,
          },
          body: JSON.stringify({
            model,
            messages: [
              { role: "system", content: system },
              { role: "user", content: user },
            ],
            temperature,
            max_tokens: maxTokens,
            stream: false,
          }),
          signal: controller.signal,
        });

        clearTimeout(timer);

        if (!response.ok) {
          const body = await response.text().catch(() => "");
          logger("llm_narrator_http_error", { status: response.status, body: body.slice(0, 200) });
          return fail("http_error", { status: response.status, endpoint: "chat/completions" });
        }

        const raw = await response.json() as Record<string, unknown>;
        const rawText = JSON.stringify(raw);

        const choices = raw["choices"] as readonly { message?: { content?: string } }[] | undefined;
        const content = choices?.[0]?.message?.content;

        if (typeof content !== "string" || content.length === 0) {
          logger("llm_narrator_invalid_response", { raw: rawText.slice(0, 300) });
          return fail("invalid_payload", { reason: "empty or missing choices[0].message.content" });
        }

        const latencyMs = Date.now() - startedAt;

        return {
          ok: true,
          value: {
            text: content.trim(),
            model,
            promptSystem: system,
            promptUser: user,
            rawResponse: rawText,
            temperature,
            latencyMs,
          },
        };
      } catch (error) {
        clearTimeout(timer);

        if (error instanceof DOMException && error.name === "AbortError") {
          logger("llm_narrator_timeout", { timeoutMs });
          return fail("timeout", { timeoutMs });
        }

        logger("llm_narrator_exception", { detail: error instanceof Error ? error.message : String(error) });
        return fail("network_error", { detail: error instanceof Error ? error.message : String(error) });
      }
    },
  };
}

function fail(code: string, context: Readonly<Record<string, unknown>>): Result<never> {
  return { ok: false, error: { code, source, context } };
}
