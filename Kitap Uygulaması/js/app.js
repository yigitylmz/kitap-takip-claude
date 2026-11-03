/* =========================================================================
   Okur — Ana başlatıcı
   Router (History API + View Transitions), durum yöneticisi, yerel/hesap
   veri akışı, tema & arayüz stili, sosyal (arkadaşlar), görünümler
   (Bugün / Kütüphane / Sosyal / İstatistik / Ayarlar / Kitap detayı),
   bottom sheet akışları ve okuma zamanlayıcısı.
   ========================================================================= */
import {
  isFirebaseConfigured,
  loadFirebase,
  createLocalDb,
  createDataService,
  migrateLocalToCloud,
  DEFAULT_PROFILE,
  LOCAL_UID,
  normalizeNickname,
  isValidNickname,
} from './firebase-config.js';
import { searchBooks, lookupISBN, isISBN, cleanISBN, searchCovers } from './api-books.js';
import * as S from './stats-engine.js';
import * as UI from './ui-components.js';

const { icon, esc } = UI;
const $ = (sel, root = document) => root.querySelector(sel);
const view = () => document.getElementById('view');

const TIMER_KEY = 'okur:timer';
const SETTINGS_KEY = 'okur:settings';
const INSTALL_KEY = 'okur:install-hint';
const HTML5_QRCODE = 'https://esm.sh/html5-qrcode@2.3.8';

const TABS = [
  { path: '/', label: 'Bugün', icon: 'sun' },
  { path: '/library', label: 'Kütüphane', icon: 'books' },
  { path: '/social', label: 'Sosyal', icon: 'people' },
  { path: '/stats', label: 'İstatistik', icon: 'chart' },
  { path: '/settings', label: 'Ayarlar', icon: 'gear' },
];

export const THEMES = [
  { key: 'ocean', label: 'Okyanus' },
  { key: 'violet', label: 'Lavanta' },
  { key: 'forest', label: 'Orman' },
  { key: 'sunset', label: 'Gün Batımı' },
  { key: 'rose', label: 'Gül' },
  { key: 'graphite', label: 'Grafit' },
];
const DEFAULT_SETTINGS = { mode: 'system', theme: 'ocean', coverGlow: true, libraryView: 'list', uiStyle: 'normal' };

const readJSON = key => {
  try {
    return JSON.parse(localStorage.getItem(key));
  } catch {
    return null;
  }
};
const writeJSON = (key, value) => {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* özel modda depolama kapalı olabilir */
  }
};

/* =========================================================================
   Durum
   ========================================================================= */
const state = {
  fb: null,
  local: createLocalDb(),
  data: null,
  user: null,
  unsubscribe: null,
  profile: null,
  books: [],
  logs: [],
  quotes: [],
  sig: {},
  ready: { profile: false, books: false, logs: false, quotes: false },
  pendingBooks: new Map(),
  route: { name: 'home', path: '/', params: {} },
  lastTab: '/',
  derived: null,
  wasSkeleton: false,
  pendingRender: false,
  timer: readJSON(TIMER_KEY),
  settings: { ...DEFAULT_SETTINGS, ...(readJSON(SETTINGS_KEY) || {}) },
  social: { friendships: [], profiles: new Map(), subs: new Map(), unsub: null, ready: false },
  ui: {
    libTab: 'reading',
    libQuery: '',
    libCollection: null,
    calMode: 'month',
    calMonth: S.todayKey().slice(0, 7),
    calWeek: S.todayKey(),
    chartRange: '7',
    descOpen: false,
    scroll: {},
    friendQuery: '',
    friendResult: null,
  },
};
const isCloud = () => !!state.user;
const minimal = () => state.settings.uiStyle === 'minimal';
const myNick = () => state.profile?.nickname || '';

function derive() {
  const profile = { ...DEFAULT_PROFILE, ...(state.profile || {}) };
  const map = S.buildDailyMap(state.logs);
  state.derived = {
    profile,
    map,
    streak: S.computeStreak(map),
    today: S.dayProgress(map, profile),
    summary: S.summarize({ books: state.books, logs: state.logs, profile, map }),
  };
}
const D = () => state.derived || (derive(), state.derived);
const loaded = () => state.ready.books && state.ready.logs;

function getBook(id) {
  return state.books.find(b => b.id === id) || state.pendingBooks.get(id) || null;
}
function booksBy(status) {
  const list = state.books.filter(b => (b.status || 'wishlist') === status);
  if (status === 'reading') return list.sort((a, b) => (S.tsMs(b.lastReadAt) || S.tsMs(b.updatedAt)) - (S.tsMs(a.lastReadAt) || S.tsMs(a.updatedAt)));
  if (status === 'wishlist') return list.sort((a, b) => (b.priority === 'high') - (a.priority === 'high') || S.tsMs(b.createdAt) - S.tsMs(a.createdAt));
  return list.sort((a, b) => S.tsMs(b.finishedAt) - S.tsMs(a.finishedAt));
}
function allCollections() {
  const set = new Set(D().profile.collections || []);
  state.books.forEach(b => b.collection && set.add(b.collection));
  return [...set].sort((a, b) => a.localeCompare(b, 'tr'));
}
const pct = b => (b.totalPages ? Math.min(100, Math.round(((b.currentPage || 0) / b.totalPages) * 100)) : 0);

function displayName() {
  return (state.profile?.displayName || state.user?.displayName || (state.user?.email || '').split('@')[0] || '').trim();
}
const firstName = () => displayName().split(/\s+/)[0] || '';
function greeting() {
  const h = new Date().getHours();
  if (h < 6) return 'İyi geceler';
  if (h < 12) return 'Günaydın';
  if (h < 18) return 'İyi günler';
  return 'İyi akşamlar';
}
function onWriteError(err) {
  console.error('[yazma]', err);
  UI.toast(err?.code === 'permission-denied' ? 'İzin reddedildi. Firestore kurallarını kontrol et.' : 'Değişiklik kaydedilemedi.', { tone: 'error', icon: 'info' });
}

/* =========================================================================
   Tema: aydınlık / karanlık / sistem + renk temaları + arayüz stili
   ========================================================================= */
const lightQuery = window.matchMedia('(prefers-color-scheme: light)');
const resolvedMode = () => (state.settings.mode === 'system' ? (lightQuery.matches ? 'light' : 'dark') : state.settings.mode);

function applyTheme() {
  const root = document.documentElement;
  const mode = resolvedMode();
  root.dataset.mode = mode;
  root.dataset.theme = state.settings.theme;
  root.dataset.ui = state.settings.uiStyle;
  $('meta[name="theme-color"]')?.setAttribute('content', mode === 'light' ? '#f2f2f7' : '#000000');
  $('meta[name="apple-mobile-web-app-status-bar-style"]')?.setAttribute('content', mode === 'light' ? 'default' : 'black-translucent');
  ambientKey = '';
  updateAmbient();
}

function updateSettings(patch, { sync = true, origin = null } = {}) {
  const prev = state.settings;
  const next = { ...prev, ...patch };
  if (JSON.stringify(prev) === JSON.stringify(next)) return;
  state.settings = next;
  writeJSON(SETTINGS_KEY, next);
  const update = () => {
    applyTheme();
    if (state.route.name === 'settings' || prev.libraryView !== next.libraryView || prev.uiStyle !== next.uiStyle) renderView();
  };
  if (prev.mode !== next.mode || prev.theme !== next.theme || prev.uiStyle !== next.uiStyle) withTransition('theme', update, origin);
  else if (prev.libraryView !== next.libraryView) withTransition('morph', update);
  else update();
  if (sync && state.data) state.data.updateProfile({ settings: next }).catch(() => {});
}
lightQuery.addEventListener?.('change', () => state.settings.mode === 'system' && withTransition('theme', applyTheme));

/* =========================================================================
   Geçişler (View Transitions API; desteklenmezse CSS animasyonları)
   ========================================================================= */
const supportsVT = () => typeof document.startViewTransition === 'function' && !UI.reducedMotion() && !document.hidden;

function withTransition(kind, update, origin = null) {
  if (!supportsVT()) {
    update();
    return;
  }
  const root = document.documentElement;
  if (origin) {
    root.style.setProperty('--vt-x', `${origin.x}px`);
    root.style.setProperty('--vt-y', `${origin.y}px`);
  }
  root.dataset.vt = kind;
  // Tarayıcı kare üretmiyorsa (arka plan, düşük güç) güncelleme asla askıda kalmasın
  let ran = false;
  const once = () => {
    if (ran) return;
    ran = true;
    update();
  };
  try {
    const t = document.startViewTransition(once);
    setTimeout(() => {
      if (ran) return;
      t.skipTransition();
      delete root.dataset.vt;
      once();
    }, 350);
    t.ready.catch(() => {});
    t.updateCallbackDone.catch(err => console.error(err));
    t.finished
      .catch(() => {})
      .finally(() => {
        if (root.dataset.vt === kind) delete root.dataset.vt;
        document.querySelectorAll('.vt-named').forEach(el => {
          el.style.viewTransitionName = '';
          el.classList.remove('vt-named');
        });
      });
  } catch {
    delete root.dataset.vt;
    once();
  }
}
function nameForTransition(el, name) {
  if (!el) return;
  el.style.viewTransitionName = name;
  el.classList.add('vt-named');
}

/* =========================================================================
   Router
   ========================================================================= */
const ROUTES = [
  { name: 'home', re: /^\/?$/ },
  { name: 'library', re: /^\/library\/?$/ },
  { name: 'social', re: /^\/social\/?$/ },
  { name: 'stats', re: /^\/stats\/?$/ },
  { name: 'settings', re: /^\/(settings|profile)\/?$/ },
  { name: 'book', re: /^\/book\/([^/]+)\/?$/, key: 'id' },
];
function matchRoute(path) {
  for (const r of ROUTES) {
    const m = path.match(r.re);
    if (m) return { name: r.name, path, params: r.key ? { [r.key]: decodeURIComponent(m[1]) } : {} };
  }
  return { name: 'home', path: '/', params: {} };
}

function navigate(path, { replace = false } = {}) {
  if (path === location.pathname && !replace) {
    view().scrollTo({ top: 0, behavior: 'smooth' });
    return;
  }
  UI.closeAllSheets();
  state.ui.scroll[location.pathname] = view().scrollTop;
  const depth = (history.state?.depth || 0) + (replace ? 0 : 1);
  history[replace ? 'replaceState' : 'pushState']({ depth }, '', path);
  applyRoute();
}
function goBack() {
  if ((history.state?.depth || 0) > 0) history.back();
  else navigate(state.lastTab || '/library', { replace: true });
}
function applyRoute(forced = null) {
  const prev = state.route;
  const next = matchRoute(location.pathname);
  let transition = forced || 'fade';
  if (!forced) {
    if (next.name === 'book' && prev.name !== 'book') transition = 'push';
    else if (prev.name === 'book' && next.name !== 'book') transition = 'pop';
    else if (next.name === 'book') transition = 'push';
    else {
      const a = TABS.findIndex(t => matchRoute(t.path).name === prev.name);
      const b = TABS.findIndex(t => matchRoute(t.path).name === next.name);
      transition = a >= 0 && b >= 0 && a !== b ? (b > a ? 'tab-right' : 'tab-left') : 'fade';
    }
  }
  const run = () => {
    state.route = next;
    if (next.name !== 'book') state.lastTab = next.name === 'home' ? '/' : `/${next.name}`;
    else state.ui.descOpen = false;
    UI.closeSwipeRows();
    renderView({ transition });
    updateTabbar();
    if (transition === 'pop' && prev.name === 'book') {
      const el = view().querySelector(`[data-id="${CSS.escape(prev.params.id)}"] .cover`);
      nameForTransition(el, 'bk-cover');
    }
  };
  withTransition(transition, run);
  updateAmbient();
}
window.addEventListener('popstate', () => {
  state.ui.scroll[state.route.path] = view().scrollTop;
  UI.closeAllSheets();
  if (state.data) applyRoute();
});

/* =========================================================================
   Render döngüsü
   ========================================================================= */
const VIEWS = { home: viewHome, library: viewLibrary, social: viewSocial, stats: viewStats, settings: viewSettings, book: viewBook };

function isEditing() {
  const a = document.activeElement;
  return !!a && view().contains(a) && /^(INPUT|TEXTAREA)$/.test(a.tagName) && a.type !== 'checkbox';
}

function renderView({ transition = null } = {}) {
  if (!state.data) return;
  const root = view();
  if (!transition && isEditing()) {
    state.pendingRender = true;
    return;
  }
  state.pendingRender = false;
  const anim = transition || (state.wasSkeleton && loaded() ? 'fade' : null);
  state.wasSkeleton = !loaded();
  const prevScroll = root.scrollTop;
  const vt = transition && document.documentElement.dataset.vt ? 'vt' : '';
  root.innerHTML = `<div class="page page-${state.route.name} ${anim ? `enter-${anim} ${vt}` : 'is-static'}">${VIEWS[state.route.name]()}</div>`;
  root.scrollTop = transition ? (transition === 'push' ? 0 : state.ui.scroll[state.route.path] || 0) : prevScroll;
  afterRender(!!anim);
}

function afterRender(animated) {
  const root = view();
  UI.bindSwipeRows(root);
  root.querySelectorAll('[data-rate]').forEach(el =>
    UI.bindStarRating(el, v => {
      el.innerHTML = UI.starRating(v, 26);
      state.data.updateBook(el.dataset.rate, { rating: v }).catch(onWriteError);
      UI.haptic(6);
    }),
  );
  const q = $('#lib-q', root);
  if (q)
    q.addEventListener('input', () => {
      state.ui.libQuery = q.value;
      refreshLibList(false);
    });
  const fs = $('#fs-form', root);
  if (fs) fs.addEventListener('submit', onFriendSearch);
  if (animated) UI.countUp(root);
  onViewScroll();
}

let rafId = 0;
function scheduleRender() {
  if (rafId) return;
  rafId = requestAnimationFrame(() => {
    rafId = 0;
    derive();
    renderView();
    updateAmbient();
    syncStreak();
    syncPublicProfile();
    refreshIsland();
  });
}

let lastScrollY = 0;
function onViewScroll() {
  const root = view();
  const y = root.scrollTop;
  const page = root.querySelector('.page');
  page?.classList.toggle('scrolled', y > 30);
  const hero = page?.querySelector('.book-hero');
  if (hero) hero.style.setProperty('--sy', String(Math.min(y, 400)));
  const tb = $('#tabbar');
  const dy = y - lastScrollY;
  if (y > 140 && dy > 8) tb.classList.add('mini');
  else if (dy < -8 || y < 60) tb.classList.remove('mini');
  lastScrollY = y;
}

/* =========================================================================
   Ortak parçalar
   ========================================================================= */
function navBar({ title = '', back = false, right = '' } = {}) {
  return `<header class="nav-bar">
    <div class="nav-side">${back ? `<button type="button" class="icon-btn glass" data-action="back" aria-label="Geri">${icon('chevronLeft', 20)}</button>` : ''}</div>
    <div class="nav-title">${esc(title)}</div>
    <div class="nav-side end">${right}</div>
  </header>`;
}
function largeTitle(title, eyebrow = '') {
  return `<div class="large-title anim-in" style="--i:0">${eyebrow ? `<p class="eyebrow">${esc(eyebrow)}</p>` : ''}<h1>${esc(title)}</h1></div>`;
}
function sectionHead(title, right = '') {
  return `<div class="section-head"><h2>${esc(title)}</h2>${right}</div>`;
}
function avatarHTML(size = '', name = firstName()) {
  const hue = UI.hashHues(name || 'okur')[0];
  return `<span class="avatar ${size}" style="--ah:${hue}">${name ? esc(name.charAt(0).toLocaleUpperCase('tr')) : icon('person', size === 'xl' ? 28 : 17)}</span>`;
}
function skeletonCards(n = 3) {
  return Array.from({ length: n }, (_, i) => `<div class="skeleton" style="--i:${i}"></div>`).join('');
}
function etaText(st) {
  if (!st.total) return 'Toplam sayfa bilinmiyor';
  if (!st.remaining) return 'Bitirmek üzeresin!';
  return st.etaDays <= 1 ? 'Bugün bitirebilirsin' : `~${st.etaDays} günde biter · ${S.fmtDay(st.etaDate)}`;
}
function ratingCaption(v) {
  if (!v) return 'Puan vermek için yıldızlara dokun';
  if (v <= 1) return 'Beğenmedim';
  if (v <= 2) return 'Pek sevmedim';
  if (v <= 3) return 'İdare eder';
  if (v <= 4) return 'Beğendim';
  if (v < 5) return 'Çok beğendim';
  return 'Favorilerimden';
}
const statusLabel = s => ({ reading: 'Okuyorum', wishlist: 'Okuyacağım', finished: 'Okudum' })[s] || 'Okuyacağım';
const fmtRating = v => String(v).replace('.', ',');

function flameBadge(streak, size = 22) {
  const cls = streak.activeToday ? 'lit' : streak.current ? 'risk' : 'off';
  return `<span class="flame ${cls}">${icon('flame', size)}</span>`;
}
function streakPill() {
  const { streak } = D();
  return `<button type="button" class="streak-pill glass ${streak.activeToday ? 'lit' : ''}" data-action="go" data-to="/stats" aria-label="${streak.current} günlük seri">
    ${flameBadge(streak, 15)}<b>${streak.current}</b></button>`;
}
function accountButton() {
  return isCloud()
    ? `<button type="button" class="icon-btn glass account-btn" data-action="go" data-to="/settings" aria-label="Hesap">${avatarHTML('sm')}</button>`
    : `<button type="button" class="icon-btn glass account-btn" data-action="auth" data-mode="signin" aria-label="Giriş yap">${icon('person', 18)}</button>`;
}

/* =========================================================================
   Görünüm: Bugün
   ========================================================================= */
function viewHome() {
  const name = firstName();
  const head = navBar({ title: 'Bugün', right: loaded() ? streakPill() + accountButton() : '' }) + largeTitle('Bugün', `${S.fmtLong(S.todayKey())}${name ? ` · ${greeting()}, ${name}` : ''}`);
  if (!loaded()) return head + skeletonCards(3);
  const reading = booksBy('reading');
  const wishlist = booksBy('wishlist');
  if (!state.books.length) return head + streakCard() + emptyLibrary();
  return head + streakCard() + readingSection(reading) + upNextSection(wishlist);
}

function streakCard() {
  const { streak, today, profile, summary, map } = D();
  const todayKey = S.todayKey();
  const pagePct = Math.min(100, Math.round((today.pages / profile.dailyPageGoal) * 100));
  const msg = streak.activeToday
    ? today.pages >= profile.dailyPageGoal
      ? 'Günlük hedef tamam. Harika gidiyorsun!'
      : 'Bugünkü okuman sayıldı, seri devam ediyor.'
    : streak.current
      ? 'Serini korumak için bugün 1 sayfa yeter.'
      : 'Bugün okuyarak yeni bir seri başlat.';
  if (minimal()) {
    return `<section class="card streak-card compact anim-in" style="--i:1" data-action="go" data-to="/stats">
      ${flameBadge(streak, 22)}
      <div class="sc-text"><div class="sc-count"><b data-count="${streak.current}">${streak.current}</b><span>günlük seri</span></div></div>
      <div class="sc-mini-goal"><b>${today.pages}</b><small>/${profile.dailyPageGoal}</small><div class="progress sm"><span style="width:${pagePct}%"></span></div></div>
    </section>`;
  }
  const week = S.weekKeys(todayKey);
  return `<section class="card streak-card anim-in" style="--i:1">
    <div class="sc-top">
      ${flameBadge(streak, 28)}
      <div class="sc-text">
        <div class="sc-count"><b data-count="${streak.current}">${streak.current}</b><span>günlük seri</span></div>
        <p>${msg}</p>
      </div>
    </div>
    <div class="sc-week">
      ${week
        .map((k, i) => {
          const e = map.get(k);
          const on = !!e && (e.pages > 0 || e.minutes > 0);
          return `<button type="button" class="sw-day ${on ? 'on' : ''} ${k === todayKey ? 'today' : ''}" data-action="day" data-key="${k}" ${k > todayKey ? 'disabled' : ''} style="--i:${i}">
            <span class="sw-dot">${on ? icon('flame', 12) : ''}</span><small>${S.WEEKDAYS_MINI[i]}</small></button>`;
        })
        .join('')}
    </div>
    <div class="sc-goal">
      <div class="sg-row"><span>Günlük hedef</span><b><span data-count="${today.pages}">${today.pages}</span><small> / ${profile.dailyPageGoal} sayfa</small></b></div>
      <div class="progress"><span style="width:${pagePct}%"></span></div>
      <div class="sg-meta"><span>${icon('clock', 12)} ${today.minutes} dk okuma</span><span>${icon('trophy', 12)} ${new Date().getFullYear()}: ${summary.finishedThisYear}/${profile.yearlyBookGoal} kitap</span></div>
    </div>
  </section>`;
}

function emptyLibrary() {
  return `<section class="card empty-hero anim-in" style="--i:2">
    <div class="empty-icon">${icon('bookOpen', 26)}</div>
    <h2>Kütüphanen seni bekliyor</h2>
    <p>İlk kitabını ekle, okuma serini başlat ve her gün biraz daha ilerle.</p>
    <div class="empty-actions">
      <button type="button" class="btn btn-primary sm" data-action="add-book">${icon('search', 15)} Kitap Ara</button>
      <button type="button" class="btn btn-secondary sm" data-action="scan">${icon('barcode', 15)} Barkod</button>
    </div>
  </section>`;
}

