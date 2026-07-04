---
baseline_commit: bd489f4a1902a89f12d6c1f45fd33ead36a87e91
---

# Story 1.7: Adapter dữ liệu Binance lịch sử (FR-5 lịch sử)

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **người xây Brighten**,
I want **adapter `binance-rest` (lịch sử) — hiện thực `IngestionPort` sau `ingestion` port — lấy klines (kèm taker buy volume), funding, open interest và long/short ratio từ Binance REST cho một cặp + khung thời gian + khoảng ngày, chuẩn hoá về đúng shape `MARKET_SNAPSHOT` (chỉ dữ liệu THÔ, KHÔNG chỉ báo), và suy giảm mềm + log khi endpoint lỗi/thiếu**,
so that **backtest engine (Story 1.8) đo được trên dữ liệu thật đã chuẩn hoá, live-tick và backtest đọc CÙNG một shape, và hệ thống không bao giờ phát Đề xuất/kết quả trên dữ liệu khuyết được coi là hợp lệ (FR-5, AD-11, AD-12, NFR-5)**.

## Acceptance Criteria

**AC1 — Adapter hiện thực `IngestionPort`, sau port (AD-1, AD-11)**
**Given** `IngestionPort.getMarketSnapshot(request: MarketSnapshotRequest): Promise<Result<MarketSnapshot>>` (đã định nghĩa ở `decision-core/ports/ingestion.ts`) với `request = { pair, timeframe, fromEpochMillis, toEpochMillis }`
**When** gọi factory `createBinanceRestIngestion(deps)` → trả một object thoả **đúng** `IngestionPort`
**Then** adapter sống ở `packages/adapters/binance-rest/`, phụ thuộc **chỉ** vào `@brighten/decision-core` (types/ports) — **KHÔNG** để `decision-core` import ngược adapter (lint đã chặn `@brighten/adapters` trong core)
**And** mọi IO (network) **được phép** ở adapter (adapter KHÔNG bị lint cấm IO như core); nhưng adapter **KHÔNG** tự đọc đồng hồ/random cho logic quyết định — thời gian là input qua `request`/`clock` nếu cần
**And** `fetch` được **tiêm** qua `deps` (vd `deps.fetchFn?: typeof fetch`, `deps.baseUrl?`) để test **không** chạm mạng thật

**AC2 — Klines chuẩn hoá kèm taker buy volume, giá/khối lượng là decimal-string (AD-12, Consistency: Tiền tệ)**
**Given** endpoint `GET {fapiBase}/fapi/v1/klines?symbol=&interval=&startTime=&endTime=&limit=` (limit tối đa **1500**, mặc định 500)
**When** adapter map `timeframe` → `interval` Binance và fetch klines trong `[fromEpochMillis, toEpochMillis]`
**Then** mỗi kline chuẩn hoá giữ **thô**: `openTime`, `open`, `high`, `low`, `close`, `volume` (base), `closeTime`, `quoteVolume`, `numberOfTrades`, `takerBuyBaseVolume`, `takerBuyQuoteVolume` — giá & khối lượng là **decimal-string** (Binance trả string, giữ nguyên; KHÔNG parse sang JS `number`); timestamps là `number` epoch-ms
**And** adapter **KHÔNG** tính `takerSellVolume`/CVD/regime/chỉ báo — chỉ giao `takerBuy*` + `volume` thô; **suy diễn tín hiệu là việc của core** (AD-12). Ghi rõ convention: `takerSell = volume − takerBuyBase` do **core** tính, không phải adapter
**And** khi khoảng ngày cho ra > `limit` nến ⇒ adapter **phân trang** (lặp `startTime` theo `closeTime` nến cuối) tới khi phủ hết `toEpochMillis`, không cắt cụt im lặng

**AC3 — Funding, open interest, long/short ratio chuẩn hoá**
**Given** các endpoint: funding `GET /fapi/v1/fundingRate?symbol=&startTime=&endTime=&limit=`; open interest lịch sử `GET /futures/data/openInterestHist?symbol=&period=&startTime=&endTime=&limit=`; long/short `GET /futures/data/globalLongShortAccountRatio?symbol=&period=&startTime=&endTime=&limit=`
**When** adapter fetch các feed phụ cho cùng cặp + khoảng
**Then** chuẩn hoá **thô**: funding `[{ fundingTime, fundingRate }]`; openInterest `[{ timestamp, sumOpenInterest, sumOpenInterestValue }]`; longShortRatio `[{ timestamp, longShortRatio, longAccount, shortAccount }]` — mọi trị số là **decimal-string**, timestamps `number`
**And** `period` cho OI/LS map từ `timeframe` (enum hợp lệ: `5m,15m,30m,1h,2h,4h,6h,12h,1d`); `timeframe` không map được ⇒ feed đó **suy giảm mềm** (xem AC5), KHÔNG throw

