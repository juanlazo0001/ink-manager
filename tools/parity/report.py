"""
The contact sheet, and the EXPECTED-vs-DRIFT classification.

The classification is the point of the whole harness. A raw list of
differences between two clients is noise — the two ARE different, on
purpose, in a dozen places. What a session needs to act on is the
difference nobody decided on.

So every mismatch is checked against `expected-divergences.md`, and a
mismatch that is not named there is DRIFT. Adding a new deliberate
divergence means adding it to that file in the same commit, which is the
rule CLAUDE.md now carries.
"""

import re
from pathlib import Path

MANIFEST = Path(__file__).parent / "expected-divergences.md"

# The property groups a named divergence can excuse. A divergence about
# "icon-only actions" should not silently excuse a font-family mismatch,
# so each entry declares what it covers.
GROUPS = {
    "type": {"fontFamily", "fontSize", "fontWeight", "letterSpacing"},
    "color": {"color", "backgroundColor", "borderColor"},
    "spacing": {"paddingTop", "paddingLeft", "gap"},
    "shape": {"borderRadius", "borderTopWidth"},
}


def load_expected():
    """
    Parses `expected-divergences.md`. Each divergence is a `## ` heading
    followed by a `covers:` line naming screens and property groups.
    """
    if not MANIFEST.exists():
        return []
    entries = []
    current = None
    for line in MANIFEST.read_text(encoding="utf-8").splitlines():
        if line.startswith("## "):
            current = {"title": line[3:].strip(), "screens": set(), "groups": set(), "reason": ""}
            entries.append(current)
        elif current is not None:
            m = re.match(r"\s*-\s*covers:\s*(.+)", line, re.I)
            if m:
                for token in m.group(1).split(","):
                    token = token.strip()
                    if token.startswith("screen:"):
                        current["screens"].add(token.split(":", 1)[1].strip())
                    elif token.startswith("group:"):
                        current["groups"].add(token.split(":", 1)[1].strip())
            elif line.strip() and not current["reason"]:
                current["reason"] = line.strip()
    return entries


#: Platform naming, not design. react-native-web resolves a family to the
#: loaded font's PostScript-ish name (`Outfit_400Regular`) where the
#: browser reports the CSS stack (`Outfit, ui-sans-serif, ...`). Comparing
#: those strings reports every single text element as different, which is
#: noise that would bury real findings.
def _normalise(prop, value):
    if prop != "fontFamily":
        return value
    first = value.split(",")[0].strip().strip("\"'")
    # Outfit_400Regular -> outfit ; "Fraunces" -> fraunces
    return first.split("_")[0].strip().lower()


def classify(screen_key, prop, expected):
    """
    EXPECTED (with the reason) or DRIFT.

    ─── AN ENTRY MUST NAME ITS SCREENS ─────────────────────────────

    This originally treated a missing `screen:` as "applies everywhere",
    which quietly turned the whole classifier off: "Card titles are
    sentence case on mobile" carries `group:type` and no screen, so it
    excused EVERY type difference on EVERY screen. The first full run
    reported TOTAL DRIFT: 0 while the Pipeline title measured 15px on web
    against 32px on mobile.

    A false green is the worst thing this tool can produce — it is the
    exact confidence the rule in CLAUDE.md was written to replace. So an
    entry now applies only where it says it applies, and `screen:*` has
    to be written out when that is really meant.
    """
    group = next((g for g, props in GROUPS.items() if prop in props), None)
    for e in expected:
        if not e["screens"]:
            continue  # names no screen: documents something, excuses nothing
        screens_ok = screen_key in e["screens"] or "*" in e["screens"]
        groups_ok = not e["groups"] or (group in e["groups"]) or "*" in e["groups"]
        if screens_ok and groups_ok:
            return "EXPECTED", e["title"]
    return "DRIFT", None


def compare(row, expected):
    """Per-landmark, per-property comparison for one screen."""
    out = []
    web, mob = row.get("web") or {}, row.get("mobile") or {}
    for landmark in sorted(set(web) | set(mob)):
        w, m = web.get(landmark), mob.get(landmark)
        if w is None or m is None:
            out.append({
                "landmark": landmark,
                "property": "(present)",
                "web": "found" if w else "MISSING",
                "mobile": "found" if m else "MISSING",
                "match": False,
                "verdict": "DRIFT" if (w is None) != (m is None) else "—",
                "reason": None,
            })
            continue
        for prop in sorted(set(w) | set(m)):
            if prop.startswith("__"):
                continue
            wv, mv = str(w.get(prop, "—")), str(m.get(prop, "—"))
            match = _normalise(prop, wv) == _normalise(prop, mv)
            verdict, reason = ("MATCH", None) if match else classify(row["key"], prop, expected)
            out.append({
                "landmark": landmark, "property": prop,
                "web": wv, "mobile": mv, "match": match,
                "verdict": verdict, "reason": reason,
            })
    return out