function readingSection(list) {
  if (!list.length)
    return `${sectionHead('Okumaya devam et')}
    <button type="button" class="card empty-inline anim-in" style="--i:2" data-action="add-book">
      <span class="ei-icon">${icon('bookOpen', 18)}</span>
      <div><b>Şu an okuduğun kitap yok</b><p>İstek listenden seç ya da yeni bir kitap ekle.</p></div>
      ${icon('chevronRight', 15, 'muted')}
    </button>`;
  const more = `<a class="link" href="/library" data-link data-shelf="reading">Tümü</a>`;
  if (minimal()) return `${sectionHead('Okumaya devam et', more)}<div class="rows anim-in" style="--i:2">${list.slice(0, 4).map(bookRow).join('')}</div>`;
  return `${sectionHead('Okumaya devam et', more)}
    <div class="h-scroll reading-carousel ${list.length === 1 ? 'single' : ''} anim-in" style="--i:2">${list.map(readingCard).join('')}</div>`;
}

function readingCard(b) {
  const st = S.bookStats(b, state.logs, D().profile, D().summary.avgPagesPerDay);
  const p = pct(b);
  const timerOn = state.timer?.bookId === b.id;
  return `<article class="card reading-card" data-action="open-book" data-id="${b.id}">
    ${UI.cover(b, 'md')}
    <div class="rc-body">
      <h3 class="rc-title">${esc(b.title)}</h3>
      <p class="rc-author">${esc(b.author || 'Bilinmeyen yazar')}</p>
      <div class="rc-progress"><div class="progress sm"><span style="width:${p}%"></span></div><b>%${p}</b></div>
      <p class="rc-eta">${b.totalPages ? `${b.currentPage || 0}/${b.totalPages} · ` : ''}${etaText(st)}</p>
      <div class="rc-actions">
        <button type="button" class="btn btn-primary xs" data-action="log" data-id="${b.id}">${icon('plus', 13)} İlerleme</button>
        <button type="button" class="icon-btn btn-tint sm ${timerOn ? 'active' : ''}" data-action="timer" data-id="${b.id}" aria-label="Zamanlayıcı">${icon('timer', 16)}</button>
      </div>
    </div>
  </article>`;
}

function upNextSection(list) {
  if (!list.length) return '';
  return `${sectionHead('Sıradakiler', `<a class="link" href="/library" data-link data-shelf="wishlist">Tümü</a>`)}
  <div class="h-scroll upnext anim-in" style="--i:3">
    ${list
      .slice(0, 12)
      .map(
        b => `<button type="button" class="upnext-item" data-action="open-book" data-id="${b.id}">
          ${UI.cover(b, 'md')}
          ${b.priority === 'high' ? `<span class="un-flag">${icon('flag', 10)}</span>` : ''}
          <span class="un-title">${esc(b.title)}</span>
        </button>`,
      )
      .join('')}
  </div>`;
}

function quoteCard(q, withBook = false) {
  const isNote = q.kind === 'note';
  return `<article class="card quote-card ${isNote ? 'note' : ''}" data-action="share-quote" data-id="${q.id}">
    <span class="qc-kind">${icon(isNote ? 'note' : 'quote', 12)}<span>${isNote ? 'Not' : 'Alıntı'}</span></span>
    <p class="qc-text">${esc(q.text)}</p>
    <footer>${withBook ? `<span class="qc-book">${esc(q.bookTitle || '')}</span>` : ''}${q.page ? `<span>s. ${q.page}</span>` : ''}<span>${S.relDay(S.dateKey(new Date(S.tsMs(q.createdAt) || Date.now())))}</span>${icon('share', 13)}</footer>
  </article>`;
}

/* =========================================================================
   Görünüm: Kütüphane (liste / ızgara)
   ========================================================================= */
function viewLibrary() {
  const right = `<button type="button" class="icon-btn glass" data-action="add-book" aria-label="Kitap ekle">${icon('plus', 20)}</button>`;
  const head = navBar({ title: 'Kütüphane', right }) + largeTitle('Kütüphane', `${state.books.length} kitap`);
  if (!loaded()) return head + skeletonCards(4);
  const count = s => state.books.filter(b => b.status === s).length;
  const tabs = [
    { key: 'reading', label: 'Okuyorum', badge: count('reading') },
    { key: 'wishlist', label: 'Okuyacağım', badge: count('wishlist') },
    { key: 'finished', label: 'Okudum', badge: count('finished') },
    { key: 'collections', label: 'Koleksiyon', badge: allCollections().length },
  ];
  return `${head}
  <div class="lib-toolbar anim-in" style="--i:1">
    <label class="search-field">${icon('search', 15)}<input id="lib-q" type="search" placeholder="Kütüphanende ara" value="${esc(state.ui.libQuery)}" autocomplete="off" enterkeyhint="search"></label>
    ${UI.segmented(
      [
        { key: 'list', icon: 'list', title: 'Liste görünümü' },
        { key: 'grid', icon: 'grid', title: 'Izgara görünümü' },
      ],
      state.settings.libraryView,
      { action: 'lib-view', id: 'lib-view', cls: 'icon-seg' },
    )}
  </div>
  <div class="anim-in" style="--i:2">${UI.segmented(tabs, state.ui.libTab, { action: 'lib-tab', id: 'lib-seg', cls: 'shelf-seg' })}</div>
  <div id="lib-list" class="lib-list anim-in" style="--i:3">${libraryList()}</div>`;
}

function refreshLibList(animate = true) {
  const list = $('#lib-list');
  if (!list) return renderView();
  list.innerHTML = libraryList();
  if (animate) {
    list.classList.remove('swap');
    void list.offsetWidth;
    list.classList.add('swap');
  }
  UI.bindSwipeRows(list);
}

function bookCollection(list) {
  if (state.settings.libraryView === 'grid') return `<div class="book-grid">${list.map(gridItem).join('')}</div>`;
  return `<div class="rows">${list.map(bookRow).join('')}</div>`;
}

function libraryList() {
  const tab = state.ui.libTab;
  const q = state.ui.libQuery.trim().toLocaleLowerCase('tr');
  const match = b => !q || `${b.title} ${b.author || ''}`.toLocaleLowerCase('tr').includes(q);
  if (tab === 'collections') return collectionsList(match);
  const list = booksBy(tab).filter(match);
  if (!list.length) return emptyShelf(tab, !!q);
  return bookCollection(list);
}

function emptyShelf(tab, searching) {
  if (searching) return `<div class="empty-shelf">${icon('search', 24)}<b>Sonuç yok</b><p>Bu rafta aramanla eşleşen kitap bulunamadı.</p></div>`;
  const map = {
    reading: ['bookOpen', 'Şu an okuduğun kitap yok', 'Yeni bir kitap ekle ya da istek listenden okumaya başla.'],
    wishlist: ['bookmark', 'İstek listen boş', 'Okumak istediğin kitapları buraya ekle; sıradaki okumanı kolayca seç.'],
    finished: ['trophy', 'Henüz bitirilen kitap yok', 'Bitirdiğin kitaplar puan ve incelemeleriyle burada görünür.'],
  };
  const [ic, t, d] = map[tab];
  return `<div class="empty-shelf">${icon(ic, 24)}<b>${t}</b><p>${d}</p><button type="button" class="btn btn-primary xs" data-action="add-book">${icon('plus', 13)} Kitap Ekle</button></div>`;
}

function swipeBtn(action, id, label, ic, color) {
  return `<button type="button" class="swipe-btn" data-action="${action}" data-id="${id}" style="--c:${color}">${icon(ic, 17)}<span>${label}</span></button>`;
}

function bookRow(b, i = 0) {
  const id = b.id;
  let left = '';
  let right = '';
  let body = '';
  let trailing = '';
  if (b.status === 'reading') {
    const p = pct(b);
    left = swipeBtn('timer', id, 'Zamanlayıcı', 'timer', 'var(--green)');
    right = swipeBtn('delete-book', id, 'Sil', 'trash', 'var(--red)') + swipeBtn('log', id, 'Sayfa', 'bookOpen', 'var(--accent)');
    body = `<p class="br-sub">${esc(b.author || 'Bilinmeyen yazar')}</p>
      <div class="rc-progress"><div class="progress sm"><span style="width:${p}%"></span></div><b>%${p}</b></div>`;
    trailing = `<button type="button" class="icon-btn btn-tint sm" data-action="log" data-id="${id}" aria-label="İlerleme kaydet">${icon('plus', 15)}</button>`;
  } else if (b.status === 'wishlist') {
    left = swipeBtn('start-reading', id, 'Başla', 'play', 'var(--green)');
    right = swipeBtn('delete-book', id, 'Sil', 'trash', 'var(--red)');
    body = `<p class="br-sub">${esc(b.author || 'Bilinmeyen yazar')}</p>
      <p class="br-meta">${b.priority === 'high' ? `<span class="badge warm">${icon('flag', 10)} Öncelikli</span>` : ''}${b.totalPages ? `<span>${b.totalPages} sayfa</span>` : ''}</p>`;
    trailing = `<button type="button" class="btn btn-secondary xs" data-action="start-reading" data-id="${id}">Başla</button>`;
  } else {
    left = swipeBtn('share-book', id, 'Paylaş', 'share', 'var(--purple)');
    right = swipeBtn('delete-book', id, 'Sil', 'trash', 'var(--red)');
    const fin = S.tsMs(b.finishedAt);
    body = `<p class="br-sub">${esc(b.author || 'Bilinmeyen yazar')}</p>
      <p class="br-meta">${UI.starRating(b.rating || 0, 11)}${fin ? `<span>${S.fmtDay(S.dateKey(new Date(fin)))}</span>` : ''}</p>`;
  }
  return `<div class="swipe-row anim-item" data-id="${id}" style="--i:${Math.min(i, 12)}">
    <div class="swipe-actions left">${left}</div>
    <div class="swipe-actions right">${right}</div>
    <div class="swipe-content card book-row" data-action="open-book" data-id="${id}">
      ${UI.cover(b, 'sm')}
      <div class="br-body"><h3 class="br-title">${esc(b.title)}</h3>${body}</div>
      ${trailing}
    </div>
  </div>`;
}

function gridItem(b, i = 0) {
  const p = pct(b);
  const sub = b.status === 'reading' ? `%${p}` : b.status === 'finished' && b.rating ? `★ ${fmtRating(b.rating)}` : b.author || '';
  return `<button type="button" class="grid-item anim-item" style="--i:${Math.min(i, 15)}" data-action="open-book" data-id="${b.id}">
    <span class="gi-cover">
      ${UI.cover(b, 'fluid')}
      ${b.status === 'reading' ? `<span class="gi-bar"><i style="width:${p}%"></i></span>` : ''}
      ${b.status === 'wishlist' && b.priority === 'high' ? `<span class="gi-flag">${icon('flag', 9)}</span>` : ''}
    </span>
    <span class="gi-title">${esc(b.title)}</span>
    <span class="gi-sub">${esc(sub)}</span>
  </button>`;
}

function collectionsList(match) {
  const cols = allCollections();
  const name = state.ui.libCollection;
  if (name) {
    const list = state.books.filter(b => b.collection === name && match(b));
    return `<div class="coll-head">
        <button type="button" class="chip" data-action="lib-collection" data-name="">${icon('chevronLeft', 13)} Koleksiyonlar</button>
        <h2>${esc(name)}</h2><span class="muted-sm">${list.length} kitap</span>
      </div>
      ${list.length ? bookCollection(list) : `<div class="empty-shelf">${icon('folder', 24)}<b>Bu koleksiyon boş</b><p>Kitap detayındaki ••• menüsünden “Koleksiyona Ekle”yi seç.</p></div>`}`;
  }
  return `<div class="coll-grid">
    ${cols
      .map((c, i) => {
        const bs = state.books.filter(b => b.collection === c);
        return `<button type="button" class="card coll-tile anim-item" style="--i:${i}" data-action="lib-collection" data-name="${esc(c)}">
          <span class="coll-stack">${bs.slice(0, 3).map(b => UI.cover(b, 'xs')).join('') || `<span class="coll-empty">${icon('folder', 20)}</span>`}</span>
          <b>${esc(c)}</b><small>${bs.length} kitap</small>
        </button>`;
      })
      .join('')}
    <button type="button" class="card coll-tile new anim-item" style="--i:${cols.length}" data-action="new-collection">
      <span class="coll-empty">${icon('plus', 20)}</span><b>Yeni koleksiyon</b><small>Kendi rafını oluştur</small>
    </button>
  </div>`;
}

/* =========================================================================
   Görünüm: Sosyal (arkadaşlar)
   ========================================================================= */
const weekStartKey = () => S.weekKeys(S.todayKey())[0];

/** Arkadaşın yayınladığı değerleri bugüne göre yorumla (eski veriyi sıfırla). */
function friendLive(pub) {
  if (!pub) return { streak: 0, week: 0, today: 0, lit: false };
  const today = S.todayKey();
  const yesterday = S.addDays(today, -1);
  const alive = pub.lastActiveDay === today || pub.lastActiveDay === yesterday;
  return {
    streak: alive ? pub.currentStreak || 0 : 0,
    week: pub.weekKey === weekStartKey() ? pub.weekPages || 0 : 0,
    today: pub.dayKey === today ? pub.todayPages || 0 : 0,
    lit: pub.lastActiveDay === today,
  };
}

function friendsOf() {
  const me = state.user?.uid;
  return state.social.friendships
    .filter(f => f.status === 'accepted')
    .map(f => {
      const uid = f.members.find(m => m !== me);
      const pub = state.social.profiles.get(uid);
      const n = f.names?.[uid] || {};
      return { id: f.id, uid, pub, nickname: pub?.nickname || n.nickname || '', displayName: pub?.displayName || n.displayName || n.nickname || 'Okur' };
    });
}

function socialGuest() {
  return `<section class="card social-hero anim-in" style="--i:1">
    <div class="sh-art">${icon('people', 30)}</div>
    <h2>Arkadaşlarınla birlikte oku</h2>
    <p>Hesap oluştur, @kullanıcı adınla arkadaş ekle; birbirinizin serisini, okuduğu kitapları ve haftalık sayfalarını görün.</p>
    <div class="ac-actions">
      <button type="button" class="btn btn-primary sm" data-action="auth" data-mode="signup">${icon('person', 14)} Hesap oluştur</button>
      <button type="button" class="btn btn-secondary sm" data-action="auth" data-mode="signin">${icon('cloud', 14)} Giriş yap</button>
    </div>
  </section>`;
}

function viewSocial() {
  const canAdd = isCloud() && myNick();
  const right = canAdd ? `<button type="button" class="icon-btn glass" data-action="focus-friend-search" aria-label="Arkadaş ekle">${icon('personAdd', 19)}</button>` : '';
  const head = navBar({ title: 'Sosyal', right }) + largeTitle('Sosyal', 'Arkadaşlarınla birlikte oku');
  if (!isCloud()) return head + socialGuest();
  if (!loaded()) return head + skeletonCards(3);
  if (!myNick())
    return `${head}<section class="card social-hero anim-in" style="--i:1">
      <div class="sh-art">${icon('at', 30)}</div>
      <h2>Kullanıcı adını seç</h2>
      <p>Arkadaşların seni @kullanıcı adınla bulur. Giriş yaparken e-posta yerine de kullanabilirsin.</p>
      <button type="button" class="btn btn-primary sm block" data-action="nickname">${icon('at', 14)} Kullanıcı adı seç</button>
    </section>`;

  const me = state.user.uid;
  const fr = state.social.friendships;
  const incoming = fr.filter(f => f.status === 'pending' && f.requester !== me);
  const outgoing = fr.filter(f => f.status === 'pending' && f.requester === me);
  const friends = friendsOf();
  return `${head}
  <section class="card me-card anim-in" style="--i:1">
    ${avatarHTML('lg')}
    <div class="mc-text"><b>${esc(displayName() || 'Okur')}</b><span>@${esc(myNick())}</span></div>
    <button type="button" class="btn btn-secondary xs" data-action="copy-nick">${icon('copy', 13)} Kopyala</button>
  </section>

  <section class="card friend-search anim-in" style="--i:2">
    <form id="fs-form" class="fs-row" autocomplete="off">
      <label class="search-field">${icon('at', 15)}<input id="fs-q" type="text" placeholder="kullanıcı adıyla arkadaş ekle" value="${esc(state.ui.friendQuery)}" autocapitalize="off" spellcheck="false" enterkeyhint="search"></label>
      <button type="submit" class="btn btn-primary sm">Ara</button>
    </form>
    <div id="fs-result">${friendResultHTML()}</div>
  </section>

  ${
    incoming.length
      ? `${sectionHead('Arkadaşlık istekleri', `<span class="count-badge">${incoming.length}</span>`)}
  <div class="card list-group anim-in" style="--i:3">${incoming
    .map(f => {
      const uid = f.members.find(m => m !== me);
      const n = f.names?.[uid] || {};
      return `<div class="person-row">${avatarHTML('', n.displayName || n.nickname)}<div class="pr-text"><b>${esc(n.displayName || n.nickname)}</b><span>@${esc(n.nickname || '')}</span></div>
        <button type="button" class="icon-btn btn-tint sm ok" data-action="friend-accept" data-id="${f.id}" aria-label="Kabul et">${icon('check', 16)}</button>
        <button type="button" class="icon-btn btn-tint sm" data-action="friend-remove" data-id="${f.id}" data-kind="decline" aria-label="Reddet">${icon('close', 15)}</button></div>`;
    })
    .join('')}</div>`
      : ''
  }

  ${friends.length ? leaderboard(friends) : ''}

  ${sectionHead('Arkadaşlar', friends.length ? `<span class="muted-sm">${friends.length}</span>` : '')}
  ${
    friends.length
      ? `<div class="card list-group anim-in" style="--i:5">${friends
          .map(f => {
            const live = friendLive(f.pub);
            const reading = f.pub?.reading?.[0];
            return `<button type="button" class="person-row" data-action="friend-open" data-uid="${f.uid}">
            ${avatarHTML('', f.displayName)}
            <div class="pr-text"><b>${esc(f.displayName)}</b><span>${reading ? `${icon('bookOpen', 11)} ${esc(reading.title)}` : `@${esc(f.nickname)}`}</span></div>
            <span class="pr-streak ${live.lit ? 'lit' : ''}">${icon('flame', 13)}${live.streak}</span>
            ${icon('chevronRight', 14, 'lr-chev')}
          </button>`;
          })
          .join('')}</div>`
      : `<div class="empty-shelf">${icon('people', 24)}<b>Henüz arkadaşın yok</b><p>Yukarıdan @kullanıcı adıyla arkadaşlarını ekle; serilerinizi birlikte takip edin.</p></div>`
  }

  ${
    outgoing.length
      ? `${sectionHead('Gönderilen istekler')}
  <div class="card list-group anim-in" style="--i:6">${outgoing
    .map(f => {
      const uid = f.members.find(m => m !== me);
      const n = f.names?.[uid] || {};
      return `<div class="person-row">${avatarHTML('', n.displayName || n.nickname)}<div class="pr-text"><b>${esc(n.displayName || n.nickname)}</b><span>@${esc(n.nickname || '')} · yanıt bekleniyor</span></div>
        <button type="button" class="btn btn-secondary xs" data-action="friend-remove" data-id="${f.id}" data-kind="cancel">İptal</button></div>`;
    })
    .join('')}</div>`
      : ''
  }`;
}

function leaderboard(friends) {
  const { map } = D();
  const myWeek = S.weekKeys(S.todayKey()).reduce((a, k) => a + (map.get(k)?.pages || 0), 0);
  const rows = [{ me: true, name: 'Sen', week: myWeek, streak: D().streak.current, lit: D().streak.activeToday }, ...friends.map(f => ({ uid: f.uid, name: f.displayName, ...(({ week, streak, lit }) => ({ week, streak, lit }))(friendLive(f.pub)) }))].sort(
    (a, b) => b.week - a.week,
  );
  const max = Math.max(1, ...rows.map(r => r.week));
  return `${sectionHead('Bu hafta', `<span class="muted-sm">okunan sayfa</span>`)}
  <section class="card leaderboard anim-in" style="--i:4">
    ${rows
      .map(
        (r, i) => `<${r.me ? 'div' : 'button type="button"'} class="lb-row ${r.me ? 'me' : ''}" ${r.me ? '' : `data-action="friend-open" data-uid="${r.uid}"`}>
        <span class="lb-rank">${i + 1}</span>
        ${avatarHTML('sm', r.me ? firstName() || 'Sen' : r.name)}
        <span class="lb-name">${esc(r.name)}</span>
        <span class="lb-bar"><i style="width:${Math.round((r.week / max) * 100)}%"></i></span>
        <b class="lb-val">${r.week}</b>
      </${r.me ? 'div' : 'button'}>`,
      )
      .join('')}
  </section>`;
}

