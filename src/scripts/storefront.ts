import { localePath, messages, formatPrice, formatProductCount } from '../lib/i18n';
import type { Catalog, Language, Product } from '../lib/types';
import {
  STORAGE_KEY,
  LEGACY_KEYS,
  normalizeState,
  addItem,
  setQuantity,
  removeItem,
  toggleFavorite,
  consumeSnapshot,
  MAX_ITEMS,
} from '../lib/selection-state.mjs';

type State = {
  schemaVersion: number;
  items: { id: string; quantity: number }[];
  favorites: string[];
};
const lang = (document.body.dataset.lang || 'ru') as Language;
const t = messages(lang);
const $ = <T extends Element = HTMLElement>(selector: string, root: ParentNode = document) =>
  root.querySelector<T>(selector);
const $$ = <T extends Element = HTMLElement>(selector: string, root: ParentNode = document) => [
  ...root.querySelectorAll<T>(selector),
];
let state: State = normalizeState(null),
  storageAvailable = true,
  catalog: Catalog | undefined;
let busy = false,
  toastTimer: ReturnType<typeof setTimeout>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function createAttempt(key: string) {
  let memoryHash = '';
  let memoryRequestId = '';
  async function requestIdFor(serialized: string): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(serialized));
    const hash = [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
    if (memoryHash === hash && UUID.test(memoryRequestId)) return memoryRequestId;
    let previous: { hash?: string; requestId?: string } | undefined;
    try {
      previous = JSON.parse(sessionStorage.getItem(key) || 'null') || undefined;
    } catch {
      /* Memory still permits retries when session storage is blocked. */
    }
    memoryHash = hash;
    memoryRequestId =
      previous?.hash === hash &&
      typeof previous.requestId === 'string' &&
      UUID.test(previous.requestId)
        ? previous.requestId
        : crypto.randomUUID();
    // A digest and opaque UUID let a retry recover an uncertain prior attempt.
    try {
      sessionStorage.setItem(key, JSON.stringify({ hash, requestId: memoryRequestId }));
    } catch {
      /* Optional persistence; retain the in-memory attempt. */
    }
    return memoryRequestId;
  }
  function clear() {
    memoryHash = '';
    memoryRequestId = '';
    try {
      sessionStorage.removeItem(key);
    } catch {
      /* No persistent attempt was required. */
    }
  }
  return { requestIdFor, clear };
}
const cartAttempt = createAttempt('simal:quote-attempt:v1');
const enquiryAttempt = createAttempt('simal:enquiry-attempt:v1');

