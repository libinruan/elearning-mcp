"""Your study progress, kept in a local SQLite file (progress.sqlite3 — git-ignored, never pushed).

The site reads it with GET /api/progress and changes it with POST /api/progress {"changes": [...]}, where each
change is one of
    {"kind": "done",    "key": "3-1",   "value": true | false}
    {"kind": "mark",    "key": "3-1#2", "value": "know" | "review" | null}
    {"kind": "setting", "key": "lang",  "value": "en" | "zh"}
Every change is also appended to `history`, so you can see later when you finished or reviewed what.
"""
import re
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

DB = Path(__file__).resolve().parent / "progress.sqlite3"

SCHEMA = """
create table if not exists lesson_done (lesson text primary key, done_at text not null);
create table if not exists card_mark (card text primary key, mark text not null, marked_at text not null);
create table if not exists setting (key text primary key, value text not null);
create table if not exists history (id integer primary key, at text not null, kind text not null, key text not null, value text);
"""

LESSON = re.compile(r"\d+-\d+")
CARD = re.compile(r"\d+-\d+#\d+")
SETTINGS = {"lang": {"en", "zh"}}


class BadChange(ValueError):
    pass


@contextmanager
def connect(path=DB):
    """One short-lived connection per request: commit on success, roll back on error, always close."""
    db = sqlite3.connect(path, timeout=5)
    try:
        db.executescript(SCHEMA)
        with db:
            yield db
    finally:
        db.close()


def load(path=DB):
    with connect(path) as db:
        return {
            "done": [r[0] for r in db.execute("select lesson from lesson_done order by done_at")],
            "marks": dict(db.execute("select card, mark from card_mark")),
            "settings": dict(db.execute("select key, value from setting")),
        }


def check(change):
    kind, key, value = change.get("kind"), change.get("key"), change.get("value")
    ok = ((kind == "done" and isinstance(key, str) and LESSON.fullmatch(key) and isinstance(value, bool))
          or (kind == "mark" and isinstance(key, str) and CARD.fullmatch(key) and value in ("know", "review", None))
          or (kind == "setting" and value in SETTINGS.get(key, ())))
    if not ok:
        raise BadChange(f"not a valid change: {change!r}")
    return kind, key, value


def apply(changes, path=DB):
    """Apply a list of changes in one transaction (all or nothing)."""
    checked = [check(c) for c in changes]
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    with connect(path) as db:
        for kind, key, value in checked:
            if kind == "done" and value:
                db.execute("insert or ignore into lesson_done values (?, ?)", (key, now))
            elif kind == "done":
                db.execute("delete from lesson_done where lesson = ?", (key,))
            elif kind == "mark" and value:
                db.execute("insert or replace into card_mark values (?, ?, ?)", (key, value, now))
            elif kind == "mark":
                db.execute("delete from card_mark where card = ?", (key,))
            else:
                db.execute("insert or replace into setting values (?, ?)", (key, value))
            db.execute("insert into history (at, kind, key, value) values (?, ?, ?, ?)",
                       (now, kind, key, None if value is None else str(value).lower()))