**AC4 — `MARKET_SNAPSHOT` shape do adapter sở hữu; core-visible, version hoá khi đổi (Consistency: Market snapshot)**
**Given** `MarketSnapshot` hiện là **placeholder** ở `decision-core/types/index.ts` (`{ pair, timeframe, atEpochMillis, [key:string]: unknown }`, note "enriched in Story 1.7")
**When** story 1.7 làm giàu shape
**Then** `MarketSnapshot` mang: `pair`, `timeframe`, `atEpochMillis` (mốc "as-of" của cửa sổ = `request.toEpochMillis`), `klines: readonly Kline[]`, và các feed phụ **optional** `funding?`, `openInterest?`, `longShortRatio?` (vắng = **chưa/không lấy được**, phân biệt với mảng rỗng = "có gọi, không bản ghi") + `warnings: readonly SnapshotWarning[]` (danh sách feed suy giảm)
**And** type **vẫn ở `decision-core/types`** (core tiêu thụ `ctx.input`, không thể import adapters); adapter **populate** nó. Bỏ index-signature `[key:string]: unknown`, dùng field cụ thể; **đổi shape về sau phải version hoá** (thêm `snapshotSchemaVersion` hằng số) — live-tick ghi & backtest đọc cùng shape
**And** `MarketSnapshotRequest` giữ nguyên (không đổi port)

**AC5 — Suy giảm mềm khi lỗi/thiếu; KHÔNG trả dữ liệu khuyết như hợp lệ (NFR-5, AD-11)**
**Given** một endpoint feed **phụ** (funding/OI/LS) lỗi HTTP / timeout / trả rỗng do ngoài cửa sổ lưu trữ (**OI & long/short chỉ giữ 30 ngày gần nhất** — khoảng ngày cũ hơn ⇒ không có dữ liệu)
**When** adapter gặp lỗi/thiếu ở feed phụ
**Then** feed đó để **`undefined`** (không bịa mảng rỗng thành "hợp lệ"), thêm một `SnapshotWarning { source, code, context }` vào `warnings`, và **vẫn** trả `Result.ok=true` với snapshot còn lại (suy giảm mềm) — KHÔNG làm chết cả tick
**And** feed **klines (bắt buộc)** lỗi/thiếu ⇒ **KHÔNG** suy giảm mềm: trả `Result.ok=false` với `CoreError { code, source: "adapter.binance_rest", context }` — không có giá thì không có snapshot hợp lệ để backtest
**And** lỗi shape thống nhất `{ code, source, context }`; mọi lỗi/suy giảm được **log** (qua một `logger` tiêm được, mặc định no-op — KHÔNG `console.log` cứng trong lib); non-2xx/parse fail → phân loại code rõ (`http_error`, `invalid_payload`, `unavailable_out_of_retention`)

**AC6 — Chuẩn hoá tất định cho cùng payload (fidelity live≡backtest)**
**Given** cùng một payload HTTP giả (fixture cố định)
**When** chạy chuẩn hoá **nhiều lần**
**Then** cùng `MarketSnapshot` (deep-equal) — chuẩn hoá là **thuần** trên payload đã nhận (phần thuần tách khỏi phần fetch), không phụ thuộc thời gian/thứ tự; đảm bảo live-tick và backtest tính **giống hệt** khi cùng dữ liệu thô (AD-12)
**And** hàm chuẩn hoá **KHÔNG** mutate payload đầu vào; số tiền/khối lượng giữ **string** (không leak `number`)

**AC7 — Hạ tầng test cho package adapters + phủ AC + toolchain sạch**
**Given** `packages/adapters` **chưa có** vitest/`test` script
**When** thêm test
**Then** thêm `packages/adapters/vitest.config.ts` + `"test": "vitest run"` (và `test:watch`) vào `packages/adapters/package.json` (vitest đã là devDep gốc); test **tiêm `fetchFn` giả** trả fixture — KHÔNG gọi mạng thật
**And** test phủ: map timeframe→interval/period; chuẩn hoá kline đúng **từng index** (idx 9=takerBuyBase, idx 10=takerBuyQuote, idx 5=volume) thành field đúng, decimal-string giữ nguyên; phân trang khi > limit; funding/OI/LS chuẩn hoá; **suy giảm mềm** feed phụ (lỗi HTTP + rỗng-do-30-ngày → `undefined` + `warnings`, `ok=true`); **klines lỗi → `ok=false`**; tất định (2 lần `toEqual`); không mutate payload; không leak `number`
**And** `pnpm -r typecheck && pnpm -r build && pnpm -r lint && pnpm -r test` **tất cả pass**; `*.test.ts` không lọt `dist/`

