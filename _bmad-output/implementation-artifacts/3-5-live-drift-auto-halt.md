---
baseline_commit: cfae2a46e98a2ac6b5e1bf9e97fc672533fa2161
depends_on: 3-4-feedback-loop-hybrid
---

# Story 3.5: Live-drift auto-halt (FR-10)

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **người dùng của Brighten**,
I want **hệ thống tự tính expectancy THỰC CHIẾN (từ R của các lệnh attributed — nguồn 3.4), so với BASELINE khoảng-tin-cậy expectancy từ backtest (1.9); khi expectancy thực chiến trượt xuống DƯỚI cận-dưới CI đó ⇒ Tầng 0 tự phanh (tạm dừng phát Đề xuất) + báo lý do; và live-drift là chỉ số HẠNG NHẤT, luôn tính & lưu**,
so that **nó tự nghi ngờ chính nó khi regime đổi, tự phanh thay vì tiếp tục đẩy tôi vào lệnh — và Epic 4 hiển thị được (FR-10, AD-5, AD-7, AD-2, AD-4)**.

## Acceptance Criteria

**AC1 — `evaluateLiveDrift` THUẦN trong Tầng 0 (FR-10 lives in tier0)**
**Given** chuỗi R thực chiến (`liveRs: string[]`, decimal — mỗi lệnh attributed một R), baseline CI cận-dưới (`baselineLower`), và ngưỡng `drift_min_samples`/`drift_window`
**When** đánh giá drift
**Then** thêm hàm thuần `evaluateLiveDrift(input) → LiveDriftStatus` trong `packages/decision-core/tiers/tier0/live-drift.ts`:
  - `liveExpectancy` = trung bình R của **`drift_window` lệnh attributed gần nhất** (decimal, `div(sum, n)`)
  - `sampleCount` = số R dùng
  - `drifting` = `sampleCount >= drift_min_samples` **và** `cmp(liveExpectancy, baselineLower) < 0`
  - `LiveDriftStatus = { liveExpectancy: string; drifting: boolean; sampleCount: number; baselineLower: string }`
**And** **luôn** tính `liveExpectancy`/`sampleCount` (chỉ số hạng nhất, kể cả khi chưa drift/thiếu mẫu ⇒ `drifting: false`); hàm **thuần**: decimal, không `Date`/IO/random, không mutate (AD-2)
**And** baseline vắng (`baselineLower` chưa set) ⇒ `drifting: false` (không phanh khi chưa có baseline) + vẫn tính expectancy

**AC2 — Tầng 0 auto-halt: drifting ⇒ veto `live_drift_halt` + báo lý do (AD-5)**
**Given** `ctx.liveDrift?: LiveDriftStatus` (driver tính & bơm — AC4)
**When** Tầng 0 chạy
**Then** thêm luật vào `createTier0`: `ctx.liveDrift?.drifting === true` ⇒ `{ kind: "veto", tier: "tier0", reason: "live_drift_halt: liveExpectancy … below baselineLower … (n samples)" }` ⇒ pipeline **im lặng** (tạm dừng phát Đề xuất)
**And** thứ tự Tầng 0 **cố định**: `live_drift_halt` đặt **ĐẦU** (drift = cả edge hỏng, nghiêm hơn cooldown/daily-loss per-session) → cooldown → daily_loss → max_trades → news; `liveDrift` undefined/`drifting:false` ⇒ **không** veto vì lý do này (mọi test Tầng 0 cũ **không đổi**)
**And** [mặc định] auto-halt = **tạm dừng** (veto). "Giảm size" (thay vì dừng) là **tùy chọn tunable** — giữ MVP = pause; nhánh giảm-size graduated ghi ở Ngoài phạm vi (AC gốc "giảm size HOẶC tạm dừng" ⇒ chọn tạm dừng)