CSS = """
:root{--ground:#0e0b08;--surface:#151009;--rule:#241d14;--fg:#f2ece0;--muted:#9b927f;
--gold:#c99a5b;--brick:#c2553f;--sage:#7d9068}
*{box-sizing:border-box}
body{background:var(--ground);color:#c7bfae;font:14px/1.6 system-ui,sans-serif;margin:0;padding:32px}
h1{font:400 34px/1.1 Georgia,serif;color:var(--fg);margin:0}
h2{font:400 22px/1.2 Georgia,serif;color:var(--fg);margin:48px 0 4px;border-top:1px solid var(--rule);padding-top:24px}
.eyebrow{font:600 11px/1 system-ui;letter-spacing:.18em;text-transform:uppercase;color:var(--gold);margin:0 0 10px}
.lede{color:var(--muted);max-width:70ch}
.shots{display:flex;gap:16px;flex-wrap:wrap;margin:18px 0}
.shots figure{margin:0}
.shots img{max-height:460px;border:1px solid var(--rule);display:block}
figcaption{font:600 10px/1 system-ui;letter-spacing:.14em;text-transform:uppercase;color:var(--muted);padding:8px 0}
table{border-collapse:collapse;width:100%;margin-top:12px;font-size:13px}
th{text-align:left;font:700 10px/1 system-ui;letter-spacing:.14em;text-transform:uppercase;color:var(--gold);
padding:0 12px 8px 0;border-bottom:1px solid var(--rule)}
td{padding:7px 12px 7px 0;border-bottom:1px solid var(--rule);vertical-align:top;font-variant-numeric:tabular-nums}
.v{font:700 9px/1 system-ui;letter-spacing:.12em;padding:3px 7px;border:1px solid;border-radius:2px;white-space:nowrap}
.MATCH{color:var(--sage);border-color:rgba(125,144,104,.45)}
.EXPECTED{color:var(--gold);border-color:rgba(201,154,91,.45)}
.DRIFT{color:var(--brick);border-color:rgba(194,85,63,.5);background:rgba(194,85,63,.08)}
.err{color:var(--brick)}
.limits{border-left:2px solid var(--brick);background:var(--surface);padding:14px 18px;margin:22px 0;max-width:80ch}
.count{display:inline-block;margin-right:18px;color:var(--muted)}
.count b{color:var(--fg);font-size:20px;font-family:Georgia,serif}
"""


def render_index(results, role):
    expected = load_expected()
    drift_total = 0
    sections = []

    for row in results:
        rows = compare(row, expected)
        drift = [r for r in rows if r["verdict"] == "DRIFT"]
        drift_total += len(drift)

        shots = []
        for key, cap in (("web_390", "web 390"), ("mobile_390", "mobile 390"),
                         ("web_1440", "web 1440"), ("composite", "composite"), ("diff", "diff")):
            if row.get(key):
                shots.append(f'<figure><img src="shots/{row[key]}" alt="{cap}">'
                             f'<figcaption>{cap}</figcaption></figure>')

        errs = ""
        for side in ("web_error", "mobile_error"):
            if row.get(side):
                errs += f'<p class="err">{side}: {row[side]}</p>'

        body = ""
        if rows:
            trs = "".join(
                f'<tr><td>{r["landmark"]}</td><td>{r["property"]}</td>'
                f'<td>{r["web"]}</td><td>{r["mobile"]}</td>'
                f'<td><span class="v {r["verdict"]}">{r["verdict"]}</span></td>'
                f'<td>{r["reason"] or ""}</td></tr>'
                for r in rows
            )
            body = ("<table><tr><th>landmark</th><th>property</th><th>web</th><th>mobile</th>"
                    f"<th>verdict</th><th>expected because</th></tr>{trs}</table>")
        else:
            body = '<p class="lede">No landmarks defined for this screen yet.</p>'

        note = f'<p class="lede">{row["note"]}</p>' if row.get("note") else ""
        pct = f' · pixel difference {row["diff_pct"]}%' if row.get("diff_pct") is not None else ""
        sections.append(
            f'<h2>{row["title"]}</h2>'
            f'<p class="lede">{len(drift)} drift{pct}</p>{note}{errs}'
            f'<div class="shots">{"".join(shots)}</div>{body}'
        )

    return f"""<!doctype html><meta charset="utf-8"><title>Parity — {role}</title>
<style>{CSS}</style>
<p class="eyebrow">Ink Manager · web vs iOS</p>
<h1>Parity report — {role}</h1>
<p class="lede">Screens compared side by side at 390&times;844, with computed values read off
named landmarks on both sides. Every mismatch is either EXPECTED — named in
<code>expected-divergences.md</code> — or DRIFT, which is the punch list.</p>
<p style="margin-top:18px">
  <span class="count"><b>{len(results)}</b> screens</span>
  <span class="count"><b>{drift_total}</b> drift findings</span>
  <span class="count"><b>{len(expected)}</b> known divergences</span>
</p>
<div class="limits">
<b>What this is not valid for.</b> Layout, type, colour and spacing only. It says
nothing about MOTION, GESTURES or true native rendering: Reanimated does not advance
inside app subtrees under this harness and gesture-handler is inert to synthetic input.
A green report here is not a substitute for the owner's device gate.<br><br>
The pixel-difference percentage is context, not a gate — two different renderers are never
pixel-identical. The value tables decide.
</div>
{"".join(sections)}
"""
