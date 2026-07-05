---
baseline_commit: cfae2a46e98a2ac6b5e1bf9e97fc672533fa2161
depends_on: 3-3-audit-log-append-only
---

# Story 3.4: Feedback loop hybrid — đóng vòng kết quả lệnh (AD-7)

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **người dùng không để hệ thống tự đặt lệnh**,
I want **hệ thống biết kết quả lệnh của tôi qua HAI nguồn: (a) Binance read-only API tự dò vị thế/fill/PnL → nạp `daily-loss` (rủi ro thật); (b) tôi xác nhận fill nào ứng Đề xuất nào → gắn đúng `win-streak`/R (edge của hệ thống); mỗi kết quả sinh event `trade-outcome` cập nhật behavioral state qua đúng owner (3.2)**,
so that **Tầng 0 và (sau này) live-drift chạy trên số liệu THẬT chứ không state ma, mà khóa API KHÔNG bao giờ có quyền đặt lệnh (FR-1/FR-10 nối, AD-7, AD-6, AD-10)**.

## Acceptance Criteria

**AC1 — `AccountPort` read-only + adapter `binance-account`: dò balance/fill/PnL, KHÔNG bao giờ đặt lệnh (AD-7, AD-10)**
**Given** khóa Binance **chỉ-đọc** (không quyền trade)
**When** hệ thống dò tài khoản
**Then** thêm **port** `AccountPort` (`packages/decision-core/ports/account.ts`): `readBalance() → Result<AccountBalance>` (equity) và `readClosedTrades(sinceEpochMillis) → Result<ClosedTrade[]>` (`ClosedTrade = { fillId, symbol, realizedPnl (signed decimal), closedEpochMillis }`); (tuỳ chọn `readOpenPositions`)
**And** adapter `createBinanceAccount(deps)` (`packages/adapters/binance-account/`) hiện thực **CHỈ** endpoint read-only đã ký (account info / userTrades); `fetchFn` + `signer` (HMAC) **tiêm vào** ⇒ test không mạng; **KHÔNG tồn tại** đường code gọi endpoint đặt/huỷ lệnh (AD-10) — assert bằng review + không import/khai báo endpoint order
**And** lỗi/timeout ⇒ `Result{ok:false, error{code,source:"adapter.binance_account",context}}` (soft-degrade, không throw); PnL/equity là **decimal-string** (không `number` tiền)

**AC2 — Tách HAI reducer thuần theo hai nguồn AD-7 (tinh chỉnh `applyTradeOutcome` của 3.2)**
**Given** 3.2 có `applyTradeOutcome` gộp (win-streak + daily-loss + count)
**When** đóng vòng theo đúng hai nguồn AD-7
**Then** **tách** thành hai reducer thuần trong `decision-core/state/behavioral.ts`:
  - `applyRiskOutcome(state, { realizedPnl, atEpochMillis }) → BehavioralState` — **nguồn probe**: nếu `realizedPnl < 0` ⇒ `dailyLoss = add(dailyLoss, abs(realizedPnl))`; **KHÔNG** đụng win-streak/count (rủi ro thật, kể cả lệnh discretionary)
  - `applyAttributedOutcome(state, { result: "win"|"loss", atEpochMillis }) → BehavioralState` — **nguồn user-confirm**: win ⇒ `winStreak+1`; loss ⇒ `winStreak = 0`; **cả hai** ⇒ `tradeCountToday+1` (edge của hệ thống)
**And** cập nhật `behavioral.test.ts` (3.2) theo cấu trúc mới; hai reducer **thuần**, decimal cho tiền, tất định — nối [[3-2-behavioral-state-durable-owner]]. Đây là chỗ **giải toả granularity mà 3.2 hoãn** (discretionary → daily-loss, không win-streak — mặc định spine)
**And** cả hai vẫn là **đường DUY NHẤT** sinh state mới; áp qua `writeBehavioralState` (owner path, 3.2) — không mutate rải rác (AD-6)

**AC3 — `runFeedback` orchestrator: probe → daily-loss → persist → audit, IDEMPOTENT**
**Given** `AccountPort` + `PersistencePort` + owner state
**When** một lần probe chạy
**Then** `runFeedback(deps)` thuần-composition: `readClosedTrades(sinceCursor)` → với **mỗi fill MỚI** (chưa xử lý): `applyRiskOutcome(state, { realizedPnl, closedEpochMillis })` → `writeBehavioralState` → `appendAuditEvent(type: "trade-outcome")` → ghi `account_fills(fillId)` (dedup) + tiến cursor
**And** **idempotent**: fill đã xử lý (có trong `account_fills`) ⇒ **bỏ qua** (không double-count daily-loss); probe lại cùng dữ liệu ⇒ state không đổi thêm
**And** soft-degrade: `readClosedTrades` lỗi ⇒ `{status:"skipped"}` + log, không throw; `runFeedback` KHÔNG cài lại luật (chỉ gọi reducer + owner write, AD-3-tinh-thần)