async function postQuote(payload: object, requestId: string) {
  const response = await fetch('/api/quote', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...payload, requestId }),
    signal: AbortSignal.timeout(20000),
  });
  const result = await response.json().catch(() => null);
  const receipt = response.ok &&
    result?.status === 'accepted' &&
    typeof result.id === 'string' &&
    /^SIM-\d{8}-[A-F0-9]{8}$/.test(result.id) &&
    result.requestId === requestId
      ? { id: result.id as string, pending: result.notification === 'pending' }
      : null;
  return { status: response.status, receipt };
}
function readStored(): State {
  try {
    let raw = localStorage.getItem(STORAGE_KEY);
    if (!raw)
      for (const key of LEGACY_KEYS) {
        raw = localStorage.getItem(key);
        if (raw) break;
      }
    const next = normalizeState(raw);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    return next;
  } catch {
    storageAvailable = false;
    return state;
  }
}
state = readStored();
function notify(message: string) {
  const toast = $('[data-toast]');
  if (!toast) return;
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.hidden = true;
  }, 3200);
}
function save(next: State) {
  state = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    storageAvailable = false;
  }
  syncControls();
  renderSelection();
}
function productFor(id: string) {
  return catalog?.products.find((p) => p.id === id && p.active);
}
function productText(p: Product) {
  return (
    p.translations[lang] ||
    p.translations.ru ||
    p.translations.en ||
    p.translations.ka || { title: p.id }
  );
}
function productLink(p: Product) {
  return productText(p).url || p.translations.ru?.url || localePath(lang, 'catalog');
}
function syncControls() {
  $$('[data-count]').forEach((el) => {
    const count =
      el.dataset.count === 'cart'
        ? state.items.reduce((s, i) => s + i.quantity, 0)
        : state.favorites.length;
    el.textContent = String(count);
    el.hidden = count === 0;
  });
  $$<HTMLButtonElement>('[data-favorite]').forEach((button) => {
    const active = state.favorites.includes(button.dataset.favorite!);
    button.setAttribute('aria-pressed', String(active));
    button.setAttribute(
      'aria-label',
      (active ? t.unfavorite : t.favorite) +
        (productFor(button.dataset.favorite!)
          ? ': ' + productText(productFor(button.dataset.favorite!)!).title
          : button.dataset.productTitle ? ': ' + button.dataset.productTitle : ''),
    );
  });
  $$<HTMLButtonElement>('[data-add]').forEach((button) => {
    const inCart = state.items.some((i) => i.id === button.dataset.add);
    button.dataset.inCart = String(inCart);
  });
  const warning = $('[data-storage-warning]');
  if (warning) warning.hidden = storageAvailable;
}
function quantityForDetail() {
  const input = $<HTMLInputElement>('#product-quantity');
  return Math.max(1, Math.min(9999, Math.floor(Number(input?.value) || 1)));
}
function add(id: string, quantity = 1) {
  const product = productFor(id);
  if (!product || product.availability === 'out_of_stock') {
    notify(t.productUnavailable);
    return;
  }
  if (state.items.length >= MAX_ITEMS && !state.items.some((i) => i.id === id)) {
    notify(
      lang === 'ru'
        ? 'В одной заявке может быть до 50 разных товаров.'
        : lang === 'ka'
          ? 'ერთ განაცხადში მაქსიმუმ 50 პროდუქტია.'
          : 'Up to 50 different products per enquiry.',
    );
    return;
  }
  save(addItem(state, id, quantity));
  notify(t.added);
}
function setText(root: ParentNode, selector: string, text: string) {
  const node = $(selector, root);
  if (node) node.textContent = text;
}
function renderSelection() {
  const page = $('[data-selection-page]');
  if (!page || !catalog) return;
  const favorites = page.dataset.selectionPage === 'favorites';
  const entries = favorites ? state.favorites.map((id) => ({ id, quantity: 1 })) : state.items;
  const content = $('[data-selection-content]'),
    empty = $('[data-selection-empty]'),
    rows = $('[data-selection-rows]');
  if (content) content.hidden = entries.length === 0;
  if (empty) empty.hidden = entries.length > 0;
  if (!rows) return;
  const template = $<HTMLTemplateElement>('#selection-row-template');
  if (!template) return;
  // Only the list is rebuilt. The contact form lives outside this subtree.
  const focus = document.activeElement as HTMLInputElement | null;
  const activeRow = focus?.closest<HTMLElement>('[data-row-id]');
  const activeId = activeRow?.dataset.rowId,
    selection = focus?.tagName === 'INPUT';
  const fragment = document.createDocumentFragment();
  let total = 0,
    unknown = false,
    unavailable = false;
  for (const entry of entries) {
    const clone = template.content.cloneNode(true) as DocumentFragment;
    const row = $<HTMLElement>('.selection-row', clone)!;
    row.dataset.rowId = entry.id;
    const product = productFor(entry.id);
    const title = product ? productText(product).title : entry.id;
    const links = $$<HTMLAnchorElement>('[data-row-link],[data-row-title]', clone);
    for (const link of links) {
      link.href = product ? productLink(product) : localePath(lang, 'catalog');
    }
    setText(clone, '[data-row-title]', title);
    const image = $<HTMLImageElement>('[data-row-image]', clone)!;
    const placeholder = $('[data-row-placeholder]', clone)!;
    if (product?.images[0]) {
      image.src = product.images[0].src;
      image.alt = product.images[0].alt || title;
      placeholder.hidden = true;
      image.addEventListener(
        'error',
        () => {
          image.hidden = true;
          placeholder.hidden = false;
        },
        { once: true },
      );
    } else image.hidden = true;
    const invalid = !product || product.availability === 'out_of_stock';
    unavailable ||= invalid;
    const note = $('[data-row-unavailable]', clone)!;
    note.hidden = !invalid;
    setText(clone, '[data-row-price]', product ? formatPrice(product.price, lang) : '—');
    if (product?.price != null) total += product.price * entry.quantity;
    else unknown = true;
    const quantity = $('[data-row-quantity]', clone)!;
    quantity.hidden = favorites;
    const input = $<HTMLInputElement>('input', quantity)!;
    input.value = String(entry.quantity);
    input.addEventListener('change', () => save(setQuantity(state, entry.id, input.value)));
    $('[data-row-minus]', clone)!.addEventListener('click', () =>
      save(setQuantity(state, entry.id, Math.max(1, entry.quantity - 1))),
    );
    $('[data-row-plus]', clone)!.addEventListener('click', () =>
      save(setQuantity(state, entry.id, entry.quantity + 1)),
    );
    const addButton = $<HTMLButtonElement>('[data-row-add]', clone)!;
    addButton.hidden = !favorites;
    addButton.disabled = invalid;
    addButton.addEventListener('click', () => add(entry.id));
    $('[data-row-remove]', clone)!.addEventListener('click', () =>
      save(favorites ? toggleFavorite(state, entry.id) : removeItem(state, entry.id)),
    );
    fragment.append(clone);
  }
  rows.replaceChildren(fragment);
  if (selection && activeId) {
    const next = $<HTMLInputElement>('[data-row-id="' + CSS.escape(activeId) + '"] input', rows);
    next?.focus();
  }
  setText(document, '[data-subtotal]', formatPrice(total, lang));
  const prices = $('[data-unknown-prices]');
  if (prices) prices.hidden = !unknown;
  const submit = $<HTMLButtonElement>('[data-quote-submit]');
  if (submit) submit.disabled = busy || unavailable;
  updateWhatsapp();
}
function updateWhatsapp() {
  const link = $<HTMLAnchorElement>('[data-whatsapp]');
  if (!link) return;
  const text = [
    'SIMAL',
    ...state.items.map((item) => {
      const p = productFor(item.id);
      return (
        (p ? productText(p).title : item.id) +
        ' × ' +
        item.quantity +
        ' ' +
        (p ? 'https://simal.ge' + productLink(p) : '')
      );
    }),
  ].join('\n');
  link.href = 'https://wa.me/995571100515?text=' + encodeURIComponent(text);
}
function initSelection() {
  $('[data-clear-selection]')?.addEventListener('click', () => {
    if (!confirm(t.clearConfirm)) return;
    const favorites = $('[data-selection-page]')?.dataset.selectionPage === 'favorites';
    save({
      ...state,
      items: favorites ? state.items : [],
      favorites: favorites ? [] : state.favorites,
    });
  });
  const form = $<HTMLFormElement>('[data-quote-form]');
  if (!form) return;
  const cityInput = $<HTMLInputElement>('[name="city"]', form),
    commentInput = $<HTMLTextAreaElement>('[name="comment"]', form);
  const updateCommentLimit = () => {
    if (commentInput) {
      const city = cityInput?.value.trim() || '';
      commentInput.maxLength = Math.min(
        1400,
        1500 - (city ? t.city.length + 2 + city.length + 1 : 0),
      );
    }
  };
  cityInput?.addEventListener('input', updateCommentLimit);
  updateCommentLimit();
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (busy || !state.items.length || !catalog) return;
    const fields = new FormData(form);
    const name = String(fields.get('customerName') || '').trim();
    const contact = String(fields.get('contact') || '').trim();
    const city = String(fields.get('city') || '').trim(),
      comment = String(fields.get('comment') || '').trim();
    const combined = [city ? t.city + ': ' + city : '', comment].filter(Boolean).join('\n');
    const status = $('[data-quote-status]')!;
    status.classList.add('form-message--error');
    if (
      name.length < 2 ||
      name.length > 100 ||
      contact.length > 120 ||
      !(
        /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact) ||
        (/^[+\d\s()\-]+$/.test(contact) && contact.replace(/\D/g, '').length >= 7)
      ) ||
      combined.length > 1500
    ) {
      status.textContent =
        combined.length > 1500
          ? lang === 'ru'
            ? 'Сократите комментарий до 1500 символов.'
            : lang === 'ka'
              ? 'კომენტარი მაქსიმუმ 1500 სიმბოლოა.'
              : 'Please keep your comment under 1500 characters.'
          : t.formInvalid;
      form.querySelector<HTMLInputElement>('input:invalid')?.focus();
      return;
    }
    if (
      state.items.some(
        (i) => !productFor(i.id) || productFor(i.id)?.availability === 'out_of_stock',
      )
    ) {
      status.textContent = t.productUnavailable;
      return;
    }
    const snapshot = state.items.map((i) => ({ ...i }));
    const payload = {
      name,
      contact,
      comment: combined,
      lang,
      items: snapshot,
      website: String(fields.get('website') || ''),
    };
    const serialized = JSON.stringify({
      ...payload,
      items: [...snapshot].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    });
    busy = true;
    const fieldset = $<HTMLFieldSetElement>('[data-quote-fields]')!;
    fieldset.disabled = true;
    const submit = $<HTMLButtonElement>('[data-quote-submit]')!;
    const label = submit.firstChild;
    const previousLabel = label?.textContent;
    if (label) label.textContent = t.sending;
    status.textContent = '';
    try {
      // Busy is set before the first await, preventing double clicks while hashing.
      const requestId = await cartAttempt.requestIdFor(serialized);
      const { status: responseStatus, receipt } = await postQuote(payload, requestId);
      if (!receipt) {
        status.textContent =
          responseStatus === 503
            ? t.unavailableServer
            : responseStatus === 400 || responseStatus === 409
              ? t.serverInvalid
              : t.sendError;
        return;
      }
      const success = $('[data-quote-success]')!;
      setText(success, '[data-quote-number]', receipt.id);
      $('[data-notification-pending]', success)!.hidden = !receipt.pending;
      success.hidden = false;
      // Read other tabs' latest basket before consuming only the submitted snapshot.
      state = readStored();
      save(consumeSnapshot(state, snapshot));
      cartAttempt.clear();
      form.reset();
      updateCommentLimit();
      status.classList.remove('form-message--error');
      status.textContent = t.received;
      success.scrollIntoView({
        behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
        block: 'center',
      });
    } catch {
      status.textContent = t.sendError;
    } finally {
      busy = false;
      fieldset.disabled = false;
      if (label) label.textContent = previousLabel || t.submit;
      syncControls();
      renderSelection();
    }
  });
}
function initEnquiry() {
  const dialog = $<HTMLDialogElement>('#mobile-enquiry');
  const form = dialog && $<HTMLFormElement>('[data-enquiry-form]', dialog);
  if (!dialog || !form) return;
  const fieldset = $<HTMLFieldSetElement>('fieldset', form)!;
  const submit = $<HTMLButtonElement>('button[type="submit"]', form)!;
  const status = $('[data-enquiry-status]', form)!;
  for (const opener of $$('[data-enquiry-open]')) {
    opener.addEventListener('click', () => dialog.showModal());
  }
  $('[data-enquiry-close]', dialog)?.addEventListener('click', () => dialog.close());

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (fieldset.disabled) return;
    const data = new FormData(form);
    const value = (name: string) => String(data.get(name) || '').trim();
    const payload = {
      kind: 'enquiry', name: value('customerName'), contact: value('contact'),
      comment: value('comment'), website: value('website'), lang, items: [],
    };
    if (payload.name.length < 2 || payload.comment.length < 2 ||
      !/^[+\d\s()\-]+$/.test(payload.contact) || payload.contact.replace(/\D/g, '').length < 7) {
      status.textContent = t.enquiryInvalid;
      status.classList.add('form-message--error');
      return;
    }
    fieldset.disabled = true;
    submit.textContent = t.sending;
    status.textContent = '';
    status.classList.remove('form-message--error');
    try {
      const requestId = await enquiryAttempt.requestIdFor(JSON.stringify(payload));
      const { status: responseStatus, receipt } = await postQuote(payload, requestId);
      if (receipt) {
        form.reset();
        enquiryAttempt.clear();
        status.textContent = `${t.received}. ${receipt.id}${receipt.pending ? ` · ${t.pendingNotification}` : ''}`;
        return;
      }
      status.textContent = responseStatus === 400 ? t.enquiryInvalid : t.enquiryError;
      status.classList.add('form-message--error');
    } catch {
      status.textContent = t.enquiryError;
      status.classList.add('form-message--error');
    } finally {
      fieldset.disabled = false;
      submit.textContent = t.submit;
    }
  });
}
function initListing() {
  const root = $('[data-catalog-list]');
  if (!root || !catalog) return;
  const grid = $('[data-product-grid]', root)!;
  const cards = $$<HTMLElement>('[data-product-id]', grid);
  let limit = 24;
  const params = new URLSearchParams(location.search);
  const min = $<HTMLInputElement>('[data-price-min]', root)!,
    max = $<HTMLInputElement>('[data-price-max]', root)!,
    stock = $<HTMLInputElement>('[data-stock]', root)!,
    sort = $<HTMLSelectElement>('[data-sort]', root)!;
  const query = $<HTMLInputElement>('[data-query]', root);
  if (query) query.value = params.get('q') || '';
  const headerQuery = $<HTMLInputElement>('#header-query');
  if (headerQuery) headerQuery.value = params.get('q') || '';
  min.value = params.get('min') || '';
  max.value = params.get('max') || '';
  stock.checked = params.get('stock') === '1';
  sort.value = ['default', 'price-asc', 'price-desc', 'name'].includes(params.get('sort') || '')
    ? params.get('sort')!
    : 'default';
  const apply = (updateUrl = false) => {
    const q = (query?.value || params.get('q') || '').trim().toLocaleLowerCase(lang);
    const matches = cards.filter((card) => {
      const p = productFor(card.dataset.productId!);
      if (!p) return false;
      const text = productText(p);
      return (
        (!q ||
          [
            text.title,
            p.sku || '',
            p.id,
            text.summary || '',
            ...(text.attributes || []).map((a) => a.value),
          ]
            .join(' ')
            .toLocaleLowerCase(lang)
            .includes(q)) &&
        (!min.value || (p.price !== null && p.price >= Number(min.value))) &&
        (!max.value || (p.price !== null && p.price <= Number(max.value))) &&
        (!stock.checked || p.availability === 'in_stock')
      );
    });
    matches.sort((a, b) => {
      const x = productFor(a.dataset.productId!)!,
        y = productFor(b.dataset.productId!)!;
      if (sort.value === 'price-asc') return (x.price ?? Infinity) - (y.price ?? Infinity);
      if (sort.value === 'price-desc') return (y.price ?? -Infinity) - (x.price ?? -Infinity);
      if (sort.value === 'name')
        return productText(x).title.localeCompare(productText(y).title, lang);
      return cards.indexOf(a) - cards.indexOf(b);
    });
    cards.forEach((card) => {
      card.hidden = true;
    });
    matches.forEach((card, i) => {
      grid.append(card);
      card.hidden = i >= limit;
    });
    setText(root, '[data-result-summary]', formatProductCount(matches.length, lang));
    $('[data-no-results]', root)!.hidden = matches.length > 0;
    $('[data-load-more]', root)!.hidden = matches.length <= limit;
    if (updateUrl) {
      for (const [key, value] of [
        ['min', min.value],
        ['max', max.value],
        ['stock', stock.checked ? '1' : ''],
        ['sort', sort.value === 'default' ? '' : sort.value],
      ]) {
        if (value) params.set(key, value);
        else params.delete(key);
      }
      if (query) {
        if (q) params.set('q', query.value.trim());
        else params.delete('q');
      }
      history.replaceState(
        null,
        '',
        location.pathname + (params.size ? '?' + params.toString() : ''),
      );
    }
  };
  for (const input of [min, max, stock, sort])
    input.addEventListener('change', () => {
      limit = 24;
      apply(true);
    });
  $$('[data-reset-filters]', root).forEach((button) =>
    button.addEventListener('click', () => {
      min.value = '';
      max.value = '';
      stock.checked = false;
      sort.value = 'default';
      if (query) query.value = '';
      params.delete('q');
      limit = 24;
      apply(true);
    }),
  );
  $('[data-load-more]', root)?.addEventListener('click', () => {
    limit += 24;
    apply();
  });
  apply();
}
const filterToggle = $<HTMLButtonElement>('[data-filter-toggle]');
const filterPanel = $('#catalog-filters');
if (filterToggle && filterPanel) {
  filterPanel.classList.add('is-collapsible');
  filterToggle.hidden = false;
  filterToggle.addEventListener('click', () => {
    const open = filterPanel.classList.toggle('is-open');
    filterToggle.setAttribute('aria-expanded', String(open));
  });
}
const headerMain = $('[data-header-main]');
if (headerMain) {
  const callOptions = $<HTMLElement>('#header-call-options');
  const observer = new IntersectionObserver(([entry]) => {
    const compact = entry.intersectionRatio < 0.01 && entry.boundingClientRect.top < 0;
    document.body.toggleAttribute('data-compact-header', compact);
    callOptions?.hidePopover?.();
  }, { threshold: 0.01 });
  observer.observe(headerMain);
  $$<HTMLButtonElement>('[popovertarget="header-call-options"]').forEach((button) => {
    button.addEventListener('click', () => {
      const { bottom, right } = button.getBoundingClientRect();
      callOptions?.style.setProperty('--call-options-top', `${bottom + 6}px`);
      callOptions?.style.setProperty('--call-options-right', `${Math.max(18, document.documentElement.clientWidth - right)}px`);
    });
  });
}

