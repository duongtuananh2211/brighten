---
baseline_commit: bd489f4a1902a89f12d6c1f45fd33ead36a87e91
---

# Story 1.9: Kỷ luật chống overfit (FR-9)

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **người dùng (solo trader) của Brighten**,
I want **`backtest-cli` bọc engine 1.8 bằng một QUY TRÌNH XÁC THỰC NGOÀI MẪU tất định — walk-forward (chia dải dữ liệu thành nhiều fold in-sample/out-of-sample), một khối holdout KHÔNG bao giờ được tối ưu trên đó, khoảng tin cậy của expectancy qua Monte-Carlo/xáo thứ tự lệnh (không chỉ một con số), một chế độ forward paper-trade (đánh dấu, không vốn thật) làm cổng trước khi cho phép live, và một trần số tham số điều chỉnh-được bị chặn theo config — tất cả 100% tái lập với cùng dữ liệu + cùng config version + cùng seed**,
so that **con số expectancy tôi thấy KHÔNG phải ảo do overfit: nó được đo trên dữ liệu lõi chưa từng "nhìn thấy", kèm biên độ bất định trung thực, và không setup nào được lên live khi chưa qua kỷ luật này (FR-9, AD-3 một-engine-hai-driver, AD-4 versioned snapshot, NFR-1 tái lập)**.

## Acceptance Criteria

> **Biên phạm vi epic 1 (đã chốt, kế thừa 1.8):** Tầng 1 (edge) và Tầng 2 (candidate/price-action) **còn stub** ⇒ pipeline chưa tự sinh lệnh, và **CHƯA có bộ tối ưu tham số** (parameter search) trong epic 1. Vì thế Story 1.9 dựng **BỘ KHUNG kỷ luật chống overfit** (walk-forward splitter + holdout guard + Monte-Carlo CI + paper-trade gate + param-cap) chạy trên **cùng seam `BacktestStrategyInput`** (fixture epic 1) và **tái dùng nguyên engine 1.8** (`runBacktest`/`replay`/`simulate`/`computeMetrics`) — **KHÔNG** sửa engine, **KHÔNG** cài bộ tối ưu thật (đó là epic 2), **KHÔNG** cài luật quyết định trong driver (AD-3). Bộ khung sẵn sàng đo ngay khi optimizer + edge/candidate thật land ở epic 2.

**AC1 — Walk-forward splitter tất định, thuần (FR-9 walk-forward)**
**Given** một `MarketSnapshot` (klines đã sắp theo `openTime`, từ adapter 1.7) + một `WalkForwardSpec` (`folds`, `inSampleRatio`, `holdoutRatio`)
**When** gọi `splitWalkForward(snapshot, spec)` (hàm **thuần** trong driver)
**Then** trả một cấu trúc gồm: (a) một **khối holdout** cuối dải = `holdoutRatio` số kline sau cùng, tách hẳn; (b) `folds` fold **không chồng khối holdout**, mỗi fold có `inSample` + `outOfSample` là các **khoảng chỉ số kline liền kề, tất định**; ranh giới tính bằng số học nguyên (không `Math.random`, không `Date.now`)
**And** MỌI fold + holdout là các khoảng chỉ số **[fromIndex, toIndex)** trên CÙNG mảng klines; hàm **không mutate** snapshot; dữ liệu holdout **không xuất hiện** trong bất kỳ `inSample` nào (bất biến kiểm được bằng test)
**And** input rác (fold ≤ 0, ratio ngoài (0,1), tổng ratio ≥ 1, klines quá ít để chia) ⇒ rejection `{ code, source: "validation.walk_forward", context }`

**AC2 — Đánh giá out-of-sample + holdout qua CÙNG engine 1.8 (AD-3 tái dùng, không tối ưu holdout)**
**Given** các fold + holdout từ AC1, cùng `BacktestStrategyInput` + `ConfigSnapshot`
**When** chạy xác thực
**Then** với mỗi **out-of-sample** segment và **holdout** segment, engine cắt sub-snapshot (`sliceSnapshot`) + re-index seam (`reindexStrategyInput`) rồi gọi **CÙNG** `replay → simulate → computeMetrics` của 1.8 (KHÔNG cài lại) — thu `BacktestMetrics` cho từng segment
**And** holdout được đánh giá **đúng một lần** như một segment tách biệt và **không bao giờ** nằm trong đường "tối ưu" (epic 1 chưa có optimizer, nên bất biến này là **structural**: holdout indices rời khỏi mọi in-sample; test chứng minh)
**And** `in-sample` segment chỉ để chỗ cho optimizer epic 2 — 1.9 **có thể** đo metrics in-sample để so sánh (tuỳ chọn) nhưng **không** dùng nó điều chỉnh tham số

