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

let raw = null;    // course.json as loaded, both languages
let course = null; // the same course, in the current language
let jupyter = null;
let lang = store.get("mcp.lang", "en") === "zh" ? "zh" : "en";
const done = new Set(store.get("mcp.done", []));
const marks = store.get("mcp.marks", {}); // "5-3#0" -> "know" | "review"
const filters = { glossary: { q: "", module: "" }, pitches: { module: "" }, interview: { module: "", status: "", order: null } };
let timers = [];

const t = (en, zh) => (lang === "zh" ? zh : en);
const dot = (id) => id.replace("-", ".");
const minutes = (m) => lang === "zh"
  ? (m >= 60 ? `${Math.floor(m / 60)} 小时${m % 60 ? ` ${m % 60} 分钟` : ""}` : `${m} 分钟`)
  : (m >= 60 ? `${Math.floor(m / 60)} h ${m % 60 ? `${m % 60} min` : ""}` : `${m} min`).trim();
const moduleOf = (n) => course.modules.find((m) => m.n === n);
const lessonOf = (id) => course.lessons.find((l) => l.id === id);

// `title_alt` is the title in the other language, shown underneath the main one.
function localize(data) {
  const zh = lang === "zh";
  return {
    ...data,
    modules: data.modules.map((m) => zh
      ? { ...m, title: m.title_zh, title_alt: m.title, blurb: m.blurb_zh || m.blurb }
      : { ...m, title_alt: m.title_zh }),
    lessons: data.lessons.map((l) => zh && l.zh
      ? { ...l, ...l.zh, title_alt: l.title }
      : { ...l, title_alt: l.title_zh }),
    plan: data.plan.map((w, i) => (zh && data.plan_zh ? { ...w, ...data.plan_zh[i] } : w)),
    method: zh && data.method_zh ? data.method_zh : data.method,
  };
}

function notebookUrl(lesson) {
  const path = lesson.notebook.split("/").map(encodeURIComponent).join("/");
  return jupyter ? `${jupyter.url}/lab/tree/${path}?token=${jupyter.token}` : null;
}

function moduleSelect(value) {
  return `<select data-filter="module" aria-label="${t("Module", "模块")}">
    <option value="">${t("All modules", "全部模块")}</option>
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
      <span class="muted" style="font-size:.8rem">${t(`${pitch.words} words`, `${pitch.words} 字`)}</span>
      <button class="btn small" data-action="rehearse">${t("Rehearse 30s", "演练 30 秒")}</button>
    </div>
  </article>`;
}

function qaCard(lesson, index, showTag) {
  const key = `${lesson.id}#${index}`;
  const item = lesson.interview[index];
  const mark = marks[key] || "";
  return `<details class="card qa ${mark}" data-key="${key}">
    <summary><span>${esc(item.q)}</span><span class="reveal">${t("show answer", "查看答案")}</span></summary>
    <div class="answer prose">${item.a}</div>
    <div class="card-foot">
      ${showTag ? `<a class="tag" href="#/lesson/${lesson.id}">${dot(lesson.id)} ${esc(lesson.title)}</a>` : ""}
      <span class="spacer"></span>
      <button class="btn small ${mark === "review" ? "is-warn" : ""}" data-action="mark" data-mark="review">${t("Review again", "再复习")}</button>
      <button class="btn small ${mark === "know" ? "is-on" : ""}" data-action="mark" data-mark="know">${t("Got it", "掌握了")}</button>
    </div>
  </details>`;
}

function glossaryTable(rows, showLesson) {
  return `<div class="table-wrap"><table class="gloss">
    <thead><tr><th>${t("Term", "术语")}</th><th>中文</th><th>${t("Meaning", "释义")}</th>${showLesson ? `<th>${t("Lessons", "课程")}</th>` : ""}</tr></thead>
    <tbody>${rows.map((r) => `<tr>
      <td class="term">${esc(r.term)}</td><td class="zhcol">${esc(r.zh)}</td><td>${esc(r.def)}</td>
      ${showLesson ? `<td class="lessons-col">${r.lessons.map((l) => `<a href="#/lesson/${l.id}">${dot(l.id)}</a>`).join(", ")}</td>` : ""}
    </tr>`).join("")}</tbody>
  </table></div>`;
}

