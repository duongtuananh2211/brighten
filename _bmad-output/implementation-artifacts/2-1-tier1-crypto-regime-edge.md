---
baseline_commit: cfae2a46e98a2ac6b5e1bf9e97fc672533fa2161
---

# Story 2.1: Tầng 1 crypto — Regime + Edge/hướng (FR-2 crypto)

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **người dùng trade crypto của Brighten**,
I want **Tầng 1 crypto — hàm THUẦN, tất định — suy ra hướng edge (`long`/`short`) từ tổ hợp funding + open interest + long/short ratio + CVD (CVD tự tích luỹ TRONG core từ taker volume, KHÔNG ở adapter), theo luật có ngưỡng cấu hình-được; và khi các nguồn mâu thuẫn, dưới ngưỡng, hoặc thiếu dữ liệu ⇒ trả "không có hướng" khiến pipeline dừng im lặng**,
so that **hệ thống chỉ săn khi xác suất nghiêng rõ một phía, và cùng `(snapshot, config)` luôn cho cùng hướng — live-tick và backtest tính giống hệt (FR-2 crypto, AD-12, AD-2, AD-5, AD-11)**.

## Acceptance Criteria

**AC1 — CVD tích luỹ TRONG core từ taker volume, KHÔNG ở adapter (AD-12)**
**Given** `MarketSnapshot.klines[]` (mỗi kline có `volume` = tổng base volume và `takerBuyBaseVolume`, đều decimal-string do adapter chuẩn hoá — KHÔNG tính chỉ báo)
**When** Tầng 1 crypto chạy trong `decision-core`
**Then** CVD được tích luỹ **trong lõi thuần** bằng hàm decimal: delta mỗi kline = `takerBuyBase − takerSellBase` với `takerSellBase = volume − takerBuyBase` (⇒ `delta = 2×takerBuyBase − volume`); CVD ròng = tổng delta trên các kline của cửa sổ snapshot
**And** mọi phép tính qua `math/decimal.ts` (`sub`/`mul`/`add`/`cmp`) — KHÔNG `Number(...)`, KHÔNG để `number` khối lượng lọt qua (kết quả là decimal-string)
**And** hàm CVD **thuần**: không IO/`Date`/random, không mutate `klines`; cùng `klines` ⇒ cùng CVD (nền tảng để live-tick và backtest ra CVD **giống hệt**, AD-12)

**AC2 — Hướng edge suy ra từ tổ hợp funding cực trị + OI xác nhận + long/short + CVD, theo luật có tham số cấu hình**
**Given** một `MarketSnapshot` crypto đủ dữ liệu (`funding[]`, `openInterest[]`, `longShortRatio[]`, `klines[]`) và các ngưỡng trong `config.params` (mục AC6)
**When** `evaluateCryptoRegime` chạy
**Then** mỗi nguồn tín hiệu cho một **phiếu hướng** ∈ `{long, short, neutral}` theo ngưỡng config (đặc tả cố định ở Dev Notes → "Đặc tả luật Tầng 1 crypto"); **OI đóng vai cổng xác nhận** (không phải phiếu hướng)
**And** hệ thống trả **một hướng** (`{ ok: true, direction }`) **chỉ khi**: (a) có ≥ 1 phiếu non-neutral, (b) **mọi** phiếu non-neutral **đồng thuận** cùng một hướng (không mâu thuẫn), **và** (c) OI **xác nhận** (đang tăng ≥ ngưỡng)
**And** hàm trả kèm ảnh chụp tín hiệu đã dùng (funding value, lsr, cvd ròng, oi-delta-ratio, từng phiếu) trong payload `ok:true` để tầng sau/audit tái dựng **vì sao** ra hướng (đủ log; **persist** là AD-8, ngoài phạm vi)

**AC3 — Mâu thuẫn / dưới ngưỡng / thiếu dữ liệu ⇒ "không có hướng" ⇒ pipeline dừng im lặng**
**Given** một `MarketSnapshot` mà tín hiệu không hội đủ điều kiện AC2
**When** Tầng 1 crypto chạy trong pipeline (`runPipeline`, thứ tự cố định Tầng 0→1→2→3)
**Then** `evaluateCryptoRegime` trả `{ ok: false, error }` với `source: "tier1.crypto_regime"` và `code` phân biệt **đúng lý do**:
  - `insufficient_data` — thiếu `funding`/`openInterest`/`longShortRatio`, hoặc số điểm/kline < `tier1_min_data_points` (suy giảm mềm, AD-11)
  - `no_edge_below_threshold` — mọi phiếu đều neutral (mọi nguồn dưới ngưỡng)
  - `conflicting_signals` — có phiếu non-neutral nhưng **mâu thuẫn** hướng (một long, một short)
  - `oi_unconfirmed` — hướng đã rõ & đồng thuận nhưng OI **không** xác nhận (không tăng đủ)
**And** `createTier1Crypto()` map `ok:false` ⇒ `{ kind: "veto", tier: "tier1", reason: formatReason(error) }` ⇒ `runPipeline` **dừng ngay**, trả `outcome: "silent"`, `vetoedBy: "tier1"` — **không** chạy Tầng 2/3 (AD-5)
**And** `ok:true` ⇒ `{ kind: "pass" }` (pipeline đi tiếp)

**AC4 — Thứ tự kiểm "không có hướng" cố định & tất định (AD-2)**
**Given** cùng `(snapshot, config)`
**When** gọi Tầng 1 crypto nhiều lần
**Then** output **bằng nhau tuyệt đối** (deep-equal); thứ tự kiểm lý-do-chặn **cố định**: `insufficient_data` → (tính phiếu) → `no_edge_below_threshold` → `conflicting_signals` → `oi_unconfirmed` (reason surface đầu tiên khớp)
**And** hàm **thuần**: không mutate `snapshot`/`config`, không `Date.now()`/`Math.random()`/IO (pass lint `decision-core`, AD-2); thời gian không cần trong Tầng 1 (không đọc `nowEpochMillis` cho luật hướng)

