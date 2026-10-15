const app = document.getElementById("app");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// Progress lives in this browser only.
const store = {
  get(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode: progress just won't persist */ }
  },
};

let course = null;
let jupyter = null;
const done = new Set(store.get("mcp.done", []));
const marks = store.get("mcp.marks", {}); // "5-3#0" -> "know" | "review"
const filters = { glossary: { q: "", module: "" }, pitches: { module: "" }, interview: { module: "", status: "", order: null } };
let timers = [];

const dot = (id) => id.replace("-", ".");
const minutes = (m) => (m >= 60 ? `${Math.floor(m / 60)} h ${m % 60 ? `${m % 60} min` : ""}` : `${m} min`).trim();
const moduleOf = (n) => course.modules.find((m) => m.n === n);
const lessonOf = (id) => course.lessons.find((l) => l.id === id);
const slug = (text) => "s-" + text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

function notebookUrl(lesson) {
  return jupyter ? `${jupyter.url}/lab/tree/${encodeURIComponent(lesson.notebook)}?token=${jupyter.token}` : null;
}

function moduleSelect(value) {
  return `<select data-filter="module" aria-label="Module">
    <option value="">All modules</option>
    ${course.modules.map((m) => `<option value="${m.n}" ${String(m.n) === value ? "selected" : ""}>${m.n} · ${esc(m.title)}</option>`).join("")}
  </select>`;
}

/* ---------- shared pieces ---------- */

function pitchCard(lesson, pitch, showTag) {
  return `<article class="card pitch">
    <h3>${esc(pitch.topic)}</h3>
    <div class="pitch-text">${pitch.text}</div>
    <div class="timer"><div class="bar"><i style="width:100%"></i></div><span>30s</span></div>
    <div class="card-foot">
      ${showTag ? `<a class="tag" href="#/lesson/${lesson.id}">${dot(lesson.id)} ${esc(lesson.title)}</a>` : ""}
      <span class="spacer"></span>
      <span class="muted" style="font-size:.8rem">${pitch.words} words</span>
      <button class="btn small" data-action="rehearse">Rehearse 30s</button>
    </div>
  </article>`;
}

function qaCard(lesson, index, showTag) {
  const key = `${lesson.id}#${index}`;
  const item = lesson.interview[index];
  const mark = marks[key] || "";
  return `<details class="card qa ${mark}" data-key="${key}">
    <summary><span>${esc(item.q)}</span><span class="reveal">show answer</span></summary>
    <div class="answer prose">${item.a}</div>
    <div class="card-foot">
      ${showTag ? `<a class="tag" href="#/lesson/${lesson.id}">${dot(lesson.id)} ${esc(lesson.title)}</a>` : ""}
      <span class="spacer"></span>
      <button class="btn small ${mark === "review" ? "is-warn" : ""}" data-action="mark" data-mark="review">Review again</button>
      <button class="btn small ${mark === "know" ? "is-on" : ""}" data-action="mark" data-mark="know">Got it</button>
    </div>
  </details>`;
}

function glossaryTable(rows, showLesson) {
  return `<div class="table-wrap"><table class="gloss">
    <thead><tr><th>Term</th><th>中文</th><th>Meaning</th>${showLesson ? "<th>Lessons</th>" : ""}</tr></thead>
    <tbody>${rows.map((r) => `<tr>
      <td class="term">${esc(r.term)}</td><td class="zhcol">${esc(r.zh)}</td><td>${esc(r.def)}</td>
      ${showLesson ? `<td class="lessons-col">${r.lessons.map((l) => `<a href="#/lesson/${l.id}">${dot(l.id)}</a>`).join(", ")}</td>` : ""}
    </tr>`).join("")}</tbody>
  </table></div>`;
}

function lessonRow(l) {
  return `<li class="lesson-row">
    <button class="tick ${done.has(l.id) ? "done" : ""}" data-action="done" data-id="${l.id}"
      aria-pressed="${done.has(l.id)}" aria-label="Mark ${dot(l.id)} as done">✓</button>
    <a class="lesson-link" href="#/lesson/${l.id}">
      <span class="num">${dot(l.id)}</span><strong>${esc(l.title)}</strong> <span class="zh">${esc(l.title_zh)}</span>
      <span class="stage">${esc(l.outcome)}</span>
    </a>
    <span class="meta">${minutes(l.minutes)}</span>
  </li>`;
}