function lessonRow(l) {
  return `<li class="lesson-row">
    <button class="tick ${done.has(l.id) ? "done" : ""}" data-action="done" data-id="${l.id}"
      aria-pressed="${done.has(l.id)}" aria-label="${t(`Mark ${dot(l.id)} as done`, `将 ${dot(l.id)} 标记为已完成`)}">✓</button>
    <a class="lesson-link" href="#/lesson/${l.id}">
      <span class="num">${dot(l.id)}</span><strong>${esc(l.title)}</strong> <span class="zh">${esc(l.title_alt)}</span>
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
      <div class="eyebrow">${t("Spec", "规范版本")} ${esc(course.spec_version)} · Python SDK ${esc(course.sdk)}</div>
      <h1>${t("From “what is MCP?” to shipping agentic systems on it", "从“MCP 是什么？”到在 MCP 上交付智能体系统")}</h1>
      <p class="lead">${t(`${total} lessons, about ${hours} hours of focused study. Each lesson digests the official docs and
        specification, then you run a notebook against real MCP servers and rehearse the answers you would give in an interview.`,
        `共 ${total} 课，约 ${hours} 小时的专注学习。每课先精读官方文档与规范（Specification），
        再用笔记本对真实的 MCP 服务器动手实践，最后演练面试中会给出的回答。`)}</p>
      <div class="stats">
        <span><b>${total}</b> ${t("notebooks", "个笔记本")}</span><span><b>${counts[0]}</b> ${t("30-second pitches", "段 30 秒电梯演讲")}</span>
        <span><b>${counts[1]}</b> ${t("interview questions", "道面试题")}</span><span><b>${counts[2]}</b> ${t("glossary entries", "个术语")}</span>
      </div>
      <div class="hero-progress">
        <div class="bar"><i style="width:${(finished / total) * 100}%"></i></div>
        <span>${t(`${finished} of ${total} lessons done`, `已完成 ${finished} / ${total} 课`)}</span>
        ${next ? `<a class="btn primary" href="#/lesson/${next.id}">${finished ? t("Continue", "继续") : t("Start", "开始")}${t(":", "：")} ${dot(next.id)} ${esc(next.title)}</a>` : ""}
        <a class="btn" href="#/plan">${t("See the 4-week plan", "查看 4 周学习计划")}</a>
      </div>
      ${lessonOf("1-4") ? `<a class="callout" href="#/lesson/1-4"><b>${t("Quick compare", "快速对比")}</b>
        <span>${t(`<strong>MCP vs. Skills vs. Functions</strong> — the three terms everyone mixes up: hands, plugs and a playbook.
        Comparison table, analogy and a 30-second pitch →`,
        `<strong>MCP、技能（Skills）与函数（Functions）</strong>——人人都会混淆的三个概念：双手、插头与剧本。
        对比表、类比和一段 30 秒电梯演讲 →`)}</span></a>` : ""}
    </section>
    ${course.modules.map((m) => {
      const lessons = course.lessons.filter((l) => l.module === m.n);
      if (!lessons.length) return "";
      const mins = lessons.reduce((s, l) => s + l.minutes, 0);
      return `<section class="module">
        <div class="module-head">
          <div class="module-n">${t(`Module ${m.n}`, `模块 ${m.n}`)} · ${minutes(mins)}</div>
          <h2>${esc(m.title)}</h2>
          <div class="zh">${esc(m.title_alt)}</div>
          <p>${esc(m.blurb)}</p>
        </div>
        <ol class="lessons">${lessons.map(lessonRow).join("")}</ol>
      </section>`;
    }).join("")}`;
}

