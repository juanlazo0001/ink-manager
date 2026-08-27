# motion-probe

Frame analysis for gesture and animation work, so a session can answer
**"did that travel with the finger, or did it stall and teleport?"** from
the terminal instead of from conviction.

## Why this exists

The web preview harness **freezes animation travel inside app subtrees**
(recorded in `CLAUDE.md`). Geometry proves fine there — a panel's width,
a colour, an inset — but motion does not, and gesture-handler is inert to
synthetic input, so a swipe cannot even be started. Everything about
*feel* therefore has exactly two honest sources: a device in someone's
hand, or frames.

This arc used frames by hand three times. The third time, a hand pass
reported "no motion" from a reference frame sitting on a frozen overlay —
a wrong answer that looked exactly like a right one. That incident is why
`track` has a QA guard and why this is a tool rather than a habit.

## Prerequisite

**ffmpeg on PATH.** It is the only thing here that reads video.

    macOS    brew install ffmpeg
    Windows  winget install Gyan.FFmpeg     (then reopen the terminal)
    Linux    apt install ffmpeg

Everything else is the Python 3 standard library. No numpy, no Pillow.

`python probe.py selftest` runs **without ffmpeg** — see below.

## The operator's side of the protocol

1. Record the screen for **≤15 seconds**. Short is better: 5s of one
   gesture beats 60s of everything.
2. Do **one named thing per recording**, and name the file after it —
   `swipe-slow.mov`, `flick-fast.mov`, `tap-outside.mov`. A session's
   report will ask for specific ones, e.g. *"record: slow swipe right,
   release; fast flick left; tap outside"*.
3. Start recording **before** the gesture and stop **after** it settles.
   The first and last still frames are what `--ref-t` needs.
4. Drop the files in `tools/motion-probe/recordings/`. That directory is
   gitignored — recordings are evidence for a session, not repo content.

## Using it

### 1. `sheet` — always start here

    python probe.py sheet recordings/swipe-slow.mov

Contact sheets, 6 across, into `recordings/sheets/`. You read two things
off them: **when** the gesture happens (for `--ref-t` and `--window`) and
**where** to put the box (for `--roi` / `--band`). Coordinates are in the
scaled frame, so pass the same `--scale` you will use later.

### 2. `track` — follow a thing

    python probe.py track recordings/swipe-slow.mov \
      --roi 40,300,60,60 --ref-t 1.2 --window 1.0,2.5

Crops the ROI out of the reference frame and slides it horizontally on
every frame, keeping the best match. Use it on something with edges — an
avatar, a bubble corner, an icon. Not flat background: see the guard.

### 3. `panel` — measure a reveal

    python probe.py panel recordings/swipe-slow.mov --band 300,60 --ref-t 0.5

Per frame, how far the changed region reaches in from the right edge,
compared against a **closed** reference frame. Use this for swipe panels:
their content is not trackable the way an avatar is, but their *arrival*
is measurable as change.

Add `--json` to either for the full per-frame series.

## Reading the verdict

Every command prints one of three, plus the numbers behind it.

**`TRACKED (finger-attached)`** — motion distributed across frames, no
single-frame teleport. At 30fps a finger-attached front shows deltas of
roughly 2–12px per frame, varying smoothly with hand speed, and
`total travel ≈ |net travel|` for a one-way gesture.

**`STATE-POP (stall→jump)`** — flat runs then one large delta. The
signature of a threshold reveal: nothing, nothing, nothing, *arrived*.
**Worked example, the swipe rebuild (06-g3):** the shipped
`ReanimatedSwipeable` rows showed exactly this — the front sat still
through the drag and snapped open once a threshold passed, plus the panel
and the row content translating on different frames (tearing). That
reading is what justified rebuilding onto a single translating front, and
a `track` pass on the rebuild reads `TRACKED`.

**`NO-MOTION (check ROI/ref)`** — nothing moved. **Treat this as a
measurement warning, never as a result.** When it comes with
`qa_warning: true` the tool is telling you the median match error was
also ~0, which means the template matched itself perfectly everywhere:
the ROI is almost certainly on something that cannot move (a status bar,
a frozen overlay, flat background) or `--ref-t` is outside the gesture.
Move the box and re-run before reporting anything.

Other fields worth reading:

| field | what it tells you |
| --- | --- |
| `longest_zero_run_frames` | how long it sat still — a stall inside a drag is the jank |
| `single_frame_jumps` | frame index and size of each teleport |
| `monotonic` | false means it reversed mid-gesture, usually two animations fighting |
| `median_match_error` | high (>40) means the template is not being found — bad ROI |

## The self-test

    python probe.py selftest

Three assertions, on frames built in-process:

1. a block moving a **known** 3px/frame for 30 frames is measured at 87px
   net, within ±2, and reads `TRACKED`;
2. an ROI on **static** background fires the QA guard rather than
   reporting "no motion" as a finding;
3. a synthetic stall-then-jump series reads `STATE-POP`, not `TRACKED`.

**It deliberately does not go through ffmpeg.** ffmpeg is the
video→frames adapter; the tracker is the part that can be wrong. Encoding
a synthetic to h264 and decoding it back would add compression noise to
the one test whose entire value is a known-exact answer — and would make
the test unrunnable on a machine that has not installed ffmpeg yet, which
is exactly the machine most likely to run it first.

This is the repo's falsifiable-test rule applied to the tool itself: a
tracker that returned 0 for everything would pass a "does it run" check
and fail all three of these.
