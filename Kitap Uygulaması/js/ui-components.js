/* =========================================================================
   Okur — UI bileşenleri
   İkon seti, Liquid Glass bottom sheet'ler (swipe-to-dismiss), action sheet,
   toast, segment kontrol, switch, hızlı kapak yükleyici + renk motoru,
   halka & grafikler, yıldız puanlama, Dinamik Ada zamanlayıcısı, swipe
   aksiyonları, sayaç ve ışık efektleri, paylaşım kartı (PNG) üretimi.
   ========================================================================= */

/* ---------- Yardımcılar ---------- */
export const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
export const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
}

export function haptic(pattern = 8) {
  try {
    if (navigator.userActivation?.hasBeenActive !== false) navigator.vibrate?.(pattern);
  } catch {
    /* iOS Safari titreşim API'sini desteklemez */
  }
}

/* ---------- SF Symbols tarzı ikonlar ---------- */
const ICONS = {
  sun: '<circle cx="12" cy="12" r="4.2"/><path d="M12 2.6v2.1M12 19.3v2.1M4.9 4.9l1.5 1.5M17.6 17.6l1.5 1.5M2.6 12h2.1M19.3 12h2.1M4.9 19.1l1.5-1.5M17.6 6.4l1.5-1.5"/>',
  moon: '<path d="M20.2 14.6A8.4 8.4 0 019.4 3.8a8.4 8.4 0 1010.8 10.8z"/>',
  sunMoon: '<path d="M12 3a9 9 0 000 18z" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="9"/>',
  books: '<rect x="3.5" y="4" width="4.6" height="16" rx="1.3"/><rect x="9.7" y="4" width="4.6" height="16" rx="1.3"/><path d="M15.9 5.6l3.8-1.1 3.3 14.9-3.8 1.1z"/>',
  chart: '<rect x="3.5" y="11" width="4.3" height="9" rx="1.4"/><rect x="9.85" y="4.5" width="4.3" height="15.5" rx="1.4"/><rect x="16.2" y="13.5" width="4.3" height="6.5" rx="1.4"/>',
  person: '<circle cx="12" cy="12" r="9.3"/><circle cx="12" cy="9.8" r="3.3"/><path d="M6.3 18.4c1.4-2.1 3.4-3.2 5.7-3.2s4.3 1.1 5.7 3.2"/>',
  people: '<circle cx="9" cy="8.6" r="3.3"/><path d="M3 19.4c.7-3.1 3.1-5 6-5s5.3 1.9 6 5"/><circle cx="16.6" cy="9.4" r="2.6"/><path d="M16.4 14.4c2.4.2 4 1.8 4.6 4.6"/>',
  personAdd: '<circle cx="10" cy="8.6" r="3.4"/><path d="M3.6 19.4c.7-3.2 3.2-5.1 6.4-5.1 1.4 0 2.7.4 3.7 1.1M18.5 13.5v6M15.5 16.5h6"/>',
  at: '<circle cx="12" cy="12" r="3.8"/><path d="M15.8 12v1.4a2.6 2.6 0 005.2 0V12a9 9 0 10-3.6 7.2"/>',
  link: '<path d="M10 14a4.2 4.2 0 006 0l3-3a4.2 4.2 0 00-6-6l-1 1M14 10a4.2 4.2 0 00-6 0l-3 3a4.2 4.2 0 006 6l1-1"/>',
  layout: '<rect x="3.5" y="3.5" width="17" height="17" rx="3.5"/><path d="M3.5 9h17M9.5 9v11.5"/>',
  gear: '<circle cx="12" cy="12" r="3.1"/><path d="M19.4 13.5l1.6 1.2-1.9 3.3-1.9-.7a7.5 7.5 0 01-2.1 1.2l-.3 2h-3.8l-.3-2a7.5 7.5 0 01-2.1-1.2l-1.9.7L4.8 14.7l1.6-1.2a7.6 7.6 0 010-3l-1.6-1.2 1.9-3.3 1.9.7a7.5 7.5 0 012.1-1.2l.3-2h3.8l.3 2a7.5 7.5 0 012.1 1.2l1.9-.7 1.9 3.3-1.6 1.2a7.6 7.6 0 010 3z"/>',
  grid: '<rect x="4" y="4" width="6.6" height="6.6" rx="1.8"/><rect x="13.4" y="4" width="6.6" height="6.6" rx="1.8"/><rect x="4" y="13.4" width="6.6" height="6.6" rx="1.8"/><rect x="13.4" y="13.4" width="6.6" height="6.6" rx="1.8"/>',
  list: '<path d="M9 6.5h11M9 12h11M9 17.5h11"/><circle cx="4.8" cy="6.5" r="1.1"/><circle cx="4.8" cy="12" r="1.1"/><circle cx="4.8" cy="17.5" r="1.1"/>',
  cloud: '<path d="M7 18.5h10.2a4.3 4.3 0 00.6-8.6 6 6 0 00-11.5 1.6A3.6 3.6 0 007 18.5z"/>',
  device: '<rect x="6.5" y="2.8" width="11" height="18.4" rx="2.8"/><path d="M10.5 18.2h3"/>',
  palette: '<path d="M12 3.5a8.5 8.5 0 000 17c1.2 0 1.8-.9 1.8-1.8 0-1.3-1-1.6-1-2.7 0-1 .8-1.6 1.8-1.6h2.1a3.8 3.8 0 003.8-3.8C20.5 6.9 16.7 3.5 12 3.5z"/><circle cx="7.8" cy="11.5" r="1.1"/><circle cx="10.2" cy="7.6" r="1.1"/><circle cx="14.6" cy="7.6" r="1.1"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5.5 12h13"/>',
  search: '<circle cx="11" cy="11" r="6.6"/><path d="M16 16l4.6 4.6"/>',
  barcode: '<path d="M3.5 8V5.6a2.1 2.1 0 012.1-2.1H8M16 3.5h2.4a2.1 2.1 0 012.1 2.1V8M20.5 16v2.4a2.1 2.1 0 01-2.1 2.1H16M8 20.5H5.6a2.1 2.1 0 01-2.1-2.1V16M7.5 8.2v7.6M10.3 8.2v7.6M13 8.2v7.6M16.5 8.2v7.6"/>',
  timer: '<circle cx="12" cy="13.4" r="7.6"/><path d="M12 9.6v3.9l2.6 1.8M9.6 2.6h4.8M12 2.6v3.2M18.6 6.2l1.3-1.3"/>',
  play: '<path d="M8 5.4v13.2a1 1 0 001.5.87l10.4-6.6a1 1 0 000-1.73L9.5 4.53A1 1 0 008 5.4z"/>',
  pause: '<rect x="6.3" y="4.8" width="4" height="14.4" rx="1.3"/><rect x="13.7" y="4.8" width="4" height="14.4" rx="1.3"/>',
  check: '<path d="M5 12.6l4.4 4.4L19 7.4"/>',
  chevronLeft: '<path d="M15 5l-7 7 7 7"/>',
  chevronRight: '<path d="M9 5l7 7-7 7"/>',
  close: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
  more: '<circle cx="5.5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="18.5" cy="12" r="1.8"/>',
  trash: '<path d="M4 6.6h16M9.4 6.6V4.9c0-.8.6-1.4 1.4-1.4h2.4c.8 0 1.4.6 1.4 1.4v1.7M6.4 6.6l.9 12.1a2 2 0 002 1.8h5.4a2 2 0 002-1.8l.9-12.1M10 10.6v5.8M14 10.6v5.8"/>',
  pencil: '<path d="M4 20l1-4.4L15.6 5a2 2 0 012.8 0l.6.6a2 2 0 010 2.8L8.4 19zM13.8 6.8l3.4 3.4"/>',
  bookOpen: '<path d="M12 6.6C10 5 7.4 4.4 3.5 4.4v13.2c3.9 0 6.5.6 8.5 2.2 2-1.6 4.6-2.2 8.5-2.2V4.4c-3.9 0-6.5.6-8.5 2.2zM12 6.6v13.2"/>',
  flame: '<path d="M12.2 2.4c.7 3.3-1.2 5.1-2.9 7C7.6 11.2 6 13.1 6 15.5c0 3.5 2.7 6.1 6 6.1s6-2.6 6-6.1c0-2.5-1.2-4.7-2.7-6-.2 1.7-1 2.8-2.2 3.3.5-3.7-.4-7.2-1.1-10.4z"/>',
  star: '<path d="M12 3.3l2.7 5.5 6 .9-4.4 4.2 1.1 6-5.4-2.8-5.4 2.8 1.1-6-4.4-4.2 6-.9z"/>',
  starFill: '<path d="M12 3.3l2.7 5.5 6 .9-4.4 4.2 1.1 6-5.4-2.8-5.4 2.8 1.1-6-4.4-4.2 6-.9z"/>',
  quote: '<path d="M9.6 6.2C6.5 7.2 4.6 9.7 4.6 13.3V18h5.3v-5.3H7.3c0-2.2 1-3.7 3-4.5zM19 6.2c-3.1 1-5 3.5-5 7.1V18h5.3v-5.3h-2.6c0-2.2 1-3.7 3-4.5z"/>',
  note: '<path d="M6.5 3.5h7.8L19 8.2v10.8a1.5 1.5 0 01-1.5 1.5h-11A1.5 1.5 0 015 19V5a1.5 1.5 0 011.5-1.5zM14 3.6v4.8h4.9M8.4 12.4h7.2M8.4 16h4.6"/>',
  share: '<path d="M12 3.4v11.4M7.6 7.6L12 3.4l4.4 4.2M5.2 11.2v7.3a2 2 0 002 2h9.6a2 2 0 002-2v-7.3"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="3.2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.3"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7.2V12l3.4 2.1"/>',
  bolt: '<path d="M13.2 2.6L4.6 13.4h6.6l-1 8 8.6-10.9h-6.6z"/>',
  trophy: '<path d="M7.6 4h8.8v5a4.4 4.4 0 01-8.8 0zM7.6 6H4.6c0 2.9 1.4 4.4 3.2 4.7M16.4 6h3c0 2.9-1.4 4.4-3.2 4.7M12 13.4v3.4M8.4 20.5h7.2M9.6 20.5c0-2 1-3.6 2.4-3.6s2.4 1.6 2.4 3.6"/>',
  folder: '<path d="M3.5 7.4a2 2 0 012-2h3.9l2 2.2h7.1a2 2 0 012 2V17a2 2 0 01-2 2h-13a2 2 0 01-2-2z"/>',
  bookmark: '<path d="M6.6 3.6h10.8v17L12 16.6l-5.4 4z"/>',
  flag: '<path d="M5.2 21V4.2M5.2 4.6c4-2 7.2 2 13.6 0v9c-6.4 2-9.6-2-13.6 0"/>',
  mail: '<rect x="3" y="5.4" width="18" height="13.2" rx="2.6"/><path d="M3.6 7.2l8.4 6 8.4-6"/>',
  lock: '<rect x="5" y="10.4" width="14" height="10.1" rx="2.6"/><path d="M8 10.4V8a4 4 0 018 0v2.4"/>',
  eye: '<path d="M2.6 12S6 5.6 12 5.6 21.4 12 21.4 12 18 18.4 12 18.4 2.6 12 2.6 12z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M2.6 12S6 5.6 12 5.6 21.4 12 21.4 12 18 18.4 12 18.4 2.6 12 2.6 12z"/><circle cx="12" cy="12" r="3"/><path d="M4 4l16 16"/>',
  logout: '<path d="M14 4.5H6.6a2 2 0 00-2 2v11a2 2 0 002 2H14M10 12h10.4M17 8.5l3.5 3.5-3.5 3.5"/>',
  sparkles: '<path d="M11 3.2l1.8 5.1 5.1 1.8-5.1 1.8L11 17l-1.8-5.1-5.1-1.8 5.1-1.8zM18.6 14.6l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z"/>',
  copy: '<rect x="8.6" y="8.6" width="11.9" height="11.9" rx="2.6"/><path d="M15.4 8.6V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7.4a2 2 0 002 2h2.6"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.6M12 7.7v.1"/>',
  download: '<path d="M12 4v11M7.6 10.6L12 15l4.4-4.4M5 19.6h14"/>',
  camera: '<path d="M4.4 8.2a2 2 0 012-2h1.9l1.6-2.1h4.2l1.6 2.1h1.9a2 2 0 012 2v9.4a2 2 0 01-2 2H6.4a2 2 0 01-2-2z"/><circle cx="12" cy="12.8" r="3.5"/>',
  refresh: '<path d="M20 11.4A8 8 0 006.3 6.3L4 8.5M4 4v4.5h4.5M4 12.6a8 8 0 0013.7 5.1l2.3-2.2M20 20v-4.5h-4.5"/>',
  arrowRight: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  google:
    '<path fill="#4285F4" d="M23.5 12.27c0-.85-.08-1.67-.22-2.45H12v4.64h6.45a5.52 5.52 0 01-2.39 3.62v3h3.87c2.26-2.09 3.57-5.17 3.57-8.81z"/><path fill="#34A853" d="M12 24c3.24 0 5.96-1.07 7.94-2.9l-3.87-3c-1.08.72-2.45 1.15-4.07 1.15-3.13 0-5.78-2.11-6.73-4.95H1.27v3.1A12 12 0 0012 24z"/><path fill="#FBBC05" d="M5.27 14.3a7.2 7.2 0 010-4.6V6.6H1.27a12 12 0 000 10.8z"/><path fill="#EA4335" d="M12 4.75c1.76 0 3.35.61 4.6 1.8l3.43-3.43A11.97 11.97 0 0012 0 12 12 0 001.27 6.6l4 3.1C6.22 6.86 8.87 4.75 12 4.75z"/>',
};
const FILLED = new Set(['play', 'pause', 'flame', 'quote', 'more', 'starFill', 'google']);

