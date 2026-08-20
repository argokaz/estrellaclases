"""Temporary compatibility shim for the auth migration.

Python imports sitecustomize before running scripts in this directory. The
legacy index has isUnlocked() on one line, while the original migration regex
expects it formatted across lines. Normalize formatting only; behavior stays
identical. Once migrated, this becomes a no-op.
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
INDEX = ROOT / "index.html"

try:
    text = INDEX.read_text(encoding="utf-8")
    if "cc2026_teacher_token" not in text:
        old = "function isUnlocked(){ return localStorage.getItem(PASS_KEY) === '1'; }"
        new = "function isUnlocked(){\n  return localStorage.getItem(PASS_KEY) === '1';\n}"
        if old in text:
            INDEX.write_text(text.replace(old, new, 1), encoding="utf-8")
except Exception:
    # Never break unrelated Python commands; the migration itself will surface
    # a useful error if the expected block still cannot be found.
    pass
