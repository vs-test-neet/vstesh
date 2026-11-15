import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { onAuthStateChanged } from '@firebase/auth';
import {
  GraduationCap,
  Lock,
  Unlock,
  Search,
  Play,
  Clock,
  FileText,
  Award,
  CheckCircle2,
  AlertCircle,
  LogIn,
  LogOut,
  Eye,
  BookOpen,
  X,
  Loader2,
  UserPlus,
  TrendingUp,
  KeyRound,
  Flame,
  BarChart3,
  CalendarClock,
  Camera,
  Folder,
  FolderOpen,
  ChevronRight,
  ShieldCheck,
  Settings,
  Lightbulb,
  HelpCircle,
  Download,
  Sun,
  Moon,
  Bell,
  Trash2,
  Bookmark,
  Pin,
} from 'lucide-react';
import {
  auth,
  ADMIN_USERNAME,
  ADMIN_SECRET_PASS,
  signInWithGoogle,
  signOutUser,
  saveTestToFirestore,
  loadTestBundleFromFirestore,
  loadTestQuestionsFromFirestore,
  loadTestHtmlFromFirestore,
  deleteTestFromFirestore,
  saveFolderToFirestore,
  deleteFolderFromFirestore,
  incrementTestEngagement,
  recordTestCompletion,
  deleteAttemptFromFirestore,
  saveStudentToFirestore,
  updateStudentPresenceInFirestore,
  fetchPortalBootstrap,
  savePortalLogoToFirestore,
  reconcilePermanentTestsWithServer,
  sendNotificationToFirestore,
  deleteNotificationFromFirestore,
  deleteStudentFromFirestore,
  saveAdminStudentTickToFirestore,
  markTestDeletedLocally,
  isBatchUploadActive,
  saveTestsMetaToLocalStorageSafe,
  saveFoldersToLocalStorageSafe,
} from './firebase';
import {
  CbtQuestion,
  CbtTestMeta,
  GlobalAttachmentPdf,
  MistakeNotebookItem,
  PortalNotification,
  StudentAccount,
  TestAttempt,
  TestDifficulty,
  TestFolder,
  UnfinishedTestSummary,
  WeakLinkRescuePlan,
} from './types';
import {
  DEFAULT_SEED_TESTS,
  DEFAULT_SEED_FOLDERS,
  BUILT_IN_COMPANION_QUESTIONS,
  loadBuiltInPrayas06Html,
  loadBuiltInPrayas06Questions,
  normalizeCbtQuestion,
  generateFallbackQuestionsForTest,
  parseCbtHtmlFile,
} from './utils/htmlTestParser';
import { CbtExamRunner } from './components/CbtExamRunner';
import { MyStudioAdmin } from './components/MyStudioAdmin';
import { PWAInstallButton } from './components/PWAInstallButton';

const NormalPdfViewerModal = React.lazy(() =>
  import('./components/NormalPdfViewerModal').then((m) => ({
    default: m.NormalPdfViewerModal,
  }))
);

type StudentPortalTab = 'tests' | 'dashboard' | 'mistakes';
type HomeBrowserStep = 'root' | 'folders' | 'folder_tests';

const DEFAULT_PORTAL_LOGO =
  '/assets/aistudio/Screenshot_2026-11-11-14-19-47-09_40deb401b9ffe8e1df2f1cc5ba480b12_d6e28b87.jpg';
const LEGACY_PORTAL_LOGO = '/assets/aistudio/a__Test_beyond_limit___8157004c.webp';

function getLocalDateKey(ts = Date.now()): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Target Timestamp for NEET (UG) 2027 Countdown
const NEET_2027_TARGET_MS = new Date('2027-05-02T14:00:00+05:30').getTime();

const SECURITY_QUESTIONS_LIST = [
  'आपका पसंदीदा विषय या टीचर का नाम क्या है? (Favorite Subject or Teacher)',
  'आपके बचपन का निकनेम या बेस्ट फ्रेंड का नाम? (Childhood Nickname / Best Friend)',
  'आपका ड्रीम मेडिकल कॉलेज कौन सा है? (Dream Medical College - e.g. AIIMS)',
  'आपके जन्म के शहर या स्कूल का नाम? (Birth City or School Name)',
];

/**
 * Security helper: Strips any script/XSS injection payloads from user text inputs
 */
function sanitizeInput(val: string, maxLen = 140): string {
  return val
    .replace(/<\s*script[^>]*>[\s\S]*?<\s*\/\s*script\s*>/gi, '')
    .replace(/javascript:/gi, '')
    .replace(/[<>]/g, '')
    .trim()
    .slice(0, maxLen);
}

/**
 * Format remaining milliseconds into a readable countdown string (e.g. "2d 04h 15m" or "01h 12m 08s")
 */
function formatScheduleCountdown(targetMs: number, currentMs: number): string {
  const diff = Math.max(0, targetMs - currentMs);
  const totalSeconds = Math.floor(diff / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (days > 0) {
    return `${days}d ${String(hours).padStart(2, '0')}h ${String(minutes).padStart(2, '0')}m`;
  }
  return `${String(hours).padStart(2, '0')}h ${String(minutes).padStart(2, '0')}m ${String(seconds).padStart(2, '0')}s`;
}

/**
 * Isolated Scheduled Test Countdown Badge so ticking seconds never re-render the parent App tree
 */
const ScheduledCountdownSpan = React.memo(function ScheduledCountdownSpan({
  targetMs,
}: {
  targetMs: number;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  return <>{formatScheduleCountdown(targetMs, now)}</>;
});

/**
 * Trigger a native OS / Mobile Phone Notification via Service Worker or Notification API
 */
async function triggerNativePhoneNotification(notif: PortalNotification): Promise<void> {
  if (typeof window === 'undefined' || !('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;

  const title = notif.title || 'Vs Test Alert';
  const options: NotificationOptions & { vibrate?: number[] } = {
    body: notif.message,
    icon: '/assets/aistudio/Screenshot_2026-11-11-14-19-47-09_40deb401b9ffe8e1df2f1cc5ba480b12_d6e28b87.jpg',
    badge: '/assets/aistudio/Screenshot_2026-11-11-14-19-47-09_40deb401b9ffe8e1df2f1cc5ba480b12_d6e28b87.jpg',
    tag: notif.id || `vstest_${notif.createdAt}`,
    vibrate: [200, 100, 200],
    data: {
      url: '/',
      testId: notif.testId || '',
    },
  };

  try {
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg && typeof reg.showNotification === 'function') {
        await reg.showNotification(title, options);
        return;
      }
    }
  } catch {
    // fallback to standard Notification constructor
  }

  try {
    new Notification(title, options);
  } catch {
    // ignore if blocked on mobile without SW
  }
}

/**
 * Compress & crop uploaded student profile photo to a fast, safe 180x180 JPEG data URI (<40KB)
 */
function compressProfileImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const SIZE = 180;
        canvas.width = SIZE;
        canvas.height = SIZE;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Canvas context unavailable'));
          return;
        }
        const minSide = Math.min(img.width, img.height);
        const sx = (img.width - minSide) / 2;
        const sy = (img.height - minSide) / 2;
        ctx.drawImage(img, sx, sy, minSide, minSide, 0, 0, SIZE, SIZE);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
        resolve(dataUrl);
      };
      img.onerror = () => reject(new Error('Invalid image file'));
      img.src = String(reader.result);
    };
    reader.onerror = () => reject(new Error('Failed to read image file'));
    reader.readAsDataURL(file);
  });
}

/**
 * Crash-Proof Error Boundary around the Exam Runner so no unexpected error ever crashes a student's test
 */
class ExamSafeErrorBoundary extends React.Component<
  { onExit: () => void; children: React.ReactNode },
  { hasError: boolean }
