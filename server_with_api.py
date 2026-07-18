#!/usr/bin/env python3
import http.server, socketserver, json, subprocess, os, urllib.parse, pathlib, sys, time, re

ROOT = pathlib.Path(r"C:\Users\Administrador\AppData\Local\hermes\cache\documents\dashboard-handoff")
DIST = ROOT / "dist"
DB = pathlib.Path(os.path.expanduser("~/.hermes/state/dashboard-tasks.local.json"))
DB.parent.mkdir(parents=True, exist_ok=True)
GAPI = [
    sys.executable,
    os.path.expandvars(r"%LOCALAPPDATA%/hermes/skills/productivity/google-workspace/scripts/google_api.py"),
    "gmail", "search", "in:inbox", "--max", "15",
]

_ENV = {**os.environ, "PYTHONUNBUFFERED": "1"}

def _read_db():
    try:
        if DB.exists():
            return json.loads(DB.read_text(encoding="utf-8"))
    except Exception:
        pass
    return {"tasks": []}

def _write_db(data):
    DB.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")

def _task_schema(body):
    return {
        "id": body.get("id") or ("task-" + str(int(time.time() * 1000))),
        "title": body.get("title") or "Sin título",
        "detail": body.get("detail") or "",
        "category": body.get("category") or "Operaciones",
        "priority": body.get("priority") or "Media",
        "status": body.get("status") or "Pendiente",
        "dueDate": body.get("dueDate") or "",
        "assignee": body.get("assignee") or "",
        "attachments": body.get("attachments") or [],
        "createdAt": body.get("createdAt") or _iso(),
        "updatedAt": _iso(),
    }

def _patch_schema(body):
    allowed = {"title","detail","category","priority","status","dueDate","assignee","attachments"}
    return {k: v for k, v in body.items() if k in allowed}

def _iso():
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(DIST), **kwargs)

    def _send_json(self, code, obj):
        payload = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def _read_body(self):
        try:
            length = int(self.headers.get("content-length", "0"))
        except Exception:
            length = 0
        data = self.rfile.read(length) if length else b""
        if not data:
            return {}
        try:
            return json.loads(data.decode("utf-8"))
        except Exception:
            return {}

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "content-type")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,PATCH,OPTIONS")

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        route = urllib.parse.unquote(parsed.path)

        if route == "/api/inbox":
            try:
                proc = subprocess.run(
                    GAPI,
                    capture_output=True,
                    text=True,
                    check=True,
                    env=_ENV,
                    timeout=20,
                )
                messages = json.loads(proc.stdout)
            except Exception as exc:
                print("inbox_error", exc, file=sys.stderr)
                messages = []
            self._send_json(200, {"messages": messages})
            return

        if route == "/api/tasks":
            db = _read_db()
            qs = urllib.parse.parse_qs(parsed.query)
            status = (qs.get("status") or [""])[0] if qs else ""
            query = ((qs.get("q") or [""])[0] if qs else "").lower().strip()
            tasks = db.get("tasks", [])
            if status:
                tasks = [t for t in tasks if t.get("status") == status]
            if query:
                def _matcher(t):
                    haystack = " ".join([
                        t.get("title", ""),
                        t.get("detail", ""),
                        t.get("category", ""),
                        t.get("assignee", ""),
                    ]).lower()
                    return query in haystack
                tasks = [t for t in tasks if _matcher(t)]
            self._send_json(200, {"tasks": tasks})
            return

        if route == "/api/calendar/events":
            self._send_json(200, [
                {"id":"evt-1","title":"Revisión Odoo","start":"2026-07-17T10:00:00Z","end":"2026-07-17T11:00:00Z","location":"Oficina"},
                {"id":"evt-2","title":"Dentista","start":"2026-07-23T15:00:00Z","end":"2026-07-23T16:00:00Z","location":"Clínica"},
                {"id":"evt-3","title":"Strava challenge","start":"2026-07-20T08:00:00Z","end":"2026-07-20T09:00:00Z","location":""},
            ])
            return

        if route in {"/api/mail/send", "/api/mail/draft"}:
            body = self._read_body()
            self._send_json(200, {"ok": True, "draft_id": f"draft-{int(time.time())}", "to": body.get("to"), "subject": body.get("subject")})
            return

        if route == "/api/telegram/send-hermes":
            body = self._read_body()
            self._send_json(200, {"reply": f"Prototipo: recibí “{body.get('text','')[:80]}”"})
            return

        if route.startswith("/api/tasks/"):
            db = _read_db()
            task_id = urllib.parse.unquote(route.split("/api/tasks/", 1)[1])
            task = next((t for t in db.get("tasks", []) if str(t.get("id")) == str(task_id)), None)
            if not task:
                self._send_json(404, {"error": "not_found"})
                return
            self._send_json(200, task)
            return

        return super().do_GET()

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        route = urllib.parse.unquote(parsed.path)

        if route == "/api/tasks":
            body = self._read_body()
            db = _read_db()
            task = _task_schema(body)
            db.setdefault("tasks", [])
            db["tasks"] = [t for t in db.get("tasks", []) if str(t.get("id")) != str(task["id"])] + [task]
            _write_db(db)
            self._send_json(201, task)
            return

        if route in {"/api/mail/send", "/api/mail/draft"}:
            body = self._read_body()
            self._send_json(200, {"ok": True, "draft_id": f"draft-{int(time.time())}", "to": body.get("to"), "subject": body.get("subject")})
            return

        if route == "/api/telegram/send-hermes":
            body = self._read_body()
            self._send_json(200, {"reply": f"Prototipo: recibí “{body.get('text','')[:80]}”"})
            return

        self._send_json(404, {"error": "not_found"})

    def do_PATCH(self):
        parsed = urllib.parse.urlparse(self.path)
        route = urllib.parse.unquote(parsed.path)

        if route.startswith("/api/tasks/"):
            body = self._read_body()
            db = _read_db()
            task_id = urllib.parse.unquote(route.split("/api/tasks/", 1)[1])
            tasks = db.get("tasks", [])
            idx = next((i for i, t in enumerate(tasks) if str(t.get("id")) == str(task_id)), -1)
            if idx == -1:
                self._send_json(404, {"error": "not_found"})
                return
            patch = _patch_schema(body)
            task = dict(tasks[idx])
            task.update(patch)
            task["updatedAt"] = _iso()
            tasks[idx] = task
            db["tasks"] = tasks
            _write_db(db)
            self._send_json(200, task)
            return

        self._send_json(404, {"error": "not_found"})

PORT = 5174
with socketserver.TCPServer(("", PORT), Handler) as httpd:
    print(f"Serving {ROOT} at http://localhost:{PORT}")
    httpd.serve_forever()
