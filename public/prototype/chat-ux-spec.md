# Ink Manager — Chat UX Specification (Edition 02)

**Status:** Draft for architect review → becomes `public/prototype/chat-ux-spec.md` once approved.
**Edition note:** E02 re-grounds every visual rule in the **current dark mobile UI** (screenshot of the live Chat tab, Aug 26). Behavior rulings from E01 are unchanged unless marked. The mobile chat surface is the **dark Editorial Gold treatment**; the light/paper treatment belongs to the web portal and returns in the web-parity pass (§15). **Rev A (post-review):** the per-row channel chip line is retired — channel renders as an avatar badge (§1.1, §8). **Rev B (cleanliness pass, from E01/E02 side-by-side):** person names are never set in Fraunces (§1.2); the channel badge is lettered, not color-coded (§1.1); list rows adopt E01's spacing rhythm (§8). **Rev C:** the FREQUENT strip is removed; the filter chips consolidate into a Filter dropdown (left) mirroring Sort (right); list order is search → controls → PINNED → CONVERSATIONS (§8). Presence now surfaces only on the IN-APP thread-header avatar (§9). **Rev D (post-investigation + owner ruling, Aug 26):** red own-bubbles confirmed by owner ruling with the surface-anchored-failure rule (§1, §2.4); reactions retained and restyled (§0, §7); Part 4 descoped pending `UserConversationState` (§8, §14); archive adopts shipped studio-wide semantics (§8); typing dormant (§6); internal notes parked (§2.6); header/chips assigned to Part 1 with expo-blur (§9, §13, §14); baseline branch is main after the `mobile/session-ae` and `chat-ux/00-investigation` merges (§0). **Rev D.1 (Part 1b):** DELIVERED un-dormanted per architect ruling — provider `deliveryStatus` persists to `Message.metadata` (backend 32623a7); provider-reported failure is a truthful `FAILED` source; READ remains dormant; Android thread header uses the solid raised-espresso fallback (expo-blur is iOS-only in Expo Go practice), accepted per the Part 1 report. **Rev E (pre-combined-run, Aug 26):** provider-failure sheet semantics + email coverage + poll update path recorded (§2.4, §7); attachment reality recorded (§3); inverted-list anchoring mechanism recorded (§5); reduced-motion-as-hook + haptic latch + send-fly gate-toggle recorded (§10); Part 4 reunified with deployment conditionals and archive full-swipe demoted to tap-confirm (§8, §14); Part 5 refocused (§14); Parts 3–5 may run as one multi-checkpoint session per operator call (§14). **Rev F (gate findings, Aug 26 PM):** unread dot returns to the gutter — alignment-stable, out of flow (§8); CHAT tab badge specified as the cream Tasks-badge treatment, muted-excluded (§8); swipe rows rebuilt to the single-translating-front model after frame analysis showed threshold-pop reveals, split translation tearing, and off-spec panel widths (§8). **Rev G (device gate round 2, Aug 26 night):** owner reversal — own bubbles return to **gold** with ink text; the CLAUDE.md red exception reverts to the CHAT fab only, and the surface-anchored failure rule stays on its original rationale (§1, §2.1). Thread header collapses to a single standard-height line with the list's avatar-badge treatment (§9). Group threads get the duo-stack avatar (§8). Reactions get opaque iMessage-anatomy balloons (§7). Reveal gains a measured ≥12pt time gap (§2.3). The DIRECTION test control is removed (§3). Live-unread on arrival and the attachment crash are Session 07 diagnostics (§8, §3). Archive's swipe panel goes red, matching the clients-page archive treatment (§8); an open swipe row closes on any outside tap, tap consumed (§8); empty search gains a conditional start-new-chat CTA under the no-inert rule (§8). **Rev G (device gate round 2, Aug 26 night):** owner reversal — own bubbles return to **gold** with ink text; the CLAUDE.md red exception reverts to the CHAT fab only, and the surface-anchored failure rule stays on its original rationale (§1, §2.1). Thread header collapses to a single standard-height line with the list's avatar-badge treatment (§9). Group threads get the duo-stack avatar (§8). Reactions get opaque iMessage-anatomy balloons (§7). Reveal gains a measured ≥12pt time gap (§2.3). The DIRECTION test control is removed (§3). Live-unread on arrival and the attachment crash are Session 07 diagnostics (§8, §3). **Rev H (Aug 27):** empty-conversation search resolves through a **decision tree** — people layer (staff + clients, name/email/normalized phone, clients searched server-side) → `START CHAT WITH {NAME}` → `CREATE CLIENT "{query}"` prefilled by parse with a start-chat intent, the create offer duplicate-gated and failing closed (§8); consent refusals on a fresh client are reason-keyed with Retry retained, and manual-creation consent capture is escalated to product. **Rev H (owner ruling, Aug 27):** the **context chip row is removed** from the thread header — the ⓘ details sheet is the home for conversation context and the scroll-collapse choreography retires with the row (§9); the header is one 44pt row and its hairline. Recorded with it: the row rendered the linked INQUIRY, never tags, and the ⓘ is not yet wired — an open no-inert item, not a shipped sheet (§9).
**Companion:** `chat-ux-prototype.html` (Edition 02) — interactive ground truth. Prototype wins on *feel*, this document wins on *rules*.
**Scope:** `apps/mobile`, Expo SDK 54, Expo Go only.
**Source model:** iOS Messages interaction anatomy, adapted to Ink Manager's existing chat surface: multi-channel client threads **and** internal team/IN-APP threads (including group threads) in one list.

