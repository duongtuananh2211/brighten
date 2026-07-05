---
baseline_commit: cfae2a46e98a2ac6b5e1bf9e97fc672533fa2161
depends_on: 2-3-fx-news-calendar-blackout
---

# Story 2.4: Tầng 2 — Khoanh vùng điểm vào (FR-3)

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **người dùng của Brighten**,
I want **Tầng 2 — hàm THUẦN, tất định — tự khoanh vùng điểm vào (entry/stop/target dạng `TradeCandidate`) từ price action, CHỈ theo hướng Tầng 1 cho phép; khi không có setup đạt chuẩn ⇒ "chờ" (veto im lặng); và một seam luồng payload giữa các tầng (`runPipeline` mang `direction` từ Tầng 1 → Tầng 2, `candidate` từ Tầng 2 → Tầng 3)**,
so that **tôi có điểm vào rõ để tự xác nhận trên sàn mà hệ thống KHÔNG bao giờ đề xuất ngược hướng, KHÔNG ép ra setup, và KHÔNG tự đặt lệnh (FR-3, AD-5, AD-2, AD-10)**.

## Acceptance Criteria

**AC1 — Cross-tier payload seam: `runPipeline` mang `direction`/`candidate` xuôi chiều (giải toả deferral 2.1/2.2)**
**Given** `runPipeline` hiện chỉ luồng pass/veto; `TierContext` có `candidate?`/`account?` được bơm ngoài
**When** thêm seam luồng payload
**Then** mở rộng nhánh **pass** của `TierOutcome`: `{ kind: "pass"; enrich?: TierPassEnrichment }` với `TierPassEnrichment = { readonly direction?: TradeDirection; readonly candidate?: TradeCandidate }`; thêm `readonly direction?: TradeDirection` vào `TierContext`
**And** `runPipeline` sau mỗi tier **pass** hợp nhất `enrich` vào ctx cho các tier sau (`ctx = { ...ctx, ...outcome.enrich }`) — tầng sau đọc được `direction`/`candidate` tầng trước sinh; nhánh **veto** không đổi (dừng ngay, silent)
**And** **backward-compatible**: `{ kind: "pass" }` (không `enrich`) vẫn hợp lệ; tier0/tier3 hiện trả `{ kind: "pass" }` **không đổi**; `PipelineResult` shape **không đổi**; `candidate` bơm-ngoài trong `base` vẫn dùng được (Tầng 2 stub không ghi đè)

**AC2 — Tầng 1 phát `direction` qua enrich (nối 2.1/2.2 vào seam)**
**Given** `createTier1Crypto()` (2.1) và `createTier1Fx()` (2.2) hiện trả `{ kind: "pass" }`, **vứt** `direction` đã suy
**When** nối vào seam
**Then** cả hai đổi thành `ok:true ⇒ { kind: "pass", enrich: { direction: outcome.direction } }` (crypto: `evaluateCryptoRegime().direction`; FX: `evaluateFxRegime().direction`); nhánh veto không đổi
**And** cập nhật test wiring 2.1/2.2 (`tier1/index.test.ts`) khẳng định `pass` **kèm** `enrich.direction` đúng; **KHÔNG** đổi `evaluateCryptoRegime`/`evaluateFxRegime`/`createTier1`/dispatcher/stub

**AC3 — Tầng 2 CHỈ khoanh vùng ĐÚNG hướng Tầng 1; không đề xuất ngược hướng**
**Given** một `direction` (`long`/`short`) trong `ctx.direction` (do Tầng 1 enrich) và `MarketSnapshot` với `klines[]`
**When** `createTier2().run(ctx)` chạy
**Then** `evaluateEntryZone({ direction, snapshot, params })` dựng `TradeCandidate = { direction, entry, stop, target }` **đúng `direction`** (đặc tả cố định ở Dev Notes) — long ⇒ `stop < entry < target`; short ⇒ `target < entry < stop`; **KHÔNG** bao giờ sinh candidate hướng ngược `ctx.direction`
**And** `ctx.direction === undefined` (assembly sai — Tầng 1 không chạy trước/không enrich) ⇒ veto `missing_direction` (thủ phòng), KHÔNG tự đoán hướng
**And** `ok:true ⇒ { kind: "pass", enrich: { candidate } }`; candidate xuôi tới Tầng 3 (đã đọc `ctx.candidate`)

**AC4 — Không có setup đạt chuẩn ⇒ "chờ" (veto im lặng), KHÔNG ép Đề xuất**
**Given** price action không cho vùng vào hợp lệ theo hướng
**When** Tầng 2 chạy
**Then** trả `{ ok: false, error }` (`source: "tier2.entry_zone"`) với `code`:
  - `insufficient_data` — `klines.length < max(tier2_min_data_points, tier2_swing_lookback + 1)` hoặc swing range = 0 (AD-11)
  - `no_setup` — move đã cạn (long: `close ≥ target`; short: `close ≤ target`) hoặc vùng thoái hoá (stop == entry) ⇒ **chờ**
**And** `createTier2()` map `ok:false ⇒ { kind: "veto", tier: "tier2", reason: formatReason(error) }` ⇒ `runPipeline` dừng, silent — **không** ép ra Đề xuất (AD-5)

