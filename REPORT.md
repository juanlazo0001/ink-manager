# Phase UI-2 — Visual Redesign Report

Branch: `ui/visual-redesign`, cut from `main` at `40204f5`. Frontend-only (`apps/web`); zero schema/migration changes, zero backend route changes.

Reference image used: `public/desktop/screenshots/layout v3.jpg` (only copy present in the repo; no `.webp` duplicate existed).

## 1. Final design tokens

Defined once in `apps/web/src/index.css`'s `@theme` block (Tailwind v4 is CSS-native in this project — there is no `tailwind.config.js`/`.ts` to extend, so the token layer lives here instead of the literal "tailwind.config theme extension" the prompt described). Every component consumes these via generated utilities (`bg-surface`, `text-fg-secondary`, `border-border`, `bg-success/15`, etc.) — no hardcoded hex values remain in component files.

| Token | Value | Utility |
|---|---|---|
| `--color-bg` | `#0a0a0b` | `bg-bg` / `text-bg` |
| `--color-surface` | `#17171a` | `bg-surface` |
| `--color-surface-raised` | `#1e1e22` | `bg-surface-raised` |
| `--color-surface-inset` | `#121214` | `bg-surface-inset` |
| `--color-border` | `#ffffff14` (~8%) | `border-border` |
| `--color-border-strong` | `#ffffff26` (~15%) | `border-border-strong` |
| `--color-fg` | `#f4f4f5` | `text-fg` |
| `--color-fg-secondary` | `#a1a1aa` | `text-fg-secondary` |
| `--color-fg-muted` | `#8b8b94` | `text-fg-muted` |
| `--color-accent` | `#c9f031` | `bg-accent` / `text-accent` |
| `--color-accent-fg` | `#0a0a0b` | `text-accent-fg` (dark text on accent fills) |
| `--color-accent-hover` | `#b8dd25` | `hover:bg-accent-hover` |
| `--color-success` | `#4ade80` | `bg-success/15 text-success` |
| `--color-info` | `#60a5fa` | `bg-info/15 text-info` |
| `--color-warning` | `#fbbf24` | `bg-warning/15 text-warning` |
| `--color-danger` | `#f87171` | `bg-danger/15 text-danger` |
| `--color-neutral` | `#b4b4bd` | `bg-neutral/15 text-neutral` |

**Naming deviation from the prompt's literal names:** text tokens are `fg`/`fg-secondary`/`fg-muted`, not `text-primary`/`text-secondary`/`text-muted` — Tailwind auto-generates the `text-*` utility from the token name, so `--color-text-primary` would have produced the doubled-up class `text-text-primary`. Same values, cleaner name.

**Radius/type/spacing:** no new tokens needed — the codebase already used Tailwind's stock scale consistently (`rounded-2xl` cards, `rounded-full` pills, `rounded-xl`/`rounded-lg` inputs; `text-2xl`/`3xl` titles, `text-sm` body, `text-xs` labels), matching the spec's scale exactly. Inter is self-hosted via `@fontsource/inter` (400/500/600/700), already wired before this phase — no font work needed.

**Native `<select>` fix:** Windows/Chromium ignores `background-color` on the native dropdown-arrow region regardless of className, leaving a pale swatch on every select in the app. Fixed once, globally, in `index.css`'s base layer (`appearance: none` + a custom SVG chevron) rather than touching each of the 8 files with selects.

## 2. Status → semantic mapping

Single source of truth: `apps/web/src/components/StatusPill.tsx`. Every status pill in the app (inquiries, appointments, gift cards, waivers, team active/inactive, ad hoc synthetic statuses like consent-form pending/signed) renders through this one component.

- **Inquiry pipeline:** `NEW`/`ARTIST_ASSIGNED` → info · `AWAITING_CLIENT_RESPONSE`/`BUDGET_NEGOTIATION`/`DEPOSIT_PENDING`/`WAITLISTED` → warning · `SCHEDULING`/`CONFIRMED` → success · `CLOSED_LOST`/`COLD_LEAD` → neutral
- **Appointments:** `REQUESTED` → info · `CONFIRMED`/`COMPLETED` → success · `CANCELLED` → neutral · `NO_SHOW` → danger
- **Gift cards:** `ACTIVE` → success · `REDEEMED` → neutral · `EXPIRED` → warning · `VOID` → danger
- **Waivers:** `PENDING` → warning · `SIGNED` → info · `VERIFIED` → success
- **Team status / synthetic:** `ACTIVE` → success, `DEACTIVATED` → neutral (reuses the gift-card `ACTIVE` tone); consent-form "Signed {date}" / "Pending" reuses the waiver `SIGNED`/`PENDING` tones via `StatusPill`'s `label` override prop.

`WAITLISTED` and `BUDGET_NEGOTIATION` weren't explicit in the phase brief's mapping prose; both were placed under warning as "still waiting on an action," consistent with `DEPOSIT_PENDING`.

## 3. AA-contrast adjustments made vs. the written spec

Computed sRGB relative luminance / contrast ratio for every text-on-background pairing actually used, per the accessibility floor's instruction to verify computed pairs rather than assume:

