/* =========================================================================
   Okur — Veri katmanı
   -------------------------------------------------------------------------
   • Hesapsız kullanım: tüm veriler cihazda (localStorage) "users/local"
     ağacında, Firestore ile birebir aynı şemada tutulur.
   • Hesapla giriş: Firebase Auth + Cloud Firestore (onSnapshot ile gerçek
     zamanlı). Giriş yapıldığında cihazdaki veriler hesaba aktarılır ve
     bundan sonra her şey hesapla senkron çalışır.

   Kurulum:
     1) Firebase konsolunda bir Web uygulaması oluşturun ve aşağıdaki
        firebaseConfig nesnesini kendi değerlerinizle doldurun.
     2) Authentication → Sign-in method: "E-posta/Şifre" ve "Google" açın,
        Authorized domains listesine Cloudflare Pages alan adınızı ekleyin.
     3) Firestore'u oluşturun ve firestore.rules kurallarını yayınlayın.

   Şema:
     users/{uid}/profile/main  { displayName, yearlyBookGoal, dailyPageGoal,
                                 dailyMinuteGoal, currentStreak, longestStreak,
                                 collections[], settings{}, updatedAt }
     users/{uid}/books/{bookId}
     users/{uid}/logs/{logId}
     users/{uid}/quotes/{quoteId}
   ========================================================================= */

export const firebaseConfig = {
  apiKey: 'AIzaSyAfhgSdDct-KIYx5SGp_3Hv9CzXDFeBSBU',
  authDomain: 'kitap-takibi-6065f.firebaseapp.com',
  projectId: 'kitap-takibi-6065f',
  storageBucket: 'kitap-takibi-6065f.firebasestorage.app',
  messagingSenderId: '860629321143',
  appId: '1:860629321143:web:1cc3333762b250e0041432',
  measurementId: 'G-69JWQYE15W',
};

export const FIREBASE_SDK_VERSION = '10.14.1';

export const isFirebaseConfigured =
  typeof firebaseConfig.apiKey === 'string' && firebaseConfig.apiKey.length > 20 && !firebaseConfig.apiKey.startsWith('YOUR_');

export const LOCAL_UID = 'local';

export const DEFAULT_PROFILE = Object.freeze({
  displayName: '',
  yearlyBookGoal: 24,
  dailyPageGoal: 30,
  dailyMinuteGoal: 30,
  currentStreak: 0,
  longestStreak: 0,
  collections: [],
});

/* ---------- Kullanıcı adı (@nickname) ---------- */
export const NICK_RE = /^[a-z0-9_.]{3,20}$/;
export function normalizeNickname(value) {
  return String(value || '')
    .trim()
    .replace(/^@+/, '')
    .toLocaleLowerCase('tr')
    .replace(/ı/g, 'i')
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ş/g, 's')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c');
}
export const isValidNickname = nick => NICK_RE.test(nick) && !/^[._]|[._]$|\.\./.test(nick);
/** İki kullanıcı arasındaki arkadaşlık belgesinin sabit kimliği */
export const pairId = (a, b) => (a < b ? `${a}_${b}` : `${b}_${a}`);

/** Firestore undefined değerleri kabul etmez. */
function clean(data) {
  const out = {};
  for (const [k, v] of Object.entries(data || {})) if (v !== undefined) out[k] = v;
  return out;
}

/* =========================================================================
   Cihaz içi depo (hesapsız kullanım) — Firestore adaptörüyle aynı arayüz
   ========================================================================= */
