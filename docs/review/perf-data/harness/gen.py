#!/usr/bin/env python3
"""Generate one Playwright runner file per screen configuration from runner.template.js."""
import json, pathlib

HERE = pathlib.Path(__file__).parent
TEMPLATE = (HERE / "runner.template.js").read_text()
CONFIGS = {
    "smoke":      {"name": "smoke", "w": 1440, "h": 900, "dpr": 1, "sizes": [12], "profile": True},
    "phone4x":    {"name": "phone 375x812 @3 (CPU 4x)", "w": 375, "h": 812, "dpr": 3, "mobile": True, "throttle": 4, "sizes": [12, 120], "profile": True},
    "phone1x":    {"name": "phone 375x812 @3 (CPU 1x)", "w": 375, "h": 812, "dpr": 3, "mobile": True, "sizes": [12, 120]},
    "tablet":     {"name": "tablet 768x1024 @2", "w": 768, "h": 1024, "dpr": 2, "mobile": True, "sizes": [12, 120]},
    "laptop":     {"name": "laptop 1440x900 @2", "w": 1440, "h": 900, "dpr": 2, "sizes": [12, 120], "profile": True},
    "laptop1x":   {"name": "laptop 1440x900 @1", "w": 1440, "h": 900, "dpr": 1, "sizes": [12, 120]},
    "uhd":        {"name": "4K 1920x1080 @2 (3840x2160 backing)", "w": 1920, "h": 1080, "dpr": 2, "sizes": [12, 120]},
}
for key, cfg in CONFIGS.items():
    (HERE / f"run_{key}.js").write_text(TEMPLATE.replace("__CFG__", json.dumps({**cfg, "key": key})))
print(sorted(p.name for p in HERE.glob("run_*.js")))
