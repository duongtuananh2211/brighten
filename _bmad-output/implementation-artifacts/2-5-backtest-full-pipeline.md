---
baseline_commit: cfae2a46e98a2ac6b5e1bf9e97fc672533fa2161
depends_on: 2-4-tier2-entry-zone
---

# Story 2.5: Backtest toàn pipeline 4 tầng

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **người dùng của Brighten**,
I want **`backtest-cli` chạy đủ Tầng 0→3 end-to-end trên cùng `decision-core` (real tier1 dispatcher + real tier2, KHÔNG còn stub, KHÔNG còn bơm candidate/edge từ fixtures), một Đề xuất chỉ sinh khi lọt cả 4 tầng, và pipeline tự surface quyết định (candidate + sizing) để driver mô phỏng đúng thứ nó quyết**,
so that **tôi đo được expectancy RÒNG của TOÀN pipeline (không phải từng mảnh), tái lập với cùng dữ liệu + config version, và không nơi nào cài lại luật quyết định (FR-8, AD-3, AD-5, AD-2, AD-4)**.

## Acceptance Criteria

**AC1 — Backtest chạy REAL 4 tầng; Đề xuất chỉ khi lọt Tầng 0→3 (AD-5)**
**Given** cả 4 tầng thật đã có trong core (Tầng 0 veto 1.6; Tầng 1 crypto 2.1 + FX 2.2 + dispatcher; Tầng 2 entry-zone 2.4; Tầng 3 sizing+cost-hurdle 1.4/1.5)
**When** chạy `backtest-cli` (`runBacktest`/`evaluateSegment`)
**Then** `defaultTiers()` = `[createTier0(), createTier1(assetClass), createTier2(), createTier3()]` (bỏ `createTier1Stub`/`createTier2Stub`); pipeline **tự** suy hướng (Tầng 1) → khoanh vùng (Tầng 2) → size + cost-hurdle (Tầng 3)
**And** một `EmittedTrade` chỉ sinh khi `runPipeline` trả `outcome: "suggestion"` (lọt cả 4 tầng); **bất kỳ** tầng veto ⇒ `silent` ⇒ **không** lệnh (im lặng) — không mảnh nào ép ra Đề xuất
**And** `assetClass: "crypto" | "fx"` do driver cấp (thêm vào `RunBacktestDeps`/seam) → `createTier1(assetClass)` (dispatcher 2.2); KHÔNG suy loại cặp trong lõi

**AC2 — Pipeline tự SURFACE quyết định; driver KHÔNG cài lại luật (AD-3)**
**Given** Tầng 2 enrich `candidate`, Tầng 3 tính `sizing`
**When** pipeline pass hết
**Then** Tầng 3 **enrich `sizing`** (SizingResult) vào ctx khi size thành công; `runPipeline` **surface** `direction`/`candidate`/`sizing` cuối cùng ra `PipelineResult` (thêm field optional, additive) khi `outcome: "suggestion"`
**And** `replay.ts` **đọc `result.sizing` từ pipeline** để dựng `EmittedTrade` — **bỏ** `deriveSizing`/`estimateCost` (đang **re-implement** luật Tầng 3 trong driver) ⇒ driver chỉ *chạy pipeline + ghi kết quả*, không cài lại quyết định (AD-3)
**And** khi `outcome: "silent"` ⇒ không đọc sizing, không emit

**AC3 — Bỏ bơm candidate/edge từ fixtures; state/account vẫn qua seam (chưa có feedback loop)**
**Given** `BacktestSignal` hiện bơm `candidate?`/`expectedEdge?`/`state?`/`account?` per tick
**When** chuyển sang pipeline-sinh
**Then** **bỏ** `candidate`/`expectedEdge` khỏi `BacktestSignal` (Tầng 1/2 sinh chúng trong pipeline giờ); **giữ** `state`/`account` override per-tick (behavioral feedback loop AD-7 + balance feed chưa có tới epic 3 ⇒ vẫn bơm qua seam)
**And** cập nhật fixtures/test-support để cấp `MarketSnapshot` **đủ dữ liệu** (klines + funding/OI/lsr cho crypto, hoặc klines cho FX) để tier1/tier2 thật sinh được hướng/vùng — không còn candidate ma
**And** ranh giới rõ: `state`/`account` seam là **tạm quyền tới khi feedback loop (AD-7) + balance feed có** (epic 3), KHÔNG phải nợ của story này