export function createLocalDb() {
  const KEY = 'okur:local-db';
  let docs = {};
  try {
    docs = JSON.parse(localStorage.getItem(KEY)) || {};
  } catch {
    docs = {};
  }
  const persist = () => {
    try {
      localStorage.setItem(KEY, JSON.stringify(docs));
    } catch (err) {
      console.warn('[local] kaydedilemedi', err);
    }
  };
  const listeners = new Set();
  const parentOf = p => p.slice(0, p.lastIndexOf('/'));
  const copy = v => JSON.parse(JSON.stringify(v));

  const deliver = l => {
    if (!l.active) return;
    if (l.kind === 'doc') l.cb(docs[l.path] ? copy(docs[l.path]) : null, { fromCache: false });
    else
      l.cb(
        Object.keys(docs)
          .filter(k => parentOf(k) === l.path)
          .map(k => ({ id: k.slice(k.lastIndexOf('/') + 1), ...copy(docs[k]) })),
      );
  };
  const apply = ops => {
    for (const op of ops) {
      if (op.type === 'delete') delete docs[op.path];
      else if (op.merge === false) docs[op.path] = clean(op.data);
      else docs[op.path] = { ...(docs[op.path] || {}), ...clean(op.data) };
    }
    persist();
    const touched = ops.map(o => o.path);
    const hit = [...listeners].filter(l => touched.some(p => (l.kind === 'doc' ? l.path === p : parentOf(p) === l.path)));
    queueMicrotask(() => hit.forEach(deliver));
    return Promise.resolve();
  };
  const listen = (kind, path, cb) => {
    const l = { kind, path, cb, active: true };
    listeners.add(l);
    queueMicrotask(() => deliver(l));
    return () => {
      l.active = false;
      listeners.delete(l);
    };
  };
  let counter = 0;

  return {
    kind: 'local',
    newId: () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8) + (counter++).toString(36),
    now: () => Date.now(),
    get: async path => (docs[path] ? copy(docs[path]) : null),
    set: (path, data, merge = true) => apply([{ type: 'set', path, data, merge }]),
    remove: path => apply([{ type: 'delete', path }]),
    commit: ops => apply(ops),
    listenDoc: (path, cb) => listen('doc', path, cb),
    listenCol: (path, cb) => listen('col', path, cb),
    /** Göç için: verilen önekteki tüm belgeler */
    entries: prefix => Object.entries(docs).filter(([k]) => k.startsWith(prefix)).map(([k, v]) => [k, copy(v)]),
    hasContent: () => Object.keys(docs).some(k => /\/(books|logs|quotes)\//.test(k)),
    clear() {
      docs = {};
      persist();
    },
  };
}

/* =========================================================================
   Firebase v10 modüler SDK (gstatic CDN, gerektiğinde dinamik import)
   ========================================================================= */
let firebasePromise = null;

export function loadFirebase() {
  if (!isFirebaseConfigured) return Promise.resolve(null);
  if (!firebasePromise) {
    firebasePromise = createFirebase().catch(err => {
      firebasePromise = null;
      throw err;
    });
  }
  return firebasePromise;
}