function friendResultHTML() {
  const r = state.ui.friendResult;
  if (!r) return '';
  if (r.state === 'loading') return `<p class="fs-msg"><span class="spinner"></span> Aranıyor…</p>`;
  if (r.state === 'invalid') return `<p class="fs-msg">${icon('info', 14)} Kullanıcı adı 3–20 karakter olmalı (harf, rakam, _ ve .).</p>`;
  if (r.state === 'none') return `<p class="fs-msg">${icon('info', 14)} @${esc(r.nick)} bulunamadı.</p>`;
  if (r.state === 'error') return `<p class="fs-msg">${icon('info', 14)} Arama yapılamadı. Bağlantını kontrol et.</p>`;
  const me = state.user.uid;
  const f = state.social.friendships.find(x => x.members.includes(r.uid));
  let action;
  if (r.uid === me) action = `<span class="muted-sm">Bu sensin</span>`;
  else if (f?.status === 'accepted') action = `<span class="badge ok">${icon('check', 11)} Arkadaşsınız</span>`;
  else if (f && f.requester === me) action = `<span class="badge">İstek gönderildi</span>`;
  else if (f) action = `<button type="button" class="btn btn-primary xs" data-action="friend-accept" data-id="${f.id}">Kabul et</button>`;
  else action = `<button type="button" class="btn btn-primary xs" data-action="friend-request" data-uid="${r.uid}">${icon('personAdd', 13)} Ekle</button>`;
  return `<div class="person-row found">${avatarHTML('', r.displayName || r.nick)}<div class="pr-text"><b>${esc(r.displayName || r.nick)}</b><span>@${esc(r.nick)}</span></div>${action}</div>`;
}

async function onFriendSearch(e) {
  e.preventDefault();
  const input = $('#fs-q');
  const nick = normalizeNickname(input.value);
  state.ui.friendQuery = input.value;
  const out = $('#fs-result');
  const show = r => {
    state.ui.friendResult = r;
    if (out) out.innerHTML = friendResultHTML();
  };
  if (!isValidNickname(nick)) return show({ state: 'invalid' });
  show({ state: 'loading' });
  try {
    const entry = await state.fb.social.lookupNickname(nick);
    show(entry ? { state: 'found', nick, uid: entry.uid, displayName: entry.displayName || '' } : { state: 'none', nick });
  } catch (err) {
    console.error(err);
    show({ state: 'error' });
  }
}

async function sendFriendRequest(uid) {
  const r = state.ui.friendResult;
  if (!r || r.uid !== uid) return;
  try {
    const res = await state.fb.social.sendRequest(
      { uid: state.user.uid, nickname: myNick(), displayName: displayName() },
      { uid, nickname: r.nick, displayName: r.displayName },
    );
    UI.haptic([8, 30, 8]);
    UI.toast(res === 'accepted' ? `@${r.nick} ile artık arkadaşsınız` : res === 'already' ? 'Zaten arkadaşsınız' : `@${r.nick} kullanıcısına istek gönderildi`, { icon: 'personAdd' });
  } catch (err) {
    onWriteError(err);
  }
}

function openFriendSheet(uid) {
  const f = friendsOf().find(x => x.uid === uid);
  if (!f) return;
  const p = f.pub || {};
  const live = friendLive(f.pub);
  UI.openSheet({
    title: '',
    html: `
      <div class="friend-hero">
        ${avatarHTML('xl', f.displayName)}
        <h2>${esc(f.displayName)}</h2>
        <p>@${esc(f.nickname)}</p>
      </div>
      <div class="friend-stats">
        <div><span class="flame ${live.lit ? 'lit' : live.streak ? 'risk' : 'off'}">${icon('flame', 18)}</span><b>${live.streak}</b><small>günlük seri</small></div>
        <div><b>${live.week}</b><small>bu hafta sayfa</small></div>
        <div><b>${p.finishedThisYear || 0}</b><small>${new Date().getFullYear()} bitirilen</small></div>
      </div>
      ${
        p.reading?.length
          ? `<div class="field-label">Şu an okuyor</div><div class="friend-books">${p.reading
              .map(b => `<div class="fb-item">${UI.cover(b, 'sm')}<div><b>${esc(b.title)}</b><span>${esc(b.author || '')}</span><div class="rc-progress"><div class="progress sm"><span style="width:${b.progress || 0}%"></span></div><b>%${b.progress || 0}</b></div></div></div>`)
              .join('')}</div>`
          : ''
      }
      ${
        p.recent?.length
          ? `<div class="field-label">Son bitirdikleri</div><div class="friend-books">${p.recent
              .map(b => `<div class="fb-item">${UI.cover(b, 'sm')}<div><b>${esc(b.title)}</b><span>${esc(b.author || '')}</span>${b.rating ? UI.starRating(b.rating, 11) : ''}</div></div>`)
              .join('')}</div>`
          : ''
      }
      ${!f.pub ? `<p class="day-empty">${esc(f.displayName)} henüz okuma verisi paylaşmadı.</p>` : ''}
      <button type="button" class="btn btn-destructive-ghost block" data-sh="remove">${icon('close', 14)} Arkadaşlıktan çıkar</button>`,
    onMount(body, sheet) {
      $('[data-sh="remove"]', body).addEventListener('click', async () => {
        const ok = await UI.confirmSheet({ title: `${f.displayName} arkadaşlıktan çıkarılsın mı?`, confirmText: 'Arkadaşlıktan Çıkar', destructive: true });
        if (!ok) return;
        state.fb.social.remove(f.id).catch(onWriteError);
        sheet.close('removed');
      });
    },
  });
}

/* ---------- Sosyal abonelikler ---------- */
function stopSocial() {
  state.social.unsub?.();
  state.social.subs.forEach(u => u());
  state.social = { friendships: [], profiles: new Map(), subs: new Map(), unsub: null, ready: false };
  updateSocialBadge();
}
function startSocial(uid) {
  stopSocial();
  if (!state.fb?.social) return;
  state.social.unsub = state.fb.social.listenFriendships(
    uid,
    list => {
      state.social.friendships = list;
      state.social.ready = true;
      const friendIds = new Set(list.filter(f => f.status === 'accepted').map(f => f.members.find(m => m !== uid)));
      for (const [fid, unsub] of state.social.subs)
        if (!friendIds.has(fid)) {
          unsub();
          state.social.subs.delete(fid);
          state.social.profiles.delete(fid);
        }
      for (const fid of friendIds)
        if (!state.social.subs.has(fid))
          state.social.subs.set(
            fid,
            state.fb.social.listenPublicProfile(
              fid,
              pub => {
                state.social.profiles.set(fid, pub);
                if (state.route.name === 'social') scheduleRender();
              },
              () => {},
            ),
          );
      updateSocialBadge();
      if (state.route.name === 'social') scheduleRender();
    },
    err => console.warn('[sosyal]', err),
  );
}
function updateSocialBadge() {
  const me = state.user?.uid;
  const n = me ? state.social.friendships.filter(f => f.status === 'pending' && f.requester !== me).length : 0;
  const tab = $('.tab[data-tab="/social"]');
  if (tab) tab.dataset.badge = n ? String(n) : '';
}