/* ---------- views ---------- */

function viewPath() {
  const total = course.lessons.length;
  const finished = course.lessons.filter((l) => done.has(l.id)).length;
  const next = course.lessons.find((l) => !done.has(l.id));
  const hours = Math.round(course.lessons.reduce((s, l) => s + (l.minutes || 0), 0) / 60);
  const counts = ["pitches", "interview", "glossary"].map((k) => course.lessons.reduce((s, l) => s + l[k].length, 0));
  return `<section class="hero">
      <div class="eyebrow">Spec ${esc(course.spec_version)} · Python SDK ${esc(course.sdk)}</div>
      <h1>From “what is MCP?” to shipping agentic systems on it</h1>
      <p class="lead">${total} lessons, about ${hours} hours of focused study. Each lesson digests the official docs and
        specification, then you run a notebook against real MCP servers and rehearse the answers you would give in an interview.</p>
      <div class="stats">
        <span><b>${total}</b> notebooks</span><span><b>${counts[0]}</b> 30-second pitches</span>
        <span><b>${counts[1]}</b> interview questions</span><span><b>${counts[2]}</b> glossary entries</span>
      </div>
      <div class="hero-progress">
        <div class="bar"><i style="width:${(finished / total) * 100}%"></i></div>
        <span>${finished} of ${total} lessons done</span>
        ${next ? `<a class="btn primary" href="#/lesson/${next.id}">${finished ? "Continue" : "Start"}: ${dot(next.id)} ${esc(next.title)}</a>` : ""}
        <a class="btn" href="#/plan">See the 4-week plan</a>
      </div>
      ${lessonOf("1-4") ? `<a class="callout" href="#/lesson/1-4"><b>Quick compare</b>
        <span><strong>MCP vs. Skills vs. Functions</strong> — the three terms everyone mixes up: hands, plugs and a playbook.
        Comparison table, analogy and a 30-second pitch →</span></a>` : ""}
    </section>
    ${course.modules.map((m) => {
      const lessons = course.lessons.filter((l) => l.module === m.n);
      if (!lessons.length) return "";
      const mins = lessons.reduce((s, l) => s + l.minutes, 0);
      return `<section class="module">
        <div class="module-head">
          <div class="module-n">Module ${m.n} · ${minutes(mins)}</div>
          <h2>${esc(m.title)}</h2>
          <div class="zh">${esc(m.title_zh)}</div>
          <p>${esc(m.blurb)}</p>
        </div>
        <ol class="lessons">${lessons.map(lessonRow).join("")}</ol>
      </section>`;
    }).join("")}`;
}

function viewPlan() {
  return `<div class="page-head"><h1>Study plan</h1>
      <p>A four-week agenda (about 8–10 hours a week). The order differs from the official site on purpose: it goes
        <b>concepts → wire protocol → server side → client side → security → ecosystem</b>, so every lesson only uses ideas you already have,
        and you build something runnable each week.</p></div>
    <section class="method">
      <h2>How to work each lesson</h2>
      <ol class="steps">${course.method.map(([t, d], i) => `<li><span class="step-n">${i + 1}</span><b>${esc(t)}</b><p>${esc(d)}</p></li>`).join("")}</ol>
    </section>
    ${course.plan.map((w) => {
      const lessons = w.lessons.map(lessonOf).filter(Boolean);
      const mins = lessons.reduce((s, l) => s + l.minutes, 0);
      const fin = lessons.filter((l) => done.has(l.id)).length;
      return `<section class="module week">
        <div class="module-head">
          <div class="module-n">Week ${w.week} · ${minutes(mins)}</div>
          <h2>${esc(w.title)}</h2>
          <p>${esc(w.goal)}</p>
          <div class="bar" style="margin-top:12px"><i style="width:${lessons.length ? (fin / lessons.length) * 100 : 0}%"></i></div>
          <p class="hint" style="margin-top:6px">${fin} of ${lessons.length} done</p>
        </div>
        <div>
          <ol class="lessons">${lessons.map(lessonRow).join("")}</ol>
          <div class="milestone"><b>Milestone</b>${esc(w.milestone)}</div>
        </div>
      </section>`;
    }).join("")}`;
}