**AC3 — Khoảng tin cậy expectancy qua Monte-Carlo / xáo thứ tự lệnh (FR-9 CI, tất định seed)**
**Given** chuỗi `netR` (bội số R ròng) của các lệnh mô phỏng trên out-of-sample (gộp các fold) hoặc holdout
**When** gọi `bootstrapExpectancyCI(netRs, { resamples, seed })` (hàm **thuần** trong driver)
**Then** dùng một **PRNG seed cố định** (vd mulberry32 — thuần, tái lập; **KHÔNG** `Math.random`) để resample (bootstrap có hoàn lại **hoặc** xáo thứ tự lệnh) `resamples` lần, tính expectancy mỗi lần, trả `{ lower, median, upper, resamples, seed }` (percentile vd p5/p50/p95) — **mọi số là decimal-string** qua `@brighten/decision-core/math`
**And** cùng `(netRs, resamples, seed)` ⇒ **cùng** CI tuyệt đối (deep-equal) nhiều lần; đổi seed ⇒ có thể khác; chuỗi rỗng ⇒ rejection tất định `{ code, source: "validation.bootstrap" }`
**And** output là **khoảng** (không chỉ điểm) — đây là chỉ số uy tín chống "một con số đẹp ảo"

**AC4 — Chế độ forward paper-trade (đánh dấu, không vốn thật) + cổng cho phép live (FR-9 paper-trade gate)**
**Given** kết quả holdout (metrics + CI từ AC2/AC3) và một cờ `paperTradeCompleted`
**When** gọi `assessLiveEligibility(input)` (hàm **thuần** trong driver)
**Then** trả một verdict tất định `{ eligible: boolean, reasons: readonly string[] }` yêu cầu ĐỦ các điều kiện: **holdout expectancy ròng > 0**, **cận dưới CI (`lower`) > 0**, và **`paperTradeCompleted === true`**; thiếu điều kiện nào ⇒ `eligible: false` kèm lý do rõ
**And** một `ValidationMode` phân biệt rõ `"backtest"` vs `"paper-trade"` (đánh dấu, KHÔNG vốn thật, KHÔNG gửi lệnh — AD-10); paper-trade v1 chỉ là **nhãn + cổng**, wiring live thật là **epic 3** (chỉ để chỗ, không làm)
**And** hàm thuần, tất định, không IO — chỉ tổng hợp bằng chứng thành quyết định cho/không-cho lên live

**AC5 — Trần số tham số điều chỉnh-được, chặn theo config có phiên bản (FR-9 param cap, AD-4 additive)**
**Given** `packages/config` schema hiện có (đã có `fee_rate`/`spread`/`slippage` từ 1.8)
**When** thêm trần tham số
**Then** thêm `max_tunable_params` (số nguyên ≥ 1) vào `ConfigParams` + `DEFAULT_PARAMS` + `fieldNames` + validate (nhân bản pattern `isPositiveInteger` như `max_trades_per_day`); cập nhật `schema.test.ts` + mọi fixture `ConfigParams` cứng shape (runner/tier3/tier0 test) để không đỏ
**And** thêm hàm thuần `enforceParamCap(tunedParamNames, max_tunable_params)` (driver): nếu **số tham số được khai báo đang tối ưu** vượt trần ⇒ rejection `{ code: "param_cap_exceeded", source: "validation.param_cap", context }`; ≤ trần ⇒ pass. (Epic 1: `tunedParamNames` đến qua fixture/seam — optimizer thật epic 2 sẽ cấp danh sách này)
**And** KHÔNG đổi param cũ; thuần additive; `ValidationReport` **nhúng config snapshot** (AD-4)

**AC6 — Tái lập 100% + tái dùng engine (NFR-1, AD-3/AD-4)**
**Given** cùng `MarketSnapshot` (fixture) + cùng config version + cùng `BacktestStrategyInput` + cùng `WalkForwardSpec` + cùng `seed`
**When** chạy `runValidation(deps)` **nhiều lần**
**Then** `ValidationReport` **bằng nhau tuyệt đối** (deep-equal): split tất định, resample seed cố định, decimal một-precision, không `Date.now()`/`Math.random()` trong đường accounting/validation
**And** driver **KHÔNG** mutate `MarketSnapshot`/config/strategyInput đầu vào; **KHÔNG** cài lại engine 1.8 hay luật quyết định core — chỉ **điều phối split → (engine 1.8) → thống kê → verdict**
**And** `ValidationReport = { walkForward, holdout, expectancyCI, liveEligibility, paramCap, configSnapshot, dataRange, mode, spec }` — đủ để tái dựng vì sao một dải dữ liệu được coi là "qua kỷ luật"

**AC7 — Hạ tầng test + phủ AC + toolchain sạch**
**Given** `apps/backtest-cli` đã có vitest (từ 1.8)
**When** thêm module + test
**Then** test **tiêm `IngestionPort` giả** (fixture klines/funding cố định) — KHÔNG mạng thật; phủ: `splitWalkForward` (số fold/holdout đúng chỉ số, holdout tách rời, input rác reject); `sliceSnapshot`/`reindexStrategyInput` (re-index đúng, không mutate); `bootstrapExpectancyCI` (cùng seed ⇒ cùng CI, chuỗi biết trước ⇒ lower≤median≤upper, rỗng reject); `assessLiveEligibility` (đủ/thiếu điều kiện → verdict + lý do đúng); `enforceParamCap` (vượt/không vượt trần); `runValidation` tái lập 2 lần `toEqual` + không mutate (`structuredClone`) + không leak `number`
**And** `pnpm -r typecheck && pnpm -r build && pnpm -r lint && pnpm -r test` **tất cả pass**; `*.test.ts` không lọt `dist/` của `apps/backtest-cli` (giữ nguyên cấu hình `tsconfig.build.json` 1.8)

## Tasks / Subtasks

