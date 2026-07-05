---
baseline_commit: cfae2a46e98a2ac6b5e1bf9e97fc672533fa2161
depends_on: 2-5-backtest-full-pipeline
---

# Story 3.1: Live tick — cron-runner (FR-5 live)

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **người dùng của Brighten**,
I want **pipeline tự chạy mỗi ~1 phút trên dữ liệu mới: `pg_cron` → `pg_net` gọi một Edge Function (Deno) chạy `decision-core`; mỗi tick poll snapshot Binance REST → chạy `runPipeline` (đúng lõi live=backtest, AD-3) → ghi Đề xuất vào Postgres; dữ liệu thiếu ⇒ không phát + log, không bao giờ làm chết cron**,
so that **hệ thống theo thị trường 24/7 mà không cần tôi bấm, và luật quyết định KHÔNG bị cài lại ở driver live (FR-5 live, AD-1, AD-3, AD-11, NFR-5)**.

## Acceptance Criteria

**AC1 — Orchestrator tick THUẦN-COMPOSITION: poll → pipeline → ghi Đề xuất (AD-3)**
**Given** một hàm `runTick(deps)` với `deps = { ingestion: IngestionPort, persistence: PersistencePort, clock: ClockPort, tickConfig: { pair, timeframe, assetClass, lookbackMs } }`
**When** một tick chạy
**Then** `runTick` tuần tự: (1) `persistence.readConfigSnapshot()` → config version; (2) `persistence.readBehavioralState()` → state; (3) `ingestion.getMarketSnapshot({ pair, timeframe, from, to })` với `to = clock.nowEpochMillis()`, `from = to − lookbackMs`; (4) `runPipeline([createTier0(), createTier1(assetClass), createTier2(), createTier3()], base, clock)`; (5) nếu `outcome: "suggestion"` ⇒ `persistence.saveSuggestion(<Suggestion từ result>)`
**And** `runTick` **KHÔNG** cài lại bất kỳ luật quyết định nào — chỉ compose ports + gọi `runPipeline` (đúng `defaultTiers` real của 2.5, cùng lõi live & backtest, AD-3); mọi luật ở `decision-core`
**And** `runTick` trả `TickResult` phân biệt: `{ status: "suggestion", suggestion }` | `{ status: "silent", vetoedBy, reason }` | `{ status: "skipped", reason }` (dữ liệu thiếu) — đủ để log/quan sát

**AC2 — Đề xuất ghi vào Postgres mang đủ quyết định (nối 2.5 surface)**
**Given** pipeline trả `outcome: "suggestion"` với `direction`/`candidate`/`sizing` surface (2.5)
**When** `runTick` lưu
**Then** dựng `Suggestion` mang: `pair`, `timeframe`, `atEpochMillis` (tick time), `direction`, `candidate` (entry/stop/target), `sizing` (volume/rr/riskAmount…), `configVersion`, `snapshotSchemaVersion` — đủ để UI (epic 4) hiển thị & user tự xác nhận thủ công trên sàn (KHÔNG tự đặt lệnh, AD-10)
**And** `persistence.saveSuggestion` ghi vào bảng `suggestions` (UUID v7 id, `created_at`); id sắp theo thời gian (Consistency Conventions)
**And** làm giàu **shape `Suggestion`** (đang stub `{kind:"stub",...}` trong `types`) thành shape thật tối thiểu cho live; **audit event richness + append-only** là story **3.3**, KHÔNG làm ở đây

**AC3 — Dữ liệu thiếu ở một tick ⇒ không phát + log (NFR-5, AD-11) — cron KHÔNG chết**
**Given** `ingestion.getMarketSnapshot` trả `{ ok: false }` (endpoint lỗi/timeout/klines rỗng)
**When** tick chạy
**Then** `runTick` **không** chạy pipeline, trả `{ status: "skipped", reason }` + log (KHÔNG throw) — không phát Đề xuất trên dữ liệu khuyết
**And** `ok: true` nhưng snapshot có `warnings` (feed phụ funding/OI/lsr thiếu) ⇒ **vẫn** chạy pipeline; tầng tự suy giảm mềm (Tầng 1 `insufficient_data` ⇒ silent) — vẫn không phát trên dữ liệu không đủ
**And** mọi lỗi trong tick được **bắt** (try/catch ở entrypoint) ⇒ Edge Function trả 200 + body lỗi có log, **không** để exception làm hỏng lịch cron (Consistency Conventions: ingestion lỗi → log + bỏ tick, không throw lên cron)

