#!/usr/bin/env python3
"""Resolve (0-based line, 0-based column) positions in dist/app.js to original sources via app.js.map.

Usage as a module: `from srcmap import resolve; resolve(line, col) -> (source, line1, col0, name)`.
"""
import bisect, json, pathlib

MAP = pathlib.Path("/Users/macmax/Desktop/Mytherrania/dist/app.js.map")
_B64 = {c: i for i, c in enumerate("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/")}
_lines = None
_meta = None


def _vlq(seg):
    out, shift, val = [], 0, 0
    for ch in seg:
        d = _B64[ch]
        val += (d & 31) << shift
        if d & 32:
            shift += 5
        else:
            neg = val & 1
            val >>= 1
            out.append(-val if neg else val)
            val, shift = 0, 0
    return out


def _load():
    global _lines, _meta
    if _lines is not None:
        return
    m = json.loads(MAP.read_text())
    _meta = m
    src = srcl = srcc = name = 0
    _lines = []
    for line in m["mappings"].split(";"):
        col = 0
        segs = []
        for seg in line.split(","):
            if not seg:
                continue
            v = _vlq(seg)
            col += v[0]
            if len(v) >= 4:
                src += v[1]; srcl += v[2]; srcc += v[3]
                nm = None
                if len(v) >= 5:
                    name += v[4]
                    nm = name
                segs.append((col, src, srcl, srcc, nm))
        _lines.append(segs)


def resolve(line, col):
    """Return (source path, 1-based line, 0-based column, original name or None) or None."""
    _load()
    if line < 0 or line >= len(_lines):
        return None
    segs = _lines[line]
    if not segs:
        return None
    cols = [s[0] for s in segs]
    i = bisect.bisect_right(cols, col) - 1
    if i < 0:
        i = 0
    c, s, sl, sc, nm = segs[i]
    source = _meta["sources"][s]
    source = source.split("Mytherrania/")[-1] if "Mytherrania/" in source else source.split("/node_modules/")[-1] if "node_modules" in source else source
    return source, sl + 1, sc, (_meta.get("names") or [None])[nm] if nm is not None else None


def enclosing_function(source_rel, line1):
    """Best-effort: the nearest preceding method/function declaration line in a project source."""
    p = pathlib.Path("/Users/macmax/Desktop/Mytherrania") / source_rel
    if not p.exists():
        return None
    import re
    lines = p.read_text().splitlines()
    pat = re.compile(r"^\s*(?:export\s+)?(?:async\s+)?(?:function\s+\w+|(?:static\s+|get\s+|set\s+|private\s+|readonly\s+)*#?\w+\s*\([^)]*\)?\s*(?::[^={]+)?\{|(?:const|let)\s+\w+\s*=\s*(?:\([^)]*\)|\w+)\s*=>)")
    for i in range(min(line1, len(lines)) - 1, -1, -1):
        if pat.match(lines[i]) and not lines[i].strip().startswith(("if", "for", "while", "switch", "return", "else", "}")):
            return i + 1, lines[i].strip()[:90]
    return None


if __name__ == "__main__":
    import sys
    print(resolve(int(sys.argv[1]), int(sys.argv[2])))
