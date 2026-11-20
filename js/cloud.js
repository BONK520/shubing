// 雲端存檔：Firebase 的 Google 登入 + Firestore（lite 版，只有讀寫一份文件，沒有即時同步，檔案小）
//
//   const cloud = createCloud(config, { emulator })
//   cloud.ready            Promise：SDK 載好、登入狀態也恢復了（重新整理後不用再登入）
//   cloud.isReady          SDK 載好了沒（登入要在點擊的當下馬上開視窗，SDK 沒好就先不要按）
//   cloud.onUser(cb)       登入 / 登出 / 恢復登入時呼叫 cb(user | null)，user = { uid, name, email, photo }
//   cloud.signIn()         Google 登入（彈出視窗；要在點擊事件裡直接呼叫，不然會被瀏覽器擋）
//   cloud.signInWithName(name, password)   帳號名稱＋密碼登入（不用 email；LINE 裡也能用）
//   cloud.signUpWithName(name, password)   開新帳號（名字已經有人用 → auth/email-already-in-use）
//   cloud.signOut()
//   cloud.load()           讀自己的存檔 → 物件或 null（還沒存過）
//   cloud.save(data, uid)  寫自己的存檔（整份覆蓋）；目前登入的不是 uid 就不寫
//
// SDK 從 Google 的 CDN 載（只有設定了雲端存檔才會載，約 110 KB gzip），不會拖慢遊戲開始。
// 存檔在 Firestore 的 saves/{uid}；規則只讓本人讀寫（firestore.rules）。

const V = '13.2.0';
const CDN = `https://www.gstatic.com/firebasejs/${V}/`;

// ---------- 帳號名稱 ↔ Firebase 的「email」 ----------
// Firebase 的帳號密碼登入一定要 email，玩家只取名字：名字換成一個不會真的收信的地址（這個網域沒有信箱，Firebase 也不會寄信）。
//   英數字的名字直接放：alice → alice@players.plush-crush.firebaseapp.com（在 Firebase 後台一眼看得出是誰）
//   其他文字（中文…）轉成 base32：小明 → u.4wyi7z4ymo@players…（「.」不會出現在名字裡，所以分得開）
// 這個網域一改，所有用名字開的帳號都登不進去，所以不要改。
const NAME_DOMAIN = 'players.plush-crush.firebaseapp.com';
const B32 = 'abcdefghijklmnopqrstuvwxyz234567';
// 名字：2–12 個字，字母（任何語言）、數字、_、-，第一個字要是字母或數字；英文不分大小寫
export function normName(raw) {
  const s = String(raw || '').normalize('NFKC').trim().toLowerCase();
  const n = Array.from(s).length;
  if (n < 2) return { error: '名字至少要 2 個字' };
  if (n > 12) return { error: '名字最多 12 個字' };
  if (!/^[\p{L}\p{N}][\p{L}\p{N}_-]*$/u.test(s)) return { error: '名字只能用文字、數字、_ 和 -' };
  let local;
  if (/^[a-z0-9_-]+$/.test(s)) local = s;
  else {
    let bits = 0, val = 0;
    local = 'u.';
    for (const b of new TextEncoder().encode(s)) {
      val = (val << 8) | b; bits += 8;
      while (bits >= 5) { local += B32[(val >>> (bits - 5)) & 31]; bits -= 5; }
    }
    if (bits) local += B32[(val << (5 - bits)) & 31];
  }
  if (local.length > 64) return { error: '名字太長了' };
  return { name: s, email: `${local}@${NAME_DOMAIN}` };
}
export function nameFromEmail(email) {
  const [local, domain] = String(email || '').split('@');
  if (domain !== NAME_DOMAIN) return null;
  if (!local.startsWith('u.')) return local;
  const bytes = [];
  let bits = 0, val = 0;
  for (const ch of local.slice(2)) {
    val = (val << 5) | B32.indexOf(ch); bits += 5;
    if (bits >= 8) { bytes.push((val >>> (bits - 8)) & 255); bits -= 8; }
  }
  try { return new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(bytes)); } catch (e) { return null; }
}

