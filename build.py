#!/usr/bin/env python
"""Turn content/ into the things the app serves.

    content/course.json + content/lessons/X-Y.md
        -> site/data/course.json   (everything the web page needs, pre-rendered to HTML)
        -> notebooks/NN_X-Y_slug.ipynb   (one practice notebook per lesson)

Usage:
    python build.py                 build the site data; create notebooks that don't exist yet
    python build.py --force         also overwrite existing notebooks (discards your edits!)
    python build.py --check 3-1     parse one lesson and execute its notebook in a temp dir
    python build.py --check all     same, for every lesson
"""
import argparse
import json
import re
import sys
import tempfile
from pathlib import Path

import markdown
import nbformat
from pygments import highlight
from pygments.formatters import HtmlFormatter
from pygments.lexers import PythonLexer

ROOT = Path(__file__).parent
CONTENT = ROOT / "content"
LESSONS = CONTENT / "lessons"
NOTEBOOKS = ROOT / "notebooks"
SITE_DATA = ROOT / "site" / "data"

SECTIONS = ["Summary", "Lesson", "Key points", "Pitches", "Interview", "Glossary", "Notebook"]
FENCE = re.compile(r"^(```+|~~~+)")
MD_EXTENSIONS = ["fenced_code", "tables", "sane_lists", "codehilite"]
MD_CONFIG = {"codehilite": {"guess_lang": False, "css_class": "hl"}}


class LessonError(Exception):
    pass


def md(text):
    return markdown.markdown(text.strip(), extensions=MD_EXTENSIONS, extension_configs=MD_CONFIG)


def code_html(source):
    return highlight(source, PythonLexer(), HtmlFormatter(nowrap=True))


def split_headings(text, prefix):
    """Split text on lines starting with `prefix` (e.g. '## '), ignoring fenced code.

    Returns (preamble, [(heading, body), ...]).
    """
    preamble, parts, fence = [], [], None
    for line in text.splitlines():
        m = FENCE.match(line)
        if m:
            if fence is None:
                fence = m.group(1)
            elif line.strip() == fence:
                fence = None
        if fence is None and not m and line.startswith(prefix):
            parts.append((line[len(prefix):].strip(), []))
        elif parts:
            parts[-1][1].append(line)
        else:
            preamble.append(line)
    return "\n".join(preamble), [(h, "\n".join(b).strip()) for h, b in parts]


def split_cells(text):
    """Notebook section -> cells. ```python fences become code cells, the rest markdown."""
    cells, buf, code, fence = [], [], None, None
    def flush():
        body = "\n".join(buf).strip()
        if body:
            cells.append({"type": "md", "source": body})
        buf.clear()
    for line in text.splitlines():
        if code is not None:
            if line.strip() == "```":
                cells.append({"type": "code", "source": "\n".join(code).rstrip()})
                code = None
            else:
                code.append(line)
            continue
        m = FENCE.match(line)
        if fence is None and line.strip() == "```python":
            flush()
            code = []
            continue
        if m:
            if fence is None:
                fence = m.group(1)
            elif line.strip() == fence:
                fence = None
        buf.append(line)
    if code is not None:
        raise LessonError("unterminated ```python block in Notebook section")
    flush()
    return cells


def parse_lesson(path):
    raw = path.read_text(encoding="utf-8")
    m = re.match(r"---\n(.*?)\n---\n(.*)", raw, re.S)
    if not m:
        raise LessonError("missing --- front matter ---")
    meta = {}
    for line in m.group(1).splitlines():
        if line.strip():
            key, _, value = line.partition(":")
            meta[key.strip()] = value.strip().strip('"')
    for key in ("title_en", "outcome"):
        if not meta.get(key):
            raise LessonError(f"front matter needs `{key}`")

    body = m.group(2)
    cut = re.search(r"^## Notebook\s*$", body, re.M)
    if not cut:
        raise LessonError("missing `## Notebook` section (must be last)")
    _, parts = split_headings(body[:cut.start()], "## ")
    sec = dict(parts)
    sec["Notebook"] = body[cut.end():]
    missing = [s for s in SECTIONS if not sec.get(s, "").strip()]
    unknown = [s for s in sec if s not in SECTIONS]
    if missing or unknown:
        raise LessonError(f"sections missing={missing} unknown={unknown}")

    points = [re.sub(r"^[-*]\s+", "", l) for l in sec["Key points"].splitlines() if re.match(r"[-*]\s+", l)]
    pitches = [{"topic": h, "text": b} for h, b in split_headings(sec["Pitches"], "### ")[1]]
    interview = [{"q": h, "a": b} for h, b in split_headings(sec["Interview"], "### ")[1]]
    glossary = []
    for line in sec["Glossary"].splitlines():
        if not re.match(r"[-*]\s+", line):
            continue
        cols = [c.strip() for c in re.sub(r"^[-*]\s+", "", line).split("|", 2)]
        if len(cols) != 3:
            raise LessonError(f"glossary line needs `term | 中文 | definition`: {line!r}")
        glossary.append({"term": cols[0].strip("*"), "zh": cols[1], "def": cols[2]})
    cells = split_cells(sec["Notebook"])
    if not (points and pitches and interview and glossary):
        raise LessonError("Key points / Pitches / Interview / Glossary must each have at least one entry")
    if not any(c["type"] == "code" for c in cells):
        raise LessonError("Notebook needs at least one ```python cell")
    toc = [h for h, _ in split_headings(sec["Lesson"], "### ")[1]]
    return {"meta": meta, "summary": sec["Summary"], "lesson": sec["Lesson"], "toc": toc, "points": points,
            "pitches": pitches, "interview": interview, "glossary": glossary, "cells": cells}


