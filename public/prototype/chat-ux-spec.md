# Ink Manager — Chat UX Specification (Edition 02)

**Status:** Draft for architect review → becomes `docs/chat-ux-spec.md` once approved.
**Edition note:** E02 re-grounds every visual rule in the **current dark mobile UI** (screenshot of the live Chat tab, Aug 26). Behavior rulings from E01 are unchanged unless marked. The mobile chat surface is the **dark Editorial Gold treatment**; the light/paper treatment belongs to the web portal and returns in the web-parity pass (§15). **Rev A (post-review):** the per-row channel chip line is retired — channel renders as an avatar badge (§1.1, §8). **Rev B (cleanliness pass, from E01/E02 side-by-side):** person names are never set in Fraunces (§1.2); the channel badge is lettered, not color-coded (§1.1); list rows adopt E01's spacing rhythm (§8). **Rev C:** the FREQUENT strip is removed; the filter chips consolidate into a Filter dropdown (left) mirroring Sort (right); list order is search → controls → PINNED → CONVERSATIONS (§8). Presence now surfaces only on the IN-APP thread-header avatar (§9).
**Companion:** `chat-ux-prototype.html` (Edition 02) — interactive ground truth. Prototype wins on *feel*, this document wins on *rules*.
**Scope:** `apps/mobile`, Expo SDK 54, Expo Go only.
**Source model:** iOS Messages interaction anatomy, adapted to Ink Manager's existing chat surface: multi-channel client threads **and** internal team/IN-APP threads (including group threads) in one list.

---

## 0. Scope and non-goals

**In scope:** presentation, motion, gesture, and interaction behavior of the Chat-center tab — conversation list and message thread — layered onto the screen furniture defined in §8 (top cluster, search, filter/sort controls row, tab bar).

**Out of scope (hard):**

- Schema changes without architect sign-off. Missing fields (e.g. `isPinned`) → the session **stops and reports**, never migrates.
- Live provider behavior (external typing signals, SMS delivery receipts) — Phase D. States are designed now, rendered only when truthful.
- iMessage features cut for v1: tapbacks/reactions, message effects, inline reply threading, edit/unsend, audio messages, FaceTime affordances. (Group *threads* are in scope — they already exist for IN-APP.)
- A light theme for mobile chat. The dark treatment in the screenshot is canonical for this surface; do not invent a light variant.

**Sensitive writes:** chat send is not on the sensitive-writes list; sessions may run unattended. Money/scheduling/permissions endpoints remain attended-only per `CLAUDE.md`.

---

## 1. Design tokens (chat-specific, dark edition)

Values marked ★ are **sampled from the screenshot** — the investigation session replaces them with the repo's actual token names/values before Part 1. `#C2402F` is exact. If the app's theme file disagrees with a sample, **the theme file wins**.

| Token | Value | Usage |
|---|---|---|
| `chat.surface` | ★ `#1A1410` | Screen background (warm near-black espresso) |
| `chat.surface.raised` | ★ `#251E17` | Search field, header blur tint, composer, sheets, keyboard, avatar fill |
| `chat.bubble.own.bg` | `#C2402F` (exact) | Outgoing bubble — the chat brand fill |
| `chat.bubble.own.text` | `#FFFFFF` | Outgoing bubble text |
| `chat.bubble.in.bg` | ★ `#2B231B` | Incoming bubble (elevated espresso) |
| `chat.text.primary` | ★ `#E7DCC4` | Names, bubble text incoming, icons (warm cream) |
| `chat.text.muted` | ★ `#9A8C74` | Previews, timestamps, meta, placeholders |
| `chat.accent.gold` | ★ `#C9A961` | Active filter chip, context chips, pin, READ MORE, internal-note accent |
| `chat.note.bg` | ★ `rgba(201,169,97,.10)` | Internal note fill (gold tint on dark) |
| `chat.alert.red` | `#C2402F` | Unread dot, failed sends, destructive confirm, CHAT tab fill — **red appears nowhere else** |
| `chat.presence.on` | ★ `#5CB36E` | Presence dot online; also the SMS channel swatch (see §1.1) |
| `chat.presence.off` | ★ `#6E675E` | Presence dot offline |
| `chat.hairline` | ★ `rgba(231,220,196,.09)` | Row separators, field borders, header divider |