export function icon(name, size = 20, cls = '') {
  const body = ICONS[name] || ICONS.info;
  const filled = FILLED.has(name);
  return `<svg class="ic ic-${name} ${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="${filled ? 'currentColor' : 'none'}" stroke="${filled ? 'none' : 'currentColor'}" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;
}

/* =========================================================================
   Bottom Sheet — iOS sheet fiziği; tutamaçtan ya da en üstteyken
   içerikten aşağı çekince parmağı gerçek zamanlı takip eder.
   ========================================================================= */
const sheetStack = [];

export function openSheet({ title = '', html = '', size = 'auto', className = '', headerRight = '', onMount, onClose, dismissible = true } = {}) {
  const host = document.getElementById('sheets');
  const layer = document.createElement('div');
  layer.className = 'sheet-layer';
  layer.innerHTML = `
    <div class="sheet-backdrop"></div>
    <section class="sheet ${size} ${className}" role="dialog" aria-modal="true" ${title ? `aria-label="${esc(title)}"` : ''}>
      <div class="sheet-grab"><span class="sheet-grabber"></span></div>
      ${
        title || headerRight
          ? `<header class="sheet-header">
        <button type="button" class="icon-btn glass sm sheet-x" data-sheet-close aria-label="Kapat">${icon('close', 15)}</button>
        <h2 class="sheet-title">${esc(title)}</h2>
        <div class="sheet-header-right">${headerRight}</div>
      </header>`
          : ''
      }
      <div class="sheet-body">${html}</div>
    </section>`;
  host.appendChild(layer);

  const sheet = layer.querySelector('.sheet');
  const body = layer.querySelector('.sheet-body');
  [...body.children].forEach((child, i) => child.style.setProperty('--si', Math.min(i, 12)));
  let closed = false;

  const api = {
    el: sheet,
    body,
    layer,
    get closed() {
      return closed;
    },
    close(reason = 'api') {
      if (closed) return;
      closed = true;
      sheet.style.transition = '';
      sheet.style.transform = '';
      layer.querySelector('.sheet-backdrop').style.opacity = '';
      layer.classList.remove('open');
      layer.classList.add('closing');
      const i = sheetStack.indexOf(api);
      if (i >= 0) sheetStack.splice(i, 1);
      syncSheetStack();
      let removed = false;
      const remove = () => {
        if (removed) return;
        removed = true;
        layer.remove();
      };
      sheet.addEventListener('transitionend', e => e.target === sheet && remove());
      setTimeout(remove, 650);
      try {
        onClose?.(reason);
      } catch (err) {
        console.error(err);
      }
    },
  };

  layer.querySelector('.sheet-backdrop').addEventListener('click', () => dismissible && api.close('backdrop'));
  layer.addEventListener('click', e => {
    if (e.target.closest('[data-sheet-close]')) api.close('button');
  });

  sheetStack.push(api);
  syncSheetStack();
  // Zorunlu reflow ile başlangıç konumu işlenir, ardından geçiş başlar (kare beklemeden)
  void sheet.offsetHeight;
  layer.classList.add('open');
  if (dismissible) bindSheetDrag(api);
  onMount?.(body, api);
  return api;
}

function syncSheetStack() {
  document.body.classList.toggle('has-sheet', sheetStack.length > 0);
  sheetStack.forEach((s, i) => s.layer.classList.toggle('behind', i < sheetStack.length - 1));
}
export function closeAllSheets() {
  [...sheetStack].reverse().forEach(s => s.close('all'));
}
export const topSheet = () => sheetStack[sheetStack.length - 1] || null;

function bindSheetDrag(api) {
  const { el: sheet, body, layer } = api;
  const backdrop = layer.querySelector('.sheet-backdrop');
  let active = false;
  let dragging = false;
  let fromBody = false;
  let startY = 0;
  let lastY = 0;
  let lastT = 0;
  let dy = 0;
  let velocity = 0;

  const start = (y, target) => {
    if (target.closest('.no-drag')) return;
    fromBody = !!target.closest('.sheet-body');
    if (fromBody && body.scrollTop > 0) return;
    active = true;
    dragging = false;
    startY = lastY = y;
    lastT = performance.now();
    dy = 0;
    velocity = 0;
  };
  const move = (y, e) => {
    if (!active) return;
    const d = y - startY;
    if (!dragging) {
      if (d > 7) {
        dragging = true;
        sheet.style.transition = 'none';
        backdrop.style.transition = 'none';
        document.activeElement?.blur?.();
      } else if (d < -5 && fromBody) {
        active = false;
        return;
      } else return;
    }
    if (e?.cancelable) e.preventDefault();
    // Yukarı yönde lastik bant direnci
    dy = d > 0 ? d : -Math.sqrt(-d) * 2.2;
    const now = performance.now();
    velocity = (y - lastY) / Math.max(1, now - lastT);
    lastY = y;
    lastT = now;
    const progress = clamp(dy / sheet.offsetHeight, 0, 1);
    sheet.style.transform = `translate3d(0, ${dy}px, 0) scale(${1 - progress * 0.04})`;
    backdrop.style.opacity = String(clamp(1 - progress * 1.1, 0, 1));
  };
  const end = () => {
    if (!active) return;
    active = false;
    if (!dragging) return;
    dragging = false;
    sheet.style.transition = '';
    backdrop.style.transition = '';
    if (dy > sheet.offsetHeight * 0.26 || velocity > 0.5) {
      haptic(6);
      api.close('swipe');
    } else {
      sheet.style.transform = '';
      backdrop.style.opacity = '';
    }
  };

  sheet.addEventListener('touchstart', e => start(e.touches[0].clientY, e.target), { passive: true });
  sheet.addEventListener('touchmove', e => move(e.touches[0].clientY, e), { passive: false });
  sheet.addEventListener('touchend', end);
  sheet.addEventListener('touchcancel', end);

  sheet.querySelector('.sheet-grab').addEventListener('mousedown', e => {
    start(e.clientY, e.target);
    const mm = ev => move(ev.clientY, ev);
    const mu = () => {
      end();
      window.removeEventListener('mousemove', mm);
      window.removeEventListener('mouseup', mu);
    };
    window.addEventListener('mousemove', mm);
    window.addEventListener('mouseup', mu);
  });
}

/** iOS action sheet — seçilen value (veya null) ile çözülür. */
export function actionSheet({ title = '', message = '', actions = [], cancelText = 'Vazgeç' } = {}) {
  return new Promise(resolve => {
    let result = null;
    openSheet({
      className: 'action-sheet',
      html: `
        ${title || message ? `<div class="as-head">${title ? `<h3>${esc(title)}</h3>` : ''}${message ? `<p>${esc(message)}</p>` : ''}</div>` : ''}
        <div class="as-group glass">${actions
          .map((a, i) => `<button type="button" class="as-btn ${a.destructive ? 'destructive' : ''}" data-i="${i}">${a.icon ? icon(a.icon, 18) : ''}<span>${esc(a.label)}</span></button>`)
          .join('')}</div>
        <button type="button" class="btn btn-glass glass block as-cancel" data-sheet-close>${esc(cancelText)}</button>`,
      onMount(body, sheet) {
        body.addEventListener('click', e => {
          const btn = e.target.closest('.as-btn');
          if (!btn) return;
          const a = actions[Number(btn.dataset.i)];
          result = a.value ?? Number(btn.dataset.i);
          haptic(6);
          sheet.close('select');
        });
      },
      onClose: () => resolve(result),
    });
  });
}

export async function confirmSheet({ title, message = '', confirmText = 'Onayla', destructive = false } = {}) {
  const v = await actionSheet({ title, message, actions: [{ label: confirmText, value: 'ok', destructive }] });
  return v === 'ok';
}

/* ---------- Toast ---------- */
export function toast(message, { icon: ic = null, tone = '', action = null, onAction = null, duration = 2800 } = {}) {
  const host = document.getElementById('toasts');
  if (!host) return;
  const t = document.createElement('div');
  t.className = `toast glass ${tone}`;
  t.setAttribute('role', 'status');
  t.innerHTML = `${ic ? icon(ic, 17) : ''}<span class="toast-msg">${esc(message)}</span>${action ? `<button type="button" class="toast-action">${esc(action)}</button>` : ''}`;
  host.appendChild(t);
  while (host.children.length > 3) host.firstElementChild.remove();
  void t.offsetHeight;
  t.classList.add('show');
  const remove = () => {
    t.classList.remove('show');
    t.classList.add('hide');
    setTimeout(() => t.remove(), 420);
  };
  const timer = setTimeout(remove, duration);
  t.querySelector('.toast-action')?.addEventListener('click', () => {
    clearTimeout(timer);
    remove();
    onAction?.();
  });
}

/* ---------- Segment kontrol (sıvı cam lens) ---------- */
export function segmented(items, active, { action = '', id = '', cls = '' } = {}) {
  const idx = Math.max(0, items.findIndex(i => i.key === active));
  return `<div class="segmented glass ${cls}" ${id ? `id="${id}"` : ''} role="tablist" style="--n:${items.length};--idx:${idx}">
    <span class="seg-lens" aria-hidden="true"></span>
    ${items
      .map(
        it => `<button type="button" class="seg ${it.key === active ? 'on' : ''}" role="tab" aria-selected="${it.key === active}" data-key="${esc(it.key)}" ${action ? `data-action="${action}"` : ''} ${it.title ? `aria-label="${esc(it.title)}"` : ''}>
          ${it.icon ? icon(it.icon, 16) : ''}${it.label ? `<span>${esc(it.label)}</span>` : ''}${it.badge != null ? `<small>${esc(it.badge)}</small>` : ''}</button>`,
      )
      .join('')}
  </div>`;
}
/** Lens yeni konuma "sıvı" gibi esneyerek kayar. */
export function setSegmented(el, key) {
  if (!el) return;
  const btns = [...el.querySelectorAll('.seg')];
  const idx = btns.findIndex(b => b.dataset.key === key);
  const prev = Number(getComputedStyle(el).getPropertyValue('--idx')) || 0;
  el.style.setProperty('--idx', Math.max(0, idx));
  morph(el, idx > prev ? 'right' : 'left');
  btns.forEach(b => {
    const on = b.dataset.key === key;
    b.classList.toggle('on', on);
    b.setAttribute('aria-selected', on);
  });
}
export function morph(el, dir = 'right') {
  el.classList.remove('morph-left', 'morph-right');
  void el.offsetWidth;
  el.classList.add(`morph-${dir}`);
  clearTimeout(el._morphT);
  el._morphT = setTimeout(() => el.classList.remove('morph-left', 'morph-right'), 560);
}

export function switchHTML(id, checked = false) {
  return `<label class="switch"><input type="checkbox" id="${id}" role="switch" ${checked ? 'checked' : ''}><span class="track"></span><span class="thumb"></span></label>`;
}

/* =========================================================================
   Kapaklar — hızlı yükleme (görüntü CDN'i ile yeniden boyutlandırma + webp),
   kaynak zinciri ile yedekleme, bellekte "çalışan kaynak" önbelleği.
   ========================================================================= */
const COVER_W = { xs: 72, sm: 120, md: 180, lg: 260, xl: 360, fluid: 260 };
const resolvedSrc = new Map();
const deadCovers = new Set();

const httpsify = url => (url ? String(url).trim().replace(/^http:\/\//i, 'https://') : '');

/** wsrv.nl: kapakları küçültür, webp'ye çevirir, CDN'de önbelleğe alır ve CORS ekler. */
export function proxied(url, w) {
  if (!/^https:\/\//i.test(url || '')) return url || '';
  // Kırpma yok: oran korunur, kadraj CSS object-fit ile yapılır
  return `https://wsrv.nl/?url=${encodeURIComponent(url)}&w=${w}&output=webp&q=84`;
}

