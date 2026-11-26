// 雲端存檔：Firebase 的帳號名稱＋密碼登入 + Firestore（lite 版，只有讀寫一份文件，沒有即時同步，檔案小）
//
//   const cloud = createCloud(config, { emulator })
//   cloud.ready            Promise：SDK 載好、登入狀態也恢復了（重新整理後不用再登入）
//   cloud.isReady          SDK 載好了沒（還沒好就先不要按登入）
//   cloud.onUser(cb)       登入 / 登出 / 恢復登入時呼叫 cb(user | null)，user = { uid, name }
//   cloud.signInWithName(name, password)   帳號名稱＋密碼登入（不用 email；LINE 裡也能用）
//   cloud.signUpWithName(name, password)   開新帳號（名字已經有人用 → auth/email-already-in-use）
//   cloud.signOut()
//   cloud.load()           讀自己的存檔 → 物件或 null（還沒存過）
//   cloud.save(data, uid)  寫自己的存檔（整份覆蓋）；目前登入的不是 uid 就不寫
//   好友排行榜（players/{uid}，登入的人都能讀、只有本人能寫；存檔 saves 還是只有本人看得到）：
//   cloud.friendCode(uid)  這個帳號的好友碼（6 個字，從 uid 算出來，不會變）
//   cloud.player(uid)      讀一個人的公開資料 → { uid, code, name, stars, best, friends } 或 null
//   cloud.publish(data, uid, addUid)  寫自己的公開資料（只改給的欄位）；addUid：順便加進自己的好友名單
//   cloud.findCode(code)   用好友碼找人 → 清單
//   cloud.addedMe()        把我加成好友的人 → 清單（對方加了我，我這邊也看得到對方）
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

// 好友碼：uid 算出來的 6 個字，去掉容易看錯的 I、O、0、1（firestore.rules 也照這個格式檢查）
const CODE_ABC = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const CODE_RE = /^[A-HJ-NP-Z2-9]{6}$/;
export function friendCode(uid) {
  let h = 0x811c9dc5;
  for (const ch of String(uid)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
  let s = '';
  for (let i = 0; i < 6; i++) { s += CODE_ABC[h & 31]; h >>>= 5; }
  return s;
}

// ---------- 跟薯餅小窩共用的錢包（2026-11-26，docs/WALLET.md） ----------
// wallets/{uid} = { coins：兩個遊戲共用的幣（1 比 1）, egg：{e, p} 蛋蛋島已經算進錢包的造型幣（e 賺到的總數、p 兌換掉的總數，只會變多）,
//                   nest：{小窩的 uid: 1} 哪些小窩帳號已經把原本的幣放進來過, t }
// 蛋蛋島的造型幣照舊用「三星＋寶箱 − 兌換掉的」算；跟錢包記的 e、p 比，多出來的部分（新拿的三星、新兌換的）加減進 coins。
// e、p 只看比錢包記的多的部分：舊裝置的存檔比較少，也不會把錢包扣回去。小窩那邊的寫法在小窩 repo 的 js/wallet.js
const WALLET_MAX = 10000000;
export function normWallet(d) {
  const n = (x) => (Number.isInteger(x) ? Math.max(0, Math.min(WALLET_MAX, x)) : 0);
  const w = d && typeof d === 'object' ? d : {};
  const egg = w.egg && typeof w.egg === 'object' ? w.egg : {};
  const nest = {};
  if (w.nest && typeof w.nest === 'object') Object.keys(w.nest).slice(0, 20).forEach(k => { nest[k] = 1; });
  return { coins: n(w.coins), egg: { e: n(egg.e), p: n(egg.p) }, nest, t: Number.isInteger(w.t) ? w.t : 0 };
}
export function eggStep(w, earned, spent) {
  const de = Math.max(0, earned - w.egg.e), dp = Math.max(0, spent - w.egg.p);
  return { ...w, coins: Math.max(0, Math.min(WALLET_MAX, w.coins + de - dp)), egg: { e: Math.max(earned, w.egg.e), p: Math.max(spent, w.egg.p) } };
}

export function createCloud(config, { emulator = false } = {}) {
  let A = null, F = null, auth = null, db = null, user = null, isReady = false;
  const subs = new Set();
  // 名字：用帳號名稱開的 → 那個名字；認不出來（不是遊戲裡開的帳號）→ email 的前半
  const toUser = u => {
    if (!u) return null;
    return { uid: u.uid, name: nameFromEmail(u.email) || (u.email ? u.email.split('@')[0] : '玩家') };
  };

  const ready = (async () => {
    const [appMod, authMod, fsMod] = await Promise.all([
      import(CDN + 'firebase-app.js'), import(CDN + 'firebase-auth.js'), import(CDN + 'firebase-firestore-lite.js'),
    ]);
    A = authMod; F = fsMod;
    const app = appMod.initializeApp(config);
    // 登入狀態記在 IndexedDB（不行就 localStorage）
    auth = A.initializeAuth(app, {
      persistence: [A.indexedDBLocalPersistence, A.browserLocalPersistence],
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
    // ---------- 跟薯餅小窩共用的錢包（規則發布前會被擋 permission-denied，main.js 接住，造型幣照舊自己算） ----------
    // earned / spent：這台算出來的造型幣賺到的總數、兌換掉的總數（衣櫃的 coinsEarned / coinsSpent）。回傳寫好的錢包
    async walletEgg(earned, spent, uid) {
      await ready;
      if (!user || (uid && user.uid !== uid)) throw Object.assign(new Error('account changed'), { code: 'cloud/account-changed' });
      const ref = F.doc(db, 'wallets', user.uid);
      return F.runTransaction(db, async tx => {
        const s = await tx.get(ref);
        const w = { ...eggStep(normWallet(s.exists() ? s.data() : null), earned | 0, spent | 0), t: Date.now() };
        tx.set(ref, w);
        return w;
      });
    },
    // ---------- 好友排行榜 ----------
    friendCode,
    async player(uid) {
      await ready;
      const s = await F.getDoc(F.doc(db, 'players', uid));
      return s.exists() ? { ...s.data(), uid } : null;
    },
    async publish(data, uid, addUid) {
      await ready;
      if (!user || (uid && user.uid !== uid)) throw Object.assign(new Error('account changed'), { code: 'cloud/account-changed' });
      const ref = F.doc(db, 'players', user.uid);
      // 平常：只換給的欄位（best 整個換掉，不會留下已經沒有的關卡），friends 不動。
      // 加好友：merge＋arrayUnion（mergeFields 跟 arrayUnion 一起用會先把整個 friends 清空，所以分開寫）
      if (addUid) await F.setDoc(ref, { ...data, friends: F.arrayUnion(addUid) }, { merge: true });
      else await F.setDoc(ref, { ...data }, { mergeFields: Object.keys(data) });
    },
    async findCode(code) {
      await ready;
      const r = await F.getDocs(F.query(F.collection(db, 'players'), F.where('code', '==', code), F.limit(5)));
      return r.docs.map(d => ({ ...d.data(), uid: d.id }));
    },
    async addedMe() {
      await ready;
      if (!user) return [];
      const r = await F.getDocs(F.query(F.collection(db, 'players'), F.where('friends', 'array-contains', user.uid), F.limit(50)));
      return r.docs.map(d => ({ ...d.data(), uid: d.id }));
    },
  };
}
