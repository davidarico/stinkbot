#!/usr/bin/env python3
"""Regenerate FEEDBACK.md from feedback table (run from repo root; uses psql).

Loads DATABASE_URL from the first existing file among database/.env, .env, and
bot/.env (same order as bot/src/database.js).
"""
import json
import os
import re
import subprocess
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def _load_env_file(path: Path) -> dict[str, str]:
    if not path.is_file():
        return {}
    out: dict[str, str] = {}
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip().replace("\r", "")
        if not line or line.startswith("#"):
            continue
        m = re.match(r"([A-Za-z_][A-Za-z0-9_]*)=(.*)", line)
        if not m:
            continue
        key, val = m.group(1), m.group(2).strip()
        if (val.startswith('"') and val.endswith('"')) or (val.startswith("'") and val.endswith("'")):
            val = val[1:-1]
        out[key] = val
    return out


def _database_url_env() -> dict[str, str]:
    """Load the first existing env file among the same paths as bot/src/database.js."""
    candidates = [
        ROOT / "database" / ".env",
        ROOT / ".env",
        ROOT / "bot" / ".env",
    ]
    for p in candidates:
        if p.is_file():
            return _load_env_file(p)
    return {}


def _as_text(v: object) -> str:
    if v is None:
        return ""
    if isinstance(v, list):
        return "\n".join(_as_text(x) for x in v)
    return str(v)


def main() -> int:
    env = os.environ.copy()
    env.update(_database_url_env())
    db_url = env.get("DATABASE_URL")
    if not db_url:
        print("DATABASE_URL not set and no .env found with it.", file=sys.stderr)
        return 1

    # Drop libpq connection env so host-level PGHOST/PGUSER/etc. cannot override the URI
    # (wrong SCRAM when DATABASE_URL is correct but PG* disagrees).
    for key in (
        "PGHOST",
        "PGPORT",
        "PGUSER",
        "PGDATABASE",
        "PGPASSWORD",
        "PGPASSFILE",
        "PGSERVICE",
        "PGTARGETSESSIONATTRS",
    ):
        env.pop(key, None)

    out = subprocess.check_output(
        [
            "psql",
            db_url,
            "-t",
            "-A",
            "-c",
            "SELECT COALESCE(json_agg(row_to_json(t) ORDER BY created_at), '[]'::json)::text "
            "FROM (SELECT id, user_id, display_name, feedback_text, server_id, created_at "
            "FROM feedback ORDER BY created_at ASC) t;",
        ],
        cwd=str(ROOT),
        text=True,
        env=env,
    ).strip()
    rows = json.loads(out)
    d = date.today().isoformat()

    lines = [
        "# Feedback",
        "",
        "Snapshot of the `feedback` table. Resolved items (implemented, already covered, "
        "out-of-scope, or non-actionable) were **removed from the database** on "
        f"**{d}**.",
        "",
        f"**Total entries:** {len(rows)}",
        "",
        "---",
        "",
    ]

    for r in rows:
        cid = r["id"]
        ts = r["created_at"]
        lines.append(f"## #{cid} — {ts}")
        lines.append("")
        lines.append(f"- **Display name:** {_as_text(r.get('display_name'))}")
        lines.append(f"- **User ID:** `{_as_text(r.get('user_id'))}`")
        lines.append(f"- **Server ID:** `{_as_text(r.get('server_id'))}`")
        lines.append("")
        lines.append("**Feedback**")
        lines.append("")
        for para in _as_text(r.get("feedback_text")).split("\n"):
            lines.append(f"> {para}" if para else ">")
        lines.append("")
        lines.append("---")
        lines.append("")

    path = ROOT / "FEEDBACK.md"
    path.write_text("\n".join(lines).rstrip() + "\n", encoding="utf-8")
    print(f"Wrote {path} ({len(rows)} entries)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