### 1.1 Channel indicator (lettered avatar badge)

Per review (rev B): channel identity in the conversation list renders as a **lettered badge on the avatar** — pill/circle ~18pt (min-width 18, padding 0×3), radius 9, `chat.surface.raised`-plus fill (`--raised-2`), 2pt `chat.surface` border, Jura ~7.5–8 bold caps code, anchored bottom-right — keeping every row to **two text lines**. Codes: `SMS · IG · EM · FB · PH · APP` (IN-APP renders as `APP`). The channel's **full name** lives in the thread header sub-line (§9), which keeps a small swatch + Jura caps label.

The badge is **neutral, not color-coded** — the letters carry the meaning. The semantics stay clean: colored square = *presence* (now only on the IN-APP thread-header avatar, §9), lettered circle = *channel* (conversation rows). A subtle per-channel tint on the badge is permitted later as a nice-to-have if the repo already has a distinct channel color map, but it is **not required** and must never be the only signal. Channel color never bleeds into bubbles: bubbles stay red/espresso regardless of channel (iMessage's blue/green transport split maps to the badge, not the bubble).

### 1.2 Type roles (unchanged)

| Role | Face | Spec |
|---|---|---|
| Screen titles and avatar **monogram initials** only — never a person's name | Fraunces | row-avatar initials ~16/600 |
| **Person/customer names**, bubble body, previews, composer input, strip names | Outfit | names 16/600 (rows) · 17/600 (thread header); 16 bubbles; 14 previews; 13 strip names |
| All metadata: section labels (`PINNED`, `CONVERSATIONS`), filter/sort dropdowns, badge codes, timestamps, delivery status, `INTERNAL` tag, tab labels | Jura | 7.5–11, letter-spaced caps |

Fraunces never appears inside a bubble and never sets a person's name — it reads as display type and at row scale it shouts. Jura never sets body copy. Icons render in `chat.text.primary`/`muted` — never red (red icons = the CHAT tab fill and alerts only).

---

## 2. Message thread

### 2.1 Bubble anatomy and grouping (unchanged rules, dark values)

- Max width **78%**, padding 10×14, radius **18**, tail (≈6×8 curve) on **last bubble of a group only** — own right / incoming left, tail color matches bubble.
- Grouping: same sender + same direction + gap ≤ **60s** + same status class (FAILED breaks the group). Intra-group gap **2**, inter-group **10**, around separators **16**.
- **Sender attribution** (shared inbox + group threads): outgoing groups from someone other than the current user, and **every** sender change inside IN-APP group threads, get `SENT BY {NAME}` / `{NAME}` in Jura 10 caps `chat.text.muted` above the group's first bubble. Your own sends show nothing.

### 2.2 Timestamps and separators (unchanged)

Gap > **60 min** → centered separator, Jura 11 `chat.text.muted`: bold day word + regular time (`Today 2:14 PM`, `Yesterday`, weekday ≤ 7d, else `Aug 12, 2:14 PM`). Per-message times are reveal-only (§2.3). Delivery status line under the **last outgoing message only**.

### 2.3 Drag-to-reveal timestamps (signature gesture #1, unchanged)

Pan left anywhere on the list → all bubbles shift left in unison, max travel **84**, resistance **0.55**, per-message times (Jura 11, muted) fade in over the first 24pt in the vacated right gutter. Release → spring S2 snap-back. Horizontal intent must win (|dx| > |dy| in first 10pt); vertical scroll never hijacked. Gesture-handler Pan + Reanimated shared value.

### 2.4 Delivery states (truth-constrained, unchanged)

| State | Rendered v1 | Treatment |
|---|---|---|
| `QUEUED` | yes | Bubble 60% opacity, `SENDING…` |
| `SENT` | yes | `SENT`, Jura 10 caps muted, under last outgoing only |
| `FAILED` | yes | Red ⚠ badge (18pt) left of own bubble + `NOT DELIVERED · TAP TO RETRY` in red; tap → retry sheet (Retry / Copy text / Discard) |
| `DELIVERED` / `READ` | **dormant** | Designed; rendered only when a Phase D provider reports it |

No fake states. If the API only knows "persisted," render `SENT`.

### 2.5 Media and link bubbles (unchanged; dark loading states)

Image bubble: radius 18, no padding, max height 280, blurhash/skeleton via `expo-image`. Tap → full-screen viewer (fade to black, pinch-zoom, swipe-down dismiss with progressive opacity). Candidate `react-native-awesome-gallery` pending Expo Go check, else bespoke. List previews of media messages render `🖻 Image`-style icon + label exactly as the current UI does. Link previews only from already-available OG data — no new fetch infra.

### 2.6 Channel-specific treatment

- Header carries the channel chip (§1.1). Bubbles never change color by channel.
- **Email:** > 6 lines collapses with fade-to-`chat.bubble.in.bg` mask + `READ MORE` (Jura caps, gold). Subject renders above body, Outfit 14/600.
- **IN-APP** (team) threads: presence-aware header (§9), group naming per §2.1; otherwise identical anatomy.
- **Internal notes** on client threads (only if the message type exists — investigation confirms): `chat.note.bg` fill, 3pt gold left border, `INTERNAL` gold Jura tag, radius 12, no tail, excluded from delivery logic.

---

## 3. Composer (unchanged rules, dark values)

Raised bar, hairline top. Plus button (28pt, cream) → attachment sheet (Photo Library / Camera, `expo-image-picker`). Field: `chat.surface` fill? — no: field sits **darker than the bar**: fill `chat.surface`, hairline border, radius 18, Outfit 16 cream, placeholder `Message` in muted; min 36, grows to 5 lines (~120) then scrolls, growth animates S3. Send: 30pt red circle, white ↑, scale-in on first character, never shown disabled. Send → `impactLight` → send-fly (§10) → optimistic `QUEUED` → `SENT` on ack.

## 4. Keyboard choreography (unchanged)

`react-native-keyboard-controller` — Expo Go-bundled since SDK 54; install via `npx expo install` only. Composer rides per-frame keyboard height; **interactive dismissal is a Part 2 acceptance requirement**; list stays bottom-anchored on open. Fallback path if the Go binary misbehaves: `KeyboardAvoidingView` + `keyboardDismissMode="interactive"`, reported explicitly.

## 5. Scroll behavior (unchanged)

List primitive ratified by investigation (installed FlashList preferred; LegendList or tuned FlatList otherwise; JS-only). Bottom-anchored; `maintainVisibleContentPosition` for history pagination. New own message → animate to bottom. New incoming while > 200pt from bottom → viewport doesn't move; **scroll-to-bottom pill** (36pt raised espresso circle, cream chevron, red count badge). Pagination spinner row at top, position preserved.

## 6. Typing indicator (unchanged)

Incoming-style bubble, 3 dots 7pt, 150ms stagger, 1.3s loop, S1 pop in/out, real list row. Wired **only** to real signals: internal WebSocket typing events if they exist (investigation); external channels wait for Phase D. Never simulated.

## 7. Long-press message actions (unchanged)

No native context menus in Expo Go → bespoke overlay: 350ms press (cancel at >8pt movement), `impactMedium`, `expo-blur` dark scrim (intensity ~40 + 45% dim), bubble clone springs to 1.04, sheet (raised espresso, radius 16, cream text): **Copy** · **Message details** · FAILED adds **Retry** (first) and **Discard** (red). Dismiss reverses with S2.

## 8. Conversation list

Screen furniture (rev C): top cluster (drawer · tasks badge · bell · avatar), search field, then a **controls row** — **Filter dropdown left-aligned, Sort dropdown right-aligned**, both in the chevron + Jura-caps style. Filter options: All / Unread / Needs Action; when a non-default filter is active the control shows the selection in gold (the active-state language the old chips used). Sort menu contents are TBD pending Q14/product ruling. The **FREQUENT strip is removed** — pinned threads are this screen's quick access. Bottom tab bar with the raised red CHAT button is retained. This series adds behavior beneath that furniture:

- **Row anatomy** (E01 rhythm, dark values): 20pt horizontal inset · inline unread dot in flex flow (not edge-pinned) · avatar **44** (espresso fill, hairline ring, Fraunces monogram) carrying the lettered **channel badge** (§1.1) bottom-right · name **Outfit 16/600** cream · timestamp Jura 11 muted right (`7h` < 24h, weekday ≤ 7d, else `Aug 10`) · preview Outfit **14, two-line clamp** (`You:` / `{Name}:` prefix; media as inline icon + `Image`). Section labels (`PINNED`, `CONVERSATIONS`) Jura 10, .2em tracking, 22pt inset. Hairline separators inset 76.
- **Preview authorship** depends on `lastMessage.author` (backend queue item) — the current UI already renders `You:` / `LouieG:`, so the investigation confirms whether that's live data or client-side inference, and standardizes on the backend field.
- **Unread:** 8pt red dot leading the row; name stays cream, preview lifts to `chat.text.primary`. Feeds the `UNREAD` filter chip and the CHAT tab badge from the same source of truth (investigation Q).
- **Swipe right → Pin/Unpin** (gold panel, pin glyph): pinned threads sort to top under a `PINNED` Jura label, directly beneath the controls row, with a small gold pin glyph by the timestamp — **no iMessage avatar grid**; pins are the screen's quick access. Max 3.
- **Swipe left → Mute · Archive:** mute = muted-brown panel (suppresses badge/push); archive = near-black panel, full-swipe commits. **No Delete** — client conversations are business records; archive is reversible from a filter. IN-APP team threads: archive hides locally, never destroys history.
- Persistence: `isPinned` / `mutedUntil` / `archivedAt` (or equivalents) — investigation inventories; anything missing → gesture ships behind local state only if trivially wireable, else escalated for a schema decision. No silent migrations.
- Row press → thread. **Edge-swipe back** must work.

## 9. Thread header and context

Translucent raised-espresso header (`expo-blur` dark + tint), hairline bottom, content scrolls beneath. Left: back chevron (**cream**, not red). Cluster: avatar 32 · name **Outfit 17/600** cream (per §1.2, names are never Fraunces) · beneath: channel swatch + full channel name + handle/number in Jura 10 caps muted. IN-APP threads: presence dot on the avatar; group threads list member names in the sub-line. Right: ⓘ cream → details.

**Context chip row** (client threads — the thing iMessage doesn't have): gold-outline chips in the exact style of the active filter chip — `INQ-0247 · BLACKWORK SLEEVE · ESTIMATE ACCEPTED`, `DEPOSIT · PAID` — tap → linked inquiry/project. Horizontally scrolls; part of the header blur unit; collapses on scroll-down, returns on scroll-up (44pt, S2).

## 10. Motion and haptics map (unchanged)

`chatMotion.ts` presets: **S1 pop** 200/16 (incoming entry from bottom-outer corner, typing, long-press lift) · **S2 settle** 260/30 (drag snap-back, header collapse, sheet dismiss, pill) · **S3 ui** 320/28 (composer growth, send-button, swipe snap) · **S4 fly** 240/26 (send-fly).

**Send-fly (signature #2):** committed text lifts from the input as a pre-rendered own bubble and springs to its final list position, cross-fading into the real row at ~70%; ≈380ms total. If device frame-rate dips below 55fps → fallback to S1 pop at destination, decided at the Part 3 gate, not silently.

Haptics: `impactLight` send/pin/pill · `impactMedium` long-press · `selectionAsync` sheet highlight · `notificationError` on FAILED. Reduced-motion: springs collapse to 150ms fades, send-fly off.

## 11. Empty, loading, error states

Thread empty: avatar 64, Fraunces name cream, `START THE CONVERSATION` Jura caps muted, channel chip. List empty (post-filter too): `NO CONVERSATIONS` + one Outfit sentence. Loading: existing skeleton foundation, dark shimmer — reuse, don't fork. Send failure inline only (§2.4). Connection loss: hairline banner under header, `RECONNECTING…` gold Jura caps.

## 12. Accessibility floor (unchanged)

Bubble `accessibilityLabel` = "{sender}, {time}: {text}"; FAILED announced. The channel badge's lettering is tiny, so every conversation row's `accessibilityLabel` still includes the channel name ("Marisol Vega, SMS, unread, last message …"). Gesture-only actions have reachable equivalents (times in Message details; swipe actions duplicated in row long-press; pill is a real button). Targets ≥ 44pt with hit-slop; OS font scaling to 1.3× without breakage. Cream-on-espresso and muted-on-espresso pairs must clear WCAG AA at rendered sizes — verify the sampled values, adjust muted upward if needed.

## 13. Library rulings (unchanged)

**Allowed:** reanimated, gesture-handler, expo-haptics, expo-blur, expo-image, expo-image-picker, react-native-keyboard-controller (SDK 54 Go-bundled), date-fns, FlashList/LegendList (JS-only).
**Forbidden:** gifted-chat; Zeego / native context menus / anything needing a dev build; hand-retyped enums (codegen only). All installs via `npx expo install`; every dependency addition listed in the session report.

## 14. Build plan mapping (unchanged)

Investigation first, then five parts, commit-and-push per part, device gate per part (Expo Go walkthrough + screen recording):

| Part | Delivers | Gate evidence |
|---|---|---|
| 1 | Thread anatomy: grouping, tails, separators, attribution, delivery states, email collapse, dark tokens wired | Grouped-thread scroll; failed-state tap |
| 2 | Composer + keyboard choreography | Interactive dismiss; growth; bottom-anchor |
| 3 | Motion + haptics: send-fly, presets, typing, pill, drag-to-reveal | Send-fly; timestamp drag; pill w/ badge |
| 4 | List behaviors on existing furniture: unread, swipes, pins, previews | Both swipes; pin persistence or report |
| 5 | Long-press overlay + attachments + image viewer | Sheet; full-screen dismiss |

Reports state: shipped, cut + why, deps touched, commit hash, escalations.

## 15. Web parity (deferred)

`ConversationsPanel.tsx` adopts anatomy, states, and row rules in the **light** Editorial Gold treatment — separate edition when scheduled.

## 16. Open questions for the investigation session

1. Repo token names/values for every ★ — theme file wins over screenshot samples.
2. `channel → color` map incl. IG/EMAIL/FB/OTHER — now **reference only** (§1.1 rev B: badges are lettered, color is an optional future tint, never the sole signal). Read the web `ConversationsPanel` channel-tag colors and report what exists; no proposal needed.
3. Chat component inventory + installed list primitive.
4. `react-native-keyboard-controller` smoke test in the current Go binary.
5. Message status field actually persisted today.
6. `isPinned` / `mutedUntil` / `archivedAt` (or equivalents) on Conversation.
7. WebSocket typing event — exists?
8. `lastMessage.author`: live backend field or client-side inference in the current list?
9. Unread source of truth (row dot ↔ UNREAD filter ↔ CHAT tab badge ↔ bell).
10. Presence source (real signal like socket presence/lastSeen, or static?) — with FREQUENT removed, presence surfaces only on the IN-APP thread-header avatar dot (§9).
11. Internal-note message type — exists?
12. Group-thread naming/membership shape for IN-APP threads.
13. `react-native-awesome-gallery` Expo Go compatibility.
14. `NEEDS ACTION` filter semantics — what flags a thread as needing action?