/** Arkadaşların göreceği özet profil (yalnızca değişince, gecikmeli yazılır). */
let publicTimer = 0;
let lastPublic = '';
function syncPublicProfile() {
  if (!isCloud() || !myNick() || !state.fb?.social || !loaded()) return;
  clearTimeout(publicTimer);
  publicTimer = setTimeout(() => {
    const { streak, summary, map, today } = D();
    const days = [...map.keys()].filter(k => map.get(k).pages > 0 || map.get(k).minutes > 0).sort();
    const safe = u => (u && /^https:\/\//.test(u) ? u : '');
    const data = {
      uid: state.user.uid,
      nickname: myNick(),
      displayName: displayName(),
      currentStreak: streak.current,
      longestStreak: streak.longest,
      lastActiveDay: days[days.length - 1] || '',
      todayPages: today.pages,
      dayKey: S.todayKey(),
      weekPages: S.weekKeys(S.todayKey()).reduce((a, k) => a + (map.get(k)?.pages || 0), 0),
      weekKey: weekStartKey(),
      finishedThisYear: summary.finishedThisYear,
      finishedTotal: summary.finishedCount,
      totalPages: summary.totalPages,
      reading: booksBy('reading')
        .slice(0, 3)
        .map(b => ({ title: b.title, author: b.author || '', coverUrl: safe(b.coverUrl), isbn: b.isbn || '', progress: pct(b) })),
      recent: booksBy('finished')
        .slice(0, 4)
        .map(b => ({ title: b.title, author: b.author || '', coverUrl: safe(b.coverUrl), isbn: b.isbn || '', rating: b.rating || 0 })),
    };
    const sig = JSON.stringify(data);
    if (sig === lastPublic) return;
    lastPublic = sig;
    state.fb.social.writePublicProfile(state.user.uid, data).catch(err => console.warn('[sosyal] profil yazılamadı', err));
  }, 2500);
}

/* =========================================================================
   Görünüm: İstatistikler
   ========================================================================= */
function metric(ic, label, value, sub, count = null) {
  return `<div class="card metric">
    <span class="metric-ic">${icon(ic, 14)}</span>
    <small>${esc(label)}</small>
    <b ${count != null ? `data-count="${count}"` : ''}>${esc(String(value))}</b>
    <span class="metric-sub">${esc(sub)}</span>
  </div>`;
}

function viewStats() {
  const right = `<button type="button" class="icon-btn glass" data-action="edit-goals" aria-label="Hedefler">${icon('target', 19)}</button>`;
  const head = navBar({ title: 'İstatistikler', right }) + largeTitle('İstatistikler', 'Okuma alışkanlığın');
  if (!loaded()) return head + skeletonCards(3);
  const { streak, summary, profile, today } = D();
  const year = new Date().getFullYear();
  const yearPct = Math.min(100, Math.round((summary.finishedThisYear / profile.yearlyBookGoal) * 100));
  const expectedPct = Math.min(100, summary.yearProgress * 100);
  const diff = summary.finishedThisYear - summary.expectedByNow;
  const paceMsg =
    summary.finishedThisYear >= profile.yearlyBookGoal
      ? 'Yıllık hedefini tamamladın. Harika bir yıl!'
      : diff >= 0.5
        ? `Hedefin ${Math.floor(diff) || 1} kitap önündesin.`
        : diff <= -0.5
          ? `Hedef temposunun ${Math.ceil(-diff)} kitap gerisindesin.`
          : 'Tam hedef temposundasın.';
  const avg = summary.avgPagesPerDay ? summary.avgPagesPerDay.toFixed(1) : '0';
  return `${head}
  <section class="card streak-hero anim-in" style="--i:1">
    ${flameBadge(streak, 34)}
    <div class="sh-main"><b data-count="${streak.current}">${streak.current}</b><span>günlük seri</span></div>
    <div class="sh-side">
      <div><small>En uzun</small><b>${streak.longest} gün</b></div>
      <div><small>Bugün</small><b>${today.pages} sf · ${today.minutes} dk</b></div>
    </div>
  </section>

  <div class="metric-grid anim-in" style="--i:2">
    ${metric('bookOpen', 'Toplam sayfa', S.fmtNum(summary.totalPages), 'gerçek okumalar', summary.totalPages)}
    ${metric('trophy', 'Bitirilen', summary.finishedCount, `${year}: ${summary.finishedThisYear}`, summary.finishedCount)}
    ${metric('bolt', 'Ortalama hız', avg.replace('.', ','), 'sayfa / gün', avg)}
    ${metric('clock', 'Okuma süresi', S.fmtMinutes(summary.totalMinutes), summary.pagesPerHour ? `~${Math.round(summary.pagesPerHour)} sf/sa` : `${summary.activeDays} aktif gün`)}
  </div>

  <section class="card goal-card anim-in" style="--i:3">
    <div class="gc-top">
      <div><small>${year} okuma hedefi</small><h3><span data-count="${summary.finishedThisYear}">${summary.finishedThisYear}</span><span class="gc-of"> / ${profile.yearlyBookGoal} kitap</span></h3></div>
      ${UI.progressRing(yearPct / 100, 50, `%${yearPct}`)}
    </div>
    <div class="progress"><span style="width:${yearPct}%"></span><i class="progress-marker" style="left:${expectedPct}%"></i></div>
    <p class="gc-msg">${paceMsg}</p>
    ${!minimal() && summary.finishedThisYearBooks.length ? `<div class="goal-covers">${summary.finishedThisYearBooks.slice(0, 8).map(b => `<button type="button" data-action="open-book" data-id="${b.id}">${UI.cover(b, 'xs')}</button>`).join('')}</div>` : ''}
  </section>

  <section class="card chart-card anim-in" style="--i:4">
    <div class="card-head"><h3>Okunan sayfa</h3>${UI.segmented(
      [
        { key: '7', label: '7G' },
        { key: '30', label: '30G' },
        { key: '12', label: '12A' },
      ],
      state.ui.chartRange,
      { action: 'chart-range', cls: 'compact' },
    )}</div>
    <div id="chart-body">${chartBody()}</div>
  </section>

  <section class="card cal-card anim-in" style="--i:5">
    <div class="card-head"><h3>Okuma takvimi</h3>${UI.segmented(
      [
        { key: 'month', label: 'Ay' },
        { key: 'week', label: 'Hafta' },
      ],
      state.ui.calMode,
      { action: 'cal-mode', cls: 'compact' },
    )}</div>
    <div id="cal-body">${calBody()}</div>
    <button type="button" class="btn btn-secondary block sm" data-action="log-any">${icon('plus', 13)} Unuttuğun okumayı sonradan ekle</button>
  </section>

  ${
    minimal()
      ? ''
      : `<section class="card insights anim-in" style="--i:6">
    <ul>
      <li>${icon('calendar', 15)}<span>En verimli gün</span><b>${summary.bestWeekday >= 0 ? S.WEEKDAYS[summary.bestWeekday] : '—'}</b></li>
      <li>${icon('chart', 15)}<span>Son 30 gün</span><b>${S.fmtNum(summary.last30Pages)} sayfa</b></li>
      <li>${icon('timer', 15)}<span>Ortalama oturum</span><b>${summary.avgSessionMinutes ? S.fmtMinutes(summary.avgSessionMinutes) : '—'}</b></li>
    </ul>
  </section>`
  }`;
}

function chartBody() {
  const { map, profile } = D();
  const today = S.todayKey();
  const r = state.ui.chartRange;
  if (r === '12') {
    const cur = new Date().getMonth();
    const ms = S.monthSeries(map, new Date().getFullYear());
    const total = ms.reduce((a, m) => a + m.pages, 0);
    const mins = ms.reduce((a, m) => a + m.minutes, 0);
    return (
      UI.barChart(
        ms.map((m, i) => ({ label: S.MONTHS_SHORT[i], value: m.pages, active: i === cur, dim: i > cur })),
        { showValues: false },
      ) + `<div class="chart-foot"><span><b>${S.fmtNum(total)}</b> sayfa</span><span><b>${(total / (cur + 1)).toFixed(0)}</b> ort./ay</span><span><b>${S.fmtMinutes(mins)}</b></span></div>`
    );
  }
  const n = Number(r);
  const data = S.series(map, n);
  const total = data.reduce((a, d) => a + d.pages, 0);
  const mins = data.reduce((a, d) => a + d.minutes, 0);
  return (
    UI.barChart(
      data.map(d => ({ key: d.key, label: n === 7 ? S.WEEKDAYS_SHORT[S.wdIndex(d.key)] : String(Number(d.key.slice(8))), value: d.pages, active: d.key === today })),
      { goal: profile.dailyPageGoal, showValues: n === 7, labelEvery: n === 7 ? 1 : 5, action: 'day' },
    ) + `<div class="chart-foot"><span><b>${S.fmtNum(total)}</b> sayfa</span><span><b>${(total / n).toFixed(1).replace('.', ',')}</b> ort./gün</span><span><b>${S.fmtMinutes(mins)}</b></span></div>`
  );
}

function calNav(label, isCurrent) {
  return `<div class="cal-nav">
    <button type="button" class="icon-btn btn-tint sm" data-action="cal-prev" aria-label="Önceki">${icon('chevronLeft', 15)}</button>
    <b>${esc(label)}</b>
    <button type="button" class="icon-btn btn-tint sm" data-action="cal-next" aria-label="Sonraki" ${isCurrent ? 'disabled' : ''}>${icon('chevronRight', 15)}</button>
  </div>`;
}

function calBody() {
  const { map, profile } = D();
  const today = S.todayKey();
  if (state.ui.calMode === 'week') {
    const keys = S.weekKeys(state.ui.calWeek);
    const max = Math.max(profile.dailyPageGoal, ...keys.map(k => map.get(k)?.pages || 0));
    const total = keys.reduce((a, k) => a + (map.get(k)?.pages || 0), 0);
    return `${calNav(`${S.fmtDay(keys[0])} – ${S.fmtDay(keys[6])}`, keys.includes(today))}
    <div class="week-list">
      ${keys
        .map((k, i) => {
          const e = map.get(k);
          const fut = k > today;
          const lvl = S.heatLevel(e, profile);
          return `<button type="button" class="week-row ${k === today ? 'today' : ''}" data-action="day" data-key="${k}" ${fut ? 'disabled' : ''} style="--i:${i}">
            <span class="wr-day"><b>${S.WEEKDAYS_SHORT[i]}</b><small>${Number(k.slice(8))}</small></span>
            <span class="wr-bar"><i class="lvl-${lvl}" style="width:${e?.pages ? Math.max(5, (e.pages / max) * 100) : e?.minutes ? 5 : 0}%"></i></span>
            <span class="wr-val">${e ? `${e.pages} sf${e.minutes ? ` · ${e.minutes} dk` : ''}` : fut ? '' : '—'}</span>
          </button>`;
        })
        .join('')}
    </div>
    <div class="cal-foot"><span>Bu hafta ${total} sayfa</span></div>`;
  }
  const [y, m] = state.ui.calMonth.split('-').map(Number);
  const cells = S.monthMatrix(y, m - 1);
  let monthPages = 0;
  let activeDays = 0;
  const grid = cells
    .map((k, i) => {
      if (!k) return '<span class="cal-cell empty"></span>';
      const e = map.get(k);
      if (e && (e.pages || e.minutes)) {
        monthPages += e.pages;
        activeDays += 1;
      }
      const lvl = S.heatLevel(e, profile);
      const fut = k > today;
      return `<button type="button" class="cal-cell lvl-${lvl} ${k === today ? 'today' : ''} ${fut ? 'future' : ''}" style="--i:${i}" data-action="day" data-key="${k}" ${fut ? 'disabled' : ''} aria-label="${S.fmtDay(k)}${e ? `, ${e.pages} sayfa` : ''}">
        <span>${Number(k.slice(8))}</span>${e?.pages ? `<small>${e.pages}</small>` : ''}
      </button>`;
    })
    .join('');
  return `${calNav(`${S.MONTHS[m - 1]} ${y}`, state.ui.calMonth === today.slice(0, 7))}
    <div class="cal-week-head">${S.WEEKDAYS_MINI.map(d => `<span>${d}</span>`).join('')}</div>
    <div class="cal-grid">${grid}</div>
    <div class="cal-foot">
      <span>${activeDays} aktif gün · ${S.fmtNum(monthPages)} sayfa</span>
      <span class="heat-legend">Az<i class="lvl-1"></i><i class="lvl-2"></i><i class="lvl-3"></i><i class="lvl-4"></i>Çok</span>
    </div>`;
}

function shiftCalendar(dir) {
  const today = S.todayKey();
  if (state.ui.calMode === 'week') {
    const next = S.addDays(state.ui.calWeek, dir * 7);
    if (dir > 0 && S.weekKeys(next)[0] > today) return;
    state.ui.calWeek = next;
  } else {
    let [y, m] = state.ui.calMonth.split('-').map(Number);
    m += dir;
    if (m < 1) {
      m = 12;
      y -= 1;
    } else if (m > 12) {
      m = 1;
      y += 1;
    }
    const key = `${y}-${String(m).padStart(2, '0')}`;
    if (key > today.slice(0, 7)) return;
    state.ui.calMonth = key;
  }
  const body = $('#cal-body');
  if (!body) return;
  body.innerHTML = calBody();
  body.classList.remove('swap-left', 'swap-right', 'swap');
  void body.offsetWidth;
  body.classList.add(dir > 0 ? 'swap-right' : dir < 0 ? 'swap-left' : 'swap');
}

/* =========================================================================
   Görünüm: Ayarlar
   ========================================================================= */
function tile(ic, color) {
  return `<span class="lr-tile" style="--c:${color}">${icon(ic, 14)}</span>`;
}
function listRow({ action, ic, color, label, value = '', attrs = '', cls = '' }) {
  return `<button type="button" class="list-row ${cls}" data-action="${action}" ${attrs}>${tile(ic, color)}<span class="lr-label">${esc(label)}</span>${value ? `<b>${esc(value)}</b>` : ''}${icon('chevronRight', 13, 'lr-chev')}</button>`;
}

function accountSection() {
  if (isCloud()) {
    return `<section class="card account-card anim-in" style="--i:1">
      <div class="ac-top">
        ${avatarHTML('xl')}
        <div class="ac-text">
          <h2>${esc(displayName() || 'Okur')}</h2>
          <p>${myNick() ? `@${esc(myNick())} · ` : ''}${esc(state.user.email || '')}</p>
          <span class="badge ok">${icon('cloud', 11)} Hesapla senkronize</span>
        </div>
      </div>
    </section>
    <div class="card list-group anim-in" style="--i:2">
      ${listRow({ action: 'nickname', ic: 'at', color: 'var(--accent)', label: 'Kullanıcı adı', value: myNick() ? `@${myNick()}` : 'Seç' })}
      ${listRow({ action: 'reset-password', ic: 'lock', color: 'var(--teal)', label: 'Şifreyi sıfırla' })}
      <button type="button" class="list-row danger" data-action="sign-out">${tile('logout', 'var(--red)')}<span class="lr-label">Oturumu kapat</span></button>
    </div>`;
  }
  return `<section class="card account-card guest anim-in" style="--i:1">
    <div class="ac-top">
      ${avatarHTML('xl')}
      <div class="ac-text">
        <h2>${esc(displayName() || 'Misafir')}</h2>
        <p>Hesapsız kullanıyorsun · veriler bu cihazda</p>
      </div>
    </div>
    <p class="ac-note">Hesap oluşturursan kütüphanen, serin ve istatistiklerin tüm cihazlarında senkron kalır; arkadaşlarını ekleyebilirsin. Bu cihazdaki her şey hesabına aktarılır.</p>
    <div class="ac-actions">
      <button type="button" class="btn btn-primary sm" data-action="auth" data-mode="signup">${icon('person', 14)} Hesap oluştur</button>
      <button type="button" class="btn btn-secondary sm" data-action="auth" data-mode="signin">${icon('cloud', 14)} Giriş yap</button>
    </div>
  </section>`;
}

function stylePicker() {
  const s = state.settings.uiStyle;
  const opt = (key, title, desc) => `<button type="button" class="style-option ${s === key ? 'on' : ''}" data-action="set-ui" data-key="${key}" aria-pressed="${s === key}">
    <span class="sp-preview sp-${key}" aria-hidden="true">
      <span class="sp-title"></span>
      <span class="sp-card"><i></i><span><em></em><em></em></span></span>
      <span class="sp-card"><i></i><span><em></em><em></em></span></span>
      <span class="sp-bar"></span>
    </span>
    <span class="sp-label"><b>${title}</b><small>${desc}</small></span>
    <span class="sp-check">${icon('check', 12)}</span>
  </button>`;
  return `<div class="style-picker">
    ${opt('normal', 'Normal', 'Kartlar, kapaklar ve ışık')}
    ${opt('minimal', 'Minimal', 'Sade, düz ve odaklı')}
  </div>`;
}

function viewSettings() {
  const head = navBar({ title: 'Ayarlar' }) + largeTitle('Ayarlar');
  if (!loaded()) return head + skeletonCards(3);
  const { profile } = D();
  const cols = allCollections();
  const s = state.settings;
  return `${head}
  ${accountSection()}

  <h3 class="group-title">Arayüz</h3>
  <div class="anim-in" style="--i:3">${stylePicker()}</div>

  <h3 class="group-title">Görünüm</h3>
  <section class="card appearance anim-in" style="--i:4">
    ${UI.segmented(
      [
        { key: 'system', label: 'Sistem', icon: 'sunMoon' },
        { key: 'light', label: 'Aydınlık', icon: 'sun' },
        { key: 'dark', label: 'Karanlık', icon: 'moon' },
      ],
      s.mode,
      { action: 'set-mode', id: 'mode-seg', cls: 'mode-seg' },
    )}
    <div class="theme-grid">
      ${THEMES.map(
        t => `<button type="button" class="theme-swatch ${t.key === s.theme ? 'on' : ''}" data-action="set-theme" data-key="${t.key}" aria-pressed="${t.key === s.theme}">
          <span class="sw-orb" data-theme-preview="${t.key}"><span class="sw-check">${icon('check', 13)}</span></span>
          <small>${t.label}</small>
        </button>`,
      ).join('')}
    </div>
    <div class="setting-row">
      <div><b>Kapak renkli ışık</b><small>Okuduğun kitabın rengi ekranın üstüne hafifçe yansır.</small></div>
      ${UI.switchHTML('set-glow', s.coverGlow)}
    </div>
    <div class="setting-row">
      <div><b>Kütüphane görünümü</b><small>Liste ya da kapak ızgarası</small></div>
      ${UI.segmented(
        [
          { key: 'list', icon: 'list', title: 'Liste' },
          { key: 'grid', icon: 'grid', title: 'Izgara' },
        ],
        s.libraryView,
        { action: 'lib-view', cls: 'icon-seg' },
      )}
    </div>
  </section>

  <h3 class="group-title">Hedefler</h3>
  <div class="list-group card anim-in" style="--i:5">
    ${listRow({ action: 'edit-goals', ic: 'trophy', color: 'var(--orange)', label: 'Yıllık kitap hedefi', value: `${profile.yearlyBookGoal} kitap` })}
    ${listRow({ action: 'edit-goals', ic: 'bookOpen', color: 'var(--pink)', label: 'Günlük sayfa hedefi', value: `${profile.dailyPageGoal} sayfa` })}
    ${listRow({ action: 'edit-goals', ic: 'clock', color: 'var(--green)', label: 'Günlük dakika hedefi', value: `${profile.dailyMinuteGoal} dk` })}
  </div>

  <h3 class="group-title">Koleksiyonlar</h3>
  <div class="list-group card anim-in" style="--i:6">
    ${cols
      .map(
        c => `<div class="list-row has-trail">
          <button type="button" class="lr-main" data-action="open-collection" data-name="${esc(c)}">${tile('folder', 'var(--purple)')}<span class="lr-label">${esc(c)}</span><b>${state.books.filter(b => b.collection === c).length}</b>${icon('chevronRight', 13, 'lr-chev')}</button>
          <button type="button" class="icon-btn sm ghost" data-action="delete-collection" data-name="${esc(c)}" aria-label="${esc(c)} koleksiyonunu sil">${icon('trash', 14)}</button>
        </div>`,
      )
      .join('')}
    ${listRow({ action: 'new-collection', ic: 'plus', color: 'var(--accent)', label: 'Yeni koleksiyon' })}
  </div>

  <h3 class="group-title">Uygulama</h3>
  <div class="list-group card anim-in" style="--i:7">
    ${listRow({ action: 'install-help', ic: 'share', color: 'var(--teal)', label: 'Ana ekrana ekle' })}
    <div class="list-row static">${tile(isCloud() ? 'cloud' : 'device', 'var(--indigo)')}<span class="lr-label">Veri depolama</span><b>${isCloud() ? 'Hesap · gerçek zamanlı' : 'Bu cihaz'}</b></div>
  </div>
  <p class="footnote">Okur 1.3</p>`;
}

/* =========================================================================
   Görünüm: Kitap detayı
   ========================================================================= */
function viewBook() {
  const b = getBook(state.route.params.id);
  const more = b ? `<button type="button" class="icon-btn glass" data-action="book-menu" data-id="${b.id}" aria-label="Diğer işlemler">${icon('more', 20)}</button>` : '';
  const head = navBar({ title: b?.title || '', back: true, right: more });
  if (!b) {
    if (!loaded()) return head + skeletonCards(2);
    return `${head}<div class="empty-shelf tall">${icon('books', 28)}<b>Kitap bulunamadı</b><p>Bu kitap silinmiş olabilir.</p><button type="button" class="btn btn-primary xs" data-action="go" data-to="/library">Kütüphaneye dön</button></div>`;
  }
  const { profile, summary } = D();
  const st = S.bookStats(b, state.logs, profile, summary.avgPagesPerDay);
  const quotes = state.quotes.filter(q => q.bookId === b.id).sort((x, y) => S.tsMs(y.createdAt) - S.tsMs(x.createdAt));
  const logs = state.logs.filter(l => l.bookId === b.id).sort((x, y) => S.tsMs(y.timestamp) - S.tsMs(x.timestamp));
  const [h1, h2] = UI.hashHues(b.title);
  const chips = [
    `<span class="chip static status-${b.status}">${statusLabel(b.status)}</span>`,
    b.collection ? `<button type="button" class="chip" data-action="open-collection" data-name="${esc(b.collection)}">${icon('folder', 11)} ${esc(b.collection)}</button>` : '',
    b.status === 'wishlist' && b.priority === 'high' ? `<span class="chip static warm">${icon('flag', 10)} Öncelikli</span>` : '',
    b.totalPages ? `<span class="chip static">${b.totalPages} sayfa</span>` : '',
    !b.coverUrl ? `<button type="button" class="chip accent" data-action="change-cover" data-id="${b.id}">${icon('image', 12)} Kapak ekle</button>` : '',
  ].join('');

  return `${head}
  <section class="book-hero">
    <div class="book-hero-bg" style="--h1:${h1};--h2:${h2}">${b.coverUrl ? UI.cover(b, 'md') : ''}</div>
    <button type="button" class="book-hero-cover" style="view-transition-name:bk-cover" data-action="change-cover" data-id="${b.id}" aria-label="Kapağı değiştir">${UI.cover(b, 'xl', { eager: true })}</button>
    <h1 class="book-title anim-in" style="--i:1">${esc(b.title)}</h1>
    <p class="book-author anim-in" style="--i:1">${esc(b.author || 'Bilinmeyen yazar')}</p>
    <div class="book-chips anim-in" style="--i:2">${chips}</div>
  </section>
  <div class="anim-in" style="--i:3">${bookStatusCard(b, st)}</div>
  ${
    st.sessions || st.minutes
      ? `<div class="metric-row anim-in" style="--i:4">
    <div class="card"><small>Okuma süresi</small><b>${S.fmtMinutes(st.minutes)}</b></div>
    <div class="card"><small>Oturum</small><b>${st.sessions}</b></div>
    <div class="card"><small>Tempo</small><b>${st.pagesPerHour ? `${Math.round(st.pagesPerHour)} sf/sa` : st.pace ? `${st.pace.toFixed(0)} sf/gün` : '—'}</b></div>
  </div>`
      : ''
  }
  ${
    b.description
      ? `<section class="card book-desc ${state.ui.descOpen ? 'open' : ''} anim-in" style="--i:5">
    <h3>Özet</h3><p>${esc(b.description)}</p>
    <button type="button" class="link" data-action="toggle-desc"><span class="more">Devamını oku</span><span class="less">Daha az göster</span></button>
  </section>`
      : ''
  }
  ${sectionHead('Alıntılar ve notlar', `<button type="button" class="btn btn-secondary xs" data-action="add-quote" data-id="${b.id}">${icon('plus', 12)} Ekle</button>`)}
  <div class="quote-list anim-in" style="--i:6">
    ${quotes.length ? quotes.map(q => quoteCard(q)).join('') : `<button type="button" class="card empty-inline dashed" data-action="add-quote" data-id="${b.id}"><span class="ei-icon">${icon('quote', 16)}</span><div><b>İlk alıntını kaydet</b><p>Beğendiğin cümleleri sayfa numarasıyla sakla.</p></div></button>`}
  </div>
  ${sectionHead('Okuma geçmişi', logs.length ? `<span class="muted-sm">${logs.length} kayıt</span>` : '')}
  <div class="card log-list anim-in" style="--i:7">
    ${logs.length ? logs.slice(0, 40).map(logRow).join('') : `<p class="log-empty">Henüz okuma kaydı yok.</p>`}
  </div>`;
}

function bookStatusCard(b, st) {
  if (b.status === 'reading') {
    const p = pct(b);
    const timerOn = state.timer?.bookId === b.id;
    return `<section class="card progress-card">
      <div class="pc-top">
        ${UI.progressRing(p / 100, 72, `<b>%${p}</b>`)}
        <div class="pc-info">
          ${b.totalPages ? `<p class="pc-pages"><b>${b.currentPage || 0}</b> / ${b.totalPages} sayfa</p><p class="muted-sm">${st.remaining} sayfa kaldı</p>` : `<p class="pc-pages"><b>Sayfa ${b.currentPage || 0}</b></p><button type="button" class="link" data-action="edit-book" data-id="${b.id}">Toplam sayfayı gir</button>`}
          <p class="pc-eta">${icon('clock', 12)} ${etaText(st)}</p>
        </div>
      </div>
      <div class="pc-actions">
        <button type="button" class="btn btn-primary sm" data-action="log" data-id="${b.id}">${icon('bookOpen', 15)} İlerleme Kaydet</button>
        <button type="button" class="btn btn-secondary sm ${timerOn ? 'active' : ''}" data-action="timer" data-id="${b.id}">${icon('timer', 15)} ${timerOn ? 'Oturum açık' : 'Zamanlayıcı'}</button>
      </div>
    </section>`;
  }
  if (b.status === 'wishlist') {
    return `<section class="card wish-card">
      <p>Bu kitap <b>istek listende</b>. Hazır olduğunda tek dokunuşla okumaya başla.</p>
      <div class="pc-actions">
        <button type="button" class="btn btn-primary sm" data-action="start-reading" data-id="${b.id}">${icon('play', 13)} Okumaya Başla</button>
        <button type="button" class="btn btn-secondary sm" data-action="toggle-priority" data-id="${b.id}">${icon('flag', 13)} ${b.priority === 'high' ? 'Öncelikli' : 'Öncelik ver'}</button>
      </div>
    </section>`;
  }
  const fin = S.tsMs(b.finishedAt);
  return `<section class="card finished-card">
    <div class="fc-top"><span class="fc-badge">${icon('trophy', 13)} Okudum${fin ? ` · ${S.fmtDay(S.dateKey(new Date(fin)), true)}` : ''}</span></div>
    <div class="fc-rating" data-rate="${b.id}">${UI.starRating(b.rating || 0, 26)}</div>
    <p class="fc-caption">${ratingCaption(b.rating || 0)}</p>
    ${b.review ? `<blockquote class="fc-review">${esc(b.review)}</blockquote>` : ''}
    <div class="pc-actions">
      <button type="button" class="btn btn-secondary sm" data-action="finish-book" data-id="${b.id}">${icon('pencil', 13)} ${b.review ? 'Düzenle' : 'İnceleme yaz'}</button>
      <button type="button" class="btn btn-primary sm" data-action="share-book" data-id="${b.id}">${icon('share', 13)} Paylaş</button>
    </div>
  </section>`;
}

function logRow(l) {
  const d = S.parseKey(l.date);
  const excluded = l.excludeFromStats;
  const typeLabel = { baseline_sync: 'Başlangıç eşitleme', correction: 'Düzeltme', timer_session: 'Zamanlayıcı', progress: 'İlerleme' }[l.type] || 'Kayıt';
  return `<div class="log-row ${excluded ? 'excluded' : ''}">
    <div class="log-date"><b>${d.getDate()}</b><small>${S.MONTHS_SHORT[d.getMonth()]}</small></div>
    <div class="log-body">
      <p>Sayfa ${l.startPage ?? '?'} → ${l.endPage ?? '?'} ${l.pagesRead ? `<span class="tag accent">+${l.pagesRead}</span>` : ''}${excluded ? `<span class="tag muted">İstatistik dışı</span>` : ''}</p>
      <small>${[typeLabel, l.durationMinutes ? `${l.durationMinutes} dk` : '', l.note ? esc(l.note) : ''].filter(Boolean).join(' · ')}</small>
    </div>
    <button type="button" class="icon-btn sm ghost" data-action="delete-log" data-id="${l.id}" aria-label="Kaydı sil">${icon('trash', 13)}</button>
  </div>`;
}

/* =========================================================================
   Kitap işlemleri
   ========================================================================= */
function addBook(data) {
  const { id, done } = state.data.addBook(data);
  state.pendingBooks.set(id, { id, ...data });
  done.catch(onWriteError);
  return id;
}

function afterBookAdded(id, data) {
  UI.haptic([8, 30, 8]);
  if (data.status === 'reading') {
    UI.toast('Kitap “Okuyorum” rafına eklendi', { icon: 'check' });
    setTimeout(() => openLogSheet({ bookId: id, mode: 'current', exclude: true, baseline: true }), 420);
  } else if (data.status === 'finished') {
    setTimeout(() => openFinishSheet({ id, ...data }), 420);
  } else {
    UI.toast('İstek listene eklendi', { icon: 'bookmark', action: 'Görüntüle', onAction: () => navigate(`/book/${id}`) });
  }
}

function startReading(id) {
  const b = getBook(id);
  if (!b) return;
  state.data.updateBook(id, { status: 'reading', startedAt: b.startedAt || Date.now(), finishedAt: null, lastReadAt: Date.now() }).catch(onWriteError);
  UI.haptic(8);
  UI.toast('“Okuyorum” rafına taşındı', {
    icon: 'bookOpen',
    action: 'Sayfa gir',
    duration: 4200,
    onAction: () => openLogSheet({ bookId: id, mode: 'current', exclude: true, baseline: true }),
  });
}

function togglePriority(id) {
  const b = getBook(id);
  if (!b) return;
  state.data.updateBook(id, { priority: b.priority === 'high' ? 'normal' : 'high' }).catch(onWriteError);
  UI.haptic(6);
}

async function deleteBook(id) {
  const b = getBook(id);
  if (!b) return;
  const ok = await UI.confirmSheet({
    title: `“${b.title}” silinsin mi?`,
    message: 'Kitap ve alıntıları silinir. Geçmiş okuma istatistiklerin korunur.',
    confirmText: 'Kitabı Sil',
    destructive: true,
  });
  if (!ok) return;
  if (state.timer?.bookId === id) discardTimer();
  state.data.deleteBook(id, { quoteIds: state.quotes.filter(q => q.bookId === id).map(q => q.id) }).catch(onWriteError);
  if (state.route.name === 'book' && state.route.params.id === id) navigate(state.lastTab || '/library', { replace: true });
  UI.toast('Kitap silindi', { icon: 'trash' });
}

async function deleteLog(id) {
  const ok = await UI.confirmSheet({
    title: 'Bu okuma kaydı silinsin mi?',
    message: 'Kayıt istatistiklerden çıkarılır. Kitabın mevcut sayfası değişmez.',
    confirmText: 'Kaydı Sil',
    destructive: true,
  });
  if (!ok) return;
  state.data.deleteLog(id).catch(onWriteError);
  UI.toast('Kayıt silindi', { icon: 'trash' });
}

async function openBookMenu(id) {
  const b = getBook(id);
  if (!b) return;
  const actions = [
    { label: 'Kitabı Düzenle', icon: 'pencil', value: 'edit' },
    { label: b.coverUrl ? 'Kapağı Değiştir' : 'Kapak Ekle', icon: 'image', value: 'cover' },
    b.status !== 'reading' && { label: 'Okuyorum’a Taşı', icon: 'bookOpen', value: 'reading' },
    b.status !== 'wishlist' && { label: 'Okuyacağım’a Taşı', icon: 'bookmark', value: 'wishlist' },
    b.status !== 'finished' && { label: 'Okudum Olarak İşaretle', icon: 'check', value: 'finished' },
    { label: b.collection ? `Koleksiyon: ${b.collection}` : 'Koleksiyona Ekle', icon: 'folder', value: 'collection' },
    { label: 'Alıntı / Not Ekle', icon: 'quote', value: 'quote' },
    { label: 'Kitabı Sil', icon: 'trash', value: 'delete', destructive: true },
  ].filter(Boolean);
  const v = await UI.actionSheet({ title: b.title, message: b.author || '', actions });
  if (v === 'edit') openBookForm(b);
  else if (v === 'cover') changeCover(b);
  else if (v === 'reading') startReading(id);
  else if (v === 'wishlist') {
    state.data.updateBook(id, { status: 'wishlist', finishedAt: null }).catch(onWriteError);
    UI.toast('“Okuyacağım” rafına taşındı', { icon: 'bookmark' });
  } else if (v === 'finished') openFinishSheet(b);
  else if (v === 'collection') openCollectionPicker(b);
  else if (v === 'quote') openQuoteSheet(b);
  else if (v === 'delete') deleteBook(id);
}

function changeCover(b) {
  if (!b) return;
  openCoverPicker({
    title: b.title,
    author: b.author,
    current: b.coverUrl,
    onPick: url => {
      state.data.updateBook(b.id, { coverUrl: url }).catch(onWriteError);
      ambientKey = '';
      UI.toast(url ? 'Kapak güncellendi' : 'Kapak kaldırıldı', { icon: 'image' });
    },
  });
}

/* =========================================================================
   Sheet: Kapak seçici (diğer baskılar, fotoğraf, bağlantı)
   ========================================================================= */
function openCoverPicker({ title = '', author = '', current = '', onPick }) {
  let controller = null;
  let results = [];
  UI.openSheet({
    title: 'Kapak seç',
    size: 'large',
    html: `
      <div class="cp-actions">
        <label class="quick-tile">${icon('camera', 19)}<b>Fotoğraf</b><small>Çek ya da galeriden seç</small><input id="cp-file" type="file" accept="image/*" hidden></label>
        <button type="button" class="quick-tile" data-sh="url">${icon('link', 19)}<b>Bağlantı</b><small>Görsel adresi yapıştır</small></button>
      </div>
      <div class="inline-form hidden" id="cp-url-row"><input id="cp-url" class="input" type="url" inputmode="url" placeholder="https://…/kapak.jpg"><button type="button" class="btn btn-primary sm" data-sh="use-url">Kullan</button></div>
      <label class="search-field cp-search">${icon('search', 15)}<input id="cp-q" type="search" value="${esc([title, author].filter(Boolean).join(' '))}" placeholder="Başlık, yazar ya da orijinal adı" enterkeyhint="search"></label>
      <p class="cp-hint">Türkçe baskının kapağı yoksa kitabın orijinal adıyla aramayı dene (ör. “The Willows Blackwood”).</p>
      <div id="cp-grid" class="cover-pick-grid"></div>
      ${current ? `<button type="button" class="btn btn-destructive-ghost block" data-sh="clear">${icon('trash', 14)} Kapağı kaldır</button>` : ''}`,
    onMount(body, sheet) {
      const grid = $('#cp-grid', body);
      const input = $('#cp-q', body);
      const pick = url => {
        onPick?.(url);
        sheet.close('picked');
      };
      const run = async () => {
        controller?.abort();
        controller = new AbortController();
        grid.innerHTML = Array.from({ length: 6 }, (_, i) => `<div class="skeleton cover-skel" style="--i:${i}"></div>`).join('');
        try {
          results = await searchCovers(input.value, { signal: controller.signal });
          grid.innerHTML = results.length
            ? results.map((r, i) => `<button type="button" class="cp-item" data-i="${i}" style="--i:${Math.min(i, 14)}">${UI.cover({ title: r.label, coverUrl: r.url }, 'fluid')}<small>${esc(r.label || '')}</small></button>`).join('')
            : `<p class="day-empty">Kapak bulunamadı. Fotoğraf çekerek ekleyebilirsin.</p>`;
        } catch (err) {
          if (err.name !== 'AbortError') grid.innerHTML = `<p class="day-empty">Arama yapılamadı.</p>`;
        }
      };
      run();
      input.addEventListener('keydown', e => {
        if (e.key === 'Enter') {
          input.blur();
          run();
        }
      });
      body.addEventListener('click', e => {
        const item = e.target.closest('.cp-item');
        if (item) return pick(results[Number(item.dataset.i)].url);
        const a = e.target.closest('[data-sh]')?.dataset.sh;
        if (a === 'url') $('#cp-url-row', body).classList.toggle('hidden');
        if (a === 'use-url') {
          const url = $('#cp-url', body).value.trim().replace(/^http:\/\//i, 'https://');
          if (/^https:\/\//i.test(url)) pick(url);
          else UI.toast('Adres https:// ile başlamalı', { tone: 'error' });
        }
        if (a === 'clear') pick('');
      });
      $('#cp-file', body).addEventListener('change', async e => {
        const file = e.target.files?.[0];
        if (!file) return;
        try {
          pick(await UI.imageFileToCover(file));
        } catch (err) {
          console.error(err);
          UI.toast('Fotoğraf işlenemedi', { tone: 'error' });
        }
      });
    },
    onClose: () => controller?.abort(),
  });
}

/* =========================================================================
   Sheet: İlerleme Kaydet (+ İstatistiklere Ekleme anahtarı, geçmiş tarih)
   ========================================================================= */
function openLogSheet({ bookId = null, mode = 'current', exclude = false, date = S.todayKey(), minutes = 0, fromTimer = false, baseline = false } = {}) {
  const pickable = [...booksBy('reading'), ...booksBy('wishlist')];
  const fixed = !!bookId;
  const sel = { bookId: bookId || pickable[0]?.id, mode, exclude, date };
  if (!sel.bookId || !getBook(sel.bookId)) {
    UI.toast('Önce kütüphanene bir kitap ekle', { icon: 'info', action: 'Ekle', onAction: () => openAddBookSheet() });
    return;
  }
  const today = S.todayKey();
  const yesterday = S.addDays(today, -1);
  const title = fromTimer ? 'Oturumu Kaydet' : baseline ? 'Nereden Başlıyorsun?' : 'İlerleme Kaydet';

  const html = `
    ${
      fixed
        ? ''
        : `<div class="field-label">Kitap</div>
    <div class="h-scroll chip-row no-drag" id="lg-books">${pickable
      .map(b => `<button type="button" class="chip book-chip ${b.id === sel.bookId ? 'on' : ''}" data-book="${b.id}">${UI.cover(b, 'xs')}<span>${esc(b.title)}</span></button>`)
      .join('')}</div>`
    }
    <div class="log-head" id="lg-head"></div>
    ${fromTimer ? `<div class="callout ok">${icon('timer', 15)}<p><b>${minutes} dakika</b> okudun. Şimdi kaçıncı sayfada kaldığını gir.</p></div>` : ''}
    ${baseline ? `<div class="callout">${icon('sparkles', 15)}<p>Bu kitaba önceden başladıysan şu an kaçıncı sayfada olduğunu gir. <b>İstatistiklere Ekleme</b> açık olduğu için bugünkü istatistiklerin şişmez.</p></div>` : ''}
    ${UI.segmented(
      [
        { key: 'current', label: 'Şu anki sayfam' },
        { key: 'delta', label: 'Bugün okuduğum' },
      ],
      sel.mode,
      { id: 'lg-mode' },
    )}
    <label class="field-label" for="lg-value" id="lg-value-label"></label>
    <div class="stepper big">
      <button type="button" class="step" data-step="-1" aria-label="Azalt">${icon('minus', 19)}</button>
      <input id="lg-value" class="stepper-input" type="number" inputmode="numeric" pattern="[0-9]*" min="0" autocomplete="off">
      <button type="button" class="step" data-step="1" aria-label="Artır">${icon('plus', 19)}</button>
    </div>
    <p class="log-preview" id="lg-preview" aria-live="polite"></p>

    <div class="toggle-card ${sel.exclude ? 'on' : ''}" id="lg-exclude-card">
      <div class="toggle-text">
        <b>İstatistiklere Ekleme (Sadece mevcut sayfayı güncelle)</b>
        <p>Halihazırda okumakta olduğunuz bir kitabın başlangıç sayfasını eşitlerken açın. Bugün okunan sayfa sayısını ve günlük istatistiklerinizi şişirmez.</p>
      </div>
      ${UI.switchHTML('lg-exclude', sel.exclude)}
    </div>

    <div class="field-label">Tarih</div>
    <div class="chip-row wrap" id="lg-dates">
      <button type="button" class="chip" data-date="${today}">Bugün</button>
      <button type="button" class="chip" data-date="${yesterday}">Dün</button>
      <span class="chip date-chip" id="lg-date-chip">${icon('calendar', 13)}<span id="lg-date-text">Tarih seç</span><input type="date" id="lg-date" max="${today}" value="${sel.date}" aria-label="Geçmiş bir tarih seç"></span>
    </div>

    <label class="field-label" for="lg-min">Okuma süresi (dakika)</label>
    <div class="stepper">
      <button type="button" class="step" data-mstep="-5" aria-label="5 dakika azalt">${icon('minus', 15)}</button>
      <input id="lg-min" class="stepper-input" type="number" inputmode="numeric" pattern="[0-9]*" min="0" value="${minutes || ''}" placeholder="0">
      <button type="button" class="step" data-mstep="5" aria-label="5 dakika artır">${icon('plus', 15)}</button>
    </div>

    <label class="field-label" for="lg-note">Not (isteğe bağlı)</label>
    <textarea id="lg-note" class="input" rows="2" placeholder="Bu okuma hakkında kısa bir not…"></textarea>

    <button type="button" class="btn btn-primary block" id="lg-save">${icon('check', 17)} Kaydet</button>`;

  UI.openSheet({
    title,
    size: 'large',
    html,
    onMount(body, sheet) {
      const valueEl = $('#lg-value', body);
      const minEl = $('#lg-min', body);
      const noteEl = $('#lg-note', body);
      const excl = $('#lg-exclude', body);
      const preview = $('#lg-preview', body);
      const save = $('#lg-save', body);
      const label = $('#lg-value-label', body);
      const head = $('#lg-head', body);
      const dateInput = $('#lg-date', body);
      const dateText = $('#lg-date-text', body);
      const book = () => getBook(sel.bookId);

      const renderHead = () => {
        const b = book();
        head.innerHTML = `${UI.cover(b, 'sm')}<div><h3>${esc(b.title)}</h3><p>${esc(b.author || '')}</p><p class="lh-pages">Şu an: <b>Sayfa ${b.currentPage || 0}</b>${b.totalPages ? ` / ${b.totalPages}` : ''}</p></div>`;
      };
      const setDefaultValue = () => {
        const b = book();
        if (sel.mode === 'current') {
          valueEl.value = baseline || !(b.currentPage > 0) ? '' : String(b.currentPage);
          valueEl.placeholder = String(b.currentPage || 0);
        } else {
          valueEl.value = '';
          valueEl.placeholder = '0';
        }
      };
      const compute = () => {
        const b = book();
        const old = b.currentPage || 0;
        const total = b.totalPages || 0;
        const raw = parseInt(valueEl.value, 10);
        const has = !Number.isNaN(raw);
        let next = sel.mode === 'current' ? (has ? raw : old) : old + (has ? raw : 0);
        const capped = total > 0 && next > total;
        next = Math.max(0, total ? Math.min(next, total) : next);
        const mins = Math.max(0, parseInt(minEl.value, 10) || 0);
        return { b, old, total, next, delta: next - old, mins, capped };
      };
      const refresh = () => {
        label.textContent = sel.mode === 'current' ? 'Şu an kaçıncı sayfadasın?' : 'Kaç sayfa okudun?';
        sel.exclude = excl.checked;
        $('#lg-exclude-card', body).classList.toggle('on', sel.exclude);
        body.querySelectorAll('[data-date]').forEach(ch => ch.classList.toggle('on', ch.dataset.date === sel.date));
        const custom = sel.date !== today && sel.date !== yesterday;
        dateText.textContent = custom ? S.fmtDay(sel.date) : 'Tarih seç';
        $('#lg-date-chip', body).classList.toggle('on', custom);

        const c = compute();
        const pctStr = c.total ? ` · %${Math.round((c.next / c.total) * 100)}` : '';
        let ic = '';
        let text;
        if (c.delta === 0 && !c.mins) text = `<span class="muted">Sayfa ${c.old}${pctStr} — henüz değişiklik yok</span>`;
        else if (sel.exclude) {
          ic = icon('refresh', 13);
          text = `Sayfa ${c.old} → <b>${c.next}</b>${pctStr} · <em class="warn">İstatistiklere eklenmeyecek</em>`;
        } else if (c.delta < 0) {
          ic = icon('refresh', 13);
          text = `Sayfa ${c.old} → <b>${c.next}</b> · Geri alma istatistiğe sayılmaz${c.mins ? ` · ${c.mins} dk eklenecek` : ''}`;
        } else {
          ic = icon('flame', 13);
          const day = sel.date === today ? 'bugünün' : `${S.relDay(sel.date)} gününün`;
          text = `${c.delta ? `<b>+${c.delta} sayfa</b>` : ''}${c.delta && c.mins ? ' · ' : ''}${c.mins ? `<b>${c.mins} dk</b>` : ''} → ${day} istatistiklerine işlenecek${pctStr}`;
        }
        if (c.capped) text += `<br><span class="muted">Toplam ${c.total} sayfa ile sınırlandı.</span>`;
        preview.innerHTML = `${ic}<span>${text}</span>`;
        preview.classList.toggle('excluded', sel.exclude);
        save.disabled = c.delta === 0 && !c.mins;
      };

      renderHead();
      setDefaultValue();
      refresh();

      body.addEventListener('click', e => {
        const seg = e.target.closest('#lg-mode .seg');
        if (seg) {
          sel.mode = seg.dataset.key;
          UI.setSegmented($('#lg-mode', body), sel.mode);
          setDefaultValue();
          refresh();
          return;
        }
        const step = e.target.closest('[data-step]');
        if (step) {
          const base = parseInt(valueEl.value, 10);
          const start = Number.isNaN(base) ? parseInt(valueEl.placeholder, 10) || 0 : base;
          valueEl.value = String(Math.max(0, start + Number(step.dataset.step)));
          valueEl.classList.remove('bump');
          void valueEl.offsetWidth;
          valueEl.classList.add('bump');
          UI.haptic(4);
          refresh();
          return;
        }
        const ms = e.target.closest('[data-mstep]');
        if (ms) {
          minEl.value = String(Math.max(0, (parseInt(minEl.value, 10) || 0) + Number(ms.dataset.mstep)));
          UI.haptic(4);
          refresh();
          return;
        }
        const dc = e.target.closest('[data-date]');
        if (dc) {
          sel.date = dc.dataset.date;
          dateInput.value = sel.date;
          refresh();
          return;
        }
        const bc = e.target.closest('[data-book]');
        if (bc) {
          sel.bookId = bc.dataset.book;
          body.querySelectorAll('[data-book]').forEach(x => x.classList.toggle('on', x === bc));
          renderHead();
          setDefaultValue();
          refresh();
        }
      });
      dateInput.addEventListener('click', () => {
        try {
          dateInput.showPicker?.();
        } catch {
          /* bazı tarayıcılar desteklemez */
        }
      });
      dateInput.addEventListener('change', () => {
        if (dateInput.value && dateInput.value <= today) sel.date = dateInput.value;
        refresh();
      });
      excl.addEventListener('change', () => {
        UI.haptic(6);
        refresh();
      });
      valueEl.addEventListener('input', refresh);
      minEl.addEventListener('input', refresh);
      valueEl.addEventListener('focus', () => valueEl.select());

      save.addEventListener('click', () => {
        const c = compute();
        if (c.delta === 0 && !c.mins) return;
        const b = c.b;
        const wasActive = D().streak.activeToday;
        const currentStreak = D().streak.current;
        const ts = S.timestampForDate(sel.date);
        const log = {
          bookId: b.id,
          bookTitle: b.title,
          date: sel.date,
          timestamp: ts,
          startPage: c.old,
          endPage: c.next,
          pagesRead: Math.max(0, c.delta),
          durationMinutes: c.mins,
          excludeFromStats: !!sel.exclude,
          type: sel.exclude ? 'baseline_sync' : c.delta < 0 ? 'correction' : fromTimer ? 'timer_session' : 'progress',
          note: noteEl.value.trim(),
        };
        const finishedNow = c.total > 0 && c.next >= c.total && b.status !== 'finished';
        const patch = { currentPage: c.next, lastReadAt: Date.now() };
        if (b.status === 'wishlist') patch.status = 'reading';
        if (!b.startedAt) patch.startedAt = ts;
        if (finishedNow) {
          patch.status = 'finished';
          patch.finishedAt = ts;
        }
        state.data.logProgress({ bookId: b.id, log, bookPatch: patch }).done.catch(onWriteError);
        sheet.close('saved');
        UI.haptic([8, 40, 12]);

        if (finishedNow) {
          setTimeout(() => openFinishSheet({ ...b, ...patch }, { celebrate: true }), 420);
        } else if (!sel.exclude && sel.date === today && !wasActive && (log.pagesRead > 0 || log.durationMinutes > 0)) {
          UI.toast(`${currentStreak + 1} günlük seri! Böyle devam.`, { icon: 'flame', tone: 'streak' });
          document.body.classList.add('streak-burst');
          setTimeout(() => document.body.classList.remove('streak-burst'), 1600);
        } else {
          UI.toast(sel.exclude ? 'Sayfa güncellendi · istatistik dışı' : log.pagesRead ? `+${log.pagesRead} sayfa kaydedildi` : 'Okuma kaydedildi', { icon: sel.exclude ? 'refresh' : 'check' });
        }
      });
    },
  });
}

/* =========================================================================
   Sheet: Bitirme / puanlama
   ========================================================================= */
function confettiHTML() {
  const colors = ['var(--accent)', 'var(--orange)', 'var(--yellow)', 'var(--green)', 'var(--teal)', 'var(--purple)'];
  return Array.from({ length: 24 }, (_, i) => {
    const x = Math.round(Math.random() * 100);
    const d = (Math.random() * 0.6).toFixed(2);
    const r = Math.round(Math.random() * 360);
    return `<i style="--x:${x}%;--d:${d}s;--r:${r}deg;--c:${colors[i % colors.length]}"></i>`;
  }).join('');
}

function openFinishSheet(book, { celebrate = false } = {}) {
  if (!book) return;
  let rating = book.rating || 0;
  const finKey = book.finishedAt ? S.dateKey(new Date(S.tsMs(book.finishedAt))) : S.todayKey();
  UI.openSheet({
    title: celebrate ? '' : 'Değerlendirme',
    className: celebrate ? 'celebrate' : '',
    html: `
      ${
        celebrate
          ? `<div class="celebrate-head"><div class="confetti" aria-hidden="true">${confettiHTML()}</div>${UI.cover(book, 'md')}<h2>Tebrikler!</h2><p>“${esc(book.title)}” kitabını bitirdin.</p></div>`
          : `<div class="log-head">${UI.cover(book, 'sm')}<div><h3>${esc(book.title)}</h3><p>${esc(book.author || '')}</p></div></div>`
      }
      <div class="field-label center">Puanın</div>
      <div class="rating-big" id="fs-stars">${UI.starRating(rating, 34)}</div>
      <p class="rating-caption" id="fs-cap">${ratingCaption(rating)}</p>
      <label class="field-label" for="fs-review">İnceleme / Düşüncelerin</label>
      <textarea id="fs-review" class="input" rows="3" placeholder="Bu kitap sende ne bıraktı?">${esc(book.review || '')}</textarea>
      <label class="field-label" for="fs-date">Bitiş tarihi</label>
      <input id="fs-date" class="input" type="date" max="${S.todayKey()}" value="${finKey}">
      <button type="button" class="btn btn-primary block" id="fs-save">${icon('check', 17)} Kaydet</button>`,
    onMount(body, sheet) {
      const stars = $('#fs-stars', body);
      UI.bindStarRating(stars, v => {
        rating = v;
        stars.innerHTML = UI.starRating(v, 34);
        $('#fs-cap', body).textContent = ratingCaption(v);
        UI.haptic(5);
      });
      $('#fs-save', body).addEventListener('click', () => {
        const dk = $('#fs-date', body).value || S.todayKey();
        const ts = S.timestampForDate(dk);
        state.data
          .updateBook(book.id, {
            status: 'finished',
            rating,
            review: $('#fs-review', body).value.trim(),
            finishedAt: ts,
            currentPage: book.totalPages || book.currentPage || 0,
            startedAt: book.startedAt || ts,
          })
          .catch(onWriteError);
        sheet.close('saved');
        UI.toast('“Okudum” rafına kaydedildi', { icon: 'trophy' });
      });
    },
  });
}

/* =========================================================================
   Sheet: Kitap ekleme (arama + barkod + manuel)
   ========================================================================= */
const SUGGESTIONS = ['Sabahattin Ali', 'Orhan Pamuk', 'Elif Şafak', 'Dostoyevski', 'Tolstoy', 'Atomik Alışkanlıklar'];

function resultRow(r, i) {
  return `<button type="button" class="result-row" data-idx="${i}" style="--i:${Math.min(i, 10)}">
    ${UI.cover(r, 'sm', { eager: i < 6 })}
    <span class="rr-body">
      <b>${esc(r.title)}</b>
      <span>${esc(r.author || 'Bilinmeyen yazar')}</span>
      <small>${[r.totalPages ? `${r.totalPages} sayfa` : '', r.publishedDate ? r.publishedDate.slice(0, 4) : '', r.source].filter(Boolean).map(esc).join(' · ')}</small>
    </span>
    ${icon('plus', 17, 'rr-plus')}
  </button>`;
}

function openAddBookSheet() {
  let results = [];
  let controller = null;
  let timer = 0;
  UI.openSheet({
    title: 'Kitap Ekle',
    size: 'large',
    html: `
      <label class="search-field">${icon('search', 15)}<input id="bk-q" type="search" placeholder="Kitap adı, yazar veya ISBN" autocomplete="off" enterkeyhint="search"></label>
      <div class="add-quick">
        <button type="button" class="quick-tile" data-sh="scan">${icon('barcode', 19)}<b>Barkod Tara</b><small>ISBN ile anında ekle</small></button>
        <button type="button" class="quick-tile" data-sh="manual">${icon('pencil', 18)}<b>Elle Ekle</b><small>Kendi baskını gir</small></button>
      </div>
      <div id="bk-results" class="results"></div>`,
    onMount(body, sheet) {
      const input = $('#bk-q', body);
      const out = $('#bk-results', body);
      const idle = () => {
        out.innerHTML = `<div class="suggest"><div class="field-label">Öneriler</div><div class="chip-row wrap">${SUGGESTIONS.map(s => `<button type="button" class="chip" data-suggest="${esc(s)}">${esc(s)}</button>`).join('')}</div></div>`;
      };
      const run = async q => {
        controller?.abort();
        if (!q.trim()) return idle();
        controller = new AbortController();
        out.innerHTML = `<div class="results-loading">${Array.from({ length: 4 }, (_, i) => `<div class="skeleton row" style="--i:${i}"></div>`).join('')}</div>`;
        try {
          results = await searchBooks(q, { signal: controller.signal });
          out.innerHTML = results.length
            ? `<div class="results-count">${results.length} sonuç</div>${results.map(resultRow).join('')}`
            : `<div class="empty-shelf">${icon('search', 22)}<b>Sonuç bulunamadı</b><p>Farklı bir yazım dene ya da kitabı elle ekle.</p><button type="button" class="btn btn-secondary xs" data-sh="manual">${icon('pencil', 12)} Elle Ekle</button></div>`;
        } catch (err) {
          if (err.name === 'AbortError') return;
          out.innerHTML = `<div class="empty-shelf">${icon('info', 22)}<b>Arama yapılamadı</b><p>İnternet bağlantını kontrol edip tekrar dene.</p></div>`;
        }
      };
      idle();
      input.addEventListener('input', () => {
        clearTimeout(timer);
        timer = setTimeout(() => run(input.value), 350);
      });
      input.addEventListener('keydown', e => {
        if (e.key === 'Enter') {
          clearTimeout(timer);
          input.blur();
          run(input.value);
        }
      });
      body.addEventListener('click', e => {
        const sh = e.target.closest('[data-sh]')?.dataset.sh;
        if (sh === 'scan') return openScannerSheet();
        if (sh === 'manual') return openBookForm(null, isISBN(input.value) ? { isbn: cleanISBN(input.value) } : { title: input.value.trim() });
        const sug = e.target.closest('[data-suggest]');
        if (sug) {
          input.value = sug.dataset.suggest;
          run(input.value);
          return;
        }
        const row = e.target.closest('.result-row');
        if (row) openConfirmAdd({ ...results[Number(row.dataset.idx)] });
      });
      sheet.el.addEventListener('transitionend', function focusOnce(e) {
        if (e.target !== sheet.el) return;
        sheet.el.removeEventListener('transitionend', focusOnce);
        if (window.matchMedia('(hover: hover)').matches) input.focus();
      });
    },
    onClose: () => controller?.abort(),
  });
}

function openConfirmAdd(r) {
  if (!r) return;
  const dup = state.books.find(
    b => (r.isbn && b.isbn && cleanISBN(b.isbn) === cleanISBN(r.isbn)) || ((b.title || '').toLocaleLowerCase('tr') === r.title.toLocaleLowerCase('tr') && (b.author || '') === (r.author || '')),
  );
  const sel = { status: 'reading', priority: 'normal', collection: '' };
  const cols = allCollections();
  UI.openSheet({
    title: 'Kütüphaneye Ekle',
    size: 'large',
    html: `
      <div class="confirm-hero">
        <div id="ca-cover">${UI.cover(r, 'lg', { eager: true })}</div>
        <div>
          <h2>${esc(r.title)}</h2>
          <p>${esc(r.author || 'Bilinmeyen yazar')}</p>
          <p class="muted-sm">${[r.publisher, r.publishedDate ? r.publishedDate.slice(0, 4) : ''].filter(Boolean).map(esc).join(' · ')}</p>
          ${r.isbn ? `<p class="muted-sm">ISBN ${esc(r.isbn)}</p>` : ''}
          <button type="button" class="btn btn-secondary xs ca-cover-btn" data-sh="cover">${icon('image', 12)} ${r.coverUrl ? 'Kapağı değiştir' : 'Kapak seç'}</button>
        </div>
      </div>
      ${dup ? `<div class="callout warn">${icon('info', 15)}<p>Bu kitap zaten kütüphanende. <button type="button" class="link" data-action="open-book" data-id="${dup.id}">Kitaba git</button></p></div>` : ''}
      <div class="field-label">Raf</div>
      ${UI.segmented(
        [
          { key: 'reading', label: 'Okuyorum' },
          { key: 'wishlist', label: 'Okuyacağım' },
          { key: 'finished', label: 'Okudum' },
        ],
        sel.status,
        { id: 'ca-status' },
      )}
      <div class="row-between priority-row hidden" id="ca-priority">
        <span>${icon('flag', 13)} Öncelik</span>
        ${UI.segmented(
          [
            { key: 'normal', label: 'Normal' },
            { key: 'high', label: 'Yüksek' },
          ],
          'normal',
          { id: 'ca-prio', cls: 'compact' },
        )}
      </div>
      <label class="field-label" for="ca-pages">Toplam sayfa</label>
      <input id="ca-pages" class="input" type="number" inputmode="numeric" min="1" value="${r.totalPages || ''}" placeholder="Örn. 320">
      ${cols.length ? `<div class="field-label">Koleksiyon</div><div class="chip-row wrap" id="ca-cols"><button type="button" class="chip on" data-col="">Yok</button>${cols.map(c => `<button type="button" class="chip" data-col="${esc(c)}">${esc(c)}</button>`).join('')}</div>` : ''}
      ${r.description ? `<div class="field-label">Özet</div><p class="desc-clamp">${esc(r.description)}</p>` : ''}
      <button type="button" class="btn btn-primary block" id="ca-add">${icon('plus', 17)} Kütüphaneye Ekle</button>`,
    onMount(body) {
      body.addEventListener('click', e => {
        if (e.target.closest('[data-sh="cover"]'))
          return openCoverPicker({
            title: r.title,
            author: r.author,
            current: r.coverUrl,
            onPick: url => {
              r.coverUrl = url;
              $('#ca-cover', body).innerHTML = UI.cover(r, 'lg', { eager: true });
            },
          });
        const seg = e.target.closest('.seg');
        if (seg && seg.closest('#ca-status')) {
          sel.status = seg.dataset.key;
          UI.setSegmented($('#ca-status', body), sel.status);
          $('#ca-priority', body).classList.toggle('hidden', sel.status !== 'wishlist');
          return;
        }
        if (seg && seg.closest('#ca-prio')) {
          sel.priority = seg.dataset.key;
          UI.setSegmented($('#ca-prio', body), sel.priority);
          return;
        }
        const col = e.target.closest('[data-col]');
        if (col) {
          sel.collection = col.dataset.col;
          body.querySelectorAll('[data-col]').forEach(c => c.classList.toggle('on', c === col));
        }
      });
      $('#ca-add', body).addEventListener('click', () => {
        const totalPages = parseInt($('#ca-pages', body).value, 10) || 0;
        const now = Date.now();
        const data = {
          title: r.title,
          author: r.author || '',
          coverUrl: r.coverUrl || '',
          isbn: r.isbn || '',
          totalPages,
          currentPage: sel.status === 'finished' ? totalPages : 0,
          status: sel.status,
          collection: sel.collection,
          rating: 0,
          review: '',
          priority: sel.priority,
          description: (r.description || '').slice(0, 1500),
          publisher: r.publisher || '',
          publishedDate: r.publishedDate || '',
          startedAt: sel.status !== 'wishlist' ? now : null,
          finishedAt: sel.status === 'finished' ? now : null,
          lastReadAt: sel.status === 'reading' ? now : null,
        };
        const id = addBook(data);
        UI.closeAllSheets();
        afterBookAdded(id, data);
      });
    },
  });
}

/* ---------- Manuel ekleme / düzenleme ---------- */
function openBookForm(book = null, prefill = {}) {
  const isEdit = !!book;
  const b = book || { title: '', author: '', coverUrl: '', totalPages: '', isbn: '', ...prefill };
  let status = 'reading';
  let coverUrl = b.coverUrl || '';
  UI.openSheet({
    title: isEdit ? 'Kitabı Düzenle' : 'Elle Kitap Ekle',
    size: 'large',
    html: `
      <div class="form-cover"><button type="button" class="form-cover-btn" data-sh="cover" aria-label="Kapak seç"><span id="bf-preview">${UI.cover(b, 'lg')}</span><span class="fc-edit">${icon('image', 13)} Kapak</span></button></div>
      <label class="field-label" for="bf-title">Kitap adı *</label>
      <input id="bf-title" class="input" type="text" value="${esc(b.title)}" placeholder="Kitabın adı" autocomplete="off">
      <label class="field-label" for="bf-author">Yazar</label>
      <input id="bf-author" class="input" type="text" value="${esc(b.author || '')}" placeholder="Yazar adı" autocomplete="off">
      <div class="form-grid">
        <div><label class="field-label" for="bf-pages">Toplam sayfa</label><input id="bf-pages" class="input" type="number" inputmode="numeric" min="1" value="${esc(b.totalPages || '')}" placeholder="320"></div>
        <div><label class="field-label" for="bf-isbn">ISBN</label><input id="bf-isbn" class="input" type="text" inputmode="numeric" value="${esc(b.isbn || '')}" placeholder="978…"></div>
      </div>
      ${
        isEdit
          ? `<p class="form-hint">${icon('info', 12)} Mevcut sayfanı değiştirmek için “İlerleme Kaydet” ekranını kullan; böylece istatistiklerin doğru kalır.</p>`
          : `<div class="field-label">Raf</div>${UI.segmented(
              [
                { key: 'reading', label: 'Okuyorum' },
                { key: 'wishlist', label: 'Okuyacağım' },
                { key: 'finished', label: 'Okudum' },
              ],
              status,
              { id: 'bf-status' },
            )}`
      }
      <p class="form-error" id="bf-error" hidden></p>
      <button type="button" class="btn btn-primary block" id="bf-save">${icon('check', 17)} ${isEdit ? 'Değişiklikleri Kaydet' : 'Kütüphaneye Ekle'}</button>`,
    onMount(body, sheet) {
      const f = id => $(`#${id}`, body);
      const preview = () => {
        f('bf-preview').innerHTML = UI.cover({ title: f('bf-title').value || 'Kitap', author: f('bf-author').value, coverUrl, isbn: f('bf-isbn').value }, 'lg');
      };
      ['bf-title', 'bf-author'].forEach(id => f(id).addEventListener('input', preview));
      f('bf-isbn').addEventListener('change', preview);
      body.addEventListener('click', e => {
        if (e.target.closest('[data-sh="cover"]'))
          return openCoverPicker({
            title: f('bf-title').value,
            author: f('bf-author').value,
            current: coverUrl,
            onPick: url => {
              coverUrl = url;
              preview();
            },
          });
        const seg = e.target.closest('#bf-status .seg');
        if (seg) {
          status = seg.dataset.key;
          UI.setSegmented(f('bf-status'), status);
        }
      });
      f('bf-save').addEventListener('click', () => {
        const title = f('bf-title').value.trim();
        const err = f('bf-error');
        if (!title) {
          err.textContent = 'Kitap adı gerekli.';
          err.hidden = false;
          f('bf-title').focus();
          return;
        }
        const totalPages = parseInt(f('bf-pages').value, 10) || 0;
        const common = { title, author: f('bf-author').value.trim(), coverUrl, totalPages, isbn: cleanISBN(f('bf-isbn').value) };
        if (isEdit) {
          const patch = { ...common };
          if (totalPages && (book.currentPage || 0) > totalPages) patch.currentPage = totalPages;
          state.data.updateBook(book.id, patch).catch(onWriteError);
          sheet.close('saved');
          UI.toast('Kitap güncellendi', { icon: 'check' });
          return;
        }
        const now = Date.now();
        const data = {
          ...common,
          currentPage: status === 'finished' ? totalPages : 0,
          status,
          collection: '',
          rating: 0,
          review: '',
          priority: 'normal',
          description: '',
          startedAt: status !== 'wishlist' ? now : null,
          finishedAt: status === 'finished' ? now : null,
          lastReadAt: status === 'reading' ? now : null,
        };
        const id = addBook(data);
        UI.closeAllSheets();
        afterBookAdded(id, data);
      });
    },
  });
}

/* ---------- Barkod (ISBN) tarayıcı ---------- */
function openScannerSheet() {
  let scanner = null;
  let closed = false;
  let busy = false;
  const stop = async () => {
    if (!scanner) return;
    try {
      if (scanner.isScanning) await scanner.stop();
      scanner.clear();
    } catch {
      /* zaten durmuş olabilir */
    }
    scanner = null;
  };
  UI.openSheet({
    title: 'Barkod Tara',
    size: 'large',
    html: `
      <div class="scanner">
        <div id="scanner-region"></div>
        <div class="scanner-frame" aria-hidden="true"><span class="scan-line"></span></div>
        <div class="scanner-msg" id="scan-msg">${icon('camera', 22)}<span>Kamera açılıyor…</span></div>
      </div>
      <p class="scan-hint">Kitabın arka kapağındaki ISBN barkodunu (978… ile başlar) çerçeveye hizala.</p>
      <div class="field-label">veya ISBN'i yaz</div>
      <div class="inline-form">
        <input id="isbn-manual" class="input" type="text" inputmode="numeric" placeholder="978 975 …" autocomplete="off">
        <button type="button" class="btn btn-primary sm" id="isbn-go">Bul</button>
      </div>`,
    onMount(body, sheet) {
      const msg = $('#scan-msg', body);
      const handle = async raw => {
        if (busy || closed) return;
        const code = cleanISBN(raw);
        if (!isISBN(code)) {
          msg.innerHTML = `${icon('info', 18)}<span>Bu bir ISBN barkodu değil. Arka kapaktaki 978… barkodunu dene.</span>`;
          msg.hidden = false;
          return;
        }
        busy = true;
        UI.haptic([10, 40, 10]);
        msg.innerHTML = `<span class="spinner"></span><span>ISBN ${code} aranıyor…</span>`;
        msg.hidden = false;
        await stop();
        try {
          const book = await lookupISBN(code);
          if (closed) return;
          sheet.close('found');
          if (book) openConfirmAdd(book);
          else {
            UI.toast('Bu ISBN için kayıt bulunamadı — elle ekleyebilirsin', { icon: 'info', duration: 3800 });
            openBookForm(null, { isbn: code });
          }
        } catch {
          busy = false;
          msg.innerHTML = `${icon('info', 18)}<span>Arama başarısız. Bağlantını kontrol et.</span>`;
        }
      };
      $('#isbn-go', body).addEventListener('click', () => handle($('#isbn-manual', body).value));
      $('#isbn-manual', body).addEventListener('keydown', e => e.key === 'Enter' && handle(e.target.value));

      (async () => {
        try {
          if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) throw Object.assign(new Error('insecure'), { name: 'InsecureContext' });
          const { Html5Qrcode, Html5QrcodeSupportedFormats: F } = await import(HTML5_QRCODE);
          if (closed) return;
          scanner = new Html5Qrcode('scanner-region', {
            verbose: false,
            formatsToSupport: [F.EAN_13, F.EAN_8, F.UPC_A, F.UPC_E, F.CODE_128],
            useBarCodeDetectorIfSupported: true,
            experimentalFeatures: { useBarCodeDetectorIfSupported: true },
          });
          await scanner.start(
            { facingMode: 'environment' },
            { fps: 12, aspectRatio: 1.333334, qrbox: (w, h) => ({ width: Math.floor(Math.min(w * 0.86, 340)), height: Math.floor(Math.min(h * 0.46, 150)) }) },
            text => handle(text),
            () => {},
          );
          if (closed) return stop();
          msg.hidden = true;
        } catch (err) {
          const denied = /NotAllowed|Permission/i.test(`${err?.name} ${err}`);
          msg.innerHTML = `${icon('camera', 22)}<span>${
            err?.name === 'InsecureContext'
              ? 'Kamera yalnızca HTTPS üzerinden açılabilir.'
              : denied
                ? 'Kamera izni verilmedi. Ayarlar → Safari → Kamera bölümünden izin verebilirsin.'
                : 'Kamera başlatılamadı. ISBN’i aşağıya yazabilirsin.'
          }</span>`;
          msg.hidden = false;
        }
      })();
    },
    onClose: () => {
      closed = true;
      stop();
    },
  });
}

/* =========================================================================
   Sheet: Alıntı / Not + paylaşım kartı
   ========================================================================= */
function openQuoteSheet(book) {
  if (!book) return;
  let kind = 'quote';
  UI.openSheet({
    title: 'Alıntı veya Not',
    size: 'large',
    html: `
      <div class="log-head">${UI.cover(book, 'sm')}<div><h3>${esc(book.title)}</h3><p>${esc(book.author || '')}</p></div></div>
      ${UI.segmented(
        [
          { key: 'quote', label: 'Alıntı' },
          { key: 'note', label: 'Düşünce / Not' },
        ],
        kind,
        { id: 'qt-kind' },
      )}
      <label class="field-label" for="qt-text" id="qt-label">Beğendiğin cümle</label>
      <textarea id="qt-text" class="input quote-input" rows="5" placeholder="Kitaptaki cümleyi aynen yaz…"></textarea>
      <label class="field-label" for="qt-page">Sayfa</label>
      <input id="qt-page" class="input" type="number" inputmode="numeric" min="0" value="${book.currentPage || ''}" placeholder="Sayfa numarası">
      <button type="button" class="btn btn-primary block" id="qt-save" disabled>${icon('check', 17)} Kaydet</button>`,
    onMount(body, sheet) {
      const text = $('#qt-text', body);
      const save = $('#qt-save', body);
      text.addEventListener('input', () => (save.disabled = !text.value.trim()));
      body.addEventListener('click', e => {
        const seg = e.target.closest('#qt-kind .seg');
        if (!seg) return;
        kind = seg.dataset.key;
        UI.setSegmented($('#qt-kind', body), kind);
        $('#qt-label', body).textContent = kind === 'quote' ? 'Beğendiğin cümle' : 'Düşüncen';
        text.placeholder = kind === 'quote' ? 'Kitaptaki cümleyi aynen yaz…' : 'Bu bölüm sana ne düşündürdü?';
      });
      save.addEventListener('click', () => {
        const value = text.value.trim();
        if (!value) return;
        state.data.addQuote({ bookId: book.id, bookTitle: book.title, page: parseInt($('#qt-page', body).value, 10) || 0, text: value, kind }).catch(onWriteError);
        sheet.close('saved');
        UI.toast(kind === 'quote' ? 'Alıntı kaydedildi' : 'Not kaydedildi', { icon: kind === 'quote' ? 'quote' : 'note' });
      });
    },
  });
}

const cardColors = hsl => hsl.map(([h, s, l]) => `hsl(${Math.round(h)} ${Math.round(UI.clamp(s * 0.85, 0.15, 0.6) * 100)}% ${Math.round(UI.clamp(l, 0.3, 0.46) * 100)}%)`);

async function openShareSheet({ quote = null, book = null }) {
  const b = book || (quote && getBook(quote.bookId)) || { title: quote?.bookTitle || '', author: '' };
  const pal = await UI.getPalette(b);
  const colors = cardColors(pal.hsl);
  const isQuote = !!quote;
  const fin = S.tsMs(b.finishedAt);
  const cardInner = isQuote
    ? `<span class="share-mark">“</span>
       <p class="share-text">${esc(quote.text)}</p>
       <div class="share-foot">${UI.cover(b, 'xs')}<div><b>${esc(b.title)}</b><span>${esc([b.author, quote.page ? `Sayfa ${quote.page}` : ''].filter(Boolean).join(' · '))}</span></div></div>`
    : `<div class="share-book">${UI.cover(b, 'lg', { eager: true })}<b>${esc(b.title)}</b><span>${esc(b.author || '')}</span>${b.rating ? UI.starRating(b.rating, 17) : ''}${b.review ? `<p>“${esc(b.review)}”</p>` : ''}</div>`;
  UI.openSheet({
    title: isQuote ? (quote.kind === 'note' ? 'Not' : 'Alıntı') : 'Kitap Kartı',
    size: 'large',
    html: `
      <div class="share-card" style="--c1:${colors[0]};--c2:${colors[1]};--c3:${colors[2]}">${cardInner}<span class="share-brand">Okur</span></div>
      <div class="share-actions">
        <button type="button" class="btn btn-primary sm" data-sh="share">${icon('share', 15)} Görseli Paylaş</button>
        <button type="button" class="btn btn-secondary sm" data-sh="copy">${icon('copy', 15)} Metni Kopyala</button>
      </div>
      ${isQuote ? `<button type="button" class="btn btn-destructive-ghost block" data-sh="delete">${icon('trash', 14)} ${quote.kind === 'note' ? 'Notu' : 'Alıntıyı'} Sil</button>` : ''}`,
    onMount(body, sheet) {
      body.addEventListener('click', async e => {
        const btn = e.target.closest('[data-sh]');
        const a = btn?.dataset.sh;
        if (!a) return;
        if (a === 'share') {
          btn.disabled = true;
          try {
            const img = await UI.loadCoverImage(b, 400);
            const blob = await UI.renderShareImage({
              kind: isQuote ? 'quote' : 'book',
              text: isQuote ? quote.text : b.review || '',
              title: b.title,
              author: b.author || '',
              page: isQuote ? quote.page : '',
              rating: isQuote ? 0 : b.rating || 0,
              footer: isQuote ? 'Okur ile kaydedildi' : fin ? `Okudum · ${S.fmtDay(S.dateKey(new Date(fin)), true)}` : 'Okur',
              colors,
              img,
            });
            const result = await UI.shareOrDownload(blob, `okur-${isQuote ? 'alinti' : 'kitap'}.png`, b.title);
            if (result === 'downloaded') UI.toast('Görsel indirildi', { icon: 'download' });
          } catch (err) {
            console.error(err);
            UI.toast('Görsel oluşturulamadı', { tone: 'error', icon: 'info' });
          } finally {
            btn.disabled = false;
          }
        } else if (a === 'copy') {
          const txt = isQuote
            ? `“${quote.text}”\n— ${b.title}${b.author ? `, ${b.author}` : ''}${quote.page ? ` (s. ${quote.page})` : ''}`
            : `${b.title} — ${b.author || ''}${b.rating ? ` · ${fmtRating(b.rating)}/5` : ''}${b.review ? `\n“${b.review}”` : ''}`;
          try {
            await navigator.clipboard.writeText(txt);
            UI.toast('Panoya kopyalandı', { icon: 'copy' });
          } catch {
            UI.toast('Kopyalanamadı', { tone: 'error' });
          }
        } else if (a === 'delete') {
          const ok = await UI.confirmSheet({ title: 'Silinsin mi?', confirmText: 'Sil', destructive: true });
          if (!ok) return;
          state.data.deleteQuote(quote.id).catch(onWriteError);
          sheet.close('deleted');
          UI.toast('Silindi', { icon: 'trash' });
        }
      });
    },
  });
}

/* =========================================================================
   Sheet: Takvim günü (geriye dönük kayıt)
   ========================================================================= */
function openDaySheet(key) {
  const d = S.dayDetail(state.logs, key);
  UI.openSheet({
    title: S.fmtLong(key),
    html: `
      <div class="day-head">
        <div><b>${d.pages}</b><small>sayfa</small></div>
        <div><b>${d.minutes}</b><small>dakika</small></div>
        <div><b>${d.entries.filter(e => !e.excludeFromStats).length}</b><small>oturum</small></div>
      </div>
      ${
        d.entries.length
          ? `<div class="day-entries">${d.entries
              .map(l => {
                const b = getBook(l.bookId);
                return `<button type="button" class="day-entry ${l.excludeFromStats ? 'excluded' : ''}" ${b ? `data-action="open-book" data-id="${b.id}"` : 'disabled'}>
                  ${UI.cover(b || { title: l.bookTitle }, 'xs')}
                  <span class="de-body"><b>${esc(l.bookTitle || b?.title || 'Kitap')}</b><small>Sayfa ${l.startPage ?? '?'} → ${l.endPage ?? '?'}${l.durationMinutes ? ` · ${l.durationMinutes} dk` : ''}</small></span>
                  ${l.excludeFromStats ? `<span class="tag muted">İstatistik dışı</span>` : `<span class="tag accent">+${l.pagesRead || 0}</span>`}
                </button>`;
              })
              .join('')}</div>`
          : `<p class="day-empty">${key === S.todayKey() ? 'Bugün henüz okuma kaydı yok.' : 'Bu gün için okuma kaydı yok. Okuduğun halde kaydetmeyi unuttuysan şimdi ekleyebilirsin.'}</p>`
      }
      <button type="button" class="btn btn-primary block" id="day-add">${icon('plus', 15)} Bu Güne Okuma Ekle</button>`,
    onMount(body, sheet) {
      $('#day-add', body).addEventListener('click', () => {
        sheet.close('add');
        setTimeout(() => openLogSheet({ date: key, mode: 'delta' }), 300);
      });
    },
  });
}

/* =========================================================================
   Sheet: Hedefler, koleksiyonlar, kurulum
   ========================================================================= */
function stepperField(id, label, value, { step, unit }) {
  return `<div class="goal-field">
    <div><b>${esc(label)}</b><small>${esc(unit)}</small></div>
    <div class="stepper compact">
      <button type="button" class="step" data-gstep="${id}" data-d="-${step}" aria-label="Azalt">${icon('minus', 14)}</button>
      <input id="${id}" class="stepper-input" type="number" inputmode="numeric" value="${value}">
      <button type="button" class="step" data-gstep="${id}" data-d="${step}" aria-label="Artır">${icon('plus', 14)}</button>
    </div>
  </div>`;
}

function openGoalsSheet() {
  const p = D().profile;
  const limits = { 'g-year': [1, 365], 'g-pages': [1, 2000], 'g-min': [1, 1440] };
  UI.openSheet({
    title: 'Hedefler',
    html: `
      <label class="field-label" for="g-name">Görünen ad</label>
      <input id="g-name" class="input" type="text" value="${esc(p.displayName || displayName())}" autocomplete="name" placeholder="Adın">
      ${stepperField('g-pages', 'Günlük sayfa', p.dailyPageGoal, { step: 5, unit: 'sayfa / gün' })}
      ${stepperField('g-min', 'Günlük süre', p.dailyMinuteGoal, { step: 5, unit: 'dakika / gün' })}
      ${stepperField('g-year', 'Yıllık kitap', p.yearlyBookGoal, { step: 1, unit: `${new Date().getFullYear()} hedefi` })}
      <button type="button" class="btn btn-primary block" id="g-save">${icon('check', 17)} Kaydet</button>`,
    onMount(body, sheet) {
      body.addEventListener('click', e => {
        const s = e.target.closest('[data-gstep]');
        if (!s) return;
        const input = $(`#${s.dataset.gstep}`, body);
        const [min, max] = limits[s.dataset.gstep];
        input.value = String(UI.clamp((parseInt(input.value, 10) || 0) + Number(s.dataset.d), min, max));
        input.classList.remove('bump');
        void input.offsetWidth;
        input.classList.add('bump');
        UI.haptic(4);
      });
      $('#g-save', body).addEventListener('click', () => {
        const val = id => UI.clamp(parseInt($(`#${id}`, body).value, 10) || limits[id][0], ...limits[id]);
        state.data
          .updateProfile({
            displayName: $('#g-name', body).value.trim(),
            dailyPageGoal: val('g-pages'),
            dailyMinuteGoal: val('g-min'),
            yearlyBookGoal: val('g-year'),
          })
          .catch(onWriteError);
        sheet.close('saved');
        UI.toast('Hedefler güncellendi', { icon: 'target' });
      });
    },
  });
}

function openNewCollectionSheet(onCreated) {
  UI.openSheet({
    title: 'Yeni Koleksiyon',
    html: `
      <label class="field-label" for="nc-name">Koleksiyon adı</label>
      <input id="nc-name" class="input" type="text" maxlength="40" placeholder="Örn. Yaz Okumaları" autocomplete="off">
      <div class="chip-row wrap nc-suggest">${['Klasikler', 'Bilim Kurgu', 'Kişisel Gelişim', 'Tarih', 'Şiir'].map(s => `<button type="button" class="chip" data-nc="${s}">${s}</button>`).join('')}</div>
      <button type="button" class="btn btn-primary block" id="nc-save">${icon('plus', 17)} Oluştur</button>`,
    onMount(body, sheet) {
      const input = $('#nc-name', body);
      body.addEventListener('click', e => {
        const c = e.target.closest('[data-nc]');
        if (c) input.value = c.dataset.nc;
      });
      const save = () => {
        const name = input.value.trim().replace(/\s+/g, ' ');
        if (!name) return input.focus();
        const cols = new Set(D().profile.collections || []);
        cols.add(name);
        state.data.updateProfile({ collections: [...cols] }).catch(onWriteError);
        sheet.close('saved');
        UI.toast(`“${name}” oluşturuldu`, { icon: 'folder' });
        onCreated?.(name);
      };
      $('#nc-save', body).addEventListener('click', save);
      input.addEventListener('keydown', e => e.key === 'Enter' && save());
    },
  });
}

function openCollectionPicker(book) {
  if (!book) return;
  const cols = allCollections();
  UI.openSheet({
    title: 'Koleksiyon',
    html: `
      <div class="list-group card">
        <button type="button" class="list-row pick ${!book.collection ? 'on' : ''}" data-pick="">${icon('close', 15)}<span class="lr-label">Koleksiyon yok</span>${!book.collection ? icon('check', 15, 'lr-check') : ''}</button>
        ${cols.map(c => `<button type="button" class="list-row pick ${book.collection === c ? 'on' : ''}" data-pick="${esc(c)}">${icon('folder', 15)}<span class="lr-label">${esc(c)}</span>${book.collection === c ? icon('check', 15, 'lr-check') : ''}</button>`).join('')}
      </div>
      <button type="button" class="btn btn-secondary block" id="cp-new">${icon('plus', 15)} Yeni Koleksiyon</button>`,
    onMount(body, sheet) {
      body.addEventListener('click', e => {
        const p = e.target.closest('[data-pick]');
        if (!p) return;
        state.data.updateBook(book.id, { collection: p.dataset.pick }).catch(onWriteError);
        sheet.close('saved');
        UI.toast(p.dataset.pick ? `“${p.dataset.pick}” koleksiyonuna eklendi` : 'Koleksiyondan çıkarıldı', { icon: 'folder' });
      });
      $('#cp-new', body).addEventListener('click', () => {
        sheet.close('new');
        setTimeout(() => openNewCollectionSheet(name => state.data.updateBook(book.id, { collection: name }).catch(onWriteError)), 280);
      });
    },
  });
}

async function deleteCollection(name) {
  const books = state.books.filter(b => b.collection === name);
  const ok = await UI.confirmSheet({
    title: `“${name}” silinsin mi?`,
    message: books.length ? `${books.length} kitap koleksiyondan çıkarılır; kitapların kendisi silinmez.` : 'Koleksiyon kaldırılır.',
    confirmText: 'Koleksiyonu Sil',
    destructive: true,
  });
  if (!ok) return;
  const cols = (D().profile.collections || []).filter(c => c !== name);
  state.data.removeCollection(name, books.map(b => b.id), cols).catch(onWriteError);
  if (state.ui.libCollection === name) state.ui.libCollection = null;
  UI.toast('Koleksiyon silindi', { icon: 'trash' });
}

function isIOS() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}
function isStandalone() {
  return window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

function openInstallSheet() {
  UI.openSheet({
    title: 'Ana Ekrana Ekle',
    html: `
      <div class="install-hero"><img src="/icons/icon.svg" alt="" width="60" height="60"><p>Okur’u ana ekranına ekle; tam ekran, hızlı ve uygulama gibi açılsın.</p></div>
      ${
        isStandalone()
          ? `<div class="callout ok">${icon('check', 15)}<p>Okur zaten ana ekranından uygulama olarak çalışıyor.</p></div>`
          : `<ol class="install-steps">
        <li><span class="step-n">1</span><span>Safari’de <b>Paylaş</b> ${icon('share', 14)} simgesine dokun.</span></li>
        <li><span class="step-n">2</span><span><b>Ana Ekrana Ekle</b> ${icon('plus', 14)} seçeneğini seç.</span></li>
        <li><span class="step-n">3</span><span>Sağ üstteki <b>Ekle</b>’ye dokun.</span></li>
      </ol>`
      }
      <button type="button" class="btn btn-secondary block" data-sheet-close>Tamam</button>`,
  });
}

function maybeInstallHint() {
  if (!isIOS() || isStandalone() || readJSON(INSTALL_KEY)) return;
  writeJSON(INSTALL_KEY, Date.now());
  setTimeout(() => UI.toast('Okur’u ana ekrana ekleyerek uygulama gibi kullan', { icon: 'share', action: 'Nasıl?', duration: 6500, onAction: openInstallSheet }), 2200);
}

/* =========================================================================
   Hesap: kayıt (+@kullanıcı adı), giriş (e-posta veya @ad), şifre, çıkış
   ========================================================================= */
const AUTH_ERRORS = {
  'auth/invalid-email': 'E-posta adresi geçersiz görünüyor.',
  'auth/invalid-credential': 'Bilgiler hatalı. E-posta / kullanıcı adı ve şifreni kontrol et.',
  'auth/wrong-password': 'Şifre hatalı.',
  'auth/user-not-found': 'Bu bilgilerle kayıtlı bir hesap bulunamadı.',
  'auth/email-already-in-use': 'Bu e-posta zaten kullanımda. Giriş yapmayı dene.',
  'auth/weak-password': 'Şifre en az 6 karakter olmalı.',
  'auth/missing-password': 'Şifreni gir.',
  'auth/too-many-requests': 'Çok fazla deneme yapıldı. Biraz sonra tekrar dene.',
  'auth/network-request-failed': 'Ağ bağlantısı kurulamadı.',
  'auth/popup-closed-by-user': 'Google girişi yarıda kaldı.',
  'auth/cancelled-popup-request': 'Google girişi yarıda kaldı.',
  'auth/unauthorized-domain': 'Bu alan adı Firebase Authentication’da yetkili değil.',
  'auth/operation-not-allowed': 'Bu giriş yöntemi Firebase konsolunda etkin değil.',
  'auth/user-disabled': 'Bu hesap devre dışı bırakılmış.',
  'permission-denied': 'Sunucu izni reddetti. Firestore kurallarının yayınlandığından emin ol.',
  'app/not-configured': 'Hesap sunucusu henüz bağlanmadı (js/firebase-config.js).',
  'app/nickname-not-found': 'Bu kullanıcı adıyla kayıtlı bir hesap bulunamadı.',
  'app/nickname-taken': 'Bu kullanıcı adı alınmış. Başka bir tane dene.',
  'app/nickname-invalid': 'Kullanıcı adı 3–20 karakter olmalı; harf, rakam, _ ve . kullanılabilir.',
};
const authMessage = err => AUTH_ERRORS[err?.code] || 'Bir şeyler ters gitti. Tekrar dene.';

function setBusy(btn, on) {
  btn.disabled = on;
  btn.classList.toggle('busy', on);
  btn.querySelector('.spinner')?.remove();
  if (on) btn.insertAdjacentHTML('beforeend', '<span class="spinner"></span>');
}

async function ensureFirebase() {
  if (state.fb) return state.fb;
  try {
    state.fb = await loadFirebase();
    if (state.fb) state.fb.auth.onChange(onAuth);
  } catch (err) {
    console.error(err);
    UI.toast('Hesap servisine ulaşılamadı. Bağlantını kontrol et.', { tone: 'error', icon: 'info' });
  }
  return state.fb;
}

/** Kullanıcı adı müsaitlik kontrolü (yazarken) */
function bindNicknameInput(input, statusEl, { allow = '' } = {}) {
  let timer = 0;
  let seq = 0;
  const check = async () => {
    const nick = normalizeNickname(input.value);
    input.value = input.value.replace(/^@+/, '');
    const id = ++seq;
    statusEl.className = 'nick-status';
    if (!nick) return (statusEl.textContent = '');
    if (!isValidNickname(nick)) {
      statusEl.classList.add('bad');
      statusEl.textContent = '3–20 karakter: harf, rakam, _ ve .';
      return;
    }
    if (nick === allow) {
      statusEl.classList.add('ok');
      statusEl.textContent = 'Mevcut kullanıcı adın';
      return;
    }
    statusEl.textContent = 'Kontrol ediliyor…';
    const fb = await ensureFirebase();
    if (!fb || id !== seq) return;
    try {
      const taken = await fb.social.lookupNickname(nick);
      if (id !== seq) return;
      statusEl.classList.add(taken ? 'bad' : 'ok');
      statusEl.textContent = taken ? `@${nick} alınmış` : `@${nick} müsait`;
    } catch {
      statusEl.textContent = '';
    }
  };
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(check, 350);
  });
}

