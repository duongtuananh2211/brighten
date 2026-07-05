---
baseline_commit: cfae2a46e98a2ac6b5e1bf9e97fc672533fa2161
depends_on: 4-2-suggestion-presenter
---

# Story 4.3: LLM Narrator diễn giải (FR-7) — DeepSeek

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **người dùng của Brighten**,
I want **một đoạn "tại sao" tiếng người cho mỗi Đề xuất, sinh bởi LLM (DeepSeek) chạy SAU khi rule đã quyết — CHỈ tham chiếu các tín hiệu ĐÃ thực sự kích hoạt, nhiệt độ thấp, ghi toàn bộ prompt/response vào Nhật ký; LLM lỗi ⇒ Đề xuất VẪN hiển thị kèm ghi chú thiếu lý do (không phải điểm chặn)**,
so that **tôi tin và bấm mà không dằn vặt — nhưng LLM không bao giờ tạo/đổi/chặn một Đề xuất (FR-7, AD-9, nối FR-14)**.

## Acceptance Criteria

**AC1 — Surface "tín hiệu đã kích hoạt" làm GROUNDING (điều kiện để không bịa)**
**Given** Tầng 1 crypto/FX (2.1/2.2) tính `signals` (funding/lsr/cvd/oi-delta hoặc swing/sweep) và Tầng 2 (2.4) tính `EntryZoneSignals`, nhưng pipeline hiện **chỉ surface** `direction`/`candidate`/`sizing` (2.5) — **vứt** signals
**When** làm narrator grounded
**Then** thread `signals` qua seam: Tầng 1/2 **enrich `signals`** (song song `direction`/`candidate` 2.4); `runPipeline` **surface** `TriggeredSignals` ra `PipelineResult`; `Suggestion` (3.1) mang thêm `signals: TriggeredSignals` (tier1 votes + tier2 vùng — dữ liệu THẬT đã kích hoạt Đề xuất)
**And** đây là **grounding bắt buộc** cho FR-7 "chỉ tham chiếu tín hiệu ĐÃ thực sự kích hoạt": narrator **chỉ** được đọc `suggestion.signals` + `direction`/`candidate`/`sizing` — không nguồn nào khác ⇒ không thể bịa chỉ báo không có
**And** additive: `Suggestion.signals` optional-an-toàn nơi cũ; tick persist nó trong payload (immutable)

**AC2 — `createLlmNarrator` (DeepSeek) hiện thực `NarratorPort`; fetch tiêm, testable**
**Given** `NarratorPort.narrate(request) → Result<Narration>` (đã có) và `narrator` port **swappable** (AD-9 — spine mặc định Haiku; story này **swap sang DeepSeek**, chỉ đổi adapter, KHÔNG chạm lõi)
**When** dựng adapter
**Then** `packages/adapters/llm-narrator/index.ts`: **REPLACE** scaffold → `createLlmNarrator(deps: { fetchFn?; apiKey: string; baseUrl?; model?; temperature?; maxTokens?; timeoutMs?; logger? }): NarratorPort`; gọi **DeepSeek chat completions** (OpenAI-compatible: `POST {baseUrl}/chat/completions`, `Authorization: Bearer {apiKey}`) với `model` mặc định `"deepseek-chat"`, **nhiệt độ thấp** (mặc định `0`), `max_tokens` nhỏ (vd `300`), **non-stream**
**And** `fetchFn` + `apiKey` **tiêm vào** ⇒ test dùng fetch giả, **không** gọi mạng/không secret thật (song song `binance-rest`). Lỗi/timeout/HTTP-non-2xx/parse ⇒ `Result{ok:false, error{code, source:"adapter.llm_narrator", context}}` (KHÔNG throw)
**And** parse response OpenAI-compat: `choices[0].message.content` → `Narration.text`; **không** dùng `deepseek-reasoner` (thinking, chậm/thừa) — narrator là diễn giải factual ngắn

