/* =========================================================================
   Okur — İstatistik motoru
   Seri (streak), günlük harita, ısı haritası, grafik serileri ve
   "İstatistiklere Ekleme" (excludeFromStats) filtresi. Saf fonksiyonlar;
   DOM veya Firebase bağımlılığı yoktur.
   ========================================================================= */

const DAY_MS = 86400000;
const LOCALE = 'tr-TR';

export const MONTHS = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
export const MONTHS_SHORT = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];
export const WEEKDAYS = ['Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi', 'Pazar'];
export const WEEKDAYS_SHORT = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];
export const WEEKDAYS_MINI = ['P', 'S', 'Ç', 'P', 'C', 'C', 'P'];

/* ---------- Tarih yardımcıları (yerel saat, YYYY-MM-DD) ---------- */
const pad = n => String(n).padStart(2, '0');

export function dateKey(input = new Date()) {
  const d = input instanceof Date ? input : new Date(input);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
export const todayKey = () => dateKey(new Date());

export function parseKey(key) {
  const [y, m, d] = String(key).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1, 12, 0, 0, 0);
}
export function addDays(key, n) {
  const d = parseKey(key);
  d.setDate(d.getDate() + n);
  return dateKey(d);
}
/** b - a (gün) */
export function diffDays(a, b) {
  return Math.round((parseKey(b) - parseKey(a)) / DAY_MS);
}
/** Pazartesi = 0 … Pazar = 6 */
export const wdIndex = key => (parseKey(key).getDay() + 6) % 7;

/** Firestore Timestamp, sayı veya tarih → milisaniye */
export function tsMs(v) {
  if (!v) return 0;
  if (typeof v === 'number') return v;
  if (typeof v.toMillis === 'function') return v.toMillis();
  if (typeof v.seconds === 'number') return v.seconds * 1000;
  const t = new Date(v).getTime();
  return Number.isNaN(t) ? 0 : t;
}

/** Geçmiş bir güne kayıt girilirken kullanılan zaman damgası */
export function timestampForDate(key) {
  if (key === todayKey()) return Date.now();
  const d = parseKey(key);
  d.setHours(20, 0, 0, 0);
  return d.getTime();
}

/* ---------- Biçimlendirme ---------- */
export const fmtNum = n => new Intl.NumberFormat(LOCALE).format(Math.round(n || 0));

export function fmtDay(key, withYear = false) {
  const d = parseKey(key);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return `${d.getDate()} ${MONTHS[d.getMonth()]}${withYear || !sameYear ? ` ${d.getFullYear()}` : ''}`;
}
export function fmtLong(key) {
  return `${WEEKDAYS[wdIndex(key)]}, ${fmtDay(key)}`;
}
export function relDay(key) {
  const t = todayKey();
  if (key === t) return 'Bugün';
  if (key === addDays(t, -1)) return 'Dün';
  const d = parseKey(key);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}${sameYear ? '' : ` ${d.getFullYear()}`}`;
}
export function fmtMinutes(min) {
  const m = Math.max(0, Math.round(min || 0));
  if (m < 60) return `${m} dk`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h} sa ${r} dk` : `${h} sa`;
}

/* ---------- Çekirdek: istatistik filtresi ---------- */
/** excludeFromStats: true olan (baseline_sync) kayıtlar hiçbir istatistiğe girmez. */
export const isStatLog = log => !!log && log.excludeFromStats !== true;
const isActive = e => !!e && (e.pages > 0 || e.minutes > 0);

/** date → { pages, minutes, sessions, books:Set } — yalnızca gerçek okumalar */
export function buildDailyMap(logs = []) {
  const map = new Map();
  for (const l of logs) {
    if (!isStatLog(l) || !l.date) continue;
    const e = map.get(l.date) || { pages: 0, minutes: 0, sessions: 0, books: new Set() };
    e.pages += Math.max(0, Number(l.pagesRead) || 0);
    e.minutes += Math.max(0, Number(l.durationMinutes) || 0);
    e.sessions += 1;
    if (l.bookId) e.books.add(l.bookId);
    map.set(l.date, e);
  }
  return map;
}