## Tasks / Subtasks

- [x] **Task 1 — Làm giàu `MarketSnapshot` + kiểu feed trong `decision-core/types` (AC: #2, #3, #4)**
  - [x] `packages/decision-core/types/index.ts`: thay placeholder `MarketSnapshot` (xoá note "enriched in 1.7" + index-signature) bằng shape cụ thể:
    - `Kline = { openTime: number; open: string; high: string; low: string; close: string; volume: string; closeTime: number; quoteVolume: string; numberOfTrades: number; takerBuyBaseVolume: string; takerBuyQuoteVolume: string }`
    - `FundingPoint = { fundingTime: number; fundingRate: string }`
    - `OpenInterestPoint = { timestamp: number; sumOpenInterest: string; sumOpenInterestValue: string }`
    - `LongShortRatioPoint = { timestamp: number; longShortRatio: string; longAccount: string; shortAccount: string }`
    - `SnapshotWarning = { source: string; code: string; context?: Readonly<Record<string, unknown>> }`
    - `MarketSnapshot = { pair: string; timeframe: string; atEpochMillis: number; klines: readonly Kline[]; funding?: readonly FundingPoint[]; openInterest?: readonly OpenInterestPoint[]; longShortRatio?: readonly LongShortRatioPoint[]; warnings: readonly SnapshotWarning[] }`
    - Comment: shape **do ingestion adapter sở hữu**, đặt ở core vì core tiêu thụ `ctx.input`; **đổi phải version hoá** — thêm hằng `export const MARKET_SNAPSHOT_SCHEMA_VERSION = 1` [Source: ARCHITECTURE-SPINE.md#Consistency Conventions → Market snapshot; AD-12]
  - [x] Kiểm hồi quy: `MarketSnapshot` đang dùng ở `pipeline/runner.ts` (`TierContext.input`), test tier3/runner (chỉ set `pair`/`timeframe`/`atEpochMillis`). Vì `klines`/`warnings` nay **bắt buộc**, các fixture test cũ sẽ **đỏ typecheck** → cập nhật: thêm `klines: []`, `warnings: []` vào các `const input: MarketSnapshot` trong `pipeline/runner.test.ts` và `tiers/tier3/index.test.ts` (và bất kỳ nơi khác dựng `MarketSnapshot`). Đây là thay đổi bắt buộc để build xanh — liệt kê hết bằng grep `MarketSnapshot`

- [x] **Task 2 — Tách phần thuần: chuẩn hoá payload → snapshot (AC: #2, #3, #6)**
  - [x] `packages/adapters/binance-rest/normalize.ts`: **NEW** — hàm **thuần** (không IO) map **payload thô đã nhận** → mảnh snapshot:
    - `normalizeKlines(raw: unknown): Result<Kline[]>` — mỗi phần tử là array 12 phần tử; lấy idx 0,1,2,3,4,5,6,7,8,9,10 theo đúng vị trí; validate là mảng-của-mảng, phần tử số/parse-được, giữ **string** cho giá/khối lượng (KHÔNG `Number()`); payload sai shape ⇒ `invalid_payload`
    - `normalizeFunding`, `normalizeOpenInterest`, `normalizeLongShort` tương tự (đọc field theo tên JSON: `fundingRate`/`fundingTime`; `sumOpenInterest`/`sumOpenInterestValue`/`timestamp`; `longShortRatio`/`longAccount`/`shortAccount`/`timestamp`)
  - [x] Thuần & không mutate input; deterministic; đây là nơi test kỹ nhất (giá trị fidelity AD-12). **KHÔNG** tính `takerSell`/CVD/chỉ báo ở đây

- [x] **Task 3 — Phần IO: fetch + phân trang + suy giảm mềm (AC: #1, #2, #3, #5)**
  - [x] `packages/adapters/binance-rest/index.ts`: thay scaffold bằng `createBinanceRestIngestion(deps: BinanceRestDeps): IngestionPort` với
    `BinanceRestDeps = { fetchFn?: FetchLike; fapiBaseUrl?: string; futuresDataBaseUrl?: string; logger?: (w: SnapshotWarning) => void }` (mặc định `fetchFn = fetch` toàn cục Node 22, base URL Binance thật, logger no-op)
    - map `timeframe` → kline `interval` **và** OI/LS `period` (bảng map; timeframe lạ cho kline ⇒ `ok=false` `invalid_timeframe`; cho OI/LS ⇒ suy giảm mềm)
    - `getMarketSnapshot(request)`:
      1. Fetch **klines** có **phân trang** (limit 1500, lặp theo `closeTime`+1 tới `toEpochMillis`) → normalize; **lỗi/thiếu ⇒ `ok=false`** (bắt buộc)
      2. Fetch funding/OI/LS song song (`Promise.allSettled`); mỗi feed lỗi/timeout/rỗng-ngoài-30-ngày ⇒ để `undefined` + push `SnapshotWarning` + `logger(w)` (suy giảm mềm)
      3. Trả `ok=true` với `{ pair, timeframe, atEpochMillis: request.toEpochMillis, klines, funding?, openInterest?, longShortRatio?, warnings }`
    - Helper `fetchJson(url)`: non-2xx ⇒ `http_error`; JSON parse fail ⇒ `invalid_payload`; wrap network throw. **KHÔNG** `console.log` cứng — dùng `logger`
  - [x] `FetchLike` type nội bộ (tối thiểu cần: `(url: string) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>`) để tiêm giả dễ. Ghi chú **30 ngày** cho `/futures/data/*` ngay tại chỗ fetch OI/LS (lý do suy giảm với range cũ)

- [x] **Task 4 — Export + barrel + không phá app (AC: #1)**
  - [x] Export từ `packages/adapters/binance-rest/index.ts`: `createBinanceRestIngestion`, `BinanceRestDeps`, `FetchLike`, và (nếu công khai) helper map timeframe. `packages/adapters/index.ts` đã `export *` từ `binance-rest` → tự lan
  - [x] Giữ/không phá kiểu scaffold cũ nếu có nơi tham chiếu (`BinanceRestAdapterScaffold`) — grep xác nhận không ai import (`apps/*`, `packages/*`); nếu không ai dùng, thay hẳn scaffold bằng factory thật
  - [x] `apps/*` hiện chỉ import **type** từ core (`PipelineResult`) — grep xác nhận không import adapter ⇒ an toàn; **KHÔNG** wiring adapter vào `backtest-cli` ở story này (đó là Story 1.8). Chỉ export để 1.8 dùng

- [x] **Task 5 — Hạ tầng test adapters + tests phủ AC (AC: #6, #7)**
  - [x] `packages/adapters/vitest.config.ts`: **NEW** (mirror `packages/decision-core/vitest.config.ts`); `packages/adapters/package.json`: thêm `"test": "vitest run"`, `"test:watch": "vitest"`
  - [x] `packages/adapters/binance-rest/normalize.test.ts`: **NEW** — kline đúng từng index (fixture 1 nến số cụ thể → assert `takerBuyBaseVolume` = phần tử idx 9, `volume` = idx 5, v.v., decimal-string giữ nguyên); funding/OI/LS chuẩn hoá; payload sai shape → `invalid_payload`; không mutate (`structuredClone`); không leak `number` (`typeof === "string"`); tất định (2 lần `toEqual`)
  - [x] `packages/adapters/binance-rest/index.test.ts`: **NEW** — tiêm `fetchFn` giả:
    - happy path: klines + 3 feed phụ đầy đủ → snapshot đủ, `warnings: []`
    - phân trang: fixture > 1500 nến (giả 2 trang) → gộp đúng, không trùng/sót
    - suy giảm mềm: fetch OI trả non-2xx và LS trả `[]` (giả ngoài-30-ngày) → `openInterest/longShortRatio === undefined`, `warnings` có 2 mục, `ok=true`
    - klines lỗi (non-2xx) → `ok=false`, `source="adapter.binance_rest"`
    - `logger` được gọi cho mỗi warning
  - [x] `packages/decision-core/pipeline/runner.test.ts` + `tiers/tier3/index.test.ts`: **UPDATE** fixture `MarketSnapshot` thêm `klines: []`, `warnings: []`
  - [x] `pnpm -r test` pass; xác nhận `dist/` không chứa `*.test.*`

## Dev Notes

> **Bối cảnh:** Story 1.7 là **story adapter đầu tiên có IO thật** — khác hẳn 1.4/1.5/1.6 (lõi thuần). Nó hiện thực `IngestionPort` sau `ingestion` port (AD-1/AD-11), giao **dữ liệu thô đã chuẩn hoá** (AD-12) cho backtest 1.8. **Ba invariant định hình toàn bộ story:** (1) **AD-12** — adapter chỉ giao dữ liệu thô, **mọi suy diễn tín hiệu (CVD/regime) nằm trong core** ⇒ adapter KHÔNG tính `takerSell`/chỉ báo; (2) **AD-11/NFR-5** — endpoint lỗi/thiếu ⇒ **suy giảm mềm + log, không trả khuyết như hợp lệ**; (3) **Consistency: Market snapshot** — shape do adapter sở hữu, live-tick ghi & backtest đọc **cùng shape**, đổi phải version hoá.

### 🔑 Ranh giới "thô vs suy diễn" — đừng để dev tính chỉ báo trong adapter (AD-12)

- Binance kline trả **taker buy base/quote volume** + **total volume** sẵn. Adapter **chỉ** giao các trị này thô. `takerSellVolume = volume − takerBuyBase` và **CVD tích luỹ**, regime, vùng thanh khoản — **core tính** (Tầng 1/2, story sau), để live-tick và backtest suy diễn **giống hệt**. Nếu adapter tự tính, live/backtest có thể trôi khác ⇒ expectancy nói dối. [Source: ARCHITECTURE-SPINE.md#AD-12, #Capability Map FR-2]
- Vì vậy chuẩn hoá là **map field thô**, KHÔNG số học. Không cần `decimal.js` trong adapter — Binance trả **string** cho giá/khối lượng/tỷ lệ; giữ nguyên string (Consistency: Tiền tệ — không JS `number`). Chỉ timestamps là `number` epoch-ms. [Source: #Consistency Conventions → Tiền tệ, Thời gian]

### 🔑 Suy giảm mềm: klines bắt buộc vs feed phụ optional (NFR-5, AD-11)

- **Klines = bắt buộc**: không giá thì không có snapshot hợp lệ ⇒ klines lỗi/thiếu ⇒ `Result.ok=false`. **Không** bịa.
- **funding / openInterest / longShortRatio = optional**: lỗi/timeout/thiếu ⇒ để **`undefined`** (KHÔNG mảng rỗng — rỗng nghĩa "đã gọi, không có bản ghi", khác "không lấy được") + `warnings` + log; snapshot vẫn `ok=true`.
- **Giới hạn 30 ngày**: `/futures/data/openInterestHist` và `/futures/data/globalLongShortAccountRatio` **chỉ giữ 30 ngày gần nhất**. Backtest khoảng ngày cũ hơn ⇒ hai feed này **trống là bình thường** ⇒ suy giảm mềm (`code: "unavailable_out_of_retention"`), KHÔNG coi là lỗi cứng. Klines & fundingRate lấy được xa hơn. [Source: WebFetch Binance docs — globalLongShortAccountRatio "Only the data of the latest 30 days is available"; openInterestHist cùng giới hạn]
- "Không phát Đề xuất trên dữ liệu không đủ" (AD-11) là luật của **core/driver** đọc `warnings`/thiếu feed — adapter chỉ **trung thực báo** trạng thái suy giảm, không tự quyết chặn. [Source: #AD-11]

### 🔑 `MarketSnapshot` shape ở đâu — core sở hữu type, adapter populate

- Nghịch lý: Consistency nói "shape do ingestion adapter **sở hữu**", nhưng `decision-core` tiêu thụ `ctx.input: MarketSnapshot` và **không thể import `@brighten/adapters`** (lint chặn — `eslint.config.js` cấm `@brighten/adapters` trong core). ⇒ **Type khai báo ở `decision-core/types/index.ts`** (nơi core thấy được), adapter **populate** giá trị. "Adapter sở hữu" nghĩa adapter chịu trách nhiệm chuẩn hoá đúng shape + version hoá khi đổi — KHÔNG có nghĩa đặt type trong package adapters. Đặt sai chỗ ⇒ vỡ hướng phụ thuộc (core→adapter là **cấm**). [Source: eslint.config.js#no-restricted-imports; ARCHITECTURE-SPINE.md#Invariants (hướng phụ thuộc), #Consistency → Market snapshot]
- Placeholder hiện tại `{ pair, timeframe, atEpochMillis, [key:string]: unknown }` (note "enriched in 1.7") → thay bằng field cụ thể + hằng `MARKET_SNAPSHOT_SCHEMA_VERSION`. Vì `klines`/`warnings` thành bắt buộc, **mọi fixture `MarketSnapshot` cũ phải cập nhật** (grep bên dưới) — nếu không, `pnpm -r build/typecheck` đỏ.

### Hợp đồng đã có (PHẢI tuân, đọc trước khi sửa)

| File | Trạng thái hôm nay | Story 1.7 đổi gì | Phải giữ nguyên |
| --- | --- | --- | --- |
| `decision-core/ports/ingestion.ts` | `IngestionPort.getMarketSnapshot(req)→Promise<Result<MarketSnapshot>>`; `MarketSnapshotRequest{pair,timeframe,fromEpochMillis,toEpochMillis}` | **không sửa** (adapter hiện thực đúng port này) | toàn bộ port + request |
| `decision-core/types/index.ts` | `MarketSnapshot` placeholder + index-signature | **làm giàu** shape + `Kline`/`FundingPoint`/`OpenInterestPoint`/`LongShortRatioPoint`/`SnapshotWarning` + `MARKET_SNAPSHOT_SCHEMA_VERSION` | `Result`/`CoreError`/kiểu khác; các placeholder khác |
| `packages/adapters/binance-rest/index.ts` | chỉ `BinanceRestAdapterScaffold{clock?}` | **thay** bằng `createBinanceRestIngestion` factory + normalize | (scaffold không ai import — thay được) |
| `packages/adapters/index.ts` | `export *` từ 5 adapter | **không sửa** (tự lan export mới) | barrel |
| `packages/adapters/package.json` | **không** có `test` script/vitest config | **+`test`/`test:watch`** + `vitest.config.ts` | `name`/`exports`/`build`/`lint`; dep `@brighten/decision-core` |
| `eslint.config.js` | core cấm IO + import adapters; **adapters KHÔNG bị cấm** | **không sửa** — adapter được phép `fetch`/network | ranh giới lint |
| `apps/backtest-cli/src/main.ts` | scaffold, import type `PipelineResult` | **không sửa** (wiring adapter là 1.8) | — |

[Source: decision-core/ports/ingestion.ts; decision-core/types/index.ts; packages/adapters/*; eslint.config.js; apps/backtest-cli/src/main.ts]

### Binance REST — đặc tả endpoint (đã xác nhận từ docs, 2026-07)

**Klines** `GET /fapi/v1/klines` — params `symbol` (bắt buộc), `interval` (enum: `1m,3m,5m,15m,30m,1h,2h,4h,6h,8h,12h,1d,...`), `startTime`, `endTime`, `limit` (mặc định 500, **tối đa 1500**). Response = mảng-của-mảng, **index cố định**:
```text
[0]openTime [1]open [2]high [3]low [4]close [5]volume(base)
[6]closeTime [7]quoteAssetVolume [8]numberOfTrades
[9]takerBuyBaseVolume [10]takerBuyQuoteVolume [11]ignore
```
`takerSell = [5] − [9]` ⇒ **core** tính (không phải adapter). Range > 1500 nến ⇒ **phân trang** theo `closeTime`. [Source: developers.binance.com/docs/derivatives/usds-margined-futures/market-data/rest-api/Kline-Candlestick-Data]

**Funding** `GET /fapi/v1/fundingRate` — params `symbol,startTime,endTime,limit`. Response `[{ symbol, fundingTime, fundingRate, markPrice }]` (giữ `fundingTime`,`fundingRate`). [Source: developers.binance.com/docs/derivatives/usds-margined-futures/market-data/rest-api/Get-Funding-Rate-History]

**Open Interest lịch sử** `GET /futures/data/openInterestHist` — params `symbol,period` (enum `5m..1d`),`startTime,endTime,limit` (max 500). Response `[{ symbol, sumOpenInterest, sumOpenInterestValue, timestamp }]`. **Chỉ 30 ngày gần nhất.**

**Long/Short ratio** `GET /futures/data/globalLongShortAccountRatio` — params `symbol,period,startTime,endTime,limit` (max 500). Response `[{ symbol, longShortRatio, longAccount, shortAccount, timestamp }]`. **Chỉ 30 ngày gần nhất.** [Source: developers.binance.com/docs/derivatives/usds-margined-futures/market-data/rest-api/Long-Short-Ratio]

> Lưu ý host: klines/funding ở `https://fapi.binance.com`; OI/LS ở path `/futures/data/*` cùng host `fapi.binance.com`. Cho cả hai **base URL tiêm được** để test + để đổi sang testnet/data-vision nếu cần.

### Invariant kiến trúc PHẢI tuân

- **AD-1 — sau ingestion port, không always-on:** adapter là hàm được driver gọi theo tick; không giữ tiến trình chạy dài. [Source: #AD-1]
- **AD-11 — suy giảm mềm:** lỗi/timeout/thiếu → log + KHÔNG phát dữ liệu khuyết như hợp lệ; klines thiếu ⇒ không snapshot. [Source: #AD-11]
- **AD-12 — suy diễn trong lõi:** adapter chỉ giao thô đã chuẩn hoá; KHÔNG chỉ báo. [Source: #AD-12]
- **Consistency — Market snapshot / Tiền tệ / Thời gian / Lỗi:** shape version hoá; giá/khối lượng decimal-string (không `number`); thời gian UTC epoch-ms; lỗi `{code,source,context}`, `source="adapter.binance_rest"`; ingestion lỗi → log + bỏ tick, **không throw lên làm chết cron**. [Source: #Consistency Conventions]
- **Hướng phụ thuộc:** `adapters → ports/core types` (được); `core → adapters` (**cấm**, lint chặn). [Source: #Invariants; eslint.config.js]

### Ngoài phạm vi story này (đừng làm — để story sau)

- **Wiring adapter vào `backtest-cli` + tính expectancy/chi phí** — **Story 1.8** (backtest engine chi phí thật). 1.7 chỉ cấp adapter + shape; 1.8 bơm vào core.
- **Tính CVD/regime/chỉ báo/`takerSell`** — **core Tầng 1/2** (AD-12). Adapter giao thô.
- **Live adapter (poll REST realtime) trong `cron-runner`** — hiện thực live-tick dùng lại cùng adapter/port là story vận hành (epic 3); 1.7 làm **nhánh lịch sử** cho backtest.
- **FX calendar adapter** (`news_blackout` nguồn tin) — adapter riêng (`fx-calendar`), story riêng.
- **Persistence `MARKET_SNAPSHOT` vào Postgres** — story persistence/adapter postgres.
- **WebSocket/streaming** — v2, adapter mới sau ingestion port (AD-11 Deferred), không đổi lõi.
- **Retry/backoff/rate-limit nâng cao** — v1 giữ tối giản: fetch + phân trang + suy giảm mềm; retry tinh vi là cải tiến sau (ghi chú, không làm).

### Source tree mục tiêu (phần thêm/đổi)

```text
packages/decision-core/
  types/index.ts                     # UPDATE: MarketSnapshot rich + Kline/Funding/OI/LS/SnapshotWarning + SCHEMA_VERSION
  pipeline/runner.test.ts            # UPDATE: fixture MarketSnapshot += klines:[], warnings:[]
  tiers/tier3/index.test.ts          # UPDATE: fixture MarketSnapshot += klines:[], warnings:[]
packages/adapters/
  package.json                       # UPDATE: + test / test:watch script
  vitest.config.ts                   # NEW (mirror decision-core)
  binance-rest/
    index.ts                         # UPDATE: createBinanceRestIngestion(deps) → IngestionPort (fetch+phân trang+suy giảm)
    normalize.ts                     # NEW: normalizeKlines/Funding/OpenInterest/LongShort (thuần)
    normalize.test.ts                # NEW
    index.test.ts                    # NEW (fetchFn giả)
```
[Source: ARCHITECTURE-SPINE.md#Structural Seed; bố cục decision-core làm khuôn test]

### Project Structure Notes

- Tách **thuần (`normalize.ts`)** khỏi **IO (`index.ts`)**: fidelity AD-12 nằm ở chuẩn hoá → test thuần kỹ; IO chỉ fetch + gộp trang + suy giảm. Song song cách core tách `sizing.ts`/`cost-hurdle.ts` khỏi `index.ts`.
- Adapters là ESM (`"type":"module"`), import nội bộ dùng đuôi `.js`, import type từ `@brighten/decision-core` / `@brighten/decision-core/ports` (đã có export path `./ports`). Tuân `consistent-type-imports` (dùng `import type`).
- `fetch` toàn cục có sẵn ở Node 22 (root engines `>=22 <23`) — không cần dep HTTP. Tiêm `fetchFn` để test.
- Rủi ro hồi quy chính: làm `klines`/`warnings` **bắt buộc** trên `MarketSnapshot` phá typecheck các fixture core cũ → **phải** grep & cập nhật hết (`grep -rn "MarketSnapshot" packages apps --include=*.ts | grep -v dist`). Không đổi `MarketSnapshotRequest`/`IngestionPort`.
- `apps/*` chỉ import type `PipelineResult` từ core (grep xác nhận, 1.5/1.6) — không import adapter ⇒ thay scaffold binance-rest an toàn.

### Chuẩn test

- Vitest (thêm cho package adapters). Mỗi AC ≥ 1 test.
- **Không mạng thật**: tiêm `fetchFn` giả trả fixture cố định (payload Binance mẫu: 1–2 kline array, vài bản ghi funding/OI/LS).
- **Số cụ thể theo index**: assert `takerBuyBaseVolume === raw[9]`, `volume === raw[5]`, `quoteVolume === raw[7]` để bắt lệch index — lỗi kinh điển của map kline.
- **Suy giảm mềm**: giả OI non-2xx + LS trả `[]` → hai field `undefined`, `warnings.length===2`, `ok===true`; giả klines non-2xx → `ok===false`, `error.source==="adapter.binance_rest"`.
- **Phân trang**: giả trang 1 đầy (1500) + trang 2 → gộp đúng thứ tự, không trùng bản ghi ranh giới.
- **Tất định** (2 lần `toEqual`), **không mutate payload** (`structuredClone`), **không leak `number`** (`typeof === "string"` cho mọi field giá/khối lượng/tỷ lệ).
- Không test lõi/DB ở đây.

### References

- [Source: epics.md → Epic 1, Story 1.7] — AC gốc: klines (kèm taker buy/sell volume) + funding + OI + long/short ở shape `MARKET_SNAPSHOT` do adapter sở hữu; chỉ dữ liệu thô, KHÔNG chỉ báo (AD-12); lỗi/thiếu → suy giảm mềm + log (NFR-5)
- [Source: ARCHITECTURE-SPINE.md#AD-1] — stateless serverless + cron poll; adapter sau ingestion port, không always-on
- [Source: ARCHITECTURE-SPINE.md#AD-11] — ingestion sau port; suy giảm mềm khi thiếu dữ liệu; không phát trên dữ liệu khuyết
- [Source: ARCHITECTURE-SPINE.md#AD-12] — suy diễn tín hiệu (CVD/regime) trong lõi thuần; adapter chỉ giao thô đã chuẩn hoá
- [Source: ARCHITECTURE-SPINE.md#Consistency Conventions] — Market snapshot (shape do adapter sở hữu, version hoá, live≡backtest cùng shape), Tiền tệ (decimal/string), Thời gian (UTC epoch-ms), Lỗi `{code,source,context}` + ingestion lỗi không làm chết cron
- [Source: ARCHITECTURE-SPINE.md#Invariants; eslint.config.js] — hướng phụ thuộc `adapters→core` (được), `core→adapters` (cấm, lint chặn)
- [Source: decision-core/ports/ingestion.ts] — `IngestionPort` + `MarketSnapshotRequest` mà adapter hiện thực
- [Source: decision-core/types/index.ts] — `MarketSnapshot` placeholder (enrich here), `Result`/`CoreError`
- [Source: packages/adapters/binance-rest/index.ts; packages/adapters/package.json; packages/adapters/tsconfig.json] — scaffold + cấu hình package cần bổ sung test infra
- [Source: packages/decision-core/vitest.config.ts] — khuôn cấu hình vitest để mirror cho adapters
- [Source: Binance USDⓈ-M Futures REST docs, 2026-07] — Kline-Candlestick-Data (index array, limit 1500); Get-Funding-Rate-History; Open-Interest / openInterestHist; Long-Short-Ratio (globalLongShortAccountRatio, "chỉ 30 ngày gần nhất")
- [Source: 1-5-cost-hurdle-cost-gate.md; 1-6-tier0-behavioral-veto.md] — khuôn story: tách phần thuần khỏi IO/wiring, shape lỗi `{code,source,context}`, chuẩn test biên/determinism/non-mutation, ranh giới phạm vi rõ

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- `pnpm --filter @brighten/adapters test -- --run binance-rest/normalize.test.ts` failed before `normalize.ts` existed, then passed after adding pure normalizers.
- `pnpm --filter @brighten/adapters typecheck` caught generic inference and test mock typing issues; fixed with explicit generics and simpler pagination mock.
- `pnpm -r lint` caught adapters test files outside the TS project after build excludes; fixed by splitting adapters `tsconfig.json` for lint/typecheck and `tsconfig.build.json` for emit.
- Final validation passed: `pnpm -r typecheck`, `pnpm -r build`, `pnpm -r lint`, `pnpm -r test`.
- Verified no `*.test.*` files under `dist/` with `rg --files -g 'dist/**' | rg '\.test\.'`.

### Completion Notes List

- Task 1: Enriched `MarketSnapshot` with concrete kline/funding/OI/long-short/warning types and schema version, then updated existing core test fixtures with required `klines`/`warnings`.
- Task 2: Added pure Binance payload normalizers for klines, funding, open interest, and long/short ratio with deterministic non-mutating tests and decimal-string preservation.
- Task 3: Replaced the Binance scaffold with an injected-fetch `IngestionPort` implementation covering klines pagination, optional feed fetches, soft warnings, logger calls, and hard kline failures.
- Task 4: Exported the Binance ingestion factory, dependency/fetch types, and timeframe mapping helpers through the existing adapters barrel.
- Task 5: Added adapters Vitest infrastructure, adapter IO tests, build excludes for test files, and fixture updates required by the enriched `MarketSnapshot`.

### File List

- packages/decision-core/types/index.ts
- packages/decision-core/pipeline/runner.test.ts
- packages/decision-core/tiers/tier0/index.test.ts
- packages/decision-core/tiers/tier3/index.test.ts
- packages/adapters/binance-rest/normalize.ts
- packages/adapters/binance-rest/normalize.test.ts
- packages/adapters/vitest.config.ts
- packages/adapters/package.json
- packages/adapters/binance-rest/index.ts
- packages/adapters/binance-rest/index.test.ts
- packages/adapters/tsconfig.json
- packages/adapters/tsconfig.build.json

### Change Log

- 2026-07-04: Implemented Story 1.7 Binance historical ingestion adapter, enriched market snapshot schema, added payload normalization, soft-degradation warnings, pagination, and adapters test infrastructure. Status set to review.