**AC4 — Edge Function (Deno) là entrypoint MỎNG, compose adapter thật**
**Given** kiến trúc AD-1 (stateless serverless + cron poll) và AD-3 (Edge Function import cùng core)
**When** dựng Edge Function
**Then** thêm `apps/cron-runner/functions/tick/index.ts` (Deno) — entrypoint **mỏng**: đọc env (pair/timeframe/assetClass/lookback, Binance base, DB URL, secret), dựng adapter thật (`createBinanceRestIngestion`, postgres persistence, system clock), gọi `runTick(deps)`, trả JSON `TickResult`
**And** import map (`deno.json`) map `@brighten/decision-core` + `@brighten/adapters` + `@brighten/config` sang path workspace (nối tiếp `functions/health/deno.json`) ⇒ Deno chạy **đúng** core TS, KHÔNG bản sao
**And** logic quyết-định-luồng nằm ở `runTick` (module TS **test được bằng vitest**, Node), Deno chỉ là vỏ — **KHÔNG** logic luật trong `index.ts` (song song backtest: `replay.ts` testable + `main.ts` vỏ)

**AC5 — Postgres persistence adapter tối thiểu (đủ cho tick); state/audit đầy đủ deferred**
**Given** `PersistencePort` đã có (`readBehavioralState`/`readConfigSnapshot`/`saveSuggestion`/`appendAuditEvent`)
**When** hiện thực adapter postgres cho tick
**Then** `createPostgresPersistence(deps)` (thay scaffold) hiện thực **tối thiểu**: `readConfigSnapshot` (đọc bảng `config` version mới nhất hoặc theo version), `readBehavioralState` (đọc `behavioral_state` một-hàng), `saveSuggestion` (insert `suggestions`); client Postgres tiêm vào (testable), soft-degrade lỗi DB → `Result{ok:false}` (không throw)
**And** **ranh giới rõ:** `readBehavioralState` ở 3.1 đọc state (seed sạch) — **quyền-sở-hữu + 2-event mutation (AD-6)** là **story 3.2**; `appendAuditEvent` append-only đầy đủ là **story 3.3**. 3.1 chỉ cấp đường **đọc config/state + ghi suggestion**; KHÔNG mutate state, KHÔNG làm audit rig

**AC6 — Migration: bật pg_cron + pg_net, tạo bảng tối thiểu, lịch ~1' gọi tick**
**Given** `supabase/migrations` (init rỗng hiện tại)
**When** thêm migration
**Then** migration mới: `create extension pg_cron`, `pg_net`; tạo bảng `suggestions` (id uuid pk, payload, created_at), `config` (version, params jsonb, created_at) **seed từ `DEFAULT_PARAMS` version 1** (AD-4), `behavioral_state` (một hàng seed sạch — 3.2 sẽ sở hữu/mở rộng); `cron.schedule(...)` mỗi ~1' gọi `net.http_post(<tick function URL>, headers auth)` (poll model, AD-1)
**And** URL/secret Edge Function qua env/secret store (KHÔNG commit khóa; Consistency Conventions Secrets); migration idempotent (`if not exists`)
**And** KHÔNG tạo schema audit append-only (3.3) / cột state đầy đủ (3.2) ở đây — chỉ bảng tối thiểu để tick chạy được

**AC7 — Test phủ từng AC + toolchain sạch**
**Given** thêm vitest cho `apps/cron-runner` (nền chưa có; nhân bản `backtest-cli` vitest)
**When** test `runTick` + postgres adapter với **fake ports/client** (KHÔNG mạng/DB thật)
**Then** có test cho: emit path (ingestion ok + pipeline suggestion ⇒ `saveSuggestion` gọi đúng payload); silent path (tầng veto ⇒ status silent, KHÔNG save); skipped path (ingestion `ok:false` ⇒ status skipped + KHÔNG chạy pipeline + KHÔNG throw); AD-3 (runTick dùng `runPipeline` core, không nhánh luật riêng); soft-degrade (fake ingestion throw ⇒ vẫn `{status:"skipped"}`); postgres adapter map row↔`ConfigSnapshot`/`BehavioralState`/insert suggestion với client giả; tất định (clock giả cố định); không leak number field tiền
**And** `pnpm -r typecheck && pnpm -r build && pnpm -r lint && pnpm -r test` **tất cả pass**; Deno `functions/tick/index.ts` typecheck qua deno (hoặc loại khỏi tsc như health); `*.test.ts` KHÔNG lọt `dist/`

## Tasks / Subtasks

