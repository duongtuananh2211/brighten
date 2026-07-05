---
baseline_commit: cfae2a46e98a2ac6b5e1bf9e97fc672533fa2161
depends_on: 4-1-web-read-realtime
---

# Story 4.2: Trình Đề xuất để xác nhận (FR-13)

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **người dùng của Brighten**,
I want **thấy Đề xuất ĐẦY ĐỦ (hướng, khối lượng, điểm dừng, target/R:R + meta) khi có, và trạng thái "chờ / không có edge" khi im lặng; hiển thị sống qua realtime; TUYỆT ĐỐI không có nút gửi lệnh — tôi tự xác nhận thủ công trên sàn**,
so that **tôi bấm (tự vào lệnh trên sàn) với niềm tin, hoặc yên tâm không làm gì khi không có edge (FR-13, AD-10, AD-1)**.

## Acceptance Criteria

**AC1 — Suggestion-card: hiển thị Đề xuất đầy đủ (FR-13)**
**Given** một Đề xuất trong `suggestions` (payload từ 3.1: `{ direction, candidate{entry,stop,target}, sizing{volume,rr,riskAmount,stopDistance,entry,stop,target,direction}, pair, timeframe, atEpochMillis, configVersion }`)
**When** mở app / có Đề xuất mới
**Then** render **suggestion-card** (token DESIGN.md) hiện: **hướng** (LONG/SHORT), **khối lượng** (`sizing.volume`), **điểm vào** (`entry`), **điểm dừng** (`stop`), **target** (`target`), **R:R** (`sizing.rr`), + meta: `pair`/`timeframe`, thời điểm (`atEpochMillis`), `configVersion`
**And** mọi **số** dùng `Geist Mono` tabular (giá/size/R:R rõ ràng, không nhập nhằng); hướng dùng nhãn rõ (không màu "thắng vui" — posture sober)
**And** card đọc **thẳng** từ `suggestions.payload` (jsonb) qua data-layer 4.1 (`getLatestSuggestion`); web **không** tính lại gì (chỉ trình bày dữ liệu engine đã quyết, AD-10)

**AC2 — "Lý do" của Đề xuất (nền cho narrator 4.3)**
**Given** card Đề xuất
**When** hiển thị
**Then** có mục **"Lý do"**: (a) **cấu trúc** — Đề xuất đi lọt Tầng 0→3 với hướng (Tầng 1), vùng vào (Tầng 2), R:R đạt `min_rr` (Tầng 3) — trình bày từ dữ liệu payload; (b) **slot narration** để **4.3** (LLM narrator) điền "tại sao" tiếng người
**And** khi **chưa có narration** (4.3 chưa chạy / LLM lỗi) ⇒ hiển thị phần cấu trúc + ghi chú **"diễn giải đang chờ / thiếu lý do"** (không để trống, không chặn hiển thị Đề xuất — nối AD-9/4.3)
**And** 4.2 **không** gọi LLM (đó là 4.3); chỉ dựng khung + đọc `narration` nếu đã có (đọc-only)

**AC3 — Trạng thái "chờ / không có edge" khi im lặng (FR-13)**
**Given** không có Đề xuất tươi (system chạy nhưng Tầng 1/2 im, hoặc bị chặn)
**When** mở app
**Then** hiển thị **silence-state** (token DESIGN.md): "Chờ — không có edge lúc này" (muted, sober) thay vì card
**And** phân biệt **alive-nhưng-im** vs **có thể down**: dùng `drift_metrics` làm **heartbeat** (3.5 ghi **mỗi tick**) — `drift_metrics.atEpochMillis` gần đây ⇒ hệ đang chạy & thật sự im (hiện "không có edge"); heartbeat cũ/vắng ⇒ hiện "không rõ trạng thái / mất kết nối dữ liệu" (không giả vờ "không edge")
**And** "tươi" = Đề xuất trong cửa sổ gần đây (ngưỡng UI, vd ≤ vài lần khung thời gian); Đề xuất cũ hơn ⇒ coi như hết hiệu lực ⇒ silence-state (Đề xuất là điểm-thời, không treo mãi)

