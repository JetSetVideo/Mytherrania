#!/usr/bin/env python3
# QD helper: print board entries with id > N (board.ts read does not filter).
import re, sys
n = int(sys.argv[1]) if len(sys.argv) > 1 else 0
txt = open("/Users/macmax/Desktop/Mytherrania/artifacts/wave-tex/BOARD.md").read()
parts = re.split(r"(?m)^(?=### \[Z-\d+\])", txt)
for p in parts:
    m = re.match(r"### \[Z-(\d+)\]", p)
    if m and int(m.group(1)) > n:
        s = p.strip()
        print(s if len(s) < 2500 else s[:2500] + " …")
        print()
