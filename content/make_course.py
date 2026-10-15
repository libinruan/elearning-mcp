"""One-off generator for content/course.json (kept so the curriculum is easy to re-edit)."""
import json
from pathlib import Path

B = "https://modelcontextprotocol.io"
D = f"{B}/docs/2026-07-28"
S = f"{B}/specification/2026-07-28"

def src(title, url):
    return {"title": title, "url": url}

modules = [
    (1, "The big picture", "全局视角", "What MCP is, the problem it solves, its participants and layers, and how the protocol is versioned."),
    (2, "The wire protocol", "协议底层", "JSON-RPC messages, the stateless request model, discovery, transports and the cross-cutting patterns."),
    (3, "Server primitives", "服务器原语", "Tools, resources and prompts — the three things a server offers — plus completion, caching and subscriptions."),
    (4, "Building servers", "构建服务器", "Write servers with the Python SDK, design tools an LLM can use well, then test and debug them."),
    (5, "Clients & agent loops", "客户端与智能体循环", "Client features, the LLM tool-use loop, multi round-trip requests, and hosts that scale to many servers."),
    (6, "Security & authorization", "安全与授权", "OAuth 2.1 for remote servers, the attacks MCP systems face, and running local servers safely."),
    (7, "Extensions & ecosystem", "扩展与生态", "The extension mechanism, Tasks, MCP Apps, Skills, auth extensions, the Registry, SDKs and the roadmap."),
    (8, "Capstone & career", "综合项目与求职", "Build a complete agentic workflow on MCP, then rehearse production and system-design interviews."),
]

