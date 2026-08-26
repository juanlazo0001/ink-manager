# Session AG — client rows, iOS Contacts anatomy

Reference material for the mobile client list's row anatomy. Committed so
the before/after can be viewed from the repo rather than reconstructed
from a report.

## What is here

| file | what it is |
| --- | --- |
| `clients-before-320.png` | The client list at a 320pt viewport BEFORE this session — no avatar, divider indented 68pt past nothing. |
| `clients-after-320.png` | The same list AFTER — avatar restored at 40pt, divider starting exactly where the name starts. |
| `chat-list-before-320.png` | The chat thread list BEFORE the sweep — 42pt avatars, divider at 16pt cutting through the column of faces. |
| `chat-list-after-320.png` | The same list AFTER — divider at 70pt, where the name starts. |
| `ios-contacts-reference.png` | **NOT SUPPLIED BY THIS SESSION — see below.** |

## The missing file, stated plainly

`ios-contacts-reference.png` is **not in this directory.** This session had
no iOS device and no Contacts screenshot to work from, and drawing a
mockup of Apple's UI and labelling it a screenshot would have made a
fabricated reference look like a measured one. **Owner: drop the real
Contacts screenshot in here under that filename.**

What that means for the work: the comparison below is against the RULE the
brief stated, not against a pixel-measured Apple screenshot. The rule is
the uncontroversial part and is what the row was built to. The exact Apple
metrics are the part that wants the owner's screenshot to confirm.

## The rule this row was built to

> **The divider's inset is the text's inset, and the zone it skips is
> occupied by the avatar.**

That is iOS's own list anatomy — a `UITableViewCell` with a leading image
aligns its separator to the text label, not to the cell edge, so a column
of avatars is never cut in half by a rule.

## The numbers, as shipped

    |<-16->|<--- 40 --->|<-12->|Name ...............  [CHIP]     ( ✉ )
    |      |   avatar   |      |
    |                          |
    |<--------- 68 ----------->|-------- divider starts here ---------

| measurement | value | where it comes from |
| --- | --- | --- |
| row padding, leading | 16pt | `space.lg` |
| avatar | 40pt circle | `AVATAR_SIZE`, `clients.tsx` |
| gap, avatar to text | 12pt | `space.md` |
| **text inset** | **68pt** | the sum of the three above |
| **divider inset** | **68pt** | `space.lg + AVATAR_SIZE + space.md` — the same expression, not a retyped constant |
| row height | 68pt | driven by the 44pt message button + 2×12 padding |

The 68 is not new. It was already written as `space.lg + 40 + space.md`
when the row still had an avatar, and it was left untouched when session W
removed that avatar — so for as long as W's removal stood, the divider was
indenting past nothing. Restoring the avatar is what makes the existing
indent true.

## The same rule, applied to the chat thread list

`app/(tabs)/index.tsx` had `marginLeft: space.lg` — 16pt — on a list whose
every row leads with a 42pt avatar, so the rule ran under the faces. Now
16 + 42 + 12 = 70pt, imported from `ConversationRow` rather than retyped,
so it cannot drift from the avatar it is measured against.