- [x] **Task 1 — Param cap vào config (additive, versioned) (AC: #5)**
  - [x] `packages/config/src/schema.ts`: thêm `max_tunable_params` (số nguyên ≥ 1) vào `ConfigParams` + `DEFAULT_PARAMS` (đề xuất mặc định vd `max_tunable_params: 5` — **ngưỡng deferred-tuning**, không phải quyết định kiến trúc) + `fieldNames`; validate bằng `isPositiveInteger` (nhân bản `max_trades_per_day`). KHÔNG đổi param cũ
  - [x] Cập nhật `packages/config/src/schema.test.ts` (case chấp nhận default mới; thiếu → `missing_config_param`; ≤0/không-nguyên → `invalid_positive_integer`) + mọi fixture `ConfigParams` cứng shape: `packages/decision-core/pipeline/runner.test.ts`, `tiers/tier3/index.test.ts`, `tiers/tier0/index.test.ts`, `tiers/tier0/behavioral-veto.test.ts` (grep `max_trades_per_day` để tìm đúng chỗ; `snapshot.test.ts`/`store.test.ts` dùng `...DEFAULT_PARAMS` nên tự cập nhật)

- [x] **Task 2 — Walk-forward splitter + slice/reindex helpers (thuần) (AC: #1, #2)**
  - [x] `apps/backtest-cli/src/walk-forward.ts`: **NEW** — hàm thuần `splitWalkForward(snapshot, spec): WalkForwardSplitOutcome`:
    - `WalkForwardSpec = { folds: number; inSampleRatio: string; holdoutRatio: string }` (ratio decimal-string trong (0,1))
    - `WalkForwardSplit = { ok: true; holdout: IndexRange; folds: readonly { inSample: IndexRange; outOfSample: IndexRange }[] }`; `IndexRange = { fromIndex: number; toIndex: number }` (nửa mở `[from, to)`)
    - Rejection `{ ok: false; error: CoreError }` (`source: "validation.walk_forward"`) cho input rác (fold ≤ 0, ratio ∉ (0,1), tổng ratio ≥ 1, klines quá ít)
  - [x] Số học ranh giới bằng **integer** (chia sàn số kline); holdout = `holdoutRatio × N` kline cuối; vùng còn lại chia `folds` khối, mỗi khối tách in-sample (`inSampleRatio`) trước, phần dư là out-of-sample. Tất định, không random
  - [x] `apps/backtest-cli/src/slice.ts`: **NEW** — `sliceSnapshot(snapshot, range): MarketSnapshot` (klines = `slice(from, to)`, `atEpochMillis` = openTime kline đầu range; không mutate; giữ `funding`/`warnings`) + `reindexStrategyInput(input, range): BacktestStrategyInput` (lọc signals có `tickIndex ∈ range`, trừ `fromIndex` để về chỉ số cục bộ; giữ `state`/`account` mặc định). **Tái dùng shape 1.8**, không đổi engine

- [x] **Task 3 — Bootstrap/Monte-Carlo CI của expectancy (thuần, seed) (AC: #3)**
  - [x] `apps/backtest-cli/src/prng.ts`: **NEW** — PRNG thuần tất định (vd `mulberry32(seed): () => number` trả [0,1)); **KHÔNG** `Math.random`. Chỉ dùng cho resample (không nằm trên đường quyết định)
  - [x] `apps/backtest-cli/src/bootstrap.ts`: **NEW** — hàm thuần `bootstrapExpectancyCI(netRs, opts): BootstrapOutcome`:
    - `opts = { resamples: number; seed: number; lowerPercentile?: string; upperPercentile?: string }` (mặc định p5/p95)
    - Mỗi resample: rút `n` mẫu **có hoàn lại** từ `netRs` bằng PRNG seed → expectancy = mean(decimal). Sắp các expectancy, lấy percentile → `{ lower, median, upper, resamples, seed }` (decimal-string qua `math`)
    - Chuỗi rỗng / `resamples ≤ 0` ⇒ rejection `{ source: "validation.bootstrap" }`
  - [x] Tất định: cùng `(netRs, resamples, seed)` ⇒ cùng CI (test 2 lần `toEqual`)

- [x] **Task 4 — Paper-trade mode + cổng live-eligibility (thuần) (AC: #4)**
  - [x] `apps/backtest-cli/src/eligibility.ts`: **NEW** — `type ValidationMode = "backtest" | "paper-trade"`; hàm thuần `assessLiveEligibility(input): LiveEligibility`:
    - `input = { holdoutExpectancy: string; ciLower: string; paperTradeCompleted: boolean }`
    - `LiveEligibility = { eligible: boolean; reasons: readonly string[] }`; `eligible` chỉ true khi `holdoutExpectancy > 0` **và** `ciLower > 0` **và** `paperTradeCompleted`; ngược lại liệt kê lý do thiếu (decimal so sánh qua `cmp`)
  - [x] Ghi rõ (comment): paper-trade v1 = **nhãn + cổng**, KHÔNG vốn thật, KHÔNG gửi lệnh (AD-10); wiring live là epic 3

- [x] **Task 5 — Param cap enforcement (thuần, đọc config) (AC: #5)**
  - [x] `apps/backtest-cli/src/param-cap.ts`: **NEW** — hàm thuần `enforceParamCap(tunedParamNames, maxTunableParams): ParamCapOutcome`: đếm `tunedParamNames.length`; > `maxTunableParams` ⇒ rejection `{ code: "param_cap_exceeded", source: "validation.param_cap", context: { count, cap } }`; ≤ ⇒ `{ ok: true, count }`. (Danh sách param đang tối ưu đến qua seam/fixture epic 1)

- [x] **Task 6 — Orchestrator `runValidation` + `ValidationReport` (tái dùng engine 1.8) (AC: #2, #6)**
  - [x] `apps/backtest-cli/src/validate.ts`: **NEW** — `runValidation(deps): Promise<Result<ValidationReport>>`:
    - `deps = { ingestion, request, strategyInput, configSnapshot, spec: WalkForwardSpec, bootstrap: { resamples, seed }, tunedParamNames, paperTradeCompleted, mode }`
    - Luồng: `getMarketSnapshot` (1.7) → `splitWalkForward` → với mỗi out-of-sample + holdout: `sliceSnapshot` + `reindexStrategyInput` → **tái dùng** `replay → simulate → computeMetrics` (import từ 1.8, KHÔNG cài lại) → gộp netR out-of-sample cho `bootstrapExpectancyCI` → `assessLiveEligibility(holdout metrics + CI + paperTradeCompleted)` → `enforceParamCap(...)`
    - `ValidationReport = { mode, spec, walkForward: readonly FoldReport[], holdout: SegmentReport, expectancyCI, liveEligibility, paramCap, configSnapshot, dataRange, snapshotSchemaVersion }` (nhúng config snapshot — AD-4)
  - [x] **Refactor tối thiểu** (nếu cần) `apps/backtest-cli/src/run.ts`: tách phần thuần sau-fetch của `runBacktest` thành helper tái dùng `evaluateSegment(snapshot, strategyInput, configSnapshot, tiers): { metrics, simulated }` (replay→simulate→computeMetrics), giữ **hành vi `runBacktest` cũ y nguyên** (nó gọi helper mới). `validate.ts` cũng dùng helper này. KHÔNG đổi engine `replay`/`simulate`/`metrics`

- [x] **Task 7 — CLI mỏng: cờ chọn backtest vs validate (AC: #4, #7)**
  - [x] `apps/backtest-cli/src/main.ts`: mở rộng parse arg — thêm subcommand/cờ `validate` (vd `backtest-cli validate <pair> <timeframe> <from> <to>`), dựng `WalkForwardSpec` + `bootstrap` mặc định + `tunedParamNames` rỗng (epic 1), gọi `runValidation`, in `ValidationReport` (JSON). Nhánh mặc định vẫn `runBacktest` (1.8). CLI là **lớp mỏng**; mọi logic ở `validate.ts`/helpers
  - [x] Giữ `apps/backtest-cli/package.json`/`tsconfig*.json`/`vitest.config.ts` như 1.8 (không cần dep mới; PRNG tự viết thuần)

- [x] **Task 8 — Tests phủ AC + toolchain sạch (AC: #6, #7)**
  - [x] `apps/backtest-cli/src/*.test.ts`: **NEW** — tiêm `IngestionPort` giả (tái dùng `test-support.ts` 1.8, mở rộng fixture nhiều kline cho walk-forward):
    - `walk-forward`: N kline → số fold/holdout đúng chỉ số; holdout không giao in-sample; input rác reject
    - `slice/reindex`: sub-snapshot đúng klines + signals re-index đúng; `structuredClone` không mutate
    - `bootstrap`: chuỗi netR biết trước + seed cố định → CI cụ thể; 2 lần `toEqual`; rỗng reject; `lower ≤ median ≤ upper`
    - `eligibility`: đủ điều kiện → eligible; thiếu từng điều kiện → không eligible + lý do đúng
    - `param-cap`: vượt trần → reject; đúng trần → pass
    - `runValidation`: 2 lần `toEqual`; không mutate snapshot; `typeof==="string"` cho mọi số; `ValidationReport` nhúng `configSnapshot`
  - [x] `pnpm -r test` pass; `apps/backtest-cli/dist` không chứa `*.test.*`/`test-support.*`

## Dev Notes

> **Bối cảnh:** Story 1.9 **đóng nắp kỷ luật của epic 1**: 1.8 cho ta *expectancy ròng sau chi phí trên một backtest thẳng*; 1.9 trả lời *"con số đó có đáng tin không, hay chỉ là overfit?"*. Đây là **story driver** (`apps/backtest-cli`) theo **AD-3 (một engine, hai driver)** và **AD-12 (suy diễn/đo lường trong nhánh đúng)**: 1.9 **tái dùng nguyên** engine 1.8, chỉ thêm **tầng điều phối xác thực** (split → engine → thống kê → verdict). **Điểm mấu chốt phạm vi:** epic 1 **chưa có optimizer** ⇒ 1.9 giao **bộ khung kỷ luật** (walk-forward/holdout/CI/paper-gate/param-cap) đo trên seam bơm (fixture), sẵn sàng khi optimizer + edge/candidate thật land ở **epic 2**. 1.9 **KHÔNG** giao bộ tối ưu, **KHÔNG** giao live/paper-trade thật (epic 3).

### 🔑 Vì sao là "đo lường trong driver", không phải "quyết định trong core"

- Walk-forward/holdout/CI/paper-gate/param-cap là **đo lường & kỷ luật quy trình**, không phải luật quyết định lệnh ⇒ sống trong **driver** `apps/backtest-cli` (giống replay/simulate/metrics của 1.8), KHÔNG trong `decision-core`. Core vẫn là nơi duy nhất **quyết định** (veto Tầng 0, sizing/cost-hurdle Tầng 3). [Source: ARCHITECTURE-SPINE.md#AD-3, #AD-5; 1-8 Dev Notes → "chỉ accounting/replay/report sống trong driver"]
- **Ngoại lệ config:** `max_tunable_params` là **tham số có phiên bản** (FR-9 "trần theo config") ⇒ nằm ở `packages/config` (AD-4), y như 1.8 thêm `fee_rate`/`spread`/`slippage`. [Source: epics.md → 1.9 AC "trần số tham số bị chặn theo config"; ARCHITECTURE-SPINE.md#AD-4]

### 🔑 Tái dùng engine 1.8 — KHÔNG cài lại (AD-3)

- `validate.ts` **import** `replay`/`simulate`/`computeMetrics`/`runBacktest` từ chính `apps/backtest-cli/src/*` (1.8) và `computeRoundTripCost`/`@brighten/decision-core/math` từ core. Nó chỉ **cắt dải** (`sliceSnapshot`) + **re-index seam** (`reindexStrategyInput`) rồi cho từng segment chạy qua **cùng** engine. Cùng một lõi đo cho mọi fold. [Source: apps/backtest-cli/src/run.ts, replay.ts, simulate.ts, metrics.ts (đã có ở 1.8)]
- **Cắt dải thay vì re-index toàn cục:** để fold độc lập và exit không "nhìn lén" qua ranh giới, mỗi segment là một **sub-snapshot klines liền kề**; `reindexStrategyInput` trừ `fromIndex` cho mọi `signal.tickIndex` và **loại** signal ngoài khoảng. Nhờ đó `replay`/`simulate` 1.8 chạy **nguyên xi** trên sub-snapshot (không cần sửa engine). [Source: apps/backtest-cli/src/types.ts → `BacktestSignal.tickIndex`; replay.ts (lặp theo `klines.entries()`)]

### 🔑 Tái lập & một-precision-source (kế thừa 1.8)

- NFR-1/AD-4: cùng dữ liệu + cùng config version + cùng seed → **cùng** `ValidationReport`. Đảm bảo bằng: split bằng **số học nguyên** tất định, **PRNG seed cố định** (mulberry32 thuần — KHÔNG `Math.random`), **decimal wrapper dùng chung** (`@brighten/decision-core/math`, cùng precision 40/HALF_UP), không `Date.now()`. `ValidationReport` **nhúng config snapshot** + `spec` + `seed` để tái dựng. [Source: ARCHITECTURE-SPINE.md#AD-2, #AD-4; packages/decision-core/math/decimal.ts]
- **PRNG ở driver là hợp lệ:** eslint chỉ cấm `Math.random`/`Date.now` trong `packages/decision-core` (không ở `apps/backtest-cli`). Nhưng để tái lập ta **vẫn** dùng PRNG seed, KHÔNG `Math.random`. [Source: eslint.config.js (`decisionCoreFiles` mới bị cấm); 1-8 Dev Notes → CLI được IO/Date nhưng accounting giữ tất định]

### Hợp đồng đã có (PHẢI tuân, đọc trước khi sửa — phần lớn là TÁI DÙNG, không sửa)

| File | Trạng thái hôm nay (sau 1.8) | Story 1.9 đổi gì | Phải giữ nguyên |
| --- | --- | --- | --- |
| `apps/backtest-cli/src/run.ts` | `runBacktest(deps): Promise<Result<BacktestRun>>` + `defaultTiers()` | **refactor tối thiểu**: tách helper thuần `evaluateSegment` (replay→simulate→metrics); `runBacktest` gọi helper (hành vi cũ y nguyên) | signature + hành vi `runBacktest`; `defaultTiers` |
| `apps/backtest-cli/src/replay.ts` | `replay(snapshot, strategyInput, configSnapshot, tiers)` thuần | **không sửa** (validate cắt sub-snapshot rồi gọi) | toàn bộ |
| `apps/backtest-cli/src/simulate.ts` | `simulate(emitted, snapshot, configSnapshot)` thuần | **không sửa** | toàn bộ |
| `apps/backtest-cli/src/metrics.ts` | `computeMetrics(netRs): BacktestMetrics` thuần | **không sửa** (bootstrap dùng lại `netR`) | toàn bộ |
| `apps/backtest-cli/src/types.ts` | `BacktestStrategyInput`/`BacktestSignal`/`SimulatedTrade`/`BacktestMetrics`/`BacktestRun`/`BacktestDataRange` | **thêm** type mới cho validation (walk-forward/CI/report); KHÔNG đổi type cũ | shape 1.8 |
| `apps/backtest-cli/src/test-support.ts` | `makeKline`/`makeSnapshot`/`makeConfigSnapshot`/`fakeIngestion`/`failingIngestion` (loại khỏi build) | **mở rộng** fixture (nhiều kline) — vẫn loại khỏi build | export cũ; loại khỏi `dist` |
| `apps/backtest-cli/tsconfig.build.json` | reference các `*.build.json`; loại `*.test.ts` + `test-support.ts` | **thêm** `param-cap`/`walk-forward`/... tự nằm trong `src/**/*.ts` (không cần đổi) | cơ chế loại test khỏi dist |
| `apps/backtest-cli/src/clock.ts` | `fixedClock(atEpochMillis): ClockPort` | **không sửa** (validate dùng lại qua engine) | toàn bộ |
| `packages/config/src/schema.ts` | `ConfigParams` có `fee_rate`/`spread`/`slippage`; **không** có `max_tunable_params` | +`max_tunable_params` (int ≥ 1, additive) | param cũ, `validateParams`, `isPositiveInteger` |
| `packages/decision-core/*` | engine + `computeRoundTripCost` + `@brighten/decision-core/math` | **không sửa** — chỉ tiêu thụ (`math` để tính decimal) | toàn bộ |

[Source: apps/backtest-cli/src/{run,replay,simulate,metrics,types,test-support,clock}.ts (1.8); apps/backtest-cli/tsconfig.build.json; packages/config/src/schema.ts; packages/decision-core/index.ts]

### Đặc tả số học (một nguồn sự thật)

```text
# splitWalkForward (thuần, integer)
N            = klines.length
holdoutLen   = floor(holdoutRatio × N)          # khối cuối, tách hẳn
workLen      = N − holdoutLen                    # vùng chia fold
foldLen      = floor(workLen / folds)            # mỗi fold liền kề
per fold k (k = 0..folds-1):
  foldFrom   = k × foldLen
  inLen      = floor(foldLen × inSampleRatio)
  inSample   = [foldFrom, foldFrom + inLen)
  outOfSample= [foldFrom + inLen, foldFrom + foldLen)
holdout      = [N − holdoutLen, N)               # KHÔNG giao bất kỳ inSample
kiểm trước: folds ≥ 1 ; 0 < inSampleRatio,holdoutRatio < 1 ; inSampleRatio + holdoutRatio < 1 ;
            workLen ≥ folds ; foldLen ≥ 1 ; else reject source="validation.walk_forward"
```

```text
# bootstrapExpectancyCI (thuần, seed)
rng          = mulberry32(seed)                  # thuần, KHÔNG Math.random
mỗi resample r (r = 0..resamples-1):
  mẫu[i]     = netRs[floor(rng() × n)]  cho i = 0..n-1   # bootstrap có hoàn lại
  exp[r]     = mean(mẫu)                          # decimal qua math
sort(exp) tăng dần (so sánh bằng cmp)
lower  = percentile(exp, lowerPercentile)         # mặc định p5
median = percentile(exp, "50")
upper  = percentile(exp, upperPercentile)         # mặc định p95
kiểm trước: netRs không rỗng ; resamples ≥ 1 ; else reject source="validation.bootstrap"
```

```text
# assessLiveEligibility (thuần)
eligible = (holdoutExpectancy > 0) AND (ciLower > 0) AND (paperTradeCompleted === true)
reasons  = liệt kê điều kiện KHÔNG đạt (tất định, thứ tự cố định)

# enforceParamCap (thuần)
count > max_tunable_params ⇒ reject code="param_cap_exceeded"
```

Mọi phép tiền/R qua `@brighten/decision-core/math` (cùng precision). PRNG chỉ trả chỉ số resample, không tính tiền. [Source: packages/decision-core/math/decimal.ts]

### Invariant kiến trúc PHẢI tuân

- **AD-3 — một engine, hai driver:** 1.9 tái dùng engine 1.8; **cấm** cài lại `replay`/`simulate`/`metrics` hay bất kỳ luật quyết định core trong tầng validation. [Source: #AD-3]
- **AD-4 — config snapshot cùng mỗi quyết định:** `max_tunable_params` versioned; `ValidationReport` nhúng snapshot + spec + seed; đổi param ⇒ version mới, report cũ tái dựng được. [Source: #AD-4]
- **AD-2/NFR-1 — tất định:** split integer, PRNG seed (không `Math.random`), decimal một-precision, không `Date.now()` trong đường validation; cùng dữ liệu+version+seed → cùng report. [Source: #AD-2]
- **AD-10 — cô lập khỏi sàn:** paper-trade v1 chỉ là **nhãn + cổng**, KHÔNG vốn thật, KHÔNG đường code gửi lệnh. [Source: #AD-10]
- **Triết lý sản phẩm:** expectancy phải kèm **khoảng tin cậy** (không một-con-số-ảo) và phải qua **holdout chưa từng tối ưu** + **paper-trade** trước khi được coi là đủ tin để live. [Source: epics.md → 1.9 AC; FR-9]

### Ngoài phạm vi story này (đừng làm — để story/epic sau)

- **Bộ tối ưu tham số thật (parameter search/grid/optuna...)** — **epic 2** (khi có edge/candidate thật). 1.9 chỉ dựng khung đo + enforce trần; `tunedParamNames` đến qua fixture/seam.
- **Sinh candidate/edge THẬT (Tầng 1 regime/edge, Tầng 2 price-action)** — **epic 2**. 1.9 bơm qua `BacktestStrategyInput` (fixture), như 1.8.
- **Live-drift auto-halt (FR-10)** — **epic 3** (logic) + **epic 4** (hiển thị). 1.9 chỉ cung cấp CI backtest làm mốc cho drift sau này, KHÔNG cài auto-halt.
- **Paper-trade THẬT chạy live-tick (cron-runner)** — **epic 3** vận hành. 1.9 chỉ là **nhãn `ValidationMode` + cổng `assessLiveEligibility`**; không wiring sàn/vốn.
- **Persist `ValidationReport` vào Postgres** — story persistence. 1.9 giữ in-memory + in ra (đã nhúng snapshot để sẵn sàng persist).
- **Sửa engine 1.8** (`replay`/`simulate`/`metrics`) hay `decision-core` — cấm; chỉ refactor tối thiểu tách `evaluateSegment` giữ hành vi cũ.
- **Thống kê nâng cao** (block bootstrap giữ tự tương quan, stationary bootstrap, p-value, deflated Sharpe) — v1 giữ bootstrap có-hoàn-lại + xáo thứ tự đơn giản; tinh chỉnh sau (ghi chú, không làm).

### Source tree mục tiêu (phần thêm/đổi)

```text
packages/config/src/
  schema.ts                          # UPDATE: + max_tunable_params (int ≥ 1, additive)
  schema.test.ts                     # UPDATE: cover param mới
apps/backtest-cli/
  src/
    walk-forward.ts                  # NEW: splitWalkForward (thuần, integer)
    slice.ts                         # NEW: sliceSnapshot + reindexStrategyInput
    prng.ts                          # NEW: mulberry32 (thuần, seed — không Math.random)
    bootstrap.ts                     # NEW: bootstrapExpectancyCI (thuần, seed)
    eligibility.ts                   # NEW: ValidationMode + assessLiveEligibility
    param-cap.ts                     # NEW: enforceParamCap
    validate.ts                      # NEW: runValidation → ValidationReport (nhúng snapshot)
    run.ts                           # UPDATE (tối thiểu): tách evaluateSegment; runBacktest giữ nguyên
    types.ts                         # UPDATE: + type validation (WalkForwardSpec/Split/CI/Report)
    main.ts                          # UPDATE: + subcommand `validate`; nhánh backtest cũ giữ nguyên
    test-support.ts                  # UPDATE: mở rộng fixture nhiều kline (vẫn loại khỏi build)
    walk-forward.test.ts             # NEW
    slice.test.ts                    # NEW
    bootstrap.test.ts                # NEW
    eligibility.test.ts              # NEW
    param-cap.test.ts                # NEW
    validate.test.ts                 # NEW
```
[Source: apps/backtest-cli/src/* (1.8); ARCHITECTURE-SPINE.md#Structural Seed → apps/backtest-cli; bố cục test 1.8 làm khuôn]

### Project Structure Notes

- Tách **thuần (walk-forward/slice/prng/bootstrap/eligibility/param-cap/validate)** khỏi **IO/CLI (main.ts)**: test được không cần mạng (tiêm `IngestionPort` giả). Song song cách tách của 1.8.
- Reuse tối đa: `replay`/`simulate`/`computeMetrics`/`runBacktest`/`defaultTiers` + `test-support` từ 1.8; `computeRoundTripCost` + `@brighten/decision-core/math` từ core; `IngestionPort`/`createBinanceRestIngestion` + `MarketSnapshot`/`ConfigSnapshot` như 1.8.
- Rủi ro hồi quy: thêm `max_tunable_params` là **thay đổi additive** chạm `@brighten/config` (1.2) → fixture `ConfigParams` cứng ở test core/config phải cập nhật (grep `max_trades_per_day`/`DEFAULT_PARAMS` để tìm hết — **giống hệt bài học 1.8** khi thêm cost params). Không đổi param cũ/`validateParams` logic.
- `apps/backtest-cli` là app Node ⇒ được IO/`Date` ở CLI; nhưng giữ validation tất định qua **PRNG seed + decimal export + split integer**. Không thêm thư viện stats ngoài — PRNG tự viết thuần (một-precision-source, không kéo phụ thuộc mới).
- `dist` sạch: cơ chế `tsconfig.build.json` (reference các `*.build.json`, loại `*.test.ts`/`test-support.ts`) đã dựng ở 1.8 — module mới nằm trong `src/**/*.ts` nên tự được build đúng; **không** cần đổi cấu hình.

### Chuẩn test

- Vitest (đã có cho `apps/backtest-cli`). Mỗi AC ≥ 1 test. Tiêm `IngestionPort` giả — **không mạng thật**.
- **Số cụ thể**: `splitWalkForward` trên N kline biết trước → chỉ số fold/holdout tính tay; `bootstrapExpectancyCI` với seed cố định + chuỗi netR biết trước → CI cụ thể (assert `lower ≤ median ≤ upper` và giá trị chính xác); `assessLiveEligibility`/`enforceParamCap` bảng điều kiện.
- **Tái dùng engine thật**: `runValidation` với fixture khiến out-of-sample có lệnh (candidate hợp lệ) và holdout đo được → chứng minh dùng engine 1.8 (không bypass); bơm state khiến Tầng 0 veto trong một fold ⇒ fold đó 0 lệnh.
- **Tái lập** (2 lần `toEqual` cả `ValidationReport`), **không mutate** snapshot/config/strategyInput (`structuredClone`), **không leak `number`** (`typeof==="string"` cho mọi số tiền/R/CI trong output).
- **Holdout guard**: assert holdout indices **không** giao bất kỳ `inSample` nào (bất biến chống overfit).
- Không mạng/DB thật.

### References

- [Source: epics.md → Epic 1, Story 1.9] — AC gốc: walk-forward + holdout không tối ưu; khoảng tin cậy expectancy (Monte Carlo/xáo thứ tự lệnh); forward paper-trade trước vốn thật; trần số tham số theo config
- [Source: requirements-inventory.md → FR-9] — "Walk-forward + khối holdout không tối ưu; khoảng tin cậy expectancy; chế độ forward paper-trade trước vốn thật; trần số tham số"
- [Source: ARCHITECTURE-SPINE.md#AD-3] — một engine, hai driver; cấm cài lại luật trong driver
- [Source: ARCHITECTURE-SPINE.md#AD-4] — config snapshot nhúng vào report; tham số versioned (`max_tunable_params`)
- [Source: ARCHITECTURE-SPINE.md#AD-2, #Consistency → Determinism/Thời gian/Tiền tệ] — tất định, decimal-string, không `Date.now()`/`Math.random()` trong đường validation
- [Source: ARCHITECTURE-SPINE.md#AD-10] — cô lập khỏi sàn; paper-trade không vốn thật/không gửi lệnh
- [Source: ARCHITECTURE-SPINE.md#Capability Map → FR-8/9] — backtest + chống overfit sống ở `apps/backtest-cli` + `decision-core`
- [Source: 1-8-backtest-engine-real-cost.md] — engine `runBacktest`/`replay`/`simulate`/`computeMetrics`/`BacktestStrategyInput`/`SimulatedTrade`/`BacktestMetrics` mà 1.9 tái dùng; bài học fixture `ConfigParams` phải cập nhật khi thêm config param; cơ chế `tsconfig.build.json` giữ `dist` sạch
- [Source: apps/backtest-cli/src/run.ts, replay.ts, simulate.ts, metrics.ts, types.ts, test-support.ts, clock.ts] — contract engine 1.8 (đọc trước khi sửa)
- [Source: packages/config/src/schema.ts] — pattern thêm param versioned (`isPositiveInteger` cho `max_trades_per_day`); thêm `max_tunable_params`
- [Source: packages/decision-core/math/decimal.ts] — wrapper precision-một-chỗ; `@brighten/decision-core/math` cho mọi phép decimal của validation
- [Source: eslint.config.js] — chỉ `decision-core` bị cấm `Math.random`/`Date.now`; driver được phép nhưng 1.9 vẫn dùng PRNG seed để tái lập

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- `pnpm --filter @brighten/config test -- --run` — pass
- `pnpm --filter @brighten/config build` — pass
- `pnpm --filter @brighten/backtest-cli test -- --run` — pass
- `pnpm -r typecheck` — pass
- `pnpm -r build` — pass
- `pnpm -r lint` — pass
- `pnpm -r test` — pass
- `find apps/backtest-cli/dist -name '*test*' -o -name 'test-support*'` — no output; dist clean

### Completion Notes List

- Added versioned config param `max_tunable_params` with default `5`, required-field validation, positive-integer validation, and updated hard-shaped `ConfigParams` fixtures.
- Added pure anti-overfit driver helpers: deterministic walk-forward split, snapshot slicing, strategy-input reindexing, seeded PRNG, bootstrap expectancy CI, live eligibility gate, and param-cap enforcement.
- Refactored `runBacktest` minimally through `evaluateSegment` so validation reuses the same 1.8 replay/simulate/metrics engine without changing the old run behavior.
- Added `runValidation` orchestration returning `ValidationReport` with walk-forward segment reports, holdout report, CI, live eligibility, param-cap result, config snapshot, data range, and snapshot schema version.
- Added CLI `validate` subcommand with default validation spec/bootstrap and empty `tunedParamNames` for epic-1 seam usage.
- Added focused Vitest coverage for config validation, walk-forward splitting, slice/reindex, bootstrap determinism, live eligibility, param cap, and end-to-end validation reproducibility/no-mutation.

### File List

- apps/backtest-cli/src/bootstrap.test.ts
- apps/backtest-cli/src/bootstrap.ts
- apps/backtest-cli/src/eligibility.test.ts
- apps/backtest-cli/src/eligibility.ts
- apps/backtest-cli/src/main.ts
- apps/backtest-cli/src/param-cap.test.ts
- apps/backtest-cli/src/param-cap.ts
- apps/backtest-cli/src/prng.ts
- apps/backtest-cli/src/run.ts
- apps/backtest-cli/src/slice.test.ts
- apps/backtest-cli/src/slice.ts
- apps/backtest-cli/src/types.ts
- apps/backtest-cli/src/validate.test.ts
- apps/backtest-cli/src/validate.ts
- apps/backtest-cli/src/walk-forward.test.ts
- apps/backtest-cli/src/walk-forward.ts
- packages/config/src/schema.test.ts
- packages/config/src/schema.ts
- packages/decision-core/pipeline/runner.test.ts
- packages/decision-core/tiers/tier0/behavioral-veto.test.ts
- packages/decision-core/tiers/tier0/index.test.ts
- packages/decision-core/tiers/tier3/index.test.ts

### Change Log

- 2026-07-04: Implemented Story 1.9 anti-overfit validation discipline and moved story to review.
