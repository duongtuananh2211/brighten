---
baseline_commit: 9a0398971e5397685afda0c233c3152f6402bc20
---

# Story 1.3: Khung decision-core + ports + pipeline runner

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **người xây Brighten**,
I want **lõi thuần `decision-core` với các port được định nghĩa là interface và một pipeline runner chạy chuỗi tầng 0→1→2→3 theo luật pass/veto**,
so that **live (cron) và backtest dùng *chung một engine*, lõi *không chạm IO/đồng hồ/ngẫu nhiên*, và cùng `(input, state, config)` luôn cho cùng output — nền tất định để mọi tầng thật (Story 1.4–1.7) và cả backtest (1.8) cắm vào (AD-2, AD-3, AD-5, NFR-1)**.

## Acceptance Criteria

**AC1 — Năm port được định nghĩa là interface thuần (không impl IO)**
**Given** lõi cần mọi tác động ngoài đi qua port (AD-2)
**When** khai báo các port `ingestion`, `persistence`, `narrator`, `clock`, `ui-read`
**Then** mỗi port là một **interface TypeScript** trong `packages/decision-core/ports/`, export được từ barrel `@brighten/decision-core/ports`
**And** module port **thuần**: KHÔNG import `fs`/`net`/`http`/`crypto`/`@supabase/*`/`@brighten/adapters` (đã bị lint chặn — AD-2), KHÔNG có class/hàm impl gọi mạng-đĩa; chỉ khai báo hình dạng (kiểu vào/ra)
**And** `ClockPort` (đã có từ Story 1.1) được **giữ nguyên hoặc mở rộng tương thích**, không phá vỡ export cũ

**AC2 — Pipeline runner chạy đúng thứ tự & dừng ngay khi một tầng veto (AD-5)**
**Given** một danh sách 4 tier stub theo thứ tự `tier0, tier1, tier2, tier3`
**When** `runPipeline` chạy với một `(input, state, config)` cụ thể
**Then** các tier được gọi **đúng thứ tự 0→1→2→3**
**And** khi một tầng trả **veto**, runner **dừng ngay** — KHÔNG gọi tầng sau — và trả kết quả **im lặng** (không Đề xuất) kèm `vetoedBy` = id tầng chặn + `reason`
**And** khi **mọi** tầng pass, runner trả kết quả "có Đề xuất" (payload Đề xuất là stub ở story này — entity `Suggestion` đầy đủ ra đời story sau)
**And** Tầng 0 giữ **veto tối cao**: veto ở tier0 khiến tier1/2/3 không bao giờ chạy

**AC3 — Lõi lấy thời gian qua `clock` port, KHÔNG gọi `Date.now()`/`Date`/`Math.random()` (AD-2)**
**Given** runner cần một mốc thời gian cho một tick
**When** runner cần thời gian
**Then** nó đọc thời gian **một lần** qua `ClockPort.nowEpochMillis()` rồi tiêm giá trị đã-giải-quyết vào ngữ cảnh tầng (tầng KHÔNG tự gọi clock → giữ tầng thuần & 1 mốc thời gian/tick)
**And** toàn bộ `packages/decision-core/**` **pass** `pnpm -r lint` với rule tất định đang bật (cấm `Date`, `Date.now()`, `Math.random()`, import IO — AD-2)

**AC4 — Tất định: cùng `(input, state, config)` → cùng output (NFR-1)**
**Given** cùng một bộ `(input, state, config)` và cùng chuỗi tier stub
**When** gọi `runPipeline` **nhiều lần**
**Then** output **bằng nhau tuyệt đối** (deep-equal): cùng `outcome`, cùng `vetoedBy`/`reason` — không phụ thuộc đồng hồ thật, không thứ tự ngẫu nhiên
**And** runner là **hàm thuần**: không mutate `input`/`state`/`config` đầu vào (state-mutation, nếu có, trả ra *tường minh* trong kết quả, không sửa tại chỗ)