---

## 0. Scope and non-goals

**In scope:** presentation, motion, gesture, and interaction behavior of the Chat-center tab — conversation list and message thread — layered onto the screen furniture defined in §8 (top cluster, search, filter/sort controls row, tab bar).

**Out of scope (hard):**

- Schema changes without architect sign-off. Missing fields (e.g. `isPinned`) → the session **stops and reports**, never migrates.
- Live provider behavior (external typing signals, SMS delivery receipts) — Phase D. States are designed now, rendered only when truthful.
- iMessage features cut for v1: message effects, inline reply threading, edit/unsend, audio messages, FaceTime affordances. (Group *threads* are in scope — they already exist for IN-APP. **Reactions are NOT cut**: they shipped in session-ae as a stored, deliberately-promoted feature; this series retains them and restyles their entry point per §7.)
- A light theme for mobile chat. The dark treatment in the screenshot is canonical for this surface; do not invent a light variant.

**Baseline:** Parts 1–5 branch from `main` after `mobile/session-ae` and `chat-ux/00-investigation` are merged. The investigation report's evidence cites the AE lineage; where spec and shipped code differ, each part **reconciles the shipped implementation to spec** rather than building a duplicate.

**Sensitive writes:** chat send is not on the sensitive-writes list; sessions may run unattended. Money/scheduling/permissions endpoints remain attended-only per `CLAUDE.md`.

---

## 1. Design tokens (chat-specific, dark edition)

Values marked ★ are **sampled from the screenshot** — the investigation session replaces them with the repo's actual token names/values before Part 1. `#C2402F` is exact. If the app's theme file disagrees with a sample, **the theme file wins**.

| Token | Value | Usage |
|---|---|---|
| `chat.surface` | ★ `#1A1410` | Screen background (warm near-black espresso) |
| `chat.surface.raised` | ★ `#251E17` | Search field, header blur tint, composer, sheets, keyboard, avatar fill |
| `chat.bubble.own.bg` | **gold** — the repo's existing gold bubble token AE originally shipped (owner reversal, rev G; red proved too distracting in real use) | Outgoing bubble fill. Own-bubble text is **ink**. `CLAUDE.md`'s red exception reverts to the CHAT fab only — Session 07 records the reversal. |
| `chat.bubble.own.text` | `#FFFFFF` | Outgoing bubble text |
| `chat.bubble.in.bg` | ★ `#2B231B` | Incoming bubble (elevated espresso) |
| `chat.text.primary` | ★ `#E7DCC4` | Names, bubble text incoming, icons (warm cream) |
| `chat.text.muted` | ★ `#9A8C74` | Previews, timestamps, meta, placeholders |
| `chat.accent.gold` | ★ `#C9A961` | Active filter chip, context chips, pin, READ MORE, internal-note accent |
| `chat.note.bg` | ★ `rgba(201,169,97,.10)` | Internal note fill (gold tint on dark) |
| `chat.alert.red` | `#C2402F` | Unread dot, failed sends, destructive confirm, CHAT tab fill — **red appears nowhere else**. Failure affordances are always **surface-anchored** (§2.4): rendered on the espresso surface beside/below the bubble, never as a recolor of the fill — and against gold bubbles (rev G), alert-red pops exactly as the original argument said it would. |
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

