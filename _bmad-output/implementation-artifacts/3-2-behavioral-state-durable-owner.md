---
baseline_commit: cfae2a46e98a2ac6b5e1bf9e97fc672533fa2161
depends_on: 3-1-live-tick-cron-runner
---

# Story 3.2: Behavioral state bền + một chủ sở hữu (AD-6)

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **người dùng của Brighten**,
I want **behavioral state (win-streak, daily-loss, cooldown-mốc, trade-count) được lưu BỀN trong Postgres và CHỈ đổi qua đúng hai event `market-tick` (cron) và `trade-outcome` (feedback) do MỘT chủ sở hữu (decision-engine) áp bằng reducer THUẦN; UI và mọi component khác chỉ ĐỌC; state sống sót qua restart edge function**,
so that **Tầng 0 không bao giờ veto sai vì state bị nhiều nơi sửa hay mất khi RAM reset, và mọi thay đổi state tái lập được từ event (AD-6, AD-2, AD-1)**.

## Acceptance Criteria

**AC1 — Hai reducer THUẦN là ĐƯỜNG DUY NHẤT đổi state (AD-6, AD-2)**
**Given** `BehavioralState` (win-streak, daily-loss, lastLoss-mốc, trade-count) + `config.params.trading_day_boundary`
**When** thêm state-owner logic vào `decision-core`
**Then** thêm **hai hàm thuần** (đường duy nhất sinh state mới) trong `packages/decision-core/state/`:
  - `applyMarketTick(state, ctx: { nowEpochMillis, tradingDayBoundary, tradingDayStartEpochMillis? }) → { state: BehavioralState; tradingDayStartEpochMillis: number }` — **reset ranh giới ngày**: nếu `now` sang trading-day mới ⇒ `tradeCountToday = 0`, `dailyLoss = "0"`; **giữ** `winStreak`/`lastLossEpochMillis` (streak & cooldown KHÔNG reset ngày)
  - `applyTradeOutcome(state, event: TradeOutcomeEvent) → BehavioralState` — `event = { result: "win" | "loss"; lossAmount?: string; atEpochMillis: number }`: win ⇒ `winStreak+1`; loss ⇒ `winStreak = 0`, `dailyLoss = add(dailyLoss, lossAmount)`, `lastLossEpochMillis = atEpochMillis`; **cả hai** ⇒ `tradeCountToday + 1`
**And** cả hai **thuần**: không mutate `state`, không `Date`/IO/random; tiền qua `math/decimal.ts` (`add`); thời gian là integer ms; cùng input ⇒ cùng output (AD-2)
**And** đây là **hiện thực phần accumulation/reset mà 1.6 CỐ Ý HOÃN** ("tích luỹ/mutate/reset là feedback-loop + state-owner, AD-6/AD-7"). Tầng 0 vẫn **chỉ đọc** state; KHÔNG đụng luật Tầng 0

**AC2 — Helper ranh giới trading-day thuần (tiêu thụ `trading_day_boundary`)**
**Given** `trading_day_boundary` dạng `"UTC HH:mm"` (mặc định `"UTC 00:00"`) hoặc `"UTC±HH:mm"` (schema 1.2 đã validate 2 dạng)
**When** tính mốc bắt đầu trading-day chứa `now`
**Then** helper thuần `tradingDayStart(nowEpochMillis, boundary) → number` = `floor((now − offsetMs) / 86_400_000) × 86_400_000 + offsetMs` (integer math, **KHÔNG** `Date`/timezone-lib ⇒ AD-2)
**And** `offsetMs` suy từ boundary theo đặc tả cố định (Dev Notes); **mặc định `"UTC 00:00"` ⇒ offset 0** (reset 00:00 UTC) — dạng offset `UTC±HH:mm` là mặc-định-tài-liệu-hoá, test phủ dạng UTC-time trước
**And** "khoá tới hết ngày" của Tầng 0 (1.6) tự đúng: `dailyLoss`/`tradeCountToday` chỉ reset khi `tradingDayStart` đổi (một định-nghĩa-ngày-duy-nhất — Consistency Conventions)

