/* =========================================================================
   Okur — Kitap arama servisi
   Google Books API + Open Library paralel sorgulanır, sonuçlar tek tip
   bir kitap nesnesine normalize edilip birleştirilir. Kapağı olmayan
   sonuçlar diğer kaynaktaki eşleşmeyle tamamlanır. Ayrıca bir kitap için
   alternatif kapak arama (kapak seçici) sağlar.
   ========================================================================= */
import { firebaseConfig, isFirebaseConfigured } from './firebase-config.js';

/**
 * Google Books anahtarı. Boş bırakılırsa Firebase projesinin web API
 * anahtarı kullanılır (aynı Google Cloud projesinde "Books API" etkin ve
 * anahtarın API kısıtlamalarına eklenmiş olmalı).
 */
export const GOOGLE_BOOKS_API_KEY = '';

const GOOGLE = 'https://www.googleapis.com/books/v1/volumes';
const OL_SEARCH = 'https://openlibrary.org/search.json';
const OL_BOOKS = 'https://openlibrary.org/api/books';
const cache = new Map();

let googleKey = GOOGLE_BOOKS_API_KEY || (isFirebaseConfigured ? firebaseConfig.apiKey : '');
let googleBlockedUntil = 0;
const googleUrl = query => `${GOOGLE}?${query}${googleKey ? `&key=${encodeURIComponent(googleKey)}` : ''}`;

export function cleanISBN(value) {
  return String(value || '').replace(/[^0-9Xx]/g, '').toUpperCase();
}
export function isISBN(value) {
  const c = cleanISBN(value);
  return (c.length === 10 && /^\d{9}[\dX]$/.test(c)) || (c.length === 13 && /^97[89]\d{10}$/.test(c));
}

