---
baseline_commit: bd489f4a1902a89f12d6c1f45fd33ead36a87e91
---

# Story 1.8: Backtest engine chi phí thật (FR-8)

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **người dùng (solo trader) của Brighten**,
I want **`backtest-cli` bơm dữ liệu lịch sử (adapter 1.7) qua CÙNG `decision-core` (AD-3), một MÔ HÌNH CHI PHÍ tất định (phí + spread + slippage + funding khi giữ lệnh crypto) cộng đúng vào P&L, rồi xuất expectancy ròng (bội số R), max drawdown, phân phối R-multiple và đường equity — 100% tái lập với cùng dữ liệu + cùng config version**,
so that **tôi có bằng chứng TRUNG THỰC (sau chi phí, không tô hồng) để tin "cái phanh", và cùng một engine chạy cho cả live lẫn backtest nên không có hai bản logic trôi khác nhau (FR-8, AD-3, AD-4, NFR-1 tái lập)**.

## Acceptance Criteria

> **Biên phạm vi epic 1 (đã chốt):** Tầng 1 (edge) và Tầng 2 (candidate/price-action) **còn stub** ⇒ pipeline chưa tự sinh lệnh. Story 1.8 dựng **engine + mô hình chi phí + metrics + wiring dữ liệu thật**, và **bơm candidate/edge/account qua một seam đầu vào tất định (fixture/`BacktestStrategyInput`)** — y hệt cách 1.4/1.5/1.6 bơm candidate/account/edge/cost. Edge/candidate **thật** đến từ Tầng 1/2 ở **epic 2**; engine 1.8 sẵn sàng đo ngay khi chúng land. **KHÔNG** cài đặt luật quyết định trong driver (AD-3).

**AC1 — Mô hình chi phí tất định (thuần, trong core) sinh round-trip cost (FR-8 chi phí; giải toả placeholder 1.5)**
**Given** `notional` (decimal-string, = volume × giá vào, đơn vị quote), config cost params `fee_rate`, `spread`, `slippage` (decimal-string), và (tuỳ chọn) `fundingPoints` + cửa sổ giữ lệnh cho perp crypto
**When** gọi `computeRoundTripCost(input)` (hàm **thuần** trong `decision-core/cost/`)
**Then** trả `Result<string>` cost round-trip (decimal, đơn vị quote) = `(fee_rate + spread + slippage) × notional × 2` (vào+ra) **cộng** funding cost `Σ(fundingRate × notional)` trên các mốc funding trong cửa sổ giữ (chỉ khi có `fundingPoints`; FX/không perp ⇒ bỏ funding)
**And** MỌI phép tính qua `math/decimal.ts` (cùng precision/rounding một-chỗ với 1.4 — tái lập); KHÔNG JS `number` cho tiền; input rác ⇒ rejection `{ code, source: "cost.round_trip", context }`
**And** hàm này là **một nguồn chi phí duy nhất** dùng cho **cả hai**: (a) ước lượng cổng cost-hurdle Tầng 3 (`ctx.cost.roundTripFee`, 1.5) và (b) chi phí thực trừ vào P&L backtest — cùng công thức, khác input (notional ước lượng vs thực)

**AC2 — Cost params là config có phiên bản (AD-4, additive vào schema 1.2)**
**Given** `packages/config` schema hiện có (`cost_hurdle_x` đã có)
**When** thêm cost params
**Then** thêm `fee_rate`, `spread`, `slippage` (decimal-string ≥ 0) vào `ConfigParams` + `DEFAULT_PARAMS` + `fieldNames` + validate (nhân bản pattern `validateDecimalField`; cho phép `0` — dùng `>= 0`, khác `min_rr` yêu cầu `> 0`); cập nhật `schema.test.ts`/`snapshot.test.ts` + mọi fixture `ConfigParams` (runner/tier3 test) để không đỏ
**And** `BacktestRun` **nhúng snapshot config** đã dùng (version + params) để tái lập (AD-4); đổi param ⇒ version mới, kết quả cũ vẫn tái dựng được
**And** KHÔNG đổi `cost_hurdle_x` hay param cũ; thuần additive

**AC3 — Driver bơm dữ liệu lịch sử qua CÙNG decision-core (AD-3)**
**Given** `IngestionPort` (adapter `binance-rest` lịch sử, Story 1.7) cấp `MarketSnapshot` (klines + funding + OI + L/S) cho cặp + khung + khoảng ngày
**When** `backtest-cli` chạy một backtest
**Then** nó **import và gọi CÙNG** `runPipeline` + tier0..3 thật của `decision-core` (KHÔNG cài lại bất kỳ luật quyết định nào trong driver — AD-3); thời gian vào lõi qua một `ClockPort` **tất định** (mốc = `kline.openTime`/`atEpochMillis` của tick, KHÔNG `Date.now()`)
**And** candidate/`expectedEdge`/account bơm qua seam `BacktestStrategyInput` (fixture epic 1); `ctx.cost` = `{ roundTripFee: computeRoundTripCost(ước lượng notional) }` từ AC1
**And** chỉ **accounting/replay/report** sống trong driver; **mọi quyết định** (veto Tầng 0, sizing/cost-hurdle Tầng 3) do core quyết