**AC4 — TUYỆT ĐỐI không nút gửi lệnh; realtime cập nhật sống (AD-10, AD-1)**
**Given** ràng buộc SAFETY (§11, AD-10) + realtime (4.1)
**When** dựng UI
**Then** **không tồn tại** nút/đường code gửi/đặt lệnh tới sàn; user đọc Đề xuất rồi **tự vào lệnh thủ công** trên sàn (web chỉ trình bày)
**And** Đề xuất mới (realtime push, 4.1 `LiveProvider`) ⇒ card cập nhật **không cần refresh**; chuyển edge→silence và ngược lại phản ánh sống
**And** (nếu có) nút "**tôi đã vào lệnh này**" = **attribution/confirm-fill** (gọi Edge Function 3.4, KHÔNG phải web ghi DB / KHÔNG phải gửi lệnh) — **tùy chọn**, có thể để **4.4**; nếu làm ở đây, rõ ràng nhãn "xác nhận đã tự vào" (win-streak), tách hẳn khỏi "đặt lệnh"

**AC5 — Posture anti-dopamine + accessibility (DESIGN.md)**
**Given** DESIGN.md (win-streak = danger state, không ăn mừng)
**When** trình Đề xuất
**Then** card **không** dùng màu "thắng/vui"; nếu đang win-streak (đọc `behavioral_state.winStreak ≥ threshold`) ⇒ **caution banner** (amber) "đang chuỗi thắng — cẩn trọng give-back", KHÔNG confetti/positive; nếu Tầng 0 đang halt/cooldown/drift ⇒ **halt/caution** rõ (nối 4.4)
**And** accessibility: tương phản đạt (light+dark tokens 4.1), số có nhãn, hướng không chỉ bằng màu (có chữ LONG/SHORT), keyboard/screen-reader đọc được card

**AC6 — Test/guard + toolchain sạch (giữ cô lập 4.1)**
**Given** nền test/guard 4.1
**When** thêm component + test
**Then** test: render card từ payload mẫu (số/hướng/R:R đúng, tabular); silence-state khi không Đề xuất tươi + heartbeat logic (fresh vs stale); "thiếu lý do" fallback khi vắng narration; **isolation guard 4.1 vẫn xanh** (không import adapters/pipeline/binance/order; **không** nút order); realtime cập nhật (mock push ⇒ card đổi)
**And** `pnpm -r typecheck && pnpm -r build && pnpm -r lint && pnpm -r test` **tất cả pass**; render dữ liệu-rỗng an toàn (SSR)

## Tasks / Subtasks

