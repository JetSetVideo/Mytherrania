#!/usr/bin/env python3
"""Aggregate the Playwright perf runs (out/*.json) into tables for docs/review/performance.md."""
import json, pathlib, sys
sys.path.insert(0, str(pathlib.Path(__file__).parent))
import srcmap

OUT = pathlib.Path(__file__).parent.parent / "raw"  # the saved runs (scratch copy used ./out)
ORDER = ["phone4x", "phone1x", "tablet", "laptop1x", "laptop", "uhd"]
CATS = ["body", "body-outline", "weapon", "weapon-outline", "terrain-ring", "terrain-outside", "props", "wall", "fx", "sky", "void-plane", "aura+contact", "pickups", "coin", "untagged"]


def load():
    runs = {}
    for k in ORDER:
        p = OUT / f"{k}.json"
        if p.exists():
            runs[k] = json.loads(p.read_text())
    return runs


def f(x, nd=1):
    return "—" if x is None else (f"{x:.{nd}f}" if isinstance(x, float) else str(x))


def frame_table(runs):
    rows = ["| Screen (CSS @ DPR) | Arena | Backing px (Mpx) | rAF dt med / p95 ms | JS/frame med / p95 ms | frames >12.5 ms / 5 s | GPU med ms | GPU p95 ms | GL draws main + shadow | GL triangles main + shadow |",
            "|---|---|---|---|---|---|---|---|---|---|"]
    for k, d in runs.items():
        c = d["cfg"]
        for r in d["runs"]:
            L, F, R = r["light"], r["full"], r["renderer"]
            w, h = R["canvas"]
            g = F.get("gpu") or {}
            ti = F.get("threeInfo") or {}
            pf = F["perFrame"]
            mc = sum(v["calls"] for k2, v in pf.items() if k2.startswith("main|")); sc_ = sum(v["calls"] for k2, v in pf.items() if k2.startswith("shadow|"))
            mt = sum(v["tris"] for k2, v in pf.items() if k2.startswith("main|")); st_ = sum(v["tris"] for k2, v in pf.items() if k2.startswith("shadow|"))
            rows.append(f"| {c['name']} | {r['size']} m ({r['snap']['ring']['shape']}) | {w}x{h} ({w*h/1e6:.2f}) | {f(L['dt']['med'])} / {f(L['dt']['p95'])} | {f(L['js']['med'])} / {f(L['js']['p95'])} | {L['long']['dtOver12_5']} of {L['dt']['n']} | {f(g['total']['med'],2)} | {f(g['total']['p95'],1)} | {mc:.0f} + {sc_:.0f} = {mc+sc_:.0f} | {mt:,} + {st_:,} = {mt+st_:,} |")
    return "\n".join(rows)


def category_table(runs, key, size):
    d = runs[key]
    r = next(x for x in d["runs"] if x["size"] == size)
    pf = r["full"]["perFrame"]
    sc = r["scene"]
    rows = [f"| Category | main calls | main tris | shadow calls | shadow tris | meshes (visible) | materials | castShadow | transparent |", "|---|---|---|---|---|---|---|---|---|"]
    tot = [0, 0, 0, 0]
    for cat in CATS:
        m = pf.get(f"main|{cat}", {"calls": 0, "tris": 0})
        s = pf.get(f"shadow|{cat}", {"calls": 0, "tris": 0})
        st = sc.get(cat)
        if not st and not m["calls"] and not s["calls"]:
            continue
        tot = [tot[0] + m["calls"], tot[1] + m["tris"], tot[2] + s["calls"], tot[3] + s["tris"]]
        rows.append(f"| {cat} | {f(m['calls'])} | {m['tris']:,} | {f(s['calls'])} | {s['tris']:,} | {st['meshes'] if st else 0} ({st['visible'] if st else 0}) | {st['mats'] if st else 0} | {st['castShadow'] if st else 0} | {st['transparent'] if st else 0} |")
    rows.append(f"| **total** | **{tot[0]:.0f}** | **{tot[1]:,}** | **{tot[2]:.0f}** | **{tot[3]:,}** | | | | |")
    return "\n".join(rows)


