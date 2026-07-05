---
baseline_commit: cfae2a46e98a2ac6b5e1bf9e97fc672533fa2161
depends_on: 2-2-tier1-fx-price-action
---

# Story 2.3: Lịch tin FX → cửa sổ blackout (FR-6)

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **người dùng trade FX của Brighten**,
I want **một adapter `fx-calendar` (sau một `fx-calendar` port) nhận diện các sự kiện tin high-impact (NFP, CPI, FOMC, quyết định lãi suất) từ nguồn lịch kinh tế và biến chúng thành `NewsBlackoutWindow[]` (event ± buffer cấu hình-được, gắn đúng cặp FX liên quan), suy giảm mềm + log khi nguồn lỗi**,
so that **Tầng 0 (đã có veto `news_blackout` từ 1.6) chặn được lệnh FX quanh tin mà không cần tự đặt lệnh, và một nguồn tin lỗi không bao giờ làm chết cron (FR-6, nối FR-1, AD-11, NFR-5, AD-4)**.

## Acceptance Criteria

**AC1 — Nhận diện sự kiện high-impact từ lịch kinh tế FX**
**Given** một payload lịch kinh tế FX thô (qua `fetchFn` tiêm vào — nguồn cụ thể là `[ASSUMPTION]` ForexFactory/investing, deferred PRD Open Q6)
**When** `fx-calendar` adapter nạp và chuẩn hoá lịch
**Then** mỗi sự kiện được chuẩn hoá về shape `{ timestamp (epoch-ms), currency, impact, title }`; **chỉ** sự kiện **high-impact** (severity `high`) — bao gồm NFP, CPI, FOMC, quyết định lãi suất — được giữ lại; sự kiện low/medium bị loại
**And** phân loại impact nằm ở **adapter/normalize** (adapter được phép biết domain lịch tin), KHÔNG ở `decision-core` thuần; adapter **chỉ giao dữ liệu đã chuẩn hoá** (windows), không suy diễn tín hiệu quyết định (AD-12)
**And** payload rác/thiếu field → item đó bị loại + ghi `SnapshotWarning` (không throw)

**AC2 — Mỗi sự kiện high-impact → một `NewsBlackoutWindow` (event ± buffer cấu hình) gắn đúng cặp**
**Given** một sự kiện high-impact `{ timestamp, currency, title }` và buffer từ config
**When** adapter dựng cửa sổ blackout
**Then** tạo `NewsBlackoutWindow = { startsAt: timestamp − news_blackout_buffer_before_ms, endsAt: timestamp + news_blackout_buffer_after_ms, reason: <title/currency>, pairs: <cặp liên quan> }`
**And** `pairs` = tập cặp trong **danh mục người dùng cấp** (`request.pairs`) mà **chứa `currency`** của sự kiện (vd event `currency="USD"` ⇒ áp `EURUSD`, `USDJPY`; KHÔNG áp `EURGBP`) — scoping deterministic bằng chuỗi symbol, **KHÔNG** taxonomy FX/crypto trong lõi (song song cách 1.6 dùng `window.pairs`)
**And** cửa sổ hợp lệ `endsAt > startsAt` (đảm bảo bởi validate config `news_blackout_buffer_before_ms + news_blackout_buffer_after_ms > 0`); nếu một sự kiện scope ra **0 cặp** ⇒ bỏ qua sự kiện đó (không tạo window rỗng-pairs = áp-mọi-cặp)

**AC3 — Cửa sổ cấp cho Tầng 0 để chặn cặp FX liên quan (nối FR-1)**
**Given** `NewsBlackoutWindow[]` do adapter sinh ra
**When** driver hợp nhất chúng vào `config.params.news_blackout` cho tick (seam driver — epic 3/2.5)
**Then** shape output **chính xác** là `NewsBlackoutWindow[]` mà Tầng 0 (`evaluateBehavioralVeto`, story 1.6) đã tiêu thụ ⇒ Tầng 0 veto `news_blackout_active` cho đúng cặp trong `[startsAt, endsAt)` — **không** cần đổi Tầng 0
**And** story này **chứng minh tính tương thích type** (windows gán được vào `ConfigParams.news_blackout` + validate qua `validateParams` không lỗi); **wiring driver** (gọi adapter → merge vào params snapshot cho mỗi tick) là **ngoài phạm vi** (deferred epic 3 live / 2.5 backtest) — nêu rõ seam
**And** ghi chú versioning (AD-4): **buffer** (`news_blackout_buffer_*_ms`) là **config tunable có phiên bản**; **windows** là **dữ liệu suy ra** driver bơm vào `news_blackout` cho tick → snapshot nhúng vào Đề xuất ghi đúng cửa sổ đã áp (auditability). Không nhầm buffer (tunable) với windows (derived)