**AC5 — Vùng vào ở dạng người dùng đọc & xác nhận được; KHÔNG tự đặt lệnh (AD-10)**
**Given** candidate Tầng 2 sinh
**When** pass tới Tầng 3 / Đề xuất
**Then** `TradeCandidate` (entry/stop/target decimal-string + direction) là **dữ liệu người-đọc-được**, đủ để user tự xác nhận thủ công trên sàn; hàm Tầng 2 **thuần** — KHÔNG IO/network/đặt-lệnh (AD-10: không đường code tự gửi lệnh)
**And** Tầng 2 **chỉ** trả candidate (data) + `signals` (swingHigh/Low/range) để audit tái dựng vùng; **persist**/hiển thị là story sau (Đề xuất/UI)

**AC6 — Tất định + thuần (AD-2, AD-12)**
**Given** cùng `(direction, snapshot, config)`
**When** gọi Tầng 2 nhiều lần
**Then** output **bằng nhau tuyệt đối** (deep-equal); thứ tự kiểm cố định: `insufficient_data` → (dựng vùng) → `no_setup`
**And** hàm **thuần**: không mutate `snapshot`/`config`, không `Date.now()`/`Math.random()`/IO (lint `decision-core`, AD-2); không đọc `nowEpochMillis`
**And** mọi so sánh/số học giá qua `math/decimal.ts` (`cmp`/`sub`/`mul`/`div`); `max`/`min` helper cục bộ (tái dùng cách 2.2) — KHÔNG `Number(...)`, KHÔNG leak `number` giá (price-action trong lõi ⇒ live/backtest giống hệt, AD-12)

**AC7 — Ngưỡng vùng vào là config CÓ PHIÊN BẢN (AD-4); thêm additive, không phá param cũ**
**Given** `packages/config` (đã có param 2.1/2.2/2.3)
**When** thêm ngưỡng Tầng 2
**Then** thêm **additive** vào `ConfigParams` + `DEFAULT_PARAMS` + `fieldNames` + `validateParams`:
  - `tier2_swing_lookback` (integer ≥ 1) — cửa sổ dựng vùng thanh khoản cho entry
  - `tier2_stop_buffer` (decimal-string ≥ 0) — khoảng stop ngoài mức vào, tỷ lệ `× range`
  - `tier2_min_data_points` (integer ≥ 1)
**And** validate nhân bản pattern có sẵn (`isPositiveInteger`/`validateNonNegativeDecimalField`); config sai miền ⇒ `invalid_tier2_param`; **KHÔNG** đổi param cũ, `version.ts`, `store.ts`, `snapshot.ts`

**AC8 — Từ chối input phi lý + Test phủ từng AC + toolchain sạch**
**Given** input giá rác (`high/low/close` không parse), config sai miền, Vitest (nền epic 1 + 2.1/2.2)
**When** thêm test cho seam + Tầng 1 enrich + `evaluateEntryZone` + wiring + config
**Then** input giá rác ⇒ `invalid_decimal_string` (`source: "tier2.entry_zone"`); config sai miền ⇒ `invalid_tier2_param`; và test cho: seam luồng `direction`/`candidate` qua `runPipeline` (tier trước enrich ⇒ tier sau đọc được); tier0/tier3 pass cũ **không đổi**; Tầng 1 crypto/FX pass **kèm** `enrich.direction`; long ⇒ `stop<entry<target`, short ⇒ `target<entry<stop` (số tính tay); ngược `ctx.direction` **không bao giờ** xảy ra; `missing_direction` khi thiếu direction; `no_setup` (close ≥/≤ target) & `insufficient_data` (thiếu kline/range 0); tất định (2× `toEqual`); không mutate (`structuredClone`); không leak number; wiring `createTier2()` veto/pass; `runPipeline` end-to-end tier1→tier2→tier3 với candidate Tầng-2-sinh chảy tới Tầng 3
**And** `pnpm -r typecheck && pnpm -r build && pnpm -r lint && pnpm -r test` **tất cả pass**; `*.test.ts` KHÔNG lọt `dist/`

## Tasks / Subtasks