**AC3 — Baseline expectancy CI từ backtest được LƯU & tham chiếu (AD-4)**
**Given** `ValidationReport.expectancyCI` (1.9: `{ lower, median, upper, resamples, seed }`) do `backtest-cli validate` sinh
**When** đặt baseline cho live
**Then** thêm bảng `drift_baseline` (lower, median, upper, source jsonb, created_at) + persistence `readDriftBaseline() → Result<DriftBaseline | null>` / `setDriftBaseline(b) → Result<void>`; baseline mang provenance (config version / data range của run sinh nó)
**And** đặt baseline là **hành động vận hành**: chạy `backtest-cli validate` → lấy `expectancyCI` → `setDriftBaseline` (CLI/endpoint admin). 3.5 cấp persistence + đường set; **KHÔNG** tự chạy validate mỗi tick (baseline ổn định, đổi khi re-validate). Live so `liveExpectancy` vs `baseline.lower`
**And** baseline là **derived-data có provenance** (không phải tunable config) — nhưng gắn `configVersion` để tái dựng "baseline này từ backtest config nào"

**AC4 — Driver tính drift mỗi tick, LƯU hạng-nhất, bơm vào ctx (AD-7 nối 3.4)**
**Given** `runTick` (3.1–3.4) + R thực chiến từ attributed outcomes (3.4)
**When** một tick chạy
**Then** `runTick` (trước pipeline): `readLiveRSeries(drift_window)` (join `trade_attributions`×`account_fills`×`suggestions` → R = `realizedPnl / sizing.riskAmount`) + `readDriftBaseline` → `evaluateLiveDrift(...)` → **lưu** `writeDriftMetric(status)` (bảng `drift_metrics`, hạng-nhất cho Epic 4) → set `ctx.liveDrift = status` cho pipeline
**And** drift **luôn** tính & lưu mỗi tick (kể cả `drifting:false`) — "chỉ số hạng nhất, luôn được tính và lưu"; lỗi đọc R/baseline ⇒ soft-degrade (`liveDrift` undefined ⇒ không phanh, log) — không chặn tick vì hụt dữ liệu drift
**And** R thực chiến = **net** (Binance `realizedPnl` đã trừ phí/funding) chia `riskAmount` (từ `suggestions.sizing`) ⇒ so **cùng đơn vị** với backtest net expectancy (AD-2 công bằng)

**AC5 — Config/port/types additive + Migration + Test phủ + toolchain sạch**
**Given** `ConfigParams` + `PersistencePort` + `TierContext` + Postgres
**When** mở rộng
**Then** additive: `ConfigParams` +`drift_min_samples` (int ≥ 1), +`drift_window` (int ≥ 1) + `DEFAULT_PARAMS` + `fieldNames` + validate (`isPositiveInteger`) + mọi fixture `ConfigParams` literal; `PersistencePort` +`readDriftBaseline`/`setDriftBaseline`/`readLiveRSeries`/`writeDriftMetric`; `TierContext` +`liveDrift?: LiveDriftStatus`; migration `drift_baseline` + `drift_metrics`
**And** test cho: `evaluateLiveDrift` (expectancy số tính tay; drifting đúng ở biên `< baselineLower` + `>= min_samples`; baseline vắng ⇒ false; luôn tính expectancy); Tầng 0 veto `live_drift_halt` khi drifting + thứ tự đầu + không-veto khi undefined (test cũ xanh); `runTick` tính+lưu+bơm drift (fake persistence); adapter 4 method drift (fake `SqlClient`); R = pnl/riskAmount đúng; tất định/không leak number
**And** `pnpm -r typecheck && pnpm -r build && pnpm -r lint && pnpm -r test` **tất cả pass**; `*.test.ts` KHÔNG lọt `dist/`

## Tasks / Subtasks

