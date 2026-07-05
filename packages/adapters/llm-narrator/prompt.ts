import type { NarrationRequest } from "@brighten/decision-core";

/**
 * Build grounded system + user prompts for the LLM narrator.
 *
 * The user prompt ONLY contains signals that actually fired (grounding).
 * The system prompt enforces: factual, sober, anti-dopamine, no fabrication.
 *
 * Pure: no IO, deterministic.
 */
export function buildPrompt(request: NarrationRequest): { system: string; user: string } {
  const s = request.suggestion;
  const signals = s.signals;

  const system = [
    "Bạn là Brighten narrator — diễn giải hệ thống giao dịch kỷ luật.",
    "",
    "QUY TẮC CỨNG:",
    "- Diễn giải bằng tiếng Việt, NGẮN (1–3 câu).",
    "- CHỈ dùng các tín hiệu được cung cấp bên dưới.",
    "- TUYỆT ĐỐI không bịa/không thêm chỉ báo/không số liệu không có.",
    "- Không dự đoán giá.",
    "- Giọng bình tĩnh, KHÔNG hưng phấn/không cường điệu (anti-dopamine).",
    "- Không khuyến khích vào lệnh — chỉ nêu vì sao edge nghiêng hướng này.",
  ].join("\n");

  const userParts: string[] = [
    `Pair: ${s.pair}`,
    `Timeframe: ${s.timeframe}`,
    `Direction: ${s.direction.toUpperCase()}`,
    `Entry: ${s.candidate.entry}`,
    `Stop: ${s.candidate.stop}`,
    `Target: ${s.candidate.target}`,
    `R:R: ${s.sizing.rr}`,
    `Risk Amount: $${s.sizing.riskAmount}`,
  ];

  if (signals !== undefined) {
    userParts.push("");
    userParts.push("Tín hiệu đã kích hoạt:");
    for (const [key, value] of Object.entries(signals)) {
      if (value !== undefined && value !== null) {
        userParts.push(`- ${key}: ${JSON.stringify(value)}`);
      }
    }
  }

  return { system, user: userParts.join("\n") };
}
