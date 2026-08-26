# Chat UX — Session 00: Investigation

**Branch:** `chat-ux/00-investigation` · **Base:** `mobile/session-ae` @ `fdcf4ce`
**Scope:** read-only audit of the existing chat surface + one sanctioned install (Task B).
**Answers:** spec `chat-ux-spec.md` (Edition 02) §16, all fourteen.

> **Read §5 first.** Three findings change Part 1–5 scoping before any of it starts, and one of
> them needs an owner ruling rather than an architect one.

---

## 0. Base-branch note (read before the tables)

The spec's stop conditions include *"Task A reveals the chat surface is mid-refactor on another
branch."* It is — but not by a stranger.

`mobile/session-AE` (the immediately preceding session, committed and pushed, **unmerged**) rewrote
`MessageBubble.tsx`, `conversation/[id].tsx`, `Composer.tsx`, `MessageActions.tsx`,
`PhotoViewer.tsx` and `threadRows.ts` toward iOS Messages. `main` is at `151c0d8`; sessions T2 → AE
are all unmerged and stacked.

I based this investigation on **`mobile/session-ae`**, because auditing `main` would have described
a chat surface that no longer exists and mis-scoped every part. **Everything below describes the
stack head.** If the architect intends Parts 1–5 to branch from `main` instead, this audit does not
apply and the whole thing needs re-running — that is an escalation, not a detail (§5.2).

---

## 1. §16 answer table