function viewPlan() {
  return `<div class="page-head"><h1>${t("Study plan", "学习计划")}</h1>
      <p>${t(`A four-week agenda (about 8–10 hours a week). The order differs from the official site on purpose: it goes
        <b>concepts → wire protocol → server side → client side → security → ecosystem</b>, so every lesson only uses ideas you already have,
        and you build something runnable each week.`,
        `为期四周的安排（每周约 8–10 小时）。顺序刻意与官网不同：
        <b>概念 → 协议底层 → 服务器端 → 客户端 → 安全 → 生态</b>，这样每课只用到你已经掌握的知识，
        而且每周都能做出可以运行的成果。`)}</p></div>
    <section class="method">
      <h2>${t("How to work each lesson", "每课的学习方法")}</h2>
      <ol class="steps">${course.method.map(([title, d], i) => `<li><span class="step-n">${i + 1}</span><b>${esc(title)}</b><p>${esc(d)}</p></li>`).join("")}</ol>
    </section>
    ${course.plan.map((w) => {
      const lessons = w.lessons.map(lessonOf).filter(Boolean);
      const mins = lessons.reduce((s, l) => s + l.minutes, 0);
      const fin = lessons.filter((l) => done.has(l.id)).length;
      return `<section class="module week">
        <div class="module-head">
          <div class="module-n">${t(`Week ${w.week}`, `第 ${w.week} 周`)} · ${minutes(mins)}</div>
          <h2>${esc(w.title)}</h2>
          <p>${esc(w.goal)}</p>
          <div class="bar" style="margin-top:12px"><i style="width:${lessons.length ? (fin / lessons.length) * 100 : 0}%"></i></div>
          <p class="hint" style="margin-top:6px">${t(`${fin} of ${lessons.length} done`, `已完成 ${fin} / ${lessons.length}`)}</p>
        </div>
        <div>
          <ol class="lessons">${lessons.map(lessonRow).join("")}</ol>
          <div class="milestone"><b>${t("Milestone", "里程碑")}</b>${esc(w.milestone)}</div>
        </div>
      </section>`;
    }).join("")}`;
}

