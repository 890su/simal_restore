"""Apply the SEO-landing fixes to the recovered static site.

Keeps the archived shop pages. Removes tags that point at files the archive
does not have, drops Yandex Metrika, and adds canonical, sitemap, hero image
variants, and the homepage head tags.
"""
from __future__ import annotations

import html
import re
from pathlib import Path
from urllib.parse import unquote, urlparse

import pillow_heif
from PIL import Image

pillow_heif.register_heif_opener()

ROOT = Path(r"d:\aibrain\04_projects\simal-ge\site")
ORIGIN = "https://simal.ge"
HERO_SRC = ROOT / "upload/iblock/3ed/o2j8vm6zn5ljuqz5k139t3r2178b4jmh.png"
HERO_DIR = ROOT / "images" / "hero"
WIDTHS = (320, 640, 768, 1024, 1280, 1920)
TITLE = "Мебель в Тбилиси и Батуми — Simal"
DESCRIPTION = (
    "Магазин мебели Simal в Тбилиси и Батуми: диваны, кровати и матрасы, доставка по Грузии."
)

LINK_RE = re.compile(r"<link\b[^>]*rel=[\"']stylesheet[\"'][^>]*>", re.I)
SCRIPT_SRC_RE = re.compile(r"<script\b[^>]*\bsrc=[\"'][^\"']+[\"'][^>]*>\s*</script>", re.I)
SCRIPT_BLOCK_RE = re.compile(r"<script\b[^>]*>.*?</script>", re.I | re.S)
ATTR_SPACE_RE = re.compile(r"([\"'])([A-Za-z][\w:-]*=)")


def local_file(url: str) -> Path | None:
    if url.startswith(("http://", "https://", "data:", "mailto:", "tel:", "#", "javascript:")):
        return None
    path = unquote(urlparse(url).path)
    if not path.startswith("/"):
        return None
    return ROOT / path.lstrip("/")


def missing_local(url: str) -> bool:
    dest = local_file(url)
    return dest is not None and not dest.is_file()


def strip_missing_assets(text: str) -> str:
    def link_sub(match: re.Match[str]) -> str:
        tag = match.group(0)
        href = re.search(r"href=[\"']([^\"']+)", tag)
        if href and missing_local(href.group(1)):
            return ""
        return tag

    def script_sub(match: re.Match[str]) -> str:
        tag = match.group(0)
        src = re.search(r"src=[\"']([^\"']+)", tag)
        if src and missing_local(src.group(1)):
            return ""
        return tag

    text = LINK_RE.sub(link_sub, text)
    text = SCRIPT_SRC_RE.sub(script_sub, text)
    return text


def strip_metrika(text: str) -> str:
    def block_sub(match: re.Match[str]) -> str:
        body = match.group(0)
        if "mc.yandex.ru" in body or "window.counters" in body or "yandex.metrika" in body:
            return ""
        return body

    text = SCRIPT_BLOCK_RE.sub(block_sub, text)
    text = text.replace("<!-- Yandex.Metrika counter -->", "")
    text = text.replace("<!-- /Yandex.Metrika counter -->", "")
    return text


def page_url(path: Path) -> str:
    rel = path.relative_to(ROOT).as_posix()
    if rel == "index.html":
        return ORIGIN + "/"
    if rel.endswith("/index.html"):
        return ORIGIN + "/" + rel[: -len("index.html")]
    return ORIGIN + "/" + rel


def lang_of(url: str) -> str:
    path = urlparse(url).path
    if path.startswith("/en/"):
        return "en"
    if path.startswith("/ge/"):
        return "ka"
    return "ru"


def skip_label(lang: str) -> str:
    if lang == "en":
        return "Skip to content"
    if lang == "ka":
        return "ძირითად ტექსტზე გადასვლა"
    return "К содержанию"


