---
baseline_commit: cfae2a46e98a2ac6b5e1bf9e97fc672533fa2161
depends_on: 2-1-tier1-crypto-regime-edge
---

# Story 2.2: Tầng 1 FX — hướng từ price action vùng thanh khoản (FR-2 FX)

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **người dùng trade FX của Brighten**,
I want **Tầng 1 FX — hàm THUẦN, tất định — suy ra hướng edge (`long`/`short`) từ price action đọc vùng thanh khoản (liquidity sweep của swing high/low) trên `klines`, theo luật có ngưỡng cấu hình-được; tin tức KHÔNG bao giờ dùng để chọn hướng; và khi không rõ hướng (không quét thanh khoản / mâu thuẫn / thiếu dữ liệu) ⇒ trả "không có hướng" khiến pipeline dừng im lặng**,
so that **tôi theo dòng smart-money (thanh khoản bị quét → đảo chiều) chứ không đoán theo tin, và cùng `(snapshot, config)` luôn cho cùng hướng — live-tick và backtest tính giống hệt (FR-2 FX, AD-2, AD-5, AD-11, AD-12)**.

## Acceptance Criteria

**AC1 — Hướng FX suy từ price action đọc vùng thanh khoản (KHÔNG từ funding/OI/CVD)**
**Given** một `MarketSnapshot` FX với `klines[]` (mỗi kline có `open/high/low/close` decimal-string do adapter chuẩn hoá) và các ngưỡng trong `config.params` (mục AC6)
**When** `evaluateFxRegime` chạy trong `decision-core`
**Then** hệ thống xác định **vùng thanh khoản** = swing high (`max(high)`) và swing low (`min(low)`) trên cửa sổ `fx_swing_lookback` kline *trước* kline cuối (kline cuối là nến ứng viên quét)
**And** hướng suy từ **liquidity sweep + reversal** (đặc tả cố định ở Dev Notes → "Đặc tả luật Tầng 1 FX"):
  - quét swing **high** (high vượt swing-high rồi close **quay lại dưới** swing-high, độ xuyên ≥ ngưỡng) ⇒ thanh khoản trên bị lấy ⇒ **short**
  - quét swing **low** (low thủng swing-low rồi close **quay lại trên** swing-low, độ xuyên ≥ ngưỡng) ⇒ thanh khoản dưới bị lấy ⇒ **long**
**And** Tầng 1 FX **KHÔNG** đọc `funding`/`openInterest`/`longShortRatio`/CVD (đó là tín hiệu crypto, story 2.1) — chỉ đọc `klines`

**AC2 — Tin tức KHÔNG được dùng để chọn hướng (ranh giới FR-2 FX)**
**Given** `config.params.news_blackout` và bất kỳ nguồn lịch tin nào tồn tại trong config/ctx
**When** Tầng 1 FX suy hướng
**Then** hàm **KHÔNG** đọc `news_blackout`/lịch tin để chọn/loại hướng — tin **chỉ** là bộ lọc rủi ro ở Tầng 0 (story 1.6 đã làm veto `news_blackout`; nạp lịch tin là story 2.3/FR-6)
**And** ranh giới này kiểm được: `evaluateFxRegime` **không nhận** và **không tham chiếu** `news_blackout` trong đường suy hướng (đọc code + test không phụ thuộc news)

**AC3 — Không rõ hướng ⇒ "không có hướng" ⇒ pipeline dừng im lặng**
**Given** một `MarketSnapshot` FX mà price action không cho sweep rõ ràng
**When** Tầng 1 FX chạy trong pipeline (`runPipeline`, thứ tự cố định Tầng 0→1→2→3)
**Then** `evaluateFxRegime` trả `{ ok: false, error }` với `source: "tier1.fx_regime"` và `code` phân biệt **đúng lý do**:
  - `insufficient_data` — `klines.length < max(fx_min_data_points, fx_swing_lookback + 1)`, hoặc swing range = 0 (thoái hoá) (suy giảm mềm, AD-11)
  - `no_liquidity_sweep` — không bên nào bị quét đạt ngưỡng (không có setup ⇒ chờ)
  - `conflicting_signals` — **cả hai** bên bị quét trong cùng nến cuối (nhập nhằng hướng)
**And** `createTier1Fx()` map `ok:false` ⇒ `{ kind: "veto", tier: "tier1", reason: formatReason(error) }` ⇒ `runPipeline` **dừng ngay**, trả `outcome: "silent"`, `vetoedBy: "tier1"` — **không** chạy Tầng 2/3 (AD-5)
**And** `ok:true` ⇒ `{ kind: "pass" }`; hàm trả kèm `signals` (swingHigh, swingLow, range, penetration mỗi bên, sweepSide) để tầng sau/audit tái dựng **vì sao** ra hướng (đủ log; **persist** là AD-8, ngoài phạm vi)

