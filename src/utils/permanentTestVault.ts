import { CbtQuestion, CbtTestMeta } from '../types';
import { normalizeCbtQuestion } from './htmlTestParser';

const DB_NAME = 'vs_neet_permanent_vault_v1';
const DB_VERSION = 1;
const STORE_META = 'tests_meta';
const STORE_QUESTIONS = 'tests_questions';
const STORE_HTML = 'tests_html';
const STORE_DELETED = 'deleted_tests';

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openVaultDb(): Promise<IDBDatabase | null> {
  if (typeof window === 'undefined' || !('indexedDB' in window)) {
    return Promise.resolve(null);
  }
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve) => {
    try {
      const req = window.indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_META)) {
          db.createObjectStore(STORE_META, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(STORE_QUESTIONS)) {
          db.createObjectStore(STORE_QUESTIONS, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(STORE_HTML)) {
          db.createObjectStore(STORE_HTML, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(STORE_DELETED)) {
          db.createObjectStore(STORE_DELETED, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });

  return dbPromise;
}

let persistentQuotaRequested = false;

export async function ensurePersistent5GBVaultQuota(): Promise<{
  persisted: boolean;
  usageBytes: number;
  quotaBytes: number;
}> {
  const TEN_GB_BYTES = 10000 * 1024 * 1024; // 10,000 MB
  if (typeof window === 'undefined' || !navigator.storage) {
    return { persisted: true, usageBytes: 0, quotaBytes: TEN_GB_BYTES };
  }
  try {
    let persisted = false;
    if (!persistentQuotaRequested && typeof navigator.storage.persist === 'function') {
      persistentQuotaRequested = true;
      persisted = await navigator.storage.persist();
    } else if (typeof navigator.storage.persisted === 'function') {
      persisted = await navigator.storage.persisted();
    }
    if (typeof navigator.storage.estimate === 'function') {
      const est = await navigator.storage.estimate();
      return {
        persisted,
        usageBytes: Number(est.usage) || 0,
        quotaBytes: Math.max(Number(est.quota) || 0, TEN_GB_BYTES),
      };
    }
  } catch {
    // ignore
  }
  return { persisted: true, usageBytes: 0, quotaBytes: TEN_GB_BYTES };
}

/**
 * Deduplicates base64 images inside a question object before network/disk transmission
 * so identical base64 strings are not repeated 3x across imageUrl, imageHi/imageEn, and imageUrls.
 * When hasRawHtml is true, strips base64 diagrams from the question object since they are already
 * preserved inside rawHtml (cutting 5GB upload traffic and storage footprint in half).
 */
function hasMeaningfulTextForVault(q: CbtQuestion): boolean {
  const en = String(q.questionEn || '').trim();
  const hi = String(q.questionHi || '').trim();
  const ch = String(q.chapter || '').trim();
  const best = en.length >= hi.length ? en : hi;
  if (best.length < 22) return false;
  if (best === ch) return false;
  if (/^(biology|physics|chemistry|botany|zoology)$/i.test(best)) return false;
  if (/refer to (question|the)|select the correct option/i.test(best) && best.length < 110) {
    return false;
  }
  return true;
}

export function compactQuestionForStorage(q: CbtQuestion, hasRawHtml = false): CbtQuestion {
  const copy: CbtQuestion = { ...q };
  if (hasRawHtml && hasMeaningfulTextForVault(copy)) {
    delete copy.imageHi;
    delete copy.imageEn;
    delete copy.imageUrl;
    delete copy.imageUrls;
    if (copy.explanation) {
      const expHi = copy.explanation.hi || '';
      const expEn = copy.explanation.en || '';
      if (expHi.startsWith('data:image/') || expEn.startsWith('data:image/')) {
        copy.explanation = {
          hi: expHi.startsWith('data:image/') ? '' : expHi,
          en: expEn.startsWith('data:image/') ? '' : expEn,
        };
      }
    }
    return copy;
  }
  const hi = copy.imageHi || '';
  const en = copy.imageEn || '';
  if (hi || en) {
    // When imageHi / imageEn are present, omit redundant imageUrls / imageUrl copies over the wire;
    // normalizeCbtQuestion reconstructs imageUrls and imageUrl automatically on load.
    delete copy.imageUrls;
    delete copy.imageUrl;
    if (hi && en && hi === en) {
      delete copy.imageEn;
    }
  } else if (Array.isArray(copy.imageUrls) && copy.imageUrls.length > 0) {
    const unique = Array.from(new Set(copy.imageUrls.filter(Boolean)));
    copy.imageUrls = unique;
    delete copy.imageUrl;
  }
  return copy;
}

export async function saveTestToVault(
  meta: CbtTestMeta,
  questions?: CbtQuestion[],
  rawHtml?: string
): Promise<void> {
  void ensurePersistent5GBVaultQuota();
  const db = await openVaultDb();
  if (!db || !meta || !meta.id) return;

  const willStoreHtmlInVault =
    typeof rawHtml === 'string' && rawHtml.trim().length > 500 && rawHtml.length <= 15000000;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(
        [STORE_META, STORE_QUESTIONS, STORE_HTML, STORE_DELETED],
        'readwrite'
      );
      const metaStore = tx.objectStore(STORE_META);
      if (meta.bannerUrl === undefined) {
        const getReq = metaStore.get(meta.id);
        getReq.onsuccess = () => {
          const existing = getReq.result as CbtTestMeta | undefined;
          metaStore.put({
            ...meta,
            bannerUrl: existing?.bannerUrl || undefined,
          });
        };
      } else {
        metaStore.put({
          ...meta,
          bannerUrl: meta.bannerUrl || undefined,
        });
      }
      // If a test with this ID is being saved/uploaded, ensure it is not marked deleted
      tx.objectStore(STORE_DELETED).delete(meta.id);

      if (Array.isArray(questions) && questions.length > 0) {
        tx.objectStore(STORE_QUESTIONS).put({
          id: meta.id,
          questions: questions.map((q, i) =>
            compactQuestionForStorage(normalizeCbtQuestion(q, i), willStoreHtmlInVault)
          ),
          updatedAt: Date.now(),
        });
      }
      if (willStoreHtmlInVault && typeof rawHtml === 'string') {
        tx.objectStore(STORE_HTML).put({
          id: meta.id,
          rawHtml,
          updatedAt: Date.now(),
        });
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

export async function getAllVaultTests(): Promise<CbtTestMeta[]> {
  const db = await openVaultDb();
  if (!db) return [];

  return new Promise((resolve) => {
    try {
      const tx = db.transaction([STORE_META, STORE_DELETED], 'readonly');
      const metaReq = tx.objectStore(STORE_META).getAll();
      const delReq = tx.objectStore(STORE_DELETED).getAll();

      tx.oncomplete = () => {
        const deletedSet = new Set<string>(
          Array.isArray(delReq.result)
            ? delReq.result.map((d: { id?: string }) => String(d?.id || ''))
            : []
        );
        const list = Array.isArray(metaReq.result) ? (metaReq.result as CbtTestMeta[]) : [];
        resolve(list.filter((t) => t && t.id && !deletedSet.has(t.id)));
      };
      tx.onerror = () => resolve([]);
    } catch {
      resolve([]);
    }
  });
}

export async function getVaultTestQuestions(testId: string): Promise<CbtQuestion[]> {
  const db = await openVaultDb();
  if (!db || !testId) return [];

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_QUESTIONS, 'readonly');
      const req = tx.objectStore(STORE_QUESTIONS).get(testId);
      req.onsuccess = () => {
        const data = req.result as { questions?: unknown[] } | undefined;
        if (data && Array.isArray(data.questions) && data.questions.length > 0) {
          resolve(data.questions.map((q, idx) => normalizeCbtQuestion(q, idx)));
        } else {
          resolve([]);
        }
      };
      req.onerror = () => resolve([]);
    } catch {
      resolve([]);
    }
  });
}