function viewLesson(id) {
  const lesson = lessonOf(id);
  if (!lesson) return `<p class="empty-note">${t(`No lesson ${esc(id)}.`, `没有第 ${esc(id)} 课。`)} <a href="#/">${t("Back to the path", "返回学习路径")}</a></p>`;
  const index = course.lessons.indexOf(lesson);
  const prev = course.lessons[index - 1];
  const next = course.lessons[index + 1];
  const mod = moduleOf(lesson.module);
  const nbUrl = notebookUrl(lesson);
  const untranslated = lang === "zh" && !lesson.zh;
  let n = 0;
  return `<div class="crumbs"><a href="#/">${t("Path", "学习路径")}</a> / ${t(`Module ${mod.n}`, `模块 ${mod.n}`)} · ${esc(mod.title)}</div>
    <div class="lesson-title">
      <h1>${dot(lesson.id)} ${esc(lesson.title)}</h1>
      <p class="zh">${esc(lesson.title_alt)} · ${minutes(lesson.minutes)}</p>
    </div>
    ${untranslated ? `<p class="hint" style="margin-bottom:12px">本课尚无中文译文，以下显示英文原文。</p>` : ""}
    <div class="lesson-layout">
    <div class="lesson-main">
      <div class="overview">
        <div class="stage-box"><b>${t("After this lesson you can", "学完本课你能")}</b>${esc(lesson.outcome)}</div>
        <div class="prose summary">${lesson.summary}</div>
        <div class="sources"><b>${t("Official reading", "官方阅读材料")}</b>
          <ul>${lesson.sources.map((s) => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title)}</a></li>`).join("")}</ul>
        </div>
      </div>
    <section class="block" id="lesson">
      <h2>${t("Lesson", "课程精要")}</h2>
      <div class="prose lesson-body">${lesson.lesson}</div>
    </section>
    <section class="block" id="points">
      <h2>${t("Key points to remember", "要点回顾")}</h2>
      <div class="prose"><ul class="points">${lesson.points.map((p) => `<li>${p.replace(/^<p>|<\/p>$/g, "")}</li>`).join("")}</ul></div>
    </section>
    <section class="block" id="practice">
      <h2>${t("Practice notebook", "练习笔记本")}
        ${nbUrl ? `<a class="btn small" href="${nbUrl}" target="_blank" rel="noopener">${t("Open in JupyterLab", "在 JupyterLab 中打开")}</a>` : ""}</h2>
      <p class="hint" style="margin-bottom:12px">${t(`Preview of <code>notebooks/${esc(lesson.notebook)}</code>. Run it for real in JupyterLab; edits you make there are kept.`,
        `<code>notebooks/${esc(lesson.notebook)}</code> 的预览。请在 JupyterLab 中实际运行；你在那里做的修改会被保留。`)}</p>
      <div class="nb">${lesson.cells.map((c) => c.type === "code"
        ? `<div class="nb-cell code"><span class="gutter">[${++n}]</span><pre><code>${c.html}</code></pre>
             <button class="btn small copy" data-action="copy">${t("Copy", "复制")}</button></div>`
        : `<div class="nb-cell md">${c.html}</div>`).join("")}</div>
    </section>
    <section class="block" id="pitch">
      <h2>${t("30-second pitch", "30 秒电梯演讲")}</h2>
      <div class="cards two">${lesson.pitches.map((p) => pitchCard(lesson, p, false)).join("")}</div>
    </section>
    <section class="block" id="qa">
      <h2>${t("Interview questions", "面试题")}</h2>
      <div class="cards">${lesson.interview.map((_, i) => qaCard(lesson, i, false)).join("")}</div>
    </section>
    <section class="block" id="terms">
      <h2>${t("Glossary", "术语表")}</h2>
      ${glossaryTable(lesson.glossary, false)}
    </section>
    <nav class="pager">
      ${prev ? `<a href="#/lesson/${prev.id}"><small>${t("← Previous", "← 上一课")}</small>${dot(prev.id)} ${esc(prev.title)}</a>` : ""}
      ${next ? `<a href="#/lesson/${next.id}"><small>${t("Next →", "下一课 →")}</small>${dot(next.id)} ${esc(next.title)}</a>` : ""}
    </nav>
    </div>
      <aside class="side">
        <div class="actions">
          ${nbUrl
            ? `<a class="btn primary" href="${nbUrl}" target="_blank" rel="noopener">${t("Open the notebook in JupyterLab", "在 JupyterLab 中打开笔记本")}</a>`
            : `<p class="hint">${t(`Start the app with <code>python run.py</code> to open notebooks from here. File: <code>notebooks/${esc(lesson.notebook)}</code>`,
                `用 <code>python run.py</code> 启动应用后即可从这里打开笔记本。文件：<code>notebooks/${esc(lesson.notebook)}</code>`)}</p>`}
          <button class="btn ${done.has(lesson.id) ? "is-on" : ""}" data-action="done" data-id="${lesson.id}" aria-pressed="${done.has(lesson.id)}">
            ${done.has(lesson.id) ? t("✓ Done", "✓ 已完成") : t("Mark as done", "标记为已完成")}</button>
        </div>
        <nav class="toc"><b>${t("In this lesson", "本课目录")}</b>
          <a href="#lesson" data-jump>${t("Lesson", "课程精要")}</a>
          ${lesson.toc.map((title, i) => `<a class="sub" href="#s-${i}" data-jump>${esc(title)}</a>`).join("")}
          <a href="#points" data-jump>${t("Key points", "要点回顾")}</a>
          <a href="#practice" data-jump>${t("Practice notebook", "练习笔记本")}</a>
          <a href="#pitch" data-jump>${t("30-second pitch", "30 秒电梯演讲")}</a>
          <a href="#qa" data-jump>${t("Interview Q&amp;A", "面试问答")}</a>
          <a href="#terms" data-jump>${t("Glossary", "术语表")}</a>
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
  return `<div class="page-head"><h1>${t(`Glossary <span class="zh">术语表</span>`, `术语表 <span class="zh">Glossary</span>`)}</h1>
      <p>${t("Every term the course introduces, in English and Chinese, with the lessons where it matters.",
        "课程中出现的所有术语，中英对照，并附上相关课程。")}</p></div>
    <div class="controls">
      <input type="search" data-filter="q" placeholder="${t("Search terms, 中文 or meanings…", "搜索术语、English 或释义…")}" value="${esc(f.q)}" aria-label="${t("Search glossary", "搜索术语表")}">
      ${moduleSelect(f.module)}
      <span class="count">${t(`${rows.length} terms`, `${rows.length} 个术语`)}</span>
    </div>
    <div id="results">${rows.length ? glossaryTable(rows, true) : `<p class="empty-note">${t(`Nothing matches “${esc(f.q)}”.`, `没有与“${esc(f.q)}”匹配的结果。`)}</p>`}</div>`;
}

