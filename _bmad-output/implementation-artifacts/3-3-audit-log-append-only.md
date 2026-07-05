---
baseline_commit: cfae2a46e98a2ac6b5e1bf9e97fc672533fa2161
depends_on: 3-2-behavioral-state-durable-owner
---

# Story 3.3: Nhật ký audit append-only (FR-14)

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **người dùng của Brighten**,
I want **mọi Đề xuất phát ra và mọi lần chặn có ý nghĩa (Tầng 0 veto hành vi + Tầng 3 loại setup) được ghi vào một Nhật ký `audit_events` BẤT BIẾN (append-only, không đường UPDATE/DELETE), mỗi bản ghi đủ ngữ cảnh (quyết định/lý do/tín hiệu/config version) để tái dựng VÌ SAO**,
so that **tôi review lại được vì sao một Đề xuất xuất hiện hoặc bị chặn, đối chiếu hành vi kỷ luật của chính mình, và lịch sử không thể bị sửa (FR-14, AD-8)**.

## Acceptance Criteria

**AC1 — `AuditEvent` shape thật + builder THUẦN từ kết quả pipeline (đủ tái dựng vì sao)**
**Given** `AuditEvent` đang là placeholder `{ type, atEpochMillis, payload }` và `PipelineResult` surface `direction/candidate/sizing/vetoedBy/reason` (2.5)
**When** nâng shape + thêm builder
**Then** nâng `AuditEvent` (kebab `type` theo Consistency Conventions) và thêm **builder thuần** trong `packages/decision-core/audit/`:
  - `buildSuggestionEmittedEvent({ suggestion, atEpochMillis }) → AuditEvent` `type: "suggestion-emitted"`, payload gồm **Đề xuất đầy đủ** (direction/candidate/sizing/pair/timeframe/configVersion/snapshotSchemaVersion)
  - `buildSuggestionBlockedEvent({ pair, timeframe, atEpochMillis, vetoedBy, reason, configVersion, snapshotSchemaVersion }) → AuditEvent` `type: "suggestion-blocked"`, payload gồm `vetoedBy` + `reason` (chuỗi `formatReason` của tầng — **đã mã hoá tín hiệu kích hoạt**, vd `"conflicting_signals: funding short, longShort long, cvd neutral"`)
**And** builder **thuần**: không IO/`Date`/random; `atEpochMillis` là input (từ tick time); reserved `type: "override-recorded"` (3.6) + optional `narration?` (LLM, AD-9/FR-7 sau) — shape mở rộng được, KHÔNG hiện thực nguồn
**And** hợp đồng "đủ tái dựng": bản ghi mang `configVersion` + `pair/timeframe/atEpochMillis` (định danh cửa sổ dữ liệu) ⇒ nhờ **tất định (AD-2)** re-run cùng data+config tái dựng đúng chuỗi tín hiệu; `reason` (blocked) + `Suggestion` (emitted) cho phần người-đọc

**AC2 — Ghi Nhật ký khi Đề xuất phát ra hoặc bị chặn có ý nghĩa (nối `runTick`)**
**Given** `runTick` (3.1) trả `suggestion`/`silent`
**When** một tick kết thúc quyết định
**Then** `runTick` gọi `persistence.appendAuditEvent`:
  - `outcome: "suggestion"` (đã `saveSuggestion`) ⇒ append `suggestion-emitted`
  - `outcome: "silent"` **và** `vetoedBy ∈ { "tier0", "tier3" }` ⇒ append `suggestion-blocked` (chặn hành vi Tầng 0 / setup bị Tầng 3 loại — **các lần chặn có giá trị kỷ luật**)
**And** `vetoedBy ∈ { "tier1", "tier2" }` ("không có hướng"/"không có setup" = thị trường im, KHÔNG phải "chặn Đề xuất") ⇒ **KHÔNG** append (tránh ngập ~1440 bản ghi/ngày vô nghĩa) — **mặc định tài liệu-hoá, tunable** (xem Cần xác nhận)
**And** append audit **soft-degrade**: `appendAuditEvent` lỗi ⇒ log + tick vẫn trả kết quả (audit hụt không làm hỏng tick); thứ tự: `saveSuggestion` → `appendAuditEvent` (emitted) để id/thời gian nhất quán

