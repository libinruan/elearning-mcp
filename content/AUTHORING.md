# Authoring guide for lessons

Every lesson is one file, `content/lessons/X-Y.md`. `build.py` parses it into the website data and a
Jupyter notebook. Use `content/lessons/1-1.md` as the reference for tone, depth and format.

## File format (sections in exactly this order; all required)

```
---
title_en: Short English title
outcome: One sentence: what the learner can DO after this lesson (shown on the path page).
---
## Summary
One paragraph (80–140 words) that tells the story of the lesson.

## Lesson
The full digest of the official pages for this lesson. Use `### ` subheadings (they become the
table of contents), tables, fenced code (```json, ```python, ```http, ```text for ASCII diagrams),
and > blockquotes for "Spec rule" / "Pitfall" callouts. 1,200–2,500 words. Must be faithful to the
2026-07-28 docs: cite exact method names, field names, MUST/SHOULD rules, error codes. Explain WHY,
not just WHAT. Where the spec changed in 2026-07-28 vs 2025-11-25, say so explicitly (interviewers
and existing codebases still use the old model).

## Key points
- 6–9 bullets, each a crisp, memorisable fact.

## Pitches
### Question-like topic an interviewer would ask
A 30-second spoken answer: 65–90 words, first person where natural, no lists, no code.
(2–3 pitches per lesson.)

## Interview
### The question
A model answer (60–200 words, markdown allowed). 4–6 questions per lesson, mixing conceptual,
practical ("how would you…"), and tricky/gotcha questions.

## Glossary
- Term | 中文翻译 | One-sentence definition.
(5–10 entries. Use standard Chinese technical translations; keep well-known English
identifiers like `tools/call` in English in the Chinese column if there is no translation,
e.g. `server/discover（服务器发现）`.)

## Notebook
### 1. Section title
Markdown explanation, then ```python cells. Ends with a `### Your turn` section of 2–4 exercises.
```

## Notebook rules

- The notebook must run top to bottom with **no network access beyond 127.0.0.1** and no API key,
  in under ~60 s total. `python build.py --check X-Y` executes it in a temp dir and must print `ok`.
- Top-level `await` works (ipykernel). Prefer `async with Client(server) as client:` directly in cells.
- Never write files outside `tempfile.mkdtemp()` / `tempfile.TemporaryDirectory()`.
- Cells that call Claude must be guarded: `if os.environ.get("ANTHROPIC_API_KEY"): ... else: print("skipped …")`
  and always have an offline fallback (e.g. a deterministic scripted "fake LLM" policy) so the lesson still teaches.
  Model id: `claude-opus-5-5`. Manual loop shape: `client.messages.create(model=..., max_tokens=16000, tools=[{name, description, input_schema}], messages=...)`,
  loop while `response.stop_reason == "tool_use"`, append `{"role": "assistant", "content": response.content}`,
  then one user message with all `{"type": "tool_result", "tool_use_id": ..., "content": ..., "is_error": ...}` blocks.
  Do not use forced `tool_choice` (`any`/`tool` 400s on this model). Don't pass `thinking` or `temperature`.
- Print things in a readable way (`json.dumps(x, indent=2)` or a small `show()` helper). Keep each notebook
  self-contained (define helpers in it; no shared module).
- Silence noisy loggers at the top when using HTTP: `logging.getLogger("httpx").setLevel(logging.WARNING)` and `"httpx2"` (the SDK's vendored client),
  same for `"mcp"` / `"uvicorn"` if needed.
- Teach by doing: build → observe raw wire messages → break it → fix it. Each notebook should show at least
  one raw JSON message on the wire when relevant.

## Verified facts about the Python SDK `mcp==2.3.0` (installed in `.venv`)

The SDK implements spec 2026-07-28 (stateless, no initialize) and still speaks the 2025 "handshake era".
Source is at `.venv/lib/python3.12/site-packages/mcp/` — **read it when unsure; never guess an API.**

```python
from mcp import Client, StdioServerParameters          # high-level client
from mcp.server import MCPServer                        # high-level server (replaces v1 FastMCP)
from mcp.server.mcpserver import Context                # tool context: ctx.report_progress, ctx.elicit, ctx.log/info, ...
import mcp_types as types                                # all protocol types (pydantic); e.g. types.TextContent

mcp = MCPServer("demo")

@mcp.tool()
def add(a: int, b: int) -> int:
    """Add two numbers."""          # docstring -> description; type hints -> inputSchema AND outputSchema
    return a + b

@mcp.resource("notes://{name}")      # template (has {param}) -> resources/templates/list
def note(name: str) -> str: ...
@mcp.resource("config://app")        # static -> resources/list
def cfg() -> str: ...
@mcp.prompt()
def review(code: str) -> str: ...