function viewPitches() {
  const f = filters.pitches;
  const lessons = course.lessons.filter((l) => !f.module || String(l.module) === f.module);
  const count = lessons.reduce((s, l) => s + l.pitches.length, 0);
  return `<div class="page-head"><h1>${t("30-second pitches", "30 秒电梯演讲")}</h1>
      <p>${t(`One spoken answer per key idea — the elevator version of what an interviewer most often asks. Hit <b>Rehearse</b>:
        the text blurs, you get 30 seconds to say it out loud, then compare.`,
        `每个核心概念一段口头回答——面试官最常问的问题的电梯演讲版本。点击<b>演练</b>：
        文字会被模糊，你有 30 秒把它大声说出来，然后再对照原文。`)}</p></div>
    <div class="controls">${moduleSelect(f.module)}<span class="count">${t(`${count} pitches`, `${count} 段演讲`)}</span></div>
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
  return `<div class="page-head"><h1>${t("Interview Q&amp;A", "面试问答")}</h1>
      <p>${t("Answer out loud first, then open the card. Mark each one so you can come back to the shaky ones.",
        "先大声作答，再翻开卡片。给每张卡片做标记，方便回头复习没把握的题。")}</p></div>
    <div class="controls">
      ${moduleSelect(f.module)}
      <select data-filter="status" aria-label="${t("Status", "状态")}">
        <option value="">${t("All questions", "全部题目")}</option>
        <option value="open" ${f.status === "open" ? "selected" : ""}>${t("Not yet “Got it”", "尚未“掌握了”")}</option>
        <option value="review" ${f.status === "review" ? "selected" : ""}>${t("Marked “Review again”", "标记为“再复习”")}</option>
      </select>
      <button class="btn ${f.order ? "is-on" : ""}" data-action="shuffle">${f.order ? t("Shuffled — reshuffle", "已打乱——再打乱一次") : t("Shuffle", "打乱顺序")}</button>
      ${f.order ? `<button class="btn" data-action="unshuffle">${t("Course order", "按课程顺序")}</button>` : ""}
      <span class="count">${t(`${known} of ${all} marked “Got it”`, `${known} / ${all} 题已标记“掌握了”`)}</span>
    </div>
    <div class="cards">${items.map((x) => qaCard(x.lesson, x.i, true)).join("") || `<p class="empty-note">${t("Nothing left in this filter.", "当前筛选条件下没有题目了。")}</p>`}</div>`;
}

/* ---------- chrome: header, footer, language ---------- */

const NAV = {
  "": ["Path", "学习路径"],
  plan: ["Study plan", "学习计划"],
  glossary: ["Glossary", "术语表"],
  pitches: ["30-second pitches", "30 秒电梯演讲"],
  interview: ["Interview Q&A", "面试问答"],
};

function renderChrome() {
  document.documentElement.lang = t("en", "zh-CN");
  document.querySelectorAll("#nav a").forEach((a) => (a.textContent = t(...NAV[a.dataset.route])));
  document.querySelector(".brand").innerHTML = `<span class="brand-mark">MCP</span> ${t(
    `MCP Mastery <span class="zh">MCP 精通之路</span>`, `MCP 精通之路 <span class="zh">MCP Mastery</span>`)}`;
  const toggle = document.getElementById("lang");
  toggle.querySelectorAll("[data-lang]").forEach((s) => s.classList.toggle("on", s.dataset.lang === lang));
  toggle.setAttribute("aria-label", t("Switch to Chinese", "切换到英文"));
  document.querySelector(".foot").innerHTML = t(
    `Built from the official documentation at <a href="https://modelcontextprotocol.io/docs/2026-07-28/getting-started/intro" target="_blank" rel="noopener">modelcontextprotocol.io</a>
    (specification revision 2026-07-28). Digests, notebooks and interview material are study aids, not official MCP material —
    the specification is the source of truth.`,
    `根据 <a href="https://modelcontextprotocol.io/docs/2026-07-28/getting-started/intro" target="_blank" rel="noopener">modelcontextprotocol.io</a>
    上的官方文档编写（规范版本 2026-07-28）。精要、笔记本和面试材料均为学习辅助，并非 MCP 官方资料——
    一切以规范为准。中文版由英文版翻译而来。`);
}

document.getElementById("lang").addEventListener("click", () => {
  lang = lang === "zh" ? "en" : "zh";
  store.set("mcp.lang", lang);
  if (raw) course = localize(raw);
  renderChrome();
  if (course) render(true);
});

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
  app.querySelectorAll(".lesson-body h3").forEach((h, i) => (h.id = `s-${i}`));
  document.querySelectorAll("#nav a").forEach((a) => a.classList.toggle("on", a.dataset.route === (name === "lesson" ? "" : name)));
  const lesson = name === "lesson" && lessonOf(arg);
  const site = t("MCP Mastery", "MCP 精通之路");
  document.title = lesson ? `${dot(lesson.id)} ${lesson.title} · ${site}` : `${site} · ${t("study & interview prep", "学习与面试准备")}`;
  if (!keepScroll) window.scrollTo(0, 0);
}

/* ---------- interactions ---------- */

function rehearse(card, button) {
  if (card.classList.contains("rehearsing")) {
    clearInterval(card._timer);
    card.classList.remove("rehearsing");
    button.textContent = t("Rehearse 30s", "演练 30 秒");
    return;
  }
  const fill = card.querySelector(".timer i");
  const label = card.querySelector(".timer span");
  const end = Date.now() + 30000;
  card.classList.remove("timed-out");
  card.classList.add("rehearsing");
  button.textContent = t("Show text", "显示原文");
  const tick = () => {
    const left = Math.max(0, end - Date.now());
    fill.style.width = `${(left / 30000) * 100}%`;
    label.textContent = `${Math.ceil(left / 1000)}s`;
    if (!left) {
      clearInterval(card._timer);
      card.classList.remove("rehearsing");
      card.classList.add("timed-out");
      label.textContent = t("Time — compare", "时间到——对照原文");
      button.textContent = t("Rehearse again", "再演练一次");
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
      el.textContent = t("Copied", "已复制");
      setTimeout(() => (el.textContent = t("Copy", "复制")), 1200);
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

renderChrome();
app.innerHTML = `<p class="loading">${t("Loading the course…", "正在加载课程…")}</p>`;
Promise.all([
  fetch("data/course.json").then((r) => r.json()),
  fetch("/api/config").then((r) => r.json()).catch(() => ({})),
]).then(([data, config]) => {
  raw = data;
  course = localize(raw);
  jupyter = config.jupyter || null;
  render(false);
}).catch(() => {
  app.innerHTML = t(
    `<p class="empty-note">Could not load <code>data/course.json</code>. Run <code>python build.py</code>, then start the app with <code>python run.py</code>.</p>`,
    `<p class="empty-note">无法加载 <code>data/course.json</code>。请先运行 <code>python build.py</code>，再用 <code>python run.py</code> 启动应用。</p>`);
});