/** Seri: bugün okunmadıysa dünden geriye sayılır (seri gün sonuna kadar canlı kalır). */
export function computeStreak(map, today = todayKey()) {
  const activeToday = isActive(map.get(today));
  let current = 0;
  let cursor = activeToday ? today : addDays(today, -1);
  while (isActive(map.get(cursor))) {
    current += 1;
    cursor = addDays(cursor, -1);
  }
  const keys = [...map.keys()].filter(k => isActive(map.get(k))).sort();
  let longest = 0;
  let run = 0;
  let prev = null;
  for (const k of keys) {
    run = prev && diffDays(prev, k) === 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
    prev = k;
  }
  return { current, longest: Math.max(longest, current), activeToday, atRisk: !activeToday && current > 0 };
}

export function dayProgress(map, profile, key = todayKey()) {
  const e = map.get(key) || { pages: 0, minutes: 0 };
  const pageGoal = Math.max(1, profile.dailyPageGoal || 1);
  const minuteGoal = Math.max(1, profile.dailyMinuteGoal || 1);
  return { pages: e.pages, minutes: e.minutes, pageGoal, minuteGoal, pageRatio: e.pages / pageGoal, minuteRatio: e.minutes / minuteGoal };
}

/** Son n gün (bitiş dahil) */
export function series(map, days, endKey = todayKey()) {
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const key = addDays(endKey, -i);
    const e = map.get(key);
    out.push({ key, pages: e?.pages || 0, minutes: e?.minutes || 0 });
  }
  return out;
}

export function monthSeries(map, year) {
  const out = Array.from({ length: 12 }, () => ({ pages: 0, minutes: 0, days: 0 }));
  for (const [key, e] of map) {
    const [y, m] = key.split('-').map(Number);
    if (y !== year) continue;
    out[m - 1].pages += e.pages;
    out[m - 1].minutes += e.minutes;
    if (isActive(e)) out[m - 1].days += 1;
  }
  return out;
}

/** Pazartesi başlangıçlı ay ızgarası; boş hücreler null */
export function monthMatrix(year, monthIndex) {
  const first = new Date(year, monthIndex, 1, 12);
  const offset = (first.getDay() + 6) % 7;
  const days = new Date(year, monthIndex + 1, 0).getDate();
  const cells = Array(offset).fill(null);
  for (let d = 1; d <= days; d++) cells.push(dateKey(new Date(year, monthIndex, d, 12)));
  while (cells.length % 7) cells.push(null);
  return cells;
}

