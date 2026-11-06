"""Save a CDP batch of {path, html} into site/<path>/index.html."""
import json
import sys
from pathlib import Path

ROOT = Path(r"d:\aibrain\04_projects\simal-ge\site")


def load(src: str):
    raw = Path(src).read_text(encoding="utf-8")
    data = json.loads(raw)
    # CDP wrapper or a bare list
    if isinstance(data, dict) and "result" in data:
        data = data["result"].get("value", data["result"])
    if isinstance(data, dict) and data.get("gz"):
        import base64
        import gzip

        blob = gzip.decompress(base64.b64decode(data["gz"]))
        batch = json.loads(blob.decode("utf-8"))
        return {"batch": batch, "stat": data.get("stat") or {}}
    if isinstance(data, dict) and "batch" in data:
        return data
    if isinstance(data, list):
        return {"batch": data, "stat": {}}
    return data


def main() -> None:
    payload = load(sys.argv[1])
    saved = 0
    skipped = 0
    for item in payload.get("batch") or []:
        html = item.get("html") or ""
        path = item.get("path") or ""
        if not path.startswith("/") or "<html" not in html.lower():
            skipped += 1
            continue
        if "suspected abusive" in html or "Wayback Machine" in html[:400]:
            skipped += 1
            continue
        dest = ROOT / path.strip("/") / "index.html"
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text(html, encoding="utf-8")
        saved += 1
        print("saved", path, len(html))
    stat = payload.get("stat") or {}
    print(f"batch saved={saved} skipped={skipped} stat={stat}")


if __name__ == "__main__":
    main()
