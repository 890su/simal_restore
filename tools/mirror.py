"""Mirror the public simal.ge site from the Wayback Machine into a static folder."""

from __future__ import annotations

import gzip
import json
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import deque
from pathlib import Path

ROOT = Path(r"d:\aibrain\04_projects\simal-ge\site")
CDX = Path(r"C:\Users\user\AppData\Local\Temp\simal-raw\html-urls.json")
LOG = Path(r"d:\aibrain\04_projects\simal-ge\tools\mirror.log")
STAMP = "20261105"
UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
)
ASSET_EXT = {
    ".css", ".js", ".mjs", ".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg",
    ".ico", ".woff", ".woff2", ".ttf", ".eot", ".map", ".avif", ".bmp",
}
SKIP_PARTS = (
    "/bitrix/admin",
    "/bitrix/tools",
    "/bitrix/services",
    "/.well-known/",
    "abonement-fitnes",
    "wwcheckmetrics.php",
    "/bitrix/spread",
    "/bitrix/rk.php",
)
WORKERS = 1
TIMESTAMPS: dict[str, str] = {}

lock = threading.RLock()
queued: set[str] = set()
pages: deque[str] = deque()
assets: deque[str] = deque()
stats = {"pages_ok": 0, "assets_ok": 0, "miss": 0, "skip": 0}


def log(msg: str) -> None:
    line = f"{time.strftime('%H:%M:%S')} {msg}"
    print(line, flush=True)
    with lock:
        LOG.parent.mkdir(parents=True, exist_ok=True)
        with LOG.open("a", encoding="utf-8") as fh:
            fh.write(line + "\n")


def norm_path(raw: str) -> str | None:
    if not raw:
        return None
    raw = raw.strip().strip("'\"")
    if raw.startswith(("mailto:", "tel:", "javascript:", "data:", "#")):
        return None
    if raw.startswith("//"):
        raw = "https:" + raw
    if raw.startswith("http://") or raw.startswith("https://"):
        parsed = urllib.parse.urlparse(raw)
        host = parsed.netloc.lower().split(":")[0]
        if host not in {"simal.ge", "www.simal.ge"}:
            return None
        path = parsed.path or "/"
    else:
        path = raw.split("#", 1)[0].split("?", 1)[0]
    path = urllib.parse.unquote(path)
    if not path.startswith("/"):
        return None
    path = re.sub(r"/{2,}", "/", path)
    lowered = path.lower()
    if any(part in lowered for part in SKIP_PARTS):
        return None
    if lowered.startswith("/bitrix/") and not is_asset(path):
        return None
    return path


def is_asset(path: str) -> bool:
    lower = path.lower().split("?")[0]
    if lower.startswith("/upload/") or lower.startswith("/images/"):
        return True
    suffix = Path(lower).suffix
    if suffix in ASSET_EXT:
        return True
    if "/font-awesome/fonts/" in lower or lower.endswith((".woff", ".woff2", ".ttf", ".eot")):
        return True
    return False


def local_file(path: str, page: bool) -> Path:
    rel = path.lstrip("/")
    suffix = Path(rel).suffix.lower()
    if page and suffix not in {".xml", ".txt", ".json"}:
        if rel.endswith("index.html"):
            return ROOT / rel
        if rel.endswith("/"):
            rel = rel + "index.html"
        elif suffix in {".html", ".htm"}:
            pass
        else:
            rel = rel.rstrip("/") + "/index.html"
        return ROOT / rel
    return ROOT / rel


def enqueue(path: str | None) -> None:
    if not path:
        return
    kind = "asset" if is_asset(path) else "page"
    key = kind + ":" + path
    with lock:
        if key in queued:
            return
        queued.add(key)
        (assets if kind == "asset" else pages).append(path)


def seed_from_cdx() -> None:
    rows = json.loads(CDX.read_text(encoding="utf-8"))[1:]
    for row in rows:
        path = norm_path(row[0])
        if not path:
            continue
        previous = TIMESTAMPS.get(path)
        if previous is None or row[1] > previous:
            TIMESTAMPS[path] = row[1]
        enqueue(path)
    for extra in (
        "/",
        "/catalog/",
        "/en/",
        "/ge/",
        "/kontakty/",
        "/kompaniya/",
        "/oplata-dostavka/",
        "/aktsii/",
        "/news/",
        "/sotrudnichestvo/",
        "/sitemap.xml",
    ):
        enqueue(extra)


ATTR_RE = re.compile(
    r"""(?:href|src|data-src|poster)\s*=\s*['"]([^'"]+)['"]""",
    re.I,
)
URL_RE = re.compile(r"""url\(\s*['"]?([^'")]+)['"]?\s*\)""", re.I)
SRCSET_RE = re.compile(r"""srcset\s*=\s*['"]([^'"]+)['"]""", re.I)


def resolve(raw: str, base: str) -> str | None:
    raw = raw.strip().strip("'\"")
    if raw.startswith(("data:", "mailto:", "tel:", "javascript:", "#")):
        return None
    if raw.startswith(("http://", "https://", "//", "/")):
        return norm_path(raw)
    if not base:
        return None
    joined = urllib.parse.urljoin("https://simal.ge" + base, raw)
    return norm_path(joined)