**AC4 — `confirmFill`: user gắn fill↔Đề xuất → win-streak/R (KHÔNG sửa Đề xuất bất biến)**
**Given** một `fill` (từ probe) và một `suggestionId` (Đề xuất hệ thống)
**When** user xác nhận "fill này là của Đề xuất kia"
**Then** `confirmFill(deps, { fillId, suggestionId, result })` ghi **attribution vào bảng RIÊNG `trade_attributions`** (`fill_id, suggestion_id, result, confirmed_at`) — **KHÔNG** UPDATE bảng `suggestions` (bất biến, AD-8, giải toả catch [[3-3-audit-log-append-only]]) → `applyAttributedOutcome(state, { result, atEpochMillis })` → `writeBehavioralState` → `appendAuditEvent(type:"trade-outcome", attributed)`
**And** attribution idempotent (một `fill_id` gắn một lần; `on conflict do nothing`), và **tách daily-loss (probe) khỏi win-streak (confirm)**: một lệnh lỗ đã tính daily-loss ở AC3; confirm chỉ thêm phần win-streak/count — **không** double-count daily-loss
**And** **UI của confirm là epic 4**; 3.4 cấp **backend function/endpoint** `confirmFill` + persistence; entrypoint Edge Function tối thiểu để UI (sau) gọi

**AC5 — Persistence + migration (dedup fills, attributions) + AccountPort adapter (AC: infra)**
**Given** `PersistencePort` (3.1/3.2/3.3) + Postgres
**When** thêm đường lưu feedback
**Then** mở rộng `PersistencePort` (additive): `hasProcessedFill(fillId)→Result<boolean>` + `recordProcessedFill(ClosedTrade)→Result<void>`; `recordAttribution({fillId,suggestionId,result})→Result<void>`; adapter postgres hiện thực (client `SqlClient` tiêm)
**And** migration mới: `account_fills (fill_id text pk, symbol text, realized_pnl text, closed_epoch_millis bigint, processed_at timestamptz default now(), raw jsonb)`; `trade_attributions (fill_id text pk, suggestion_id uuid, result text, confirmed_at timestamptz default now())`; **append-only** (trigger reject update/delete như 3.3) vì là bằng chứng
**And** KHÔNG đổi `behavioral_state`/`suggestions`/`config`/`audit_events` schema (chỉ thêm bảng); `suggestions` vẫn bất biến

**AC6 — Đóng seam `account.equity` (thay env seam bằng balance thật) + trade-outcome vào audit**
**Given** `runTick` (3.1) hiện lấy `account.equity` từ env `ACCOUNT_EQUITY` (seam tạm)
**When** có balance thật
**Then** `runTick`/entrypoint dùng `accountPort.readBalance()` cho `account.equity` (thay env seam); lỗi balance ⇒ soft-degrade (skip tick, không phát trên equity không rõ)
**And** `AuditEventType` +`"trade-outcome"`; builder `buildTradeOutcomeEvent(...)` (thuần, nối [[3-3-audit-log-append-only]]) — mỗi trade-outcome (risk & attributed) ghi Nhật ký bất biến (đủ tái dựng: fill, pnl/result, suggestionId nếu attributed, atEpochMillis)

**AC7 — Test phủ từng AC + toolchain sạch**
**Given** Vitest (nền adapters + cron-runner + state 3.1/3.2/3.3)
**When** test reducer + orchestrator + adapter + builder với fake ports/client
**Then** có test cho: `applyRiskOutcome` (loss ⇒ dailyLoss+|pnl|, không đụng streak/count; win pnl ⇒ no-op state) + `applyAttributedOutcome` (win⇒streak+1/count+1; loss⇒streak=0/count+1) — thuần/tất định/decimal; `runFeedback` (fill mới ⇒ applyRisk+write+audit+recordFill; fill đã xử lý ⇒ bỏ qua idempotent; probe lỗi ⇒ skipped); `confirmFill` (ghi attribution + applyAttributed + audit; KHÔNG update suggestions; double-confirm ⇒ no-op); `binance-account` adapter (fetch/signer giả ⇒ balance/closedTrades map đúng; **không** endpoint order; lỗi→Result{ok:false}); `buildTradeOutcomeEvent` payload; `runTick` dùng `readBalance` cho equity
**And** `pnpm -r typecheck && pnpm -r build && pnpm -r lint && pnpm -r test` **tất cả pass**; `*.test.ts` KHÔNG lọt `dist/`

