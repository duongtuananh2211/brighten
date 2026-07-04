---
baseline_commit: bd489f4a1902a89f12d6c1f45fd33ead36a87e91
---

# Story 1.6: Tầng 0 — Phủ quyết hành vi (FR-1)

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **người dùng (solo trader) dễ overtrade sau khi thắng/thua của Brighten**,
I want **Tầng 0 — tầng phủ quyết tối cao chạy ĐẦU pipeline — chặn mọi Đề xuất mới một cách tất định khi một luật kỷ luật hành vi kích hoạt (đang trong cooldown sau lỗ, đã chạm `max_trades_per_day`, lỗ luỹ kế ngày chạm `daily_loss_limit`, hoặc đang trong cửa sổ `news_blackout` áp cho cặp đang xét), CỘNG một cơ chế giảm size (`size_dampening`) khi chuỗi thắng đạt `win_streak_threshold`**,
so that **tôi không trả lại lợi nhuận vì give-back/revenge trade, và mọi lần chặn tái lập được 100% + ghi được vào Nhật ký (FR-1, NFR-6, AD-5, AD-2)**.

## Acceptance Criteria

**AC1 — Tầng 0 là cổng ĐẦU pipeline, veto tối cao (AD-5)**
**Given** một `TierContext` đầy đủ (`input`, `state: BehavioralState`, `config: ConfigSnapshot`, `nowEpochMillis`)
**When** pipeline chạy Tầng 0 (thứ tự cố định Tầng 0→1→2→3, `runPipeline` đã có)
**Then** nếu Tầng 0 **veto** thì `runPipeline` dừng ngay, trả `outcome: "silent"` với `vetoedBy: "tier0"` + `reason` — **không** chạy Tầng 1/2/3 (đã đảm bảo bởi `runPipeline`, story chỉ cấp `createTier0()` thật trả veto/pass)
**And** `createTier0()` là **hàm thuần** đọc `state`/`config`/`nowEpochMillis`/`input` từ ctx — KHÔNG `Date.now()`/`Math.random()`/IO (pass lint `decision-core`, AD-2)
**And** khi KHÔNG luật nào kích hoạt ⇒ Tầng 0 **pass** (`{ kind: "pass" }`)

**AC2 — Cooldown sau lỗ (`cooldown_after_loss`)**
**Given** `state.lastLossEpochMillis` (mốc lệnh lỗ vừa đóng) và `config.params.cooldown_after_loss` (ms, integer ≥ 0)
**When** `state.lastLossEpochMillis !== undefined` **và** `nowEpochMillis < state.lastLossEpochMillis + cooldown_after_loss`
**Then** Tầng 0 **veto** với `code: "cooldown_active"`, context nêu `lastLossEpochMillis`, `cooldownUntilEpochMillis` (= `lastLossEpochMillis + cooldown_after_loss`), `nowEpochMillis`
**And** biên: `nowEpochMillis == lastLossEpochMillis + cooldown_after_loss` ⇒ cooldown **hết** ⇒ **không** veto vì lý do này (dùng `<`, không `<=`)
**And** `state.lastLossEpochMillis === undefined` ⇒ luật cooldown **bỏ qua**

**AC3 — Trần lệnh/ngày (`max_trades_per_day`)**
**Given** `state.tradeCountToday` (số lệnh đã vào trong trading-day, do state-owner cấp) và `config.params.max_trades_per_day` (integer ≥ 1)
**When** `state.tradeCountToday >= max_trades_per_day`
**Then** Tầng 0 **veto** với `code: "max_trades_reached"`, context nêu `tradeCountToday`, `maxTradesPerDay`
**And** biên: `tradeCountToday == max_trades_per_day - 1` (còn 1 lệnh) ⇒ **không** veto; `== max_trades_per_day` ⇒ **veto** (dùng `>=`)

**AC4 — Khoá theo lỗ ngày (`daily_loss_limit`)**
**Given** `state.dailyLoss` (độ lớn lỗ luỹ kế ngày, **decimal-string**, đơn vị quote, `"0"` khi chưa lỗ) và `config.params.daily_loss_limit` (decimal-string > 0)
**When** so sánh **decimal** `cmp(dailyLoss, daily_loss_limit) >= 0` (chạm hoặc vượt)
**Then** Tầng 0 **veto** với `code: "daily_loss_limit_reached"`, context nêu `dailyLoss`, `dailyLossLimit` (decimal-string)
**And** biên: `dailyLoss == daily_loss_limit` ⇒ **veto** ("chạm" = khoá); `dailyLoss < daily_loss_limit` ⇒ không veto vì lý do này
**And** mọi so sánh qua `math/decimal.ts` (`cmp`), KHÔNG `Number(...)`, KHÔNG để `number` tiền lọt qua

**AC5 — Cửa sổ tin (`news_blackout`) áp theo cặp**
**Given** `config.params.news_blackout: NewsBlackoutWindow[]` (mỗi window `{ startsAt, endsAt, reason?, pairs? }`, epoch-ms) và `input.pair`
**When** tồn tại một window với `nowEpochMillis >= startsAt && nowEpochMillis < endsAt` **và** window áp cho `input.pair` (áp khi `window.pairs === undefined` ⇒ **mọi cặp**, hoặc `window.pairs` chứa `input.pair`)
**Then** Tầng 0 **veto** với `code: "news_blackout_active"`, context nêu `pair`, `windowStartsAt`, `windowEndsAt`, `reason` (nếu có)
**And** biên nửa mở: `now == startsAt` ⇒ trong cửa sổ (veto); `now == endsAt` ⇒ **ngoài** (không veto) — nhất quán `[startsAt, endsAt)`
**And** window có `pairs` **không** chứa `input.pair` ⇒ **không** áp cho cặp này (cặp crypto không bị chặn bởi tin FX được scope) — giải toả AC gốc "chặn cặp FX **liên quan**"