**AC4 — Báo cáo expectancy RÒNG + drawdown + R-distribution cho TOÀN pipeline**
**Given** các trade `EmittedTrade` do pipeline thật sinh
**When** `simulate` → `computeMetrics` chạy (đã có, 1.8)
**Then** `BacktestRun.metrics` báo cáo **expectancy ròng** (net R, đã trừ chi phí thật fee+spread+slippage+funding — `simulate.ts` 1.8), **maxDrawdown**, **rDistribution**, **equityCurve** cho **toàn pipeline 4 tầng** (không phải mảnh); `winRateReference` chỉ tham chiếu (không headline)
**And** metrics engine (`metrics.ts`/`simulate.ts`) **không đổi luật** — chỉ nhận trade pipeline-thật thay vì fixture; expectancy giờ phản ánh gating thật của cả 4 tầng

**AC5 — Tái lập: cùng dữ liệu + config version → cùng BacktestRun (AD-4, AD-2)**
**Given** cùng `MarketSnapshot` + cùng `ConfigSnapshot` (version cố định) + cùng `state`/`account` seam
**When** chạy `runBacktest` nhiều lần
**Then** `BacktestRun` **bằng nhau tuyệt đối** (deep-equal): metrics, equityCurve, trades — không ngẫu nhiên, không `Date.now()` (fixedClock từ `kline.openTime`), decimal precision một-nguồn
**And** `BacktestRun.configSnapshot` nhúng snapshot đã dùng (AD-4) + `snapshotSchemaVersion` ⇒ tái dựng chính xác; đổi 1 param (config version mới) ⇒ kết quả đổi tương ứng (chứng minh version gắn kết quả)

**AC6 — Tầng 3 self-contained: cost-hurdle chạy TRONG pipeline (không bơm edge/cost ngoài)**
**Given** cost-hurdle (FR-11, 1.5) hiện đọc `ctx.expectedEdge`/`ctx.cost` bơm-ngoài
**When** pipeline chạy end-to-end
**Then** Tầng 3 **tự suy** `expectedEdge` + `cost` từ candidate + account + config: `expectedEdge = |target − entry| × volume` (quote units), `cost = computeRoundTripCost({ notional: volume×entry, feeRate, spread, slippage })` (quote units — cùng đơn vị, 1.5/1.8) rồi áp `evaluateCostHurdle` ⇒ cost-hurdle **thật sự gate** trong pipeline
**And** **backward-compat**: nếu `ctx.expectedEdge`/`ctx.cost` được cấp (test 1.5 hiện tại) ⇒ **ưu tiên dùng** (override); nếu vắng ⇒ **tự suy** từ candidate/account/config. Test 1.5 (bơm edge/cost) vẫn xanh; test mới phủ nhánh tự-suy
**And** funding trong cost-hurdle **entry-time** = 0 (funding chỉ biết sau fill — như `estimateCost` cũ ghi chú); realized funding tính ở `simulate` (exit-time, đã có)

**AC7 — Test phủ từng AC + toolchain sạch**
**Given** Vitest (nền backtest-cli epic 1 + tiers 2.1–2.4)
**When** thêm/sửa test cho real-tier wiring + surface decision + reconcile replay + cost-hurdle self-contained
**Then** có test cho: `defaultTiers()` là real 4 tầng; pipeline emit chỉ khi lọt cả 4 (mỗi tầng veto → 0 trade: Tầng 0 cooldown, Tầng 1 no-direction, Tầng 2 no-setup, Tầng 3 rr/cost-hurdle); `replay` đọc sizing pipeline-surface (không `deriveSizing`); `BacktestSignal` không còn candidate/edge (typecheck); cost-hurdle tự-suy gate đúng (edge < x×fee ⇒ veto) + override 1.5 vẫn xanh; expectancy ròng số tính tay cho 1 fixture nhỏ đi hết pipeline; **tái lập** (2× `runBacktest` `toEqual`); đổi config version ⇒ metrics đổi; determinism/không leak number
**And** `pnpm -r typecheck && pnpm -r build && pnpm -r lint && pnpm -r test` **tất cả pass** (gồm `apps/backtest-cli`); `*.test.ts` KHÔNG lọt `dist/`