/** Görüntülenecek boyuta uygun kaynak: Open Library'de hafif boy, Google'da yüksek çözünürlük */
function sizedSource(url, w) {
  if (/covers\.openlibrary\.org\/b\//.test(url)) return url.replace(/-[SML]\.jpg/, w <= 200 ? '-M.jpg' : '-L.jpg');
  if (/books\.google(usercontent)?\.com/.test(url) && !/fife=/.test(url)) return `${url.replace(/zoom=\d/, 'zoom=1')}&fife=w400-h600`;
  return url;
}

export function coverCandidates(book, w = 180) {
  const raw = sizedSource(httpsify(book?.coverUrl), w);
  const isbn = String(book?.isbn || '').replace(/[^0-9Xx]/g, '');
  const list = [];
  if (raw) list.push(proxied(raw, w), raw);
  if (isbn.length >= 10 && !raw.includes(isbn)) list.push(proxied(`https://covers.openlibrary.org/b/isbn/${isbn}-M.jpg?default=false`, w));
  return [...new Set(list)];
}

function hashString(s) {
  let h = 2166136261;
  for (const ch of String(s)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}
export function hashHues(seed = 'okur') {
  const h = hashString(seed) % 360;
  return [h, (h + 32) % 360, (h + 320) % 360];
}

export function cover(book, size = 'md', { eager = false } = {}) {
  const title = book?.title || '';
  const [h1, h2] = hashHues(title || 'okur');
  const srcs = coverCandidates(book, COVER_W[size] || 180);
  const key = srcs[0] || '';
  let img = '';
  if (key && !deadCovers.has(key)) {
    const known = resolvedSrc.get(key);
    const src = known || key;
    const alt = known ? '' : srcs.slice(1).join(' ');
    img = `<img class="cover-img ${known ? 'loaded' : ''}" src="${esc(src)}" data-key="${esc(key)}" data-alt="${esc(alt)}" alt="" ${eager ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async" referrerpolicy="no-referrer">`;
  }
  return `<div class="cover cover-${size}" style="--h1:${h1};--h2:${h2}">
    <div class="cover-fallback"><span class="cf-title">${esc(title)}</span><span class="cf-author">${esc(book?.author || '')}</span></div>
    ${img}<span class="cover-sheen"></span>
  </div>`;
}

/**
 * Tek seferlik: tüm kapak <img> yükleme/hata olaylarını yakalar.
 * Her yeni kapak için CDN kopyası ile doğrudan kaynak aynı anda yarışır;
 * hangisi önce gelirse o gösterilir ve sonraki çizimlerde doğrudan kullanılır.
 */
export function initCoverLoader() {
  const race = img => {
    if (img._raced || img.classList.contains('loaded')) return;
    img._raced = true;
    const direct = (img.dataset.alt || '').split(' ').filter(Boolean)[0];
    if (!direct || !img.src.startsWith('https://wsrv.nl')) return;
    const probe = new Image();
    probe.referrerPolicy = 'no-referrer';
    probe.decoding = 'async';
    probe.onload = () => {
      if (img.classList.contains('loaded') || probe.naturalWidth < 10) return;
      img.dataset.alt = (img.dataset.alt || '').split(' ').filter(s => s && s !== direct).join(' ');
      img.src = direct;
    };
    probe.src = direct;
  };
  // Tembel yüklenen kapaklar yalnızca görünür alana yaklaşınca yarışa girer
  const io =
    'IntersectionObserver' in window
      ? new IntersectionObserver(
          entries =>
            entries.forEach(e => {
              if (!e.isIntersecting) return;
              io.unobserve(e.target);
              race(e.target);
            }),
          { rootMargin: '300px' },
        )
      : null;
  const arm = img => (io && img.loading === 'lazy' ? io.observe(img) : race(img));
  const scan = root => root.querySelectorAll?.('img.cover-img:not(.loaded)').forEach(arm);
  new MutationObserver(muts => {
    for (const m of muts) for (const n of m.addedNodes) if (n.nodeType === 1) n.matches?.('img.cover-img') ? arm(n) : scan(n);
  }).observe(document.body, { childList: true, subtree: true });

  const fail = img => {
    const rest = (img.dataset.alt || '').split(' ').filter(Boolean);
    if (!rest.length) {
      deadCovers.add(img.dataset.key);
      img.remove();
      return;
    }
    img.dataset.alt = rest.slice(1).join(' ');
    img.src = rest[0];
  };
  document.addEventListener(
    'load',
    e => {
      const t = e.target;
      if (t.tagName !== 'IMG' || !t.classList.contains('cover-img')) return;
      if (t.naturalWidth < 10) return fail(t);
      resolvedSrc.set(t.dataset.key, t.currentSrc || t.src);
      t.classList.add('loaded');
    },
    true,
  );
  document.addEventListener(
    'error',
    e => {
      const t = e.target;
      if (t.tagName === 'IMG' && t.classList.contains('cover-img')) fail(t);
    },
    true,
  );
}

/* ---------- Renk motoru (Ambient Cover Glow) ---------- */
const paletteCache = new Map();

function rgbToHsl(r, g, b) {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h * 60, s, l];
}

function extractHsl(img) {
  const c = document.createElement('canvas');
  c.width = 24;
  c.height = 36;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, c.width, c.height);
  const { data } = ctx.getImageData(0, 0, c.width, c.height);
  const buckets = new Map();
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    const [h, s, l] = rgbToHsl(data[i], data[i + 1], data[i + 2]);
    if (l < 0.07 || l > 0.95) continue;
    const key = `${Math.round(h / 30) % 12}-${s > 0.3 ? 1 : 0}`;
    const b = buckets.get(key) || { h: 0, s: 0, l: 0, n: 0, w: 0 };
    b.h += h;
    b.s += s;
    b.l += l;
    b.n += 1;
    b.w += 0.35 + s * 1.8;
    buckets.set(key, b);
  }
  const ranked = [...buckets.values()].sort((a, b) => b.w - a.w).slice(0, 3);
  if (!ranked.length) return null;
  const out = ranked.map(b => [b.h / b.n, b.s / b.n, b.l / b.n]);
  while (out.length < 3) out.push(out[out.length - 1]);
  return out;
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    img.referrerPolicy = 'no-referrer';
    const timer = setTimeout(() => reject(new Error('timeout')), 8000);
    img.onload = () => {
      clearTimeout(timer);
      resolve(img);
    };
    img.onerror = () => {
      clearTimeout(timer);
      reject(new Error('load'));
    };
    img.src = src;
  });
}