- Max width **78%**, padding 10×14, radius **18**, tail (≈6×8 curve) on **last bubble of a group only** — own right / incoming left, tail color matches bubble. **Rev G:** own bubbles are **gold with ink text** (send-fly clone matches); links inside own bubbles render ink, underlined.
- Grouping: same sender + same direction + gap ≤ **60s** + same status class (FAILED breaks the group). Intra-group gap **2**, inter-group **10**, around separators **16**.
- **Sender attribution** (shared inbox + group threads): outgoing groups from someone other than the current user, and **every** sender change inside IN-APP group threads, get `SENT BY {NAME}` / `{NAME}` in Jura 10 caps `chat.text.muted` above the group's first bubble. Your own sends show nothing.

### 2.2 Timestamps and separators (unchanged)

Gap > **60 min** → centered separator, Jura 11 `chat.text.muted`: bold day word + regular time (`Today 2:14 PM`, `Yesterday`, weekday ≤ 7d, else `Aug 12, 2:14 PM`). Per-message times are reveal-only (§2.3). Delivery status line under the **last outgoing message only**.

### 2.3 Drag-to-reveal timestamps (signature gesture #1, unchanged)

Pan left anywhere on the list → all bubbles shift left in unison, max travel **84**, resistance **0.55**, per-message times (Jura 11, muted) fade in over the first 24pt in the vacated right gutter. Release → spring S2 snap-back. Horizontal intent must win (|dx| > |dy| in first 10pt); vertical scroll never hijacked. Gesture-handler Pan + Reanimated shared value. **Rev G — spacing rule:** at full travel there is a **clear gap ≥ 12pt** between every bubble's trailing edge and its timestamp's leading edge, verified by printed measurement; times right-align within the 84pt gutter.

### 2.4 Delivery states (truth-constrained, unchanged)

| State | Rendered v1 | Treatment |
|---|---|---|
| `QUEUED` | yes | Bubble 60% opacity, `SENDING…` |
| `SENT` | yes | `SENT`, Jura 10 caps muted, under last outgoing only |
| `FAILED` | yes | Red ⚠ badge (18pt) on the **surface** at the bubble's outer-left edge + `NOT DELIVERED · TAP TO RETRY` in red **below** the bubble; the red fill itself never changes color to carry state (surface-anchored rule, §1). Tap → retry sheet (Retry / Copy text / Discard) |
| `DELIVERED` | **yes (rev D.1)** | Read from `Message.metadata.deliveryStatus` (provider DLRs via backend commit 32623a7). Absent or unrecognized metadata → falls back to `SENT`. Provider `undelivered`/`failed` map to `FAILED` (same surface-anchored treatment). |
| `READ` | **dormant** | No read-receipt source exists for any live channel; stays designed-only. |

No fake states. If the API only knows "persisted," render `SENT`.

**Rev E — failure classes and the update path (shipped in 1b):** a **local** FAILED (optimistic send that never persisted) gets the full sheet — Retry / Copy text / Discard. A **provider** FAILED (persisted, rejected downstream) gets **Copy text plus one honest sentence** — Retry would post a duplicate and orphan the rejected row, and Discard would hide a message the poll resurrects; both are lies with a thirty-second half-life. The metadata guard covers **email** `deliveryStatus` too (superset shape, same rules). Status updates ride the existing **30-second thread poll**; a real-time flip is queued behind the Phase D backlog item "fast-path DLR webhook emits `conversation.updated`."


### 2.5 Media and link bubbles (unchanged; dark loading states)

Image bubble: radius 18, no padding, max height 280, blurhash/skeleton via `expo-image`. Tap → full-screen viewer (fade to black, pinch-zoom, swipe-down dismiss with progressive opacity). Candidate `react-native-awesome-gallery` pending Expo Go check, else bespoke. List previews of media messages render `🖻 Image`-style icon + label exactly as the current UI does. Link previews only from already-available OG data — no new fetch infra.

### 2.6 Channel-specific treatment

- Header carries the channel chip (§1.1). Bubbles never change color by channel.
- **Email:** > 6 lines collapses with fade-to-`chat.bubble.in.bg` mask + `READ MORE` (Jura caps, gold). Subject renders above body, Outfit 14/600.
- **IN-APP** (team) threads: presence-aware header (§9), group naming per §2.1; otherwise identical anatomy.
- **Internal notes** on client threads — **parked**: the investigation confirmed no such message type exists in the data model. The styling above stands as designed (`chat.note.bg` fill, 3pt gold left border, `INTERNAL` gold Jura tag, radius 12, no tail, excluded from delivery logic) for whenever the type lands via a future backend addendum; no part of this series builds it.