**AC4 — Dispatch crypto-vs-FX (giải toả deferral từ 2.1) — assembly-time, KHÔNG taxonomy trong lõi**
**Given** cả `createTier1Crypto()` (2.1) và `createTier1Fx()` (story này) đã tồn tại
**When** driver dựng chuỗi tiers cho một cặp
**Then** thêm factory mỏng `createTier1(assetClass: "crypto" | "fx"): Tier` — `assetClass === "crypto"` ⇒ `createTier1Crypto()`, `"fx"` ⇒ `createTier1Fx()`
**And** `assetClass` do **driver cấp lúc assembly** (driver/config biết cặp nào là FX/crypto, y như `news_blackout.pairs` do người soạn config cấp) — **KHÔNG** suy loại cặp trong lõi từ `pair` string, **KHÔNG** thêm `assetClass` vào `MarketSnapshot`/`MARKET_SNAPSHOT_SCHEMA_VERSION`
**And** giữ export ổn định: `createTier1Crypto`, `createTier1Fx`, `createTier1Stub`/`tier1Stub` (pass mặc định) đều còn

**AC5 — Tất định + thuần (AD-2, AD-12)**
**Given** cùng `(snapshot, config)`
**When** gọi Tầng 1 FX nhiều lần
**Then** output **bằng nhau tuyệt đối** (deep-equal); thứ tự kiểm lý-do-chặn **cố định**: `insufficient_data` → (tính sweep) → `conflicting_signals` → `no_liquidity_sweep`
**And** hàm **thuần**: không mutate `snapshot`/`config`, không `Date.now()`/`Math.random()`/IO (pass lint `decision-core`, AD-2); không đọc `nowEpochMillis` cho luật hướng
**And** mọi so sánh/số học giá qua `math/decimal.ts` (`cmp`/`sub`/`div`/`max`-thủ-công) — KHÔNG `Number(...)`, KHÔNG để `number` giá lọt qua (suy diễn price-action **trong lõi** ⇒ live/backtest giống hệt, AD-12)

**AC6 — Ngưỡng luật là config CÓ PHIÊN BẢN (AD-4); thêm additive, không phá param cũ**
**Given** `packages/config` (đã có `ConfigParams`/`DEFAULT_PARAMS`/`validateParams`, gồm 4 param crypto của 2.1)
**When** thêm ngưỡng Tầng 1 FX
**Then** thêm **additive** vào `ConfigParams` + `DEFAULT_PARAMS` + `fieldNames` + `validateParams` (nhân bản pattern có sẵn), gồm:
  - `fx_swing_lookback` (integer ≥ 1) — số kline định nghĩa vùng thanh khoản (swing high/low) trước nến ứng viên
  - `fx_sweep_min_penetration` (decimal-string ≥ 0) — độ xuyên tối thiểu ngoài swing extreme, tính theo tỷ lệ `penetration / range`, để wick tí hon không kích hoạt
  - `fx_min_data_points` (integer ≥ 1) — số kline tối thiểu, dưới ⇒ `insufficient_data`
**And** mọi ngưỡng đọc từ **snapshot config đã version** (AD-4); **KHÔNG** đổi/xoá param cũ (gồm crypto 2.1), `version.ts`, `store.ts`, `snapshot.ts`
**And** ghi chú: các param này **tính vào ngân sách chống overfit** (`max_tunable_params`, 1.9) khi tối ưu — thực thi cap là việc 1.9/optimizer, story này chỉ khai báo

**AC7 — Từ chối input phi lý bằng shape lỗi thống nhất (song song 2.1/1.5/1.6)**
**Given** input giá phi lý: `open/high/low/close` không parse được decimal-string; hoặc ngưỡng config sai miền (`fx_sweep_min_penetration < 0`, `fx_swing_lookback < 1`, `fx_min_data_points < 1`)
**When** Tầng 1 FX chạy nhánh liên quan
**Then** trả **rejection tường minh** `{ code, source: "tier1.fx_regime", context }` (KHÔNG throw string trần, KHÔNG để `NaN`/`Infinity`/`number` lọt qua), map thành veto có `reason` ghi được
**And** chia lỗi rõ: dữ liệu **thiếu** ⇒ `insufficient_data`; dữ liệu **rác** ⇒ `invalid_decimal_string` (context nêu field); **config sai miền** ⇒ `invalid_tier1_param` (context nêu field)

**AC8 — Test phủ từng AC + toolchain sạch**
**Given** Vitest (nền từ epic 1 + 2.1)
**When** thêm test cho `evaluateFxRegime` + wiring `createTier1Fx` + `createTier1` dispatcher + validate config mới
**Then** có test cho: swing high/low tính đúng số tính tay; quét-high ⇒ short, quét-low ⇒ long ở **biên** ngưỡng penetration (`==` ⇒ đủ vì `>=`, dưới ⇒ không); close **quay lại trong** (không close ngoài ⇒ không tính sweep = tiếp diễn, không đảo); cả-hai-bên-quét ⇒ `conflicting_signals`; không bên nào ⇒ `no_liquidity_sweep`; `klines` dưới `max(fx_min_data_points, fx_swing_lookback+1)` / range=0 ⇒ `insufficient_data`; input giá rác ⇒ `invalid_decimal_string`; config sai miền ⇒ `invalid_tier1_param`; **KHÔNG** phụ thuộc news (snapshot có/không news_blackout ⇒ cùng hướng); **tất định** (2× `toEqual`); **không mutate** (`structuredClone`); **không leak number** (`typeof === "string"` field giá); dispatcher `createTier1("crypto")`/`("fx")` trả đúng tier; wiring `createTier1Fx()` veto↔`ok:false` / pass↔`ok:true`; `runPipeline` dừng ở tier1 khi FX veto (tier2/3 không chạy)
**And** `pnpm -r typecheck && pnpm -r build && pnpm -r lint && pnpm -r test` **tất cả pass**; `*.test.ts` KHÔNG lọt `dist/` (`rg --files -g 'dist/**' | rg '\.test\.'` rỗng)