/** Kapak renkleri [[h,s,l]×3]. CORS mümkün değilse başlıktan türetilir. */
export function getPalette(book) {
  const raw = httpsify(book?.coverUrl);
  const fallback = { hsl: hashHues(book?.title || 'okur').map(h => [h, 0.5, 0.4]), fromCover: false };
  if (!raw) return Promise.resolve(fallback);
  if (paletteCache.has(raw)) return paletteCache.get(raw);
  const p = loadImage(proxied(raw, 40))
    .catch(() => loadImage(raw))
    .then(img => {
      const hsl = extractHsl(img);
      return hsl ? { hsl, fromCover: true } : fallback;
    })
    .catch(() => fallback);
  paletteCache.set(raw, p);
  return p;
}

/**
 * Fotoğraftan kapak: görüntüyü 2:3 oranında ortalayarak kırpar, 300×450
 * JPEG'e küçültür (~25–40 KB) ve data URL döndürür. Böylece kapak, ek bir
 * depolama servisine gerek kalmadan kitap kaydıyla birlikte senkron olur.
 */
export async function imageFileToCover(file, w = 300) {
  const h = Math.round(w * 1.5);
  let source;
  try {
    source = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    source = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = URL.createObjectURL(file);
    });
  }
  const sw = source.width;
  const sh = source.height;
  const scale = Math.max(w / sw, h / sh);
  const cw = w / scale;
  const ch = h / scale;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, (sw - cw) / 2, (sh - ch) / 2, cw, ch, 0, 0, w, h);
  source.close?.();
  return canvas.toDataURL('image/jpeg', 0.82);
}