const menuButton = $<HTMLButtonElement>('[data-menu-toggle]');
const mobileMenu = $('#mobile-navigation');
const menuBackground = $$<HTMLElement>('[data-menu-background]');
const desktopCatalog = $<HTMLDetailsElement>('.category-nav [data-header-catalog]');

function setMobileMenu(open: boolean) {
  if (!menuButton || !mobileMenu) return;
  menuButton.setAttribute('aria-expanded', String(open));
  mobileMenu.hidden = !open;
  menuBackground.forEach((element) => { element.inert = open; });
}

menuButton?.addEventListener('click', () => setMobileMenu(!!mobileMenu?.hidden));
const mobileViewport = matchMedia('(max-width: 767px)');
mobileViewport.addEventListener('change', () => {
  if (!mobileViewport.matches) setMobileMenu(false);
  else if (desktopCatalog) desktopCatalog.open = false;
});
document.addEventListener('click', (event) => {
  if (desktopCatalog?.open && !desktopCatalog.contains(event.target as Node)) {
    desktopCatalog.open = false;
  }
});
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape' || $('dialog[open]') || $('.call-options:popover-open')) return;
  if (mobileMenu && !mobileMenu.hidden) {
    setMobileMenu(false);
    menuButton?.focus();
  } else if (desktopCatalog?.open) {
    desktopCatalog.open = false;
    desktopCatalog.querySelector('summary')?.focus();
  }
});
document.addEventListener('click', (event) => {
  const target = event.target as Element;
  const favorite = target.closest<HTMLElement>('[data-favorite]');
  if (favorite) {
    save(toggleFavorite(state, favorite.dataset.favorite));
    return;
  }
  const addButton = target.closest<HTMLButtonElement>('[data-add]');
  if (addButton && !addButton.disabled) {
    add(
      addButton.dataset.add!,
      addButton.closest('[data-detail-product]') ? quantityForDetail() : 1,
    );
    return;
  }
  const gallery = target.closest<HTMLElement>('[data-gallery-src]');
  if (gallery) {
    const image = $<HTMLImageElement>('[data-main-image] img');
    if (image) {
      image.src = gallery.dataset.gallerySrc!;
      image.removeAttribute('srcset');
    }
  }
});
$('[data-detail-minus]')?.addEventListener('click', () => {
  const input = $<HTMLInputElement>('#product-quantity')!;
  input.value = String(Math.max(1, quantityForDetail() - 1));
});
$('[data-detail-plus]')?.addEventListener('click', () => {
  const input = $<HTMLInputElement>('#product-quantity')!;
  input.value = String(Math.min(9999, quantityForDetail() + 1));
});
window.addEventListener('storage', (event) => {
  if (event.key === STORAGE_KEY || event.key === null) {
    state = normalizeState(event.newValue);
    syncControls();
    renderSelection();
  }
});
syncControls();
initEnquiry();
fetch('/data/catalog.json')
  .then(async (response) => {
    if (!response.ok) throw new Error('catalog');
    const data: Catalog = await response.json();
    if (data.schemaVersion !== 1 || !Array.isArray(data.products)) throw new Error('catalog');
    catalog = data;
    syncControls();
    renderSelection();
    initListing();
    initSelection();
  })
  .catch(() => {
    if ($('[data-selection-page]')) {
      const rows = $('[data-selection-rows]');
      if (rows) {
        rows.textContent = t.sendError;
        rows.setAttribute('role', 'alert');
      }
    }
  });