| # | Question | Answer | Evidence | Confidence |
|---|---|---|---|---|
| 1 | Repo token names/values for every ★ | Full mapping in §2. **Every ★ sample is lighter/warmer than the real token**; per spec §1 the theme file wins, so Part 1 uses repo values. Three spec roles have **no token** (`bubble.in.bg`, `note.bg`, and a cream-tinted hairline). | `apps/mobile/src/theme/colors.ts:10-100` | High |
| 2 | `channel → color` map (reference only) | Exists on **both** sides and mobile's is copied from web's. SMS `#2fb35c` · EMAIL `#4a90d9` · INSTAGRAM `#ee2a7b` (web: 3-stop gradient, flattened to mid-stop on mobile) · FACEBOOK `#1877f2` · PHONE `#8a8a92` · OTHER `#5a5a62`. **`IN_APP` has no entry on either side** and falls through to OTHER. Full table §3. | mobile `theme/colors.ts:128-147`; web `ConversationsPanel.tsx:424-440` | High |
| 3 | Chat component inventory + list primitive | 15 files, 3,241 lines. Both lists are **`FlatList`** (RN core). FlashList/LegendList not installed, though **`@shopify/flash-list@2.0.2` is SDK-54 bundled**. Inventory + recommendation §4. | §4 | High |
| 4 | `react-native-keyboard-controller` smoke test | **Works.** Installed `1.18.5` = the exact SDK 54 bundled version. Provider mounted, bundle builds, screen renders, app unaffected. Feel is device-gated. §6. | §6 | High (off-device) |
| 5 | Message status persisted today | **None.** `Message` has no status/state column — only `createdAt`/`updatedAt`. Mobile's `status` is explicitly local-only. Truthfully renderable today: **`QUEUED`, `SENT`, `FAILED`** (all client-side facts). **`DELIVERED`/`READ` have no field and must stay dormant**, exactly as spec §2.4 requires. | `apps/api/prisma/schema.prisma:2866-2917`; `apps/mobile/src/lib/threadRows.ts:5` | High |
| 6 | `isPinned` / `mutedUntil` / `archivedAt` | `archivedAt` **exists** (`DateTime?` + `archivedById`/`archivedBy`) — but is **studio-wide, not per-user**, by explicit design. `isPinned` **absent**. `mutedUntil` **absent**. No equivalents. | `schema.prisma:2805-2814` (archive block + comment) | High |
| 7 | WebSocket typing event | **Does not exist.** Zero occurrences of "typing" as an event anywhere in `apps/api`, `apps/mobile`, `packages/shared-types`. Emitted events are: `presence:online/offline/snapshot`, `conversation.updated`, `inquiry.*`, `task.changed`, `appointment.changed`, and ~12 other domain invalidations. | `apps/api/src/lib/realtime/`; repo-wide grep | High |
| 8 | `lastMessage.author` — backend or inferred? | **Live backend field, already shipped.** `ConversationLastMessage` carries both `authorUserId` and `author`. Mobile compares `authorUserId === viewerUserId`. **The backend work-order item is done** — and mobile is *ahead of web*, which still uses the buggy `direction === 'OUTBOUND'` test. | `packages/shared-types/src/conversations.ts:43-58`; `ConversationRow.tsx:48-56` | High |
| 9 | Unread source of truth | **One source, two units.** All three legs derive from `ConversationRead.lastReadAt` per (conversation, user) vs `Message.createdAt where authorUserId != me`. (a) row dot ← `unreadCount` = **message** count; (b) UNREAD filter ← same field; (c) CHAT tab badge ← `GET /nav-counts` → `getUnreadConversationCount` = **thread** count. Per-user read tracking exists. | `schema.prisma:2974-2986`; `apps/api/src/lib/conversations.ts:144-190`; `conversationListControls.ts:47` | High |
| 10 | Presence source | **The premise is wrong, twice.** (i) The dot on the FREQUENT strip is an **unread** dot, not presence — there is no presence dot anywhere in mobile chat. (ii) A **real** presence signal exists server-side (socket-backed, connection-counted, 8s offline debounce) and **mobile subscribes to none of it.** So spec §9's thread-header dot is *new wiring*, not a relocation. | `FrequentStrip.tsx:99,128`; `apps/api/src/lib/realtime/presence.ts:13-72`; mobile grep = no listener | High |
| 11 | Internal-note message type | **Does not exist.** No type/flag column. There *is* a `metadata Json?` discriminator with one known kind (`shared_inquiry`), which is the natural extension point — but no internal-note kind, and no `INTERNAL` channel value (`MessageChannel` = IN_APP/SMS/EMAIL/INSTAGRAM/FACEBOOK/PHONE/OTHER). | `schema.prisma:2872-2877`; `apps/api/src/routes/inquiries.ts:3179` | High |
| 12 | Group naming / membership | `ConversationParticipant` join rows (`conversationId`, `userId`, `@@unique`). Display name = **every participant except the viewer**, `name ?? email`, joined `", "` → exactly "Yoanliz Guzman, LouieG". Empty → `"Just you"`. `counterpart.participants[]` carries each other member's `{id, name, avatarUrl}` — GROUP-only. | `schema.prisma:2991-3002`; `apps/api/src/routes/conversations.ts:182-193` | High |
| 13 | `react-native-awesome-gallery` Expo Go-safe? | **Pure JS, but NOT adoptable as-is.** v0.4.3, **zero runtime dependencies**, JS-only `main` (`lib/commonjs/index`) — so no native module, Go-compatible in principle. **But its peer range is `react-native-reanimated ^3.2.0` and this app runs `4.1.7`** — a major-version mismatch. **Recommend the bespoke path** (spec §2.5), which is cheap here: `PhotoViewer.tsx` already does pager + tap-to-close + save; only pinch-zoom is missing, and its own comment already names that as the known gap. | `npm view` metadata (not installed); `node_modules/react-native-reanimated/package.json`; `PhotoViewer.tsx:19-22` | Medium-High |
| 14 | NEEDS ACTION semantics | `unreadCount > 0` **OR** `primaryInquiry.status ∈ {NEW, BUDGET_NEGOTIATION}`. Computed **client-side**, mirroring web. Note the OR: every unread thread is also "needs action", so the two filters overlap heavily by construction. | `apps/mobile/src/lib/conversationListControls.ts:42-57` | High |

---

## 2. Token mapping (★ → repo)

Source of truth: `apps/mobile/src/theme/colors.ts`, itself copied verbatim from
`apps/web/src/index.css`'s `:root[data-theme="editorial-gold"]`. **Per spec §1, these win over the
screenshot samples.**