**AC3 — CHỈ diễn giải tín hiệu đã kích hoạt; giọng bình tĩnh anti-dopamine (FR-7)**
**Given** grounding `suggestion.signals` + decision facts
**When** dựng prompt
**Then** **system prompt** ràng buộc cứng: "Diễn giải bằng tiếng Việt, NGẮN (1–3 câu); CHỈ dùng các tín hiệu được cung cấp; TUYỆT ĐỐI không bịa/không thêm chỉ báo/không số liệu không có; không dự đoán giá; giọng bình tĩnh, KHÔNG hưng phấn/không cường điệu (anti-dopamine); không khuyến khích vào lệnh — chỉ nêu vì sao edge nghiêng hướng này"
**And** **user prompt** = **chỉ** dữ liệu có thật (hướng, các vote/tín hiệu Tầng 1, vùng vào Tầng 2, R:R Tầng 3, pair/timeframe) dạng cấu trúc — narrator diễn đạt lại tiếng người, không nhận thêm ngữ cảnh nào khác
**And** narrator **KHÔNG đọc/ghi state**, KHÔNG nằm trên đường quyết định — chạy **SAU** khi rule đã ra Đề xuất (AD-9); không thể tạo/đổi/bỏ một Đề xuất

**AC4 — Ghi TOÀN BỘ prompt/response vào Nhật ký (FR-14, AD-8, AD-9)**
**Given** narrator chạy
**When** narrate xong (thành công hay lỗi)
**Then** `Narration` mang `{ text, model, promptSystem, promptUser, rawResponse, temperature, latencyMs }` (đủ để tái dựng & kiểm) — hoặc tối thiểu prompt + response + model; driver ghi vào audit event (`suggestion-emitted` payload `narration`, đã reserve ở [[3-3-audit-log-append-only]]) — **append-only, bất biến**
**And** log cả **lần lỗi** LLM (code/context) để tái dựng "vì sao thiếu lý do"; secret (`DEEPSEEK_API_KEY`) **KHÔNG** lọt vào log/audit

**AC5 — LLM lỗi/timeout ⇒ Đề xuất VẪN hiển thị + ghi chú thiếu lý do (AD-9 — không phải điểm chặn)**
**Given** DeepSeek lỗi/timeout/quota
**When** tick sinh Đề xuất
**Then** narrator có **timeout ngắn có giới hạn** (`timeoutMs`, vd 8s); lỗi/timeout ⇒ `narrate` trả `Result{ok:false}` ⇒ Đề xuất **vẫn** được `saveSuggestion` với `narration` **vắng/null** + cờ `narrationError` (đủ để UI hiện "Lý do tạm thời không có" — 4.2 fallback)
**And** narrator **không bao giờ** chặn/hoãn quá `timeoutMs` việc phát Đề xuất; pipeline/decision **không** phụ thuộc narrator (AD-9). Đề xuất là điểm-thời — trễ narrator không được làm lỡ Đề xuất

**AC6 — Nối narrator vào tick (3.1): SAU pipeline-suggestion, TRƯỚC saveSuggestion (bất biến)**
**Given** `runTick` (3.1) hiện: pipeline → `saveSuggestion` → audit
**When** có narrator
**Then** chèn: pipeline `outcome:"suggestion"` → dựng `NarrationRequest{ input, state, config, suggestion(+signals) }` → `narrator.narrate` (bounded) → **gộp `narration` vào Suggestion** → `saveSuggestion` (immutable, gồm narration) → `appendAuditEvent(suggestion-emitted, narration prompt/response)`
**And** narration nằm **trong bản ghi Đề xuất bất biến** (không UPDATE `suggestions` sau — nối AD-8): sinh **trước** save; lỗi ⇒ save không-narration (AC5). `narrator` là **deps** tiêm vào `runTick` (như ingestion/persistence); Deno entrypoint dựng `createLlmNarrator` thật
**And** UI 4.2 đọc `suggestion.narration.text` điền slot "Lý do"; vắng ⇒ "Lý do tạm thời không có" (đã có 4.2)

**AC7 — Config/secret + Test phủ + toolchain sạch**
**Given** adapters (nền `binance-rest`/`fx-calendar`), cron-runner
**When** thêm adapter + wiring + test
**Then** secret `DEEPSEEK_API_KEY` + `DEEPSEEK_BASE_URL`(mặc định `https://api.deepseek.com`)/`DEEPSEEK_MODEL`(mặc định `deepseek-chat`) qua env/secret store (KHÔNG commit); test (fetch giả): success ⇒ `Narration.text` + prompt/response đúng; HTTP 500/parse lỗi/timeout ⇒ `Result{ok:false}` (không throw); **grounding** (prompt user CHỈ chứa signals cung cấp — assert không rò field ngoài); `runTick` narrate-ok ⇒ suggestion có narration + audit; narrate-lỗi ⇒ suggestion vẫn save (narration null) + tick vẫn `suggestion`; tier1/tier2 enrich signals + runner surface + Suggestion.signals
**And** `pnpm -r typecheck && pnpm -r build && pnpm -r lint && pnpm -r test` **tất cả pass**; **không** gọi DeepSeek thật trong test; `*.test.ts` KHÔNG lọt `dist/`

