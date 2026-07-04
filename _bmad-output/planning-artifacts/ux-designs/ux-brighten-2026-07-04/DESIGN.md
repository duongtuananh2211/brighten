---
name: Brighten
description: Trading decision-support "discipline machine" (FX & Crypto), solo tool. shadcn/ui on Next.js 16.2 + Tailwind; this DESIGN.md specifies the brand-layer delta only. Anti-dopamine posture — a winning streak is a danger state, not a celebration.
status: final
updated: '2026-07-04'
colors:
  # Brand overrides on top of shadcn defaults. Unlisted tokens (background,
  # foreground, muted, muted-foreground, popover, card, border, input, ring)
  # inherit from shadcn.
  primary: '#1E3A5F'          # sober deep slate-blue — the system speaking with earned confidence
  primary-foreground: '#F8FAFC'
  caution: '#B45309'          # amber-700 - "danger of yourself": win-streak, cooldown, override friction, news blackout
  caution-foreground: '#FFFBEB'
  halt: '#7F1D1D'             # deep muted red - auto-halt, drift-breach, daily-loss lock ("I don't trust myself")
  halt-foreground: '#FEF2F2'
  primary-dark: '#7DA7D9'
  primary-foreground-dark: '#0A1626'
  caution-dark: '#FBBF24'
  caution-foreground-dark: '#1A1208'
  halt-dark: '#F87171'
  halt-foreground-dark: '#1A0A0A'
typography:
  # Body, label, muted inherit shadcn (Geist Sans). Only display is overridden —
  # a restrained serif for the few moments the system speaks in the first person.
  display:
    fontFamily: 'Newsreader'
    fontSize: 32px
    fontWeight: '400'
    lineHeight: '1.2'
    letterSpacing: -0.01em
  display-sm:
    fontFamily: 'Newsreader'
    fontSize: 22px
    fontWeight: '400'
    lineHeight: '1.25'
  mono:
    # Numbers (giá, size, R:R, expectancy) — tabular, unambiguous.
    fontFamily: 'Geist Mono'
    fontVariantNumeric: 'tabular-nums'
rounded:
  sm: 4px
  md: 6px
  lg: 8px
spacing:
  # shadcn / Tailwind defaults inherited; no overrides.
components:
  suggestion-card:
    background: '{colors.card}'
    border: '{colors.primary}'
    radius: '{rounded.lg}'
  silence-state:
    foreground: '{colors.muted-foreground}'
  danger-banner:
    background: '{colors.caution}'
    foreground: '{colors.caution-foreground}'
    radius: '{rounded.md}'
  halt-banner:
    background: '{colors.halt}'
    foreground: '{colors.halt-foreground}'
    radius: '{rounded.md}'
  override-confirm-dialog:
    border: '{colors.caution}'
    radius: '{rounded.lg}'
---

## Brand & Style

Brighten is a **discipline machine**, not a prophet. Its whole premise is that price is uncontrollable, so the product only ever suggests the things the trader *does* control — enter or wait, size, stop, exit — and never places an order. The brand expression must carry that posture: **sober, honest, un-hyped**. This is the anti-thesis of a neon trading terminal. No dopamine, no confetti, no green "you're winning" glow.

The signature inversion: **a winning streak is rendered as a danger state (amber), not a success (green).** After wins is exactly when the trader over-trades and gives it all back, so the interface treats a hot streak the way a good coach does — with a warning, not a high-five. Green-as-euphoria is *banned* everywhere.

Brighten inherits shadcn/ui wholesale and specifies only the brand-layer delta: three semantic colors (`primary`, `caution`, `halt`), a restrained serif for the moments the system speaks in first person, tabular mono for every number, and a handful of product-specific components (the suggestion card, the silence state, the two banners, the override dialog). Everything else is shadcn's default — customizing beyond the brand layer is against the discipline.

## Colors

Three brand semantics on top of shadcn neutrals. Each means exactly one thing.