**AC5 — Tin tức KHÔNG chọn hướng; Tầng 1 crypto không đụng FX (ranh giới FR-2)**
**Given** phạm vi story = **crypto**
**When** Tầng 1 crypto suy hướng
**Then** hướng **chỉ** từ funding/OI/long-short/CVD — **KHÔNG** đọc `news_blackout`/lịch tin để chọn hướng (tin là bộ lọc rủi ro ở Tầng 0, story 1.6/2.3)
**And** Tầng 1 **FX** (price action vùng thanh khoản) là **story 2.2** — **ngoài phạm vi**; story này KHÔNG hiện thực FX, KHÔNG thêm taxonomy phân loại cặp trong lõi
**And** cơ chế **dispatch** crypto-vs-FX cho `createTier1()` mặc định là việc của 2.2 (khi cả hai tồn tại) ⇒ story này export `createTier1Crypto()` (+ giữ `createTier1Stub`/`tier1Stub`); **KHÔNG** ép chọn dispatcher bây giờ

**AC6 — Ngưỡng luật là config CÓ PHIÊN BẢN (AD-4); thêm additive, không phá param cũ**
**Given** `packages/config` (artifact 1.2, đã có `ConfigParams`/`DEFAULT_PARAMS`/`validateParams`)
**When** thêm ngưỡng Tầng 1 crypto
**Then** thêm **additive** vào `ConfigParams` + `DEFAULT_PARAMS` + `fieldNames` + `validateParams` (nhân bản pattern có sẵn), gồm:
  - `funding_extreme_threshold` (decimal-string ≥ 0) — |funding| ≥ ngưỡng ⇒ funding "cực trị"
  - `long_short_extreme_ratio` (decimal-string > 1) — lsr ≥ ngưỡng ⇒ đám đông long; lsr ≤ `1/ngưỡng` ⇒ đám đông short
  - `oi_confirmation_min` (decimal-string ≥ 0) — `(OI_last − OI_first)/OI_first` ≥ ngưỡng ⇒ OI "xác nhận" (đang tăng)
  - `tier1_min_data_points` (integer ≥ 1) — số kline/điểm tối thiểu mỗi nguồn, dưới ⇒ `insufficient_data`
**And** mọi ngưỡng đọc từ **snapshot config đã version** (AD-4), không "config sống"; **KHÔNG** đổi/xoá bất kỳ param cũ, `version.ts`, `store.ts`, `snapshot.ts`
**And** ghi chú: các param này **tính vào ngân sách chống overfit** (`max_tunable_params`, story 1.9) khi tối ưu — nhưng **thực thi** cap là việc của 1.9/optimizer, story này chỉ khai báo param

**AC7 — Từ chối input phi lý bằng shape lỗi thống nhất (song song 1.5/1.6)**
**Given** input tiền/tỷ lệ phi lý: `funding_rate`/`longShortRatio`/`volume`/`takerBuyBaseVolume`/`sumOpenInterest` không parse được decimal-string; hoặc ngưỡng config sai miền (`long_short_extreme_ratio ≤ 1`, `oi_confirmation_min < 0`, `funding_extreme_threshold < 0`)
**When** Tầng 1 crypto chạy nhánh liên quan
**Then** trả **rejection tường minh** `{ code, source: "tier1.crypto_regime", context }` (KHÔNG throw string trần, KHÔNG để `NaN`/`Infinity`/`number` lọt qua), map thành veto có `reason` ghi được
**And** chia lỗi rõ: dữ liệu **thiếu** ⇒ `insufficient_data`; dữ liệu **rác** ⇒ `invalid_decimal_string`; **config sai miền** ⇒ `invalid_tier1_param` (context nêu field)

**AC8 — Test phủ từng AC + toolchain sạch**
**Given** Vitest (nền từ epic 1)
**When** thêm test cho CVD accumulation + `evaluateCryptoRegime` + wiring `createTier1Crypto` + validate config mới
**Then** có test cho: CVD ròng bằng số tính tay (delta = `2×takerBuyBase − volume`, cộng dồn); mỗi nguồn ra phiếu đúng ở **hai biên** ngưỡng (`≥` cực trị vs dưới; lsr `≥ ratio` / `≤ 1/ratio` / khoảng giữa neutral; CVD `>0`/`<0`/`==0`); **đồng thuận** ⇒ hướng; **mâu thuẫn** ⇒ `conflicting_signals`; **mọi neutral** ⇒ `no_edge_below_threshold`; hướng rõ nhưng OI phẳng/giảm ⇒ `oi_unconfirmed`, OI tăng đủ ⇒ pass; thiếu series/dưới `tier1_min_data_points` ⇒ `insufficient_data`; input rác ⇒ `invalid_decimal_string`; config sai miền ⇒ `invalid_tier1_param`; **tất định** (2 lần `toEqual`); **không mutate** (`structuredClone`); **không leak number** (`typeof === "string"` field tiền/tỷ lệ); wiring `createTier1Crypto()` veto↔`ok:false` / pass↔`ok:true`; `runPipeline` dừng ở tier1 (không chạy tier2/3) khi tier1 veto
**And** `pnpm -r typecheck && pnpm -r build && pnpm -r lint && pnpm -r test` **tất cả pass**; `*.test.ts` KHÔNG lọt `dist/` (`rg --files -g 'dist/**' | rg '\.test\.'` rỗng)

## Tasks / Subtasks

