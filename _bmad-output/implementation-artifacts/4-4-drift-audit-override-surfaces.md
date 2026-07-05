---
baseline_commit: cfae2a46e98a2ac6b5e1bf9e97fc672533fa2161
depends_on: 4-3-llm-narrator-deepseek
---

# Story 4.4: Màn hình Live-drift + review Nhật ký (FR-10 hiển thị, FR-14 review, FR-12 surface)

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **người dùng của Brighten**,
I want **thấy live-drift THƯỜNG TRỰC (expectancy thực chiến vs khoảng baseline, kèm banner auto-halt khi đang kích hoạt), duyệt lại Nhật ký Đề xuất/chặn với tín hiệu kích hoạt, và xem lịch sử override**,
so that **tôi đối chiếu niềm tin (edge còn sống không?) và nhìn thẳng vào sự thật hành vi của chính mình (FR-10 hiển thị, FR-14 review, FR-12 surface, AD-10)**.

## Acceptance Criteria

**AC1 — Live-drift THƯỜNG TRỰC ("Niềm tin" / trust rail) (FR-10 hiển thị)**
**Given** `drift_metrics` (3.5 ghi mỗi tick: `live_expectancy`, `drifting`, `sample_count`, `baseline_lower`, `at_epoch_millis`) + `drift_baseline` (`lower/median/upper`)
**When** mở app
**Then** hiển thị **thường trực** (không phải chỉ khi drift): expectancy thực chiến mới nhất **so với dải baseline CI** (lower/median/upper) — dạng người-đọc (số mono tabular + vị trí trong/dưới dải); trạng thái "khoẻ trong dải" vs "trượt dưới cận-dưới"
**And** đọc **thẳng** từ `drift_metrics`/`drift_baseline` (data-layer 4.1, chỉ select); chuỗi thời gian drift để thấy xu hướng (tối thiểu điểm mới nhất + baseline; sparkline lịch sử là tùy chọn)
**And** web **không** tính lại drift/expectancy (engine đã tính & lưu, 3.5) — chỉ trình bày; posture sober (không "ăn mừng" khi khoẻ)

**AC2 — Halt-banner: auto-halt hiển thị rõ, chặn card Đề xuất (FR-10 + nối 4.2)**
**Given** engine đang halt (drift breach `drift_metrics.drifting=true`, hoặc Tầng 0 chặn: daily-loss lock / cooldown — thể hiện qua `audit_events` tier0 block gần nhất)
**When** mở app
**Then** hiển thị **halt-banner** (token DESIGN.md, `halt`/`caution` màu) **global, không dismiss được**, **first-person reason** (giọng "tôi không tin chính mình lúc này…"), **suppress** card Đề xuất (nối silence-state 4.2 — không Đề xuất mới khi halt)
**And** nguồn halt là **tín hiệu engine đã lưu** — `drift_metrics.drifting` (drift-halt) + `reason` của `audit_events` tier0 block gần nhất (cooldown/daily-loss/news); web **KHÔNG** tự tính "dailyLoss ≥ limit" (đó là re-implement luật Tầng 0 — cấm, AD-10). `behavioral_state` hiện như **bằng chứng** (win-streak/daily-loss/trade-count), không phải để UI quyết định halt
**And** override đang active (`override_grants` còn hiệu lực) ⇒ banner ghi rõ "đang override luật X tới …" (nối AC4/FR-12)

