#!/usr/bin/env python3
import http.server, socketserver, json, subprocess, os, urllib.parse, pathlib, sys

ROOT = pathlib.Path(r"C:\Users\Administrador\AppData\Local\hermes\cache\documents\dashboard-handoff")
GAPI = [
    sys.executable,
    os.path.expanduser(r"~/.hermes/skills/productivity/google-workspace/scripts/google_api.py"),
    "gmail", "search", "in:inbox", "--max", "15"
]

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/api/inbox":
            try:
                out = subprocess.check_output(GAPI, text=True, timeout=25)
                data = json.loads(out)
                self.send_response(200)
                self.send_header("content-type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps(data, ensure_ascii=False).encode("utf-8"))
            except Exception as e:
                self.send_response(500)
                self.send_header("content-type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({"error": str(e)}).encode("utf-8"))
            return
        return super().do_GET()

PORT = 5174
with socketserver.TCPServer(("", PORT), Handler) as httpd:
    print(f"Serving {ROOT} at http://localhost:{PORT}")
    httpd.serve_forever()
