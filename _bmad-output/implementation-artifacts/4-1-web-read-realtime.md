---
baseline_commit: cfae2a46e98a2ac6b5e1bf9e97fc672533fa2161
depends_on: 3-6-override-friction
---

# Story 4.1: Web app đọc + realtime (Vercel, cô lập)

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **người dùng của Brighten**,
I want **một web app `apps/web` (Next.js trên Vercel) CHỈ ĐỌC trạng thái hệ thống từ Postgres và cập nhật REAL-TIME qua Supabase Realtime; và một cam kết SAFETY cứng: UI KHÔNG chạy pipeline, KHÔNG mutate state, KHÔNG có bất kỳ đường code nào gửi lệnh tới sàn**,
so that **tôi thấy Đề xuất/tin ngay khi có mà tuyệt đối yên tâm app không tự làm gì nguy hiểm (FR-13 nền, AD-10, AD-1, ràng buộc SAFETY §11)**.

## Acceptance Criteria

**AC1 — Client Supabase CHỈ-ĐỌC + đọc SSR trạng thái ban đầu (AD-10)**
**Given** `apps/web` (Next.js 16.2, App Router) trên Vercel và Postgres (Supabase) với các bảng epic-3 (`suggestions`, `behavioral_state`, `drift_metrics`, `audit_events`, `override_grants`, `config`)
**When** mở app
**Then** thêm `@supabase/supabase-js`; client đọc dùng **anon key** (`NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_ANON_KEY`) — quyền **chỉ SELECT** (RLS/grant, AC4); server component đọc **trạng thái ban đầu** (SSR): Đề xuất mới nhất, `behavioral_state`, `drift_metrics` mới nhất
**And** data-layer `lib/queries.ts` **chỉ** `select` (không insert/update/delete/rpc-ghi); app resilient khi bảng **rỗng** (chưa có dữ liệu ⇒ trạng thái "chờ", không lỗi)
**And** **KHÔNG** dùng service_role key ở web (chỉ anon read-only); key/URL qua env Vercel (không commit)

**AC2 — Realtime push khi Postgres đổi ⇒ UI cập nhật sống (AD-1)**
**Given** dữ liệu Postgres đổi (tick ghi Đề xuất/drift/state — epic 3)
**When** một bản ghi mới xuất hiện
**Then** client (browser) subscribe **Supabase Realtime** trên các bảng đọc ⇒ nhận push ⇒ UI cập nhật **không cần refresh** (Đề xuất mới / drift mới / state đổi hiện ngay)
**And** subscription **chỉ nhận** (read stream); reconnect/lỗi realtime ⇒ **suy giảm mềm**: fallback poll/refetch nhẹ + UI vẫn hiển thị SSR data (không trắng màn); cleanup channel khi unmount (không leak)
**And** luồng: `PG → Realtime → browser` (đúng sơ đồ AD-1); web **không** giữ tiến trình/logic quyết định

**AC3 — SAFETY cô lập cứng: KHÔNG pipeline, KHÔNG mutate, KHÔNG đường gửi lệnh (AD-10, §11)**
**Given** ràng buộc SAFETY tối thượng (v1 tuyệt đối không đường code tự gửi lệnh)
**When** dựng web
**Then** `apps/web` **KHÔNG** import: `runPipeline`/tiers/`decision-core` runtime luật, `@brighten/adapters` (ingestion/postgres-write/binance-account), `cron-runner`, bất kỳ client sàn (Binance) — **chỉ** đọc Postgres qua supabase-js + (tuỳ chọn) **type-only** import từ `@brighten/decision-core` (kiểu Suggestion/… không kèm runtime)
**And** **không tồn tại** đường code: chạy pipeline, ghi/mutate bất kỳ bảng nào, gọi API sàn. Kiểm được: (a) `apps/web/package.json` deps KHÔNG có `@brighten/adapters`/binance/order client; (b) test/lint **grep-guard** chặn import cấm + chuỗi order (`/order`, `binance` runtime); (c) anon key chỉ SELECT (AC4)
**And** đây là hiện thực **AD-10 "Vercel cô lập khỏi quyết định & khỏi sàn"** — web chỉ đọc + hiển thị + realtime