**AC3 — `market-tick` nối vào `runTick` (3.1): đọc → apply → PERSIST → pipeline**
**Given** `runTick` (3.1) hiện đọc state rồi chạy pipeline (KHÔNG persist state)
**When** tick chạy
**Then** `runTick` chèn bước state-owner **trước** pipeline: `readBehavioralState` → `applyMarketTick(state, { now, boundary, persistedDayStart })` → **persist** `writeBehavioralState(nextState)` → chạy pipeline với `nextState`
**And** persist state **KHÔNG** làm hỏng tick khi lỗi: `writeBehavioralState` lỗi ⇒ log + tiếp tục (hoặc `skipped` — chốt ở "Cần xác nhận"); soft-degrade như 3.1
**And** đây là event `market-tick` — **một trong hai** đường hợp lệ; `trade-outcome` (đường kia) nối ở **3.4** (feedback)

**AC4 — State BỀN trong Postgres, sống sót restart; MỘT đường ghi (AD-6, AD-1)**
**Given** edge function stateless (AD-1, `policy = "oneshot"`) — RAM mất sau mỗi invocation
**When** state đổi
**Then** state đọc/ghi **hoàn toàn** ở Postgres (`behavioral_state` một-hàng, 3.1) — **không** giữ trong RAM giữa các tick ⇒ sống sót restart/redeploy
**And** thêm `writeBehavioralState(state) → Result<void>` vào `PersistencePort` (additive) — **đường ghi state DUY NHẤT**; chỉ **state-owner** (driver `runTick` market-tick + driver feedback 3.4) gọi. Adapter postgres hiện thực UPDATE hàng `id=1` (gồm cột trading-day-start mới)
**And** `readBehavioralState` (3.1) mở rộng đọc kèm `tradingDayStartEpochMillis` (bookkeeping) để owner detect reset

**AC5 — UI & mọi component khác CHỈ ĐỌC; không đường mutate nào khác (AD-6)**
**Given** AD-6 "không component nào khác được mutate; UI chỉ đọc"
**When** cấp quyền/đường code
**Then** migration cấp **read-only** cho vai UI (grant `select` trên `behavioral_state`, **không** `insert/update/delete`; hoặc view read-only) — enforce ở tầng DB
**And** ở tầng code: **không** export đường mutate state ngoài `writeBehavioralState` (owner-only); reducer thuần không tự-persist; `apps/web` (epic 4) chỉ `select`. Test/đọc-code khẳng định không path nào khác ghi `behavioral_state`
**And** convention: state là "aggregate của decision-engine" — bất kỳ nhu cầu đổi state ⇒ **phải** qua `applyMarketTick`/`applyTradeOutcome` rồi `writeBehavioralState`, KHÔNG UPDATE trực tiếp rải rác

**AC6 — `trade-outcome` reducer sẵn sàng; NGUỒN (feedback) deferred 3.4**
**Given** `applyTradeOutcome` (AC1) là reducer thuần
**When** story 3.2
**Then** cấp + test **reducer** `applyTradeOutcome` + persistence apply đường (owner đọc→reduce→ghi) bằng **fixture** event; **NGUỒN** trade-outcome (Binance read-only probe vị thế/PnL + user xác nhận fill↔Đề xuất, AD-7) là **story 3.4** — 3.2 KHÔNG dò Binance, KHÔNG UI xác nhận
**And** ranh giới "khi nào lệnh tính vào `tradeCountToday`/win-streak" (lúc entry-confirm vs lúc outcome) là chi tiết granularity của **3.4**; 3.2 mặc định `applyTradeOutcome` = một lệnh **đã đóng** ⇒ +1 count + cập nhật streak/loss (tài liệu-hoá, chỉnh ở 3.4 nếu cần)

**AC7 — Migration/port/types additive + Test phủ từng AC + toolchain sạch**
**Given** `behavioral_state` (3.1) + `PersistencePort` + `BehavioralState`
**When** mở rộng
**Then** additive: `behavioral_state` +cột `trading_day_start_epoch_millis bigint` (migration mới, `if not exists`/`alter add column`); `BehavioralState` +`tradingDayStartEpochMillis?: number` **optional** (không phá fixtures); `PersistencePort` +`writeBehavioralState`; **KHÔNG** đổi param config, KHÔNG đổi luật Tầng 0
**And** test cho: `applyMarketTick` reset đúng ở biên ngày (số tính tay: `now` sang ngày mới ⇒ reset count/loss, giữ streak/lastLoss; cùng ngày ⇒ không reset); `tradingDayStart` số tính tay (`"UTC 00:00"`); `applyTradeOutcome` win/loss (streak/loss/lastLoss/count đúng, decimal `dailyLoss`); reducer thuần (không mutate `structuredClone`, tất định 2× `toEqual`, không leak number); `runTick` gọi `applyMarketTick`+`writeBehavioralState` đúng thứ tự (fake persistence ghi nhận nextState); postgres adapter `writeBehavioralState` UPDATE đúng + `readBehavioralState` map cột trading-day-start; **không** đường ghi khác
**And** `pnpm -r typecheck && pnpm -r build && pnpm -r lint && pnpm -r test` **tất cả pass**; `*.test.ts` KHÔNG lọt `dist/`