async function createFirebase() {
  const base = `https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}`;
  const [{ initializeApp }, A, F] = await Promise.all([
    import(`${base}/firebase-app.js`),
    import(`${base}/firebase-auth.js`),
    import(`${base}/firebase-firestore.js`),
  ]);

  const app = initializeApp(firebaseConfig);
  const auth = A.getAuth(app);
  auth.languageCode = 'tr';

  // Çevrimdışı kalıcılık: v10'da enableIndexedDbPersistence yerine önerilen
  // persistentLocalCache + çoklu sekme yöneticisi.
  let db;
  try {
    db = F.initializeFirestore(app, { localCache: F.persistentLocalCache({ tabManager: F.persistentMultipleTabManager() }) });
  } catch (err) {
    console.warn('[firestore] IndexedDB kalıcılığı açılamadı, bellek önbelleği kullanılıyor.', err);
    db = F.getFirestore(app);
  }

  const ref = path => F.doc(db, path);
  const colRef = path => F.collection(db, path);
  const mapUser = u => ({ uid: u.uid, email: u.email, displayName: u.displayName, photoURL: u.photoURL });
  const isStandalone = () => window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;

  const getData = async path => {
    const snap = await F.getDoc(ref(path));
    return snap.exists() ? snap.data() : null;
  };

  return {
    auth: {
      onChange: cb => A.onAuthStateChanged(auth, u => cb(u ? mapUser(u) : null)),
      /** E-posta ya da @kullanıcı adı ile giriş */
      async signInWithIdentifier(identifier, password) {
        let email = String(identifier || '').trim();
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
          const nick = normalizeNickname(email);
          const entry = isValidNickname(nick) ? await getData(`usernames/${nick}`) : null;
          if (!entry?.email) throw Object.assign(new Error('nick'), { code: 'app/nickname-not-found' });
          email = entry.email;
        }
        return A.signInWithEmailAndPassword(auth, email, password);
      },
      async completeRedirect() {
        try {
          await A.getRedirectResult(auth);
          return null;
        } catch (err) {
          return err;
        }
      },
      signIn: (email, password) => A.signInWithEmailAndPassword(auth, email, password),
      async signUp(name, email, password) {
        const cred = await A.createUserWithEmailAndPassword(auth, email, password);
        if (name) await A.updateProfile(cred.user, { displayName: name });
        return cred;
      },
      reset: email => A.sendPasswordResetEmail(auth, email),
      async google() {
        const provider = new A.GoogleAuthProvider();
        provider.setCustomParameters({ prompt: 'select_account' });
        try {
          return await A.signInWithPopup(auth, provider);
        } catch (err) {
          const fallback = ['auth/popup-blocked', 'auth/operation-not-supported-in-this-environment', 'auth/web-storage-unsupported'];
          if (fallback.includes(err.code) || (isStandalone() && err.code === 'auth/internal-error')) return A.signInWithRedirect(auth, provider);
          throw err;
        }
      },
      signOut: () => A.signOut(auth),
    },
    db: {
      kind: 'cloud',
      newId: colPath => F.doc(colRef(colPath)).id,
      now: () => F.serverTimestamp(),
      async get(path) {
        const snap = await F.getDoc(ref(path));
        return snap.exists() ? snap.data() : null;
      },
      set: (path, data, merge = true) => F.setDoc(ref(path), clean(data), merge ? { merge: true } : {}),
      remove: path => F.deleteDoc(ref(path)),
      async commit(ops) {
        for (let i = 0; i < ops.length; i += 450) {
          const batch = F.writeBatch(db);
          for (const op of ops.slice(i, i + 450)) {
            if (op.type === 'delete') batch.delete(ref(op.path));
            else batch.set(ref(op.path), clean(op.data), op.merge === false ? {} : { merge: true });
          }
          await batch.commit();
        }
      },
      listenDoc: (path, cb, onError) =>
        F.onSnapshot(ref(path), snap => cb(snap.exists() ? snap.data({ serverTimestamps: 'estimate' }) : null, { fromCache: snap.metadata.fromCache }), onError),
      listenCol: (path, cb, onError) =>
        F.onSnapshot(colRef(path), snap => cb(snap.docs.map(d => ({ id: d.id, ...d.data({ serverTimestamps: 'estimate' }) }))), onError),
    },

    /* ---------- Sosyal: kullanıcı adları, arkadaşlıklar, herkese açık profil ---------- */
    social: {
      lookupNickname: nick => getData(`usernames/${nick}`),
      /** Kullanıcı adını atomik olarak sahiplenir (eski ad varsa serbest bırakır). */
      async claimNickname({ uid, nick, email, displayName, oldNick = '' }) {
        const batch = F.writeBatch(db);
        batch.set(ref(`usernames/${nick}`), { uid, email: email || '', displayName: displayName || '', createdAt: F.serverTimestamp() });
        if (oldNick && oldNick !== nick) batch.delete(ref(`usernames/${oldNick}`));
        batch.set(ref(`users/${uid}/profile/main`), { nickname: nick, ...(displayName ? { displayName } : {}), updatedAt: F.serverTimestamp() }, { merge: true });
        batch.set(ref(`publicProfiles/${uid}`), { uid, nickname: nick, displayName: displayName || '', updatedAt: F.serverTimestamp() }, { merge: true });
        await batch.commit();
      },
      listenFriendships: (uid, cb, onError) =>
        F.onSnapshot(
          F.query(colRef('friendships'), F.where('members', 'array-contains', uid)),
          snap => cb(snap.docs.map(d => ({ id: d.id, ...d.data({ serverTimestamps: 'estimate' }) }))),
          onError,
        ),
      listenPublicProfile: (uid, cb, onError) => F.onSnapshot(ref(`publicProfiles/${uid}`), snap => cb(snap.exists() ? snap.data() : null), onError),
      writePublicProfile: (uid, data) => F.setDoc(ref(`publicProfiles/${uid}`), { ...clean(data), updatedAt: F.serverTimestamp() }, { merge: true }),
      /** Arkadaşlık isteği; karşı taraf zaten istek gönderdiyse doğrudan kabul edilir. */
      async sendRequest(me, them) {
        const id = pairId(me.uid, them.uid);
        const existing = await getData(`friendships/${id}`);
        if (existing) {
          if (existing.status === 'pending' && existing.requester === them.uid) {
            await F.updateDoc(ref(`friendships/${id}`), { status: 'accepted', updatedAt: F.serverTimestamp() });
            return 'accepted';
          }
          return existing.status === 'accepted' ? 'already' : 'pending';
        }
        await F.setDoc(ref(`friendships/${id}`), {
          members: [me.uid, them.uid].sort(),
          requester: me.uid,
          status: 'pending',
          names: {
            [me.uid]: { nickname: me.nickname, displayName: me.displayName || '' },
            [them.uid]: { nickname: them.nickname, displayName: them.displayName || '' },
          },
          createdAt: F.serverTimestamp(),
          updatedAt: F.serverTimestamp(),
        });
        return 'sent';
      },
      accept: id => F.updateDoc(ref(`friendships/${id}`), { status: 'accepted', updatedAt: F.serverTimestamp() }),
      remove: id => F.deleteDoc(ref(`friendships/${id}`)),
    },
  };
}

