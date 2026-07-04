---
baseline_commit: 7163623e062941bff2c3d1fff599debb61298ec8
---

# Story 1.1: Scaffold monorepo & stack $0

Status: in-progress

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **người xây kiêm người dùng (solo)**,
I want **một monorepo TypeScript với đủ package/app rỗng và ràng buộc lint tất định ngay từ đầu**,
so that **mọi story sau có chỗ đứng đúng theo ranh giới hexagonal, và `decision-core` không thể lẫn IO/thời gian/random ngay từ ngày đầu**.

## Acceptance Criteria

**AC1 — Workspace dựng được, build & typecheck pass**
**Given** repo trống
**When** dựng workspace pnpm với các package/app: `packages/decision-core`, `packages/adapters`, `packages/config`, `apps/web`, `apps/cron-runner`, `apps/backtest-cli`, `supabase/migrations`
**Then** toàn repo `build` & `typecheck` pass ở **TypeScript strict** (không error)

**AC2 — Lint tất định bật cho `decision-core` (AD-2)**
**Given** package `packages/decision-core`
**When** chạy lint
**Then** lint **chặn** (báo error, không chỉ warn): `Date.now()`, `Math.random()`, và mọi **import IO** (network/disk/clock/random) trong `packages/decision-core`
**And** một file thử vi phạm (dùng `Date.now()` hoặc `import 'fs'`) khiến lint **fail** — chứng minh rule đang hoạt động thật, không phải cấu hình chết

**AC3 — Supabase khởi tạo được, migration rỗng chạy được**
**Given** thư mục `supabase/`
**When** khởi tạo dự án Supabase local (`supabase init` + `supabase start`) và áp một **migration rỗng** (hoặc migration seed tối thiểu, không có bảng nghiệp vụ)
**Then** migration chạy thành công trên Postgres local, không lỗi

**AC4 — `apps/web` deploy được lên Vercel free (trang trống)**
**Given** `apps/web` là app Next.js 16.2.x
**When** build production (`next build`) và deploy lên Vercel free
**Then** một **trang trống/placeholder** hiển thị được (không lỗi build/deploy)
**And** `apps/web` **không** chứa đường code chạy pipeline hay gửi lệnh tới sàn (AD-10 — ở story này chỉ là trang trống, chỉ cần không mở cửa cho các đường đó)

## Tasks / Subtasks