/** Paylaşım kartı için CORS uyumlu büyük kapak görseli */
export async function loadCoverImage(book, w = 360) {
  for (const src of coverCandidates(book, w).filter(s => s.startsWith('https://wsrv.nl') || s.startsWith('data:image/'))) {
    try {
      return await loadImage(src);
    } catch {
      /* sıradaki kaynak */
    }
  }
  return null;
}

/** Tema moduna göre yumuşatılmış ortam renkleri (aşırı parlak değil) */
export function ambientColors(hsl, mode = 'dark') {
  return hsl.map(([h, s, l]) =>
    mode === 'light'
      ? `hsl(${Math.round(h)} ${Math.round(clamp(s, 0.15, 0.55) * 100)}% ${Math.round(clamp(l + 0.35, 0.72, 0.84) * 100)}%)`
      : `hsl(${Math.round(h)} ${Math.round(clamp(s * 0.8, 0.1, 0.55) * 100)}% ${Math.round(clamp(l, 0.24, 0.38) * 100)}%)`,
  );
}

/** colors=null → tema varsayılanlarına dön */
export function setAmbient(colors = null) {
  const root = document.documentElement.style;
  ['--amb-1', '--amb-2', '--amb-3'].forEach((k, i) => (colors ? root.setProperty(k, colors[i] || colors[0]) : root.removeProperty(k)));
}

/* =========================================================================
   Halka, grafik, yıldız
   ========================================================================= */
let gradientSeq = 0;