def slugify(text):
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")[:48]


def notebook_name(index, lesson, parsed):
    return f"{index:02d}_{lesson['id']}_{slugify(parsed['meta']['title_en'])}.ipynb"


def make_notebook(lesson, parsed):
    lid = lesson["id"].replace("-", ".")
    links = " · ".join(f"[{s['title']}]({s['url']})" for s in lesson["sources"])
    header = (f"# {lid} · {parsed['meta']['title_en']}\n\n"
              f"**{lesson['title_zh']}**\n\n"
              f"> **After this lesson you can:** {parsed['meta']['outcome']}\n\n"
              f"Official reading: {links}\n\n"
              "Run the cells top to bottom (`Shift+Enter`), then change things and re-run. "
              "Everything runs locally: servers live in this kernel, in temp folders, or on localhost. "
              "Cells that call a real LLM are skipped unless `ANTHROPIC_API_KEY` is set.")
    nb = nbformat.v4.new_notebook()
    nb.metadata["kernelspec"] = {"display_name": "Python 3 (ipykernel)", "language": "python", "name": "python3"}
    nb.cells = [nbformat.v4.new_markdown_cell(header)]
    for cell in parsed["cells"]:
        make = nbformat.v4.new_code_cell if cell["type"] == "code" else nbformat.v4.new_markdown_cell
        nb.cells.append(make(cell["source"]))
    return nb


def execute(nb, label):
    from nbclient import NotebookClient
    from nbclient.exceptions import CellExecutionError
    with tempfile.TemporaryDirectory() as tmp:
        client = NotebookClient(nb, timeout=180, kernel_name="python3", resources={"metadata": {"path": tmp}})
        try:
            client.execute()
        except CellExecutionError as exc:
            print(f"FAIL {label}\n{str(exc)[:4000]}")
            return False
    print(f"ok   {label} ({sum(c.cell_type == 'code' for c in nb.cells)} code cells ran)")
    return True


def render(lesson, parsed, nb_file):
    return {
        **lesson,
        "title": parsed["meta"]["title_en"],
        "outcome": parsed["meta"]["outcome"],
        "summary": md(parsed["summary"]),
        "lesson": md(parsed["lesson"]),
        "toc": parsed["toc"],
        "points": [md(p) for p in parsed["points"]],
        "pitches": [{"topic": p["topic"], "text": md(p["text"]), "words": len(p["text"].split())}
                    for p in parsed["pitches"]],
        "interview": [{"q": q["q"], "a": md(q["a"])} for q in parsed["interview"]],
        "glossary": parsed["glossary"],
        "notebook": nb_file,
        "cells": [{"type": c["type"], "html": code_html(c["source"]) if c["type"] == "code" else md(c["source"])}
                  for c in parsed["cells"]],
    }


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--force", action="store_true", help="overwrite existing notebooks")
    ap.add_argument("--check", metavar="ID", help="parse and execute one lesson's notebook (or 'all')")
    args = ap.parse_args()

    course = json.loads((CONTENT / "course.json").read_text(encoding="utf-8"))
    out, ok = [], True
    for index, lesson in enumerate(course["lessons"], 1):
        path = LESSONS / f"{lesson['id']}.md"
        if args.check and args.check not in ("all", lesson["id"]):
            continue
        if not path.exists():
            print(f"--   {lesson['id']} has no content/lessons/{lesson['id']}.md yet")
            ok = ok and not args.check
            continue
        try:
            parsed = parse_lesson(path)
        except LessonError as exc:
            print(f"FAIL {lesson['id']}: {exc}")
            ok = False
            continue
        nb = make_notebook(lesson, parsed)
        if args.check:
            ok = execute(nb, lesson["id"]) and ok
            continue
        name = notebook_name(index, lesson, parsed)
        target = NOTEBOOKS / name
        if args.force or not target.exists():
            NOTEBOOKS.mkdir(exist_ok=True)
            nbformat.write(nb, target)
        out.append(render(lesson, parsed, name))

    if not args.check:
        SITE_DATA.mkdir(parents=True, exist_ok=True)
        data = {k: v for k, v in course.items() if k != "lessons"}
        data["lessons"] = out
        (SITE_DATA / "course.json").write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
        print(f"built {len(out)}/{len(course['lessons'])} lessons -> site/data/course.json, notebooks/")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