lessons = [
    # module, id, title_zh, minutes, sources
    (1, "1-1", "什么是 MCP，为什么需要它", 45, [
        src("What is MCP?", f"{D}/getting-started/intro"),
        src("Specification overview", f"{S}/index"),
        src("Design principles", f"{B}/community/design-principles")]),
    (1, "1-2", "架构：宿主、客户端与服务器", 60, [
        src("Architecture overview", f"{D}/learn/architecture"),
        src("Spec: Architecture", f"{S}/architecture/index")]),
    (1, "1-3", "版本、特性生命周期与 2026-07-28 的变化", 50, [
        src("Versioning", f"{D}/learn/versioning"),
        src("Spec: Versioning and compatibility", f"{S}/basic/versioning"),
        src("Key changes (changelog)", f"{S}/changelog"),
        src("Deprecated features", f"{S}/deprecated"),
        src("Feature lifecycle policy", f"{B}/community/feature-lifecycle")]),
    (1, "1-4", "MCP、技能（Skills）与函数调用的区别", 40, [
        src("Agent Skills specification", "https://agentskills.io/specification"),
        src("Skills extension", f"{B}/extensions/skills/overview"),
        src("Build with Agent Skills", f"{D}/develop/build-with-agent-skills"),
        src("Build an MCP client (function calling loop)", f"{D}/develop/build-client")]),
    (2, "2-1", "JSON-RPC 消息、_meta 与错误码", 60, [
        src("Spec: Base protocol overview", f"{S}/basic/index"),
        src("Schema reference", f"{S}/schema")]),
    (2, "2-2", "无状态协议与 server/discover", 50, [
        src("Spec: Discovery", f"{S}/server/discover"),
        src("Spec: Statelessness", f"{S}/basic/index#statelessness"),
        src("Spec: Version negotiation", f"{S}/basic/versioning")]),
    (2, "2-3", "传输层：stdio 与 Streamable HTTP", 70, [
        src("Spec: Transports overview", f"{S}/basic/transports/index"),
        src("Spec: stdio", f"{S}/basic/transports/stdio"),
        src("Spec: Streamable HTTP", f"{S}/basic/transports/streamable-http")]),
    (2, "2-4", "通用模式：取消、进度、分页与日志", 55, [
        src("Spec: Patterns overview", f"{S}/basic/patterns/index"),
        src("Spec: Cancellation", f"{S}/basic/patterns/cancellation"),
        src("Spec: Progress", f"{S}/basic/patterns/progress"),
        src("Spec: Pagination", f"{S}/server/utilities/pagination"),
        src("Spec: Logging", f"{S}/server/utilities/logging")]),
    (3, "3-1", "工具（Tools）：模型可调用的能力", 70, [
        src("Understanding MCP servers", f"{D}/learn/server-concepts"),
        src("Spec: Tools", f"{S}/server/tools")]),
    (3, "3-2", "资源（Resources）与资源模板", 55, [
        src("Spec: Resources", f"{S}/server/resources"),
        src("Understanding MCP servers", f"{D}/learn/server-concepts")]),
    (3, "3-3", "提示（Prompts）与参数补全", 45, [
        src("Spec: Prompts", f"{S}/server/prompts"),
        src("Spec: Completion", f"{S}/server/utilities/completion")]),
    (3, "3-4", "缓存与订阅：让列表保持新鲜", 50, [
        src("Spec: Caching", f"{S}/server/utilities/caching"),
        src("Spec: Subscriptions", f"{S}/basic/patterns/subscriptions")]),
    (4, "4-1", "用 Python SDK 写第一个服务器", 70, [
        src("Build an MCP server", f"{D}/develop/build-server"),
        src("SDKs", f"{D}/sdk")]),
    (4, "4-2", "为大模型设计好用的工具", 60, [
        src("Spec: Tools (stateful tools, errors)", f"{S}/server/tools"),
        src("Build with Agent Skills", f"{D}/develop/build-with-agent-skills"),
        src("Client best practices", f"{D}/develop/clients/client-best-practices")]),
    (4, "4-3", "测试与调试：Inspector 与日志", 60, [
        src("MCP Inspector", f"{D}/tools/inspector"),
        src("Inspector CLI client", f"{D}/tools/inspector/cli"),
        src("Inspector protocol eras", f"{D}/tools/inspector/protocol-eras"),
        src("Debugging", f"{D}/tools/debugging")]),
    (5, "5-1", "客户端特性：征询、根目录与采样", 55, [
        src("Understanding MCP clients", f"{D}/learn/client-concepts"),
        src("Spec: Roots", f"{S}/client/roots"),
        src("Spec: Sampling", f"{S}/client/sampling")]),
    (5, "5-2", "构建客户端与 LLM 工具调用循环", 75, [
        src("Build an MCP client", f"{D}/develop/build-client")]),
    (5, "5-3", "多轮往返请求（MRTR）与征询", 70, [
        src("Spec: Multi round-trip requests", f"{S}/basic/patterns/mrtr"),
        src("Spec: Elicitation", f"{S}/client/elicitation")]),
    (5, "5-4", "多服务器宿主：渐进式发现与代码模式", 65, [
        src("Client best practices", f"{D}/develop/clients/client-best-practices"),
        src("Understanding MCP servers (multi-server example)", f"{D}/learn/server-concepts")]),
    (5, "5-5", "接入真实宿主：本地与远程服务器", 40, [
        src("Connect to local MCP servers", f"{D}/develop/connect-local-servers"),
        src("Connect to remote MCP servers", f"{D}/develop/connect-remote-servers")]),
    (6, "6-1", "授权：MCP 中的 OAuth 2.1", 80, [
        src("Understanding authorization in MCP", f"{D}/tutorials/security/authorization"),
        src("Spec: Authorization", f"{S}/basic/authorization/index"),
        src("Spec: Authorization server discovery", f"{S}/basic/authorization/authorization-server-discovery"),
        src("Spec: Client registration", f"{S}/basic/authorization/client-registration")]),
    (6, "6-2", "攻击与防御：安全最佳实践", 75, [
        src("Security best practices", f"{D}/tutorials/security/security_best_practices"),
        src("Spec: Authorization security considerations", f"{S}/basic/authorization/security-considerations")]),
    (6, "6-3", "本地服务器安全与隔离", 50, [
        src("Local server security", f"{D}/tutorials/security/local-server-security"),
        src("Inspector security model", f"{D}/tools/inspector/security")]),
    (7, "7-1", "扩展机制与 Tasks 扩展", 55, [
        src("Extensions overview", f"{B}/extensions/overview"),
        src("Extension support matrix", f"{B}/extensions/client-matrix"),
        src("Tasks", f"{B}/extensions/tasks/overview")]),
    (7, "7-2", "MCP Apps：在对话里渲染交互界面", 55, [
        src("MCP Apps overview", f"{B}/extensions/apps/overview"),
        src("Build an MCP App", f"{B}/extensions/apps/build")]),
    (7, "7-3", "Skills over MCP 与授权扩展", 50, [
        src("Skills extension", f"{B}/extensions/skills/overview"),
        src("Authorization extensions", f"{B}/extensions/auth/overview"),
        src("OAuth client credentials", f"{B}/extensions/auth/oauth-client-credentials"),
        src("Enterprise-managed authorization", f"{B}/extensions/auth/enterprise-managed-authorization")]),
    (7, "7-4", "注册中心、SDK 分级与路线图", 50, [
        src("The MCP Registry", f"{B}/registry/about"),
        src("Registry quickstart", f"{B}/registry/quickstart"),
        src("SDK tiering", f"{B}/community/sdk-tiers"),
        src("Roadmap", f"{B}/development/roadmap")]),
    (8, "8-1", "综合项目：基于 MCP 的研究助理工作流", 120, [
        src("Build an MCP server", f"{D}/develop/build-server"),
        src("Build an MCP client", f"{D}/develop/build-client"),
        src("Client best practices", f"{D}/develop/clients/client-best-practices")]),
    (8, "8-2", "生产清单与系统设计面试", 60, [
        src("Security best practices", f"{D}/tutorials/security/security_best_practices"),
        src("Spec: Streamable HTTP", f"{S}/basic/transports/streamable-http"),
        src("Roadmap", f"{B}/development/roadmap")]),
]