export function progressRing(value, size = 64, label = '') {
  const stroke = Math.max(4, Math.round(size * 0.1));
  const c = size / 2;
  const r = c - stroke / 2;
  const circ = 2 * Math.PI * r;
  const v = clamp(value || 0, 0, 1);
  const uid = `pr${++gradientSeq}`;
  return `<div class="pring" style="width:${size}px;height:${size}px">
    <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true">
      <defs><linearGradient id="${uid}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="var(--accent-2)"/><stop offset="1" stop-color="var(--accent)"/></linearGradient></defs>
      <circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="var(--track)" stroke-width="${stroke}"/>
      <circle class="ring-progress" cx="${c}" cy="${c}" r="${r}" fill="none" stroke="url(#${uid})" stroke-width="${stroke}" stroke-linecap="round"
        stroke-dasharray="${circ.toFixed(2)}" stroke-dashoffset="${(circ * (1 - v)).toFixed(2)}" style="--circ:${circ.toFixed(2)};opacity:${v > 0 ? 1 : 0}" transform="rotate(-90 ${c} ${c})"/>
    </svg>${label ? `<span class="pring-label">${label}</span>` : ''}</div>`;
}

/** HTML çubuk grafik: [{ key?, label, value, active?, dim? }] */
export function barChart(data, { goal = 0, showValues = true, labelEvery = 1, action = '' } = {}) {
  const max = Math.max(goal * 1.15, ...data.map(d => d.value), 1);
  const n = data.length;
  return `<div class="bars" style="--cols:${n}">
    ${goal ? `<div class="bars-goal" style="--g:${(goal / max).toFixed(4)}"><span>Hedef ${goal}</span></div>` : ''}
    ${data
      .map((d, i) => {
        const h = d.value ? Math.max(3, (d.value / max) * 100) : 0;
        const showLabel = (n - 1 - i) % labelEvery === 0;
        const tag = action && d.key ? 'button' : 'div';
        const attrs = action && d.key ? `type="button" data-action="${action}" data-key="${d.key}"` : '';
        return `<${tag} class="bar-col ${d.active ? 'active' : ''} ${d.dim ? 'dim' : ''} ${goal && d.value >= goal ? 'met' : ''}" ${attrs}>
          <span class="bar-track"><span class="bar" style="--h:${h.toFixed(1)}%;--d:${i * (n > 12 ? 12 : 30)}ms">${showValues && d.value ? `<em>${d.value}</em>` : ''}</span></span>
          <span class="bar-lbl">${showLabel ? esc(d.label) : ''}</span></${tag}>`;
      })
      .join('')}
  </div>`;
}

export function starRating(value = 0, size = 16) {
  let out = '';
  for (let i = 1; i <= 5; i++) {
    const fill = clamp(value - (i - 1), 0, 1) * 100;
    out += `<span class="star" data-i="${i}" style="--fill:${fill}%;width:${size}px;height:${size}px">${icon('star', size)}<span class="star-fill">${icon('starFill', size)}</span></span>`;
  }
  return `<span class="stars" role="img" aria-label="5 üzerinden ${value}">${out}</span>`;
}
export function bindStarRating(container, onChange) {
  if (container.dataset.bound) return;
  container.dataset.bound = '1';
  container.classList.add('stars-interactive');
  container.addEventListener('click', e => {
    const s = e.target.closest('.star');
    if (!s) return;
    e.stopPropagation();
    const r = s.getBoundingClientRect();
    onChange(Number(s.dataset.i) - (e.clientX - r.left < r.width / 2 ? 0.5 : 0));
  });
}

/* =========================================================================
   Akışkan efektler
   ========================================================================= */
/** Sayılar 0'dan hedefe yumuşakça sayar: <b data-count="42">42</b> */
export function countUp(root) {
  if (reducedMotion()) return;
  root.querySelectorAll('[data-count]').forEach(el => {
    const raw = el.dataset.count;
    const target = parseFloat(raw);
    if (!Number.isFinite(target) || target === 0) return;
    const dec = (raw.split('.')[1] || '').length;
    const fmt = v => (dec ? v.toFixed(dec).replace('.', ',') : Math.round(v).toLocaleString('tr-TR'));
    const t0 = performance.now();
    const dur = 650 + Math.min(500, target * 3);
    const step = now => {
      const p = Math.min(1, (now - t0) / dur);
      el.textContent = fmt(target * (1 - Math.pow(1 - p, 4)));
      if (p < 1) requestAnimationFrame(step);
    };
    el.textContent = fmt(0);
    requestAnimationFrame(step);
  });
}

/** Cam yüzeylerde parmağı/imleci takip eden yumuşak ışık */
export function initPointerGlow() {
  let raf = 0;
  let last = null;
  const sel = '.glass, .btn';
  const update = () => {
    raf = 0;
    if (!last) return;
    const r = last.el.getBoundingClientRect();
    last.el.style.setProperty('--mx', `${last.x - r.left}px`);
    last.el.style.setProperty('--my', `${last.y - r.top}px`);
  };
  const track = e => {
    const el = e.target.closest?.(sel);
    if (!el) return;
    last = { x: e.clientX, y: e.clientY, el };
    if (!raf) raf = requestAnimationFrame(update);
  };
  // Dokunmatikte kaydırma sırasında her karede ölçüm yapmamak için yalnızca fare izlenir
  document.addEventListener('pointermove', e => e.pointerType === 'mouse' && track(e), { passive: true });
  document.addEventListener(
    'pointerdown',
    e => {
      track(e);
      const el = e.target.closest?.(sel);
      if (!el) return;
      el.classList.add('pressed');
      const up = () => el.classList.remove('pressed');
      window.addEventListener('pointerup', up, { once: true });
      window.addEventListener('pointercancel', up, { once: true });
    },
    { passive: true },
  );
}

/* =========================================================================
   Dinamik Ada / Live Activity okuma zamanlayıcısı
   ========================================================================= */