async function claimNicknameFlow(nick) {
  const fb = await ensureFirebase();
  if (!fb) throw { code: 'app/not-configured' };
  if (!isValidNickname(nick)) throw { code: 'app/nickname-invalid' };
  const current = myNick();
  if (nick === current) return;
  const taken = await fb.social.lookupNickname(nick);
  if (taken && taken.uid !== state.user.uid) throw { code: 'app/nickname-taken' };
  await fb.social.claimNickname({ uid: state.user.uid, nick, email: state.user.email, displayName: displayName(), oldNick: current });
  lastPublic = '';
}

function openNicknameSheet() {
  if (!isCloud()) return openAuthSheet('signup');
  UI.openSheet({
    title: 'Kullanıcı adı',
    html: `
      <p class="sheet-lead">Arkadaşların seni bu adla bulur; giriş yaparken e-posta yerine de kullanabilirsin.</p>
      <label class="input-icon nick-field">${icon('at', 16)}<input id="nk-input" class="input" type="text" value="${esc(myNick())}" placeholder="kullaniciadi" autocapitalize="off" autocomplete="username" spellcheck="false"></label>
      <p class="nick-status" id="nk-status"></p>
      <button type="button" class="btn btn-primary block" id="nk-save"><span class="btn-label">Kaydet</span></button>`,
    onMount(body, sheet) {
      const input = $('#nk-input', body);
      const status = $('#nk-status', body);
      bindNicknameInput(input, status, { allow: myNick() });
      const btn = $('#nk-save', body);
      btn.addEventListener('click', async () => {
        setBusy(btn, true);
        try {
          await claimNicknameFlow(normalizeNickname(input.value));
          sheet.close('saved');
          UI.toast(`Kullanıcı adın @${normalizeNickname(input.value)} oldu`, { icon: 'at' });
        } catch (err) {
          status.className = 'nick-status bad';
          status.textContent = authMessage(err);
          setBusy(btn, false);
        }
      });
    },
  });
}