course = {
    "title": "MCP Mastery",
    "title_zh": "MCP 精通之路",
    "subtitle": "Model Context Protocol for AI engineers — spec revision 2026-07-28",
    "spec_version": "2026-07-28",
    "source": f"{D}/getting-started/intro",
    "sdk": "mcp 2.3.0",
    "modules": [{"n": n, "title": t, "title_zh": z, "blurb": b} for n, t, z, b in modules],
    "lessons": [{"id": i, "module": m, "title_zh": z, "minutes": mins, "sources": s} for m, i, z, mins, s in lessons],
}
Path(__file__).with_name("course.json").write_text(json.dumps(course, ensure_ascii=False, indent=1), encoding="utf-8")
print(len(course["lessons"]), "lessons")

# ---- the suggested agenda (shown on the Study plan page) ----
course["plan"] = [
    {"week": 1, "title": "Mental model & wire protocol", "lessons": ["1-1", "1-2", "1-3", "1-4", "2-1", "2-2", "2-3", "2-4"],
     "goal": "Explain MCP on a whiteboard and read any raw MCP message: who sends it, what it means, which transport carries it.",
     "milestone": "Hand-write a JSON-RPC exchange (server/discover → tools/list → tools/call) and an HTTP request with its Mcp-* headers."},
    {"week": 2, "title": "Server primitives & building servers", "lessons": ["3-1", "3-2", "3-3", "3-4", "4-1", "4-2", "4-3"],
     "goal": "Ship a well-designed server exposing tools, resources and prompts, tested with an in-memory client and the Inspector.",
     "milestone": "Your own server (any domain) with 3+ tools, a resource template and a prompt, passing a scripted test."},
    {"week": 3, "title": "Clients, agent loops & security", "lessons": ["5-1", "5-2", "5-3", "5-4", "5-5", "6-1", "6-2", "6-3"],
     "goal": "Build the host side: an LLM tool loop over several servers, with MRTR input, and defend it against the known attacks.",
     "milestone": "An agent loop that routes across two servers, asks for confirmation via elicitation, and validates a bearer token."},
    {"week": 4, "title": "Ecosystem, capstone & interviews", "lessons": ["7-1", "7-2", "7-3", "7-4", "8-1", "8-2"],
     "goal": "Know the extensions and ecosystem, finish the capstone, and answer design questions fluently.",
     "milestone": "Capstone running end to end; every pitch rehearsed under 30 s; all interview cards marked “Got it”."},
]
course["method"] = [
    ["Read", "Open the lesson's digest first (15–25 min). Skim the official pages linked at the top only where you want the full detail."],
    ["Run", "Work through the notebook top to bottom, then do the “Your turn” exercises — that is where the learning sticks."],
    ["Say", "Rehearse each 30-second pitch out loud with the timer. If you can't say it, you don't own it yet."],
    ["Recall", "Answer the interview cards before revealing them; mark the shaky ones and shuffle them again 2 and 7 days later."],
]
Path(__file__).with_name("course.json").write_text(json.dumps(course, ensure_ascii=False, indent=1), encoding="utf-8")
