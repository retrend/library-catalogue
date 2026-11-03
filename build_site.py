#!/usr/bin/env python3
"""Build data.json for the public Library Catalogue site from Library Scout's catalog.jsonl.

Read-only over the catalogue. Idempotent: data.json is only rewritten when its content
changes, and it carries no build timestamp (the date shown is the newest found_on / last_checked).

  python3 build_site.py
  LIBRARY_CATALOG=/tmp/library-site-test/catalog.jsonl LIBRARY_SITE_OUT=/tmp/x/data.json python3 build_site.py

Optional catalogue fields (stars, repo_pushed_at, path_updated_at, skill_file, archived, low_trust,
licence_source, first_seen, last_checked, stars_prev) are tolerated. Only low_trust and archived are
shipped (and only when true); "updated" is the newest of found_on and last_checked.

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
# Known types. "app" = closed-source software or a hosted service (often with a free tier), added 2026-11-03.
# Any other clean lowercase type value is passed through as is (and listed in the build log),
# so a new type from Library Scout shows up in the Type filter without a code change.
TYPES = ["skill", "agent", "bot", "plugin", "template", "prompt", "app"]
TYPE_RE = re.compile(r"^[a-z][a-z0-9-]{0,23}$")
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


def flag(v) -> bool:
    return v is True or (isinstance(v, str) and v.strip().lower() == "true")


def date_of(v) -> str:
    d = text(v)[:10]
    return d if DATE_RE.match(d) else ""


def normalise(raw: dict) -> dict | None:
    name = text(raw.get("name")) or text(raw.get("id"))
    if not name:
        return None
    typ = text(raw.get("type")).lower()
    tags = tags_of(raw.get("tags"))
    found = text(raw.get("found_on"))
    e = {  # explicit allow-list: notes and the ranking signals (stars, dates, skill_file, licence_source...) are never copied
        "id": slug(text(raw.get("id")) or name),
        "rank": rank_of(raw.get("rank")),
        "name": name,
        "type": typ if typ in TYPES or TYPE_RE.match(typ) else "other",
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
    # Optional flags, shipped only when true to keep data.json small.
    if flag(raw.get("low_trust")):
        e["low_trust"] = True
    if flag(raw.get("archived")):
        e["archived"] = True
    # Build-only: the newest last_checked feeds the "Updated" date (not shipped per entry).
    e["_checked"] = date_of(raw.get("last_checked"))
    return e


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
    dates = [d for e in entries for d in (e["found_on"], e.pop("_checked")) if d]
    new_types = sorted({e["type"] for e in entries} - set(TYPES) - {"other"})
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
    by_type: dict[str, int] = {}
    for e in entries:
        by_type[e["type"]] = by_type.get(e["type"], 0) + 1
    print("By type: " + ", ".join(f"{k} {v}" for k, v in sorted(by_type.items(), key=lambda kv: -kv[1])))
    print(f"Flagged: low_trust {sum(1 for e in entries if e.get('low_trust'))}, archived {sum(1 for e in entries if e.get('archived'))}")
    if new_types:
        print(f"New type value(s) passed through: {', '.join(new_types)}")
    if no_link:
        print(f"No http(s) link for {len(no_link)} entry(ies): {', '.join(no_link)}")
    for i, n, hits in excluded:
        print(f"EXCLUDED {i} (line {n}: {', '.join(hits)})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