function openAuthSheet(mode = 'signin') {
  if (isCloud()) return navigate('/settings');
  const hasLocal = state.local.hasContent();
  UI.openSheet({
    title: 'Hesap',
    size: 'large',
    html: `
      <div class="auth-hero"><img src="/icons/icon.svg" alt="" width="50" height="50"><h2>Okur hesabı</h2><p>Kütüphanen, serin ve istatistiklerin tüm cihazlarında senkron kalsın; arkadaşlarını ekle.</p></div>
      ${
        !isFirebaseConfigured
          ? `<div class="callout warn">${icon('info', 15)}<p>Hesap sunucusu henüz bağlanmadı.</p></div>`
          : hasLocal
            ? `<div class="callout ok">${icon('cloud', 15)}<p>Bu cihazdaki kitapların ve kayıtların hesabına aktarılır.</p></div>`
            : ''
      }
      <form id="auth-form" data-mode="${mode}" novalidate>
        ${UI.segmented(
          [
            { key: 'signin', label: 'Giriş Yap' },
            { key: 'signup', label: 'Kayıt Ol' },
          ],
          mode,
          { id: 'auth-seg' },
        )}
        <div class="auth-fields">
          <label class="input-icon only-signup">${icon('person', 16)}<input class="input" name="name" type="text" autocomplete="name" placeholder="Adın" enterkeyhint="next"></label>
          <label class="input-icon only-signup">${icon('at', 16)}<input class="input" name="nick" type="text" autocomplete="username" placeholder="kullanıcı adı" autocapitalize="off" spellcheck="false" enterkeyhint="next"></label>
          <p class="nick-status only-signup" id="au-nick-status"></p>
          <label class="input-icon only-signup">${icon('mail', 16)}<input class="input" name="email" type="email" autocomplete="email" inputmode="email" placeholder="E-posta" autocapitalize="off" spellcheck="false" enterkeyhint="next"></label>
          <label class="input-icon only-signin">${icon('person', 16)}<input class="input" name="identifier" type="text" autocomplete="username" placeholder="E-posta veya @kullanıcı adı" autocapitalize="off" spellcheck="false" enterkeyhint="next"></label>
          <label class="input-icon">${icon('lock', 16)}<input class="input" name="password" type="password" autocomplete="current-password" placeholder="Şifre" enterkeyhint="go"><button type="button" class="pw-toggle" aria-label="Şifreyi göster">${icon('eye', 16)}</button></label>
        </div>
        <p class="auth-error" role="alert" hidden></p>
        <button class="btn btn-primary block" type="submit"><span class="btn-label">Giriş Yap</span></button>
        <button type="button" class="link center only-signin" id="auth-forgot">Şifremi unuttum</button>
        <div class="divider"><span>veya</span></div>
        <button type="button" class="btn btn-secondary block" id="auth-google">${icon('google', 16)} Google ile devam et</button>
      </form>`,
    onMount(body, sheet) {
      const form = $('#auth-form', body);
      const err = $('.auth-error', form);
      const submit = $('button[type="submit"]', form);
      const pw = form.elements.password;
      bindNicknameInput(form.elements.nick, $('#au-nick-status', form));
      const setMode = m => {
        form.dataset.mode = m;
        UI.setSegmented($('#auth-seg', form), m);
        $('.btn-label', submit).textContent = m === 'signin' ? 'Giriş Yap' : 'Hesap Oluştur';
        pw.autocomplete = m === 'signin' ? 'current-password' : 'new-password';
        pw.placeholder = m === 'signin' ? 'Şifre' : 'Şifre (en az 6 karakter)';
        err.hidden = true;
      };
      const showErr = e => {
        err.textContent = authMessage(e);
        err.hidden = false;
        form.classList.remove('shake');
        void form.offsetWidth;
        form.classList.add('shake');
      };
      setMode(mode);
      form.addEventListener('click', e => {
        const seg = e.target.closest('#auth-seg .seg');
        if (seg) setMode(seg.dataset.key);
      });
      $('.pw-toggle', form).addEventListener('click', e => {
        const show = pw.type === 'password';
        pw.type = show ? 'text' : 'password';
        e.currentTarget.innerHTML = icon(show ? 'eyeOff' : 'eye', 16);
      });
      form.addEventListener('submit', async e => {
        e.preventDefault();
        err.hidden = true;
        setBusy(submit, true);
        try {
          const fb = await ensureFirebase();
          if (!fb) throw { code: 'app/not-configured' };
          if (form.dataset.mode === 'signin') {
            await fb.auth.signInWithIdentifier(form.elements.identifier.value, pw.value);
          } else {
            const nick = normalizeNickname(form.elements.nick.value);
            if (!isValidNickname(nick)) throw { code: 'app/nickname-invalid' };
            if (await fb.social.lookupNickname(nick)) throw { code: 'app/nickname-taken' };
            const name = form.elements.name.value.trim();
            const email = form.elements.email.value.trim();
            const cred = await fb.auth.signUp(name, email, pw.value);
            try {
              await fb.social.claimNickname({ uid: cred.user.uid, nick, email, displayName: name });
            } catch (claimErr) {
              console.error(claimErr);
              UI.toast('Hesap oluştu ama kullanıcı adı kaydedilemedi. Ayarlar’dan tekrar seçebilirsin.', { tone: 'error', duration: 5000 });
            }
          }
          sheet.close('signed-in');
        } catch (ex) {
          showErr(ex);
          setBusy(submit, false);
        }
      });
      $('#auth-google', form).addEventListener('click', async e => {
        const btn = e.currentTarget;
        const fb = await ensureFirebase();
        if (!fb) return showErr({ code: 'app/not-configured' });
        setBusy(btn, true);
        try {
          await fb.auth.google();
          sheet.close('signed-in');
        } catch (ex) {
          showErr(ex);
        } finally {
          if (document.body.contains(btn)) setBusy(btn, false);
        }
      });
      $('#auth-forgot', form).addEventListener('click', () => openForgotSheet(form.elements.identifier.value.trim()));
    },
  });
}