**AC3 — Bản ghi Nhật ký BẤT BIẾN: không đường UPDATE/DELETE (AD-8)**
**Given** bảng `audit_events` (và `suggestions` của 3.1 — Đề xuất cũng bất biến, AD-8)
**When** ai đó thử sửa/xoá
**Then** migration **chặn cứng ở DB**: `revoke update, delete on audit_events` (và `suggestions`) khỏi mọi vai; **cộng** trigger `before update or delete ... raise exception` (belt-and-suspenders) ⇒ không đường code/role nào UPDATE/DELETE được
**And** chỉ thao tác `insert` được phép; `audit_events` id UUID (sắp thời gian — Consistency Conventions ID), `created_at` default `now()`
**And** ở tầng code: `PersistencePort` **KHÔNG** có method update/delete audit; adapter chỉ `insert` — một đường ghi-thêm duy nhất

**AC4 — `appendAuditEvent` thật trong adapter postgres (thay stub deferred)**
**Given** `appendAuditEvent` (3.1) đang stub (chỉ `logger("postgres_audit_deferred")`)
**When** hiện thực
**Then** `appendAuditEvent(event)` insert `audit_events (type, at_epoch_millis, payload)` values (`event.type`, `event.atEpochMillis`, `event.payload` jsonb); lỗi DB ⇒ `Result{ok:false}` (không throw) — soft-degrade
**And** `SqlClient` tiêm (test không DB thật); shape lỗi `{ code:"db_error", source:"adapter.postgres", context }` song song method khác

**AC5 — Test phủ từng AC + toolchain sạch**
**Given** Vitest (nền adapters + cron-runner từ 3.1/3.2)
**When** thêm test builder + wiring + adapter + (kiểm) append-only
**Then** có test cho: `buildSuggestionEmittedEvent`/`buildSuggestionBlockedEvent` payload đúng (số/chuỗi tính tay, thuần, tất định 2× `toEqual`, không leak number); `runTick` append `suggestion-emitted` khi suggestion, `suggestion-blocked` khi tier0/tier3 veto, **KHÔNG** append khi tier1/tier2 silent, KHÔNG append khi skipped; append lỗi ⇒ tick vẫn trả kết quả (fake persistence lỗi); postgres `appendAuditEvent` phát `insert audit_events` đúng tham số (fake `SqlClient`) + lỗi→`Result{ok:false}`; adapter KHÔNG có đường update/delete
**And** (nếu có Supabase local test harness) kiểm trigger append-only chặn UPDATE/DELETE — hoặc tối thiểu **review migration** khẳng định revoke + trigger; `pnpm -r typecheck && pnpm -r build && pnpm -r lint && pnpm -r test` **tất cả pass**; `*.test.ts` KHÔNG lọt `dist/`

## Tasks / Subtasks

