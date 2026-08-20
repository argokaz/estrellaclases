#!/usr/bin/env python3
"""Normalize the legacy ACCESS CONTROL block so the idempotent migrator can match it.

The current index has isUnlocked() on one line, while the original migration
regex expected a multiline function. This changes formatting only, not behavior.
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
INDEX = ROOT / "index.html"

old = "function isUnlocked(){ return localStorage.getItem(PASS_KEY) === '1'; }"
new = "function isUnlocked(){\n  return localStorage.getItem(PASS_KEY) === '1';\n}"

text = INDEX.read_text(encoding="utf-8")
if "cc2026_teacher_token" in text:
    print("auth block already migrated; normalization skipped")
elif old in text:
    INDEX.write_text(text.replace(old, new, 1), encoding="utf-8")
    print("normalized legacy isUnlocked() formatting")
else:
    raise RuntimeError("No encontré el bloque legacy isUnlocked() esperado")