def insert_head(text: str, url: str) -> str:
    lang = lang_of(url)
    bits = []
    if 'meta charset="utf-8"' not in text.lower() and "<meta charset='utf-8'" not in text.lower():
        bits.append('<meta charset="utf-8">')
    if 'name="referrer"' not in text:
        bits.append('<meta name="referrer" content="strict-origin-when-cross-origin">')
    if 'name="robots"' not in text:
        bits.append(
            '<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1">'
        )
    if 'rel="canonical"' not in text:
        bits.append(f'<link rel="canonical" href="{html.escape(url, quote=True)}">')
    if "BX.setJSList" not in text[:2500]:
        bits.append("<script>window.BX=window.BX||{};BX.setJSList=BX.setJSList||function(){};</script>")
    if not bits:
        return text
    block = "\n".join(bits) + "\n"
    return re.sub(r"<head[^>]*>", lambda m: m.group(0) + "\n" + block, text, count=1, flags=re.I)


def wrap_main(text: str, lang: str) -> str:
    if 'class="skip-link"' not in text and "<body" in text.lower():
        label = html.escape(skip_label(lang))
        text = re.sub(
            r"<body([^>]*)>",
            rf'<body\1>\n<a class="skip-link" href="#main">{label}</a>',
            text,
            count=1,
            flags=re.I,
        )
    if 'id="main"' not in text and "</header>" in text and "<footer" in text:
        text = text.replace("</header>", '</header>\n<main id="main">', 1)
        text = text.replace("<footer", "</main>\n<footer", 1)
    return text


def common_clean(text: str) -> str:
    text = text.replace('href="javascript:;"', 'href="#callback"')
    text = text.replace('type="input"', 'type="text"')
    text = text.replace('class="hdslide_home"style=', 'class="hdslide_home" style=')
    text = re.sub(
        r'(<a\b[^>]*target="_blank")(?![^>]*\brel=)',
        r'\1 rel="noopener noreferrer"',
        text,
        flags=re.I,
    )
    text = re.sub(
        r'<meta name=viewport content="width=device-width, initial-scale=1.0">',
        '<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=5.0">',
        text,
    )
    return text


HERO_HTML = """<div class="header-slider">
			<div class="header-slider__img">
				<h1 class="hero-title">Мебель для вашего комфорта</h1>
				<picture>
					<source type="image/avif" srcset="/images/hero/hero-320.avif 320w, /images/hero/hero-640.avif 640w, /images/hero/hero-768.avif 768w, /images/hero/hero-1024.avif 1024w, /images/hero/hero-1280.avif 1280w, /images/hero/hero-1920.avif 1920w" sizes="(min-width: 1200px) 1200px, 100vw">
					<source type="image/webp" srcset="/images/hero/hero-320.webp 320w, /images/hero/hero-640.webp 640w, /images/hero/hero-768.webp 768w, /images/hero/hero-1024.webp 1024w, /images/hero/hero-1280.webp 1280w, /images/hero/hero-1920.webp 1920w" sizes="(min-width: 1200px) 1200px, 100vw">
					<img src="/images/hero/hero-1280.jpg" srcset="/images/hero/hero-320.jpg 320w, /images/hero/hero-640.jpg 640w, /images/hero/hero-768.jpg 768w, /images/hero/hero-1024.jpg 1024w, /images/hero/hero-1280.jpg 1280w, /images/hero/hero-1920.jpg 1920w" sizes="(min-width: 1200px) 1200px, 100vw" alt="Диван и кровать магазина Simal" width="1280" height="533" fetchpriority="high" decoding="async">
				</picture>
			</div>
		</div>"""

