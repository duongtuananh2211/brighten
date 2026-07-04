---
name: Brighten
status: final
sources:
  - _bmad-output/planning-artifacts/prds/prd-brighten-2026-07-03/prd.md
  - _bmad-output/planning-artifacts/architecture/architecture-brighten-2026-07-04/ARCHITECTURE-SPINE.md
  - _bmad-output/planning-artifacts/epics.md
updated: 2026-07-04
---

# Brighten — Experience Spine

> Trading decision-support "discipline machine" (FX & Crypto), solo tool. Single-surface responsive web, shadcn/ui on Next.js 16.2 + Tailwind. Paired with `DESIGN.md`. The interface enforces discipline: it suggests, never executes; its silence is a recommendation; and it treats the user's own winning streak as the primary threat. Read-only mirror of a Postgres-backed engine (see ARCHITECTURE-SPINE AD-10) — the UI never runs the pipeline and has no path to place an order.

## Foundation

Single-surface responsive web, desktop-primary. shadcn/ui on Next.js 16.2 + Tailwind; `DESIGN.md` is the visual identity reference. The web app is a **read-only surface over Postgres** (Supabase Realtime pushes updates) — per architecture AD-10 it never mutates state, never runs the pipeline, and contains no code path that sends an order to an exchange. Every action the user takes here is *reading a suggestion, confirming they've acted manually, logging an outcome, or overriding a block* — never trading.

`[ASSUMPTION]` Notification of a fresh suggestion uses web push + a tab badge (PRD Open Q5 unresolved).

## Information Architecture

| Surface | Reached from | Purpose |
|---|---|---|
| **Now** (Đề xuất / Chờ) | App open / `g n` | The one live suggestion, or the calm "no edge — wait" silence state. Persistent trust rail (drift + discipline state) alongside. |
| **Nhật ký** (Audit log) | Nav / `g l` | Immutable review of every suggestion, trigger signal, block, and override — why each appeared or was stopped. |
| **Niềm tin** (Trust) | Nav / `g t` | Live-drift vs backtest confidence band, net expectancy, equity curve, R-multiple distribution. `[ASSUMPTION]` read-only view of backtest results produced by the CLI. |
| **Cấu hình** (Config) | Nav / `g c` | Versioned tunable parameters (cooldown, thresholds, min R:R, risk %, cost-hurdle X). Read-emphasis; edits create a new config version. |
| **Override** | Danger/halt banner action | Modal high-friction flow, not a standalone surface. |

Surface closure: every PRD need maps to a surface — the suggestion + silence (Now), the "why"/audit (Nhật ký), the evidence that earns trust (Niềm tin), the levers (Cấu hình). Modal stacks one level deep only.

→ Composition reference: `mockups/` (rendered at Finalize). Spine wins on conflict.

## Voice and Tone

Microcopy. The system speaks in the **first person, plainly, no hype, no emoji, no exclamation marks**. Aesthetic posture lives in `DESIGN.md`.

| Do | Don't |
|---|---|
| "Không có edge rõ ràng — chờ." | "Chưa có tín hiệu nào 😔 Hãy kiên nhẫn nhé!" |
| "Đang thắng chuỗi — trạng thái nguy hiểm. Size giảm còn 0.5×." | "🔥 Chuỗi thắng 4 lệnh! Tiếp tục phong độ!" |
| "Regime có thể đã đổi. Tôi không còn đáng tin — chờ đã." | "Cảnh báo: hiệu suất giảm." |
| "Đã khoá tới hết ngày — lỗ ngày chạm giới hạn." | "Bạn đã đạt giới hạn giao dịch." |
| First person for the system's judgments; imperative-calm for the user. | Cheerful assistant voice, gamified praise, emoji. |

## Component Patterns

Behavioral. Visual specs live in `DESIGN.md.Components`.