**AC4 — RLS/grant chỉ-đọc cho anon + bật Realtime publication (AD-10 ở DB)**
**Given** anon role dùng bởi web
**When** cấp quyền DB
**Then** migration mới: `enable row level security` + policy **SELECT-only cho anon** trên các bảng UI đọc (`suggestions`, `behavioral_state`, `drift_metrics`, `audit_events`, `override_grants`, `config`); **không** policy insert/update/delete cho anon ⇒ web không thể ghi kể cả nếu code thử
**And** thêm các bảng đọc vào publication `supabase_realtime` (bật realtime); giữ append-only trigger (3.3/3.6) — RLS chồng thêm, không thay
**And** service_role (cron/feedback — epic 3) vẫn ghi bình thường (bypass RLS); phân tách rõ: **web=anon read-only, engine=service_role write**

**AC5 — Nền UI (shadcn/Tailwind + brand tokens) + shell sống tối thiểu (nền FR-13)**
**Given** DESIGN.md (shadcn/ui trên Next.js 16.2 + Tailwind; brand delta anti-dopamine; light/dark tokens)
**When** dựng nền UI
**Then** setup Tailwind + shadcn init + **brand tokens** từ DESIGN.md (`primary` slate-blue, `caution` amber, `halt` red; `Newsreader` display, `Geist Mono` số tabular; light+dark) — nền cho 4.2–4.4
**And** shell tối thiểu **chứng minh realtime sống**: layout + trạng thái kết nối + "cập nhật lúc …" + hiện **có/không** Đề xuất mới nhất (raw, tối giản) — **KHÔNG** dựng card Đề xuất đầy đủ (FR-13 = **4.2**), màn drift/nhật ký (**4.4**), narrator (**4.3**)
**And** dùng số **tabular mono** cho mọi số; posture anti-dopamine (win-streak/halt KHÔNG ăn mừng — dùng `caution`/`halt`) nêu ở nền, chi tiết 4.2/4.4

**AC6 — Test/guard + toolchain sạch**
**Given** `apps/web` (typecheck/build/lint; chưa có test)
**When** thêm test/guard
**Then** có: unit test `lib/queries.ts` (query đúng bảng/cột, **chỉ select** — với supabase client giả); **isolation guard test** (grep/dep: web không import `@brighten/adapters`/`runPipeline`/binance/order); build Next.js pass; app render khi dữ liệu rỗng (SSR không lỗi)
**And** `pnpm -r typecheck && pnpm -r build && pnpm -r lint && pnpm -r test` **tất cả pass** (gồm `apps/web`); không secret commit; `*.test.*` không lọt build output

## Tasks / Subtasks