- [x] **Task 1 — Khởi tạo monorepo pnpm + TS strict base (AC: #1)**
  - [x] Cài `pnpm` (Node 22 LTS làm runtime dev). Tạo `package.json` gốc với `"packageManager": "pnpm@..."`, `"private": true`
  - [x] Tạo `pnpm-workspace.yaml` khai báo `packages/*` và `apps/*`
  - [x] Tạo `tsconfig.base.json` gốc bật strict tối đa: `"strict": true`, `"noUncheckedIndexedAccess": true`, `"exactOptionalPropertyTypes": true`, `"noImplicitOverride": true`, `"moduleResolution": "Bundler"` (hoặc `"NodeNext"` — xem Dev Notes), target `ES2022`
  - [x] Mỗi package/app có `tsconfig.json` riêng `extends` base; cân nhắc TS **project references** để `typecheck` toàn repo một lệnh
  - [x] Script gốc: `pnpm -r build`, `pnpm -r typecheck`, `pnpm -r lint`
- [x] **Task 2 — Scaffold 3 package lõi (AC: #1)**
  - [x] `packages/decision-core/`: tạo cây thư mục rỗng theo spine — `tiers/` (tier0..tier3), `ports/`, `types/`. Mỗi thư mục có một `index.ts` export placeholder (ví dụ `export {}` hoặc type stub) để build pass. **KHÔNG** thêm dependency runtime nào (không `dependencies` trỏ tới adapters/IO)
  - [x] `packages/adapters/`: thư mục rỗng cho `binance-rest`, `fx-calendar`, `postgres`, `llm-narrator`, `clock` (mỗi cái một `index.ts` placeholder). Adapters **được phép** phụ thuộc `ports` (từ decision-core) nhưng không phụ thuộc logic core
  - [x] `packages/config/`: placeholder cho schema + versioning tham số (chỉ scaffold, logic ở Story 1.2)
- [x] **Task 3 — Cấu hình ESLint flat config + rule tất định (AC: #2)**
  - [x] Dựng ESLint (flat config `eslint.config.js`) cho toàn repo với `typescript-eslint`
  - [x] Thêm **override riêng cho `packages/decision-core/**`**: bật `no-restricted-globals` (chặn `Date`, ...) + `no-restricted-syntax` chặn `Date.now()` / `Math.random()` (selector `CallExpression`), + `no-restricted-imports` chặn IO modules (`fs`, `node:fs`, `net`, `http`, `https`, `crypto`, `child_process`, `path` nếu muốn nghiêm, `@supabase/*`, và mọi `packages/adapters`)
  - [x] Viết một **fixture test vi phạm** (file `.eslint-fixtures/` hoặc test tạm) để chứng minh lint fail đúng như AC2 yêu cầu — rồi xóa/để dưới thư mục không build
- [x] **Task 4 — Scaffold 3 app driver/UI rỗng (AC: #1, #4)**
  - [x] `apps/web/`: `create-next-app` Next.js **16.2.x LTS**, App Router, TS strict, một trang `/` placeholder ("Brighten — coming soon"). Không thêm data-fetch/mutation nào
  - [x] `apps/backtest-cli/`: Node 22 CLI rỗng — một `main()` in "backtest-cli scaffold ok" và thoát 0. Import được `decision-core` (kiểm chứng ranh giới package hoạt động)
  - [x] `apps/cron-runner/`: scaffold Supabase Edge Function (Deno). Một function rỗng trả 200. Lưu ý **runtime Deno** khác Node — xem Dev Notes về việc chia sẻ `decision-core` (TS thuần, portable)
- [ ] **Task 5 — Supabase init + migration rỗng (AC: #3)**
  - [x] `supabase init` tạo `supabase/config.toml` + thư mục `migrations/`
  - [x] Tạo một migration rỗng (ví dụ `supabase migration new init`) — không bảng nghiệp vụ (behavioral_state, suggestion, audit... để dành các story sau)
  - [ ] Xác minh `supabase start` + `supabase db reset` (hoặc migration up) chạy sạch trên Postgres 15+ local
- [ ] **Task 6 — Xác minh CI-lite cục bộ + deploy web (AC: #1, #2, #4)**
  - [x] Chạy `pnpm -r typecheck && pnpm -r build && pnpm -r lint` — tất cả pass (trừ fixture vi phạm cố ý ở Task 3, đặt ngoài phạm vi build/lint chính)
  - [ ] Deploy `apps/web` lên Vercel free, xác nhận trang placeholder mở được; cấu hình **Root Directory = `apps/web`** trên Vercel (monorepo)
  - [ ] (Tùy chọn) thêm `.github/workflows/ci.yml` chạy typecheck+build+lint để khóa các invariant từ đầu

## Dev Notes

> Đây là story **greenfield** đầu tiên — không có story trước, không có `sprint-status.yaml`, repo hầu như trống (chỉ có `_bmad-output/` planning docs + git init). Mọi file mã nguồn là NEW; **không có file UPDATE** cần đọc trước.

### Bối cảnh kiến trúc — ranh giới story này PHẢI đặt nền đúng

Story này không viết logic nghiệp vụ nào; giá trị của nó là **đóng khung các invariant kiến trúc bằng cấu hình thật** để các story sau không thể vi phạm. Ba invariant quan trọng nhất phải thể hiện được ngay ở scaffold:

- **AD-2 — Lõi thuần, tất định:** `decision-core` **cấm** network/disk/clock/random trực tiếp; thời gian & dữ liệu vào lõi **chỉ** qua port. Lint phải **chặn** `Date.now()`/`Math.random()`/import IO. Đây chính là AC2 — và nó phải *fail thật* khi vi phạm, không chỉ tồn tại trên giấy. [Source: ARCHITECTURE-SPINE.md#AD-2, #Consistency Conventions → Determinism]
- **AD-3 — Một engine, hai driver:** `apps/cron-runner` (Deno) và `apps/backtest-cli` (Node) sẽ **import cùng** `decision-core`. Vì thế `decision-core` phải là **TypeScript thuần, portable cả Deno lẫn Node** — tránh mọi API chỉ-Node ở lõi. Scaffold nên chứng minh cả hai app import được core. [Source: SOLUTION-DESIGN.md §3, ARCHITECTURE-SPINE.md#AD-3]
- **AD-10 — Vercel cô lập:** `apps/web` **chỉ** đọc Postgres + hiển thị + realtime; **không** chạy pipeline, **không** mutate state, **không tồn tại** đường code gửi lệnh tới sàn (SAFETY). Ở story này web chỉ là trang trống — chỉ cần đảm bảo không mở sẵn các đường đó. [Source: ARCHITECTURE-SPINE.md#AD-10]

### Hướng phụ thuộc (ép bằng cấu trúc package)

Mũi tên = "được phép phụ thuộc vào". Vi phạm hướng này là lỗi kiến trúc:

| Layer | Thư mục | Được phép phụ thuộc |
| --- | --- | --- |
| Core (thuần) | `packages/decision-core/` (gồm `ports/`) | *không gì* (chỉ types nội bộ) |
| Adapters | `packages/adapters/` | `ports` (không phụ thuộc core logic) |
| Drivers | `apps/cron-runner/`, `apps/backtest-cli/` | core + adapters |
| UI | `apps/web/` | **chỉ** persistence-read (Postgres) |
| Config | `packages/config/` | (schema/versioning; scaffold ở đây) |

[Source: ARCHITECTURE-SPINE.md#Design Paradigm — bảng layer→namespace, #Invariants (mermaid dependency graph)]

Gợi ý ép ranh giới: (1) `no-restricted-imports` trong ESLint override cho `decision-core` chặn import từ `@brighten/adapters` và mọi IO module; (2) không khai `packages/adapters` vào `dependencies` của `decision-core`.

### Source tree mục tiêu (scaffold — code sở hữu chi tiết bên trong)

```text
brighten/
  package.json                # root, private, pnpm workspace
  pnpm-workspace.yaml
  tsconfig.base.json
  eslint.config.js            # flat config + override decision-core
  packages/
    decision-core/            # lõi THUẦN — tất định, không IO
      tiers/                  # tier0 (hành vi) .. tier3 (risk/sizing) — placeholder
      ports/                  # ingestion · persistence · narrator · clock · ui-read — placeholder
      types/
    adapters/                 # binance-rest · fx-calendar · postgres · llm-narrator · clock — placeholder
    config/                   # schema + versioning tham số (scaffold; logic ở Story 1.2)
  apps/
    web/                      # Next.js 16.2.x (Vercel) — trang trống
    cron-runner/              # Supabase Edge Function (Deno) — function rỗng
    backtest-cli/             # Node 22 CLI — main() rỗng, import được core
  supabase/
    config.toml
    migrations/               # migration rỗng chạy được
```

[Source: ARCHITECTURE-SPINE.md#Structural Seed → Source tree]

### Stack & phiên bản (đã chốt — không tự đổi)

| Thành phần | Phiên bản | Ghi chú |
| --- | --- | --- |
| TypeScript | `^5` | lõi + toàn repo, strict |
| Next.js (`apps/web`, Vercel) | **16.2.x LTS** | App Router |
| Node.js (dev + `backtest-cli`) | **22 LTS** | |
| Deno (`apps/cron-runner`) | theo nền tảng Supabase Edge | runtime khác Node — giữ core portable |
| Supabase | Postgres 15+, pg_cron, pg_net, Realtime, Edge Functions | free tier |
| Package manager | pnpm (workspaces) | |

[Source: ARCHITECTURE-SPINE.md#Stack, epics.md Requirements Inventory §Stack]

### Conventions cần chuẩn bị chỗ (chưa cần implement, nhưng đừng đặt bẫy)

- **Tiền/khối lượng:** KHÔNG dùng JS `number` cho tính tiền — dùng string/decimal. (Chỉ scaffold ở đây; đừng thêm helper number cho tiền.)
- **Thời gian:** UTC epoch-millis khi lưu; trong lõi thời gian là input qua `clock` port (không `Date.now()`).
- **ID:** UUID v7 cho `Suggestion`/`AuditEvent`/`BacktestRun` (dùng ở story sau).
- **Lỗi:** shape thống nhất `{ code, source, context }`.
- **Secrets:** khóa Binance read-only / LLM key / DB URL ở env/secret của từng runtime (Supabase Edge secrets, Vercel env, `.env` cho CLI). **Không commit.** Thêm `.env` vào `.gitignore` ngay.

[Source: ARCHITECTURE-SPINE.md#Consistency Conventions]

### Ghi chú kỹ thuật quan trọng (giảm rủi ro triển khai)

- **ESLint flat config** (`eslint.config.js`) là chuẩn hiện hành với `typescript-eslint`. Rule chặn tất định:
  - `no-restricted-syntax` với selector cho `Date.now()` và `Math.random()` — ví dụ chặn `MemberExpression[object.name='Math'][property.name='random']` và `MemberExpression[object.name='Date'][property.name='now']`, hoặc dùng `no-restricted-globals`/`no-restricted-properties`.
  - `no-restricted-imports` với `patterns` chặn `fs`, `node:*` IO, `crypto`, `net`, `http(s)`, `@supabase/*`, và `@brighten/adapters*`.
  - Chỉ áp override này cho `files: ['packages/decision-core/**/*.ts']` để phần còn lại repo vẫn dùng IO bình thường.
- **Chứng minh rule sống (AC2):** đưa một file vi phạm vào và xác nhận `pnpm lint` trả exit code khác 0. Sau đó chuyển file này ra ngoài phạm vi lint chính (thư mục fixtures được ignore) hoặc xóa — nhưng ghi lại trong Completion Notes rằng đã kiểm chứng lint fail.
- **Deno vs Node:** `apps/cron-runner` chạy Deno; đừng dùng `import`-style chỉ-Node trong `decision-core`. Với scaffold, chỉ cần cron-runner có một function rỗng; việc import core từ Deno có thể để tối giản (một import type) miễn không phá build. Nếu tách được thời gian, kiểm chứng cả Node CLI lẫn Deno function tham chiếu được core sẽ khóa AD-3 sớm.
- **Vercel monorepo:** set **Root Directory = `apps/web`** trong project settings; Vercel tự nhận pnpm workspace. Trang `/` chỉ là component tĩnh, **không** `fetch` tới DB/sàn.
- **Supabase migration rỗng:** dùng `supabase init` rồi `supabase migration new init`. Chưa tạo bảng nghiệp vụ nào (behavioral_state, suggestion, audit_event, config, backtest_run... để các story tương ứng). Chỉ cần migration up chạy sạch.

### Project Structure Notes

- Cấu trúc trên **khớp trực tiếp** với `ARCHITECTURE-SPINE.md#Structural Seed` — không phát sinh biến thể. Nếu buộc phải lệch (ví dụ tên package scope `@brighten/*`), ghi lý do vào Completion Notes.
- Không có xung đột đã biết. `_bmad-output/` (planning docs) nằm cạnh mã nguồn — không đụng tới, không đưa vào workspace.

### References

- [Source: ARCHITECTURE-SPINE.md#Design Paradigm] — bảng layer→namespace, paradigm hexagonal + pipes-and-filters
- [Source: ARCHITECTURE-SPINE.md#AD-2] — lõi thuần tất định, lint chặn `Date.now()`/`Math.random()`
- [Source: ARCHITECTURE-SPINE.md#AD-3] — một engine, hai driver (core portable Deno+Node)
- [Source: ARCHITECTURE-SPINE.md#AD-10] — Vercel cô lập (SAFETY)
- [Source: ARCHITECTURE-SPINE.md#Structural Seed → Source tree] — cây thư mục scaffold
- [Source: ARCHITECTURE-SPINE.md#Stack] — phiên bản pinned
- [Source: ARCHITECTURE-SPINE.md#Consistency Conventions] — tiền/thời gian/ID/lỗi/secrets/determinism
- [Source: SOLUTION-DESIGN.md §3] — vì sao hexagonal + pure core, một ngôn ngữ một engine
- [Source: SOLUTION-DESIGN.md §6] — thứ tự build (Story này = bước 1: khung xương + thước đo)
- [Source: epics.md → Epic 1, Story 1.1] — user story + AC gốc (BDD)

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- `node --version` -> `v22.22.3`
- `pnpm --version` -> `11.8.0`
- `CI=true pnpm install` -> pass sau khi approve build script `sharp`
- `CI=true pnpm -r typecheck && CI=true pnpm -r build && CI=true pnpm -r lint` -> pass
- `CI=true pnpm lint:determinism-fixture` -> fail đúng kỳ vọng với 4 lỗi: import `node:fs`, `Date.now()`, `Math.random()`
- `node apps/backtest-cli/dist/main.js` -> `backtest-cli scaffold ok: decision-core`
- `supabase init` -> project đã initialized, CLI báo `Config already exists at .../supabase/config.toml`
- `supabase start` -> chưa pass vì Docker daemon chưa chạy: `Cannot connect to the Docker daemon at unix:///Users/tuananhduong/.docker/run/docker.sock`
- `which vercel` -> `vercel not found`

### Implementation Plan

- Dựng monorepo pnpm private với Node 22, TypeScript strict base và script root chạy recursive.
- Dùng `tsc -b` cho package/app TypeScript thuần để project references resolve đúng workspace dependency graph.
- Giữ `decision-core` không có runtime dependencies và khóa invariant tất định bằng ESLint override riêng.
- Đặt fixture vi phạm ngoài phạm vi lint/build chính nhưng có script riêng để chứng minh rule lint fail thật.
- Scaffold `apps/web` như Next.js 16.2.0 App Router static placeholder, không có fetch/mutation/pipeline path.
- Scaffold Supabase config + migration rỗng; xác minh runtime local còn phụ thuộc Docker daemon.

### Completion Notes List

- Đã scaffold workspace pnpm với package/app theo story: `decision-core`, `adapters`, `config`, `web`, `cron-runner`, `backtest-cli`, `supabase/migrations`.
- Đã bật TypeScript strict base và project references cho các consumer của `decision-core`.
- Đã cấu hình ESLint flat config với override riêng cho `packages/decision-core/**`, chặn `Date`, `Date.now()`, `Math.random()`, IO imports, `@supabase/*`, và `@brighten/adapters*`.
- Đã chứng minh fixture lint fail thật bằng `CI=true pnpm lint:determinism-fixture`.
- Đã build production `apps/web` thành công với Next.js 16.2.0; trang `/` là placeholder tĩnh, không có code data-fetch/mutation/pipeline.
- Chưa thể hoàn tất AC3 runtime vì Docker daemon chưa chạy; `supabase start` fail trước khi Postgres local khởi động.
- Chưa thể hoàn tất deploy Vercel vì Vercel CLI không có trong môi trường và chưa có auth/project remote.

### File List

- `.eslint-fixtures/decision-core/violation.ts`
- `.gitignore`
- `.npmrc`
- `apps/backtest-cli/package.json`
- `apps/backtest-cli/src/main.ts`
- `apps/backtest-cli/tsconfig.json`
- `apps/cron-runner/functions/health/deno.json`
- `apps/cron-runner/functions/health/index.ts`
- `apps/cron-runner/package.json`
- `apps/cron-runner/tsconfig.json`
- `apps/web/app/globals.css`
- `apps/web/app/layout.tsx`
- `apps/web/app/page.tsx`
- `apps/web/next-env.d.ts`
- `apps/web/next.config.ts`
- `apps/web/package.json`
- `apps/web/tsconfig.json`
- `eslint.config.js`
- `package.json`
- `packages/adapters/binance-rest/index.ts`
- `packages/adapters/clock/index.ts`
- `packages/adapters/fx-calendar/index.ts`
- `packages/adapters/index.ts`
- `packages/adapters/llm-narrator/index.ts`
- `packages/adapters/package.json`
- `packages/adapters/postgres/index.ts`
- `packages/adapters/tsconfig.json`
- `packages/config/package.json`
- `packages/config/src/index.ts`
- `packages/config/tsconfig.json`
- `packages/decision-core/index.ts`
- `packages/decision-core/package.json`
- `packages/decision-core/ports/index.ts`
- `packages/decision-core/tiers/index.ts`
- `packages/decision-core/tiers/tier0/index.ts`
- `packages/decision-core/tiers/tier1/index.ts`
- `packages/decision-core/tiers/tier2/index.ts`
- `packages/decision-core/tiers/tier3/index.ts`
- `packages/decision-core/tsconfig.json`
- `packages/decision-core/types/index.ts`
- `pnpm-lock.yaml`
- `pnpm-workspace.yaml`
- `supabase/config.toml`
- `supabase/migrations/20260704000000_init.sql`
- `tsconfig.base.json`

### Change Log

- 2026-07-04: Scaffolded monorepo, package/app placeholders, deterministic lint guard, Supabase empty migration, and local CI-lite validation.