function openForgotSheet(identifier = '') {
  UI.openSheet({
    title: 'Şifremi Unuttum',
    html: `
      <p class="sheet-lead">E-posta adresini ya da @kullanıcı adını gir; şifre sıfırlama bağlantısı gönderelim.</p>
      <label class="input-icon">${icon('mail', 16)}<input id="fp-id" class="input" type="text" autocomplete="username" value="${esc(identifier)}" placeholder="E-posta veya @kullanıcı adı" autocapitalize="off"></label>
      <p class="auth-error" id="fp-err" hidden></p>
      <button type="button" class="btn btn-primary block" id="fp-send"><span class="btn-label">Bağlantı Gönder</span></button>`,
    onMount(body, sheet) {
      const btn = $('#fp-send', body);
      btn.addEventListener('click', async () => {
        const er = $('#fp-err', body);
        setBusy(btn, true);
        try {
          const fb = await ensureFirebase();
          if (!fb) throw { code: 'app/not-configured' };
          let email = $('#fp-id', body).value.trim();
          if (!email.includes('@') || email.startsWith('@')) {
            const entry = await fb.social.lookupNickname(normalizeNickname(email));
            if (!entry?.email) throw { code: 'app/nickname-not-found' };
            email = entry.email;
          }
          await fb.auth.reset(email);
          sheet.close('sent');
          UI.toast('Sıfırlama bağlantısı gönderildi. Gelen kutunu kontrol et.', { icon: 'mail', duration: 4200 });
        } catch (e) {
          er.textContent = authMessage(e);
          er.hidden = false;
          setBusy(btn, false);
        }
      });
    },
  });
}

