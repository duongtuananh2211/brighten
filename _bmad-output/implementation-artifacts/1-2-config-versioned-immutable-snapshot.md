---
baseline_commit: 9a0398971e5397685afda0c233c3152f6402bc20
---

# Story 1.2: Config có phiên bản + snapshot bất biến

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **người dùng (solo trader) của Brighten**,
I want **mọi tham số điều chỉnh-được nằm trong một config có version và snapshot được thành object bất biến**,
so that **mỗi Đề xuất/BacktestRun tái lập chính xác kể cả sau khi tôi tinh chỉnh tham số — vì nó nhúng kèm đúng snapshot config đã dùng (AD-4)**.

## Acceptance Criteria

**AC1 — Config nhận version khi lưu, đọc lại theo version cho đúng giá trị**
**Given** một bộ tham số đầy đủ (`cooldown_after_loss`, `win_streak_threshold`, `size_dampening`, `daily_loss_limit`, `max_trades_per_day`, `min_rr`, `risk_pct`, `cost_hurdle_x`, `news_blackout`, `trading_day_boundary`)
**When** lưu config qua store
**Then** config nhận một `version` định danh (số nguyên đơn điệu tăng, bắt đầu từ 1)
**And** đọc lại theo `version` đó trả về **đúng** các giá trị đã lưu, không sai lệch (AD-4)

**AC2 — Snapshot bất biến, tự-chứa, nhúng được vào Đề xuất/BacktestRun**
**Given** một config version đã lưu
**When** gọi `snapshot(version)`
**Then** trả về một object **bất biến sâu** (deep-frozen): mọi mưu toan mutate (kể cả nested/array) bị chặn — `Object.isFrozen` = true ở mọi cấp
**And** snapshot **tự-chứa** — nhúng cả `version` lẫn toàn bộ giá trị tham số, đủ để tái lập một Đề xuất/BacktestRun mà không cần đọc lại store
**And** kiểu của snapshot export được từ `@brighten/config` để `decision-core` `import type` về sau (không kéo theo bất kỳ IO nào)

**AC3 — Đổi tham số tạo version mới, không ghi đè version cũ (append-only)**
**Given** đã có config version N
**When** lưu một bộ tham số đã đổi
**Then** một version N+1 mới được tạo
**And** version N cũ vẫn đọc lại được **nguyên vẹn** giá trị gốc (không bị ghi đè, không bị mutate)
**And** `getLatest()` trả về version mới nhất

**AC4 — Validation từ chối tham số không hợp lệ**
**Given** một bộ tham số vi phạm ràng buộc (ví dụ: `daily_loss_limit` là chuỗi decimal không hợp lệ/không parse được, `risk_pct` ≤ 0, `min_rr` ≤ 0, số nguyên âm ở `win_streak_threshold`/`max_trades_per_day`, `trading_day_boundary` sai định dạng)
**When** lưu config
**Then** save **fail** với lỗi theo shape thống nhất `{ code, source, context }` — **không** tạo version mới, store không đổi
**And** tham số tiền/tỷ lệ dùng **decimal/string**, KHÔNG dùng JS `number` cho `daily_loss_limit`/`size_dampening`/`min_rr`/`risk_pct`/`cost_hurdle_x` (conventions)

## Tasks / Subtasks

- [x] **Task 1 — Thiết lập test runner cho toàn repo (nền cho mọi story sau)**
  - [x] Thêm **Vitest** làm test runner ở root (`devDependencies`), Node 22 + ESM (repo là `"type": "module"`). Xem Dev Notes → Quyết định tooling (cần xác nhận nếu muốn `node:test` thay thế)
  - [x] Root `package.json`: thêm script `"test": "pnpm -r test"`
  - [x] `packages/config/package.json`: thêm script `"test": "vitest run"` (và tùy chọn `"test:watch": "vitest"`)
  - [x] Cấu hình vitest tối thiểu cho package (`vitest.config.ts` hoặc root config) — không cần coverage tool ở story này
  - [x] Đảm bảo `pnpm -r typecheck && pnpm -r build && pnpm -r lint && pnpm -r test` chạy sạch