**AC6 — Giảm size khi chuỗi thắng (`win_streak_threshold` × `size_dampening`)**
**Given** `state.winStreak`, `config.params.win_streak_threshold` (integer ≥ 1), `config.params.size_dampening` (decimal-string > 0), `config.params.risk_pct` (decimal-string)
**When** `state.winStreak >= win_streak_threshold`
**Then** **rủi ro hiệu dụng** dùng cho sizing = `risk_pct × size_dampening` (mul **decimal**); `winStreak < threshold` ⇒ dùng nguyên `risk_pct`
**And** giảm size này **KHÔNG** phải veto (là điều chỉnh sizing) — được áp bên trong Tầng 3 sizing bằng cách đọc `ctx.state`/`ctx.config` (state+config đều có trong ctx; KHÔNG mở rộng `TierOutcome`, KHÔNG đổi chữ ký `sizeTrade`)
**And** hàm đánh giá dampening **thuần**, decimal-string vào/ra; xuất công khai để Tầng 3 tiêu thụ
**And** phần "nâng ngưỡng vào" (AC gốc "và/hoặc") thuộc Tầng 1/2 (còn stub epic 1) ⇒ **ngoài phạm vi**; nhánh `size × size_dampening` thoả AC ("và/hoặc")

**AC7 — Từ chối input phi lý với lỗi shape thống nhất**
**Given** input tiền phi lý: `state.dailyLoss` / `config.params.daily_loss_limit` không parse được decimal-string; `daily_loss_limit ≤ 0`
**When** Tầng 0 chạy nhánh liên quan
**Then** trả **rejection tường minh** shape `{ code, source: "tier0.behavioral", context }` (KHÔNG pass rác, KHÔNG throw string trần), map thành veto có `reason` ghi được — song song cách 1.5 xử lý input phi lý
**And** không phép nào để `NaN`/`Infinity`/`number` tiền lọt qua (chặn bằng kiểm decimal, không `Number.isFinite`)

**AC8 — Tất định 100% + config có phiên bản (NFR-6, AD-4, AD-2)**
**Given** cùng `(input, state, config, nowEpochMillis)`
**When** gọi Tầng 0 **nhiều lần**
**Then** output **bằng nhau tuyệt đối** (deep-equal) — không ngẫu nhiên, không AI, không phụ thuộc thứ tự
**And** mọi ngưỡng đọc từ `config.params` của **snapshot đã version** (AD-4), không "config sống"; hàm **thuần** (không mutate `input`/`state`/`config`, không `Date`/`Math.random`/IO — pass lint `decision-core`)
**And** khi **nhiều** luật cùng kích hoạt, thứ tự kiểm **cố định**: `cooldown_active` → `daily_loss_limit_reached` → `max_trades_reached` → `news_blackout_active` (reason surface đầu tiên khớp; tất định)

**AC9 — Test phủ từng AC + toolchain sạch**
**Given** Vitest (nền từ 1.2/1.3/1.4/1.5)
**When** thêm test cho behavioral-veto + win-streak dampening + wiring Tầng 0 + wiring dampening vào Tầng 3
**Then** có test cho: pass khi không luật nào kích hoạt; **mỗi** luật veto (cooldown/max-trades/daily-loss/news) với **biên** (`<` cooldown-end, `>=` max-trades, `==` daily-loss-limit chạm→veto, `[startsAt,endsAt)` news); news_blackout **scope cặp** (window `pairs` không chứa pair ⇒ pass; chứa/undefined ⇒ veto); thứ tự cố định khi nhiều luật cùng bật; win-streak dampening đúng số (`risk_pct × size_dampening`) + biên `winStreak == threshold` (bật) và `== threshold-1` (không bật); Tầng 3 áp risk giảm khi winStreak≥threshold (volume nhỏ hơn baseline đúng tỷ lệ) và **không đổi** khi winStreak<threshold; input phi lý (daily-loss rác, limit ≤ 0) → rejection đúng `code`/`source`; tất định (2 lần `toEqual`); không mutate (`structuredClone`); không leak `number` (`typeof === "string"` cho field tiền)
**And** `pnpm -r typecheck && pnpm -r build && pnpm -r lint && pnpm -r test` **tất cả pass**; `*.test.ts` không lọt `dist/`

## Tasks / Subtasks

