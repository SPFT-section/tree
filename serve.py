#!/usr/bin/env python3
"""No-build local server for the procedural tree demo.

Why not `python -m http.server`? On Windows, Python's mimetypes reads the
registry, which often maps `.js` to `text/plain`. Browsers REFUSE to load
ES modules served as text/plain, so the page shows the UI panel but the 3D
scene stays black with no error in the panel. This server forces the
correct JavaScript MIME type regardless of registry settings.

Usage: python serve.py [PORT]   (default 8001, serves this directory)
"""
import http.server
import pathlib
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8001
ROOT = pathlib.Path(__file__).resolve().parent


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript",
        ".mjs": "text/javascript",
        ".json": "application/json",
        ".wasm": "application/wasm",
    }

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)


if __name__ == "__main__":
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"== Procedural Tree ==\nServing {ROOT} on http://127.0.0.1:{PORT}")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