export function createCloud(config, { emulator = false } = {}) {
  let A = null, F = null, auth = null, db = null, user = null, isReady = false;
  const subs = new Set();
  // 名字：用帳號名稱開的 → 那個名字；Google → Google 上的名字；都沒有 → email 的前半
  const toUser = u => {
    if (!u) return null;
    const own = nameFromEmail(u.email);
    return { uid: u.uid, name: own || u.displayName || (u.email ? u.email.split('@')[0] : '玩家'), email: own ? '' : (u.email || ''), photo: own ? '' : (u.photoURL || ''), kind: own ? 'name' : 'google' };
  };

  const ready = (async () => {
    const [appMod, authMod, fsMod] = await Promise.all([
      import(CDN + 'firebase-app.js'), import(CDN + 'firebase-auth.js'), import(CDN + 'firebase-firestore-lite.js'),
    ]);
    A = authMod; F = fsMod;
    const app = appMod.initializeApp(config);
    // 登入狀態記在 IndexedDB（不行就 localStorage）；彈出視窗登入
    auth = A.initializeAuth(app, {
      persistence: [A.indexedDBLocalPersistence, A.browserLocalPersistence],
      popupRedirectResolver: A.browserPopupRedirectResolver,
    });
    db = F.getFirestore(app);
    if (emulator) {
      A.connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
      F.connectFirestoreEmulator(db, '127.0.0.1', 8085);
    }
    // 第一次回報 = 重新整理後恢復的登入狀態
    await new Promise(res => {
      let first = true;
      A.onAuthStateChanged(auth, u => {
        user = toUser(u);
        for (const cb of subs) { try { cb(user); } catch (e) { console.error('[cloud]', e); } }
        if (first) { first = false; res(); }
      });
    });
    isReady = true;
  })();
  ready.catch(e => console.warn('[cloud] 雲端存檔載入失敗（照樣可以玩，存在這台裝置）', e));

  const ref = () => {
    if (!user) throw new Error('not signed in');
    return F.doc(db, 'saves', user.uid);
  };

  return {
    ready,
    checkName: normName,        // 名字合不合格（送出前先在畫面上提醒）
    get isReady() { return isReady; },
    get user() { return user; },
    onUser(cb) { subs.add(cb); if (isReady) cb(user); return () => subs.delete(cb); },
    // 不能先 await 任何東西：彈出視窗一定要在點擊的同一個事件裡打開
    signIn() {
      if (!isReady) return Promise.reject(Object.assign(new Error('cloud not ready'), { code: 'cloud/not-ready' }));
      // 只有測試（連本機模擬器）時：測試腳本先設 window.__emuGoogleUser = { sub, email, name }，
      // 就直接把這個假的 Google 身分交給模擬器登入（模擬器接受假的 id token），不用開彈出視窗
      if (emulator && typeof window !== 'undefined' && window.__emuGoogleUser) {
        const cred = A.GoogleAuthProvider.credential(JSON.stringify({ email_verified: true, ...window.__emuGoogleUser }));
        return A.signInWithCredential(auth, cred).then(r => toUser(r.user));
      }
      const p = new A.GoogleAuthProvider();
      p.setCustomParameters({ prompt: 'select_account' });     // 同一台裝置換人玩：每次都讓他選帳號
      return A.signInWithPopup(auth, p).then(r => toUser(r.user));
    },
    signInWithName(name, password) {
      if (!isReady) return Promise.reject(Object.assign(new Error('cloud not ready'), { code: 'cloud/not-ready' }));
      const n = normName(name);
      if (n.error) return Promise.reject(Object.assign(new Error(n.error), { code: 'cloud/bad-name', hint: n.error }));
      return A.signInWithEmailAndPassword(auth, n.email, String(password || '')).then(r => toUser(r.user));
    },
    signUpWithName(name, password) {
      if (!isReady) return Promise.reject(Object.assign(new Error('cloud not ready'), { code: 'cloud/not-ready' }));
      const n = normName(name);
      if (n.error) return Promise.reject(Object.assign(new Error(n.error), { code: 'cloud/bad-name', hint: n.error }));
      return A.createUserWithEmailAndPassword(auth, n.email, String(password || '')).then(r => toUser(r.user));
    },
    signOut() { return isReady ? A.signOut(auth) : Promise.resolve(); },
    async load() {
      await ready;
      const s = await F.getDoc(ref());
      return s.exists() ? s.data() : null;
    },
    // uid：呼叫的人以為現在是誰。登入狀態剛換人、上一個人的存檔還排著要寫的時候，不會寫到下一個人的雲端存檔裡
    async save(data, uid) {
      await ready;
      if (uid && (!user || user.uid !== uid)) throw Object.assign(new Error('account changed'), { code: 'cloud/account-changed' });
      await F.setDoc(ref(), data);
    },
  };
}
