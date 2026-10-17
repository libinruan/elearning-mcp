#!/usr/bin/env python
"""Start the study app: the website on http://localhost:8000 plus JupyterLab for the notebooks.

    python run.py [--port 8000] [--no-browser] [--no-jupyter]
"""
import argparse
import atexit
import json
import os
import secrets
import signal
import socket
import subprocess
import sys
import threading
import webbrowser
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import progress

ROOT = Path(__file__).resolve().parent
VENV_PY = ROOT / ".venv" / "bin" / "python"

# Always run with the project's virtualenv so the notebooks find mcp, anthropic, ...
if VENV_PY.exists() and Path(sys.prefix).resolve() != (ROOT / ".venv").resolve():
    os.execv(str(VENV_PY), [str(VENV_PY), str(Path(__file__).resolve()), *sys.argv[1:]])


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def start_jupyter():
    port, token = free_port(), secrets.token_urlsafe(24)
    proc = subprocess.Popen(
        [sys.executable, "-m", "jupyterlab", "--no-browser",
         f"--ServerApp.port={port}", "--ServerApp.port_retries=0", "--ServerApp.ip=127.0.0.1",
         f"--IdentityProvider.token={token}", f"--ServerApp.root_dir={ROOT / 'notebooks'}"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    atexit.register(proc.terminate)
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))  # so a plain `kill` also stops JupyterLab
    return {"url": f"http://localhost:{port}", "token": token}


class IPv6Server(ThreadingHTTPServer):
    address_family = socket.AF_INET6


class Handler(SimpleHTTPRequestHandler):
    config = {"jupyter": None}

    def send_json(self, data, status=200):
        body = json.dumps(data).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = self.path.split("?")[0]
        if path == "/api/config":
            self.send_json(self.config)
        elif path == "/api/progress":
            self.send_json(progress.load())
        else:
            super().do_GET()

    def do_POST(self):
        if self.path.split("?")[0] != "/api/progress":
            return self.send_json({"error": "not found"}, 404)
        # Other sites can't send a JSON content type to localhost without a CORS preflight, which we never allow
        if self.headers.get("Content-Type", "").split(";")[0].strip() != "application/json":
            return self.send_json({"error": "expected application/json"}, 415)
        try:
            payload = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)) or b"{}")
            progress.apply(payload["changes"])
        except (ValueError, KeyError, TypeError) as exc:  # bad JSON, missing "changes", or a BadChange
            return self.send_json({"error": str(exc)}, 400)
        self.send_json(progress.load())

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, *args):
        pass


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--port", type=int, default=8000)
    ap.add_argument("--no-browser", action="store_true")
    ap.add_argument("--no-jupyter", action="store_true", help="serve the site only")
    args = ap.parse_args()

    subprocess.run([sys.executable, str(ROOT / "build.py")], check=False)
    if not args.no_jupyter:
        Handler.config = {"jupyter": start_jupyter()}

    try:
        handler = partial(Handler, directory=str(ROOT / "site"))
        server = ThreadingHTTPServer(("127.0.0.1", args.port), handler)
    except OSError:
        sys.exit(f"Port {args.port} is busy. Try: python run.py --port {args.port + 1}")
    try:  # some browsers resolve "localhost" to ::1 first, so answer there too
        threading.Thread(target=IPv6Server(("::1", args.port), handler).serve_forever, daemon=True).start()
    except OSError:
        pass
    url = f"http://localhost:{args.port}"
    print(f"\n  Study app   {url}")
    if Handler.config["jupyter"]:
        print(f"  JupyterLab  {Handler.config['jupyter']['url']}/lab?token={Handler.config['jupyter']['token']}")
    print("  Ctrl+C to stop\n")
    if not args.no_browser:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nbye")


if __name__ == "__main__":
    main()