/* =========================================================================
   Cihazdaki verileri hesaba aktarma
   ========================================================================= */
const wait = ms => new Promise(r => setTimeout(r, ms));

/**
 * Hesapsız modda oluşturulan kitap, kayıt ve alıntıları kullanıcının
 * hesabına taşır. Sunucu onayı gelmezse (çevrimdışı) yazmalar Firestore'un
 * kalıcı kuyruğunda bekler; hata olursa cihazdaki veriler silinmez.
 */
export async function migrateLocalToCloud(local, cloud, uid) {
  const from = `users/${LOCAL_UID}/`;
  const entries = local.entries(from);
  const content = entries.filter(([p]) => !p.endsWith('/profile/main'));
  const books = content.filter(([p]) => p.includes('/books/')).length;
  if (!content.length) {
    local.clear();
    return 0;
  }
  const to = p => p.replace(from, `users/${uid}/`);
  const ops = content.map(([p, data]) => ({ type: 'set', merge: false, path: to(p), data }));

  const localProfile = entries.find(([p]) => p.endsWith('/profile/main'))?.[1];
  if (localProfile) {
    let cloudProfile = null;
    try {
      cloudProfile = await Promise.race([cloud.get(`users/${uid}/profile/main`), wait(4000).then(() => null)]);
    } catch {
      cloudProfile = null;
    }
    const collections = [...new Set([...(cloudProfile?.collections || []), ...(localProfile.collections || [])])];
    ops.push({
      type: 'set',
      path: `users/${uid}/profile/main`,
      data: cloudProfile ? { collections } : { ...localProfile, collections },
    });
  }

  const result = await Promise.race([cloud.commit(ops).then(() => 'ok'), wait(6000).then(() => 'pending')]);
  if (result === 'ok' || result === 'pending') local.clear();
  return books;
}

/* =========================================================================
   Yüksek seviye veri servisi — uygulama yalnızca bu API'yi kullanır.
   ========================================================================= */
export function createDataService(db, uid) {
  const root = `users/${uid}`;
  const P = {
    profile: `${root}/profile/main`,
    books: `${root}/books`,
    logs: `${root}/logs`,
    quotes: `${root}/quotes`,
  };
  const stamp = data => ({ ...data, updatedAt: db.now() });

  return {
    kind: db.kind,
    paths: P,

    subscribe({ profile, books, logs, quotes, error }) {
      const unsubs = [
        db.listenDoc(P.profile, profile, error),
        db.listenCol(P.books, books, error),
        db.listenCol(P.logs, logs, error),
        db.listenCol(P.quotes, quotes, error),
      ];
      return () => unsubs.forEach(u => typeof u === 'function' && u());
    },

    updateProfile: data => db.set(P.profile, stamp(data)),

    addBook(data) {
      const id = db.newId(P.books);
      const done = db.set(`${P.books}/${id}`, stamp({ ...data, createdAt: data.createdAt ?? Date.now() }), false);
      return { id, done };
    },
    updateBook: (id, data) => db.set(`${P.books}/${id}`, stamp(data)),
    /** Kitap ve alıntıları silinir; okuma kayıtları istatistik bütünlüğü için korunur. */
    deleteBook: (id, { quoteIds = [] } = {}) =>
      db.commit([...quoteIds.map(q => ({ type: 'delete', path: `${P.quotes}/${q}` })), { type: 'delete', path: `${P.books}/${id}` }]),

    /** Okuma kaydı + kitabın sayfa güncellemesi tek atomik batch'te */
    logProgress({ bookId, log, bookPatch }) {
      const id = db.newId(P.logs);
      const done = db.commit([
        { type: 'set', path: `${P.logs}/${id}`, data: { ...log, createdAt: Date.now() }, merge: false },
        { type: 'set', path: `${P.books}/${bookId}`, data: stamp(bookPatch) },
      ]);
      return { id, done };
    },
    deleteLog: id => db.remove(`${P.logs}/${id}`),

    addQuote(data) {
      const id = db.newId(P.quotes);
      return db.set(`${P.quotes}/${id}`, { ...data, createdAt: Date.now() }, false);
    },
    deleteQuote: id => db.remove(`${P.quotes}/${id}`),

    removeCollection(name, bookIds, collections) {
      return db.commit([
        ...bookIds.map(id => ({ type: 'set', path: `${P.books}/${id}`, data: stamp({ collection: '' }) })),
        { type: 'set', path: P.profile, data: stamp({ collections }) },
      ]);
    },
  };
}