- **Primary — Slate-Blue (`#1E3A5F` / dark `#7DA7D9`)**: the system speaking with *earned* confidence. Suggestion card border, primary actions, active nav, the drift-meter's healthy zone. Confidence, never excitement.
- **Caution — Amber (`#B45309` / dark `#FBBF24`)**: *"the danger is you."* Win-streak dampening, cooldown timers, news blackout, and the override-friction dialog. Amber means *slow down*.
- **Halt — Muted Red (`#7F1D1D` / dark `#F87171`)**: *"I don't trust myself right now."* Live-drift breach auto-halt, daily-loss lock, regime-change pause. Serious, desaturated — a full stop, not an alarm.
- **All other tokens** inherit shadcn defaults. Notably there is **no success/profit green token** — P&L and direction are shown in neutral `foreground` with mono numerals and directional glyphs, never color-coded to trigger emotion.

Avoid: green for gains, red for losses (P&L is neutral, factual), gradients, glow, more than the three brand semantics, using `caution`/`halt` decoratively.

## Typography

- **Body / label / caption**: shadcn Geist Sans, unchanged.
- **Display (`Newsreader` serif, 32/22px)**: reserved for the ~4 moments the system speaks in the first person — the silence state ("không có edge rõ ràng — chờ"), the danger warning, the auto-halt statement, and the first-session greeting. The serif gives these gravity; it is a punctuation mark, not a default voice.
- **Mono (`Geist Mono`, tabular-nums)**: every number — price, size, stop, R:R, expectancy, drift %. Tabular so columns of figures align and never jitter on live update.

## Layout & Spacing

shadcn / Tailwind 4-based scale inherited as-is. Max content width `max-w-4xl` (896px) — Brighten is a focused decision surface, not a dense multi-panel terminal. Single-column primary flow; the trust rail (drift + discipline state) is a persistent right column on `lg+`, collapsing above the fold on smaller viewports.

## Elevation & Depth

Inherited from shadcn — subtle shadow on interactive surfaces only. The suggestion card gets the *single* elevated moment on the Now surface; everything else stays flat. Depth is not a decoration budget.

## Shapes

Tool-crisp: `rounded/sm` (4px) inputs, `rounded/md` (6px) banners/buttons, `rounded/lg` (8px) suggestion card and dialogs. Pills (`rounded/full`) only on discipline-state badges (cooldown, streak count, blackout).

## Components

Used from shadcn as-is: `Button`, `Card`, `Dialog`, `Sheet`, `Badge`, `Toast`, `Tabs`, `Table`, `Separator`, `Skeleton`, `Tooltip`, `Popover`.

Brand-layer components:

- **Suggestion card** — the Đề xuất. `{colors.card}` fill, `{colors.primary}` border, `{rounded.lg}`, the one elevated element on Now. Shows direction, size, stop, target, R:R (mono), and the LLM "why". Confident, not celebratory.
- **Silence state** — the "no edge, wait" surface. `display` serif in `{colors.muted-foreground}`, centered, calm. Deliberately *not* an empty-state error.
- **Danger banner** — `{colors.caution}` fill. Win-streak dampening active, cooldown running, news blackout. Persistent, dismissible only by the condition clearing.
- **Halt banner** — `{colors.halt}` fill. Auto-halt / drift breach / daily-loss lock. Not dismissible; states the reason in first person.
- **Override-confirm dialog** — `{colors.caution}` border, requires a typed phrase + shows the running cooldown. High-friction by design.
- **Drift-meter** — horizontal gauge, backtest confidence band as the neutral track, live expectancy as a mono marker; marker crossing below the band flips the surface toward `{colors.halt}`.

## Do's and Don'ts

| Do | Don't |
|---|---|
| Render win-streak / hot state in `caution` amber | Ever use green to celebrate a win or a streak |
| Keep P&L and direction neutral + mono + glyphs | Color-code profit green / loss red |
| Give the silence state serif gravity | Treat "no edge" as an empty-state error |
| Speak in first person, plainly, no emoji | Add hype, exclamation marks, or 🎉 |
| Inherit shadcn for everything outside the 3 semantics | Introduce a 4th brand color or a gradient |
| Make override deliberately high-friction | Let override be a single quick click |