- [x] **Task 1 — Thêm ngưỡng Tầng 1 crypto vào `@brighten/config` (additive) (AC: #6, #7)**
  - [x] `packages/config/src/schema.ts`: thêm vào `ConfigParams` (4 field mới, đúng thứ tự cạnh param liên quan): `funding_extreme_threshold: string`, `long_short_extreme_ratio: string`, `oi_confirmation_min: string`, `tier1_min_data_points: number`
  - [x] Thêm mặc định vào `DEFAULT_PARAMS` (**ngưỡng deferred-tuning**, không phải quyết định kiến trúc — đề xuất khởi điểm, chốt qua backtest): `funding_extreme_threshold: "0.0005"`, `long_short_extreme_ratio: "2"`, `oi_confirmation_min: "0.01"`, `tier1_min_data_points: 2`
  - [x] Thêm 4 tên vào mảng `fieldNames` (để kiểm "missing_config_param")
  - [x] Validate: `funding_extreme_threshold` & `oi_confirmation_min` qua `validateNonNegativeDecimalField` (≥ 0); `long_short_extreme_ratio` qua `validateDecimalField` (> 0) **cộng** kiểm miền `> 1` ⇒ nếu `cmp(value,"1") <= 0` trả `invalid("invalid_tier1_param", "long_short_extreme_ratio", ...)`; `tier1_min_data_points` qua `isPositiveInteger` (≥ 1, nhân bản `max_trades_per_day`). Ghép 4 field vào object trả về của `validateParams`
  - [x] **KHÔNG** đổi param cũ, `validateParams` shape cũ, `version.ts`, `store.ts`, `snapshot.ts`
  - [x] `packages/config/src/schema.test.ts`: **UPDATE** — `DEFAULT_PARAMS` hợp lệ (đã cover bởi test có sẵn — thêm assert 4 mặc định mới `toBe`); case `long_short_extreme_ratio: "1"`/`"0.9"` ⇒ `invalid_tier1_param`; `funding_extreme_threshold: "-0.1"` ⇒ `invalid_non_negative_decimal_string`; `tier1_min_data_points: 0` ⇒ `invalid_positive_integer`; thiếu 1 field mới ⇒ `missing_config_param`

- [x] **Task 2 — CVD accumulation THUẦN trong core (AD-12) (AC: #1, #7)**
  - [x] `packages/decision-core/tiers/tier1/cvd.ts`: **NEW** — hàm thuần `accumulateCvd(klines: readonly Kline[]): CvdOutcome`
    - `CvdResult = { ok: true; cvd: string; klineCount: number }` (`cvd` = CVD ròng decimal-string)
    - `CvdRejection = { ok: false; error: CoreError }` (`source: "tier1.cvd"`, `code: "invalid_decimal_string"` khi `volume`/`takerBuyBaseVolume` rác)
  - [x] Logic mỗi kline: `takerSellBase = sub(volume, takerBuyBase)`; `delta = sub(takerBuyBase, takerSellBase)` (⇔ `2×takerBuyBase − volume`); CVD ròng = `add` dồn từ `"0"`. Toàn bộ qua `math/decimal.ts`; parse rác ⇒ rejection (không throw trần)
  - [x] Hàm **thuần**: không mutate `klines`, không IO/`Date`/random. (Không kiểm `klines.length` ở đây — điều kiện `tier1_min_data_points` do `evaluateCryptoRegime` kiểm, một nguồn)

- [x] **Task 3 — Luật suy hướng THUẦN `evaluateCryptoRegime` (trái tim FR-2 crypto) (AC: #2, #3, #4, #5, #7)**
  - [x] `packages/decision-core/tiers/tier1/crypto-regime.ts`: **NEW** — hàm thuần
    `evaluateCryptoRegime(input: CryptoRegimeInput): CryptoRegimeOutcome` với:
    - `CryptoRegimeInput = { snapshot: MarketSnapshot; params: ConfigParams }` (đọc `snapshot.funding/openInterest/longShortRatio/klines`)
    - `CryptoRegimePass = { ok: true; direction: TradeDirection; signals: CryptoRegimeSignals }` (`signals` = ảnh chụp: `fundingRate`, `longShortRatio`, `cvd`, `oiDeltaRatio`, `fundingVote`, `longShortVote`, `cvdVote` — tất cả decimal-string / `"long"|"short"|"neutral"`)
    - `CryptoRegimeRejection = { ok: false; error: CoreError }` (`source: "tier1.crypto_regime"`)
  - [x] Trình tự (thứ tự cố định, AC4):
    1. **Kiểm miền config** (AC7): `long_short_extreme_ratio > 1`, `oi_confirmation_min ≥ 0`, `funding_extreme_threshold ≥ 0` — sai ⇒ `invalid_tier1_param`
    2. **insufficient_data** (AD-11): `funding`/`openInterest`/`longShortRatio` `=== undefined` hoặc `length < tier1_min_data_points`, hoặc `klines.length < tier1_min_data_points` ⇒ reject `insufficient_data`
    3. Tính tín hiệu (đặc tả ở Dev Notes): `fundingRate` = funding point **cuối**; `longShortRatio` = lsr point **cuối**; `cvd` = `accumulateCvd(klines)` (rác ⇒ trả rejection của CVD); `oiDeltaRatio = div(sub(OI_last, OI_first), OI_first)`
    4. Tính 3 **phiếu** (funding, long/short, cvd) theo ngưỡng
    5. **no_edge_below_threshold**: cả 3 phiếu `neutral` ⇒ reject
    6. **conflicting_signals**: các phiếu non-neutral **không** cùng hướng ⇒ reject
    7. Hướng = hướng đồng thuận của phiếu non-neutral
    8. **oi_unconfirmed**: `cmp(oiDeltaRatio, oi_confirmation_min) < 0` ⇒ reject (OI không tăng đủ)
    9. `ok: true` với `direction` + `signals`
  - [x] Mọi so sánh/nhân/chia tiền-tỷ-lệ qua `math/decimal.ts` (`cmp`/`div`/`sub`/`mul`). `1/ratio` = `div("1", long_short_extreme_ratio)`. Hàm **thuần**, không đọc `nowEpochMillis`, không `news_blackout` (AC5)

- [x] **Task 4 — Nối Tầng 1 crypto thật vào pipeline (AC: #3, #5)**
  - [x] `packages/decision-core/tiers/tier1/index.ts`: thêm `createTier1Crypto(): Tier` (id `"tier1"`) — trong `run(ctx)` gọi `evaluateCryptoRegime({ snapshot: ctx.input, params: ctx.config.params })`; `ok:false` ⇒ `{ kind: "veto", tier: "tier1", reason: formatReason(error) }`; `ok:true` ⇒ `{ kind: "pass" }`. Thêm `formatReason` render mỗi `code` từ context (song song `tier0/index.ts`/`tier3/index.ts#formatReason`)
  - [x] **GIỮ** `createTier1Stub`/`tier1Stub`/`Tier1StubOptions` export tên ổn định (test khác + driver tương lai ép pass/veto). **KHÔNG** đặt `tier1Stub = createTier1Crypto()` (khác tier0: stub tier1 hiện là *pass mặc định* — nhiều test epic-1 dựa vào tier1 "trong suốt"); giữ nguyên hành vi stub
  - [x] Export công khai từ `tiers/tier1/index.ts`: `createTier1Crypto`, `evaluateCryptoRegime` + kiểu (`CryptoRegimeInput/Outcome/Pass/Rejection/Signals`), `accumulateCvd` + kiểu CVD. `tiers/index.ts` + `decision-core/index.ts` đã `export *` từ tier1 ⇒ tự lan (kiểm không xung đột tên — vd tránh trùng `TradeDirection` đã có ở `types`)
  - [x] **Mang `direction` sang Tầng 2**: cross-tier payload là **seam deferred** (như 1.5/1.6). Tầng 2 (story 2.4) tiêu thụ `direction`; story này **CHỈ** cấp hàm thuần trả `direction` + wiring pass/veto — KHÔNG mở rộng `TierOutcome`/`TierContext` để thread payload bây giờ. Đề xuất shape khi 2.4 tới: thêm `direction?: TradeDirection` optional vào `TierContext` do driver re-inject, hoặc đổi `runPipeline` thành thread outcome-payload (quyết định ở 2.4)

- [x] **Task 5 — Cập nhật fixtures `ConfigParams` cứng shape (AC: #6, #8)**
  - [x] Thêm 4 field mới vào **mọi** literal `ConfigParams` trong test (4 field required ⇒ typecheck đỏ nếu thiếu): `packages/decision-core/pipeline/runner.test.ts`, `packages/decision-core/tiers/tier0/behavioral-veto.test.ts` (gồm cả 2 inline params ~L167/L193), `packages/decision-core/tiers/tier0/index.test.ts`, `packages/decision-core/tiers/tier3/index.test.ts`. Dùng giá trị mặc định (`funding_extreme_threshold: "0.0005"`, `long_short_extreme_ratio: "2"`, `oi_confirmation_min: "0.01"`, `tier1_min_data_points: 2`)
  - [x] `packages/config/src/store.test.ts`/`snapshot.test.ts`: nếu dựng params từ `DEFAULT_PARAMS` ⇒ tự đúng; nếu literal ⇒ thêm 4 field

- [x] **Task 6 — Tests phủ từng AC (AC: #1..#8)**
  - [x] `packages/decision-core/tiers/tier1/cvd.test.ts`: **NEW** — CVD ròng số tính tay (vd 2 kline: `volume="10"`,`takerBuyBase="7"` ⇒ delta `"4"`; `volume="10"`,`takerBuyBase="3"` ⇒ delta `"-4"`; ròng `"0"`); rác (`volume="x"`) ⇒ `invalid_decimal_string`/`source:"tier1.cvd"`; tất định + không mutate + `typeof cvd === "string"`
  - [x] `packages/decision-core/tiers/tier1/crypto-regime.test.ts`: **NEW** — dựng `MarketSnapshot` fixture đủ nguồn; test: mỗi phiếu ở **hai biên** ngưỡng; đồng thuận ⇒ `ok:true` + `direction` đúng + `signals` đúng; mâu thuẫn ⇒ `conflicting_signals`; mọi neutral ⇒ `no_edge_below_threshold`; hướng rõ + OI phẳng ⇒ `oi_unconfirmed`, OI tăng đủ ⇒ pass; thiếu `funding`/dưới `tier1_min_data_points` ⇒ `insufficient_data`; config `long_short_extreme_ratio:"1"` ⇒ `invalid_tier1_param`; input rác ⇒ `invalid_decimal_string`; **thứ tự cố định** (bơm đồng thời thiếu-data + mâu thuẫn ⇒ reason là `insufficient_data`); tất định (2× `toEqual`); không mutate (`structuredClone`); không leak number
  - [x] `packages/decision-core/tiers/tier1/index.test.ts`: **NEW** — `createTier1Crypto()` veto↔`ok:false` (reason render đúng mỗi code) / pass↔`ok:true`; `createTier1Stub()` mặc định vẫn **pass**, `createTier1Stub({vetoReason})` vẫn ép veto
  - [x] `packages/decision-core/pipeline/runner.test.ts`: **UPDATE** — thêm case: chèn `createTier1Crypto()` vào chuỗi tiers, snapshot "không có hướng" ⇒ `runPipeline` trả `silent`/`vetoedBy:"tier1"`, **không** chạy tier2/3 (spy/thứ tự)
  - [x] `pnpm -r test` pass; xác nhận `dist/` không chứa `*.test.*` (`rg --files -g 'dist/**' | rg '\.test\.'`)

## Dev Notes

> **Bối cảnh:** Story 2.1 mở đầu **Epic 2** — thay stub Tầng 1 bằng luật **crypto regime + edge/hướng thật** (FR-2 crypto). Đây là tầng đầu tiên *tạo ra* thông tin hướng cho pipeline (Tầng 0 chỉ veto hành vi; Tầng 3 chỉ sizing). Nó xây theo đúng khuôn epic 1 (1.4/1.5/1.6): **hàm thuần tách khỏi `index.ts` mỏng**, shape lỗi `{ code, source, context }`, so sánh/số học tiền qua `math/decimal.ts` một-nguồn, mọi ngưỡng từ **config snapshot đã version** (AD-4), test biên/determinism/non-mutation. **Điểm mấu chốt kiến trúc:** CVD **tích luỹ trong lõi thuần** (AD-12) — đây là lỗ đã bịt ở review adversarial: nếu adapter tính CVD cho live còn backtest tự tính lại, hai bên lệch ⇒ expectancy nói dối. Adapter chỉ giao `klines` thô (đã có `takerBuyBaseVolume`); mọi suy diễn CVD ở đây.

### 🔑 Giải toả mơ hồ: hướng đến từ đâu, "không có hướng" nghĩa là gì — đừng để dev đoán

- **Tầng 1 crypto TẠO hướng, không nhận hướng.** Nó đọc `MarketSnapshot` (raw, do `ingestion` adapter sở hữu) + `config.params` (ngưỡng) và suy ra `long`/`short`/không-có-hướng. **Không** đọc `nowEpochMillis` (luật hướng không phụ thuộc thời-điểm-tick), **không** đọc `state` hành vi, **không** đọc `news_blackout` (AC5 — tin là bộ lọc rủi ro Tầng 0, KHÔNG chọn hướng). [Source: prd.md#FR-2; ARCHITECTURE-SPINE.md#AD-12]
- **"Không có hướng" ⇒ VETO Tầng 1 ⇒ pipeline im lặng.** Trong kiến trúc pipes-and-filters, mỗi tầng *pass hoặc veto*; "dừng pipeline khi không rõ hướng" ánh xạ **chính xác** thành veto tier1 (⇒ `runPipeline` trả `silent`, không chạy Tầng 2/3). KHÔNG cần khái niệm outcome thứ ba. Bốn lý do "không có hướng" mang **code riêng** để Nhật ký phân biệt (thiếu-data ≠ mâu-thuẫn ≠ dưới-ngưỡng ≠ OI-chưa-xác-nhận). [Source: ARCHITECTURE-SPINE.md#AD-5; §Design Paradigm "mỗi tầng pass/veto"]
- **CVD tích luỹ trong core (AD-12) — KHÔNG ở adapter.** `Kline` đã có `takerBuyBaseVolume` (taker mua) và `volume` (tổng) do adapter chuẩn hoá. Taker bán = `volume − takerBuyBase`. Delta = mua − bán. CVD ròng = tổng delta trên cửa sổ. Đây là "CVD xấp xỉ từ taker buy/sell volume trong kline REST" mà Solution Design §2 mô tả. Vì tính **trong lõi thuần**, live-tick và backtest ra CVD **byte-identical**. [Source: ARCHITECTURE-SPINE.md#AD-12; SOLUTION-DESIGN.md §2 "Bước ngoặt", §5.1]
- **OI là cổng xác nhận, không phải phiếu hướng.** "OI xác nhận" (AC gốc) = open interest **đang tăng** ⇒ vị thế mới thật sự vào ⇒ move có lực. Nếu hướng rõ nhưng OI phẳng/giảm ⇒ `oi_unconfirmed` (không đủ conviction). OI **không** tự chọn long/short — nó gate hướng đã suy từ funding/lsr/CVD. [Source: epics.md → Story 2.1 AC "OI xác nhận"; prd.md#FR-2]

### Đặc tả luật Tầng 1 crypto (một nguồn sự thật)

```text
# evaluateCryptoRegime(snapshot, params) — thứ tự cố định; trả REJECTION đầu tiên khớp, else { ok:true, direction }

0. kiểm miền config:
     long_short_extreme_ratio > 1 ; oi_confirmation_min >= 0 ; funding_extreme_threshold >= 0
     sai ⇒ invalid_tier1_param (context.field)
1. insufficient_data (AD-11 suy giảm mềm):
     funding|openInterest|longShortRatio === undefined
     hoặc mỗi series.length < tier1_min_data_points  (klines cũng vậy)
2. tính tín hiệu (mọi phép qua math/decimal.ts):
     fundingRate    = funding[last].fundingRate
     lsr            = longShortRatio[last].longShortRatio
     cvd            = accumulateCvd(klines).cvd            # ròng; rác ⇒ invalid_decimal_string
     oiDeltaRatio   = (OI[last].sumOpenInterest − OI[0].sumOpenInterest) / OI[0].sumOpenInterest
3. phiếu (vote ∈ long|short|neutral):
     fundingVote   = fundingRate >=  +funding_extreme_threshold ⇒ short   # đám đông long đông đúc ⇒ contrarian short
                     fundingRate <=  −funding_extreme_threshold ⇒ long
                     else neutral
     longShortVote = lsr >= long_short_extreme_ratio            ⇒ short   # crowded long ⇒ contrarian short
                     lsr <= 1/long_short_extreme_ratio          ⇒ long
                     else neutral
     cvdVote       = cvd > 0 ⇒ long ; cvd < 0 ⇒ short ; cvd == 0 ⇒ neutral   # taker aggression thật
4. no_edge_below_threshold : cả 3 phiếu neutral
5. conflicting_signals     : ∃ phiếu long VÀ ∃ phiếu short (các non-neutral không đồng thuận)
6. direction               : hướng chung của phiếu non-neutral (đã đồng thuận)
7. oi_unconfirmed          : oiDeltaRatio < oi_confirmation_min           # OI không tăng đủ
8. ⇒ { ok:true, direction, signals:{ fundingRate,longShortRatio:lsr,cvd,oiDeltaRatio, fundingVote,longShortVote,cvdVote } }

source = "tier1.crypto_regime" cho mọi rejection (trừ CVD rác ⇒ source "tier1.cvd")
```

> **Về "polarity" (contrarian funding/lsr + momentum CVD):** cấu trúc luật (phiếu → đồng thuận → xác nhận OI → mâu thuẫn⇒dừng) là **hợp đồng cố định** của story. Chiều dấu cụ thể ở trên là **mặc định tài liệu-hoá** khớp tinh thần "chỉ săn khi xác suất nghiêng rõ một phía" (đám đông cực trị + dòng taker + OI tăng). **Ngưỡng số** (`funding_extreme_threshold`…) là **config deferred**, chốt qua backtest (AD-4, §Deferred). Dev **giữ nguyên cấu trúc + chiều dấu này**; đừng tự phát minh thesis khác. [Source: ARCHITECTURE-SPINE.md#Deferred "Ngưỡng số cụ thể…luật crypto funding/OI/L-S/CVD"; #AD-4]

### Hợp đồng đã có (PHẢI tuân, đọc trước khi sửa) — trạng thái hiện tại các file UPDATE

| File | Trạng thái hôm nay | Story 2.1 đổi gì | Phải giữ nguyên |
| --- | --- | --- | --- |
| `tiers/tier1/index.ts` | chỉ `createTier1Stub`/`tier1Stub` (pass, hoặc veto nếu `vetoReason`) | **+`createTier1Crypto()` thật** + `formatReason`; export helper/kiểu | tên export `createTier1Stub`/`tier1Stub`/`Tier1StubOptions`; **hành vi stub pass mặc định** (đừng gán `tier1Stub = crypto thật`) |
| `types/index.ts` | `Kline`(có `volume`/`takerBuyBaseVolume`), `MarketSnapshot`(funding/openInterest/longShortRatio optional), `TradeDirection`, `CoreError`, `Result` | **không sửa** (mọi shape cần đã có) | toàn bộ; `MARKET_SNAPSHOT_SCHEMA_VERSION` |
| `pipeline/runner.ts` | `TierContext.input:MarketSnapshot`, `config`, veto→silent dừng ngay | **không sửa** (Tầng 1 đọc `ctx.input`/`ctx.config` sẵn có; direction-payload deferred) | `runPipeline`/`TierOutcome`/`TierContext` |
| `packages/config/src/schema.ts` | `ConfigParams`/`DEFAULT_PARAMS`/`validateParams`/`fieldNames` (patterns `validateDecimalField`/`validateNonNegativeDecimalField`/`isPositiveInteger`) | **+4 field Tầng 1** (additive) + validate | mọi param/field cũ; `version.ts`/`store.ts`/`snapshot.ts` |
| `math/decimal.ts` | wrapper thuần precision 40 / HALF_UP một chỗ (`add`/`sub`/`mul`/`div`/`cmp`/`toDecimal`) | **không sửa** — tái dùng | precision/rounding một chỗ (determinism) |

[Source: packages/decision-core/tiers/tier1/index.ts; types/index.ts; pipeline/runner.ts; packages/config/src/schema.ts; math/decimal.ts]

### Invariant kiến trúc PHẢI tuân

- **AD-12 — suy diễn tín hiệu trong lõi:** CVD (và mọi chỉ báo) tính trong `decision-core`, adapter chỉ giao raw ⇒ live/backtest giống hệt. [Source: #AD-12]
- **AD-2 — thuần & tất định:** mọi hàm thuần; không `Date`/`Math.random`/IO (lint `decision-core` chặn); cùng `(snapshot,config)` → cùng output (NFR-6/NFR-1). [Source: #AD-2]
- **AD-5 — thứ tự gating:** Tầng 1 chạy **sau** Tầng 0, **trước** Tầng 2; veto ⇒ dừng ngay, im lặng; Tầng 2 chỉ tìm điểm vào theo hướng Tầng 1 (2.4). [Source: #AD-5]
- **AD-11 — suy giảm mềm khi thiếu dữ liệu:** endpoint/nguồn thiếu ⇒ KHÔNG phát Đề xuất trên dữ liệu khuyết ⇒ `insufficient_data` veto. [Source: #AD-11; NFR-5]
- **AD-4 — config có phiên bản:** ngưỡng Tầng 1 là param versioned, snapshot cùng mỗi quyết định. [Source: #AD-4]
- **AD-8 — audit append-only:** `signals` payload + `code`/`context` **đủ để log** *vì sao* ra hướng / bị chặn; **persist** (`suggestion-blocked`/tín hiệu kích hoạt) là AD-8, **ngoài phạm vi** (chưa có persistence adapter). [Source: #AD-8]

### Ngoài phạm vi story này (đừng làm — để story sau)

- **Tầng 1 FX (price action vùng thanh khoản)** — **story 2.2**. Story này chỉ crypto; KHÔNG thêm taxonomy phân loại cặp trong lõi.
- **Dispatcher crypto-vs-FX cho `createTier1()` mặc định** — khi cả hai tồn tại (2.2). Nay export `createTier1Crypto()` + giữ stub.
- **Mang `direction` vào Tầng 2 (`TierContext`/`runPipeline` threading payload)** — seam **deferred**; Tầng 2 tiêu thụ ở **story 2.4**. Nay chỉ cấp hàm thuần trả `direction` + wiring pass/veto.
- **Lịch tin FX → `news_blackout`** — **story 2.3** (FR-6). Tầng 1 KHÔNG đọc tin.
- **Backtest chạy đủ 4 tầng** — **story 2.5**. Story này KHÔNG wire tier chain vào `backtest-cli`.
- **Persist tín hiệu/hướng/lần chặn vào Nhật ký audit** — AD-8, cần persistence adapter (epic 3). Nay chỉ trả `signals`/`code`/`context`.
- **Live poll funding/OI/lsr real-time** — `cron-runner` + ingestion live (epic 3). Story này đọc `MarketSnapshot` bơm sẵn (backtest lịch sử / fixture), không gọi Binance.
- **basis từ mark/index** (FR-5) — không nằm trong luật hướng 2.1; nguồn dữ liệu, không phải suy diễn tầng này.

### Source tree mục tiêu (phần thêm/đổi)

```text
packages/config/src/
  schema.ts                          # UPDATE: +4 field Tầng 1 (additive) + validate (invalid_tier1_param)
  schema.test.ts                     # UPDATE: cover 4 mặc định + miền sai + missing field
packages/decision-core/
  tiers/tier1/
    cvd.ts                           # NEW: accumulateCvd() — CVD ròng từ taker volume (AD-12)
    cvd.test.ts                      # NEW
    crypto-regime.ts                 # NEW: evaluateCryptoRegime() + Input/Pass/Rejection/Signals/Outcome
    crypto-regime.test.ts            # NEW
    index.ts                         # UPDATE: +createTier1Crypto() + formatReason; export helper/kiểu; GIỮ stub (pass mặc định)
    index.test.ts                    # NEW: wiring createTier1Crypto veto/pass + reason; stub vẫn pass
  pipeline/runner.test.ts            # UPDATE: +case tier1 veto ⇒ silent, không chạy tier2/3; +4 field fixture
  tiers/tier0/behavioral-veto.test.ts # UPDATE: +4 field vào literal ConfigParams
  tiers/tier0/index.test.ts          # UPDATE: +4 field fixture
  tiers/tier3/index.test.ts          # UPDATE: +4 field fixture
```
[Source: ARCHITECTURE-SPINE.md#Structural Seed "một filter/tầng = một module trong decision-core/tiers/"; bố cục tier0/tier3 làm khuôn]

### Project Structure Notes

- Tách `cvd.ts` + `crypto-regime.ts` khỏi `index.ts` (song song `behavioral-veto.ts`/`sizing.ts`/`cost-hurdle.ts`): hàm thuần dễ test đơn vị (nơi giá trị FR-2 nằm); `index.ts` chỉ là lớp nối pipeline mỏng + `formatReason`.
- Tái dùng `math/decimal.ts` — **không** cấu hình precision mới (một nguồn sự thật cho tái lập).
- Config: thêm 4 field là **thay đổi additive** chạm `@brighten/config` (artifact 1.2). Rủi ro chính: mọi literal `ConfigParams` trong test cứng-shape → thêm 4 field (Task 5), nếu không typecheck đỏ (4 field required). Không đổi `version.ts`/`store.ts`/`snapshot.ts`.
- Xung đột đã biết: `apps/*` chưa wire tier chain (grep xác nhận không import `createTier1*`) ⇒ thêm `createTier1Crypto()` **an toàn**, không vỡ app; wiring vào backtest là 2.5.
- `MarketSnapshot`/`Kline` do adapter `binance-rest` (1.7) sở hữu và đã có `takerBuyBaseVolume`/`funding`/`openInterest`/`longShortRatio` — Tầng 1 **chỉ đọc**, KHÔNG đổi shape (nếu đổi phải version `MARKET_SNAPSHOT_SCHEMA_VERSION`).

### Chuẩn test

- Vitest; mỗi AC ≥ 1 test. Ưu tiên **số cụ thể tính tay**:
  - CVD: kline `volume="10"`/`takerBuyBase="7"` ⇒ delta `"4"`; cộng dồn nhiều kline ra ròng chính xác.
  - phiếu: `funding_extreme_threshold="0.0005"` với `fundingRate="0.0006"` ⇒ short (biên `"0.0005"` ⇒ short vì `>=`); `"0.0004"` ⇒ neutral; `long_short_extreme_ratio="2"` với lsr `"2"` ⇒ short, `"0.5"` ⇒ long, `"1.2"` ⇒ neutral.
- Test **biên** ngưỡng (`>=`/`<=`) cho funding & lsr; CVD `>0`/`<0`/`==0`; OI `oiDeltaRatio == oi_confirmation_min` ⇒ **xác nhận** (`>=`, không unconfirmed).
- Test **đồng thuận vs mâu thuẫn**: 2 phiếu long + 1 neutral ⇒ long; long + short ⇒ `conflicting_signals`.
- Test **thứ tự cố định**: bơm đồng thời thiếu-series **và** mâu-thuẫn ⇒ reason là `insufficient_data` (chứng minh short-circuit).
- Test **tất định** (2× `toEqual`), **không mutate** (`structuredClone` snapshot+params), **không leak number** (`typeof === "string"` cho `cvd`/`oiDeltaRatio`/`fundingRate`).
- Test **wiring**: `createTier1Crypto()` map `ok:false`→veto (reason render), `ok:true`→pass; `runPipeline` với tier1 veto ⇒ `silent`/`vetoedBy:"tier1"`, tier2/3 **không** chạy.
- Không integration/DB (không adapter/persistence ở story này); snapshot là fixture.

### References

- [Source: epics.md → Epic 2, Story 2.1] — AC gốc (BDD): CVD tích luỹ trong core (AD-12); hướng từ funding cực trị + OI xác nhận + long/short theo luật tham số; mâu thuẫn/dưới ngưỡng → "không có hướng", dừng pipeline
- [Source: prd.md#FR-2] — crypto tính hướng từ funding/OI/long-short/CVD theo luật config-được; tin KHÔNG chọn hướng; mâu thuẫn/dưới ngưỡng → "không có hướng" dừng pipeline
- [Source: ARCHITECTURE-SPINE.md#AD-12] — suy diễn tín hiệu (CVD…) trong lõi thuần, adapter chỉ giao raw ⇒ live/backtest giống hệt
- [Source: ARCHITECTURE-SPINE.md#AD-2] — lõi thuần tất định (lint chặn IO/Date/random); NFR-6
- [Source: ARCHITECTURE-SPINE.md#AD-5] — thứ tự gating 0→1→2→3; veto dừng ngay im lặng; Tầng 2 theo hướng Tầng 1
- [Source: ARCHITECTURE-SPINE.md#AD-11] — suy giảm mềm khi thiếu dữ liệu → không phát Đề xuất; `insufficient_data`
- [Source: ARCHITECTURE-SPINE.md#AD-4; #Deferred] — ngưỡng luật crypto là config có phiên bản, số cụ thể chốt qua backtest
- [Source: ARCHITECTURE-SPINE.md#Capability Map] — FR-2 Tầng 1 regime/edge lives in `decision-core/tiers/tier1`, governed AD-2/AD-5/AD-11
- [Source: SOLUTION-DESIGN.md §2, §5.1] — CVD xấp xỉ từ taker buy/sell volume trong kline REST; lỗ adversarial "CVD trong lõi không trong adapter"
- [Source: packages/decision-core/tiers/tier1/index.ts] — stub hiện tại (`createTier1Stub`/`tier1Stub`) mà 2.1 nối tiếp; giữ tên export + hành vi pass mặc định
- [Source: packages/decision-core/types/index.ts] — `Kline`(`volume`/`takerBuyBaseVolume`), `MarketSnapshot`(funding/openInterest/longShortRatio), `TradeDirection`, `CoreError`, `Result`
- [Source: packages/decision-core/pipeline/runner.ts] — `TierContext`(`input`/`config`)/`TierOutcome`(pass/veto)/`runPipeline` (veto→silent, dừng ngay)
- [Source: packages/config/src/schema.ts] — `ConfigParams`/`DEFAULT_PARAMS`/`validateParams`/`fieldNames`; patterns `validateDecimalField`/`validateNonNegativeDecimalField`/`isPositiveInteger` để nhân bản
- [Source: packages/decision-core/math/decimal.ts] — wrapper decimal precision-một-chỗ (`add`/`sub`/`mul`/`div`/`cmp`/`toDecimal`) để tái dùng
- [Source: packages/decision-core/tiers/tier0/behavioral-veto.ts; tiers/tier3/cost-hurdle.ts] — khuôn trực tiếp: hàm thuần tách khỏi index, shape lỗi `{code,source,context}`, thứ-tự-kiểm-cố-định, `formatReason`, chuẩn test biên/determinism/non-mutation
- [Source: 1-6-tier0-behavioral-veto.md] — khuôn story epic-này: "cấp hàm thuần, hoãn payload/wiring", additive config + cập nhật fixtures, ranh giới đọc-vs-mutate

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- 2026-07-04: Resolver script failed because shell Python lacks `tomllib` / Python 3.11; workflow customization was resolved manually from base/team/user files.
- 2026-07-04: `pnpm --filter @brighten/config test && pnpm --filter @brighten/decision-core test` passed after implementing config, CVD, regime, and wiring tests.
- 2026-07-04: First full validation failed on strict `TradeDirection | undefined` inference for `nonNeutralVotes[0]`; added explicit guard.
- 2026-07-04: Second full validation failed on `exactOptionalPropertyTypes` in crypto-regime test fixture; changed fixture helper to represent missing optional snapshot series by deleting the property.
- 2026-07-04: Full `pnpm -r typecheck && pnpm -r build && pnpm -r lint && pnpm -r test` passed.
- 2026-07-04: Removed stale generated `dist/*.test.*` artifacts from earlier builds; verified both `rg --files -g 'dist/**' | rg '\.test\.'` and `find packages apps -path '*/dist/*' ...` return no test artifacts.

### Completion Notes List

- Added additive Tier 1 crypto config params and validation: funding threshold, long/short extreme ratio, OI confirmation minimum, and min data points.
- Implemented pure CVD accumulation in decision-core from raw kline `volume` and `takerBuyBaseVolume`, returning decimal-string results or structured `CoreError`.
- Implemented pure `evaluateCryptoRegime` with fixed rejection order, deterministic votes, OI confirmation, structured signal payload, and no news/FX coupling.
- Added `createTier1Crypto()` pipeline wiring while preserving `createTier1Stub()` / `tier1Stub` default-pass behavior.
- Added Vitest coverage for CVD, crypto regime edge cases, threshold boundaries, deterministic/non-mutating behavior, invalid inputs/config, Tier 1 wiring, and pipeline stop-on-veto.
- Updated required `ConfigParams` test fixtures with new additive Tier 1 params.

### File List

- `_bmad-output/implementation-artifacts/2-1-tier1-crypto-regime-edge.md`
- `packages/config/src/schema.ts`
- `packages/config/src/schema.test.ts`
- `packages/decision-core/pipeline/runner.test.ts`
- `packages/decision-core/tiers/tier0/behavioral-veto.test.ts`
- `packages/decision-core/tiers/tier0/index.test.ts`
- `packages/decision-core/tiers/tier1/cvd.ts`
- `packages/decision-core/tiers/tier1/cvd.test.ts`
- `packages/decision-core/tiers/tier1/crypto-regime.ts`
- `packages/decision-core/tiers/tier1/crypto-regime.test.ts`
- `packages/decision-core/tiers/tier1/index.ts`
- `packages/decision-core/tiers/tier1/index.test.ts`
- `packages/decision-core/tiers/tier3/index.test.ts`

### Change Log

- 2026-07-04: Implemented Story 2.1 Tier 1 crypto regime edge, CVD core accumulation, config params, pipeline wiring, and tests; status moved to review.