export function weekKeys(anchorKey = todayKey()) {
  const monday = addDays(anchorKey, -wdIndex(anchorKey));
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

/** 0–4 ısı seviyesi: günlük hedefe oranla */
export function heatLevel(entry, profile) {
  if (!isActive(entry)) return 0;
  const ratio = Math.max(entry.pages / Math.max(1, profile.dailyPageGoal), entry.minutes / Math.max(1, profile.dailyMinuteGoal));
  if (ratio < 0.34) return 1;
  if (ratio < 0.67) return 2;
  if (ratio < 1) return 3;
  return 4;
}

/* ---------- Özet / analitik kartları ---------- */
export function summarize({ books = [], logs = [], profile, map }) {
  const now = new Date();
  const year = now.getFullYear();
  let totalPages = 0;
  let totalMinutes = 0;
  let activeDays = 0;
  const weekday = Array(7).fill(0);
  for (const [key, e] of map) {
    totalPages += e.pages;
    totalMinutes += e.minutes;
    if (isActive(e)) activeDays += 1;
    weekday[wdIndex(key)] += e.pages;
  }
  let timedPages = 0;
  let timedMinutes = 0;
  let sessions = 0;
  let sessionMinutes = 0;
  for (const l of logs) {
    if (!isStatLog(l)) continue;
    if (l.durationMinutes > 0) {
      sessions += 1;
      sessionMinutes += l.durationMinutes;
      if (l.pagesRead > 0) {
        timedPages += l.pagesRead;
        timedMinutes += l.durationMinutes;
      }
    }
  }
  const finished = books.filter(b => b.status === 'finished');
  const finishedThisYear = finished.filter(b => {
    const t = tsMs(b.finishedAt);
    return t && new Date(t).getFullYear() === year;
  });
  const startOfYear = new Date(year, 0, 1);
  const daysInYear = (new Date(year + 1, 0, 1) - startOfYear) / DAY_MS;
  const dayOfYear = Math.floor((now - startOfYear) / DAY_MS) + 1;
  const goal = Math.max(1, profile.yearlyBookGoal || 1);
  const last30 = series(map, 30).reduce((a, d) => a + d.pages, 0);
  const best = Math.max(...weekday);

  return {
    totalPages,
    totalMinutes,
    activeDays,
    finishedCount: finished.length,
    finishedThisYear: finishedThisYear.length,
    finishedThisYearBooks: finishedThisYear.sort((a, b) => tsMs(b.finishedAt) - tsMs(a.finishedAt)),
    avgPagesPerDay: activeDays ? totalPages / activeDays : 0,
    pagesPerHour: timedMinutes ? timedPages / (timedMinutes / 60) : 0,
    avgSessionMinutes: sessions ? sessionMinutes / sessions : 0,
    last30Pages: last30,
    expectedByNow: goal * (dayOfYear / daysInYear),
    yearProgress: dayOfYear / daysInYear,
    bestWeekday: best > 0 ? weekday.indexOf(best) : -1,
  };
}

/** Kitap bazlı istatistik ve tahmini bitiş */
export function bookStats(book, logs = [], profile = {}, globalPace = 0) {
  const own = logs.filter(l => l.bookId === book.id);
  const stat = own.filter(isStatLog);
  const pages = stat.reduce((a, l) => a + Math.max(0, l.pagesRead || 0), 0);
  const minutes = stat.reduce((a, l) => a + Math.max(0, l.durationMinutes || 0), 0);
  const timed = stat.filter(l => l.durationMinutes > 0 && l.pagesRead > 0);
  const timedPages = timed.reduce((a, l) => a + l.pagesRead, 0);
  const timedMinutes = timed.reduce((a, l) => a + l.durationMinutes, 0);
  const readingDays = new Set(stat.filter(l => l.pagesRead > 0).map(l => l.date)).size;
  const pace = readingDays ? pages / readingDays : 0;
  const total = book.totalPages || 0;
  const current = book.currentPage || 0;
  const remaining = Math.max(0, total - current);
  const usedPace = pace || globalPace || profile.dailyPageGoal || 20;
  const etaDays = total && remaining ? Math.max(1, Math.ceil(remaining / usedPace)) : 0;
  return {
    pages,
    minutes,
    sessions: stat.length,
    readingDays,
    pace,
    total,
    remaining,
    progress: total ? Math.min(1, current / total) : 0,
    pagesPerHour: timedMinutes ? timedPages / (timedMinutes / 60) : 0,
    etaDays,
    etaDate: etaDays ? addDays(todayKey(), etaDays) : null,
  };
}

/** Takvimde dokunulan gün: tüm kayıtlar (hariç tutulanlar işaretli) + gerçek toplamlar */
export function dayDetail(logs = [], key) {
  const entries = logs.filter(l => l.date === key).sort((a, b) => tsMs(a.timestamp) - tsMs(b.timestamp));
  const stat = entries.filter(isStatLog);
  return {
    entries,
    pages: stat.reduce((a, l) => a + Math.max(0, l.pagesRead || 0), 0),
    minutes: stat.reduce((a, l) => a + Math.max(0, l.durationMinutes || 0), 0),
  };
}