def extract(text: str, base: str = "/", css: bool = False) -> None:
    if css:
        for match in URL_RE.finditer(text):
            enqueue(resolve(match.group(1).strip(), base))
        return
    for match in ATTR_RE.finditer(text):
        enqueue(resolve(match.group(1), base))
    for match in SRCSET_RE.finditer(text):
        for part in match.group(1).split(","):
            token = part.strip().split(" ")[0]
            enqueue(resolve(token, base))
    for match in URL_RE.finditer(text):
        enqueue(resolve(match.group(1).strip(), base))
    for match in re.finditer(r"""['"](/upload/[^'"\s)]+)['"]""", text):
        enqueue(norm_path(match.group(1)))
    for match in re.finditer(
        r"""['"](/bitrix/[^'"\s)]+\.(?:css|js|png|jpg|jpeg|webp|gif|svg|woff2?))['"]""",
        text,
        re.I,
    ):
        enqueue(norm_path(match.group(1).split("?")[0]))
    if "<loc>" in text and text.lstrip().startswith("<?xml"):
        for match in re.finditer(r"<loc>\s*([^<]+)\s*</loc>", text):
            enqueue(norm_path(match.group(1).strip()))


def fetch(path: str) -> bytes | None:
    original = "https://simal.ge" + path
    stamp = TIMESTAMPS.get(path, STAMP)
    urls = [
        f"https://web.archive.org/web/{STAMP}id_/{original}",
        f"https://web.archive.org/web/{stamp}id_/{original}",
    ]
    headers = {"User-Agent": UA, "Accept": "*/*"}
    last = "unknown"
    for attempt in range(6):
        url = urls[min(attempt, len(urls) - 1)]
        try:
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=80) as resp:
                data = resp.read()
            if data[:2] == b"\x1f\x8b":
                data = gzip.decompress(data)
            head = data[:1800].lower()
            if b"wayback machine has not archived" in head or b"this url has been excluded" in head:
                last = "not-archived"
                time.sleep(1)
                continue
            if len(data) < 80:
                last = f"short {len(data)}"
                time.sleep(1 + attempt)
                continue
            return data
        except urllib.error.HTTPError as exc:
            last = f"HTTP {exc.code}"
            if exc.code == 404:
                return None
            if exc.code == 429:
                time.sleep(25 + attempt * 10)
                continue
            time.sleep(4 + attempt * 3)
        except Exception as exc:  # noqa: BLE001
            last = f"{type(exc).__name__}"
            time.sleep(5 + attempt * 3)
    log(f"MISS {path} ({last})")
    with lock:
        stats["miss"] += 1
    return None


def looks_like_html(data: bytes) -> bool:
    head = data[:400].lstrip().lower()
    return head.startswith(b"<!doctype") or head.startswith(b"<html") or b"<head" in head[:400]


def save_and_scan(path: str, page: bool) -> None:
    dest = local_file(path, page)
    if dest.exists() and dest.stat().st_size > 80:
        data = dest.read_bytes()
        with lock:
            stats["skip"] += 1
    else:
        data = fetch(path)
        if data is None:
            return
        if page and not looks_like_html(data):
            # A CSS/JS file mislabeled by CDX: store it as an asset instead.
            if is_asset(path) or path.endswith((".css", ".js", ".xml")):
                page = False
                dest = local_file(path, False)
            else:
                log(f"NOTHTML {path} {data[:60]!r}")
                return
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(data)
        with lock:
            if page:
                stats["pages_ok"] += 1
            else:
                stats["assets_ok"] += 1
    try:
        text = data.decode("utf-8", "replace")
    except Exception:
        return
    base = path if path.endswith("/") else path.rsplit("/", 1)[0] + "/"
    if page or path.endswith((".css", ".js", ".xml")):
        extract(text, base=base, css=path.endswith(".css"))
    elif b"url(" in data[:200000]:
        extract(text, base=base, css=True)


def worker(kind: str) -> None:
    queue = pages if kind == "page" else assets
    while True:
        with lock:
            if not queue:
                return
            path = queue.popleft()
        save_and_scan(path, page=(kind == "page"))
        time.sleep(2.0)


def run() -> None:
    ROOT.mkdir(parents=True, exist_ok=True)
    seed_from_cdx()
    log(f"seed pages={len(pages)} assets={len(assets)}")
    threads = []
    for _ in range(WORKERS):
        threads.append(threading.Thread(target=worker, args=("page",), daemon=True))
    for thread in threads:
        thread.start()
    while any(thread.is_alive() for thread in threads):
        time.sleep(8)
        with lock:
            log(
                f"progress pages_ok={stats['pages_ok']} assets_ok={stats['assets_ok']} "
                f"miss={stats['miss']} skip={stats['skip']} "
                f"qP={len(pages)} qA={len(assets)}"
            )
    log("pages done, downloading assets")
    # Newly discovered pages may have been queued while the page workers exited.
    while pages:
        threads = [threading.Thread(target=worker, args=("page",), daemon=True) for _ in range(WORKERS)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
    threads = [threading.Thread(target=worker, args=("asset",), daemon=True) for _ in range(WORKERS)]
    for thread in threads:
        thread.start()
    while any(thread.is_alive() for thread in threads):
        time.sleep(8)
        with lock:
            log(
                f"assets pages_ok={stats['pages_ok']} assets_ok={stats['assets_ok']} "
                f"miss={stats['miss']} skip={stats['skip']} qA={len(assets)} qP={len(pages)}"
            )
    for thread in threads:
        thread.join()
    # One more pass in case CSS revealed more assets after workers checked the queue.
    if assets or pages:
        log("final pass")
        run_remaining()
    log(f"DONE {stats}")


def run_remaining() -> None:
    for _ in range(3):
        if pages:
            threads = [threading.Thread(target=worker, args=("page",), daemon=True) for _ in range(WORKERS)]
            for thread in threads:
                thread.start()
            for thread in threads:
                thread.join()
        if assets:
            threads = [threading.Thread(target=worker, args=("asset",), daemon=True) for _ in range(WORKERS)]
            for thread in threads:
                thread.start()
            for thread in threads:
                thread.join()
        if not pages and not assets:
            break


if __name__ == "__main__":
    run()
