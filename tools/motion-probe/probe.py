#!/usr/bin/env python3
"""
motion-probe — frame analysis for gesture and animation work.

This arc verified two swipe rebuilds and a reveal-gap ruling by stepping
through operator screen recordings by hand. That worked, and it did not
scale: every session re-derived the same method, and the one time a
reference frame was wrong the hand analysis reported "no motion" as if it
were a result. This is that method, owned by the repo.

    python probe.py sheet   <video>                        first look
    python probe.py track   <video> --roi x,y,w,h --ref-t S   follow a thing
    python probe.py panel   <video> --band y,h --ref-t S      measure a reveal
    python probe.py selftest                                  prove the tracker

WHY A TOOL AND NOT A LIBRARY: the operator records a phone, drops the file
in `recordings/`, and a session has to answer "did that travel with the
finger or pop?" from the terminal. That is a command, not an API.

PREREQUISITE: ffmpeg on PATH, for `sheet`, `track` and `panel` — it is the
only thing that reads video here. `selftest` deliberately does NOT need it
(see its docstring). Everything else is the standard library: no numpy, no
Pillow, nothing to install.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
from dataclasses import dataclass, asdict

# ─── frame source ────────────────────────────────────────────────────

FFMPEG_MISSING = """\
motion-probe needs ffmpeg on PATH to read video, and could not find it.

  macOS    brew install ffmpeg
  Windows  winget install Gyan.FFmpeg     (then reopen the terminal)
  Linux    apt install ffmpeg

