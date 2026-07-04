---
baseline_commit: bd489f4a1902a89f12d6c1f45fd33ead36a87e91
---

# Story 1.5: Cost hurdle — cổng chi phí (FR-11)

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **người dùng (solo trader) của Brighten**,
I want **một cổng chi phí tất định BÊN TRONG Tầng 3 loại các lệnh "tàng tàng" mà edge kỳ vọng không vượt nổi bội số chi phí round-trip cấu hình được (`cost_hurdle_x`), cộng một chỉ số theo dõi tỷ lệ phí/lãi-gộp để bật cờ đỏ overtrade**,
so that **hệ thống không đẩy tôi vào overtrade với edge mỏng — chỉ những setup có biên lợi nhuận kỳ vọng thực sự vượt chi phí mới được phát Đề xuất, và mọi lần chặn tái lập được 100% (FR-11, NFR-6)**.

## Acceptance Criteria

**AC1 — Cổng cost-hurdle chạy TRONG Tầng 3, SAU sizing (AD-5)**
**Given** một `expectedEdge` (edge kỳ vọng, đơn vị quote) và một `roundTripFee` (phí round-trip ước lượng, đơn vị quote) — cả hai là decimal-string — cùng `cost_hurdle_x` từ config snapshot
**When** Tầng 3 chạy: **trước tiên** tính sizing (Story 1.4), **rồi mới** tới cổng cost-hurdle
**Then** nếu sizing đã **veto** (rr thấp / setup phi lý) thì Tầng 3 dừng ở đó, **không** chạy cổng cost-hurdle (short-circuit theo thứ tự)
**And** cổng cost-hurdle là **một cổng nữa bên trong Tầng 3**, KHÔNG phải một tầng thứ 5 (AD-5)
**And** khi thiếu `expectedEdge` **hoặc** `roundTripFee` trong context (biên epic 1: Tầng 1 sinh edge còn stub, mô hình phí chưa có) ⇒ cổng **bỏ qua** (pass), y hệt cách Tầng 3 pass khi thiếu candidate/account ở 1.4

**AC2 — Tín hiệu chỉ qua nếu `edge ≥ cost_hurdle_x × phí round-trip` (X từ config)**
**Given** `hurdle = cost_hurdle_x × roundTripFee` (tính bằng **decimal**, không JS `number`)
**When** so sánh `expectedEdge` với `hurdle` (so sánh **decimal**)
**Then** `expectedEdge ≥ hurdle` ⇒ cổng **pass** (kể cả **bằng đúng** ngưỡng — biên **pass**)
**And** `expectedEdge < hurdle` ⇒ Tầng 3 **veto** tại `"tier3"` với `reason` nêu rõ `expectedEdge` thực, `hurdle`, `roundTripFee`, `cost_hurdle_x` — lý do **ghi lại được** (không im lặng vô cớ)
**And** rejection mang shape lỗi thống nhất `{ code: "cost_hurdle_not_met", source: "tier3.cost_hurdle", context }`

**AC3 — Từ chối input phi lý với lỗi shape thống nhất**
**Given** input vi phạm: `roundTripFee < 0`; `cost_hurdle_x ≤ 0`; `expectedEdge`/`roundTripFee`/`cost_hurdle_x` không parse được thành decimal-string
**When** cổng cost-hurdle chạy
**Then** trả **rejection tường minh** mang mã lỗi + lý do (`{ code, source: "tier3.cost_hurdle", context }`), **không** trả pass rác, **không** throw string trần
**And** không phép nào để `number` tiền lọt qua (không `NaN`/`Infinity`; chặn bằng kiểm decimal, không bằng `Number.isFinite`)

**AC4 — Theo dõi tỷ lệ phí/lãi-gộp + cờ đỏ overtrade (hàm thuần; ngưỡng từ config)**
**Given** phí luỹ kế `cumulativeFees` và lãi-gộp luỹ kế `cumulativeGrossProfit` (decimal-string) cùng ngưỡng `overtrade_cost_ratio_limit` từ config snapshot
**When** gọi hàm đánh giá overtrade
**Then** trả `{ ratio, flagged }`: `ratio = cumulativeFees / cumulativeGrossProfit` (decimal-string) và `flagged = ratio > limit` (**vượt** ngưỡng = strictly greater; `ratio == limit` ⇒ **không** flag — biên)
**And** biên `cumulativeGrossProfit ≤ 0`: nếu `cumulativeFees > 0` ⇒ `flagged = true`, `ratio = null` (phí mà không có lãi = overtrade tệ nhất, tránh chia 0); nếu `cumulativeFees == 0` ⇒ `flagged = false`
**And** input phi lý (decimal-string rác, `limit ≤ 0`) ⇒ rejection shape thống nhất `source: "tier3.overtrade"`
**And** hàm này **thuần** — **KHÔNG** tự tích luỹ state, **KHÔNG** đọc IO/persistence; sự tích luỹ phí/lãi luỹ kế vào state bền và việc surface cờ đỏ lên UI/audit là **ngoài phạm vi** (xem Ngoài phạm vi → nối vào 1.6/feedback)