- [x] **Task 1 — `evaluateLiveDrift` thuần (AC: #1)**
  - [ ] `packages/decision-core/tiers/tier0/live-drift.ts`: **NEW** — `LiveDriftInput = { liveRs: readonly string[]; baselineLower?: string; minSamples: number; window: number }`; `evaluateLiveDrift(input): LiveDriftStatus` — lấy `window` R gần nhất, `liveExpectancy = div(sum, count)` (count>0; count 0 ⇒ expectancy "0", drifting false); `drifting = count>=minSamples && baselineLower!==undefined && cmp(liveExpectancy, baselineLower) < 0`
  - [ ] Thuần: `add`/`div`/`cmp` từ `math/decimal.ts`; không `Date`/IO; export từ `tiers/tier0/index.ts` (đã `export *`)
  - [ ] `packages/decision-core/types/index.ts` hoặc live-drift.ts: `LiveDriftStatus` type (export)

- [x] **Task 2 — Tầng 0 auto-halt + TierContext (AC: #2)**
  - [ ] `packages/decision-core/pipeline/runner.ts`: `TierContext` +`readonly liveDrift?: LiveDriftStatus` (additive)
  - [ ] `packages/decision-core/tiers/tier0/index.ts`: trong `createTier0().run(ctx)`, **trước** `evaluateBehavioralVeto`, kiểm `ctx.liveDrift?.drifting === true` ⇒ `{ kind: "veto", tier: "tier0", reason: formatDriftReason(ctx.liveDrift) }`; else tiếp luật hành vi cũ. Thêm `live_drift_halt` vào `formatReason`/reason builder
  - [ ] Giữ mọi luật/thứ tự/`createTier0Stub` cũ; `liveDrift` undefined ⇒ nhánh cũ nguyên (test 1.6 xanh)
  - [ ] `packages/decision-core/tiers/tier0/index.test.ts`: **UPDATE** — drifting ⇒ veto `live_drift_halt` (đầu, kể cả khi cooldown cũng bật ⇒ reason là drift); `drifting:false`/undefined ⇒ nhánh cũ

- [x] **Task 3 — Config additive + fixtures (AC: #5)**
  - [ ] `packages/config/src/schema.ts`: +`drift_min_samples: number`, `drift_window: number` vào `ConfigParams`/`DEFAULT_PARAMS` (`drift_min_samples: 20`, `drift_window: 50` — deferred-tuning)/`fieldNames`/validate (`isPositiveInteger`)
  - [ ] `schema.test.ts` + mọi literal `ConfigParams` (runner/tier0/tier3/tier1 crypto+fx tests) +2 field; apps `{...DEFAULT_PARAMS}` tự đúng

- [x] **Task 4 — Persistence baseline + R-series + metric (AC: #3, #4)**
  - [ ] `packages/decision-core/ports/persistence.ts`: +`readDriftBaseline() => Promise<Result<DriftBaseline | null>>`, `setDriftBaseline(b: DriftBaseline) => Promise<Result<void>>`, `readLiveRSeries(window: number) => Promise<Result<readonly string[]>>`, `writeDriftMetric(status: LiveDriftStatus & { atEpochMillis: number }) => Promise<Result<void>>`. `DriftBaseline = { lower: string; median: string; upper: string; configVersion?: number }`
  - [ ] `packages/adapters/postgres/index.ts`: impl 4 method — `readLiveRSeries` join `trade_attributions ta join account_fills f on ta.fill_id=f.fill_id join suggestions s on ta.suggestion_id=s.id`, tính `R = realizedPnl / (s.payload->'sizing'->>'riskAmount')` **trong core/JS** (không SQL decimal — đọc thô rồi `div` bằng `math/decimal.ts` để một-nguồn-precision), order by closed desc limit `window`; `readDriftBaseline`/`setDriftBaseline` bảng `drift_baseline`; `writeDriftMetric` insert `drift_metrics`. Lỗi ⇒ `Result{ok:false}`
  - [ ] `index.test.ts`: **UPDATE** — 4 method (fake `SqlClient`)

- [x] **Task 5 — Nối drift vào `runTick` (AC: #4)**
  - [ ] `apps/cron-runner/src/tick.ts`: sau state/config, **trước** pipeline: `readLiveRSeries(config.params.drift_window)` + `readDriftBaseline` → `evaluateLiveDrift({ liveRs, baselineLower: baseline?.lower, minSamples: params.drift_min_samples, window: params.drift_window })` → `writeDriftMetric({ ...status, atEpochMillis: toEpochMillis })` → `base.liveDrift = status`. Lỗi đọc drift/baseline ⇒ log + `liveDrift` undefined (không phanh, không chặn tick)
  - [ ] Giữ market-tick(3.2)/audit(3.3)/equity(3.4)/soft-degrade. `live_drift_halt` veto ⇒ (3.3) audit `suggestion-blocked` tier0 tự động ghi
  - [ ] `apps/cron-runner/src/tick.test.ts`: **UPDATE** — fake persistence R-series+baseline ⇒ drift tính+lưu+bơm; drifting ⇒ tick silent tier0

- [x] **Task 6 — Migration + set-baseline path (AC: #3)**
  - [ ] `supabase/migrations/<ts>_live_drift.sql`: **NEW** — `drift_baseline (id int pk default 1 check(id=1), lower text, median text, upper text, source jsonb, config_version int, updated_at timestamptz)`; `drift_metrics (id uuid pk default gen_random_uuid(), live_expectancy text, drifting boolean, sample_count int, baseline_lower text, at_epoch_millis bigint, created_at timestamptz default now())` (append-only trigger như 3.3 — lịch sử drift bất biến cho Epic 4). Read-only grant UI
  - [ ] Đường set baseline: entrypoint/CLI admin (vd `functions/set-drift-baseline` hoặc lệnh `backtest-cli validate --set-baseline`) — **tối thiểu**: `setDriftBaseline` gọi được; tự động-hoá "validate → baseline" ghi chú ops (không mỗi tick)
  - [ ] Ghi chú: baseline đổi khi **re-validate** (regime mới / re-tune) — có provenance `config_version` + `source`

- [x] **Task 7 — Tests (AC: #5)**
  - [ ] `packages/decision-core/tiers/tier0/live-drift.test.ts`: **NEW** — expectancy số tính tay (`["1","-1","0.5"]` window 3 ⇒ mean); drifting biên (`< baselineLower` & `count>=min` ⇒ true; `==` ⇒ false; count<min ⇒ false; baseline vắng ⇒ false); luôn có expectancy; thuần/tất định/typeof string
  - [ ] `tier0/index.test.ts` (Task 2) + `tick.test.ts` (Task 5) + `postgres/index.test.ts` (Task 4) phủ wiring
  - [ ] `pnpm -r test` pass; `dist/` không chứa `*.test.*`

## Dev Notes

> **Bối cảnh:** Story 3.5 hiện thực **FR-10 — live-drift auto-halt**: hệ thống **tự nghi ngờ chính nó**. So **expectancy thực chiến** (R của lệnh attributed — nguồn 3.4) với **baseline CI expectancy từ backtest** (1.9 `expectancyCI`); trượt dưới cận-dưới CI ⇒ **Tầng 0 tự phanh** (im lặng) + báo lý do. Đây là "cái phanh cuối" khi regime đổi — thay vì tiếp tục đẩy user vào lệnh trên edge đã hỏng. FR-10 **sống ở Tầng 0** (Capability Map) nên auto-halt là **luật Tầng 0** (veto tối cao, AD-5). Live-drift là **chỉ số hạng nhất**: luôn tính & lưu mỗi tick (Epic 4 hiển thị).

> **Phụ thuộc:** **3.4** (R thực chiến từ attributed outcomes: `trade_attributions`×`account_fills`×`suggestions.sizing`), **1.9** (`expectancyCI` baseline), **1.6/3.2** (Tầng 0 + state), **3.3** (halt tự audit `suggestion-blocked`). [Source: 3-4…md; apps/backtest-cli/src/validate.ts (expectancyCI); 1-9…md]

### 🔑 Vì sao live vs backtest phải CÙNG đơn vị (net R) — nếu không drift nói dối

- Backtest expectancy là **net R** (đã trừ fee+spread+slippage+funding — `simulate.ts` 1.8). Live R **phải** cũng net: Binance `realizedPnl` đã trừ phí/funding thật; chia `riskAmount` (từ `suggestions.sizing`, chính sizing pipeline đã quyết) ⇒ R net cùng đơn vị. So sai đơn vị (gross vs net) ⇒ drift báo động giả/bỏ sót. [Source: apps/backtest-cli/src/simulate.ts; packages/decision-core/tiers/tier3/sizing.ts (riskAmount)]

### 🔑 Auto-halt sống ở Tầng 0, driver chỉ CẤP dữ liệu (tách IO khỏi luật)

- **Luật** (drifting ⇒ halt) ở **Tầng 0** (`evaluateLiveDrift` pure trong `tiers/tier0/` + veto trong `createTier0`) — đúng Capability Map "FR-10 lives in tier0", và giữ Tầng 0 là nơi duy nhất "phanh".
- **Dữ liệu** (R-series + baseline — cần IO đọc Postgres) do **driver** (`runTick`) đọc, gọi `evaluateLiveDrift`, **lưu** metric (hạng-nhất), rồi **bơm `LiveDriftStatus` gọn vào ctx**. Tầng 0 chỉ đọc `ctx.liveDrift.drifting` (không cầm R-series nặng, không IO). Song song cách state bơm vào ctx (1.6). [Source: ARCHITECTURE-SPINE.md#Capability Map (FR-10→tier0); #AD-2 (lõi thuần, IO qua port)]
- Driver tính drift **một lần/tick**, dùng cho **cả** lưu-hạng-nhất **và** ctx ⇒ không double-compute.

### 🔑 Baseline là derived-data có provenance, KHÔNG phải tunable config

- Baseline CI đến từ **một backtest/validate cụ thể** (1.9), không phải số người chỉnh tay ⇒ lưu bảng `drift_baseline` với `source`/`config_version` (tái dựng "baseline từ đâu"). Đặt baseline là **vận hành**: re-validate khi regime/tune đổi → `setDriftBaseline`. **Không** chạy validate mỗi tick (nặng + baseline nên ổn định). Live chỉ so `liveExpectancy` vs `baseline.lower`. [Source: ARCHITECTURE-SPINE.md#AD-4; apps/backtest-cli/src/validate.ts#expectancyCI]

### 🔑 "Chỉ số hạng nhất, luôn tính & lưu"

- `evaluateLiveDrift` **luôn** trả `liveExpectancy`/`sampleCount` (kể cả chưa đủ mẫu / chưa baseline ⇒ `drifting:false`). `runTick` **luôn** `writeDriftMetric` mỗi tick ⇒ `drift_metrics` là chuỗi thời gian để Epic 4 vẽ "expectancy thực chiến vs baseline". Không chỉ tính khi đã drift. [Source: epics.md → 3.5 "Live-drift là chỉ số hạng nhất, luôn được tính và lưu"]

### Hợp đồng đã có (PHẢI tuân) — sau 3.1–3.4

| File | Trạng thái | Story 3.5 đổi gì | Phải giữ nguyên |
| --- | --- | --- | --- |
| `packages/decision-core/tiers/tier0/index.ts` | veto hành vi (cooldown/daily-loss/max-trades/news) | **+luật `live_drift_halt`** (đầu thứ tự) + `evaluateLiveDrift` | luật/thứ tự cũ; `createTier0Stub`; `formatReason` cũ |
| `packages/decision-core/pipeline/runner.ts` | `TierContext` (state/config/... + liveDrift chưa có) | **+`liveDrift?`** (additive) | `runPipeline`/surface/enrich (2.4/2.5) |
| `packages/config/src/schema.ts` | param tới 3.x | **+`drift_min_samples`,`drift_window`** (additive) | param cũ; `version/store/snapshot` |
| `packages/decision-core/ports/persistence.ts` | read/write state, suggestion, audit, feedback (3.1–3.4) | **+4 method drift** (additive) | method cũ |
| `packages/adapters/postgres/index.ts` | các method 3.1–3.4 | **+4 method drift** impl (join R-series) | method cũ; `SqlClient` tiêm |
| `apps/cron-runner/src/tick.ts` | market-tick/audit/equity/pipeline | **+tính/lưu/bơm drift** trước pipeline | các bước 3.1–3.4; soft-degrade |
| `supabase/migrations/…` | config/state/suggestions/audit/feedback | **+`drift_baseline`,`drift_metrics`** | migration cũ |
| `apps/backtest-cli/src/validate.ts` | `expectancyCI` (1.9) | (không sửa) — nguồn baseline; +đường `setDriftBaseline` (ops) | luật validate/CI |

[Source: các file đã dẫn; packages/decision-core/tiers/tier0, pipeline/runner; packages/config/src/schema; packages/adapters/postgres; apps/cron-runner/src/tick; apps/backtest-cli/src/validate]

### Invariant kiến trúc PHẢI tuân

- **AD-5 — Tầng 0 veto tối cao:** live_drift_halt là veto Tầng 0 ⇒ dừng ngay, im lặng; đặt đầu thứ tự (systemic > per-session). [Source: #AD-5; #Capability Map FR-10→tier0]
- **AD-2 — thuần & tất định:** `evaluateLiveDrift` thuần decimal; driver tính từ dữ liệu port; cùng R-series+baseline ⇒ cùng kết quả. [Source: #AD-2]
- **AD-7 — feedback:** R thực chiến từ attributed outcomes (3.4); drift dùng nó (không state ma). [Source: #AD-7]
- **AD-4 — config/baseline versioned:** ngưỡng drift là config versioned; baseline có provenance config_version. [Source: #AD-4]
- **AD-8 — audit:** halt ⇒ `suggestion-blocked` (3.3); `drift_metrics` append-only (bằng chứng). [Source: #AD-8]
- **AD-11 — suy giảm mềm:** đọc R/baseline lỗi ⇒ không phanh + log (không chặn tick vì hụt dữ liệu drift). [Source: #AD-11]

### Ngoài phạm vi story này (đừng làm — để story sau)

- **Giảm-size graduated** (thay vì tạm dừng hẳn khi drift nhẹ) — MVP = pause. Nhánh dampening theo mức drift là tùy chọn tunable sau (AC gốc "HOẶC").
- **UI hiển thị live-drift / expectancy-vs-baseline** — **epic 4** (FR-13). 3.5 chỉ tính & lưu `drift_metrics`.
- **Tự động re-validate → set baseline định kỳ** — vận hành; 3.5 cấp `setDriftBaseline` + đường thủ công. Auto-refresh baseline là sau.
- **Override khi bị auto-halt** — **3.6** (FR-12): user vượt halt phải trả ma sát.
- **Drift theo pair/asset riêng** — v1 drift toàn-danh-mục (một expectancy). Per-pair drift là v2.
- **Chọn cửa sổ drift tinh vi** (EWMA, CUSUM…) — v1 mean cửa sổ `drift_window`. Thống kê nâng cao sau.

### Source tree mục tiêu (phần thêm/đổi)

```text
packages/decision-core/
  tiers/tier0/live-drift.ts       # NEW: evaluateLiveDrift + LiveDriftStatus (thuần)
  tiers/tier0/live-drift.test.ts  # NEW
  tiers/tier0/index.ts            # UPDATE: +luật live_drift_halt (đầu) + export
  tiers/tier0/index.test.ts       # UPDATE
  pipeline/runner.ts              # UPDATE: TierContext +liveDrift?
  types/index.ts                  # (LiveDriftStatus nếu đặt ở types)
packages/config/src/
  schema.ts, schema.test.ts       # UPDATE: +drift_min_samples/drift_window
packages/decision-core/ports/persistence.ts  # UPDATE: +4 method drift
packages/adapters/postgres/
  index.ts, index.test.ts         # UPDATE: +4 method drift (join R-series)
apps/cron-runner/src/
  tick.ts, tick.test.ts           # UPDATE: +tính/lưu/bơm drift
supabase/migrations/
  <ts>_live_drift.sql             # NEW: drift_baseline + drift_metrics (append-only)
# + mọi literal ConfigParams fixture: +2 field drift
```
[Source: ARCHITECTURE-SPINE.md#Structural Seed; bố cục 1.6/3.x làm khuôn]

### Project Structure Notes

- **`evaluateLiveDrift` ở `tiers/tier0/`** (không `state/`): FR-10 thuộc Tầng 0 (Capability Map); giữ luật-phanh một chỗ. Export qua `tier0/index.ts` (`export *`).
- **`TierContext +liveDrift?`** additive (như 2.4 `direction?`) ⇒ mọi test Tầng 0 cũ (liveDrift undefined) xanh; chỉ test drift mới dùng.
- **R-series precision:** đọc `realizedPnl`/`riskAmount` thô (string) từ DB, `div` bằng `math/decimal.ts` **trong JS** (không SQL numeric) ⇒ một-nguồn-precision, khớp backtest. Adapter query trả thô, tính R ở code.
- **Baseline một-hàng** (`drift_baseline id=1`) như `behavioral_state`; `setDriftBaseline` upsert. `drift_metrics` append-only (lịch sử).
- **Thứ tự Tầng 0**: `live_drift_halt` đầu ⇒ khi drift, reason là drift kể cả cooldown cũng bật (test khẳng định short-circuit). Cân nhắc: drift-halt có nên đứng **trước** cả news? Có — systemic nhất. Tài liệu-hoá thứ tự mới.
- **Config +2 field** ⇒ mọi literal `ConfigParams` (crypto-regime/fx-regime/tier0/tier3/runner tests) +2; apps `{...DEFAULT_PARAMS}` tự đúng.
- **Set-baseline**: tối thiểu `setDriftBaseline` gọi được từ một đường admin (function/CLI). Không cần UI. Ghi rõ ops chạy `validate` rồi set.

### Chuẩn test

- **evaluateLiveDrift**: mean R tính tay; drifting biên (`<`/`==`/count<min/baseline vắng); luôn có expectancy; thuần/2×toEqual/typeof string.
- **Tầng 0**: `ctx.liveDrift.drifting=true` ⇒ veto `live_drift_halt`; đặt đầu (bơm cả cooldown ⇒ reason drift); `false`/undefined ⇒ nhánh cũ (mọi test 1.6 xanh).
- **runTick**: fake persistence R-series `["-1","-1","-1"]` + baseline lower `"0"` ⇒ drifting ⇒ tick silent tier0 + `writeDriftMetric` gọi; baseline vắng ⇒ không phanh nhưng vẫn lưu metric; đọc R lỗi ⇒ liveDrift undefined + tick tiếp.
- **adapter**: `readLiveRSeries` join + R=pnl/riskAmount tính tay (fake rows); `readDriftBaseline`/`setDriftBaseline`/`writeDriftMetric` SQL đúng; lỗi→Result.
- Không DB/mạng thật (fake ports/`SqlClient`).

### References

- [Source: epics.md → Epic 3, Story 3.5] — AC gốc (BDD): baseline CI expectancy từ backtest; expectancy thực chiến trượt dưới CI ⇒ tự giảm size hoặc tạm dừng + báo lý do; live-drift hạng nhất, luôn tính & lưu (Epic 4 hiển thị)
- [Source: prd.md#FR-10] — live-drift auto-halt; hệ thống tự nghi ngờ khi thực chiến lệch xấu khỏi backtest
- [Source: ARCHITECTURE-SPINE.md#Capability Map] — FR-10 lives in `decision-core/tiers/tier0`, governed AD-5/AD-7
- [Source: ARCHITECTURE-SPINE.md#AD-5] — Tầng 0 veto tối cao, dừng ngay im lặng (auto-halt)
- [Source: ARCHITECTURE-SPINE.md#AD-2, #AD-4, #AD-7, #AD-8, #AD-11] — thuần/tất định; config+baseline versioned; feedback R; audit; suy giảm mềm
- [Source: apps/backtest-cli/src/validate.ts] — `ValidationReport.expectancyCI {lower,median,upper,resamples,seed}` (nguồn baseline)
- [Source: apps/backtest-cli/src/simulate.ts, metrics.ts] — net R/expectancy backtest (cùng đơn vị so sánh)
- [Source: packages/decision-core/tiers/tier0/index.ts] — `createTier0` (thêm luật drift đầu thứ tự); `formatReason`
- [Source: packages/decision-core/pipeline/runner.ts] — `TierContext` (+liveDrift?)
- [Source: packages/decision-core/tiers/tier3/sizing.ts] — `SizingResult.riskAmount` (mẫu số R live)
- [Source: 3-4-feedback-loop-hybrid.md] — `trade_attributions`/`account_fills`/attributed R (nguồn live R-series)
- [Source: packages/adapters/postgres/index.ts] — `SqlClient` tiêm; khuôn +method drift
- [Source: packages/config/src/schema.ts] — `isPositiveInteger` (nhân bản drift params)
- [Source: packages/decision-core/math/decimal.ts] — `add`/`div`/`cmp` cho expectancy/R

## Cần xác nhận (không chặn draft)

- **Auto-halt = pause hay giảm-size?** Mặc định mình chọn **pause** (veto, rõ ràng "phanh"). Nếu anh muốn **giảm-size graduated** (drift nhẹ → size nhỏ, drift nặng → dừng), mình thêm band dampening (nối cơ chế `size_dampening` Tầng 3). AC gốc cho "HOẶC" nên cả hai hợp lệ.
- **Cửa sổ drift**: mặc định mean của `drift_window` (50) lệnh gần nhất, `drift_min_samples` (20). Anh có ngưỡng/cửa sổ ưu tiên khác?
- **Set baseline**: mình để đường thủ công (`setDriftBaseline` sau khi `validate`). Muốn mình thêm flag `backtest-cli validate --set-baseline` để tự ghi luôn không?

## Dev Agent Record

### Agent Model Used

Claude (deepseek-v4-pro)

### Debug Log References

### Completion Notes List

- **Task 1**: Created `evaluateLiveDrift` pure function in `tiers/tier0/live-drift.ts`. Computes mean expectancy from the most recent `window` R values using `add`/`div` from `math/decimal.ts`. Drifting only when count >= minSamples AND baselineLower is set AND liveExpectancy < baselineLower. Always returns expectancy/sampleCount (first-class metric). Added 10 tests.
- **Task 2**: Added `live_drift_halt` veto to `createTier0()` — placed FIRST in order (systemic > per-session). `ctx.liveDrift?.drifting === true` ⇒ veto with descriptive reason. `liveDrift` undefined ⇒ no change to existing behavior. Added `liveDrift?` to `TierContext`. Added `formatDriftReason` helper. Exported `evaluateLiveDrift` and types from tier0/index.ts. Added 4 tier0 drift veto tests.
- **Task 3**: Added `drift_min_samples` (default 20) and `drift_window` (default 50) to `ConfigParams`, `DEFAULT_PARAMS`, `fieldNames`, and validation (`isPositiveInteger`). Updated all 9 ConfigParams literal fixtures across test files. Updated migration seed data via new migration.
- **Task 4**: Added 4 drift methods to `PersistencePort`: `readDriftBaseline`, `setDriftBaseline`, `readLiveRSeries`, `writeDriftMetric`. Added `DriftBaseline` type. Implemented in postgres adapter: `readLiveRSeries` joins `trade_attributions`×`account_fills`×`suggestions` computing R = realizedPnl / riskAmount in JS (not SQL) for precision consistency; `setDriftBaseline` upserts single-row table; `writeDriftMetric` inserts append-only metrics. Added stubs to all fake persistence implementations.
- **Task 5**: Wired drift into `runTick`: after market-tick persist, before pipeline — read R-series + baseline → `evaluateLiveDrift` → `writeDriftMetric` → inject `liveDrift` into pipeline context. All wrapped in try/catch with soft-degrade (drift read failure ⇒ liveDrift undefined, no halt, log only).
- **Task 6**: Created migration `20260705030000_live_drift.sql`: `drift_baseline` single-row table (id=1), `drift_metrics` append-only table with reject trigger, read-only grants for UI, config seed update for drift params.
- **Task 7**: 14 new tests: live-drift.test.ts (10) + tier0 drift veto tests (4). Total: 343 tests pass (up from 329). Zero regressions. Zero test artifacts in dist.

### File List

- `packages/decision-core/tiers/tier0/live-drift.ts` (NEW)
- `packages/decision-core/tiers/tier0/live-drift.test.ts` (NEW)
- `packages/decision-core/tiers/tier0/index.ts` (MODIFIED — +live_drift_halt veto, +exports)
- `packages/decision-core/tiers/tier0/index.test.ts` (MODIFIED — +4 drift veto tests)
- `packages/decision-core/tiers/tier0/behavioral-veto.test.ts` (MODIFIED — +2 config fields)
- `packages/decision-core/pipeline/runner.ts` (MODIFIED — TierContext +liveDrift?)
- `packages/decision-core/pipeline/runner.test.ts` (MODIFIED — +2 config fields)
- `packages/config/src/schema.ts` (MODIFIED — +drift_min_samples, drift_window)
- `packages/decision-core/ports/persistence.ts` (MODIFIED — +4 drift methods + DriftBaseline)
- `packages/adapters/postgres/index.ts` (MODIFIED — +4 drift method impls + div import)
- `apps/cron-runner/src/tick.ts` (MODIFIED — +drift computation block + liveDrift in ctx)
- `apps/cron-runner/src/tick.test.ts` (MODIFIED — +4 drift stubs in fake persistence)
- `apps/cron-runner/src/feedback.test.ts` (MODIFIED — +4 drift stubs + type fix)
- `supabase/migrations/20260705030000_live_drift.sql` (NEW)
- 8 tier test files (MODIFIED — +2 config fields in fixtures)

## Change Log

- 2026-07-05: Story 3.5 implementation — pure evaluateLiveDrift in tier0, live_drift_halt veto (first in order, AD-5), TierContext +liveDrift?, config params (drift_min_samples/drift_window), persistence drift methods with R-series join (JS precision), runTick drift wiring with soft-degrade, migration with drift_baseline + drift_metrics append-only. All 343 tests pass, 0 regressions.