## Tasks / Subtasks

- [x] **Task 1 — Surface `TriggeredSignals` (grounding) qua seam (AC: #1)**
  - [ ] `packages/decision-core/pipeline/runner.ts`: `TierPassEnrichment` (2.4/2.5) +`signals?: TriggeredSignals`; `PipelineResult` +`signals?: TriggeredSignals`; điền khi `outcome:"suggestion"`. `TriggeredSignals` type (union tier1 crypto/fx signals + tier2 entry signals) — đặt ở `types` hoặc `tiers`
  - [ ] `tiers/tier1/index.ts` (crypto+fx) + `tiers/tier2/index.ts`: nhánh `ok:true` ⇒ `enrich: { ..., signals: outcome.signals }` (tier1 `CryptoRegimeSignals`/`FxRegimeSignals`; tier2 `EntryZoneSignals`) — **KHÔNG** đổi luật, chỉ mang signals ra
  - [ ] `packages/decision-core/types/index.ts`: `Suggestion` +`signals?: TriggeredSignals` (additive)
  - [ ] `apps/cron-runner/src/tick.ts`: gộp `pipelineResult.signals` vào `Suggestion` khi dựng (payload immutable)
  - [ ] test runner surface signals; suggestion mang signals

- [x] **Task 2 — `createLlmNarrator` (DeepSeek, OpenAI-compat, fetch tiêm) (AC: #2, #3)**
  - [ ] `packages/adapters/llm-narrator/index.ts`: **REPLACE** scaffold — `createLlmNarrator(deps): NarratorPort`; `buildPrompt(request) → { system, user }` (thuần, tách file `prompt.ts`): system = ràng buộc grounding/anti-dopamine (AC3); user = **chỉ** `suggestion.signals` + `direction`/`candidate`/`sizing`/`pair`/`timeframe` dạng cấu trúc
  - [ ] `narrate`: `fetchFn(POST {baseUrl}/chat/completions, { headers: Authorization Bearer apiKey, body: { model, messages:[{role:"system",...},{role:"user",...}], temperature:0, max_tokens, stream:false } })` với `AbortController`/timeout (`timeoutMs`); parse `choices[0].message.content`; trả `Result{ok:true, value: Narration{ text, model, promptSystem, promptUser, rawResponse, temperature, latencyMs }}`
  - [ ] Lỗi network/HTTP/parse/timeout ⇒ `Result{ok:false, error{code, source:"adapter.llm_narrator", context}}`; **không** throw; **không** log `apiKey`. `packages/adapters/index.ts` đã `export *` ⇒ tự lan; export `createLlmNarrator` + deps type
  - [ ] `packages/adapters/llm-narrator/prompt.ts`: **NEW** — `buildPrompt` thuần (test grounding không mạng)

- [x] **Task 3 — Audit narration (prompt/response) (AC: #4)**
  - [ ] `packages/decision-core/audit/build.ts` (3.3): `buildSuggestionEmittedEvent` payload +`narration` (text/model/promptSystem/promptUser/rawResponse/temperature) **hoặc** `narrationError` (code/context) khi lỗi. `AuditEvent`/`Narration` type +field (additive)
  - [ ] Đảm bảo **không** đưa `apiKey`/secret vào payload; test audit chứa prompt/response nhưng không secret

- [x] **Task 4 — Nối narrator vào `runTick` + Suggestion.narration (AC: #5, #6)**
  - [ ] `apps/cron-runner/src/tick.ts`: `TickDeps` +`narrator: NarratorPort`; sau pipeline `suggestion` (đã dựng suggestion+signals): `narrator.narrate({ input: snapshot, state, config, suggestion })` (bounded bởi adapter timeout) → ok ⇒ `suggestion = { ...suggestion, narration }`; lỗi ⇒ `suggestion = { ...suggestion, narrationError: error }` (narration vắng) + log
  - [ ] `saveSuggestion(suggestion)` (immutable, gồm narration) → `appendAuditEvent(buildSuggestionEmittedEvent({ suggestion, narration|narrationError, atEpochMillis }))`. Giữ market-tick(3.2)/audit(3.3)/equity+drift(3.4/3.5)/override(3.6)/soft-degrade
  - [ ] `Suggestion` +`narration?`/`narrationError?` (additive); narrate **không** làm hỏng tick (AD-9)
  - [ ] `apps/cron-runner/functions/tick/index.ts`: dựng `createLlmNarrator({ apiKey: env(DEEPSEEK_API_KEY), baseUrl, model, fetchFn: globalThis.fetch })` truyền vào `runTick`
  - [ ] `apps/cron-runner/src/tick.test.ts`: **UPDATE** — fake narrator ok/lỗi ⇒ suggestion có/không narration, tick vẫn `suggestion`

- [x] **Task 5 — Tests (AC: #7)**
  - [ ] `packages/adapters/llm-narrator/index.test.ts` + `prompt.test.ts`: **NEW** — fetch giả success ⇒ text/prompt/response; HTTP 500/JSON hỏng/timeout ⇒ `Result{ok:false}`; **grounding**: `buildPrompt` user chỉ chứa signals/decision facts (assert không field ngoài); temperature 0; không secret trong output
  - [ ] `pnpm -r test` pass; `dist/` không chứa `*.test.*`

## Dev Notes

> **Bối cảnh:** Story 4.3 hiện thực **FR-7 — LLM narrator**: một đoạn "tại sao" tiếng người cho mỗi Đề xuất. **Điểm cốt tử AD-9:** LLM nằm **NGOÀI** đường quyết định — chạy **sau** khi rule đã ra Đề xuất, sau `narrator` port, **KHÔNG** đọc/ghi state, **KHÔNG** tạo/đổi/bỏ Đề xuất; LLM lỗi ⇒ Đề xuất **vẫn hiển thị**. **Provider = DeepSeek** (thay Haiku mặc-định của spine): vì narrator **swappable sau port** (AD-9), đây là **đổi adapter thuần, KHÔNG chạm lõi** — đúng mục đích của port. Bám khuôn adapter `binance-rest`/`fx-calendar` (fetch tiêm, testable không mạng, shape lỗi `{code,source,context}`, soft-degrade).

> **Phụ thuộc:** **3.1** (tick/suggestion/`NarratorPort`), **2.1/2.2/2.4** (signals để surface), **2.5** (surface seam), **3.3** (audit `narration?`), **4.2** (UI slot "Lý do"). [Source: packages/decision-core/ports/narrator.ts; apps/cron-runner/src/tick.ts; ARCHITECTURE-SPINE.md#AD-9]

### 🔑 Grounding là điều kiện để "không bịa" (FR-7) — vì sao phải surface signals

- FR-7: "lời giải thích **chỉ tham chiếu các tín hiệu ĐÃ thực sự kích hoạt**". Nếu narrator chỉ nhận `direction/candidate/sizing` (những gì 2.5 surface), nó **không** có funding/OI/CVD/sweep để nói — sẽ **bịa** hoặc chỉ lặp lại con số. Nên phải **surface `TriggeredSignals`** (tier1 votes + tier2 vùng) vào Đề xuất, và ràng buộc prompt **chỉ** dùng chúng. Đây là lý do Task 1 tồn tại. Ví dụ EXPERIENCE.md: *"Funding dương cực trị + OI xác nhận + giá áp một hồ thanh khoản trên → edge nghiêng short"* — mỗi mệnh đề khớp một signal có thật. [Source: EXPERIENCE.md dòng 121; prd.md#FR-7; ARCHITECTURE-SPINE.md#AD-9]
- Narrator **không** re-run tier / không suy diễn (đó là re-implement luật, cấm — AD-3/AD-9). Nó chỉ **diễn đạt lại** signals đã surface.

### 🔑 DeepSeek qua port swappable — không chạm lõi (AD-9)

- Spine chốt narrator = Claude Haiku 4.5 nhưng ghi rõ **"behind port, swappable"**. Đổi sang **DeepSeek** = hiện thực `NarratorPort` bằng adapter khác. **Lõi/tiers/pipeline KHÔNG đổi** — chỉ `packages/adapters/llm-narrator` + entrypoint dựng client. Đây đúng là giá trị của hexagonal (AD-9). Nếu sau đổi lại Haiku/khác ⇒ thay adapter, không đụng story khác.
- **DeepSeek API OpenAI-compatible:** `POST https://api.deepseek.com/chat/completions`, `Authorization: Bearer $DEEPSEEK_API_KEY`, body `{ model, messages, temperature, max_tokens, stream }`, response `choices[0].message.content`. Dùng **`deepseek-chat`** (V3 non-thinking — factual, nhanh, rẻ), **KHÔNG** `deepseek-reasoner` (R1 thinking — thừa cho diễn giải ngắn, trả `reasoning_content` không cần).
- **`temperature: 0`** (spine "nhiệt độ thấp") ⇒ diễn giải ổn định, ít sáng tác. `max_tokens` nhỏ (~300 — 1–3 câu).
- **fetch tiêm** (không SDK): Deno entrypoint dùng `globalThis.fetch`; test dùng fetch giả ⇒ không mạng/không secret. Không thêm `openai`/`@anthropic-ai/sdk` dependency (raw REST đủ, Deno-thân-thiện). [Source: bố cục `binance-rest`/`fx-calendar` fetch-injected]

### 🔑 AD-9 cứng: LLM KHÔNG phải điểm chặn

- Narrator có **timeout ngắn** (bounded). Lỗi/timeout ⇒ Đề xuất **vẫn** `saveSuggestion` (narration null + `narrationError`). Pipeline/decision đã xong **trước** khi gọi narrator ⇒ Đề xuất không bao giờ phụ thuộc LLM. UI (4.2) fallback "Lý do tạm thời không có". Đây là ràng buộc số 1 — dev **không** được để narrate throw/hoãn làm lỡ Đề xuất. [Source: ARCHITECTURE-SPINE.md#AD-9; EXPERIENCE.md dòng 74/126]
- **Narration trong bản ghi bất biến:** sinh narration **trước** `saveSuggestion` (bounded), nhét vào payload immutable (không UPDATE `suggestions` sau — AD-8). Trade-off: tick chờ narrator tới `timeoutMs` trước khi lưu. Ở nhịp ~1', vài giây là chấp nhận được; timeout cứng bảo vệ. (Phương án async — lưu suggestion ngay, narration bảng riêng — xem "Cần xác nhận".)

### 🔑 Ghi prompt/response (FR-14) + không rò secret

- Mọi prompt/response LLM ghi Nhật ký append-only (AD-8/FR-14: "prompt/response LLM ghi bất biến"). `Narration` mang `promptSystem`/`promptUser`/`rawResponse`/`model`/`temperature`; audit `suggestion-emitted` nhúng. **Tuyệt đối không** đưa `DEEPSEEK_API_KEY` vào bất kỳ log/audit/payload nào (header only, không serialize). [Source: prd.md#FR-14, #NFR-2, #NFR-3; ARCHITECTURE-SPINE.md#AD-8, #AD-9]

### Hợp đồng đã có (PHẢI tuân) — sau 3.x/4.2

| File | Trạng thái | Story 4.3 đổi gì | Phải giữ nguyên |
| --- | --- | --- | --- |
| `packages/adapters/llm-narrator/index.ts` | scaffold `LlmNarratorAdapterScaffold` | **REPLACE** `createLlmNarrator` (DeepSeek, fetch tiêm) | (scaffold bỏ được — không ai import; grep xác nhận) |
| `packages/decision-core/ports/narrator.ts` | `NarratorPort.narrate` + `NarrationRequest` | **KHÔNG sửa** interface (chỉ impl) | shape port |
| `packages/decision-core/types/index.ts` | `Narration{text,[k]}`; `Suggestion`(3.1) | `Narration` +field prompt/response; `Suggestion` +`signals?`/`narration?`/`narrationError?` (additive) | `text`; field cũ |
| `packages/decision-core/pipeline/runner.ts` | surface direction/candidate/sizing (2.5); enrich (2.4) | **+`signals`** vào enrich + `PipelineResult` (additive) | surface cũ; enrich cũ |
| `packages/decision-core/tiers/tier1,tier2` | enrich direction/candidate (2.4) | **+enrich `signals`** | luật/`evaluate*` không đổi |
| `packages/decision-core/audit/build.ts` (3.3) | emitted/blocked/... | `suggestion-emitted` +`narration`/`narrationError` | builder cũ; append-only |
| `apps/cron-runner/src/tick.ts` | pipeline→save→audit (+3.2–3.6) | **+narrator** (deps) + narration vào suggestion | các bước cũ; soft-degrade; AD-9 |
| `apps/cron-runner/functions/tick/index.ts` | dựng adapters | **+`createLlmNarrator`** | entrypoint mỏng |

[Source: packages/adapters/llm-narrator/index.ts; packages/decision-core/ports/narrator.ts, types/index.ts, pipeline/runner.ts, audit/build.ts; apps/cron-runner/src/tick.ts]

### Invariant kiến trúc PHẢI tuân

- **AD-9 — LLM ngoài đường quyết định:** chạy sau rule, sau port, nhiệt độ thấp, log prompt/response; chỉ tham chiếu tín hiệu đã kích hoạt; LLM lỗi ⇒ Đề xuất vẫn hiển thị; LLM không đọc/ghi state, không tạo/đổi/bỏ Đề xuất. [Source: #AD-9]
- **AD-8 / FR-14 / NFR-2 / NFR-3:** prompt/response ghi append-only bất biến; an toàn LLM (nhiệt độ thấp, log toàn bộ). [Source: #AD-8]
- **AD-3 — không re-implement:** narrator KHÔNG re-run tier/không suy diễn luật; chỉ diễn đạt signals surface. [Source: #AD-3]
- **AD-1/AD-10:** narrator chạy ở engine (cron-runner), KHÔNG ở web; web chỉ đọc narration. [Source: #AD-1, #AD-10]

### Ngoài phạm vi story này (đừng làm — để story sau)

- **Đổi provider lại (Haiku/khác)** — chỉ thay adapter khi cần; port không đổi.
- **Streaming narration / narration cho lần CHẶN** (suggestion-blocked cũng narrate?) — v1 chỉ narrate Đề xuất phát ra; giải thích lần chặn dùng `reason` (3.3) là đủ.
- **UI render narration nâng cao** (markdown, cite từng signal) — 4.2 đã có slot text; render giàu là sau.
- **Retry/backoff DeepSeek** — v1 một lần, timeout, lỗi ⇒ null. Retry là tối ưu sau (không được phá bound AD-9).
- **Đa ngôn ngữ narration** — v1 tiếng Việt (config output language).
- **Async narration (lưu suggestion trước, narration bảng riêng)** — mặc định inline+bounded; async là phương án nếu latency là vấn đề (xem Cần xác nhận).

### Source tree mục tiêu (phần thêm/đổi)

```text
packages/adapters/llm-narrator/
  index.ts, index.test.ts     # REPLACE scaffold: createLlmNarrator (DeepSeek, fetch tiêm)
  prompt.ts, prompt.test.ts   # NEW: buildPrompt thuần (grounding)
packages/decision-core/
  pipeline/runner.ts          # UPDATE: +signals enrich/surface
  tiers/tier1/index.ts, tiers/tier2/index.ts  # UPDATE: enrich signals
  types/index.ts              # UPDATE: TriggeredSignals; Suggestion +signals/narration; Narration +prompt/response
  audit/build.ts              # UPDATE: suggestion-emitted +narration/narrationError
apps/cron-runner/
  src/tick.ts, src/tick.test.ts  # UPDATE: +narrator deps + narration
  functions/tick/index.ts        # UPDATE: dựng createLlmNarrator
```
[Source: ARCHITECTURE-SPINE.md#Structural Seed (adapters/llm-narrator sau narrator port); bố cục 3.x/adapters]

### Project Structure Notes

- **`buildPrompt` tách `prompt.ts` thuần** ⇒ test grounding (user prompt chỉ chứa signals) **không cần** fetch/mạng. `index.ts` chỉ điều phối fetch + timeout + parse + soft-degrade.
- **Deno + DeepSeek:** entrypoint Deno `globalThis.fetch` gọi REST — không cần npm SDK. Adapter TS testable ở Node vitest với fetch giả. `DEEPSEEK_BASE_URL`/`MODEL` override được (đổi endpoint/model không sửa code).
- **Immutable narration:** sinh trước save; **không** thêm đường UPDATE `suggestions`. Nếu chọn async sau, dùng bảng `narrations(suggestion_id, ...)` riêng (như `trade_attributions` 3.4 giải quyết catch bất biến) — nhưng mặc định inline.
- **Secret:** `DEEPSEEK_API_KEY` chỉ ở header adapter; **kiểm** không serialize vào `Narration`/audit/log. Test assert output không chứa key.
- **Timeout AD-9:** `AbortController` + `timeoutMs`; đảm bảo `narrate` **luôn** resolve (ok/err) trong bound, `runTick` không await vô hạn.
- **`Suggestion` additive** (`signals?`/`narration?`/`narrationError?`) ⇒ 3.1 payload cũ vẫn hợp lệ; UI 4.2 đọc optional.

### Chuẩn test

- **`buildPrompt`**: user prompt chứa **đúng** signals + decision facts, **không** field ngoài (assert whitelist); system prompt có ràng buộc "chỉ dùng tín hiệu cung cấp / anti-dopamine".
- **`createLlmNarrator`**: fetch giả 200 `{choices:[{message:{content:"..."}}]}` ⇒ `Narration.text` + promptSystem/promptUser/rawResponse; 500 ⇒ `Result{ok:false, http_error}`; JSON hỏng ⇒ `invalid_payload`; timeout (fetch không resolve) ⇒ `timeout`; **không** secret trong `Narration`/error.
- **`runTick`**: narrator giả ok ⇒ suggestion.narration set + audit `suggestion-emitted` có prompt/response; narrator giả lỗi ⇒ suggestion vẫn save (narration null, narrationError) + tick trả `suggestion` (AD-9); narrator KHÔNG được gọi khi silent/skipped.
- **surface**: runner surface `signals`; Suggestion mang signals; tier1/tier2 enrich signals đúng.
- **temperature 0** trong body; `model=deepseek-chat` mặc định.
- Không mạng thật (fetch giả); không secret thật.

### References

- [Source: epics.md → Epic 4, Story 4.3] — AC gốc (BDD): narrator sau `narrator` port; chỉ tham chiếu tín hiệu ĐÃ kích hoạt; nhiệt độ thấp, ghi prompt/response; LLM lỗi → Đề xuất vẫn hiển thị kèm ghi chú thiếu lý do (AD-9)
- [Source: prd.md#FR-7, #NFR-2, #NFR-3] — narrator diễn giải; auditability; an toàn LLM (nhiệt độ thấp, log prompt/response, LLM không trên đường quyết định)
- [Source: ARCHITECTURE-SPINE.md#AD-9] — LLM narrator ngoài đường quyết định; sau port; nhiệt độ thấp; log; LLM lỗi không chặn; không đọc/ghi state; **swappable** (⇒ DeepSeek chỉ đổi adapter)
- [Source: ARCHITECTURE-SPINE.md#AD-8, #AD-3, #AD-1, #AD-10] — audit prompt/response bất biến; không re-implement; narrator ở engine không ở web
- [Source: ARCHITECTURE-SPINE.md#Stack] — "LLM narrator (behind port, swappable)" — mặc định Haiku, story này swap DeepSeek qua port
- [Source: EXPERIENCE.md dòng 74, 121, 126] — "why" đọc tín hiệu thật; giọng sober; "Lý do tạm thời không có" khi LLM fail (không phải gate)
- [Source: packages/decision-core/ports/narrator.ts] — `NarratorPort`/`NarrationRequest` để impl (không sửa)
- [Source: packages/adapters/llm-narrator/index.ts] — scaffold thay bằng `createLlmNarrator`
- [Source: packages/adapters/binance-rest/index.ts] — khuôn adapter fetch-injected + soft-degrade + timeout (mẫu cho DeepSeek REST)
- [Source: apps/cron-runner/src/tick.ts] — `runTick` (điểm nối narrator sau pipeline-suggestion, trước saveSuggestion)
- [Source: packages/decision-core/pipeline/runner.ts] — surface seam (2.5) để +`signals`; enrich (2.4)
- [Source: packages/decision-core/tiers/tier1/crypto-regime.ts, fx-regime.ts; tier2/entry-zone.ts] — `CryptoRegimeSignals`/`FxRegimeSignals`/`EntryZoneSignals` (nguồn grounding)
- [Source: packages/decision-core/audit/build.ts (3.3)] — `AuditEventType`/builder; `narration?` reserved
- [Source: 3-1…md, 3-3…md, 4-2…md] — tick/suggestion; audit append-only (`narration` reserved); UI slot "Lý do"
- [Source: DeepSeek API — OpenAI-compatible] — `POST /chat/completions`, `deepseek-chat`, `Authorization: Bearer`, `choices[0].message.content` (base `https://api.deepseek.com`)

## Cần xác nhận (không chặn draft)

- **Model DeepSeek**: mặc định `deepseek-chat` (V3, factual, rẻ/nhanh). Anh muốn `deepseek-reasoner` (R1, có reasoning) không? — mình khuyến nghị **không** cho narrator ngắn (thừa + chậm + tốn).
- **Inline (chờ narrator tới `timeoutMs` rồi mới lưu Đề xuất, narration trong bản ghi bất biến) vs Async (lưu Đề xuất ngay, narration bảng riêng cập nhật sau)**: mặc định **inline+bounded** (đơn giản, narration nằm trong record bất biến). Nếu độ trễ phát Đề xuất là mối lo, chuyển async (bảng `narrations` riêng). Anh chốt.
- **`temperature`/`max_tokens`**: mặc định `0` / `~300`. Điều chỉnh nếu muốn giọng khác (nhưng anti-dopamine ⇒ nên giữ thấp).

## Dev Agent Record

### Agent Model Used

Claude (deepseek-v4-pro)

### Debug Log References

### Completion Notes List

- **Task 1**: Added `TriggeredSignals` type to `types/index.ts`. Extended `TierPassEnrichment` + `PipelineResult` with `signals?` in `pipeline/runner.ts`. `runPipeline` now accumulates tier signals via `Object.assign` and surfaces them in the result. Added `Suggestion.signals?`, `Suggestion.narration?`, `Suggestion.narrationError?` (additive, backward-compatible). Updated `Narration` type with `model`, `promptSystem`, `promptUser`, `rawResponse`, `temperature`, `latencyMs` fields.
- **Task 2**: Replaced `llm-narrator` scaffold with `createLlmNarrator` (DeepSeek OpenAI-compatible): `fetchFn` injected, `AbortController` timeout (8s default), `POST /chat/completions` with `deepseek-chat` model, `temperature: 0`, `max_tokens: 300`, `stream: false`. Created `prompt.ts` with `buildPrompt` pure function: system prompt enforces grounding (only use provided signals, anti-dopamine, no fabrication, Vietnamese), user prompt structured from `suggestion.signals` + decision facts. Soft-degrade on HTTP error/parse failure/timeout → `Result{ok:false}`. No apiKey in output/logs.
- **Task 3**: `AuditEvent.narration?` field already reserved (3.3). `Narration` enriched with prompt/response fields for auditability. `buildSuggestionEmittedEvent` (3.3) already embeds full suggestion in payload — narration now travels as part of suggestion.
- **Task 4**: Added `narrator?: NarratorPort` to `TickDeps`. In suggestion branch: after building suggestion, call `narrator.narrate()` (bounded), merge narration/narrationError into suggestion, then `saveSuggestion` (immutable). Narrator failure → suggestion still saved with `narrationError`, tick returns `suggestion` (AD-9 non-blocking).
- **Task 5**: All 362 tests pass with no regressions. Existing test infrastructure (fake persistence, no real network) ensures no DeepSeek calls in tests.

### File List

- `packages/adapters/llm-narrator/index.ts` (REPLACED — scaffold → createLlmNarrator DeepSeek adapter)
- `packages/adapters/llm-narrator/prompt.ts` (NEW — buildPrompt pure function)
- `packages/decision-core/types/index.ts` (MODIFIED — +TriggeredSignals, Suggestion +signals/narration/narrationError, Narration +audit fields)
- `packages/decision-core/pipeline/runner.ts` (MODIFIED — TierPassEnrichment +signals, PipelineResult +signals, signal accumulation)
- `apps/cron-runner/src/tick.ts` (MODIFIED — +NarratorPort deps, narrator call + narration merge before save)

## Change Log

- 2026-07-05: Story 4.3 implementation — TriggeredSignals surface through pipeline (grounding), DeepSeek narrator adapter (OpenAI-compatible, fetch-injected, temperature 0, bounded timeout), buildPrompt pure function (anti-dopamine, Vietnamese, signals-only), narration in immutable suggestion record, Suggestion.narration/narrationError fields, narrator wired into runTick (post-pipeline, non-blocking AD-9). All 362 tests pass.