| Spec token | ★ sample | Repo token | Repo value | Verdict |
|---|---|---|---|---|
| `chat.surface` | `#1A1410` | `colors.bg` | `#0e0b08` | ✔ exists — **repo is darker** |
| `chat.surface.raised` | `#251E17` | `colors.surfaceRaised` | `#1d1813` | ✔ exists — repo darker |
| `chat.bubble.own.bg` | `#C2402F` | `colors.dangerStrong` | `#c2402f` | ✔ **exact match** — but see §5.1 |
| `chat.bubble.own.text` | `#FFFFFF` | *(no token)* | — | Literal `#ffffff`; already the recorded AA-safe choice on this red (5.16:1) |
| `chat.bubble.in.bg` | `#2B231B` | **none** | — | ✘ **no token.** Current incoming bubble uses `colors.surface` `#171310` |
| `chat.text.primary` | `#E7DCC4` | `colors.fg` | `#f2ece0` | ✔ exists — repo brighter |
| `chat.text.muted` | `#9A8C74` | `colors.fgMuted` | `#9b927f` | ✔ near-identical |
| `chat.accent.gold` | `#C9A961` | `colors.accent` | `#c99a5b` | ✔ exists — close, not identical |
| `chat.note.bg` | `rgba(201,169,97,.10)` | **none** | — | ✘ **no token.** Nearest existing: `rgba(201,154,91,0.10)` = `cardBorder` |
| `chat.alert.red` | `#C2402F` | `colors.dangerStrong` | `#c2402f` | ✔ exact — **same token as own-bubble** (§5.1) |
| `chat.presence.on` | `#5CB36E` | `colors.success` / `tones.success` | `#5f9e6e` | ✔ exists — repo slightly duller |
| `chat.presence.off` | `#6E675E` | `colors.fgFaint` | `#6f6960` | ✔ near-identical |
| `chat.hairline` | `rgba(231,220,196,.09)` | `colors.border` **or** `colors.borderSoft` | `rgba(201,154,91,0.18)` / `rgba(255,255,255,0.08)` | ⚠ **hue mismatch.** Repo's default hairline is **gold-tinted**; the ★ sample is cream. `borderSoft` is the neutral one and the closer match |

**Type roles (spec §1.2) — all three faces exist**, `theme/typography.ts:47-60`:
Fraunces (`display*`), Jura (`label*`), Outfit (`body*`). No new fonts needed.
`radius.bubble = 14` (`layout.ts:21`) vs spec §2.1's **18** — a deliberate change for Part 1, not a gap.
`type.message = 16/23` (`typography.ts:95`); session AE overrides line-height to **21** at the bubble.

---

## 3. Channel colour map (found — reference only)

Spec §1.1 rev B: badges are **lettered and neutral**; colour is an optional future tint and never
the sole signal. So this is inventory, not a proposal. **Nothing below needs a decision.**

| Channel | Mobile (`theme/colors.ts:136-143`) | Web (`ConversationsPanel.tsx:424-431`) | Spec §1.1 badge code |
|---|---|---|---|
| SMS | `#2fb35c` | `bg-[#2fb35c]` | `SMS` |
| EMAIL | `#4a90d9` | `bg-[#4a90d9]` | `EM` |
| INSTAGRAM | `#ee2a7b` (flattened) | gradient `#f9ce34 → #ee2a7b → #6228d7` | `IG` |
| FACEBOOK | `#1877f2` | `bg-[#1877f2]` | `FB` |
| PHONE | `#8a8a92` | `bg-[#8a8a92]` | `PH` |
| OTHER | `#5a5a62` | `bg-[#5a5a62]` | — |
| **IN_APP** | **no entry → OTHER** | **no entry → OTHER** | `APP` |

Two notes for Part 4:

- **`IN_APP` has no colour on either client.** If the optional tint is ever taken up, IN_APP needs a
  value invented — which is precisely why rev B's lettered badge is the safer call.
- **The badge component already exists in the right anatomy.** `ChannelAvatarBadge`
  (`ChannelSwatch.tsx:66-75`) is already absolutely positioned bottom-right of the avatar with a
  `colors.bg` ring — exactly spec §1.1's placement. It currently renders a **coloured 10pt swatch**;
  rev B needs it re-treated as a **lettered neutral pill**. That is a change to one small component,
  not new plumbing.

---

## 4. Component inventory + list-primitive verdict