| Component | Use | Behavioral rules |
|---|---|---|
| **Suggestion card** ({components.suggestion-card}) | Now | Shows direction, size, stop, target, R:R (mono), and the LLM "why". Primary action is **"Đã xác nhận trên sàn"** (logs that the user acted — does NOT trade). Secondary: "Bỏ qua". Confirming opens the light outcome-log affordance later (see State Patterns → trade-outcome). |
| **Silence state** ({components.silence-state}) | Now | The default, not a fallback. Serif line + one muted sub-line naming which layer is holding (e.g. "Tầng 1: chưa rõ hướng"). No primary action — waiting *is* the action. |
| **Danger banner** ({components.danger-banner}) | Now / global top | Appears when a Tầng-0 caution condition is live (win-streak dampening, cooldown, news blackout). States the condition + remaining time (mono countdown). Persists until the condition clears. |
| **Halt banner** ({components.halt-banner}) | Now / global top | Appears on auto-halt / drift breach / daily-loss lock. Not dismissible. First-person reason. Suppresses the suggestion card entirely — no new Đề xuất while halted. |
| **Drift-meter** ({components.drift-meter}) | Trust rail (persistent) | Always visible. Backtest confidence band = track; live expectancy = mono marker. Marker below band → whole Now surface shifts toward `{colors.halt}` and the halt banner arms. |
| **Override-confirm dialog** ({components.override-confirm-dialog}) | From banner action | Requires typing a fixed phrase + shows a running cooldown that must elapse before the confirm button enables. Logs the override on confirm. |
| **Discipline-state badges** | Trust rail | Pills: streak count, trades-today / max, cooldown remaining, daily P&L (neutral mono, never green/red). |

## State Patterns

| State | Surface | Treatment |
|---|---|---|
| Cold load | Now | shadcn `Skeleton` for card + rail. Resolves on Postgres read. |
| **Silence (no edge)** | Now | Silence state (serif). Sub-line names the holding layer. The trust rail stays fully populated — absence of a suggestion is not absence of information. |
| **Suggestion live** | Now | Suggestion card elevated; realtime-pushed. If a suggestion is superseded by a newer tick, the card updates in place with a subtle "cập nhật lúc {time}" mono stamp. |
| **Win-streak danger** | Now (banner) | Danger banner amber: "Đang thắng chuỗi — trạng thái nguy hiểm. Size giảm còn {n}×." Suggestion card, if any, shows the dampened size. |
| **Cooldown after loss** | Now (banner) | Danger banner + mono countdown. No new suggestion until it elapses. |
| **News blackout (FX)** | Now (banner) | Danger banner naming the event + window. Affected FX pairs suppressed. |
| **Auto-halt / drift breach** | Now (banner) | Halt banner red, first person. Suggestion suppressed. Drift-meter marker below band. |
| **Daily-loss lock** | Now (banner) | Halt banner: locked until day boundary (config, default UTC 00:00). |
| **Trade-outcome pending** | Now / Nhật ký | After "Đã xác nhận trên sàn", a light affordance asks the user to map the fill ↔ suggestion and (later) log the R result — feeds behavioral state (architecture AD-7). Read-only API auto-detects P&L; user only confirms the mapping. |
| **LLM narration failed** | Suggestion card | Card still shows all rule facts; the "why" area shows "Lý do tạm thời không có" — narration is never a blocker (AD-9). |
| **Data incomplete (tick)** | Now | No suggestion emitted on missing data; silence sub-line: "Dữ liệu chưa đủ ở tick này." (NFR-5). |

## Interaction Primitives

- `g n` / `g l` / `g t` / `g c` — go to Now / Nhật ký / Trust / Cấu hình (vim-style).
- `Enter` on a live suggestion card → confirm "Đã xác nhận trên sàn" (log only).
- `Esc` — close dialogs / override flow.
- Override is **never** a hotkey — it requires the modal, the typed phrase, and the cooldown. Friction is the point.
- **Banned:** any control that places or modifies an exchange order; one-click override; green/red P&L coloring; celebratory motion; auto-refresh that hides a halt.

## Accessibility Floor

Behavioral. Visual contrast lives in `DESIGN.md` (shadcn WCAG AA defaults; brand overrides verified).

- WCAG 2.2 AA across the responsive surface.
- **Color is never the sole signal.** Danger/halt states always carry text + icon + (where relevant) a mono countdown — the amber/red is reinforcement, not the message. Critical for the streak-danger inversion, which would be meaningless to a color-blind user if left to hue alone.
- Screen reader announces surface + system state on navigation and on realtime state change via `aria-live` (polite for suggestions, assertive for halt): e.g. "Now — đang halt: regime có thể đã đổi."
- Halt and danger banners are focusable and announced the instant they arm.
- `Tab` order matches reading order; `Esc` closes the topmost modal; override dialog traps focus until resolved or cancelled.

## Responsive & Platform

| Breakpoint | Behavior |
|---|---|
| `≥ lg` (1024px+) | Two-column: Now (suggestion/silence) + persistent trust rail (drift-meter, discipline badges). |
| `md` (768–1023px) | Trust rail moves above the suggestion card, condensed; drift-meter stays visible above the fold. |
| `< md` (`sm`) | Single column; drift-meter + active banner pinned to top; nav becomes a `Sheet`. Read + confirm + override all work on phone (the glance-and-act case). |