def homepage_extras(text: str) -> str:
    text = re.sub(r"<title>.*?</title>", f"<title>{html.escape(TITLE)}</title>", text, count=1, flags=re.S)
    text = re.sub(
        r'(<meta name="description" content=").*?(")',
        rf"\1{html.escape(DESCRIPTION, quote=True)}\2",
        text,
        count=1,
        flags=re.S,
    )
    text = re.sub(
        r'(<meta property="og:title" content=").*?(")',
        rf"\1{html.escape(TITLE, quote=True)}\2",
        text,
        count=1,
        flags=re.S,
    )
    text = re.sub(
        r'(<meta property="og:description" content=").*?(")',
        rf"\1{html.escape(DESCRIPTION, quote=True)}\2",
        text,
        count=1,
        flags=re.S,
    )
    if 'property="og:locale"' not in text:
        text = text.replace(
            '<meta property="og:type" content="website">',
            '<meta property="og:type" content="website">\n'
            '\t<meta property="og:locale" content="ru_RU">',
            1,
        )
    text = text.replace(
        'content="https://simal.ge/images/logo.png"',
        'content="https://simal.ge/images/hero/hero-1280.jpg"',
    )
    if 'property="og:image:width"' not in text:
        text = text.replace(
            '<meta property="og:image" content="https://simal.ge/images/hero/hero-1280.jpg">',
            '<meta property="og:image" content="https://simal.ge/images/hero/hero-1280.jpg">\n'
            '\t<meta property="og:image:width" content="1280">\n'
            '\t<meta property="og:image:height" content="533">\n'
            '\t<meta property="og:image:alt" content="Диван и кровать магазина Simal">',
            1,
        )
    if 'name="twitter:card"' not in text:
        text = text.replace(
            "<!-- /Open Graph -->",
            '<meta name="twitter:card" content="summary_large_image">\n'
            f'\t<meta name="twitter:title" content="{html.escape(TITLE, quote=True)}">\n'
            f'\t<meta name="twitter:description" content="{html.escape(DESCRIPTION, quote=True)}">\n'
            '\t<meta name="twitter:image" content="https://simal.ge/images/hero/hero-1280.jpg">\n'
            "\t\t<!-- /Open Graph -->",
            1,
        )
    if "hreflang" not in text:
        text = text.replace(
            "<!-- /Open Graph -->",
            '<link rel="alternate" hreflang="ru" href="https://simal.ge/">\n'
            '\t<link rel="alternate" hreflang="en" href="https://simal.ge/en/">\n'
            '\t<link rel="alternate" hreflang="ka" href="https://simal.ge/ge/">\n'
            '\t<link rel="alternate" hreflang="x-default" href="https://simal.ge/">\n'
            "\t\t<!-- /Open Graph -->",
            1,
        )
    text = text.replace(
        "<h1>Продажа кроватей и диванов в Батуми и Грузии.</h1>",
        "<h2>Продажа кроватей и диванов в Батуми и Грузии.</h2>",
        1,
    )
    text = text.replace("<h4>Мы в социальных сетях<br>", "<h2>Мы в социальных сетях<br>", 1)
    text = text.replace("</h4>", "</h2>", 1)
    text = text.replace('alt="телега.png"', 'alt="Telegram"')
    text = text.replace('alt="фэйс.png"', 'alt="Facebook"')
    text = text.replace('alt="инста.png"', 'alt="Instagram"')
    if 'class="hero-title"' not in text:
        start = text.find('<div class="header-slider owl-carousel owl-theme">')
        end = text.find("<!-- /header-slider -->")
        if start != -1 and end != -1 and start < end:
            text = text[:start] + HERO_HTML + "\n\t\t\t" + text[end:]
    if 'application/ld+json' not in text:
        text = text.replace("</body>", JSON_LD + "\n</body>", 1)
    return text


JSON_LD = r"""<script type="application/ld+json">
{"@context":"https://schema.org","@graph":[
{"@type":"WebSite","@id":"https://simal.ge/#website","name":"Simal","url":"https://simal.ge/"},
{"@type":"Organization","@id":"https://simal.ge/#organization","name":"Simal","legalName":"Simal2023 LLC","url":"https://simal.ge/","email":"info@simal.ge","telephone":["+995571100515","+995579404041"],"address":[
{"@type":"PostalAddress","streetAddress":"ул. Давида Агмашенебели, 13 Т","addressLocality":"Батуми","addressCountry":"GE"},
{"@type":"PostalAddress","streetAddress":"проспект Давида Гурамишвили, 17 Б","addressLocality":"Тбилиси","addressCountry":"GE"}
]}
]}
</script>"""