---

## 3. Composer (unchanged rules, dark values)

Raised bar, hairline top. Plus button (28pt, cream) → attachment sheet (Photo Library / Camera, `expo-image-picker`) — **rev E: shipped reality** (AE wired capture + upload end-to-end; Part 2 restyled it under the **no-inert-affordances rule**). **Rev G:** the `DIRECTION` control (outbound vs log-inbound, a testing artifact) is **removed from the UI**; the API's direction parameter remains, defaulting outbound, documented for a future deliberate manual-logging design. The picker crash found at gate is a Session 07 diagnostic — the working pick→upload→render path is the acceptance. Field: `chat.surface` fill? — no: field sits **darker than the bar**: fill `chat.surface`, hairline border, radius 18, Outfit 16 cream, placeholder `Message` in muted; min 36, grows to 5 lines (five full lines — the ceiling derives from line metrics, ≈128 with current type) then scrolls, growth animates S3; growth follows content size regardless of how the content arrived (keystroke, template, link, paste). Send: 30pt red circle, white ↑, scale-in on first character, never shown disabled. Send → `impactLight` → send-fly (§10) → optimistic `QUEUED` → `SENT` on ack.

## 4. Keyboard choreography (unchanged)

`react-native-keyboard-controller` — Expo Go-bundled since SDK 54; install via `npx expo install` only. Composer rides per-frame keyboard height; **interactive dismissal is a Part 2 acceptance requirement**; list stays bottom-anchored on open. Fallback path if the Go binary misbehaves: `KeyboardAvoidingView` + `keyboardDismissMode="interactive"`, reported explicitly.

## 5. Scroll behavior (unchanged)

List primitive ratified by investigation (installed FlashList preferred; LegendList or tuned FlatList otherwise; JS-only). Bottom-anchored; `maintainVisibleContentPosition` for history pagination. New own message → animate to bottom. New incoming while > 200pt from bottom → viewport doesn't move; **scroll-to-bottom pill** (36pt raised espresso circle, cream chevron, red count badge). Pagination spinner row at top, position preserved. **Rev E — implementation truth:** the thread is an **inverted FlatList inside the keyboard-translated container**, so bottom-anchoring holds *by construction* (a transform, no relayout, no scroll-offset management); pill distances measure from offset 0, and nothing in later parts may add offset management that fights this.

## 6. Typing indicator (unchanged)

Incoming-style bubble, 3 dots 7pt, 150ms stagger, 1.3s loop, S1 pop in/out, real list row. Wired **only** to real signals: internal WebSocket typing events if they exist (investigation); external channels wait for Phase D. Never simulated. **Rev D:** the investigation found no typing event anywhere on the socket layer, so Part 3 ships the component dormant behind a `__DEV__` prop; the WS typing event joins the Phase D backlog alongside the provider work.

## 7. Long-press message actions (unchanged)

No native context menus in Expo Go → bespoke overlay: 350ms press (cancel at >8pt movement), `impactMedium`, `expo-blur` dark scrim (intensity ~40 + 45% dim), bubble clone springs to 1.04, sheet (raised espresso, radius 16, cream text): **Copy** · **Message details** · FAILED adds its **class-appropriate items per §2.4 rev E** (local: Retry first + Discard red; provider: Copy text + one-sentence explanation only). Dismiss reverses with S2. **Reactions (rev D):** the shipped reactions feature is retained — its entry point restyles into an iMessage-style tapback row springing in **above the lifted bubble** (action sheet below); existing reaction storage and API semantics are reused. **Rev G — balloon anatomy (replaces the transparent stamps):** a reaction renders as an **opaque balloon** overlapping the reacted bubble's **top corner on the reactor's side** (their reaction on your bubble: top-left; yours on theirs: top-right), with two descending tail dots toward the bubble, slight shadow, z-above the bubble. Own reactions fill **gold**; others fill raised-espresso with a hairline. Emoji ~16pt in a ~30pt balloon; multiple reactions cluster horizontally from the corner. **Rev H — the reacted row RESERVES its own headroom.** A message with reactions grows its own row by `balloonHeight − overlap`, where the balloon overlaps the bubble's top corner by ~45% of its height (14 of 30, so 16 of headroom), and the balloon renders **entirely within its row's bounds**. No negative-margin overflow, and `zIndex` is never load-bearing across rows: in an inverted list the visually-above row paints later, so a balloon hanging outside its own row is chopped by construction and no z-order can rescue it. Neighbours therefore slide apart because the row GREW — layout, not choreography — including inside groups, where the 2pt inter-bubble gap opens to 2 + headroom for the reacted message only; tails, grouping class and attribution are untouched. Clusters grow horizontally within that one headroom, so the count never changes the row height twice. **Corner restated:** the corner is the REACTOR's side — their reaction on your bubble sits top-left, yours on theirs top-right; own balloons fill gold, others raised-espresso with a hairline.