**AC4 — Suy giảm mềm + log khi nguồn lỗi (NFR-5, AD-11) — KHÔNG bao giờ throw lên cron**
**Given** `fetchFn` lỗi network/timeout/HTTP non-2xx, hoặc payload không parse được JSON
**When** adapter nạp lịch
**Then** adapter trả `{ windows: [], warnings: [<SnapshotWarning shape { code, source: "adapter.fx_calendar", context }>] }` (KHÔNG throw, KHÔNG reject cứng) + gọi `logger(warning)` — cron/pipeline chạy tiếp **không có** blackout cho tick đó
**And** lỗi **từng phần** (một số item rác, số khác hợp lệ) ⇒ giữ item hợp lệ + warning cho item hỏng (không vứt cả batch)
**And** [DECISION — mặc định tài liệu-hoá] nguồn tin **lỗi ⇒ không blackout** (giao dịch tiếp, có ghi log). Phương án bảo thủ hơn (coi calendar-fail = veto FX tới khi có lịch) là **product decision**, KHÔNG đổi kiến trúc — nếu chọn, thực hiện ở **driver/Tầng 0**, không ở adapter. Xem "Cần xác nhận" ở cuối

**AC5 — Adapter sau `fx-calendar` port; testable KHÔNG mạng (song song `binance-rest`)**
**Given** kiến trúc hexagonal (AD-11: FX calendar là nguồn sau ingestion port)
**When** dựng adapter
**Then** thêm **port** `FxCalendarPort` trong `packages/decision-core/ports/fx-calendar.ts`: `getNewsBlackout(request: FxCalendarRequest) => Promise<FxCalendarResult>` với `FxCalendarRequest = { fromEpochMillis, toEpochMillis, pairs: readonly string[], blackoutBufferBeforeMs: number, blackoutBufferAfterMs: number }` và `FxCalendarResult = { windows: readonly NewsBlackoutWindow[]; warnings: readonly SnapshotWarning[] }`
**And** adapter `createFxCalendarAdapter(deps)` nhận `deps.fetchFn?`/`deps.logger?` **tiêm vào** (mặc định `globalThis.fetch` / no-op) — mọi test dùng `fetchFn` giả, **không** gọi mạng thật (song song `createBinanceRestIngestion`)
**And** `assetClass`/loại nguồn không suy trong lõi; `request.pairs` (danh mục) + buffer do **driver cấp từ config** (adapter KHÔNG phụ thuộc `@brighten/config`) — port request là seam duy nhất

**AC6 — Buffer là config CÓ PHIÊN BẢN (AD-4); thêm additive, không phá param cũ**
**Given** `packages/config` (đã có param crypto 2.1 + FX 2.2)
**When** thêm buffer blackout
**Then** thêm **additive** vào `ConfigParams` + `DEFAULT_PARAMS` + `fieldNames` + `validateParams`:
  - `news_blackout_buffer_before_ms` (integer ≥ 0) — cửa sổ bắt đầu trước event
  - `news_blackout_buffer_after_ms` (integer ≥ 0) — cửa sổ kết thúc sau event
**And** validate qua `isNonNegativeInteger` (nhân bản `cooldown_after_loss`); **cộng** ràng buộc **tổng > 0** (`before + after > 0`) để mọi window sinh ra hợp lệ `endsAt > startsAt` ⇒ nếu cả hai `0` trả `invalid("invalid_news_blackout_buffer", ...)`
**And** mặc định (deferred-tuning, chốt qua backtest): `news_blackout_buffer_before_ms: 1_800_000` (30′), `news_blackout_buffer_after_ms: 1_800_000` (30′); **KHÔNG** đổi param cũ, `version.ts`, `store.ts`, `snapshot.ts`

**AC7 — Từ chối/chuẩn hoá input phi lý bằng shape lỗi thống nhất**
**Given** item lịch thiếu `timestamp`/`currency`/`impact`, hoặc `timestamp` không phải epoch-ms integer, hoặc payload không phải mảng
**When** normalize chạy
**Then** payload không-mảng ⇒ 1 warning `invalid_payload` + `windows: []`; item lỗi field ⇒ loại item đó + 1 warning `invalid_calendar_item` (context nêu `index`); mọi warning shape `{ code, source: "adapter.fx_calendar", context }` (song song `adapter.binance_rest`)
**And** KHÔNG throw string trần; KHÔNG để item rác biến thành window rác