- [x] **Task 1 — Cross-tier payload seam trong `runPipeline` (AC: #1)**
  - [x] `packages/decision-core/pipeline/runner.ts`:
    - `TierPassEnrichment = { readonly direction?: TradeDirection; readonly candidate?: TradeCandidate }`
    - `TierOutcome` nhánh pass ⇒ `{ readonly kind: "pass"; readonly enrich?: TierPassEnrichment }` (giữ nhánh veto y nguyên)
    - `TierContext` thêm `readonly direction?: TradeDirection` (cạnh `candidate?`)
    - `runPipeline`: dùng biến `let ctx`; sau mỗi tier pass ⇒ `if (outcome.enrich) ctx = { ...ctx, ...outcome.enrich }`; veto ⇒ trả silent như cũ; import `TradeDirection` từ types
  - [x] **KHÔNG** đổi `PipelineResult`, `PipelineBaseContext`, chữ ký `runPipeline`. Backward-compat: tier trả `{ kind: "pass" }` vẫn chạy
  - [x] `packages/decision-core/pipeline/runner.test.ts`: **UPDATE** — thêm test: tier A pass `enrich:{direction:"long"}` ⇒ tier B `run` thấy `ctx.direction==="long"`; tier B pass `enrich:{candidate}` ⇒ tier C thấy `ctx.candidate`; test cũ (stub pass/veto/thứ tự/determinism) giữ nguyên xanh

- [x] **Task 2 — Tầng 1 phát `direction` qua enrich (AC: #2)**
  - [x] `packages/decision-core/tiers/tier1/index.ts`: trong `createTier1Crypto().run` và `createTier1Fx().run`, nhánh `outcome.ok` ⇒ `{ kind: "pass", enrich: { direction: outcome.direction } }` (thay `{ kind: "pass" }`). Nhánh veto không đổi; `formatReason`/`formatReasonFx`/dispatcher/stub không đổi
  - [x] `packages/decision-core/tiers/tier1/index.test.ts`: **UPDATE** — assertion pass đổi sang `toEqual({ kind: "pass", enrich: { direction: <đúng> } })` cho cả crypto & FX; giữ mọi test veto/reason/stub

- [x] **Task 3 — Thêm ngưỡng Tầng 2 vào `@brighten/config` (additive) (AC: #7)**
  - [x] `packages/config/src/schema.ts`: thêm `tier2_swing_lookback: number`, `tier2_stop_buffer: string`, `tier2_min_data_points: number` vào `ConfigParams` + `DEFAULT_PARAMS` (`tier2_swing_lookback: 20`, `tier2_stop_buffer: "0.1"`, `tier2_min_data_points: 21`) + `fieldNames`
  - [x] Validate: `tier2_swing_lookback`/`tier2_min_data_points` qua `isPositiveInteger`; `tier2_stop_buffer` qua `validateNonNegativeDecimalField`. Sai miền số nguyên/decimal ⇒ code có sẵn; (không cần `invalid_tier2_param` ở config nếu pattern có sẵn phủ — dùng `invalid_positive_integer`/`invalid_non_negative_decimal_string`). Ghép vào object trả về
  - [x] **KHÔNG** đổi param cũ, `version/store/snapshot`
  - [x] `packages/config/src/schema.test.ts`: **UPDATE** — assert 3 mặc định mới; `tier2_swing_lookback:0` ⇒ `invalid_positive_integer`; `tier2_stop_buffer:"-1"` ⇒ `invalid_non_negative_decimal_string`; thiếu field ⇒ `missing_config_param`

- [x] **Task 4 — Luật khoanh vùng THUẦN `evaluateEntryZone` (trái tim FR-3) (AC: #3, #4, #5, #6, #8)**
  - [x] `packages/decision-core/tiers/tier2/entry-zone.ts`: **NEW** — hàm thuần
    `evaluateEntryZone(input: EntryZoneInput): EntryZoneOutcome` với:
    - `EntryZoneInput = { direction: TradeDirection; snapshot: MarketSnapshot; params: ConfigParams }` (đọc **chỉ** `snapshot.klines`)
    - `EntryZoneSignals = { swingHigh: string; swingLow: string; range: string }`
    - `EntryZonePass = { ok: true; candidate: TradeCandidate; signals: EntryZoneSignals }`
    - `EntryZoneRejection = { ok: false; error: CoreError }` (`source: "tier2.entry_zone"`)
    - `EntryZoneOutcome = EntryZonePass | EntryZoneRejection`
  - [x] Trình tự (thứ tự cố định, AC6):
    1. Kiểm miền config: `tier2_swing_lookback ≥ 1`, `tier2_min_data_points ≥ 1` (int), `tier2_stop_buffer ≥ 0` — sai ⇒ `invalid_tier2_param`
    2. `insufficient_data`: `klines.length < max(tier2_min_data_points, tier2_swing_lookback + 1)`
    3. `window` = `tier2_swing_lookback` kline cuối; `swingHigh = max(high)`, `swingLow = min(low)` (parse decimal; rác ⇒ `invalid_decimal_string`); `range = sub(swingHigh, swingLow)`; `range == 0` ⇒ `insufficient_data`
    4. `lastClose = klines[len-1].close`; dựng candidate theo `direction` (đặc tả Dev Notes): long ⇒ entry=swingLow, stop=`sub(swingLow, mul(tier2_stop_buffer, range))`, target=swingHigh; short ⇒ entry=swingHigh, stop=`add(swingHigh, mul(tier2_stop_buffer, range))`, target=swingLow
    5. `no_setup`: long & `cmp(lastClose, target) >= 0`; short & `cmp(lastClose, target) <= 0`; hoặc `stopDistance == 0` (buffer 0) ⇒ reject `no_setup`
    6. `ok:true` với `candidate` + `signals`
  - [x] Mọi số học giá qua `math/decimal.ts`; `max`/`min` helper cục bộ (`cmp`). Hàm **thuần**, không `nowEpochMillis`, không IO (AC5)

- [x] **Task 5 — Nối Tầng 2 thật vào pipeline (AC: #3, #4)**
  - [x] `packages/decision-core/tiers/tier2/index.ts`: thêm `createTier2(): Tier` (id `"tier2"`) — `run(ctx)`: nếu `ctx.direction === undefined` ⇒ `{ kind: "veto", tier: "tier2", reason: "missing_direction" }`; else `evaluateEntryZone({ direction: ctx.direction, snapshot: ctx.input, params: ctx.config.params })`; `ok:false ⇒ veto formatReason`; `ok:true ⇒ { kind: "pass", enrich: { candidate: outcome.candidate } }`. Thêm `formatReason` (song song tier khác)
  - [x] **GIỮ** `createTier2Stub`/`tier2Stub`/`Tier2StubOptions` (backtest `defaultTiers()` dùng stub — không đổi). Export `createTier2`, `evaluateEntryZone` + kiểu (`EntryZoneInput/Outcome/Pass/Rejection/Signals`). `tiers/index.ts`/`decision-core/index.ts` đã `export *` ⇒ tự lan (kiểm không xung đột tên)
  - [x] **KHÔNG** đổi `apps/backtest-cli` (`defaultTiers()` vẫn `createTier2Stub()` + candidate bơm-ngoài) — swap real tier2 + reconcile `replay.ts` là **story 2.5**

- [x] **Task 6 — Cập nhật fixtures `ConfigParams` cứng shape (AC: #7, #8)**
  - [x] Thêm 3 field Tầng 2 vào **mọi** literal `ConfigParams` trong test: `pipeline/runner.test.ts`, `tiers/tier0/behavioral-veto.test.ts` (mọi inline), `tiers/tier0/index.test.ts`, `tiers/tier3/index.test.ts`, `tiers/tier1/crypto-regime.test.ts`, `tiers/tier1/fx-regime.test.ts`. Dùng mặc định
  - [x] `apps/backtest-cli` dùng `{ ...DEFAULT_PARAMS }` (test-support) ⇒ **tự đúng**, không sửa. `store.test.ts`/`snapshot.test.ts` từ `DEFAULT_PARAMS` ⇒ tự đúng

- [x] **Task 7 — Tests (AC: #1..#8)**
  - [x] `packages/decision-core/tiers/tier2/entry-zone.test.ts`: **NEW** — long candidate số tính tay (`swingLow="1.1000"`, `swingHigh="1.1080"`, `range="0.0080"`, `tier2_stop_buffer="0.1"` ⇒ stop `"1.09920"`, entry `"1.1000"`, target `"1.1080"`, `stop<entry<target`); short mirror; ngược direction không xảy ra; `no_setup` (long `close="1.1080"` ≥ target); `insufficient_data` (thiếu kline / range 0); giá rác ⇒ `invalid_decimal_string`; config `tier2_swing_lookback:0` ⇒ `invalid_tier2_param`; tất định (2× `toEqual`); không mutate (`structuredClone`); không leak number
  - [x] `packages/decision-core/tiers/tier2/index.test.ts`: **NEW** — `createTier2()` `ok:true ⇒ pass + enrich.candidate`; `missing_direction` veto khi `ctx.direction` vắng; `no_setup`/`insufficient_data` veto reason đúng; `createTier2Stub()` vẫn pass
  - [x] `packages/decision-core/pipeline/runner.test.ts`: **UPDATE** (Task 1) — thêm end-to-end: `[createTier1Crypto?, createTier2(), createTier3()]` với direction enrich ⇒ candidate Tầng-2 chảy tới Tầng-3; hoặc dùng tier giả enrich direction rồi `createTier2()` sinh candidate
  - [x] `pnpm -r test` pass; xác nhận `dist/` không chứa `*.test.*`

## Dev Notes

> **Bối cảnh:** Story 2.4 là **story tích hợp** của epic 2 — nó (a) **giải toả seam luồng payload giữa các tầng** mà 1.4/1.5/1.6/2.1/2.2 đều hoãn, và (b) hiện thực **Tầng 2 khoanh vùng điểm vào (FR-3)**. Đây là lần đầu một tầng **tiêu thụ output** của tầng trước (`direction` từ Tầng 1) và **sinh output** cho tầng sau (`candidate` cho Tầng 3). Khuôn kỹ thuật bám 2.1/2.2: hàm thuần `evaluateEntryZone` tách khỏi `index.ts` mỏng, shape lỗi `{code,source,context}`, thứ-tự-kiểm-cố-định, `signals` đủ-log, config versioned, test biên/determinism/non-mutation.

> **Phụ thuộc:** build trên 2.1+2.2 (sửa `createTier1Crypto`/`createTier1Fx` để enrich direction) + 2.3 (config đã tiến). Làm sau 2.3. [Source: 2-1…md, 2-2…md, 2-3…md]

### 🔑 Giải toả mơ hồ: seam luồng payload — vì sao ở đây, làm thế nào tối thiểu

- **Tại sao bây giờ:** Tầng 2 **không thể** biết hướng nếu không nhận từ Tầng 1; Tầng 3 **không thể** size nếu không nhận candidate từ Tầng 2. Từ 1.4, `candidate` được **bơm ngoài** vào ctx (driver/test) như tạm-quyền. 2.4 là story đầu tiên có **hai tầng thật nối nhau** ⇒ đúng chỗ mở seam. [Source: 2-1…md/2-2…md → "Mang direction sang Tầng 2 … seam deferred, tiêu thụ ở 2.4"]
- **Thiết kế tối thiểu, backward-compatible:** chỉ **thêm** `enrich?` vào nhánh **pass** của `TierOutcome` + `direction?` vào `TierContext`; `runPipeline` merge `enrich` xuôi. Nhánh veto, `PipelineResult`, chữ ký `runPipeline` **không đổi**. Tier trả `{ kind: "pass" }` cũ (tier0/tier3) vẫn hợp lệ ⇒ **0 regression**. Đây là cách rẻ nhất giữ "một engine, hai driver" (AD-3) mà vẫn luồng dữ liệu. [Source: packages/decision-core/pipeline/runner.ts]
- **Vì sao KHÔNG đụng `apps/backtest-cli`:** `defaultTiers() = [createTier0(), createTier1Stub(), createTier2Stub(), createTier3()]` + `replay.ts` **bơm candidate từ fixtures** (`strategyInput.signals`). Stub Tầng 2 không enrich ⇒ candidate bơm-ngoài vẫn dùng. **Swap real tier1/tier2 vào `defaultTiers()` + reconcile `replay.ts` (bỏ candidate bơm-ngoài, đọc candidate pipeline-sinh) là story 2.5** (backtest toàn pipeline). 2.4 giữ driver nguyên ⇒ không vỡ backtest. [Source: apps/backtest-cli/src/run.ts, replay.ts]

### 🔑 Giải toả mơ hồ: "khoanh vùng điểm vào" cụ thể + "chờ" nghĩa là gì

- **Vùng vào theo hướng, dựng từ swing structure** (tái dùng ngữ cảnh vùng thanh khoản của 2.2, nhưng dùng để **đặt lệnh** chứ không phải suy hướng). Long ⇒ mua ở vùng cầu (swingLow), stop dưới vùng, target ở kháng cự (swingHigh). Short ⇒ mirror. `stop<entry<target` (long) / `target<entry<stop` (short) khớp `validateSide` của `sizing.ts` ⇒ Tầng 3 nhận candidate hợp lệ. [Source: packages/decision-core/tiers/tier3/sizing.ts#validateSide]
- **"Không setup đạt chuẩn → chờ" = `no_setup` veto:** điều kiện tất định — **move đã cạn** (long: giá đóng đã ≥ target ⇒ hết room; short: ≤ target) hoặc vùng thoái hoá (stopDistance 0). Đây là cách trung thực hiện "chờ" mà không cần chủ quan. **Chuẩn R:R** (`min_rr`) là việc **Tầng 3** (đã có) — Tầng 2 chỉ khoanh vùng; RR thấp ⇒ Tầng 3 veto `rr_below_min`. Không trùng trách nhiệm. [Source: packages/decision-core/tiers/tier3/index.ts, sizing.ts]
- **"KHÔNG tự đặt lệnh" (AC5, AD-10):** Tầng 2 là hàm **thuần** chỉ trả `TradeCandidate` (data). Không có đường IO/đặt-lệnh trong lõi (AD-10). Vùng vào là **dữ liệu người-đọc** để user tự xác nhận trên sàn. [Source: ARCHITECTURE-SPINE.md#AD-10]
- **Chỉ đúng hướng, KHÔNG ngược:** candidate.direction **luôn** = `ctx.direction`; luật dựng vùng chỉ có 2 nhánh long/short theo `direction`, không có đường nào sinh hướng ngược. Test khẳng định. [Source: prd.md#FR-3 "chỉ tìm điểm vào đúng hướng Tầng 1; không đề xuất ngược hướng"]

### Đặc tả luật Tầng 2 (một nguồn sự thật)

```text
# evaluateEntryZone(direction, snapshot, params) — thứ tự cố định; đọc CHỈ snapshot.klines
0. kiểm miền config: tier2_swing_lookback>=1(int), tier2_min_data_points>=1(int), tier2_stop_buffer>=0
     sai ⇒ invalid_tier2_param
1. insufficient_data: klines.length < max(tier2_min_data_points, tier2_swing_lookback + 1)
2. window = tier2_swing_lookback kline CUỐI:
     swingHigh = max(window.high) ; swingLow = min(window.low)   # rác ⇒ invalid_decimal_string
     range = swingHigh − swingLow ; range == 0 ⇒ insufficient_data
3. lastClose = klines[len-1].close ; buf = tier2_stop_buffer × range
   long : entry=swingLow ; stop=swingLow − buf ; target=swingHigh     # stop < entry < target
   short: entry=swingHigh; stop=swingHigh + buf ; target=swingLow     # target < entry < stop
4. no_setup:
     long  & lastClose >= target(swingHigh)     # move cạn ⇒ chờ
     short & lastClose <= target(swingLow)
     hoặc stopDistance == 0 (buf 0)
5. ⇒ { ok:true, candidate:{direction,entry,stop,target}, signals:{swingHigh,swingLow,range} }
source = "tier2.entry_zone" cho mọi rejection
```

> **Về luật cụ thể:** *cấu trúc* (swing pool → entry ở vùng thuận hướng, stop ngoài vùng, target ở cực đối, move-cạn⇒chờ) là **hợp đồng cố định**. Chi tiết (entry ngay tại swing extreme; 1 vùng/nhịp) là **mặc định tài liệu-hoá**; **ngưỡng số** (`tier2_swing_lookback`, `tier2_stop_buffer`) là **config deferred**, chốt qua backtest (AD-4). Đừng phát minh chỉ báo khác. [Source: ARCHITECTURE-SPINE.md#Deferred; #AD-4]

### Hợp đồng đã có (PHẢI tuân, đọc trước khi sửa)

| File | Trạng thái | Story 2.4 đổi gì | Phải giữ nguyên |
| --- | --- | --- | --- |
| `pipeline/runner.ts` | `TierOutcome` pass/veto; `TierContext`(input/state/config/candidate?/account?/…); `runPipeline` veto→silent | **+`enrich?`** vào pass; **+`direction?`** vào ctx; merge enrich xuôi | `PipelineResult`; `PipelineBaseContext`; chữ ký `runPipeline`; nhánh veto; nhánh suggestion cuối |
| `tiers/tier1/index.ts` | `createTier1Crypto`/`createTier1Fx` trả `{kind:"pass"}` (vứt direction); dispatcher/stub | **enrich direction** vào pass | `evaluate*Regime`; `createTier1`/dispatcher; stub; format |
| `tiers/tier2/index.ts` | chỉ `createTier2Stub`/`tier2Stub` (pass mặc định) | **+`createTier2()`** thật + `formatReason` | `createTier2Stub`/`tier2Stub`/`Tier2StubOptions`; hành vi stub pass |
| `tiers/tier3/index.ts`, `sizing.ts` | Tầng 3 đọc `ctx.candidate`; `validateSide` long `stop<entry<target` / short `target<entry<stop` | **KHÔNG sửa** (nhận candidate Tầng-2 hợp lệ) | toàn bộ |
| `types/index.ts` | `TradeCandidate`(direction/entry/stop/target), `Kline`, `TradeDirection`, `MarketSnapshot` | **không sửa** (đủ shape) | toàn bộ |
| `packages/config/src/schema.ts` | `ConfigParams` gồm param 2.1/2.2/2.3 | **+3 param Tầng 2** (additive) + validate | mọi param cũ; `version/store/snapshot` |
| `apps/backtest-cli/*` | `defaultTiers()` stub tier1/2 + candidate bơm-ngoài | **KHÔNG sửa** (2.5 swap real + reconcile) | `run.ts`/`replay.ts` |

[Source: packages/decision-core/pipeline/runner.ts; tiers/tier1/index.ts; tiers/tier2/index.ts; tiers/tier3/index.ts; sizing.ts; types/index.ts; packages/config/src/schema.ts; apps/backtest-cli/src/run.ts,replay.ts]

### Invariant kiến trúc PHẢI tuân

- **AD-5 — thứ tự gating & Tầng 2 theo hướng Tầng 1:** Tầng 2 sau Tầng 1, trước Tầng 3; chỉ khoanh vùng đúng hướng Tầng 1 cho phép; không setup ⇒ chờ (veto, silent). [Source: #AD-5]
- **AD-2 — thuần & tất định:** hàm thuần; không `Date`/random/IO (lint chặn); cùng input → cùng output (NFR-6). [Source: #AD-2]
- **AD-12 — suy diễn trong lõi:** dựng vùng (swing/price-action) trong `decision-core` ⇒ live/backtest giống hệt. [Source: #AD-12]
- **AD-11 — suy giảm mềm:** thiếu kline/range thoái hoá ⇒ `insufficient_data`. [Source: #AD-11]
- **AD-10 — không tự đặt lệnh:** Tầng 2 chỉ sinh data candidate; không đường IO/đặt-lệnh. [Source: #AD-10]
- **AD-3 — một engine, hai driver:** seam luồng payload nằm trong `decision-core` ⇒ live & backtest cùng luồng; driver không cài lại luật. [Source: #AD-3]
- **AD-4 — config có phiên bản:** ngưỡng Tầng 2 versioned. [Source: #AD-4]

### Ngoài phạm vi story này (đừng làm — để story sau)

- **Wiring `defaultTiers()` sang real tier1/tier2 + reconcile `replay.ts`** (bỏ candidate bơm-ngoài, đọc candidate pipeline-sinh, sizing từ candidate thật) — **story 2.5** (backtest toàn pipeline). 2.4 giữ driver nguyên.
- **`expectedEdge`/cost-hurdle end-to-end** — Tầng 3 cost-hurdle (1.5) đọc `ctx.expectedEdge` bơm-ngoài; suy `expectedEdge` từ candidate (target−entry) là 2.5. 2.4 KHÔNG enrich expectedEdge.
- **Đề xuất/UI hiển thị vùng vào** — FR-13 (`apps/web`), epic sau. 2.4 chỉ sinh `TradeCandidate` data.
- **Multi-timeframe / order-block / FVG / nhiều vùng vào** — luật 2.4 một-vùng-theo-swing. Mở rộng là v2.
- **Persist candidate/lần chờ vào Nhật ký** — AD-8, cần persistence adapter (epic 3).
- **Tầng 1 crypto/FX logic** — 2.1/2.2 xong; 2.4 chỉ nối `direction` vào enrich, KHÔNG đổi luật suy hướng.

### Source tree mục tiêu (phần thêm/đổi)

```text
packages/decision-core/
  pipeline/runner.ts                 # UPDATE: +enrich? (pass) + direction? (ctx) + merge xuôi
  pipeline/runner.test.ts            # UPDATE: seam threading + end-to-end; +3 field fixture
  tiers/tier1/index.ts               # UPDATE: pass ⇒ enrich.direction (crypto+FX)
  tiers/tier1/index.test.ts          # UPDATE: pass assertion + enrich.direction
  tiers/tier1/crypto-regime.test.ts, fx-regime.test.ts  # UPDATE: +3 field fixture
  tiers/tier2/
    entry-zone.ts                    # NEW: evaluateEntryZone() + Input/Pass/Rejection/Signals
    entry-zone.test.ts               # NEW
    index.ts                         # UPDATE: +createTier2() + formatReason; GIỮ stub
    index.test.ts                    # NEW: wiring + missing_direction
  tiers/tier0/behavioral-veto.test.ts, tier0/index.test.ts, tier3/index.test.ts  # UPDATE: +3 field fixture
packages/config/src/
  schema.ts                          # UPDATE: +3 param Tầng 2 (additive) + validate
  schema.test.ts                     # UPDATE: defaults + miền sai + missing field
```
[Source: ARCHITECTURE-SPINE.md#Structural Seed; bố cục 2.1/2.2 làm khuôn]

### Project Structure Notes

- Tách `entry-zone.ts` khỏi `index.ts` (song song `crypto-regime.ts`/`fx-regime.ts`): hàm thuần dễ test; `index.ts` chỉ nối pipeline + format + đọc `ctx.direction`.
- `max`/`min` giá: viết helper cục bộ bằng `cmp` (2.2 cũng vậy — nếu 2.2 đã có helper trong `fx-regime.ts`, cân nhắc chia sẻ; **khuyến nghị** giữ cục bộ mỗi module để tránh coupling chéo-tier, hoặc đặt ở `math/decimal.ts` nếu muốn dùng lại — quyết định nhỏ, ưu tiên thay đổi tối thiểu).
- Seam `enrich` là thay đổi **contract lõi** — cẩn thận: mọi tier trả pass phải hoặc `{kind:"pass"}` hoặc `{kind:"pass",enrich}`; TypeScript optional `enrich?` đảm bảo cũ vẫn compile. Kiểm `runner.test.ts` helper `allPassTiers` vẫn hợp lệ.
- Config: +3 field additive ⇒ mọi literal `ConfigParams` (gồm `fx-regime.test.ts`/`crypto-regime.test.ts`) phải thêm; apps `{...DEFAULT_PARAMS}` tự đúng.
- Xung đột tên: `EntryZone*` tiền tố; `createTier2` tên mới (grep xác nhận tier2 chỉ có stub).
- `apps/backtest-cli` **không đổi** ⇒ backtest tests xanh nguyên (stub tier2 + candidate bơm-ngoài).

### Chuẩn test

- Vitest; mỗi AC ≥ 1 test. Số cụ thể tính tay cho swing/entry/stop/target/range.
- **Seam**: tier giả A `run` trả `{kind:"pass",enrich:{direction:"long"}}` ⇒ tier giả B đọc `ctx.direction`; B enrich candidate ⇒ C đọc `ctx.candidate`. Chứng minh merge xuôi + veto vẫn dừng.
- **Tầng 1 enrich**: `createTier1Crypto()` trên snapshot ra hướng ⇒ `{kind:"pass",enrich:{direction}}`; tương tự FX.
- **Tầng 2 biên**: long/short candidate đúng cạnh (`stop<entry<target` / `target<entry<stop`); `no_setup` khi `close` chạm target; `insufficient_data` khi thiếu kline / range 0.
- **Ngược hướng KHÔNG xảy ra**: với direction="long", candidate.direction luôn "long" (không nhánh nào ra "short").
- **missing_direction**: `ctx.direction` vắng ⇒ `createTier2()` veto.
- **Tất định** (2× `toEqual`), **không mutate** (`structuredClone`), **không leak number** (`typeof entry === "string"`).
- **End-to-end**: `runPipeline([tierEnrichLong, createTier2(), createTier3()], base_with_account, clock)` ⇒ candidate Tầng-2 tới Tầng-3, sizing chạy (hoặc veto RR đúng).
- Không integration/DB.

### References

- [Source: epics.md → Epic 2, Story 2.4] — AC gốc (BDD): chỉ tìm điểm vào đúng hướng Tầng 1; không setup → chờ; vùng vào người-đọc-được, KHÔNG tự đặt lệnh
- [Source: prd.md#FR-3] — Tầng 2 khoanh vùng điểm vào (price action); chỉ đúng hướng Tầng 1, không đề xuất ngược; không setup → chờ; xuất dạng người dùng đọc & xác nhận
- [Source: ARCHITECTURE-SPINE.md#AD-5] — thứ tự gating; Tầng 2 chỉ tìm điểm vào theo hướng Tầng 1 cho phép
- [Source: ARCHITECTURE-SPINE.md#AD-2] — lõi thuần tất định (lint chặn IO/Date/random)
- [Source: ARCHITECTURE-SPINE.md#AD-10] — không đường code tự gửi lệnh; user xác nhận thủ công
- [Source: ARCHITECTURE-SPINE.md#AD-3] — một engine hai driver; seam luồng payload trong core, driver không cài lại luật
- [Source: ARCHITECTURE-SPINE.md#AD-11, #AD-12, #AD-4] — suy giảm mềm; suy diễn trong lõi; config versioned
- [Source: packages/decision-core/pipeline/runner.ts] — `TierOutcome`/`TierContext`/`runPipeline` điểm mở seam `enrich`/`direction`
- [Source: packages/decision-core/tiers/tier1/index.ts] — `createTier1Crypto`/`createTier1Fx` điểm enrich direction; `evaluate*Regime().direction`
- [Source: packages/decision-core/tiers/tier2/index.ts] — stub hiện tại mà 2.4 nối tiếp; giữ tên export
- [Source: packages/decision-core/tiers/tier3/sizing.ts] — `validateSide` (long `stop<entry<target`/short `target<entry<stop`), `zero_stop_distance`, `rr_below_min` — candidate Tầng 2 phải khớp
- [Source: packages/decision-core/tiers/tier3/index.ts] — Tầng 3 đọc `ctx.candidate` (nay do Tầng 2 enrich khi wiring 2.5)
- [Source: packages/decision-core/types/index.ts] — `TradeCandidate`/`TradeDirection`/`Kline`/`MarketSnapshot`
- [Source: apps/backtest-cli/src/run.ts, replay.ts] — `defaultTiers()` stub + candidate bơm-ngoài; điểm 2.5 sẽ reconcile (ngoài phạm vi 2.4)
- [Source: packages/config/src/schema.ts] — `ConfigParams`/`validateParams`; `isPositiveInteger`/`validateNonNegativeDecimalField` để nhân bản
- [Source: packages/decision-core/math/decimal.ts] — `cmp`/`sub`/`mul`/`add` để dựng vùng; `max`/`min` helper cục bộ
- [Source: 2-1…md, 2-2…md] — khuôn hàm-thuần/config-additive/fixtures + deferral seam mà 2.4 giải toả

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- 2026-07-04: Resolver script failed because shell Python lacks `tomllib` / Python 3.11; workflow customization was resolved manually from base config.
- 2026-07-04: Implemented pipeline pass enrichment seam and verified backward-compatible `{ kind: "pass" }` tiers still pass existing tests.
- 2026-07-04: Full `pnpm -r typecheck && pnpm -r build && pnpm -r lint && pnpm -r test` passed.
- 2026-07-04: Removed stale generated `dist/*.test.*` artifacts; verified both `rg --files -g 'dist/**' | rg '\.test\.'` and direct `find packages apps -path '*/dist/*' ...` return no test artifacts.

### Completion Notes List

- Added `TierPassEnrichment` and `direction` threading to `runPipeline`, preserving existing veto/result shapes and pass compatibility.
- Updated Tier 1 crypto/FX wiring to enrich `direction` on pass while preserving veto, dispatcher, and stub behavior.
- Added versioned Tier 2 config params and validation for swing lookback, stop buffer, and minimum data points.
- Implemented pure `evaluateEntryZone` that builds direction-preserving `TradeCandidate` values from swing structure with decimal math and deterministic rejection order.
- Added `createTier2()` real tier wiring that consumes `ctx.direction`, enriches `candidate`, and vetoes `missing_direction`/entry-zone failures; kept `createTier2Stub()` default pass.
- Added tests for payload seam threading, Tier 1 enrich, Tier 2 entry-zone math, no-setup/insufficient-data/invalid input, Tier 2 wiring, and candidate flow into downstream tiers.

### File List

- `_bmad-output/implementation-artifacts/2-4-tier2-entry-zone.md`
- `packages/config/src/schema.ts`
- `packages/config/src/schema.test.ts`
- `packages/decision-core/pipeline/runner.ts`
- `packages/decision-core/pipeline/runner.test.ts`
- `packages/decision-core/tiers/tier0/behavioral-veto.test.ts`
- `packages/decision-core/tiers/tier0/index.test.ts`
- `packages/decision-core/tiers/tier1/crypto-regime.test.ts`
- `packages/decision-core/tiers/tier1/fx-regime.test.ts`
- `packages/decision-core/tiers/tier1/index.ts`
- `packages/decision-core/tiers/tier1/index.test.ts`
- `packages/decision-core/tiers/tier2/entry-zone.ts`
- `packages/decision-core/tiers/tier2/entry-zone.test.ts`
- `packages/decision-core/tiers/tier2/index.ts`
- `packages/decision-core/tiers/tier2/index.test.ts`
- `packages/decision-core/tiers/tier3/index.test.ts`

### Change Log

- 2026-07-04: Implemented Story 2.4 cross-tier payload seam, Tier 1 direction enrich, real Tier 2 entry-zone candidate generation, config params, tests, and validation; status moved to review.