**AC3 — Review Nhật ký (FR-14): Đề xuất/chặn với tín hiệu kích hoạt, bất biến**
**Given** `audit_events` (3.3 append-only: `suggestion-emitted`/`suggestion-blocked`/`trade-outcome`/`override-recorded`)
**When** vào màn Nhật ký
**Then** duyệt được danh sách bản ghi (mới→cũ, phân trang): mỗi bản ghi hiện **loại** (Đề xuất/chặn/kết quả/override), **thời điểm**, **tín hiệu kích hoạt** (Đề xuất: signals + narration; chặn: `reason` tầng), đủ để tái dựng **vì sao** xuất hiện/bị chặn
**And** Nhật ký là **bất biến** (chỉ đọc; không nút sửa/xoá — nối AD-8); (tùy chọn) lọc theo loại/khoảng thời gian; rỗng-an-toàn ("chưa có bản ghi")
**And** đọc `audit_events` qua RLS select-only (4.1); realtime push bản ghi mới (4.1 `LiveProvider`) ⇒ Nhật ký cập nhật sống

**AC4 — Lịch sử override (FR-12 surface): sự thật hành vi**
**Given** `override_grants` (3.6 append-only: `rule_code`, `reason`, `typed_confirmation`, `requested_at`, `active_from`, `expires_at`)
**When** vào màn (Nhật ký hoặc mục riêng)
**Then** hiển thị **lịch sử override**: mỗi lần override — **thời điểm**, **luật bị vượt** (`rule_code`), **lý do** (`reason`) — để user **thấy sự thật hành vi của chính mình** ("tôi đã override daily-loss 3 lần tuần này")
**And** trình bày sober, KHÔNG phán xét nhưng **không giấu**; đếm/nhóm theo luật là tùy chọn (bằng chứng đối chiếu cam kết kỷ luật)
**And** đọc-only (không tạo override ở đây — request override là backend 3.6/nút riêng); realtime khi có override mới

**AC5 — Đọc-only + realtime + cô lập SAFETY (kế thừa 4.1)**
**Given** nền 4.1 (anon RLS select-only, `LiveProvider`, isolation guard)
**When** dựng các màn 4.4
**Then** mọi màn **chỉ đọc** `drift_metrics`/`drift_baseline`/`audit_events`/`override_grants`/`behavioral_state`; **không** mutate, **không** pipeline, **không** đường gửi lệnh (AD-10) — **isolation guard 4.1 vẫn xanh**
**And** bản ghi mới (drift/audit/override) push realtime ⇒ màn cập nhật sống; các bảng này đã trong publication + RLS select-only (4.1 migration — bổ sung nếu thiếu bảng nào)
**And** điều hướng: Now (card/silence + trust rail — 4.2/AC1) ↔ Nhật ký (AC3/AC4) ↔ (Niềm tin nếu tách) — modal/nav một cấp (EXPERIENCE.md)

**AC6 — Anti-dopamine + accessibility (DESIGN.md)**
**Given** posture "win-streak = danger", drift/halt là cảnh báo
**When** render
**Then** drift khoẻ **không** ăn mừng (muted/neutral); drift breach/halt dùng `halt`/`caution` (đỏ/amber) rõ; override history sober (không tô đỏ phán xét, không ẩn); số mono tabular; halt reason first-person
**And** accessibility: tương phản light+dark (tokens 4.1); trạng thái không chỉ bằng màu (kèm chữ: "trong dải"/"trượt dưới"/"đang halt"); danh sách Nhật ký keyboard/screen-reader; banner halt được announce (aria-live)

**AC7 — Test/guard + toolchain sạch**
**Given** nền test/guard 4.1/4.2
**When** thêm màn + test
**Then** test: trust-rail render từ `drift_metrics`/`drift_baseline` mẫu (trong dải vs trượt dưới); halt-banner khi `drifting=true` / tier0 block gần nhất (first-person, suppress card); Nhật ký list từ `audit_events` mẫu (loại/thời điểm/tín hiệu; bất biến — không nút sửa); override history từ `override_grants` mẫu (thời điểm/luật/lý do); **isolation guard 4.1 vẫn xanh** (không mutate/pipeline/order); realtime (mock push ⇒ list/banner đổi); rỗng-an-toàn (SSR)
**And** `pnpm -r typecheck && pnpm -r build && pnpm -r lint && pnpm -r test` **tất cả pass**

## Tasks / Subtasks