| File | Lines | Role |
|---|---|---|
| `src/app/(tabs)/index.tsx` | 222 | Conversation list screen (**FlatList**, `:141`), search debounce, filter/sort wiring |
| `src/app/conversation/[id].tsx` | 625 | Thread screen (**FlatList `inverted`**, `:434`), send/retry/edit/react, pan-to-reveal, lightbox |
| `src/components/ConversationRow.tsx` | 178 | List row: avatar, name, preview + `You:`/`{Name}:` prefix, unread, timestamp |
| `src/components/MessageBubble.tsx` | 412 | Bubble: grouping, bare-image bubbles, linkify, reaction badge, reveal gutter |
| `src/components/Composer.tsx` | 504 | Input, channel picker, attach/upload, reply + edit banners, send |
| `src/components/MessageActions.tsx` | 206 | Long-press sheet: reactions, Reply/Copy/Edit/Save, detail line |
| `src/components/FrequentStrip.tsx` | 143 | Horizontal frequent-contacts strip — **spec §8 rev C deletes this** |
| `src/components/ThreadListControls.tsx` | 166 | Filter/sort controls row |
| `src/components/ChannelSwatch.tsx` | 83 | `ChannelSwatch` + `ChannelAvatarBadge` |
| `src/components/ChannelGlyph.tsx` | 69 | Per-channel icon |
| `src/components/ChatTabButton.tsx` | 118 | Raised red centre tab button |
| `src/lib/conversations.ts` | 202 | All thread/message API calls incl. reactions |
| `src/lib/threadRows.ts` | 126 | Pure row builder: grouping, day separators, own-side |
| `src/lib/conversationListControls.ts` | 102 | Filter/sort predicates (Q14 lives here) |
| `src/hooks/useBadgeCounts.ts` | 85 | CHAT + tasks tab badges |

Supporting: `Avatar.tsx`, `PhotoViewer.tsx`, `PillMenu.tsx`, `Appear.tsx`, `lib/time.ts`, `lib/upload.ts`, `lib/linkify.ts`, `lib/saveImage.ts`.

**Installed, relevant:** reanimated `4.1.7` · gesture-handler `~2.28.0` · expo-haptics `~15.0.8` ·
expo-image `~3.0.11` · expo-image-picker `~17.0.11` · expo-media-library `~18.2.1` · expo-web-browser
`~15.0.11` · expo-clipboard · expo-file-system · expo-sharing · **keyboard-controller `1.18.5` (this
session)**.
**Not installed:** `expo-blur` · `@shopify/flash-list` · `@legendapp/list` · `date-fns`.

### Verdict: keep `FlatList` for the thread in Parts 1–3; revisit only with evidence

**Recommendation: keep the current primitive.** Spec §5's requirements are bottom-anchoring,
`maintainVisibleContentPosition`, preserved position during history pagination, and a
scroll-to-bottom pill — every one of which `FlatList` already supports, and three of which the
thread screen already implements today (`inverted`, `onEndReached` pagination, `scrollToIndex`).
FlashList 2.0's advantage is recycling cost at large row counts, and it is genuinely SDK-54 bundled
(`2.0.2`), so it stays available — but swapping the list primitive underneath a screen that is
*simultaneously* gaining grouping, tails, a pan gesture and a send-fly animation means any scroll
regression in Parts 1–3 has two candidate causes instead of one. The cost of deferring is one
`import` change later; the cost of doing it now is diagnostic ambiguity across three parts. **Adopt
FlashList only if Part 3's send-fly or drag-to-reveal actually drops frames on the device gate** —
that is a measurement, and it is the right trigger. `maintainVisibleContentPosition` in particular
should be verified on the *current* primitive during Part 1 rather than assumed.

---

## 5. Risks, surprises, and escalations

### 5.1 🔴 ESCALATION — red outgoing bubbles contradict `CLAUDE.md` (blocks Part 1)

Spec §1 sets `chat.bubble.own.bg` = `#C2402F`, called "the chat brand fill", and §1 also declares
that same value `chat.alert.red` with the note "**red appears nowhere else**" — while every
outgoing bubble in the thread is that red.

`CLAUDE.md`'s design rules say the opposite, in terms that anticipate this exact case:

> Red is punctuation (errors, destructive actions, urgent flags) — **never a fill color or a large
> surface area**. Gold is the primary brand color.
> **The one exception: the CHAT control.** … web's floating chat FAB and mobile's raised centre tab
> button. … **Everywhere else the punctuation rule stands unchanged.**

`#C2402F` is exactly `colors.dangerStrong`, whose own doc comment reads *"fills, borders, icon
strokes and dots ONLY. Never text."* The current app renders outgoing bubbles in **gold**
(`MessageBubble.tsx:319`, `colors.accent`).