## Tasks / Subtasks

- [x] **Task 1 — `AccountPort` + adapter `binance-account` read-only (AC: #1)**
  - [ ] `packages/decision-core/ports/account.ts`: **NEW** — `AccountBalance = { equity: string }`; `ClosedTrade = { fillId: string; symbol: string; realizedPnl: string; closedEpochMillis: number }`; `AccountPort = { readBalance: () => Promise<Result<AccountBalance>>; readClosedTrades: (sinceEpochMillis: number) => Promise<Result<readonly ClosedTrade[]>> }`. `ports/index.ts` +export
  - [ ] `packages/adapters/binance-account/index.ts` + `normalize.ts`: **NEW** — `createBinanceAccount(deps: { fetchFn?; signer: (query: string) => string; apiKey: string; baseUrl?; logger? }): AccountPort`; gọi read-only signed endpoints (account balance, userTrades); normalize → `AccountBalance`/`ClosedTrade[]` (decimal-string pnl); **KHÔNG** khai báo/gọi endpoint order (POST /order…); lỗi ⇒ `Result{ok:false, source:"adapter.binance_account"}` (soft-degrade). `packages/adapters/index.ts` +export
  - [ ] `signer`/`apiKey` tiêm (secret env, ops); test bơm `signer` giả + `fetchFn` giả (song song `binance-rest`)

- [x] **Task 2 — Tách reducer daily-loss vs attribution (AC: #2)**
  - [ ] `packages/decision-core/state/behavioral.ts`: **thay** `applyTradeOutcome` (3.2) bằng:
    - `applyRiskOutcome(state, { realizedPnl, atEpochMillis })` — `realizedPnl<0` ⇒ `dailyLoss = add(dailyLoss, abs(realizedPnl))`; else state y nguyên; **không** streak/count
    - `applyAttributedOutcome(state, { result, atEpochMillis })` — win⇒winStreak+1; loss⇒winStreak=0; count+1
  - [ ] `abs` từ `math/decimal.ts`; thuần (không mutate/Date/IO); export cả hai; giữ `applyMarketTick` (3.2) nguyên
  - [ ] `packages/decision-core/state/behavioral.test.ts`: **UPDATE** — thay test `applyTradeOutcome` bằng test hai reducer (số tính tay; decimal dailyLoss; thuần/tất định)

- [x] **Task 3 — `PersistencePort` + adapter: dedup fills + attributions (AC: #5)**
  - [ ] `packages/decision-core/ports/persistence.ts`: **+** `hasProcessedFill(fillId: string) => Promise<Result<boolean>>`, `recordProcessedFill(trade: ClosedTrade) => Promise<Result<void>>`, `recordAttribution(input: { fillId: string; suggestionId: string; result: "win"|"loss" }) => Promise<Result<void>>` (additive)
  - [ ] `packages/adapters/postgres/index.ts`: impl 3 method (`select 1 from account_fills where fill_id=$1`; `insert into account_fills(...) on conflict do nothing`; `insert into trade_attributions(...) on conflict do nothing`); lỗi ⇒ `Result{ok:false}`; **không** đổi method cũ
  - [ ] `packages/adapters/postgres/index.test.ts`: **UPDATE** — 3 method với `SqlClient` giả

- [x] **Task 4 — `buildTradeOutcomeEvent` + `AuditEventType` (AC: #6)**
  - [ ] `packages/decision-core/types/index.ts`: `AuditEventType` +`"trade-outcome"`
  - [ ] `packages/decision-core/audit/build.ts`: **+** `buildTradeOutcomeEvent(input: { fillId; realizedPnl?; result?; suggestionId?; atEpochMillis }): AuditEvent` (thuần; payload đủ tái dựng: risk hay attributed). Test trong `audit/build.test.ts`

- [x] **Task 5 — `runFeedback` orchestrator + `confirmFill` (AC: #3, #4)**
  - [ ] `apps/cron-runner/src/feedback.ts`: **NEW** —
    - `runFeedback(deps: { account, persistence, clock, sinceLookbackMs, logger? }): Promise<FeedbackResult>` — `readClosedTrades(now−lookback)` → lỗi ⇒ skipped; với mỗi fill: `hasProcessedFill` false ⇒ `readBehavioralState` → `applyRiskOutcome` → `writeBehavioralState` → `appendAuditEvent(buildTradeOutcomeEvent risk)` → `recordProcessedFill`; đã xử lý ⇒ bỏ qua
    - `confirmFill(deps: { persistence, clock }, input: { fillId, suggestionId, result }): Promise<Result<void>>` — `recordAttribution` → `readBehavioralState` → `applyAttributedOutcome` → `writeBehavioralState` → `appendAuditEvent(buildTradeOutcomeEvent attributed)`; idempotent (attribution `on conflict` + không double count)
  - [ ] Soft-degrade + try/catch bao ngoài (như `runTick`); **KHÔNG** cài lại luật (chỉ reducer + owner write). Export `FeedbackResult`
  - [ ] `apps/cron-runner/src/feedback.test.ts`: **NEW** — fake account/persistence/clock: idempotent, daily-loss đúng, audit gọi, confirm không-double-count

- [x] **Task 6 — Edge Function feedback + confirm + migration + wire equity (AC: #4, #5, #6)**
  - [ ] `apps/cron-runner/functions/feedback/index.ts` (+`deno.json`): **NEW** — Deno entrypoint mỏng dựng `createBinanceAccount` + postgres persistence + clock → `runFeedback`; bắt lỗi → 200
  - [ ] `apps/cron-runner/functions/confirm-fill/index.ts` (+`deno.json`): **NEW** — entrypoint nhận `{fillId,suggestionId,result}` (POST body) → `confirmFill` → JSON. (UI epic 4 gọi endpoint này)
  - [ ] `apps/cron-runner/src/tick.ts`: dùng `accountPort.readBalance()` cho `account.equity` thay env seam (entrypoint `functions/tick/index.ts` dựng accountPort); balance lỗi ⇒ skip tick (không phát trên equity không rõ). **Giữ** market-tick/audit/soft-degrade
  - [ ] `supabase/migrations/<ts>_feedback.sql`: **NEW** — `account_fills`, `trade_attributions` (append-only trigger như 3.3); pg_cron job `brighten-feedback` gọi feedback function (nhịp riêng, vd mỗi 1–5'); read-only grant nối 3.2/3.3
  - [ ] `apps/cron-runner/src/tick.test.ts`: **UPDATE** — equity từ `readBalance` (fake account); balance lỗi ⇒ skipped

- [x] **Task 7 — Tests tổng (AC: #7)**
  - [ ] `packages/adapters/binance-account/index.test.ts` + `normalize.test.ts`: **NEW** — fetch/signer giả; balance/closedTrades map; lỗi→Result; **không** endpoint order
  - [ ] Gom test reducer/orchestrator/adapter/builder (Task 2–5); `pnpm -r test` pass; `dist/` không chứa `*.test.*`

## Dev Notes

> **Bối cảnh:** Story 3.4 hiện thực **AD-7 — feedback loop hybrid**: hệ thống KHÔNG tự đặt lệnh, nên phải *học* kết quả từ hai nguồn — **(a) Binance read-only probe** (vị thế/fill/PnL → `daily-loss`, và `live-drift` ở 3.5) và **(b) user xác nhận** fill↔Đề xuất (→ `win-streak`/R chính xác). Mỗi kết quả sinh event `trade-outcome` cập nhật behavioral state qua **owner path 3.2** (`writeBehavioralState`). Đây là story **cấp NGUỒN** cho `trade-outcome` mà 3.2 để trống. Khóa API v1 **chỉ đọc** — không bao giờ có quyền đặt lệnh (AD-7/AD-10).

> **Phụ thuộc:** build trên **3.2** (`applyTradeOutcome`→tách; `writeBehavioralState` owner) + **3.3** (audit append-only; `buildXxxEvent`; catch "suggestions bất biến" ⇒ attribution ở bảng riêng) + **3.1** (persistence/tick/adapter). [Source: 3-1…md, 3-2…md, 3-3…md]

### 🔑 Hai nguồn = hai reducer = hai hiệu ứng tách bạch (đừng gộp)

- **Probe (tự động) → daily-loss (rủi ro thật):** mọi lệnh đóng có PnL âm ⇒ cộng `dailyLoss` — **kể cả lệnh discretionary** (rủi ro là rủi ro; spine deferred-decision: discretionary tính daily-loss/drift). `applyRiskOutcome`. Không đụng win-streak.
- **Confirm (user) → win-streak/R (edge hệ thống):** chỉ fill user xác nhận "là của Đề xuất X" mới +/reset win-streak + đếm — vì win-streak đo **edge của hệ thống**, không phải lệnh tay. `applyAttributedOutcome`.
- Tách hai reducer khớp **đúng** AC gốc ("read-only → daily-loss & live-drift; user confirm → win-streak/R"). Gộp lại sẽ hoặc double-count hoặc gán sai win-streak cho lệnh tay. [Source: epics.md → 3.4; ARCHITECTURE-SPINE.md#AD-7, #Deferred "Lệnh discretionary"]
- **Không double-count daily-loss:** một lệnh lỗ hệ thống: probe cộng daily-loss (AC3), confirm chỉ thêm win-streak (AC4) — daily-loss **không** cộng lần hai. Test khẳng định.

### 🔑 Attribution ở bảng RIÊNG (giải toả catch 3.3)

- `suggestions` **bất biến** (AD-8, 3.3) ⇒ **không** UPDATE để đánh dấu "đã confirm fill". Thay vào đó `confirmFill` ghi `trade_attributions(fill_id, suggestion_id, result)` — bảng riêng, append-only. Đây đúng là hướng mình đã cảnh báo ở [[3-3-audit-log-append-only]] "Cần xác nhận #2". [Source: 3-3…md → Cần xác nhận; ARCHITECTURE-SPINE.md#AD-8]

### 🔑 An toàn khóa read-only (AD-7, AD-10) — ràng buộc SAFETY

- Adapter `binance-account` **chỉ** khai báo/gọi endpoint read-only (account, userTrades). **KHÔNG tồn tại** đường code POST order/cancel — assert review + không import hằng endpoint order. Khóa API cấp quyền read-only (ops). Đây là ràng buộc SAFETY cứng: "khóa API v1 chỉ đọc, không bao giờ có quyền đặt lệnh". [Source: ARCHITECTURE-SPINE.md#AD-7, #AD-10; prd.md §11 SAFETY]

### 🔑 Idempotent probe — không double-count

- Probe chạy định kỳ (cron riêng) trên `readClosedTrades(since)`; **phải** dedup: `account_fills(fill_id pk)` + `hasProcessedFill` ⇒ chỉ fill mới áp `applyRiskOutcome`. `on conflict do nothing`. Probe lại cùng dữ liệu ⇒ state không đổi. Cursor `since = now − lookback` (đủ phủ độ trễ); dedup lo phần chồng. [Source: ARCHITECTURE-SPINE.md#AD-2 (tất định); #Consistency Conventions]

### Hợp đồng đã có (PHẢI tuân) — sau 3.1/3.2/3.3

| File | Trạng thái | Story 3.4 đổi gì | Phải giữ nguyên |
| --- | --- | --- | --- |
| `packages/decision-core/state/behavioral.ts` (3.2) | `applyMarketTick` + `applyTradeOutcome` (gộp) | **tách** `applyRiskOutcome`+`applyAttributedOutcome`; giữ `applyMarketTick` | `applyMarketTick`; thuần/decimal |
| `packages/decision-core/ports/persistence.ts` | read/write state, save suggestion, appendAudit (3.1–3.3) | **+3 method** feedback (additive) | method cũ; `writeBehavioralState` owner (3.2) |
| `packages/decision-core/ports/index.ts` | export ports | **+`AccountPort`** | export cũ |
| `packages/decision-core/audit/build.ts` (3.3) | emitted/blocked builder | **+`buildTradeOutcomeEvent`**; `AuditEventType`+`trade-outcome` | builder cũ |
| `packages/adapters/postgres/index.ts` | read/write/save/append (3.1–3.3) | **+3 method** feedback impl | method cũ; `SqlClient` tiêm |
| `apps/cron-runner/src/tick.ts` | market-tick + pipeline + audit; equity từ env | **equity từ `readBalance`** | market-tick(3.2)/audit(3.3)/soft-degrade |
| `supabase/migrations/…` | config/state/suggestions/audit (3.1–3.3) | **+`account_fills`,`trade_attributions`** (append-only) + cron feedback | migration cũ (không sửa); `suggestions` bất biến |
| `packages/decision-core/types/index.ts` | `AccountState{equity}` placeholder | (không bắt buộc đổi; `AccountBalance` ở port) | `AccountState` (tier3 đọc `equity`) |

[Source: các file 3.1–3.3 đã dẫn; packages/decision-core/ports/*, state/*, audit/*; packages/adapters/postgres; apps/cron-runner/src/tick.ts]

### Invariant kiến trúc PHẢI tuân

- **AD-7 — feedback hybrid:** hai nguồn (read-only probe + user confirm); trade-outcome cập nhật state; khóa chỉ đọc. [Source: #AD-7]
- **AD-10 — không tự đặt lệnh:** không đường code order; user xác nhận thủ công trên sàn. [Source: #AD-10]
- **AD-6 — một owner:** state đổi qua `writeBehavioralState` (owner), reducer thuần; UI read-only. [Source: #AD-6]
- **AD-8 — append-only:** `account_fills`/`trade_attributions`/audit bất biến; attribution KHÔNG sửa `suggestions`. [Source: #AD-8]
- **AD-2 — tất định:** reducer thuần; probe idempotent (dedup) ⇒ tái lập. [Source: #AD-2]
- **AD-11/NFR-5 — suy giảm mềm:** probe lỗi ⇒ skip + log, không throw/không phát trên số liệu không rõ. [Source: #AD-11]

### Ngoài phạm vi story này (đừng làm — để story sau)

- **Tính live-drift (dùng chuỗi R từ attributed outcomes) + auto-halt** — **3.5** (FR-10). 3.4 chỉ cấp dữ liệu (daily-loss + R attributed); 3.5 tính drift & phanh.
- **UI xác nhận fill↔Đề xuất** — **epic 4** (FR-13). 3.4 cấp backend `confirmFill` + endpoint; nút bấm sau.
- **Override friction** — **3.6** (FR-12).
- **Phân loại lệnh discretionary vs không** tinh vi (matching tự động fill↔suggestion) — v1: user confirm thủ công là nguồn attribution; auto-match (theo giá/thời gian) là v2.
- **`max_trades_per_day` đếm lúc entry** — 3.4 đếm `tradeCountToday` khi **attributed outcome** (lệnh hệ thống đã xác nhận). Nếu cần chặn ngay lúc vào, thêm event entry (tùy chọn) — mặc định đếm lúc confirm.
- **Realtime push khi có trade-outcome** — epic 4.

### Source tree mục tiêu (phần thêm/đổi)

```text
packages/decision-core/
  ports/account.ts               # NEW: AccountPort + AccountBalance + ClosedTrade
  ports/persistence.ts           # UPDATE: +hasProcessedFill/recordProcessedFill/recordAttribution
  ports/index.ts                 # UPDATE: +export AccountPort
  state/behavioral.ts            # UPDATE: applyTradeOutcome → applyRiskOutcome + applyAttributedOutcome
  state/behavioral.test.ts       # UPDATE
  audit/build.ts                 # UPDATE: +buildTradeOutcomeEvent; AuditEventType +trade-outcome
  audit/build.test.ts            # UPDATE
packages/adapters/binance-account/
  index.ts, normalize.ts         # NEW: read-only account adapter (fetch/signer tiêm)
  index.test.ts, normalize.test.ts # NEW
packages/adapters/postgres/
  index.ts, index.test.ts        # UPDATE: +3 feedback method
apps/cron-runner/src/
  feedback.ts, feedback.test.ts  # NEW: runFeedback + confirmFill
  tick.ts, tick.test.ts          # UPDATE: equity từ readBalance
  functions/feedback/, functions/confirm-fill/ # NEW: Deno entrypoints (+deno.json)
supabase/migrations/
  <ts>_feedback.sql              # NEW: account_fills + trade_attributions (append-only) + cron feedback
```
[Source: ARCHITECTURE-SPINE.md#Structural Seed; bố cục 3.1–3.3 làm khuôn]

### Project Structure Notes

- **`binance-account` là adapter riêng** (không nhồi vào `binance-rest`): endpoint **ký** (HMAC) khác public market data; tách giữ `binance-rest` public sạch. `signer`/`apiKey` tiêm ⇒ test không secret thật.
- **Không endpoint order**: điểm SAFETY — review PR phải xác nhận `binance-account` không có hằng/đường POST order. Cân nhắc lint/test grep chặn chuỗi `"/order"`.
- **Reducer tách** chạm `behavioral.ts` của 3.2 (chưa merge lúc soạn) — nếu 3.2 đã merge, đây là refactor nhỏ + cập nhật test; nếu chưa, phối hợp thứ tự. `applyMarketTick` không đụng.
- **`confirmFill` không đọc snapshot/pipeline** — chỉ state + persistence; thuần-composition. `runFeedback` cũng vậy (KHÔNG chạy pipeline — khác `runTick`). Hai orchestrator độc lập.
- **Cron feedback nhịp riêng**: probe không cần mỗi phút; 1–5' đủ (fill đóng không tức thời). Tách job `brighten-feedback` khỏi `brighten-live-tick`.
- **Equity seam**: `runTick` dùng `readBalance` ⇒ đóng seam `ACCOUNT_EQUITY` env (3.1). Balance lỗi ⇒ skip tick (không size trên equity sai). Backtest vẫn dùng seam `strategyInput.account` (offline, không probe) — không đụng.
- **Idempotency & thời gian**: `readClosedTrades(since)` + dedup `account_fills`; `since = clock.now − lookback`. Không dùng `Date` trong reducer (clock ở orchestrator).

### Chuẩn test

- **Reducer**: `applyRiskOutcome` loss `realizedPnl="-30"` ⇒ `dailyLoss` +30 (decimal), streak/count nguyên; pnl≥0 ⇒ no-op. `applyAttributedOutcome` win⇒streak+1/count+1; loss⇒streak=0/count+1. structuredClone/2×toEqual/typeof string.
- **runFeedback**: fake account trả 2 fill (1 mới,1 đã xử lý qua `hasProcessedFill`) ⇒ chỉ 1 áp daily-loss + 1 audit + recordFill; probe lỗi ⇒ skipped; không throw.
- **confirmFill**: ghi attribution + applyAttributed + audit; gọi 2 lần cùng fill ⇒ attribution on-conflict, không double win-streak; KHÔNG update `suggestions`.
- **binance-account**: fetch/signer giả ⇒ balance decimal, closedTrades map (pnl string); lỗi HTTP/parse ⇒ Result{ok:false}; grep-assert không có `"/order"`/order endpoint.
- **tick equity**: fake account `readBalance` ⇒ tick dùng equity đó; balance lỗi ⇒ skipped.
- Không mạng/DB thật (fake `fetchFn`/`SqlClient`/ports).

### References

- [Source: epics.md → Epic 3, Story 3.4] — AC gốc (BDD): read-only phát hiện vị thế/fill/PnL cho daily-loss & live-drift (khóa không đặt lệnh); user xác nhận fill↔Đề xuất → win-streak/R; sinh `trade-outcome` cập nhật state (nối AD-6)
- [Source: prd.md#FR-10 (live-drift dùng dữ liệu này), §11 SAFETY] — khóa read-only, không tự đặt lệnh
- [Source: ARCHITECTURE-SPINE.md#AD-7] — feedback hybrid; hai nguồn; khóa chỉ đọc
- [Source: ARCHITECTURE-SPINE.md#AD-10] — không đường tự gửi lệnh; user xác nhận thủ công
- [Source: ARCHITECTURE-SPINE.md#AD-6] — owner state; trade-outcome là một trong hai event; write qua owner
- [Source: ARCHITECTURE-SPINE.md#AD-8] — append-only; attribution KHÔNG sửa Đề xuất bất biến
- [Source: ARCHITECTURE-SPINE.md#Deferred "Lệnh discretionary"] — discretionary → daily-loss/drift, không win-streak (mặc định reducer tách)
- [Source: ARCHITECTURE-SPINE.md#AD-2, #AD-11] — tất định (dedup idempotent); suy giảm mềm khi probe lỗi
- [Source: 3-2-behavioral-state-durable-owner.md] — `applyTradeOutcome`/`writeBehavioralState`/owner (tách reducer, dùng owner write)
- [Source: 3-3-audit-log-append-only.md] — `buildXxxEvent`/`AuditEventType`/append-only; catch "suggestions bất biến" → attribution bảng riêng
- [Source: apps/cron-runner/src/tick.ts] — `runTick` (equity seam env; khuôn orchestrator soft-degrade)
- [Source: packages/adapters/binance-rest/index.ts] — khuôn adapter fetch-injected (mẫu cho `binance-account` + signer)
- [Source: packages/adapters/postgres/index.ts] — `SqlClient` tiêm; khuôn +method feedback
- [Source: packages/decision-core/ports/persistence.ts, types/index.ts] — port +method; `AccountState` placeholder

## Cần xác nhận (không chặn draft)

- **Nhịp cron feedback & lookback probe**: mặc định job riêng ~1–5' + `readClosedTrades(now − lookback)` + dedup. Anh muốn probe trong chính tick (~1') hay job riêng thưa hơn?
- **`tradeCountToday` đếm lúc confirm (attributed)** — nếu muốn `max_trades_per_day` chặn ngay lúc **vào** lệnh (trước khi đóng/confirm), cần thêm event entry (user báo "đã vào"). Mặc định đếm lúc confirm outcome.
- **Auto-match fill↔suggestion**: v1 user confirm thủ công. Có muốn thử auto-match theo giá/thời gian (giảm thao tác) ngay v1 không, hay để v2?

## Dev Agent Record

### Agent Model Used

Claude (deepseek-v4-pro)

### Debug Log References

### Completion Notes List

- **Task 1**: Created `AccountPort` (read-only balance + closedTrades) in `packages/decision-core/ports/account.ts` with `AccountBalance` and `ClosedTrade` types (decimal-string PnL). Built `binance-account` adapter with HMAC-signed read-only endpoints (GET /fapi/v2/account + GET /fapi/v1/userTrades), `fetchFn`/`signer` injection, soft-degrade on errors. No order endpoint code exists (AD-10 safety).
- **Task 2**: Split `applyTradeOutcome` into two pure reducers: `applyRiskOutcome` (probe source: adds abs(realizedPnl) to dailyLoss on negative PnL, doesn't touch streak/count) and `applyAttributedOutcome` (user-confirm source: win→streak+1/count+1, loss→streak=0/count+1, doesn't touch dailyLoss). Updated state/index.ts exports. Updated behavioral.test.ts with 15 tests for both reducers.
- **Task 3**: Added 3 additive methods to `PersistencePort`: `hasProcessedFill`, `recordProcessedFill`, `recordAttribution`. Implemented in postgres adapter with parameterized queries + on-conflict-do-nothing for idempotency. Added 5 tests.
- **Task 4**: Added `"trade-outcome"` to `AuditEventType` union. Built `buildTradeOutcomeEvent` builder (pure, supports both risk probe and attributed confirm payloads). Added 4 tests.
- **Task 5**: Created `runFeedback` orchestrator (readClosedTrades → dedup via hasProcessedFill → applyRiskOutcome → writeBehavioralState → audit → recordProcessedFill) and `confirmFill` (recordAttribution → read state → applyAttributedOutcome → writeBehavioralState → audit). Both soft-degrade + try/catch. Created feedback.test.ts with 7 tests.
- **Task 6**: Created migration `20260705020000_feedback.sql` (account_fills + trade_attributions tables with append-only triggers, pg_cron feedback job). Created Deno Edge Function entrypoints `functions/feedback/index.ts` and `functions/confirm-fill/index.ts`. Updated `runTick` to resolve equity from `AccountPort.readBalance()` with fallback to config seam. Equity read failure → skip tick.
- **Task 7**: Added 30 new tests: behavioral (15), audit/build (4), feedback.test.ts (7), binance-account/index.test.ts (5), binance-account/normalize.test.ts (5), postgres/index.test.ts (5). Total: 329 tests pass (up from 302). Zero test artifacts in dist.

### File List

- `packages/decision-core/ports/account.ts` (NEW)
- `packages/decision-core/ports/index.ts` (MODIFIED — +AccountPort export)
- `packages/decision-core/ports/persistence.ts` (MODIFIED — +3 feedback methods)
- `packages/decision-core/types/index.ts` (MODIFIED — AuditEventType +trade-outcome)
- `packages/decision-core/state/behavioral.ts` (MODIFIED — split applyTradeOutcome → applyRiskOutcome + applyAttributedOutcome)
- `packages/decision-core/state/behavioral.test.ts` (MODIFIED — rewritten for split reducers)
- `packages/decision-core/state/index.ts` (MODIFIED — updated exports)
- `packages/decision-core/audit/build.ts` (MODIFIED — +buildTradeOutcomeEvent)
- `packages/decision-core/audit/build.test.ts` (MODIFIED — +4 trade-outcome tests)
- `packages/decision-core/audit/index.ts` (MODIFIED — +export)
- `packages/adapters/binance-account/index.ts` (NEW)
- `packages/adapters/binance-account/index.test.ts` (NEW)
- `packages/adapters/binance-account/normalize.ts` (NEW)
- `packages/adapters/binance-account/normalize.test.ts` (NEW)
- `packages/adapters/index.ts` (MODIFIED — +binance-account export)
- `packages/adapters/postgres/index.ts` (MODIFIED — +3 feedback methods)
- `packages/adapters/postgres/index.test.ts` (MODIFIED — +5 feedback tests)
- `apps/cron-runner/src/feedback.ts` (NEW)
- `apps/cron-runner/src/feedback.test.ts` (NEW)
- `apps/cron-runner/src/tick.ts` (MODIFIED — equity from AccountPort.readBalance)
- `apps/cron-runner/src/tick.test.ts` (MODIFIED — +3 PersistencePort stubs)
- `apps/cron-runner/functions/feedback/index.ts` (NEW)
- `apps/cron-runner/functions/confirm-fill/index.ts` (NEW)
- `supabase/migrations/20260705020000_feedback.sql` (NEW)

## Change Log

- 2026-07-05: Story 3.4 implementation — AccountPort + binance-account read-only adapter (no order endpoints, AD-10), split trade-outcome reducers (risk vs attributed, AD-7), feedback orchestrator with idempotent probe + confirmFill, audit trade-outcome events, migration with append-only tables + cron feedback job, equity wired from live balance. All 329 tests pass, 0 regressions.