- **`fg-muted` bumped from the spec's suggested `~#6B6B74` to `#8b8b94`.** `#6B6B74` on `--color-surface` computes to **~3.4:1** — fails WCAG AA's 4.5:1 for normal text. `#8b8b94` computes to **~5.3:1** — passes comfortably. This is the only token value changed from the spec's literal suggestion.
- `fg-secondary` (`#a1a1aa`) on surface: **~7.0:1** — passes.
- `fg` (`#f4f4f5`) on `bg`/`surface`: >19:1 — no concern.
- `accent-fg` (`#0a0a0b`) on `accent` (`#c9f031`) — used for every filled accent button/pill: **~15:1** — passes AAA even at small sizes, confirming dark-text-on-accent is safe everywhere it's used.
- Semantic status text-on-tinted-background (the actual rendered pair, i.e. the status color blended at 15% over `surface`, not the flat token): success **~7.6:1**, danger **~5.2:1**, calculated the same way for info/warning — all clear AA for normal text. The spec's own caution ("lime on near-black... check small text usage") turned out to be a non-issue once computed: accent-as-text on `bg`/`surface` is >15:1 regardless of size.

## 4. Where usability won over the reference aesthetic

- **No KPI donut/line charts, vehicle illustration, or embedded map** were replicated from the reference — per the brief, only the reference's surface/pill/type/spacing *language* was taken. The pre-existing Dashboard widgets (stat cards, weekly bar chart, artist workload bars, today's-appointments table) were reskinned in place, not replaced or extended with new chart types.
- **Status is never color-only**: every `StatusPill` always renders its text label alongside the tint, per the accessibility floor, even where the reference's own dashboard leans more heavily on color/iconography alone.
- **Focus-visible ring** added as a base-layer default (`:focus-visible { outline: 2px solid accent }`) so every interactive element gets a visible keyboard focus state even where no component author had added a bespoke one.
- **Modal focus behavior**: neither the shared `Modal` component nor `ConversationsPanel`'s slide-over trapped focus or auto-focused on open before this phase (the panel already had Esc-to-close from UI-1, but no Tab trap). Both now trap Tab/Shift+Tab within the dialog and restore focus to the trigger on close — a functional (not just cosmetic) accessibility addition, made because the phase's own accessibility floor explicitly requires it ("keyboard-reachable modals/slide-over — Esc closes, focus trapped").
- **Touch targets**: `TopBar`'s three circular icon buttons and the mobile sidebar hamburger were bumped from 40px (`h-10 w-10`) to 44px (`h-11 w-11`) to clear the accessibility floor's minimum. Smaller secondary icon buttons inside `ConversationsPanel`'s already-dense header row (28–32px) were **not** bumped — doing so risked visibly breaking that row's layout on mobile, and they're tertiary actions, not primary navigation. Flagged here rather than silently left as a gap.

## 5. Deviations from the reference image

- The reference's bottom-left Light/Dark segmented toggle was **not** built — explicitly out of scope this session ("dark is the brand default").
- The reference's active-nav chevron (small arrow inside the lime pill) was **not** added — the written spec asks for "the accent pill (rounded-full, dark text)" only; the chevron was a decorative flourish noted from the image but not requested, and skipping it keeps the change scoped to what was asked.
- No other hex/spacing values in the final tokens meaningfully diverge from the reference image — the written spec was already a faithful reading of it.

## 6. Known pre-existing issue found during verification (not fixed — out of scope)

**Desktop-width header collision:** on `Dashboard`, `Calendar`, `Clients`, and `Team` (and likely other pages with a primary action button in the top-right of their own in-page header), that button visually overlaps the app-wide fixed `TopBar` cluster at viewport widths where the page's flex header doesn't wrap (roughly ≥1280px). This is a **structural/positioning** defect that predates this phase — confirmed by checking that none of my edits touched positioning/layout classes for these elements, only color tokens. It became more visually obvious after the restyle because the affected buttons are now bright accent-lime rather than muted gray, but the underlying DOM overlap is unchanged. Since this phase's mandate is "restyle... must not move, add, or remove functionality, routes, or backend anything," it was **not** touched. Recommend a small follow-up (e.g. reserving top-clearance or right-margin on these specific page headers) in a future structural session. Does not occur on mobile widths, since the header row wraps below the fixed top bar there.

## 7. Verification performed

Both dev servers run against the dev DB (`hopper.proxy.rlwy.net`, confirmed via `apps/api/.env`). Clicked through, via Playwright, at desktop (1440×900) and phone (iPhone 12 viewport) widths:

- **As OWNER:** Dashboard, Inquiries & Projects (list + detail, including a live create → assign → artist-approve → send-estimate pipeline run against a fresh test inquiry — zero regressions, zero console errors), Calendar, Clients, Team (Staff/Artists/Permissions tabs), Tasks, Settings, Conversations (list + thread + quick-details drawer), Gift Card detail + QR, View As activation → banner → client-side navigation while impersonating → Exit.
- **As ARTIST:** Dashboard, My Inquiries, Calendar (role-scoped sidebar and top bar confirmed correct, no regressions from `useEffectiveUser()`).
- **All five public pages**, each fetched live (fresh tokens generated via the real API flows, not mocked): intake form (mobile), estimate response (mobile, live token), deposit form (mobile — hit the real "already signed" expired-link state, which renders correctly), waiver signing (mobile, live token, full clause list with per-clause initials), gift card view (mobile, live QR).
- Zero console/page errors across every check.
- Screenshots of the above are in `ui-screenshots/` (gitignored, not part of this commit).

## 8. Owner's options

1. **Review locally:**
   ```
   git fetch && git checkout ui/visual-redesign
   ```
   Run the dev servers as usual and click around against the dev DB.
   ```
   git checkout main
   ```
   returns you to the current design instantly.

2. **Approve** — merge the branch into main and push (this deploys it):
   ```
   git checkout main
   git merge ui/visual-redesign
   git push
   ```

3. **Discard** — production and main never knew this branch existed:
   ```
   git checkout main
   git branch -D ui/visual-redesign
   git push origin --delete ui/visual-redesign
   ```
