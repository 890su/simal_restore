"""Accept archived HTML posted by the browser and save it into the static site."""

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote

ROOT = Path(r"d:\aibrain\04_projects\simal-ge\site")
MISSING = Path(r"d:\aibrain\04_projects\simal-ge\tools\missing-pages.txt")


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def _cors(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(204)
        self._cors()
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802
        if self.path.split("?", 1)[0] != "/missing":
            self.send_error(404)
            return
        body = MISSING.read_bytes()
        self.send_response(200)
        self._cors()
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self) -> None:  # noqa: N802
        if not self.path.startswith("/save"):
            self.send_error(404)
            return
        length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(length)
        query = self.path.split("?", 1)[1] if "?" in self.path else ""
        path = "/"
        for part in query.split("&"):
            if part.startswith("path="):
                path = unquote(part[5:])
        rel = path.strip("/")
        dest = ROOT / "index.html" if not rel else ROOT / rel / "index.html"
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(raw)
        print(f"saved {dest.stat().st_size} {path}", flush=True)
        msg = b"ok"
        self.send_response(200)
        self._cors()
        self.send_header("Content-Type", "text/plain")
        self.send_header("Content-Length", str(len(msg)))
        self.end_headers()
        self.wfile.write(msg)

    def log_message(self, fmt: str, *args) -> None:
        return


if __name__ == "__main__":
    server = ThreadingHTTPServer(("127.0.0.1", 5501), Handler)
    print("ingest on 5501", flush=True)
    server.serve_forever()