**AC5 — Tất định 100% + config có phiên bản nhúng ngưỡng (NFR-6, AD-4)**
**Given** cùng một `(expectedEdge, roundTripFee, cost_hurdle_x)` và cùng một `(cumulativeFees, cumulativeGrossProfit, limit)`
**When** gọi các hàm **nhiều lần**
**Then** output **bằng nhau tuyệt đối** đến từng chữ số (deep-equal decimal-string) — không ngẫu nhiên, không AI, không phụ thuộc thứ tự
**And** mọi phép chia đi qua `math/decimal.ts` (precision/rounding **một chỗ** — cùng nguồn với 1.4), không tự chọn precision
**And** `cost_hurdle_x` **và** `overtrade_cost_ratio_limit` đọc từ **config snapshot đã version** (AD-4), không đọc "config sống"; hàm cổng **thuần** (không mutate input, không `Date`/`Math.random`/IO — pass lint `decision-core`)

**AC6 — Test phủ từng AC + toolchain sạch**
**Given** Vitest (nền từ 1.2/1.3/1.4)
**When** thêm test cho cổng cost-hurdle + overtrade + wiring Tầng 3 + config
**Then** có test cho: `hurdle = X×fee` đúng trên số cụ thể; **pass tại biên** `edge == hurdle`; **veto** khi `edge < hurdle` (context đủ trường); mỗi input phi lý ở AC3 → rejection đúng `code`; overtrade ratio/flag đúng + **biên** `ratio == limit` không flag + biên `grossProfit ≤ 0`; tất định (2 lần → `toEqual`); không mutate input; không leak `number` (`typeof === "string"`); Tầng 3 short-circuit khi sizing veto (không tới cost-hurdle); Tầng 3 pass khi thiếu edge/fee; config param mới validate + có trong `DEFAULT_PARAMS` + snapshot
**And** `pnpm -r typecheck && pnpm -r build && pnpm -r lint && pnpm -r test` **tất cả pass**; `*.test.ts` không lọt `dist`

## Tasks / Subtasks