**AC4 — Mô phỏng kết quả lệnh + cộng chi phí thật vào P&L (FR-8)**
**Given** một Đề xuất core phát ra (pipeline `outcome: "suggestion"`) với candidate (entry/stop/target) + sizing (volume/riskAmount từ Tầng 3)
**When** engine mô phỏng outcome bằng cách duyệt klines **sau** thời điểm vào (dùng `high`/`low`) tới khi chạm stop hoặc target
**Then** tính **R-multiple gộp** = (giá thoát − entry)/(entry − stop) (theo hướng), rồi **R ròng** = R gộp − (chi phí thực round-trip / riskAmount) với chi phí thực từ AC1 (notional thực + funding thực trên cửa sổ giữ)
**And** cộng đủ **phí + spread + slippage + funding** (funding chỉ khi giữ lệnh perp crypto, từ `MarketSnapshot.funding`); FX không funding
**And** quy ước hoà/không chạm tới hết dữ liệu: đánh dấu rõ (vd đóng ở close cuối) — tất định, ghi tài liệu

**AC5 — Xuất metrics trung thực: expectancy ròng, max drawdown, phân phối R, equity; win-rate chỉ "tham khảo"**
**Given** chuỗi R ròng của các lệnh mô phỏng
**When** engine tổng hợp
**Then** xuất: **expectancy ròng** (trung bình bội số R sau chi phí), **max drawdown** (trên đường equity theo R hoặc quote), **phân phối R-multiple** (histogram/danh sách), **đường equity** (chuỗi tích luỹ)
**And** **win rate** chỉ hiển thị kèm **nhãn "tham khảo"** (reference), KHÔNG phải chỉ số uy tín chính (không headline) — đúng triết lý sản phẩm chống "cảm giác thắng"
**And** mọi số tiền/R là decimal-string (không leak `number`); output có cấu trúc (object + in ra CLI), `BacktestRun` gồm metrics + config snapshot nhúng + tham chiếu khoảng dữ liệu

**AC6 — Tái lập 100%: cùng dữ liệu + cùng config version → cùng kết quả (NFR-1)**
**Given** cùng một `MarketSnapshot` (fixture cố định) + cùng config version + cùng `BacktestStrategyInput`
**When** chạy backtest **nhiều lần**
**Then** `BacktestRun` **bằng nhau tuyệt đối** (deep-equal) — duyệt tất định, clock tất định, decimal một-precision, không `Date.now()`/`Math.random()` trong accounting
**And** engine **KHÔNG** mutate `MarketSnapshot`/config đầu vào

**AC7 — Hạ tầng test cho backtest-cli + phủ AC + toolchain sạch**
**Given** `apps/backtest-cli` **chưa có** vitest/`test` script; deps hiện chỉ `@brighten/decision-core`
**When** thêm test + wiring
**Then** thêm deps `@brighten/adapters`, `@brighten/config` vào `apps/backtest-cli/package.json`; thêm `vitest.config.ts` + `"test"/"test:watch"`; test **tiêm `IngestionPort` giả** (fixture klines/funding) — KHÔNG mạng thật
**And** test phủ: `computeRoundTripCost` số cụ thể (phí/spread/slippage + funding; biên không-funding); wiring pipeline (dùng tier thật, veto Tầng 0 ⇒ không có lệnh); simulate hit stop/target đúng + R ròng đúng số; metrics (expectancy/drawdown/R-dist/equity) trên chuỗi R biết trước; win-rate gắn nhãn "tham khảo"; **tái lập** (2 lần `toEqual`); không mutate; không leak `number`
**And** `pnpm -r typecheck && pnpm -r build && pnpm -r lint && pnpm -r test` **tất cả pass**; `*.test.ts` không lọt `dist/`

## Tasks / Subtasks

