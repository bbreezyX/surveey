#!/usr/bin/env python3
"""Local atlas server: static files plus a write path for point flags.

Flags: "cadangan" (Status Cadangan, not counted) and "duplikat" (Duplikat
true, still counted, pin needs a field check).

Binds 127.0.0.1 only. Production stays a static Caddy host — this endpoint
does not exist there. After you commit and push data/points.geojson, the
flagged points go live; the buttons do not.

    python3 scripts/dev-server.py
"""

from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
import os
import socket
import sys
import threading
from pathlib import Path

WRITE_LOCK = threading.Lock()

ROOT = Path(__file__).resolve().parent.parent
GEOJSON = ROOT / "data" / "points.geojson"
HOST = "127.0.0.1"
PORT = 8123
# macOS EADDRINUSE, Linux EADDRINUSE, Windows WSAEADDRINUSE
PORT_IN_USE = frozenset((48, 98, 10048))


class AtlasServer(ThreadingHTTPServer):
    # Python defaults this to True. On Windows, SO_REUSEADDR lets a second
    # `npm run dev` bind 8123, print "Local atlas", then answer browsers
    # with an empty reply.
    allow_reuse_address = False

    def server_bind(self):
        if os.name == "nt":
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()


class Handler(SimpleHTTPRequestHandler):
    # Keep-alive, not the stdlib's HTTP/1.0 default. HTTP/1.0 closes the
    # socket after every response, and on this Windows box a close that races
    # a large send loses the response's tail: resources/ol.js (869 KB) stalled
    # or reset ~20 KB short in 9 of 40 runs against a reader that drains a bit
    # slower than curl (0/40 with keep-alive). The Claude browser pane reads
    # through such a proxy, so ol.js or dissolved.geojson died with
    # ERR_CONNECTION_RESET, `ol` was undefined and the map sat on "Memuat data
    # titik…". Every response here carries Content-Length, and send_error
    # sends Connection: close, so an unread POST body never gets parsed as
    # the next request.
    protocol_version = "HTTP/1.1"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        # Never cache anything on the dev server. It used to exempt only
        # /api/, /data/ and custom.*, which left layers/layers.js, styles/*
        # and resources/* to the browser's heuristic cache: an edit to
        # layers.js then failed to show up in the preview until the ?v= token
        # moved, and looked like a bug in the feature. Production caching is
        # the Caddyfile's job; here the file on disk is always the truth.
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_GET(self):
        if self.path.split("?", 1)[0] == "/api/flag":
            self._json(200, {"ok": True, "flags": sorted(FLAGS)})
            return
        super().do_GET()

    def do_POST(self):
        if self.path.split("?", 1)[0] != "/api/flag":
            self.send_error(404)
            return
        if self.client_address[0] not in ("127.0.0.1", "::1"):
            self.send_error(403)
            return
        length = int(self.headers.get("Content-Length") or 0)
        if length > 4096:
            self.send_error(413)
            return
        try:
            payload = json.loads(self.rfile.read(length) or b"{}")
        except json.JSONDecodeError:
            self._json(400, {"ok": False, "error": "json"})
            return
        nomor = str(payload.get("nomor") or "").strip()
        flag = str(payload.get("flag") or "").strip().lower()
        value = payload.get("value")
        if not nomor or flag not in FLAGS or not isinstance(value, bool):
            self._json(400, {"ok": False, "error": "payload"})
            return
        try:
            with WRITE_LOCK:
                set_flag(nomor, flag, value)
        except KeyError:
            self._json(404, {"ok": False, "error": "nomor"})
            return
        except OSError as exc:
            self._json(500, {"ok": False, "error": str(exc)})
            return
        self._json(200, {"ok": True, "nomor": nomor, "flag": flag, "value": value})

    def _json(self, code, obj):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))


FLAGS = ("cadangan", "duplikat")


def set_flag(nomor, flag, value):
    data = json.loads(GEOJSON.read_text(encoding="utf-8"))
    found = None
    for feat in data.get("features") or []:
        props = feat.get("properties") or {}
        if str(props.get("Nomor") or "").strip() == nomor:
            found = feat
            break
    if found is None:
        raise KeyError(nomor)
    props = found["properties"]
    if flag == "cadangan":
        # Reserve = not an SK unit: excluded from every count.
        if value:
            props["Status"] = "Cadangan"
        else:
            props.pop("Status", None)
    elif flag == "duplikat":
        # Duplicate = the phone GPS did not move between two real units.
        # Both still count; the flag only says the pin needs a field check.
        if value:
            props["Duplikat"] = True
        else:
            props.pop("Duplikat", None)
    tmp = GEOJSON.with_name(GEOJSON.name + ".tmp")
    tmp.write_text(
        json.dumps(data, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    os.replace(tmp, GEOJSON)


def main():
    os.chdir(ROOT)
    try:
        httpd = AtlasServer((HOST, PORT), Handler)
    except OSError as exc:
        codes = {getattr(exc, "errno", None), getattr(exc, "winerror", None)}
        if codes & PORT_IN_USE:
            sys.stderr.write(
                "Port %s already in use. Stop the other server "
                "and open http://%s:%s/ if it is already running.\n"
                % (PORT, HOST, PORT)
            )
            sys.exit(1)
        raise
    print("Local atlas  http://%s:%s/" % (HOST, PORT), flush=True)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nstopped", flush=True)


if __name__ == "__main__":
    main()