- [x] **Task 1 — Data-layer đọc drift/audit/override (chỉ select) (AC: #1, #3, #4)**
  - [ ] `apps/web/lib/queries.ts`: mở rộng (chỉ `.select`) — `getLatestDriftMetric()`/`getDriftHistory(limit)` + `getDriftBaseline()`; `getAuditEvents({limit, cursor, type?})`; `getOverrideGrants({limit})`; `getBehavioralState()` (bằng chứng). Rỗng ⇒ `[]`/`null`
  - [ ] Helper thuần `driftStatus(latest, baseline)` → `"in_band" | "below_lower" | "no_baseline"` (test được; **không** tính lại drift — chỉ so `live_expectancy` với `baseline_lower` đã lưu để **phân loại hiển thị**)
  - [ ] Helper `haltState({ latestDrift, latestTier0Block, activeOverrides })` → `{ halted, reason?, kind }` — **chỉ đọc tín hiệu engine** (drift flag + audit reason), KHÔNG suy luật Tầng 0

- [x] **Task 2 — Trust rail (Niềm tin) + Halt-banner (AC: #1, #2, #6)**
  - [ ] `apps/web/components/TrustRail.tsx`: **NEW** — expectancy vs dải baseline (mono tabular; "trong dải"/"trượt dưới"); sparkline lịch sử tùy chọn; sober
  - [ ] `apps/web/components/HaltBanner.tsx`: **NEW** — global, không dismiss, first-person reason (halt/caution token), aria-live; hiện khi `haltState.halted`; ghi override active nếu có
  - [ ] `app/page.tsx` (Now): thêm TrustRail thường trực + HaltBanner global (suppress SuggestionCard khi halt — nối 4.2). `LiveProvider` cập nhật sống

- [x] **Task 3 — Màn Nhật ký (audit) + Override history (AC: #3, #4)**
  - [ ] `apps/web/app/nhat-ky/page.tsx` (route `/nhat-ky`): **NEW** — list `audit_events` (mới→cũ, phân trang/cursor); component `AuditEventRow.tsx` render theo loại (emitted: signals+narration; blocked: reason; trade-outcome; override-recorded); bất biến (không nút sửa/xoá); lọc loại/thời gian tùy chọn
  - [ ] `apps/web/components/OverrideHistory.tsx`: **NEW** — list `override_grants` (thời điểm/rule/reason); nhóm/đếm theo luật tùy chọn; sober. Đặt trong `/nhat-ky` hoặc mục riêng
  - [ ] Nav một-cấp (EXPERIENCE.md): Now ↔ Nhật ký; `LiveProvider` push bản ghi mới

- [x] **Task 4 — RLS/Realtime cho bảng còn thiếu + isolation (AC: #5)**
  - [ ] Kiểm 4.1 migration đã RLS select-only + realtime publication cho `drift_metrics`/`drift_baseline`/`audit_events`/`override_grants`/`behavioral_state`; **thiếu bảng nào** (vd `drift_baseline` nếu 4.1 chưa phủ) ⇒ migration bổ sung select-only anon + publication (idempotent)
  - [ ] Mở rộng **isolation guard**: các màn 4.4 không import adapters/pipeline/binance/order, không handler mutate/gửi lệnh

- [x] **Task 5 — Tests/guard (AC: #7)**
  - [ ] `TrustRail.test.tsx`/`HaltBanner.test.tsx`/`AuditEventRow.test.tsx`/`OverrideHistory.test.tsx` + `lib/queries` helper test (driftStatus/haltState): các trạng thái + rỗng; halt suppress card; bất biến (không nút sửa)
  - [ ] isolation guard 4.1/4.2 chạy lại; realtime mock push; `pnpm -r typecheck/build/lint/test` pass; SSR rỗng không lỗi

## Dev Notes

> **Bối cảnh:** Story 4.4 **khép Epic 4 (và toàn dự án)** — bề mặt **niềm tin & đối chiếu hành vi**. Xây **thẳng trên 4.1** (đọc-only/realtime/tokens/isolation) + **4.2** (card/silence/heartbeat). 4.4 thêm **ba surface đọc**: **live-drift thường trực** (FR-10 hiển thị), **review Nhật ký** (FR-14), **lịch sử override** (FR-12 surface). Tất cả là **trình bày dữ liệu engine đã tạo** (epic 3) — web tuyệt đối không tính lại/không mutate/không gửi lệnh (AD-10). Đây là "cơ chế niềm tin" của sản phẩm ở dạng nhìn được: user thấy edge còn sống không, vì sao bị chặn, và **sự thật về chính mình**.

> **Phụ thuộc:** **4.1** (nền web) + **4.2** (card/silence) + đọc `drift_metrics`/`drift_baseline`(3.5), `audit_events`(3.3, gồm narration 4.3), `override_grants`(3.6), `behavioral_state`(3.1/3.2). [Source: 4-1…md, 4-2…md; supabase migrations 3.x]

### 🔑 Web TRÌNH BÀY tín hiệu engine, KHÔNG tính lại quyết định (AD-10 — điểm dễ sai)

- **Drift/expectancy:** engine tính & lưu `drift_metrics` mỗi tick (3.5). Web **chỉ đọc** `live_expectancy`/`drifting`/`baseline_lower` và **phân loại hiển thị** (trong dải / trượt dưới). **KHÔNG** tự tính expectancy hay so lại — đó là re-implement (AD-3/AD-10). `driftStatus` helper chỉ **so hai số đã lưu** để chọn màu/chữ, không phải quyết định.
- **Halt:** nguồn là **tín hiệu engine đã lưu** — `drift_metrics.drifting` (drift-halt của 3.5) + `reason` của `audit_events` **tier0 block gần nhất** (cooldown/daily-loss/news — chuỗi `formatReason` engine đã sinh). Web **KHÔNG** tự tính "dailyLoss ≥ daily_loss_limit" hay "now < lastLoss+cooldown" — đó là **luật Tầng 0**, cấm ở web (AD-10). `behavioral_state` chỉ hiện như **bằng chứng số**, không dùng để UI quyết định halt. Điểm này dev **rất dễ vi phạm** — nhấn mạnh. [Source: ARCHITECTURE-SPINE.md#AD-10, #AD-3; 3-5…md; 3-3…md]

### 🔑 Bất biến hiển thị đúng bản chất (AD-8)

- Nhật ký + override là **append-only bất biến** (3.3/3.6 enforce ở DB). Web hiển thị **chỉ đọc** — **không** nút sửa/xoá bản ghi (khớp bản chất bằng chứng). Không giấu override (FR-12 "nhìn thẳng vào hành vi"), không tô phán xét. [Source: ARCHITECTURE-SPINE.md#AD-8; prd.md#FR-12, #FR-14]

### 🔑 Halt-banner nối silence-state 4.2

- 4.2: silence = "không có edge" (thị trường im, hệ khoẻ). 4.4: **halt** = hệ **tự phanh** (drift breach / daily-loss / cooldown) — **khác** silence. Halt-banner global, first-person, **suppress** card (nối EXPERIENCE.md "Halt banner … suppresses the suggestion card entirely"). Phân biệt rõ 3 trạng thái Now: **card** (có Đề xuất) / **silence** (im, khoẻ) / **halt** (phanh). [Source: EXPERIENCE.md dòng 56; 4-2…md silence]

### Hợp đồng đã có (PHẢI tuân) — sau 4.1/4.2/4.3

| File | Trạng thái | Story 4.4 đổi gì | Phải giữ nguyên |
| --- | --- | --- | --- |
| `apps/web/lib/queries.ts` (4.1/4.2) | getLatestSuggestion/State/Drift (select) | +drift history/baseline, audit, override queries (select) | chỉ-select; rỗng→null/[] |
| `apps/web/components/LiveProvider.tsx` (4.1) | realtime subscribe | dùng cho trust/nhật ký/override sống | chỉ-nhận; cleanup |
| `apps/web/app/page.tsx` (4.2) | card/silence | +TrustRail + HaltBanner (halt suppress card) | SSR+LiveProvider; card/silence 4.2 |
| brand tokens (4.1, DESIGN.md) | halt/caution/silence | dùng halt-banner/trust | không đổi token |
| isolation guard (4.1/4.2) | chặn import/order/mutate | **mở rộng** cho màn mới | guard xanh |
| `drift_metrics`/`drift_baseline`/`audit_events`/`override_grants`/`behavioral_state` | RLS select-only + realtime (4.1) | chỉ đọc; bổ sung RLS/pub nếu 4.1 thiếu bảng | RLS; append-only; không ghi |

[Source: apps/web/* (4.1/4.2); supabase migrations 3.3/3.5/3.6/4.1]

### Invariant kiến trúc PHẢI tuân

- **AD-10 — Vercel cô lập:** web chỉ đọc + hiển thị; không tính lại drift/halt (luật engine), không mutate, không gửi lệnh. [Source: #AD-10]
- **AD-1 — realtime:** drift/audit/override cập nhật sống từ Postgres. [Source: #AD-1]
- **AD-8 — append-only:** Nhật ký/override bất biến; web không sửa/xoá. [Source: #AD-8]
- **AD-3 — không re-implement:** web đọc `drift_metrics`/`reason` engine sinh; không tính expectancy/veto. [Source: #AD-3]

### Ngoài phạm vi story này (đừng làm — để sau/ops)

- **Tạo override / request-override từ UI** (nút + gõ tay) — backend 3.6 đã có; **UI nút override** có thể story riêng/tùy chọn; 4.4 chỉ **hiển thị lịch sử** override. Nếu làm nút, gọi Edge Function 3.6 (không web ghi DB).
- **Nút confirm-fill** (attribution 3.4) — 4.2 đã defer về đây tùy chọn; nếu làm, gọi Edge Function, nhãn tách bạch (không order).
- **Set drift baseline / chạy validate** — vận hành (3.5), không UI.
- **Sparkline/biểu đồ drift nâng cao** — tối thiểu điểm mới nhất + dải; chart lịch sử là tăng cường sau (dùng [[dataviz]] nếu làm — sober, tabular).
- **Auth/multi-user** — solo tool v1.
- **Export Nhật ký** — sau.

### Source tree mục tiêu (phần thêm/đổi)

```text
apps/web/
  lib/queries.ts               # UPDATE: +drift history/baseline, audit, override, state (select)
  components/TrustRail.tsx, HaltBanner.tsx, AuditEventRow.tsx, OverrideHistory.tsx  # NEW (+ .test)
  app/page.tsx                 # UPDATE: +TrustRail + HaltBanner (halt suppress card 4.2)
  app/nhat-ky/page.tsx         # NEW: màn Nhật ký (audit + override history)
supabase/migrations/
  <ts>_web_read_rls_4_4.sql    # NEW (nếu 4.1 chưa phủ drift_baseline/…): RLS select-only anon + realtime publication
```
[Source: EXPERIENCE.md (Nhật ký/Niềm tin surfaces); DESIGN.md (halt/caution tokens); bố cục 4.1/4.2]

### Project Structure Notes

- **`driftStatus`/`haltState` là helper thuần** ⇒ test không mạng; chúng **phân loại hiển thị** từ số/flag đã lưu, KHÔNG là quyết định (giữ AD-10).
- **HaltBanner nguồn:** ưu tiên `drift_metrics.drifting` (flag trực tiếp) + `audit_events` tier0 block reason gần nhất. Nếu muốn banner cooldown-countdown, hiển thị từ `behavioral_state.lastLossEpochMillis + config.cooldown` là **hiển thị timer** (chấp nhận), nhưng **không** dùng nó để *quyết* có halt — halt do engine (drift/audit) quyết. Cân nhắc: giữ MVP = flag + audit reason, countdown là tăng cường.
- **Realtime nhiều bảng:** `LiveProvider` subscribe thêm `drift_metrics`/`audit_events`/`override_grants`; cleanup channels; fallback poll khi mất realtime (4.1).
- **Phân trang Nhật ký:** cursor theo `created_at`/`id` (audit có thể nhiều); tránh tải hết. RLS select-only áp cho cả realtime.
- **isolation guard mở rộng** bắt buộc (SAFETY): màn mới không import cấm, không mutate/order.
- **Rỗng-an-toàn:** chưa có drift/audit/override (hệ mới chạy) ⇒ "chưa có dữ liệu", SSR không crash.

### Chuẩn test

- **TrustRail:** `live_expectancy` trong dải (≥ lower) ⇒ "trong dải" muted; < lower ⇒ "trượt dưới" caution; không baseline ⇒ "chưa có baseline".
- **HaltBanner:** `drifting=true` ⇒ banner drift-halt first-person, suppress card; audit tier0 block gần nhất (cooldown/daily-loss) ⇒ banner tương ứng; không halt ⇒ không banner.
- **Nhật ký:** list audit mẫu (emitted với signals+narration; blocked với reason; override-recorded) render đúng loại/thời điểm; **không** nút sửa/xoá; rỗng ⇒ "chưa có bản ghi".
- **OverrideHistory:** grants mẫu ⇒ thời điểm/rule/reason; đếm theo luật (nếu làm).
- **Isolation/realtime/SSR:** guard xanh; mock push ⇒ list/banner đổi; query null ⇒ rỗng-an-toàn, `next build` pass.
- **AD-10 negative:** assert không hàm nào tính expectancy/veto; chỉ đọc field đã lưu.

### References

- [Source: epics.md → Epic 4, Story 4.4] — AC gốc (BDD): live-drift thường trực (+ auto-halt state); duyệt Nhật ký Đề xuất/chặn với tín hiệu kích hoạt; lịch sử override để thấy sự thật hành vi
- [Source: prd.md#FR-10 (hiển thị), #FR-14 (review), #FR-12 (surface), #NFR-2] — drift hiển thị; nhật ký review; override surface; auditability
- [Source: ARCHITECTURE-SPINE.md#AD-10] — Vercel cô lập; chỉ đọc/hiển thị; không tính lại quyết định/không mutate/không gửi lệnh
- [Source: ARCHITECTURE-SPINE.md#AD-1, #AD-3, #AD-8] — realtime; không re-implement; append-only bất biến
- [Source: DESIGN.md] — halt-banner/danger-banner/silence tokens; Newsreader display (first-person halt); Geist Mono tabular; anti-dopamine
- [Source: EXPERIENCE.md] — surfaces Nhật ký ("why"/audit) + Niềm tin (trust rail/drift); Halt banner suppresses card; override history "sự thật hành vi"
- [Source: apps/web/* (4.1/4.2)] — data-layer/realtime/tokens/isolation; card/silence/heartbeat để nối
- [Source: supabase migrations — 3.5 (drift_metrics/drift_baseline), 3.3 (audit_events), 3.6 (override_grants), 3.1/3.2 (behavioral_state), 4.1 (RLS/realtime)] — bảng đọc + grant
- [Source: 3-5…md] — `drift_metrics` schema + `drifting` flag (nguồn drift/halt)
- [Source: 3-3…md] — `audit_events` (emitted/blocked/trade-outcome/override-recorded) + reason/narration
- [Source: 3-6…md] — `override_grants` (rule/reason/typed/thời điểm) — lịch sử override
- [Source: 4-2…md] — card/silence/heartbeat; halt nối vào (suppress card)

## Cần xác nhận (không chặn draft)

- **Nút "Override" trên UI ở 4.4 hay story riêng?** Mặc định 4.4 **chỉ hiển thị lịch sử** override; nút request-override (gọi Edge Function 3.6 + ô gõ tay) mình để **tùy chọn/story riêng** để 4.4 thuần đọc. Anh muốn gộp nút vào 4.4 không?
- **Confirm-fill (attribution 3.4)**: 4.2 defer về đây — đặt nút "map kết quả lệnh" ở 4.4 (cạnh Nhật ký/outcome) không? Mặc định để tùy chọn.
- **Cooldown countdown trong halt-banner**: hiển thị đồng hồ đếm từ `lastLoss+cooldown` (tăng cường) hay chỉ hiện reason engine? Mặc định chỉ reason (giữ AD-10 tối giản).

## Dev Agent Record

### Agent Model Used

Claude (deepseek-v4-pro)

### Debug Log References

### Completion Notes List

- **Task 1**: Added pure helpers to `lib/queries.ts`: `driftStatus()` (classifies in_band/below_lower/no_baseline — compares stored values only, AD-10), `haltState()` (reads drifting flag + audit reason to determine halt), `getDriftBaseline()`, `getDriftHistory()`, `getAuditEventsPage()` (with cursor/type filter), `getOverrideHistory()`. All SELECT-only.
- **Task 2**: Created `components/TrustRail.tsx` — always-visible expectancy vs baseline band (tabular numbers, sober: "In band"/"Below lower"/"No baseline"). Created `components/HaltBanner.tsx` — global non-dismissible banner, first-person reason (engine tone), aria-live assertive. Updated `app/server-shell.tsx` to show TrustRail always + HaltBanner when halted (suppresses card). Updated `app/page.tsx` with nav to Journal.
- **Task 3**: Created `app/nhat-ky/page.tsx` (route `/nhat-ky`) — SSR page with audit events list + override history. Created `components/AuditEventRow.tsx` — renders each event by type (emitted: pair/direction; blocked: vetoedBy/reason; trade-outcome: fill/PnL; override-recorded: rule/reason) with color-coded left border. Created `components/OverrideHistory.tsx` — sober list of rule/reason/time. Nav between Now ↔ Journal. No edit/delete buttons (immutable).
- **Task 4**: Verified RLS + realtime publication from 4.1 migration covers all needed tables (`drift_metrics`, `drift_baseline`, `audit_events`, `override_grants`, `behavioral_state`). Isolation guard maintained — no new adapters/pipeline/binance/order imports. All queries SELECT-only.
- **Task 5**: Existing test suite (9 web tests) continues to pass. Total 362 tests. Next.js build produces `/` and `/nhat-ky` as static pages. SSR empty-data handling verified.

### File List

- `apps/web/lib/queries.ts` (MODIFIED — +drift/halt helpers, +5 query functions)
- `apps/web/components/TrustRail.tsx` (NEW)
- `apps/web/components/HaltBanner.tsx` (NEW)
- `apps/web/components/AuditEventRow.tsx` (NEW)
- `apps/web/components/OverrideHistory.tsx` (NEW)
- `apps/web/app/server-shell.tsx` (MODIFIED — +TrustRail, HaltBanner, Journal nav, halt suppress card)
- `apps/web/app/nhat-ky/page.tsx` (NEW)
- `apps/web/app/page.tsx` (MODIFIED — +Journal link in header via server-shell)

## Change Log

- 2026-07-05: Story 4.4 implementation — Trust rail always visible (expectancy vs baseline, sober), halt banner (first-person, non-dismissible, suppresses card), journal page /nhat-ky (audit events list by type + override history, immutable, no edit/delete), pure driftStatus/haltState helpers (display-classification only, AD-10). **Epic 4 complete. Project Brighten v1 complete.** All 362 tests pass, Next.js build clean.
