#!/usr/bin/env python3
"""Build data.json for the public Library Catalogue site from Library Scout's catalog.jsonl.

Read-only over the catalogue. Idempotent: data.json is only rewritten when its content
changes, and it carries no build timestamp (the date shown is the newest found_on).

  python3 build_site.py
  LIBRARY_CATALOG=/tmp/library-site-test/catalog.jsonl LIBRARY_SITE_OUT=/tmp/x/data.json python3 build_site.py

Privacy rules:
  - the 'notes' field is never written to data.json
  - entries with status 'skip' are left out (count only)
  - any entry whose raw fields match the secrets / personal-details scan is left out
"""
from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
CATALOG = Path(os.environ.get("LIBRARY_CATALOG", "/workspace/library-catalog/catalog.jsonl"))
OUT = Path(os.environ.get("LIBRARY_SITE_OUT", ROOT / "data.json"))

# Same patterns as /workspace/skill-browser/build_skills.py (copied so this project stands alone).
SECRET_PATTERNS = [
    ("github-token", r"gh[pousr]_[A-Za-z0-9]{20,}"),
    ("github-pat", r"github_pat_[A-Za-z0-9_]{20,}"),
    ("sk-api-key", r"\bsk-[A-Za-z0-9_-]{20,}"),
    ("slack-token", r"xox[abprs]-[A-Za-z0-9-]{10,}"),
    ("aws-key", r"AKIA[0-9A-Z]{16}"),
    ("google-key", r"AIza[0-9A-Za-z_-]{30,}"),
    ("private-key", r"-----BEGIN [A-Z ]*PRIVATE KEY"),
    ("bearer-token", r"(?i)bearer\s+[A-Za-z0-9._-]{24,}"),
    ("key-assignment", r"(?i)(api[_-]?key|secret|token|password)\s*[:=]\s*['\"]?[A-Za-z0-9/+_.-]{16,}"),
    ("email", r"[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z0-9.-]*[A-Za-z]{2,}"),
    ("phone", r"(?<![\d/=-])\+\d{1,3}[\s.-]?\(?\d{2,4}\)?[\s.-]?\d{3,4}[\s.-]?\d{3,4}(?!\d)"),
]
TYPES = ["skill", "agent", "bot", "plugin", "template", "prompt"]
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def secret_hits(s: str) -> list[str]:
    return [label for label, pat in SECRET_PATTERNS if re.search(pat, s)]


def text(v) -> str:
    if v is None:
        return ""
    if isinstance(v, (list, tuple)):
        return ", ".join(t for t in (text(x) for x in v) if t)
    if isinstance(v, dict):
        return ""
    return re.sub(r"\s+", " ", str(v)).strip()


def tags_of(v) -> list[str]:
    if isinstance(v, str):
        items = v.split(",")
    elif isinstance(v, (list, tuple)):
        items = [x for x in v if isinstance(x, (str, int, float))]
    else:
        items = []
    out: list[str] = []
    for t in items:
        t = re.sub(r"\s+", "-", str(t).strip().lower().lstrip("#"))
        if t and t not in out:
            out.append(t)
    return out


def slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")[:80] or "entry"


def safe_url(v) -> str:
    u = text(v)
    return u if re.match(r"^https?://[^\s\"'<>]+$", u, re.I) else ""


def rank_of(v):
    try:
        r = int(float(v))
        return r if r > 0 else None
    except (TypeError, ValueError):
        return None


def normalise(raw: dict) -> dict | None:
    name = text(raw.get("name")) or text(raw.get("id"))
    if not name:
        return None
    typ = text(raw.get("type")).lower()
    tags = tags_of(raw.get("tags"))
    found = text(raw.get("found_on"))
    return {  # explicit allow-list: notes is never copied
        "id": slug(text(raw.get("id")) or name),
        "rank": rank_of(raw.get("rank")),
        "name": name,
        "type": typ if typ in TYPES else "other",
        "need": tags[0] if tags else "",
        "tags": tags,
        "summary": text(raw.get("summary")),
        "use_when": text(raw.get("use_when")),
        "author": text(raw.get("author")),
        "licence": text(raw.get("licence")) or "none stated",
        "source_site": text(raw.get("source_site")),
        "url": safe_url(raw.get("source_url")),
        "found_on": found if DATE_RE.match(found) else "",
    }


def main() -> int:
    blank, bad, skipped_status, excluded, no_link = 0, [], [], [], []
    entries: list[dict] = []
    if CATALOG.exists():
        lines = CATALOG.read_text(encoding="utf-8", errors="replace").splitlines()
    else:
        print(f"Catalogue not found at {CATALOG}; writing an empty data.json")
        lines = []
    seen: set[str] = set()
    valid = 0
    for n, line in enumerate(lines, 1):
        if not line.strip():
            blank += 1
            continue
        try:
            raw = json.loads(line)
        except json.JSONDecodeError:
            bad.append(n)
            continue
        e = normalise(raw) if isinstance(raw, dict) else None
        if e is None:
            bad.append(n)
            continue
        valid += 1
        if text(raw.get("status")).lower() == "skip":
            skipped_status.append(e["id"])
            continue
        hits = secret_hits(json.dumps(raw, ensure_ascii=False))
        if hits:
            excluded.append((e["id"], n, hits))
            continue
        if not e["url"]:
            no_link.append(e["id"])
        base, i = e["id"], 2
        while e["id"] in seen:
            e["id"] = f"{base}-{i}"
            i += 1
        seen.add(e["id"])
        entries.append(e)

    entries.sort(key=lambda e: (e["rank"] is None, e["rank"] or 0, e["name"].lower(), e["id"]))
    dates = [e["found_on"] for e in entries if e["found_on"]]
    data = {
        "name": "Library Catalogue",
        "updated": max(dates) if dates else "",
        "count": len(entries),
        "skippedStatus": len(skipped_status),
        "excluded": len(excluded),
        "entries": entries,
    }
    out = json.dumps(data, ensure_ascii=False, indent=1, sort_keys=True) + "\n"
    old = OUT.read_text(encoding="utf-8") if OUT.exists() else None
    if old == out:
        print(f"data.json up to date ({len(entries)} entries)")
    else:
        OUT.parent.mkdir(parents=True, exist_ok=True)
        OUT.write_text(out, encoding="utf-8")
        print(f"Wrote {OUT}: {len(entries)} entries")
    print(f"Valid lines: {valid}; published: {len(entries)}")
    if blank:
        print(f"Skipped {blank} blank line(s)")
    if bad:
        print(f"Skipped {len(bad)} malformed line(s): {', '.join(map(str, bad))}")
    if skipped_status:
        print(f"Left out {len(skipped_status)} entry(ies) with status skip")
    if no_link:
        print(f"No http(s) link for {len(no_link)} entry(ies): {', '.join(no_link)}")
    for i, n, hits in excluded:
        print(f"EXCLUDED {i} (line {n}: {', '.join(hits)})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
