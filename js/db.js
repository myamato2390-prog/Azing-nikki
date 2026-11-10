// IndexedDB の薄いラッパー
// テスト版（/preview/）は別の保存場所を使い、本番の記録には触れない
export const IS_TEST = typeof location !== 'undefined' && location.pathname.includes('/preview/');
const DB_NAME = IS_TEST ? 'aji-nikki-test' : 'aji-nikki';
const VERSION = 1;
let dbp;

function open() {
  if (!dbp) {
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const s of ['trips', 'presets', 'kv']) {
          if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbp;
}

async function run(store, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const req = fn(tx.objectStore(store));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export const getAll = (store) => run(store, 'readonly', (s) => s.getAll());
export const get = (store, id) => run(store, 'readonly', (s) => s.get(id));
export const put = (store, obj) => run(store, 'readwrite', (s) => s.put(obj));
export const del = (store, id) => run(store, 'readwrite', (s) => s.delete(id));
export const putMany = (store, list) => run(store, 'readwrite', (s) => { list.forEach((o) => s.put(o)); });

export async function getKV(key, fallback) {
  const r = await get('kv', key);
  return r ? r.value : fallback;
}
export const setKV = (key, value) => put('kv', { id: key, value });

export async function requestPersist() {
  try {
    if (navigator.storage?.persist && !(await navigator.storage.persisted())) await navigator.storage.persist();
    return await navigator.storage?.persisted?.();
  } catch { return false; }
}