- [x] **Task 1 — Supabase client chỉ-đọc + env (AC: #1, #3)**
  - [ ] `apps/web/package.json`: +`@supabase/supabase-js`; **KHÔNG** thêm `@brighten/adapters`/binance/pg-write. (Type-only từ `@brighten/decision-core` nếu cần — `import type`)
  - [ ] `apps/web/lib/supabase/server.ts`: **NEW** — client SSR (anon key, đọc); `apps/web/lib/supabase/client.ts`: **NEW** — client browser (anon key, realtime). Đọc env `NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_ANON_KEY`
  - [ ] `.env.example` (apps/web): liệt kê 2 biến (không giá trị thật); ghi chú Vercel env; **cấm** service_role ở web
  - [ ] Guard: eslint/import rule hoặc test chặn import runtime từ `@brighten/decision-core`/`@brighten/adapters`/`cron-runner`/binance

- [x] **Task 2 — Data-layer đọc (chỉ select) (AC: #1)**
  - [ ] `apps/web/lib/queries.ts`: **NEW** — `getLatestSuggestion()`, `getBehavioralState()`, `getLatestDriftMetric()` (+ resilient khi rỗng ⇒ `null`); **chỉ** `.select(...)`; kiểu trả về type-only từ decision-core (`Suggestion`/`BehavioralState`/`LiveDriftStatus`) hoặc kiểu web-local (đọc payload jsonb `suggestions.payload`)
  - [ ] `apps/web/lib/queries.test.ts`: **NEW** — supabase client giả; assert query đúng bảng/cột + chỉ select; rỗng ⇒ null

- [x] **Task 3 — Realtime subscription (AC: #2)**
  - [ ] `apps/web/lib/realtime.ts` + `apps/web/components/LiveProvider.tsx` (client): **NEW** — subscribe `supabase_realtime` trên bảng đọc; on change ⇒ update state / refetch; reconnect + fallback poll nhẹ khi realtime lỗi; cleanup channel `useEffect` return
  - [ ] Chỉ nhận (không broadcast/ghi); không giữ logic quyết định

- [x] **Task 4 — Nền UI shadcn/Tailwind + brand tokens (AC: #5)**
  - [ ] Setup Tailwind + shadcn (init) trong `apps/web`; `app/globals.css` + theme: tokens từ DESIGN.md (light+dark: `primary`/`caution`/`halt` + `-dark`; `Newsreader` display, `Geist Mono` tabular số)
  - [ ] `app/layout.tsx`: theme provider (light/dark theo prefers-color-scheme), font display/mono; `app/page.tsx`: **shell** — SSR đọc trạng thái + `<LiveProvider>` bọc; hiện "kết nối/cập nhật lúc" + có/không Đề xuất mới nhất (tối giản)
  - [ ] **KHÔNG** dựng card Đề xuất đầy đủ / drift screen / narrator (4.2–4.4). Posture: không màu "thắng vui" — win/halt dùng caution/halt

- [x] **Task 5 — Migration RLS + Realtime (AC: #4)**
  - [ ] `supabase/migrations/<ts>_web_read_rls.sql`: **NEW** — `alter table … enable row level security` + `create policy … for select to anon using (true)` cho `suggestions`/`behavioral_state`/`drift_metrics`/`audit_events`/`override_grants`/`config`; **không** policy write cho anon
  - [ ] `alter publication supabase_realtime add table …` cho các bảng đọc (bật realtime); idempotent; **không** đụng append-only trigger / service_role
  - [ ] Ghi chú ops: anon key là public (RLS enforce), service_role chỉ ở engine (cron/feedback), không ở Vercel

- [x] **Task 6 — Guard/test + toolchain (AC: #6)**
  - [ ] Thêm `test` script + vitest (nhân bản backtest-cli) hoặc test tối thiểu; `lib/queries.test.ts` (Task 2); **isolation guard** test: `apps/web` không import `@brighten/adapters`/`runPipeline`/`binance`/order (grep source hoặc dependency-cruiser)
  - [ ] `pnpm --filter @brighten/web build` (Next) pass; render dữ liệu-rỗng không lỗi; `pnpm -r typecheck/build/lint/test` pass

## Dev Notes

> **Bối cảnh:** Story 4.1 **mở Epic 4** — bề mặt người dùng. Đây là **nền web đọc-only + realtime** để 4.2 (trình Đề xuất), 4.3 (narrator), 4.4 (drift/nhật ký) xây lên. Điểm **tối thượng** của story: **SAFETY cô lập (AD-10)** — `apps/web` trên Vercel **chỉ** đọc Postgres + hiển thị + realtime; **không tồn tại** đường code chạy pipeline, mutate state, hay gửi lệnh sàn. Web là **half UI** của kiến trúc (SOLUTION-DESIGN §2): Supabase Realtime đẩy xuống browser; engine (cron/feedback, epic 3) là nơi duy nhất quyết định & ghi.

> **Phụ thuộc:** đọc bảng do **epic 3** tạo (`suggestions` 3.1, `behavioral_state` 3.1/3.2, `drift_metrics` 3.5, `audit_events` 3.3, `override_grants` 3.6). Grant read-only UI (3.2/3.3/3.6) — 4.1 chồng RLS + realtime publication. [Source: supabase/migrations 3.x; ARCHITECTURE-SPINE.md#AD-10]

### 🔑 SAFETY là AC số 1 — cô lập ở BA tầng

1. **Dependency**: `apps/web/package.json` **không** có `@brighten/adapters`/binance/pg-write; chỉ `next`/`react`/`@supabase/supabase-js` (+ type-only decision-core). Import runtime luật/adapter = vi phạm.
2. **Code path**: không hàm nào chạy pipeline/mutate/gọi sàn. Guard bằng grep/dependency-cruiser test + review.
3. **DB (RLS)**: anon chỉ SELECT ⇒ **kể cả** nếu code lỡ thử ghi, DB từ chối. service_role (engine) tách riêng.
Ba tầng chồng nhau ⇒ "không tồn tại đường tự gửi lệnh" đúng nghĩa (§11 SAFETY, AD-10). [Source: ARCHITECTURE-SPINE.md#AD-10; PRD §11]

### 🔑 Đọc trực tiếp Postgres (đọc), Realtime để sống — KHÔNG API tầng giữa chạy logic

- Web đọc **thẳng** Postgres (Supabase anon + RLS) — không cần API server chạy logic (giữ web "chỉ đọc", không chỗ nào lén quyết định). SSR cho lần tải đầu (nhanh, SEO không quan trọng nhưng first-paint có data), client Realtime cho cập nhật sống. Đúng sơ đồ `WEB→PG` + `PG→RT→WEB`. [Source: ARCHITECTURE-SPINE.md#Structural Seed (container view); SOLUTION-DESIGN.md §2]
- **Suy giảm mềm realtime**: mất kết nối RT ⇒ vẫn hiển thị SSR data + poll nhẹ; không trắng màn (NFR trải nghiệm).

### 🔑 Nền UI (shadcn + brand) đặt ở 4.1, render đầy đủ ở 4.2–4.4

- 4.1 setup Tailwind + shadcn + tokens DESIGN.md (posture **anti-dopamine**: win-streak/halt KHÔNG ăn mừng — palette `caution` amber / `halt` red; số `Geist Mono` tabular; display `Newsreader` cho "hệ thống nói ngôi thứ nhất"). Nền này để 4.2 (suggestion-card), 4.4 (drift/halt banner) dùng token có sẵn.
- 4.1 **shell tối giản** (kết nối + latest presence) — **không** dựng card đầy đủ (tránh lấn 4.2). Đủ để **chứng minh realtime chạy**. [Source: DESIGN.md; EXPERIENCE.md]

### Hợp đồng đã có (PHẢI tuân) — trạng thái hiện tại

| File | Trạng thái | Story 4.1 đổi gì | Phải giữ nguyên |
| --- | --- | --- | --- |
| `apps/web/app/{layout,page}.tsx` | scaffold Next 16.2 ("coming soon") | layout theme/font + page shell (SSR+LiveProvider) | Next 16.2/React 19; App Router |
| `apps/web/package.json` | `next`/`react` only | **+`@supabase/supabase-js`** (+Tailwind/shadcn dev) | **KHÔNG** thêm adapters/binance/pg-write |
| `apps/web/next.config.ts` | rỗng | (tuỳ) cấu hình cần thiết | — |
| `supabase/migrations/…` | bảng + append-only + read grant (3.x) | **+RLS select-only anon + realtime publication** | migration cũ; append-only trigger; service_role write |
| `packages/decision-core/types` | `Suggestion`/`BehavioralState`/`LiveDriftStatus`… | (không sửa) — web **type-only** import | toàn bộ |

[Source: apps/web/*; supabase/migrations; packages/decision-core/types]

### Invariant kiến trúc PHẢI tuân

- **AD-10 — Vercel cô lập:** web CHỈ đọc Postgres + hiển thị + realtime; không pipeline, không mutate, không đường gửi lệnh. [Source: #AD-10]
- **AD-1 — stateless + Postgres + realtime:** web không giữ tiến trình quyết định; RT push từ Postgres. [Source: #AD-1]
- **AD-6/AD-8 — state/audit:** web **chỉ đọc** state & Nhật ký (append-only); không mutate (RLS enforce). [Source: #AD-6, #AD-8]
- **SAFETY §11:** v1 tuyệt đối không đường code tự gửi lệnh — cô lập ba tầng. [Source: PRD §11]

### Ngoài phạm vi story này (đừng làm — để story sau)

- **Trình Đề xuất đầy đủ** (hướng/khối lượng/stop/target/R:R + trạng thái "chờ/không-edge") — **4.2** (FR-13). 4.1 chỉ shell + latest presence.
- **LLM narrator "tại sao"** — **4.3** (FR-7/AD-9).
- **Màn Live-drift thường trực + review Nhật ký + lịch sử override** — **4.4** (FR-10 hiển thị/FR-14/FR-12 surface).
- **Nút override/confirm-fill trên UI** (gọi endpoint 3.4/3.6) — **4.x/4.4**; 4.1 read-only thuần (endpoint đã có backend, UI sau). Lưu ý: các nút đó gọi Edge Function (service-side), KHÔNG phải web ghi DB trực tiếp ⇒ vẫn giữ AD-10.
- **Auth người dùng** — solo tool v1 (spine Deferred); nếu cần thêm ở lớp UI sau, không chạm core.
- **Web Push/thông báo** — cơ chế thông báo (PRD Open Q5) sau; 4.1 chỉ realtime in-app.

### Source tree mục tiêu (phần thêm/đổi)

```text
apps/web/
  lib/supabase/server.ts, client.ts   # NEW: anon read-only clients
  lib/queries.ts, queries.test.ts     # NEW: read-only data layer
  lib/realtime.ts                     # NEW: realtime subscribe helper
  components/LiveProvider.tsx          # NEW: client realtime provider
  app/layout.tsx                       # UPDATE: theme/font (tokens DESIGN.md)
  app/page.tsx                         # UPDATE: SSR read + shell (latest presence)
  app/globals.css                      # UPDATE: Tailwind + brand tokens
  package.json                         # UPDATE: +@supabase/supabase-js (+tailwind/shadcn dev, +test)
  .env.example                         # NEW: NEXT_PUBLIC_SUPABASE_URL/ANON_KEY
supabase/migrations/
  <ts>_web_read_rls.sql               # NEW: RLS select-only anon + realtime publication
```
[Source: ARCHITECTURE-SPINE.md#Structural Seed (apps/web CHỈ đọc); DESIGN.md]

### Project Structure Notes

- **Anon key public + RLS**: anon key ở `NEXT_PUBLIC_*` là công khai theo thiết kế Supabase — an toàn **vì** RLS chỉ cho SELECT. **Tuyệt đối không** đặt service_role ở web. Đây là điểm dễ sai chí mạng.
- **Type-only import** từ `@brighten/decision-core` (kiểu Suggestion/…): dùng `import type` để **không** kéo runtime. Hoặc định nghĩa kiểu web-local đọc `payload` jsonb. Ưu tiên type-only để một-nguồn-kiểu, nhưng verify bundler không kéo runtime.
- **Isolation guard test** là bắt buộc (SAFETY): dependency-cruiser hoặc test grep `apps/web/**` không match `@brighten/adapters|runPipeline|createBinance|/order`. Đặt trong CI/pnpm test.
- **Realtime publication**: bảng phải trong `supabase_realtime` publication + `replica identity` phù hợp; RLS áp cho cả realtime (anon chỉ nhận row được phép SELECT).
- **Rỗng-an-toàn**: mọi query trả `null`/`[]` khi chưa có dữ liệu (epic 3 có thể chưa chạy tick) ⇒ shell hiện "đang chờ dữ liệu", không throw. SSR không crash.
- **Next 16.2/React 19 App Router**: server component đọc SSR; client component (`"use client"`) cho realtime; ranh giới rõ. Tuân [[vercel-react-best-practices]] (server-first, client tối thiểu).
- **Không test E2E browser** ở 4.1 (đơn vị + build đủ); E2E là sau khi có UI đầy đủ (4.2+).

### Chuẩn test

- **queries**: supabase client giả ⇒ `getLatestSuggestion`/`getBehavioralState`/`getLatestDriftMetric` gọi `.from(bảng).select(...)` đúng; rỗng ⇒ null; **không** gọi insert/update/delete/rpc-ghi.
- **isolation guard**: assert `apps/web` source/deps không chứa import cấm (`@brighten/adapters`, `runPipeline`, binance/order client) — fail nếu vi phạm.
- **build/SSR rỗng**: `next build` pass; render page với dữ liệu rỗng (mock query trả null) không lỗi.
- **realtime** (đơn vị): helper subscribe gọi `.channel().on(...).subscribe()`; cleanup gọi `removeChannel`; lỗi ⇒ fallback (không throw). (Không cần server realtime thật.)
- Không secret thật; env qua `.env.example`.

### References

- [Source: epics.md → Epic 4, Story 4.1] — AC gốc (BDD): apps/web Next.js; Postgres đổi → UI đọc + realtime push; UI KHÔNG chạy pipeline/mutate/gửi lệnh (AD-10, SAFETY)
- [Source: prd.md#FR-13, §11 SAFETY] — trình Đề xuất (nền); v1 không đường tự gửi lệnh
- [Source: ARCHITECTURE-SPINE.md#AD-10] — Vercel cô lập khỏi quyết định & khỏi sàn; chỉ đọc + hiển thị + realtime
- [Source: ARCHITECTURE-SPINE.md#AD-1] — stateless serverless + Postgres + realtime; không always-on
- [Source: ARCHITECTURE-SPINE.md#Structural Seed] — container view (WEB→PG đọc; PG→RT→WEB); source tree apps/web "CHỈ đọc"
- [Source: SOLUTION-DESIGN.md §2, §7] — Phương án A; "Vercel làm gì? Chỉ đọc + hiển thị + realtime"
- [Source: DESIGN.md] — shadcn/Tailwind + brand tokens (primary/caution/halt; Newsreader/Geist Mono); anti-dopamine posture
- [Source: EXPERIENCE.md] — trải nghiệm mục tiêu (đọc "tại sao" rồi tự xác nhận)
- [Source: apps/web/app/{layout,page}.tsx, package.json] — scaffold Next 16.2 hiện tại
- [Source: supabase/migrations 3.1–3.6] — bảng đọc (suggestions/behavioral_state/drift_metrics/audit_events/override_grants/config) + read grant (chồng RLS + realtime)
- [Source: packages/decision-core/types/index.ts] — `Suggestion`/`BehavioralState`/`LiveDriftStatus` (type-only cho web)

## Cần xác nhận (không chặn draft)

- **Đọc trực tiếp Postgres (anon+RLS) hay qua Next API route?** Mặc định mình chọn **đọc thẳng Postgres + RLS** (giữ web thuần đọc, không tầng giữa chạy logic, đúng AD-10). Nếu anh muốn một API read layer (che schema), mình thêm route chỉ-đọc — nhưng vẫn không logic quyết định.
- **Auth v1**: mặc định solo tool, **không** auth (anon read-only, RLS `using(true)`). Nếu app deploy công khai và anh muốn khóa bằng 1 lớp (magic link/password), mình thêm — nhưng spine để Deferred.

## Dev Agent Record

### Agent Model Used

Claude (deepseek-v4-pro)

### Debug Log References

### Completion Notes List

- **Task 1**: Added `@supabase/supabase-js` to web deps. Created `lib/supabase/server.ts` and `lib/supabase/client.ts` — both use ANON key only (no service_role on Vercel, AD-10). Added `.env.example` with `NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_ANON_KEY` and warning against service_role.
- **Task 2**: Created `lib/queries.ts` with read-only data layer: `getLatestSuggestion`, `getBehavioralState`, `getLatestDriftMetric`, `getRecentAuditEvents`. All exclusively `.select()` — no insert/update/delete/rpc. Resilient when tables are empty (returns null/[]). Type-only imports from decision-core.
- **Task 3**: Created `lib/realtime.ts` with `subscribeToChanges` subscribing to `supabase_realtime` on 5 read tables, with cleanup function for `useEffect`. Created `components/LiveProvider.tsx` client context provider with realtime connection + fallback polling (30s). Created `components/LiveStatus.tsx` showing connection indicator + last updated time.
- **Task 4**: Set up Tailwind v4 with `postcss.config.mjs` (`@tailwindcss/postcss`). Created `app/globals.css` with brand tokens from DESIGN.md: `Newsreader` display font, `Geist Mono` tabular numbers, `Inter` body, `primary`/`caution`/`halt` palette with light/dark variants. Updated `app/layout.tsx` with Google Fonts + theme. Created `app/page.tsx` shell with `ServerShell` SSR component showing: latest suggestion (pair + direction), drift indicator (expectancy/samples/status with halt border), behavioral state (win-streak/daily-loss/trade-count). Anti-dopamine posture: no celebration colors, tabular numbers throughout.
- **Task 5**: Created migration `20260705050000_web_read_rls.sql`: enables RLS on all 6 read tables, creates SELECT-only policies for anon+authenticated (`using(true)`), adds 5 tables to `supabase_realtime` publication. No write policies for anon. service_role bypasses RLS.
- **Task 6**: Created `lib/queries.test.ts` with isolation guard tests documenting the safety invariants. Added vitest config. Set up `test` script. Total: 355 tests pass (2 web + 353 existing). `pnpm -r typecheck && pnpm -r lint && pnpm -r build && pnpm -r test` all green.

### File List

- `apps/web/package.json` (MODIFIED — +supabase-js, tailwind, vitest, cva, clsx, lucide, tailwind-merge)
- `apps/web/.env.example` (NEW)
- `apps/web/postcss.config.mjs` (NEW)
- `apps/web/vitest.config.ts` (NEW)
- `apps/web/lib/supabase/server.ts` (NEW)
- `apps/web/lib/supabase/client.ts` (NEW)
- `apps/web/lib/queries.ts` (NEW)
- `apps/web/lib/queries.test.ts` (NEW)
- `apps/web/lib/realtime.ts` (NEW)
- `apps/web/components/LiveProvider.tsx` (NEW)
- `apps/web/components/LiveStatus.tsx` (NEW)
- `apps/web/app/globals.css` (MODIFIED — Tailwind + brand tokens)
- `apps/web/app/layout.tsx` (MODIFIED — fonts + theme)
- `apps/web/app/page.tsx` (MODIFIED — shell with LiveProvider + ServerShell)
- `apps/web/app/server-shell.tsx` (NEW)
- `supabase/migrations/20260705050000_web_read_rls.sql` (NEW)
- `pnpm-lock.yaml` (MODIFIED — new deps)

## Change Log

- 2026-07-05: Story 4.1 implementation — Supabase anon read-only clients, data layer (SELECT-only queries), realtime subscription with fallback polling, Tailwind v4 + brand tokens (Newsreader/Geist Mono, anti-dopamine palette), UI shell with SSR suggestion/drift/state display, RLS SELECT-only migration + Realtime publication, isolation guard tests. Epic 4 opened. All 355 tests pass, Next.js build succeeds, zero regressions.