export function fmtClock(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const ss = String(total % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

export function createIsland(el, handlers = {}) {
  el.innerHTML = `
    <div class="island-compact" data-is="expand" role="button" aria-label="Okuma oturumunu aç">
      <span class="is-cover"></span>
      <span class="is-wave" aria-hidden="true"><i></i><i></i><i></i><i></i></span>
      <span class="is-time">0:00</span>
    </div>
    <div class="island-expanded">
      <div class="is-top">
        <span class="is-cover lg" data-is="open"></span>
        <div class="is-meta"><small>Okuma oturumu</small><b class="is-title"></b><span class="is-author"></span></div>
        <span class="is-time big">0:00</span>
      </div>
      <div class="is-actions">
        <button type="button" class="is-btn toggle" data-is="toggle" aria-label="Duraklat"></button>
        <button type="button" class="is-btn finish" data-is="finish">${icon('check', 16)}<span>Bitir ve Kaydet</span></button>
        <button type="button" class="is-btn ghost" data-is="cancel" aria-label="Oturumu iptal et">${icon('close', 16)}</button>
      </div>
    </div>`;
  let expanded = false;
  let visible = false;
  const times = el.querySelectorAll('.is-time');
  const api = {
    show(book, running) {
      el.querySelectorAll('.is-cover').forEach(c => (c.innerHTML = cover(book, 'xs')));
      el.querySelector('.is-title').textContent = book?.title || 'Okuma';
      el.querySelector('.is-author').textContent = book?.author || '';
      api.setRunning(running);
      if (!visible) {
        visible = true;
        el.hidden = false;
        void el.offsetHeight;
        el.classList.add('show');
      }
    },
    hide() {
      if (!visible) return;
      visible = false;
      api.collapse();
      el.classList.remove('show');
      setTimeout(() => !visible && (el.hidden = true), 450);
    },
    setTime(ms) {
      const t = fmtClock(ms);
      times.forEach(n => (n.textContent = t));
    },
    setRunning(running) {
      el.classList.toggle('paused', !running);
      const btn = el.querySelector('[data-is="toggle"]');
      btn.innerHTML = icon(running ? 'pause' : 'play', 18);
      btn.setAttribute('aria-label', running ? 'Duraklat' : 'Devam et');
    },
    expand() {
      if (!visible) return;
      expanded = true;
      el.classList.add('expanded');
      haptic(6);
    },
    collapse() {
      expanded = false;
      el.classList.remove('expanded');
    },
  };
  el.addEventListener('click', e => {
    const a = e.target.closest('[data-is]')?.dataset.is;
    if (!a) return;
    e.stopPropagation();
    if (a === 'expand') api.expand();
    else {
      handlers[a]?.();
      if (a !== 'toggle') api.collapse();
    }
  });
  document.addEventListener('click', e => {
    if (expanded && !el.contains(e.target)) api.collapse();
  });
  return api;
}

/* =========================================================================
   Swipe aksiyonları (kitap satırları)
   Tam kaydırma: soldaki ilk / sağdaki son aksiyonu tetikler.
   ========================================================================= */
const ACTION_W = 70;
let openRow = null;

function setRowOffset(row, x, animate = true) {
  const content = row.querySelector('.swipe-content');
  content.style.transition = animate ? 'transform .55s var(--spring)' : 'none';
  content.style.transform = x ? `translate3d(${x}px,0,0)` : '';
  row._offset = x;
  row.dataset.dir = x > 0 ? 'right' : x < 0 ? 'left' : '';
  row.classList.toggle('open', x !== 0);
  const left = row.querySelector('.swipe-actions.left');
  const right = row.querySelector('.swipe-actions.right');
  const lw = (left?.children.length || 0) * ACTION_W;
  const rw = (right?.children.length || 0) * ACTION_W;
  row.style.setProperty('--reveal', String(clamp(Math.abs(x) / ((x > 0 ? lw : rw) || 1), 0, 1.4)));
  if (x === 0 && openRow === row) openRow = null;
}
export function closeSwipeRows() {
  if (openRow) setRowOffset(openRow, 0);
  openRow = null;
}
export function consumeSwipeClick(target) {
  const row = target?.closest?.('.swipe-row');
  if (!row) {
    if (openRow && !target?.closest?.('.swipe-actions')) closeSwipeRows();
    return false;
  }
  if (row._suppress && Date.now() - row._suppress < 420) return true;
  if (row.classList.contains('open') && target.closest('.swipe-content')) {
    setRowOffset(row, 0);
    return true;
  }
  return false;
}

export function bindSwipeRows(root) {
  root.querySelectorAll('.swipe-row').forEach(row => {
    if (row._bound) return;
    row._bound = true;
    row._offset = 0;
    const content = row.querySelector('.swipe-content');
    const left = row.querySelector('.swipe-actions.left');
    const right = row.querySelector('.swipe-actions.right');
    const lw = () => (left?.children.length || 0) * ACTION_W;
    const rw = () => (right?.children.length || 0) * ACTION_W;
    let sx = 0;
    let sy = 0;
    let base = 0;
    let x = 0;
    let tracking = false;
    let decided = false;
    let horizontal = false;
    let width = 0;
    let armed = false;

    const start = (cx, cy) => {
      if (openRow && openRow !== row) closeSwipeRows();
      sx = cx;
      sy = cy;
      base = row._offset || 0;
      x = base;
      tracking = true;
      decided = false;
      horizontal = false;
      armed = false;
      width = row.offsetWidth;
    };
    const move = (cx, cy, e) => {
      if (!tracking) return;
      const mx = cx - sx;
      const my = cy - sy;
      if (!decided) {
        if (Math.abs(mx) < 8 && Math.abs(my) < 8) return;
        decided = true;
        horizontal = Math.abs(mx) > Math.abs(my) * 1.15;
        if (!horizontal) {
          tracking = false;
          return;
        }
      }
      if (e?.cancelable) e.preventDefault();
      let nx = base + mx;
      if (nx > 0 && !lw()) nx *= 0.15;
      if (nx < 0 && !rw()) nx *= 0.15;
      const limit = width * 0.82;
      if (Math.abs(nx) > limit) nx = Math.sign(nx) * (limit + (Math.abs(nx) - limit) * 0.2);
      x = nx;
      setRowOffset(row, x, false);
      const full = Math.abs(x) > width * 0.55;
      if (full !== armed) {
        armed = full;
        if (full) haptic(10);
      }
      row.classList.toggle('full', full);
    };
    const end = () => {
      if (!tracking) return;
      tracking = false;
      if (!horizontal) return;
      row._suppress = Date.now();
      row.classList.remove('full');
      if (x > 0 && lw() && x > width * 0.55) {
        setRowOffset(row, 0);
        left.firstElementChild?.click();
        return;
      }
      if (x < 0 && rw() && -x > width * 0.55) {
        setRowOffset(row, 0);
        right.lastElementChild?.click();
        return;
      }
      if (x > lw() * 0.45 && lw()) {
        setRowOffset(row, lw());
        openRow = row;
      } else if (-x > rw() * 0.45 && rw()) {
        setRowOffset(row, -rw());
        openRow = row;
      } else setRowOffset(row, 0);
    };

    content.addEventListener('touchstart', e => start(e.touches[0].clientX, e.touches[0].clientY), { passive: true });
    content.addEventListener('touchmove', e => move(e.touches[0].clientX, e.touches[0].clientY, e), { passive: false });
    content.addEventListener('touchend', end);
    content.addEventListener('touchcancel', end);
    content.addEventListener('mousedown', e => {
      if (e.button !== 0) return;
      start(e.clientX, e.clientY);
      const mm = ev => move(ev.clientX, ev.clientY, ev);
      const mu = () => {
        end();
        window.removeEventListener('mousemove', mm);
        window.removeEventListener('mouseup', mu);
      };
      window.addEventListener('mousemove', mm);
      window.addEventListener('mouseup', mu);
    });
  });
}

/* =========================================================================
   Paylaşım kartı (1080×1350 PNG)
   ========================================================================= */
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
function wrapLines(ctx, text, maxWidth) {
  const lines = [];
  for (const para of String(text).split(/\n+/)) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const test = line ? `${line} ${word}` : word;
      if (ctx.measureText(test).width > maxWidth && line) {
        lines.push(line);
        line = word;
      } else line = test;
    }
    if (line) lines.push(line);
  }
  return lines;
}
function glow(ctx, x, y, r, color) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, color);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
}
function drawStars(ctx, x, y, size, value) {
  const path = new Path2D('M12 3.3l2.7 5.5 6 .9-4.4 4.2 1.1 6-5.4-2.8-5.4 2.8 1.1-6-4.4-4.2 6-.9z');
  for (let i = 0; i < 5; i++) {
    const fill = clamp(value - i, 0, 1);
    ctx.save();
    ctx.translate(x + i * (size + 14), y);
    ctx.scale(size / 24, size / 24);
    ctx.fillStyle = 'rgba(255,255,255,.22)';
    ctx.fill(path);
    if (fill > 0) {
      ctx.beginPath();
      ctx.rect(0, 0, 24 * fill, 24);
      ctx.clip();
      ctx.fillStyle = '#F2C94C';
      ctx.fill(path);
    }
    ctx.restore();
  }
}