## Tasks / Subtasks

- [x] **Task 1 — Thêm ngưỡng Tầng 1 FX vào `@brighten/config` (additive) (AC: #6, #7)**
  - [x] `packages/config/src/schema.ts`: thêm vào `ConfigParams` (cạnh param crypto 2.1): `fx_swing_lookback: number`, `fx_sweep_min_penetration: string`, `fx_min_data_points: number`
  - [x] Thêm mặc định vào `DEFAULT_PARAMS` (**ngưỡng deferred-tuning**, chốt qua backtest — đề xuất khởi điểm): `fx_swing_lookback: 20`, `fx_sweep_min_penetration: "0.0005"`, `fx_min_data_points: 21`
  - [x] Thêm 3 tên vào mảng `fieldNames`
  - [x] Validate: `fx_swing_lookback` & `fx_min_data_points` qua `isPositiveInteger` (≥ 1, nhân bản `max_trades_per_day`); `fx_sweep_min_penetration` qua `validateNonNegativeDecimalField` (≥ 0). Ghép 3 field vào object trả về của `validateParams`
  - [x] **KHÔNG** đổi param cũ (gồm crypto 2.1), `version.ts`, `store.ts`, `snapshot.ts`
  - [x] `packages/config/src/schema.test.ts`: **UPDATE** — thêm assert 3 mặc định mới `toBe`; `fx_swing_lookback: 0` ⇒ `invalid_positive_integer`; `fx_sweep_min_penetration: "-0.1"` ⇒ `invalid_non_negative_decimal_string`; thiếu 1 field mới ⇒ `missing_config_param`

- [x] **Task 2 — Luật suy hướng FX THUẦN `evaluateFxRegime` (trái tim FR-2 FX) (AC: #1, #2, #3, #5, #7)**
  - [x] `packages/decision-core/tiers/tier1/fx-regime.ts`: **NEW** — hàm thuần
    `evaluateFxRegime(input: FxRegimeInput): FxRegimeOutcome` với:
    - `FxRegimeInput = { snapshot: MarketSnapshot; params: ConfigParams }` (đọc **chỉ** `snapshot.klines`; **KHÔNG** đọc funding/OI/lsr/news)
    - `FxRegimeSignals = { swingHigh: string; swingLow: string; range: string; highPenetration: string; lowPenetration: string; sweepSide: "high" | "low" }` (mọi số decimal-string)
    - `FxRegimePass = { ok: true; direction: TradeDirection; signals: FxRegimeSignals }`
    - `FxRegimeRejection = { ok: false; error: CoreError }` (`source: "tier1.fx_regime"`)
    - `FxRegimeOutcome = FxRegimePass | FxRegimeRejection`
  - [x] Trình tự (thứ tự cố định, AC5):
    1. **Kiểm miền config** (AC7): `fx_swing_lookback ≥ 1`, `fx_min_data_points ≥ 1` (integer), `fx_sweep_min_penetration ≥ 0` — sai ⇒ `invalid_tier1_param`
    2. **insufficient_data**: `klines.length < max(fx_min_data_points, fx_swing_lookback + 1)` ⇒ reject
    3. Cửa sổ swing = `klines` từ đầu tới `length - 2` **giới hạn** `fx_swing_lookback` phần tử cuối trước nến cuối (đặc tả rõ ở Dev Notes); nến ứng viên = `klines[length - 1]`
    4. `swingHigh = max(high)`, `swingLow = min(low)` trên cửa sổ (parse decimal; rác ⇒ `invalid_decimal_string`); `range = sub(swingHigh, swingLow)`; `range == 0` ⇒ `insufficient_data` (thoái hoá)
    5. Tính sweep mỗi bên (đặc tả Dev Notes), penetration theo tỷ lệ `/range`
    6. **conflicting_signals**: cả high-sweep **và** low-sweep ⇒ reject
    7. **no_liquidity_sweep**: không bên nào ⇒ reject
    8. một bên ⇒ `direction` (high⇒short, low⇒long) + `signals`
  - [x] Mọi so sánh/số học giá qua `math/decimal.ts` (`cmp`/`sub`/`div`); `max`/`min` tự viết bằng `cmp` (không có sẵn — thêm helper cục bộ hoặc reduce). Hàm **thuần**, không `nowEpochMillis`, không news (AC2)

- [x] **Task 3 — Nối Tầng 1 FX + dispatcher vào `tier1/index.ts` (AC: #3, #4)**
  - [x] `packages/decision-core/tiers/tier1/index.ts`: thêm `createTier1Fx(): Tier` (id `"tier1"`) — trong `run(ctx)` gọi `evaluateFxRegime({ snapshot: ctx.input, params: ctx.config.params })`; `ok:false` ⇒ `{ kind: "veto", tier: "tier1", reason: formatReasonFx(error) }`; `ok:true` ⇒ `{ kind: "pass" }`
  - [x] `formatReason` hiện tại là **crypto-specific** (render `fundingVote`/`oiDeltaRatio`…). **Chọn một**: (a) tách thành `formatReasonFx` riêng render code FX (`no_liquidity_sweep`/`conflicting_signals` với `sweepSide`/penetration; `insufficient_data`; `invalid_*` với `field`), hoặc (b) refactor `formatReason` thành generic đọc `context.message` + vài code chung. **Khuyến nghị (a)** — mỗi tier-variant một formatter, tránh regress render crypto
  - [x] Thêm factory dispatcher `createTier1(assetClass: "crypto" | "fx"): Tier` ⇒ crypto→`createTier1Crypto()`, fx→`createTier1Fx()`. Định nghĩa type `Tier1AssetClass = "crypto" | "fx"` (không thêm vào `MarketSnapshot`)
  - [x] **GIỮ** export ổn định: `createTier1Crypto`, `createTier1Stub`/`tier1Stub` (pass mặc định), `Tier1StubOptions`, mọi export crypto/CVD của 2.1. Thêm export: `createTier1Fx`, `createTier1`, `evaluateFxRegime` + kiểu (`FxRegimeInput/Outcome/Pass/Rejection/Signals`), `Tier1AssetClass`. `tiers/index.ts` + `decision-core/index.ts` đã `export *` ⇒ tự lan (kiểm không xung đột tên với crypto: dùng tiền tố `Fx*`)
  - [x] **Mang `direction` sang Tầng 2**: vẫn là **seam deferred** như 2.1 — Tầng 2 tiêu thụ ở story 2.4; story này KHÔNG mở rộng `TierOutcome`/`TierContext` thread payload

- [x] **Task 4 — Cập nhật fixtures `ConfigParams` cứng shape (AC: #6, #8)**
  - [x] Thêm 3 field FX mới vào **mọi** literal `ConfigParams` trong test (3 field required ⇒ typecheck đỏ nếu thiếu): `packages/decision-core/pipeline/runner.test.ts`, `packages/decision-core/tiers/tier0/behavioral-veto.test.ts` (gồm mọi inline params), `packages/decision-core/tiers/tier0/index.test.ts`, `packages/decision-core/tiers/tier3/index.test.ts`, và **`packages/decision-core/tiers/tier1/crypto-regime.test.ts`** (2.1 dựng params literal). Dùng giá trị mặc định
  - [x] `packages/config/src/store.test.ts`/`snapshot.test.ts`: nếu dựng từ `DEFAULT_PARAMS` ⇒ tự đúng; nếu literal ⇒ thêm 3 field

- [x] **Task 5 — Tests phủ từng AC (AC: #1..#8)**
  - [x] `packages/decision-core/tiers/tier1/fx-regime.test.ts`: **NEW** — fixture `MarketSnapshot` FX (chỉ `klines`, không funding/OI/lsr, `warnings: []`); test: swingHigh/Low số tính tay; quét-high (last.high vượt swingHigh, close < swingHigh, penetration/range ≥ ngưỡng) ⇒ `short` + `signals.sweepSide==="high"`; biên penetration `==` ngưỡng ⇒ đủ, dưới ⇒ `no_liquidity_sweep`; close **không** quay lại trong (close > swingHigh) ⇒ không sweep; quét-low ⇒ `long`; cả hai ⇒ `conflicting_signals`; không bên nào ⇒ `no_liquidity_sweep`; `klines` thiếu / range=0 ⇒ `insufficient_data`; giá rác ⇒ `invalid_decimal_string`; config `fx_swing_lookback:0` ⇒ `invalid_tier1_param`; **news-independence** (thêm/bỏ `news_blackout` trong params ⇒ output y hệt); tất định (2× `toEqual`); không mutate (`structuredClone`); không leak number
  - [x] `packages/decision-core/tiers/tier1/index.test.ts`: **UPDATE** — thêm: `createTier1Fx()` veto↔`ok:false` (reason render đúng mỗi code FX) / pass↔`ok:true`; `createTier1("crypto")` chạy như crypto (veto khi thiếu funding), `createTier1("fx")` chạy như FX; `createTier1Stub()` vẫn pass. **KHÔNG** phá test crypto wiring 2.1 hiện có
  - [x] `packages/decision-core/pipeline/runner.test.ts`: **UPDATE** — thêm case: chèn `createTier1Fx()`, snapshot FX "không có hướng" ⇒ `runPipeline` `silent`/`vetoedBy:"tier1"`, tier2/3 không chạy
  - [x] `pnpm -r test` pass; xác nhận `dist/` không chứa `*.test.*`

## Dev Notes

> **Bối cảnh:** Story 2.2 là **cặp song sinh FX** của 2.1 — hoàn tất Tầng 1 (FR-2) bằng nhánh **FX price-action** và **giải toả deferral dispatcher** mà 2.1 để lại. Nó xây theo **đúng khuôn 2.1**: hàm thuần `evaluateFxRegime` tách khỏi `index.ts` mỏng, shape lỗi `{ code, source: "tier1.fx_regime", context }`, thứ-tự-kiểm-cố-định, `signals` payload đủ-log, mọi ngưỡng từ config versioned (AD-4), test biên/determinism/non-mutation/news-independence. **Điểm khác cốt lõi với crypto:** FX **không có** funding/OI/lsr/CVD — hướng đọc **thuần price action** trên `klines` (vùng thanh khoản = swing high/low bị quét). Suy diễn này **trong lõi thuần** (AD-12) ⇒ live/backtest giống hệt.

> **Phụ thuộc:** story này build **trên** 2.1 (chưa commit lúc soạn — `tier1/index.ts`, `crypto-regime.ts`, `cvd.ts`, 4 param crypto trong `schema.ts`, fixtures đã cập nhật). Dev PHẢI có cây làm việc 2.1 trước khi bắt đầu. [Source: 2-1-tier1-crypto-regime-edge.md → File List]

### 🔑 Giải toả mơ hồ: "price action vùng thanh khoản" nghĩa là gì cụ thể — đừng để dev đoán

- **Vùng thanh khoản = nơi stop cụm lại = swing high/low.** Smart-money "quét" (sweep) các pool này để lấy thanh khoản rồi đảo chiều. Đây là cách đọc **tất định, testable** của "price action đọc vùng thanh khoản / theo dòng smart-money" trong AC gốc — KHÔNG phải chỉ báo mờ. [Source: epics.md → Story 2.2 AC; prd.md#FR-2 "hướng edge dựa trên price action đọc vùng thanh khoản"]
- **Sweep + reversal (không phải breakout).** Điểm mấu chốt: high **vượt** swing-high nhưng **close quay lại dưới** ⇒ đó là *quét* (đảo), không phải *phá vỡ* (tiếp diễn). Nếu close **trên** swing-high ⇒ breakout, KHÔNG cho hướng short (không phải setup smart-money) ⇒ neutral bên đó. Tương tự low sweep. Đây là ranh giới quan trọng dev dễ nhầm.
- **`fx_sweep_min_penetration` theo TỶ LỆ (`penetration/range`)** để không phụ thuộc scale giá cặp (EURUSD ~1.0x vs USDJPY ~150x). Wick tí hon (penetration/range < ngưỡng) ⇒ không tính sweep ⇒ tránh nhiễu. [Source: ARCHITECTURE-SPINE.md#Consistency Conventions → Tiền/số dùng decimal]
- **Tin tức KHÔNG chọn hướng (AC2).** Đây là ràng buộc *âm* (đừng làm): `evaluateFxRegime` **không nhận** `news_blackout`. Tin FX là **bộ lọc rủi ro Tầng 0** (veto `news_blackout` — story 1.6 xong; nạp lịch tin → blackout là story 2.3/FR-6). Test chứng minh: đổi `news_blackout` ⇒ hướng **không đổi**. [Source: prd.md#FR-2 "tin tức KHÔNG dùng chọn hướng (chỉ là bộ lọc rủi ro ở Tầng 0)"; epics.md → Story 2.2, 2.3]
- **"Không rõ hướng → dừng pipeline" ⇒ veto tier1** (y hệt 2.1) ⇒ `runPipeline` silent, không chạy Tầng 2/3. `no_liquidity_sweep` = "không có setup → chờ" (AC gốc). [Source: ARCHITECTURE-SPINE.md#AD-5]

### Đặc tả luật Tầng 1 FX (một nguồn sự thật)

```text
# evaluateFxRegime(snapshot, params) — thứ tự cố định; trả REJECTION đầu tiên khớp, else { ok:true, direction }
# đọc CHỈ snapshot.klines. KHÔNG funding/OI/lsr/CVD/news.

0. kiểm miền config:
     fx_swing_lookback >= 1 (int) ; fx_min_data_points >= 1 (int) ; fx_sweep_min_penetration >= 0
     sai ⇒ invalid_tier1_param (context.field)
1. insufficient_data: klines.length < max(fx_min_data_points, fx_swing_lookback + 1)
2. cửa sổ swing = fx_swing_lookback kline NGAY TRƯỚC nến cuối:
     candidate = klines[len-1]
     window    = klines[len-1-fx_swing_lookback .. len-2]      # đúng fx_swing_lookback nến
     swingHigh = max(window[i].high) ; swingLow = min(window[i].low)   # parse decimal; rác ⇒ invalid_decimal_string
     range = swingHigh − swingLow ; range == 0 ⇒ insufficient_data
3. sweep mỗi bên (candidate = nến cuối):
     highSweep = candidate.high > swingHigh
                 AND candidate.close < swingHigh                       # close QUAY LẠI dưới (đảo, không breakout)
                 AND (candidate.high − swingHigh)/range >= fx_sweep_min_penetration
     lowSweep  = candidate.low  < swingLow
                 AND candidate.close > swingLow                        # close QUAY LẠI trên
                 AND (swingLow − candidate.low)/range >= fx_sweep_min_penetration
4. conflicting_signals : highSweep AND lowSweep
5. no_liquidity_sweep  : NOT highSweep AND NOT lowSweep
6. direction: highSweep ⇒ short ; lowSweep ⇒ long
   signals = { swingHigh, swingLow, range, highPenetration, lowPenetration, sweepSide }

source = "tier1.fx_regime" cho mọi rejection
```

> **Về luật cụ thể (sweep-reversal):** *cấu trúc* (swing pool → sweep + close-back → penetration gate → cả-hai⇒dừng) là **hợp đồng cố định** của story. Chi tiết (chỉ xét 1 nến cuối làm ứng viên, penetration theo tỷ lệ) là **mặc định tài liệu-hoá** khớp tinh thần smart-money; **ngưỡng số** (`fx_swing_lookback`, `fx_sweep_min_penetration`) là **config deferred**, chốt qua backtest (AD-4, §Deferred). Dev **giữ nguyên cấu trúc này**; đừng phát minh chỉ báo khác (RSI/MA…). [Source: ARCHITECTURE-SPINE.md#Deferred; #AD-4]

### Hợp đồng đã có (PHẢI tuân, đọc trước khi sửa) — trạng thái sau 2.1

| File | Trạng thái sau 2.1 | Story 2.2 đổi gì | Phải giữ nguyên |
| --- | --- | --- | --- |
| `tiers/tier1/index.ts` | `createTier1Crypto()`, `createTier1Stub`/`tier1Stub`, `formatReason` (crypto-specific), export crypto/CVD | **+`createTier1Fx()`** + `formatReasonFx`; **+`createTier1(assetClass)`** dispatcher; export FX helper/kiểu | `createTier1Crypto`/`createTier1Stub`/`tier1Stub`/`Tier1StubOptions`; hành vi stub pass; render crypto của `formatReason` |
| `tiers/tier1/crypto-regime.ts`, `cvd.ts` | luật crypto + CVD (2.1) | **không sửa** (FX là module riêng) | toàn bộ |
| `types/index.ts` | `Kline`(`open/high/low/close`), `MarketSnapshot`, `TradeDirection`, `CoreError` | **không sửa** (klines đủ shape cho price action) | toàn bộ; `MARKET_SNAPSHOT_SCHEMA_VERSION` |
| `pipeline/runner.ts` | `TierContext.input/config`, veto→silent dừng ngay | **không sửa** (FX đọc `ctx.input`/`ctx.config` sẵn có; direction-payload deferred) | `runPipeline`/`TierOutcome`/`TierContext` |
| `packages/config/src/schema.ts` | `ConfigParams` gồm 4 param crypto 2.1; patterns validate | **+3 field FX** (additive) + validate | mọi param cũ (gồm crypto 2.1); `version.ts`/`store.ts`/`snapshot.ts` |
| `math/decimal.ts` | `add/sub/mul/div/cmp/toDecimal/abs/isPositive` | **không sửa** — tái dùng; `max/min` viết cục bộ bằng `cmp` | precision/rounding một chỗ |
| test fixtures `ConfigParams` | đã có 4 param crypto 2.1 | **+3 field FX** vào mọi literal (gồm `crypto-regime.test.ts`) | assertion cũ |

[Source: packages/decision-core/tiers/tier1/index.ts; crypto-regime.ts; cvd.ts; types/index.ts; pipeline/runner.ts; packages/config/src/schema.ts; math/decimal.ts]

### Invariant kiến trúc PHẢI tuân

- **AD-2 — thuần & tất định:** hàm thuần; không `Date`/`Math.random`/IO (lint chặn); cùng `(snapshot,config)` → cùng output (NFR-6/NFR-1). [Source: #AD-2]
- **AD-12 — suy diễn tín hiệu trong lõi:** price-action (swing/sweep) tính trong `decision-core`, adapter chỉ giao `klines` raw ⇒ live/backtest giống hệt. [Source: #AD-12]
- **AD-5 — thứ tự gating:** Tầng 1 sau Tầng 0, trước Tầng 2; veto ⇒ dừng ngay im lặng; Tầng 2 chỉ tìm điểm vào theo hướng Tầng 1 (2.4). [Source: #AD-5]
- **AD-11 — suy giảm mềm khi thiếu dữ liệu:** thiếu kline/range thoái hoá ⇒ `insufficient_data` veto, không phát Đề xuất trên dữ liệu khuyết. [Source: #AD-11; NFR-5]
- **AD-4 — config có phiên bản:** ngưỡng FX là param versioned, snapshot cùng mỗi quyết định. [Source: #AD-4]
- **AD-8 — audit append-only:** `signals` + `code`/`context` **đủ để log** vì-sao ra hướng/bị chặn; **persist** ngoài phạm vi (chưa có persistence adapter). [Source: #AD-8]

### Ngoài phạm vi story này (đừng làm — để story sau)

- **Nạp lịch tin FX → cửa sổ `news_blackout`** — **story 2.3** (FR-6). Story này KHÔNG đọc/nạp tin; chỉ đảm bảo tin **không** chọn hướng.
- **Mang `direction` vào Tầng 2 (`TierContext`/`runPipeline` threading payload)** — seam **deferred**; Tầng 2 tiêu thụ ở **story 2.4**. Nay chỉ cấp hàm thuần trả `direction` + wiring pass/veto.
- **Backtest chạy đủ 4 tầng** — **story 2.5**. Story này KHÔNG wire tier chain vào `backtest-cli`; dispatcher `createTier1(assetClass)` để driver 2.5 dùng.
- **Suy loại cặp (FX/crypto) tự động từ `pair` string trong lõi** — KHÔNG làm; `assetClass` do driver/config cấp lúc assembly (AC4).
- **Multi-timeframe / nhiều nến ứng viên / order-block / FVG** — luật 2.2 xét 1 nến cuối làm ứng viên sweep. Mở rộng price-action là v2/story sau, không đụng seam này.
- **Persist tín hiệu/hướng/lần chặn vào Nhật ký audit** — AD-8, cần persistence adapter (epic 3).
- **Live poll klines FX real-time** — `cron-runner` (epic 3). Story này đọc `MarketSnapshot` bơm sẵn (backtest lịch sử / fixture).

### Source tree mục tiêu (phần thêm/đổi)

```text
packages/config/src/
  schema.ts                          # UPDATE: +3 field FX (additive) + validate
  schema.test.ts                     # UPDATE: cover 3 mặc định + miền sai + missing field
packages/decision-core/
  tiers/tier1/
    fx-regime.ts                     # NEW: evaluateFxRegime() + Input/Pass/Rejection/Signals/Outcome
    fx-regime.test.ts                # NEW
    index.ts                         # UPDATE: +createTier1Fx() + formatReasonFx + createTier1(assetClass) dispatcher; export FX; GIỮ crypto/stub
    index.test.ts                    # UPDATE: FX wiring + dispatcher; giữ crypto wiring
    crypto-regime.ts / cvd.ts        # (không đổi)
    crypto-regime.test.ts            # UPDATE: +3 field FX vào ConfigParams literal
  pipeline/runner.test.ts            # UPDATE: +case FX tier1 veto ⇒ silent; +3 field fixture
  tiers/tier0/behavioral-veto.test.ts, tier0/index.test.ts, tier3/index.test.ts  # UPDATE: +3 field fixture
```
[Source: ARCHITECTURE-SPINE.md#Structural Seed "một filter/tầng = một module trong decision-core/tiers/"; bố cục 2.1 làm khuôn]

### Project Structure Notes

- Tách `fx-regime.ts` khỏi `index.ts` (song song `crypto-regime.ts`): hàm thuần dễ test đơn vị; `index.ts` chỉ nối pipeline + format + dispatch.
- Tái dùng `math/decimal.ts` — `max`/`min` chưa có, viết helper cục bộ bằng `cmp` (đừng thêm vào `math/decimal.ts` trừ khi muốn dùng lại; giữ thay đổi tối thiểu).
- Config: +3 field additive; mọi literal `ConfigParams` (gồm `crypto-regime.test.ts` của 2.1) phải thêm, nếu không typecheck đỏ (3 field required). Không đổi `version.ts`/`store.ts`/`snapshot.ts`.
- `formatReason` crypto **không** tái dùng cho FX (render field khác) ⇒ tạo `formatReasonFx` để tránh regress render crypto. Đây là điểm dev dễ vô tình phá test 2.1.
- Xung đột tên khi `export *`: dùng tiền tố `Fx*` cho kiểu FX; `createTier1` dispatcher là tên mới (chưa tồn tại — grep xác nhận 2.1 chỉ có `createTier1Crypto`/`createTier1Stub`).
- `apps/*` chưa wire tier chain ⇒ thêm FX + dispatcher an toàn, không vỡ app; wiring vào backtest là 2.5.

### Chuẩn test

- Vitest; mỗi AC ≥ 1 test. Ưu tiên **số cụ thể tính tay**:
  - swing: window highs `["1.1050","1.1080","1.1060"]` ⇒ swingHigh `"1.1080"`; lows tương tự ⇒ swingLow.
  - high-sweep: `swingHigh="1.1080"`, `range="0.0080"`, candidate `high="1.1090"` (penetration `"0.0010"`, ratio `"0.125"` ≥ `fx_sweep_min_penetration`), `close="1.1075"` (< swingHigh) ⇒ **short**.
  - biên penetration: ratio `==` ngưỡng ⇒ sweep (dùng `>=`); ngay dưới ⇒ `no_liquidity_sweep`.
  - breakout (không sweep): candidate `close="1.1095"` (> swingHigh) ⇒ high **không** sweep.
- Test **conflicting**: candidate vừa `high>swingHigh & close<swingHigh` vừa `low<swingLow & close>swingLow` (nến range rộng cả hai đầu, close giữa) ⇒ `conflicting_signals`.
- Test **news-independence**: chạy cùng snapshot với `params.news_blackout=[]` và với 1 window phủ pair ⇒ **cùng** `ok:true, direction` (chứng minh AC2).
- Test **insufficient_data**: `klines.length = fx_swing_lookback` (thiếu 1) ⇒ reject; window mọi high==low ⇒ range 0 ⇒ reject.
- Test **tất định** (2× `toEqual`), **không mutate** (`structuredClone` snapshot+params), **không leak number** (`typeof === "string"` cho `swingHigh`/`range`/penetration).
- Test **dispatcher**: `createTier1("crypto")` trên snapshot thiếu funding ⇒ veto (chạy đúng nhánh crypto); `createTier1("fx")` trên snapshot FX ⇒ chạy FX.
- Test **wiring**: `createTier1Fx()` map `ok:false`→veto (reason render), `ok:true`→pass; `runPipeline` với FX veto ⇒ `silent`/`vetoedBy:"tier1"`, tier2/3 **không** chạy.
- Không integration/DB; snapshot là fixture.

### References

- [Source: epics.md → Epic 2, Story 2.2] — AC gốc (BDD): hướng suy từ price action / vùng thanh khoản; tin KHÔNG chọn hướng (chỉ bộ lọc rủi ro Tầng 0); không rõ hướng → "không có hướng", dừng pipeline
- [Source: prd.md#FR-2] — FX: hướng edge dựa trên price action đọc vùng thanh khoản; tin tức KHÔNG dùng chọn hướng; mâu thuẫn/dưới ngưỡng → "không có hướng" dừng pipeline
- [Source: ARCHITECTURE-SPINE.md#AD-2] — lõi thuần tất định (lint chặn IO/Date/random); NFR-6
- [Source: ARCHITECTURE-SPINE.md#AD-12] — suy diễn tín hiệu (price-action) trong lõi thuần, adapter chỉ giao raw ⇒ live/backtest giống hệt
- [Source: ARCHITECTURE-SPINE.md#AD-5] — thứ tự gating 0→1→2→3; veto dừng ngay im lặng; Tầng 2 theo hướng Tầng 1
- [Source: ARCHITECTURE-SPINE.md#AD-11] — suy giảm mềm khi thiếu dữ liệu → không phát Đề xuất; `insufficient_data`
- [Source: ARCHITECTURE-SPINE.md#AD-4; #Deferred] — ngưỡng luật FX là config có phiên bản; số cụ thể chốt qua backtest
- [Source: ARCHITECTURE-SPINE.md#Capability Map] — FR-2 Tầng 1 regime/edge lives in `decision-core/tiers/tier1`, governed AD-2/AD-5/AD-11
- [Source: packages/decision-core/tiers/tier1/index.ts] — hợp đồng 2.1: `createTier1Crypto`/`createTier1Stub`/`tier1Stub`/`formatReason`; điểm thêm `createTier1Fx`/`createTier1`
- [Source: packages/decision-core/tiers/tier1/crypto-regime.ts] — khuôn trực tiếp: hàm thuần tách khỏi index, `{ ok:true, direction, signals } | { ok:false, error }`, thứ-tự-kiểm-cố-định, `validateTier1Params`, `parseSignalDecimal`, reject shape
- [Source: packages/decision-core/types/index.ts] — `Kline`(`open/high/low/close`), `MarketSnapshot`(klines luôn có; funding/OI/lsr optional = vắng ở FX), `TradeDirection`, `CoreError`
- [Source: packages/decision-core/pipeline/runner.ts] — `TierContext`(`input`/`config`)/`TierOutcome`(pass/veto)/`runPipeline` (veto→silent, dừng ngay)
- [Source: packages/config/src/schema.ts] — `ConfigParams`/`DEFAULT_PARAMS`/`validateParams`/`fieldNames` (gồm crypto 2.1); patterns `isPositiveInteger`/`validateNonNegativeDecimalField` để nhân bản
- [Source: packages/decision-core/math/decimal.ts] — wrapper decimal precision-một-chỗ (`cmp`/`sub`/`div`) để tái dùng
- [Source: 2-1-tier1-crypto-regime-edge.md] — story song sinh crypto: khuôn hàm-thuần/wiring/config-additive/fixtures/news-độc-lập; deferral dispatcher mà 2.2 giải toả

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- 2026-07-04: Resolver script failed because shell Python lacks `tomllib` / Python 3.11; workflow customization was resolved manually from base/team/user files.
- 2026-07-04: `pnpm --filter @brighten/config test && pnpm --filter @brighten/decision-core test && pnpm --filter @brighten/decision-core typecheck` initially required rebuilding `@brighten/config` declarations before decision-core typecheck.
- 2026-07-04: Full validation first failed on `exactOptionalPropertyTypes` in dispatcher test when using `funding: undefined`; fixture now deletes the optional property to represent missing funding.
- 2026-07-04: Full `pnpm -r typecheck && pnpm -r build && pnpm -r lint && pnpm -r test` passed.
- 2026-07-04: Removed stale generated `dist/*.test.*` artifacts; verified both `rg --files -g 'dist/**' | rg '\.test\.'` and a direct `find packages apps -path '*/dist/*' ...` return no test artifacts.

### Completion Notes List

- Added additive FX Tier 1 config params and validation: swing lookback, sweep min penetration, and min data points.
- Implemented pure `evaluateFxRegime` using only `snapshot.klines`, decimal math, fixed rejection order, liquidity sweep/reversal rules, and signal payloads.
- Added `createTier1Fx()` and assembly-time `createTier1("crypto" | "fx")` dispatcher while preserving crypto and stub exports/behavior.
- Updated required `ConfigParams` literals with FX params, including existing crypto regime tests.
- Added Vitest coverage for FX swing/sweep behavior, boundary penetration, no-sweep/breakout/conflict, insufficient data, invalid input/config, news-independence, determinism, non-mutation, wiring, dispatcher, and pipeline stop-on-veto.

### File List

- `_bmad-output/implementation-artifacts/2-2-tier1-fx-price-action.md`
- `packages/config/src/schema.ts`
- `packages/config/src/schema.test.ts`
- `packages/decision-core/pipeline/runner.test.ts`
- `packages/decision-core/tiers/tier0/behavioral-veto.test.ts`
- `packages/decision-core/tiers/tier0/index.test.ts`
- `packages/decision-core/tiers/tier1/crypto-regime.test.ts`
- `packages/decision-core/tiers/tier1/fx-regime.ts`
- `packages/decision-core/tiers/tier1/fx-regime.test.ts`
- `packages/decision-core/tiers/tier1/index.ts`
- `packages/decision-core/tiers/tier1/index.test.ts`
- `packages/decision-core/tiers/tier3/index.test.ts`

### Change Log

- 2026-07-04: Implemented Story 2.2 Tier 1 FX price-action regime, config params, Tier 1 dispatcher, pipeline wiring tests, and full validation; status moved to review.