## 8. Conversation list

Screen furniture (rev C): top cluster (drawer · tasks badge · bell · avatar), search field, then a **controls row** — **Filter dropdown left-aligned, Sort dropdown right-aligned**, both in the chevron + Jura-caps style. Filter options: All / Unread / Needs Action; when a non-default filter is active the control shows the selection in gold (the active-state language the old chips used). Sort menu adopts the options already shipped in the app (per investigation Q14) — no new sort semantics are invented in this series. **Rev H — empty search resolves through a decision tree** (replaces rev G's A/B/C wording, which this generalizes). No matches renders `NO CONVERSATIONS FOUND` (Jura caps, muted), and beneath it:

1. **Ask the people layer** — staff and clients, matched on name, email and **digit-normalized phone**. Clients are matched SERVER-side via `/clients/merge-search`; `GET /clients` has no search parameter and caps at 100, so filtering it locally answers "not in the newest hundred", which is not the same question. Staff are matched locally on name and email, being a small roster the screen already loads.
2. **Person exists, no thread →** per-person `START CHAT WITH {NAME}` rows, via the `POST /conversations` find-or-create (`clientId` or `staffUserId`). Client threads channel-default from their contact info exactly as the existing client-messaging path does — phone → SMS.
3. **No person at all →** `CREATE CLIENT "{query}"`, standard primary treatment (gold fill, ink label — **not red**), opening `client-new` prefilled by parse: all-digits → phone, @-shaped → email, else name. Carries a start-chat intent; on successful save the conversation is find-or-created and the app replaces into the thread.
4. **The plain empty copy remains beneath every state.**

**The CREATE row is duplicate-gated, and fails CLOSED.** It renders only when the people query *ran* and matched nobody — a failed search shows no offer, because "we could not look" must never render as "no such person". An ARTIST sees no offers at all (the route 404s them; no-inert).

**Phone matching is one-directional until the backend catches up.** `Client.phone` is stored normalized (bare ten digits), so a raw-digit query matches today and a **formatted** one does not. Closing that, plus matching secondary `ClientPhone` rows, is the `fix/merge-search-phone` order. Until it deploys, a formatted-phone miss is *unknown*, not *absent*.

**Consent on a freshly created client:** the A2P gate refuses outbound SMS until consent exists, and that is correct and unsoftened. When the refusal carries `code: "no_sms_consent"` the failed row reads `NO SMS CONSENT ON FILE` rather than `NOT DELIVERED`, and the local-FAILED sheet explains that sends unlock once the client completes their consent form. **Retry stays** — the row never persisted and the blocking state is one the client can change, which is the opposite of the provider-FAILED case where retry duplicates a stored message.

**Escalated as a product decision:** manual client creation captures no consent, so every client created this way starts un-textable with no in-app path to fix it — whether that flow should offer to send a consent request belongs to product, not to this spec. CTA uses the app's standard primary-button treatment — not red; red stays scarce post-reversal. The **FREQUENT strip is removed** — pinned threads are this screen's quick access. Bottom tab bar with the raised red CHAT button is retained. This series adds behavior beneath that furniture:

- **Row anatomy** (E01 rhythm, dark values): 20pt horizontal inset · unread dot **gutter-anchored** (rev F: absolutely positioned, vertically centered within the 20pt inset — occupies no layout width, so the avatar sits at exactly 20pt and alignment is identical read/unread) · avatar **44** (espresso fill, hairline ring, Fraunces monogram) carrying the lettered **channel badge** (§1.1) bottom-right · name **Outfit 16/600** cream · timestamp Jura 11 muted right (`7h` < 24h, weekday ≤ 7d, else `Aug 10`) · preview Outfit **14, two-line clamp** (`You:` / `{Name}:` prefix; media as inline icon + `Image`). Section labels (`PINNED`, `CONVERSATIONS`) Jura 10, .2em tracking, 22pt inset. Hairline separators inset 76.
- **Preview authorship** depends on `lastMessage.author` (backend queue item) — the current UI already renders `You:` / `LouieG:`, so the investigation confirms whether that's live data or client-side inference, and standardizes on the backend field.
- **Unread:** 8pt red dot leading the row; name stays cream, preview lifts to `chat.text.primary`. Feeds the `UNREAD` filter chip and the CHAT tab badge from the same source of truth (investigation Q). **Rev F — CHAT tab badge:** the fab carries an unread-conversation count in the **cream pill treatment of the Tasks badge** (reuse that component) — never red-on-red — top-right of the fab, hidden at 0, capped `99+`, **excluding muted threads** (the interruption/indicator rule made visible), reading the same Q9 source as the dot and filter.
- **Swipe right → Pin/Unpin** (gold panel, pin glyph): pinned threads sort to top under a `PINNED` Jura label, directly beneath the controls row, with a small gold pin glyph by the timestamp — **no iMessage avatar grid**; pins are the screen's quick access. Max 3, server-enforced. **Rev E:** `UserConversationState` is built and pushed (`00713fa`/`8a45b6c` on `session/api-integrity-notifications`) — Part 4 wires pin against `PATCH /conversations/:id/viewer-state` **if that branch is merged + deployed at session time** (probe the running dev API); 4th-pin `409 PIN_LIMIT` surfaces as a brief notice. Undeployed → pin ships later as the 4b micro-part.
- **Swipe left → Mute · Archive:** mute = muted-brown panel; product rule (backend-verified): **the mute suppresses the interruption, not the indicator** — tab badge stays quiet, the thread's own unread dot keeps accruing. Same deployment conditional as pin. Archive = **red panel** (`chat.alert.red` — the destructive slot, matching the clients-page archive button; white icon/label; rev G) with **shipped studio-wide semantics** (`archivedAt` hides the thread for everyone by explicit existing design). **Rev E:** because it is studio-wide, **full-swipe does not auto-commit** — the swipe reveals the button, the tap commits; and the swipe wires only to an existing archive endpoint (no-inert rule — if none exists, omit and report). Reversible from a filter. **No Delete** — client conversations are business records.
- **Rev F — swipe implementation mandate** (from frame analysis of the shipped version): one **row-front container translates** — dot, avatar, main, *and* the trailing time/pin column all inside it (split translation tears: a fixed timestamp over a revealed panel is the recorded failure). Action panels are **absolutely positioned behind** at fixed widths — pin **72pt**; mute + archive **72pt each** (−144 total). The pan drives a shared value **1:1 with the finger on the UI thread** (`activeOffsetX(±14)` / `failOffsetY(±12)` per the standing philosophy), rubber-bands past the snaps, and on release springs (S3) to the nearest of 0 / +72 / −144. Zero React re-renders during the drag (render-counter proof) and no state-threshold reveals — the finger owns the front. **Rev G — outside tap closes:** while a row is open, any tap outside its action buttons closes it with S3 and is **consumed** — it never simultaneously navigates or opens another thread; a tap on the open row's own front also just closes. Scroll-to-close and other-row-swipe-to-close remain.
- Persistence (rev E): `archivedAt` studio-wide; `isPinned`/`mutedUntil` live on `UserConversationState`, embedded in the list payload as `viewerState` once the backend branch deploys. **No local-state stand-ins for per-user prefs** — a pin that vanishes on reinstall is a broken promise; the deployment conditional descopes rather than fakes. Preview authorship prefers the backend `lastMessage.author` when deployed; otherwise the shipped client inference stands (Q8).
- **Rev G — group avatars (duo-stack, from the iMessage reference):** group threads render a composite — back avatar **40pt** (first member) top-left, front avatar **28pt** (second member) bottom-right overlapping with a **2pt surface ring**; more than two members → the front circle shows **`+N`**. Photos when present, Fraunces monograms otherwise. The lettered channel badge rides the composite's bottom-right corner. One shared component serves the list row and the thread header (§9).
- **Rev G — live unread:** a message arriving while the user is on the list (thread closed) must produce the row's gutter dot, the preview lift, and the fab-badge increment within **one list refresh cycle** — no app restart, no tab bounce. Session 07 diagnoses the current failure against the Q9 source and cites root cause.
- Row press → thread. **Edge-swipe back** must work.

## 9. Thread header and context

Translucent raised-espresso header (`expo-blur` dark + tint; Android solid fallback), hairline bottom, content scrolls beneath. **Rev G — single-line header at standard height:** total height = safe-area top + ~8pt padding + one 44pt row — no dead band above the name. Left: back chevron (**cream**). Center-left: avatar **32** carrying the **lettered channel badge exactly as the list renders it** (no swatch, no channel sub-line) · name **Outfit 17/600** cream, vertically centered. Group threads use the §8 duo-stack composite at header scale. Right: ⓘ cream → details. Presence dormancy rule unchanged.

**Rev H — the context chip row is removed** (owner ruling, Aug 27; replaces the rule below). The header is **one 44pt row and its hairline** — nothing between the name row and the thread. The **ⓘ details sheet is the designated home for conversation context**, and the **scroll-collapse choreography retires with the row**: no part of this header responds to scroll any more.

Two things the ruling should be read against, both established while removing it:

- **The row never rendered tags.** As shipped it rendered exactly ONE chip, built from `primaryInquiry` — description · placement · status. The gate's `TEST · TEST · NEW` was an inquiry whose description and placement were both "TEST" and whose status was NEW. `ConversationThreadTag` carries no human label to render, which is why tags were never on screen. No tag data changes.
- **The ⓘ is not wired yet, so §9's context has no home on screen today.** `ThreadHeader` accepts `onInfo`, but `conversation/[id]` does not pass it: the button renders muted and `disabled`. The chip's tap was the only path from a thread to its linked inquiry (`/staff-inquiry/[id]`), and removing the row removes it. Under this spec's own **no-inert-affordances rule** the ⓘ must either get its sheet or stop rendering — tracked as the open item from Session 12, not silently assumed done.

**Rev H — details sheet v1 (Session 13).** The ⓘ is wired and no longer inert. It opens the house bottom sheet (`components/Sheet.tsx`, the same one the attach and long-press sheets use — reused, not forked) containing:

- **PARTICIPANTS** — one row per person: the shared avatar with its lettered channel badge, the display name, and the channel's full name beneath. Group threads list every member; CLIENT/STAFF threads are their single counterpart. The second line is the channel because that is what the retired two-line sub-line actually rendered — it read `channelLabel(channel) + (handle ? ' · ' + handle : '')`, and **no commit in this repo ever passed a `handle`**; there is no handle/number field on the thread payload. A number or @handle would require data the screen does not hold, i.e. a new request, which v1 does not make.
- **LINKED INQUIRY** — rendered only when `primaryInquiry` exists, absent entirely otherwise (not an empty section). Its label is the removed chip's exact composition — description · placement · status — and tapping it pushes `/staff-inquiry/[id]`, the same call the chip made, recovered from the commit that deleted it rather than reinvented.

No new API calls: everything renders from `ConversationThreadHeader`, which the screen already holds. **This closes the no-inert item opened above.**

*Superseded (rev G and earlier):* Context chip row (client threads — the thing iMessage doesn't have): gold-outline chips in the exact style of the active filter chip — `INQ-0247 · BLACKWORK SLEEVE · ESTIMATE ACCEPTED`, `DEPOSIT · PAID` — tap → linked inquiry/project. Horizontally scrolls; part of the header blur unit; collapses on scroll-down, returns on scroll-up (44pt, S2).

## 10. Motion and haptics map (unchanged)

`chatMotion.ts` presets: **S1 pop** 200/16 (incoming entry from bottom-outer corner, typing, long-press lift) · **S2 settle** 260/30 (drag snap-back, header collapse, sheet dismiss, pill) · **S3 ui** 320/28 (composer growth, send-button, swipe snap) · **S4 fly** 240/26 (send-fly).

**Send-fly (signature #2):** committed text lifts from the input as a pre-rendered own bubble and springs to its final list position, cross-fading into the real row at ~70%; ≈380ms total. If device frame-rate dips below 55fps → fallback to S1 pop at destination, decided at the Part 3 gate, not silently.

Haptics: `impactLight` send/pin/pill · `impactMedium` long-press · `selectionAsync` sheet highlight · `notificationError` on FAILED — **transition-only, behind a once-per-message-id latch** (polls, re-renders, and history loads never re-buzz; messages arriving already-failed from history are silent). Reduced-motion: springs collapse to 150ms fades, send-fly off — and the setting is read via the **`useReducedMotion` hook, never a module constant** (the OS toggle can flip mid-session). The send-fly ships behind a `__DEV__` toggle; the **operator's gate verdict picks the shipping default** (fly vs S1 pop), never a silent frame-rate guess.

## 11. Empty, loading, error states

Thread empty: avatar 64, Fraunces name cream, `START THE CONVERSATION` Jura caps muted, channel chip. List empty (post-filter too): `NO CONVERSATIONS` + one Outfit sentence. Loading: existing skeleton foundation, dark shimmer — reuse, don't fork. Send failure inline only (§2.4). Connection loss: hairline banner under header, `RECONNECTING…` gold Jura caps.

## 12. Accessibility floor (unchanged)

Bubble `accessibilityLabel` = "{sender}, {time}: {text}"; FAILED announced. The channel badge's lettering is tiny, so every conversation row's `accessibilityLabel` still includes the channel name ("Marisol Vega, SMS, unread, last message …"). Gesture-only actions have reachable equivalents (times in Message details; swipe actions duplicated in row long-press; pill is a real button). Targets ≥ 44pt with hit-slop; OS font scaling to 1.3× without breakage. Cream-on-espresso and muted-on-espresso pairs must clear WCAG AA at rendered sizes — verify the sampled values, adjust muted upward if needed.

## 13. Library rulings (unchanged)

**Allowed:** reanimated, gesture-handler, expo-haptics, expo-blur (not yet installed — **install sanctioned in Part 1** via `npx expo install`), expo-image (conditional install sanctioned in Part 5 if absent, `npx expo install`), expo-image-picker, react-native-keyboard-controller (SDK 54 Go-bundled), date-fns, FlashList/LegendList (JS-only — swap only at the §5 no-jump escalation point, architect call). §2.5 viewer: `react-native-awesome-gallery` **only if** investigation Q13 cleared it Go-safe (then `npx expo install`), else the bespoke minimal viewer.
**Forbidden:** gifted-chat; Zeego / native context menus / anything needing a dev build; hand-retyped enums (codegen only). All installs via `npx expo install`; every dependency addition listed in the session report.

## 14. Build plan mapping (unchanged)

Investigation first, then the parts, commit-and-push per part. **Rev E:** by operator call, Parts 3–5 run as **one multi-checkpoint session** — per-part commits preserved for bisection, one consolidated device gate at the end (Expo Go walkthrough + screen recording):

| Part | Delivers | Gate evidence |
|---|---|---|
| 1 | Reconcile + build thread anatomy: tokens wired incl. **red own-bubble ruling + CLAUDE.md amendment**, grouping/tails/separators/attribution (reconciling AE's shipped version), surface-anchored delivery states, email collapse, **§9 header + context chips (expo-blur install)** | Grouped-thread scroll with red bubbles; failed-state tap; header chip-row collapse |
| 2 | Composer + keyboard choreography | Interactive dismiss; growth; bottom-anchor |
| 3 | Motion + haptics: send-fly, presets, typing (dormant, `__DEV__`-toggled), pill, drag-to-reveal (**reconcile** AE's shipped version: travel 68→84, add 0.55 resistance curve + per-message fade) | Send-fly; timestamp drag; pill w/ badge |
| 4 | List reconcile (rev C furniture: FREQUENT removed, Filter/Sort dropdowns, row anatomy/typography/insets, lettered badges) + unread rendering + preview authorship + archive (tap-confirm, studio-wide) + **pin/mute if backend deployed** | Furniture matches prototype; unread dot + filter agreement; prefixes; archive confirm; pin reorders + 409 at 4th; mute quiets badge while dot accrues |
| 4b | Only if backend was undeployed at Part 4 time: pin + mute wiring micro-part | Pin survives restart; mute quiets tab badge |
| 5 | Long-press overlay (generalizing Part 1's retry sheet: blur scrim, clone lift, class-appropriate items) + **reactions tapback restyle** (§7) + §2.5 image bubbles + full-screen viewer (Q13 path) — attachment capture/upload already shipped | Lift + sheet variants; tapback add/remove syncing with existing reaction display; image bubble; viewer drag-dismiss |

Reports state: shipped, cut + why, deps touched, commit hash, escalations.

## 15. Web parity (deferred)

`ConversationsPanel.tsx` adopts anatomy, states, and row rules in the **light** Editorial Gold treatment — separate edition when scheduled. A light-token twin of the prototype lives at `public/prototype/chat-ux-prototype-light.html` (identical DOM/JS to the dark file; only the token block and ~12 literals differ) as the parity reference and proof that the theme is a token layer.

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
