// 雲端存檔：Firebase 的 Google 登入 + Firestore（lite 版，只有讀寫一份文件，沒有即時同步，檔案小）
//
//   const cloud = createCloud(config, { emulator })
//   cloud.ready            Promise：SDK 載好、登入狀態也恢復了（重新整理後不用再登入）
//   cloud.isReady          SDK 載好了沒（登入要在點擊的當下馬上開視窗，SDK 沒好就先不要按）
//   cloud.onUser(cb)       登入 / 登出 / 恢復登入時呼叫 cb(user | null)，user = { uid, name, email, photo }
//   cloud.signIn()         Google 登入（彈出視窗；要在點擊事件裡直接呼叫，不然會被瀏覽器擋）
//   cloud.signOut()
//   cloud.load()           讀自己的存檔 → 物件或 null（還沒存過）
//   cloud.save(data, uid)  寫自己的存檔（整份覆蓋）；目前登入的不是 uid 就不寫
//
// SDK 從 Google 的 CDN 載（只有設定了雲端存檔才會載，約 110 KB gzip），不會拖慢遊戲開始。
// 存檔在 Firestore 的 saves/{uid}；規則只讓本人讀寫（firestore.rules）。

const V = '13.2.0';
const CDN = `https://www.gstatic.com/firebasejs/${V}/`;

export function createCloud(config, { emulator = false } = {}) {
  let A = null, F = null, auth = null, db = null, user = null, isReady = false;
  const subs = new Set();
  const toUser = u => (u ? { uid: u.uid, name: u.displayName || (u.email ? u.email.split('@')[0] : '玩家'), email: u.email || '', photo: u.photoURL || '' } : null);

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