> {
  constructor(props: { onExit: () => void; children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-[#090d16] p-6">
          <div className="max-w-md w-full bg-slate-900 rounded-2xl border border-slate-800 p-6 shadow-xl text-center space-y-4">
            <h2 className="text-lg font-bold text-white">
              टेस्ट पेज रीलोड हो रहा है (Recovering Test Session)
            </h2>
            <p className="text-sm text-slate-400">
              आपकी टेस्ट प्रोग्रेस सुरक्षित है। नीचे दिए गए बटन पर क्लिक करके टेस्ट जारी रखें।
            </p>
            <div className="flex items-center justify-center gap-3">
              <button
                type="button"
                onClick={() => this.setState({ hasError: false })}
                className="px-5 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-bold"
              >
                Resume Test
              </button>
              <button
                type="button"
                onClick={this.props.onExit}
                className="px-4 py-2.5 rounded-xl bg-slate-800 text-slate-200 text-sm font-semibold"
              >
                Back to Home
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

class PdfModalErrorBoundary extends React.Component<
  { url: string; title: string; fileName?: string; onClose: () => void; children: React.ReactNode },
  { hasError: boolean }
> {
  constructor(props: {
    url: string;
    title: string;
    fileName?: string;
    onClose: () => void;
    children: React.ReactNode;
  }) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  render() {
    if (this.state.hasError) {
      const downloadUrl = this.props.url.includes('?')
        ? `${this.props.url}&download=1`
        : `${this.props.url}?download=1`;
      return (
        <div
          onClick={this.props.onClose}
          className="fixed inset-0 z-[80] bg-slate-950/92 flex flex-col"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="flex items-center justify-between gap-3 px-4 py-3 bg-slate-900 border-b border-slate-700 text-white"
          >
            <h3 className="text-sm font-extrabold truncate">{this.props.title}</h3>
            <div className="flex items-center gap-2 shrink-0">
              <a
                href={downloadUrl}
                download={this.props.fileName || this.props.title}
                className="px-3 py-1.5 rounded-xl bg-emerald-600 text-white text-xs font-extrabold"
              >
                Download PDF
              </a>
              <button
                type="button"
                onClick={this.props.onClose}
                className="px-3 py-1.5 rounded-xl bg-rose-600 text-white text-xs font-extrabold"
              >
                Close
              </button>
            </div>
          </div>
          <div onClick={(e) => e.stopPropagation()} className="flex-1 bg-slate-950 p-3">
            <iframe
              src={`${this.props.url}#toolbar=1&navpanes=0`}
              title={this.props.title}
              className="w-full h-full min-h-[75vh] border-0 rounded-xl bg-white"
            />
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

/**
 * Compact Adaptive Light / Dark Mode NEET 2027 Countdown
 * Features a Medium-Sized Animated Hexagonal Ring on the Side containing ONLY DAYS (no chemical formula or labels)
 */
const Neet2027Countdown = React.memo(function Neet2027Countdown({
  isDarkMode,
}: {
  isDarkMode: boolean;
}) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  const diff = Math.max(0, NEET_2027_TARGET_MS - now);
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff / (1000 * 60 * 60)) % 24);
  const minutes = Math.floor((diff / (1000 * 60)) % 60);
  const seconds = Math.floor((diff / 1000) % 60);

  // Alternate internal π-bond resonance positions every second
  const isResonanceStateB = seconds % 2 === 1;

  // Medium Hexagon inside viewBox="0 0 200 200" (Center: 100, 100, Radius: 82)
  const outerHexPoints = '100,18 171,59 171,141 100,182 29,141 29,59';

  const vertices = [
    { cx: 100, cy: 18 },
    { cx: 171, cy: 59 },
    { cx: 171, cy: 141 },
    { cx: 100, cy: 182 },
    { cx: 29, cy: 141 },
    { cx: 29, cy: 59 },
  ];

  // 3 alternating internal π-bonds in distinct glowing colors (State A)
  const piBondsStateA = [
    { x1: 105, y1: 32, x2: 158, y2: 63, color: '#f59e0b' }, // Amber-Gold
    { x1: 158, y1: 137, x2: 105, y2: 168, color: '#0ea5e9' }, // Sky-Cyan
    { x1: 41, y1: 132, x2: 41, y2: 68, color: '#f43f5e' }, // Crimson-Rose
  ];

  // 3 alternating internal π-bonds shifted (State B)
  const piBondsStateB = [
    { x1: 159, y1: 68, x2: 159, y2: 132, color: '#f59e0b' }, // Amber-Gold
    { x1: 95, y1: 168, x2: 42, y2: 137, color: '#0ea5e9' }, // Sky-Cyan
    { x1: 42, y1: 63, x2: 95, y2: 32, color: '#f43f5e' }, // Crimson-Rose
  ];

  const activePiBonds = isResonanceStateB ? piBondsStateB : piBondsStateA;

  return (
    <div className="neet-countdown-vault-ring w-full">
      <div className="neet-countdown-vault px-4 py-3.5 sm:px-6 sm:py-4">
        <div className="flex flex-row items-center justify-between gap-3 sm:gap-6">
          {/* Left Side: Exam Target Info + Compact Live Hours : Minutes : Seconds */}
          <div className="min-w-0 flex-1 space-y-2">
            <div className="inline-flex items-center gap-1.5 text-sm sm:text-base font-extrabold text-amber-600 dark:text-amber-400">
              <CalendarClock className="w-4 h-4 text-rose-500 shrink-0" />
              <span className="truncate">NEET (UG) 2027</span>
            </div>

            <h2 className="text-xl sm:text-2xl font-black text-black dark:text-white tracking-tight leading-snug">
              Exam Countdown
            </h2>

            {/* Compact Hrs : Min : Sec Row on the Left */}
            <div className="inline-flex items-center gap-2 sm:gap-3 pt-0.5">
              <div className="px-2.5 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-900/90 border border-slate-300 dark:border-slate-800 text-center min-w-[54px]">
                <div className="text-base sm:text-lg font-extrabold font-mono-tabular text-black dark:text-white leading-none">
                  {String(hours).padStart(2, '0')}
                </div>
                <div className="text-[10px] font-bold text-slate-700 dark:text-slate-400 uppercase mt-0.5">
                  Hrs
                </div>
              </div>

              <span className="text-black dark:text-white font-bold text-base">:</span>

              <div className="px-2.5 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-900/90 border border-slate-300 dark:border-slate-800 text-center min-w-[54px]">
                <div className="text-base sm:text-lg font-extrabold font-mono-tabular text-black dark:text-white leading-none">
                  {String(minutes).padStart(2, '0')}
                </div>
                <div className="text-[10px] font-bold text-slate-700 dark:text-slate-400 uppercase mt-0.5">
                  Min
                </div>
              </div>

              <span className="text-black dark:text-white font-bold text-base">:</span>

              <div className="px-2.5 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-900/90 border border-slate-300 dark:border-slate-800 text-center min-w-[54px]">
                <div className="text-base sm:text-lg font-extrabold font-mono-tabular text-black dark:text-white leading-none">
                  {String(seconds).padStart(2, '0')}
                </div>
                <div className="text-[10px] font-bold text-slate-700 dark:text-slate-400 uppercase mt-0.5">
                  Sec
                </div>
              </div>
            </div>
          </div>

          {/* Right Side: Medium-Sized Animated Benzene Ring Containing ONLY DAYS (No Formula, No Name) */}
          <div className="relative w-28 h-28 sm:w-32 sm:h-32 flex items-center justify-center shrink-0 select-none">
            <svg
              viewBox="0 0 200 200"
              className="w-full h-full overflow-visible select-none"
              aria-hidden="true"
            >
              {/* Soft Ambient Glow behind the Ring */}
              <circle
                cx="100"
                cy="100"
                r="76"
                fill={isDarkMode ? 'rgba(251, 191, 36, 0.09)' : 'rgba(251, 191, 36, 0.16)'}
              />

              {/* Animated Moving Hexagonal Ring Structure */}
              <g className="benzene-molecule-motion">
                {/* Rotating Inner Resonance Circle */}
                <g className="benzene-resonance-orbit">
                  <circle
                    cx="100"
                    cy="100"
                    r="54"
                    fill="none"
                    stroke="#f59e0b"
                    strokeWidth="1.5"
                    strokeDasharray="7 6"
                    opacity="0.55"
                  />
                </g>

                {/* Outer 6-Sided Hexagon */}
                <polygon
                  points={outerHexPoints}
                  fill={isDarkMode ? '#0b1120' : '#ffffff'}
                  stroke={isDarkMode ? '#475569' : '#0f172a'}
                  strokeWidth="4.5"
                  strokeLinejoin="round"
                />

                {/* 3 Alternating Colored Internal Pi Bonds */}
                {activePiBonds.map((bond, bIdx) => (
                  <g
                    key={`pi-${bIdx}`}
                    className="pi-bond-glow"
                    style={{ color: bond.color, transition: 'all 0.45s ease' }}
                  >
                    <line
                      x1={bond.x1}
                      y1={bond.y1}
                      x2={bond.x2}
                      y2={bond.y2}
                      stroke={bond.color}
                      strokeWidth="8"
                      strokeLinecap="round"
                      opacity="0.28"
                    />
                    <line
                      x1={bond.x1}
                      y1={bond.y1}
                      x2={bond.x2}
                      y2={bond.y2}
                      stroke={bond.color}
                      strokeWidth="4"
                      strokeLinecap="round"
                    />
                  </g>
                ))}

                {/* Clean Corner Nodes (No Letters or Formulas) */}
                {vertices.map((v, vIdx) => (
                  <circle
                    key={`v-${vIdx}`}
                    cx={v.cx}
                    cy={v.cy}
                    r="3.5"
                    fill={isDarkMode ? '#f8fafc' : '#0f172a'}
                    stroke="#38bdf8"
                    strokeWidth="1.5"
                  />
                ))}
              </g>
            </svg>

            {/* ONLY DAYS Inside the Benzene Ring */}
            <div className="absolute inset-0 flex flex-col items-center justify-center text-center pointer-events-none">
              <div className="text-2xl sm:text-3xl font-black font-mono-tabular text-black dark:text-white tracking-tight leading-none">
                {days}
              </div>
              <div className="text-[10px] font-extrabold uppercase tracking-widest text-amber-600 dark:text-amber-400 mt-1">
                DAYS
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
});

class GlobalPortalErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; errorMsg: string }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, errorMsg: '' };
  }

  static getDerivedStateFromError(error: unknown) {
    return {
      hasError: true,
      errorMsg: error instanceof Error ? error.message : 'Unexpected display error',
    };
  }

  componentDidCatch(error: unknown) {
    console.warn('GlobalPortalErrorBoundary caught error:', error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-slate-950 text-white flex flex-col items-center justify-center p-6 text-center space-y-4">
          <AlertCircle className="w-12 h-12 text-amber-400" />
          <h2 className="text-xl font-black">Vs Tests Portal Protected Recovery</h2>
          <p className="text-xs sm:text-sm text-slate-300 max-w-md">
            Your tests, scores, and folders are 100% safe. Tap below to resume immediately.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => {
                try {
                  sessionStorage.removeItem('vs_neet_active_test_session_v1');
                } catch {
                  // ignore
                }
                this.setState({ hasError: false, errorMsg: '' });
              }}
              className="px-5 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-xs sm:text-sm font-extrabold"
            >
              Resume Portal
            </button>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="px-5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs sm:text-sm font-extrabold border border-slate-700"
            >
              Reload Page
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function AppContent() {
  const [appMode, setAppMode] = useState<'student' | 'studio'>('student');
  const [studentTab, setStudentTab] = useState<StudentPortalTab>('tests');
  const [showQuickMenu, setShowQuickMenu] = useState(false);

  // Student Completed Test Filter & Manual Tick (✔) State ("Students jo test de chuke h unko trick/track krne ka option")
  const [studentCompletionFilter, setStudentCompletionFilter] = useState<
    'all' | 'completed' | 'pending'
  >('all');
  const [studentTickedTests, setStudentTickedTests] = useState<Record<string, boolean>>(() => {
    try {
      const raw = localStorage.getItem('vs_student_ticked_tests_v1');
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  });

  const toggleStudentTestTick = useCallback((testId: string) => {
    if (!testId) return;
    setStudentTickedTests((prev) => {
      const next = { ...prev, [testId]: !prev[testId] };
      if (!next[testId]) delete next[testId];
      try {
        localStorage.setItem('vs_student_ticked_tests_v1', JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  }, []);

  // Lightweight periodic check for scheduled test unlock transitions (every 15s instead of 1s so App never lags)
  const [nowTs, setNowTs] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (!activeRunningTestRef.current) {
        setNowTs(Date.now());
      }
    }, 15000);
    return () => window.clearInterval(timer);
  }, []);

  // Theme State: Default to Light Mode (false) when a student visits or logs in for the first time
  const [isDarkMode, setIsDarkMode] = useState<boolean>(() => {
    try {
      const savedTheme = localStorage.getItem('vs_test_theme_mode_v2');
      return savedTheme ? savedTheme === 'dark' : false;
    } catch {
      return false;
    }
  });

  useEffect(() => {
    const root = document.documentElement;
    if (isDarkMode) {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    try {
      localStorage.setItem('vs_test_theme_mode_v2', isDarkMode ? 'dark' : 'light');
    } catch {
      // ignore
    }
  }, [isDarkMode]);

  // Admin Credentials Lock State (Completely Hidden from Public UI — Opened ONLY by 4 Clicks on "Vs Test" near Logo)
  const [isAdminUnlocked, setIsAdminUnlocked] = useState(false);
  const [showAdminPassModal, setShowAdminPassModal] = useState(false);
  const [adminUsernameInput, setAdminUsernameInput] = useState('');
  const [adminPasswordInput, setAdminPasswordInput] = useState('');
  const [adminPassError, setAdminPassError] = useState('');
  const [adminFailedAttempts, setAdminFailedAttempts] = useState(0);
  const [adminLockoutUntil, setAdminLockoutUntil] = useState(0);

  // Anti-Bot & Anti-Hacker Security State
  const [botHoneypot, setBotHoneypot] = useState('');
  const [authFailedAttempts, setAuthFailedAttempts] = useState(0);
  const [authLockoutUntil, setAuthLockoutUntil] = useState(0);
  const [securityNumA, setSecurityNumA] = useState(() => Math.floor(Math.random() * 5) + 2);
  const [securityNumB, setSecurityNumB] = useState(() => Math.floor(Math.random() * 4) + 1);
  const [securityAnswerInput, setSecurityAnswerInput] = useState('');

  const refreshSecurityChallenge = () => {
    setSecurityNumA(Math.floor(Math.random() * 5) + 2);
    setSecurityNumB(Math.floor(Math.random() * 4) + 1);
    setSecurityAnswerInput('');
  };

  // Student Auth State (Sign Up / Login / Forgot Password with Security Question)
  const [students, setStudents] = useState<StudentAccount[]>(() => {
    try {
      const saved = localStorage.getItem('vs_neet_2027_students_cache_v1');
      return saved ? (JSON.parse(saved) as StudentAccount[]) : [];
    } catch {
      return [];
    }
  });
  const [currentStudent, setCurrentStudent] = useState<StudentAccount | null>(() => {
    try {
      const saved = localStorage.getItem('neet_cbt_student_session');
      return saved ? (JSON.parse(saved) as StudentAccount) : null;
    } catch {
      return null;
    }
  });
  const [showStudentAuthModal, setShowStudentAuthModal] = useState(false);
  const [authModalMode, setAuthModalMode] = useState<'login' | 'signup' | 'forgot'>('login');
  const [authFullName, setAuthFullName] = useState('');
  const [authEmailOrRoll, setAuthEmailOrRoll] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authSecurityQuestion, setAuthSecurityQuestion] = useState(SECURITY_QUESTIONS_LIST[0]);
  const [authSecurityQuestionAnswer, setAuthSecurityQuestionAnswer] = useState('');
  const [authError, setAuthError] = useState('');
  const [isSubmittingAuth, setIsSubmittingAuth] = useState(false);
  const [showGoogleQuickForm, setShowGoogleQuickForm] = useState(false);
  const [googleQuickEmail, setGoogleQuickEmail] = useState('');
  const [googleQuickName, setGoogleQuickName] = useState('');

  // Post-Login Student Profile Modal State (Update Photo, Name, Phone, Batch, City, Password, Security Question)
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [profileName, setProfileName] = useState('');
  const [profilePhone, setProfilePhone] = useState('');
  const [profileBatch, setProfileBatch] = useState('NEET 2027 · Vs Target Batch');
  const [profileCity, setProfileCity] = useState('');
  const [profileNewPassword, setProfileNewPassword] = useState('');
  const [profileSecurityQuestion, setProfileSecurityQuestion] = useState(SECURITY_QUESTIONS_LIST[0]);
  const [profileSecurityAnswer, setProfileSecurityAnswer] = useState('');
  const [profilePhotoUrl, setProfilePhotoUrl] = useState('');
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const profilePhotoInputRef = useRef<HTMLInputElement | null>(null);

  // Folders, Tests, Attempts & Notifications State (Backed by Server + Permanent Vault + localStorage)
  const [folders, setFolders] = useState<TestFolder[]>(() => {
    try {
      const delRaw = localStorage.getItem('vs_neet_deleted_folder_ids_v1');
      const delSet = new Set<string>(delRaw ? (JSON.parse(delRaw) as string[]) : []);
      const savedRaw = localStorage.getItem('vs_neet_2027_folders_cache_v1');
      const savedList = savedRaw ? (JSON.parse(savedRaw) as TestFolder[]) : [];
      const map = new Map<string, TestFolder>();
      const baseList = savedList.length > 0 ? savedList : DEFAULT_SEED_FOLDERS;
      for (const f of baseList) {
        if (f && f.id && !delSet.has(f.id)) map.set(f.id, f);
      }
      return Array.from(map.values());
    } catch {
      return DEFAULT_SEED_FOLDERS;
    }
  });
  const [tests, setTests] = useState<CbtTestMeta[]>(() => {
    try {
      const deletedRaw = localStorage.getItem('vs_neet_deleted_test_ids_v1');
      const deletedIds = new Set<string>(deletedRaw ? (JSON.parse(deletedRaw) as string[]) : []);
      const savedRaw = localStorage.getItem('vs_neet_2027_tests_meta_v3');
      const savedList = savedRaw ? (JSON.parse(savedRaw) as CbtTestMeta[]) : [];
      const map = new Map<string, CbtTestMeta>();
      const baseTests = savedList.length > 0 ? savedList : DEFAULT_SEED_TESTS;
      for (const t of baseTests) {
        if (t && t.id && t.title && !deletedIds.has(t.id)) {
          if (t.isPdfOnly) {
            map.set(t.id, {
              ...t,
              totalQuestions: 0,
              maxMarks: 0,
            });
            continue;
          }
          const rawQ = Number(t.totalQuestions) || 0;
          const healedQ =
            rawQ > 1
              ? rawQ
              : /ranker|fst|full\s*syllabus|major|180/i.test(`${t.title} ${t.subTitle || ''}`)
                ? 180
                : 90;
          const cMarks = Number(t.correctMarks) || 4;
          map.set(t.id, {
            ...t,
            totalQuestions: healedQ,
            maxMarks: rawQ > 1 && t.maxMarks ? t.maxMarks : healedQ * cMarks,
          });
        }
      }
      return Array.from(map.values()).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    } catch {
      return DEFAULT_SEED_TESTS;
    }
  });
  const [attempts, setAttempts] = useState<TestAttempt[]>(() => {
    try {
      const saved = localStorage.getItem('vs_neet_2027_attempts_cache');
      return saved ? (JSON.parse(saved) as TestAttempt[]) : [];
    } catch {
      return [];
    }
  });
  const [notifications, setNotifications] = useState<PortalNotification[]>(() => {
    try {
      const saved = localStorage.getItem('vs_neet_2027_notifications_v1');
      return saved ? (JSON.parse(saved) as PortalNotification[]) : [];
    } catch {
      return [];
    }
  });
  const [showNotificationsModal, setShowNotificationsModal] = useState(false);
  const [liveIncomingNotif, setLiveIncomingNotif] = useState<PortalNotification | null>(null);
  const [lastSeenNotifTime, setLastSeenNotifTime] = useState<number>(() => {
    try {
      return Number(localStorage.getItem('vs_neet_last_seen_notif_ts') || '0');
    } catch {
      return 0;
    }
  });
  const [notifPermissionState, setNotifPermissionState] = useState<string>(() => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      return Notification.permission;
    }
    return 'default';
  });
  const lastDeliveredNotifIdRef = useRef<string>('');

  const [localQuestionsCache, setLocalQuestionsCache] = useState<Record<string, CbtQuestion[]>>(
    BUILT_IN_COMPANION_QUESTIONS
  );
  const [localRawHtmlCache, setLocalRawHtmlCache] = useState<Record<string, string>>({});
  const [globalAttachmentPdf, setGlobalAttachmentPdf] = useState<GlobalAttachmentPdf | null>(null);
  const [activeNormalPdfModal, setActiveNormalPdfModal] = useState<{
    url: string;
    title: string;
    fileName?: string;
  } | null>(null);

  // Portal Logo State (Admin can change logo anytime; synced to all student devices)
  const [portalLogoUrl, setPortalLogoUrl] = useState<string>(() => {
    try {
      const saved = localStorage.getItem('vs_neet_portal_logo_url');
      if (!saved || saved === LEGACY_PORTAL_LOGO) {
        localStorage.setItem('vs_neet_portal_logo_url', DEFAULT_PORTAL_LOGO);
        return DEFAULT_PORTAL_LOGO;
      }
      return saved;
    } catch {
      return DEFAULT_PORTAL_LOGO;
    }
  });

  // Home Page Navigation Step: 'root' (Only Total Tests card) -> 'folders' (All Test Folders) -> 'folder_tests' (Tests inside selected folder)
  const [homeViewStep, setHomeViewStep] = useState<HomeBrowserStep>('root');

  // Student Portal Filters (Folder, Subject, Search)
  const [selectedFolderFilter, setSelectedFolderFilter] = useState<string>('ALL');
  const [subjectFilter] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState('');

  // Pre-exam Modal & Active Exam Runner State (Only 2 Modes: 'html' [Full Test Mode] & 'practice' [Practice Mode])
  const [selectedTestForInstructions, setSelectedTestForInstructions] =
    useState<CbtTestMeta | null>(null);
  const [pendingTestAfterLogin, setPendingTestAfterLogin] = useState<CbtTestMeta | null>(null);
  const logoTapCountRef = useRef(0);
  const logoTapTimerRef = useRef<number | null>(null);
  const [selectedExamLaunchMode, setSelectedExamLaunchMode] = useState<'practice' | 'html'>(
    'html'
  );
  const [activeRunningTest, setActiveRunningTest] = useState<{
    meta: CbtTestMeta;
    questions: CbtQuestion[];
    practiceMode: boolean;
    rawHtmlContent?: string;
    initialHtmlMode?: boolean;
    reviewAttempt?: TestAttempt | null;
  } | null>(null);
  const [isLoadingTestQuestions, setIsLoadingTestQuestions] = useState(false);

  // Dashboard Weak Link Rescue Engine State
  const [dashboardRescuePlan, setDashboardRescuePlan] = useState<WeakLinkRescuePlan | null>(null);
  const [isLoadingDashboardRescue, setIsLoadingDashboardRescue] = useState(false);
  const [dashboardRescueMcqAnswers, setDashboardRescueMcqAnswers] = useState<
    Record<number, string>
  >({});

  // Feature 1: Mistake Notebook & Bookmarks State (IndexedDB + Quota-Safe localStorage)
  const [mistakeNotebook, setMistakeNotebook] = useState<MistakeNotebookItem[]>(() => {
    try {
      const raw = localStorage.getItem('vs_neet_mistake_notebook_v1');
      return raw ? (JSON.parse(raw) as MistakeNotebookItem[]) : [];
    } catch {
      return [];
    }
  });
  const [mistakeFilter, setMistakeFilter] = useState<'all' | 'wrong' | 'bookmarked'>('all');

  const persistMistakeNotebookEverywhere = useCallback((items: MistakeNotebookItem[]) => {
    // 1. Save full items (including base64 question & solution images) to IndexedDB
    if (typeof window !== 'undefined' && 'indexedDB' in window) {
      try {
        const req = window.indexedDB.open('vs_neet_mistake_notebook_db_v1', 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains('mistakes')) {
            db.createObjectStore('mistakes');
          }
        };
        req.onsuccess = () => {
          try {
            const db = req.result;
            const tx = db.transaction('mistakes', 'readwrite');
            tx.objectStore('mistakes').put(items, 'notebook_items_v1');
            tx.oncomplete = () => db.close();
          } catch {
            // ignore idb write error
          }
        };
      } catch {
        // ignore idb open error
      }
    }
    // 2. Save to localStorage with automatic fallback if base64 images exceed 5MB quota
    try {
      localStorage.setItem('vs_neet_mistake_notebook_v1', JSON.stringify(items));
    } catch {
      try {
        const compactItems = items.slice(0, 120).map((it) => ({
          ...it,
          question: {
            ...it.question,
            imageUrls: undefined,
            explanation: it.question?.explanation
              ? {
                  hi:
                    it.question.explanation.hi && it.question.explanation.hi.length > 15000
                      ? ''
                      : it.question.explanation.hi,
                  en:
                    it.question.explanation.en && it.question.explanation.en.length > 15000
                      ? ''
                      : it.question.explanation.en,
                }
              : undefined,
          },
        }));
        localStorage.setItem('vs_neet_mistake_notebook_v1', JSON.stringify(compactItems));
      } catch {
        // IndexedDB still holds the full items
      }
    }
  }, []);

  // Hydrate full image-rich Mistake Notebook from IndexedDB on startup
  useEffect(() => {
    if (typeof window === 'undefined' || !('indexedDB' in window)) return;
    try {
      const req = window.indexedDB.open('vs_neet_mistake_notebook_db_v1', 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('mistakes')) {
          db.createObjectStore('mistakes');
        }
      };
      req.onsuccess = () => {
        try {
          const db = req.result;
          const tx = db.transaction('mistakes', 'readonly');
          const getReq = tx.objectStore('mistakes').get('notebook_items_v1');
          getReq.onsuccess = () => {
            const idbItems = Array.isArray(getReq.result)
              ? (getReq.result as MistakeNotebookItem[])
              : [];
            if (idbItems.length > 0) {
              setMistakeNotebook((prev) => {
                const map = new Map<string, MistakeNotebookItem>();
                for (const item of prev) {
                  if (item && item.uid) map.set(item.uid, item);
                }
                for (const item of idbItems) {
                  if (item && item.uid) {
                    const existing = map.get(item.uid);
                    if (
                      !existing ||
                      (item.savedAt || 0) >= (existing.savedAt || 0) ||
                      Boolean(item.question?.imageEn || item.question?.imageHi)
                    ) {
                      map.set(item.uid, item);
                    }
                  }
                }
                return Array.from(map.values())
                  .sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0))
                  .slice(0, 250);
              });
            }
            db.close();
          };
        } catch {
          // ignore
        }
      };
    } catch {
      // ignore
    }
  }, []);

  // Feature 2: Auto-Saved Unfinished Test Session State ("Resume Test From Where You Left")
  const [unfinishedTest, setUnfinishedTest] = useState<UnfinishedTestSummary | null>(() => {
    try {
      const raw = localStorage.getItem('vs_neet_last_unfinished_test_v1');
      if (!raw) return null;
      const parsed = JSON.parse(raw) as UnfinishedTestSummary;
      if (!parsed || !parsed.testId || parsed.remainingSeconds <= 30) return null;
      return parsed;
    } catch {
      return null;
    }
  });

  useEffect(() => {
    if (activeRunningTest) return;
    try {
      const raw = localStorage.getItem('vs_neet_last_unfinished_test_v1');
      if (!raw) {
        setUnfinishedTest(null);
        return;
      }
      const parsed = JSON.parse(raw) as UnfinishedTestSummary;
      if (parsed && parsed.testId && parsed.remainingSeconds > 30) {
        setUnfinishedTest(parsed);
      } else {
        setUnfinishedTest(null);
      }
    } catch {
      setUnfinishedTest(null);
    }
  }, [activeRunningTest]);

  const handleSyncMistakesAndBookmarks = useCallback(
    (newItems: MistakeNotebookItem[], masteredUids?: string[]) => {
      setMistakeNotebook((prev) => {
        const removeSet = new Set(masteredUids || []);
        const map = new Map<string, MistakeNotebookItem>();
        for (const existing of prev) {
          if (existing && existing.uid && !removeSet.has(existing.uid)) {
            map.set(existing.uid, existing);
          }
        }
        let addedCount = 0;
        for (const item of newItems) {
          if (!item || !item.uid || removeSet.has(item.uid)) continue;
          const prevItem = map.get(item.uid);
          if (!prevItem) addedCount++;
          const mergedReason =
            prevItem && prevItem.reason !== item.reason ? 'both' : item.reason;
          map.set(item.uid, {
            ...item,
            reason: mergedReason,
            savedAt: Date.now(),
          });
        }
        const updated = Array.from(map.values())
          .sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0))
          .slice(0, 250);
        persistMistakeNotebookEverywhere(updated);
        if (addedCount > 0) {
          setTimeout(() => {
            setToast({
              message: `📓 ${addedCount} Mistake/Bookmark Question${addedCount > 1 ? 's' : ''} Auto-Saved to Mistake Notebook!`,
              type: 'success',
            });
          }, 50);
        }
        return updated;
      });
    },
    [persistMistakeNotebookEverywhere]
  );

  const handleRemoveMistakeItem = (uid: string) => {
    setMistakeNotebook((prev) => {
      const next = prev.filter((item) => item.uid !== uid);
      persistMistakeNotebookEverywhere(next);
      return next;
    });
    showToast('Removed question from Mistake Notebook.', 'info');
  };

  const handleStartMistakeRetest = () => {
    const filteredList = mistakeNotebook.filter((item) => {
      if (mistakeFilter === 'wrong') return item.reason === 'wrong' || item.reason === 'both';
      if (mistakeFilter === 'bookmarked') return item.reason === 'bookmarked' || item.reason === 'both';
      return true;
    });
    if (filteredList.length === 0) {
      showToast('No saved questions in this filter to start a Re-Test.', 'error');
      return;
    }
    const retestQuestions: CbtQuestion[] = filteredList.map((item, idx) => ({
      ...normalizeCbtQuestion(item.question, idx),
      id: idx + 1,
      chapter: item.question.chapter || item.testTitle || 'Mistake Revision',
      sourceUid: item.uid,
    } as CbtQuestion));

    const retestMeta: CbtTestMeta = {
      id: 'mistake_retest_session',
      title: `My Mistakes & Bookmarks Re-Test (${retestQuestions.length} Qs)`,
      subTitle: 'Targeted Mistake & Bookmark Revision Test',
      chapter: 'Saved Mistakes & Bookmarked Questions',
      subject: 'Biology · Chemistry · Physics',
      difficulty: 'Medium',
      totalQuestions: retestQuestions.length,
      maxMarks: retestQuestions.length * 4,
      correctMarks: 4,
      negativeMarks: 1,
      durationMinutes: Math.max(15, Math.min(180, retestQuestions.length * 2)),
      openCount: 1,
      playCount: 1,
      completionCount: 0,
      createdAt: Date.now(),
    };

    // Clear any stale in-progress session so Mistake Re-Test always starts fresh at Question 1 with full time
    try {
      localStorage.removeItem('vs_neet_inprogress_mistake_retest_session');
    } catch {
      // ignore
    }

    setActiveRunningTest({
      meta: retestMeta,
      questions: retestQuestions,
      practiceMode: false,
      initialHtmlMode: false,
      reviewAttempt: null,
    });
  };

  const handleDiscardUnfinishedTest = (testId: string) => {
    try {
      localStorage.removeItem('vs_neet_last_unfinished_test_v1');
      localStorage.removeItem(`vs_neet_inprogress_${testId}`);
    } catch {
      // ignore
    }
    setUnfinishedTest(null);
    showToast('Cleared unfinished test session.', 'info');
  };

  // Toast Notification
  const [toast, setToast] = useState<{
    message: string;
    type: 'success' | 'error' | 'info';
  } | null>(null);

  const showToast = (message: string, type: 'success' | 'error' | 'info' = 'info') => {
    setToast({ message, type });
    setTimeout(() => {
      setToast((prev) => (prev?.message === message ? null : prev));
    }, 4000);
  };

  const activeRunningTestRef = useRef(false);
  activeRunningTestRef.current = Boolean(activeRunningTest);

  // Request Browser / Mobile Phone Push Notification Permission
  const requestPhoneNotificationPermission = async () => {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      showToast('Notifications are supported when installed on mobile browser.', 'info');
      return;
    }
    try {
      const perm = await Notification.requestPermission();
      setNotifPermissionState(perm);
      if (perm === 'granted') {
        showToast('🔔 Phone Push Notifications enabled!', 'success');
      } else {
        showToast('Please allow Notification permission in your browser settings.', 'info');
      }
    } catch {
      // ignore
    }
  };

  // Built-in PRAYAS Minor Test-06 questions are loaded on demand when opened (prevents 6MB HTML parse on startup)

  // Listen to Firebase Auth for Google Sign-In students & push login data to Admin Store
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (fbUser) => {
      if (fbUser && !currentStudent) {
        const cleanEmail = String(fbUser.email || fbUser.uid || '').toLowerCase();
        const existing = students.find(
          (s) => String(s?.emailOrRoll || '').toLowerCase() === cleanEmail
        );
        const googleStudent: StudentAccount = {
          id: existing?.id || `stu_${fbUser.uid.slice(0, 16)}`,
          fullName:
            existing?.fullName ||
            fbUser.displayName ||
            fbUser.email?.split('@')[0] ||
            'NEET Student',
          emailOrRoll: cleanEmail,
          phone: existing?.phone || fbUser.phoneNumber || '',
          photoUrl: existing?.photoUrl || fbUser.photoURL || undefined,
          passwordHash: existing?.passwordHash || 'google_oauth',
          passwordPlain: existing?.passwordPlain || 'Google Sign-In',
          securityQuestion: existing?.securityQuestion,
          securityAnswer: existing?.securityAnswer,
          targetBatch: existing?.targetBatch || 'NEET 2027 · Vs Target Batch',
          city: existing?.city || '',
          loginCount: (existing?.loginCount || 0) + 1,
          createdAt: existing?.createdAt || Date.now(),
          lastLoginAt: Date.now(),
        };
        setCurrentStudent(googleStudent);
        localStorage.setItem('neet_cbt_student_session', JSON.stringify(googleStudent));
        saveStudentToFirestore(googleStudent, !existing).catch(() => {});
      }
    });
    return () => unsub();
  }, [currentStudent, students]);

  const [tickedStudentMap, setTickedStudentMap] = useState<Record<string, boolean>>(() => {
    try {
      const raw = localStorage.getItem('vs_admin_ticked_students_v1');
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  });

  const currentStudentRef = useRef<StudentAccount | null>(null);
  currentStudentRef.current = currentStudent;

  const lastBootstrapSigRef = useRef<string>('');
  const hasReconciledVaultRef = useRef<boolean>(false);

  // 100% Automatic Real-Time Server Synchronization (`syncPortalStore`) + SSE Live Stream (`/api/store/stream`)
  // Optimized for 10,000+ concurrent test takers & Permanent Test Vault reconciliation
  const syncPortalStore = useCallback(async (invalidateTestId?: string) => {
    if (activeRunningTestRef.current && !invalidateTestId) {
      return;
    }
    if (isBatchUploadActive() && invalidateTestId !== 'batch_complete') {
      return;
    }

    if (invalidateTestId && invalidateTestId !== 'prayas_06') {
      lastBootstrapSigRef.current = '';
      setLocalQuestionsCache((prev) => {
        if (!prev[invalidateTestId]) return prev;
        const next = { ...prev };
        delete next[invalidateTestId];
        return next;
      });
      setLocalRawHtmlCache((prev) => {
        if (!prev[invalidateTestId]) return prev;
        const next = { ...prev };
        delete next[invalidateTestId];
        return next;
      });
    }

    const forceFullFetch = Boolean(invalidateTestId) || !hasReconciledVaultRef.current;
    const boot = await fetchPortalBootstrap(forceFullFetch);
    if (!boot) return;

    // Fast path for 10,000 concurrent users: if server version is unchanged and vault is already reconciled, do zero work
    if (boot.unchanged && hasReconciledVaultRef.current && !invalidateTestId) {
      return;
    }

    // Reconcile server tests with local IndexedDB Permanent Vault + localStorage so uploaded tests NEVER disappear
    // AND enforce permanent deletion tombstones so Admin-deleted tests NEVER return
    const serverDeletedIds = Array.isArray(boot.deletedTestIds) ? boot.deletedTestIds : [];
    for (const delId of serverDeletedIds) {
      markTestDeletedLocally(delId);
    }
    let localDeletedIds: string[] = [];
    try {
      const rawDel = localStorage.getItem('vs_neet_deleted_test_ids_v1');
      if (rawDel) localDeletedIds = JSON.parse(rawDel) as string[];
    } catch {
      // ignore
    }
    const combinedDeletedIds = Array.from(new Set([...serverDeletedIds, ...localDeletedIds]));
    const deletedSet = new Set(combinedDeletedIds);
    try {
      localStorage.setItem('vs_neet_deleted_test_ids_v1', JSON.stringify(combinedDeletedIds));
    } catch {
      // ignore
    }

    const reconciledTests = await reconcilePermanentTestsWithServer(
      boot.tests || [],
      combinedDeletedIds
    );
    hasReconciledVaultRef.current = true;

    // Fast signature check: if server + vault state hasn't changed, skip state updates for zero micro-lag
    const sig = JSON.stringify({
      v: boot.version || 0,
      l: boot.portalLogoUrl || '',
      g: boot.globalAttachmentPdf
        ? `${boot.globalAttachmentPdf.id}_${boot.globalAttachmentPdf.updatedAt || 0}`
        : '',
      f: boot.folders.map(
        (x) =>
          `${x.id}_${x.name}_${(x.bannerUrl || '').length}_${(x.bannerUrl || '').slice(-40)}`
      ),
      t: reconciledTests.map(
        (x) =>
          `${x.id}_${x.title}_${x.totalQuestions || 0}_${(x.bannerUrl || '').length}_${(x.bannerUrl || '').slice(-40)}_${x.scheduledAt || 0}_${x.isPinned ? 1 : 0}_${x.pinnedAt || 0}_${x.playCount || 0}_${x.completionCount || 0}_${x.folderId || ''}_${x.attachmentPdfId || ''}_${x.isPdfOnly ? 1 : 0}`
      ),
      d: combinedDeletedIds,
      ds: boot.deletedStudentIds || [],
      da: boot.deletedAttemptIds || [],
      tk: boot.tickedStudentMap || {},
      s: boot.students.map(
        (x) =>
          `${x.id}_${x.lastOnlineAt || 0}_${x.activeTestId || ''}_${x.lastScore ?? ''}_${x.lastTestCompletedAt || 0}`
      ),
      a: boot.attempts.map((x) => `${x.id}_${x.score}`),
      n: boot.notifications?.map((x) => x.id) || [],
    });
    if (sig === lastBootstrapSigRef.current && !invalidateTestId) {
      return;
    }
    lastBootstrapSigRef.current = sig;

    if (boot.tickedStudentMap && typeof boot.tickedStudentMap === 'object') {
      setTickedStudentMap((prev) => {
        const next = { ...prev, ...boot.tickedStudentMap };
        // Also remove keys that were explicitly unticked on server if server has authoritative map
        for (const k of Object.keys(prev)) {
          if (!(k in (boot.tickedStudentMap || {})) && Object.keys(boot.tickedStudentMap || {}).length > 0) {
            delete next[k];
          }
        }
        try {
          localStorage.setItem('vs_admin_ticked_students_v1', JSON.stringify(next));
        } catch {
          // ignore
        }
        return next;
      });
    }

    setGlobalAttachmentPdf(boot.globalAttachmentPdf || null);

    if (typeof boot.portalLogoUrl === 'string' && boot.portalLogoUrl.trim().length > 0) {
      const resolvedLogo =
        boot.portalLogoUrl.trim() === LEGACY_PORTAL_LOGO
          ? DEFAULT_PORTAL_LOGO
          : boot.portalLogoUrl.trim();
      setPortalLogoUrl(resolvedLogo);
      try {
        localStorage.setItem('vs_neet_portal_logo_url', resolvedLogo);
      } catch {
        // ignore
      }
    }

    // Track explicitly deleted folders so Admin can delete any folder (including default folders) permanently
    const serverDeletedFolderIds = Array.isArray(boot.deletedFolderIds) ? boot.deletedFolderIds : [];
    let localDeletedFolderIds: string[] = [];
    try {
      const rawDelFolders = localStorage.getItem('vs_neet_deleted_folder_ids_v1');
      if (rawDelFolders) localDeletedFolderIds = JSON.parse(rawDelFolders) as string[];
    } catch {
      // ignore
    }
    const combinedDeletedFolderIds = Array.from(
      new Set([...serverDeletedFolderIds, ...localDeletedFolderIds])
    );
    const deletedFolderSet = new Set(combinedDeletedFolderIds);
    try {
      localStorage.setItem(
        'vs_neet_deleted_folder_ids_v1',
        JSON.stringify(combinedDeletedFolderIds)
      );
    } catch {
      // ignore
    }

    const hasSeededFolders = localStorage.getItem('neet_cbt_folders_seeded_v2');
    if (!hasSeededFolders && boot.folders.length === 0 && combinedDeletedFolderIds.length === 0) {
      localStorage.setItem('neet_cbt_folders_seeded_v2', 'true');
      for (const seedFolder of DEFAULT_SEED_FOLDERS) {
        await saveFolderToFirestore(seedFolder);
      }
    }

    const hasSeededTests = localStorage.getItem('neet_cbt_seeded_v4');
    if (!hasSeededTests && reconciledTests.length === 0 && combinedDeletedIds.length === 0) {
      localStorage.setItem('neet_cbt_seeded_v4', 'true');
      for (const seedTest of DEFAULT_SEED_TESTS) {
        if (!deletedSet.has(seedTest.id)) {
          await saveTestToFirestore(seedTest, undefined, undefined, { explicitAdminCreate: true });
        }
      }
    }

    // Authoritative Folders Sync from Server + Local Cache (never inject seed folders if server already has folders)
    setFolders((prev) => {
      const map = new Map<string, TestFolder>();
      const seedFallback =
        boot.folders.length === 0 && prev.length === 0 && combinedDeletedFolderIds.length === 0
          ? DEFAULT_SEED_FOLDERS
          : [];
      for (const f of [...seedFallback, ...prev]) {
        if (f && f.id && !deletedFolderSet.has(f.id)) {
          map.set(f.id, f);
        }
      }
      for (const f of boot.folders) {
        if (f && f.id && !deletedFolderSet.has(f.id)) {
          const prevF = map.get(f.id);
          const hasBannerProp = Object.prototype.hasOwnProperty.call(f, 'bannerUrl');
          map.set(f.id, {
            ...(prevF || {}),
            ...f,
            bannerUrl: hasBannerProp
              ? f.bannerUrl
                ? String(f.bannerUrl)
                : undefined
              : prevF?.bannerUrl,
          });
        }
      }
      for (const t of reconciledTests) {
        if (
          t &&
          t.folderId &&
          t.folderName &&
          !deletedFolderSet.has(t.folderId) &&
          !map.has(t.folderId)
        ) {
          map.set(t.folderId, {
            id: t.folderId,
            name: t.folderName,
            description: 'Vs Tests Series',
            createdAt: t.createdAt || Date.now(),
          });
        }
      }
      const mergedFolders = Array.from(map.values());
      saveFoldersToLocalStorageSafe(mergedFolders);
      return mergedFolders;
    });

    // Permanent Tests Sync: merges Existing State + Reconciled Vault & Server Tests (never deletes or overwrites banners)
    setTests((prev) => {
      const map = new Map<string, CbtTestMeta>();
      const seedTestFallback =
        boot.tests.length === 0 && reconciledTests.length === 0 && combinedDeletedIds.length === 0
          ? DEFAULT_SEED_TESTS
          : [];
      const sourceTests = [...seedTestFallback, ...prev, ...reconciledTests];

      // Build folder-level Syllabus PDF lookup so every test in a folder automatically gets its folder's Syllabus PDF
      const folderPdfLookup = new Map<string, { id: string; name: string }>();
      for (const f of boot.folders) {
        if (f && f.id && f.attachmentPdfId) {
          folderPdfLookup.set(f.id, {
            id: f.attachmentPdfId,
            name: f.attachmentPdfName || `${f.name} Syllabus.pdf`,
          });
        }
      }
      for (const t of sourceTests) {
        if (t && t.folderId && t.attachmentPdfId && !folderPdfLookup.has(t.folderId)) {
          folderPdfLookup.set(t.folderId, {
            id: t.attachmentPdfId,
            name: t.attachmentPdfName || `${t.title} Syllabus.pdf`,
          });
        }
      }

      for (const t of sourceTests) {
        if (!t || !t.id || !t.title || deletedSet.has(t.id)) continue;
        const prevEntry = map.get(t.id);
        const hasBannerProp = Object.prototype.hasOwnProperty.call(t, 'bannerUrl');
        const resolvedBanner = hasBannerProp
          ? t.bannerUrl
            ? String(t.bannerUrl)
            : undefined
          : prevEntry?.bannerUrl;

        const safeTitle = String(t.title || 'NEET CBT Test');
        const safeSubject = String(t.subject || 'Biology (जीव विज्ञान)');
        const safeChapter = String(t.chapter || 'Complete Syllabus');
        if (t.isPdfOnly) {
          const pdfFolderId = t.folderId || 'folder_prayas';
          const inheritedPdf = folderPdfLookup.get(pdfFolderId);
          map.set(t.id, {
            ...(prevEntry || {}),
            ...t,
            title: safeTitle,
            subject: safeSubject,
            chapter: safeChapter,
            totalQuestions: 0,
            maxMarks: 0,
            isPdfOnly: true,
            folderId: pdfFolderId,
            bannerUrl: resolvedBanner,
            attachmentPdfId: t.attachmentPdfId || inheritedPdf?.id || prevEntry?.attachmentPdfId,
            attachmentPdfName:
              t.attachmentPdfName || inheritedPdf?.name || prevEntry?.attachmentPdfName,
            scheduledAt: t.scheduledAt ? Number(t.scheduledAt) : undefined,
            isPinned: Boolean(t.isPinned),
            pinnedAt: t.pinnedAt ? Number(t.pinnedAt) : undefined,
          });
          continue;
        }
        const rawDur = Number(t.durationMinutes) || 90;
        const safeDuration = rawDur <= 6 ? rawDur * 60 : Math.max(60, rawDur);
        const rawQCount = Number(t.totalQuestions) || 0;
        const healedQCount =
          rawQCount > 1
            ? rawQCount
            : /ranker|fst|full\s*syllabus|major|180/i.test(`${safeTitle} ${t.subTitle || ''}`)
              ? 180
              : 90;
        const cMarks = Number(t.correctMarks) || 4;
        const healedMaxMarks =
          rawQCount > 1 && Number(t.maxMarks) > 4 ? Number(t.maxMarks) : healedQCount * cMarks;
        const inferredDiff: TestDifficulty =
          t.difficulty === 'Easy' || t.difficulty === 'Medium' || t.difficulty === 'Hard'
            ? t.difficulty
            : healedQCount >= 120
              ? 'Hard'
              : healedQCount >= 45
                ? 'Medium'
                : 'Easy';
        const inferredFolderId =
          t.folderId ||
          (safeTitle.toLowerCase().includes('trackprep')
            ? 'folder_trackprep'
            : safeTitle.toLowerCase().includes('ubt')
              ? 'folder_ubt_mock'
              : 'folder_prayas');
        const inheritedPdf = folderPdfLookup.get(inferredFolderId);
        map.set(t.id, {
          ...(prevEntry || {}),
          ...t,
          title: safeTitle,
          subject: safeSubject,
          chapter: safeChapter,
          totalQuestions: healedQCount,
          maxMarks: healedMaxMarks,
          durationMinutes: safeDuration,
          difficulty: inferredDiff,
          folderId: inferredFolderId,
          bannerUrl: resolvedBanner,
          attachmentPdfId: t.attachmentPdfId || inheritedPdf?.id || prevEntry?.attachmentPdfId,
          attachmentPdfName:
            t.attachmentPdfName || inheritedPdf?.name || prevEntry?.attachmentPdfName,
          scheduledAt: t.scheduledAt ? Number(t.scheduledAt) : undefined,
          isPinned: Boolean(t.isPinned),
          pinnedAt: t.pinnedAt ? Number(t.pinnedAt) : undefined,
        });
      }
      const finalTests = Array.from(map.values()).sort((a, b) => {
        if (Boolean(a.isPinned) !== Boolean(b.isPinned)) {
          return a.isPinned ? -1 : 1;
        }
        if (a.isPinned && b.isPinned && (b.pinnedAt || 0) !== (a.pinnedAt || 0)) {
          return (b.pinnedAt || 0) - (a.pinnedAt || 0);
        }
        return (b.createdAt || 0) - (a.createdAt || 0);
      });
      saveTestsMetaToLocalStorageSafe(finalTests);
      return finalTests;
    });

    const serverDeletedStudentSet = new Set(
      Array.isArray(boot.deletedStudentIds) ? boot.deletedStudentIds : []
    );
    setStudents((prev) => {
      const map = new Map<string, StudentAccount>();
      for (const s of [...prev, ...boot.students]) {
        if (s && s.id && !serverDeletedStudentSet.has(s.id)) {
          map.set(s.id, s);
        }
      }
      const mergedStudents = Array.from(map.values());
      try {
        localStorage.setItem('vs_neet_2027_students_cache_v1', JSON.stringify(mergedStudents));
      } catch {
        // ignore
      }
      return mergedStudents;
    });

    const serverDeletedAttemptIds = Array.isArray(boot.deletedAttemptIds)
      ? boot.deletedAttemptIds
      : [];
    let localDeletedAttemptIds: string[] = [];
    try {
      const rawDelAtt = localStorage.getItem('vs_neet_deleted_attempt_ids_v1');
      if (rawDelAtt) localDeletedAttemptIds = JSON.parse(rawDelAtt) as string[];
    } catch {
      // ignore
    }
    const combinedDeletedAttemptIds = Array.from(
      new Set([...serverDeletedAttemptIds, ...localDeletedAttemptIds])
    );
    const deletedAttemptSet = new Set(combinedDeletedAttemptIds);

    setAttempts((prev) => {
      const map = new Map<string, TestAttempt>();
      // Put boot.attempts after prev so server updates always win over stale local cache
      for (const a of [...prev, ...boot.attempts]) {
        if (!a) continue;
        const key = a.id || `${a.testId}_${a.completedAt}`;
        if (deletedAttemptSet.has(key) || (a.id && deletedAttemptSet.has(a.id))) continue;
        if (a.studentId && serverDeletedStudentSet.has(a.studentId)) continue;
        map.set(key, a);
      }
      const merged = Array.from(map.values()).sort(
        (a, b) => (b.completedAt || 0) - (a.completedAt || 0)
      );
      try {
        localStorage.setItem('vs_neet_2027_attempts_cache', JSON.stringify(merged.slice(0, 80)));
      } catch {
        // ignore
      }
      return merged;
    });

    if (Array.isArray(boot.notifications)) {
      const sortedNotifs = [...boot.notifications].sort(
        (a, b) => (b.createdAt || 0) - (a.createdAt || 0)
      );
      setNotifications(sortedNotifs);
      if (sortedNotifs.length > 0) {
        const newest = sortedNotifs[0];
        if (!lastDeliveredNotifIdRef.current) {
          lastDeliveredNotifIdRef.current = newest.id;
        } else if (newest.id !== lastDeliveredNotifIdRef.current) {
          lastDeliveredNotifIdRef.current = newest.id;
          setLiveIncomingNotif(newest);
          triggerNativePhoneNotification(newest);
        }
      }
    }
  }, []);

  useEffect(() => {
    syncPortalStore();

    // 1. Live Server-Sent Events (SSE) stream with auto-reconnect so whatever Admin does updates every student screen in <0.3s
    let es: EventSource | null = null;
    let reconnectTimer: number | null = null;
    let isUnmounted = false;

    const connectSse = () => {
      if (isUnmounted) return;
      try {
        if (es) es.close();
        es = new EventSource('/api/store/stream');
        es.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (!data || data.type === 'connected') return;

            if (data.type === 'logo_updated' && typeof data.portalLogoUrl === 'string') {
              const nextLogo = data.portalLogoUrl.trim() || DEFAULT_PORTAL_LOGO;
              setPortalLogoUrl(nextLogo);
              try {
                localStorage.setItem('vs_neet_portal_logo_url', nextLogo);
              } catch {
                // ignore
              }
            } else if (data.type === 'notification_sent' && data.notification) {
              const incoming = data.notification as PortalNotification;
              lastDeliveredNotifIdRef.current = incoming.id;
              setNotifications((prev) => {
                const filtered = prev.filter((n) => n.id !== incoming.id);
                return [incoming, ...filtered];
              });
              setLiveIncomingNotif(incoming);
              triggerNativePhoneNotification(incoming);
            } else if (data.type === 'test_deleted' && data.testId) {
              markTestDeletedLocally(data.testId);
              setTests((prev) => prev.filter((t) => t.id !== data.testId));
              syncPortalStore(data.testId);
            } else if (data.type === 'student_deleted' && data.studentId) {
              setStudents((prev) => prev.filter((s) => s.id !== data.studentId));
              setAttempts((prev) => prev.filter((a) => a.studentId !== data.studentId));
              syncPortalStore('force_refresh');
            } else if (data.type === 'attempt_deleted' && data.attemptId) {
              setAttempts((prev) => prev.filter((a) => a.id !== data.attemptId));
              syncPortalStore('force_refresh');
            } else if (data.type === 'student_tick_updated') {
              if (data.tickedStudentMap && typeof data.tickedStudentMap === 'object') {
                setTickedStudentMap(data.tickedStudentMap);
                try {
                  localStorage.setItem(
                    'vs_admin_ticked_students_v1',
                    JSON.stringify(data.tickedStudentMap)
                  );
                } catch {
                  // ignore
                }
              }
              const me = currentStudentRef.current;
              const tickKeyStr = String(data.tickKey || '');
              if (
                me &&
                data.value === true &&
                (data.studentId === me.id ||
                  tickKeyStr === me.id ||
                  tickKeyStr.startsWith(`${me.id}__`))
              ) {
                setToast({
                  message:
                    '✅ Admin verified your test record! (Admin द्वारा आपका टेस्ट Verify ✔ किया गया)',
                  type: 'success',
                });
              }
              syncPortalStore('force_refresh');
            } else {
              const targetId = data.meta?.id || data.testId || 'force_refresh';
              syncPortalStore(targetId);
            }
          } catch {
            syncPortalStore('force_refresh');
          }
        };
        es.onerror = () => {
          try {
            if (es) es.close();
          } catch {
            // ignore
          }
          if (!isUnmounted && !reconnectTimer) {
            reconnectTimer = window.setTimeout(() => {
              reconnectTimer = null;
              connectSse();
            }, 2000);
          }
        };
      } catch {
        // fallback to fast background poll
      }
    };

    connectSse();

    // 2. Fast lightweight background poll (4s-5s using 28-byte sinceVersion fast-path) so live updates never miss even behind mobile proxies
    const jitterMs = 4000 + Math.floor(Math.random() * 1500);
    const interval = window.setInterval(() => {
      if (!activeRunningTestRef.current) {
        syncPortalStore();
      }
    }, jitterMs);

    const handleVisibilityOrFocus = () => {
      if (document.visibilityState === 'visible') {
        syncPortalStore('force_refresh');
      }
    };
    window.addEventListener('focus', handleVisibilityOrFocus);
    window.addEventListener('online', handleVisibilityOrFocus);
    document.addEventListener('visibilitychange', handleVisibilityOrFocus);

    return () => {
      isUnmounted = true;
      if (es) es.close();
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      window.clearInterval(interval);
      window.removeEventListener('focus', handleVisibilityOrFocus);
      window.removeEventListener('online', handleVisibilityOrFocus);
      document.removeEventListener('visibilitychange', handleVisibilityOrFocus);
    };
  }, [syncPortalStore]);

  // Whenever `students` loads from store and `currentStudent` is logged in, sync any stored profile photo / details
  useEffect(() => {
    if (!currentStudent || students.length === 0) return;
    const match = students.find(
      (s) =>
        s &&
        (s.id === currentStudent.id ||
          String(s.emailOrRoll || '').toLowerCase() ===
            String(currentStudent.emailOrRoll || '').toLowerCase())
    );
    if (
      match &&
      (match.photoUrl !== currentStudent.photoUrl ||
        match.fullName !== currentStudent.fullName ||
        match.securityQuestion !== currentStudent.securityQuestion ||
        match.id !== currentStudent.id)
    ) {
      const merged: StudentAccount = {
        ...currentStudent,
        ...match,
      };
      setCurrentStudent(merged);
      localStorage.setItem('neet_cbt_student_session', JSON.stringify(merged));
    }
  }, [students]);

  // Lookup matched student when email is typed in Forgot Password mode so we can display their chosen Security Question
  const matchedStudentForForgot = useMemo(() => {
    const cleanEmail = sanitizeInput(authEmailOrRoll, 120).toLowerCase();
    if (!cleanEmail) return undefined;
    return students.find((s) => String(s?.emailOrRoll || '').toLowerCase() === cleanEmail);
  }, [authEmailOrRoll, students]);

  // Handle Admin Credentials Verification with Anti-Brute-Force Protection
  const handleAdminUnlockSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (botHoneypot) return;
    if (Date.now() < adminLockoutUntil) {
      const waitSecs = Math.ceil((adminLockoutUntil - Date.now()) / 1000);
      setAdminPassError(`Too many failed attempts. Locked for ${waitSecs}s.`);
      return;
    }

    const cleanUser = sanitizeInput(adminUsernameInput, 60).toLowerCase();
    const cleanPass = adminPasswordInput.trim();
    if (cleanUser === ADMIN_USERNAME.toLowerCase() && cleanPass === ADMIN_SECRET_PASS) {
      setIsAdminUnlocked(true);
      setAppMode('studio');
      setShowAdminPassModal(false);
      setAdminUsernameInput('');
      setAdminPasswordInput('');
      setAdminPassError('');
      setAdminFailedAttempts(0);
      showToast(`Admin Studio unlocked! Welcome ${ADMIN_USERNAME}.`, 'success');
    } else {
      const nextFails = adminFailedAttempts + 1;
      setAdminFailedAttempts(nextFails);
      if (nextFails >= 5) {
        setAdminLockoutUntil(Date.now() + 30000);
        setAdminPassError('Security Shield: 5 failed attempts. Locked for 30 seconds.');
      } else {
        setAdminPassError('Invalid Admin Username or Password. Access denied.');
      }
    }
  };

  const handleLockAdminStudio = () => {
    setIsAdminUnlocked(false);
    setAppMode('student');
    showToast('Admin Studio locked. Returned to Student Portal.', 'info');
  };

  // Phone Hardware Back Button Navigation Support (popstate) — depth-tracked so Back never re-pushes states
  const navStateRef = useRef({
    activeRunningTest: false,
    activeNormalPdfModal: false,
    selectedTestForInstructions: false,
    showQuickMenu: false,
    showNotificationsModal: false,
    showProfileModal: false,
    showStudentAuthModal: false,
    showAdminPassModal: false,
    appMode: 'student' as 'student' | 'studio',
    studentTab: 'tests' as StudentPortalTab,
    homeViewStep: 'root' as HomeBrowserStep,
  });
  const prevNavDepthRef = useRef(0);
  const suppressNextPushRef = useRef(false);

  useEffect(() => {
    navStateRef.current = {
      activeRunningTest: Boolean(activeRunningTest),
      activeNormalPdfModal: Boolean(activeNormalPdfModal),
      selectedTestForInstructions: Boolean(selectedTestForInstructions),
      showQuickMenu,
      showNotificationsModal,
      showProfileModal,
      showStudentAuthModal,
      showAdminPassModal,
      appMode,
      studentTab,
      homeViewStep,
    };

    const baseDepth =
      appMode === 'studio'
        ? 1
        : studentTab === 'dashboard' || studentTab === 'mistakes'
          ? 1
          : homeViewStep === 'folder_tests'
            ? 2
            : homeViewStep === 'folders'
              ? 1
              : 0;
    const modalDepth =
      (selectedTestForInstructions ? 1 : 0) +
      (activeRunningTest ? 1 : 0) +
      (activeNormalPdfModal ? 1 : 0) +
      (showQuickMenu ? 1 : 0) +
      (showNotificationsModal ? 1 : 0) +
      (showProfileModal ? 1 : 0) +
      (showStudentAuthModal ? 1 : 0) +
      (showAdminPassModal ? 1 : 0);
    const navDepth = baseDepth + modalDepth;

    if (suppressNextPushRef.current) {
      suppressNextPushRef.current = false;
      prevNavDepthRef.current = navDepth;
      return;
    }

    if (navDepth > prevNavDepthRef.current) {
      try {
        window.history.pushState({ vsNav: true, depth: navDepth }, '');
      } catch {
        // ignore
      }
    }
    prevNavDepthRef.current = navDepth;
  }, [
    activeRunningTest,
    activeNormalPdfModal,
    selectedTestForInstructions,
    showQuickMenu,
    showNotificationsModal,
    showProfileModal,
    showStudentAuthModal,
    showAdminPassModal,
    appMode,
    studentTab,
    homeViewStep,
  ]);

  useEffect(() => {
    const handlePopState = () => {
      const st = navStateRef.current;
      if (st.activeNormalPdfModal) {
        suppressNextPushRef.current = true;
        setActiveNormalPdfModal(null);
        return;
      }
      if (st.showQuickMenu) {
        suppressNextPushRef.current = true;
        setShowQuickMenu(false);
        return;
      }
      if (st.showNotificationsModal) {
        suppressNextPushRef.current = true;
        setShowNotificationsModal(false);
        return;
      }
      if (st.showProfileModal) {
        suppressNextPushRef.current = true;
        setShowProfileModal(false);
        return;
      }
      if (st.showStudentAuthModal) {
        suppressNextPushRef.current = true;
        setShowStudentAuthModal(false);
        return;
      }
      if (st.showAdminPassModal) {
        suppressNextPushRef.current = true;
        setShowAdminPassModal(false);
        return;
      }
      if (st.selectedTestForInstructions) {
        suppressNextPushRef.current = true;
        setSelectedTestForInstructions(null);
        return;
      }
      if (st.activeRunningTest) {
        suppressNextPushRef.current = true;
        try {
          sessionStorage.removeItem('vs_neet_active_test_session_v1');
        } catch {
          // ignore
        }
        setActiveRunningTest(null);
        return;
      }
      if (st.appMode === 'studio') {
        suppressNextPushRef.current = true;
        setAppMode('student');
        return;
      }
      if (st.studentTab === 'dashboard' || st.studentTab === 'mistakes') {
        suppressNextPushRef.current = true;
        setStudentTab('tests');
        return;
      }
      if (st.homeViewStep === 'folder_tests') {
        suppressNextPushRef.current = true;
        setSearchQuery('');
        setHomeViewStep('folders');
        return;
      }
      if (st.homeViewStep === 'folders') {
        suppressNextPushRef.current = true;
        setHomeViewStep('root');
        return;
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  // Complete post-login transition: Ensure Light Mode on first login, ask for Phone Notification Permission, and open pending test
  const completeStudentLogin = (student: StudentAccount, welcomeMsg: string) => {
    try {
      if (!localStorage.getItem('vs_test_first_login_light_done')) {
        localStorage.setItem('vs_test_first_login_light_done', 'true');
        localStorage.setItem('vs_test_theme_mode_v2', 'light');
        setIsDarkMode(false);
      }
    } catch {
      // ignore
    }

    setCurrentStudent(student);
    localStorage.setItem('neet_cbt_student_session', JSON.stringify(student));
    setShowStudentAuthModal(false);
    showToast(welcomeMsg, 'success');

    // Ask for Phone Notification permission immediately upon student login
    void requestPhoneNotificationPermission();

    // Update daily calendar streak for today's login
    incrementDailyStudyStreak('Daily Login');

    if (pendingTestAfterLogin) {
      const target = pendingTestAfterLogin;
      setPendingTestAfterLogin(null);
      setTests((prev) =>
        prev.map((t) => (t.id === target.id ? { ...t, openCount: (t.openCount || 0) + 1 } : t))
      );
      incrementTestEngagement(target.id, 'openCount').catch(() => {});
      void handleStartExamNow(target, 'html');
    }
  };

  // Handle Student Sign Up (Name, Email, Password, Security Question + Answer), Login, and Forgot Password
  const handleStudentAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');

    // Anti-Bot Honeypot Check
    if (botHoneypot.trim() !== '') {
      setAuthError('Automated bot activity detected and blocked.');
      return;
    }

    // Brute-force lockout check
    if (Date.now() < authLockoutUntil) {
      const waitSecs = Math.ceil((authLockoutUntil - Date.now()) / 1000);
      setAuthError(`Security Lockout: Please wait ${waitSecs} seconds before trying again.`);
      return;
    }

    // Verify human math challenge on Sign Up & Forgot Password (or after failed login attempts)
    if (authModalMode !== 'login' || authFailedAttempts >= 2) {
      if (Number(securityAnswerInput.trim()) !== securityNumA + securityNumB) {
        setAuthError(
          `Security Verification failed: Please enter the correct sum (${securityNumA} + ${securityNumB}).`
        );
        refreshSecurityChallenge();
        return;
      }
    }

    const cleanEmail = sanitizeInput(authEmailOrRoll, 120).toLowerCase();
    const cleanPass = authPassword.trim();

    if (!cleanEmail || !cleanPass) {
      setAuthError('Please enter your Email ID and Password.');
      return;
    }

    if (cleanPass.length < 4) {
      setAuthError('Password must be at least 4 characters long.');
      return;
    }

    setIsSubmittingAuth(true);
    try {
      const encodedPass = btoa(encodeURIComponent(cleanPass));
      const matched = students.find(
        (s) => String(s?.emailOrRoll || '').toLowerCase() === cleanEmail
      );

      if (authModalMode === 'forgot') {
        const cleanSecAns = sanitizeInput(authSecurityQuestionAnswer, 100).toLowerCase();
        if (!cleanSecAns) {
          setAuthError(
            'कृपया पासवर्ड रीसेट करने के लिए अपने सुरक्षा प्रश्न का उत्तर दें (Please enter your Security Question answer).'
          );
          setIsSubmittingAuth(false);
          return;
        }

        if (
          matched?.securityAnswer &&
          String(matched.securityAnswer).trim().toLowerCase() !== cleanSecAns
        ) {
          setAuthError(
            'सुरक्षा प्रश्न का उत्तर गलत है! (Incorrect Security Answer for this account. Please enter the exact answer you set during Sign Up.)'
          );
          setIsSubmittingAuth(false);
          return;
        }

        // Forgot Password Flow: Reset password after verifying Security Question Answer
        const resetRecord: StudentAccount = matched
          ? {
              ...matched,
              passwordHash: encodedPass,
              passwordPlain: cleanPass,
              securityQuestion: matched.securityQuestion || authSecurityQuestion,
              securityAnswer: matched.securityAnswer || cleanSecAns,
              loginCount: (matched.loginCount || 1) + 1,
              lastLoginAt: Date.now(),
            }
          : {
              id: `stu_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
              fullName: cleanEmail.split('@')[0],
              emailOrRoll: cleanEmail,
              phone: '',
              passwordHash: encodedPass,
              passwordPlain: cleanPass,
              securityQuestion: authSecurityQuestion,
              securityAnswer: cleanSecAns,
              targetBatch: 'NEET 2027 · Vs Target Batch',
              city: '',
              loginCount: 1,
              createdAt: Date.now(),
              lastLoginAt: Date.now(),
            };

        await saveStudentToFirestore(resetRecord, !matched);
        setStudents((prev) => {
          const next = [resetRecord, ...prev.filter((s) => s.id !== resetRecord.id)];
          try {
            localStorage.setItem('vs_neet_2027_students_cache_v1', JSON.stringify(next));
          } catch {
            // ignore
          }
          return next;
        });
        completeStudentLogin(
          resetRecord,
          `Password reset successful! Welcome back, ${resetRecord.fullName}.`
        );
      } else if (authModalMode === 'signup') {
        const cleanName = sanitizeInput(authFullName, 100);
        const cleanSecAns = sanitizeInput(authSecurityQuestionAnswer, 100).toLowerCase();
        if (!cleanName) {
          setAuthError('Please enter your Full Name.');
          setIsSubmittingAuth(false);
          return;
        }
        if (!cleanSecAns) {
          setAuthError(
            'कृपया पासवर्ड रिकवरी के लिए सुरक्षा प्रश्न का उत्तर लिखें (Please answer the Security Question for Forgot Password recovery).'
          );
          setIsSubmittingAuth(false);
          return;
        }

        if (matched) {
          const updatedExisting: StudentAccount = {
            ...matched,
            fullName: cleanName || matched.fullName,
            passwordHash: encodedPass,
            passwordPlain: cleanPass,
            securityQuestion: authSecurityQuestion,
            securityAnswer: cleanSecAns,
            loginCount: (matched.loginCount || 1) + 1,
            lastLoginAt: Date.now(),
          };
          await saveStudentToFirestore(updatedExisting, false);
          setStudents((prev) => {
            const next = [updatedExisting, ...prev.filter((s) => s.id !== updatedExisting.id)];
            try {
              localStorage.setItem('vs_neet_2027_students_cache_v1', JSON.stringify(next));
            } catch {
              // ignore
            }
            return next;
          });
          completeStudentLogin(
            updatedExisting,
            `Welcome back to Vs Neet 2027, ${updatedExisting.fullName}! Your test history is restored.`
          );
        } else {
          const newStudent: StudentAccount = {
            id: `stu_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
            fullName: cleanName,
            emailOrRoll: cleanEmail,
            phone: '',
            passwordHash: encodedPass,
            passwordPlain: cleanPass,
            securityQuestion: authSecurityQuestion,
            securityAnswer: cleanSecAns,
            targetBatch: 'NEET 2027 · Vs Target Batch',
            city: '',
            loginCount: 1,
            createdAt: Date.now(),
            lastLoginAt: Date.now(),
          };
          await saveStudentToFirestore(newStudent, true);
          setStudents((prev) => {
            const next = [newStudent, ...prev.filter((s) => s.id !== newStudent.id)];
            try {
              localStorage.setItem('vs_neet_2027_students_cache_v1', JSON.stringify(next));
            } catch {
              // ignore
            }
            return next;
          });
          completeStudentLogin(
            newStudent,
            `Account created! Welcome to Vs Neet 2027, ${newStudent.fullName}!`
          );
        }
      } else {
        // Log In Mode (Email + Password only)
        if (
          matched &&
          matched.passwordHash !== encodedPass &&
          matched.passwordHash !== cleanPass &&
          matched.passwordPlain !== cleanPass
        ) {
          const nextFails = authFailedAttempts + 1;
          setAuthFailedAttempts(nextFails);
          if (nextFails >= 5) {
            setAuthLockoutUntil(Date.now() + 30000);
            setAuthError('Too many wrong password attempts. Locked for 30 seconds.');
          } else {
            setAuthError(
              'Incorrect password for this Email. Click "Forgot Password?" below to reset it using your Security Question.'
            );
          }
          refreshSecurityChallenge();
          setIsSubmittingAuth(false);
          return;
        }

        const studentRecord: StudentAccount = matched
          ? {
              ...matched,
              passwordPlain: cleanPass,
              loginCount: (matched.loginCount || 1) + 1,
              lastLoginAt: Date.now(),
            }
          : {
              id: `stu_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
              fullName: cleanEmail.split('@')[0],
              emailOrRoll: cleanEmail,
              phone: '',
              passwordHash: encodedPass,
              passwordPlain: cleanPass,
              targetBatch: 'NEET 2027 · Vs Target Batch',
              city: '',
              loginCount: 1,
              createdAt: Date.now(),
              lastLoginAt: Date.now(),
            };

        setAuthFailedAttempts(0);
        await saveStudentToFirestore(studentRecord, !matched);
        setStudents((prev) => {
          const next = [studentRecord, ...prev.filter((s) => s.id !== studentRecord.id)];
          try {
            localStorage.setItem('vs_neet_2027_students_cache_v1', JSON.stringify(next));
          } catch {
            // ignore
          }
          return next;
        });
        completeStudentLogin(
          studentRecord,
          `Welcome back, ${studentRecord.fullName}! Your test history is synced.`
        );
      }

      setAuthFullName('');
      setAuthEmailOrRoll('');
      setAuthPassword('');
      setAuthSecurityQuestionAnswer('');
      refreshSecurityChallenge();
    } catch {
      setAuthError('Authentication failed. Please try again.');
    } finally {
      setIsSubmittingAuth(false);
    }
  };

  // Open Post-Login Student Profile Modal
  const openStudentProfileModal = () => {
    if (!currentStudent) return;
    setProfileName(currentStudent.fullName || '');
    setProfilePhone(currentStudent.phone || '');
    setProfileBatch(currentStudent.targetBatch || 'NEET 2027 · Vs Target Batch');
    setProfileCity(currentStudent.city || '');
    setProfilePhotoUrl(currentStudent.photoUrl || '');
    setProfileSecurityQuestion(
      currentStudent.securityQuestion || SECURITY_QUESTIONS_LIST[0]
    );
    setProfileSecurityAnswer(currentStudent.securityAnswer || '');
    setProfileNewPassword('');
    setShowProfileModal(true);
  };

  // Handle Profile Photo Upload (Post-Login)
  const handleProfilePhotoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    try {
      const compressedDataUrl = await compressProfileImage(file);
      setProfilePhotoUrl(compressedDataUrl);
      showToast('Profile photo ready! Click "Save Profile" to update.', 'info');
    } catch {
      showToast('Could not process image. Please try another photo.', 'error');
    }
  };

  // Save Post-Login Student Profile Updates (Photo, Name, Mobile, Batch, City, Password, Security Question)
  const handleSaveStudentProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentStudent) return;
    const cleanName = sanitizeInput(profileName, 100);
    if (!cleanName) {
      showToast('Full Name cannot be empty.', 'error');
      return;
    }

    setIsSavingProfile(true);
    try {
      const newPass = profileNewPassword.trim();
      const cleanSecAns = sanitizeInput(profileSecurityAnswer, 100).toLowerCase();
      const updatedStudent: StudentAccount = {
        ...currentStudent,
        fullName: cleanName,
        phone: sanitizeInput(profilePhone, 30),
        targetBatch: sanitizeInput(profileBatch, 120) || 'NEET 2027 · Vs Target Batch',
        city: sanitizeInput(profileCity, 80),
        photoUrl: profilePhotoUrl || undefined,
        securityQuestion: profileSecurityQuestion,
        securityAnswer: cleanSecAns || currentStudent.securityAnswer,
        passwordHash: newPass
          ? btoa(encodeURIComponent(newPass))
          : currentStudent.passwordHash,
        passwordPlain: newPass ? newPass : currentStudent.passwordPlain,
        lastLoginAt: Date.now(),
      };

      await saveStudentToFirestore(updatedStudent, true);
      setCurrentStudent(updatedStudent);
      localStorage.setItem('neet_cbt_student_session', JSON.stringify(updatedStudent));
      setShowProfileModal(false);
      showToast('Profile & Photo updated successfully!', 'success');
    } catch {
      showToast('Failed to update profile.', 'error');
    } finally {
      setIsSavingProfile(false);
    }
  };

  const handleStudentLogout = () => {
    setCurrentStudent(null);
    setShowProfileModal(false);
    localStorage.removeItem('neet_cbt_student_session');
    signOutUser().catch(() => {});
    showToast('Logged out of Student account.', 'info');
  };

  // Helper to generate clean companion question slots for custom HTML/PDF tests (NEVER clones prayas_06!)
  const createCleanCompanionSlots = (test: CbtTestMeta): CbtQuestion[] => {
    const count = Math.max(1, Number(test.totalQuestions) || 90);
    return Array.from({ length: count }, (_, idx) => ({
      id: idx + 1,
      chapter: test.chapter || test.subject || 'NEET Syllabus',
      questionHi: `प्रश्न ${idx + 1} (${test.title})`,
      questionEn: `Question ${idx + 1} (${test.title})`,
      optionsHi: [
        { id: '1', text: 'विकल्प (1)' },
        { id: '2', text: 'विकल्प (2)' },
        { id: '3', text: 'विकल्प (3)' },
        { id: '4', text: 'विकल्प (4)' },
      ],
      optionsEn: [
        { id: '1', text: 'Option (1)' },
        { id: '2', text: 'Option (2)' },
        { id: '3', text: 'Option (3)' },
        { id: '4', text: 'Option (4)' },
      ],
      correctAnswer: '1',
      explanation: {
        hi: `${test.title} की उत्तर कुंजी के अनुसार।`,
        en: `As per ${test.title} official answer key.`,
      },
    }));
  };

  // Load questions for any test (from Memory Cache -> IndexedDB Vault -> Server Store)
  const loadQuestionsForTest = async (test: CbtTestMeta): Promise<CbtQuestion[]> => {
    if (localQuestionsCache[test.id] && localQuestionsCache[test.id].length > 0) {
      return localQuestionsCache[test.id].map((q, idx) => normalizeCbtQuestion(q, idx));
    }
    if (test.id === 'prayas_06' || test.assetUrl) {
      const qs = await loadBuiltInPrayas06Questions();
      if (qs.length > 0) {
        setLocalQuestionsCache((prev) => ({ ...prev, [test.id]: qs }));
        return qs;
      }
    }
    try {
      const bundle = await loadTestBundleFromFirestore(test.id);
      if (bundle.rawHtml) {
        setLocalRawHtmlCache((prev) => ({ ...prev, [test.id]: bundle.rawHtml }));
      }
      if (bundle.questions.length > 0) {
        setLocalQuestionsCache((prev) => ({ ...prev, [test.id]: bundle.questions }));
        return bundle.questions;
      }
      if (bundle.rawHtml) {
        const parsedFromHtml = parseCbtHtmlFile(bundle.rawHtml, test.title);
        if (parsedFromHtml && parsedFromHtml.questions.length > 0) {
          setLocalQuestionsCache((prev) => ({ ...prev, [test.id]: parsedFromHtml.questions }));
          return parsedFromHtml.questions;
        }
        const slots = createCleanCompanionSlots(test);
        setLocalQuestionsCache((prev) => ({ ...prev, [test.id]: slots }));
        return slots;
      }
    } catch {
      // ignore
    }

    if (test.id === 'prayas_06') {
      await loadBuiltInPrayas06Questions();
      return generateFallbackQuestionsForTest(test);
    }

    const cleanSlots = createCleanCompanionSlots(test);
    setLocalQuestionsCache((prev) => ({ ...prev, [test.id]: cleanSlots }));
    return cleanSlots;
  };

  // Load raw test paper source for a test (checks Local Cache, Built-In Asset, Permanent IndexedDB Vault, and Server chunks)
  const loadRawHtmlForTest = async (test: CbtTestMeta): Promise<string> => {
    if (localRawHtmlCache[test.id]) {
      return localRawHtmlCache[test.id];
    }
    if (test.id === 'prayas_06' || test.assetUrl) {
      const builtInHtml = await loadBuiltInPrayas06Html();
      if (builtInHtml) {
        setLocalRawHtmlCache((prev) => ({ ...prev, [test.id]: builtInHtml }));
        return builtInHtml;
      }
    }
    const bundle = await loadTestBundleFromFirestore(test.id);
    if (bundle.rawHtml) {
      setLocalRawHtmlCache((prev) => ({ ...prev, [test.id]: bundle.rawHtml }));
      return bundle.rawHtml;
    }
    return '';
  };

  // Live Student Presence & Active Test Heartbeat (Tracks when student was online & which test they are currently giving)
  useEffect(() => {
    if (!currentStudent) return;
    const isReviewOnly = Boolean(activeRunningTest?.reviewAttempt);
    const activeId = !isReviewOnly && activeRunningTest?.meta?.id ? activeRunningTest.meta.id : null;
    const activeTitle =
      !isReviewOnly && activeRunningTest?.meta?.title ? activeRunningTest.meta.title : null;

    const sendHeartbeat = () => {
      updateStudentPresenceInFirestore({
        studentId: currentStudent.id,
        emailOrRoll: currentStudent.emailOrRoll,
        fullName: currentStudent.fullName,
        activeTestId: activeId,
        activeTestTitle: activeTitle,
      }).catch(() => {});
    };

    sendHeartbeat();
    const timer = window.setInterval(sendHeartbeat, 25000);
    return () => window.clearInterval(timer);
  }, [
    currentStudent?.id,
    currentStudent?.emailOrRoll,
    currentStudent?.fullName,
    activeRunningTest?.meta?.id,
    activeRunningTest?.meta?.title,
    activeRunningTest?.reviewAttempt,
  ]);

  // Clear any legacy session key on mount so the portal always opens cleanly
  useEffect(() => {
    try {
      sessionStorage.removeItem('vs_neet_active_test_session_v1');
    } catch {
      // ignore
    }
  }, []);

  // Increment playCount and launch the Exam Runner in single-request instant HTML Mode (or Practice Mode)
  const handleStartExamNow = async (
    test: CbtTestMeta,
    modeOverride?: 'html' | 'practice'
  ) => {
    if (test.scheduledAt && test.scheduledAt > Date.now() && !isAdminUnlocked) {
      showToast('⏰ This test is still scheduled and locked until its start time.', 'error');
      return;
    }
    setIsLoadingTestQuestions(true);
    try {
      let rawHtml = localRawHtmlCache[test.id] || '';
      let qs = localQuestionsCache[test.id] || [];

      if (test.id === 'prayas_06' || test.assetUrl) {
        if (!rawHtml || qs.length === 0) {
          const [bHtml, bQs] = await Promise.all([
            rawHtml ? Promise.resolve(rawHtml) : loadBuiltInPrayas06Html(),
            qs.length > 0 ? Promise.resolve(qs) : loadBuiltInPrayas06Questions(),
          ]);
          rawHtml = bHtml;
          qs = bQs;
        }
      } else if (!rawHtml && qs.length === 0) {
        // Single fast bundle load from RAM / IndexedDB Vault (~5ms) / Server Store
        const bundle = await loadTestBundleFromFirestore(test.id);
        rawHtml = bundle.rawHtml;
        qs = bundle.questions;
      } else if (!rawHtml) {
        const bundle = await loadTestBundleFromFirestore(test.id);
        if (bundle.rawHtml) rawHtml = bundle.rawHtml;
        if (bundle.questions.length > 0) qs = bundle.questions;
      }

      if (rawHtml) {
        // Keep only the active test's rawHtml in React state so mobile RAM is never exhausted
        setLocalRawHtmlCache({ [test.id]: rawHtml });
      }
      if (qs.length === 0 && rawHtml) {
        const parsed = parseCbtHtmlFile(rawHtml, test.title);
        qs = parsed && parsed.questions.length > 0 ? parsed.questions : createCleanCompanionSlots(test);
      }
      if (qs.length === 0) {
        qs = createCleanCompanionSlots(test);
      }
      setLocalQuestionsCache({ ...BUILT_IN_COMPANION_QUESTIONS, [test.id]: qs });

      setTests((prev) =>
        prev.map((t) => (t.id === test.id ? { ...t, playCount: (t.playCount || 0) + 1 } : t))
      );
      incrementTestEngagement(test.id, 'playCount').catch(() => {});

      const launchMode = modeOverride || selectedExamLaunchMode;

      setSelectedTestForInstructions(null);
      setActiveRunningTest({
        meta: test,
        questions: qs,
        practiceMode: launchMode === 'practice',
        rawHtmlContent: rawHtml,
        initialHtmlMode: launchMode !== 'practice',
        reviewAttempt: null,
      });
    } catch {
      showToast('Failed to start exam.', 'error');
    } finally {
      setIsLoadingTestQuestions(false);
    }
  };

  // Enforce Student Login/Sign-Up & Scheduled Time Check before opening any test card (unless Admin is previewing)
  const handleStudentOpenTestCard = async (test: CbtTestMeta) => {
    if (test.scheduledAt && test.scheduledAt > Date.now() && !isAdminUnlocked) {
      const unlockStr = new Date(test.scheduledAt).toLocaleString('en-IN', {
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      });
      showToast(
        `⏰ यह टेस्ट ${unlockStr} पर खुलेगा (This test is scheduled to unlock at ${unlockStr}).`,
        'info'
      );
      return;
    }

    if (!currentStudent && !isAdminUnlocked) {
      setPendingTestAfterLogin(test);
      setAuthModalMode('login');
      setAuthError('');
      refreshSecurityChallenge();
      setShowStudentAuthModal(true);
      showToast(
        'कृपया टेस्ट देने के लिए पहले Login या Sign Up करें / Please Log In or Sign Up first!',
        'error'
      );
      return;
    }

    setTests((prev) =>
      prev.map((t) => (t.id === test.id ? { ...t, openCount: (t.openCount || 0) + 1 } : t))
    );
    incrementTestEngagement(test.id, 'openCount').catch(() => {});

    if (test.isPdfOnly) {
      const matchedFolder = folders.find((f) => f.id === test.folderId);
      const pdfId =
        test.attachmentPdfId || matchedFolder?.attachmentPdfId || globalAttachmentPdf?.id || '';
      const pdfUrl = pdfId
        ? `/api/store/pdf/${encodeURIComponent(pdfId)}`
        : `/api/store/test/${encodeURIComponent(test.id)}/syllabus.pdf`;
      setActiveNormalPdfModal({
        url: pdfUrl,
        title: test.title,
        fileName: test.attachmentPdfName || `${test.title}.pdf`,
      });
      return;
    }

    await handleStartExamNow(test, 'html');
  };

  // Open a previously completed test directly in Post-Submission Analysis & Solutions mode
  const handleAnalyzeCompletedAttempt = async (attempt: TestAttempt) => {
    const matchedTest =
      tests.find((t) => t.id === attempt.testId) ||
      DEFAULT_SEED_TESTS.find((t) => t.id === attempt.testId) || {
        id: attempt.testId,
        title: attempt.testTitle,
        subTitle: 'Completed Test Attempt Review',
        subject: 'Biology',
        difficulty: 'Medium' as TestDifficulty,
        chapter: 'Full Syllabus Review',
        durationMinutes: 180,
        totalQuestions:
          attempt.correctCount + attempt.wrongCount + attempt.unattemptedCount || 90,
        maxMarks: attempt.maxMarks || 360,
        correctMarks: 4,
        negativeMarks: 1,
        openCount: 1,
        playCount: 1,
        completionCount: 1,
        totalScoreSum: attempt.score,
        highScore: attempt.score,
        createdAt: attempt.completedAt,
      };

    setIsLoadingTestQuestions(true);
    showToast('Opening detailed Test Analysis & Solutions...', 'info');
    try {
      const [qs, rawHtml] = await Promise.all([
        loadQuestionsForTest(matchedTest),
        loadRawHtmlForTest(matchedTest).catch(() => ''),
      ]);
      setSelectedTestForInstructions(null);
      setActiveRunningTest({
        meta: matchedTest,
        questions: qs,
        rawHtmlContent: rawHtml,
        practiceMode: false,
        reviewAttempt: attempt,
      });
    } catch {
      showToast('Could not open test analysis.', 'error');
    } finally {
      setIsLoadingTestQuestions(false);
    }
  };

  // Admin handlers
  const handleAdminSaveTest = async (
    meta: CbtTestMeta,
    questions?: CbtQuestion[],
    rawHtml?: string,
    options?: {
      awaitServerSync?: boolean;
      explicitAdminCreate?: boolean;
      skipLocalVault?: boolean;
      skipLocalStateUpdate?: boolean;
      onProgress?: (transferredBytes: number, totalBytes: number) => void;
    }
  ) => {
    // Only un-delete if Admin explicitly saved/created a test
    if (options?.explicitAdminCreate) {
      try {
        const rawDel = localStorage.getItem('vs_neet_deleted_test_ids_v1');
        if (rawDel) {
          const parsed = (JSON.parse(rawDel) as string[]).filter((id) => id !== meta.id);
          localStorage.setItem('vs_neet_deleted_test_ids_v1', JSON.stringify(parsed));
        }
      } catch {
        // ignore
      }
    }

    // Bound React RAM cache to 2 most recent tests so 5GB+ batch uploads never cause browser memory bloat
    if (questions && questions.length > 0 && !options?.awaitServerSync) {
      const normalized = questions.map((q, idx) => normalizeCbtQuestion(q, idx));
      setLocalQuestionsCache((prev) => {
        const recentEntries = Object.entries(prev)
          .filter(([k]) => k !== meta.id)
          .slice(-2);
        return { ...Object.fromEntries(recentEntries), [meta.id]: normalized };
      });
    }
    if (rawHtml && rawHtml.trim().length > 0 && !options?.awaitServerSync) {
      setLocalRawHtmlCache((prev) => {
        const recentEntries = Object.entries(prev)
          .filter(([k]) => k !== meta.id)
          .slice(-2);
        return { ...Object.fromEntries(recentEntries), [meta.id]: rawHtml };
      });
    }
    const hasExplicitTestBanner = Object.prototype.hasOwnProperty.call(meta, 'bannerUrl');
    const normalizedMeta: CbtTestMeta = {
      ...meta,
      bannerUrl: meta.bannerUrl ? String(meta.bannerUrl) : undefined,
    };
    if (!options?.skipLocalStateUpdate) {
      setTests((prev) => {
        const exists = prev.some((t) => t.id === normalizedMeta.id);
        const next = exists
          ? prev.map((t) => {
              if (t.id !== normalizedMeta.id) return t;
              return {
                ...t,
                ...normalizedMeta,
                bannerUrl: hasExplicitTestBanner ? normalizedMeta.bannerUrl : t.bannerUrl,
              };
            })
          : [normalizedMeta, ...prev];
        saveTestsMetaToLocalStorageSafe(next);
        return next;
      });
    }
    await saveTestToFirestore(meta, questions, rawHtml, options);
    if (!options?.awaitServerSync && !options?.skipLocalStateUpdate) {
      await syncPortalStore(meta.id).catch(() => {});
    }
  };

  const handleAdminDeleteTest = async (testId: string) => {
    markTestDeletedLocally(testId);
    setLocalQuestionsCache((prev) => {
      if (!prev[testId]) return prev;
      const next = { ...prev };
      delete next[testId];
      return next;
    });
    setLocalRawHtmlCache((prev) => {
      if (!prev[testId]) return prev;
      const next = { ...prev };
      delete next[testId];
      return next;
    });
    setTests((prev) => {
      const next = prev.filter((t) => t.id !== testId);
      saveTestsMetaToLocalStorageSafe(next);
      return next;
    });
    try {
      await deleteTestFromFirestore(testId);
      await syncPortalStore(testId);
      showToast('Test permanently deleted from portal across all devices.', 'info');
    } catch {
      showToast('Removed test permanently.', 'info');
    }
  };

  const handleAdminSaveFolder = async (folder: TestFolder) => {
    const hasExplicitFolderBanner = Object.prototype.hasOwnProperty.call(folder, 'bannerUrl');
    const normalizedFolder: TestFolder = {
      ...folder,
      bannerUrl: folder.bannerUrl ? String(folder.bannerUrl) : undefined,
    };
    setFolders((prev) => {
      const exists = prev.some((f) => f.id === normalizedFolder.id);
      const next = exists
        ? prev.map((f) => {
            if (f.id !== normalizedFolder.id) return f;
            return {
              ...f,
              ...normalizedFolder,
              bannerUrl: hasExplicitFolderBanner ? normalizedFolder.bannerUrl : f.bannerUrl,
            };
          })
        : [...prev, normalizedFolder];
      saveFoldersToLocalStorageSafe(next);
      return next;
    });
    await saveFolderToFirestore(folder);
    await syncPortalStore('folder_updated');
  };

  const handleAdminDeleteFolder = async (folderId: string) => {
    try {
      const rawDelFolders = localStorage.getItem('vs_neet_deleted_folder_ids_v1');
      const existing = rawDelFolders ? (JSON.parse(rawDelFolders) as string[]) : [];
      if (!existing.includes(folderId)) {
        localStorage.setItem('vs_neet_deleted_folder_ids_v1', JSON.stringify([...existing, folderId]));
      }
    } catch {
      // ignore
    }
    setFolders((prev) => {
      const next = prev.filter((f) => f.id !== folderId);
      try {
        localStorage.setItem('vs_neet_2027_folders_cache_v1', JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
    await deleteFolderFromFirestore(folderId);
    await syncPortalStore('force_refresh');
  };

  const handleAdminSendNotification = async (
    notifData: Omit<PortalNotification, 'id' | 'createdAt'>
  ): Promise<PortalNotification | null> => {
    const newNotif: PortalNotification = {
      ...notifData,
      id: `notif_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      createdAt: Date.now(),
    };
    lastDeliveredNotifIdRef.current = newNotif.id;
    setNotifications((prev) => [newNotif, ...prev]);
    const saved = await sendNotificationToFirestore(newNotif);
    triggerNativePhoneNotification(saved || newNotif);
    await syncPortalStore();
    return saved || newNotif;
  };

  const handleAdminDeleteNotification = async (notifId: string) => {
    setNotifications((prev) => prev.filter((n) => n.id !== notifId));
    await deleteNotificationFromFirestore(notifId);
    await syncPortalStore();
    showToast('Notification deleted.', 'info');
  };

  const handleSimulateEngagement = async (testId: string, field: 'openCount' | 'playCount') => {
    setTests((prev) =>
      prev.map((t) => (t.id === testId ? { ...t, [field]: (t[field] || 0) + 1 } : t))
    );
    await incrementTestEngagement(testId, field);
    showToast(
      `Incremented ${field === 'openCount' ? 'Open Count' : 'Play Count'}!`,
      'success'
    );
  };

  // Unread notifications count for student Bell icon
  const unreadNotifCount = useMemo(() => {
    return notifications.filter((n) => (n.createdAt || 0) > lastSeenNotifTime).length;
  }, [notifications, lastSeenNotifTime]);

  const openNotificationsDrawer = () => {
    const now = Date.now();
    setLastSeenNotifTime(now);
    try {
      localStorage.setItem('vs_neet_last_seen_notif_ts', String(now));
    } catch {
      // ignore
    }
    setShowNotificationsModal(true);
    if (
      typeof window !== 'undefined' &&
      'Notification' in window &&
      Notification.permission === 'default'
    ) {
      Notification.requestPermission()
        .then((p) => setNotifPermissionState(p))
        .catch(() => {});
    }
  };

  const handleAdminUpdatePortalLogo = async (newLogoUrl: string) => {
    const cleanLogo = newLogoUrl.trim() || DEFAULT_PORTAL_LOGO;
    setPortalLogoUrl(cleanLogo);
    await savePortalLogoToFirestore(cleanLogo);
    await syncPortalStore('force_refresh');
  };

  const handleAdminDeleteStudent = async (studentId: string) => {
    setStudents((prev) => prev.filter((s) => s.id !== studentId));
    await deleteStudentFromFirestore(studentId);
    await syncPortalStore('force_refresh');
    showToast('Student record deleted.', 'info');
  };

  // Student's personal attempts & stats — ONLY shows tests given by this student/device, deduplicated so 1 completed test = 1 card
  const studentPersonalAttempts = useMemo(() => {
    let deviceAttemptIds = new Set<string>();
    try {
      const rawDev = localStorage.getItem('vs_neet_my_device_attempt_ids_v1');
      if (rawDev) {
        const parsed = JSON.parse(rawDev);
        if (Array.isArray(parsed)) deviceAttemptIds = new Set(parsed.map(String));
      }
    } catch {
      // ignore
    }

    const emailLower = currentStudent
      ? String(currentStudent.emailOrRoll || '').trim().toLowerCase()
      : '';
    const stuId = currentStudent ? String(currentStudent.id || '').trim() : '';

    const matched = attempts.filter((a) => {
      if (!a || !a.testId) return false;
      if (currentStudent) {
        const aEmail = String(a.studentEmail || '').trim().toLowerCase();
        const aStuId = String(a.studentId || '').trim();
        if (stuId && aStuId === stuId) return true;
        if (emailLower && aEmail === emailLower) return true;
        if (a.id && deviceAttemptIds.has(a.id) && (!aEmail || aEmail === emailLower)) return true;
        return false;
      }
      return Boolean(a.id && (deviceAttemptIds.has(a.id) || String(a.id).startsWith('local_')));
    });

    // Deduplicate by testId so each test attempted shows once (with its latest attempt)
    const byTestId = new Map<string, TestAttempt>();
    const sorted = [...matched].sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0));
    for (const att of sorted) {
      if (!byTestId.has(att.testId)) {
        byTestId.set(att.testId, att);
      }
    }
    return Array.from(byTestId.values());
  }, [attempts, currentStudent]);

  // ============================================================================
  // ACCURATE DAILY STUDY STREAK ENGINE (Increments ONLY Once Per Calendar Day)
  // ============================================================================
  const [streakDaysHistory, setStreakDaysHistory] = useState<string[]>(() => {
    try {
      const todayKey = getLocalDateKey();
      const raw = localStorage.getItem('vs_neet_daily_streak_days_v2');
      const parsed = raw ? (JSON.parse(raw) as string[]) : [];
      const set = new Set<string>(Array.isArray(parsed) ? parsed : []);
      const lastDate = localStorage.getItem('vs_neet_daily_streak_date');
      if (lastDate) set.add(lastDate);
      if (set.size === 0) set.add(todayKey);
      return Array.from(set).sort();
    } catch {
      return [getLocalDateKey()];
    }
  });

  const [studyStreak, setStudyStreak] = useState<number>(() => {
    try {
      const todayKey = getLocalDateKey();
      const yesterdayKey = getLocalDateKey(Date.now() - 86400000);
      const lastDate = localStorage.getItem('vs_neet_daily_streak_date') || '';
      const savedCount = Number(localStorage.getItem('vs_neet_daily_streak_count') || '0');
      if (lastDate === todayKey) {
        return Math.max(1, savedCount || 1);
      }
      if (lastDate === yesterdayKey) {
        const nextDayCount = Math.max(1, savedCount) + 1;
        localStorage.setItem('vs_neet_daily_streak_date', todayKey);
        localStorage.setItem('vs_neet_daily_streak_count', String(nextDayCount));
        return nextDayCount;
      }
      localStorage.setItem('vs_neet_daily_streak_date', todayKey);
      localStorage.setItem('vs_neet_daily_streak_count', '1');
      return 1;
    } catch {
      return 1;
    }
  });

  // Sync student's saved dailyStreak and attempt dates into the active streak state
  useEffect(() => {
    const attemptDates = studentPersonalAttempts
      .map((a) => (a.completedAt ? getLocalDateKey(a.completedAt) : ''))
      .filter(Boolean);
    if (attemptDates.length > 0) {
      setStreakDaysHistory((prev) => {
        const merged = Array.from(new Set([...prev, ...attemptDates])).sort();
        if (merged.length === prev.length) return prev;
        try {
          localStorage.setItem('vs_neet_daily_streak_days_v2', JSON.stringify(merged.slice(-60)));
        } catch {
          // ignore
        }
        return merged;
      });
    }
    if (currentStudent?.dailyStreak && currentStudent.dailyStreak > studyStreak) {
      const todayKey = getLocalDateKey();
      const yesterdayKey = getLocalDateKey(Date.now() - 86400000);
      if (
        currentStudent.lastStreakDate === todayKey ||
        currentStudent.lastStreakDate === yesterdayKey
      ) {
        setStudyStreak(currentStudent.dailyStreak);
        try {
          localStorage.setItem('vs_neet_daily_streak_count', String(currentStudent.dailyStreak));
          localStorage.setItem('vs_neet_daily_streak_date', todayKey);
        } catch {
          // ignore
        }
      }
    }
  }, [currentStudent, studentPersonalAttempts, studyStreak]);

  // 7-Day Current Week Tracker (Mon - Sun) for visual Day Streak display
  const currentWeekDays = useMemo(() => {
    const today = new Date();
    const todayKey = getLocalDateKey(today.getTime());
    const dayOfWeek = today.getDay(); // 0 (Sun) - 6 (Sat)
    const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const monday = new Date(today);
    monday.setHours(12, 0, 0, 0);
    monday.setDate(today.getDate() + diffToMonday);

    const activeSet = new Set(streakDaysHistory);
    activeSet.add(todayKey);

    const labels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    return labels.map((label, idx) => {
      const d = new Date(monday);
      d.setDate(monday.getDate() + idx);
      const dateKey = getLocalDateKey(d.getTime());
      return {
        label,
        dateNum: d.getDate(),
        dateKey,
        isToday: dateKey === todayKey,
        isCompleted: activeSet.has(dateKey),
      };
    });
  }, [streakDaysHistory]);

  // Strictly increments only once per calendar day (if already incremented today, keeps today's count)
  const incrementDailyStudyStreak = (reasonLabel: string) => {
    const todayKey = getLocalDateKey();
    const yesterdayKey = getLocalDateKey(Date.now() - 86400000);

    setStreakDaysHistory((prev) => {
      const next = Array.from(new Set([...prev, todayKey])).sort();
      try {
        localStorage.setItem('vs_neet_daily_streak_days_v2', JSON.stringify(next.slice(-60)));
      } catch {
        // ignore
      }
      return next;
    });

    const lastDate = localStorage.getItem('vs_neet_daily_streak_date') || '';
    if (lastDate === todayKey) {
      // Already counted for today's calendar date
      return;
    }

    setStudyStreak((prev) => {
      const nextCount = lastDate === yesterdayKey ? Math.max(1, prev) + 1 : 1;
      try {
        localStorage.setItem('vs_neet_daily_streak_count', String(nextCount));
        localStorage.setItem('vs_neet_daily_streak_date', todayKey);
      } catch {
        // ignore
      }
      if (currentStudent) {
        const updatedStudent: StudentAccount = {
          ...currentStudent,
          dailyStreak: nextCount,
          lastStreakDate: todayKey,
        };
        setCurrentStudent(updatedStudent);
        try {
          localStorage.setItem('neet_cbt_student_session', JSON.stringify(updatedStudent));
        } catch {
          // ignore
        }
        saveStudentToFirestore(updatedStudent).catch(() => {});
      }
      showToast(`🔥 Day Streak: ${nextCount} Days (${reasonLabel})!`, 'success');
      return nextCount;
    });
  };

  // Secret Trick Handler: ONLY 4 Clicks on "Vs Tests" next to the Logo opens Admin Login Modal (nowhere else!)
  const handleSecretAdminTap = () => {
    if (logoTapTimerRef.current) {
      window.clearTimeout(logoTapTimerRef.current);
    }
    const nextTap = logoTapCountRef.current + 1;
    if (nextTap >= 4) {
      logoTapCountRef.current = 0;
      setAdminPassError('');
      setAdminUsernameInput('');
      setAdminPasswordInput('');
      setShowAdminPassModal(true);
    } else {
      logoTapCountRef.current = nextTap;
      logoTapTimerRef.current = window.setTimeout(() => {
        logoTapCountRef.current = 0;
      }, 2200);
    }
  };

  const handleStudentSubmitAttempt = async (attempt: Omit<TestAttempt, 'id'>) => {
    try {
      sessionStorage.removeItem('vs_neet_active_test_session_v1');
    } catch {
      // ignore
    }
    const attemptId = `att_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    try {
      const rawDev = localStorage.getItem('vs_neet_my_device_attempt_ids_v1');
      const existingDev: string[] = rawDev ? JSON.parse(rawDev) : [];
      localStorage.setItem(
        'vs_neet_my_device_attempt_ids_v1',
        JSON.stringify(Array.from(new Set([attemptId, ...existingDev])).slice(0, 200))
      );
    } catch {
      // ignore
    }

    const enrichedAttempt: Omit<TestAttempt, 'id'> & { id?: string } = {
      ...attempt,
      id: attemptId,
      studentId: currentStudent?.id || attempt.studentId,
      studentEmail: currentStudent?.emailOrRoll?.toLowerCase() || attempt.studentEmail,
      studentName: currentStudent?.fullName || attempt.studentName,
    };
    const newAttempt: TestAttempt = { ...enrichedAttempt, id: attemptId };
    setAttempts((prev) => {
      const filtered = prev.filter((a) => a.testId !== newAttempt.testId || a.studentId !== newAttempt.studentId);
      const updated = [newAttempt, ...filtered];
      try {
        localStorage.setItem('vs_neet_2027_attempts_cache', JSON.stringify(updated.slice(0, 80)));
      } catch {
        // ignore storage quota
      }
      return updated;
    });

    if (attempt.testId === 'mistake_retest_session') {
      showToast(
        `✅ Mistake Re-Test Submitted! Score: ${attempt.score}/${attempt.maxMarks} (${attempt.accuracy}%)`,
        'success'
      );
    }

    const targetTest = tests.find((t) => t.id === attempt.testId);
    const prevHigh = targetTest?.highScore || 0;

    setTests((prev) =>
      prev.map((t) =>
        t.id === attempt.testId
          ? {
              ...t,
              completionCount: (t.completionCount || 0) + 1,
              totalScoreSum: (t.totalScoreSum || 0) + attempt.score,
              highScore: Math.max(prevHigh, attempt.score),
            }
          : t
      )
    );

    // Increment Daily Study Streak when a student completes a test
    incrementDailyStudyStreak('Test Completed');

    await recordTestCompletion(enrichedAttempt, prevHigh);
    await syncPortalStore('force_refresh');
  };

  // Allow students to delete a completed test attempt from their Homepage Completed Tests section
  const handleStudentDeleteAttempt = async (attempt: TestAttempt) => {
    const targetId = attempt.id;
    try {
      const rawDelAtt = localStorage.getItem('vs_neet_deleted_attempt_ids_v1');
      const existing = rawDelAtt ? (JSON.parse(rawDelAtt) as string[]) : [];
      const key = attempt.id || `${attempt.testId}_${attempt.completedAt}`;
      const nextDel = Array.from(new Set([...existing, targetId, key].filter(Boolean)));
      localStorage.setItem('vs_neet_deleted_attempt_ids_v1', JSON.stringify(nextDel));
    } catch {
      // ignore
    }

    setAttempts((prev) => {
      const next = prev.filter(
        (a) =>
          a.id !== targetId &&
          !(a.testId === attempt.testId && a.completedAt === attempt.completedAt)
      );
      try {
        localStorage.setItem('vs_neet_2027_attempts_cache', JSON.stringify(next.slice(0, 80)));
      } catch {
        // ignore
      }
      return next;
    });

    if (targetId && !targetId.startsWith('local_')) {
      await deleteAttemptFromFirestore(targetId);
    }
    showToast('Completed test record deleted from your homepage.', 'info');
  };

  // Filtered tests for Student Portal (by Folder, Subject, and Search query — Pinned tests ALWAYS at the top!)
  const filteredTests = useMemo(() => {
    const qLower = String(searchQuery || '').trim().toLowerCase();
    const subjLower = String(subjectFilter || 'ALL').toLowerCase();
    const knownFolderIds = new Set(folders.map((f) => f.id));
    const fallbackFolderId = folders[0]?.id || 'folder_prayas';

    return tests
      .filter((t) => {
        if (!t || !t.id) return false;
        const effectiveFolderId =
          t.folderId && knownFolderIds.has(t.folderId) ? t.folderId : fallbackFolderId;
        const matchesFolder =
          selectedFolderFilter === 'ALL' || effectiveFolderId === selectedFolderFilter;
        const tSubj = String(t.subject || '').toLowerCase();
        const tTitle = String(t.title || '').toLowerCase();
        const tChap = String(t.chapter || '').toLowerCase();
        const matchesSubject = subjectFilter === 'ALL' || tSubj.includes(subjLower);
        const matchesSearch =
          !qLower || tTitle.includes(qLower) || tChap.includes(qLower) || tSubj.includes(qLower);
        return matchesFolder && matchesSubject && matchesSearch;
      })
      .sort((a, b) => {
        if (Boolean(a.isPinned) !== Boolean(b.isPinned)) {
          return a.isPinned ? -1 : 1;
        }
        if (a.isPinned && b.isPinned && (b.pinnedAt || 0) !== (a.pinnedAt || 0)) {
          return (b.pinnedAt || 0) - (a.pinnedAt || 0);
        }
        return (b.createdAt || 0) - (a.createdAt || 0);
      });
  }, [tests, folders, selectedFolderFilter, subjectFilter, searchQuery]);

  // Map latest attempt by testId for quick "Analyze Completed Test" lookup on Homepage cards
  const latestAttemptByTestId = useMemo(() => {
    const map: Record<string, TestAttempt> = {};
    for (const att of studentPersonalAttempts) {
      if (!map[att.testId]) {
        map[att.testId] = att;
      }
    }
    return map;
  }, [studentPersonalAttempts]);

  // Generate Weak Link Rescue Plan from the Student Analytics Dashboard (Also increments Daily Study Streak)
  const handleGenerateDashboardRescue = async () => {
    if (isLoadingDashboardRescue) return;
    setIsLoadingDashboardRescue(true);
    try {
      const latestAtt = studentPersonalAttempts[0];
      const avgAcc =
        studentPersonalAttempts.length > 0
          ? Math.round(
              studentPersonalAttempts.reduce((s, a) => s + a.accuracy, 0) /
                studentPersonalAttempts.length
            )
          : 65;
      const res = await fetch('/api/ai-weak-link-rescue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          studentName: currentStudent?.fullName || 'NEET Aspirant',
          testTitle: latestAtt?.testTitle || 'VS TEST NEET Overall Performance',
          subject: 'NEET-UG & AIIMS Paramedical Biology, Chemistry & Physics',
          score: latestAtt?.score ?? 240,
          maxMarks: latestAtt?.maxMarks ?? 360,
          accuracy: avgAcc,
          weakChapters: [
            'Plant Kingdom & Bryophytes',
            'Biological Classification & Fungi',
            'Coordination Compounds & Bonding',
            'Human Physiology & Genetics',
          ],
          wrongQuestionsSummary: `${studentPersonalAttempts.length} tests completed, average accuracy ${avgAcc}%`,
        }),
      });
      if (res.ok) {
        const plan = (await res.json()) as WeakLinkRescuePlan;
        setDashboardRescuePlan(plan);
        setDashboardRescueMcqAnswers({});
        incrementDailyStudyStreak('Topic Revised');
      }
    } catch {
      showToast('Could not generate Revision Notes right now.', 'error');
    } finally {
      setIsLoadingDashboardRescue(false);
    }
  };

  // If a student is actively taking or reviewing a test, render the full-screen Exam Runner inside ExamSafeErrorBoundary
  if (activeRunningTest) {
    return (
      <div className="ice-ambient-bg min-h-screen">
        <ExamSafeErrorBoundary
          onExit={() => {
            try {
              sessionStorage.removeItem('vs_neet_active_test_session_v1');
            } catch {
              // ignore
            }
            setActiveRunningTest(null);
          }}
        >
          <CbtExamRunner
            testMeta={activeRunningTest.meta}
            questions={activeRunningTest.questions}
            studentName={currentStudent?.fullName || 'NEET Aspirant'}
            studentId={currentStudent?.id}
            studentEmail={currentStudent?.emailOrRoll}
            studentBatch={currentStudent?.targetBatch}
            practiceMode={activeRunningTest.practiceMode}
            rawHtmlContent={activeRunningTest.rawHtmlContent}
            initialHtmlMode={activeRunningTest.initialHtmlMode}
            initialReviewAttempt={activeRunningTest.reviewAttempt}
            testAttempts={attempts}
            onSyncMistakesAndBookmarks={handleSyncMistakesAndBookmarks}
            onExit={() => {
              try {
                sessionStorage.removeItem('vs_neet_active_test_session_v1');
              } catch {
                // ignore
              }
              setActiveRunningTest(null);
            }}
            onSubmitAttempt={handleStudentSubmitAttempt}
          />
        </ExamSafeErrorBoundary>
      </div>
    );
  }

  return (
    <div className="ice-ambient-bg min-h-screen flex flex-col bg-[#f8fafc] dark:bg-[#090d16] text-black dark:text-white transition-colors duration-200">
      {/* Live Push Notification Banner (Appears when Admin sends a notification to phones) */}
      {liveIncomingNotif && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-50 w-[94%] max-w-lg bg-white dark:bg-slate-900 border-2 border-amber-500 rounded-2xl p-4 shadow-2xl flex items-start justify-between gap-3 animate-in fade-in slide-in-from-top-4 duration-200">
          <div className="flex items-start gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center shrink-0">
              <Bell className="w-5 h-5 text-amber-500 animate-bounce" />
            </div>
            <div className="min-w-0">
              <div className="text-xs font-extrabold uppercase tracking-wider text-amber-600 dark:text-amber-400">
                Vs Test Live Notification
              </div>
              <h4 className="text-base font-black text-black dark:text-white mt-0.5">
                {liveIncomingNotif.title}
              </h4>
              <p className="text-sm font-semibold text-black dark:text-slate-200 mt-0.5">
                {liveIncomingNotif.message}
              </p>
              {liveIncomingNotif.testId && (
                <button
                  type="button"
                  onClick={() => {
                    const target = tests.find((t) => t.id === liveIncomingNotif.testId);
                    setLiveIncomingNotif(null);
                    if (target) {
                      handleStudentOpenTestCard(target);
                    }
                  }}
                  className="mt-2 px-3.5 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-extrabold inline-flex items-center gap-1.5"
                >
                  <Play className="w-3.5 h-3.5 fill-current" />
                  <span>Open Test</span>
                </button>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setLiveIncomingNotif(null)}
            className="p-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-black dark:text-white shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Toast Notification */}
      {toast && (
        <div className="fixed bottom-5 right-5 z-50 max-w-sm bg-white dark:bg-slate-900 rounded-2xl px-4 py-3 shadow-2xl border border-slate-300 dark:border-slate-700 flex items-center gap-2.5">
          {toast.type === 'error' ? (
            <AlertCircle className="w-5 h-5 text-rose-500 shrink-0" />
          ) : (
            <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />
          )}
          <span className="text-sm font-bold text-black dark:text-white">{toast.message}</span>
        </div>
      )}

      {/* Top Navigation Bar — Ice Glass Header with ONLY 'Vs Tests' Name */}
      <header className="sticky top-0 z-40 ice-glass-strong border-b border-white/60 dark:border-slate-800 px-3 sm:px-6 py-2.5 transition-colors">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-2 flex-nowrap">
          {/* Official Vs Tests Logo & Title: ONLY 4-Click Trigger Here Opens Admin Login Modal */}
          <div
            onClick={() => {
              if (appMode === 'studio') {
                setAppMode('student');
              }
              setStudentTab('tests');
              setHomeViewStep('root');
              handleSecretAdminTap();
            }}
            className="flex items-center gap-2.5 cursor-pointer select-none min-w-0"
            title="Vs Tests"
          >
            <img
              src={`${portalLogoUrl || DEFAULT_PORTAL_LOGO}?v=3`}
              alt="Vs Tests"
              className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl object-cover border border-sky-300/80 dark:border-slate-700 shrink-0 shadow-xs"
            />
            <div className="min-w-0">
              <h1 className="text-lg sm:text-xl font-black text-black dark:text-white tracking-tight truncate">
                Vs Tests
              </h1>
            </div>
          </div>

          {/* Top-Right Corner: Notification Bell + Light/Dark Switch + Profile (with Flame Streak) + 3-Line Menu Button */}
          <div className="relative flex items-center gap-1.5 sm:gap-2 shrink-0">
            {/* Notification Bell Icon (Shows Unread Badge & Opens Phone Push Notification Center) */}
            <button
              type="button"
              onClick={openNotificationsDrawer}
              className="relative inline-flex items-center justify-center w-9 h-9 rounded-xl ice-glass text-black dark:text-white transition cursor-pointer"
              title="Notifications & Test Alerts"
              aria-label="Notifications"
            >
              <Bell className="w-4 h-4 text-amber-500" />
              {unreadNotifCount > 0 && (
                <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-rose-600 text-white text-[10px] font-black flex items-center justify-center">
                  {unreadNotifCount}
                </span>
              )}
            </button>

            {/* Dark Mode / Light Mode Toggle Switch */}
            <button
              type="button"
              onClick={() => setIsDarkMode((prev) => !prev)}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl ice-glass text-black dark:text-white text-xs font-bold transition cursor-pointer"
              title={isDarkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
              aria-label="Toggle Dark/Light Mode"
            >
              {isDarkMode ? (
                <>
                  <Sun className="w-4 h-4 text-amber-400 shrink-0" />
                  <span className="hidden md:inline text-white">Light</span>
                </>
              ) : (
                <>
                  <Moon className="w-4 h-4 text-slate-900 shrink-0" />
                  <span className="hidden md:inline text-black">Dark</span>
                </>
              )}
            </button>

            <PWAInstallButton />

            {currentStudent ? (
              <button
                type="button"
                onClick={openStudentProfileModal}
                className="inline-flex items-center gap-1.5 px-2 py-1 rounded-xl ice-glass text-left transition"
                title="My Profile & Daily Study Streak"
              >
                <div className="w-7 h-7 rounded-full overflow-hidden bg-blue-600 text-white flex items-center justify-center font-bold text-xs shrink-0">
                  {currentStudent.photoUrl ? (
                    <img
                      src={currentStudent.photoUrl}
                      alt={currentStudent.fullName || 'Student'}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <span>{(currentStudent.fullName || 'S').charAt(0).toUpperCase()}</span>
                  )}
                </div>
                <span className="text-xs font-bold text-black dark:text-white max-w-[68px] sm:max-w-[110px] truncate">
                  {(currentStudent.fullName || 'Student').split(' ')[0]}
                </span>
                <span
                  className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-lg bg-amber-500/15 dark:bg-amber-500/20 border border-amber-500/40 text-amber-600 dark:text-amber-400 text-[11px] font-black font-mono-tabular shrink-0"
                  title={`Daily Study Streak: ${studyStreak} Days`}
                >
                  <Flame className="w-3.5 h-3.5 fill-amber-500 text-orange-500 shrink-0" />
                  <span>{studyStreak}</span>
                </span>
              </button>
            ) : (
              <div className="inline-flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setStudentTab('dashboard')}
                  className="inline-flex items-center gap-0.5 px-2 py-1.5 rounded-xl bg-amber-500/15 dark:bg-amber-500/20 border border-amber-500/40 text-amber-600 dark:text-amber-400 text-xs font-black font-mono-tabular"
                  title={`Daily Study Streak: ${studyStreak} Days`}
                >
                  <Flame className="w-3.5 h-3.5 fill-amber-500 text-orange-500 shrink-0" />
                  <span>{studyStreak}</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setPendingTestAfterLogin(null);
                    setAuthModalMode('login');
                    setAuthError('');
                    refreshSecurityChallenge();
                    setShowStudentAuthModal(true);
                  }}
                  className="hidden sm:inline-flex px-3 py-1.5 rounded-lg ice-glass text-black dark:text-white text-xs font-bold transition"
                >
                  Log In
                </button>
              </div>
            )}

            {/* Top-Most 3-Dot / 3-Line Menu Button */}
            <button
              type="button"
              onClick={() => setShowQuickMenu((prev) => !prev)}
              className="inline-flex flex-col items-center justify-center gap-1 w-9 h-9 rounded-xl ice-glass text-black dark:text-white transition cursor-pointer"
              title="Open Menu"
              aria-label="Open Menu"
            >
              <span className="w-4 h-0.5 bg-black dark:bg-white rounded-full" />
              <span className="w-4 h-0.5 bg-black dark:bg-white rounded-full" />
              <span className="w-4 h-0.5 bg-black dark:bg-white rounded-full" />
            </button>
          </div>
        </div>
      </header>

      {/* =====================================================================
          3-DOT CLICK: LINE-BY-LINE LIQUID GLASS MENU ("3 dod me line by line sara option ko kr do")
         ===================================================================== */}
      {showQuickMenu && (
        <div
          onClick={() => setShowQuickMenu(false)}
          className="fixed inset-0 z-50 bg-slate-900/35 dark:bg-black/60 backdrop-blur-md flex items-start justify-end p-3 sm:p-6 pt-16 transition-all duration-200"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="liquid-glass-tab w-full max-w-sm rounded-3xl p-4 sm:p-5 space-y-3 text-black dark:text-white animate-in fade-in zoom-in-95 duration-150 max-h-[85vh] overflow-y-auto"
          >
            {/* Liquid Glass Tab Header */}
            <div className="flex items-center justify-between gap-3 pb-3 border-b border-slate-300/60 dark:border-white/15">
              <div className="flex items-center gap-2.5 min-w-0">
                <img
                  src={`${portalLogoUrl || DEFAULT_PORTAL_LOGO}?v=3`}
                  alt="Vs Tests"
                  className="w-9 h-9 rounded-xl object-cover border border-white/40 shrink-0"
                />
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm sm:text-base font-extrabold text-black dark:text-white truncate">
                      {currentStudent ? currentStudent.fullName : 'Vs Tests'}
                    </h3>
                    <span
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-amber-500/20 border border-amber-500/40 text-amber-700 dark:text-amber-300 text-xs font-black font-mono-tabular shrink-0"
                      title="Daily Study Streak"
                    >
                      <Flame className="w-3.5 h-3.5 fill-amber-500 text-orange-500" />
                      <span>{studyStreak}</span>
                    </span>
                  </div>
                  <p className="text-[11px] font-semibold text-slate-700 dark:text-slate-300 truncate">
                    {currentStudent
                      ? currentStudent.emailOrRoll
                      : 'Sign in to save your test history'}
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setShowQuickMenu(false)}
                className="liquid-glass-item p-2 rounded-xl text-black dark:text-white"
                aria-label="Close menu"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Line-by-Line Options List (One Option Per Row) */}
            <div className="flex flex-col space-y-2">
              {currentStudent ? (
                <button
                  type="button"
                  onClick={() => {
                    setShowQuickMenu(false);
                    openStudentProfileModal();
                  }}
                  className="liquid-glass-item w-full flex items-center justify-between gap-2 px-4 py-3 rounded-2xl text-xs sm:text-sm font-extrabold text-black dark:text-white"
                >
                  <span className="flex items-center gap-2.5">
                    <Settings className="w-4 h-4 text-sky-600 dark:text-sky-400" />
                    <span>Edit Profile &amp; Photo</span>
                  </span>
                  <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400 font-mono-tabular text-xs">
                    <Flame className="w-4 h-4 fill-amber-500 text-orange-500" />
                    {studyStreak}d
                  </span>
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      setShowQuickMenu(false);
                      setPendingTestAfterLogin(null);
                      setAuthModalMode('login');
                      setAuthError('');
                      refreshSecurityChallenge();
                      setShowStudentAuthModal(true);
                    }}
                    className="w-full flex items-center justify-between gap-2 px-4 py-3 rounded-2xl bg-blue-600 hover:bg-blue-500 text-white text-xs sm:text-sm font-extrabold shadow-lg transition"
                  >
                    <span className="flex items-center gap-2.5">
                      <LogIn className="w-4 h-4" />
                      <span>Log In</span>
                    </span>
                    <ChevronRight className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowQuickMenu(false);
                      setPendingTestAfterLogin(null);
                      setAuthModalMode('signup');
                      setAuthError('');
                      refreshSecurityChallenge();
                      setShowStudentAuthModal(true);
                    }}
                    className="liquid-glass-item w-full flex items-center justify-between gap-2 px-4 py-3 rounded-2xl text-xs sm:text-sm font-extrabold text-black dark:text-white"
                  >
                    <span className="flex items-center gap-2.5">
                      <UserPlus className="w-4 h-4 text-sky-600 dark:text-sky-400" />
                      <span>Sign Up (New Student)</span>
                    </span>
                    <ChevronRight className="w-4 h-4 opacity-60" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowQuickMenu(false);
                      setPendingTestAfterLogin(null);
                      setAuthModalMode('forgot');
                      setAuthError('');
                      refreshSecurityChallenge();
                      setShowStudentAuthModal(true);
                    }}
                    className="liquid-glass-item w-full flex items-center justify-between gap-2 px-4 py-3 rounded-2xl text-xs sm:text-sm font-extrabold text-black dark:text-white"
                  >
                    <span className="flex items-center gap-2.5">
                      <KeyRound className="w-4 h-4 text-amber-500" />
                      <span>Forgot Password</span>
                    </span>
                    <ChevronRight className="w-4 h-4 opacity-60" />
                  </button>
                </>
              )}

              <button
                type="button"
                onClick={() => {
                  setShowQuickMenu(false);
                  setAppMode('student');
                  setStudentTab('tests');
                  setHomeViewStep('root');
                }}
                className="liquid-glass-item w-full flex items-center justify-between gap-2 px-4 py-3 rounded-2xl text-xs sm:text-sm font-extrabold text-black dark:text-white"
              >
                <span className="flex items-center gap-2.5">
                  <GraduationCap className="w-4 h-4 text-sky-600 dark:text-sky-400 shrink-0" />
                  <span>Home Page</span>
                </span>
                <ChevronRight className="w-4 h-4 opacity-60" />
              </button>

              {isAdminUnlocked && (
                <button
                  type="button"
                  onClick={() => {
                    setShowQuickMenu(false);
                    setAppMode('studio');
                  }}
                  className="liquid-glass-item w-full flex items-center justify-between gap-2 px-4 py-3 rounded-2xl text-xs sm:text-sm font-extrabold text-sky-700 dark:text-sky-300 border border-sky-400/50"
                >
                  <span className="flex items-center gap-2.5">
                    <ShieldCheck className="w-4 h-4 text-sky-600 dark:text-sky-400 shrink-0" />
                    <span>Open Admin Studio</span>
                  </span>
                  <ChevronRight className="w-4 h-4 opacity-60" />
                </button>
              )}

              <button
                type="button"
                onClick={() => {
                  setShowQuickMenu(false);
                  setAppMode('student');
                  setStudentTab('tests');
                  setHomeViewStep('folders');
                }}
                className="liquid-glass-item w-full flex items-center justify-between gap-2 px-4 py-3 rounded-2xl text-xs sm:text-sm font-extrabold text-black dark:text-white"
              >
                <span className="flex items-center gap-2.5">
                  <FolderOpen className="w-4 h-4 text-sky-600 dark:text-sky-400 shrink-0" />
                  <span>Test Folders ({folders.length})</span>
                </span>
                <span className="text-xs font-mono-tabular text-sky-700 dark:text-sky-300 font-bold">
                  {tests.length} Tests
                </span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setShowQuickMenu(false);
                  setAppMode('student');
                  setStudentTab('dashboard');
                }}
                className="liquid-glass-item w-full flex items-center justify-between gap-2 px-4 py-3 rounded-2xl text-xs sm:text-sm font-extrabold text-black dark:text-white"
              >
                <span className="flex items-center gap-2.5">
                  <TrendingUp className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                  <span>Test Analysis &amp; Solutions</span>
                </span>
                <span className="text-xs font-mono-tabular text-emerald-700 dark:text-emerald-300 font-bold">
                  {studentPersonalAttempts.length} Done
                </span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setShowQuickMenu(false);
                  setAppMode('student');
                  setStudentTab('mistakes');
                }}
                className="liquid-glass-item w-full flex items-center justify-between gap-2 px-4 py-3 rounded-2xl text-xs sm:text-sm font-extrabold text-black dark:text-white"
              >
                <span className="flex items-center gap-2.5">
                  <Bookmark className="w-4 h-4 text-amber-500 fill-amber-500 shrink-0" />
                  <span>My Mistakes &amp; Bookmarks</span>
                </span>
                <span className="text-xs font-mono-tabular text-amber-600 dark:text-amber-400 font-bold">
                  {mistakeNotebook.length} Saved
                </span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setShowQuickMenu(false);
                  openNotificationsDrawer();
                }}
                className="liquid-glass-item w-full flex items-center justify-between gap-2 px-4 py-3 rounded-2xl text-xs sm:text-sm font-extrabold text-black dark:text-white"
              >
                <span className="flex items-center gap-2.5">
                  <Bell className="w-4 h-4 text-amber-500 shrink-0" />
                  <span>Notifications</span>
                </span>
                <span className="text-xs font-mono-tabular font-bold">
                  {notifications.length}
                </span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setShowQuickMenu(false);
                  window.dispatchEvent(new Event('vs:open-pwa-install'));
                }}
                className="liquid-glass-item w-full flex items-center justify-between gap-2 px-4 py-3 rounded-2xl text-xs sm:text-sm font-extrabold text-black dark:text-white"
              >
                <span className="flex items-center gap-2.5">
                  <Download className="w-4 h-4 text-sky-600 dark:text-sky-400 shrink-0" />
                  <span>Install Vs Tests App</span>
                </span>
                <ChevronRight className="w-4 h-4 opacity-60" />
              </button>

              <a
                href="https://t.me/vstestneet"
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setShowQuickMenu(false)}
                className="liquid-glass-item w-full flex items-center justify-between gap-2 px-4 py-3 rounded-2xl text-xs sm:text-sm font-extrabold text-black dark:text-white hover:bg-sky-500/15 transition"
              >
                <span className="flex items-center gap-2.5">
                  <svg
                    viewBox="0 0 24 24"
                    className="w-4 h-4 fill-[#229ED9] shrink-0"
                    aria-hidden="true"
                  >
                    <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
                  </svg>
                  <span>Join Telegram Channel</span>
                </span>
                <ChevronRight className="w-4 h-4 opacity-60" />
              </a>

              <button
                type="button"
                onClick={() => setIsDarkMode((prev) => !prev)}
                className="liquid-glass-item w-full flex items-center justify-between gap-2 px-4 py-3 rounded-2xl text-xs sm:text-sm font-extrabold text-black dark:text-white"
              >
                <span className="flex items-center gap-2.5">
                  {isDarkMode ? (
                    <Sun className="w-4 h-4 text-amber-400 shrink-0" />
                  ) : (
                    <Moon className="w-4 h-4 text-sky-600 shrink-0" />
                  )}
                  <span>{isDarkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode'}</span>
                </span>
                <span className="text-[11px] font-bold px-2 py-0.5 rounded bg-sky-500/15 text-sky-700 dark:text-sky-300">
                  {isDarkMode ? 'Dark' : 'Light'}
                </span>
              </button>

              {currentStudent && (
                <button
                  type="button"
                  onClick={() => {
                    setShowQuickMenu(false);
                    handleStudentLogout();
                  }}
                  className="liquid-glass-item w-full flex items-center justify-between gap-2 px-4 py-3 rounded-2xl text-xs sm:text-sm font-extrabold text-rose-600 dark:text-rose-400"
                >
                  <span className="flex items-center gap-2.5">
                    <LogOut className="w-4 h-4" />
                    <span>Log Out</span>
                  </span>
                  <ChevronRight className="w-4 h-4 opacity-60" />
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Main Content Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 md:px-8 py-5 md:py-7">
        {appMode === 'studio' && isAdminUnlocked ? (
          /* =================================================================
             PASSWORD-PROTECTED MY STUDIO (ADMIN VIEW)
             ================================================================= */
          <MyStudioAdmin
            tests={tests}
            folders={folders}
            attempts={attempts}
            students={students}
            notifications={notifications}
            globalAttachmentPdf={globalAttachmentPdf}
            portalLogoUrl={portalLogoUrl}
            onUpdatePortalLogo={handleAdminUpdatePortalLogo}
            onRefreshPortal={() => syncPortalStore('force_refresh')}
            onPreviewNormalPdf={(url, title) => setActiveNormalPdfModal({ url, title })}
            onSaveTest={handleAdminSaveTest}
            onDeleteTest={handleAdminDeleteTest}
            onSaveFolder={handleAdminSaveFolder}
            onDeleteFolder={handleAdminDeleteFolder}
            onSendNotification={handleAdminSendNotification}
            onDeleteNotification={handleAdminDeleteNotification}
            onDeleteStudent={handleAdminDeleteStudent}
            onDeleteAttempt={async (attemptId) => {
              await deleteAttemptFromFirestore(attemptId);
              setAttempts((prev) => prev.filter((a) => a.id !== attemptId));
              await syncPortalStore('force_refresh');
              showToast('Attempt deleted.', 'info');
            }}
            tickedStudentMap={tickedStudentMap}
            onUpdateTickedStudentMap={(nextMap, tickKey, value, studentId) => {
              setTickedStudentMap(nextMap);
              saveAdminStudentTickToFirestore({
                tickKey,
                value,
                tickMap: nextMap,
                studentId,
              }).catch(() => {});
            }}
            onOpenTestAsStudent={(test) => handleStudentOpenTestCard(test)}
            onSimulateEngagement={handleSimulateEngagement}
            onLoadQuestionsForTest={loadQuestionsForTest}
            onBackToStudentPortal={() => {
              setAppMode('student');
              setStudentTab('tests');
              setHomeViewStep('root');
            }}
            onLockStudio={handleLockAdminStudio}
            showToast={showToast}
          />
        ) : studentTab === 'dashboard' ? (
          /* =================================================================
             STUDENT PERSONAL PERFORMANCE DASHBOARD & DAILY STUDY STREAK
             ================================================================= */
          <div className="space-y-6">
            <div className="flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => {
                  setStudentTab('tests');
                  setHomeViewStep('root');
                }}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl ice-glass font-extrabold text-sm sm:text-base text-black dark:text-white hover:bg-slate-200 dark:hover:bg-slate-800 transition"
              >
                <BookOpen className="w-4 h-4 text-sky-600 dark:text-sky-400" />
                <span>← Back to Home</span>
              </button>
            </div>

            <div className="ice-glass-strong rounded-3xl p-6 md:p-8 flex flex-col md:flex-row md:items-center justify-between gap-6">
              <div className="flex items-center gap-4">
                {currentStudent && (
                  <div
                    onClick={openStudentProfileModal}
                    className="w-16 h-16 rounded-2xl overflow-hidden bg-blue-600 text-white flex items-center justify-center font-extrabold text-2xl border-2 border-slate-300 dark:border-slate-700 shadow-md cursor-pointer shrink-0"
                    title="Click to update profile photo"
                  >
                    {currentStudent.photoUrl ? (
                      <img
                        src={currentStudent.photoUrl}
                        alt={currentStudent.fullName || 'Student'}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <span>{(currentStudent.fullName || 'S').charAt(0).toUpperCase()}</span>
                    )}
                  </div>
                )}
                <div>
                  <span className="inline-flex items-center gap-1.5 text-xs sm:text-sm font-extrabold uppercase tracking-wider text-sky-600 dark:text-sky-400">
                    <GraduationCap className="w-5 h-5 text-sky-600 dark:text-sky-400" /> Vs Test · Performance &amp; Analysis
                  </span>

                  {/* Student Profile Name + Flame Icon Daily Study Streak Counter Right Next to Name */}
                  <div className="flex flex-wrap items-center gap-2.5 mt-1">
                    <h2 className="text-2xl sm:text-3xl font-extrabold text-black dark:text-white">
                      {currentStudent ? currentStudent.fullName : 'NEET Student'}
                    </h2>

                    <div
                      className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-500/15 dark:bg-amber-500/20 border border-amber-500/40 text-amber-700 dark:text-amber-300 text-xs sm:text-sm font-black shadow-sm"
                      title="Daily Study Streak increments when you complete a test or revise a topic!"
                    >
                      <Flame className="w-4 h-4 fill-amber-500 text-orange-500 animate-pulse shrink-0" />
                      <span className="font-mono-tabular">{studyStreak}</span>
                      <span>Day Study Streak</span>
                    </div>
                  </div>

                  <p className="text-sm text-slate-700 dark:text-slate-300 mt-1">
                    {currentStudent
                      ? `Email: ${currentStudent.emailOrRoll} · ${currentStudent.targetBatch}`
                      : 'Complete a test or revise a weak topic below to grow your Daily Study Streak!'}
                  </p>
                </div>
              </div>

              {currentStudent ? (
                <button
                  type="button"
                  onClick={openStudentProfileModal}
                  className="min-h-[46px] inline-flex items-center gap-2 px-5 py-2.5 rounded-2xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-black dark:text-white text-sm font-extrabold self-start border border-slate-300 dark:border-slate-700"
                >
                  <Camera className="w-4 h-4 text-sky-600 dark:text-sky-400" /> Edit Profile &amp; Photo
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setAuthModalMode('login');
                    refreshSecurityChallenge();
                    setShowStudentAuthModal(true);
                  }}
                  className="min-h-[46px] inline-flex items-center gap-2 px-5 py-2.5 rounded-2xl ice-glow-btn text-sm font-extrabold self-start"
                >
                  <LogIn className="w-4 h-4" /> Student Login
                </button>
              )}
            </div>

            {/* Student 5 KPI Cards (Including Daily Study Streak) */}
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
              <div className="ice-glass rounded-2xl p-5">
                <div className="text-xs font-extrabold uppercase text-amber-600 dark:text-amber-400 flex items-center gap-1">
                  <Flame className="w-4 h-4 fill-amber-500 text-orange-500" />
                  <span>Daily Study Streak</span>
                </div>
                <div className="text-3xl sm:text-4xl font-extrabold text-black dark:text-white font-mono-tabular mt-2 flex items-baseline gap-1.5">
                  <span>{studyStreak}</span>
                  <span className="text-xs font-bold uppercase text-amber-600 dark:text-amber-400">
                    Days
                  </span>
                </div>
              </div>
              <div className="ice-glass rounded-2xl p-5">
                <div className="text-xs font-extrabold uppercase text-sky-600 dark:text-sky-400">
                  Tests Completed
                </div>
                <div className="text-3xl sm:text-4xl font-extrabold text-black dark:text-white font-mono-tabular mt-2">
                  {studentPersonalAttempts.length}
                </div>
              </div>
              <div className="ice-glass rounded-2xl p-5">
                <div className="text-xs font-extrabold uppercase text-emerald-600 dark:text-emerald-400">
                  Highest Score
                </div>
                <div className="text-3xl sm:text-4xl font-extrabold text-emerald-600 dark:text-emerald-400 font-mono-tabular mt-2">
                  {studentPersonalAttempts.length > 0
                    ? Math.max(...studentPersonalAttempts.map((a) => a.score))
                    : 0}
                </div>
              </div>
              <div className="ice-glass rounded-2xl p-5">
                <div className="text-xs font-extrabold uppercase text-amber-600 dark:text-amber-400">
                  Avg Accuracy
                </div>
                <div className="text-3xl sm:text-4xl font-extrabold text-black dark:text-white font-mono-tabular mt-2">
                  {studentPersonalAttempts.length > 0
                    ? Math.round(
                        studentPersonalAttempts.reduce((s, a) => s + a.accuracy, 0) /
                          studentPersonalAttempts.length
                      )
                    : 0}
                  %
                </div>
              </div>
              <div className="ice-glass rounded-2xl p-5 col-span-2 lg:col-span-1">
                <div className="text-xs font-extrabold uppercase text-indigo-600 dark:text-indigo-400">
                  Questions Solved
                </div>
                <div className="text-3xl sm:text-4xl font-extrabold text-black dark:text-white font-mono-tabular mt-2">
                  {studentPersonalAttempts.reduce(
                    (s, a) => s + a.correctCount + a.wrongCount,
                    0
                  )}
                </div>
              </div>
            </div>

            {/* Weak Topic Revision & Mistake Analysis Panel */}
            <div className="ice-glass-strong rounded-2xl p-6 md:p-7 space-y-5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-start gap-3.5">
                  <div className="w-12 h-12 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-black dark:text-white flex items-center justify-center shrink-0">
                    <BookOpen className="w-6 h-6 text-rose-500" />
                  </div>
                  <div>
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-[11px] font-bold uppercase tracking-wider text-sky-600 dark:text-sky-400">
                      Vs Test · Weak Topic &amp; Mistake Analysis
                    </span>
                    <h3 className="text-xl sm:text-2xl font-extrabold text-black dark:text-white mt-1">
                      Weak Topic Revision &amp; Notes (कमजोर टॉपिक्स का रिवीजन)
                    </h3>
                    <p className="text-xs sm:text-sm text-slate-700 dark:text-slate-300">
                      Revising weak chapters or solving rescue questions automatically increases your 🔥 Daily Study Streak!
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  disabled={isLoadingDashboardRescue}
                  onClick={handleGenerateDashboardRescue}
                  className="min-h-[48px] px-5 py-3 rounded-xl ice-glow-btn text-xs sm:text-sm font-extrabold flex items-center justify-center gap-2 shrink-0 active:scale-[0.98] transition"
                >
                  {isLoadingDashboardRescue ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Preparing Revision Notes...</span>
                    </>
                  ) : (
                    <>
                      <Flame className="w-4 h-4 fill-amber-400 text-amber-200" />
                      <span>
                        {dashboardRescuePlan
                          ? 'Revise Another Topic (+1 Streak)'
                          : 'Revise Weak Topics (+1 Streak)'}
                      </span>
                    </>
                  )}
                </button>
              </div>

              {dashboardRescuePlan && (
                <div className="space-y-5 pt-4 border-t border-slate-200 dark:border-slate-800">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="p-4 rounded-xl bg-slate-100/90 dark:bg-slate-900/90 border border-slate-300 dark:border-slate-800 space-y-1.5">
                      <div className="text-xs font-extrabold uppercase tracking-wider text-sky-600 dark:text-sky-400">
                        हिंदी विश्लेषण (Topic Feedback)
                      </div>
                      <p className="text-sm sm:text-base font-semibold text-black dark:text-white leading-relaxed">
                        {dashboardRescuePlan.diagnosisHi}
                      </p>
                    </div>
                    <div className="p-4 rounded-xl bg-slate-100/90 dark:bg-slate-900/90 border border-slate-300 dark:border-slate-800 space-y-1.5">
                      <div className="text-xs font-extrabold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                        Performance Report
                      </div>
                      <p className="text-sm sm:text-base font-medium text-black dark:text-white leading-relaxed">
                        {dashboardRescuePlan.diagnosisEn}
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {(Array.isArray(dashboardRescuePlan.rescueCapsules)
                      ? dashboardRescuePlan.rescueCapsules
                      : []
                    ).map((cap, idx) => (
                      <div
                        key={idx}
                        className="ice-glass rounded-2xl p-4 border border-slate-300 dark:border-slate-800 flex flex-col justify-between space-y-3"
                      >
                        <div className="space-y-2">
                          <span className="inline-block px-2.5 py-0.5 rounded-lg bg-blue-600 text-white text-xs font-extrabold">
                            Capsule #{idx + 1} · {cap.chapter}
                          </span>
                          <p className="text-sm font-bold text-black dark:text-white leading-snug">
                            {cap.conceptHi}
                          </p>
                          <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
                            {cap.conceptEn}
                          </p>
                        </div>
                        <div className="p-2.5 rounded-xl bg-amber-500/15 dark:bg-amber-950/60 border border-amber-500/40 dark:border-amber-700/70 text-xs font-bold text-black dark:text-amber-200">
                          <Lightbulb className="w-3.5 h-3.5 inline mr-1 text-amber-500" />
                          {cap.ncertTrick}
                        </div>
                      </div>
                    ))}
                  </div>

                  {Array.isArray(dashboardRescuePlan.practiceMcqs) &&
                    dashboardRescuePlan.practiceMcqs.length > 0 && (
                      <div className="space-y-3">
                        <h4 className="text-sm sm:text-base font-extrabold text-black dark:text-white">
                          Targeted Weak-Link Rescue Drill (Tap an option to verify):
                        </h4>
                        <div className="grid grid-cols-1 gap-4">
                          {dashboardRescuePlan.practiceMcqs.map((mcq, mIdx) => {
                            const picked = dashboardRescueMcqAnswers[mIdx];
                            return (
                              <div
                                key={mIdx}
                                className="p-4 rounded-2xl bg-slate-100 dark:bg-slate-900 border border-slate-300 dark:border-slate-800 space-y-3"
                              >
                                <div className="text-xs font-extrabold text-sky-600 dark:text-sky-400">
                                  Rescue Q.{mIdx + 1} · {mcq.chapter}
                                </div>
                                <p className="text-base font-bold text-black dark:text-white">
                                  {mcq.questionHi}
                                </p>
                                <p className="text-sm text-slate-700 dark:text-slate-300">
                                  {mcq.questionEn}
                                </p>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                                  {(Array.isArray(mcq.options) ? mcq.options : []).map((optText, oIdx) => {
                                    const optNum = String(oIdx + 1);
                                    const isChosen = picked === optNum;
                                    const isRight = mcq.correctOption === optNum;
                                    let btnClass =
                                      'bg-white dark:bg-slate-800/80 hover:bg-slate-200 dark:hover:bg-slate-800 text-black dark:text-white border-slate-300 dark:border-slate-700';
                                    if (picked) {
                                      if (isRight) {
                                        btnClass =
                                          'bg-emerald-500/20 dark:bg-emerald-950/80 border-emerald-500 text-black dark:text-emerald-200 font-extrabold';
                                      } else if (isChosen) {
                                        btnClass =
                                          'bg-rose-500/20 dark:bg-rose-950/80 border-rose-500 text-black dark:text-rose-200';
                                      }
                                    }
                                    return (
                                      <button
                                        key={oIdx}
                                        type="button"
                                        onClick={() => {
                                          if (!dashboardRescueMcqAnswers[mIdx]) {
                                            incrementDailyStudyStreak('Practice Drill Solved');
                                          }
                                          setDashboardRescueMcqAnswers((prev) => ({
                                            ...prev,
                                            [mIdx]: optNum,
                                          }));
                                        }}
                                        className={`min-h-[46px] p-3 rounded-xl border text-left text-xs sm:text-sm flex items-center gap-2.5 transition ${btnClass}`}
                                      >
                                        <span className="w-6 h-6 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 flex items-center justify-center font-mono-tabular font-extrabold text-xs text-black dark:text-white shrink-0">
                                          {optNum}
                                        </span>
                                        <span className="flex-1">{optText}</span>
                                      </button>
                                    );
                                  })}
                                </div>
                                {picked && (
                                  <div className="p-3 rounded-xl bg-white dark:bg-slate-800/90 border border-slate-300 dark:border-slate-700 text-xs sm:text-sm text-black dark:text-white">
                                    <strong className="text-sky-600 dark:text-sky-400">
                                      Explanation:
                                    </strong>{' '}
                                    {mcq.explanationHi}{' '}
                                    {mcq.explanationEn !== mcq.explanationHi
                                      ? `(${mcq.explanationEn})`
                                      : ''}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                </div>
              )}
            </div>

            {/* Completed Test History Table with "Analyze & Solutions" Button */}
            <div className="ice-glass-strong rounded-3xl p-6">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
                <div>
                  <h3 className="text-xl sm:text-2xl font-extrabold text-black dark:text-white">
                    Completed Tests — Detailed Analysis &amp; Solutions (टेस्ट एनालिसिस)
                  </h3>
                  <p className="text-sm text-slate-700 dark:text-slate-300">
                    All tests attempted with your email are permanently saved here. Click &ldquo;Analyze &amp; Solutions&rdquo; to review questions and NCERT explanations.
                  </p>
                </div>
              </div>

              {studentPersonalAttempts.length === 0 ? (
                <div className="py-12 text-center space-y-3">
                  <p className="text-base font-semibold text-slate-700 dark:text-slate-300">
                    {currentStudent
                      ? 'You have not submitted any tests under this email yet. Start your first NEET test!'
                      : 'Log in with your email to see all tests you have previously given.'}
                  </p>
                  <button
                    type="button"
                    onClick={() => setStudentTab('tests')}
                    className="min-h-[48px] px-6 py-3 rounded-xl ice-glow-btn text-sm sm:text-base font-extrabold"
                  >
                    Browse Test Series
                  </button>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-sm sm:text-base">
                    <thead>
                      <tr className="border-b border-slate-300 dark:border-slate-800 text-black dark:text-white">
                        <th className="py-3.5 px-3 font-extrabold">Test Title</th>
                        <th className="py-3.5 px-3 font-extrabold text-right">Score</th>
                        <th className="py-3.5 px-3 font-extrabold text-right text-emerald-600 dark:text-emerald-400">
                          Correct
                        </th>
                        <th className="py-3.5 px-3 font-extrabold text-right text-rose-600 dark:text-rose-400">
                          Wrong
                        </th>
                        <th className="py-3.5 px-3 font-extrabold text-right">Accuracy</th>
                        <th className="py-3.5 px-3 font-extrabold text-right">Time</th>
                        <th className="py-3.5 px-3 font-extrabold text-right">
                          Detailed Review
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 dark:divide-slate-800/80">
                      {studentPersonalAttempts.map((att, idx) => (
                        <tr
                          key={att.id || idx}
                          className="hover:bg-slate-100/80 dark:hover:bg-slate-800/50"
                        >
                          <td className="py-3.5 px-3 font-extrabold text-black dark:text-white">
                            <div>{att.testTitle}</div>
                            <div className="text-xs font-medium text-slate-600 dark:text-slate-400">
                              {new Date(att.completedAt).toLocaleString('en-IN', {
                                day: '2-digit',
                                month: 'short',
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </div>
                          </td>
                          <td className="py-3.5 px-3 text-right font-mono-tabular font-extrabold text-sky-600 dark:text-sky-400">
                            {att.score} / {att.maxMarks}
                          </td>
                          <td className="py-3.5 px-3 text-right font-mono-tabular text-emerald-600 dark:text-emerald-400 font-bold">
                            +{att.correctCount}
                          </td>
                          <td className="py-3.5 px-3 text-right font-mono-tabular text-rose-600 dark:text-rose-400 font-bold">
                            -{att.wrongCount}
                          </td>
                          <td className="py-3.5 px-3 text-right font-mono-tabular font-extrabold text-black dark:text-white">
                            {att.accuracy}%
                          </td>
                          <td className="py-3.5 px-3 text-right font-mono-tabular text-slate-700 dark:text-slate-300">
                            {Math.floor(att.timeTakenSeconds / 60)}m {att.timeTakenSeconds % 60}s
                          </td>
                          <td className="py-3.5 px-3 text-right">
                            <button
                              type="button"
                              disabled={isLoadingTestQuestions}
                              onClick={() => handleAnalyzeCompletedAttempt(att)}
                              className="min-h-[44px] inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl ice-glow-btn text-xs sm:text-sm font-extrabold active:scale-[0.98]"
                            >
                              <BarChart3 className="w-4 h-4" />
                              <span>Analyze &amp; Solutions</span>
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        ) : studentTab === 'mistakes' ? (
          /* =================================================================
             FEATURE 1: MY MISTAKES & BOOKMARKS NOTEBOOK + INSTANT RE-TEST
             ================================================================= */
          <div className="space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => {
                  setStudentTab('tests');
                  setHomeViewStep('root');
                }}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl ice-glass font-extrabold text-sm text-black dark:text-white hover:bg-slate-200 dark:hover:bg-slate-800 transition"
              >
                <BookOpen className="w-4 h-4 text-sky-600 dark:text-sky-400" />
                <span>← Back to Home</span>
              </button>

              {mistakeNotebook.length > 0 && (
                <button
                  type="button"
                  onClick={handleStartMistakeRetest}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl ice-glow-btn text-xs sm:text-sm font-extrabold shadow-md active:scale-[0.98] transition"
                >
                  <Play className="w-4 h-4 fill-current" />
                  <span>⚡ Start Re-Test of My Mistakes ({mistakeNotebook.length} Qs)</span>
                </button>
              )}
            </div>

            <div className="ice-glass-strong rounded-3xl p-5 sm:p-7 space-y-4">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-sky-200/80 dark:border-slate-800 pb-4">
                <div className="flex items-start gap-3.5">
                  <div className="w-12 h-12 rounded-2xl bg-amber-500/15 border border-amber-500/40 flex items-center justify-center shrink-0">
                    <Bookmark className="w-6 h-6 text-amber-500 fill-amber-500" />
                  </div>
                  <div>
                    <span className="text-xs font-extrabold uppercase tracking-wider text-amber-600 dark:text-amber-400">
                      Vs Tests · Smart Revision Vault
                    </span>
                    <h2 className="text-xl sm:text-2xl font-black text-black dark:text-white mt-0.5">
                      My Mistake Notebook &amp; Bookmarks ({mistakeNotebook.length})
                    </h2>
                    <p className="text-xs sm:text-sm text-slate-700 dark:text-slate-300 mt-0.5">
                      Every question you answer wrong in any test or bookmark for revision is saved here automatically.
                    </p>
                  </div>
                </div>

                {/* Filter Tabs: All | Wrong in Tests | Bookmarked */}
                <div className="flex flex-wrap gap-1.5">
                  {(
                    [
                      { id: 'all', label: `All Saved (${mistakeNotebook.length})` },
                      {
                        id: 'wrong',
                        label: `Wrong in Tests (${
                          mistakeNotebook.filter((m) => m.reason === 'wrong' || m.reason === 'both').length
                        })`,
                      },
                      {
                        id: 'bookmarked',
                        label: `⭐ Bookmarked (${
                          mistakeNotebook.filter((m) => m.reason === 'bookmarked' || m.reason === 'both').length
                        })`,
                      },
                    ] as const
                  ).map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setMistakeFilter(tab.id)}
                      className={`px-3.5 py-2 rounded-xl text-xs font-extrabold transition ${
                        mistakeFilter === tab.id
                          ? 'ice-glow-btn'
                          : 'ice-glass text-black dark:text-white'
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
              </div>

              {(() => {
                const visibleMistakes = mistakeNotebook.filter((item) => {
                  if (mistakeFilter === 'wrong') return item.reason === 'wrong' || item.reason === 'both';
                  if (mistakeFilter === 'bookmarked')
                    return item.reason === 'bookmarked' || item.reason === 'both';
                  return true;
                });

                if (visibleMistakes.length === 0) {
                  return (
                    <div className="py-12 text-center space-y-3">
                      <Bookmark className="w-10 h-10 text-amber-500 mx-auto opacity-80" />
                      <h3 className="text-lg font-extrabold text-black dark:text-white">
                        No Questions Saved in This Section Yet
                      </h3>
                      <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 max-w-md mx-auto">
                        When you attempt any test, your wrong answers and bookmarked questions will automatically appear here for quick revision and Re-Test!
                      </p>
                    </div>
                  );
                }

                return (
                  <div className="space-y-4">
                    {visibleMistakes.map((item, idx) => {
                      const q = item.question;
                      return (
                        <div
                          key={item.uid}
                          className="liquid-glass-card rounded-2xl p-4 sm:p-5 space-y-3 border border-sky-200/80 dark:border-slate-800"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-sky-200/60 dark:border-slate-800 pb-2.5">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="px-2.5 py-0.5 rounded-lg bg-sky-600 text-white text-xs font-extrabold font-mono-tabular">
                                #{idx + 1}
                              </span>
                              <span className="px-2.5 py-0.5 rounded-lg bg-sky-500/15 text-sky-800 dark:text-sky-300 text-xs font-extrabold">
                                {item.testTitle}
                              </span>
                              {item.reason !== 'bookmarked' && (
                                <span className="px-2 py-0.5 rounded-lg bg-rose-500/15 text-rose-700 dark:text-rose-300 text-xs font-extrabold">
                                  ❌ Wrong in Test
                                </span>
                              )}
                              {(item.reason === 'bookmarked' || item.reason === 'both') && (
                                <span className="px-2 py-0.5 rounded-lg bg-amber-500/20 text-amber-800 dark:text-amber-300 text-xs font-extrabold">
                                  ⭐ Bookmarked
                                </span>
                              )}
                            </div>

                            <button
                              type="button"
                              onClick={() => handleRemoveMistakeItem(item.uid)}
                              className="px-3 py-1 rounded-xl bg-emerald-600/15 hover:bg-emerald-600 text-emerald-800 dark:text-emerald-300 hover:text-white text-xs font-extrabold transition"
                              title="Mark as Mastered and remove from Mistake Notebook"
                            >
                              ✓ Mastered (Remove)
                            </button>
                          </div>

                          <div className="space-y-1.5 text-sm sm:text-base font-bold text-black dark:text-white">
                            {q.questionHi && !q.questionHi.startsWith('data:image/') && <p>{q.questionHi}</p>}
                            {q.questionEn &&
                              q.questionEn !== q.questionHi &&
                              !q.questionEn.startsWith('data:image/') && (
                                <p className="text-black/85 dark:text-white/90">{q.questionEn}</p>
                              )}
                          </div>

                          {(() => {
                            const imgs = Array.from(
                              new Set(
                                [
                                  q.imageHi,
                                  q.imageEn,
                                  q.imageUrl,
                                  ...(Array.isArray(q.imageUrls) ? q.imageUrls : []),
                                  q.questionHi?.startsWith('data:image/') ? q.questionHi : undefined,
                                  q.questionEn?.startsWith('data:image/') ? q.questionEn : undefined,
                                ].filter((u): u is string => Boolean(u && u.trim().length > 0))
                              )
                            );
                            if (imgs.length === 0) return null;
                            return (
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                {imgs.map((imgSrc, imgIdx) => (
                                  <div
                                    key={imgIdx}
                                    className="rounded-xl overflow-hidden border border-slate-200 dark:border-slate-700 bg-white p-2"
                                  >
                                    <img
                                      src={imgSrc}
                                      alt={`Saved question diagram ${imgIdx + 1}`}
                                      className="max-h-72 w-auto mx-auto object-contain"
                                      loading="lazy"
                                    />
                                  </div>
                                ))}
                              </div>
                            );
                          })()}

                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                            {(Array.isArray(q.optionsEn) ? q.optionsEn : []).map((opt, oIdx) => {
                              const optId = String(opt.id || oIdx + 1);
                              const optHi = Array.isArray(q.optionsHi) ? q.optionsHi[oIdx] : undefined;
                              const isRight =
                                optId === String(q.correctAnswer) ||
                                Boolean(q.alsoCorrect && optId === String(q.alsoCorrect));
                              const isWrongPicked =
                                Boolean(item.chosenAnswer) &&
                                String(item.chosenAnswer) === optId &&
                                !isRight;

                              return (
                                <div
                                  key={optId}
                                  className={`p-2.5 rounded-xl border text-xs sm:text-sm flex items-center gap-2 ${
                                    isRight
                                      ? 'bg-emerald-500/15 border-emerald-500 text-black dark:text-emerald-200 font-extrabold'
                                      : isWrongPicked
                                        ? 'bg-rose-500/15 border-rose-400 text-black dark:text-rose-200 font-bold'
                                        : 'ice-glass text-black dark:text-white'
                                  }`}
                                >
                                  <span className="w-6 h-6 rounded-lg bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 flex items-center justify-center font-mono-tabular font-extrabold text-xs shrink-0">
                                    {optId}
                                  </span>
                                  <span className="flex-1">
                                    {optHi?.text || opt.text}
                                    {opt.text && optHi?.text && opt.text !== optHi.text
                                      ? ` / ${opt.text}`
                                      : ''}
                                  </span>
                                  {isRight && (
                                    <span className="text-[10px] font-black text-emerald-700 dark:text-emerald-300">
                                      ✓ Correct
                                    </span>
                                  )}
                                  {isWrongPicked && (
                                    <span className="text-[10px] font-black text-rose-700 dark:text-rose-300">
                                      ✗ Your Pick
                                    </span>
                                  )}
                                </div>
                              );
                            })}
                          </div>

                          {(q.explanation?.hi || q.explanation?.en) && (
                            <div className="p-3 rounded-xl bg-sky-50/90 dark:bg-slate-900/90 border border-sky-200/80 dark:border-slate-700 text-xs sm:text-sm space-y-2">
                              <div className="font-extrabold text-sky-900 dark:text-sky-300">
                                NCERT Explanation (Correct Option {q.correctAnswer}):
                              </div>
                              {q.explanation?.hi &&
                                (q.explanation.hi.startsWith('data:image/') ? (
                                  <div className="rounded-lg overflow-hidden bg-white p-1.5 border border-slate-200">
                                    <img
                                      src={q.explanation.hi}
                                      alt="Hindi Solution"
                                      className="max-h-64 w-auto mx-auto object-contain"
                                      loading="lazy"
                                    />
                                  </div>
                                ) : (
                                  <p>{q.explanation.hi}</p>
                                ))}
                              {q.explanation?.en &&
                                q.explanation.en !== q.explanation.hi &&
                                (q.explanation.en.startsWith('data:image/') ? (
                                  <div className="rounded-lg overflow-hidden bg-white p-1.5 border border-slate-200">
                                    <img
                                      src={q.explanation.en}
                                      alt="English Solution"
                                      className="max-h-64 w-auto mx-auto object-contain"
                                      loading="lazy"
                                    />
                                  </div>
                                ) : (
                                  <p className="text-black/80 dark:text-white/85">{q.explanation.en}</p>
                                ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </div>
          </div>
        ) : (
          /* =================================================================
             HOMEPAGE VIEW:
             1) Side Medium Benzene Ring Countdown
             2) Daily Study Streak (7-Day Tracker)
             3) Hierarchical Test Browser:
                - Step 'root': Shows ONLY Total Tests Master Card on Home Page
                - Step 'folders': Shows All Test Folders when Total Tests is opened
                - Step 'folder_tests': Shows Tests inside the selected Folder
             ================================================================= */
          <div className="space-y-5">
            {homeViewStep === 'root' && (
              <>
                {/* 1. Compact Side-Benzene NEET 2027 Countdown */}
                <Neet2027Countdown isDarkMode={isDarkMode} />

                {/* 2. Daily Study Streak (Day Streak) 7-Day Tracker Bar */}
                <div className="ice-glass-strong rounded-2xl p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="flex items-center gap-3.5">
                    <div className="w-12 h-12 rounded-2xl bg-amber-500/15 dark:bg-amber-500/20 border border-amber-500/40 flex items-center justify-center shrink-0">
                      <Flame className="w-6 h-6 fill-amber-500 text-orange-500 animate-pulse" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-lg sm:text-xl font-black text-black dark:text-white font-mono-tabular">
                          {studyStreak} Day Study Streak
                        </span>
                        <span className="px-2.5 py-0.5 rounded-full bg-amber-500/20 border border-amber-500/40 text-amber-700 dark:text-amber-300 text-xs font-extrabold">
                          Active 🔥
                        </span>
                      </div>
                      <p className="text-xs sm:text-sm font-semibold text-slate-700 dark:text-slate-300 mt-0.5">
                        {currentStudent ? `${currentStudent.fullName} · ` : ''}
                        Complete any test or revise a topic daily to build your streak
                      </p>
                    </div>
                  </div>

                  {/* 7-Day Week Pills (Mon - Sun) */}
                  <div className="grid grid-cols-7 gap-1.5 sm:gap-2">
                    {currentWeekDays.map((day) => (
                      <div
                        key={day.dateKey}
                        className={`px-2 py-1.5 rounded-xl border text-center transition ${
                          day.isCompleted
                            ? 'bg-amber-500/20 dark:bg-amber-950/80 border-amber-500 text-black dark:text-amber-200 font-extrabold'
                            : day.isToday
                              ? 'bg-sky-500/15 border-sky-500 text-black dark:text-white font-bold'
                              : 'bg-slate-100/80 dark:bg-slate-900/80 border-slate-300 dark:border-slate-800 text-slate-600 dark:text-slate-400'
                        }`}
                      >
                        <div className="text-[10px] uppercase font-extrabold">{day.label}</div>
                        <div className="mt-0.5 flex items-center justify-center">
                          {day.isCompleted ? (
                            <Flame className="w-3.5 h-3.5 fill-amber-500 text-orange-500" />
                          ) : (
                            <span className="text-xs font-mono-tabular font-bold">{day.dateNum}</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}

            {/* 2B. AUTO-SAVE & RESUME UNFINISHED TEST BANNER ("Resume Test from Where You Left") */}
            {homeViewStep === 'root' && unfinishedTest && (
              <div className="ice-glass-strong rounded-2xl p-4 sm:p-5 border-2 border-emerald-500/80 flex flex-col sm:flex-row sm:items-center justify-between gap-3.5 shadow-md">
                <div className="flex items-start sm:items-center gap-3.5 min-w-0">
                  <div className="w-11 h-11 rounded-2xl bg-emerald-600 text-white flex items-center justify-center shrink-0 shadow-sm">
                    <Play className="w-5 h-5 fill-current" />
                  </div>
                  <div className="min-w-0">
                    <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-emerald-500/20 text-emerald-800 dark:text-emerald-300 text-[10px] font-black uppercase tracking-wider">
                      ● Auto-Saved Unfinished Test Ready to Resume
                    </div>
                    <h3 className="text-base sm:text-lg font-black text-black dark:text-white truncate mt-0.5">
                      {unfinishedTest.testTitle}
                    </h3>
                    <p className="text-xs font-bold text-slate-700 dark:text-slate-300 font-mono-tabular">
                      Answered: {unfinishedTest.answeredCount}/{unfinishedTest.totalQuestions} Qs · Time Left:{' '}
                      {Math.floor(unfinishedTest.remainingSeconds / 60)}m {unfinishedTest.remainingSeconds % 60}s
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      const target = tests.find((t) => t.id === unfinishedTest.testId);
                      if (target) {
                        handleStudentOpenTestCard(target);
                      } else {
                        handleDiscardUnfinishedTest(unfinishedTest.testId);
                      }
                    }}
                    className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs sm:text-sm font-extrabold inline-flex items-center gap-1.5 shadow-sm transition cursor-pointer"
                  >
                    <Play className="w-4 h-4 fill-current" />
                    <span>Resume Test</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDiscardUnfinishedTest(unfinishedTest.testId)}
                    className="px-3 py-2.5 rounded-xl ice-glass text-rose-600 dark:text-rose-400 text-xs font-extrabold hover:bg-rose-50 transition cursor-pointer"
                    title="Discard saved session"
                  >
                    ✕
                  </button>
                </div>
              </div>
            )}

            {/* 3. HIERARCHICAL HOME -> LIQUID GLASS FOLDERS -> FULL DISPLAY TESTS VIEW */}
            {homeViewStep === 'root' ? (
              /* STEP 1: COMPACT FOLDER-SIZED CARDS ON HOMEPAGE (Total Tests + Mistake Notebook) */
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div
                  onClick={() => setHomeViewStep('folders')}
                  className="liquid-glass-card rounded-2xl p-4 sm:p-5 cursor-pointer transition touch-manipulation flex items-center justify-between gap-3.5"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-12 h-12 rounded-2xl bg-sky-500/15 dark:bg-sky-950/90 border border-sky-500/40 flex items-center justify-center shrink-0 shadow-sm">
                      <FolderOpen className="w-6 h-6 text-sky-600 dark:text-sky-400" />
                    </div>
                    <div className="min-w-0">
                      <span className="inline-block text-[10px] font-extrabold uppercase tracking-wider text-sky-700 dark:text-sky-300">
                        Vs Tests Library
                      </span>
                      <h3 className="text-lg sm:text-xl font-black text-black dark:text-white tracking-tight truncate">
                        Total Tests: <span className="font-mono-tabular text-sky-600 dark:text-sky-400">{tests.length}</span>
                      </h3>
                      <p className="text-xs font-semibold text-slate-700 dark:text-slate-300 truncate">
                        {folders.length} Folders · Tap to open
                      </p>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setHomeViewStep('folders');
                    }}
                    className="px-3.5 py-2 rounded-xl ice-glow-btn font-extrabold text-xs sm:text-sm inline-flex items-center gap-1 shrink-0 shadow-sm"
                  >
                    <span>Open</span>
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>

                {/* Compact Mistake Notebook & Bookmarks Card on Homepage */}
                <div
                  onClick={() => setStudentTab('mistakes')}
                  className="liquid-glass-card rounded-2xl p-4 sm:p-5 cursor-pointer transition touch-manipulation flex items-center justify-between gap-3.5"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-12 h-12 rounded-2xl bg-amber-500/15 dark:bg-amber-950/90 border border-amber-500/40 flex items-center justify-center shrink-0 shadow-sm">
                      <Bookmark className="w-6 h-6 text-amber-500 fill-amber-500" />
                    </div>
                    <div className="min-w-0">
                      <span className="inline-block text-[10px] font-extrabold uppercase tracking-wider text-amber-700 dark:text-amber-300">
                        Mistake Notebook &amp; Bookmarks
                      </span>
                      <h3 className="text-lg sm:text-xl font-black text-black dark:text-white tracking-tight truncate">
                        Saved Qs: <span className="font-mono-tabular text-amber-600 dark:text-amber-400">{mistakeNotebook.length}</span>
                      </h3>
                      <p className="text-xs font-semibold text-slate-700 dark:text-slate-300 truncate">
                        Wrong &amp; Bookmarked Qs · Re-Test
                      </p>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setStudentTab('mistakes');
                    }}
                    className="px-3.5 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-extrabold text-xs sm:text-sm inline-flex items-center gap-1 shrink-0 shadow-sm"
                  >
                    <span>Revise</span>
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ) : homeViewStep === 'folders' ? (
              /* STEP 2: ALL TEST FOLDERS VIEW IN LIQUID GLASS EFFECT ("Jab kisi bhi folder ko open kre to wah liquid glass eefect me open ho") */
              <div className="liquid-glass-folder-shell rounded-3xl p-4 sm:p-6 min-h-[calc(100dvh-110px)] space-y-5">
                <div className="liquid-glass-card rounded-2xl p-4 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => setHomeViewStep('root')}
                      className="min-h-[40px] px-3.5 py-2 rounded-xl liquid-glass-item text-xs sm:text-sm font-extrabold text-black dark:text-white transition"
                    >
                      ← Back
                    </button>
                    <div>
                      <h3 className="text-lg sm:text-xl font-black text-black dark:text-white">
                        Test Folders ({folders.length})
                      </h3>
                      <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                        Tap any folder to open in Liquid Glass view
                      </p>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setSelectedFolderFilter('ALL');
                      setSearchQuery('');
                      setHomeViewStep('folder_tests');
                    }}
                    className="min-h-[40px] px-3.5 py-2 rounded-xl ice-glow-btn text-xs font-extrabold inline-flex items-center gap-1.5"
                  >
                    <BookOpen className="w-3.5 h-3.5" />
                    <span>All {tests.length} Tests</span>
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {folders.map((folder) => {
                    const knownIds = new Set(folders.map((f) => f.id));
                    const fallbackId = folders[0]?.id || 'folder_prayas';
                    const count = tests.filter((t) => {
                      const effId =
                        t.folderId && knownIds.has(t.folderId) ? t.folderId : fallbackId;
                      return effId === folder.id;
                    }).length;

                    return (
                      <div
                        key={folder.id}
                        onClick={() => {
                          setSelectedFolderFilter(folder.id);
                          setSearchQuery('');
                          setHomeViewStep('folder_tests');
                        }}
                        className="liquid-glass-card rounded-2xl p-4 sm:p-5 flex flex-col justify-between gap-4 cursor-pointer touch-manipulation transition overflow-hidden"
                      >
                        <div className="space-y-2">
                          {folder.bannerUrl && (
                            <div className="-mx-4 -mt-4 sm:-mx-5 sm:-mt-5 mb-3 h-28 sm:h-32 overflow-hidden border-b border-sky-200/70 dark:border-slate-800">
                              <img
                                src={folder.bannerUrl}
                                alt={folder.name}
                                loading="lazy"
                                decoding="async"
                                className="w-full h-full object-cover"
                              />
                            </div>
                          )}
                          <div className="flex items-center justify-between gap-2">
                            <div className="w-11 h-11 rounded-2xl bg-sky-500/15 dark:bg-sky-950 border border-sky-500/40 flex items-center justify-center">
                              <FolderOpen className="w-6 h-6 text-sky-600 dark:text-sky-400" />
                            </div>
                            <span className="px-3 py-1 rounded-xl bg-sky-500/15 dark:bg-sky-950 border border-sky-500/40 text-sky-700 dark:text-sky-300 font-mono-tabular text-xs sm:text-sm font-black">
                              {count} {count === 1 ? 'Test' : 'Tests'}
                            </span>
                          </div>

                          <h4 className="text-lg sm:text-xl font-black text-black dark:text-white leading-snug">
                            {folder.name}
                          </h4>
                          <p className="text-xs sm:text-sm font-semibold text-slate-700 dark:text-slate-300 line-clamp-2">
                            {folder.description || 'Vs Tests Series'}
                          </p>
                        </div>

                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedFolderFilter(folder.id);
                            setSearchQuery('');
                            setHomeViewStep('folder_tests');
                          }}
                          className="w-full min-h-[42px] py-2.5 px-4 rounded-xl ice-glow-btn font-extrabold text-xs sm:text-sm flex items-center justify-center gap-1.5"
                        >
                          <span>Open Folder ({count})</span>
                          <ChevronRight className="w-4 h-4" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              /* STEP 3: OPENED FOLDER IN LIQUID GLASS EFFECT & FULL DISPLAY */
              <div className="liquid-glass-folder-shell rounded-3xl p-4 sm:p-6 min-h-[calc(100dvh-110px)] space-y-5">
                <div className="liquid-glass-card rounded-2xl p-4 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-3 flex-wrap">
                    <button
                      type="button"
                      onClick={() => {
                        setSearchQuery('');
                        setHomeViewStep('folders');
                      }}
                      className="min-h-[40px] px-3.5 py-2 rounded-xl liquid-glass-item text-xs sm:text-sm font-extrabold text-black dark:text-white transition"
                    >
                      ← Back to Folders
                    </button>
                    <div>
                      <div className="inline-flex items-center gap-1.5 text-[11px] font-extrabold uppercase tracking-wider text-sky-600 dark:text-sky-400">
                        <FolderOpen className="w-3.5 h-3.5" />
                        <span>Liquid Glass Folder</span>
                      </div>
                      <h3 className="text-lg sm:text-xl font-black text-black dark:text-white">
                        {selectedFolderFilter === 'ALL'
                          ? `All Tests (${filteredTests.length})`
                          : `${folders.find((f) => f.id === selectedFolderFilter)?.name || 'Folder Tests'} (${filteredTests.length})`}
                      </h3>
                    </div>
                  </div>

                  {/* Search Input inside Folder */}
                  <div className="relative w-full sm:w-64">
                    <Search className="w-4 h-4 text-sky-600 dark:text-sky-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => {
                        const val = sanitizeInput(e.target.value, 100);
                        setSearchQuery(val);
                      }}
                      placeholder="Search test or chapter..."
                      className="w-full min-h-[40px] pl-9 pr-4 py-2 rounded-xl liquid-glass-item text-xs sm:text-sm font-bold text-black dark:text-white placeholder:text-slate-500 dark:placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500"
                    />
                  </div>
                </div>

                {/* COMPLETED TEST TRACKER & FILTER BAR FOR STUDENTS ("Students jo test de chuke h unko trick/track krne ka option") */}
                <div className="liquid-glass-card rounded-2xl p-3 sm:p-4 flex flex-wrap items-center justify-between gap-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    {[
                      {
                        id: 'all',
                        label: `📋 All Tests (${filteredTests.length})`,
                      },
                      {
                        id: 'completed',
                        label: `✅ Completed / Ticked (${
                          filteredTests.filter(
                            (t) =>
                              Boolean(latestAttemptByTestId[t.id]) ||
                              Boolean(studentTickedTests[t.id])
                          ).length
                        })`,
                      },
                      {
                        id: 'pending',
                        label: `⏳ Pending (${
                          filteredTests.filter(
                            (t) =>
                              !latestAttemptByTestId[t.id] && !studentTickedTests[t.id]
                          ).length
                        })`,
                      },
                    ].map((fBtn) => {
                      const active = studentCompletionFilter === fBtn.id;
                      return (
                        <button
                          key={fBtn.id}
                          type="button"
                          onClick={() =>
                            setStudentCompletionFilter(
                              fBtn.id as 'all' | 'completed' | 'pending'
                            )
                          }
                          className={`px-3.5 py-1.5 rounded-xl text-xs font-extrabold transition cursor-pointer ${
                            active
                              ? 'bg-emerald-600 text-white shadow-sm'
                              : 'liquid-glass-item text-black dark:text-white'
                          }`}
                        >
                          {fBtn.label}
                        </button>
                      );
                    })}
                  </div>
                  <span className="text-[11px] font-bold text-slate-700 dark:text-slate-300">
                    Tap <strong>☑️ Done</strong> on any test card to tick/track completed tests
                  </span>
                </div>

                {filteredTests.length === 0 ? (
                  <div className="liquid-glass-card rounded-2xl p-10 text-center space-y-3">
                    <BookOpen className="w-10 h-10 text-sky-600 dark:text-sky-400 mx-auto" />
                    <h3 className="text-lg sm:text-xl font-extrabold text-black dark:text-white">
                      No Tests in This Folder Yet
                    </h3>
                    <button
                      type="button"
                      onClick={() => setHomeViewStep('folders')}
                      className="min-h-[42px] px-5 py-2 rounded-xl ice-glow-btn text-xs sm:text-sm font-extrabold"
                    >
                      ← Back to All Folders
                    </button>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {filteredTests
                      .filter((test) => {
                        const isDone =
                          Boolean(latestAttemptByTestId[test.id]) ||
                          Boolean(studentTickedTests[test.id]);
                        if (studentCompletionFilter === 'completed') return isDone;
                        if (studentCompletionFilter === 'pending') return !isDone;
                        return true;
                      })
                      .map((test) => {
                        const completedAttempt = latestAttemptByTestId[test.id];
                        const isTestTicked =
                          Boolean(completedAttempt) || Boolean(studentTickedTests[test.id]);
                      const matchedFolder = folders.find((f) => f.id === test.folderId);
                      const folderLabel =
                        matchedFolder?.name ||
                        test.folderName ||
                        'Vs Tests';
                      const siblingWithPdf = tests.find(
                        (s) => s.folderId === test.folderId && Boolean(s.attachmentPdfId)
                      );
                      const effectivePdfId =
                        test.attachmentPdfId ||
                        matchedFolder?.attachmentPdfId ||
                        siblingWithPdf?.attachmentPdfId ||
                        globalAttachmentPdf?.id ||
                        '';
                      const effectivePdfName =
                        test.attachmentPdfName ||
                        matchedFolder?.attachmentPdfName ||
                        siblingWithPdf?.attachmentPdfName ||
                        globalAttachmentPdf?.name ||
                        `${test.title} Syllabus.pdf`;
                      const effectivePdfUrl = effectivePdfId
                        ? `/api/store/pdf/${encodeURIComponent(effectivePdfId)}`
                        : `/api/store/test/${encodeURIComponent(test.id)}/syllabus.pdf`;
                      const displayTotalQuestions = test.isPdfOnly
                        ? 0
                        : test.totalQuestions && test.totalQuestions > 1
                          ? test.totalQuestions
                          : /ranker|fst|full\s*syllabus|major|180/i.test(`${test.title} ${test.subTitle || ''}`)
                            ? 180
                            : 90;
                      const displayMaxMarks = test.isPdfOnly
                        ? 0
                        : test.totalQuestions && test.totalQuestions > 1 && test.maxMarks > 4
                          ? test.maxMarks
                          : displayTotalQuestions * (test.correctMarks || 4);

                      const isScheduledLocked = Boolean(
                        test.scheduledAt && test.scheduledAt > nowTs
                      );

                      return (
                        <div
                          key={test.id}
                          onClick={() => handleStudentOpenTestCard(test)}
                          className={`liquid-glass-card rounded-2xl p-4 sm:p-5 flex flex-col justify-between gap-4 cursor-pointer touch-manipulation overflow-hidden ${
                            test.isPinned ? 'ring-2 ring-amber-400/90 dark:ring-amber-500/80' : ''
                          }`}
                        >
                          <div>
                            {(test.bannerUrl || matchedFolder?.bannerUrl) && (
                              <div className="-mx-4 -mt-4 sm:-mx-5 sm:-mt-5 mb-3 h-28 sm:h-32 overflow-hidden border-b border-sky-200/70 dark:border-slate-800">
                                <img
                                  src={test.bannerUrl || matchedFolder?.bannerUrl}
                                  alt={test.title}
                                  loading="lazy"
                                  decoding="async"
                                  className="w-full h-full object-cover"
                                />
                              </div>
                            )}
                            <div className="flex items-center justify-between gap-2 flex-wrap">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                {test.isPinned && (
                                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg bg-amber-500 text-slate-950 text-xs font-black shadow-xs">
                                    <Pin className="w-3 h-3 fill-current" />
                                    <span>Pinned</span>
                                  </span>
                                )}
                                <span
                                  className={`px-2.5 py-0.5 rounded-lg border text-xs font-extrabold ${
                                    test.isPdfOnly
                                      ? 'bg-emerald-500/15 dark:bg-emerald-950/90 border-emerald-500/40 dark:border-emerald-700/80 text-emerald-900 dark:text-emerald-300'
                                      : 'bg-sky-500/15 dark:bg-sky-950/90 border-sky-500/40 dark:border-sky-700/80 text-sky-900 dark:text-sky-300'
                                  }`}
                                >
                                  {test.isPdfOnly ? '📄 Normal PDF' : test.subject}
                                </span>
                              </div>

                              <div className="flex items-center gap-1.5">
                                {isAdminUnlocked && (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      const nextPin = !test.isPinned;
                                      void handleAdminSaveTest({
                                        ...test,
                                        isPinned: nextPin,
                                        pinnedAt: nextPin ? Date.now() : 0,
                                      });
                                      showToast(
                                        nextPin
                                          ? `📌 Pinned "${test.title}" to top!`
                                          : `Unpinned "${test.title}".`,
                                        'success'
                                      );
                                    }}
                                    className={`px-2 py-0.5 rounded-lg text-[11px] font-extrabold inline-flex items-center gap-1 border transition ${
                                      test.isPinned
                                        ? 'bg-amber-500 text-slate-950 border-amber-600'
                                        : 'ice-glass text-black dark:text-white border-sky-200 dark:border-slate-700'
                                    }`}
                                    title={test.isPinned ? 'Unpin Test' : 'Pin Test to Top'}
                                  >
                                    <Pin className="w-3 h-3" />
                                    <span>{test.isPinned ? 'Unpin' : 'Pin'}</span>
                                  </button>
                                )}

                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    toggleStudentTestTick(test.id);
                                  }}
                                  className={`px-2.5 py-0.5 rounded-lg text-[11px] font-extrabold inline-flex items-center gap-1 border transition cursor-pointer ${
                                    isTestTicked
                                      ? 'bg-emerald-600 text-white border-emerald-500 shadow-xs'
                                      : 'ice-glass text-black dark:text-white border-sky-200 dark:border-slate-700'
                                  }`}
                                  title="Tick / Mark this test as completed"
                                >
                                  <span>{isTestTicked ? '☑️ Done ✔' : '⬜ Tick'}</span>
                                </button>

                                {completedAttempt && !test.isPdfOnly ? (
                                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg bg-emerald-500/15 dark:bg-emerald-950/90 border border-emerald-500/40 dark:border-emerald-700 text-emerald-900 dark:text-emerald-300 text-xs font-extrabold">
                                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                                    {completedAttempt.score}/{completedAttempt.maxMarks}
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 text-xs font-mono-tabular font-bold text-black dark:text-slate-200">
                                    <Eye className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400" />
                                    {test.playCount || 0}
                                  </span>
                                )}
                              </div>
                            </div>

                            {isScheduledLocked && test.scheduledAt && (
                              <div className="mt-2.5 p-2.5 rounded-xl bg-amber-500/15 dark:bg-amber-950/80 border border-amber-500/50 text-black dark:text-amber-200 flex items-center justify-between gap-2">
                                <div className="flex items-center gap-1.5 min-w-0">
                                  <CalendarClock className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                                  <span className="text-xs font-extrabold truncate">
                                    {new Date(test.scheduledAt).toLocaleString('en-IN', {
                                      day: '2-digit',
                                      month: 'short',
                                      hour: '2-digit',
                                      minute: '2-digit',
                                    })}
                                  </span>
                                </div>
                                <span className="px-2 py-0.5 rounded-lg bg-amber-500 text-slate-950 font-mono-tabular text-[11px] font-black shrink-0">
                                  <ScheduledCountdownSpan targetMs={test.scheduledAt} />
                                </span>
                              </div>
                            )}

                            <div className="mt-2 inline-flex items-center gap-1 text-xs font-extrabold text-sky-700 dark:text-sky-400">
                              <Folder className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400" />
                              <span>{folderLabel}</span>
                            </div>

                            <h3 className="text-lg sm:text-xl font-black text-black dark:text-white mt-1 leading-snug tracking-tight">
                              {test.title}
                            </h3>

                            <div className="mt-2 p-2.5 rounded-xl ice-glass-subtle text-xs sm:text-sm font-semibold text-black dark:text-white line-clamp-2">
                              <strong className="text-sky-700 dark:text-sky-400 font-extrabold">
                                {test.isPdfOnly ? 'Document:' : 'Syllabus:'}
                              </strong>{' '}
                              {test.isPdfOnly ? effectivePdfName : test.chapter}
                            </div>
                          </div>

                          <div className="space-y-2.5">
                            {!test.isPdfOnly && (
                              <div className="grid grid-cols-3 gap-1.5 pt-2 border-t border-slate-200/70 dark:border-slate-800 text-center">
                                <div className="ice-glass-subtle rounded-lg p-1.5">
                                  <div className="text-[10px] uppercase font-bold text-slate-700 dark:text-slate-300">
                                    Qs
                                  </div>
                                  <div className="text-sm sm:text-base font-black text-black dark:text-white font-mono-tabular">
                                    {displayTotalQuestions}
                                  </div>
                                </div>
                                <div className="ice-glass-subtle rounded-lg p-1.5">
                                  <div className="text-[10px] uppercase font-bold text-slate-700 dark:text-slate-300">
                                    Marks
                                  </div>
                                  <div className="text-sm sm:text-base font-black text-black dark:text-white font-mono-tabular">
                                    {displayMaxMarks}
                                  </div>
                                </div>
                                <div className="ice-glass-subtle rounded-lg p-1.5">
                                  <div className="text-[10px] uppercase font-bold text-slate-700 dark:text-slate-300">
                                    Time
                                  </div>
                                  <div className="text-sm sm:text-base font-black text-black dark:text-white font-mono-tabular">
                                    {test.durationMinutes}m
                                  </div>
                                </div>
                              </div>
                            )}

                            {test.isPdfOnly ? (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setActiveNormalPdfModal({
                                    url: effectivePdfUrl,
                                    title: test.title,
                                    fileName: test.attachmentPdfName || `${test.title}.pdf`,
                                  });
                                }}
                                className="w-full min-h-[42px] py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 active:scale-[0.98] text-white font-black text-xs sm:text-sm flex items-center justify-center gap-2 shadow-sm transition touch-manipulation"
                              >
                                <FileText className="w-4 h-4 shrink-0" />
                                <span>📄 View &amp; Download PDF</span>
                              </button>
                            ) : isScheduledLocked && !isAdminUnlocked ? (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleStudentOpenTestCard(test);
                                }}
                                className="w-full min-h-[42px] py-2.5 px-4 rounded-xl bg-amber-500/20 dark:bg-amber-950/90 border border-amber-500/60 text-black dark:text-amber-300 font-black text-xs sm:text-sm flex items-center justify-center gap-1.5 transition touch-manipulation"
                              >
                                <Lock className="w-4 h-4 text-amber-500 shrink-0" />
                                <span>
                                  Unlocks in{' '}
                                  {test.scheduledAt ? (
                                    <ScheduledCountdownSpan targetMs={test.scheduledAt} />
                                  ) : (
                                    ''
                                  )}
                                </span>
                              </button>
                            ) : completedAttempt ? (
                              <div className="grid grid-cols-2 gap-2">
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleAnalyzeCompletedAttempt(completedAttempt);
                                  }}
                                  className="min-h-[40px] py-2 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 active:scale-[0.98] text-white font-extrabold text-xs sm:text-sm flex items-center justify-center gap-1.5 shadow-sm transition touch-manipulation"
                                >
                                  <BarChart3 className="w-4 h-4 shrink-0" />
                                  <span>Analyze</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleStudentOpenTestCard(test);
                                  }}
                                  className="min-h-[40px] py-2 px-3 rounded-xl ice-glow-btn active:scale-[0.98] font-extrabold text-xs sm:text-sm flex items-center justify-center gap-1.5 transition touch-manipulation"
                                >
                                  <Play className="w-4 h-4 fill-current shrink-0" />
                                  <span>Retest</span>
                                </button>
                              </div>
                            ) : (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleStudentOpenTestCard(test);
                                }}
                                className="w-full min-h-[42px] py-2.5 px-4 rounded-xl ice-glow-btn active:scale-[0.98] font-black text-xs sm:text-sm flex items-center justify-center gap-2 shadow-sm transition touch-manipulation"
                              >
                                {currentStudent || isAdminUnlocked ? (
                                  <>
                                    <Play className="w-4 h-4 fill-current shrink-0" />
                                    <span>Start Test (Full Display)</span>
                                  </>
                                ) : (
                                  <>
                                    <Lock className="w-4 h-4 shrink-0" />
                                    <span>Login to Start Test</span>
                                  </>
                                )}
                              </button>
                            )}

                            {!test.isPdfOnly && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setActiveNormalPdfModal({
                                    url: effectivePdfUrl,
                                    title: `${test.title} — Syllabus PDF`,
                                    fileName: effectivePdfName.toLowerCase().endsWith('.pdf')
                                      ? effectivePdfName
                                      : `${effectivePdfName}.pdf`,
                                  });
                                }}
                                className="w-full min-h-[38px] py-2 px-3 rounded-xl bg-emerald-500/15 hover:bg-emerald-500/25 dark:bg-emerald-950/80 border border-emerald-500/40 text-emerald-900 dark:text-emerald-200 font-extrabold text-xs flex items-center justify-center gap-1.5 transition touch-manipulation"
                              >
                                <FileText className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                                <span className="truncate">📄 Syllabus PDF</span>
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* =====================================================================
                BOTTOM OF HOME PAGE: COMPACT COMPLETED TESTS & ANALYSIS SECTION
                ("jitn test de utna hi test aaye or enka folder size ko chota karke homepage pr dikhao")
               ===================================================================== */}
            {homeViewStep === 'root' && (
              <div className="pt-4 border-t border-slate-200/80 dark:border-slate-800 space-y-3.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <div className="w-9 h-9 rounded-xl bg-emerald-600 text-white flex items-center justify-center shadow-sm shrink-0">
                      <BarChart3 className="w-4 h-4" />
                    </div>
                    <div>
                      <h2 className="text-base sm:text-lg font-black text-black dark:text-white tracking-tight">
                        Completed Tests &amp; Analysis ({studentPersonalAttempts.length})
                      </h2>
                      <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                        Tap any completed test folder below to view full analysis &amp; solutions
                      </p>
                    </div>
                  </div>

                  {studentPersonalAttempts.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setStudentTab('dashboard')}
                      className="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-extrabold flex items-center gap-1.5 shadow-sm transition cursor-pointer"
                    >
                      <TrendingUp className="w-3.5 h-3.5 shrink-0" />
                      <span>Full Analytics</span>
                    </button>
                  )}
                </div>

                {studentPersonalAttempts.length === 0 ? (
                  <div className="ice-glass rounded-2xl p-4 sm:p-5 flex flex-col sm:flex-row items-center justify-between gap-3">
                    <div className="space-y-0.5 text-center sm:text-left">
                      <h3 className="text-sm sm:text-base font-extrabold text-black dark:text-white">
                        No Completed Tests Yet
                      </h3>
                      <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                        Once you submit a test, its compact analysis card will appear right here.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setHomeViewStep('folders')}
                      className="px-4 py-2 rounded-xl ice-glow-btn text-xs font-extrabold shrink-0 cursor-pointer"
                    >
                      Open Test Folders →
                    </button>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                    {studentPersonalAttempts.map((att) => {
                      const matchedTest = tests.find((t) => t.id === att.testId);
                      const isAdminVerified = Boolean(
                        (att.id && tickedStudentMap[`att_${att.id}`]) ||
                          (currentStudent?.id &&
                            (tickedStudentMap[currentStudent.id] ||
                              tickedStudentMap[`${currentStudent.id}__${att.testId}`])) ||
                          (att.studentId &&
                            (tickedStudentMap[att.studentId] ||
                              tickedStudentMap[`${att.studentId}__${att.testId}`]))
                      );
                      return (
                        <div
                          key={att.id || att.testId}
                          onClick={() => handleAnalyzeCompletedAttempt(att)}
                          className="liquid-glass-card rounded-2xl p-3.5 flex flex-col justify-between gap-2.5 cursor-pointer transition touch-manipulation"
                        >
                          <div className="space-y-1.5">
                            <div className="flex items-center justify-between gap-1 flex-wrap">
                              <div className="flex items-center gap-1 flex-wrap">
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-500/15 dark:bg-emerald-950/90 border border-emerald-500/40 text-emerald-800 dark:text-emerald-300 text-[10px] font-black">
                                  <CheckCircle2 className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                                  {att.score}/{att.maxMarks}
                                </span>
                                {isAdminVerified && (
                                  <span
                                    className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md bg-emerald-600 text-white text-[9px] font-black shadow-2xs"
                                    title="Verified / Ticked by Admin"
                                  >
                                    ☑️ Verified ✔
                                  </span>
                                )}
                              </div>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleStudentDeleteAttempt(att);
                                }}
                                className="p-1 rounded-md bg-rose-500/15 hover:bg-rose-600 text-rose-600 dark:text-rose-400 hover:text-white transition cursor-pointer"
                                title="Delete completed test"
                                aria-label="Delete completed test"
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>
                            </div>

                            <h3 className="text-xs sm:text-sm font-black text-black dark:text-white line-clamp-2 leading-snug">
                              {att.testTitle || matchedTest?.title || 'Vs Test'}
                            </h3>

                            <div className="flex items-center justify-between text-[11px] font-mono-tabular font-bold text-slate-700 dark:text-slate-300">
                              <span>Acc: {att.accuracy}%</span>
                              <span className="text-emerald-700 dark:text-emerald-400">
                                +{att.correctCount} / -{att.wrongCount}
                              </span>
                            </div>
                          </div>

                          <div className="flex items-center gap-1.5 pt-1 border-t border-slate-200/60 dark:border-slate-800">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleAnalyzeCompletedAttempt(att);
                              }}
                              className="flex-1 py-1.5 px-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold text-[11px] flex items-center justify-center gap-1 transition cursor-pointer"
                            >
                              <BarChart3 className="w-3 h-3 shrink-0" />
                              <span>Analysis</span>
                            </button>
                            {matchedTest && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleStudentOpenTestCard(matchedTest);
                                }}
                                className="py-1.5 px-2 rounded-lg ice-glow-btn font-extrabold text-[11px] flex items-center justify-center gap-1 transition cursor-pointer"
                                title="Re-attempt Test"
                              >
                                <Play className="w-3 h-3 fill-current shrink-0" />
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Clean Footer: ONLY 'Vs tests' as requested ("Website ke sabse niche jo website ka name likha hai usko delete karke only 'Vs tests' rakho") */}
            {homeViewStep === 'root' && (
              <footer className="pt-5 pb-2 text-center text-xs sm:text-sm font-extrabold text-slate-700 dark:text-slate-400">
                <span>Vs tests</span>
              </footer>
            )}
          </div>
        )}
      </main>

      {/* =====================================================================
          MODAL 1: ADMIN STUDIO CREDENTIALS MODAL (OPENED ONLY BY SECRET TRICK)
         ===================================================================== */}
      {showAdminPassModal && (
        <div
          onClick={() => setShowAdminPassModal(false)}
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="max-w-md w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-2xl p-6 md:p-7 space-y-5 shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-xl ice-glow-btn flex items-center justify-center">
                  <KeyRound className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-lg font-extrabold text-black dark:text-white">
                    Vs Test · Admin Login
                  </h3>
                  <p className="text-xs text-slate-600 dark:text-slate-400">
                    Protected Studio Control Center
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowAdminPassModal(false)}
                className="p-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-black dark:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleAdminUnlockSubmit} className="space-y-4">
              <input
                type="text"
                tabIndex={-1}
                autoComplete="off"
                value={botHoneypot}
                onChange={(e) => setBotHoneypot(e.target.value)}
                className="hidden"
              />
              <div>
                <label className="block text-xs font-bold text-black dark:text-slate-200 mb-1.5">
                  Admin Username
                </label>
                <input
                  type="text"
                  autoFocus
                  required
                  value={adminUsernameInput}
                  onChange={(e) => setAdminUsernameInput(e.target.value)}
                  placeholder="Enter admin username..."
                  className="w-full px-4 py-3 rounded-xl bg-slate-100 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-sm font-semibold text-black dark:text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-black dark:text-slate-200 mb-1.5">
                  Admin Password
                </label>
                <input
                  type="password"
                  required
                  value={adminPasswordInput}
                  onChange={(e) => setAdminPasswordInput(e.target.value)}
                  placeholder="Enter admin password..."
                  className="w-full px-4 py-3 rounded-xl bg-slate-100 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-sm font-mono-tabular text-black dark:text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
                {adminPassError && (
                  <p className="text-xs font-semibold text-rose-500 mt-2 flex items-center gap-1">
                    <AlertCircle className="w-3.5 h-3.5" /> {adminPassError}
                  </p>
                )}
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAdminPassModal(false)}
                  className="px-4 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-xs font-bold text-black dark:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-6 py-2.5 rounded-xl ice-glow-btn text-xs font-bold"
                >
                  Unlock Admin Studio
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* =====================================================================
          MODAL 2: STUDENT LOGIN, SIGN UP & FORGOT PASSWORD MODAL
         ===================================================================== */}
      {showStudentAuthModal && (
        <div
          onClick={() => setShowStudentAuthModal(false)}
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="max-w-md w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-2xl p-6 md:p-7 space-y-4 max-h-[92vh] overflow-y-auto shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
              <div>
                <span className="text-xs font-extrabold uppercase tracking-wider text-sky-600 dark:text-sky-400 flex items-center gap-1">
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" /> Vs Test Secure Portal
                </span>
                <h3 className="text-xl font-extrabold text-black dark:text-white">
                  {authModalMode === 'signup'
                    ? 'Student Sign Up'
                    : authModalMode === 'forgot'
                      ? 'Reset / Forgot Password'
                      : 'Student Login'}
                </h3>
              </div>
              <button
                onClick={() => setShowStudentAuthModal(false)}
                className="p-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-black dark:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {pendingTestAfterLogin && (
              <div className="p-3.5 rounded-xl bg-amber-500/15 dark:bg-amber-950/70 border border-amber-500/40 dark:border-amber-700 text-black dark:text-amber-200 text-xs space-y-1">
                <div className="font-extrabold flex items-center gap-1.5">
                  <Lock className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
                  <span>पहले Login / Sign Up करें फिर टेस्ट खुलेगा!</span>
                </div>
                <p className="text-[11px]">
                  Please log in or sign up to open{' '}
                  <strong>{pendingTestAfterLogin.title}</strong>.
                </p>
              </div>
            )}

            {/* Mode Switcher: Log In | Sign Up */}
            <div className="grid grid-cols-2 gap-1.5 p-1 rounded-xl bg-slate-100 dark:bg-slate-950 border border-slate-300 dark:border-slate-800">
              <button
                type="button"
                onClick={() => {
                  setAuthModalMode('login');
                  setAuthError('');
                }}
                className={`py-2 rounded-lg text-xs sm:text-sm font-extrabold transition ${
                  authModalMode === 'login' ? 'ice-glow-btn' : 'text-black dark:text-white'
                }`}
              >
                Log In
              </button>
              <button
                type="button"
                onClick={() => {
                  setAuthModalMode('signup');
                  setAuthError('');
                  refreshSecurityChallenge();
                }}
                className={`py-2 rounded-lg text-xs sm:text-sm font-extrabold transition ${
                  authModalMode === 'signup' ? 'ice-glow-btn' : 'text-black dark:text-white'
                }`}
              >
                Sign Up
              </button>
            </div>

            <form onSubmit={handleStudentAuthSubmit} className="space-y-3.5">
              <input
                type="text"
                tabIndex={-1}
                autoComplete="off"
                value={botHoneypot}
                onChange={(e) => setBotHoneypot(e.target.value)}
                className="hidden"
              />

              {authModalMode === 'signup' && (
                <div>
                  <label className="block text-xs font-bold text-black dark:text-slate-200 mb-1">
                    Full Name (पूरा नाम) *
                  </label>
                  <input
                    type="text"
                    required
                    value={authFullName}
                    onChange={(e) => setAuthFullName(e.target.value)}
                    placeholder="Enter your full name..."
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-sm font-semibold text-black dark:text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-500"
                  />
                </div>
              )}

              <div>
                <label className="block text-xs font-bold text-black dark:text-slate-200 mb-1">
                  Email ID *
                </label>
                <input
                  type="text"
                  required
                  value={authEmailOrRoll}
                  onChange={(e) => setAuthEmailOrRoll(e.target.value)}
                  placeholder="e.g. student@gmail.com"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-sm font-semibold text-black dark:text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
                <p className="text-[11px] text-slate-600 dark:text-slate-400 mt-1">
                  Jis email se login karenge uska purana test data aur score apne aap aa jayega.
                </p>
              </div>

              {(authModalMode === 'signup' || authModalMode === 'forgot') && (
                <div className="p-3.5 rounded-xl bg-slate-100 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 space-y-2.5">
                  <div className="flex items-center gap-1.5 text-xs font-extrabold text-sky-600 dark:text-sky-400">
                    <HelpCircle className="w-4 h-4 shrink-0" />
                    <span>
                      {authModalMode === 'signup'
                        ? 'Security Question (पासवर्ड भूलने पर काम आएगा) *'
                        : 'Verify Your Security Question (सुरक्षा प्रश्न का उत्तर दें) *'}
                    </span>
                  </div>

                  {authModalMode === 'forgot' && matchedStudentForForgot?.securityQuestion ? (
                    <div className="px-3 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-xs font-bold text-black dark:text-white">
                      {matchedStudentForForgot.securityQuestion}
                    </div>
                  ) : (
                    <select
                      value={authSecurityQuestion}
                      onChange={(e) => setAuthSecurityQuestion(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-xs font-bold text-black dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500"
                    >
                      {SECURITY_QUESTIONS_LIST.map((q) => (
                        <option key={q} value={q}>
                          {q}
                        </option>
                      ))}
                    </select>
                  )}

                  <input
                    type="text"
                    required
                    value={authSecurityQuestionAnswer}
                    onChange={(e) => setAuthSecurityQuestionAnswer(e.target.value)}
                    placeholder={
                      authModalMode === 'signup'
                        ? 'Write your secret answer (e.g. Biology / AIIMS Delhi)...'
                        : 'Enter the secret answer you set during Sign Up...'
                    }
                    className="w-full px-3.5 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-sm font-semibold text-black dark:text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-500"
                  />
                </div>
              )}

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-bold text-black dark:text-slate-200">
                    {authModalMode === 'forgot' ? 'Enter New Password (नया पासवर्ड) *' : 'Password *'}
                  </label>
                  {authModalMode === 'login' && (
                    <button
                      type="button"
                      onClick={() => {
                        setAuthModalMode('forgot');
                        setAuthError('');
                        refreshSecurityChallenge();
                      }}
                      className="text-xs font-extrabold text-sky-600 dark:text-sky-400 hover:underline"
                    >
                      Forgot Password?
                    </button>
                  )}
                </div>
                <input
                  type="password"
                  required
                  value={authPassword}
                  onChange={(e) => setAuthPassword(e.target.value)}
                  placeholder={
                    authModalMode === 'forgot'
                      ? 'Create your new password...'
                      : 'Enter your password...'
                  }
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-sm font-semibold text-black dark:text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
              </div>

              {(authModalMode !== 'login' || authFailedAttempts >= 2) && (
                <div className="p-3 rounded-xl bg-slate-100 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 flex items-center justify-between gap-3">
                  <div className="text-xs font-bold text-black dark:text-white flex items-center gap-1.5">
                    <ShieldCheck className="w-4 h-4 text-emerald-500 shrink-0" />
                    <span>
                      Anti-Bot Check: What is{' '}
                      <strong className="font-mono-tabular text-sky-600 dark:text-sky-400">
                        {securityNumA} + {securityNumB}
                      </strong>
                      ?
                    </span>
                  </div>
                  <input
                    type="number"
                    required
                    value={securityAnswerInput}
                    onChange={(e) => setSecurityAnswerInput(e.target.value)}
                    placeholder="?"
                    className="w-20 px-2.5 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-center font-mono-tabular text-sm font-extrabold text-black dark:text-white"
                  />
                </div>
              )}

              {authError && (
                <div className="p-3 rounded-xl bg-rose-500/15 dark:bg-rose-950/70 border border-rose-500/40 dark:border-rose-800 text-rose-700 dark:text-rose-300 text-xs font-semibold flex items-center gap-1.5">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{authError}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={isSubmittingAuth}
                className="w-full min-h-[48px] py-3 rounded-xl ice-glow-btn text-sm font-extrabold flex items-center justify-center gap-2"
              >
                {isSubmittingAuth ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : authModalMode === 'signup' ? (
                  <>
                    <UserPlus className="w-4 h-4" /> Sign Up &amp; Open Portal
                  </>
                ) : authModalMode === 'forgot' ? (
                  <>
                    <KeyRound className="w-4 h-4" /> Verify Answer &amp; Reset Password
                  </>
                ) : (
                  <>
                    <LogIn className="w-4 h-4" /> Log In to Vs Test
                  </>
                )}
              </button>

              {authModalMode === 'forgot' && (
                <button
                  type="button"
                  onClick={() => {
                    setAuthModalMode('login');
                    setAuthError('');
                  }}
                  className="w-full py-2 text-xs font-bold text-black dark:text-white"
                >
                  Back to Login
                </button>
              )}

              <div className="relative py-1 text-center">
                <span className="text-[11px] text-slate-600 dark:text-slate-400 px-2">
                  OR
                </span>
              </div>

              <button
                type="button"
                onClick={() => {
                  setAuthError('');
                  signInWithGoogle()
                    .then(async (cred) => {
                      const fbUser = cred.user;
                      const cleanEmail = String(fbUser.email || fbUser.uid || '').toLowerCase();
                      const existing = students.find(
                        (s) => String(s?.emailOrRoll || '').toLowerCase() === cleanEmail
                      );
                      const googleStudent: StudentAccount = {
                        id: existing?.id || `stu_${fbUser.uid.slice(0, 16)}`,
                        fullName:
                          existing?.fullName ||
                          fbUser.displayName ||
                          fbUser.email?.split('@')[0] ||
                          'NEET Student',
                        emailOrRoll: cleanEmail,
                        phone: existing?.phone || fbUser.phoneNumber || '',
                        photoUrl: existing?.photoUrl || fbUser.photoURL || undefined,
                        passwordHash: existing?.passwordHash || 'google_oauth',
                        passwordPlain: existing?.passwordPlain || 'Google Sign-In',
                        securityQuestion: existing?.securityQuestion,
                        securityAnswer: existing?.securityAnswer,
                        targetBatch: existing?.targetBatch || 'NEET 2027 · Vs Target Batch',
                        city: existing?.city || '',
                        loginCount: (existing?.loginCount || 0) + 1,
                        createdAt: existing?.createdAt || Date.now(),
                        lastLoginAt: Date.now(),
                        dailyStreak: existing?.dailyStreak || studyStreak,
                      };
                      await saveStudentToFirestore(googleStudent, !existing);
                      completeStudentLogin(googleStudent, 'Signed in with Google!');
                    })
                    .catch(() => {
                      // Seamless fallback when preview iframe or mobile browser blocks third-party popup
                      const typedEmail = sanitizeInput(authEmailOrRoll, 120).toLowerCase();
                      if (typedEmail && typedEmail.includes('@')) {
                        const existing = students.find(
                          (s) => String(s?.emailOrRoll || '').toLowerCase() === typedEmail
                        );
                        const instantGoogleStudent: StudentAccount = {
                          id: existing?.id || `stu_g_${Date.now().toString(36)}`,
                          fullName:
                            existing?.fullName ||
                            sanitizeInput(authFullName, 100) ||
                            typedEmail.split('@')[0],
                          emailOrRoll: typedEmail,
                          phone: existing?.phone || '',
                          photoUrl: existing?.photoUrl,
                          passwordHash: existing?.passwordHash || 'google_oauth',
                          passwordPlain: existing?.passwordPlain || 'Google Sign-In',
                          securityQuestion: existing?.securityQuestion,
                          securityAnswer: existing?.securityAnswer,
                          targetBatch: existing?.targetBatch || 'NEET 2027 · Vs Target Batch',
                          city: existing?.city || '',
                          loginCount: (existing?.loginCount || 0) + 1,
                          createdAt: existing?.createdAt || Date.now(),
                          lastLoginAt: Date.now(),
                          dailyStreak: existing?.dailyStreak || studyStreak,
                        };
                        void saveStudentToFirestore(instantGoogleStudent, !existing);
                        completeStudentLogin(instantGoogleStudent, 'Signed in with Google!');
                        return;
                      }
                      setGoogleQuickEmail(typedEmail || '');
                      setGoogleQuickName(sanitizeInput(authFullName, 100) || '');
                      setShowGoogleQuickForm(true);
                    });
                }}
                className="w-full py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 border border-slate-300 dark:border-slate-700 text-xs sm:text-sm font-extrabold text-black dark:text-white flex items-center justify-center gap-2 transition cursor-pointer"
              >
                <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24">
                  <path
                    fill="#4285F4"
                    d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17z"
                  />
                  <path
                    fill="#34A853"
                    d="M12 24c3.3 0 6.08-1.09 8.1-2.96l-3.88-3.05c-1.1.74-2.5 1.18-4.22 1.18-3.25 0-6-2.19-6.98-5.14H1.01v3.14C3.02 21.2 7.21 24 12 24z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M5.02 14.03c-.25-.74-.39-1.54-.39-2.36s.14-1.62.39-2.36V6.17H1.01C.37 7.45 0 8.89 0 10.42s.37 2.97 1.01 4.25l4.01-3.14z"
                  />
                  <path
                    fill="#EA4335"
                    d="M12 4.75c1.8 0 3.41.62 4.68 1.84l3.51-3.51C18.07 1.19 15.3 0 12 0 7.21 0 3.02 2.8 1.01 6.83l4.01 3.14c.98-2.95 3.73-5.22 6.98-5.22z"
                  />
                </svg>
                <span>Continue with Google Account</span>
              </button>

              {showGoogleQuickForm && (
                <div className="p-3.5 rounded-2xl bg-sky-50/95 dark:bg-slate-950 border-2 border-sky-400 dark:border-sky-600 space-y-2.5">
                  <div className="text-xs font-extrabold text-sky-900 dark:text-sky-300 flex items-center justify-between">
                    <span>Google Account Sign-In (Enter your Gmail)</span>
                    <button
                      type="button"
                      onClick={() => setShowGoogleQuickForm(false)}
                      className="text-slate-500 hover:text-black dark:hover:text-white"
                    >
                      ✕
                    </button>
                  </div>
                  <input
                    type="text"
                    value={googleQuickName}
                    onChange={(e) => setGoogleQuickName(e.target.value)}
                    placeholder="Your Full Name (नाम)"
                    className="w-full px-3 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-xs sm:text-sm font-semibold text-black dark:text-white"
                  />
                  <input
                    type="email"
                    value={googleQuickEmail}
                    onChange={(e) => setGoogleQuickEmail(e.target.value)}
                    placeholder="yourname@gmail.com"
                    className="w-full px-3 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-xs sm:text-sm font-semibold text-black dark:text-white"
                  />
                  <button
                    type="button"
                    onClick={async () => {
                      const gMail = sanitizeInput(googleQuickEmail, 120).toLowerCase();
                      if (!gMail || !gMail.includes('@')) {
                        setAuthError('Please enter your valid Gmail address (e.g. name@gmail.com).');
                        return;
                      }
                      const gName =
                        sanitizeInput(googleQuickName, 100) || gMail.split('@')[0] || 'NEET Student';
                      const existing = students.find(
                        (s) => String(s?.emailOrRoll || '').toLowerCase() === gMail
                      );
                      const googleStudent: StudentAccount = {
                        id: existing?.id || `stu_g_${Date.now().toString(36)}`,
                        fullName: gName,
                        emailOrRoll: gMail,
                        phone: existing?.phone || '',
                        photoUrl: existing?.photoUrl,
                        passwordHash: existing?.passwordHash || 'google_oauth',
                        passwordPlain: existing?.passwordPlain || 'Google Sign-In',
                        securityQuestion: existing?.securityQuestion,
                        securityAnswer: existing?.securityAnswer,
                        targetBatch: existing?.targetBatch || 'NEET 2027 · Vs Target Batch',
                        city: existing?.city || '',
                        loginCount: (existing?.loginCount || 0) + 1,
                        createdAt: existing?.createdAt || Date.now(),
                        lastLoginAt: Date.now(),
                        dailyStreak: existing?.dailyStreak || studyStreak,
                      };
                      setShowGoogleQuickForm(false);
                      await saveStudentToFirestore(googleStudent, !existing);
                      setStudents((prev) => {
                        const next = [googleStudent, ...prev.filter((s) => s.id !== googleStudent.id)];
                        try {
                          localStorage.setItem('vs_neet_2027_students_cache_v1', JSON.stringify(next));
                        } catch {
                          // ignore
                        }
                        return next;
                      });
                      completeStudentLogin(googleStudent, `Signed in with Google (${gName})!`);
                    }}
                    className="w-full py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs sm:text-sm font-extrabold transition cursor-pointer"
                  >
                    Continue as {googleQuickEmail || 'Google User'} →
                  </button>
                </div>
              )}
            </form>
          </div>
        </div>
      )}

      {/* =====================================================================
          MODAL 3: POST-LOGIN STUDENT PROFILE & PHOTO UPDATE MODAL
         ===================================================================== */}
      {showProfileModal && currentStudent && (
        <div
          onClick={() => setShowProfileModal(false)}
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="max-w-md w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-2xl p-6 md:p-7 space-y-5 max-h-[92vh] overflow-y-auto shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
              <div>
                <span className="text-xs font-extrabold uppercase tracking-wider text-sky-600 dark:text-sky-400">
                  Student Profile Settings
                </span>
                <div className="flex items-center gap-2 mt-0.5">
                  <h3 className="text-xl font-extrabold text-black dark:text-white">
                    My Profile &amp; Photo
                  </h3>
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/40 text-amber-600 dark:text-amber-400 text-xs font-black font-mono-tabular">
                    <Flame className="w-3.5 h-3.5 fill-amber-500 text-orange-500" />
                    {studyStreak}
                  </span>
                </div>
              </div>
              <button
                onClick={() => setShowProfileModal(false)}
                className="p-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-black dark:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveStudentProfile} className="space-y-4">
              <div className="flex flex-col items-center gap-2.5 py-2">
                <div className="relative">
                  <div className="w-24 h-24 rounded-full overflow-hidden bg-blue-600 text-white flex items-center justify-center font-extrabold text-3xl border-4 border-slate-200 dark:border-slate-800 shadow-lg">
                    {profilePhotoUrl ? (
                      <img
                        src={profilePhotoUrl}
                        alt={profileName}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <span>{(profileName || currentStudent.fullName).charAt(0).toUpperCase()}</span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => profilePhotoInputRef.current?.click()}
                    className="absolute -bottom-1 -right-1 p-2 rounded-full ice-glow-btn shadow-md"
                    title="Upload Profile Photo"
                  >
                    <Camera className="w-4 h-4" />
                  </button>
                </div>

                <input
                  ref={profilePhotoInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleProfilePhotoChange}
                  className="hidden"
                />

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => profilePhotoInputRef.current?.click()}
                    className="px-3.5 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-xs font-extrabold text-sky-600 dark:text-sky-400 border border-slate-300 dark:border-slate-700"
                  >
                    Change Photo (फ़ोटो बदलें)
                  </button>
                  {profilePhotoUrl && (
                    <button
                      type="button"
                      onClick={() => setProfilePhotoUrl('')}
                      className="px-2.5 py-1.5 rounded-xl bg-rose-500/15 dark:bg-rose-950/80 border border-rose-500/40 dark:border-rose-800 text-rose-600 dark:text-rose-300 text-xs font-bold"
                    >
                      Remove
                    </button>
                  )}
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-black dark:text-slate-200 mb-1">
                  Registered Email ID (Permanent History Key)
                </label>
                <input
                  type="text"
                  disabled
                  value={currentStudent.emailOrRoll}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 text-sm font-mono-tabular text-slate-600 dark:text-slate-400"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-black dark:text-slate-200 mb-1">
                  Full Name (पूरा नाम) *
                </label>
                <input
                  type="text"
                  required
                  value={profileName}
                  onChange={(e) => setProfileName(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-sm font-semibold text-black dark:text-white"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-black dark:text-slate-200 mb-1">
                    Mobile / WhatsApp No.
                  </label>
                  <input
                    type="tel"
                    value={profilePhone}
                    onChange={(e) => setProfilePhone(e.target.value)}
                    placeholder="e.g. 9876543210"
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-sm text-black dark:text-white"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-black dark:text-slate-200 mb-1">
                    City / Study Center
                  </label>
                  <input
                    type="text"
                    value={profileCity}
                    onChange={(e) => setProfileCity(e.target.value)}
                    placeholder="e.g. Kota / Sikar / Patna"
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-sm text-black dark:text-white"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-black dark:text-slate-200 mb-1">
                  Target NEET Batch
                </label>
                <select
                  value={profileBatch}
                  onChange={(e) => setProfileBatch(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-xs sm:text-sm font-semibold text-black dark:text-white"
                >
                  <option value="NEET 2027 · Vs Target Batch">
                    NEET 2027 · Vs Target Batch
                  </option>
                  <option value="NEET 2027 · PRAYAS Dropper Batch">
                    NEET 2027 · PRAYAS Dropper Batch
                  </option>
                  <option value="NEET 2027 · Class 12th Target">
                    NEET 2027 · Class 12th Target
                  </option>
                  <option value="NEET 2027 · Class 11th Foundation">
                    NEET 2027 · Class 11th Foundation
                  </option>
                </select>
              </div>

              <div className="p-3 rounded-xl bg-slate-100 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 space-y-2">
                <label className="block text-xs font-extrabold text-sky-600 dark:text-sky-400">
                  Password Recovery Security Question
                </label>
                <select
                  value={profileSecurityQuestion}
                  onChange={(e) => setProfileSecurityQuestion(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-xs font-bold text-black dark:text-white"
                >
                  {SECURITY_QUESTIONS_LIST.map((q) => (
                    <option key={q} value={q}>
                      {q}
                    </option>
                  ))}
                </select>
                <input
                  type="text"
                  value={profileSecurityAnswer}
                  onChange={(e) => setProfileSecurityAnswer(e.target.value)}
                  placeholder="Your secret recovery answer..."
                  className="w-full px-3.5 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-sm text-black dark:text-white"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-black dark:text-slate-200 mb-1">
                  Change Password (Optional)
                </label>
                <input
                  type="password"
                  value={profileNewPassword}
                  onChange={(e) => setProfileNewPassword(e.target.value)}
                  placeholder="Leave blank to keep current password..."
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-sm text-black dark:text-white"
                />
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => setShowProfileModal(false)}
                  className="px-4 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-xs sm:text-sm font-bold text-black dark:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSavingProfile}
                  className="px-6 py-2.5 rounded-xl ice-glow-btn text-xs sm:text-sm font-extrabold flex items-center gap-1.5"
                >
                  {isSavingProfile ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <CheckCircle2 className="w-4 h-4" />
                  )}
                  <span>Save Profile</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* =====================================================================
          MODAL 4: PRE-EXAM INSTRUCTIONS & 2-MODE SELECTOR MODAL
         ===================================================================== */}
      {selectedTestForInstructions && (
        <div
          onClick={() => setSelectedTestForInstructions(null)}
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="max-w-xl w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-2xl p-6 md:p-7 space-y-5 shadow-2xl"
          >
            <div className="flex items-start justify-between gap-3 border-b border-slate-200 dark:border-slate-800 pb-4">
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="px-2.5 py-1 rounded-lg bg-sky-500/15 dark:bg-sky-950 border border-sky-500/40 dark:border-sky-800 text-sky-900 dark:text-sky-300 text-xs font-extrabold">
                    {selectedTestForInstructions.subject}
                  </span>
                </div>
                <h3 className="text-xl md:text-2xl font-extrabold text-black dark:text-white mt-2">
                  {selectedTestForInstructions.title}
                </h3>
                <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 mt-0.5">
                  {selectedTestForInstructions.subTitle}
                </p>
              </div>
              <button
                onClick={() => setSelectedTestForInstructions(null)}
                className="p-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-black dark:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-3 gap-3 text-center">
              <div className="bg-slate-100 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-xl p-3">
                <FileText className="w-4 h-4 text-sky-600 dark:text-sky-400 mx-auto mb-1" />
                <div className="text-xs text-slate-600 dark:text-slate-400">Total Questions</div>
                <div className="text-lg font-extrabold text-black dark:text-white font-mono-tabular">
                  {selectedTestForInstructions.totalQuestions}
                </div>
              </div>
              <div className="bg-slate-100 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-xl p-3">
                <Award className="w-4 h-4 text-sky-600 dark:text-sky-400 mx-auto mb-1" />
                <div className="text-xs text-slate-600 dark:text-slate-400">Maximum Marks</div>
                <div className="text-lg font-extrabold text-black dark:text-white font-mono-tabular">
                  {selectedTestForInstructions.maxMarks}
                </div>
              </div>
              <div className="bg-slate-100 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-xl p-3">
                <Clock className="w-4 h-4 text-sky-600 dark:text-sky-400 mx-auto mb-1" />
                <div className="text-xs text-slate-600 dark:text-slate-400">Duration</div>
                <div className="text-lg font-extrabold text-black dark:text-white font-mono-tabular">
                  {selectedTestForInstructions.durationMinutes} mins
                </div>
              </div>
            </div>

            {latestAttemptByTestId[selectedTestForInstructions.id] && (
              <div className="p-3.5 rounded-xl bg-emerald-500/15 dark:bg-emerald-950/70 border border-emerald-500/40 dark:border-emerald-700 flex items-center justify-between gap-3">
                <div className="text-xs sm:text-sm text-black dark:text-emerald-200">
                  <div className="font-extrabold">
                    You have already completed this test! (Score:{' '}
                    {latestAttemptByTestId[selectedTestForInstructions.id].score}/
                    {latestAttemptByTestId[selectedTestForInstructions.id].maxMarks})
                  </div>
                  <div className="text-xs opacity-80">
                    You can view your full question-by-question analysis or start a fresh attempt.
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    handleAnalyzeCompletedAttempt(
                      latestAttemptByTestId[selectedTestForInstructions.id]
                    )
                  }
                  className="min-h-[42px] px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-extrabold shrink-0 flex items-center gap-1.5"
                >
                  <BarChart3 className="w-4 h-4" />
                  <span>Analyze</span>
                </button>
              </div>
            )}

            {/* Choose Mode: ONLY 2 Modes — Full Test Mode & Practice Mode */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setSelectedExamLaunchMode('html')}
                className={`p-4 rounded-xl border text-left transition ${
                  selectedExamLaunchMode === 'html'
                    ? 'bg-emerald-500/15 dark:bg-emerald-950/60 border-emerald-500 ring-1 ring-emerald-400'
                    : 'bg-slate-100 dark:bg-slate-950 border-slate-300 dark:border-slate-800 hover:border-slate-400 dark:hover:border-slate-700'
                }`}
              >
                <div className="text-sm sm:text-base font-extrabold text-emerald-700 dark:text-emerald-300 flex items-center gap-2">
                  <Play className="w-4 h-4 text-emerald-600 dark:text-emerald-400 fill-current" />
                  <span>1. Full Test Mode (टेस्ट मोड)</span>
                </div>
                <p className="text-xs text-slate-700 dark:text-slate-300 mt-1">
                  Complete the full exam paper in real test environment with live scoring.
                </p>
              </button>

              <button
                type="button"
                onClick={() => setSelectedExamLaunchMode('practice')}
                className={`p-4 rounded-xl border text-left transition ${
                  selectedExamLaunchMode === 'practice'
                    ? 'bg-sky-500/15 dark:bg-sky-950/60 border-sky-500 ring-1 ring-sky-400'
                    : 'bg-slate-100 dark:bg-slate-950 border-slate-300 dark:border-slate-800 hover:border-slate-400 dark:hover:border-slate-700'
                }`}
              >
                <div className="text-sm sm:text-base font-extrabold text-sky-700 dark:text-sky-300 flex items-center gap-2">
                  <BookOpen className="w-4 h-4 text-sky-600 dark:text-sky-400" />
                  <span>2. Practice Mode (प्रैक्टिस मोड)</span>
                </div>
                <p className="text-xs text-slate-700 dark:text-slate-300 mt-1">
                  Check instant answer &amp; detailed NCERT explanation on every question.
                </p>
              </button>
            </div>

            <div className="rounded-xl bg-slate-100 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 p-4 text-xs sm:text-sm space-y-1.5 text-black dark:text-slate-200">
              <div className="font-bold text-black dark:text-white">Exam Instructions:</div>
              <ul className="list-disc list-inside space-y-1 text-xs sm:text-sm">
                <li>
                  Correct Answer:{' '}
                  <strong className="text-emerald-600 dark:text-emerald-400">
                    +{selectedTestForInstructions.correctMarks} marks
                  </strong>{' '}
                  · Incorrect Answer:{' '}
                  <strong className="text-rose-600 dark:text-rose-400">
                    -{selectedTestForInstructions.negativeMarks} mark
                  </strong>
                </li>
                <li>
                  Completing this test automatically increases your 🔥 Daily Study Streak!
                </li>
              </ul>
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setSelectedTestForInstructions(null)}
                className="min-h-[46px] px-4 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-xs sm:text-sm font-semibold text-black dark:text-white"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isLoadingTestQuestions}
                onClick={() => handleStartExamNow(selectedTestForInstructions)}
                className="min-h-[46px] inline-flex items-center gap-2 px-6 py-2.5 rounded-xl ice-glow-btn text-sm sm:text-base font-extrabold disabled:opacity-50 active:scale-[0.98]"
              >
                {isLoadingTestQuestions ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" /> Loading Test...
                  </>
                ) : (
                  <>
                    <Play className="w-4 h-4 fill-current" /> Start Test Now
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          MODAL 5: STUDENT NOTIFICATIONS & PHONE PUSH ALERTS MODAL
         ===================================================================== */}
      {showNotificationsModal && (
        <div
          onClick={() => setShowNotificationsModal(false)}
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="max-w-lg w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-2xl p-6 space-y-4 max-h-[88vh] flex flex-col shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center">
                  <Bell className="w-5 h-5 text-amber-500" />
                </div>
                <div>
                  <h3 className="text-lg sm:text-xl font-black text-black dark:text-white">
                    Notifications &amp; Test Alerts
                  </h3>
                  <p className="text-xs font-semibold text-slate-600 dark:text-slate-400">
                    Live test schedules &amp; announcements
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowNotificationsModal(false)}
                className="p-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-black dark:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Phone Push Alert Permission Banner */}
            {notifPermissionState !== 'granted' && (
              <div className="p-3.5 rounded-xl bg-amber-500/15 dark:bg-amber-950/70 border border-amber-500/40 flex items-center justify-between gap-3">
                <div className="text-xs sm:text-sm font-bold text-black dark:text-amber-200">
                  Enable Phone Notifications to get instant alerts when a new test is uploaded or scheduled!
                </div>
                <button
                  type="button"
                  onClick={requestPhoneNotificationPermission}
                  className="px-3.5 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-black shrink-0"
                >
                  Allow Alerts
                </button>
              </div>
            )}

            <div className="flex-1 overflow-y-auto space-y-3 pr-1">
              {notifications.length === 0 ? (
                <div className="py-10 text-center space-y-2">
                  <Bell className="w-10 h-10 text-slate-400 mx-auto" />
                  <p className="text-base font-bold text-black dark:text-white">
                    No notifications yet
                  </p>
                  <p className="text-xs text-slate-600 dark:text-slate-400">
                    Whenever a new test or schedule is published, it will appear right here and on your phone.
                  </p>
                </div>
              ) : (
                notifications.map((notif) => {
                  const linkedTest = notif.testId
                    ? tests.find((t) => t.id === notif.testId)
                    : undefined;
                  return (
                    <div
                      key={notif.id}
                      className="p-4 rounded-2xl bg-slate-100 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 space-y-2"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <h4 className="text-base font-black text-black dark:text-white">
                          {notif.title}
                        </h4>
                        <span className="text-[11px] font-mono-tabular font-semibold text-slate-600 dark:text-slate-400 shrink-0">
                          {new Date(notif.createdAt).toLocaleString('en-IN', {
                            day: '2-digit',
                            month: 'short',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                      </div>
                      <p className="text-sm font-medium text-black dark:text-slate-200 leading-relaxed">
                        {notif.message}
                      </p>
                      {linkedTest && (
                        <div className="pt-1">
                          <button
                            type="button"
                            onClick={() => {
                              setShowNotificationsModal(false);
                              handleStudentOpenTestCard(linkedTest);
                            }}
                            className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs sm:text-sm font-extrabold inline-flex items-center gap-1.5"
                          >
                            <Play className="w-3.5 h-3.5 fill-current" />
                            <span>Open {linkedTest.title}</span>
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}
      {/* =====================================================================
          MODAL 6: FULL-SCREEN EXACT NORMAL PDF VIEWER (Lazy PDF.js + Download)
         ===================================================================== */}
      {activeNormalPdfModal && (
        <PdfModalErrorBoundary
          url={activeNormalPdfModal.url}
          title={activeNormalPdfModal.title}
          fileName={activeNormalPdfModal.fileName}
          onClose={() => setActiveNormalPdfModal(null)}
        >
          <React.Suspense
            fallback={
              <div className="fixed inset-0 z-[80] bg-slate-950/92 flex flex-col items-center justify-center text-white gap-3">
                <Loader2 className="w-9 h-9 animate-spin text-emerald-400" />
                <div className="text-sm font-extrabold">Loading Exact PDF Viewer...</div>
              </div>
            }
          >
            <NormalPdfViewerModal
              url={activeNormalPdfModal.url}
              title={activeNormalPdfModal.title}
              fileName={activeNormalPdfModal.fileName}
              onClose={() => setActiveNormalPdfModal(null)}
            />
          </React.Suspense>
        </PdfModalErrorBoundary>
      )}
    </div>
  );
}

export default function App() {
  return (
    <GlobalPortalErrorBoundary>
      <AppContent />
    </GlobalPortalErrorBoundary>
  );
}