async function signOut() {
  const ok = await UI.confirmSheet({
    title: 'Oturum kapatılsın mı?',
    message: 'Verilerin hesabında güvende kalır. Çıkış yaptıktan sonra bu cihazda boş bir kütüphaneyle devam edersin.',
    confirmText: 'Oturumu Kapat',
    destructive: true,
  });
  if (!ok) return;
  try {
    await state.fb?.auth.signOut();
  } catch (err) {
    onWriteError(err);
  }
}

/* =========================================================================
   Okuma zamanlayıcısı (Dinamik Ada)
   ========================================================================= */
let island = null;
let tickTimer = 0;

const timerElapsed = () => {
  const t = state.timer;
  return t ? t.elapsed + (t.running ? Date.now() - t.resumedAt : 0) : 0;
};
const persistTimer = () => writeJSON(TIMER_KEY, state.timer);

async function startTimer(bookId) {
  const b = getBook(bookId);
  if (!b) return;
  if (state.timer) {
    if (state.timer.bookId === bookId) {
      island.expand();
      return;
    }
    const ok = await UI.confirmSheet({
      title: 'Açık bir okuma oturumu var',
      message: `“${state.timer.bookTitle}” için süren oturumu bitirip kaydetmen gerekiyor.`,
      confirmText: 'Mevcut Oturumu Bitir',
    });
    if (ok) finishTimer();
    return;
  }
  if (b.status !== 'reading') state.data.updateBook(bookId, { status: 'reading', startedAt: b.startedAt || Date.now(), finishedAt: null }).catch(onWriteError);
  state.timer = { bookId, bookTitle: b.title, elapsed: 0, resumedAt: Date.now(), running: true, startedAt: Date.now() };
  persistTimer();
  refreshIsland();
  setTimeout(() => island.expand(), 380);
  UI.haptic([6, 30, 6]);
  renderView();
}
function toggleTimer() {
  const t = state.timer;
  if (!t) return;
  if (t.running) {
    t.elapsed += Date.now() - t.resumedAt;
    t.running = false;
  } else {
    t.resumedAt = Date.now();
    t.running = true;
  }
  persistTimer();
  refreshIsland();
  UI.haptic(6);
}
function finishTimer() {
  const t = state.timer;
  if (!t) return;
  const minutes = Math.max(1, Math.round(timerElapsed() / 60000));
  state.timer = null;
  persistTimer();
  refreshIsland();
  renderView();
  if (getBook(t.bookId)) openLogSheet({ bookId: t.bookId, mode: 'current', minutes, fromTimer: true });
  else UI.toast('Kitap bulunamadı; oturum kaydedilemedi', { tone: 'error' });
}
function discardTimer() {
  state.timer = null;
  persistTimer();
  refreshIsland();
}
async function cancelTimer() {
  const ok = await UI.confirmSheet({ title: 'Oturum iptal edilsin mi?', message: 'Geçen süre kaydedilmeyecek.', confirmText: 'Oturumu İptal Et', destructive: true });
  if (!ok) return;
  discardTimer();
  renderView();
}
function refreshIsland() {
  if (!island) return;
  if (!state.timer || !state.data) {
    island.hide();
    clearInterval(tickTimer);
    tickTimer = 0;
    document.body.classList.remove('has-island');
    return;
  }
  const b = getBook(state.timer.bookId) || { title: state.timer.bookTitle };
  island.show(b, state.timer.running);
  island.setTime(timerElapsed());
  document.body.classList.add('has-island');
  if (!tickTimer) tickTimer = setInterval(() => !document.hidden && island.setTime(timerElapsed()), 1000);
}

/* =========================================================================
   Ambient Cover Glow & seri senkronizasyonu
   ========================================================================= */
let ambientKey = '';
async function updateAmbient() {
  const mode = resolvedMode();
  if (!state.settings.coverGlow || !state.data || minimal()) {
    ambientKey = 'theme';
    UI.setAmbient(null);
    return;
  }
  const b = (state.route.name === 'book' && getBook(state.route.params.id)) || (state.timer && getBook(state.timer.bookId)) || booksBy('reading')[0] || null;
  const key = `${b ? b.coverUrl || b.title : 'theme'}|${mode}`;
  if (key === ambientKey) return;
  ambientKey = key;
  if (!b?.coverUrl) {
    UI.setAmbient(null);
    return;
  }
  const pal = await UI.getPalette(b);
  if (key !== ambientKey) return;
  UI.setAmbient(pal.fromCover ? UI.ambientColors(pal.hsl, mode) : null);
}

let streakSyncTimer = 0;
function syncStreak() {
  if (!state.ready.profile || !state.ready.logs || !state.profile) return;
  clearTimeout(streakSyncTimer);
  streakSyncTimer = setTimeout(() => {
    const { current, longest } = D().streak;
    const p = state.profile;
    if (!p) return;
    const best = Math.max(longest, p.longestStreak || 0);
    if (p.currentStreak !== current || p.longestStreak !== best) state.data.updateProfile({ currentStreak: current, longestStreak: best }).catch(() => {});
  }, 1500);
}

/* =========================================================================
   Global olaylar
   ========================================================================= */
const ACTIONS = {
  go: el => navigate(el.dataset.to),
  back: () => goBack(),
  'add-book': () => openAddBookSheet(),
  scan: () => openScannerSheet(),
  auth: el => openAuthSheet(el.dataset.mode || 'signin'),
  nickname: () => openNicknameSheet(),
  'reset-password': async () => {
    const email = state.user?.email;
    if (!email || !state.fb) return;
    const ok = await UI.confirmSheet({ title: 'Şifre sıfırlama', message: `${email} adresine sıfırlama bağlantısı gönderilsin mi?`, confirmText: 'Bağlantı Gönder' });
    if (!ok) return;
    try {
      await state.fb.auth.reset(email);
      UI.toast('Sıfırlama bağlantısı gönderildi', { icon: 'mail' });
    } catch (err) {
      UI.toast(authMessage(err), { tone: 'error', icon: 'info' });
    }
  },
  'open-book': el => {
    if (state.route.name !== 'book' && !el.closest('.sheet')) nameForTransition(el.querySelector('.cover') || el.closest('[data-id]')?.querySelector('.cover'), 'bk-cover');
    navigate(`/book/${encodeURIComponent(el.dataset.id)}`);
  },
  'change-cover': el => changeCover(getBook(el.dataset.id)),
  log: el => openLogSheet({ bookId: el.dataset.id }),
  'log-any': () => openLogSheet({ mode: 'delta' }),
  timer: el => startTimer(el.dataset.id),
  'start-reading': el => startReading(el.dataset.id),
  'delete-book': el => deleteBook(el.dataset.id),
  'book-menu': el => openBookMenu(el.dataset.id),
  'finish-book': el => openFinishSheet(getBook(el.dataset.id)),
  'edit-book': el => openBookForm(getBook(el.dataset.id)),
  'toggle-priority': el => togglePriority(el.dataset.id),
  'add-quote': el => openQuoteSheet(getBook(el.dataset.id)),
  'share-quote': el => {
    const q = state.quotes.find(x => x.id === el.dataset.id);
    if (q) openShareSheet({ quote: q });
  },
  'share-book': el => {
    const b = getBook(el.dataset.id);
    if (b) openShareSheet({ book: b });
  },
  'delete-log': el => deleteLog(el.dataset.id),
  'toggle-desc': () => {
    state.ui.descOpen = !state.ui.descOpen;
    $('.book-desc')?.classList.toggle('open', state.ui.descOpen);
  },
  'lib-tab': el => {
    if (state.ui.libTab === el.dataset.key) return;
    state.ui.libTab = el.dataset.key;
    state.ui.libCollection = null;
    UI.setSegmented($('#lib-seg'), el.dataset.key);
    UI.haptic(4);
    refreshLibList();
  },
  'lib-view': el => {
    UI.setSegmented(el.closest('.segmented'), el.dataset.key);
    updateSettings({ libraryView: el.dataset.key });
  },
  'lib-collection': el => {
    state.ui.libCollection = el.dataset.name || null;
    refreshLibList();
  },
  'open-collection': el => {
    state.ui.libTab = 'collections';
    state.ui.libCollection = el.dataset.name;
    if (state.route.name === 'library') {
      UI.setSegmented($('#lib-seg'), 'collections');
      refreshLibList();
    } else navigate('/library');
  },
  'new-collection': () => openNewCollectionSheet(),
  'delete-collection': el => deleteCollection(el.dataset.name),
  day: el => openDaySheet(el.dataset.key),
  'chart-range': el => {
    state.ui.chartRange = el.dataset.key;
    UI.setSegmented(el.closest('.segmented'), el.dataset.key);
    const body = $('#chart-body');
    if (body) body.innerHTML = chartBody();
  },
  'cal-mode': el => {
    state.ui.calMode = el.dataset.key;
    UI.setSegmented(el.closest('.segmented'), el.dataset.key);
    shiftCalendar(0);
  },
  'cal-prev': () => shiftCalendar(-1),
  'cal-next': () => shiftCalendar(1),
  'edit-goals': () => openGoalsSheet(),
  'install-help': () => openInstallSheet(),
  'sign-out': () => signOut(),
  'set-mode': (el, e) => {
    UI.setSegmented(el.closest('.segmented'), el.dataset.key);
    updateSettings({ mode: el.dataset.key }, { origin: { x: e.clientX, y: e.clientY } });
  },
  'set-theme': (el, e) => {
    document.querySelectorAll('.theme-swatch').forEach(s => s.classList.toggle('on', s === el));
    UI.haptic(6);
    updateSettings({ theme: el.dataset.key }, { origin: { x: e.clientX, y: e.clientY } });
  },
  'set-ui': (el, e) => {
    document.querySelectorAll('.style-option').forEach(s => s.classList.toggle('on', s === el));
    UI.haptic(8);
    updateSettings({ uiStyle: el.dataset.key }, { origin: { x: e.clientX, y: e.clientY } });
  },
  /* Sosyal */
  'focus-friend-search': () => {
    const input = $('#fs-q');
    input?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    input?.focus();
  },
  'copy-nick': async () => {
    try {
      await navigator.clipboard.writeText(`@${myNick()}`);
      UI.toast('Kullanıcı adın kopyalandı', { icon: 'copy' });
    } catch {
      UI.toast(`@${myNick()}`, { icon: 'at' });
    }
  },
  'friend-request': el => sendFriendRequest(el.dataset.uid),
  'friend-accept': el => {
    state.fb.social.accept(el.dataset.id).catch(onWriteError);
    UI.haptic([8, 30, 8]);
    UI.toast('Arkadaşlık isteği kabul edildi', { icon: 'people' });
  },
  'friend-remove': el => {
    state.fb.social.remove(el.dataset.id).catch(onWriteError);
    UI.toast(el.dataset.kind === 'cancel' ? 'İstek geri çekildi' : 'İstek reddedildi', { icon: 'close' });
  },
  'friend-open': el => openFriendSheet(el.dataset.uid),
};

document.addEventListener('click', e => {
  if (UI.consumeSwipeClick(e.target)) {
    e.preventDefault();
    e.stopPropagation();
    return;
  }
  const link = e.target.closest('a[data-link]');
  if (link) {
    e.preventDefault();
    if (link.dataset.shelf) {
      state.ui.libTab = link.dataset.shelf;
      state.ui.libCollection = null;
    }
    navigate(link.getAttribute('href'));
    return;
  }
  const el = e.target.closest('[data-action]');
  if (!el || el.disabled) return;
  const fn = ACTIONS[el.dataset.action];
  if (!fn) return;
  e.preventDefault();
  if (el.classList.contains('swipe-btn')) UI.closeSwipeRows();
  if (el.dataset.action === 'open-book' && el.closest('.sheet')) UI.closeAllSheets();
  fn(el, e);
});

document.addEventListener('change', e => {
  if (e.target.id === 'set-glow') {
    UI.haptic(6);
    updateSettings({ coverGlow: e.target.checked });
  }
});

/* =========================================================================
   Kabuk: tab bar, klavye, service worker
   ========================================================================= */
function buildTabbar() {
  $('#tabbar').innerHTML = `
    <div class="tabbar-capsule glass" style="--n:${TABS.length};--idx:0">
      <span class="tab-lens" aria-hidden="true"></span>
      ${TABS.map(t => `<a href="${t.path}" class="tab" data-link data-tab="${t.path}">${icon(t.icon, 21)}<span>${t.label}</span></a>`).join('')}
    </div>
    <button type="button" class="tab-fab glass" data-action="add-book" aria-label="Kitap ekle">${icon('plus', 23)}</button>`;
}
function updateTabbar() {
  const active = state.route.name === 'book' ? state.lastTab : state.route.name === 'home' ? '/' : `/${state.route.name}`;
  const idx = Math.max(0, TABS.findIndex(t => t.path === active));
  const cap = $('.tabbar-capsule');
  if (!cap) return;
  const prev = Number(cap.style.getPropertyValue('--idx')) || 0;
  if (prev !== idx) UI.morph(cap, idx > prev ? 'right' : 'left');
  cap.style.setProperty('--idx', idx);
  cap.querySelectorAll('.tab').forEach((t, i) => {
    t.classList.toggle('on', i === idx);
    if (i === idx) t.setAttribute('aria-current', 'page');
    else t.removeAttribute('aria-current');
  });
}

function bindKeyboardInset() {
  const vv = window.visualViewport;
  if (!vv) return;
  const update = () => {
    const kb = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
    document.documentElement.style.setProperty('--kb', `${kb > 60 ? kb : 0}px`);
  };
  vv.addEventListener('resize', update);
  vv.addEventListener('scroll', update);
}

function registerSW() {
  if (!('serviceWorker' in navigator) || !/^https?:$/.test(location.protocol)) return;
  const register = () =>
    navigator.serviceWorker
      .register('/sw.js')
      .then(reg => {
        reg.addEventListener('updatefound', () => {
          const w = reg.installing;
          w?.addEventListener('statechange', () => {
            if (w.state === 'installed' && navigator.serviceWorker.controller)
              UI.toast('Yeni sürüm hazır', { icon: 'sparkles', action: 'Yenile', duration: 9000, onAction: () => location.reload() });
          });
        });
        // Uygulama öne geldiğinde güncellemeyi sessizce kontrol et
        document.addEventListener('visibilitychange', () => !document.hidden && reg.update().catch(() => {}));
      })
      .catch(err => console.warn('[sw] kayıt başarısız', err));
  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register);
}

function hideSplash() {
  const s = $('#splash');
  if (!s) return;
  s.classList.add('hide');
  setTimeout(() => s.remove(), 600);
}

/* =========================================================================
   Oturum yaşam döngüsü: yerel ↔ hesap
   ========================================================================= */
/** Belge listesindeki anlamlı değişiklik imzası (updatedAt tahmin farkları yok sayılır). */
const signature = v => JSON.stringify(v, (k, x) => (k === 'updatedAt' ? undefined : x));
function changed(kind, value) {
  const s = signature(value);
  if (state.sig[kind] === s) return false;
  state.sig[kind] = s;
  return true;
}

let nickPrompted = '';
function startSession(user) {
  state.unsubscribe?.();
  stopSocial();
  Object.assign(state, {
    user,
    profile: null,
    books: [],
    logs: [],
    quotes: [],
    sig: {},
    derived: null,
    ready: { profile: false, books: false, logs: false, quotes: false },
  });
  lastPublic = '';
  state.ui.friendResult = null;
  state.pendingBooks.clear();
  state.data = createDataService(user ? state.fb.db : state.local, user ? user.uid : LOCAL_UID);
  document.body.classList.toggle('cloud', !!user);

  let profileCreated = false;
  let settingsPushed = false;
  state.unsubscribe = state.data.subscribe({
    profile: (doc, meta = {}) => {
      if (!doc && !meta.fromCache && !profileCreated) {
        profileCreated = true;
        settingsPushed = true;
        state.data.updateProfile({ ...DEFAULT_PROFILE, collections: [], displayName: user?.displayName || '', settings: state.settings, createdAt: Date.now() }).catch(onWriteError);
      }
      if (doc?.settings) updateSettings({ ...DEFAULT_SETTINGS, ...doc.settings }, { sync: false });
      else if (doc && !settingsPushed) {
        settingsPushed = true;
        state.data.updateProfile({ settings: state.settings }).catch(() => {});
      }
      if (user && doc && !meta.fromCache && !doc.nickname && nickPrompted !== user.uid) {
        nickPrompted = user.uid;
        setTimeout(() => {
          if (isCloud() && !myNick()) UI.toast('Arkadaşlarının seni bulması için bir kullanıcı adı seç', { icon: 'at', action: 'Seç', duration: 7000, onAction: openNicknameSheet });
        }, 3000);
      }
      const first = !state.ready.profile;
      if (!changed('profile', doc) && !first) return;
      state.profile = doc;
      state.ready.profile = true;
      scheduleRender();
    },
    books: list => {
      const first = !state.ready.books;
      list.forEach(b => state.pendingBooks.delete(b.id));
      if (!changed('books', list) && !first) return;
      state.books = list;
      state.ready.books = true;
      scheduleRender();
    },
    logs: list => {
      const first = !state.ready.logs;
      if (!changed('logs', list) && !first) return;
      state.logs = list;
      state.ready.logs = true;
      scheduleRender();
    },
    quotes: list => {
      const first = !state.ready.quotes;
      if (!changed('quotes', list) && !first) return;
      state.quotes = list;
      state.ready.quotes = true;
      scheduleRender();
    },
    error: err => {
      console.error('[veri]', err);
      UI.toast(err?.code === 'permission-denied' ? 'Veritabanı izni reddedildi. Firestore kurallarını kontrol et.' : 'Veriler eşitlenemedi.', { tone: 'error', icon: 'info' });
    },
  });
  if (user) startSocial(user.uid);
  derive();
  if (location.pathname !== '/' && matchRoute(location.pathname).path === '/') history.replaceState({ depth: 0 }, '', '/');
  hideSplash();
  applyRoute('fade');
  refreshIsland();
}

let authResolved = false;
let authChain = Promise.resolve();
function onAuth(user) {
  authChain = authChain.then(async () => {
    const sameUser = authResolved && (state.user?.uid || null) === (user?.uid || null);
    if (sameUser) return;
    if (user && state.local.hasContent()) {
      try {
        const n = await migrateLocalToCloud(state.local, state.fb.db, user.uid);
        if (n) UI.toast(`Bu cihazdaki ${n} kitap hesabına aktarıldı`, { icon: 'cloud', duration: 4000 });
      } catch (err) {
        console.error('[göç]', err);
        UI.toast('Cihazdaki veriler hesaba aktarılamadı; bu cihazda saklanmaya devam ediyor.', { tone: 'error', icon: 'info', duration: 5000 });
      }
    }
    const announce = authResolved;
    authResolved = true;
    startSession(user);
    if (announce) UI.toast(user ? 'Giriş yapıldı · her şey hesabınla senkron' : 'Oturum kapatıldı · bu cihazda devam ediliyor', { icon: user ? 'cloud' : 'device' });
  });
}

async function boot() {
  applyTheme();
  UI.initCoverLoader();
  UI.initPointerGlow();
  buildTabbar();
  island = UI.createIsland($('#island'), {
    toggle: toggleTimer,
    finish: finishTimer,
    cancel: cancelTimer,
    open: () => state.timer && navigate(`/book/${encodeURIComponent(state.timer.bookId)}`),
  });
  view().addEventListener('scroll', onViewScroll, { passive: true });
  view().addEventListener('focusout', () => {
    if (state.pendingRender) setTimeout(() => !isEditing() && renderView(), 80);
  });
  let lastDay = S.todayKey();
  document.addEventListener('visibilitychange', () => {
    if (document.hidden || !state.data) return;
    // Yalnızca gün değiştiyse (seri / hedefler) yeniden hesapla
    if (S.todayKey() !== lastDay) {
      lastDay = S.todayKey();
      derive();
      renderView();
    }
    refreshIsland();
  });
  window.addEventListener('keydown', e => {
    if (e.key === 'Escape') UI.topSheet()?.close('esc');
  });
  if (!history.state) history.replaceState({ depth: 0 }, '', location.pathname + location.search);
  bindKeyboardInset();
  registerSW();
  maybeInstallHint();

  if (!isFirebaseConfigured) {
    onAuth(null);
    return;
  }
  // Oturum açık kullanıcıyı göstermeden önce Firebase'in kısa süre yanıt
  // vermesini bekle; gecikirse yerel modla başla.
  const fallback = setTimeout(() => !authResolved && onAuth(null), 6000);
  try {
    state.fb = await loadFirebase();
    state.fb.auth.completeRedirect().then(err => err && UI.toast(authMessage(err), { tone: 'error', icon: 'info' }));
    state.fb.auth.onChange(user => {
      clearTimeout(fallback);
      onAuth(user);
    });
  } catch (err) {
    console.warn('[firebase] yüklenemedi, yerel modla devam', err);
    clearTimeout(fallback);
    onAuth(null);
  }
}

boot();