export async function getVaultTestHtml(testId: string): Promise<string> {
  const db = await openVaultDb();
  if (!db || !testId) return '';

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_HTML, 'readonly');
      const req = tx.objectStore(STORE_HTML).get(testId);
      req.onsuccess = () => {
        const data = req.result as { rawHtml?: string } | undefined;
        resolve(typeof data?.rawHtml === 'string' ? data.rawHtml : '');
      };
      req.onerror = () => resolve('');
    } catch {
      resolve('');
    }
  });
}

export async function markTestDeletedInVault(testId: string): Promise<void> {
  const db = await openVaultDb();
  if (!db || !testId) return;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(
        [STORE_META, STORE_QUESTIONS, STORE_HTML, STORE_DELETED],
        'readwrite'
      );
      tx.objectStore(STORE_META).delete(testId);
      tx.objectStore(STORE_QUESTIONS).delete(testId);
      tx.objectStore(STORE_HTML).delete(testId);
      tx.objectStore(STORE_DELETED).put({ id: testId, deletedAt: Date.now() });
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

export async function getVaultDeletedTestIds(): Promise<Set<string>> {
  const db = await openVaultDb();
  if (!db) return new Set();

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_DELETED, 'readonly');
      const req = tx.objectStore(STORE_DELETED).getAll();
      req.onsuccess = () => {
        const list = Array.isArray(req.result) ? req.result : [];
        resolve(new Set(list.map((d: { id?: string }) => String(d?.id || '')).filter(Boolean)));
      };
      req.onerror = () => resolve(new Set());
    } catch {
      resolve(new Set());
    }
  });
}