const httpsify = url => (url ? String(url).replace(/^http:\/\//i, 'https://') : '');
const stripHtml = s => String(s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const isAbort = err => err?.name === 'AbortError';
export const fold = s =>
  String(s || '')
    .replace(/[ğĞ]/g, 'g')
    .replace(/[üÜ]/g, 'u')
    .replace(/[şŞ]/g, 's')
    .replace(/[ıİ]/g, 'i')
    .replace(/[öÖ]/g, 'o')
    .replace(/[çÇ]/g, 'c')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

async function fetchJSON(url, signal) {
  const res = await fetch(url, { signal, headers: { Accept: 'application/json' } });
  if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status });
  return res.json();
}

/** Google isteği: anahtar reddedilirse anahtarsız dener, kota dolarsa bir süre atlar. */
async function google(query, signal) {
  if (Date.now() < googleBlockedUntil) throw new Error('google-quota');
  try {
    return await fetchJSON(googleUrl(query), signal);
  } catch (err) {
    if (isAbort(err)) throw err;
    if (googleKey && (err.status === 400 || err.status === 403)) {
      console.warn('[books] Google Books anahtarı kabul edilmedi; anahtarsız deneniyor.');
      googleKey = '';
      return fetchJSON(googleUrl(query), signal);
    }
    if (err.status === 429) googleBlockedUntil = Date.now() + 10 * 60 * 1000;
    throw err;
  }
}

/** Google kapağını yüksek çözünürlükte ister (varsayılan 128px yerine 400×600). */
export function googleCoverHiRes(url) {
  if (!url) return '';
  let u = httpsify(url).replace('&edge=curl', '').replace(/zoom=\d/, 'zoom=1');
  if (/books\.google/.test(u) && !/fife=/.test(u)) u += '&fife=w400-h600';
  return u;
}
const googleCover = links => googleCoverHiRes(links?.thumbnail || links?.smallThumbnail || '');

function fromGoogle(item) {
  const v = item.volumeInfo || {};
  const ids = v.industryIdentifiers || [];
  const isbn = (ids.find(i => i.type === 'ISBN_13') || ids.find(i => i.type === 'ISBN_10'))?.identifier || '';
  return {
    sourceId: `g:${item.id}`,
    source: 'Google Books',
    title: (v.title || '').trim(),
    subtitle: v.subtitle || '',
    author: (v.authors || []).join(', '),
    coverUrl: googleCover(v.imageLinks),
    isbn,
    totalPages: v.pageCount || 0,
    description: stripHtml(v.description),
    publishedDate: v.publishedDate || '',
    publisher: v.publisher || '',
  };
}

function fromOpenLibraryDoc(doc) {
  const isbn = (doc.isbn || []).find(i => i.length === 13) || (doc.isbn || [])[0] || '';
  return {
    sourceId: `ol:${doc.key}`,
    source: 'Open Library',
    title: (doc.title || '').trim(),
    subtitle: doc.subtitle || '',
    author: (doc.author_name || []).slice(0, 3).join(', '),
    coverUrl: doc.cover_i ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-L.jpg` : '',
    isbn,
    totalPages: doc.number_of_pages_median || 0,
    description: '',
    publishedDate: doc.first_publish_year ? String(doc.first_publish_year) : '',
    publisher: (doc.publisher || [])[0] || '',
  };
}

const sameBook = (a, b) => {
  if (fold(a.title) !== fold(b.title)) return false;
  const fa = fold(a.author).split(/[ ,]+/).filter(w => w.length > 2);
  const fb = fold(b.author);
  return !fa.length || !fb || fa.some(w => fb.includes(w));
};

function dedupe(list) {
  const seen = new Set();
  return list.filter(b => {
    if (!b.title) return false;
    const key = `${fold(b.title)}|${fold(b.author)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Kapağı olmayan sonuçları diğer kaynaktaki aynı kitabın kapağıyla tamamlar. */
function enrichCovers(list) {
  for (const b of list) {
    if (b.coverUrl) continue;
    const twin = list.find(o => o !== b && o.coverUrl && sameBook(b, o));
    if (twin) b.coverUrl = twin.coverUrl;
    if (!b.totalPages) b.totalPages = twin?.totalPages || 0;
  }
  return list;
}

const OL_FIELDS = 'key,title,subtitle,author_name,cover_i,number_of_pages_median,isbn,first_publish_year,publisher';

async function searchOpenLibrary(q, signal) {
  const run = async query => (await fetchJSON(`${OL_SEARCH}?q=${encodeURIComponent(query)}&limit=20&fields=${OL_FIELDS}`, signal)).docs || [];
  let docs = await run(q);
  const ascii = fold(q);
  if (docs.length < 3 && ascii !== q.toLowerCase()) docs = docs.concat(await run(ascii));
  return docs.map(fromOpenLibraryDoc);
}

async function searchGoogle(q, signal) {
  const data = await google(`q=${encodeURIComponent(q)}&maxResults=24&printType=books&orderBy=relevance`, signal);
  return (data.items || []).map(fromGoogle);
}

/** Başlık / yazar / ISBN araması — Google ve Open Library aynı anda sorgulanır. */
export async function searchBooks(query, { signal } = {}) {
  const q = String(query || '').trim();
  if (!q) return [];
  const key = q.toLocaleLowerCase('tr');
  if (cache.has(key)) return cache.get(key);

  let results;
  if (isISBN(q)) {
    const book = await lookupISBN(q, { signal });
    results = book ? [book] : [];
  } else {
    const [g, o] = await Promise.allSettled([searchGoogle(q, signal), searchOpenLibrary(q, signal)]);
    if ([g, o].some(r => r.status === 'rejected' && isAbort(r.reason))) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    if (g.status === 'rejected' && o.status === 'rejected') throw o.reason;
    const gl = g.status === 'fulfilled' ? g.value : [];
    const ol = o.status === 'fulfilled' ? o.value : [];
    results = dedupe(enrichCovers([...gl, ...ol])).slice(0, 30);
  }
  cache.set(key, results);
  return results;
}

/** ISBN ile tek kitap; eksik sayfa/kapak bilgisi Open Library ile tamamlanır. */
export async function lookupISBN(raw, { signal } = {}) {
  const isbn = cleanISBN(raw);
  if (!isbn) return null;
  const [g, o] = await Promise.allSettled([google(`q=isbn:${isbn}`, signal), fetchJSON(`${OL_BOOKS}?bibkeys=ISBN:${isbn}&format=json&jscmd=data`, signal)]);
  let book = g.status === 'fulfilled' && g.value.items?.length ? fromGoogle(g.value.items[0]) : null;
  const ol = o.status === 'fulfilled' ? o.value[`ISBN:${isbn}`] : null;
  if (ol) {
    const olBook = {
      sourceId: `ol:${isbn}`,
      source: 'Open Library',
      title: (ol.title || '').trim(),
      subtitle: ol.subtitle || '',
      author: (ol.authors || []).map(a => a.name).join(', '),
      coverUrl: httpsify(ol.cover?.large || ol.cover?.medium || ''),
      isbn,
      totalPages: ol.number_of_pages || 0,
      description: '',
      publishedDate: ol.publish_date || '',
      publisher: (ol.publishers || []).map(p => p.name).join(', '),
    };
    book = book ? { ...olBook, ...book, totalPages: book.totalPages || olBook.totalPages, coverUrl: book.coverUrl || olBook.coverUrl } : olBook;
  }
  if (book) {
    book.isbn = book.isbn || isbn;
    if (!book.coverUrl) book.coverUrl = `https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg?default=false`;
  }
  return book;
}

/**
 * Kapak seçici: verilen sorgu için farklı baskı / çevirilerin kapaklarını toplar.
 * Döner: [{ url, label }]
 */
export async function searchCovers(query, { signal } = {}) {
  const q = String(query || '').trim();
  if (!q) return [];
  const [g, o] = await Promise.allSettled([
    google(`q=${encodeURIComponent(q)}&maxResults=30&printType=books`, signal),
    fetchJSON(`${OL_SEARCH}?q=${encodeURIComponent(q)}&limit=30&fields=title,author_name,cover_i,edition_key`, signal),
  ]);
  const out = [];
  const seen = new Set();
  const push = (url, label) => {
    if (!url || seen.has(url)) return;
    seen.add(url);
    out.push({ url, label });
  };
  if (g.status === 'fulfilled')
    for (const it of g.value.items || []) {
      const v = it.volumeInfo || {};
      if (v.imageLinks) push(googleCover(v.imageLinks), [v.title, v.publishedDate?.slice(0, 4)].filter(Boolean).join(' · '));
    }
  if (o.status === 'fulfilled')
    for (const d of o.value.docs || []) if (d.cover_i) push(`https://covers.openlibrary.org/b/id/${d.cover_i}-L.jpg`, d.title);
  return out.slice(0, 36);
}