- [x] **Task 2 — Schema tham số + validation (AC: #1, #4)**
  - [x] `packages/config/src/schema.ts`: định nghĩa kiểu `ConfigParams` với **đúng 10 tham số** ở AC1. Phân loại kiểu (xem Dev Notes → Bảng tham số): decimal-as-string cho tiền/tỷ lệ, `number` nguyên cho count, ms-epoch/int cho duration, chuỗi/offset cho `trading_day_boundary`
  - [x] Hàm `validateParams(input): Result` — từ chối decimal string không parse được, số ≤ 0 nơi bắt buộc dương, số nguyên âm, định dạng `trading_day_boundary` sai. Trả lỗi shape `{ code, source, context }` (đừng throw string trần)
  - [x] Export `DEFAULT_PARAMS` **[ASSUMPTION]** — giá trị mặc định hợp lệ để test & bootstrap (ngưỡng số cụ thể là *deferred*, chốt qua backtest — chỉ cần hợp-lệ, không cần "đúng thị trường")
  - [x] Module này **thuần**, không import IO — để `decision-core` type-only import an toàn
- [x] **Task 3 — Versioning + snapshot bất biến (AC: #1, #2, #3)**
  - [x] `packages/config/src/version.ts`: kiểu `ConfigVersion` = `{ version: number; params: ConfigParams; createdAt: number /* epoch-ms */ }`. Logic gán version đơn điệu là **thuần** (nhận version trước + thời gian làm input, KHÔNG tự gọi `Date.now()`)
  - [x] `packages/config/src/snapshot.ts`: `snapshot(cv: ConfigVersion): ConfigSnapshot` — deep-freeze (đệ quy qua object/array) + trả kiểu `readonly`. Viết helper `deepFreeze`. Snapshot tự-chứa `version` + toàn bộ params. Module **thuần**, không IO
  - [x] Export kiểu `ConfigSnapshot` từ barrel để core dùng sau
- [x] **Task 4 — Store (port + in-memory impl) (AC: #1, #3, #4)**
  - [x] `packages/config/src/store.ts`: interface `ConfigStore` = `{ save(params): ConfigVersion; getByVersion(v): ConfigVersion | undefined; getLatest(): ConfigVersion | undefined }`
  - [x] `InMemoryConfigStore`: append-only (Map theo version), version đơn điệu bắt đầu 1. `save` **validate trước**, fail → không đổi state. Tiêm thời gian qua tham số/`now: () => number` (mặc định inject-able) để test tất định — đừng gọi `Date.now()` trực tiếp trong đường logic thuần
  - [x] Lưu trữ **bất biến giữa các version**: save mới KHÔNG mutate version cũ (freeze hoặc clone khi lưu)
  - [x] **KHÔNG** implement persistence Postgres ở story này (xem Dev Notes → Ngoài phạm vi). Chỉ định nghĩa interface + in-memory impl
- [x] **Task 5 — Public API + dọn scaffold cũ (AC: tất cả)**
  - [x] `packages/config/src/index.ts`: **thay thế** placeholder `ConfigSchemaScaffold` bằng barrel export thật: `ConfigParams`, `ConfigVersion`, `ConfigSnapshot`, `ConfigStore`, `InMemoryConfigStore`, `snapshot`, `validateParams`, `DEFAULT_PARAMS`
  - [x] Đảm bảo không còn tham chiếu tới `ConfigSchemaScaffold` (nó chỉ là stub từ Story 1.1)
- [x] **Task 6 — Tests phủ từng AC (AC: #1, #2, #3, #4)**
  - [x] `packages/config/src/*.test.ts` (đặt cạnh source hoặc `__tests__/`): mỗi AC ≥ 1 test
    - AC1: save → version=1; getByVersion(1) trả đúng giá trị đã lưu
    - AC2: snapshot deep-frozen (`Object.isFrozen` ở root + nested + phần tử array); mutate ném lỗi ở strict mode; snapshot chứa `version`
    - AC3: save lần 2 (đổi tham số) → version=2; getByVersion(1) vẫn nguyên vẹn; getLatest()=version 2
    - AC4: mỗi loại input xấu → save fail với lỗi `{code,source,context}`, store không tăng version
  - [x] Chạy `pnpm -r test` pass

## Dev Notes

> **Bối cảnh story:** Đây là story **đầu tiên có logic nghiệp vụ thật** (Story 1.1 chỉ scaffold). `packages/config` hiện chỉ có một stub `ConfigSchemaScaffold` (`packages/config/src/index.ts`). Story này lấp đầy nó bằng domain versioned-config + snapshot bất biến. **Không có file UPDATE nào ngoài `packages/config/**` + hai `package.json` (root + config).** Tất cả file logic là NEW.

### File UPDATE cần đọc trước khi sửa

| File | Trạng thái hiện tại | Story này đổi gì | Phải giữ nguyên |
| --- | --- | --- | --- |
| `packages/config/src/index.ts` | Chỉ có `export interface ConfigSchemaScaffold { readonly schemaVersion: "0.0.0" }` | Thay bằng barrel export API thật | Giữ package build/typecheck/lint pass; `"type":"module"` ESM |
| `packages/config/package.json` | Có `build/typecheck/lint`, không có `test` | Thêm script `test` | Giữ `name: @brighten/config`, exports map, `composite` build qua `tsc -b` |
| `package.json` (root) | Có `build/typecheck/lint`, không có `test` | Thêm `test` script + Vitest devDep | Giữ pnpm workspace, engines Node `>=22 <23`, ESM |
| `packages/config/tsconfig.json` | `extends` base, `rootDir: src`, `composite: true`, `include: src/**/*.ts` | Có thể cần `exclude` file `*.test.ts` khỏi build phát hành (test không nên vào `dist`) | Giữ strict base + project references |

### Invariant kiến trúc story này PHẢI hiện thực (AD-4)

**AD-4 — Config được snapshot cùng mỗi quyết định:** Mọi tham số điều chỉnh-được là **config có phiên bản**; mỗi Đề xuất và mỗi `BacktestRun` **lưu kèm snapshot config** đã dùng. Story này là *nền tảng* cho invariant đó — nó chưa gắn snapshot vào Suggestion/BacktestRun (các entity đó ra đời ở story sau), nhưng phải cung cấp: versioning append-only + `snapshot()` bất biến tự-chứa để story sau chỉ việc nhúng. [Source: ARCHITECTURE-SPINE.md#AD-4, #Consistency Conventions → Config]

### Bảng tham số (10 tham số bắt buộc — nguồn: epic AC + AD-4 + conventions)

| Tham số | Kiểu lưu | Ràng buộc validate | Ghi chú |
| --- | --- | --- | --- |
| `cooldown_after_loss` | int (ms) hoặc duration | ≥ 0 | Khoảng khóa sau lệnh lỗ (Tầng 0) |
| `win_streak_threshold` | int | ≥ 1 | Ngưỡng chuỗi thắng bật dampening |
| `size_dampening` | **decimal-string** | parse được, > 0, thường ≤ 1 | Hệ số nhân size khi win-streak |
| `daily_loss_limit` | **decimal-string** | parse được, > 0 | Tiền — KHÔNG dùng JS number |
| `max_trades_per_day` | int | ≥ 1 | Trần lệnh/ngày (Tầng 0) |
| `min_rr` | **decimal-string** | parse được, > 0 | R:R tối thiểu (Tầng 3) |
| `risk_pct` | **decimal-string** | parse được, > 0, < 100 | % rủi ro mỗi lệnh |
| `cost_hurdle_x` | **decimal-string** | parse được, > 0 | Bội số phí round-trip (Tầng 3, FR-11) |
| `news_blackout` | struct/array | mỗi cửa sổ hợp lệ | Cửa sổ chặn quanh tin FX |
| `trading_day_boundary` | offset/string (mặc định `"UTC 00:00"`) | định dạng hợp lệ | **Một** mốc ngày duy nhất cho daily-loss/max-trades/reset chuỗi — không tầng nào tự chọn |

[Source: epics.md → Story 1.2 AC; ARCHITECTURE-SPINE.md#Consistency Conventions → Ranh giới "ngày", Tiền tệ/số lượng]

> **Deferred (đừng cố "đúng thị trường"):** ngưỡng số cụ thể của các tham số này được chốt **qua backtest**, không phải quyết định kiến trúc/story này. Chỉ cần `DEFAULT_PARAMS` hợp-lệ để test & bootstrap. [Source: ARCHITECTURE-SPINE.md#Deferred]

### Convention bắt buộc (từ Story 1.1 đã đặt nền)

- **Tiền/tỷ lệ = decimal/string, KHÔNG JS `number`.** Story này chỉ *lưu & validate* decimal-string (parse-check), **chưa** làm số học tiền — nên **chưa cần** kéo decimal lib. Việc chọn thư viện decimal cho số học để dành Story 1.4 (Tầng 3 sizing). Đừng thêm helper number cho tiền. [Source: ARCHITECTURE-SPINE.md#Consistency Conventions → Tiền tệ]
- **Thời gian = UTC epoch-millis khi lưu.** `createdAt` của version là epoch-ms. Trong đường logic thuần đừng gọi `Date.now()`; **tiêm** thời gian (tham số hoặc `now: () => number`) để test tất định. `packages/config` KHÔNG bị lint tất định chặn (chỉ `decision-core` bị — AD-2), nhưng vẫn giữ kỷ luật này cho reproducibility. [Source: ARCHITECTURE-SPINE.md#Consistency Conventions → Thời gian, Determinism]
- **Lỗi shape thống nhất `{ code, source, context }`** — validation fail trả đúng shape này, không throw string/Error trần. [Source: ARCHITECTURE-SPINE.md#Consistency Conventions → Lỗi & log]
- **Config dùng `version`** (không phải UUID v7). UUID v7 dành cho `Suggestion`/`AuditEvent`/`BacktestRun`, KHÔNG cho config. [Source: ARCHITECTURE-SPINE.md#Consistency Conventions → ID, Config]

### Ranh giới hexagonal — nơi config đứng

`packages/config` là package riêng (không thuộc `decision-core`, không thuộc `adapters`). Nó sở hữu **schema + versioning tham số**. `decision-core` về sau nhận config snapshot như một phần input `(input, state, config)` — nên **kiểu `ConfigSnapshot` phải import-được vào core bằng `import type`** mà không kéo IO. ⇒ Giữ `schema.ts`/`version.ts`/`snapshot.ts` **thuần, không import IO**; chỉ `store.ts` (in-memory) mới có trạng thái. [Source: ARCHITECTURE-SPINE.md#Design Paradigm — bảng layer→namespace; AD-2]

### Ngoài phạm vi story này (đừng làm — để story sau)

- **Persistence Postgres cho `config`** (bảng `config` + adapter). Bảng nghiệp vụ được Story 1.1 cố ý hoãn; `persistence` port ra đời ở **Story 1.3** (khung ports). Story 1.2 chỉ định nghĩa interface `ConfigStore` + in-memory impl. Postgres-backed store là story sau khi persistence adapter tồn tại.
- **Gắn snapshot vào `Suggestion`/`BacktestRun`** — các entity đó chưa tồn tại (Story 1.3+/1.8). Chỉ cung cấp `snapshot()` để chúng dùng.
- **Số học tiền/decimal** (sizing) — Story 1.4.

### Source tree mục tiêu (phần thêm/đổi)

```text
brighten/
  package.json                      # UPDATE: + devDep vitest, + script "test"
  packages/config/
    package.json                    # UPDATE: + script "test"
    tsconfig.json                   # UPDATE (nếu cần): exclude *.test.ts khỏi build dist
    vitest.config.ts                # NEW (hoặc dùng root config)
    src/
      index.ts                      # UPDATE: barrel export thật (bỏ ConfigSchemaScaffold)
      schema.ts                     # NEW: ConfigParams, validateParams, DEFAULT_PARAMS
      version.ts                    # NEW: ConfigVersion + logic gán version (thuần)
      snapshot.ts                   # NEW: snapshot() + deepFreeze (thuần)
      store.ts                      # NEW: ConfigStore interface + InMemoryConfigStore
      schema.test.ts                # NEW
      snapshot.test.ts              # NEW
      store.test.ts                 # NEW
```

[Source: ARCHITECTURE-SPINE.md#Structural Seed → Source tree; Story 1.1 File List]

### Quyết định tooling cần xác nhận (mặc định đã chọn để không chặn dev)

1. **Test runner = Vitest** (mặc định khuyến nghị). Lý do: chuẩn de-facto cho monorepo TS/ESM, cấu hình gọn, chạy Node 22. Thay thế khả dĩ: `node:test` built-in (không thêm dep) — chọn nếu muốn tối giản dependency tuyệt đối. **Đây là quyết định khóa cho MỌI story sau** → nếu muốn `node:test`, báo trước khi dev.
2. **Validation** = TS thuần + hàm `validateParams` viết tay (mặc định, 0 runtime dep). Thay thế: Zod (runtime validation + infer type, nhưng thêm dep vào config package). Vì tập tham số nhỏ & cố định, hand-rolled là đủ và giữ dep-graph sạch.

### Chuẩn test

- Framework: Vitest (Task 1). Mỗi AC có ≥ 1 test tương ứng (map ở Task 6).
- Test **tất định**: tiêm thời gian vào store (`now` cố định) — không phụ thuộc đồng hồ thật.
- Kiểm bất biến snapshot bằng `Object.isFrozen` ở nhiều cấp + assert mutate ném lỗi (chạy ở ESM strict mode nên gán vào frozen object throw `TypeError`).
- Không cần integration/DB test (không có Postgres ở story này).

### Project Structure Notes

- Cấu trúc khớp `ARCHITECTURE-SPINE.md#Structural Seed` — `packages/config` = "schema + versioning tham số điều chỉnh-được". Không phát sinh biến thể.
- Xung đột đã biết: `packages/config/src/index.ts` hiện export `ConfigSchemaScaffold` (stub Story 1.1) — phải thay, không giữ song song.
- `*.test.ts` không được lọt vào `dist` phát hành: kiểm `tsconfig.json` `include/exclude` cho phù hợp (build package qua `tsc -b`; test chạy qua vitest độc lập).

### References

- [Source: epics.md → Epic 1, Story 1.2] — user story + AC gốc (BDD): version, snapshot bất biến, đổi tham số → version mới
- [Source: ARCHITECTURE-SPINE.md#AD-4] — config có phiên bản + snapshot nhúng vào mỗi Đề xuất/BacktestRun
- [Source: ARCHITECTURE-SPINE.md#Consistency Conventions] — Tiền tệ (decimal/string), Thời gian (UTC epoch-ms), ID (version cho config, UUID v7 cho entity khác), Lỗi `{code,source,context}`, Ranh giới trading-day, Determinism
- [Source: ARCHITECTURE-SPINE.md#Design Paradigm] — vị trí `packages/config` trong hexagonal; core `import type` snapshot
- [Source: ARCHITECTURE-SPINE.md#Deferred] — ngưỡng số cụ thể chốt qua backtest, không phải story này
- [Source: SOLUTION-DESIGN.md §—] — Config có phiên bản + snapshot (AD-4) là cơ chế tái lập
- [Source: Story 1.1 File List + Dev Notes] — scaffold `packages/config`, conventions đã đặt nền, chưa có test framework, `ConfigSchemaScaffold` là stub

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- 2026-07-04: `pnpm --filter @brighten/config test` red phase failed as expected because public API was still scaffold-only.
- 2026-07-04: `pnpm install --config.confirmModulesPurge=false` required network approval to install Vitest and refresh pnpm lock/install state.
- 2026-07-04: `pnpm --filter @brighten/config test` passed after config schema/version/snapshot/store implementation.
- 2026-07-04: `pnpm -r typecheck`, `pnpm -r build`, `pnpm -r lint`, `pnpm -r test` all passed.

### Completion Notes List

- Added Vitest as the repo test runner and package-level config tests for `@brighten/config`.
- Replaced `ConfigSchemaScaffold` with the real public config API: `ConfigParams`, `ConfigVersion`, `ConfigSnapshot`, `ConfigStore`, `InMemoryConfigStore`, `snapshot`, `validateParams`, and `DEFAULT_PARAMS`.
- Implemented hand-rolled pure validation for the 10 required params, preserving decimal-as-string conventions and returning `{ code, source, context }` validation errors.
- Implemented append-only in-memory versioning with injectable time and frozen stored versions.
- Implemented self-contained deep-frozen snapshots with exported readonly snapshot types for future type-only core imports.
- Split config package tsconfig so tests are visible to ESLint while build output excludes `*.test.ts`.

### File List

- `_bmad-output/implementation-artifacts/1-2-config-versioned-immutable-snapshot.md`
- `package.json`
- `pnpm-lock.yaml`
- `packages/config/package.json`
- `packages/config/tsconfig.json`
- `packages/config/tsconfig.build.json`
- `packages/config/vitest.config.ts`
- `packages/config/src/index.ts`
- `packages/config/src/schema.ts`
- `packages/config/src/version.ts`
- `packages/config/src/snapshot.ts`
- `packages/config/src/store.ts`
- `packages/config/src/schema.test.ts`
- `packages/config/src/snapshot.test.ts`
- `packages/config/src/store.test.ts`

### Change Log

- 2026-07-04: Implemented versioned immutable config snapshot story and moved status to review.