- [x] **Task 1 — Làm giàu `Suggestion` shape cho live (AC: #2)**
  - [x] `packages/decision-core/types/index.ts`: nâng `Suggestion` từ stub thành shape thật tối thiểu: `{ kind: "trade"; pair: string; timeframe: string; atEpochMillis: number; direction: TradeDirection; candidate: TradeCandidate; sizing: SizingResult; configVersion: number; snapshotSchemaVersion: number }` — hoặc giữ `kind` mở rộng được. **Giữ tương thích** nơi đang dùng `Suggestion` stub (`runPipeline` `suggestion` field, `PipelineResult`, `PersistencePort.saveSuggestion`, cron health) — kiểm grep, cập nhật chỗ dựng stub
  - [x] Cân nhắc: `runPipeline` hiện điền `suggestion: { kind:"stub", atEpochMillis }` — driver dựng `Suggestion` thật từ `PipelineResult.{direction,candidate,sizing}` (2.5 surface) + `pair/timeframe/configVersion`. **Khuyến nghị**: `runTick` dựng Suggestion (nó có pair/timeframe/config); giữ `runPipeline` surface nguyên (không ép core biết pair là nội-dung Suggestion)
  - [x] `SizingResult` import type-only nếu chạm vòng (như 2.5 ghi chú)

- [x] **Task 2 — Orchestrator `runTick` (testable, Node/TS) (AC: #1, #2, #3)**
  - [x] `apps/cron-runner/src/tick.ts`: **NEW** — `runTick(deps: TickDeps): Promise<TickResult>` compose:
    - `TickDeps = { ingestion, persistence, clock, tickConfig: { pair, timeframe, assetClass: Tier1AssetClass, lookbackMs, account?: AccountState } }` (account tạm qua deps tới khi balance feed 3.4)
    - đọc config (port) → lỗi ⇒ `{status:"skipped",reason}`; đọc state (port) → lỗi ⇒ skipped
    - `to = clock.nowEpochMillis()`, `from = to − lookbackMs`; `ingestion.getMarketSnapshot(...)`; `ok:false` ⇒ `{status:"skipped",reason}` + log warnings
    - `base: PipelineBaseContext = { input: snapshot, state, config, ...(account?{account}:{}) }`; `runPipeline([createTier0(), createTier1(assetClass), createTier2(), createTier3()], base, clock)`
    - `outcome:"suggestion"` ⇒ dựng `Suggestion` từ `result.{direction,candidate,sizing}` + `pair/timeframe/config.version`; `saveSuggestion` → lỗi ⇒ log nhưng vẫn trả suggestion status (hoặc `skipped` nếu muốn nghiêm — chọn một, tài liệu-hoá); trả `{status:"suggestion",suggestion}`
    - `outcome:"silent"` ⇒ `{status:"silent",vetoedBy,reason}`
  - [x] **Bắt lỗi**: `runTick` không throw ra ngoài; mọi lỗi ⇒ `{status:"skipped",reason}` (cron sống). `TickResult` type export
  - [x] `runTick` **KHÔNG** import luật tier lẻ ngoài `createTier0/createTier1/createTier2/createTier3` (assembly), KHÔNG tự tính hướng/vùng/size (AD-3)

- [x] **Task 3 — Postgres persistence adapter tối thiểu (AC: #5)**
  - [x] `packages/adapters/postgres/index.ts`: **REPLACE** scaffold — `createPostgresPersistence(deps: { sql: SqlClient; logger? }): PersistencePort`
    - `SqlClient` = interface tiêm vào (query tham số hoá) ⇒ test với client giả, không DB thật (song song `FetchLike` của binance-rest)
    - `readConfigSnapshot(version?)`: select `config` (mới nhất/theo version) → parse `params` jsonb qua `validateParams` (@brighten/config) → `snapshot(createConfigVersion(...))`; lỗi/không có ⇒ `Result{ok:false, error{code,source:"adapter.postgres",context}}`
    - `readBehavioralState()`: select `behavioral_state` một-hàng → map cột → `BehavioralState`; không có ⇒ lỗi (3.2 seed/own)
    - `saveSuggestion(s)`: insert `suggestions(id, payload, created_at)` (id uuid v7 do adapter/DB sinh); lỗi ⇒ `Result{ok:false}`
    - `appendAuditEvent`: **stub tối thiểu** (insert no-op hoặc chưa hiện thực đầy đủ) — **3.3** làm append-only thật; ghi TODO rõ
  - [x] Soft-degrade: lỗi DB → `Result{ok:false}`, KHÔNG throw. Export `createPostgresPersistence` + `SqlClient` type; `packages/adapters/index.ts` đã `export *` ⇒ tự lan

- [x] **Task 4 — Edge Function tick (Deno entrypoint mỏng) (AC: #4)**
  - [x] `apps/cron-runner/functions/tick/index.ts`: **NEW** (Deno) — `Deno.serve` handler: đọc env (`PAIR`, `TIMEFRAME`, `ASSET_CLASS`, `LOOKBACK_MS`, `BINANCE_BASE_URL`, `DATABASE_URL`/secret), dựng `createBinanceRestIngestion({fapiBaseUrl})`, postgres persistence (client Deno-compatible, vd `postgres`/`postgres.js` từ deno.land — tiêm `SqlClient`), `systemClock`; `try { const r = await runTick(deps); return 200 json(r) } catch(e){ log; return 200 json({status:"skipped",reason}) }`
  - [x] `apps/cron-runner/functions/tick/deno.json`: import map `@brighten/decision-core`, `@brighten/adapters`, `@brighten/config`, `./src/tick.ts` → path workspace (nối `health/deno.json`)
  - [x] **Bắt mọi lỗi** ở handler ⇒ luôn 200 (cron/pg_net không coi tick lỗi là fail lịch). Giữ `functions/health` nguyên (probe riêng)

- [x] **Task 5 — Migration pg_cron/pg_net + bảng tối thiểu + lịch (AC: #6)**
  - [x] `supabase/migrations/<ts>_live_tick.sql`: **NEW** —
    - `create extension if not exists pg_cron;` `create extension if not exists pg_net;`
    - `create table if not exists config (version int primary key, params jsonb not null, created_at timestamptz default now());`
    - seed `config` version 1 từ `DEFAULT_PARAMS` (jsonb literal — đồng bộ với `@brighten/config` DEFAULT_PARAMS; ghi chú giữ đồng bộ)
    - `create table if not exists behavioral_state (id int primary key default 1, win_streak int, daily_loss text, last_loss_epoch_millis bigint, trade_count_today int, ...);` seed một hàng sạch (3.2 sở hữu/mở rộng)
    - `create table if not exists suggestions (id uuid primary key default gen_random_uuid(), payload jsonb not null, created_at timestamptz default now());` (uuid v7 nếu có ext; else gen_random_uuid + ghi chú)
    - `cron.schedule('brighten-live-tick', '* * * * *', $$ select net.http_post(url := <edge fn url>, headers := jsonb_build_object('Authorization', 'Bearer '||<secret>)) $$);` (mỗi phút)
  - [x] Idempotent (`if not exists`); URL/secret qua `current_setting`/vault, KHÔNG hardcode khóa. Ghi chú deploy/secret là **ops** (ngoài code)

- [x] **Task 6 — Vitest cho cron-runner + tests (AC: #7)**
  - [x] `apps/cron-runner/package.json`: thêm `"test": "vitest run"` + devDep vitest; `apps/cron-runner/vitest.config.ts` (nhân bản backtest-cli, exclude dist/node_modules)
  - [x] `apps/cron-runner/src/tick.test.ts`: **NEW** — fake `ingestion`/`persistence`/`clock`: emit (ok+suggestion ⇒ saveSuggestion payload đúng), silent (veto ⇒ no save), skipped (ingestion ok:false ⇒ no pipeline), soft-degrade (ingestion throw ⇒ skipped), AD-3 (dùng real tiers ⇒ hướng/vùng do core), determinism (clock cố định), no leak number
  - [x] `packages/adapters/postgres/index.test.ts`: **NEW** — fake `SqlClient`: readConfig row→snapshot (validateParams), readState row→BehavioralState, saveSuggestion insert đúng, lỗi DB→`Result{ok:false}`
  - [x] `pnpm -r test` pass; `dist/` không chứa `*.test.*`

## Dev Notes

> **Bối cảnh:** Story 3.1 **mở Epic 3** — chuyển từ backtest offline sang **driver LIVE thứ hai** của cùng `decision-core` (AD-3: "một engine, hai driver"). Đây là hiện thực **Phương án A** (SOLUTION-DESIGN §2): stateless serverless + Postgres + cron poll — `pg_cron ~1'` → `pg_net` → Edge Function (Deno) chạy lõi → ghi Postgres. Khuôn: **orchestrator `runTick` testable (Node/vitest) + Deno entrypoint mỏng** — y hệt cách `backtest-cli` tách `replay.ts` (testable) khỏi `main.ts` (vỏ). Điểm bất biến: driver **compose ports + gọi `runPipeline`**, KHÔNG cài lại luật.

> **Phụ thuộc:** build trên **2.5** (real `defaultTiers` + `PipelineResult` surface `direction`/`candidate`/`sizing`). `runTick` dùng đúng chuỗi tier real + đọc quyết định surface — **không** re-derive (bài học 2.5). [Source: 2-5…md]

### 🔑 Ranh giới với 3.2/3.3/3.4 — đừng lấn (quan trọng nhất)

3.1 chỉ dựng **vòng tick chạy được + ghi Đề xuất**. **Cố ý** để lại cho story sau:
- **Behavioral state bền + một-chủ-sở-hữu + 2-event mutation (AD-6)** → **3.2**. 3.1 chỉ **ĐỌC** state (seed sạch); KHÔNG mutate, KHÔNG định nghĩa `market-tick`/`trade-outcome` event ownership. [Source: epics.md → 3.2; ARCHITECTURE-SPINE.md#AD-6]
- **Nhật ký audit append-only + no UPDATE/DELETE + record đủ tái dựng (AD-8)** → **3.3**. 3.1 `appendAuditEvent` là **stub tối thiểu**; bảng `suggestions` chưa phải audit rig. [Source: epics.md → 3.3; #AD-8]
- **Feedback loop / `trade-outcome` / balance feed read-only (AD-7)** → **3.4**. 3.1 `account` tạm qua `deps` (như backtest seam). [Source: epics.md → 3.4; #AD-7]
- **Live-drift auto-halt (FR-10)** → **3.5**; **override friction (FR-12)** → **3.6**.
- **Realtime push → UI** → **epic 4**. 3.1 chỉ ghi Postgres; Realtime/UI đọc sau.

Giữ 3.1 nhỏ: *poll → pipeline → ghi suggestion + soft-degrade + cron wiring*. Mọi thứ "state/audit/feedback nghiêm" là story kế.

### 🔑 AD-3 là ràng buộc số 1 của story này

Edge Function **PHẢI** import cùng `decision-core` và **KHÔNG** cài lại luật. `runTick` chỉ được: đọc port, dựng `PipelineBaseContext`, gọi `runPipeline(real tiers)`, đọc `PipelineResult`, ghi. **Cấm**: tự tính hướng/vùng/size/veto trong `runTick` hay `index.ts`. Đây là thứ ngăn "bản live" và "bản backtest" trôi khác nhau — lỗi chí mạng của sản phẩm tất định. [Source: ARCHITECTURE-SPINE.md#AD-3; SOLUTION-DESIGN.md §3 "cấm cài lại luật trong driver"]

### 🔑 Soft-degrade là hợp đồng cứng (NFR-5, AD-11) — cron KHÔNG được chết

- `ingestion.getMarketSnapshot` `ok:false` ⇒ **skip tick** + log, KHÔNG chạy pipeline (không phát trên dữ liệu khuyết).
- `ok:true` + `warnings` (feed phụ thiếu) ⇒ **vẫn** chạy; Tầng 1 tự `insufficient_data` ⇒ silent (đã đúng tinh thần "không phát trên dữ liệu không đủ").
- **Entrypoint Deno bắt mọi exception** ⇒ luôn trả 200 (pg_net/cron không nên coi tick lỗi = job fail). "ingestion lỗi → log + bỏ tick, không throw lên làm chết cron" là Consistency Convention. [Source: ARCHITECTURE-SPINE.md#Consistency Conventions → Lỗi & log; #AD-11; prd.md#NFR-5]

### Hợp đồng đã có (PHẢI tuân, đọc trước khi sửa)

| File | Trạng thái | Story 3.1 đổi gì | Phải giữ nguyên |
| --- | --- | --- | --- |
| `apps/cron-runner/functions/health/index.ts` | Deno health scaffold trả stub `PipelineResult` | **KHÔNG sửa** (giữ probe); thêm `functions/tick/` riêng | health probe |
| `apps/cron-runner/package.json` | build/typecheck/lint (không test) | **+vitest** + `test` script | deps `@brighten/decision-core` |
| `packages/adapters/postgres/index.ts` | scaffold `PostgresAdapterScaffold` | **REPLACE** `createPostgresPersistence` (impl port, client tiêm) | (scaffold bỏ được — grep xác nhận không ai import) |
| `packages/decision-core/ports/persistence.ts` | `PersistencePort` 4 method | **KHÔNG sửa** interface (chỉ impl) | 4 method |
| `packages/decision-core/types/index.ts` | `Suggestion` stub `{kind:"stub",...}` | **nâng** shape thật cho live; kiểm mọi nơi dựng stub | `TradeCandidate`/`TradeDirection`/`BehavioralState`/`AuditEvent`/`Result` |
| `packages/decision-core/pipeline/runner.ts` | `PipelineResult` surface `direction/candidate/sizing` (2.5) | **KHÔNG sửa** (đọc surface) | toàn bộ |
| `packages/adapters/binance-rest/index.ts` | `createBinanceRestIngestion(deps)` (fetchFn/logger tiêm) | **KHÔNG sửa**; dùng làm ingestion live | toàn bộ |
| `packages/adapters/clock/index.ts` | `systemClockAdapterScaffold` (`Date.now`) | dùng làm clock live (đổi tên bỏ "Scaffold" nếu muốn — nhỏ) | `ClockPort` shape |
| `supabase/migrations/…_init.sql` | rỗng | **+migration mới** (extensions/bảng/cron); KHÔNG sửa init | init rỗng |

[Source: apps/cron-runner/functions/health/index.ts; packages/adapters/postgres/index.ts; packages/decision-core/ports/persistence.ts; types/index.ts; pipeline/runner.ts; packages/adapters/binance-rest/index.ts, clock/index.ts; supabase/migrations]

### Invariant kiến trúc PHẢI tuân

- **AD-1 — stateless serverless + Postgres + cron poll:** không tiến trình always-on; tick ~1' qua pg_cron; state ở Postgres. [Source: #AD-1]
- **AD-3 — một engine hai driver, cấm cài lại luật:** Edge Function import cùng core; `runTick` chỉ compose + `runPipeline`. [Source: #AD-3]
- **AD-11 / NFR-5 — suy giảm mềm:** thiếu dữ liệu ⇒ không phát + log; cron không chết. [Source: #AD-11]
- **AD-10 — không tự đặt lệnh:** tick chỉ **ghi Đề xuất** (data) vào Postgres; không đường gửi lệnh sàn. [Source: #AD-10]
- **AD-4 — config có phiên bản:** tick đọc `config` version từ Postgres; Suggestion mang `configVersion` (tái dựng). [Source: #AD-4]
- **AD-6/AD-7 — state/feedback:** 3.1 **chỉ đọc** state; mutation/ownership/feedback là 3.2/3.4. [Source: #AD-6, #AD-7]
- **AD-8 — audit append-only:** deferred 3.3; 3.1 ghi suggestion, chưa audit rig. [Source: #AD-8]

### Ngoài phạm vi story này (đừng làm — để story sau)

- **Behavioral state persist + 2-event ownership + reset trading-day** — **3.2** (AD-6). 3.1 đọc state seed, không mutate.
- **Audit append-only (bảng/trigger no-UPDATE-DELETE + record đủ tái dựng)** — **3.3** (AD-8).
- **Feedback loop / trade-outcome / Binance read-only account probe** — **3.4** (AD-7). `account` tạm qua deps.
- **Live-drift auto-halt** — **3.5** (FR-10); **override friction** — **3.6** (FR-12).
- **Realtime → UI, hiển thị Đề xuất** — **epic 4** (FR-13).
- **LLM narrator** — **epic 3 sau/FR-7** (AD-9); tick chưa gọi narrator.
- **Merge `news_blackout` windows (2.3) vào config mỗi tick** — cần lịch tin adapter chạy + inject; có thể ghép vào tick sau khi 3.x ổn (hoặc story riêng). 3.1 dùng `config.news_blackout` như-lưu (rỗng seed). Ghi chú seam.
- **Deploy/secret provisioning (Supabase Edge deploy, env, vault)** — **ops**, ngoài code; story cấp migration + entrypoint, không cấp khóa.

### Source tree mục tiêu (phần thêm/đổi)

```text
packages/decision-core/types/index.ts       # UPDATE: Suggestion stub → shape thật (live)
packages/adapters/postgres/index.ts          # REPLACE: createPostgresPersistence (impl port, SqlClient tiêm)
packages/adapters/postgres/index.test.ts     # NEW
apps/cron-runner/
  src/tick.ts                                # NEW: runTick orchestrator (testable, Node)
  src/tick.test.ts                           # NEW
  vitest.config.ts                           # NEW
  package.json                               # UPDATE: +vitest + test script
  functions/tick/index.ts                    # NEW: Deno entrypoint mỏng
  functions/tick/deno.json                   # NEW: import map
supabase/migrations/<ts>_live_tick.sql       # NEW: pg_cron/pg_net + bảng tối thiểu + lịch
```
[Source: ARCHITECTURE-SPINE.md#Structural Seed (apps/cron-runner, supabase/migrations); bố cục backtest-cli làm khuôn]

### Project Structure Notes

- **Deno vs Node split:** `src/tick.ts` là TS thuần Node (vitest test được); `functions/tick/index.ts` là Deno (`Deno.serve`, import map). Deno import `../../src/tick.ts` + adapter workspace qua import map (như `health/deno.json` map decision-core). Client Postgres cho Deno cần thư viện Deno-compatible (vd `postgres`/`deno-postgres`) — tiêm qua `SqlClient` để `src/tick.ts`/adapter test được không cần Deno.
- **`SqlClient` tiêm** là chìa khoá test: adapter nhận interface query, test bơm client giả (song song `FetchLike` binance-rest). Không import driver DB cứng trong adapter core-path.
- **`Suggestion` nâng shape** chạm nhiều nơi (grep `kind: "stub"`, `PipelineResult.suggestion`, `saveSuggestion`): cập nhật đồng bộ; `runPipeline` có thể vẫn trả `suggestion` tối giản còn `runTick` dựng Suggestion đầy đủ từ surface — **khuyến nghị** để core surface `direction/candidate/sizing` (đã có 2.5) và driver ráp Suggestion (driver biết pair/timeframe/configVersion). Tránh ép core biết "pair" là nội-dung-Suggestion.
- **Migration seed `config`**: `params jsonb` phải **khớp `DEFAULT_PARAMS`** của `@brighten/config` (gồm param 2.1–2.4). Rủi ro trôi lệch: ghi chú "seed đồng bộ DEFAULT_PARAMS"; cân nhắc test đọc-lại config qua `validateParams` để bắt lệch.
- **cron-runner chưa có vitest** — thêm (nhân bản backtest-cli). Deno `functions/*` KHÔNG chạy trong vitest (Deno runtime) ⇒ để typecheck qua deno/loại khỏi tsc như `health`.
- Xung đột: `apps/cron-runner/health` chỉ dùng `PipelineResult` type; nâng `Suggestion` không đụng health (không dùng Suggestion). Kiểm build cả `cron-runner`.

### Chuẩn test

- **fake ports** cho `runTick` (KHÔNG mạng/DB): `ingestion` giả trả snapshot cố định / `ok:false`; `persistence` giả ghi vào array + trả config/state seed; `clock` giả cố định.
- **Emit path**: snapshot đủ khiến pipeline suggestion ⇒ `saveSuggestion` gọi 1 lần với payload mang `direction/candidate/sizing/pair/timeframe/configVersion`.
- **Silent path**: state cooldown / snapshot no-direction ⇒ `{status:"silent"}`, `saveSuggestion` **không** gọi.
- **Skipped path**: `ingestion.ok:false` ⇒ `{status:"skipped"}`, pipeline **không** chạy (spy). `ingestion` throw ⇒ vẫn `{status:"skipped"}` (không throw ra).
- **AD-3**: `runTick` dùng real `createTier1(assetClass)` etc — hướng/vùng do core (test qua kết quả, không mock tier).
- **postgres adapter**: `SqlClient` giả trả row config → `validateParams` → snapshot đúng version; row state → `BehavioralState`; `saveSuggestion` gọi insert đúng bảng/tham số; lỗi client → `Result{ok:false}` (không throw).
- **Tất định** (clock cố định), **không leak number** (`typeof` field tiền `=== "string"`).
- **Không** test Deno entrypoint bằng vitest (Deno runtime); typecheck qua deno riêng nếu có.

### References

- [Source: epics.md → Epic 3, Story 3.1] — AC gốc (BDD): pg_cron ~1' + pg_net → Edge Function chạy core; poll Binance → pipeline → ghi Đề xuất/state; Edge Function không cài lại luật (AD-3); dữ liệu thiếu → không phát + log (NFR-5)
- [Source: prd.md#FR-5] — thu thập dữ liệu + real-time; [Source: prd.md#NFR-5] — bền dữ liệu, không phát trên dữ liệu khuyết + log
- [Source: ARCHITECTURE-SPINE.md#AD-1] — stateless serverless + Postgres + cron poll; không always-on
- [Source: ARCHITECTURE-SPINE.md#AD-3] — một engine hai driver; Edge Function import cùng core, cấm cài lại luật
- [Source: ARCHITECTURE-SPINE.md#AD-11, #Consistency Conventions] — suy giảm mềm; ingestion lỗi → log + bỏ tick, không throw lên cron
- [Source: ARCHITECTURE-SPINE.md#AD-10] — tick chỉ ghi Đề xuất (data); không đường tự gửi lệnh
- [Source: ARCHITECTURE-SPINE.md#AD-4] — config có phiên bản; tick đọc config version, Suggestion mang configVersion
- [Source: ARCHITECTURE-SPINE.md#AD-6, #AD-7, #AD-8] — state ownership (3.2)/feedback (3.4)/audit (3.3) deferred; 3.1 chỉ đọc state + ghi suggestion
- [Source: SOLUTION-DESIGN.md §2, §3, §7] — Phương án A (cron poll + Edge Function); cấm cài lại luật; bản đồ "Chạy pipeline ở đâu = Edge Function cron ~1'"
- [Source: apps/cron-runner/functions/health/index.ts, deno.json] — khuôn Deno function + import map decision-core
- [Source: apps/backtest-cli/src/replay.ts, main.ts] — khuôn "orchestrator testable + entrypoint vỏ"; compose ingestion/pipeline; `PipelineBaseContext`
- [Source: packages/decision-core/ports/persistence.ts] — `PersistencePort` (readConfigSnapshot/readBehavioralState/saveSuggestion/appendAuditEvent) để impl
- [Source: packages/decision-core/pipeline/runner.ts] — `PipelineResult` surface `direction/candidate/sizing` (2.5); `runPipeline` + `defaultTiers` real (2.5)
- [Source: packages/adapters/binance-rest/index.ts] — `createBinanceRestIngestion` (ingestion live); `FetchLike` tiêm làm khuôn `SqlClient`
- [Source: packages/adapters/postgres/index.ts] — scaffold thay bằng impl; [Source: packages/adapters/clock/index.ts] — system clock
- [Source: supabase/config.toml, migrations/…_init.sql] — nền Supabase (pg 15, edge_runtime); migration mới thêm pg_cron/pg_net
- [Source: 2-5…md] — real tiers + surface decision (nền để `runTick` đọc quyết định, không re-derive)

## Cần xác nhận (không chặn draft)

- **`saveSuggestion` lỗi ⇒ tick status nào?** Mặc định: log lỗi nhưng vẫn trả `{status:"suggestion"}` (Đề xuất đã sinh, chỉ ghi hụt) — hay nghiêm hơn `{status:"skipped"}` (không tin Đề xuất chưa ghi được)? Ảnh hưởng khi 3.3 audit. Mình chọn **log + suggestion** mặc định; anh chốt nếu muốn nghiêm.
- **Merge `news_blackout` (2.3) vào config mỗi tick**: story riêng hay ghép vào tick 3.x? 3.1 dùng `config.news_blackout` như seed (rỗng). Cần chốt khi bật FX live.

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- `CI=true pnpm --filter @brighten/adapters test`
- `CI=true pnpm --filter @brighten/cron-runner test`
- `CI=true pnpm -r typecheck`
- `CI=true pnpm -r build`
- `CI=true pnpm -r lint`
- `CI=true pnpm -r test`
- `find packages apps -path '*/dist/*' \( -name '*.test.js' -o -name '*.test.d.ts' -o -name '*.test.js.map' -o -name '*.test.d.ts.map' \) -print`
- `command -v deno` returned no executable in this environment; Deno tick entrypoint is included in Node tsc/lint via dynamic import, but Deno CLI typecheck was not runnable locally.

### Completion Notes List

- `Suggestion` is now the live trade payload shape. `runPipeline` keeps surfacing decision fields; `runTick` builds the persisted suggestion with pair/timeframe/config/schema metadata.
- Added `runTick` orchestrator with soft-degrade handling for config/state/ingestion/exceptions, real tier assembly, silent/suggestion/skipped status, and save-failure logging while returning the generated suggestion.
- Replaced postgres scaffold with `createPostgresPersistence` using injectable `SqlClient`; config/state reads and suggestion insert return `Result` without throwing, and audit remains deferred/no-op for 3.3.
- Added Deno tick Edge Function wrapper and import map; handler reads env, composes Binance ingestion + postgres persistence + system clock, and always returns 200 JSON.
- Added idempotent Supabase migration for `pg_cron`, `pg_net`, `config`, `behavioral_state`, `suggestions`, default config seed, clean state seed, and minute cron schedule using DB settings for URL/secret.
- Added cron-runner Vitest setup and tests plus postgres adapter tests. Full validation passed with `CI=true`; `dist` test artifacts were deleted and rechecked clean.

### File List

- apps/cron-runner/functions/tick/deno.json
- apps/cron-runner/functions/tick/index.ts
- apps/cron-runner/package.json
- apps/cron-runner/src/tick.test.ts
- apps/cron-runner/src/tick.ts
- apps/cron-runner/tsconfig.build.json
- apps/cron-runner/tsconfig.json
- apps/cron-runner/vitest.config.ts
- packages/adapters/package.json
- packages/adapters/postgres/index.test.ts
- packages/adapters/postgres/index.ts
- packages/decision-core/pipeline/runner.ts
- packages/decision-core/types/index.ts
- pnpm-lock.yaml
- supabase/migrations/20260704031000_live_tick.sql

### Change Log

- 2026-07-04: Implemented Story 3.1 live tick cron-runner orchestration, postgres persistence, Deno entrypoint, migration, and tests.