## Tasks / Subtasks

- [x] **Task 1 — Reducer thuần + trading-day helper trong `decision-core/state/` (AC: #1, #2)**
  - [x] `packages/decision-core/state/trading-day.ts`: **NEW** — `tradingDayStart(nowEpochMillis: number, boundary: string): number` (integer math, không `Date`); parse boundary → `offsetMs` theo đặc tả Dev Notes; export
  - [x] `packages/decision-core/state/behavioral.ts`: **NEW** —
    - `TradeOutcomeEvent = { readonly result: "win" | "loss"; readonly lossAmount?: string; readonly atEpochMillis: number }`
    - `applyMarketTick(state, ctx): { state: BehavioralState; tradingDayStartEpochMillis: number }` — dùng `tradingDayStart`; reset khi đổi ngày (count=0, dailyLoss="0"); giữ streak/lastLoss
    - `applyTradeOutcome(state, event): BehavioralState` — win/loss theo AC1; `add` decimal cho `dailyLoss`; count+1
    - Thuần: không mutate (trả object mới), không `Date`/IO/random; loss thiếu `lossAmount` ⇒ dùng `"0"` hoặc reject-shape (chọn: mặc định `lossAmount` bắt buộc khi `result="loss"`, thiếu ⇒ coi `"0"` + log-able — tài liệu-hoá)
  - [x] `packages/decision-core/state/index.ts`: **NEW** — `export *`; thêm `export * from "./state/index.js"` vào `packages/decision-core/index.ts`
  - [x] `packages/decision-core/types/index.ts`: `BehavioralState` +`readonly tradingDayStartEpochMillis?: number` (optional, additive — comment "bookkeeping do state-owner, tiers bỏ qua")

- [x] **Task 2 — Mở rộng `PersistencePort` + adapter postgres (AC: #4)**
  - [x] `packages/decision-core/ports/persistence.ts`: thêm `readonly writeBehavioralState: (state: BehavioralState) => Promise<Result<void>>` (additive; đường ghi state DUY NHẤT). `readBehavioralState` trả `BehavioralState` gồm `tradingDayStartEpochMillis` (đọc từ cột mới)
  - [x] `packages/adapters/postgres/index.ts`: `createPostgresPersistence` — impl `writeBehavioralState`: `update behavioral_state set win_streak=$, daily_loss=$, last_loss_epoch_millis=$, trade_count_today=$, trading_day_start_epoch_millis=$, updated_at=now() where id=1`; `readBehavioralState` map thêm cột `trading_day_start_epoch_millis` → `tradingDayStartEpochMillis`. Lỗi DB ⇒ `Result{ok:false}` (không throw)
  - [x] `packages/adapters/postgres/index.test.ts`: **UPDATE** — `writeBehavioralState` gọi UPDATE đúng tham số (fake `SqlClient`); `readBehavioralState` map cột mới

- [x] **Task 3 — Nối `market-tick` vào `runTick` (AC: #3)**
  - [x] `apps/cron-runner/src/tick.ts`: sau `readBehavioralState` (ok), **trước** `runPipeline`:
    - `const { state: tickedState, tradingDayStartEpochMillis } = applyMarketTick(stateResult.value, { nowEpochMillis: toEpochMillis, tradingDayBoundary: configResult.value.params.trading_day_boundary, tradingDayStartEpochMillis: stateResult.value.tradingDayStartEpochMillis })`
    - `const writeResult = await deps.persistence.writeBehavioralState({ ...tickedState, tradingDayStartEpochMillis })`; lỗi ⇒ log (tiếp tục — hoặc `skipped`, xem Cần xác nhận)
    - dùng `tickedState` cho `base.state` (không phải state cũ)
  - [x] Lưu ý thứ tự: `applyMarketTick` dùng `toEpochMillis` (đã tính từ `clock`); giữ soft-degrade + try/catch bao ngoài (3.1)
  - [x] `apps/cron-runner/src/tick.test.ts`: **UPDATE** — fake persistence: khẳng định `writeBehavioralState` gọi với state đã reset (khi biên ngày) trước pipeline; state cũ không rò vào pipeline

- [x] **Task 4 — Migration: cột trading-day-start + read-only grant (AC: #4, #5)**
  - [x] `supabase/migrations/<ts>_behavioral_state_owner.sql`: **NEW** —
    - `alter table public.behavioral_state add column if not exists trading_day_start_epoch_millis bigint;`
    - **read-only cho UI:** tạo vai/role read-only hoặc grant `select` (không `insert/update/delete`) trên `behavioral_state` cho vai UI/anon dùng bởi `apps/web` (AD-6). Ghi chú: enforce đường-ghi-duy-nhất qua service role của cron/feedback
    - Idempotent (`if not exists`); KHÔNG đổi seed 3.1
  - [x] Ghi chú ops: `apps/web` (epic 4) dùng khóa read-only; cron/feedback dùng service role (đường ghi duy nhất)

- [x] **Task 5 — Tests reducer + wiring (AC: #7)**
  - [x] `packages/decision-core/state/trading-day.test.ts`: **NEW** — `tradingDayStart` số tính tay (`"UTC 00:00"`: now trong ngày ⇒ start = 00:00 UTC hôm đó; biên qua nửa đêm); dạng `"UTC+07:00"` (mặc-định-tài-liệu-hoá) 1 case
  - [x] `packages/decision-core/state/behavioral.test.ts`: **NEW** — `applyMarketTick`: đổi ngày ⇒ reset count/loss giữ streak/lastLoss; cùng ngày ⇒ y nguyên; `applyTradeOutcome`: win ⇒ streak+1/count+1; loss ⇒ streak=0/dailyLoss+lossAmount (decimal)/lastLoss=atEpochMillis/count+1; thuần (structuredClone), tất định (2× toEqual), `typeof dailyLoss==="string"`
  - [x] `apps/cron-runner/src/tick.test.ts` (Task 3) + `packages/adapters/postgres/index.test.ts` (Task 2) đã phủ wiring/persist
  - [x] `pnpm -r test` pass; `dist/` không chứa `*.test.*`

## Dev Notes

> **Bối cảnh:** Story 3.2 hiện thực **AD-6 — một chủ sở hữu cho behavioral state**. Nó đóng khoản nợ mà **1.6 cố ý hoãn**: 1.6 làm Tầng 0 **đọc** state để veto; việc **tích luỹ/reset** state (win-streak++, cộng daily-loss, đặt lastLoss, reset đếm theo trading-day) là "feedback-loop + state-owner (AD-6/AD-7)" — chính là story này. 3.2 đặt **hai reducer thuần** (`applyMarketTick`, `applyTradeOutcome`) làm **đường DUY NHẤT** sinh state mới, persist bền ở Postgres, và nối `market-tick` vào `runTick` (3.1). Nguồn `trade-outcome` (Binance probe + user confirm) là **3.4**.

> **Phụ thuộc:** build trên **3.1** (`runTick`, `behavioral_state` table, `createPostgresPersistence`, `readBehavioralState`/`saveSuggestion`). [Source: apps/cron-runner/src/tick.ts; supabase/migrations/20260704031000_live_tick.sql; packages/adapters/postgres/index.ts]

### 🔑 Vì sao reducer thuần trong core, không trong adapter/driver

- **Tất định (AD-2):** state-transition là luật (streak/loss/reset) ⇒ phải thuần, tái lập, cùng event → cùng state. Nếu để adapter/driver tự tính, live & (future) replay lệch. Reducer ở `decision-core/state/` (thuần); persistence chỉ **lưu** kết quả; driver chỉ **gọi** reducer rồi `writeBehavioralState`. [Source: ARCHITECTURE-SPINE.md#AD-2, #AD-6]
- **Một chủ sở hữu = một đường ghi:** chỉ `writeBehavioralState` ghi `behavioral_state`, chỉ state-owner (tick market-tick + feedback 3.4) gọi. Không UPDATE rải rác. UI read-only (grant DB). Đây là thứ ngăn "Tầng 0 veto sai vì nhiều nơi sửa state" (AC gốc). [Source: ARCHITECTURE-SPINE.md#AD-6]
- **Bền, không RAM (AD-1):** edge function `oneshot` mất RAM mỗi lần ⇒ state PHẢI ở Postgres; 3.1 đã đọc từ đó, 3.2 thêm **ghi** bền ⇒ sống sót restart. [Source: supabase/config.toml `policy="oneshot"`; ARCHITECTURE-SPINE.md#AD-1]

### Đặc tả reducer + trading-day (một nguồn sự thật)

```text
# tradingDayStart(now, boundary) — integer ms, KHÔNG Date
parse boundary:
  "UTC HH:mm"   ⇒ offsetMs = (HH*60+mm)*60_000         # reset tại HH:mm UTC (mặc định "UTC 00:00" ⇒ 0)
  "UTC±HH:mm"   ⇒ offsetMs = ∓(HH*60+mm)*60_000        # dạng offset (mặc-định-tài-liệu-hoá; test sau)
dayStart = floor((now − offsetMs) / 86_400_000) * 86_400_000 + offsetMs

# applyMarketTick(state, {now, boundary, tradingDayStartEpochMillis?})
nextStart = tradingDayStart(now, boundary)
crossed   = tradingDayStartEpochMillis === undefined ? false : nextStart > tradingDayStartEpochMillis
# undefined (lần đầu) ⇒ khởi tạo start = nextStart, KHÔNG reset (chưa có ngày trước)
if crossed ⇒ { tradeCountToday: 0, dailyLoss: "0", winStreak giữ, lastLossEpochMillis giữ }
else       ⇒ state giữ nguyên
return { state: next, tradingDayStartEpochMillis: nextStart }

# applyTradeOutcome(state, {result, lossAmount?, atEpochMillis})
win  ⇒ winStreak+1
loss ⇒ winStreak=0 ; dailyLoss = add(dailyLoss, lossAmount ?? "0") ; lastLossEpochMillis = atEpochMillis
both ⇒ tradeCountToday+1
```

> **Về "khi nào +count" & granularity:** mặc định `applyTradeOutcome` = một lệnh **đã đóng** ⇒ +1. Nếu 3.4 cần đếm **lúc entry** (để `max_trades_per_day` chặn sớm), tách thêm event entry ở 3.4 — KHÔNG đổi reducer này ngoài phạm vi. [Source: 1-6…md → tradeCountToday "do state-owner cấp"; epics.md → 3.4]

### Hợp đồng đã có (PHẢI tuân, đọc trước khi sửa) — trạng thái sau 3.1

| File | Trạng thái sau 3.1 | Story 3.2 đổi gì | Phải giữ nguyên |
| --- | --- | --- | --- |
| `packages/decision-core/types/index.ts` | `BehavioralState{winStreak,dailyLoss,lastLossEpochMillis?,tradeCountToday}` | **+`tradingDayStartEpochMillis?`** (optional) | field cũ; `Suggestion` (3.1); tiers đọc cũ |
| `packages/decision-core/ports/persistence.ts` | `PersistencePort` 4 method (read state/config, save suggestion, appendAudit) | **+`writeBehavioralState`** (additive) | 4 method cũ |
| `packages/decision-core/tiers/tier0/*` | đọc `winStreak/dailyLoss/tradeCountToday/lastLossEpochMillis` | **KHÔNG sửa** (chỉ đọc) | toàn bộ luật Tầng 0 |
| `packages/adapters/postgres/index.ts` | `createPostgresPersistence` (read config/state, save suggestion) | **+`writeBehavioralState`** UPDATE + map cột mới | read/save hiện có; `SqlClient` tiêm |
| `apps/cron-runner/src/tick.ts` | read state → pipeline → save suggestion (KHÔNG persist state) | **+applyMarketTick + writeBehavioralState** trước pipeline; dùng tickedState | soft-degrade/try-catch; save suggestion; TickResult shape |
| `supabase/migrations/…_live_tick.sql` | `behavioral_state` (không cột trading-day) | **migration mới**: +cột `trading_day_start_epoch_millis` + read-only grant | migration 3.1 (không sửa) |
| `math/decimal.ts` | `add` v.v. | **không sửa** — dùng `add` cho dailyLoss | precision một chỗ |

[Source: apps/cron-runner/src/tick.ts; packages/decision-core/types/index.ts, ports/persistence.ts; packages/adapters/postgres/index.ts; supabase/migrations/20260704031000_live_tick.sql]

### Invariant kiến trúc PHẢI tuân

- **AD-6 — một chủ sở hữu:** state đổi CHỈ qua `market-tick`/`trade-outcome`; một đường ghi (`writeBehavioralState`); UI/khác read-only. [Source: #AD-6]
- **AD-2 — thuần & tất định:** reducer + trading-day helper thuần (không `Date`/IO/random, integer/decimal); cùng event ⇒ cùng state (lint chặn). [Source: #AD-2]
- **AD-1 — bền, không RAM:** state ở Postgres, sống sót restart oneshot. [Source: #AD-1]
- **AD-7 — feedback (deferred 3.4):** `trade-outcome` reducer sẵn; nguồn (Binance read-only + user confirm) là 3.4. [Source: #AD-7]
- **AD-8 — audit (deferred 3.3):** ghi lịch sử event/state-change bất biến là 3.3; 3.2 chỉ cập nhật state hiện tại. [Source: #AD-8]
- **AD-4 — trading-day một định nghĩa:** `trading_day_boundary` từ config versioned; một helper duy nhất (không mỗi tầng tự chọn). [Source: #AD-4, #Consistency Conventions → Ranh giới "ngày"]

### Ngoài phạm vi story này (đừng làm — để story sau)

- **Nguồn `trade-outcome`** (Binance read-only probe vị thế/fill/PnL + user xác nhận fill↔Đề xuất) — **3.4** (AD-7). 3.2 chỉ reducer + persist apply (fixture).
- **Audit append-only** lịch sử event/state-change — **3.3** (AD-8). 3.2 cập nhật state "hiện tại", chưa ghi lịch sử bất biến.
- **Live-drift** (dùng chuỗi kết quả) — **3.5** (FR-10).
- **Override friction** — **3.6** (FR-12).
- **UI đọc state** (hiển thị streak/loss) — **epic 4**; 3.2 chỉ cấp read-only grant.
- **Optimistic concurrency nhiều tick song song** — cron `oneshot` ~1' một-instance ⇒ rủi ro thấp; nếu về sau nhiều writer, thêm version guard (không cần nay). Ghi chú.
- **Đếm lệnh lúc entry (max_trades chặn sớm)** — granularity 3.4; reducer mặc định đếm lúc outcome.

### Source tree mục tiêu (phần thêm/đổi)

```text
packages/decision-core/
  state/
    trading-day.ts        # NEW: tradingDayStart(now, boundary) thuần
    trading-day.test.ts   # NEW
    behavioral.ts         # NEW: applyMarketTick + applyTradeOutcome + TradeOutcomeEvent
    behavioral.test.ts    # NEW
    index.ts              # NEW: export *
  index.ts                # UPDATE: + export * from state
  types/index.ts          # UPDATE: BehavioralState +tradingDayStartEpochMillis?
  ports/persistence.ts    # UPDATE: +writeBehavioralState
packages/adapters/postgres/
  index.ts                # UPDATE: +writeBehavioralState + map cột mới
  index.test.ts           # UPDATE
apps/cron-runner/src/
  tick.ts                 # UPDATE: +applyMarketTick + writeBehavioralState (market-tick event)
  tick.test.ts            # UPDATE
supabase/migrations/
  <ts>_behavioral_state_owner.sql  # NEW: +cột trading-day-start + read-only grant
```
[Source: ARCHITECTURE-SPINE.md#Structural Seed; bố cục 3.1 làm khuôn]

### Project Structure Notes

- **`state/` là dir mới** trong decision-core (song song `tiers/`, `cost/`, `math/`). Reducer thuần, không import port/IO. `decision-core/index.ts` +`export *`.
- **`BehavioralState +tradingDayStartEpochMillis?` optional** ⇒ **không** phá fixture `ConfigParams`/`BehavioralState` cũ (runner.test/tier0/tier3 dựng state không có field này = undefined; `applyMarketTick` xử lý undefined = lần đầu, không reset). Tránh churn.
- **`readBehavioralState` trả kèm trading-day-start:** đọc từ cột mới; nếu cột null (hàng seed 3.1 trước migration) ⇒ `undefined` ⇒ lần đầu khởi tạo. Adapter map an toàn null→undefined.
- **`writeBehavioralState` là đường ghi DUY NHẤT** — kiểm code review: không nơi nào khác `update behavioral_state`. `saveSuggestion` (3.1) không đụng state. Feedback (3.4) cũng gọi `writeBehavioralState`.
- **Read-only grant**: enforce AD-6 ở DB. `apps/web` (epic 4) dùng anon/read-only key. Cron/feedback dùng service_role (đường ghi). Chi tiết role tuỳ Supabase setup — ghi chú ops, migration cấp grant tối thiểu.
- **`runTick` thứ tự mới**: readConfig → readState → **applyMarketTick → writeBehavioralState** → ingestion → pipeline(tickedState) → saveSuggestion. Giữ mọi soft-degrade/try-catch 3.1. Persist-state lỗi: mặc định log+tiếp (state tick này không lưu, tick sau tự sửa) — xem Cần xác nhận.

### Chuẩn test

- **Reducer thuần** (trọng tâm): số tính tay biên ngày; win/loss decimal; structuredClone (không mutate); 2× toEqual (tất định); typeof tiền `=== "string"`.
- **trading-day**: `"UTC 00:00"` now=`1_700_000_000_000` ⇒ start = mốc 00:00 UTC ngày chứa nó (tính tay); qua nửa đêm ⇒ start nhảy.
- **runTick wiring**: fake persistence ghi lại `writeBehavioralState` payload; biên ngày ⇒ payload có count=0/loss="0"; pipeline nhận tickedState (không state cũ). Save-state lỗi ⇒ tick vẫn tiếp (hoặc skipped — theo chốt).
- **postgres adapter**: `SqlClient` giả — `writeBehavioralState` phát UPDATE đúng cột/tham số; `readBehavioralState` map `trading_day_start_epoch_millis`→`tradingDayStartEpochMillis` (null→undefined).
- **Không đường ghi khác**: grep/khẳng định chỉ `writeBehavioralState` UPDATE `behavioral_state`.
- Không DB/mạng thật (fake `SqlClient`/ports).

### References

- [Source: epics.md → Epic 3, Story 3.2] — AC gốc (BDD): state chỉ đổi qua `market-tick`/`trade-outcome`; UI & khác chỉ đọc; sống sót restart edge function (không RAM)
- [Source: ARCHITECTURE-SPINE.md#AD-6] — một chủ sở hữu behavioral state; hai event; UI chỉ đọc; ngăn Tầng 0 veto sai
- [Source: ARCHITECTURE-SPINE.md#AD-2] — reducer thuần tất định (lint chặn Date/IO/random)
- [Source: ARCHITECTURE-SPINE.md#AD-1] — stateless serverless, state ở Postgres, không always-on/RAM
- [Source: ARCHITECTURE-SPINE.md#AD-7] — feedback loop (nguồn trade-outcome) — deferred 3.4
- [Source: ARCHITECTURE-SPINE.md#AD-4, #Consistency Conventions] — trading_day_boundary một định nghĩa (mặc định UTC 00:00), do state-owner; config versioned
- [Source: 1-6-tier0-behavioral-veto.md] — Tầng 0 chỉ ĐỌC; accumulation/reset/mutate cố ý HOÃN cho state-owner (chính story này); `cooldown` config-driven từ `lastLossEpochMillis`
- [Source: apps/cron-runner/src/tick.ts] — `runTick` 3.1 (read state → pipeline → save suggestion); điểm chèn market-tick + writeBehavioralState
- [Source: packages/decision-core/ports/persistence.ts] — `PersistencePort` để +`writeBehavioralState`
- [Source: packages/adapters/postgres/index.ts] — `createPostgresPersistence` (SqlClient tiêm) để +write + map cột
- [Source: supabase/migrations/20260704031000_live_tick.sql] — `behavioral_state` table 3.1 (id=1 một-hàng) để +cột trading-day-start + grant
- [Source: packages/decision-core/types/index.ts] — `BehavioralState` để +`tradingDayStartEpochMillis?`
- [Source: packages/config/src/schema.ts] — `trading_day_boundary` (validate 2 dạng) để helper tiêu thụ
- [Source: packages/decision-core/math/decimal.ts] — `add` cho `dailyLoss` (decimal một-nguồn)

## Cần xác nhận (không chặn draft)

- **`writeBehavioralState` (market-tick) lỗi ⇒ tick status nào?** Mặc định mình chọn **log + tiếp tục chạy pipeline** (state tick này không lưu; tick sau ~1' tự sửa vì reset là idempotent theo ngày). Phương án nghiêm: `{status:"skipped"}` (không quyết trên state chưa persist). Ảnh hưởng khi audit 3.3. Anh chốt giúp.
- **Đếm `tradeCountToday` lúc entry hay lúc outcome?** Mặc định outcome (lệnh đã đóng). Nếu muốn `max_trades_per_day` chặn ngay khi vào lệnh, cần event entry ở 3.4.

## Dev Agent Record

### Agent Model Used

Claude (deepseek-v4-pro)

### Debug Log References

### Completion Notes List

- **Task 1**: Created three pure reducer modules in `packages/decision-core/state/`:
  - `trading-day.ts`: `tradingDayStart(now, boundary)` — integer-ms day-boundary computation using `floor((now − offsetMs) / DAY_MS) × DAY_MS + offsetMs`. Supports both `"UTC HH:mm"` (absolute) and `"UTC±HH:mm"` (timezone-offset) formats with `∓` mapping. No `Date`, no IO.
  - `behavioral.ts`: `applyMarketTick` (day-crossing reset) and `applyTradeOutcome` (win/loss accumulation). Both pure — no mutation, deterministic. Uses `add()` from `math/decimal.ts`.
  - `index.ts`: barrel export.
  - Updated `BehavioralState` with optional `tradingDayStartEpochMillis?: number` (additive, backward-compatible).
  - Updated `decision-core/index.ts` to export the new `state` barrel.

- **Task 2**: Extended `PersistencePort` with `writeBehavioralState` (sole write path, AD-6). Updated postgres adapter:
  - `readBehavioralState` now selects `trading_day_start_epoch_millis` column; `mapBehavioralState` maps null→undefined safely.
  - `writeBehavioralState` issues parameterized `UPDATE behavioral_state SET ... WHERE id=1` with all 5 columns + `updated_at=now()`.
  - Adapter tests cover: correct UPDATE parameters, null mapping for undefined fields, DB error soft-degrade.

- **Task 3**: Wired market-tick into `runTick`:
  - After `readBehavioralState` → `applyMarketTick` → `writeBehavioralState` → then pipeline.
  - Pipeline receives `tickedState` (day-crossing-reset applied), not raw DB state.
  - Write failure is logged but tick continues (soft-degrade; next tick self-heals via idempotent reset).
  - Tests verify: day-crossing reset before pipeline, old state doesn't leak, write failure doesn't crash.

- **Task 4**: Created migration `20260705000000_behavioral_state_owner.sql`:
  - `ALTER TABLE behavioral_state ADD COLUMN IF NOT EXISTS trading_day_start_epoch_millis bigint`.
  - Read-only grants for `anon` + `authenticated` roles (SELECT only, revoke INSERT/UPDATE/DELETE).
  - Cron/feedback use service_role as sole write path (AD-6 enforcement at DB level).

- **Task 5**: Comprehensive test coverage:
  - `trading-day.test.ts`: 11 tests (UTC 00:00, UTC 07:00, UTC+07:00, deterministic, large epoch).
  - `behavioral.test.ts`: 13 tests (same-day no reset, day-crossing reset, first-tick init, purity, determinism, win/loss accumulation, decimal string types).
  - `tick.test.ts`: +5 tests (writeBehavioralState called with reset state, pipeline receives tickedState, write failure continues, old state not leaked).
  - `postgres/index.test.ts`: +3 tests (writeBehavioralState exact UPDATE params, undefined→null mapping, DB error handling).
  - All 287 tests pass; 0 regressions; `dist/` contains zero `*.test.*` files.

### File List

- `packages/decision-core/state/trading-day.ts` (NEW)
- `packages/decision-core/state/trading-day.test.ts` (NEW)
- `packages/decision-core/state/behavioral.ts` (NEW)
- `packages/decision-core/state/behavioral.test.ts` (NEW)
- `packages/decision-core/state/index.ts` (NEW)
- `packages/decision-core/types/index.ts` (MODIFIED — +tradingDayStartEpochMillis)
- `packages/decision-core/index.ts` (MODIFIED — +state export)
- `packages/decision-core/ports/persistence.ts` (MODIFIED — +writeBehavioralState)
- `packages/adapters/postgres/index.ts` (MODIFIED — +writeBehavioralState + map new column)
- `packages/adapters/postgres/index.test.ts` (MODIFIED — +3 tests)
- `apps/cron-runner/src/tick.ts` (MODIFIED — +applyMarketTick + writeBehavioralState)
- `apps/cron-runner/src/tick.test.ts` (MODIFIED — +5 tests + writeBehavioralState in fake persistence)
- `supabase/migrations/20260705000000_behavioral_state_owner.sql` (NEW)

## Change Log

- 2026-07-05: Story 3.2 implementation — pure reducers for behavioral state transitions, Postgres persistence with sole write path (AD-6), market-tick wiring into runTick, DB migration with trading-day column + read-only grant. All 287 tests pass, 0 regressions.