`python probe.py selftest` still runs without it — it exercises the
tracker on frames generated in-process.\
"""


def ffmpeg_path() -> str:
    exe = shutil.which("ffmpeg")
    if not exe:
        print(FFMPEG_MISSING, file=sys.stderr)
        raise SystemExit(2)
    return exe


@dataclass
class Frames:
    """Decoded 8-bit grayscale frames, one `bytes` of w*h per frame."""

    width: int
    height: int
    fps: float
    data: list[bytes]

    def px(self, frame: int, x: int, y: int) -> int:
        return self.data[frame][y * self.width + x]


def read_gray(video: str, fps: float, width: int, window: tuple[float, float] | None) -> Frames:
    """
    Video → raw 8-bit gray frames.

    `-pix_fmt gray -f rawvideo` rather than PNGs on disk: the output is
    w*h bytes per frame with no container and no decoder needed on this
    side, which is what keeps the tool to the standard library.

    Grayscale because every measurement here is about WHERE something is,
    never what colour it is. It also cuts the byte count by three.
    """
    exe = ffmpeg_path()
    seek: list[str] = []
    if window:
        t0, t1 = window
        seek = ["-ss", f"{t0:.3f}", "-to", f"{t1:.3f}"]

    probe = subprocess.run(
        [exe, *seek, "-i", video, "-vf", f"fps={fps},scale={width}:-2", "-pix_fmt", "gray",
         "-f", "rawvideo", "-"],
        capture_output=True,
    )
    if probe.returncode != 0:
        print(probe.stderr.decode(errors="replace")[-2000:], file=sys.stderr)
        raise SystemExit(f"ffmpeg failed reading {video}")

    # Height comes back in ffmpeg's own log line; parse it rather than guess.
    height = _parse_height(probe.stderr.decode(errors="replace"), width)
    frame_bytes = width * height
    raw = probe.stdout
    count = len(raw) // frame_bytes
    if count == 0:
        raise SystemExit(f"no frames decoded from {video} (window too narrow?)")
    data = [raw[i * frame_bytes:(i + 1) * frame_bytes] for i in range(count)]
    return Frames(width=width, height=height, fps=fps, data=data)


def _parse_height(stderr: str, width: int) -> int:
    """The scaled height, off ffmpeg's own 'Stream ... WxH' line."""
    import re

    for m in re.finditer(r"(\d{2,5})x(\d{2,5})", stderr):
        w, h = int(m.group(1)), int(m.group(2))
        if w == width:
            return h
    # `scale=W:-2` keeps aspect and rounds to even; fall back to 16:9.
    return (width * 9 // 16) & ~1


# ─── analysis ────────────────────────────────────────────────────────

@dataclass
class Verdict:
    verdict: str
    reason: str


def analyse(offsets: list[float], jump_px: float, fps: float) -> dict:
    """
    Turn a per-frame position series into the things that decide an
    argument: is it finger-attached, or does it stall and teleport?

    The three shapes this arc actually met:

      TRACKED     motion spread across frames, no single-frame teleport.
                  What a translating front under a finger looks like.
      STATE-POP   long flat runs punctuated by one huge frame delta. The
                  signature of a threshold reveal: nothing, nothing,
                  nothing, ARRIVED. This is what the 06-g3 swipe rebuild
                  was called for, and what it removed.
      NO-MOTION   nothing moved anywhere. Almost always the measurement
                  and not the app — see the QA guard in `track`.
    """
    deltas = [round(b - a, 2) for a, b in zip(offsets, offsets[1:])]
    total = round(offsets[-1] - offsets[0], 2) if offsets else 0.0
    travel = round(sum(abs(d) for d in deltas), 2)

    # Longest run of consecutive frames that did not move at all.
    zero_runs: list[int] = []
    run = 0
    for d in deltas:
        if abs(d) < 0.5:
            run += 1
        else:
            if run:
                zero_runs.append(run)
            run = 0
    if run:
        zero_runs.append(run)
    longest_zero = max(zero_runs) if zero_runs else 0

    jumps = [{"frame": i + 1, "delta": d} for i, d in enumerate(deltas) if abs(d) >= jump_px]

    # Monotone means the thing travelled one way; a reveal that reverses
    # mid-gesture is usually a fight between two animations.
    signs = {1 if d > 0.5 else -1 if d < -0.5 else 0 for d in deltas}
    monotonic = len(signs - {0}) <= 1

    if travel < 1.0:
        v = Verdict("NO-MOTION (check ROI/ref)", "nothing moved across the window")
    elif jumps and longest_zero >= max(2, int(fps * 0.1)):
        v = Verdict(
            "STATE-POP (stall->jump)",
            f"{len(jumps)} single-frame jump(s) >= {jump_px}px after a stall of "
            f"{longest_zero} frame(s)",
        )
    else:
        v = Verdict("TRACKED (finger-attached)", "motion distributed across frames")

    return {
        "frames": len(offsets),
        "fps": fps,
        "net_px": total,
        "total_travel_px": travel,
        "longest_zero_run_frames": longest_zero,
        "single_frame_jumps": jumps,
        "monotonic": monotonic,
        "offsets": [round(o, 2) for o in offsets],
        "deltas": deltas,
        **asdict(v),
    }


# ─── track ───────────────────────────────────────────────────────────

def _mad(frames: Frames, f: int, ref: bytes, rx: int, ry: int, rw: int, rh: int,
         shift: int, step: int) -> float:
    """Mean absolute difference of the ROI against frame `f`, shifted in x."""
    w = frames.width
    row = frames.data[f]
    total = 0
    n = 0
    for y in range(0, rh, step):
        base_ref = y * rw
        base_row = (ry + y) * w
        for x in range(0, rw, step):
            sx = rx + x + shift
            if sx < 0 or sx >= w:
                return float("inf")
            total += abs(ref[base_ref + x] - row[base_row + sx])
            n += 1
    return total / max(1, n)


def track(frames: Frames, roi: tuple[int, int, int, int], ref_index: int,
          max_shift: int, step: int = 2) -> dict:
    """
    Template-track a region horizontally.

    Crop the ROI out of the reference frame, then for every frame slide
    that patch left and right and keep the offset with the lowest mean
    absolute difference. Horizontal only: every gesture this repo argues
    about — swipe rows, the timestamp reveal — travels in x.

    Two performance choices, both documented rather than silent: the ROI
    is subsampled (`step`, default every 2nd pixel each way, so a quarter
    of the work) and after the first frame the search is LOCAL, ±32px
    around the previous offset. A front under a finger does not teleport
    between frames — and if it does, that is a STATE-POP, which the local
    search still catches because the fallback widens on a poor match.
    """
    rx, ry, rw, rh = roi
    if rx < 0 or ry < 0 or rx + rw > frames.width or ry + rh > frames.height:
        raise SystemExit(
            f"ROI {roi} falls outside the {frames.width}x{frames.height} frame. "
            f"Run `sheet` first and pick the box off a contact sheet."
        )

    ref_row = frames.data[ref_index]
    ref = bytearray()
    for y in range(rh):
        start = (ry + y) * frames.width + rx
        ref.extend(ref_row[start:start + rw])
    ref = bytes(ref)

    offsets: list[float] = []
    errors: list[float] = []
    prev = 0
    for f in range(len(frames.data)):
        lo, hi = -max_shift, max_shift
        if offsets:
            lo, hi = max(-max_shift, prev - 32), min(max_shift, prev + 32)
        best, best_err = 0, float("inf")
        for shift in range(lo, hi + 1):
            err = _mad(frames, f, ref, rx, ry, rw, rh, shift, step)
            if err < best_err:
                best_err, best = err, shift
        offsets.append(float(best))
        errors.append(best_err)
        prev = best

    out = analyse(offsets, jump_px=24.0, fps=frames.fps)
    out["median_match_error"] = round(sorted(errors)[len(errors) // 2], 2)

    # ─── THE QA GUARD, learned the hard way ──────────────────────────
    #
    # A near-perfect match on every frame AND no motion does not mean
    # "the app did not move". It much more often means the ROI is sitting
    # on something that cannot move -- a frozen overlay, a status bar, a
    # band of flat background -- so the template matches itself perfectly
    # everywhere and the answer is vacuous. This arc lost time to exactly
    # that once, and reported it as a finding before catching it.
    #
    # So: refuse to present it as a result.
    if out["median_match_error"] < 2.0 and out["total_travel_px"] < 1.0:
        out["verdict"] = "NO-MOTION (check ROI/ref)"
        out["reason"] = (
            "median match error is ~0 AND nothing moved -- the ROI is probably on a "
            "static region (overlay, chrome, flat background) or --ref-t is outside "
            "the gesture. This is a measurement warning, NOT evidence the UI is still."
        )
        out["qa_warning"] = True
    else:
        out["qa_warning"] = False
    return out


# ─── panel ───────────────────────────────────────────────────────────

def panel(frames: Frames, band: tuple[int, int], ref_index: int, threshold: int = 12) -> dict:
    """
    Measure a reveal by CHANGE, not by content.

    For a horizontal band, compare each frame against the closed
    reference and report how far the changed region extends from the left
    and right edges. That measures how far a panel has travelled without
    needing to know what is drawn on it -- which matters because a swipe
    panel's content (icon, label) is not trackable the way an avatar is.

    Reported as the RIGHT-edge width, since every reveal in this app
    comes in from the trailing edge.
    """
    by, bh = band
    w = frames.width
    ref = frames.data[ref_index]

    widths: list[float] = []
    for row in frames.data:
        right = 0
        for x in range(w - 1, -1, -1):
            changed = False
            for y in range(by, by + bh, 2):
                if abs(row[y * w + x] - ref[y * w + x]) > threshold:
                    changed = True
                    break
            if changed:
                right = w - x
            elif right:
                break
        widths.append(float(right))

    return analyse(widths, jump_px=24.0, fps=frames.fps)


# ─── sheet ───────────────────────────────────────────────────────────

def sheet(video: str, out_dir: str, fps: float, width: int, per_sheet: int) -> list[str]:
    """Contact sheets, 6 across — the first look at any recording."""
    exe = ffmpeg_path()
    os.makedirs(out_dir, exist_ok=True)
    rows = max(1, per_sheet // 6)
    pattern = os.path.join(out_dir, "sheet%d.png")
    cmd = [exe, "-y", "-i", video, "-vf",
           f"fps={fps},scale={width}:-2,tile=6x{rows}", "-frames:v", "50", pattern]
    r = subprocess.run(cmd, capture_output=True)
    if r.returncode != 0:
        print(r.stderr.decode(errors="replace")[-2000:], file=sys.stderr)
        raise SystemExit("ffmpeg failed building the contact sheet")
    return sorted(f for f in os.listdir(out_dir) if f.startswith("sheet"))


# ─── selftest ────────────────────────────────────────────────────────

def selftest() -> int:
    """
    Prove the tracker detects motion it was told to expect.

    ─── WHY THIS DOES NOT GO THROUGH FFMPEG ─────────────────────────

    The brief suggested rendering a moving rectangle to mp4 and tracking
    that. This builds the frames directly instead, and the reason is not
    convenience: ffmpeg is only the video->frames ADAPTER here, while the
    thing that can actually be wrong is the tracker. Encoding a synthetic
    to h264 and decoding it back adds compression noise to the one test
    whose whole value is a known-exact answer, and it makes the test
    unrunnable on a machine without ffmpeg -- which is precisely the
    machine most likely to be running it for the first time.

    So: frames in, known displacement, assert the tracker finds it.

    This is the repo's falsifiable-test rule applied to the tool itself.
    A tracker that returned 0 for everything would pass a "does it run"
    check and fail this one, which is the entire point.
    """
    W, H, N = 240, 120, 30
    RECT, SPEED = 24, 3  # px wide, px per frame  ->  87px of scripted travel

    frames_data: list[bytes] = []
    for i in range(N):
        buf = bytearray([40]) * (W * H)          # dark ground
        x0 = 20 + i * SPEED
        for y in range(40, 40 + RECT):
            row = y * W
            for x in range(x0, min(W, x0 + RECT)):
                buf[row + x] = 220              # bright block
        frames_data.append(bytes(buf))

    frames = Frames(width=W, height=H, fps=30.0, data=frames_data)
    expected = SPEED * (N - 1)

    print("motion-probe selftest")
    print(f"  synthetic: {N} frames, {RECT}px block moving {SPEED}px/frame")
    print(f"  scripted net travel: {expected}px")

    ok = True

    # 1. The tracker must find the scripted motion.
    moving = track(frames, roi=(20, 40, RECT, RECT), ref_index=0, max_shift=120)
    got = moving["net_px"]
    within = abs(got - expected) <= 2
    print(f"  track net_px = {got} (tolerance +/-2)  ...  {'PASS' if within else 'FAIL'}")
    print(f"  verdict = {moving['verdict']}")
    if not within or not moving["verdict"].startswith("TRACKED"):
        ok = False

    # 2. The QA guard must fire on a static ROI rather than report "no motion"
    #    as a finding. This is the half that catches a wrong reference.
    static = track(frames, roi=(150, 5, 30, 20), ref_index=0, max_shift=60)
    guarded = static.get("qa_warning") is True
    print(f"  static-ROI QA guard fired = {guarded}  ...  {'PASS' if guarded else 'FAIL'}")
    print(f"  verdict = {static['verdict']}")
    if not guarded:
        ok = False

    # 3. A stall-then-teleport series must read as STATE-POP, not TRACKED.
    popped = analyse([0.0] * 10 + [80.0] * 10, jump_px=24.0, fps=30.0)
    is_pop = popped["verdict"].startswith("STATE-POP")
    print(f"  stall->jump reads as STATE-POP = {is_pop}  ...  {'PASS' if is_pop else 'FAIL'}")
    if not is_pop:
        ok = False

    print("SELFTEST:", "PASS" if ok else "FAIL")
    return 0 if ok else 1


# ─── cli ─────────────────────────────────────────────────────────────

def _roi(s: str) -> tuple[int, int, int, int]:
    parts = [int(p) for p in s.split(",")]
    if len(parts) != 4:
        raise argparse.ArgumentTypeError("--roi wants x,y,w,h")
    return tuple(parts)  # type: ignore[return-value]


def _band(s: str) -> tuple[int, int]:
    parts = [int(p) for p in s.split(",")]
    if len(parts) != 2:
        raise argparse.ArgumentTypeError("--band wants y,h")
    return parts[0], parts[1]


def _window(s: str) -> tuple[float, float]:
    parts = [float(p) for p in s.split(",")]
    if len(parts) != 2:
        raise argparse.ArgumentTypeError("--window wants t0,t1 in seconds")
    return parts[0], parts[1]


def emit(result: dict, as_json: bool) -> None:
    if as_json:
        print(json.dumps(result, indent=1))
        return
    print(f"frames            {result['frames']} @ {result['fps']}fps")
    print(f"net travel        {result['net_px']}px")
    print(f"total travel      {result['total_travel_px']}px")
    print(f"longest stall     {result['longest_zero_run_frames']} frame(s)")
    print(f"single-frame jumps {len(result['single_frame_jumps'])}")
    for j in result["single_frame_jumps"][:5]:
        print(f"                  frame {j['frame']}: {j['delta']}px")
    print(f"monotonic         {result['monotonic']}")
    if "median_match_error" in result:
        print(f"median match err  {result['median_match_error']}")
    print()
    print(f"VERDICT  {result['verdict']}")
    print(f"         {result['reason']}")
    if result.get("qa_warning"):
        print("         ^ this is a warning about the MEASUREMENT, not a result.")


def main() -> int:
    ap = argparse.ArgumentParser(prog="probe.py", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)

    s = sub.add_parser("sheet", help="contact sheets — the first look")
    s.add_argument("video")
    s.add_argument("--fps", type=float, default=6.0)
    s.add_argument("--scale", type=int, default=240)
    s.add_argument("--count", type=int, default=36)
    s.add_argument("--out", default=None)

    t = sub.add_parser("track", help="template-track a region horizontally")
    t.add_argument("video")
    t.add_argument("--roi", type=_roi, required=True, metavar="x,y,w,h")
    t.add_argument("--ref-t", type=float, required=True, metavar="SECONDS")
    t.add_argument("--window", type=_window, default=None, metavar="t0,t1")
    t.add_argument("--fps", type=float, default=30.0)
    t.add_argument("--scale", type=int, default=320)
    t.add_argument("--max-shift", type=int, default=160)
    t.add_argument("--json", action="store_true")

    p = sub.add_parser("panel", help="reveal width vs a closed reference")
    p.add_argument("video")
    p.add_argument("--band", type=_band, required=True, metavar="y,h")
    p.add_argument("--ref-t", type=float, required=True, metavar="SECONDS")
    p.add_argument("--window", type=_window, default=None, metavar="t0,t1")
    p.add_argument("--fps", type=float, default=30.0)
    p.add_argument("--scale", type=int, default=320)
    p.add_argument("--json", action="store_true")

    sub.add_parser("selftest", help="prove the tracker on synthetic frames (no ffmpeg needed)")

    a = ap.parse_args()

    if a.cmd == "selftest":
        return selftest()

    if a.cmd == "sheet":
        out = a.out or os.path.join(os.path.dirname(os.path.abspath(a.video)), "sheets")
        made = sheet(a.video, out, a.fps, a.scale, a.count)
        print(f"{len(made)} sheet(s) in {out}")
        for m in made:
            print(f"  {m}")
        return 0

    frames = read_gray(a.video, a.fps, a.scale, a.window)
    # --ref-t is absolute; inside a --window it is relative to the window start.
    base = a.window[0] if a.window else 0.0
    ref_index = max(0, min(len(frames.data) - 1, int(round((a.ref_t - base) * a.fps))))

    if a.cmd == "track":
        emit(track(frames, a.roi, ref_index, a.max_shift), a.json)
    else:
        emit(panel(frames, a.band, ref_index), a.json)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