async with Client(mcp) as c:                     # in-process, modern era, no JSON-RPC framing
    (await c.list_tools()).tools[0].input_schema  # snake_case attributes on pydantic models
    r = await c.call_tool("add", {"a": 2, "b": 3}) # r.content[0].text == "5", r.structured_content == {"result": 5}, r.is_error
    await c.list_resources(); await c.list_resource_templates(); await c.read_resource("notes://hi")
    await c.get_prompt("review", {"code": "x=1"}); await c.complete(...)
    c.protocol_version, c.server_info, c.server_capabilities
# dump a result exactly as on the wire:
r.model_dump(by_alias=True, exclude_none=True, mode="json")
```

- `Client(server)` accepts: an `MCPServer`/`Server` (in-process), a URL string (Streamable HTTP),
  `StdioServerParameters(command=sys.executable, args=[path])` (subprocess), or a `Transport`.
  `mode="auto"` (default) probes `server/discover` then falls back to legacy `initialize`; `mode="legacy"` forces the old handshake.
  Other kwargs: `elicitation_callback`, `sampling_callback`, `list_roots_callback`, `logging_callback`, `log_level`,
  `message_handler`, `client_info`, `read_timeout_seconds`, `cache` (CacheConfig, honours ttlMs), `extensions`, `input_required_max_rounds`.
- Results carry `resultType: "complete"`, list/read results carry `ttlMs` + `cacheScope`, and every result's `_meta`
  has `io.modelcontextprotocol/serverInfo`.
- A tool that raises returns `isError: true` (it does not raise in the client). Only
  `mcp.server.mcpserver.exceptions.ToolError` passes its message through; any other exception is masked as
  "Error executing tool X". Raise `ToolError("actionable message")` when the model should see why.
- Open/close each `Client` within ONE cell/task (anyio cancel scopes); for several clients use `AsyncExitStack`
  and exit in reverse order. `call_tool` also issues a `tools/list` (output-schema validation) — expect it in wire logs.
- `ctx.elicit()` / `ctx.elicit_url()` only work on legacy (2025) connections; on 2026-07-28 they raise
  `NoBackChannelError`. Modern way: parameters typed `Annotated[T, Resolve(fn)]` with `Elicit`/`Sample`/`ListRoots`
  resolvers, or return `types.InputRequiredResult` and read `ctx.input_responses` / `ctx.request_state`
  (see content/lessons/5-3.md for working code). requestState is encrypted per-process by default; multiple
  instances need `RequestStateSecurity(keys=[...])`.
- `Client` caches list results by default; use `list_tools(cache_mode="bypass")` to force a server call.
  Custom HTTP headers: `Client(streamable_http_client(url, http_client=httpx2.AsyncClient(headers=...)))` (SDK uses `httpx2`).
- **Raw stdio** (great for showing the wire): run a server file with `mcp.run(transport="stdio")` via `subprocess.Popen(..., text=True)`,
  write one JSON object per line. The connection's era is chosen by the FIRST request: it must carry the modern
  envelope or the connection becomes legacy. Envelope:
  `"_meta": {"io.modelcontextprotocol/protocolVersion": "2026-07-28", "io.modelcontextprotocol/clientCapabilities": {}, "io.modelcontextprotocol/clientInfo": {"name": "raw", "version": "0"}}`.
  Verified responses: `server/discover` → `{"supportedVersions":["2026-07-28"],"capabilities":{...},"resultType":"complete","ttlMs":0,"cacheScope":"private",...}`;
  missing `_meta` → `-32602`; bad version → `-32022 Unsupported protocol version` with `data: {"supported": [...], "requested": ...}`.
- **Streamable HTTP**: `app = mcp.streamable_http_app()`; run with
  `uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=free_port, log_level="warning"))` in a daemon thread
  (`server.run`), wait for `server.started`, stop with `server.should_exit = True`. Endpoint: `http://127.0.0.1:PORT/mcp`.
  `Client(url)` negotiates 2026-07-28. Raw POST with httpx (`trust_env=False`) needs headers
  `Accept: application/json, text/event-stream`, `MCP-Protocol-Version: 2026-07-28`, `Mcp-Method: tools/call`, `Mcp-Name: add`
  → 200 `application/json`. A wrong `Mcp-Method` → HTTP 400 with JSON-RPC error `-32020` (header mismatch).
- Don't name scratch files after stdlib modules (`http.py` breaks starlette).

## Source material

Every official page is available as markdown by appending `.md` to its URL; the full index is
<https://modelcontextprotocol.io/llms.txt>. To work offline, download the pages a lesson needs into a folder
outside the repo, e.g.:

```bash
mkdir -p ~/mcp-docs && cd ~/mcp-docs
curl -sL https://modelcontextprotocol.io/llms.txt \
  | grep -oE "https://modelcontextprotocol.io/(docs/2026-07-28|specification/2026-07-28|extensions|registry)/[^)]+\.md" \
  | sort -u | while read -r u; do curl -sL "$u" -o "$(echo "${u#https://modelcontextprotocol.io/}" | tr / _)"; done
```

`specification/2026-07-28/schema.md` is the full schema reference (700 KB — grep it, don't read it whole).