def build_hero() -> None:
    HERO_DIR.mkdir(parents=True, exist_ok=True)
    image = Image.open(HERO_SRC).convert("RGB")
    pixels = image.load()
    width, height = image.size
    for y in range(320, 420):
        for x in range(width):
            pixels[x, y] = (255, 255, 255)
    for slot in WIDTHS:
        frame = image.resize((slot, round(slot * height / width)), Image.Resampling.LANCZOS)
        frame.save(HERO_DIR / f"hero-{slot}.avif", quality=50)
        frame.save(HERO_DIR / f"hero-{slot}.webp", quality=75)
        frame.save(HERO_DIR / f"hero-{slot}.jpg", quality=82, optimize=True)
    logo_src = ROOT / "upload/main/a9b/pwxen21mubcjnq0piq12ajhfnk914m29.png"
    if logo_src.is_file():
        logo = Image.open(logo_src).convert("RGBA")
        logo.thumbnail((512, 512))
        out = Image.new("RGBA", logo.size, (255, 255, 255, 0))
        out.paste(logo, (0, 0))
        (ROOT / "images").mkdir(exist_ok=True)
        out.convert("RGB").save(ROOT / "images" / "logo.png")
    icon_src = ROOT / "upload/main/4e3/mshfxe4kgz4k8t1fjvlkk66cofqraex2"
    if icon_src.is_file():
        icon = Image.open(icon_src).convert("RGBA")
        icon = icon.resize((48, 48), Image.Resampling.LANCZOS)
        bg = Image.new("RGB", (48, 48), (255, 255, 255))
        bg.paste(icon, mask=icon.getchannel("A") if "A" in icon.getbands() else None)
        bg.save(ROOT / "favicon.png")


def write_sitemap(urls: list[str]) -> None:
    rows = ["<?xml version=\"1.0\" encoding=\"UTF-8\"?>", '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']
    for url in urls:
        rows.append("  <url>")
        rows.append(f"    <loc>{html.escape(url)}</loc>")
        rows.append("  </url>")
    rows.append("</urlset>")
    (ROOT / "sitemap.xml").write_text("\n".join(rows) + "\n", encoding="utf-8")


def write_headers() -> None:
    (ROOT / "_headers").write_text(
        "/*\n"
        "  X-Content-Type-Options: nosniff\n"
        "  X-Frame-Options: DENY\n"
        "  Referrer-Policy: strict-origin-when-cross-origin\n"
        "  Permissions-Policy: camera=(), microphone=(), geolocation=()\n"
        "  Strict-Transport-Security: max-age=86400\n"
        "/\n"
        "  Cache-Control: max-age=0, must-revalidate\n"
        "/*.html\n"
        "  Cache-Control: max-age=0, must-revalidate\n"
        "/robots.txt\n"
        "  Cache-Control: max-age=0, must-revalidate\n"
        "/sitemap.xml\n"
        "  Cache-Control: max-age=0, must-revalidate\n",
        encoding="utf-8",
    )
    (ROOT / "robots.txt").write_text(
        "User-agent: *\nAllow: /\nSitemap: https://simal.ge/sitemap.xml\n",
        encoding="utf-8",
    )


def main() -> None:
    print("title_chars", len(TITLE), "desc_chars", len(DESCRIPTION))
    if len(TITLE) > 60 or len(DESCRIPTION) > 160:
        raise SystemExit("title or description is too long")
    build_hero()
    urls: list[str] = []
    changed = 0
    for path in ROOT.rglob("*.html"):
        text = path.read_text(encoding="utf-8", errors="replace")
        original = text
        url = page_url(path)
        urls.append(url)
        text = strip_metrika(text)
        text = strip_missing_assets(text)
        text = common_clean(text)
        text = insert_head(text, url)
        text = wrap_main(text, lang_of(url))
        if path == ROOT / "index.html":
            text = homepage_extras(text)
        if text != original:
            path.write_text(text, encoding="utf-8")
            changed += 1
    urls = sorted(set(urls))
    write_sitemap(urls)
    write_headers()
    print("html_changed", changed, "urls", len(urls))


if __name__ == "__main__":
    main()