- [x] **Task 1 — Làm giàu `BehavioralState` + mở rộng `NewsBlackoutWindow.pairs?` (backward-compatible) (AC: #2, #5, #7)**
  - [x] `packages/decision-core/types/index.ts`: đổi `BehavioralState` (xoá placeholder note "enriched in 1.6"):
    - **thay** `cooldownUntilEpochMillis?: number | undefined` **bằng** `readonly lastLossEpochMillis?: number` — Tầng 0 tự dẫn `cooldownUntil = lastLoss + cooldown_after_loss` từ config (rule config-driven, versioned — không double-store giá trị đã dẫn). Giữ `winStreak: number`, `dailyLoss: string`, `tradeCountToday: number`
    - Comment rõ: `BehavioralState` do **decision-engine** sở hữu, chỉ đổi qua event `market-tick`/`trade-outcome` (AD-6/AD-7); Tầng 0 **chỉ đọc** [Source: ARCHITECTURE-SPINE.md#AD-6, #AD-7]
  - [x] `packages/config/src/schema.ts`: thêm field **optional** `pairs?: readonly string[]` vào `NewsBlackoutWindow` (additive — window cũ không có `pairs` vẫn hợp lệ = áp mọi cặp). Trong `validateNewsBlackout`: nếu `"pairs" in window` thì phải là `string[]` (mọi phần tử `typeof === "string"`), sai ⇒ `invalid_news_blackout_window_pairs`. **KHÔNG** đổi field/luật cũ của window (`startsAt`/`endsAt`/`reason`); **KHÔNG** thêm param config mới nào khác — mọi ngưỡng Tầng 0 (`cooldown_after_loss`, `win_streak_threshold`, `size_dampening`, `daily_loss_limit`, `max_trades_per_day`, `news_blackout`, `trading_day_boundary`) **ĐÃ TỒN TẠI** từ 1.2, chỉ consume
  - [x] Cập nhật fixtures dùng `cooldownUntilEpochMillis`: `packages/decision-core/pipeline/runner.test.ts` (dòng ~19) và `packages/decision-core/tiers/tier3/index.test.ts` (dòng ~16) → đổi sang `lastLossEpochMillis: undefined` để không đỏ. `schema.test.ts`: thêm case validate `pairs` hợp lệ + `pairs` rác → `invalid_news_blackout_window_pairs`

- [x] **Task 2 — Cổng phủ quyết hành vi thuần (trái tim FR-1) (AC: #2, #3, #4, #5, #7, #8)**
  - [x] `packages/decision-core/tiers/tier0/behavioral-veto.ts`: **NEW** — hàm thuần
    `evaluateBehavioralVeto(input: BehavioralVetoInput): BehavioralVetoOutcome` với:
    - `BehavioralVetoInput = { state: BehavioralState; params: ConfigParams; pair: string; nowEpochMillis: number }`
    - `BehavioralVetoPass = { blocked: false }`
    - `BehavioralVetoBlock = { blocked: true; error: CoreError }` (shape `{ code, source: "tier0.behavioral", context }`)
    - `BehavioralVetoOutcome = BehavioralVetoPass | BehavioralVetoBlock`
  - [x] Thứ tự kiểm **cố định** (AC8) — trả block ĐẦU TIÊN khớp:
    1. **cooldown**: `state.lastLossEpochMillis !== undefined && nowEpochMillis < lastLossEpochMillis + cooldown_after_loss` ⇒ block `cooldown_active`
    2. **daily-loss**: parse decimal `state.dailyLoss` + `daily_loss_limit` (rác ⇒ block `invalid_decimal_string`; `daily_loss_limit ≤ 0` ⇒ block `invalid_daily_loss_limit` — thủ phòng); `cmp(dailyLoss, dailyLossLimit) >= 0` ⇒ block `daily_loss_limit_reached`
    3. **max-trades**: `state.tradeCountToday >= max_trades_per_day` ⇒ block `max_trades_reached`
    4. **news**: có window `now ∈ [startsAt, endsAt)` **và** (`pairs === undefined || pairs.includes(pair)`) ⇒ block `news_blackout_active`
    5. ngược lại ⇒ `{ blocked: false }`
  - [x] Hàm **thuần**: không mutate input, không IO/`Date`/random; so sánh tiền qua `cmp` (decimal); thời gian/đếm là integer (không phải tiền) — dùng số nguyên trực tiếp OK. KHÔNG `Number()` cho `dailyLoss`

- [x] **Task 3 — Hàm đánh giá win-streak dampening thuần (AC: #6, #8)**
  - [x] `packages/decision-core/tiers/tier0/win-streak.ts`: **NEW** — hàm thuần
    `evaluateWinStreakDampening(input: WinStreakInput): WinStreakOutcome` với:
    - `WinStreakInput = { winStreak: number; threshold: number; sizeDampening: string; riskPct: string }`
    - `WinStreakOutcome = { dampened: boolean; effectiveRiskPct: string }` (decimal-string)
  - [x] Logic: `dampened = winStreak >= threshold`; `effectiveRiskPct = dampened ? mul(riskPct, sizeDampening) : toDecimalString(toDecimal(riskPct))` (chuẩn hoá qua `math/decimal.ts`). Parse rác ⇒ trả rejection shape `{ code: "invalid_decimal_string", source: "tier0.win_streak", context }` (hoặc discriminated `ok:false` song song sizing) — chọn **một** kiểu kết quả nhất quán với `behavioral-veto` và test theo đó
  - [x] Hàm **thuần**, decimal-string vào/ra; KHÔNG tự đọc state/IO; KHÔNG tự tăng `winStreak` (tích luỹ là feedback-loop, ngoài phạm vi)

- [x] **Task 4 — Nối Tầng 0 thật vào pipeline (AC: #1, #8)**
  - [x] `packages/decision-core/tiers/tier0/index.ts`: thêm `createTier0(): Tier` (id `"tier0"`) — trong `run(ctx)` gọi `evaluateBehavioralVeto({ state: ctx.state, params: ctx.config.params, pair: ctx.input.pair, nowEpochMillis: ctx.nowEpochMillis })`; block ⇒ `{ kind: "veto", tier: "tier0", reason: formatReason(error) }`; pass ⇒ `{ kind: "pass" }`. Thêm `formatReason` render mỗi `code` từ context (song song `tier3/index.ts#formatReason`)
  - [x] **GIỮ** `createTier0Stub`/`tier0Stub`/`Tier0StubOptions` export tên ổn định (test khác + driver tương lai dùng để ép pass/veto); có thể để `createTier0Stub()` không tham số trả `createTier0()` thật (song song `createTier3Stub`) — nhưng **giữ** đường ép `vetoReason`
  - [x] Export công khai từ `tiers/tier0/index.ts`: `createTier0`, `evaluateBehavioralVeto` + kiểu `BehavioralVetoInput/Outcome/Pass/Block`, `evaluateWinStreakDampening` + kiểu win-streak. `tiers/index.ts` + `decision-core/index.ts` đã `export *` từ tier0 ⇒ tự lan (kiểm không xung đột tên)

- [x] **Task 5 — Áp win-streak dampening vào Tầng 3 sizing (AC: #6)**
  - [x] `packages/decision-core/tiers/tier3/index.ts`: trong `createTier3().run(ctx)`, **trước** khi gọi `sizeTrade`, tính `effectiveRiskPct` = `evaluateWinStreakDampening({ winStreak: ctx.state.winStreak, threshold: ctx.config.params.win_streak_threshold, sizeDampening: ctx.config.params.size_dampening, riskPct: ctx.config.params.risk_pct }).effectiveRiskPct`; truyền `riskPct: effectiveRiskPct` vào `sizeTrade(...)` thay cho `ctx.config.params.risk_pct` thô
  - [x] **KHÔNG** đổi chữ ký/logic `sizing.ts` (`sizeTrade` đã nhận `riskPct: string` — chỉ đổi giá trị truyền vào). **KHÔNG** đổi thứ tự sizing→cost-hurdle của 1.5. Với `winStreak < threshold` (mọi test 1.4/1.5 hiện dùng `winStreak: 0`) ⇒ `effectiveRiskPct == risk_pct` ⇒ **mọi test cũ vẫn xanh** (backward-compat)
  - [x] Import `evaluateWinStreakDampening` từ `../tier0/index.js` (tier3 phụ thuộc tier0 helper — cùng layer `decision-core`, không phá hướng phụ thuộc port). Nếu muốn tránh cross-tier import, có thể đặt `win-streak.ts` ở nơi trung lập; **khuyến nghị** giữ ở `tier0` (nơi luật hành vi sống) và import — đơn giản, một nguồn

- [x] **Task 6 — Tests phủ từng AC (AC: #1..#9)**
  - [x] `packages/decision-core/tiers/tier0/behavioral-veto.test.ts`: **NEW** — pass khi sạch; mỗi luật veto + biên: cooldown `now == end` ⇒ pass, `now < end` ⇒ veto, `lastLossEpochMillis undefined` ⇒ pass; max-trades `==limit` veto / `==limit-1` pass; daily-loss `==limit` veto / `<limit` pass, decimal chính xác (vd `dailyLoss="100"`, limit `"100"` ⇒ veto); news `[startsAt,endsAt)` + scope `pairs` (chứa/undefined ⇒ veto, không chứa ⇒ pass); **thứ tự cố định** (bơm cả cooldown + daily-loss ⇒ reason là cooldown); AC7 input phi lý (`dailyLoss` rác, `daily_loss_limit="0"`) ⇒ block `source="tier0.behavioral"`; tất định (2 lần `toEqual`); không mutate (`structuredClone`); không leak `number`
  - [x] `packages/decision-core/tiers/tier0/win-streak.test.ts`: **NEW** — `winStreak >= threshold` ⇒ `dampened:true`, `effectiveRiskPct = risk_pct×size_dampening` (số cụ thể: `risk_pct="1"`, `size_dampening="0.5"` ⇒ `"0.5"`); biên `winStreak==threshold` bật, `==threshold-1` không bật (`effectiveRiskPct==risk_pct`); rác ⇒ rejection; tất định + không mutate + `typeof==="string"`
  - [x] `packages/decision-core/tiers/tier0/index.test.ts`: **NEW** — `createTier0()` veto/pass wiring; `reason` render đúng cho mỗi code; stub `createTier0Stub({vetoReason})` vẫn ép veto
  - [x] `packages/decision-core/tiers/tier3/index.test.ts`: **UPDATE** — thêm: winStreak≥threshold ⇒ `volume` nhỏ hơn đúng tỷ lệ `size_dampening` so với baseline; winStreak<threshold ⇒ volume **không đổi** (chốt backward-compat). Đổi fixture `cooldownUntilEpochMillis`→`lastLossEpochMillis`
  - [x] `packages/decision-core/pipeline/runner.test.ts`: **UPDATE** — đổi fixture `cooldownUntilEpochMillis`→`lastLossEpochMillis` (giữ mọi assertion order/veto hiện có)
  - [x] `packages/config/src/schema.test.ts`: **UPDATE** — `news_blackout` window có `pairs` hợp lệ pass; `pairs` rác → `invalid_news_blackout_window_pairs`
  - [x] `pnpm -r test` pass; xác nhận `dist/` không chứa `*.test.*` (`rg --files -g 'dist/**' | rg '\.test\.'`)

## Dev Notes

> **Bối cảnh:** Story 1.6 hoàn tất **Tầng 0 — phủ quyết hành vi (FR-1)**, cổng ĐẦU pipeline có **veto tối cao** (AD-5). Nó xây theo đúng khuôn 1.4/1.5: hàm thuần tách khỏi `index.ts` mỏng, shape lỗi `{ code, source, context }`, so sánh tiền qua `math/decimal.ts` một-nguồn, mọi ngưỡng từ **config snapshot đã version** (AD-4), test biên/determinism/non-mutation. **Điểm mấu chốt về phạm vi:** Tầng 0 **CHỈ ĐỌC** `BehavioralState` — việc **tích luỹ/mutate** state (tăng `winStreak`, cộng `dailyLoss`, tăng `tradeCountToday`, đặt `lastLossEpochMillis` khi lỗ, reset theo trading-day) là **feedback loop + state-owner** (AD-6/AD-7), **ngoài phạm vi** story này — **y hệt** cách 1.5 cấp hàm tính overtrade nhưng hoãn accumulation.

### 🔑 Giải toả mơ hồ: state đến từ đâu, ai reset "ngày" — đừng để dev đoán

- **`BehavioralState` (win-streak, daily-loss, trade-count, last-loss)** do **decision-engine** sở hữu, chỉ đổi qua event `market-tick`/`trade-outcome`, lưu ở Postgres. Trong epic 1 **chưa có** feedback loop/persistence ⇒ state do **driver/test bơm** vào `ctx.state` (y hệt candidate/account ở 1.4, edge/phí ở 1.5). Tầng 0 **tiêu thụ** state đã-tính-sẵn; **KHÔNG** tự suy ra từ lịch sử lệnh. [Source: ARCHITECTURE-SPINE.md#AD-6, #AD-7]
- **Reset "tới hết ngày" & mốc trading-day:** `state.tradeCountToday`/`state.dailyLoss` là các giá trị **đã được state-owner scope theo trading-day** trước khi vào ctx. Việc reset chúng tại `trading_day_boundary` (mặc định UTC 00:00) là **việc của state-owner/feedback** (một định nghĩa trading-day duy nhất — Consistency Conventions), **KHÔNG** phải Tầng 0. Vì vậy story 1.6 **KHÔNG** cần helper trading-day; `config.params.trading_day_boundary` do story reset-state (feedback) tiêu thụ. "Khoá tới hết ngày" tự động đúng vì state không reset tới mốc kế. [Source: ARCHITECTURE-SPINE.md#Consistency Conventions → Ranh giới "ngày"; #AD-6]
- **Cooldown là rule config-driven:** state chỉ mang **mốc thô** `lastLossEpochMillis`; Tầng 0 **dẫn** `cooldownUntil = lastLoss + cooldown_after_loss` rồi so với `now`. Nhờ đó đổi `cooldown_after_loss` (config versioned) tự tái-dẫn đúng, và rule sống ở Tầng 0 (nơi nó thuộc về). Đây là lý do **thay** field placeholder `cooldownUntilEpochMillis` (giá trị đã-dẫn) bằng `lastLossEpochMillis` (mốc thô). [Source: ARCHITECTURE-SPINE.md#AD-4]
- **`news_blackout` "chặn cặp FX liên quan":** window mang `pairs?` (thêm mới, optional). `pairs` liệt kê cặp mà cửa sổ tin áp vào ⇒ crypto **không** bị chặn bởi tin FX được scope. `pairs === undefined` = halt mọi cặp (macro lớn). Đây là cách trung thực nhất để hiện "**liên quan**" mà **không** cần taxonomy FX/crypto trong lõi (người soạn config biết cặp nào là FX). [Source: epics.md → Story 1.6 AC; ARCHITECTURE-SPINE.md#AD-4]

### 🔑 Vì sao win-streak dampening được áp trong Tầng 3, không phải veto Tầng 0

AC gốc gộp win-streak dưới Tầng 0, nhưng **hiệu ứng** là **giảm size** — mà size tính ở **Tầng 3** (AD-5: Tầng 0 = veto; Tầng 3 = risk/sizing). Vì `TierOutcome` chỉ pass/veto (mang payload giữa tầng là seam **deferred** từ 1.4/1.5), ta **không** đẩy tín hiệu dampening qua outcome. Thay vào đó Tầng 3 tự đọc `ctx.state.winStreak` + `ctx.config` (đều có sẵn trong ctx) và áp qua hàm thuần `evaluateWinStreakDampening` — **tất định, không cross-tier payload, không đổi `TierOutcome`, không đổi chữ ký `sizeTrade`**. Đây là chỗ đặt kiến trúc đúng: dampening là **sizing modifier**. Phần "nâng ngưỡng vào" (AC gốc "và/hoặc") thuộc Tầng 1/2 (stub) ⇒ ngoài phạm vi; nhánh `size × size_dampening` đã thoả AC. [Source: ARCHITECTURE-SPINE.md#AD-5; 1-5 Dev Notes → "Chuyển payload giữa các tầng deferred"]

### Hợp đồng đã có (PHẢI tuân, đọc trước khi sửa) — trạng thái hiện tại các file UPDATE

| File | Trạng thái hôm nay | Story 1.6 đổi gì | Phải giữ nguyên |
| --- | --- | --- | --- |
| `tiers/tier0/index.ts` | chỉ có `createTier0Stub`/`tier0Stub` (pass, hoặc veto nếu `vetoReason`) | **+`createTier0()` thật** (veto hành vi); +`formatReason`; export helper/kiểu | tên export `createTier0Stub`/`tier0Stub`/`Tier0StubOptions`; đường ép `vetoReason` |
| `types/index.ts` | `BehavioralState` placeholder có `cooldownUntilEpochMillis?` | **thay** bằng `lastLossEpochMillis?`; xoá note placeholder | `winStreak`/`dailyLoss`/`tradeCountToday`; kiểu khác |
| `pipeline/runner.ts` | `TierContext` có `state/input/config/nowEpochMillis`; `runPipeline` veto→silent, dừng ngay | **không sửa** (Tầng 0 chỉ đọc ctx sẵn có) | toàn bộ `runPipeline`/`TierOutcome`/`TierContext` |
| `tiers/tier3/index.ts` | `createTier3` gọi `sizeTrade(riskPct=risk_pct thô)` rồi cost-hurdle | truyền `effectiveRiskPct` (đã dampen) vào `sizeTrade`; +import win-streak helper | thứ tự sizing→cost-hurdle; nhánh thiếu candidate/account→pass; tên export |
| `tiers/tier3/sizing.ts` | `sizeTrade(input.riskPct: string)` thuần | **không sửa** (chỉ đổi giá trị truyền vào) | toàn bộ |
| `packages/config/src/schema.ts` | `NewsBlackoutWindow = {startsAt,endsAt,reason?}`; mọi param Tầng 0 **đã có** | **+`pairs?: string[]`** (additive) vào window + validate | mọi field/param cũ; `validateParams`; `DEFAULT_PARAMS` |
| `math/decimal.ts` | wrapper thuần precision 40 / HALF_UP một chỗ | **không sửa** — tái dùng `cmp`/`mul`/`toDecimal` | precision/rounding một chỗ (determinism) |

[Source: packages/decision-core/tiers/tier0/index.ts; types/index.ts; pipeline/runner.ts; tiers/tier3/index.ts; tiers/tier3/sizing.ts; packages/config/src/schema.ts; math/decimal.ts]

### Đặc tả logic Tầng 0 (một nguồn sự thật)

```text
# evaluateBehavioralVeto — trả BLOCK đầu tiên khớp (thứ tự cố định), else pass
1. cooldown_active           nếu lastLossEpochMillis !== undefined
                               và now < lastLossEpochMillis + cooldown_after_loss   # integer ms; biên now==end ⇒ HẾT
2. daily_loss_limit_reached  nếu cmp(dailyLoss, daily_loss_limit) >= 0             # decimal; == ⇒ VETO ("chạm")
                               (parse rác ⇒ invalid_decimal_string; limit ≤ 0 ⇒ invalid_daily_loss_limit)
3. max_trades_reached        nếu tradeCountToday >= max_trades_per_day             # integer; >= ⇒ VETO
4. news_blackout_active      nếu ∃ window: now ∈ [startsAt, endsAt)                # nửa mở; now==endsAt ⇒ NGOÀI
                               và (window.pairs === undefined || pairs.includes(pair))
source = "tier0.behavioral" cho mọi block
```

```text
# evaluateWinStreakDampening (áp trong Tầng 3, KHÔNG phải veto)
dampened        = winStreak >= win_streak_threshold                 # integer; >= ⇒ dampen
effectiveRiskPct = dampened ? mul(risk_pct, size_dampening) : risk_pct   # mul decimal
source = "tier0.win_streak" cho rejection input rác
```

Mọi so sánh tiền là **decimal** (`cmp`), mọi nhân tiền là **decimal** (`mul`) — KHÔNG `Number(...)`. Thời gian/đếm là integer ms/count (không phải tiền) ⇒ toán integer trực tiếp hợp lệ. [Source: packages/decision-core/math/decimal.ts; ARCHITECTURE-SPINE.md#Consistency Conventions → Tiền tệ, Thời gian, Determinism]

### Invariant kiến trúc PHẢI tuân

- **AD-5 — Tầng 0 veto tối cao, chạy đầu:** thứ tự cố định 0→1→2→3; Tầng 0 chặn → dừng ngay, im lặng (`runPipeline` đã đảm bảo). [Source: #AD-5]
- **AD-2 — thuần & tất định:** mọi hàm thuần; không `Date`/`Math.random`/IO; lint `decision-core` chặn; cùng input → cùng output (NFR-6). Thời gian vào lõi **chỉ** qua `nowEpochMillis` (đã resolve từ `clock` port ở `runPipeline`). [Source: #AD-2]
- **AD-4 — config snapshot:** mọi ngưỡng Tầng 0 đọc từ snapshot đã version; danh sách tham số AD-4 **đã liệt kê** cooldown/win_streak_threshold/size_dampening/daily_loss_limit/news_blackout — nhúng được vào Đề xuất để tái lập. [Source: #AD-4]
- **AD-6/AD-7 — chủ sở hữu state & feedback:** `BehavioralState` là behavioral state do decision-engine sở hữu, đổi chỉ qua `market-tick`/`trade-outcome`. Story 1.6 **chỉ đọc**; accumulation/reset/persist là story feedback sau. [Source: #AD-6, #AD-7]
- **AD-8 — audit append-only:** "mọi lần chặn ghi Nhật ký" — story 1.6 cấp `reason` + `code` + `context` **đủ để log**; việc **persist** block-event vào audit append-only (`suggestion-blocked`) là **AD-8**, **ngoài phạm vi** (chưa có persistence adapter). [Source: #AD-8; #Consistency Conventions → Naming event]

### Ngoài phạm vi story này (đừng làm — để story sau)

- **Tích luỹ/mutate/reset `BehavioralState`** (tăng winStreak, cộng dailyLoss, tăng tradeCountToday, đặt lastLossEpochMillis, reset theo trading-day) — **feedback loop + state-owner** (AD-6/AD-7) + persistence. Story 1.6 **chỉ đọc** state bơm sẵn.
- **Helper trading-day / parse `trading_day_boundary`** — thuộc story reset-state (feedback). Tầng 0 đọc state **đã** scope-theo-ngày.
- **Persist "lần chặn" vào Nhật ký audit append-only** (`suggestion-blocked`) — AD-8, cần persistence adapter (story sau). Nay chỉ trả `reason`/`code`/`context`.
- **FR-10 live-drift auto-halt** & **FR-12 override friction** — cũng là luật Tầng 0 nhưng **FR khác, story khác**; 1.6 chỉ làm FR-1.
- **Nâng "ngưỡng vào" khi win-streak** — thuộc Tầng 1/2 (stub epic 1). Nhánh size-dampening đã thoả AC "và/hoặc".
- **Taxonomy FX/crypto tự động** cho news_blackout — nay scope bằng `window.pairs` do người soạn config cấp; suy luận pair-class tự động là v2.
- **Mang kết quả Tầng 0 vào `Suggestion`** — `Suggestion` còn stub. Deferred cùng story làm giàu Đề xuất.

### Source tree mục tiêu (phần thêm/đổi)

```text
packages/config/src/
  schema.ts                          # UPDATE: + NewsBlackoutWindow.pairs? (additive, validate)
  schema.test.ts                     # UPDATE: cover pairs hợp lệ + rác
packages/decision-core/
  types/index.ts                     # UPDATE: BehavioralState → lastLossEpochMillis? (thay cooldownUntilEpochMillis?)
  tiers/tier0/
    behavioral-veto.ts               # NEW: evaluateBehavioralVeto() + Input/Pass/Block/Outcome
    behavioral-veto.test.ts          # NEW
    win-streak.ts                    # NEW: evaluateWinStreakDampening() + Input/Outcome
    win-streak.test.ts               # NEW
    index.ts                         # UPDATE: + createTier0() thật + formatReason; export helper/kiểu; giữ stub
    index.test.ts                    # NEW: wiring createTier0 veto/pass + reason
  tiers/tier3/
    index.ts                         # UPDATE: áp effectiveRiskPct (win-streak) vào sizeTrade
    index.test.ts                    # UPDATE: dampening volume + fixture lastLossEpochMillis
  pipeline/runner.ts                 # (không đổi)
  pipeline/runner.test.ts            # UPDATE: fixture cooldownUntilEpochMillis → lastLossEpochMillis
```
[Source: ARCHITECTURE-SPINE.md#Structural Seed; bố cục 1.4/1.5 làm khuôn]

### Project Structure Notes

- Tách `behavioral-veto.ts` + `win-streak.ts` khỏi `index.ts` (song song `sizing.ts`/`cost-hurdle.ts`): hàm thuần dễ test đơn vị (nơi giá trị FR-1 nằm); `index.ts` chỉ là lớp nối pipeline mỏng.
- Tái dùng `math/decimal.ts` của 1.4 — **không** cấu hình precision mới (một nguồn sự thật cho tái lập).
- Config: thêm `pairs?` là **thay đổi additive** chạm `@brighten/config` (artifact 1.2). Rủi ro chính: test config assert cứng shape window → cập nhật fixture (Task 6). Không đổi `validateParams`/`DEFAULT_PARAMS`/`version.ts`/`store.ts`.
- Xung đột đã biết: `apps/*` chỉ import **type** `PipelineResult` (grep 1.5 xác nhận) — **không** import tier0/tier3 ⇒ wiring `createTier0()` + đổi tier3 **an toàn**, không vỡ app.
- `BehavioralState` chỉ được dựng ở 2 fixture test (`runner.test.ts`, `tier3/index.test.ts`) + tham chiếu type ở port `persistence`/`narrator`/`ui-read` (chỉ type, không dựng giá trị) ⇒ đổi field an toàn, chỉ sửa 2 fixture.

### Chuẩn test

- Vitest; mỗi AC ≥ 1 test. Ưu tiên **số cụ thể tính tay** (vd `risk_pct="1"×size_dampening="0.5" ⇒ "0.5"`; `dailyLoss="100"` vs limit `"100"` ⇒ veto).
- Test **biên**: cooldown `now == lastLoss+cooldown` ⇒ **pass** (dùng `<`); max-trades `== limit` ⇒ **veto** (dùng `>=`); daily-loss `== limit` ⇒ **veto** ("chạm"); news `now == endsAt` ⇒ **pass** (`[start,end)`); `winStreak == threshold` ⇒ **dampen**.
- Test **scope news**: window `pairs=["EURUSD"]` + `pair="BTCUSDT"` ⇒ **pass**; `pair="EURUSD"` ⇒ **veto**; `pairs` undefined ⇒ **veto** mọi cặp.
- Test **thứ tự cố định**: bơm đồng thời cooldown + daily-loss + max-trades ⇒ reason là **cooldown** (chứng minh short-circuit đúng thứ tự).
- Test **tất định** (2 lần `toEqual`), **không mutate** (`structuredClone`), **không leak number** (`typeof field === "string"` cho `dailyLoss`/`effectiveRiskPct`).
- Test **Tầng 3 dampening**: winStreak≥threshold ⇒ `volume` = baseline × `size_dampening` (số cụ thể); winStreak<threshold ⇒ volume **không đổi**.
- Không integration/DB (không adapter/persistence ở story này).

### References

- [Source: epics.md → Epic 1, Story 1.6] — AC gốc (BDD): cooldown sau lỗ; `max_trades_per_day` khoá tới hết ngày; `win_streak_threshold` → `size_dampening`/nâng ngưỡng; `daily_loss_limit` khoá tới hết ngày; `news_blackout` chặn cặp FX liên quan; mọi lần chặn ghi log
- [Source: ARCHITECTURE-SPINE.md#AD-5] — Tầng 0 veto tối cao, chạy đầu, dừng-ngay-khi-veto
- [Source: ARCHITECTURE-SPINE.md#AD-6, #AD-7] — `BehavioralState` là aggregate state của decision-engine qua `market-tick`/`trade-outcome` → accumulation/reset deferred; Tầng 0 chỉ đọc
- [Source: ARCHITECTURE-SPINE.md#AD-4] — mọi ngưỡng Tầng 0 là config có phiên bản, snapshot cùng mỗi quyết định (danh sách AD-4 đã liệt kê cooldown/win_streak/size_dampening/daily_loss/news_blackout)
- [Source: ARCHITECTURE-SPINE.md#AD-2] — lõi thuần tất định (lint chặn IO/Date/random); NFR-6; thời gian vào lõi qua `clock`→`nowEpochMillis`
- [Source: ARCHITECTURE-SPINE.md#AD-8] — chặn ghi Nhật ký append-only (`suggestion-blocked`) → persist deferred; 1.6 cấp reason/code/context đủ log
- [Source: ARCHITECTURE-SPINE.md#Consistency Conventions] — Tiền tệ (decimal/string), Thời gian (UTC epoch-ms qua clock), Ranh giới "ngày" (một mốc trading-day, do state-owner), Lỗi `{code,source,context}`, Determinism, Naming event
- [Source: ARCHITECTURE-SPINE.md#Capability Map] — FR-1 Tầng 0 phủ quyết lives in `decision-core/tiers/tier0` + `behavioral-state`, governed AD-5/AD-6/AD-2
- [Source: packages/decision-core/tiers/tier0/index.ts] — stub hiện tại (`createTier0Stub`/`tier0Stub`) mà 1.6 nối tiếp; giữ tên export
- [Source: packages/decision-core/pipeline/runner.ts] — `TierContext`/`TierOutcome`/`runPipeline` (đọc `state`/`input`/`config`/`nowEpochMillis`; veto→silent)
- [Source: packages/decision-core/types/index.ts] — `BehavioralState` placeholder (enrich here), `CoreError`, `Result`
- [Source: packages/config/src/schema.ts] — `ConfigParams` (mọi param Tầng 0 đã có), `NewsBlackoutWindow`, `validateNewsBlackout` (pattern mở rộng `pairs?`)
- [Source: packages/decision-core/tiers/tier3/index.ts; sizing.ts] — điểm áp `effectiveRiskPct`; `formatReason` làm khuôn
- [Source: packages/decision-core/math/decimal.ts] — wrapper decimal precision-một-chỗ (`cmp`/`mul`/`toDecimal`) để tái dùng
- [Source: 1-5-cost-hurdle-cost-gate.md] — khuôn trực tiếp: hàm thuần tách khỏi index, shape lỗi `{code,source,context}`, chuẩn test biên/determinism/non-mutation, ranh giới "cấp hàm thuần, hoãn accumulation/wiring"

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- `pnpm --filter @brighten/config test -- --run src/schema.test.ts` failed before `news_blackout[].pairs?` support, then passed after schema validation update.
- `pnpm --filter @brighten/decision-core test -- --run tiers/tier0/behavioral-veto.test.ts tiers/tier0/win-streak.test.ts` failed before new helper modules existed, then passed after implementation.
- `pnpm --filter @brighten/decision-core test -- --run tiers/tier0/index.test.ts` failed before `createTier0()` existed, then passed after Tier 0 wiring.
- `pnpm --filter @brighten/decision-core test -- --run tiers/tier3/index.test.ts` failed before Tier 3 used dampened risk, then passed after applying `effectiveRiskPct`.
- Final validation passed: `pnpm -r typecheck`, `pnpm -r build`, `pnpm -r lint`, `pnpm -r test`.
- Verified no `*.test.*` files under `dist/` with `rg --files -g 'dist/**' | rg '\.test\.'`.

### Completion Notes List

- Task 1: Replaced `BehavioralState.cooldownUntilEpochMillis` with `lastLossEpochMillis`, added `news_blackout[].pairs?` validation, and updated config/state fixtures.
- Task 2: Added pure behavioral veto evaluation with fixed rule priority, decimal daily-loss checks, scoped news blackout handling, structured block errors, determinism, and non-mutation coverage.
- Task 3: Added pure win-streak dampening evaluation with decimal effective-risk output, threshold boundary coverage, structured rejection, determinism, and non-mutation coverage.
- Task 4: Wired real `createTier0()` to behavioral veto evaluation, formatted veto reasons, preserved stub override behavior, and exported Tier 0 helpers/types.
- Task 5: Applied win-streak dampening before Tier 3 sizing by passing effective decimal risk into `sizeTrade`, preserving sizing-to-cost-hurdle order.
- Task 6: Added AC coverage for behavioral veto pass/veto boundaries, scoped news blackout, fixed rule priority, invalid input, deterministic/non-mutating behavior, win-streak dampening, Tier 0 wiring, Tier 3 dampening, and config validation.

### File List

- packages/decision-core/types/index.ts
- packages/decision-core/pipeline/runner.test.ts
- packages/decision-core/tiers/tier3/index.test.ts
- packages/config/src/schema.ts
- packages/config/src/schema.test.ts
- packages/decision-core/tiers/tier0/behavioral-veto.ts
- packages/decision-core/tiers/tier0/behavioral-veto.test.ts
- packages/decision-core/tiers/tier0/win-streak.ts
- packages/decision-core/tiers/tier0/win-streak.test.ts
- packages/decision-core/tiers/tier0/index.ts
- packages/decision-core/tiers/tier0/index.test.ts
- packages/decision-core/tiers/tier3/index.ts
- packages/decision-core/tiers/tier3/index.test.ts

### Change Log

- 2026-07-04: Implemented Story 1.6 Tier 0 behavioral veto, scoped news blackout config, win-streak dampening into Tier 3 sizing, and AC test coverage. Status set to review.