function viewLesson(id) {
  const lesson = lessonOf(id);
  if (!lesson) return `<p class="empty-note">No lesson ${esc(id)}. <a href="#/">Back to the path</a></p>`;
  const index = course.lessons.indexOf(lesson);
  const prev = course.lessons[index - 1];
  const next = course.lessons[index + 1];
  const mod = moduleOf(lesson.module);
  const nbUrl = notebookUrl(lesson);
  let n = 0;
  return `<div class="crumbs"><a href="#/">Path</a> / Module ${mod.n} · ${esc(mod.title)}</div>
    <div class="lesson-title">
      <h1>${dot(lesson.id)} ${esc(lesson.title)}</h1>
      <p class="zh">${esc(lesson.title_zh)} · ${minutes(lesson.minutes)}</p>
    </div>
    <div class="lesson-layout">
    <div class="lesson-main">
      <div class="overview">
        <div class="stage-box"><b>After this lesson you can</b>${esc(lesson.outcome)}</div>
        <div class="prose summary">${lesson.summary}</div>
        <div class="sources"><b>Official reading</b>
          <ul>${lesson.sources.map((s) => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title)}</a></li>`).join("")}</ul>
        </div>
      </div>
    <section class="block" id="lesson">
      <h2>Lesson</h2>
      <div class="prose lesson-body">${lesson.lesson}</div>
    </section>
    <section class="block" id="points">
      <h2>Key points to remember</h2>
      <div class="prose"><ul class="points">${lesson.points.map((p) => `<li>${p.replace(/^<p>|<\/p>$/g, "")}</li>`).join("")}</ul></div>
    </section>
    <section class="block" id="practice">
      <h2>Practice notebook
        ${nbUrl ? `<a class="btn small" href="${nbUrl}" target="_blank" rel="noopener">Open in JupyterLab</a>` : ""}</h2>
      <p class="hint" style="margin-bottom:12px">Preview of <code>notebooks/${esc(lesson.notebook)}</code>. Run it for real in JupyterLab; edits you make there are kept.</p>
      <div class="nb">${lesson.cells.map((c) => c.type === "code"
        ? `<div class="nb-cell code"><span class="gutter">[${++n}]</span><pre><code>${c.html}</code></pre>
             <button class="btn small copy" data-action="copy">Copy</button></div>`
        : `<div class="nb-cell md">${c.html}</div>`).join("")}</div>
    </section>
    <section class="block" id="pitch">
      <h2>30-second pitch</h2>
      <div class="cards two">${lesson.pitches.map((p) => pitchCard(lesson, p, false)).join("")}</div>
    </section>
    <section class="block" id="qa">
      <h2>Interview questions</h2>
      <div class="cards">${lesson.interview.map((_, i) => qaCard(lesson, i, false)).join("")}</div>
    </section>
    <section class="block" id="terms">
      <h2>Glossary</h2>
      ${glossaryTable(lesson.glossary, false)}
    </section>
    <nav class="pager">
      ${prev ? `<a href="#/lesson/${prev.id}"><small>← Previous</small>${dot(prev.id)} ${esc(prev.title)}</a>` : ""}
      ${next ? `<a href="#/lesson/${next.id}"><small>Next →</small>${dot(next.id)} ${esc(next.title)}</a>` : ""}
    </nav>
    </div>
      <aside class="side">
        <div class="actions">
          ${nbUrl
            ? `<a class="btn primary" href="${nbUrl}" target="_blank" rel="noopener">Open the notebook in JupyterLab</a>`
            : `<p class="hint">Start the app with <code>python run.py</code> to open notebooks from here. File: <code>notebooks/${esc(lesson.notebook)}</code></p>`}
          <button class="btn ${done.has(lesson.id) ? "is-on" : ""}" data-action="done" data-id="${lesson.id}" aria-pressed="${done.has(lesson.id)}">
            ${done.has(lesson.id) ? "✓ Done" : "Mark as done"}</button>
        </div>
        <nav class="toc"><b>In this lesson</b>
          <a href="#lesson" data-jump>Lesson</a>
          ${lesson.toc.map((t) => `<a class="sub" href="#${slug(t)}" data-jump>${esc(t)}</a>`).join("")}
          <a href="#points" data-jump>Key points</a>
          <a href="#practice" data-jump>Practice notebook</a>
          <a href="#pitch" data-jump>30-second pitch</a>
          <a href="#qa" data-jump>Interview Q&amp;A</a>
          <a href="#terms" data-jump>Glossary</a>
        </nav>
      </aside>
    </div>`;
}

function viewGlossary() {
  const f = filters.glossary;
  const q = f.q.trim().toLowerCase();
  // A term several lessons define appears once, with its first definition and every lesson linked.
  const merged = new Map();
  course.lessons
    .filter((l) => !f.module || String(l.module) === f.module)
    .forEach((l) => l.glossary.forEach((g) => {
      const key = g.term.toLowerCase();
      if (merged.has(key)) merged.get(key).lessons.push(l);
      else merged.set(key, { ...g, lessons: [l] });
    }));
  const rows = [...merged.values()]
    .filter((r) => !q || `${r.term} ${r.zh} ${r.def}`.toLowerCase().includes(q))
    .sort((a, b) => a.term.localeCompare(b.term, "en", { sensitivity: "base" }));
  return `<div class="page-head"><h1>Glossary <span class="zh">术语表</span></h1>
      <p>Every term the course introduces, in English and Chinese, with the lessons where it matters.</p></div>
    <div class="controls">
      <input type="search" data-filter="q" placeholder="Search terms, 中文 or meanings…" value="${esc(f.q)}" aria-label="Search glossary">
      ${moduleSelect(f.module)}
      <span class="count">${rows.length} terms</span>
    </div>
    <div id="results">${rows.length ? glossaryTable(rows, true) : `<p class="empty-note">Nothing matches “${esc(f.q)}”.</p>`}</div>`;
}

function viewPitches() {
  const f = filters.pitches;
  const lessons = course.lessons.filter((l) => !f.module || String(l.module) === f.module);
  const count = lessons.reduce((s, l) => s + l.pitches.length, 0);
  return `<div class="page-head"><h1>30-second pitches</h1>
      <p>One spoken answer per key idea — the elevator version of what an interviewer most often asks. Hit <b>Rehearse</b>:
        the text blurs, you get 30 seconds to say it out loud, then compare.</p></div>
    <div class="controls">${moduleSelect(f.module)}<span class="count">${count} pitches</span></div>
    <div class="cards two">${lessons.flatMap((l) => l.pitches.map((p) => pitchCard(l, p, true))).join("")}</div>`;
}

function viewInterview() {
  const f = filters.interview;
  let items = course.lessons
    .filter((l) => !f.module || String(l.module) === f.module)
    .flatMap((l) => l.interview.map((_, i) => ({ lesson: l, i, key: `${l.id}#${i}` })));
  const all = items.length;
  const known = items.filter((x) => marks[x.key] === "know").length;
  if (f.status === "review") items = items.filter((x) => marks[x.key] === "review");
  if (f.status === "open") items = items.filter((x) => marks[x.key] !== "know");
  if (f.order) items.sort((a, b) => f.order[a.key] - f.order[b.key]);
  return `<div class="page-head"><h1>Interview Q&amp;A</h1>
      <p>Answer out loud first, then open the card. Mark each one so you can come back to the shaky ones.</p></div>
    <div class="controls">
      ${moduleSelect(f.module)}
      <select data-filter="status" aria-label="Status">
        <option value="">All questions</option>
        <option value="open" ${f.status === "open" ? "selected" : ""}>Not yet “Got it”</option>
        <option value="review" ${f.status === "review" ? "selected" : ""}>Marked “Review again”</option>
      </select>
      <button class="btn ${f.order ? "is-on" : ""}" data-action="shuffle">${f.order ? "Shuffled — reshuffle" : "Shuffle"}</button>
      ${f.order ? `<button class="btn" data-action="unshuffle">Course order</button>` : ""}
      <span class="count">${known} of ${all} marked “Got it”</span>
    </div>
    <div class="cards">${items.map((x) => qaCard(x.lesson, x.i, true)).join("") || `<p class="empty-note">Nothing left in this filter.</p>`}</div>`;
}