**AC8 — Test phủ từng AC + toolchain sạch**
**Given** Vitest (nền adapters từ `binance-rest`)
**When** thêm test cho normalize/classify + windowing + scoping + soft-degrade + validate config mới
**Then** có test cho: chỉ giữ high-impact (low/medium loại); window `startsAt/endsAt` số tính tay từ buffer; scoping `pairs` (USD event ⇒ EURUSD+USDJPY, KHÔNG EURGBP; event 0 cặp ⇒ bỏ); type-compat (windows validate qua `validateParams` khi nhét vào `news_blackout`); soft-degrade (`fetchFn` throw ⇒ `{windows:[],warnings:[network_error]}` + `logger` được gọi; HTTP 500 ⇒ warning; JSON hỏng ⇒ warning); lỗi từng phần (1 item rác + 1 hợp lệ ⇒ 1 window + 1 warning); config `before=0,after=0` ⇒ `invalid_news_blackout_buffer`, `before="x"` ⇒ `invalid_non_negative_integer`; tất định (2× `toEqual` cùng payload); không leak number (`typeof startsAt === "number"` epoch-ms; `reason`/`pairs` đúng kiểu)
**And** `pnpm -r typecheck && pnpm -r build && pnpm -r lint && pnpm -r test` **tất cả pass**; `*.test.ts` KHÔNG lọt `dist/`

## Tasks / Subtasks