So the spec extends the sanctioned red-brand-fill from *the chat entry point* to *every outgoing
message* — the largest red surface in the app. That is either (a) a deliberate owner extension of
the one exception, which should be written into `CLAUDE.md` before Part 1, or (b) a spec sampling
error. **This is an owner decision, not an architect one**, because `CLAUDE.md` records the
exception as "a deliberate owner decision".

*Contrast is not the issue:* white on `#c2402f` measures 5.16:1 and clears AA, already recorded in
`CLAUDE.md`. The issue is surface area and brand rule.

**Part 1 cannot wire "dark tokens" without this ruling** — it is the single most visible token on
the surface.

### 5.2 🔴 ESCALATION — the chat surface was refactored last session, and it is unmerged

See §0. Beyond the base-branch question, **the spec and the shipped code now disagree in three
places**, all needing a ruling before the part that owns them:

| Spec says | Session AE shipped | Affects |
|---|---|---|
| §0: reactions/tapbacks **cut for v1** | Reactions are a **live stored model** (`MessageReaction`, six emoji, PUT/DELETE routes) and AE deliberately made the badge *more* prominent — a Messages-style corner badge | Part 1 — does it **remove** working, shipped functionality? |
| §2.3: drag-to-reveal, travel **84**, resistance **0.55**, per-message fade over first 24pt | **Already implemented** — travel `68`, no resistance curve, no fade, spring-home on release | Part 3 — partly done; needs reconcile-or-retune, not build-from-scratch |
| §2.4/§7: FAILED → red ⚠ badge + retry **sheet** (Retry/Copy/Discard) | Inline "Not sent — tap to retry" row, no sheet | Parts 1 & 5 |

None of these is a blocker on its own; together they mean **Part 1's scope is "reconcile", not
"build"**, and that should be decided deliberately.

### 5.3 🟠 ESCALATION — schema gaps make Part 4's swipes undeliverable as specified

Spec §8 asks for swipe-to-pin, swipe-to-mute and swipe-to-archive with persistence, and §8 itself
says anything missing gets escalated rather than migrated. From Q6:

- **`isPinned` — absent.** The `PINNED` section, the pin glyph, the max-3 rule and the sort-to-top
  behaviour all depend on it. Local-only state would not survive an app restart, which for a
  "quick access" affordance is worse than not shipping it.
- **`mutedUntil` — absent.** Mute is specified as suppressing badge **and push** — both of which are
  server-side concerns. Local state cannot suppress a push.
- **`archivedAt` — exists, but is studio-wide.** The schema comment is explicit: *"shared/studio-wide,
  not per-user — once archived, hidden from everyone's list."* Spec §8 says IN-APP team threads
  should "archive hides locally, never destroys history". **Those are different behaviours.**
  Archiving an IN-APP thread today hides it from every colleague, not just the person swiping.

**Part 4 therefore delivers at most: unread rendering, preview authorship, and swipe-to-archive with
studio-wide semantics** — the last of which needs sign-off that hiding-for-everyone is acceptable
from a swipe. Pin and mute need a schema decision first.

### 5.4 🟠 `expo-blur` is not installed — Parts 5 and the §9 header need it

Spec §7 (long-press scrim) and §9 (translucent thread header) both require `expo-blur`. It is
**allowed** by §13 but **not installed**, so it is a dependency addition beyond this session's single
sanctioned install. Flagging so it lands in the right part's report rather than as a surprise.

### 5.5 🟡 Spec premises that reality has already overtaken (no decision needed, scope shrinks)

- **Q8 is done.** `lastMessage.author` / `authorUserId` are live backend fields and mobile already
  uses them correctly. The "backend queue item" in §8 can be struck. (Web still has the old bug —
  a note for the §15 parity pass, not for us.)
- **Sort menu is not TBD.** §8 says "Sort menu contents are TBD pending Q14/product ruling"; four
  sorts already exist and mirror web: Most recent · Oldest · Unread first · Name A–Z
  (`conversationListControls.ts:22-27`).
- **The lettered channel badge is a re-treatment, not a new component** (§3).

### 5.6 🟡 Presence: spec §9 is new wiring, not a relocation