- [x] **Task 1 — Đọc dữ liệu Đề xuất + heartbeat (AC: #1, #3)**
  - [ ] `apps/web/lib/queries.ts`: mở rộng (chỉ select) — `getLatestSuggestion()` trả payload đã parse (kiểu `Suggestion` type-only); `getLatestDriftMetric()` (heartbeat, đã có 4.1) trả `atEpochMillis`; `getBehavioralState()` (win-streak cho AC5)
  - [ ] Helper thuần `isSuggestionFresh(atEpochMillis, nowMs, timeframe|thresholdMs)` + `isSystemAlive(driftAtEpochMillis, nowMs, staleMs)` — quyết định card vs silence vs "mất kết nối" (test được)
  - [ ] Rỗng-an-toàn: không Đề xuất ⇒ null ⇒ silence

- [x] **Task 2 — Component `SuggestionCard` (AC: #1, #2, #5)**
  - [ ] `apps/web/components/SuggestionCard.tsx`: **NEW** — nhận `Suggestion` (+ optional `narration`); render hướng/volume/entry/stop/target/rr/meta (tabular mono, suggestion-card token); mục "Lý do" (cấu trúc + slot narration; fallback "diễn giải đang chờ / thiếu lý do")
  - [ ] Posture: nhãn LONG/SHORT (chữ, không chỉ màu); không màu thắng-vui; caution banner nếu win-streak (đọc state)
  - [ ] Accessibility: aria-label số/hướng; tương phản; keyboard

- [x] **Task 3 — `SilenceState` + trạng thái hệ (AC: #3)**
  - [ ] `apps/web/components/SilenceState.tsx`: **NEW** — "Chờ — không có edge lúc này" (silence-state token, muted); biến thể "mất kết nối dữ liệu" khi heartbeat stale
  - [ ] `app/page.tsx`: chọn hiển thị **card** (Đề xuất tươi + alive) hay **silence** (im + alive) hay **"không rõ"** (stale) — dùng helper Task 1; bọc `LiveProvider` (4.1) để realtime đổi trạng thái sống

- [x] **Task 4 — Realtime cập nhật card (AC: #4)**
  - [ ] Nối `LiveProvider` (4.1): on new `suggestions` row / new `drift_metrics` ⇒ refetch/update ⇒ card/silence đổi không refresh; cleanup channel
  - [ ] **Khẳng định KHÔNG** nút/đường gửi lệnh; (tùy chọn) nút "đã tự vào lệnh" gọi Edge Function confirm-fill (3.4) — nhãn tách bạch, KHÔNG order

- [x] **Task 5 — Tests/guard (AC: #6)**
  - [ ] `apps/web/components/SuggestionCard.test.tsx` + `SilenceState.test.tsx` (+ `lib/queries` helper test): render payload mẫu (số/hướng/R:R/tabular); "thiếu lý do" fallback; fresh/stale/alive logic; win-streak caution
  - [ ] **Isolation guard** (4.1) chạy lại + mở rộng: không nút/handler order; không import cấm
  - [ ] `pnpm -r typecheck/build/lint/test` pass; SSR rỗng không lỗi

## Dev Notes

> **Bối cảnh:** Story 4.2 hiện thực **FR-13 — trình Đề xuất**: bề mặt để user "đọc rồi tự bấm trên sàn". Xây **thẳng trên nền 4.1** (data-layer đọc-only, realtime `LiveProvider`, brand tokens shadcn/Tailwind, cô lập SAFETY). 4.2 thêm **suggestion-card** (Đề xuất đầy đủ) + **silence-state** ("chờ/không-edge") + **giữ nguyên** cam kết **không nút gửi lệnh** (AD-10). "Lý do" tiếng người (LLM) là **4.3** — 4.2 dựng khung + slot + fallback "thiếu lý do".

> **Phụ thuộc:** **4.1** (queries/realtime/tokens/isolation) + đọc `suggestions`(3.1)/`drift_metrics`(3.5)/`behavioral_state`(3.1/3.2). [Source: 4-1…md; apps/cron-runner/src/tick.ts (shape Suggestion); supabase 3.x]

### 🔑 Suggestion payload là nguồn — web KHÔNG tính lại (AD-10)

- Card đọc **thẳng** `suggestions.payload` (jsonb) — engine đã quyết direction/volume/stop/target/R:R (pipeline 2.x + tick 3.1). Web **chỉ trình bày**; **không** re-derive R:R/size (đó là re-implement luật, cấm ở UI). `sizing.rr`/`sizing.volume` lấy nguyên. [Source: apps/cron-runner/src/tick.ts (Suggestion shape); ARCHITECTURE-SPINE.md#AD-10, #AD-3]
- Kiểu: `import type { Suggestion }` từ `@brighten/decision-core` (type-only, giữ cô lập 4.1) hoặc kiểu web-local đọc payload.

### 🔑 Heartbeat qua `drift_metrics` — phân biệt "im" vs "down"

- `drift_metrics` ghi **mỗi tick** (3.5 "luôn tính & lưu") ⇒ là **nhịp tim** rẻ nhất. `atEpochMillis` gần ⇒ hệ sống & thật sự **không edge** (hiện silence "chờ"); cũ/vắng ⇒ **không giả vờ "không edge"** mà báo "mất kết nối dữ liệu". Tránh UI nói dối "an toàn không edge" khi thực ra cron chết. [Source: 3-5…md (drift ghi mỗi tick); epics.md → 4.4 (drift thường trực)]
- Đề xuất là **điểm-thời**: cũ quá ngưỡng ⇒ hết hiệu lực ⇒ silence (không treo Đề xuất chết). Ngưỡng "tươi" là hằng UI (tài liệu-hoá; tunable) — xem Cần xác nhận.

### 🔑 "Không nút gửi lệnh" là bất biến, không chỉ là "chưa làm"

- SAFETY §11/AD-10: **không tồn tại** đường gửi lệnh. 4.2 giữ guard 4.1 + thêm assert **không handler order** trong component. Nút "đã tự vào lệnh" (nếu có) = **attribution** (confirm-fill 3.4, gọi Edge Function) — **khác hoàn toàn** đặt lệnh; nhãn phải tách bạch để user không nhầm web đặt lệnh hộ. [Source: ARCHITECTURE-SPINE.md#AD-10; PRD §11; 3-4…md (confirmFill)]

### 🔑 Anti-dopamine (DESIGN.md) — Đề xuất là công cụ kỷ luật, không phần thưởng

- Card sober: hướng bằng **chữ** LONG/SHORT (không chỉ màu xanh/đỏ "thắng/thua"); **không** confetti/positive reinforcement. Win-streak ⇒ **caution** (amber "cẩn trọng give-back"), đúng "win-streak là danger state". Halt/cooldown/drift ⇒ halt/caution (chi tiết màn 4.4). [Source: DESIGN.md (anti-dopamine posture, tokens caution/halt)]

### Hợp đồng đã có (PHẢI tuân) — sau 4.1

| File | Trạng thái | Story 4.2 đổi gì | Phải giữ nguyên |
| --- | --- | --- | --- |
| `apps/web/lib/queries.ts` (4.1) | getLatestSuggestion/State/Drift (select) | mở rộng parse payload + helper fresh/alive | chỉ-select; rỗng→null |
| `apps/web/components/LiveProvider.tsx` (4.1) | realtime subscribe | dùng để card/silence đổi sống | chỉ-nhận; cleanup |
| `apps/web/app/page.tsx` (4.1) | shell latest-presence | **render card/silence/không-rõ** | SSR+LiveProvider; rỗng-an-toàn |
| brand tokens (4.1, DESIGN.md) | suggestion-card/silence-state/caution/halt | dùng token | không đổi token |
| isolation guard (4.1) | chặn import/order | **mở rộng**: không handler order | guard xanh |
| `suggestions`/`drift_metrics`/`behavioral_state` | RLS select-only (4.1) | chỉ đọc | RLS; không ghi |

[Source: apps/web/* (4.1); supabase migrations 3.x/4.1]

### Invariant kiến trúc PHẢI tuân

- **AD-10 — Vercel cô lập:** web chỉ trình bày; không nút/đường gửi lệnh; không tính lại luật. [Source: #AD-10]
- **AD-1 — realtime:** Đề xuất/silence cập nhật sống từ Postgres qua Realtime; không tiến trình quyết định ở web. [Source: #AD-1]
- **AD-3 — không re-implement:** web đọc `sizing`/`candidate` engine quyết, không tự tính R:R/size. [Source: #AD-3]
- **AD-9 — LLM ngoài đường:** thiếu narration ⇒ Đề xuất **vẫn hiển thị** kèm ghi chú thiếu lý do (4.2 dựng fallback; nguồn LLM 4.3). [Source: #AD-9]

### Ngoài phạm vi story này (đừng làm — để story sau)

- **LLM narrator sinh "tại sao"** — **4.3** (FR-7). 4.2 chỉ slot + fallback; đọc narration nếu đã có.
- **Màn Live-drift thường trực + review Nhật ký + lịch sử override** — **4.4**. 4.2 chỉ dùng drift làm heartbeat + caution banner tối thiểu.
- **Nút override** (3.6) — 4.4/UI override. 4.2 không.
- **Confirm-fill UI đầy đủ** (chọn fill↔Đề xuất) — có thể 4.4; 4.2 chỉ (tùy chọn) nút "đã tự vào" tối giản, tách khỏi order.
- **Web Push/thông báo ngoài app** (PRD Open Q5) — sau.
- **Lịch sử nhiều Đề xuất / danh sách** — 4.2 tập trung Đề xuất **hiện tại** + silence; danh sách/review là 4.4.

### Source tree mục tiêu (phần thêm/đổi)

```text
apps/web/
  components/SuggestionCard.tsx, SuggestionCard.test.tsx   # NEW
  components/SilenceState.tsx, SilenceState.test.tsx       # NEW
  lib/queries.ts                    # UPDATE: parse payload + helper fresh/alive
  lib/queries.test.ts               # UPDATE
  app/page.tsx                      # UPDATE: card/silence/không-rõ + LiveProvider
```
[Source: DESIGN.md (suggestion-card/silence-state); bố cục 4.1]

### Project Structure Notes

- **Component server vs client**: card/silence render được ở server (SSR data) nhưng cập nhật sống cần client (`LiveProvider`). Ưu tiên server-first, client-boundary tối thiểu (nút/subscribe) — tuân [[vercel-react-best-practices]].
- **Không re-derive**: KHÔNG tính lại `rr`/`volume` trong web (dù dễ) — luôn đọc `sizing.*`. Nếu payload thiếu field ⇒ hiển thị "—" + không suy diễn.
- **Freshness/heartbeat là hằng UI** (không config core) — đặt một chỗ, tài liệu-hoá; tránh rải rác magic number.
- **Isolation**: SuggestionCard **không** import gì runtime từ core/adapters; chỉ type + JSX. Guard 4.1 mở rộng bắt nút order.
- **i18n/số**: số tiền/giá là decimal-string từ payload — render nguyên (không `parseFloat` làm mất chính xác); format hiển thị (nhóm nghìn) nhưng giữ giá trị gốc.

### Chuẩn test

- **SuggestionCard**: payload mẫu (LONG, volume/entry/stop/target/rr cụ thể) ⇒ render đúng số (tabular), hướng chữ, meta; win-streak≥threshold ⇒ caution banner; narration vắng ⇒ "thiếu lý do"; có narration ⇒ hiện.
- **SilenceState/logic**: không Đề xuất tươi + heartbeat fresh ⇒ "chờ/không edge"; heartbeat stale ⇒ "mất kết nối"; Đề xuất cũ ⇒ silence.
- **Realtime**: mock push suggestions ⇒ card xuất hiện/đổi; push drift ⇒ heartbeat cập nhật.
- **Isolation/SAFETY**: guard không import cấm; **không** handler/nút order (grep component).
- **Rỗng/SSR**: query null ⇒ silence, không crash; `next build` pass.

### References

- [Source: epics.md → Epic 4, Story 4.2] — AC gốc (BDD): hiển thị hướng/khối lượng/điểm dừng/target/R:R + lý do; không Đề xuất → "chờ/không edge"; không nút gửi lệnh, tự xác nhận thủ công
- [Source: prd.md#FR-13, §11 SAFETY] — trình Đề xuất; không đường tự gửi lệnh
- [Source: ARCHITECTURE-SPINE.md#AD-10] — Vercel cô lập; chỉ đọc/hiển thị/realtime; không gửi lệnh
- [Source: ARCHITECTURE-SPINE.md#AD-1, #AD-3, #AD-9] — realtime; không re-implement luật; LLM ngoài đường (fallback thiếu lý do)
- [Source: DESIGN.md] — suggestion-card/silence-state/caution/halt tokens; anti-dopamine posture; Geist Mono tabular
- [Source: EXPERIENCE.md] — đọc "tại sao" rồi tự xác nhận
- [Source: apps/cron-runner/src/tick.ts] — shape `Suggestion` (direction/candidate/sizing/pair/timeframe/atEpochMillis/configVersion) web đọc
- [Source: packages/decision-core/tiers/tier3/sizing.ts] — `SizingResult` (volume/rr/entry/stop/target/riskAmount) — nguồn số card
- [Source: 4-1-web-read-realtime.md] — data-layer/realtime/tokens/isolation (nền); heartbeat drift
- [Source: 3-5-live-drift-auto-halt.md] — `drift_metrics` ghi mỗi tick (heartbeat)
- [Source: 3-4-feedback-loop-hybrid.md] — confirm-fill endpoint (nếu làm nút "đã tự vào")

## Cần xác nhận (không chặn draft)

- **Ngưỡng "Đề xuất tươi"**: mặc định mình dùng bội số khung thời gian (vd ≤ 2–3× timeframe) rồi coi hết hiệu lực → silence. Anh muốn Đề xuất treo tới khi có cái mới, hay hết hạn theo thời gian?
- **Nút "đã tự vào lệnh" (confirm-fill)**: đặt ở 4.2 (cạnh card) hay dồn về 4.4 (cùng feedback/nhật ký)? Mặc định mình **để 4.4** để 4.2 thuần trình bày.
- **Heartbeat stale threshold**: bao lâu không thấy `drift_metrics` mới thì báo "mất kết nối"? (vd > vài phút, tùy nhịp cron ~1').

## Dev Agent Record

### Agent Model Used

Claude (deepseek-v4-pro)

### Debug Log References

### Completion Notes List

- **Task 1**: Added pure helper functions to `lib/queries.ts`: `isSuggestionFresh()` (now - atEpoch ≤ maxAge), `isSystemAlive()` (heartbeat via drift.atEpochMillis within stale threshold), `PageState` discriminated union. Constants: `DEFAULT_SUGGESTION_MAX_AGE_MS` (5 min), `DEFAULT_HEARTBEAT_STALE_MS` (5 min). All pure, testable.
- **Task 2**: Created `components/SuggestionCard.tsx` — renders full suggestion: direction (LONG/SHORT badge, sober), pair/timeframe, entry/stop/target/volume/R:R/riskAmount in 2×3 metric grid (Geist Mono tabular), config version + timestamp meta. "Why" section with structural reason list (tier1 direction, tier2 entry zone, tier3 RR) + narration slot. Fallback "Interpretation pending" when no LLM narration. Caution banner when winStreak ≥ threshold (anti-dopamine: amber, "stay cautious").
- **Task 3**: Created `components/SilenceState.tsx` — two variants: alive (amber dot, "Waiting — no edge right now") vs disconnected (red dot, "Status unclear — data connection lost", with actionable message). Distinguishes genuine silence from engine down via heartbeat.
- **Task 4**: Updated `app/server-shell.tsx` to use `isSuggestionFresh` + `isSystemAlive` to pick SuggestionCard (fresh + alive) or SilenceState (alive/stale). Compact state bar below with winStreak/dailyLoss/tradeCount/expectancy in tabular mono. LiveProvider already wraps in page.tsx for realtime updates.
- **Task 5**: Created `components/SuggestionCard.test.tsx` with 7 tests covering freshness (within/outside/exact) and heartbeat (recent/stale/null/undefined). Updated vitest config to include components/**/*.test.*. Total: 362 tests pass (9 web + 353 core).

### File List

- `apps/web/lib/queries.ts` (MODIFIED — +freshness/heartbeat helpers + PageState type)
- `apps/web/components/SuggestionCard.tsx` (NEW)
- `apps/web/components/SuggestionCard.test.tsx` (NEW)
- `apps/web/components/SilenceState.tsx` (NEW)
- `apps/web/app/server-shell.tsx` (MODIFIED — card/silence/không-rõ logic)
- `apps/web/vitest.config.ts` (MODIFIED — +components test glob)

## Change Log

- 2026-07-05: Story 4.2 implementation — suggestion-card with full presentation (direction/volume/stop/target/R:R/meta + structural reason + narration slot), silence-state (alive vs disconnected via drift heartbeat), freshness/heartbeat pure helpers, anti-dopamine posture (caution banner on streak, sober colours, tabular numbers), no order button (AD-10). All 362 tests pass, Next.js build clean.