- [x] **Task 1 — Thêm buffer blackout vào `@brighten/config` (additive) (AC: #6)**
  - [x] `packages/config/src/schema.ts`: thêm `news_blackout_buffer_before_ms: number`, `news_blackout_buffer_after_ms: number` vào `ConfigParams` (cạnh `news_blackout`); thêm vào `DEFAULT_PARAMS` (`1_800_000` mỗi cái); thêm 2 tên vào `fieldNames`
  - [x] Validate: mỗi field qua `isNonNegativeInteger` (nhân bản `cooldown_after_loss`) ⇒ sai type/âm ⇒ `invalid_non_negative_integer`; **thêm** kiểm tổng: nếu `before + after <= 0` ⇒ `invalid("invalid_news_blackout_buffer", "news_blackout_buffer_after_ms", "before+after must be > 0")`. Ghép 2 field vào object trả về của `validateParams`
  - [x] **KHÔNG** đổi param cũ (crypto 2.1, FX 2.2, news_blackout 1.6), `version.ts`, `store.ts`, `snapshot.ts`
  - [x] `packages/config/src/schema.test.ts`: **UPDATE** — assert 2 mặc định mới `toBe`; `before=0 & after=0` ⇒ `invalid_news_blackout_buffer`; `before="x"` ⇒ `invalid_non_negative_integer`; thiếu field ⇒ `missing_config_param`

- [x] **Task 2 — Thêm `FxCalendarPort` vào decision-core/ports (AC: #5)**
  - [x] `packages/decision-core/ports/fx-calendar.ts`: **NEW** —
    - `import type { NewsBlackoutWindow } from "@brighten/config"` (một định nghĩa duy nhất; decision-core đã phụ thuộc `@brighten/config`)
    - `import type { Result, SnapshotWarning } from "../types/index.js"` (không cần `Result` nếu dùng `FxCalendarResult`)
    - `FxCalendarRequest = { fromEpochMillis: number; toEpochMillis: number; pairs: readonly string[]; blackoutBufferBeforeMs: number; blackoutBufferAfterMs: number }`
    - `FxCalendarResult = { windows: readonly NewsBlackoutWindow[]; warnings: readonly SnapshotWarning[] }`
    - `FxCalendarPort = { getNewsBlackout: (request: FxCalendarRequest) => Promise<FxCalendarResult> }`
  - [x] `packages/decision-core/ports/index.ts`: **UPDATE** — `export type { FxCalendarPort, FxCalendarRequest, FxCalendarResult } from "./fx-calendar.js"`. `decision-core/index.ts` đã `export * from "./ports/index.js"` ⇒ tự lan
  - [x] **KHÔNG** đổi port khác; KHÔNG thêm method vào `IngestionPort` (calendar là port riêng, "một adapter một thư mục")

- [x] **Task 3 — Normalize + phân loại high-impact + dựng window + scoping (AC: #1, #2, #7)**
  - [x] `packages/adapters/fx-calendar/normalize.ts`: **NEW** — thuần transform (song song `binance-rest/normalize.ts`):
    - `normalizeCalendar(raw: unknown): { events: CalendarEvent[]; warnings: SnapshotWarning[] }` — mảng? không ⇒ warning `invalid_payload` + rỗng; mỗi item: đọc `timestamp` (epoch-ms integer), `currency` (string), `impact` (string), `title` (string). Thiếu/sai ⇒ loại + warning `invalid_calendar_item` (context `index`)
    - `CalendarEvent = { timestamp: number; currency: string; impact: string; title: string }`
    - `isHighImpact(impact: string): boolean` — severity `high` (chuẩn hoá lower-case; nhận `"high"`/`"High"`/`"3"` nếu nguồn dùng số — tài liệu-hoá bộ nhận diện; **mặc định** khớp field `impact` = high; NFP/CPI/FOMC/rate là **hệ quả** của severity high, không hardcode tên)
    - `buildWindow(event, pairs, beforeMs, afterMs): NewsBlackoutWindow | undefined` — scope `pairs` = `pairs.filter(p => p.includes(event.currency))`; nếu rỗng ⇒ `undefined` (bỏ sự kiện); else `{ startsAt: timestamp − beforeMs, endsAt: timestamp + afterMs, reason: event.title, pairs: scoped }`
  - [x] Mọi warning shape `{ code, source: "adapter.fx_calendar", context }`. Thời gian là **integer epoch-ms** (không phải tiền) ⇒ toán integer trực tiếp OK; KHÔNG dùng `Date`/timezone trong tính window (buffer là ms thuần)

- [x] **Task 4 — `createFxCalendarAdapter` impl port + soft-degrade (AC: #4, #5)**
  - [x] `packages/adapters/fx-calendar/index.ts`: **REPLACE** scaffold — `createFxCalendarAdapter(deps: FxCalendarDeps = {}): FxCalendarPort`
    - `FxCalendarDeps = { fetchFn?: FetchLike; baseUrl?: string; logger?: (w: SnapshotWarning) => void }` (tái dùng kiểu `FetchLike`/`FetchResponseLike` — import từ `binance-rest` hoặc khai báo song song; **khuyến nghị** tách `FetchLike` dùng chung nếu gọn, nếu không nhân bản để tránh coupling)
    - `getNewsBlackout(request)`: build URL từ `baseUrl` + range; `fetchJson` (song song binance-rest: network/HTTP/JSON lỗi ⇒ **warning + windows:[]**, gọi `logger`); payload ok ⇒ `normalizeCalendar` ⇒ lọc `isHighImpact` ⇒ `buildWindow` cho mỗi event (bỏ `undefined`) ⇒ gộp warnings normalize; trả `{ windows, warnings }`; mọi warning cũng `logger(w)`
  - [x] **Soft-degrade tuyệt đối** (AC4): không path nào throw ra ngoài `getNewsBlackout`; lỗi ⇒ luôn `{ windows: [...], warnings: [...] }`. `logger` mặc định no-op
  - [x] `packages/adapters/index.ts` đã `export * from "./fx-calendar/index.js"` ⇒ tự lan; export thêm `createFxCalendarAdapter` + kiểu deps

- [x] **Task 5 — Cập nhật fixtures `ConfigParams` cứng shape (AC: #6, #8)**
  - [x] Thêm 2 field buffer vào **mọi** literal `ConfigParams` trong test (2 field required): `packages/decision-core/pipeline/runner.test.ts`, `tiers/tier0/behavioral-veto.test.ts` (mọi inline params), `tiers/tier0/index.test.ts`, `tiers/tier3/index.test.ts`, `tiers/tier1/crypto-regime.test.ts`, **`tiers/tier1/fx-regime.test.ts`** (2.2). Dùng mặc định `1_800_000`
  - [x] `packages/config/src/store.test.ts`/`snapshot.test.ts`: nếu từ `DEFAULT_PARAMS` ⇒ tự đúng; literal ⇒ thêm 2 field

- [x] **Task 6 — Tests (AC: #1..#8)**
  - [x] `packages/adapters/fx-calendar/normalize.test.ts`: **NEW** — high-impact giữ / low-medium loại; item rác loại + warning `invalid_calendar_item`; payload không-mảng ⇒ warning `invalid_payload`; `buildWindow` số tính tay (ts `1_700_000_000_000`, before/after `1_800_000` ⇒ startsAt/endsAt đúng); scoping USD ⇒ EURUSD+USDJPY, KHÔNG EURGBP; event 0 cặp ⇒ `undefined`; tất định; `typeof startsAt === "number"`
  - [x] `packages/adapters/fx-calendar/index.test.ts`: **NEW** (song song `binance-rest/index.test.ts`) — `fetchFn` giả trả payload hợp lệ ⇒ windows đúng; `fetchFn` throw ⇒ `{windows:[],warnings:[network_error]}` + `logger` gọi; response `ok:false status:500` ⇒ warning `http_error`; `json()` throw ⇒ warning `invalid_payload`; lỗi từng phần ⇒ 1 window + 1 warning; **KHÔNG** gọi mạng thật
  - [x] `packages/config/src/schema.test.ts`: **UPDATE** (Task 1) + **type-compat** test: lấy windows mẫu (từ `buildWindow`) nhét vào `{ ...DEFAULT_PARAMS, news_blackout: windows }` ⇒ `validateParams` `ok:true` (chứng minh AC3 tương thích Tầng 0)
  - [x] `pnpm -r test` pass; xác nhận `dist/` không chứa `*.test.*`

## Dev Notes

> **Bối cảnh:** Story 2.3 là story **adapter-layer đầu tiên của epic 2** — khác 2.1/2.2 (lõi thuần). Nó hoàn tất **FR-6**: biến lịch tin FX thành `NewsBlackoutWindow[]` để **Tầng 0 (đã có veto từ 1.6)** chặn lệnh FX quanh tin. Nó **không** đụng `decision-core/tiers` — Tầng 0 đã tiêu thụ `config.params.news_blackout` rồi (1.6); story này chỉ **sản xuất** windows đúng shape + suy giảm mềm. Khuôn kỹ thuật bám **`binance-rest`** (adapter đã có): `fetchFn`/`logger` tiêm vào, `fetchJson` xử lý network/HTTP/JSON, `normalize.ts` tách riêng, warning shape `{ code, source, context }`, testable không mạng.

> **Phụ thuộc:** build trên 2.1+2.2 (config đã có param crypto/FX; fixtures đã cập nhật). Chia sẻ `schema.ts` + fixtures với 2.1/2.2 ⇒ làm sau 2.2 để tránh xung đột merge. [Source: 2-1…md, 2-2…md → File List]

### 🔑 Giải toả mơ hồ: windows là DỮ LIỆU, buffer là CONFIG; adapter KHÔNG chạm core

- **Ranh giới sản xuất vs tiêu thụ:** adapter **sản xuất** `NewsBlackoutWindow[]`; Tầng 0 **tiêu thụ** qua `config.params.news_blackout` (1.6 xong). Cầu nối = **driver** hợp nhất windows vào params snapshot cho mỗi tick (`{ ...params, news_blackout: [...params.news_blackout, ...calendarWindows] }`). Driver wiring là **epic 3 (live cron) / 2.5 (backtest)** — **ngoài phạm vi 2.3**. Story này dừng ở "windows đúng shape + type-compat chứng minh". [Source: 1-6…md → Tầng 0 đọc `config.params.news_blackout`; ARCHITECTURE-SPINE.md#AD-11]
- **Versioning (AD-4) — đừng nhầm:** `news_blackout_buffer_*_ms` là **tham số tunable có phiên bản** (như cooldown/min_rr). `news_blackout` **windows** là **dữ liệu suy ra** từ lịch tin theo thời gian — driver bơm vào cho tick, rồi snapshot nhúng vào `Suggestion` để **audit** ghi đúng cửa sổ đã áp. Buffer đi vào version; windows đi vào snapshot-per-tick. [Source: ARCHITECTURE-SPINE.md#AD-4; #Consistency Conventions → Config]
- **Scoping "cặp liên quan" KHÔNG cần taxonomy trong lõi:** adapter scope bằng `pair.includes(event.currency)` trên **danh mục người dùng cấp** (`request.pairs`) — y hệt triết lý 1.6 (`window.pairs` do người soạn config cấp; lõi không phân loại cặp). Adapter **được phép** biết "USD ∈ EURUSD" vì nó ngoài lõi thuần. Lõi vẫn mù taxonomy. [Source: 1-6…md → news_blackout scope bằng `pairs`; ARCHITECTURE-SPINE.md#AD-12]
- **Adapter chỉ giao dữ liệu chuẩn hoá (AD-12):** phân loại impact + dựng window là **transform dữ liệu**, KHÔNG phải suy diễn tín hiệu-quyết-định (khác CVD/price-action nằm trong lõi). Blackout là **rào rủi ro** cấp cho Tầng 0, không phải "hướng edge" ⇒ hợp lệ ở adapter. [Source: ARCHITECTURE-SPINE.md#AD-12, #AD-11 "v1: Binance REST + FX calendar"]

### Đặc tả luật (một nguồn sự thật)

```text
# createFxCalendarAdapter(deps).getNewsBlackout(request) — LUÔN trả { windows, warnings }, KHÔNG throw
fetch(baseUrl + range)
  ├─ network/timeout throw   ⇒ warning network_error   + windows:[]   (logger) ; return
  ├─ response.ok === false   ⇒ warning http_error(status) + windows:[] (logger) ; return
  └─ json() throw            ⇒ warning invalid_payload  + windows:[]   (logger) ; return
payload ok:
  { events, warnings } = normalizeCalendar(payload)          # không-mảng ⇒ 1 warning invalid_payload
  for event in events where isHighImpact(event.impact):      # low/medium loại
     w = buildWindow(event, request.pairs, before, after)
       scoped = request.pairs.filter(p => p.includes(event.currency))
       scoped empty ⇒ skip (undefined)                       # không tạo window áp-mọi-cặp
       else ⇒ { startsAt: ts−before, endsAt: ts+after, reason: title, pairs: scoped }
     if w ⇒ windows.push(w)
  warnings = normalize.warnings (+ mọi warning cũng logger())
return { windows, warnings }

source = "adapter.fx_calendar" cho mọi warning
```

### Hợp đồng đã có (PHẢI tuân, đọc trước khi sửa)

| File | Trạng thái | Story 2.3 đổi gì | Phải giữ nguyên |
| --- | --- | --- | --- |
| `packages/adapters/fx-calendar/index.ts` | scaffold `FxCalendarAdapterScaffold` | **REPLACE** bằng `createFxCalendarAdapter` impl port | (scaffold bỏ được — chưa ai import; grep xác nhận) |
| `packages/decision-core/ports/fx-calendar.ts` | **chưa có** | **NEW** `FxCalendarPort`/Request/Result | — |
| `packages/decision-core/ports/index.ts` | export 5 port | **+export** fx-calendar port types | export cũ |
| `packages/config/src/schema.ts` | `ConfigParams` gồm `news_blackout` + param 2.1/2.2 | **+2 buffer** (additive) + validate | mọi param cũ; `NewsBlackoutWindow`; `version/store/snapshot` |
| `packages/decision-core/tiers/tier0/behavioral-veto.ts` | veto `news_blackout_active` cho `[startsAt,endsAt)` + `pairs` | **KHÔNG sửa** (đã tiêu thụ đúng shape) | toàn bộ |
| `packages/adapters/binance-rest/index.ts` | `FetchLike`/`FetchResponseLike`/`fetchJson` pattern | **KHÔNG sửa**; tham chiếu làm khuôn (import `FetchLike` nếu tách gọn) | toàn bộ |

[Source: packages/adapters/fx-calendar/index.ts; packages/decision-core/ports/index.ts; packages/config/src/schema.ts; packages/decision-core/tiers/tier0/behavioral-veto.ts; packages/adapters/binance-rest/index.ts]

### Invariant kiến trúc PHẢI tuân

- **AD-11 — ingestion sau port + suy giảm mềm:** FX calendar là nguồn sau `fx-calendar` port; lỗi/timeout/thiếu ⇒ suy giảm mềm + log, KHÔNG chết cron (ingestion lỗi → log + bỏ tick, không throw — Consistency Conventions "Lỗi & log"). [Source: #AD-11; #Consistency Conventions]
- **AD-12 — adapter chỉ giao dữ liệu chuẩn hoá:** windows là transform, không suy diễn quyết định; lõi không tính. [Source: #AD-12]
- **AD-4 — config có phiên bản:** buffer là param versioned; windows là derived bơm vào snapshot-per-tick. [Source: #AD-4]
- **AD-8 — audit:** windows nhúng vào snapshot ⇒ tái dựng "chặn vì tin nào"; `reason`/`pairs` mang đủ ngữ cảnh; persist là AD-8 (driver/persistence, ngoài phạm vi). [Source: #AD-8]
- **NFR-5 — bền dữ liệu:** nguồn lỗi/thiếu ⇒ không phát trên dữ liệu khuyết + log (ở đây: không blackout + log). [Source: prd.md#NFR-5]

### Ngoài phạm vi story này (đừng làm — để story sau)

- **Wiring driver: gọi adapter → merge windows vào `config.params.news_blackout` cho mỗi tick** — epic 3 (cron-runner live) / story 2.5 (backtest). Story 2.3 chỉ sản xuất windows + chứng minh type-compat.
- **Nguồn lịch tin cụ thể (URL/scrape/API trả phí)** — `[ASSUMPTION]` ForexFactory/investing, deferred (PRD Open Q6). Adapter tiêm `fetchFn` + `normalize` theo shape kỳ vọng; đấu nối nguồn thật là cấu hình sau, KHÔNG đổi cấu trúc.
- **Sửa Tầng 0** — đã veto `news_blackout` đúng (1.6). Story này KHÔNG chạm `tiers/`.
- **Merge/dedup cửa sổ chồng lấn** — Tầng 0 kiểm "∃ window" nên chồng lấn vô hại; tối ưu gộp là sau, không cần cho đúng.
- **Blackout cho crypto** — FR-6 là tin FX; crypto blackout (nếu có) là v2. Scoping theo `currency` tự nhiên chỉ chạm cặp FX chứa currency.
- **Timezone/DST của lịch tin** — nguồn phải giao `timestamp` epoch-ms (UTC) đã chuẩn; adapter KHÔNG parse chuỗi ngày bản địa (nếu nguồn thật trả local time, normalize hoá epoch là việc của lớp normalize nguồn-cụ-thể, tài liệu-hoá).
- **Persist windows/lần chặn vào Nhật ký** — AD-8, cần persistence adapter (epic 3).

### Source tree mục tiêu (phần thêm/đổi)

```text
packages/config/src/
  schema.ts                          # UPDATE: +2 buffer (additive) + validate (invalid_news_blackout_buffer)
  schema.test.ts                     # UPDATE: buffer defaults + miền sai + type-compat windows
packages/decision-core/ports/
  fx-calendar.ts                     # NEW: FxCalendarPort/Request/Result
  index.ts                           # UPDATE: +export fx-calendar port types
packages/adapters/fx-calendar/
  index.ts                           # REPLACE scaffold: createFxCalendarAdapter (impl port, soft-degrade)
  index.test.ts                      # NEW (khuôn binance-rest/index.test.ts)
  normalize.ts                       # NEW: normalizeCalendar + isHighImpact + buildWindow
  normalize.test.ts                  # NEW
packages/decision-core/               # + mọi fixture ConfigParams literal: +2 buffer field
  (pipeline/runner.test.ts, tiers/tier0/*, tier3/index.test.ts, tier1/crypto-regime.test.ts, tier1/fx-regime.test.ts)
```
[Source: ARCHITECTURE-SPINE.md#Structural Seed "một adapter = một thư mục trong packages/adapters/"; bố cục binance-rest làm khuôn]

### Project Structure Notes

- Adapter `fx-calendar` cần thư mục test riêng — kiểm `packages/adapters/vitest.config.ts` phủ `fx-calendar/**` (binance-rest đã trong đó ⇒ pattern glob nhiều khả năng tự phủ; xác nhận).
- Tách `normalize.ts` khỏi `index.ts` (song song binance-rest): transform thuần dễ test; `index.ts` chỉ điều phối fetch + soft-degrade.
- `FetchLike`/`FetchResponseLike` đã có ở `binance-rest/index.ts` (export). **Khuyến nghị** import lại từ đó nếu ESLint/boundary cho phép (cùng package `@brighten/adapters`); nếu gây coupling chéo-adapter khó chịu, nhân bản 2 type nhỏ. Không tạo package util mới cho 2 dòng.
- Config: +2 field additive ⇒ mọi literal `ConfigParams` (gồm `fx-regime.test.ts` của 2.2) phải thêm, nếu không typecheck đỏ. Không đổi `version/store/snapshot`.
- `decision-core/ports/fx-calendar.ts` import `NewsBlackoutWindow` từ `@brighten/config` (đã là dependency của decision-core). Không tái định nghĩa type ⇒ một nguồn sự thật, windows adapter khớp Tầng 0 tuyệt đối.
- Xung đột đã biết: `apps/*` chưa gọi calendar ⇒ thêm port/adapter an toàn; wiring là driver story.

### Chuẩn test

- Vitest; mỗi AC ≥ 1 test. Ưu tiên **số cụ thể tính tay** (ts + buffer ⇒ startsAt/endsAt; scoping list cặp).
- **Soft-degrade** là trọng tâm (NFR-5): test đủ 3 nhánh lỗi (network throw / HTTP non-2xx / JSON hỏng) ⇒ luôn `{windows:[], warnings:[...]}` + `logger` gọi; **không** test nào để adapter throw.
- **Lỗi từng phần**: payload mảng có 1 item high-impact hợp lệ + 1 item thiếu field ⇒ 1 window + 1 warning (không mất item tốt).
- **Scoping**: `request.pairs=["EURUSD","USDJPY","EURGBP"]`, event USD ⇒ windows.pairs=`["EURUSD","USDJPY"]`; event `currency` không khớp cặp nào ⇒ sự kiện bị bỏ.
- **Type-compat (AC3)**: windows nhét vào `news_blackout` ⇒ `validateParams` ok (chứng minh Tầng 0 tiêu thụ được, không cần chạy Tầng 0).
- **Tất định**: cùng payload ⇒ 2× `toEqual` windows.
- **fetch giả** bắt buộc — KHÔNG mạng thật (song song `binance-rest/index.test.ts`).
- Không integration/DB.

### References

- [Source: epics.md → Epic 2, Story 2.3] — AC gốc (BDD): nạp lịch → high-impact (NFP/CPI/FOMC/lãi suất) gắn `news_blackout`; cửa sổ cấp Tầng 0 chặn cặp FX liên quan (nối FR-1); nguồn lỗi → suy giảm mềm + log (NFR-5)
- [Source: prd.md#FR-6] — lịch tin FX → cửa sổ blackout; [Source: prd.md#NFR-5] — bền dữ liệu: nguồn lỗi/thiếu → không phát trên dữ liệu khuyết + log
- [Source: ARCHITECTURE-SPINE.md#AD-11] — ingestion sau port; FX calendar là nguồn v1; lỗi → suy giảm mềm + log, không chết cron
- [Source: ARCHITECTURE-SPINE.md#AD-12] — adapter chỉ giao dữ liệu chuẩn hoá, không suy diễn quyết định
- [Source: ARCHITECTURE-SPINE.md#AD-4] — buffer là config versioned; windows derived vào snapshot-per-tick
- [Source: ARCHITECTURE-SPINE.md#AD-8] — windows nhúng snapshot ⇒ audit "chặn vì tin nào"
- [Source: ARCHITECTURE-SPINE.md#Consistency Conventions] — Lỗi & log (`{code,source,context}`, ingestion lỗi → log + bỏ tick không throw); Thời gian (UTC epoch-ms); ID/Config
- [Source: ARCHITECTURE-SPINE.md#Deferred] — nguồn & cách lấy lịch tin FX cụ thể (API trả phí vs scrape) sau ingestion port, không đổi kiến trúc (PRD Open Q6)
- [Source: packages/adapters/binance-rest/index.ts] — khuôn adapter: `FetchLike`/`FetchResponseLike`/`createBinanceRestIngestion`/`fetchJson`/warning-vs-failure/logger tiêm
- [Source: packages/adapters/binance-rest/normalize.ts] — khuôn normalize: `normalizeObjectArray`/`readString`/`readNumber`/`invalidPayload`, warning shape `{code,source,context}`
- [Source: packages/decision-core/ports/ingestion.ts] — khuôn port interface (`IngestionPort`/`MarketSnapshotRequest`) + `Result`
- [Source: packages/config/src/schema.ts] — `ConfigParams`/`NewsBlackoutWindow`/`validateParams`/`validateNewsBlackout`/`isNonNegativeInteger`; điểm thêm buffer + type-compat
- [Source: packages/decision-core/tiers/tier0/behavioral-veto.ts (story 1-6)] — Tầng 0 tiêu thụ `news_blackout` (`[startsAt,endsAt)` + `pairs`), shape windows phải khớp
- [Source: 1-6-tier0-behavioral-veto.md] — news_blackout scope bằng `window.pairs`; "chặn cặp FX liên quan" không cần taxonomy lõi

## Cần xác nhận (product decision — không chặn draft)

- **Nguồn tin LỖI ⇒ hành vi nào?** Mặc định story chọn **suy giảm mềm = không blackout, có log** (giao dịch tiếp) — khớp NFR-5 "suy giảm mềm + log" và AC gốc không bắt chặn. Phương án bảo thủ hơn: **calendar-fail ⇒ Tầng 0 veto cặp FX** tới khi có lịch (an toàn hơn nhưng ngừng trade FX khi mất nguồn). Nếu anh muốn phương án bảo thủ, mình chuyển veto-on-missing-calendar sang **driver/Tầng 0** (không phải adapter) ở story wiring epic 3. Cần anh chốt trước khi live.

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- 2026-07-04: Resolver script failed because shell Python lacks `tomllib` / Python 3.11; workflow customization was resolved manually from base config.
- 2026-07-04: Initial package validation caught adapters importing `@brighten/config` directly; normalized window typing was changed to use `FxCalendarResult` from `@brighten/decision-core` to preserve package boundaries.
- 2026-07-04: Full `pnpm -r typecheck && pnpm -r build && pnpm -r lint && pnpm -r test` passed.
- 2026-07-04: Removed stale generated `dist/*.test.*` artifacts; verified both `rg --files -g 'dist/**' | rg '\.test\.'` and direct `find packages apps -path '*/dist/*' ...` return no test artifacts.

### Completion Notes List

- Added versioned news blackout buffer params to config with non-negative validation and `before + after > 0` guard.
- Added `FxCalendarPort` / request / result types in decision-core ports and exported them publicly.
- Replaced `fx-calendar` scaffold with a soft-degrading adapter that fetches JSON through injected `fetchFn`, logs warnings, never throws to cron, and returns generated windows plus warnings.
- Added pure calendar normalization, high-impact classification, and deterministic pair-scoped `NewsBlackoutWindow` building.
- Added adapter/config tests covering high-impact filtering, window math, pair scoping, type compatibility with `ConfigParams.news_blackout`, network/HTTP/JSON failure soft-degrade, partial invalid payloads, deterministic output, and config validation.
- Updated hard-shaped `ConfigParams` test fixtures with blackout buffer defaults.

### File List

- `_bmad-output/implementation-artifacts/2-3-fx-news-calendar-blackout.md`
- `packages/adapters/fx-calendar/index.ts`
- `packages/adapters/fx-calendar/index.test.ts`
- `packages/adapters/fx-calendar/normalize.ts`
- `packages/adapters/fx-calendar/normalize.test.ts`
- `packages/config/src/schema.ts`
- `packages/config/src/schema.test.ts`
- `packages/decision-core/ports/fx-calendar.ts`
- `packages/decision-core/ports/index.ts`
- `packages/decision-core/pipeline/runner.test.ts`
- `packages/decision-core/tiers/tier0/behavioral-veto.test.ts`
- `packages/decision-core/tiers/tier0/index.test.ts`
- `packages/decision-core/tiers/tier1/crypto-regime.test.ts`
- `packages/decision-core/tiers/tier1/fx-regime.test.ts`
- `packages/decision-core/tiers/tier1/index.test.ts`
- `packages/decision-core/tiers/tier3/index.test.ts`

### Change Log

- 2026-07-04: Implemented Story 2.3 FX calendar blackout adapter, config buffers, port, tests, and validation; status moved to review.
