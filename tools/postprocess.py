"""Make the archived Bitrix HTML safe to host as a static site.

The visual markup stays as archived. Dead Bitrix endpoints are disconnected:
session tokens are cleared, the telemetry ping is removed, and cart/callback
forms open WhatsApp instead of posting to a server that no longer exists.
"""

from pathlib import Path
import re

ROOT = Path(r"d:\aibrain\04_projects\simal-ge\site")
SNIPPET = '<script src="/static/order.js" defer></script>'

SESSID_RE = re.compile(r"bitrix_sessid':'[a-f0-9]+'")
BA_RE = re.compile(
    r"<script[^>]*>var _ba = _ba \|\| \[\];.*?</script>",
    re.I | re.S,
)
METRICS_RE = re.compile(
    r"<script[^>]*>;?window\.ww_metrics_check=false;.*?</script>",
    re.I | re.S,
)


def main() -> None:
    order = ROOT / "static" / "order.js"
    order.parent.mkdir(parents=True, exist_ok=True)
    order.write_text(ORDER_JS, encoding="utf-8")
    changed = 0
    for path in ROOT.rglob("*.html"):
        text = path.read_text(encoding="utf-8", errors="replace")
        updated = SESSID_RE.sub("bitrix_sessid':''", text)
        updated = BA_RE.sub("", updated)
        updated = METRICS_RE.sub("", updated)
        if SNIPPET not in updated and "</body>" in updated.lower():
            updated = re.sub(r"</body>", SNIPPET + "\n</body>", updated, count=1, flags=re.I)
        if updated != text:
            path.write_text(updated, encoding="utf-8")
            changed += 1
    (ROOT / "robots.txt").write_text(
        "User-agent: *\nAllow: /\nSitemap: https://simal.ge/sitemap.xml\n",
        encoding="utf-8",
    )
    (ROOT / "_headers").write_text(
        "/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n",
        encoding="utf-8",
    )
    print(f"updated {changed} html files")


ORDER_JS = r"""(function () {
  var WA = "995571100515";
  function textOf(node) {
    return (node && node.textContent || "").replace(/\s+/g, " ").trim();
  }
  document.addEventListener("click", function (event) {
    var btn = event.target.closest && event.target.closest(".catalog-cart-add");
    if (!btn) return;
    event.preventDefault();
    event.stopPropagation();
    var card = btn.closest(".catalog-section-tile__item, .catalog-detail, .product-item, .item");
    var title = textOf(card && card.querySelector(".catalog-section-tile__title-link, h1, .catalog-detail__title"));
    var qtyInput = card && card.querySelector("input[name='quantity']");
    var qty = qtyInput && qtyInput.value ? qtyInput.value : "1";
    var message = "Здравствуйте! Хочу заказать: " + (title || "товар с сайта SIMAL") + ". Количество: " + qty;
    window.open("https://wa.me/" + WA + "?text=" + encodeURIComponent(message), "_blank", "noopener");
  }, true);
  document.addEventListener("submit", function (event) {
    var form = event.target;
    if (!form || !form.classList || !form.classList.contains("feedback")) return;
    event.preventDefault();
    var name = (form.querySelector("[name='form_name']") || {}).value || "";
    var phone = (form.querySelector("[name='form_phone']") || {}).value || "";
    var comment = (form.querySelector("textarea") || {}).value || "";
    var message = "Заявка с сайта SIMAL\nИмя: " + name + "\nТелефон: " + phone + (comment ? "\n" + comment : "");
    window.open("https://wa.me/" + WA + "?text=" + encodeURIComponent(message), "_blank", "noopener");
  }, true);
})();
"""


if __name__ == "__main__":
    main()
