---
paths:
  - "frontend/**/*.tsx"
  - "frontend/**/*.ts"
  - "frontend/**/*.css"
---

# Design system

Full spec: `documentation/design/design-system.md`. Before changing UI, follow these rules.

- **No literal colors** in TSX/TS/CSS. Use theme tokens (`ide-*` today, semantic `--color-*` after the token migration). Phase colors come from the 10-color phase palette.
- **Text on a colored fill uses the `text` token**, never `#fff` and never the fill's own color. Fills are tints (18 % dark / 12 % light), the accent is a 3 px left bar.
- **One meaning per color.** On the calendar, color = phase. Priority, status, source and kind are icons or text.
- **One filled primary button per screen or dialog.** Delete in lists and footers is the `danger` text variant; solid red only for the confirm button of a delete dialog.
- **Font:** Onest 400/500/600 with the system fallback; `tabular-nums` for times and durations.
- **Type scale only:** 12 / 13 / 15 / 16 / 20 / 28 px. No `text-[10px]`, `text-[11px]`, `text-[0.65rem]`. Weights 400/500/600.
- **Radii:** 6 (chips, badges), 10 (controls, cards), 16 (dialogs, sheets), full (pills).
- **Same control height inside one form** (36 desktop / 44 phone). Inputs are 16 px text below 768 px (iOS zoom). Tap targets ≥ 44 px on the phone.
- **Phase colors** come only from the 10-color phase palette; no free HEX.
- **Check both themes and three sizes** (1440×900, 1920×1080, 390×844) before calling UI work done.
- **Copy:** «ви», durations as `1 год 30 хв`, weekdays as `Пн–Пт`, no internal words (`work`, `Generate`, `Color`).