/* ---------- router ---------- */

function route() {
  const [name = "", arg] = location.hash.replace(/^#\/?/, "").split("/");
  return { name, arg };
}

function render(keepScroll) {
  timers.forEach(clearInterval);
  timers = [];
  const { name, arg } = route();
  const views = { "": viewPath, plan: viewPlan, lesson: () => viewLesson(arg), glossary: viewGlossary, pitches: viewPitches, interview: viewInterview };
  app.innerHTML = (views[name] || viewPath)();
  // ### headings inside the lesson body get ids so the table of contents can jump to them
  app.querySelectorAll(".lesson-body h3").forEach((h) => (h.id = slug(h.textContent)));
  document.querySelectorAll("#nav a").forEach((a) => a.classList.toggle("on", a.dataset.route === (name === "lesson" ? "" : name)));
  const lesson = name === "lesson" && lessonOf(arg);
  document.title = lesson ? `${dot(lesson.id)} ${lesson.title} · MCP Mastery` : "MCP Mastery · study & interview prep";
  if (!keepScroll) window.scrollTo(0, 0);
}

/* ---------- interactions ---------- */

function rehearse(card, button) {
  if (card.classList.contains("rehearsing")) {
    clearInterval(card._timer);
    card.classList.remove("rehearsing");
    button.textContent = "Rehearse 30s";
    return;
  }
  const fill = card.querySelector(".timer i");
  const label = card.querySelector(".timer span");
  const end = Date.now() + 30000;
  card.classList.remove("timed-out");
  card.classList.add("rehearsing");
  button.textContent = "Show text";
  const tick = () => {
    const left = Math.max(0, end - Date.now());
    fill.style.width = `${(left / 30000) * 100}%`;
    label.textContent = `${Math.ceil(left / 1000)}s`;
    if (!left) {
      clearInterval(card._timer);
      card.classList.remove("rehearsing");
      card.classList.add("timed-out");
      label.textContent = "Time — compare";
      button.textContent = "Rehearse again";
    }
  };
  tick();
  card._timer = setInterval(tick, 200);
  timers.push(card._timer);
}

app.addEventListener("click", (event) => {
  const jump = event.target.closest("[data-jump]");
  if (jump) {
    event.preventDefault(); // keep the #/lesson/x route in the address bar
    document.querySelector(jump.getAttribute("href"))?.scrollIntoView();
    return;
  }
  const el = event.target.closest("[data-action]");
  if (!el) return;
  const action = el.dataset.action;
  if (action === "done") {
    done.has(el.dataset.id) ? done.delete(el.dataset.id) : done.add(el.dataset.id);
    store.set("mcp.done", [...done]);
    render(true);
  } else if (action === "mark") {
    const card = el.closest(".qa");
    const key = card.dataset.key;
    if (marks[key] === el.dataset.mark) delete marks[key]; else marks[key] = el.dataset.mark;
    store.set("mcp.marks", marks);
    card.classList.remove("know", "review");
    if (marks[key]) card.classList.add(marks[key]);
    card.querySelectorAll("[data-action=mark]").forEach((b) => {
      b.classList.toggle("is-on", b.dataset.mark === "know" && marks[key] === "know");
      b.classList.toggle("is-warn", b.dataset.mark === "review" && marks[key] === "review");
    });
  } else if (action === "rehearse") {
    rehearse(el.closest(".pitch"), el);
  } else if (action === "copy") {
    navigator.clipboard?.writeText(el.parentElement.querySelector("pre").textContent).then(() => {
      el.textContent = "Copied";
      setTimeout(() => (el.textContent = "Copy"), 1200);
    });
  } else if (action === "shuffle") {
    const order = {};
    course.lessons.forEach((l) => l.interview.forEach((_, i) => (order[`${l.id}#${i}`] = Math.random())));
    filters.interview.order = order;
    render(true);
  } else if (action === "unshuffle") {
    filters.interview.order = null;
    render(true);
  }
});

function onFilter(event) {
  const el = event.target.closest("[data-filter]");
  if (!el) return;
  const { name } = route();
  if (!filters[name]) return;
  filters[name][el.dataset.filter] = el.value;
  render(true);
  if (el.type === "search") { // re-rendering replaced the input; give the caret back
    const input = app.querySelector("[data-filter=q]");
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }
}
app.addEventListener("input", onFilter);

window.addEventListener("hashchange", () => render(false));

Promise.all([
  fetch("data/course.json").then((r) => r.json()),
  fetch("/api/config").then((r) => r.json()).catch(() => ({})),
]).then(([data, config]) => {
  course = data;
  jupyter = config.jupyter || null;
  render(false);
}).catch(() => {
  app.innerHTML = `<p class="empty-note">Could not load <code>data/course.json</code>. Run <code>python build.py</code>, then start the app with <code>python run.py</code>.</p>`;
});