- [x] **Task 1 — `AuditEvent` shape + builder thuần (AC: #1)**
  - [x] `packages/decision-core/types/index.ts`: nâng `AuditEvent` (giữ tương thích `PersistencePort.appendAuditEvent(event: AuditEvent)`): `{ readonly type: AuditEventType; readonly atEpochMillis: number; readonly payload: Readonly<Record<string, unknown>> }` với `type AuditEventType = "suggestion-emitted" | "suggestion-blocked" | "override-recorded"` (kebab). Giữ `payload` mở (jsonb-able)
  - [x] `packages/decision-core/audit/build.ts`: **NEW** — thuần:
    - `buildSuggestionEmittedEvent(input: { suggestion: Suggestion; atEpochMillis: number }): AuditEvent`
    - `buildSuggestionBlockedEvent(input: { pair; timeframe; atEpochMillis; vetoedBy: TierId; reason: string; configVersion: number; snapshotSchemaVersion: number }): AuditEvent`
    - payload chỉ dữ liệu người-đọc/tái-dựng (không hàm/không undefined rác); `atEpochMillis` từ input
  - [x] `packages/decision-core/audit/index.ts`: **NEW** `export *`; `packages/decision-core/index.ts` +`export * from "./audit/index.js"`
  - [x] Không IO/`Date`/random trong builder (AD-2); reserved `override-recorded` + optional `narration` chỉ khai báo shape

- [x] **Task 2 — `appendAuditEvent` thật trong adapter postgres (AC: #4)**
  - [x] `packages/adapters/postgres/index.ts`: thay stub `appendAuditEvent` → `insert into audit_events (type, at_epoch_millis, payload) values ($1, $2, $3)` với `[event.type, event.atEpochMillis, event.payload]`; try/catch → lỗi `failure("db_error", { operation: "appendAuditEvent", detail })`; **không** throw. (`payload` truyền object; client jsonb-hoá như `saveSuggestion` truyền `suggestion`)
  - [x] `packages/adapters/postgres/index.test.ts`: **UPDATE** — `appendAuditEvent` phát insert đúng bảng/tham số (fake `SqlClient`); lỗi client → `Result{ok:false}`; KHÔNG còn `postgres_audit_deferred`

- [x] **Task 3 — Nối audit vào `runTick` (AC: #2)**
  - [x] `apps/cron-runner/src/tick.ts`: sau `saveSuggestion` (nhánh suggestion) ⇒ `appendAuditEvent(buildSuggestionEmittedEvent({ suggestion, atEpochMillis: toEpochMillis }))`; nhánh `silent` với `vetoedBy ∈ {tier0,tier3}` ⇒ `appendAuditEvent(buildSuggestionBlockedEvent({ pair, timeframe, atEpochMillis: toEpochMillis, vetoedBy, reason, configVersion: config.version, snapshotSchemaVersion: MARKET_SNAPSHOT_SCHEMA_VERSION }))`
  - [x] Append lỗi ⇒ `logger(...)` + tiếp (không đổi `TickResult`); tier1/tier2 silent + skipped ⇒ **không** append. Giữ soft-degrade/try-catch 3.1; giữ `market-tick` persist của 3.2
  - [x] `apps/cron-runner/src/tick.test.ts`: **UPDATE** — 4 nhánh append (emitted / tier0-blocked / tier3-blocked / KHÔNG-append cho tier1/tier2/skip); append lỗi ⇒ tick vẫn trả kết quả

- [x] **Task 4 — Migration: `audit_events` + append-only guard (`suggestions` cũng bất biến) (AC: #3)**
  - [x] `supabase/migrations/<ts>_audit_append_only.sql`: **NEW** —
    - `create table if not exists public.audit_events (id uuid primary key default gen_random_uuid(), type text not null, at_epoch_millis bigint not null, payload jsonb not null, created_at timestamptz not null default now());`
    - hàm `create or replace function public.reject_mutation() returns trigger language plpgsql as $$ begin raise exception 'append-only table % is immutable', tg_table_name; end; $$;`
    - trigger `before update or delete` trên `audit_events` **và** `suggestions` (AD-8: Đề xuất bất biến) execute `reject_mutation`
    - `revoke update, delete on public.audit_events, public.suggestions from public;` (+ vai anon/authenticated dùng bởi UI — chỉ `select`)
    - Idempotent (`if not exists` / `drop trigger if exists` trước create)
  - [x] Ghi chú ops: role service (cron/feedback) chỉ `insert`; UI role chỉ `select` (nối AD-6/AD-8)

- [x] **Task 5 — Tests (AC: #5)**
  - [x] `packages/decision-core/audit/build.test.ts`: **NEW** — builder payload emitted/blocked đúng (fixture Suggestion + veto); thuần (structuredClone input không đổi), tất định (2× `toEqual`), `typeof` field tiền trong payload `=== "string"`
  - [x] `apps/cron-runner/src/tick.test.ts` (Task 3) + `packages/adapters/postgres/index.test.ts` (Task 2) phủ wiring/adapter
  - [x] (Tuỳ chọn) test SQL append-only nếu có harness Supabase local; nếu không, note review migration
  - [x] `pnpm -r test` pass; `dist/` không chứa `*.test.*`

## Dev Notes

> **Bối cảnh:** Story 3.3 hiện thực **AD-8 — Nhật ký audit append-only (FR-14)**. 3.1 để `appendAuditEvent` là **stub deferred** (chỉ log) và `AuditEvent` là placeholder; 3.3 làm nó **thật + bất biến**. Đây là **cơ chế niềm tin** của sản phẩm: người dùng review lại "vì sao hệ thống chặn tôi / đề xuất gì" và **không thể sửa lịch sử** (kể cả chính họ) ⇒ bằng chứng để tin & tự đối chiếu hành vi. Bám hạ tầng 3.1: `PersistencePort`/`SqlClient` tiêm, shape lỗi `{code,source,context}`, soft-degrade, builder thuần trong core.

> **Phụ thuộc:** build trên **3.1** (`appendAuditEvent` stub, `suggestions` table, `runTick`, `PipelineResult` surface) + **3.2** (runTick đã chèn market-tick/writeBehavioralState; migration sequencing sau 3.2). [Source: apps/cron-runner/src/tick.ts; packages/adapters/postgres/index.ts#appendAuditEvent; supabase/migrations]

### 🔑 "Đủ để tái dựng vì sao" = tất định + định-danh-input, KHÔNG cần chép mọi tín hiệu

- Lõi **tất định (AD-2)**: cùng `MarketSnapshot` + `configVersion` + `state` ⇒ **cùng** chuỗi tín hiệu/quyết định. Nên bản ghi audit **không cần** chép mọi funding/OI/CVD/swing — chỉ cần **định danh input** (`configVersion` + `pair/timeframe/atEpochMillis` = cửa sổ dữ liệu) + **kết quả** (Đề xuất đầy đủ, hoặc `vetoedBy`+`reason`). Re-run tái dựng phần còn lại. [Source: ARCHITECTURE-SPINE.md#AD-2, #AD-8]
- Phần **người-đọc-ngay**: `reason` (blocked) đã là chuỗi `formatReason` mã hoá tín hiệu kích hoạt (vd `"cooldown_active: cooldown until … now …"`, `"conflicting_signals: funding short, longShort long, cvd neutral"`); `Suggestion` (emitted) mang direction/candidate/sizing. Đủ cho người dùng hiểu **không cần re-run**. [Source: packages/decision-core/tiers/*/index.ts#formatReason]
- Vì vậy 3.3 **KHÔNG** cần replumb tier để surface raw signals — tránh scope creep. Nếu sau muốn audit giàu hơn (chép `CryptoRegimeSignals`/`EntryZoneSignals`), mở rộng enrich/surface ở story riêng.

### 🔑 Ghi lần chặn NÀO — tránh ngập Nhật ký

- **Chặn có giá trị kỷ luật** = Tầng 0 veto (cooldown/daily-loss/max-trades/news — "hệ thống phanh tôi revenge") + Tầng 3 loại setup đã hình thành (cost-hurdle/rr — "chi phí giết cơ hội"). **Ghi.**
- **Tầng 1 "không có hướng" / Tầng 2 "không có setup"** = **thị trường im**, không phải "chặn một Đề xuất". Xảy ra gần như mỗi tick ⇒ ghi hết = **ngập ~1440 bản ghi/ngày** vô giá trị. **KHÔNG ghi** (mặc định). [Source: epics.md → 3.3 "một Đề xuất phát ra hoặc **bị chặn**"; suy luận sản phẩm]
- Đây là **quyết định sản phẩm về độ ồn Nhật ký**, không phải kiến trúc — tunable (xem Cần xác nhận). `vetoedBy` (surface 2.5) đủ để phân nhánh trong `runTick`.

### 🔑 Bất biến ở DB, không chỉ ở code (AD-8)

"Không có đường UPDATE/DELETE lên bản ghi Nhật ký" phải enforce **ở Postgres** (revoke + trigger raise), không chỉ "code không gọi update". Lý do: audit là bằng chứng — phải chống cả bug lẫn tay người. `suggestions` (3.1) cũng bất biến (Đề xuất là bằng chứng). Chỉ `insert`. [Source: ARCHITECTURE-SPINE.md#AD-8]

### Hợp đồng đã có (PHẢI tuân, đọc trước khi sửa) — sau 3.1/3.2

| File | Trạng thái | Story 3.3 đổi gì | Phải giữ nguyên |
| --- | --- | --- | --- |
| `packages/decision-core/types/index.ts` | `AuditEvent` placeholder `{type,atEpochMillis,payload}` | nâng `type` thành union kebab; giữ shape `{type,atEpochMillis,payload}` | `Suggestion` (3.1); `PersistencePort.appendAuditEvent(event)` compat |
| `packages/decision-core/ports/persistence.ts` | `appendAuditEvent(event)` | **KHÔNG sửa** interface (chỉ impl) | 4/5 method |
| `packages/adapters/postgres/index.ts` | `appendAuditEvent` stub (log deferred) | **impl thật** insert `audit_events` | read/save/write hiện có; `SqlClient` tiêm; shape lỗi |
| `apps/cron-runner/src/tick.ts` | suggestion→save; silent→trả; (3.2: market-tick persist) | **+append audit** (emitted / tier0+tier3 blocked) | soft-degrade/try-catch; save suggestion; market-tick 3.2; TickResult shape |
| `supabase/migrations/…` | `suggestions` table (3.1), `behavioral_state` (3.1/3.2) | **migration mới**: `audit_events` + trigger/revoke append-only (cả `suggestions`) | migration cũ (không sửa) |
| `packages/decision-core/pipeline/runner.ts` | `PipelineResult` surface `vetoedBy/reason/direction/candidate/sizing` | **KHÔNG sửa** (đọc surface) | toàn bộ |

[Source: packages/decision-core/types/index.ts; ports/persistence.ts; packages/adapters/postgres/index.ts; apps/cron-runner/src/tick.ts; supabase/migrations]

### Invariant kiến trúc PHẢI tuân

- **AD-8 — audit append-only:** mọi Đề xuất/lần chặn/(override) ghi bất biến, không UPDATE/DELETE (enforce DB); mỗi bản đủ tái dựng vì sao. [Source: #AD-8]
- **AD-2 — tất định:** builder thuần; "đủ tái dựng" dựa determinism + config version (không chép mọi tín hiệu). [Source: #AD-2]
- **AD-9 — LLM ngoài đường quyết định (deferred):** `narration?` (prompt/response LLM) là optional trong audit; nguồn narrator (FR-7) là story sau — audit chừa chỗ, chưa hiện thực. [Source: #AD-9]
- **AD-6 — state owner:** audit chỉ **ghi-thêm** sự kiện, KHÔNG mutate state; UI đọc audit read-only (nối grant 3.2). [Source: #AD-6]
- **Consistency Conventions:** naming event kebab (`suggestion-emitted`/`suggestion-blocked`/`override-recorded`); ID UUID sắp thời gian; lỗi `{code,source,context}`. [Source: #Consistency Conventions]

### Ngoài phạm vi story này (đừng làm — để story sau)

- **`override-recorded` NGUỒN** (ma sát override + ghi lần override) — **3.6** (FR-12). 3.3 chỉ **reserve** type; không hiện thực override flow.
- **LLM `narration` (prompt/response) trong audit** — narrator FR-7/AD-9, story sau. 3.3 chừa optional field, không gọi LLM.
- **UI đọc/hiển thị Nhật ký** — **epic 4** (FR-13). 3.3 chỉ ghi + cấp read-only; UI render sau.
- **Ghi Tầng 1/2 "không có hướng/setup"** — mặc định KHÔNG (tránh ngập); nếu muốn "im lặng cũng ghi" là tùy chọn tunable sau.
- **Retention/rotation Nhật ký** — v1 giữ hết (append-only); dọn dẹp là vận hành sau.
- **Feedback trade-outcome ghi audit** — event trade-outcome (3.4) có thể sinh audit; wiring đó thuộc 3.4/3.5 khi có nguồn. 3.3 làm khung emitted/blocked.

### Source tree mục tiêu (phần thêm/đổi)

```text
packages/decision-core/
  types/index.ts            # UPDATE: AuditEvent placeholder → type union kebab (giữ shape)
  audit/
    build.ts                # NEW: buildSuggestionEmittedEvent + buildSuggestionBlockedEvent (thuần)
    build.test.ts           # NEW
    index.ts                # NEW: export *
  index.ts                  # UPDATE: +export * from audit
packages/adapters/postgres/
  index.ts                  # UPDATE: appendAuditEvent stub → insert audit_events
  index.test.ts             # UPDATE
apps/cron-runner/src/
  tick.ts                   # UPDATE: +append audit (emitted / tier0+tier3 blocked)
  tick.test.ts              # UPDATE
supabase/migrations/
  <ts>_audit_append_only.sql # NEW: audit_events + trigger/revoke append-only (+ suggestions)
```
[Source: ARCHITECTURE-SPINE.md#Structural Seed; bố cục 3.1/3.2 làm khuôn]

### Project Structure Notes

- **`audit/` dir mới** trong decision-core (builder thuần, song song `state/` 3.2, `cost/`). Không import port/IO. `decision-core/index.ts` +`export *`.
- **`AuditEvent` giữ shape `{type,atEpochMillis,payload}`** (3.1 stub đã vậy) ⇒ chỉ siết `type` thành union + thêm builder ⇒ **không** phá `PersistencePort.appendAuditEvent` hay adapter chữ ký. Payload `jsonb`-able (không hàm/Date).
- **Append-only ở DB là điểm dễ sai:** phải cả `revoke` (chặn role) **và** trigger `raise` (chặn cả superuser path/bug). `drop trigger if exists` trước `create` để idempotent. `reject_mutation()` dùng chung 2 bảng.
- **`suggestions` cũng append-only:** 3.1 tạo bảng chưa có guard; 3.3 thêm trigger/revoke cho nó (AD-8 "Mọi Đề xuất… bất biến"). Đảm bảo `saveSuggestion` (insert) vẫn chạy — chỉ chặn update/delete.
- **runTick nhánh append**: cần `vetoedBy` (đã surface). `buildSuggestionBlockedEvent` cần `configVersion` (từ `config.version` đã đọc) + `pair/timeframe` (từ snapshot/tickConfig). Đảm bảo lấy đúng nguồn (snapshot cho suggestion; tickConfig cho blocked trước khi có snapshot? — Tầng 0 veto xảy ra sau khi đã có snapshot trong runTick ⇒ dùng `snapshot.pair/timeframe`). Kiểm: Tầng 0 chạy trong pipeline **sau** ingestion ⇒ snapshot có sẵn khi blocked.
- **Soft-degrade audit**: append lỗi KHÔNG đổi `TickResult` (Đề xuất/chặn đã xảy ra; audit hụt chỉ log). Nhất quán `saveSuggestion` lỗi của 3.1 (log + tiếp).

### Chuẩn test

- **Builder thuần**: emitted payload = Đề xuất đầy đủ; blocked payload = `{vetoedBy,reason,pair,timeframe,configVersion,...}`; structuredClone input bất biến; 2× `toEqual`; `typeof` field tiền `=== "string"`.
- **runTick nhánh**: fake persistence ghi `appendAuditEvent` calls — assert: suggestion ⇒ 1 emitted; tier0 veto ⇒ 1 blocked; tier3 veto ⇒ 1 blocked; tier1/tier2 veto ⇒ **0** audit; skipped ⇒ 0 audit; append throw/`ok:false` ⇒ tick vẫn trả đúng status.
- **postgres adapter**: `appendAuditEvent` phát `insert into audit_events` đúng cột/tham số (fake `SqlClient`); lỗi → `Result{ok:false}`, không throw.
- **Append-only SQL**: nếu có Supabase local test → UPDATE/DELETE `audit_events` raise; nếu không → checklist review migration (revoke + trigger cả 2 bảng).
- Không DB/mạng thật (fake `SqlClient`/ports).

### References

- [Source: epics.md → Epic 3, Story 3.3] — AC gốc (BDD): Đề xuất/chặn/override/lý do ghi bất biến; không UPDATE/DELETE (AD-8); mỗi bản đủ tái dựng vì sao Đề xuất xuất hiện/bị chặn
- [Source: prd.md#FR-14, #NFR-2] — nhật ký audit; khả kiểm: mọi Đề xuất/tín hiệu/lý do LLM/chặn/override ghi bất biến
- [Source: ARCHITECTURE-SPINE.md#AD-8] — append-only, không UPDATE/DELETE; đủ tái dựng vì sao; cơ chế niềm tin
- [Source: ARCHITECTURE-SPINE.md#AD-2] — tất định ⇒ "đủ tái dựng" bằng định-danh-input + config version, không chép mọi tín hiệu
- [Source: ARCHITECTURE-SPINE.md#AD-9] — LLM ngoài đường quyết định; `narration` optional trong audit (nguồn sau)
- [Source: ARCHITECTURE-SPINE.md#Consistency Conventions] — naming event kebab; ID UUID sắp thời gian; lỗi `{code,source,context}`
- [Source: apps/cron-runner/src/tick.ts] — `runTick` (suggestion/silent/skipped; `vetoedBy`/`reason`; `saveSuggestion`) — điểm nối append audit
- [Source: packages/adapters/postgres/index.ts] — `appendAuditEvent` stub (thay); `saveSuggestion` insert (khuôn); `SqlClient`/`failure` shape
- [Source: packages/decision-core/types/index.ts] — `AuditEvent` placeholder (nâng); `Suggestion` (3.1); `TierId`
- [Source: packages/decision-core/pipeline/runner.ts] — `PipelineResult.vetoedBy/reason` (phân nhánh blocked); surface decision (emitted)
- [Source: packages/decision-core/ports/persistence.ts] — `appendAuditEvent` (impl thật)
- [Source: supabase/migrations/20260704031000_live_tick.sql] — `suggestions` table 3.1 (thêm append-only guard); nền để +`audit_events`
- [Source: 3-1…md, 3-2…md] — hạ tầng persistence/tick/migration; ranh giới state-owner (audit chỉ ghi-thêm)

## Cần xác nhận (không chặn draft)

- **Ghi lần chặn nào?** Mặc định: **emitted + Tầng 0 veto + Tầng 3 veto**; Tầng 1/2 "không hướng/setup" KHÔNG ghi (tránh ngập). Nếu anh muốn "mọi tick im cũng ghi" (audit đầy đủ tuyệt đối) hay chỉ Tầng 0, mình chỉnh policy trong `runTick`.
- **`suggestions` có cần bất biến không?** Mặc định mình thêm append-only cho cả `suggestions` (AD-8 "Đề xuất bất biến"). Nếu anh muốn Đề xuất được phép cập nhật trạng thái (vd "đã xác nhận fill" ở 3.4) thì cần cột trạng thái tách khỏi bản-ghi-bất-biến — chốt khi làm 3.4.

## Dev Agent Record

### Agent Model Used

Claude (deepseek-v4-pro)

### Debug Log References

### Completion Notes List

- **Task 1**: Upgraded `AuditEvent` from placeholder `{type: string, ...}` to typed union `AuditEventType = "suggestion-emitted" | "suggestion-blocked" | "override-recorded"` with optional `narration` field (AD-9 deferred). Created pure builder functions in `packages/decision-core/audit/build.ts`:
  - `buildSuggestionEmittedEvent`: embeds full Suggestion (direction/candidate/sizing/pair/timeframe/configVersion/snapshotSchemaVersion) in payload.
  - `buildSuggestionBlockedEvent`: embeds vetoedBy/reason/pair/timeframe/configVersion/snapshotSchemaVersion in payload.
  - Both pure: no Date, no IO, no random. Input `atEpochMillis` is from tick time.
  - Added `audit/index.ts` barrel and `decision-core/index.ts` export.

- **Task 2**: Replaced `appendAuditEvent` stub (was `logger("postgres_audit_deferred")`) in postgres adapter with real `INSERT INTO audit_events (type, at_epoch_millis, payload) VALUES ($1, $2, $3)`. DB errors return `Result{ok:false}` (no throw) matching existing adapter patterns. Tests verify correct INSERT parameters and error handling.

- **Task 3**: Wired audit into `runTick`:
  - **Suggestion branch**: after `saveSuggestion`, append `suggestion-emitted` event.
  - **Silent branch**: append `suggestion-blocked` only for `tier0` (behavioural veto) and `tier3` (cost/rr rejection) — these have discipline value. `tier1`/`tier2` (no direction/setup = quiet market) and `skipped` are NOT audited to avoid ~1440 noise records/day.
  - All audit appends are soft-degrade: error → log + tick continues with correct result.
  - Tests cover 6 branches: emitted, tier0-blocked, tier3-blocked, no-audit for tier1/tier2, no-audit for skipped, audit failure doesn't crash.

- **Task 4**: Created migration `20260705010000_audit_append_only.sql`:
  - `audit_events` table (UUID id, type text, at_epoch_millis bigint, payload jsonb, created_at timestamptz).
  - `reject_mutation()` trigger function that raises exception on UPDATE/DELETE.
  - Applied trigger to BOTH `audit_events` AND `suggestions` (AD-8: all decisions immutable).
  - Revoked UPDATE/DELETE from public + granted SELECT-only to anon/authenticated roles.
  - Fully idempotent (IF NOT EXISTS, DROP TRIGGER IF EXISTS, DO blocks for role checks).

- **Task 5**: 7 new builder tests + 2 new adapter tests + 6 new wiring tests = 15 new tests. Total: 302 tests pass (previously 287). Zero test artifacts in `dist/`. `pnpm -r typecheck && pnpm -r build && pnpm -r lint && pnpm -r test` all green.

### File List

- `packages/decision-core/types/index.ts` (MODIFIED — AuditEvent type union kebab + narration)
- `packages/decision-core/audit/build.ts` (NEW)
- `packages/decision-core/audit/build.test.ts` (NEW)
- `packages/decision-core/audit/index.ts` (NEW)
- `packages/decision-core/index.ts` (MODIFIED — +audit export)
- `packages/adapters/postgres/index.ts` (MODIFIED — appendAuditEvent stub → real INSERT)
- `packages/adapters/postgres/index.test.ts` (MODIFIED — +2 appendAuditEvent tests)
- `apps/cron-runner/src/tick.ts` (MODIFIED — +audit append in suggestion + blocked branches)
- `apps/cron-runner/src/tick.test.ts` (MODIFIED — +6 audit wiring tests + AuditEvent import)
- `supabase/migrations/20260705010000_audit_append_only.sql` (NEW)

## Change Log

- 2026-07-05: Story 3.3 implementation — typed AuditEvent with kebab union, pure builders in decision-core/audit/, real INSERT appendAuditEvent in postgres adapter, audit wiring in runTick (emitted + tier0/tier3 blocked only), append-only migration with trigger + revoke on both audit_events and suggestions. All 302 tests pass, 0 regressions.