**AC5 — Test phủ từng AC, chạy sạch trong toolchain hiện có**
**Given** Vitest đã là test runner của repo (Story 1.2 đặt nền)
**When** thêm test cho `decision-core`
**Then** có test cho: thứ tự gọi tầng, dừng-khi-veto (veto ở mỗi tier0..3), clock được gọi đúng 1 lần & không dùng `Date.now()`, tính tất định (chạy 2 lần → bằng nhau)
**And** `pnpm -r typecheck && pnpm -r build && pnpm -r lint && pnpm -r test` **tất cả pass**; file `*.test.ts` **không** lọt vào `dist` phát hành

## Tasks / Subtasks

- [x] **Task 1 — Test runner + build split cho `decision-core` (nền test, AC: #5)**
  - [x] `packages/decision-core/package.json`: thêm script `"test": "vitest run"` (và tùy chọn `"test:watch": "vitest"`). Giữ nguyên `name: @brighten/decision-core`, exports map (`.` + `./ports`), `"type": "module"`
  - [x] `packages/decision-core/vitest.config.ts`: **NEW** — cấu hình tối thiểu (mirror `packages/config/vitest.config.ts`)
  - [x] `packages/decision-core/tsconfig.build.json`: **NEW** — `rootDir: "."`, `exclude` `**/*.test.ts` + `vitest.config.ts` khỏi `dist` (mirror `packages/config/tsconfig.build.json`). Đổi script `build`/`typecheck` của package sang `tsc -b tsconfig.build.json` để test không vào dist nhưng vẫn được lint/typecheck qua `tsconfig.json`
  - [x] `packages/decision-core/tsconfig.json`: giữ `include: ["**/*.ts"]` để ESLint thấy cả test; thêm **project reference** tới config (xem Task 2) nếu dùng `import type` từ `@brighten/config`
  - [x] Xác nhận `pnpm -r typecheck && pnpm -r build && pnpm -r lint && pnpm -r test` chạy sạch **trước khi** viết logic (red baseline)

- [x] **Task 2 — Kiểu miền tối thiểu (forward-declared) + shape lỗi (AC: #1, #2, #4)**
  - [x] `packages/decision-core/types/index.ts`: **thay** stub `DecisionCoreScaffold` bằng các **kiểu placeholder tối thiểu** [ASSUMPTION] mà port/runner cần tham chiếu — entity đầy đủ do story sau sở hữu:
    - `MarketSnapshot` — dữ liệu thô đã chuẩn hóa do **ingestion adapter sở hữu** (đầy đủ ở Story 1.7). Ở đây khai báo **tối thiểu/mở** (ví dụ chỉ `pair`, `timeframe`, `atEpochMillis` + `readonly [k: string]: unknown` chờ enrich). KHÔNG mô hình hóa klines/funding/OI chi tiết ở story này
    - `BehavioralState` — win-streak/daily-loss/cooldown/trade-count (đầy đủ ở Story 1.6). Khai báo tối thiểu, `readonly`
    - `Suggestion` — Đề xuất (đầy đủ ở story sau). Stub tối thiểu cho payload "có Đề xuất"
    - `AuditEvent`, `Narration` — stub tối thiểu để port narrator/persistence tham chiếu
  - [x] Định nghĩa `CoreError = { readonly code: string; readonly source: string; readonly context?: Record<string, unknown> }` và `Result<T> = { ok: true; value: T } | { ok: false; error: CoreError }` — **shape lỗi thống nhất** của repo (đừng throw string trần). KHÔNG runtime-import `@brighten/config` để lấy `Result` (giữ core độc lập runtime); có thể trùng shape là chấp nhận được
  - [x] Đánh dấu rõ mọi kiểu placeholder bằng comment `// [PLACEHOLDER — enriched in Story 1.x]` để dev sau biết chỗ mở rộng

- [x] **Task 3 — Định nghĩa 5 port là interface thuần (AC: #1, #3)**
  - [x] Tách mỗi port một file trong `packages/decision-core/ports/` + barrel `ports/index.ts` (khớp cấu trúc arch `ports/ # ingestion · persistence · narrator · clock · ui-read`):
    - `ports/clock.ts` — **giữ** `ClockPort { readonly nowEpochMillis: () => number }` (di chuyển từ `ports/index.ts` hiện tại, re-export qua barrel để không phá import cũ)
    - `ports/ingestion.ts` — `IngestionPort`: lấy `MarketSnapshot` cho `(pair, timeframe, khoảng)`. Trả `Promise<Result<MarketSnapshot>>` — endpoint lỗi/thiếu → `Result.error` (suy giảm mềm, AD-11). Adapter **chỉ giao dữ liệu thô**, KHÔNG tính chỉ báo (AD-12)
    - `ports/persistence.ts` — `PersistencePort`: đọc `BehavioralState`, đọc config theo `version`/`snapshot`, **append** `AuditEvent` (append-only, AD-8), lưu `Suggestion`. Mọi method trả `Promise<Result<...>>`. **Interface only** — KHÔNG impl Postgres ở story này
    - `ports/narrator.ts` — `NarratorPort`: `narrate(...) => Promise<Result<Narration>>`. Nằm **ngoài** đường quyết định (AD-9): lỗi narrator KHÔNG chặn Đề xuất
    - `ports/ui-read.ts` — `UiReadPort`: chiếu **chỉ-đọc** cho UI (danh sách Đề xuất gần đây, state hiện tại). AD-10 (UI chỉ đọc)
  - [x] Tất cả module port **thuần**: chỉ `import type` (nếu cần), không giá trị runtime IO. Dùng `import type { ConfigSnapshot } from "@brighten/config"` nơi port cần config (type-only, bị `verbatimModuleSyntax` xóa khi build — không kéo IO)
  - [x] Nếu dùng `import type` từ `@brighten/config`: thêm `"@brighten/config": "workspace:*"` vào `dependencies` của `packages/decision-core/package.json` + project reference trong tsconfig. Xác nhận rule `no-restricted-imports` (chặn `@supabase/*`, `@brighten/adapters`) **KHÔNG** chặn `@brighten/config`

- [x] **Task 4 — Hợp đồng Tier + pipeline runner thuần (AC: #2, #3, #4)**
  - [x] `packages/decision-core/pipeline/runner.ts`: **NEW** — định nghĩa hợp đồng tầng và runner:
    - `type TierId = "tier0" | "tier1" | "tier2" | "tier3"`
    - `type TierOutcome = { readonly kind: "pass" } | { readonly kind: "veto"; readonly tier: TierId; readonly reason: string }`
    - `interface TierContext { readonly input: MarketSnapshot; readonly state: BehavioralState; readonly config: ConfigSnapshot; readonly nowEpochMillis: number }` (thời gian đã-giải-quyết, tiêm vào — tầng KHÔNG tự đọc clock)
    - `interface Tier { readonly id: TierId; run(ctx: TierContext): TierOutcome }` — tầng là **hàm thuần**
    - `interface PipelineResult { readonly outcome: "suggestion" | "silent"; readonly vetoedBy?: TierId; readonly reason?: string; readonly suggestion?: Suggestion }`
    - `function runPipeline(tiers: readonly Tier[], base: Omit<TierContext, "nowEpochMillis">, clock: ClockPort): PipelineResult`
  - [x] Logic runner: đọc `clock.nowEpochMillis()` **đúng một lần** → dựng `TierContext` bất biến; lặp tiers **theo thứ tự mảng**; tầng đầu tiên trả `veto` → `return { outcome: "silent", vetoedBy, reason }` **ngay** (không chạy tầng sau); mọi tầng pass → `return { outcome: "suggestion", suggestion: <stub> }`
  - [x] **Thuần & không mutate**: KHÔNG sửa `input`/`state`/`config`; KHÔNG `Date.now()`/`Math.random()`. (State-mutation thực do decision-engine sở hữu qua event — AD-6 — nằm ngoài phạm vi runner story này)
  - [x] `tiers/tier0..tier3/index.ts`: **thay** các stub `TierNScaffold` bằng **tier stub tuân hợp đồng `Tier`** (ví dụ mặc định trả `{ kind: "pass" }`, cho phép cấu hình veto để test). Đây chỉ là stub tối thiểu — luật thật là Story 1.4 (tier3), 1.5 (cost hurdle), 1.6 (tier0), và tier1/tier2 sau. Ghi chú rõ "STUB — logic thật ở Story 1.x"
  - [x] `packages/decision-core/index.ts`: cập nhật barrel — export `runPipeline`, các kiểu `Tier`/`TierContext`/`TierOutcome`/`TierId`/`PipelineResult`, `./ports`, `./types`. Đảm bảo KHÔNG còn tham chiếu `DecisionCoreScaffold`/`TierNScaffold`

- [x] **Task 5 — Tests phủ từng AC (AC: #2, #3, #4, #5)**
  - [x] `packages/decision-core/pipeline/runner.test.ts` (đặt cạnh source):
    - **Thứ tự**: dùng tier ghi lại thứ tự gọi → assert `["tier0","tier1","tier2","tier3"]` khi tất cả pass
    - **Dừng-khi-veto**: cho tier1 veto → tier2/tier3 **không** được gọi; `outcome="silent"`, `vetoedBy="tier1"`, `reason` khớp. Lặp cho veto ở tier0 (tier1..3 không chạy), tier2, tier3
    - **Có Đề xuất**: mọi tầng pass → `outcome="suggestion"`
    - **Clock**: fake `ClockPort` đếm số lần gọi → `nowEpochMillis` gọi **đúng 1 lần**; `TierContext.nowEpochMillis` = giá trị fake trả về (không phải giờ thật)
    - **Tất định**: chạy `runPipeline` 2 lần cùng input → `expect(a).toEqual(b)`; assert `input`/`state` **không bị mutate** (deep-equal so với bản gốc)
  - [x] Test **tất định**: tiêm clock giả cố định, không phụ thuộc đồng hồ/PRNG thật
  - [x] Chạy `pnpm -r test` pass; xác nhận `dist/` **không** chứa `*.test.js`

## Dev Notes

> **Bối cảnh story:** Đây là story dựng **khung lõi** — biến scaffold rỗng của Story 1.1 (`packages/decision-core/**` chỉ có các interface `*Scaffold`) thành **hợp đồng thật**: 5 port + pipeline runner tất định + tier stub. Đây là *nền* để các story tầng thật (1.4–1.7) và backtest (1.8) cắm vào **cùng một engine** (AD-3). **Không có adapter, không Postgres, không luật tầng thật** ở story này.

### Nguyên tắc altitude — ĐỪNG over-build

Story này là **plumbing/hợp đồng**, KHÔNG phải mô hình hóa nghiệp vụ. Cạm bẫy lớn nhất của LLM ở đây là *nhét sớm* toàn bộ entity (klines, funding, win-streak, R-multiple…) vào `types/`. **Đừng.** Các entity đó có chủ sở hữu story riêng:

| Entity | Story sở hữu shape đầy đủ | Ở 1.3 chỉ cần |
| --- | --- | --- |
| `MarketSnapshot` (raw) | 1.7 (ingestion adapter sở hữu) | placeholder mở, đủ để port/runner tham chiếu |
| `BehavioralState` | 1.6 (Tầng 0) | placeholder `readonly` tối thiểu |
| `Suggestion` | story sau (1.6/1.8 dùng) | stub payload "có Đề xuất" |
| `AuditEvent` | FR-14 / persistence sau | stub |
| Luật tier0/1/2/3 | 1.6 / (sau) / (sau) / 1.4+1.5 | **stub pass/veto** cấu hình-được cho test |

Nếu phân vân "có nên mô hình chi tiết X không?" → **không**, để placeholder + comment `[PLACEHOLDER — Story 1.x]`.

### Invariant kiến trúc story này PHẢI hiện thực

- **AD-2 — Lõi thuần, tất định:** `decision-core` **cấm** network/disk/clock/random trực tiếp. Thời gian & dữ liệu vào lõi **chỉ qua port**. Cùng `(input, state, config)` → **luôn** cùng output. Lint đã bật rule chặn (`Date`, `Date.now()`, `Math.random()`, import `fs/net/http/https/crypto/child_process/@supabase/*/@brighten/adapters`). [Source: ARCHITECTURE-SPINE.md#AD-2; eslint.config.js → `decisionCoreFiles`]
- **AD-3 — Một engine, hai driver:** runner này là engine dùng chung; live (cron) & backtest **phải** import cùng package, cấm cài lại luật ở driver. Nên runner + hợp đồng Tier phải đủ tổng quát để cả hai driver bơm dữ liệu vào. [Source: ARCHITECTURE-SPINE.md#AD-3]
- **AD-5 — Thứ tự gating:** cố định **Tầng 0 → 1 → 2 → 3**; Tầng 0 veto tối cao; **bất kỳ tầng chặn → dừng ngay, im lặng**. Đây là hành vi lõi của `runPipeline`. (Cost-hurdle FR-11 là cổng *trong* Tầng 3, live-drift/override là luật *trong* Tầng 0 — KHÔNG phải tầng riêng; runner chỉ biết 4 tier.) [Source: ARCHITECTURE-SPINE.md#AD-5]
- **AD-6 (biên):** state kỷ luật chỉ đổi qua event `market-tick`/`trade-outcome` do decision-engine sở hữu — **ngoài phạm vi runner story này**. Runner **đọc** state như input, **không** mutate tại chỗ; nếu cần biểu diễn thay đổi state thì trả tường minh (để tầng thật/engine sau xử lý). [Source: ARCHITECTURE-SPINE.md#AD-6]
- **AD-9 (narrator port):** LLM nằm **ngoài** đường quyết định — narrator port khai báo ở đây nhưng runner **không** gọi nó trên đường ra Đề xuất. [Source: ARCHITECTURE-SPINE.md#AD-9]
- **AD-11/AD-12 (ingestion port):** ingestion trả `Result<MarketSnapshot>` (suy giảm mềm khi lỗi); adapter **chỉ giao dữ liệu thô**, mọi suy diễn tín hiệu (CVD/regime) nằm trong lõi (story sau). Port ở đây phản ánh hợp đồng đó. [Source: ARCHITECTURE-SPINE.md#AD-11, #AD-12]

### File hiện trạng cần đọc trước khi sửa (UPDATE)

| File | Trạng thái hiện tại | Story này đổi gì | Phải giữ nguyên |
| --- | --- | --- | --- |
| `packages/decision-core/index.ts` | Barrel `export *` từ ports/tiers/types (toàn stub) | Thêm export `runPipeline` + kiểu Tier/PipelineResult; bỏ export stub cũ | Giữ dạng barrel, ESM `.js` extension trong specifier |
| `packages/decision-core/ports/index.ts` | Chỉ `ClockPort` | Tách thành file-per-port + barrel; **giữ** `ClockPort` export ổn định | Không phá `@brighten/decision-core/ports` subpath export |
| `packages/decision-core/types/index.ts` | `DecisionCoreScaffold` (stub) | Thay bằng kiểu miền placeholder + `Result`/`CoreError` | Giữ module thuần |
| `packages/decision-core/tiers/tier0..3/index.ts` | 4 interface `TierNScaffold` | Thay bằng tier **stub** tuân hợp đồng `Tier` | Giữ 4 thư mục tier (naming `tier0..3`) |
| `packages/decision-core/package.json` | `build/typecheck/lint` trỏ `tsconfig.json`; không `test` | + script `test`; đổi build/typecheck sang `tsconfig.build.json`; (+ dep `@brighten/config` nếu import type) | Giữ `name`, exports map (`.` + `./ports`), `"type":"module"` |
| `packages/decision-core/tsconfig.json` | `rootDir:"."`, `include:["**/*.ts"]`, composite | + project reference config (nếu cần); giữ include test cho lint | Giữ strict base + composite |

### Convention bắt buộc (từ ARCHITECTURE-SPINE + Story 1.1/1.2)

- **ESM `.js` trong import specifier** (repo `"type":"module"`, `moduleResolution: Bundler`, `verbatimModuleSyntax`): import nội bộ dùng đuôi `.js` như barrel hiện có (`./ports/index.js`). [Source: packages/decision-core/index.ts; tsconfig.base.json]
- **`import type` bắt buộc cho kiểu** (rule `consistent-type-imports` = error). `import type { ConfigSnapshot } from "@brighten/config"` — type-only, bị xóa khi build → không kéo IO vào lõi (đúng ý định Story 1.2: "core `import type` snapshot không kéo IO"). [Source: eslint.config.js; 1-2 story Dev Notes → Ranh giới hexagonal]
- **Thời gian = UTC epoch-millis, vào lõi qua `clock` port.** Trong lõi **cấm** `Date`/`Date.now()` (lint chặn cả global `Date`). Runner đọc clock **một lần/tick**. [Source: ARCHITECTURE-SPINE.md#Consistency Conventions → Thời gian, Determinism]
- **Shape lỗi thống nhất `{ code, source, context }`** cho mọi kết quả port lỗi (đừng throw string/Error trần). [Source: ARCHITECTURE-SPINE.md#Consistency Conventions → Lỗi & log]
- **Tiền/số lượng = decimal/string** — story này chưa làm số học tiền (đó là Tầng 3 / Story 1.4); chỉ khai báo kiểu, để placeholder decimal-as-string nếu cần trong `Suggestion` stub, KHÔNG dùng JS `number` cho tiền. [Source: ARCHITECTURE-SPINE.md#Consistency Conventions → Tiền tệ]
- **ID** — `Suggestion`/`AuditEvent`/`BacktestRun` dùng UUID v7 (sắp theo thời gian). Story này KHÔNG sinh ID (không IO/clock trong lõi) — nếu stub `Suggestion` cần id, để trường kiểu `string` do driver/persistence cấp sau, KHÔNG sinh trong runner. [Source: ARCHITECTURE-SPINE.md#Consistency Conventions → ID]

### Ranh giới hexagonal — nơi từng thứ đứng

- **Core (thuần)** `packages/decision-core/`: runner + tiers + types. Phụ thuộc *không gì* runtime (chỉ types nội bộ + `import type` từ config). [Source: ARCHITECTURE-SPINE.md#Design Paradigm bảng layer→namespace]
- **Ports (interface)** `packages/decision-core/ports/`: chỉ khai báo, phụ thuộc core types. Adapter (Story 1.7+) sẽ impl các port này ở `packages/adapters/` — **KHÔNG** làm ở story này.
- **Driver** (`apps/cron-runner`, `apps/backtest-cli`) sẽ nối core+adapters — **KHÔNG** làm ở story này.

### Ngoài phạm vi story này (đừng làm — để story sau)

- **Impl bất kỳ adapter nào** (binance-rest, postgres, llm-narrator, clock impl thật) — Story 1.7+ và driver sau. Story 1.3 chỉ định nghĩa *interface* port.
- **Luật tầng thật** — tier0 (1.6), tier3 sizing (1.4) + cost hurdle (1.5), tier1/tier2 (sau). Ở đây chỉ **stub pass/veto**.
- **Suy diễn tín hiệu** (CVD/regime) — trong lõi nhưng ở story tầng sau (AD-12).
- **Behavioral state mutation qua event** (`market-tick`/`trade-outcome`) — AD-6, decision-engine sở hữu, story sau.
- **Postgres/persistence impl, audit append-only thật** — persistence adapter story sau; ở đây chỉ interface.
- **Gắn narrator vào luồng** — AD-9, story sau; ở đây chỉ interface, runner không gọi.

### Source tree mục tiêu (phần thêm/đổi)

```text
brighten/
  packages/decision-core/
    package.json                 # UPDATE: + "test", build→tsconfig.build.json, (+ dep @brighten/config nếu import type)
    tsconfig.json                # UPDATE: (+ reference config); include **/*.ts để lint thấy test
    tsconfig.build.json          # NEW: exclude *.test.ts + vitest.config.ts khỏi dist
    vitest.config.ts             # NEW
    index.ts                     # UPDATE: barrel + runPipeline + kiểu pipeline
    types/index.ts               # UPDATE: bỏ DecisionCoreScaffold; + kiểu miền placeholder + Result/CoreError
    ports/
      index.ts                   # UPDATE: barrel re-export 5 port
      clock.ts                   # NEW (di chuyển ClockPort): ClockPort
      ingestion.ts               # NEW: IngestionPort
      persistence.ts             # NEW: PersistencePort
      narrator.ts                # NEW: NarratorPort
      ui-read.ts                 # NEW: UiReadPort
    pipeline/
      runner.ts                  # NEW: runPipeline + Tier/TierContext/TierOutcome/PipelineResult
      runner.test.ts             # NEW
    tiers/tier0..3/index.ts      # UPDATE: stub tuân hợp đồng Tier (bỏ TierNScaffold)
```

[Source: ARCHITECTURE-SPINE.md#Structural Seed → Source tree; Story 1.1 File List; packages/config bố cục build/test làm khuôn mẫu]

### Quyết định tooling (mặc định đã chọn, báo trước khi dev nếu muốn đổi)

1. **Test runner = Vitest** — đã chốt & cài ở Story 1.2 (root). Chỉ thêm script + `vitest.config.ts` cho package. Không mở lại quyết định.
2. **`decision-core` `import type` từ `@brighten/config`** cho `ConfigSnapshot` (mặc định). Lý do: đúng ý định 1.2, type-only nên không phá AD-2. Thay thế khả dĩ: khai báo lại `ConfigSnapshot` như generic param của runner để core **hoàn toàn** không có edge tới config — chọn nếu muốn dep-graph tuyệt đối rỗng; đánh đổi là trùng lặp kiểu. **Khuyến nghị: import type** (một nguồn sự thật). Nếu chọn generic, báo trước.
3. **Tiêm thời gian**: runner nhận `ClockPort` và đọc **một lần**; tầng nhận `nowEpochMillis` đã-giải-quyết (không nhận cả clock) → tầng thuần, một mốc/tick. (Thay thế: truyền clock xuống tầng — bác bỏ vì mở đường cho nhiều mốc/tick & khó test tất định.)

### Chuẩn test

- Framework: Vitest. Mỗi AC ≥ 1 test (map ở Task 5).
- **Fake ClockPort** cố định (ví dụ `nowEpochMillis: vi.fn(() => 1_700_000_000_000)`) — assert gọi đúng 1 lần & giá trị chảy vào `TierContext`.
- **Fake tiers** ghi lại thứ tự gọi (push id vào mảng) để kiểm order + short-circuit.
- Kiểm **không mutate**: snapshot `structuredClone` input/state trước, `toEqual` sau.
- Kiểm **tất định**: gọi 2 lần → `toEqual`.
- Không integration/DB test (không có adapter/Postgres ở story này).

### Project Structure Notes

- Cấu trúc khớp `ARCHITECTURE-SPINE.md#Structural Seed` (`decision-core/{tiers,ports,types}`), bổ sung `pipeline/` cho runner — biến thể hợp lý (runner không thuộc một tầng cụ thể). Nếu muốn đặt runner trong `decision-core/index.ts` hoặc `core/` thay vì `pipeline/`, đó là lựa chọn tổ chức nhỏ, giữ nhất quán 1 nơi.
- Xung đột đã biết: các interface `*Scaffold` (Story 1.1) là stub — **phải thay**, không giữ song song. `ClockPort` là thứ **duy nhất** không phải stub trong scaffold → giữ ổn định.
- `*.test.ts` không được lọt `dist`: mirror cơ chế `tsconfig.build.json` của `packages/config` (build qua build-config loại test; lint/typecheck qua `tsconfig.json` gồm test).

### References

- [Source: epics.md → Epic 1, Story 1.3] — user story + AC gốc (BDD): 5 port là interface, runner 0→1→2→3 dừng-khi-veto, clock port không `Date.now()`, tất định
- [Source: ARCHITECTURE-SPINE.md#AD-2] — lõi thuần tất định, IO/clock/random chỉ qua port; lint chặn
- [Source: ARCHITECTURE-SPINE.md#AD-3] — một engine, hai driver (live/backtest cùng package)
- [Source: ARCHITECTURE-SPINE.md#AD-5] — thứ tự gating 0→1→2→3, Tầng 0 veto tối cao, chặn → im lặng ngay
- [Source: ARCHITECTURE-SPINE.md#AD-6] — behavioral state chỉ đổi qua event (ngoài phạm vi runner)
- [Source: ARCHITECTURE-SPINE.md#AD-9] — narrator ngoài đường quyết định
- [Source: ARCHITECTURE-SPINE.md#AD-11, #AD-12] — ingestion sau port, suy giảm mềm, adapter chỉ giao dữ liệu thô
- [Source: ARCHITECTURE-SPINE.md#Design Paradigm] — bảng layer→namespace; core `import type` snapshot không kéo IO
- [Source: ARCHITECTURE-SPINE.md#Consistency Conventions] — Thời gian (epoch-ms qua clock), Determinism (lint), Lỗi `{code,source,context}`, ID (UUID v7 cho entity, không cho config), Tiền (decimal/string)
- [Source: eslint.config.js] — rule tất định thực thi cho `packages/decision-core/**` (cấm `Date`, `Date.now`, `Math.random`, import IO/`@supabase`/`@brighten/adapters`)
- [Source: 1-2-config-versioned-immutable-snapshot.md] — `@brighten/config` public API (`ConfigSnapshot`, `snapshot`, …), khuôn mẫu build/test split, ý định core import type snapshot; persistence port "ra đời ở Story 1.3"
- [Source: Story 1.1 File List] — scaffold `decision-core` (`*Scaffold` stubs, `ClockPort`), conventions ESM/strict đã đặt nền

## Dev Agent Record

### Agent Model Used
GPT-5 Codex

### Debug Log References
- RED: `CI=true pnpm --filter @brighten/decision-core test` fail do thiếu `pipeline/runner.js` trước khi implement.
- GREEN: `CI=true pnpm --filter @brighten/decision-core test` pass với 8 tests sau khi thêm runner/types/ports.
- Validation cuối: `CI=true pnpm -r typecheck`, `CI=true pnpm -r build`, `CI=true pnpm -r lint`, `CI=true pnpm -r test` đều pass.
- Kiểm `packages/decision-core/dist` không còn `*.test.*`.

### Completion Notes List
- Thêm build/test split cho `@brighten/decision-core`: `vitest.config.ts`, `tsconfig.build.json`, scripts `test`/`test:watch`, build/typecheck qua build config và dependency type-only tới `@brighten/config`.
- Thay scaffold types bằng placeholder domain types tối thiểu (`MarketSnapshot`, `BehavioralState`, `Suggestion`, `AuditEvent`, `Narration`) và `CoreError`/`Result`.
- Tách 5 port interface thuần trong `packages/decision-core/ports/`, giữ `ClockPort` export ổn định qua barrel.
- Thêm `runPipeline` thuần: đọc clock đúng một lần, chạy tiers theo thứ tự mảng, short-circuit khi veto, trả `silent` hoặc stub `suggestion`, không mutate input/state/config.
- Thay tier scaffold bằng tier stub `createTierNStub`/`tierNStub` tuân hợp đồng `Tier`.
- Thêm tests runner phủ thứ tự tier, veto tier0..3, suggestion path, clock injection, deterministic output và không mutate input/state/config.
- Cập nhật scaffold app references từ `DecisionCoreScaffold` sang public type mới `PipelineResult` để không còn tham chiếu scaffold cũ.
- Sửa guard strict TS trong `packages/config/src/snapshot.test.ts` để full repo typecheck/build/lint pass.

### File List
- apps/backtest-cli/src/main.ts
- apps/cron-runner/functions/health/index.ts
- packages/config/src/snapshot.test.ts
- packages/decision-core/index.ts
- packages/decision-core/package.json
- packages/decision-core/pipeline/runner.test.ts
- packages/decision-core/pipeline/runner.ts
- packages/decision-core/ports/clock.ts
- packages/decision-core/ports/index.ts
- packages/decision-core/ports/ingestion.ts
- packages/decision-core/ports/narrator.ts
- packages/decision-core/ports/persistence.ts
- packages/decision-core/ports/ui-read.ts
- packages/decision-core/tiers/tier0/index.ts
- packages/decision-core/tiers/tier1/index.ts
- packages/decision-core/tiers/tier2/index.ts
- packages/decision-core/tiers/tier3/index.ts
- packages/decision-core/tsconfig.build.json
- packages/decision-core/tsconfig.json
- packages/decision-core/types/index.ts
- packages/decision-core/vitest.config.ts
- pnpm-lock.yaml

### Change Log
- 2026-07-04: Implemented Story 1.3 decision-core ports, deterministic pipeline runner, tier stubs, tests, and validation cleanup.