- [x] **Task 1 — Thêm tham số config `overtrade_cost_ratio_limit` (backward-compatible additive) (AC: #4, #5)**
  - [x] `packages/config/src/schema.ts`: thêm `overtrade_cost_ratio_limit: string` (decimal-string) vào `ConfigParams`; thêm vào `DEFAULT_PARAMS` (đề xuất mặc định `"0.3"` — phí không nên quá 30% lãi gộp; là **ngưỡng deferred-tuning**, không phải quyết định kiến trúc); thêm tên field vào mảng `fieldNames`; validate qua `validateDecimalField(...)` **và** yêu cầu `> 0` (nhân bản pattern `isPositiveDecimalString`/kiểm min_rr). `cost_hurdle_x` **đã tồn tại** — KHÔNG thêm lại
  - [x] Cập nhật `packages/config/src/schema.test.ts` + `snapshot.test.ts` (+ `store.test.ts` nếu assert cứng shape `DEFAULT_PARAMS`): thêm field mới vào các fixture/expect để không đỏ; thêm case validate: thiếu field → `missing_config_param`; giá trị `≤ 0`/rác → mã lỗi tương ứng
  - [x] KHÔNG đổi `cost_hurdle_x` hiện có; KHÔNG đụng `version.ts`/`store.ts` logic — chỉ mở rộng schema + default + test. Đây là **thay đổi chạm artifact của Story 1.2** → giữ tối giản, thuần additive, mọi test config cũ vẫn xanh [Source: 1-2 config schema; packages/config/src/schema.ts]

- [x] **Task 2 — Kiểu miền + mở rộng TierContext cho edge & phí (backward-compatible) (AC: #1, #2, #3)**
  - [x] `packages/decision-core/types/index.ts`: thêm (không phá kiểu cũ):
    - `CostEstimate` — **[PLACEHOLDER — mô hình phí/adapter sinh ở Story 1.8]**: `{ roundTripFee: string }` (decimal-string, đơn vị quote). Nay do driver/backtest/test cấp
    - (không cần kiểu riêng cho edge — dùng `string` decimal cho `expectedEdge`, ghi chú producer)
  - [x] `packages/decision-core/pipeline/runner.ts`: **mở rộng `TierContext`** thêm **hai trường optional** (giữ mọi test 1.3/1.4 xanh):
    - `readonly expectedEdge?: string;` — **[PLACEHOLDER — output Tầng 1 regime/edge, FR-2; epic 1 stub → driver/test bơm]**
    - `readonly cost?: CostEstimate;` — **[PLACEHOLDER — mô hình phí, Story 1.8; epic 1 driver/test bơm]**
    - Vì optional nên tier0/1/2 stub + tier3 sizing-only (khi vắng) không đổi; `runPipeline` không đổi logic; `PipelineBaseContext` tự cập nhật qua `Omit`
  - [x] Comment rõ: `expectedEdge` do **Tầng 1** sinh, `cost.roundTripFee` do **mô hình phí (1.8)** sinh; hai producer khác nhau ⇒ hai trường tách biệt (song song cách `candidate`/`account` tách ở 1.4). **KHÔNG** nhồi edge vào `TierOutcome` (seam chuyển payload giữa các tầng vẫn deferred — xem Ngoài phạm vi)

- [x] **Task 3 — Cổng cost-hurdle thuần (trái tim FR-11) (AC: #1, #2, #3, #5)**
  - [x] `packages/decision-core/tiers/tier3/cost-hurdle.ts`: **NEW** — hàm thuần
    `evaluateCostHurdle(input: CostHurdleInput): CostHurdleOutcome` với:
    - `CostHurdleInput = { expectedEdge: string; roundTripFee: string; costHurdleX: string }`
    - `CostHurdlePass = { ok: true; expectedEdge: string; roundTripFee: string; hurdle: string }` (tất cả decimal-string)
    - `CostHurdleRejection = { ok: false; error: CoreError }` (shape `{ code, source: "tier3.cost_hurdle", context }`)
    - `CostHurdleOutcome = CostHurdlePass | CostHurdleRejection`
  - [x] Thứ tự tính & kiểm (dùng `math/decimal.ts` cho MỌI phép — cùng wrapper 1.4):
    1. Parse decimal-string cho `expectedEdge`, `roundTripFee`, `costHurdleX` → rác ⇒ reject `invalid_decimal_string`
    2. `roundTripFee < 0` ⇒ reject `invalid_round_trip_fee`; `costHurdleX ≤ 0` ⇒ reject `invalid_cost_hurdle_x` (thủ phòng; config đã đảm bảo `> 0` nhưng vẫn kiểm)
    3. `hurdle = costHurdleX × roundTripFee` (mul decimal)
    4. `cmp(expectedEdge, hurdle) >= 0` ⇒ **pass** (kể cả `==` — biên pass); ngược lại ⇒ reject `cost_hurdle_not_met` với context `{ expectedEdge, hurdle, roundTripFee, costHurdleX }` (tất cả decimal-string)
  - [x] Hàm **thuần**: không mutate `input`, không IO/`Date`/random; chỉ decimal-string vào/ra; KHÔNG dùng `number` cho tiền
  - [x] **KHÔNG** tự tính `roundTripFee` từ notional/fee-rate/spread/slippage/funding ở đây — phí là **input ước lượng** (mô hình phí là 1.8/adapter). Xem Ngoài phạm vi

- [x] **Task 4 — Hàm đánh giá overtrade thuần (AC: #4, #5)**
  - [x] `packages/decision-core/tiers/tier3/overtrade.ts`: **NEW** — hàm thuần
    `evaluateOvertrade(input: OvertradeInput): OvertradeOutcome` với:
    - `OvertradeInput = { cumulativeFees: string; cumulativeGrossProfit: string; limit: string }`
    - `OvertradeAssessment = { ok: true; ratio: string | null; flagged: boolean }`
    - `OvertradeRejection = { ok: false; error: CoreError }` (`source: "tier3.overtrade"`)
    - `OvertradeOutcome = OvertradeAssessment | OvertradeRejection`
  - [x] Logic (decimal):
    1. Parse `cumulativeFees`, `cumulativeGrossProfit`, `limit` → rác ⇒ reject `invalid_decimal_string`; `cumulativeFees < 0` ⇒ reject `invalid_cumulative_fees`; `limit ≤ 0` ⇒ reject `invalid_overtrade_limit`
    2. `cumulativeGrossProfit ≤ 0`: nếu `cumulativeFees > 0` ⇒ `{ ratio: null, flagged: true }`; nếu `cumulativeFees == 0` ⇒ `{ ratio: null, flagged: false }` (không chia 0)
    3. ngược lại `ratio = cumulativeFees / cumulativeGrossProfit`; `flagged = cmp(ratio, limit) > 0` (**vượt** = strictly greater; `==` ⇒ không flag)
  - [x] Hàm **thuần** — KHÔNG tích luỹ state, KHÔNG IO. **Chỉ tính**; producer của `cumulativeFees`/`cumulativeGrossProfit` (feedback loop + persistence, AD-6/AD-7) và surface cờ đỏ (UI/audit) là **ngoài phạm vi** story này

- [x] **Task 5 — Nối cổng cost-hurdle vào Tầng 3 SAU sizing (AC: #1, #2)**
  - [x] `packages/decision-core/tiers/tier3/index.ts`: trong `createTier3().run(ctx)`, **sau khi** `sizeTrade(...)` trả `ok: true` (sizing pass), thêm bước cost-hurdle:
    - nếu `ctx.expectedEdge === undefined || ctx.cost === undefined` ⇒ giữ **pass** (biên epic 1 — không có edge/phí để gate)
    - nếu có cả hai ⇒ gọi `evaluateCostHurdle({ expectedEdge: ctx.expectedEdge, roundTripFee: ctx.cost.roundTripFee, costHurdleX: ctx.config.params.cost_hurdle_x })`
    - `CostHurdleRejection` ⇒ `{ kind: "veto", tier: "tier3", reason }` (huỷ với lý do — AC2); mở rộng `formatReason` (hoặc thêm helper) để render `cost_hurdle_not_met` từ context (`expectedEdge`/`hurdle`)
    - `CostHurdlePass` ⇒ `{ kind: "pass" }`
  - [x] **Thứ tự bắt buộc:** sizing **trước**, cost-hurdle **sau**; nếu sizing veto thì **return ngay**, không chạy cost-hurdle (đúng AD-5 gating + AC1)
  - [x] Cập nhật barrel `tiers/tier3/index.ts` `export type` cho kiểu cost-hurdle + overtrade công khai; `decision-core/index.ts` đã `export *` từ tier3 → tự lan (kiểm không xung đột tên). **KHÔNG** wiring `evaluateOvertrade` vào `run()` (không có nguồn luỹ kế trong pipeline epic 1) — chỉ export để 1.6/feedback dùng sau
  - [x] Giữ `createTier3Stub`/`tier3Stub`/`createTier3` export tên ổn định; kiểm `apps/*` chỉ dùng type `PipelineResult` (đã xác nhận — không import tier3), an toàn

- [x] **Task 6 — Tests phủ từng AC (AC: #1..#6)**
  - [x] `packages/decision-core/tiers/tier3/cost-hurdle.test.ts`: **NEW**
    - **Công thức/pass**: ví dụ `expectedEdge="30"`, `roundTripFee="10"`, `costHurdleX="2"` → `hurdle="20"`, `edge≥hurdle` ⇒ pass, `hurdle` đúng
    - **Biên pass**: dựng `edge == hurdle` (vd edge `"20"`, X `"2"`, fee `"10"`) ⇒ **pass** (dễ sai thành `>`)
    - **Veto**: `edge < hurdle` (vd edge `"15"`) ⇒ reject `cost_hurdle_not_met`, context có `expectedEdge`/`hurdle`/`roundTripFee`/`costHurdleX`
    - **AC3**: `roundTripFee="-1"`, `costHurdleX="0"`, decimal rác → reject đúng `code`, `source="tier3.cost_hurdle"`
    - **Tất định + không mutate + không number**: 2 lần `toEqual`; `structuredClone` so sánh input; `typeof field === "string"`
  - [x] `packages/decision-core/tiers/tier3/overtrade.test.ts`: **NEW**
    - ratio đúng (vd fees `"30"`, gross `"100"` → ratio `"0.3"`, limit `"0.3"` ⇒ **không** flag; limit `"0.2"` ⇒ flag)
    - biên `ratio == limit` ⇒ không flag; `grossProfit="0"` + fees `"5"` ⇒ `flagged:true, ratio:null`; `grossProfit="0"` + fees `"0"` ⇒ `flagged:false`
    - AC3-style input phi lý (fees âm, limit `"0"`, rác) → reject `source="tier3.overtrade"`
    - tất định + không mutate
  - [x] `packages/decision-core/tiers/tier3/index.test.ts`: **UPDATE** — thêm:
    - Tầng 3 **veto** khi edge<hurdle (bơm `expectedEdge`/`cost` vào ctx)
    - Tầng 3 **pass** khi edge≥hurdle
    - Tầng 3 **pass** khi thiếu `expectedEdge` hoặc `cost` (biên epic 1)
    - **short-circuit**: khi sizing veto (rr thấp) thì Tầng 3 veto **vì sizing**, không bao giờ chạm cost-hurdle (vd bơm edge thấp + rr thấp → reason là của sizing)
  - [x] `pnpm -r test` pass; xác nhận `dist/` không chứa `*.test.*` (đặc biệt tier3 mới + config)

## Dev Notes

> **Bối cảnh:** Story 1.5 hoàn tất Tầng 3 bằng **cổng chi phí** — cơ chế FR-11 chống overtrade edge-mỏng. Nó xây **trực tiếp trên 1.4**: cùng `math/decimal.ts` (precision/rounding một chỗ), cùng shape lỗi `{ code, source, context }`, cùng pattern "trường context optional → backward-compat", cùng đặt logic thuần ở file riêng cạnh `index.ts` mỏng. Đây là **cổng thứ hai bên trong Tầng 3** (AD-5) — **không** phải tầng thứ 5. Trong epic 1, Tầng 1 (sinh edge) và mô hình phí (1.8) đều chưa có ⇒ `expectedEdge` & `roundTripFee` do **driver/backtest/test** bơm, y hệt candidate/account ở 1.4.

### 🔑 "edge" và "phí" đến từ đâu — đừng để dev đoán (giải toả mơ hồ)

AC gốc: *"Given một edge kỳ vọng và phí round-trip ước lượng"* — **cả hai là input (given), không phải thứ Tầng 3 tự tính.**

- **`expectedEdge` (edge kỳ vọng)** — là output của **Tầng 1 (regime/edge, FR-2)** trong hệ đầy đủ. Trong epic 1 Tầng 1 là **stub** ⇒ edge do driver/test bơm qua `ctx.expectedEdge`. **KHÔNG** tự suy edge từ sizing (vd `riskAmount × rr`) và hardcode nó vào cổng — đó là một định nghĩa gây tranh cãi thuộc về Tầng 1, không phải Tầng 3. Tầng 3 chỉ **tiêu thụ** một con số edge decimal-string, đơn vị **quote**. [Source: ARCHITECTURE-SPINE.md#Capability Map → FR-2 Tầng 1 regime/edge; epics.md → Story 1.5 AC]
- **`roundTripFee` (phí round-trip ước lượng)** — là output của **mô hình chi phí** (fee schedule + spread + slippage + funding) mà **Story 1.8 backtest** dựng và adapter sàn (1.7+) cấp dữ liệu filter. Trong epic 1 chưa có ⇒ phí do driver/test bơm qua `ctx.cost.roundTripFee`, đơn vị **quote**. Cổng cost-hurdle **không** tự tính phí. [Source: epics.md → Story 1.8 "cộng phí + spread + slippage + funding"; ARCHITECTURE-SPINE.md#AD-11, #AD-12]
- **Đơn vị:** `expectedEdge` và `roundTripFee` **phải cùng đơn vị quote** để so sánh `edge ≥ X × fee` có nghĩa. Ghi convention này rõ trong doc/comment. [Source: ARCHITECTURE-SPINE.md#Consistency Conventions → Tiền tệ]

⇒ Vì hai producer khác nhau (Tầng 1 vs mô hình phí), mở rộng `TierContext` bằng **hai trường optional tách biệt** `expectedEdge?` + `cost?` — đúng chỗ, không phá 1.3/1.4, phản ánh trung thực rằng producer ra đời sau. [Source: 1-4 Dev Notes → "Nguồn dữ liệu vào Tầng 3"; packages/decision-core/pipeline/runner.ts]

### Hợp đồng đã có (PHẢI tuân, đọc trước khi sửa) — trạng thái hiện tại của các file UPDATE

| File | Trạng thái hôm nay | Story 1.5 đổi gì | Phải giữ nguyên |
| --- | --- | --- | --- |
| `pipeline/runner.ts` | `TierContext = { input, state, config, candidate?, account?, nowEpochMillis }`; `TierOutcome = pass \| veto{tier,reason}`; `runPipeline` lặp tier, veto→silent | **+2 trường optional** `expectedEdge?`, `cost?` | `runPipeline` logic; `TierOutcome`; `candidate?`/`account?`; `Omit` cho `PipelineBaseContext` |
| `tiers/tier3/index.ts` | `createTier3()` gọi `sizeTrade`, pass khi thiếu candidate/account; veto khi sizing reject; có `formatReason`; giữ alias `createTier3Stub`/`tier3Stub`/`tier3` | thêm bước cost-hurdle **sau** sizing-pass; mở rộng `formatReason` cho `cost_hurdle_not_met`; export kiểu mới | chữ ký `Tier`; tên export cũ; nhánh "thiếu candidate/account → pass" |
| `tiers/tier3/sizing.ts` | `sizeTrade` thuần → `SizingResult\|SizingRejection` | **không sửa** (chỉ đọc kết quả pass để chạy tiếp) | toàn bộ |
| `types/index.ts` | có `TradeCandidate`, `AccountState`, `CoreError`, `Result` | **+`CostEstimate`** (placeholder) | kiểu cũ |
| `math/decimal.ts` | wrapper thuần: `toDecimal/add/sub/mul/div/abs/cmp/isPositive/toDecimalString`, `CoreDecimal=string`, precision 40 / ROUND_HALF_UP một chỗ | **không sửa** — tái dùng | precision/rounding một chỗ (determinism) |
| `packages/config/src/schema.ts` | `ConfigParams` có `cost_hurdle_x` (default `"1"`), `min_rr`, `risk_pct`...; `validateParams` + `DEFAULT_PARAMS` | **+`overtrade_cost_ratio_limit`** (additive) | `cost_hurdle_x` và mọi field cũ; pattern validate |

[Source: packages/decision-core/pipeline/runner.ts; packages/decision-core/tiers/tier3/index.ts; packages/decision-core/tiers/tier3/sizing.ts; packages/decision-core/math/decimal.ts; packages/decision-core/types/index.ts; packages/config/src/schema.ts]

### Đặc tả số học cost-hurdle (một nguồn sự thật)

```text
hurdle = cost_hurdle_x × roundTripFee        # mul decimal
pass  nếu expectedEdge ≥ hurdle              # cmp decimal; == ⇒ PASS (biên)
veto  nếu expectedEdge < hurdle  → code "cost_hurdle_not_met"
kiểm trước: roundTripFee ≥ 0 ; cost_hurdle_x > 0 ; mọi input parse được decimal
```

```text
# Overtrade (hàm thuần, KHÔNG wiring vào pipeline epic 1)
ratio   = cumulativeFees / cumulativeGrossProfit   # khi grossProfit > 0
flagged = ratio > overtrade_cost_ratio_limit       # strictly > ; == ⇒ KHÔNG flag
grossProfit ≤ 0: fees>0 ⇒ {ratio:null, flagged:true} ; fees==0 ⇒ {ratio:null, flagged:false}
kiểm trước: cumulativeFees ≥ 0 ; limit > 0 ; parse được decimal
```

Mọi so sánh `≥`/`>` là **decimal compare** (`cmp(...)`), không `Number(...)`. Mọi chia qua wrapper precision cố định (không `Infinity`/`NaN` — chặn chia-0 bằng nhánh `grossProfit ≤ 0`). [Source: packages/decision-core/math/decimal.ts; ARCHITECTURE-SPINE.md#Consistency Conventions → Tiền tệ, Determinism]

### Invariant kiến trúc PHẢI tuân

- **AD-5 — cost-hurdle là cổng TRONG Tầng 3:** chạy **sau** sizing, cùng tầng; **không** tạo tầng thứ 5. Tầng nào chặn → dừng ngay, im lặng. [Source: ARCHITECTURE-SPINE.md#AD-5]
- **AD-4 — config snapshot:** `cost_hurdle_x` **và** `overtrade_cost_ratio_limit` đọc từ snapshot đã version; ngưỡng phải nhúng được vào Đề xuất/BacktestRun để tái lập. Danh sách tham số của AD-4 **đã liệt kê `cost_hurdle_x`** — thêm `overtrade_cost_ratio_limit` cùng họ. [Source: #AD-4]
- **AD-2 — thuần & tất định:** cả hai hàm thuần; không `Date`/`Math.random`/IO; lint `decision-core` chặn; cùng input → cùng output (NFR-6). [Source: #AD-2]
- **AD-6/AD-7 — chủ sở hữu state & feedback:** `cumulativeFees`/`cumulativeGrossProfit` là **behavioral/aggregate state** do decision-engine sở hữu, chỉ đổi qua event `trade-outcome` (feedback). Story 1.5 **chỉ** cấp hàm **tính** thuần; **không** tự tích luỹ, không persistence. [Source: #AD-6, #AD-7]
- **Lỗi:** shape `{ code, source, context }`, `source` = `"tier3.cost_hurdle"` / `"tier3.overtrade"`. [Source: #Consistency Conventions → Lỗi & log]

### Ngoài phạm vi story này (đừng làm — để story sau)

- **Mô hình chi phí thật** (fee schedule Binance, spread, slippage, funding cost khi giữ lệnh) — **Story 1.8** (backtest chi phí thật) + adapter sàn (1.7+). Story 1.5 nhận `roundTripFee` **ước lượng** làm input, không tự tính.
- **Producer của `expectedEdge`** (Tầng 1 regime/edge, FR-2) — story riêng. Nay driver/test bơm.
- **Tích luỹ `cumulativeFees`/`cumulativeGrossProfit` vào state bền + surface cờ đỏ overtrade lên UI/audit** — cần behavioral-state (**Story 1.6**) + feedback loop (AD-7) + persistence + append-only audit (AD-8). Story 1.5 chỉ cấp **hàm thuần tính ratio/flag**; wiring accumulation là story sau. **Đừng** dựng persistence/UI ở đây.
- **Chuyển payload edge/phí giữa các tầng qua `TierOutcome`** — `TierOutcome` vẫn chỉ pass/veto; mang dữ liệu từ Tầng 1 sang Tầng 3 qua outcome là seam deferred (giống 1.4 hoãn mang `SizingResult` vào `Suggestion`). Nay dùng context injection. **Đừng** mở rộng `TierOutcome`.
- **Mang kết quả cost-hurdle vào `Suggestion`** — `Suggestion` còn stub (`{kind:"stub"}`). Deferred cùng story làm giàu Đề xuất.
- **Số học Tầng 0/1/2** — story riêng.

### Source tree mục tiêu (phần thêm/đổi)

```text
packages/config/src/
  schema.ts                          # UPDATE: + overtrade_cost_ratio_limit (ConfigParams, DEFAULT_PARAMS, validate)
  schema.test.ts                     # UPDATE: cover param mới
  snapshot.test.ts                   # UPDATE: shape mới (nếu assert cứng)
packages/decision-core/
  types/index.ts                     # UPDATE: + CostEstimate (placeholder)
  pipeline/runner.ts                 # UPDATE: TierContext + expectedEdge?/cost? (optional, backward-compat)
  tiers/tier3/
    cost-hurdle.ts                   # NEW: evaluateCostHurdle() + CostHurdleInput/Pass/Rejection/Outcome
    cost-hurdle.test.ts              # NEW
    overtrade.ts                     # NEW: evaluateOvertrade() + Input/Assessment/Rejection/Outcome
    overtrade.test.ts                # NEW
    index.ts                         # UPDATE: nối cost-hurdle SAU sizing; export kiểu mới; mở rộng formatReason
    index.test.ts                    # UPDATE: veto/pass cost-hurdle + short-circuit sizing + thiếu edge/fee
  index.ts                           # (không đổi — đã export * từ tiers/tier3)
```
[Source: ARCHITECTURE-SPINE.md#Structural Seed; bố cục 1.4 làm khuôn]

### Project Structure Notes

- Tách `cost-hurdle.ts` và `overtrade.ts` khỏi `index.ts` (song song `sizing.ts`): hàm thuần dễ test đơn vị (nơi giá trị FR-11 nằm); `index.ts` chỉ là lớp nối pipeline mỏng nối **sizing → cost-hurdle** theo thứ tự.
- Tái dùng `math/decimal.ts` của 1.4 — **không** cấu hình precision mới (một nguồn sự thật cho tái lập; đây là bất biến determinism đã chốt ở 1.4).
- Config: thêm param là **thay đổi additive** chạm package `@brighten/config` (artifact 1.2). Rủi ro chính: các test config assert cứng shape `DEFAULT_PARAMS`/params → phải cập nhật fixture. Đã liệt kê ở Task 1. Không đổi `version.ts`/`store.ts`.
- Xung đột đã biết: `apps/*` chỉ import **type** `PipelineResult` (đã grep xác nhận: `apps/backtest-cli/src/main.ts`, `apps/cron-runner/functions/health/index.ts`), **không** import tier3/`createTier3` ⇒ wiring tier3 an toàn, không vỡ app.

### Chuẩn test

- Vitest; mỗi AC ≥ 1 test. Ưu tiên **số cụ thể tính tay** để bắt sai công thức/precision (vd `hurdle = 2 × 10 = 20`).
- Test **biên**: `edge == hurdle` phải **pass** (dễ sai thành `>`); `ratio == limit` phải **không flag** (dễ sai thành `≥`); `grossProfit == 0` (không được chia 0).
- Test **tất định**: không clock/random; gọi 2 lần `toEqual`.
- Test **không mutate** input bằng `structuredClone`; **không leak number**: `typeof field === "string"` cho field tiền/tỷ lệ (ratio là `string | null`).
- Test **thứ tự Tầng 3**: sizing veto ⇒ reason của sizing (không phải cost-hurdle) kể cả khi edge/phí cũng "xấu" — chứng minh short-circuit.
- Không integration/DB (không adapter/persistence ở story này).

### References

- [Source: epics.md → Epic 1, Story 1.5] — AC gốc (BDD): edge ≥ `cost_hurdle_X` × phí round-trip (X từ config); dưới ngưỡng → chặn + log; theo dõi tỷ lệ phí/lãi-gộp + cờ đỏ overtrade
- [Source: ARCHITECTURE-SPINE.md#AD-5] — cost-hurdle là **cổng trong Tầng 3**, chạy sau sizing; gating dừng-ngay-khi-veto
- [Source: ARCHITECTURE-SPINE.md#AD-4] — `cost_hurdle_x` (và ngưỡng overtrade) là config có phiên bản, snapshot cùng mỗi quyết định
- [Source: ARCHITECTURE-SPINE.md#AD-2] — lõi thuần tất định (lint chặn IO/Date/random); NFR-6
- [Source: ARCHITECTURE-SPINE.md#AD-6, #AD-7] — `cumulativeFees`/`cumulativeGrossProfit` là aggregate state của decision-engine qua feedback `trade-outcome` → lý do accumulation deferred tới 1.6/feedback
- [Source: ARCHITECTURE-SPINE.md#Capability Map] — FR-11 Cost hurdle lives in `decision-core/tiers/tier3` (cổng); FR-2 Tầng 1 sinh edge
- [Source: ARCHITECTURE-SPINE.md#Consistency Conventions] — Tiền tệ (decimal/string, không JS `number`), Lỗi `{code,source,context}`, Determinism
- [Source: packages/config/src/schema.ts] — `ConfigParams.cost_hurdle_x` (đã có), pattern `validateDecimalField`/`DEFAULT_PARAMS` để mở rộng
- [Source: packages/decision-core/pipeline/runner.ts] — hợp đồng `Tier`/`TierOutcome`/`TierContext` + điểm mở rộng optional
- [Source: packages/decision-core/tiers/tier3/index.ts; sizing.ts] — tier3 hiện tại (sizing pass/veto, `formatReason`, alias export) mà 1.5 nối tiếp
- [Source: packages/decision-core/math/decimal.ts] — wrapper decimal precision-một-chỗ để tái dùng
- [Source: 1-4-tier3-deterministic-risk-sizing.md] — khuôn: file thuần tách khỏi index, context optional backward-compat, shape lỗi, chuẩn test biên/determinism/non-mutation

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- `pnpm --filter @brighten/config test -- --run src/schema.test.ts` failed before schema update, then passed after adding `overtrade_cost_ratio_limit`.
- `pnpm --filter @brighten/decision-core test -- --run tiers/tier3/cost-hurdle.test.ts tiers/tier3/overtrade.test.ts` failed before new modules existed, then passed after implementation.
- `pnpm --filter @brighten/decision-core test -- --run tiers/tier3/index.test.ts` failed before Tier 3 wiring, then passed after adding cost-hurdle after sizing.
- Final validation passed: `pnpm -r typecheck`, `pnpm -r build`, `pnpm -r lint`, `pnpm -r test`.
- Verified `dist/` has no `*.test.*` files with `rg --files -g 'dist/**' | rg '\.test\.'`.

### Completion Notes List

- Task 1: Added `overtrade_cost_ratio_limit` to config params/default validation with missing and invalid value coverage. Verified with `pnpm --filter @brighten/config test -- --run src/schema.test.ts`.
- Task 2: Added `CostEstimate` and optional `expectedEdge`/`cost` fields to `TierContext` without changing pipeline outcome flow.
- Task 3: Added pure `evaluateCostHurdle` with decimal parse/compare, pass-at-boundary behavior, structured rejection context, determinism, and non-mutation coverage.
- Task 4: Added pure `evaluateOvertrade` with ratio/flag evaluation, zero/non-positive gross-profit handling, structured rejection context, determinism, and non-mutation coverage.
- Task 5: Wired cost-hurdle into Tier 3 after sizing pass, preserving missing edge/fee pass behavior and sizing-veto short-circuit.
- Task 6: Added AC coverage for cost-hurdle, overtrade, Tier 3 wiring, config validation, deterministic output, non-mutation, decimal-string outputs, and full toolchain validation.

### File List

- packages/config/src/schema.ts
- packages/config/src/schema.test.ts
- packages/decision-core/types/index.ts
- packages/decision-core/pipeline/runner.ts
- packages/decision-core/tiers/tier3/cost-hurdle.ts
- packages/decision-core/tiers/tier3/cost-hurdle.test.ts
- packages/decision-core/tiers/tier3/overtrade.ts
- packages/decision-core/tiers/tier3/overtrade.test.ts
- packages/decision-core/tiers/tier3/index.ts
- packages/decision-core/tiers/tier3/index.test.ts
- packages/decision-core/pipeline/runner.test.ts

### Change Log

- 2026-07-04: Implemented Story 1.5 cost-hurdle and overtrade pure logic, Tier 3 wiring, config threshold, and AC test coverage. Status set to review.