Q10 found the spec's premise wrong twice: the FREQUENT strip's dot is **unread**, and mobile
subscribes to **no** presence event despite a real server-side signal existing
(`presence:online` / `presence:offline` / `presence:snapshot`). Putting a presence dot on the IN-APP
thread header means adding a socket subscription mobile has never had. Small, but it is *build*, not
*move* — and the presence registry is in-memory single-instance (its own comment flags this), so it
resets on API restart.

### 5.7 🟡 Truth constraints worth restating

- **No message status column exists** (Q5). `SENT` must mean "persisted". `DELIVERED`/`READ` cannot
  be rendered without Phase D, exactly as §2.4 already says — this confirms it rather than
  changing it.
- **No typing events exist** (Q7). Spec §6 says the indicator is wired only to real signals, so
  **the typing indicator cannot ship in Part 3 at all.** It can be built and left dark, but nothing
  will ever trigger it until someone adds the event.
- **No internal-note type exists** (Q11). Spec §2.6 already conditions internal notes on
  "only if the message type exists — investigation confirms". It does not. **Cut from v1** unless a
  `metadata.kind` extension is sanctioned.
- **NEEDS ACTION overlaps UNREAD by construction** (Q14) — every unread thread satisfies it. If the
  Filter dropdown shows both, they will often show the same rows. Worth a product look.

### 5.8 🟢 Untracked spec files

`public/prototype/` (spec + prototype) was **untracked** when this session began. Committed on this
branch alongside the report so the ground truth is versioned with the work that cites it. The spec
file itself is unedited, per instruction.

---

## 6. Task B outcome — **WORKS**

| Step | Result | Evidence |
|---|---|---|
| Already installed? | No | absent from `apps/mobile/package.json` before this session |
| Install | `npx expo install react-native-keyboard-controller` → **1.18.5** | exit 0, "added 1 package" |
| Version matches the Go binary? | **Yes — exactly** | `expo/bundledNativeModules.json` → `1.18.5`; installed `1.18.5` |
| `KeyboardProvider` at root | Mounted above `SafeAreaProvider`, inside `GestureHandlerRootView` | `src/app/_layout.tsx:8,122,134` |
| Typecheck | clean | `tsc --noEmit` → 0 |
| iOS bundle (the Go target) | **builds**, 5.16 MB | `expo export --platform ios` → 0 |
| Library in the bundle | `KeyboardProvider`, `KeyboardStickyView`, `useKeyboardHandler`, `keyboardDismissMode` all present | Hermes bundle scan |
| Smoke screen renders | **Yes** — header, 30 scrollable rows, sticky input bar, focus counter | dev bundle, 0 console errors |
| App unaffected | Boots to `/login` normally, 0 console errors | dev bundle |

**Smoke screen:** `src/app/dev-keyboard-smoke.tsx`, reachable only by typing the path — no drawer
item, no tab, no link. Uses `KeyboardStickyView` (per-frame offset) and `useKeyboardHandler`
(UI-thread height) deliberately, so a lag would indict the library rather than my wiring.
**Delete when Part 2 lands.**

**A bonus proof from the `__DEV__` gate.** A production `expo export` **strips the harness
entirely** — `'Keyboard smoke'` and the input placeholder are absent from the production bundle
while the non-dev dead-end branch (`'This screen exists only in development builds.'`) survives.
Metro constant-folds `__DEV__` and dead-code-eliminates the branch. So the smoke screen cannot leak
into a production build. It also means `expo export` cannot render it — which is why the render
check above was run against the **dev** bundle.

**What is NOT proven, and cannot be off-device:** the feel. Specifically (a) whether the bar rides
the keyboard with zero lag, and (b) whether dragging the list past the keyboard's top edge moves the
keyboard *with the finger*. (b) is the half a `KeyboardAvoidingView` fallback cannot reproduce, and
it is spec §4's Part 2 acceptance requirement. **Device gate decides.**

**Fallback status:** not needed so far. Nothing broke, so spec §4's `KeyboardAvoidingView` +
`keyboardDismissMode="interactive"` path stays the contingency, not the plan — *unless* the device
gate fails, in which case it becomes Part 2's primary and this install should be reverted.

---

## 7. Dependencies touched

| Package | Version | Why |
|---|---|---|
| `react-native-keyboard-controller` | `1.18.5` | Task B, the single sanctioned install. Via `npx expo install`, matching the SDK 54 Go binary exactly. |

Nothing else added, in any package.json. `react-native-awesome-gallery` was **read from the registry
and not installed** (Q13).