def overdraw_table(runs):
    rows = ["| Screen | Arena | raw layers/px (all · opaque · transparent) | depth-tested layers/px (all · opaque · transparent) | wall raw / tested | void-plane coverage | est. shaded fragments/frame TBDR · IMR (M) |",
            "|---|---|---|---|---|---|---|"]
    for k, d in runs.items():
        for r in d["runs"]:
            o = r["overdraw"]
            if "raw" not in o:
                rows.append(f"| {d['cfg']['name']} | {r['size']} m | {o.get('err')} | | | | |")
                continue
            raw, te = o["raw"], o["tested"]
            w, h = r["renderer"]["canvas"]
            px = w * h
            tbdr = px * (te["opaque"]["coverage"] + te["transparent"]["layers"]) / 1e6
            imr = px * te["all"]["layers"] / 1e6
            wall = raw.get("wall", {"layers": 0}); wallt = te.get("wall", {"layers": 0})
            rows.append(f"| {d['cfg']['name']} | {r['size']} m | {raw['all']['layers']:.2f} · {raw['opaque']['layers']:.2f} · {raw['transparent']['layers']:.2f} | {te['all']['layers']:.2f} · {te['opaque']['layers']:.2f} · {te['transparent']['layers']:.2f} | {wall['layers']:.2f} / {wallt['layers']:.2f} | {raw.get('void-plane', {'coverage': 0})['coverage']:.2f} | {tbdr:.1f} · {imr:.1f} |")
    return "\n".join(rows)


def profile_table(runs, key, size, n=15):
    d = runs[key]
    r = next(x for x in d["runs"] if x["size"] == size)
    pr = r.get("profile")
    if not pr:
        return ""
    frames = pr["frames"] or 1
    rows = [f"Profile window: {pr['totalMs']} ms sampled, {pr['samples']} samples @200 µs, {frames} frames (rAF dt med {pr['dt']['med']} ms, JS/frame med {pr['js']['med']} ms).", "",
            "| # | self ms (5 s) | µs/frame | % of wall | function | original source |", "|---|---|---|---|---|---|"]
    i = 0
    for x in pr["self"]:
        if x["fn"] in ("(idle)", "(program)"):
            continue
        i += 1
        src = "native / V8"
        if x["url"] == "app.js":
            m = srcmap.resolve(x["line"], x["col"])
            if m:
                path = m[0].split("registry.npmjs.org/")[-1].replace("../", "")
                src = f"`{path}:{m[1]}`" + (f" ({m[3]})" if m[3] else "")
        rows.append(f"| {i} | {x['ms']} | {1000 * x['ms'] / frames:.0f} | {x['pct']} | `{x['fn']}` | {src} |")
        if i >= n:
            break
    idle = next((x for x in pr["self"] if x["fn"] == "(idle)"), None)
    prog = next((x for x in pr["self"] if x["fn"] == "(program)"), None)
    rows.append("")
    rows.append(f"(idle) {idle['ms'] if idle else '—'} ms ({idle['pct'] if idle else '—'} %), (program) {prog['ms'] if prog else '—'} ms ({prog['pct'] if prog else '—'} %).")
    return "\n".join(rows)


def incl_table(runs, key, size, wanted):
    d = runs[key]
    r = next(x for x in d["runs"] if x["size"] == size)
    pr = r.get("profile")
    frames = pr["frames"] or 1
    out = {}
    for x in pr["incl"]:
        m = srcmap.resolve(x["line"], x["col"]) if x["url"] == "app.js" else None
        name = (m[3] if m and m[3] else x["fn"])
        loc = (m[0].split("registry.npmjs.org/")[-1].replace("../", "") + ":" + str(m[1])) if m else ""
        out.setdefault(name + "@" + loc, (x["ms"], 1000 * x["ms"] / frames, x["pct"]))
    rows = ["| function (inclusive) | ms / 5 s | µs/frame | % wall |", "|---|---|---|---|"]
    for k, v in out.items():
        if any(w in k for w in wanted):
            rows.append(f"| `{k}` | {v[0]} | {v[1]:.0f} | {v[2]} |")
    return "\n".join(rows)


if __name__ == "__main__":
    runs = load()
    print(frame_table(runs))
    print()
    print(overdraw_table(runs))
    print()
    for k in ["laptop", "phone4x"]:
        for s in [12, 120]:
            print(f"### {k} {s}")
            print(category_table(runs, k, s))
            print()
