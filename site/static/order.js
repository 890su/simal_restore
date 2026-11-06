(function () {
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