Desktop-primary; the phone surface is for glancing at a pushed suggestion and confirming/overriding, not analysis.

## Inspiration & Anti-patterns

- **Lifted from Linear:** keyboard-first vim nav, calm density, no chrome noise.
- **Lifted from shadcn:** the entire surface vocabulary; the brand is *what we add*, not a from-scratch system.
- **Rejected — green P&L / profit dopamine:** the core anti-pattern this product exists to defeat. Gains are facts in neutral mono, not rewards.
- **Rejected — streak celebration, badges, "🔥 hot hand":** a streak is a *danger*, rendered amber. Celebrating it would defeat the product.
- **Rejected — one-click "trade now" / broker integration:** v1 has no execution path by hard constraint. The most prominent action is only "I confirmed on the exchange myself."
- **Rejected — dashboards full of predictive charts:** Brighten shows what the user controls and the evidence for trusting it, not price forecasts.

## Key Flows

Protagonist: **Tú**, solo trader, builder-operator, at his desk mid-morning.

### Flow 1 — A crypto suggestion Tú trusts enough to act on (UJ-1)

1. A web-push fires; Tú opens the Now tab. The suggestion card is live: **short BTC/USDT**, size, stop, target, R:R in mono.
2. The "why" reads, in the system's plain voice: *"Funding dương cực trị + OI xác nhận + giá áp một hồ thanh khoản trên → edge nghiêng short."* The trust rail shows drift healthy inside the band.
3. Tú reads the reason, agrees, and places the order himself on Binance.
4. He hits `Enter` → **"Đã xác nhận trên sàn."** The card logs the suggestion + reason to Nhật ký.
5. **Climax:** nothing celebratory happens. The card quietly resolves to a logged entry; a light affordance appears — "Khi đóng lệnh, map kết quả để tôi cập nhật kỷ luật." The surface stays sober. Tú got a decision and a paper trail, not a slot-machine payout — which is exactly why he trusts it.

Failure: LLM narration failed → card still shows every rule fact, "why" reads "Lý do tạm thời không có." Tú can still act; narration was never the gate.

### Flow 2 — Silence is the answer (UJ-2)

1. Market is sideways. Tú opens Now expecting to "check for setups."
2. No card. Centered serif: **"Không có edge rõ ràng — chờ."** Sub-line: "Tầng 1: chưa rõ hướng."
3. The trust rail is still fully alive — drift healthy, expectancy positive, discipline badges calm.
4. **Climax:** Tú does nothing, and the interface makes *doing nothing feel like a completed action* rather than an empty screen. There is no "scan again" button to tempt him. He closes the tab. The silence recommended patience, and he took it.

### Flow 3 — The system blocks Tú after a winning streak (UJ-3)

1. Tú has just won 4 in a row and is itching to re-enter. He opens Now.
2. A **danger banner (amber)** sits above everything: *"Đang thắng chuỗi — trạng thái nguy hiểm. Size giảm còn 0.5×."* Any suggestion shown carries the dampened size; a fresh entry may be blocked outright with the block logged.
3. Tú, hot-handed, clicks the small "Override" on the banner.
4. The **override dialog** opens with a caution border: a running cooldown counts down, and he must type a fixed phrase before the confirm button even enables.
5. **Climax:** the friction does its job. By the time the cooldown elapses and he's typed the phrase, the urge has cooled; he closes the dialog. The override — had he completed it — would have been written to Nhật ký for him to face later. The system didn't forbid him; it made his worst impulse expensive.

### Flow 4 — The system doubts itself (UJ-4)

1. Over days, live expectancy has slid. Tú opens Now.
2. The drift-meter marker has dropped **below** the backtest confidence band; the whole surface has shifted toward the halt tone.
3. A **halt banner (red)** states, first person: *"Regime có thể đã đổi. Tôi không còn đáng tin — chờ đã."* No suggestion card is shown; new Đề xuất are suppressed.
4. **Climax:** the tool that exists to be trusted has just told Tú *not* to trust it right now — and shown him the drift evidence for why. He respects it and stands down. The brake put a brake on itself.

Failure: Tú disagrees and wants to trade anyway → he can still act on the exchange manually (the system never controls his hands), but there is no in-app path that resumes suggestions until drift returns inside the band.