- [x] **Task 1 — Cost params vào config (additive, versioned) (AC: #2)**
  - [x] `packages/config/src/schema.ts`: thêm `fee_rate`, `spread`, `slippage` (decimal-string) vào `ConfigParams` + `DEFAULT_PARAMS` (đề xuất mặc định nhỏ, vd `fee_rate: "0.0004"` taker ~4bps, `spread: "0.0001"`, `slippage: "0.0002"` — **ngưỡng deferred-tuning**, không phải quyết định kiến trúc) + `fieldNames`; validate **cho phép 0** (`>= 0`) — thêm helper `validateNonNegativeDecimalField` (nhân bản `validateDecimalField` nhưng bỏ ràng buộc `> 0`). KHÔNG đổi `cost_hurdle_x`/param cũ
  - [x] Cập nhật `schema.test.ts` + `snapshot.test.ts` + mọi fixture `ConfigParams` cứng shape: `packages/decision-core/pipeline/runner.test.ts`, `tiers/tier3/index.test.ts`, `tiers/tier0/*.test.ts` (nếu dựng params) — grep `DEFAULT_PARAMS`/`params:` để không sót; thêm case validate: thiếu → `missing_config_param`; rác/âm → mã lỗi tương ứng

- [x] **Task 2 — Mô hình chi phí thuần trong core (giải toả placeholder 1.5) (AC: #1)**
  - [x] `packages/decision-core/cost/round-trip.ts`: **NEW** — hàm thuần
    `computeRoundTripCost(input: RoundTripCostInput): RoundTripCostOutcome`:
    - `RoundTripCostInput = { notional: string; feeRate: string; spread: string; slippage: string; fundingPoints?: readonly { fundingRate: string }[] }`
    - `RoundTripCostResult = { ok: true; cost: string }` (decimal); `RoundTripCostRejection = { ok: false; error: CoreError }` (`source: "cost.round_trip"`)
  - [x] Công thức (decimal, `math/decimal.ts`): `perSide = (feeRate + spread + slippage) × notional`; `base = perSide × 2`; `funding = Σ(fundingRate × notional)` trên `fundingPoints` (vắng ⇒ 0); `cost = base + funding`. Parse rác / `notional < 0` ⇒ reject. **KHÔNG** JS `number`; hàm thuần, không mutate, không IO
  - [x] `packages/decision-core/cost/round-trip.test.ts`: **NEW** — số cụ thể (vd `notional="10000"`, `feeRate="0.0004"`, `spread="0.0001"`, `slippage="0.0002"` ⇒ `perSide=7`, `base=14`; + 2 funding `"0.0001"` ⇒ `+2` ⇒ `cost="16"`); biên không funding; input rác → reject; tất định + không mutate + `typeof==="string"`
  - [x] Export: thêm `export * from "./cost/round-trip.js"` vào `packages/decision-core/index.ts`

- [x] **Task 3 — Export decimal wrapper để driver tái dùng (một-precision-source) (AC: #6)**
  - [x] `packages/decision-core/package.json`: thêm export subpath `"./math": { types: "./dist/math/decimal.d.ts", default: "./dist/math/decimal.js" }` (mirror `./ports`). Nhờ đó accounting driver dùng **cùng** `add/sub/mul/div/cmp/abs/toDecimal` (cùng precision 40/HALF_UP) ⇒ tái lập; **KHÔNG** để driver tự `new Decimal`/tự set precision (tránh trôi determinism — bất biến đã chốt 1.4)
  - [x] KHÔNG đổi `math/decimal.ts` logic; chỉ mở cửa export

- [x] **Task 4 — Backtest engine: replay + simulate + metrics (thuần, trong driver) (AC: #3, #4, #5, #6)**
  - [x] `apps/backtest-cli/src/clock.ts`: **NEW** — `fixedClock(atEpochMillis): ClockPort` (tất định, cho mỗi tick); KHÔNG `Date.now()` trong đường accounting
  - [x] `apps/backtest-cli/src/replay.ts`: **NEW** — hàm thuần: nhận `MarketSnapshot` + `BacktestStrategyInput` (seam bơm `candidate?`/`expectedEdge?`/`account?` theo tick — fixture epic 1) + `ConfigSnapshot` + mảng tier thật (`[createTier0(), createTier1Stub(), createTier2Stub(), createTier3()]`); với mỗi tick: dựng `PipelineBaseContext` (input=cửa sổ snapshot, state, config, candidate/edge/account bơm, `cost` = `computeRoundTripCost(ước lượng notional)`), gọi `runPipeline(tiers, base, fixedClock(tick))`; thu Đề xuất phát ra
  - [x] `apps/backtest-cli/src/simulate.ts`: **NEW** — hàm thuần: với mỗi Đề xuất + candidate + sizing, duyệt klines sau entry (dùng `high`/`low`) → chạm stop/target → `grossR`; `netR = grossR − div(realizedCost, riskAmount)` với `realizedCost = computeRoundTripCost(notional thực + funding thực trên cửa sổ giữ)`; quy ước hoà/không-chạm (đóng ở close cuối) ghi rõ
  - [x] `apps/backtest-cli/src/metrics.ts`: **NEW** — hàm thuần: từ chuỗi `netR` → `{ expectancy, maxDrawdown, rDistribution, equityCurve, winRateReference }` (mọi số decimal-string; `winRateReference` gắn nhãn tham khảo). `maxDrawdown` trên equity tích luỹ; `rDistribution` gom bin/đếm tất định
  - [x] `apps/backtest-cli/src/run.ts`: **NEW** — `runBacktest(deps)` ghép replay→simulate→metrics, trả `BacktestRun = { metrics, configSnapshot, dataRange, snapshotSchemaVersion }` (nhúng config snapshot — AD-4). `deps` tiêm `ingestion: IngestionPort` + `strategyInput` + `configSnapshot` (test bơm giả)

- [x] **Task 5 — CLI mỏng + wiring adapter thật (AC: #3, #7)**
  - [x] `apps/backtest-cli/src/main.ts`: thay scaffold — parse tham số (pair/timeframe/from/to), dựng `createBinanceRestIngestion(...)` (1.7), dựng `ConfigSnapshot` từ `@brighten/config` (`snapshot(createConfigVersion(DEFAULT_PARAMS))` hoặc store), gọi `runBacktest`, in `BacktestRun` (JSON). CLI là **lớp mỏng**; mọi logic ở `run.ts`/`replay`/`simulate`/`metrics`
  - [x] `apps/backtest-cli/package.json`: thêm deps `@brighten/adapters`, `@brighten/config` (workspace:*); `apps/backtest-cli/tsconfig.json`: thêm `references` tới `../../packages/adapters`, `../../packages/config`
  - [x] `apps/backtest-cli` là driver (Node) — **được phép IO/`Date`** ở lớp CLI (không bị lint core cấm), nhưng đường **accounting** (replay/simulate/metrics) giữ tất định qua `fixedClock` + decimal wrapper

- [x] **Task 6 — Hạ tầng test backtest-cli + tests phủ AC (AC: #6, #7)**
  - [x] `apps/backtest-cli/vitest.config.ts`: **NEW** (mirror adapters/decision-core); `package.json` thêm `"test"/"test:watch"`
  - [x] `apps/backtest-cli/src/*.test.ts`: **NEW** — tiêm `IngestionPort` giả (fixture klines/funding cố định) + `strategyInput` cố định:
    - `simulate`: candidate hit target → `grossR` đúng; hit stop → `-1R`-ish; `netR` trừ chi phí đúng số
    - `metrics`: chuỗi netR biết trước → expectancy/maxDrawdown/equity/rDistribution đúng; `winRateReference` có nhãn
    - `replay`: bơm state khiến Tầng 0 veto ⇒ **không** Đề xuất/lệnh (chứng minh dùng core thật); Tầng 0 pass + candidate ⇒ có Đề xuất
    - **tái lập**: `runBacktest` 2 lần → `toEqual`; không mutate snapshot (`structuredClone`)
  - [x] `pnpm -r test` pass; `dist/` không chứa `*.test.*`

## Dev Notes

> **Bối cảnh:** Story 1.8 **đóng epic 1** — biến khung tất định (1.1–1.6) + dữ liệu thật (1.7) thành **bằng chứng expectancy ròng sau chi phí**. Đây là **story driver** (`apps/backtest-cli`) theo **AD-3 (một engine, hai driver)**: backtest import **CÙNG** `decision-core` như live, chỉ khác adapter (dữ liệu lịch sử) + clock (tất định). **Điểm mấu chốt phạm vi:** Tầng 1/2 còn stub ⇒ engine 1.8 đo trên **candidate/edge bơm qua seam** (fixture epic 1); edge/candidate thật là **epic 2**. Story 1.8 giao **engine + mô hình chi phí + metrics + wiring**, KHÔNG giao chiến lược sinh lệnh.

### 🔑 Mô hình chi phí sống ở đâu, dùng cho cái gì — giải toả placeholder 1.5

- 1.5 đã hoãn: `CostEstimate.roundTripFee` "produced by the fee model in Story 1.8". Nay 1.8 dựng nó là **hàm thuần trong `decision-core/cost/`** (KHÔNG trong driver) vì **hai lý do**: (a) nó **nuôi một QUYẾT ĐỊNH** (cổng cost-hurdle Tầng 3) ⇒ phải trong core để live≡backtest gate **giống hệt** (AD-3/AD-12); (b) nó được backtest **tái dùng** để trừ chi phí thực vào P&L. Một công thức, một chỗ. [Source: 1-5 Dev Notes → "mô hình phí là 1.8"; ARCHITECTURE-SPINE.md#AD-3, #AD-12]
- **Giải "vòng lặp notional":** cost cần notional = volume×giá, mà volume do sizing Tầng 3 tính (sau khi cost-hurdle đã cần cost). Giải: `computeRoundTripCost` là **hàm của notional (tham số)**, không của nội bộ Tầng 3. Driver gọi nó **hai lần**: (1) **ước lượng** notional trước pipeline (từ risk%/equity/stop — cùng công thức sizing) → `ctx.cost.roundTripFee` cho cổng; (2) **notional thực** sau khi có fill mô phỏng + funding thực → chi phí trừ P&L. Chênh lệch ước lượng/thực là **chấp nhận được** cho một cổng ước lượng, và accounting dùng số thực — trung thực. [Source: packages/decision-core/tiers/tier3/sizing.ts (công thức volume); 1-5 AC (roundTripFee là "ước lượng")]
- **Funding chỉ cho perp crypto**: `MarketSnapshot.funding` (1.7) cấp `fundingRate` theo mốc; cost cộng `Σ(fundingRate×notional)` trên cửa sổ giữ. FX/không perp ⇒ `fundingPoints` vắng ⇒ funding = 0. [Source: epics.md → 1.8 "funding cost (khi giữ lệnh crypto)"; decision-core/types → FundingPoint]

### 🔑 AD-3 — cùng engine, không cài lại luật trong driver

- `backtest-cli` **import** `runPipeline` + `createTier0/1/2/3` thật + `computeRoundTripCost` từ `@brighten/decision-core`. Driver **KHÔNG** tự viết veto/sizing/cost-hurdle. Chỉ **replay** (dựng ctx theo tick), **simulate** (duyệt giá tính R), **metrics**, **report** sống trong driver — đó là **đo lường**, không phải **quyết định**. [Source: ARCHITECTURE-SPINE.md#AD-3]
- Thời gian vào lõi qua `ClockPort` **tất định** (`fixedClock(tick.openTime)`), KHÔNG `Date.now()` — giữ NFR-1 tái lập và song song cách live lấy giờ qua clock. Lớp CLI ngoài accounting được phép `Date`/IO (driver, không bị lint core cấm). [Source: ARCHITECTURE-SPINE.md#AD-2, #Consistency → Thời gian; eslint.config.js (chỉ core bị cấm)]

### 🔑 Tái lập & một-precision-source

- NFR-1/AD-4: cùng dữ liệu + cùng config version → **cùng** `BacktestRun`. Đảm bảo bằng: duyệt tất định (thứ tự kline), `fixedClock`, **decimal wrapper dùng chung** (export `@brighten/decision-core/math`), không random. `BacktestRun` **nhúng config snapshot** (AD-4) để tái dựng. [Source: #AD-3, #AD-4; packages/decision-core/math/decimal.ts]
- **KHÔNG** cho driver tự `new Decimal`/tự set precision — phải qua wrapper export để cùng precision 40/ROUND_HALF_UP (bất biến determinism chốt ở 1.4). [Source: packages/decision-core/math/decimal.ts]

### Hợp đồng đã có (PHẢI tuân, đọc trước khi sửa)

| File | Trạng thái hôm nay | Story 1.8 đổi gì | Phải giữ nguyên |
| --- | --- | --- | --- |
| `apps/backtest-cli/src/main.ts` | scaffold in 1 dòng, import type `PipelineResult` | thay bằng CLI mỏng wiring adapter+config+runBacktest | — |
| `apps/backtest-cli/package.json` | dep chỉ `@brighten/decision-core`; **không** test script | +deps `@brighten/adapters`,`@brighten/config`; +test/vitest | `name`/`bin`/`build`/`lint` |
| `apps/backtest-cli/tsconfig.json` | references chỉ decision-core | +references adapters, config | rootDir/outDir |
| `decision-core/index.ts` | export ports/pipeline/tiers/types | +`export * from "./cost/round-trip.js"` | export cũ |
| `decision-core/package.json` | exports `.` + `./ports` | +`./math` subpath | `.`/`./ports` |
| `decision-core/pipeline/runner.ts` | `runPipeline`, `TierContext` có `cost?`/`candidate?`/`account?`/`expectedEdge?` | **không sửa** (driver bơm ctx qua field sẵn có) | toàn bộ |
| `tiers/tier3/index.ts` | đọc `ctx.cost.roundTripFee` cho cost-hurdle | **không sửa** (driver cấp `ctx.cost` từ cost model) | toàn bộ |
| `packages/config/src/schema.ts` | `ConfigParams` có `cost_hurdle_x`; **không** có fee/spread/slippage | +`fee_rate`/`spread`/`slippage` (additive, `>=0`) | param cũ, `validateParams`, `DEFAULT_PARAMS` cũ |
| `packages/adapters/binance-rest` | `createBinanceRestIngestion(deps): IngestionPort` (1.7) | **không sửa** — chỉ tiêu thụ | toàn bộ |

[Source: apps/backtest-cli/*; packages/decision-core/index.ts, package.json, pipeline/runner.ts, tiers/tier3/index.ts, math/decimal.ts; packages/config/src/schema.ts; packages/adapters/binance-rest/index.ts]

### Đặc tả số học (một nguồn sự thật)

```text
# computeRoundTripCost (core, thuần)
perSide = (fee_rate + spread + slippage) × notional        # mul/add decimal
base    = perSide × 2                                       # vào + ra
funding = Σ(fundingRate_i × notional)  trên fundingPoints   # 0 nếu vắng (FX/không perp)
cost    = base + funding
kiểm trước: notional ≥ 0 ; mọi input parse decimal ; else reject source="cost.round_trip"
```

```text
# simulate (driver, tất định trên klines sau entry)
long : chạm target nếu high ≥ target trước khi low ≤ stop ; ngược lại chạm stop
short: đối xứng
grossR = |exit − entry| / |entry − stop|   (dấu theo thắng/thua)
netR   = grossR − (realizedCost / riskAmount)     # realizedCost = computeRoundTripCost(notional thực, funding thực)
không chạm tới hết dữ liệu ⇒ đóng ở close cuối (ghi rõ, tất định)
```

```text
# metrics (driver, thuần)
expectancy   = mean(netR)                     # decimal
equityCurve  = tích luỹ netR
maxDrawdown  = max(peak − trough) trên equityCurve
rDistribution= gom bin netR (đếm tất định)
winRateReference = count(netR>0)/n   # GẮN NHÃN "tham khảo", không headline
```

Mọi phép qua `@brighten/decision-core/math` (cùng precision). [Source: packages/decision-core/math/decimal.ts]

### Invariant kiến trúc PHẢI tuân

- **AD-3 — một engine, hai driver:** backtest import cùng `decision-core`; cấm cài lại luật quyết định trong driver. [Source: #AD-3]
- **AD-4 — config snapshot cùng mỗi quyết định:** cost params versioned; `BacktestRun` nhúng snapshot; đổi param ⇒ version mới, kết quả cũ tái dựng được. [Source: #AD-4]
- **AD-2/NFR-1 — tất định:** accounting không `Date.now()`/random; clock tất định; decimal một-precision; cùng dữ liệu+version → cùng kết quả. [Source: #AD-2]
- **AD-12 — suy diễn trong lõi:** cost model + (tương lai) CVD/regime trong core; adapter chỉ giao thô. [Source: #AD-12]
- **Triết lý sản phẩm:** win rate là nhãn "tham khảo", expectancy ròng + drawdown là chỉ số uy tín chính (chống "cảm giác thắng"). [Source: epics.md → 1.8 AC]

### Ngoài phạm vi story này (đừng làm — để story sau)

- **Chống overfit: walk-forward, holdout, Monte-Carlo khoảng tin cậy, forward paper-trade, trần số tham số** — **Story 1.9** (FR-9). 1.8 chỉ chạy một backtest thẳng + metrics.
- **Sinh candidate/edge THẬT (Tầng 1 regime/edge, Tầng 2 price-action)** — **epic 2**. 1.8 bơm qua `BacktestStrategyInput` (fixture).
- **Persist `BacktestRun` vào Postgres** — story persistence/adapter postgres. 1.8 giữ `BacktestRun` in-memory + in ra (đã nhúng config snapshot để sẵn sàng persist).
- **Live-tick driver (`cron-runner`) dùng cùng adapter/core** — epic 3 vận hành. 1.8 là nhánh backtest.
- **Tích luỹ `BehavioralState` từ kết quả lệnh mô phỏng (feedback loop)** — AD-6/AD-7, story feedback. 1.8 bơm state theo tick (fixture); backtest có thể mô phỏng tiến hoá state đơn giản nếu cần cho demo, nhưng **không** dựng feedback/persistence thật.
- **Mô hình chi phí nâng cao** (orderbook-depth slippage, maker/taker phân biệt theo lệnh, funding theo mốc 8h thực tế của sàn) — v1 giữ mô hình phí tuyến tính theo notional + funding từ `MarketSnapshot.funding`; tinh chỉnh sau (ghi chú, không làm).

### Source tree mục tiêu (phần thêm/đổi)

```text
packages/config/src/
  schema.ts                          # UPDATE: + fee_rate/spread/slippage (additive, >=0)
  schema.test.ts / snapshot.test.ts  # UPDATE: cover param mới
packages/decision-core/
  cost/round-trip.ts                 # NEW: computeRoundTripCost (thuần)
  cost/round-trip.test.ts            # NEW
  index.ts                           # UPDATE: export cost
  package.json                       # UPDATE: + "./math" export subpath
  pipeline/runner.test.ts            # UPDATE: fixture ConfigParams += fee/spread/slippage
  tiers/tier3/index.test.ts          # UPDATE: fixture ConfigParams += fee/spread/slippage
apps/backtest-cli/
  package.json                       # UPDATE: + deps adapters/config, + test script
  tsconfig.json                      # UPDATE: + references adapters/config
  vitest.config.ts                   # NEW
  src/
    clock.ts                         # NEW: fixedClock
    replay.ts                        # NEW: dựng ctx + runPipeline (tier thật)
    simulate.ts                      # NEW: duyệt giá → grossR/netR
    metrics.ts                       # NEW: expectancy/drawdown/R-dist/equity
    run.ts                           # NEW: runBacktest → BacktestRun (nhúng snapshot)
    main.ts                          # UPDATE: CLI mỏng wiring adapter thật
    *.test.ts                        # NEW: ingestion giả + fixture
```
[Source: ARCHITECTURE-SPINE.md#Structural Seed → apps/backtest-cli + decision-core; bố cục test 1.5–1.7 làm khuôn]

### Project Structure Notes

- Tách **thuần (replay/simulate/metrics/run)** khỏi **IO/CLI (main.ts)**: metrics/simulate test được không cần mạng (tiêm `IngestionPort` giả). Song song cách tách của core.
- Reuse: `runPipeline`+tier thật+`computeRoundTripCost`+`math` từ core; `IngestionPort`/`createBinanceRestIngestion` từ 1.7; `ConfigSnapshot`/`snapshot`/`DEFAULT_PARAMS`/`createConfigVersion` từ `@brighten/config`.
- Rủi ro hồi quy: thêm cost params là **thay đổi additive** chạm `@brighten/config` (1.2) → fixture `ConfigParams` cứng ở test core/config phải cập nhật (grep `DEFAULT_PARAMS`/`cost_hurdle_x` để tìm hết). Không đổi param cũ/`validateParams` core logic.
- `apps/backtest-cli` là app Node (không phải core) ⇒ được IO/`Date` ở CLI; nhưng giữ accounting tất định qua `fixedClock` + decimal export. Không thêm `decimal.js` trực tiếp vào app — dùng `@brighten/decision-core/math` (một-precision-source).
- Node 22 (`fetch` global) cho adapter; backtest lịch sử chạy on-demand từ CLI (không always-on, AD-1).

### Chuẩn test

- Vitest (thêm cho `apps/backtest-cli`). Mỗi AC ≥ 1 test. Tiêm `IngestionPort` giả — **không mạng thật**.
- **Số cụ thể**: `computeRoundTripCost` tính tay (vd cost="16" ở Dev Notes); simulate hit target/stop trên fixture klines biết trước → R ròng đúng đến chữ số; metrics trên chuỗi netR biết trước.
- **Dùng core thật**: test bơm state khiến Tầng 0 veto ⇒ 0 lệnh (chứng minh không bypass core); bơm candidate hợp lệ ⇒ có lệnh.
- **Tái lập** (2 lần `toEqual` cả `BacktestRun`), **không mutate** snapshot/config (`structuredClone`), **không leak `number`** (`typeof==="string"` cho mọi số tiền/R trong output).
- **Win-rate nhãn**: assert output có trường/nhãn "tham khảo", không phải khoá chính.
- Không mạng/DB thật.

### References

- [Source: epics.md → Epic 1, Story 1.8] — AC gốc: bơm lịch sử vào cùng decision-core (AD-3); cộng phí+spread+slippage+funding; xuất expectancy ròng (R), max drawdown, phân phối R, equity; win rate chỉ "tham khảo"; cùng dữ liệu+config version → cùng kết quả
- [Source: ARCHITECTURE-SPINE.md#AD-3] — một engine, hai driver; cấm cài lại luật trong driver
- [Source: ARCHITECTURE-SPINE.md#AD-4] — config snapshot nhúng vào `BacktestRun`; tham số versioned
- [Source: ARCHITECTURE-SPINE.md#AD-2, #Consistency → Determinism/Thời gian/Tiền tệ] — tất định, clock port, decimal-string
- [Source: ARCHITECTURE-SPINE.md#AD-12] — suy diễn (gồm cost) trong lõi; adapter giao thô
- [Source: ARCHITECTURE-SPINE.md#Capability Map] — FR-8/9 backtest lives in `apps/backtest-cli` + `decision-core`
- [Source: 1-5-cost-hurdle-cost-gate.md] — `CostEstimate.roundTripFee` "produced by fee model in 1.8"; cost-hurdle Tầng 3 tiêu thụ `ctx.cost.roundTripFee`
- [Source: 1-7-binance-historical-ingestion-adapter.md] — `IngestionPort`/`createBinanceRestIngestion` + `MarketSnapshot` (klines/funding) mà backtest bơm
- [Source: packages/decision-core/pipeline/runner.ts] — `runPipeline`/`TierContext` (field `cost?`/`candidate?`/`account?`/`expectedEdge?` để driver bơm)
- [Source: packages/decision-core/tiers/tier3/index.ts; sizing.ts] — sizing volume/riskAmount + cost-hurdle tiêu thụ `ctx.cost`
- [Source: packages/decision-core/math/decimal.ts] — wrapper precision-một-chỗ; export `./math` để driver tái dùng
- [Source: packages/config/src/index.ts; schema.ts; snapshot.ts] — `snapshot`/`createConfigVersion`/`DEFAULT_PARAMS`/`ConfigSnapshot`; pattern thêm param
- [Source: apps/backtest-cli/*] — scaffold hiện tại + cấu hình cần bổ sung deps/test

## Dev Agent Record

### Agent Model Used

claude-opus-4-8 (Claude Code, dev-story workflow)

### Debug Log References

- `pnpm -r typecheck && pnpm -r build && pnpm -r lint && pnpm -r test` — tất cả pass (exit 0).
- backtest-cli: 18 test pass (simulate/metrics/replay/run). decision-core: 90 pass. config: 38 pass. adapters: 10 pass.

### Completion Notes List

- **AC1** `computeRoundTripCost` là hàm **thuần trong core** (`packages/decision-core/cost/round-trip.ts`), một nguồn chi phí duy nhất: replay dùng nó ước lượng `ctx.cost.roundTripFee` cho cổng cost-hurdle Tầng 3, simulate dùng nó (notional thực + funding thực) trừ vào P&L. `perSide=(fee+spread+slippage)×notional; base=perSide×2; funding=Σ(rate×notional); cost=base+funding`. Reject `notional<0`/parse rác (`source:"cost.round_trip"`). Hỗ trợ funding âm (nhận funding).
- **AC2** Thêm `fee_rate`/`spread`/`slippage` (decimal `>=0`) vào `ConfigParams`/`DEFAULT_PARAMS`/`fieldNames`/`validateParams` qua helper mới `validateNonNegativeDecimalField` (cho phép `0`). Thuần additive — không đổi `cost_hurdle_x`/param cũ. `BacktestRun` nhúng `configSnapshot` (AD-4).
- **AC3** `replay` import & gọi **CÙNG** `runPipeline` + `createTier0/1Stub/2Stub/3` thật; thời gian vào lõi qua `fixedClock(kline.openTime)` (không `Date.now()` trong accounting). candidate/expectedEdge/state/account bơm qua seam `BacktestStrategyInput` (fixture epic 1). Không có luật quyết định trong driver — chỉ replay/simulate/metrics/report.
- **AC4** `simulate` duyệt klines sau entry (`high`/`low`) → chạm stop/target; `grossR=signedMove/stopDistance`; `netR=grossR−realizedCost/riskAmount`. Quy ước tất định (ghi rõ trong code): cùng nến chạm cả 2 mức ⇒ **stop thắng** (trung thực); không chạm tới hết dữ liệu ⇒ đóng ở close nến cuối. Funding chỉ cộng khi có `MarketSnapshot.funding` trong cửa sổ giữ.
- **AC5** `metrics`: `expectancy` (mean netR), `maxDrawdown` (trên equity tích luỹ), `rDistribution` (gom theo giá trị netR chính xác, sort tăng — tất định), `equityCurve`. `winRateReference` **chỉ nhãn tham khảo** — không có trường headline `winRate`. Mọi số là decimal-string.
- **AC6** `runBacktest` 2 lần → `toEqual` (tất định: duyệt theo thứ tự kline, fixedClock, decimal một-precision qua `@brighten/decision-core/math`, không random). Không mutate `MarketSnapshot` đầu vào (test `structuredClone`).
- **AC7** `apps/backtest-cli` thêm deps `@brighten/adapters`/`@brighten/config`/`@types/node`, `vitest.config.ts` + `test`/`test:watch`; test tiêm `IngestionPort` giả (không mạng). Bốn lệnh DoD pass.
- **Quyết định kỹ thuật:** (1) Export `sizeTrade` (giá trị) từ `tiers/tier3/index.ts` để driver **tái dùng** đúng công thức sizing của core (không cài lại — AD-3); replay tính sizing qua `evaluateWinStreakDampening` + `sizeTrade` giống hệt Tầng 3. (2) Thêm `apps/backtest-cli/tsconfig.build.json` reference các `tsconfig.build.json` của deps ⇒ **dist backtest-cli sạch** (không lọt `*.test.*`); `src/test-support.ts` (fixtures) bị loại khỏi build. (3) Tách types dùng chung ra `src/types.ts`.
- **Lưu ý pre-existing (ngoài phạm vi 1.8):** `pnpm -r build` khiến `packages/decision-core/dist` & `packages/config/dist` chứa `*.test.js` — do `apps/cron-runner` và `packages/adapters` reference `decision-core/tsconfig.json` (composite, include test). Hiện tượng này **có sẵn trước story 1.8** (thấy `dist/pipeline/runner.test.js` ngay đầu session) và nằm ngoài danh sách file của 1.8. Deliverable mới `apps/backtest-cli/dist` đã sạch tuyệt đối.

### File List

**Mới (NEW):**
- `packages/decision-core/cost/round-trip.ts`
- `packages/decision-core/cost/round-trip.test.ts`
- `apps/backtest-cli/tsconfig.build.json`
- `apps/backtest-cli/vitest.config.ts`
- `apps/backtest-cli/src/clock.ts`
- `apps/backtest-cli/src/types.ts`
- `apps/backtest-cli/src/replay.ts`
- `apps/backtest-cli/src/simulate.ts`
- `apps/backtest-cli/src/metrics.ts`
- `apps/backtest-cli/src/run.ts`
- `apps/backtest-cli/src/test-support.ts`
- `apps/backtest-cli/src/simulate.test.ts`
- `apps/backtest-cli/src/metrics.test.ts`
- `apps/backtest-cli/src/replay.test.ts`
- `apps/backtest-cli/src/run.test.ts`

**Sửa (MODIFIED):**
- `packages/config/src/schema.ts`
- `packages/config/src/schema.test.ts`
- `packages/decision-core/index.ts`
- `packages/decision-core/package.json`
- `packages/decision-core/tiers/tier3/index.ts`
- `packages/decision-core/pipeline/runner.test.ts`
- `packages/decision-core/tiers/tier3/index.test.ts`
- `packages/decision-core/tiers/tier0/index.test.ts`
- `packages/decision-core/tiers/tier0/behavioral-veto.test.ts`
- `apps/backtest-cli/package.json`
- `apps/backtest-cli/tsconfig.json`
- `apps/backtest-cli/src/main.ts`

## Change Log

| Date | Version | Change |
| --- | --- | --- |
| 2026-07-04 | 0.1 | Triển khai Story 1.8: cost params versioned (config), `computeRoundTripCost` thuần trong core, export `./math` + `sizeTrade`, backtest engine (clock/replay/simulate/metrics/run) + CLI mỏng wiring adapter thật, hạ tầng test backtest-cli. Status → review. |