## Tasks / Subtasks

- [x] **Task 1 — Tầng 3 tự suy expectedEdge + cost; cost-hurdle gate trong pipeline (AC: #6)**
  - [x] `packages/decision-core/tiers/tier3/index.ts`: sau `sizeTrade` thành công, tính nếu `ctx.expectedEdge`/`ctx.cost` **vắng**:
    - `expectedEdge = mul(abs(sub(result.target, result.entry)), result.volume)` (quote units; dùng `math/decimal.ts`)
    - `cost = computeRoundTripCost({ notional: mul(result.volume, result.entry), feeRate: params.fee_rate, spread: params.spread, slippage: params.slippage })` ⇒ `roundTripFee = cost.cost` (funding entry-time bỏ trống = 0)
    - `evaluateCostHurdle({ expectedEdge, roundTripFee, costHurdleX: params.cost_hurdle_x })`
  - [x] **Override/backward-compat:** nếu `ctx.expectedEdge !== undefined && ctx.cost !== undefined` ⇒ dùng chúng (giữ nhánh 1.5 hiện tại). Chỉ khi vắng mới tự suy. Giữ nhánh "thiếu candidate/account ⇒ pass" nguyên
  - [x] Tầng 3 **enrich `sizing`** (SizingResult) khi pass: `{ kind: "pass", enrich: { sizing: result } }` (mở rộng `TierPassEnrichment` — Task 2). Import `computeRoundTripCost`/`abs`/`mul`/`sub`
  - [x] `packages/decision-core/tiers/tier3/index.test.ts`: **UPDATE** — giữ test bơm edge/cost (override) xanh; thêm test **tự suy**: candidate+account, no edge/cost ⇒ cost-hurdle gate từ giá trị suy (số tính tay: edge `|target−entry|×volume` vs `cost_hurdle_x × roundTripFee`); pass ⇒ `enrich.sizing` đúng

- [x] **Task 2 — Surface quyết định từ `runPipeline` (AC: #2)**
  - [x] `packages/decision-core/pipeline/runner.ts`:
    - Mở rộng `TierPassEnrichment` (2.4) thêm `readonly sizing?: SizingResult` (import `SizingResult` từ `../tiers/tier3/sizing.js` — hoặc re-export type; kiểm không tạo vòng import: `runner.ts` ↔ `tier3` — nếu vòng, đặt `SizingResult` type ở nơi trung lập `types` hoặc dùng structural type. **Khuyến nghị**: import type-only `SizingResult` từ sizing (type-only import không tạo vòng runtime))
    - `PipelineResult` thêm optional (additive): `readonly direction?: TradeDirection; readonly candidate?: TradeCandidate; readonly sizing?: SizingResult`
    - Khi `outcome: "suggestion"` ⇒ điền `direction`/`candidate`/`sizing` từ `ctx` cuối (đã merge enrich); `outcome: "silent"` ⇒ để trống
  - [x] **KHÔNG** đổi chữ ký `runPipeline`, `PipelineBaseContext`, nhánh veto. `apps/cron-runner/health` chỉ dùng `PipelineResult` type với field cũ ⇒ additive an toàn (grep xác nhận)
  - [x] `packages/decision-core/pipeline/runner.test.ts`: **UPDATE** — pipeline pass hết (tier enrich direction+candidate+sizing) ⇒ `result.sizing`/`candidate`/`direction` đúng; silent ⇒ trống

- [x] **Task 3 — Wire real tiers vào `defaultTiers()` + assetClass (AC: #1)**
  - [x] `apps/backtest-cli/src/run.ts`: `defaultTiers(assetClass)` = `[createTier0(), createTier1(assetClass), createTier2(), createTier3()]` (import `createTier1`/`createTier2` thay `createTier1Stub`/`createTier2Stub`)
  - [x] `RunBacktestDeps` + `evaluateSegment`/`runBacktest`: thêm `assetClass: "crypto" | "fx"` (truyền xuống `defaultTiers`). `tiers?` override vẫn cho test inject
  - [x] Cập nhật `run.test.ts`/callers cấp `assetClass`

- [x] **Task 4 — Reconcile `replay.ts`: đọc sizing pipeline-surface, bỏ re-implement (AC: #2, #3)**
  - [x] `apps/backtest-cli/src/replay.ts`:
    - Bỏ `deriveSizing`/`estimateCost` (re-implement Tầng 3)
    - `base` chỉ còn `{ input: windowAt(...), state, config, ...(account?{account}:{}) }` — **bỏ** bơm `candidate`/`expectedEdge`/`cost`
    - Sau `runPipeline`: `if (result.outcome === "suggestion" && result.sizing) emitted.push({ entryTickIndex, entryEpochMillis, sizing: result.sizing })`
  - [x] `apps/backtest-cli/src/types.ts`: `BacktestSignal` bỏ `candidate?`/`expectedEdge?`; giữ `tickIndex`/`state?`/`account?`. `EmittedTrade` giữ nguyên (`sizing: SizingResult`)
  - [x] `apps/backtest-cli/src/replay.test.ts`: **UPDATE** — bỏ fixture candidate; cấp `MarketSnapshot` đủ dữ liệu để tier1/tier2 sinh; assert emit chỉ khi pipeline suggestion

- [x] **Task 5 — Fixtures/test-support đủ dữ liệu cho real tiers (AC: #3, #7)**
  - [x] `apps/backtest-cli/src/test-support.ts`: thêm helper dựng `MarketSnapshot` crypto đủ `klines`+`funding`+`openInterest`+`longShortRatio` (ép Tầng 1 crypto ra hướng) và/hoặc FX klines (ép Tầng 1 FX sweep) + đủ dài cho `tier1_min_data_points`/`fx_swing_lookback`/`tier2_swing_lookback`. Dùng `{ ...DEFAULT_PARAMS, ...overrides }` (đã có) ⇒ config tự đủ param 2.1–2.4
  - [x] Đảm bảo fixture đi hết pipeline: Tầng 0 pass (state sạch), Tầng 1 ra hướng, Tầng 2 ra vùng, Tầng 3 size + cost-hurdle pass ⇒ ≥ 1 trade để metrics khác rỗng
  - [x] Fixture "mỗi tầng veto" cho AC1 test: state cooldown (T0), snapshot mâu thuẫn (T1 no-direction), giá cạn move (T2 no-setup), RR thấp/edge<cost (T3)

- [x] **Task 6 — Tests end-to-end (AC: #1, #4, #5, #7)**
  - [x] `apps/backtest-cli/src/run.test.ts` (hoặc mới `full-pipeline.test.ts`): **UPDATE/NEW** — real `defaultTiers`: fixture-tốt ⇒ ≥1 trade, metrics net hợp lý (expectancy số tính tay 1 trade nhỏ); mỗi fixture-veto ⇒ 0 trade (4 case); **tái lập** 2× `runBacktest` `toEqual`; đổi 1 param (`min_rr` cao) ⇒ trade↓/metrics đổi (config version gắn kết quả)
  - [x] `packages/decision-core/tiers/tier3/index.test.ts` (Task 1) + `pipeline/runner.test.ts` (Task 2) đã phủ core
  - [x] `pnpm -r test` (gồm apps/backtest-cli) pass; `dist/` không chứa `*.test.*`

## Dev Notes

> **Bối cảnh:** Story 2.5 **khép Epic 2** — biến `backtest-cli` từ "chạy pipeline với **stub** tier1/2 + **bơm candidate ma** từ fixtures" thành "chạy **REAL 4 tầng** end-to-end, pipeline **tự** quyết". Đây là lúc **thu nợ kỹ thuật** mà epic 1 cố ý tạo: `replay.ts` hiện có `deriveSizing`/`estimateCost` **re-implement luật Tầng 3** trong driver (chấp nhận được khi tier2 còn stub); 2.5 **bỏ** chúng bằng cách để pipeline **surface** quyết định. Kết quả: driver chỉ *chạy engine + ghi*, đúng AD-3 ("cấm cài lại luật quyết định trong driver"). Metrics/simulate (1.8) + walk-forward/anti-overfit (1.9) **không đổi** — chỉ nhận trade pipeline-thật.

> **Phụ thuộc:** build trên **toàn bộ 2.1→2.4** (tier1 crypto/FX + dispatcher, tier2, seam enrich `direction`/`candidate`). 2.4 đã thêm `enrich?`/`direction?`; 2.5 mở rộng `enrich.sizing` + surface ra `PipelineResult`. [Source: 2-4…md → seam; 2-1/2-2 → dispatcher `createTier1`]

### 🔑 Ba thay đổi cốt lõi — vì sao & tối thiểu

1. **Tầng 3 self-contained cost-hurdle (AC6):** để "lọt Tầng 3" là **thật**, cost-hurdle (FR-11) phải gate trong pipeline. Trước đây `ctx.expectedEdge`/`ctx.cost` bơm-ngoài (1.5) vì chưa có candidate thật. Nay có candidate (Tầng 2) + account ⇒ Tầng 3 tự suy `expectedEdge=|target−entry|×volume` và `cost=computeRoundTripCost(notional)` (cùng đơn vị quote — xác nhận `round-trip.ts`/`cost-hurdle.ts`). **Giữ override** khi ctx cấp sẵn ⇒ **test 1.5 xanh nguyên**. [Source: packages/decision-core/cost/round-trip.ts (quote units); tiers/tier3/cost-hurdle.ts]
2. **Surface quyết định (AC2):** Tầng 3 enrich `sizing`; `runPipeline` đưa `sizing`/`candidate`/`direction` ra `PipelineResult` (additive). Driver đọc `result.sizing` ⇒ **không** re-derive. Đây là cách bỏ `deriveSizing` mà vẫn dùng **đúng** sizing pipeline đã quyết (không lệch). [Source: apps/backtest-cli/src/replay.ts#deriveSizing (re-implement smell)]
3. **Bỏ candidate ma (AC3):** `BacktestSignal.candidate/expectedEdge` biến mất; pipeline sinh. `state`/`account` **giữ** (feedback loop AD-7 + balance feed = epic 3). Fixtures phải cấp `MarketSnapshot` đủ dữ liệu để tier thật chạy. [Source: apps/backtest-cli/src/types.ts, test-support.ts]

### Vì sao cost-hurdle entry-time funding = 0 (đừng nhầm với simulate)

- `evaluateCostHurdle` (Tầng 3, **entry-time**) ước tính rào chi phí **trước fill** — funding chưa biết ⇒ `computeRoundTripCost` **bỏ `fundingPoints`** (=0), y hệt `estimateCost` cũ trong `replay.ts`. **Realized** funding (giữ vị thế qua cửa sổ) tính ở `simulate.ts` (**exit-time**, đã có, giữ funding thật). Hai chỗ, hai thời điểm — KHÔNG gộp. [Source: apps/backtest-cli/src/replay.ts#estimateCost (comment), simulate.ts#simulateOne]

### Hợp đồng đã có (PHẢI tuân, đọc trước khi sửa)

| File | Trạng thái | Story 2.5 đổi gì | Phải giữ nguyên |
| --- | --- | --- | --- |
| `packages/decision-core/pipeline/runner.ts` | `TierPassEnrichment{direction?,candidate?}` (2.4); `PipelineResult{outcome,vetoedBy?,reason?,suggestion?}` | **+`sizing?`** vào enrich; **+`direction?/candidate?/sizing?`** vào `PipelineResult` (additive); điền khi suggestion | chữ ký `runPipeline`; nhánh veto; `suggestion` stub; merge enrich (2.4) |
| `packages/decision-core/tiers/tier3/index.ts` | size → (nếu ctx edge+cost) cost-hurdle; pass/veto | **tự suy edge+cost khi ctx vắng**; **enrich sizing** khi pass | thứ tự winStreak→size→cost-hurdle; nhánh thiếu candidate/account→pass; override khi ctx cấp; `sizeTrade`/`evaluateCostHurdle` không đổi |
| `apps/backtest-cli/src/run.ts` | `defaultTiers()` stub tier1/2 | real tiers + `assetClass` | `evaluateSegment`/`runBacktest` orchestration; `tiers?` override |
| `apps/backtest-cli/src/replay.ts` | bơm candidate + `deriveSizing`/`estimateCost` | **bỏ** chúng; đọc `result.sizing`; base bỏ candidate/edge/cost | `windowAt`; vòng lặp tick; `state`/`account` seam |
| `apps/backtest-cli/src/types.ts` | `BacktestSignal{candidate?,expectedEdge?,state?,account?}` | **bỏ** candidate/expectedEdge | `EmittedTrade`/`SimulatedTrade`/`BacktestMetrics`/`BacktestRun`; walk-forward types |
| `apps/backtest-cli/src/simulate.ts`, `metrics.ts` | net R + expectancy/drawdown/R-dist (1.8) | **KHÔNG sửa** (nhận trade pipeline-thật) | toàn bộ |
| `apps/backtest-cli/src/validate.ts`, `walk-forward.ts` (1.9) | anti-overfit dùng `evaluateSegment(...,tiers)` | truyền `assetClass`/tiers thật nếu cần | luật walk-forward/CI/param-cap |
| `apps/cron-runner/functions/health` | `PipelineResult` type (field cũ) | **KHÔNG sửa** (additive an toàn) | — |

[Source: packages/decision-core/pipeline/runner.ts; tiers/tier3/index.ts; apps/backtest-cli/src/run.ts, replay.ts, types.ts, simulate.ts, metrics.ts, validate.ts]

### Invariant kiến trúc PHẢI tuân

- **AD-3 — một engine, hai driver; cấm cài lại luật trong driver:** bỏ `deriveSizing`/`estimateCost`; driver đọc quyết định pipeline-surface. Live (epic 3) + backtest import **cùng** `decision-core`. [Source: #AD-3]
- **AD-5 — thứ tự gating & im lặng:** Đề xuất chỉ khi lọt Tầng 0→3; bất kỳ tầng veto ⇒ silent ⇒ 0 trade. [Source: #AD-5]
- **AD-2 — thuần & tất định:** fixedClock (`kline.openTime`), decimal một-nguồn ⇒ cùng input → cùng `BacktestRun` (NFR-6). [Source: #AD-2]
- **AD-4 — config snapshot gắn kết quả:** `BacktestRun.configSnapshot` + `snapshotSchemaVersion` nhúng; đổi param ⇒ version mới ⇒ kết quả đổi, tái dựng được. [Source: #AD-4]
- **AD-12 — suy diễn trong lõi:** tier1/tier2 tính hướng/vùng trong core ⇒ backtest = live. [Source: #AD-12]

### Ngoài phạm vi story này (đừng làm — để story sau)

- **Live driver `cron-runner` chạy real pipeline + feedback loop (AD-7) + balance feed** — **epic 3**. 2.5 chỉ backtest offline. `state`/`account` vẫn qua seam.
- **Persist `BacktestRun`/Đề xuất/audit vào Postgres (AD-8)** — cần persistence adapter (epic 3). `BacktestRun` đã "self-contained, ready to persist" (types.ts) nhưng KHÔNG persist ở đây.
- **LLM narrator / UI hiển thị** — FR-7/FR-13, epic sau.
- **Đổi luật tier nào** — 2.1–2.4 đã chốt; 2.5 chỉ **wire** + surface + reconcile driver. KHÔNG đổi `evaluate*Regime`/`evaluateEntryZone`/`sizeTrade`/`evaluateCostHurdle`.
- **Walk-forward/anti-overfit (1.9)** — đã có; 2.5 chỉ đảm bảo nó chạy trên real tiers (truyền tiers/assetClass), không đổi luật CI/param-cap.
- **`expectedEdge` tinh vi hơn** (vd theo xác suất thắng) — 2.5 dùng `|target−entry|×volume` (gross edge danh nghĩa); mô hình edge kỳ vọng nâng cao là v2.

### Source tree mục tiêu (phần thêm/đổi)

```text
packages/decision-core/
  pipeline/runner.ts                 # UPDATE: +enrich.sizing? + PipelineResult{direction?,candidate?,sizing?}
  pipeline/runner.test.ts            # UPDATE: surface decision
  tiers/tier3/index.ts               # UPDATE: tự suy edge+cost (fallback) + enrich sizing
  tiers/tier3/index.test.ts          # UPDATE: nhánh tự-suy + override 1.5 + enrich.sizing
apps/backtest-cli/src/
  run.ts                             # UPDATE: defaultTiers(assetClass) real; RunBacktestDeps.assetClass
  replay.ts                          # UPDATE: bỏ deriveSizing/estimateCost; đọc result.sizing; base gọn
  types.ts                           # UPDATE: BacktestSignal bỏ candidate/expectedEdge
  test-support.ts                    # UPDATE: fixtures MarketSnapshot đủ dữ liệu cho real tiers
  replay.test.ts, run.test.ts        # UPDATE: real tiers, 4 case veto, tái lập, config-version
  (validate.ts/walk-forward nếu cần) # UPDATE: truyền assetClass/tiers thật
```
[Source: apps/backtest-cli/src cấu trúc hiện có; ARCHITECTURE-SPINE.md#Structural Seed]

### Project Structure Notes

- **Vòng import** cần tránh: `runner.ts` import `SizingResult` từ `tiers/tier3/sizing.ts`, còn `tier3/index.ts` import `Tier` từ `runner.ts`. Dùng **type-only import** (`import type { SizingResult }`) ⇒ không vòng runtime; nếu bundler/tsc vẫn cảnh báo, chuyển `SizingResult` type sang `types/index.ts` (nơi trung lập). Ưu tiên type-only trước.
- `assetClass` là seam driver — KHÔNG vào `MarketSnapshot`/lõi (2.2 đã chốt). Driver biết cặp nào crypto/fx.
- Fixtures là phần **nặng nhất** của story: phải dựng snapshot khiến 4 tầng thật đi lọt (hoặc chặn đúng tầng). Ưu tiên số nhỏ, kline ít, tính tay expectancy 1 trade. Tái dùng cách dựng snapshot của `crypto-regime.test.ts`/`fx-regime.test.ts`/`entry-zone.test.ts` (2.1/2.2/2.4).
- `apps/backtest-cli` dùng `{ ...DEFAULT_PARAMS }` (test-support) ⇒ param 2.1–2.4 tự đủ; **không** cần thêm config.
- Kiểm `validate.ts`/`walk-forward.ts` (1.9) gọi `evaluateSegment` — nay cần `assetClass`; truyền xuống hoặc default. Đảm bảo test 1.9 vẫn xanh (có thể cần inject `tiers` giả hoặc assetClass).

### Chuẩn test

- **Gating end-to-end (AC1):** 1 fixture đi lọt cả 4 ⇒ ≥1 trade; 4 fixture mỗi cái chặn 1 tầng ⇒ 0 trade (Tầng0 cooldown; Tầng1 mâu thuẫn/no-direction; Tầng2 move-cạn/no-setup; Tầng3 rr_below_min hoặc cost-hurdle edge<x×fee).
- **Surface (AC2):** `runPipeline` suggestion ⇒ `result.sizing`/`candidate`/`direction` khớp; `replay` emit từ `result.sizing` (không gọi `deriveSizing` — đã xoá).
- **Cost-hurdle tự-suy (AC6):** candidate cho `expectedEdge` tính tay < `cost_hurdle_x × roundTripFee` ⇒ Tầng 3 veto `cost_hurdle_not_met`; ≥ ⇒ pass. Test override (ctx cấp edge/cost) vẫn xanh (1.5).
- **Tái lập (AC5):** 2× `runBacktest` cùng input ⇒ `toEqual` (metrics+trades+equityCurve). Đổi `min_rr`/`cost_hurdle_x` ⇒ kết quả đổi.
- **Expectancy ròng:** 1 trade fixture, tính tay grossR − realizedCost/riskAmount ⇒ khớp `metrics.expectancy`.
- **Determinism/không leak number:** field tiền `typeof === "string"`; không `Date.now()`.
- **Backtest tests hiện có (slice/walk-forward/param-cap/eligibility/metrics/simulate)** vẫn xanh sau đổi seam (chú ý `BacktestSignal` shape đổi).

### References

- [Source: epics.md → Epic 2, Story 2.5] — AC gốc (BDD): Đề xuất chỉ khi lọt Tầng 0→3, tầng chặn → im lặng; báo cáo expectancy ròng + drawdown + R-distribution toàn pipeline; tái lập cùng dữ liệu + config version
- [Source: prd.md#FR-8] — backtest trên cùng engine; [Source: prd.md#FR-11] — cost hurdle gate; [Source: prd.md#NFR-1/NFR-6] — tất định/tái lập
- [Source: ARCHITECTURE-SPINE.md#AD-3] — một engine hai driver, cấm cài lại luật trong driver
- [Source: ARCHITECTURE-SPINE.md#AD-5] — thứ tự gating 0→3, im lặng khi veto
- [Source: ARCHITECTURE-SPINE.md#AD-2, #AD-4, #AD-12] — tất định; config snapshot gắn kết quả; suy diễn trong lõi
- [Source: SOLUTION-DESIGN.md §6] — thứ tự build: sau tier1/tier2 là "backtest toàn pipeline"
- [Source: packages/decision-core/pipeline/runner.ts] — `TierPassEnrichment`(2.4)/`PipelineResult`/`runPipeline` điểm surface
- [Source: packages/decision-core/tiers/tier3/index.ts] — thứ tự winStreak→size→cost-hurdle; điểm tự-suy edge/cost + enrich sizing
- [Source: packages/decision-core/tiers/tier3/cost-hurdle.ts] — `evaluateCostHurdle(expectedEdge, roundTripFee, costHurdleX)` (quote units)
- [Source: packages/decision-core/cost/round-trip.ts] — `computeRoundTripCost` (quote units; funding optional) — dùng chung entry-time (edge) & exit-time (simulate)
- [Source: apps/backtest-cli/src/replay.ts] — `deriveSizing`/`estimateCost` (re-implement smell 2.5 gỡ); `windowAt`; `state`/`account` seam
- [Source: apps/backtest-cli/src/run.ts] — `defaultTiers()`/`evaluateSegment`/`runBacktest`; điểm wire real tiers + assetClass
- [Source: apps/backtest-cli/src/types.ts] — `BacktestSignal`(bỏ candidate/edge)/`EmittedTrade`/`BacktestMetrics`/`BacktestRun`
- [Source: apps/backtest-cli/src/simulate.ts, metrics.ts] — net R + expectancy/drawdown/R-dist (không đổi)
- [Source: 2-4…md] — seam enrich `direction`/`candidate` + ranh giới "reconcile replay.ts là 2.5"
- [Source: 2-1…md, 2-2…md] — `createTier1` dispatcher(assetClass); tier1 crypto/FX enrich direction

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- `pnpm --filter @brighten/decision-core test -- --run pipeline/runner.test.ts tiers/tier3/index.test.ts`
- `pnpm --filter @brighten/backtest-cli test`
- `pnpm -r typecheck`
- `pnpm -r build`
- `pnpm -r lint`
- `pnpm -r test`
- `find packages apps -path '*/dist/*' \( -name '*.test.js' -o -name '*.test.d.ts' -o -name '*.test.js.map' -o -name '*.test.d.ts.map' \) -print`

### Completion Notes List

- Tầng 3 giờ tự suy `expectedEdge` và round-trip cost từ sizing khi ctx không bơm override, vẫn ưu tiên `ctx.expectedEdge`/`ctx.cost` nếu được cấp để giữ backward compatibility.
- `runPipeline` merge và surface `direction`, `candidate`, `sizing` trên `PipelineResult` khi suggestion; silent outcomes không surface decision.
- `backtest-cli` dùng real `[createTier0(), createTier1(assetClass), createTier2(), createTier3()]`, bỏ `deriveSizing`/`estimateCost`, và `BacktestSignal` không còn `candidate`/`expectedEdge`.
- Fixtures/test mới phủ real FX full-pipeline pass, T0/T1/T2/T3 veto không emit, determinism, net expectancy, config-version result change, và validation seam tương thích assetClass.
- Full DoD pass: `pnpm -r typecheck`, `pnpm -r build`, `pnpm -r lint`, `pnpm -r test`; đã xoá và xác nhận không còn `*.test.*` trong `dist/`.

### File List

- apps/backtest-cli/src/main.ts
- apps/backtest-cli/src/replay.test.ts
- apps/backtest-cli/src/replay.ts
- apps/backtest-cli/src/run.test.ts
- apps/backtest-cli/src/run.ts
- apps/backtest-cli/src/slice.test.ts
- apps/backtest-cli/src/test-support.ts
- apps/backtest-cli/src/types.ts
- apps/backtest-cli/src/validate.test.ts
- apps/backtest-cli/src/validate.ts
- packages/decision-core/pipeline/runner.test.ts
- packages/decision-core/pipeline/runner.ts
- packages/decision-core/tiers/tier3/index.test.ts
- packages/decision-core/tiers/tier3/index.ts

### Change Log

- 2026-07-04: Implemented Story 2.5 full backtest pipeline wiring, pipeline decision surfacing, self-contained Tier 3 cost-hurdle, real-tier backtest fixtures/tests, and validation updates.