/** kind: 'quote' | 'book' */
export function renderShareImage({ kind = 'quote', text = '', title = '', author = '', page = '', rating = 0, footer = '', colors, img = null }) {
  const W = 1080;
  const H = 1350;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  const serif = 'Georgia, "Times New Roman", serif';
  const sans = '-apple-system, "Helvetica Neue", Arial, sans-serif';

  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, colors[0]);
  bg.addColorStop(0.55, colors[1] || colors[0]);
  bg.addColorStop(1, colors[2] || colors[1] || colors[0]);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  glow(ctx, W * 0.86, H * 0.1, 560, 'rgba(255,255,255,.18)');
  glow(ctx, W * 0.08, H * 0.92, 640, 'rgba(0,0,0,.4)');
  ctx.fillStyle = 'rgba(0,0,0,.22)';
  ctx.fillRect(0, 0, W, H);

  const px = 76;
  const py = 120;
  const pw = W - px * 2;
  const ph = H - py * 2 - 40;
  roundRect(ctx, px, py, pw, ph, 64);
  ctx.fillStyle = 'rgba(255,255,255,.08)';
  ctx.fill();
  const rim = ctx.createLinearGradient(px, py, px + pw, py + ph);
  rim.addColorStop(0, 'rgba(255,255,255,.55)');
  rim.addColorStop(0.4, 'rgba(255,255,255,.06)');
  rim.addColorStop(1, 'rgba(255,255,255,.22)');
  ctx.strokeStyle = rim;
  ctx.lineWidth = 2.5;
  ctx.stroke();

  const innerX = px + 64;
  const innerW = pw - 128;

  if (kind === 'quote') {
    ctx.fillStyle = 'rgba(255,255,255,.85)';
    ctx.font = `700 190px ${serif}`;
    ctx.fillText('“', innerX - 8, py + 210);
    let size = 66;
    let lines = [];
    const maxH = 600;
    while (size >= 34) {
      ctx.font = `500 ${size}px ${serif}`;
      lines = wrapLines(ctx, text, innerW);
      if (lines.length * size * 1.38 <= maxH) break;
      size -= 4;
    }
    const maxLines = Math.floor(maxH / (size * 1.38));
    if (lines.length > maxLines) {
      lines = lines.slice(0, maxLines);
      lines[maxLines - 1] = `${lines[maxLines - 1].replace(/\s+\S*$/, '')}…`;
    }
    ctx.fillStyle = '#fff';
    lines.forEach((ln, i) => ctx.fillText(ln, innerX, py + 300 + i * size * 1.38));

    const fy = py + ph - 150;
    let tx = innerX;
    if (img) {
      ctx.save();
      roundRect(ctx, innerX, fy - 10, 84, 126, 12);
      ctx.clip();
      ctx.drawImage(img, innerX, fy - 10, 84, 126);
      ctx.restore();
      tx += 112;
    }
    ctx.fillStyle = '#fff';
    ctx.font = `700 40px ${sans}`;
    ctx.fillText(title.length > 30 ? `${title.slice(0, 29)}…` : title, tx, fy + 34);
    ctx.fillStyle = 'rgba(255,255,255,.72)';
    ctx.font = `500 32px ${sans}`;
    ctx.fillText([author, page ? `Sayfa ${page}` : ''].filter(Boolean).join(' · '), tx, fy + 82);
  } else {
    const cw = 330;
    const ch = 495;
    const cx = (W - cw) / 2;
    const cy = py + 70;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,.5)';
    ctx.shadowBlur = 60;
    ctx.shadowOffsetY = 24;
    roundRect(ctx, cx, cy, cw, ch, 18);
    ctx.fillStyle = colors[1] || '#333';
    ctx.fill();
    ctx.restore();
    ctx.save();
    roundRect(ctx, cx, cy, cw, ch, 18);
    ctx.clip();
    if (img) ctx.drawImage(img, cx, cy, cw, ch);
    else {
      const g = ctx.createLinearGradient(cx, cy, cx + cw, cy + ch);
      g.addColorStop(0, colors[0]);
      g.addColorStop(1, colors[1] || colors[0]);
      ctx.fillStyle = g;
      ctx.fillRect(cx, cy, cw, ch);
      ctx.fillStyle = '#fff';
      ctx.font = `700 40px ${serif}`;
      wrapLines(ctx, title, cw - 60)
        .slice(0, 5)
        .forEach((ln, i) => ctx.fillText(ln, cx + 30, cy + 80 + i * 50));
    }
    ctx.restore();

    ctx.textAlign = 'center';
    ctx.fillStyle = '#fff';
    ctx.font = `700 52px ${serif}`;
    const tl = wrapLines(ctx, title, innerW).slice(0, 2);
    tl.forEach((ln, i) => ctx.fillText(ln, W / 2, cy + ch + 96 + i * 60));
    let y = cy + ch + 96 + tl.length * 60;
    ctx.fillStyle = 'rgba(255,255,255,.75)';
    ctx.font = `500 34px ${sans}`;
    ctx.fillText(author, W / 2, y);
    y += 40;
    if (rating) {
      const sz = 46;
      drawStars(ctx, W / 2 - (5 * sz + 4 * 14) / 2, y, sz, rating);
      y += sz + 30;
    }
    if (text) {
      ctx.fillStyle = 'rgba(255,255,255,.92)';
      ctx.font = `italic 400 34px ${serif}`;
      const rl = wrapLines(ctx, `“${text}”`, innerW - 20);
      const room = Math.max(1, Math.floor((py + ph - 60 - y) / 46));
      rl.slice(0, room).forEach((ln, i) => ctx.fillText(i === room - 1 && rl.length > room ? `${ln}…` : ln, W / 2, y + 20 + i * 46));
    }
    ctx.textAlign = 'left';
  }

  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(255,255,255,.8)';
  ctx.font = `600 30px ${sans}`;
  ctx.fillText(footer || 'Okur ile kaydedildi', W / 2, H - 70);
  ctx.textAlign = 'left';

  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob(b => (b ? resolve(b) : reject(new Error('blob'))), 'image/png');
    } catch (err) {
      reject(err);
    }
  });
}

export async function shareOrDownload(blob, filename, title = '') {
  const file = new File([blob], filename, { type: 'image/png' });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title });
      return 'shared';
    } catch (err) {
      if (err?.name === 'AbortError') return 'cancelled';
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return 'downloaded';
}
