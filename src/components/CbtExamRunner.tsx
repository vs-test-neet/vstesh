import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  Clock,
  ChevronLeft,
  ChevronRight,
  Flag,
  RotateCcw,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Printer,
  ZoomIn,
  X,
  LayoutGrid,
  Award,
  BookOpen,
  ArrowLeft,
  Languages,
  Bookmark,
  Eye,
  Lightbulb,
  Loader2,
  ShieldAlert,
  Share2,
  Download,
  FileDown,
  Copy,
  Check,
} from 'lucide-react';
import {
  CbtQuestion,
  CbtTestMeta,
  MistakeNotebookItem,
  TestAttempt,
  UnfinishedTestSummary,
  WeakLinkRescuePlan,
} from '../types';
import {
  buildStandaloneCbtHtmlFromQuestions,
  ensureImageDataUrl,
  normalizeCbtQuestion,
  parseCbtHtmlFile,
} from '../utils/htmlTestParser';
import { generateQuestionPaperPdfWithWatermark } from '../utils/questionPaperPdfGenerator';
import { HeartCelebrationCanvas } from './HeartCelebrationCanvas';

interface CbtExamRunnerProps {
  testMeta: CbtTestMeta;
  questions: CbtQuestion[];
  studentName: string;
  studentId?: string;
  studentEmail?: string;
  studentBatch?: string;
  practiceMode?: boolean;
  rawHtmlContent?: string;
  initialHtmlMode?: boolean;
  initialReviewAttempt?: TestAttempt | null;
  testAttempts?: TestAttempt[];
  onSyncMistakesAndBookmarks?: (items: MistakeNotebookItem[], masteredUids?: string[]) => void;
  onExit: () => void;
  onSubmitAttempt: (attempt: Omit<TestAttempt, 'id'>) => void;
}

type LangMode = 'both' | 'hi' | 'en';
type FontScale = 'normal' | 'large' | 'xlarge';

const HTML_TAG_REGEX = /<\/?[a-z][\s\S]*>/i;

function formatExamClock(secs: number) {
  const safe = Math.max(0, Math.floor(secs));
  const hrs = Math.floor(safe / 3600);
  const mins = Math.floor((safe % 3600) / 60);
  const s = safe % 60;
  if (hrs > 0) {
    return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${String(mins).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/**
 * Isolated 1-second exam timer badge so ticking every second NEVER re-renders the 90-180 question exam runner or base64 images
 */
const IsolatedExamTimerBadge = React.memo(function IsolatedExamTimerBadge({
  initialSeconds,
  isPaused,
  isPracticeActive,
  currentIdx,
  remainingSecondsRef,
  questionTimesRef,
  onTimeUp,
}: {
  initialSeconds: number;
  isPaused: boolean;
  isPracticeActive: boolean;
  currentIdx: number;
  remainingSecondsRef: React.MutableRefObject<number>;
  questionTimesRef: React.MutableRefObject<Record<number, number>>;
  onTimeUp: () => void;
}) {
  const [displaySecs, setDisplaySecs] = useState(initialSeconds);
  const currentIdxRef = useRef(currentIdx);
  currentIdxRef.current = currentIdx;
  const onTimeUpRef = useRef(onTimeUp);
  onTimeUpRef.current = onTimeUp;

  useEffect(() => {
    if (isPaused) return;
    const interval = window.setInterval(() => {
      const idx = currentIdxRef.current;
      questionTimesRef.current[idx] = (questionTimesRef.current[idx] || 0) + 1;

      const nextSecs = Math.max(0, remainingSecondsRef.current - 1);
      remainingSecondsRef.current = nextSecs;
      setDisplaySecs(nextSecs);

      if (nextSecs <= 0 && !isPracticeActive) {
        window.clearInterval(interval);
        onTimeUpRef.current();
      }
    }, 1000);
    return () => window.clearInterval(interval);
  }, [isPaused, isPracticeActive, remainingSecondsRef, questionTimesRef]);

  return (
    <div
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border font-mono-tabular text-xs sm:text-sm font-bold ${
        displaySecs < 300
          ? 'bg-rose-100/90 dark:bg-rose-950/90 border-rose-400 text-rose-900 dark:text-rose-200 animate-pulse'
          : 'ice-glass text-black dark:text-white border-sky-300 dark:border-slate-700'
      }`}
    >
      <Clock className="w-4 h-4 text-sky-600 dark:text-sky-400" />
      <span>{formatExamClock(displaySecs)}</span>
    </div>
  );
});

/**
 * Renders text that may contain chemistry/physics formatting tags (<sub>, <sup>, <br>, <b>, <i>, <table>, <img>)
 * or plain text with newlines.
 */
function RichQuestionText({
  text,
  className = '',
}: {
  text?: string;
  className?: string;
}) {
  if (!text) return null;
  const trimmed = String(text).trim();
  if (!trimmed) return null;
  const imgDataUrl = ensureImageDataUrl(trimmed);
  if (imgDataUrl) {
    return (
      <div className="my-2 w-full min-w-0 rounded-2xl overflow-hidden border border-slate-300 dark:border-slate-600 bg-white p-1.5 sm:p-3 shadow-xs">
        <img
          src={imgDataUrl}
          alt="Question Content"
          className="ultra-hd-img w-full max-w-full h-auto object-contain mx-auto block rounded-lg"
          loading="eager"
          decoding="sync"
        />
      </div>
    );
  }
  if (HTML_TAG_REGEX.test(trimmed)) {
    return (
      <div
        className={`whitespace-pre-line break-words min-w-0 ${className}`}
        dangerouslySetInnerHTML={{ __html: trimmed }}
      />
    );
  }
  return <div className={`whitespace-pre-line break-words min-w-0 ${className}`}>{trimmed}</div>;
}

export const CbtExamRunner: React.FC<CbtExamRunnerProps> = ({
  testMeta,
  questions: rawQuestions,
  studentName,
  studentId,
  studentEmail,
  studentBatch,
  practiceMode = false,
  rawHtmlContent = '',
  initialHtmlMode = false,
  initialReviewAttempt = null,
  testAttempts = [],
  onSyncMistakesAndBookmarks,
  onExit,
  onSubmitAttempt,
}) => {
  // Helper to normalize any option code ('A','B','C','D','1','2','3','4','(1)', etc.) to '1' | '2' | '3' | '4'
  const normalizeOptCode = useCallback((rawVal: unknown, fallback = '1'): string => {
    const s = String(rawVal ?? '').trim().toUpperCase().replace(/[()[\].]/g, '');
    if (s === '1' || s === 'A') return '1';
    if (s === '2' || s === 'B') return '2';
    if (s === '3' || s === 'C') return '3';
    if (s === '4' || s === 'D') return '4';
    return fallback;
  }, []);

  // Guarantee every question is normalized without re-running slow 12MB HTML parsing when questions already exist
  const questions = useMemo(() => {
    let safeList = Array.isArray(rawQuestions) ? rawQuestions : [];
    const needsHtmlHydration =
      safeList.length === 0 && Boolean(rawHtmlContent && rawHtmlContent.trim().length > 200);

    if (needsHtmlHydration && rawHtmlContent) {
      try {
        const parsed = parseCbtHtmlFile(rawHtmlContent, testMeta.title);
        if (parsed && Array.isArray(parsed.questions) && parsed.questions.length > 0) {
          safeList = parsed.questions;
        }
      } catch {
        // ignore hydration errors
      }
    }

    return safeList.map((q, idx) => {
      try {
        const norm = normalizeCbtQuestion(q, idx);
        const safeOptsHi =
          Array.isArray(norm.optionsHi) && norm.optionsHi.length > 0
            ? norm.optionsHi.slice(0, 4).map((o, oIdx) => ({
                id: String(oIdx + 1),
                text: String(o?.text || `विकल्प (${oIdx + 1})`),
              }))
            : [
                { id: '1', text: 'विकल्प (1)' },
                { id: '2', text: 'विकल्प (2)' },
                { id: '3', text: 'विकल्प (3)' },
                { id: '4', text: 'विकल्प (4)' },
              ];
        const safeOptsEn =
          Array.isArray(norm.optionsEn) && norm.optionsEn.length > 0
            ? norm.optionsEn.slice(0, 4).map((o, oIdx) => ({
                id: String(oIdx + 1),
                text: String(o?.text || `Option (${oIdx + 1})`),
              }))
            : [
                { id: '1', text: 'Option (1)' },
                { id: '2', text: 'Option (2)' },
                { id: '3', text: 'Option (3)' },
                { id: '4', text: 'Option (4)' },
              ];

        const rawSourceUid = (q as unknown as { sourceUid?: string })?.sourceUid;
        return {
          ...norm,
          ...(rawSourceUid ? { sourceUid: String(rawSourceUid) } : {}),
          id: idx + 1,
          questionHi: String(norm.questionHi || ''),
          questionEn: String(norm.questionEn || ''),
          optionsHi: safeOptsHi,
          optionsEn: safeOptsEn,
          correctAnswer: normalizeOptCode(norm.correctAnswer, '1'),
          alsoCorrect: norm.alsoCorrect ? normalizeOptCode(norm.alsoCorrect, '') : undefined,
        } as CbtQuestion;
      } catch {
        return normalizeCbtQuestion(null, idx);
      }
    });
  }, [rawQuestions, rawHtmlContent, testMeta.title, normalizeOptCode]);

  const inProgressStorageKey = `vs_neet_inprogress_${testMeta.id}`;

  // Load any saved in-progress exam session so accidental refresh never cuts the test off
  const savedProgress = useMemo(() => {
    if (initialReviewAttempt) return null;
    try {
      const raw = localStorage.getItem(inProgressStorageKey);
      if (!raw) return null;
      return JSON.parse(raw) as {
        currentIdx?: number;
        answers?: Record<number, string>;
        markedForReview?: Record<number, boolean>;
        bookmarked?: Record<number, boolean>;
        questionTimes?: Record<number, number>;
        remainingSeconds?: number;
        exactHtmlMode?: boolean;
      };
    } catch {
      return null;
    }
  }, [inProgressStorageKey, initialReviewAttempt]);

  const [exactHtmlMode, setExactHtmlMode] = useState<boolean>(() =>
    Boolean(!initialReviewAttempt && !practiceMode && (initialHtmlMode || Boolean(rawHtmlContent)))
  );
  const [htmlBridgeReady, setHtmlBridgeReady] = useState<boolean>(false);
  const [showHtmlFallbackExit, setShowHtmlFallbackExit] = useState<boolean>(false);
  const [isPracticeActive, setIsPracticeActive] = useState<boolean>(() =>
    Boolean(practiceMode && !initialHtmlMode)
  );

  const [currentIdx, setCurrentIdx] = useState<number>(() => {
    const savedIdx = Number(savedProgress?.currentIdx ?? 0);
    return Number.isFinite(savedIdx) && savedIdx >= 0 && savedIdx < Math.max(1, questions.length)
      ? savedIdx
      : 0;
  });

  const initialNormalizedAnswers = useMemo(() => {
    const rawAns = initialReviewAttempt?.answers || savedProgress?.answers || {};
    const cleaned: Record<number, string> = {};
    if (rawAns && typeof rawAns === 'object') {
      Object.entries(rawAns).forEach(([k, v]) => {
        const numKey = Number(k);
        if (Number.isFinite(numKey) && v) {
          cleaned[numKey] = normalizeOptCode(v, String(v).trim());
        }
      });
    }
    return cleaned;
  }, [initialReviewAttempt, savedProgress, normalizeOptCode]);

  const [answers, setAnswers] = useState<Record<number, string>>(() => initialNormalizedAnswers);
  const answersRef = useRef<Record<number, string>>(initialNormalizedAnswers);

  const [markedForReview, setMarkedForReview] = useState<Record<number, boolean>>(
    () => savedProgress?.markedForReview || {}
  );
  const [bookmarked, setBookmarked] = useState<Record<number, boolean>>(
    () => initialReviewAttempt?.bookmarked || savedProgress?.bookmarked || {}
  );
  const [paletteFilter, setPaletteFilter] = useState<'all' | 'bookmarked'>('all');
  const [revealedInPractice, setRevealedInPractice] = useState<Record<number, boolean>>({});
  const [visited, setVisited] = useState<Record<number, boolean>>(() => {
    const vis: Record<number, boolean> = { 0: true };
    Object.keys(initialNormalizedAnswers).forEach((k) => {
      vis[Number(k)] = true;
    });
    return vis;
  });
  const [questionTimes, setQuestionTimes] = useState<Record<number, number>>(
    () => initialReviewAttempt?.questionTimes || savedProgress?.questionTimes || {}
  );

  // Safe initial duration: never allow 1-3 minute accidental cutoffs when duration was entered in hours
  const safeInitialSeconds = useMemo(() => {
    const rawDur = Number(testMeta.durationMinutes) || 90;
    const normalizedMinutes =
      rawDur <= 6 ? rawDur * 60 : Math.max(rawDur, Math.min(180, Math.max(60, questions.length)));
    const defaultSecs = Math.max(3600, normalizedMinutes * 60);
    if (
      savedProgress?.remainingSeconds &&
      savedProgress.remainingSeconds > 120 &&
      savedProgress.remainingSeconds <= defaultSecs
    ) {
      return savedProgress.remainingSeconds;
    }
    return defaultSecs;
  }, [testMeta.durationMinutes, questions.length, savedProgress]);

  // Mutable refs for 1-second timer updates (zero React re-renders per second!)
  const remainingSecondsRef = useRef<number>(safeInitialSeconds);
  const questionTimesRef = useRef<Record<number, number>>(
    initialReviewAttempt?.questionTimes || savedProgress?.questionTimes || {}
  );

  const [isSubmitted, setIsSubmitted] = useState<boolean>(() => Boolean(initialReviewAttempt));
  const [showConfirmSubmit, setShowConfirmSubmit] = useState(false);
  const [showConfirmExit, setShowConfirmExit] = useState(false);
  const [showMobilePalette, setShowMobilePalette] = useState(false);
  const [langMode, setLangMode] = useState<LangMode>('both');

  // Permanently fixed to A++ ('xlarge') as requested, with selector buttons hidden
  const fontScale: FontScale = 'xlarge';

  const [zoomedImage, setZoomedImage] = useState<string | null>(null);
  const [zoomScale, setZoomScale] = useState<number>(1.5);
  const [solutionFilter, setSolutionFilter] = useState<
    'all' | 'correct' | 'wrong' | 'unattempted' | 'slow' | 'bookmarked'
  >('all');
  const [showHeartCelebration, setShowHeartCelebration] = useState(false);

  // Share Scorecard Modal & Web Share API state
  const [showShareModal, setShowShareModal] = useState(false);
  const [shareCardPreviewUrl, setShareCardPreviewUrl] = useState<string | null>(null);
  const [isGeneratingShareCard, setIsGeneratingShareCard] = useState(false);
  const [shareStatusMsg, setShareStatusMsg] = useState<string | null>(null);
  const [copiedSummaryLink, setCopiedSummaryLink] = useState(false);
  const [isGeneratingQuestionPdf, setIsGeneratingQuestionPdf] = useState(false);
  const [pdfProgressStep, setPdfProgressStep] = useState<string>('');
  const [pdfProgressPercent, setPdfProgressPercent] = useState<number>(0);
  const [htmlResultOverride, setHtmlResultOverride] = useState<{
    score: number;
    maxMarks: number;
    correctCount: number;
    wrongCount: number;
    unattemptedCount: number;
    accuracy: number;
    totalTimeSpent: number;
  } | null>(null);

  // Pre-decode upcoming question images so switching questions has 0ms lag
  useEffect(() => {
    if (isSubmitted) return;
    const indicesToPreload = [currentIdx, currentIdx + 1, currentIdx + 2, currentIdx + 3];
    for (const i of indicesToPreload) {
      const q = questions[i];
      if (!q) continue;
      const urls = new Set<string>();
      if (q.imageHi) urls.add(q.imageHi);
      if (q.imageEn) urls.add(q.imageEn);
      if (q.imageUrl) urls.add(q.imageUrl);
      if (Array.isArray(q.imageUrls)) {
        q.imageUrls.forEach((u) => {
          if (u) urls.add(u);
        });
      }
      urls.forEach((src) => {
        const img = new Image();
        img.decoding = 'async';
        img.src = src;
        if (typeof img.decode === 'function') {
          img.decode().catch(() => {});
        }
      });
    }
  }, [currentIdx, questions, isSubmitted]);

  // AI Weak Link Rescue Engine State
  const [rescuePlan, setRescuePlan] = useState<WeakLinkRescuePlan | null>(null);
  const [isLoadingRescue, setIsLoadingRescue] = useState(false);
  const [rescueMcqAnswers, setRescueMcqAnswers] = useState<Record<number, string>>({});

  // Persist in-progress state when user actions occur AND every 5 seconds for Auto-Resume protection
  const persistInProgressSnapshot = useCallback(
    (
      overrideAnswers?: Record<number, string>,
      overrideRemainingSecs?: number,
      overrideIdx?: number
    ) => {
      if (isSubmitted || testMeta.id === 'mistake_retest_session') return;
      const activeAns = overrideAnswers ?? answersRef.current;
      const activeRem = overrideRemainingSecs ?? remainingSecondsRef.current;
      const activeIdx = overrideIdx ?? currentIdx;
      try {
        localStorage.setItem(
          inProgressStorageKey,
          JSON.stringify({
            currentIdx: activeIdx,
            answers: activeAns,
            markedForReview,
            bookmarked,
            questionTimes: questionTimesRef.current,
            remainingSeconds: activeRem,
            exactHtmlMode,
          })
        );
        const answeredCount = Object.keys(activeAns || {}).filter(
          (k) => activeAns[Number(k)] !== undefined && String(activeAns[Number(k)]).trim() !== ''
        ).length;
        const summary: UnfinishedTestSummary = {
          testId: testMeta.id,
          testTitle: testMeta.title,
          subject: testMeta.subject,
          answeredCount,
          totalQuestions: questions.length || testMeta.totalQuestions || 90,
          remainingSeconds: activeRem,
          updatedAt: Date.now(),
        };
        localStorage.setItem('vs_neet_last_unfinished_test_v1', JSON.stringify(summary));
      } catch {
        // ignore storage quota errors
      }
    },
    [
      isSubmitted,
      testMeta.id,
      testMeta.title,
      testMeta.subject,
      testMeta.totalQuestions,
      questions.length,
      currentIdx,
      inProgressStorageKey,
      markedForReview,
      bookmarked,
      exactHtmlMode,
    ]
  );

  useEffect(() => {
    if (isSubmitted) return;
    persistInProgressSnapshot(answers, remainingSecondsRef.current, currentIdx);
  }, [isSubmitted, answers, currentIdx, markedForReview, bookmarked, exactHtmlMode, persistInProgressSnapshot]);

  useEffect(() => {
    if (isSubmitted || testMeta.id === 'mistake_retest_session') return;
    const id = window.setInterval(() => {
      persistInProgressSnapshot();
    }, 5000);
    return () => window.clearInterval(id);
  }, [isSubmitted, testMeta.id, persistInProgressSnapshot]);

  const goToQuestion = useCallback(
    (idx: number) => {
      if (idx < 0 || idx >= questions.length) return;
      setQuestionTimes({ ...questionTimesRef.current });
      setVisited((prev) => ({ ...prev, [idx]: true }));
      setCurrentIdx(idx);
      setShowMobilePalette(false);
    },
    [questions.length]
  );

  const selectOption = (optId: string) => {
    if (isSubmitted) return;
    const normalizedId = normalizeOptCode(optId, String(optId || '1').trim());
    const qIndex = Number(currentIdx);
    const updated = { ...answersRef.current, [qIndex]: normalizedId };
    answersRef.current = updated;
    setAnswers(updated);
    setVisited((prev) => ({ ...prev, [qIndex]: true }));
    if (isPracticeActive) {
      setRevealedInPractice((prev) => ({ ...prev, [qIndex]: true }));
      // Auto-save mistake immediately in Practice Mode when a wrong option is selected
      const q = questions[qIndex];
      if (q && onSyncMistakesAndBookmarks) {
        const normCorrect = normalizeOptCode(q.correctAnswer, String(q.correctAnswer));
        const normAlso = q.alsoCorrect ? normalizeOptCode(q.alsoCorrect, String(q.alsoCorrect)) : '';
        const isCorrect =
          normalizedId === normCorrect || Boolean(normAlso && normalizedId === normAlso);
        if (!isCorrect) {
          onSyncMistakesAndBookmarks([
            {
              uid: `${testMeta.id}_q_${q.id}`,
              testId: testMeta.id,
              testTitle: testMeta.title,
              subject: testMeta.subject,
              question: q,
              chosenAnswer: normalizedId,
              reason: bookmarked[qIndex] ? 'both' : 'wrong',
              savedAt: Date.now(),
            },
          ]);
        }
      }
    }
  };

  const clearResponse = () => {
    if (isSubmitted) return;
    const qIndex = Number(currentIdx);
    const next = { ...answersRef.current };
    delete next[qIndex];
    answersRef.current = next;
    setAnswers(next);
    setRevealedInPractice((prev) => {
      const nextRev = { ...prev };
      delete nextRev[qIndex];
      return nextRev;
    });
  };

  const toggleMarkReview = () => {
    if (isSubmitted) return;
    setMarkedForReview((prev) => ({
      ...prev,
      [currentIdx]: !prev[currentIdx],
    }));
  };

  const toggleBookmark = () => {
    setBookmarked((prev) => {
      const next = { ...prev, [currentIdx]: !prev[currentIdx] };
      if (next[currentIdx] && onSyncMistakesAndBookmarks && questions[currentIdx]) {
        const q = questions[currentIdx];
        onSyncMistakesAndBookmarks([
          {
            uid: `${testMeta.id}_q_${q.id}`,
            testId: testMeta.id,
            testTitle: testMeta.title,
            subject: testMeta.subject,
            question: q,
            chosenAnswer: answers[currentIdx],
            reason: 'bookmarked',
            savedAt: Date.now(),
          },
        ]);
      }
      return next;
    });
  };

  const toggleBookmarkAtIdx = (idx: number) => {
    setBookmarked((prev) => {
      const isNowSaved = !prev[idx];
      const next = { ...prev, [idx]: isNowSaved };
      if (onSyncMistakesAndBookmarks && questions[idx]) {
        const q = questions[idx];
        const uid = `${testMeta.id}_q_${q.id}`;
        if (isNowSaved) {
          onSyncMistakesAndBookmarks([
            {
              uid,
              testId: testMeta.id,
              testTitle: testMeta.title,
              subject: testMeta.subject,
              question: q,
              chosenAnswer: answers[idx],
              reason: 'bookmarked',
              savedAt: Date.now(),
            },
          ]);
        } else {
          onSyncMistakesAndBookmarks([], [uid]);
        }
      }
      return next;
    });
  };

  const saveAndNext = () => {
    if (currentIdx < questions.length - 1) {
      goToQuestion(currentIdx + 1);
    } else {
      setQuestionTimes({ ...questionTimesRef.current });
      setShowConfirmSubmit(true);
    }
  };

  const markReviewAndNext = () => {
    setMarkedForReview((prev) => ({ ...prev, [currentIdx]: true }));
    if (currentIdx < questions.length - 1) {
      goToQuestion(currentIdx + 1);
    } else {
      setQuestionTimes({ ...questionTimesRef.current });
      setShowConfirmSubmit(true);
    }
  };

  // Keyboard shortcuts for fast desktop navigation
  useEffect(() => {
    if (isSubmitted || showConfirmSubmit || showConfirmExit || exactHtmlMode) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (['1', '2', '3', '4'].includes(e.key)) {
        selectOption(e.key);
      } else if (e.key === 'ArrowRight' || e.key.toLowerCase() === 'n') {
        if (currentIdx < questions.length - 1) goToQuestion(currentIdx + 1);
      } else if (e.key === 'ArrowLeft' || e.key.toLowerCase() === 'p') {
        if (currentIdx > 0) goToQuestion(currentIdx - 1);
      } else if (e.key.toLowerCase() === 'm') {
        toggleMarkReview();
      } else if (e.key.toLowerCase() === 'c') {
        clearResponse();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isSubmitted, showConfirmSubmit, showConfirmExit, exactHtmlMode, currentIdx, questions.length]);

  // Compute results
  const resultSummary = useMemo(() => {
    let correctCount = 0;
    let wrongCount = 0;
    let unattemptedCount = 0;
    const chapterStats: Record<
      string,
      { total: number; correct: number; wrong: number; unattempted: number; timeSpent: number }
    > = {};

    questions.forEach((q, idx) => {
      const ch = q.chapter || 'NEET Syllabus';
      if (!chapterStats[ch]) {
        chapterStats[ch] = { total: 0, correct: 0, wrong: 0, unattempted: 0, timeSpent: 0 };
      }
      chapterStats[ch].total += 1;
      chapterStats[ch].timeSpent += questionTimes[idx] || 0;

      const chosen = answers[idx];
      if (!chosen) {
        unattemptedCount += 1;
        chapterStats[ch].unattempted += 1;
      } else {
        const isCorrect =
          String(chosen) === String(q.correctAnswer) ||
          (q.alsoCorrect && String(chosen) === String(q.alsoCorrect));
        if (isCorrect) {
          correctCount += 1;
          chapterStats[ch].correct += 1;
        } else {
          wrongCount += 1;
          chapterStats[ch].wrong += 1;
        }
      }
    });

    const hasSavedAnswers = Object.keys(answers).length > 0;
    if (initialReviewAttempt && !hasSavedAnswers) {
      return {
        score: initialReviewAttempt.score,
        correctCount: initialReviewAttempt.correctCount,
        wrongCount: initialReviewAttempt.wrongCount,
        unattemptedCount: initialReviewAttempt.unattemptedCount,
        accuracy: initialReviewAttempt.accuracy,
        totalTimeSpent: initialReviewAttempt.timeTakenSeconds,
        chapterStats,
      };
    }

    const rawScore =
      correctCount * testMeta.correctMarks - wrongCount * testMeta.negativeMarks;
    const attempted = correctCount + wrongCount;
    const accuracy = attempted > 0 ? Math.round((correctCount / attempted) * 100) : 0;
    const totalTimeSpent =
      Object.values(questionTimes).reduce((a, b) => a + b, 0) ||
      initialReviewAttempt?.timeTakenSeconds ||
      0;

    return {
      score: rawScore,
      correctCount,
      wrongCount,
      unattemptedCount,
      accuracy,
      totalTimeSpent,
      chapterStats,
    };
  }, [questions, answers, questionTimes, testMeta, initialReviewAttempt]);

  // Auto-sync mistakes when opening a previously completed test review
  const hasSyncedReviewMistakesRef = useRef(false);
  useEffect(() => {
    if (!initialReviewAttempt || hasSyncedReviewMistakesRef.current || !onSyncMistakesAndBookmarks) {
      return;
    }
    hasSyncedReviewMistakesRef.current = true;
    const itemsToSync: MistakeNotebookItem[] = [];
    questions.forEach((q, idx) => {
      const chosen = answers[idx];
      const isBookmarkedQ = Boolean(bookmarked[idx]);
      const qUid = `${testMeta.id}_q_${q.id}`;
      if (!chosen) {
        if (isBookmarkedQ) {
          itemsToSync.push({
            uid: qUid,
            testId: testMeta.id,
            testTitle: testMeta.title,
            subject: testMeta.subject,
            question: q,
            reason: 'bookmarked',
            savedAt: Date.now(),
          });
        }
      } else {
        const normChosen = normalizeOptCode(chosen, String(chosen));
        const normCorrect = normalizeOptCode(q.correctAnswer, String(q.correctAnswer));
        const normAlso = q.alsoCorrect ? normalizeOptCode(q.alsoCorrect, String(q.alsoCorrect)) : '';
        const isCorrect =
          normChosen === normCorrect || Boolean(normAlso && normChosen === normAlso);
        if (!isCorrect || isBookmarkedQ) {
          itemsToSync.push({
            uid: qUid,
            testId: testMeta.id,
            testTitle: testMeta.title,
            subject: testMeta.subject,
            question: q,
            chosenAnswer: normChosen,
            reason: !isCorrect && isBookmarkedQ ? 'both' : !isCorrect ? 'wrong' : 'bookmarked',
            savedAt: Date.now(),
          });
        }
      }
    });
    if (itemsToSync.length > 0) {
      onSyncMistakesAndBookmarks(itemsToSync);
    }
  }, [initialReviewAttempt, questions, answers, bookmarked, testMeta, normalizeOptCode, onSyncMistakesAndBookmarks]);

  const handleFinalizeSubmit = () => {
    if (isSubmitted) return;
    const latestAnswers = { ...answers, ...answersRef.current };
    answersRef.current = latestAnswers;
    setAnswers(latestAnswers);

    const latestQTimes = { ...questionTimesRef.current };
    setQuestionTimes(latestQTimes);
    setIsSubmitted(true);
    setShowConfirmSubmit(false);
    setShowMobilePalette(false);
    setShowHeartCelebration(true);
    setTimeout(() => setShowHeartCelebration(false), 5200);
    try {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch {
      // ignore
    }
    try {
      localStorage.removeItem(inProgressStorageKey);
      const rawLast = localStorage.getItem('vs_neet_last_unfinished_test_v1');
      if (rawLast) {
        const parsedLast = JSON.parse(rawLast) as UnfinishedTestSummary;
        if (parsedLast.testId === testMeta.id) {
          localStorage.removeItem('vs_neet_last_unfinished_test_v1');
        }
      }
    } catch {
      // ignore
    }

    let cCount = 0;
    let wCount = 0;
    let uCount = 0;
    const mistakeItemsToSync: MistakeNotebookItem[] = [];
    const masteredUidsToRemove: string[] = [];

    questions.forEach((q, idx) => {
      const chosen = latestAnswers[idx];
      const isBookmarkedQ = Boolean(bookmarked[idx]);
      const qSourceUid = (q as unknown as { sourceUid?: string }).sourceUid;
      const qUid =
        testMeta.id === 'mistake_retest_session' && qSourceUid
          ? qSourceUid
          : `${testMeta.id}_q_${q.id}`;
      if (!chosen) {
        uCount += 1;
        if (isBookmarkedQ) {
          mistakeItemsToSync.push({
            uid: qUid,
            testId: testMeta.id,
            testTitle: testMeta.title,
            subject: testMeta.subject,
            question: q,
            reason: 'bookmarked',
            savedAt: Date.now(),
          });
        }
      } else {
        const normChosen = normalizeOptCode(chosen, String(chosen));
        const normCorrect = normalizeOptCode(q.correctAnswer, String(q.correctAnswer));
        const normAlso = q.alsoCorrect ? normalizeOptCode(q.alsoCorrect, String(q.alsoCorrect)) : '';
        const isCorrect = normChosen === normCorrect || Boolean(normAlso && normChosen === normAlso);
        if (isCorrect) {
          cCount += 1;
          if (isBookmarkedQ) {
            mistakeItemsToSync.push({
              uid: qUid,
              testId: testMeta.id,
              testTitle: testMeta.title,
              subject: testMeta.subject,
              question: q,
              chosenAnswer: normChosen,
              reason: 'bookmarked',
              savedAt: Date.now(),
            });
          } else if (testMeta.id === 'mistake_retest_session' && qSourceUid) {
            masteredUidsToRemove.push(qSourceUid);
          }
        } else {
          wCount += 1;
          mistakeItemsToSync.push({
            uid: qUid,
            testId: testMeta.id,
            testTitle: testMeta.title,
            subject: testMeta.subject,
            question: q,
            chosenAnswer: normChosen,
            reason: isBookmarkedQ ? 'both' : 'wrong',
            savedAt: Date.now(),
          });
        }
      }
    });

    if (onSyncMistakesAndBookmarks && (mistakeItemsToSync.length > 0 || masteredUidsToRemove.length > 0)) {
      onSyncMistakesAndBookmarks(mistakeItemsToSync, masteredUidsToRemove);
    }

    const finalScore = cCount * testMeta.correctMarks - wCount * testMeta.negativeMarks;
    const attemptedCount = cCount + wCount;
    const finalAcc = attemptedCount > 0 ? Math.round((cCount / attemptedCount) * 100) : 0;
    const finalTimeSpent =
      Object.values(latestQTimes).reduce((a, b) => a + b, 0) ||
      Math.max(1, safeInitialSeconds - remainingSecondsRef.current);

    onSubmitAttempt({
      testId: testMeta.id,
      testTitle: testMeta.title,
      studentId,
      studentEmail,
      studentName: studentName || 'NEET Aspirant',
      studentBatch,
      score: finalScore,
      maxMarks: testMeta.maxMarks,
      correctCount: cCount,
      wrongCount: wCount,
      unattemptedCount: uCount,
      accuracy: finalAcc,
      timeTakenSeconds: Math.max(1, finalTimeSpent),
      completedAt: Date.now(),
      answers: latestAnswers,
      questionTimes: latestQTimes,
      bookmarked,
    });
  };

  // Launch AI Weak Link Rescue Engine for the completed test
  const handleGenerateWeakLinkRescue = async () => {
    if (isLoadingRescue) return;
    setIsLoadingRescue(true);
    try {
      const sortedWeakChapters = Object.entries(resultSummary.chapterStats)
        .sort((a, b) => {
          const errA = a[1].wrong * 2 + a[1].unattempted;
          const errB = b[1].wrong * 2 + b[1].unattempted;
          return errB - errA;
        })
        .map(([ch]) => ch)
        .slice(0, 4);

      const res = await fetch('/api/ai-weak-link-rescue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          studentName: studentName || 'NEET Aspirant',
          testTitle: testMeta.title,
          subject: testMeta.subject,
          score: resultSummary.score,
          maxMarks: testMeta.maxMarks,
          accuracy: resultSummary.accuracy,
          weakChapters:
            sortedWeakChapters.length > 0 ? sortedWeakChapters : [testMeta.chapter || 'NEET Biology'],
          wrongQuestionsSummary: `${resultSummary.wrongCount} incorrect, ${resultSummary.unattemptedCount} unattempted out of ${questions.length} questions`,
        }),
      });
      if (res.ok) {
        const data = (await res.json()) as WeakLinkRescuePlan;
        setRescuePlan(data);
        setRescueMcqAnswers({});
      }
    } catch {
      // ignore
    } finally {
      setIsLoadingRescue(false);
    }
  };

  // Palette counts — always check hasAns FIRST so any selected answer is counted even if visited wasn't set
  const paletteCounts = useMemo(() => {
    let answered = 0;
    let notAnswered = 0;
    let marked = 0;
    let answeredMarked = 0;
    let notVisited = 0;
    let bookmarkedCount = 0;

    questions.forEach((_, idx) => {
      const rawAns = answers[idx] ?? answersRef.current[idx];
      const hasAns = Boolean(rawAns && String(rawAns).trim().length > 0);
      const isMarked = Boolean(markedForReview[idx]);
      const isVis = Boolean(visited[idx]) || idx === currentIdx;
      if (bookmarked[idx]) bookmarkedCount++;

      if (hasAns && isMarked) {
        answeredMarked++;
      } else if (hasAns) {
        answered++;
      } else if (isMarked) {
        marked++;
      } else if (!isVis) {
        notVisited++;
      } else {
        notAnswered++;
      }
    });

    const totalAnswered = answered + answeredMarked;
    return { answered, notAnswered, marked, answeredMarked, notVisited, bookmarkedCount, totalAnswered };
  }, [questions, answers, markedForReview, visited, bookmarked, currentIdx]);

  // Memoize the 180-question palette buttons so 1-second timer updates never re-render the palette grid
  const memoizedPaletteButtons = useMemo(() => {
    return questions.map((_, idx) => {
      if (paletteFilter === 'bookmarked' && !bookmarked[idx]) {
        return null;
      }
      const hasAns = Boolean(answers[idx]);
      const isMarked = Boolean(markedForReview[idx]);
      const isVis = Boolean(visited[idx]);
      const isBookmarked = Boolean(bookmarked[idx]);
      const isCurrent = idx === currentIdx;

      let pillClass =
        'bg-white/90 dark:bg-slate-800 text-black dark:text-white border border-sky-200 dark:border-slate-700 hover:bg-sky-50 dark:hover:bg-slate-700';
      if (hasAns && isMarked) {
        pillClass = 'bg-indigo-600 text-white shadow-xs';
      } else if (hasAns) {
        pillClass = 'bg-emerald-500 text-white shadow-xs';
      } else if (isMarked) {
        pillClass = 'bg-purple-500 text-white shadow-xs';
      } else if (isVis) {
        pillClass = 'bg-rose-500 text-white shadow-xs';
      }

      return (
        <button
          key={idx}
          type="button"
          onClick={() => {
            setCurrentIdx(idx);
            setVisited((prev) => ({ ...prev, [idx]: true }));
            setShowMobilePalette(false);
          }}
          className={`relative h-10 rounded-xl font-mono-tabular text-xs font-bold transition ${pillClass} ${
            isCurrent ? 'ring-2 ring-sky-500 ring-offset-2 scale-105' : ''
          }`}
        >
          {idx + 1}
          {isBookmarked && (
            <span className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-amber-400 border border-white flex items-center justify-center shadow-xs">
              <Bookmark className="w-2 h-2 fill-amber-950 text-amber-950" />
            </span>
          )}
        </button>
      );
    });
  }, [questions, paletteFilter, bookmarked, answers, markedForReview, visited, currentIdx]);

  const formatTime = (secs: number) => {
    const hrs = Math.floor(secs / 3600);
    const mins = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    if (hrs > 0) {
      return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }
    return `${String(mins).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  // Effective stats for sharing (uses HTML test result override when sharing from inside HTML test view)
  const activeShareStats = useMemo(() => {
    if (htmlResultOverride) return htmlResultOverride;
    return {
      score: resultSummary.score,
      maxMarks: Math.max(4, testMeta.maxMarks || questions.length * 4 || 360),
      correctCount: resultSummary.correctCount,
      wrongCount: resultSummary.wrongCount,
      unattemptedCount: resultSummary.unattemptedCount,
      accuracy: resultSummary.accuracy,
      totalTimeSpent: resultSummary.totalTimeSpent,
    };
  }, [htmlResultOverride, resultSummary, testMeta.maxMarks, questions.length]);

  const buildShareSummaryText = useCallback(
    (statsOverride?: typeof activeShareStats) => {
      const st = statsOverride || activeShareStats;
      const pct = st.maxMarks > 0 ? Math.round((Math.max(0, st.score) / st.maxMarks) * 100) : 0;
      const shareUrl = typeof window !== 'undefined' ? window.location.origin : '';
      return (
        `🏆 Vs Tests — Official NEET & Paramedical Test Result!\n` +
        `👤 Student: ${studentName || 'NEET Aspirant'}\n` +
        `📝 Test: ${testMeta.title}\n` +
        `🎯 Final Score: ${st.score} / ${st.maxMarks} (${pct}%)\n` +
        `✅ Correct: ${st.correctCount} | ❌ Wrong: ${st.wrongCount} | ⚪ Unattempted: ${st.unattemptedCount}\n` +
        `⚡ Accuracy: ${st.accuracy}% | ⏱️ Time: ${formatExamClock(st.totalTimeSpent)}\n` +
        `🔗 Attempt Live Bilingual CBT Test: ${shareUrl}`
      );
    },
    [activeShareStats, studentName, testMeta.title]
  );

  // Generate a crisp 1080x1280 Official Scorecard PNG Image on HTML5 Canvas
  const generateScorecardPng = useCallback(
    async (
      statsOverride?: typeof activeShareStats
    ): Promise<{ blob: Blob; dataUrl: string } | null> => {
      try {
        const st = statsOverride || activeShareStats;
        const pct = st.maxMarks > 0 ? Math.round((Math.max(0, st.score) / st.maxMarks) * 100) : 0;
        const canvas = document.createElement('canvas');
        canvas.width = 1080;
        canvas.height = 1280;
        const ctx = canvas.getContext('2d');
        if (!ctx) return null;

        // Background Gradient
        const bgGrad = ctx.createLinearGradient(0, 0, 1080, 1280);
        bgGrad.addColorStop(0, '#071526');
        bgGrad.addColorStop(0.5, '#0b2239');
        bgGrad.addColorStop(1, '#09192c');
        ctx.fillStyle = bgGrad;
        ctx.fillRect(0, 0, 1080, 1280);

        // Decorative Glow Orbs
        const glow1 = ctx.createRadialGradient(200, 140, 20, 200, 140, 380);
        glow1.addColorStop(0, 'rgba(14, 165, 233, 0.25)');
        glow1.addColorStop(1, 'rgba(14, 165, 233, 0)');
        ctx.fillStyle = glow1;
        ctx.fillRect(0, 0, 1080, 1280);

        const glow2 = ctx.createRadialGradient(880, 980, 20, 880, 980, 420);
        glow2.addColorStop(0, 'rgba(16, 185, 129, 0.2)');
        glow2.addColorStop(1, 'rgba(16, 185, 129, 0)');
        ctx.fillStyle = glow2;
        ctx.fillRect(0, 0, 1080, 1280);

        // Outer Card Border
        ctx.strokeStyle = 'rgba(56, 189, 248, 0.35)';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.roundRect(44, 44, 992, 1192, 36);
        ctx.stroke();

        // Top Header Pill
        ctx.fillStyle = 'rgba(14, 165, 233, 0.18)';
        ctx.beginPath();
        ctx.roundRect(90, 90, 900, 68, 20);
        ctx.fill();
        ctx.strokeStyle = 'rgba(56, 189, 248, 0.45)';
        ctx.lineWidth = 2;
        ctx.stroke();

        ctx.fillStyle = '#38bdf8';
        ctx.font = '800 26px system-ui, -apple-system, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('🏆 VS TESTS · OFFICIAL NEET UG & PARAMEDICAL SCORECARD', 540, 134);

        // Student Name & Date
        ctx.fillStyle = '#ffffff';
        ctx.font = '900 50px system-ui, -apple-system, sans-serif';
        const cleanStudent = (studentName || 'NEET Aspirant').slice(0, 32);
        ctx.fillText(cleanStudent, 540, 235);

        ctx.fillStyle = '#94a3b8';
        ctx.font = '600 24px system-ui, -apple-system, sans-serif';
        const dateStr = new Date().toLocaleDateString('en-IN', {
          day: '2-digit',
          month: 'short',
          year: 'numeric',
        });
        ctx.fillText(
          `${studentBatch || 'Target Batch'}  •  Completed on ${dateStr}`,
          540,
          280
        );

        // Test Title Box
        ctx.fillStyle = 'rgba(15, 23, 42, 0.78)';
        ctx.beginPath();
        ctx.roundRect(90, 320, 900, 130, 24);
        ctx.fill();
        ctx.strokeStyle = 'rgba(148, 163, 184, 0.25)';
        ctx.lineWidth = 2;
        ctx.stroke();

        ctx.fillStyle = '#f8fafc';
        ctx.font = '800 32px system-ui, -apple-system, sans-serif';
        const cleanTitle =
          testMeta.title.length > 48 ? `${testMeta.title.slice(0, 45)}...` : testMeta.title;
        ctx.fillText(cleanTitle, 540, 378);

        ctx.fillStyle = '#38bdf8';
        ctx.font = '700 24px system-ui, -apple-system, sans-serif';
        ctx.fillText(`${testMeta.subject || 'Biology · Chemistry · Physics'}`, 540, 422);

        // Hero Score Center Box
        const scoreGrad = ctx.createLinearGradient(90, 480, 990, 740);
        scoreGrad.addColorStop(0, 'rgba(16, 185, 129, 0.22)');
        scoreGrad.addColorStop(1, 'rgba(14, 165, 233, 0.22)');
        ctx.fillStyle = scoreGrad;
        ctx.beginPath();
        ctx.roundRect(90, 480, 900, 250, 32);
        ctx.fill();
        ctx.strokeStyle = 'rgba(52, 211, 153, 0.55)';
        ctx.lineWidth = 3;
        ctx.stroke();

        ctx.fillStyle = '#a7f3d0';
        ctx.font = '800 25px system-ui, -apple-system, sans-serif';
        ctx.fillText('FINAL EXAM SCORE', 540, 535);

        ctx.fillStyle = '#ffffff';
        ctx.font = '900 96px system-ui, -apple-system, sans-serif';
        ctx.fillText(`${st.score} / ${st.maxMarks}`, 540, 640);

        ctx.fillStyle = '#38bdf8';
        ctx.font = '800 30px system-ui, -apple-system, sans-serif';
        ctx.fillText(
          `Percentage: ${pct}%   •   Accuracy Rate: ${st.accuracy}%`,
          540,
          700
        );

        // 4 KPI Boxes Grid (2x2)
        const kpis = [
          {
            label: 'CORRECT ANSWERS',
            val: `${st.correctCount}`,
            color: '#34d399',
            bg: 'rgba(16, 185, 129, 0.14)',
            border: 'rgba(52, 211, 153, 0.4)',
            x: 90,
            y: 765,
          },
          {
            label: 'INCORRECT ANSWERS',
            val: `${st.wrongCount}`,
            color: '#fb7185',
            bg: 'rgba(244, 63, 94, 0.14)',
            border: 'rgba(251, 113, 133, 0.4)',
            x: 555,
            y: 765,
          },
          {
            label: 'UNATTEMPTED Qs',
            val: `${st.unattemptedCount}`,
            color: '#cbd5e1',
            bg: 'rgba(148, 163, 184, 0.12)',
            border: 'rgba(148, 163, 184, 0.35)',
            x: 90,
            y: 945,
          },
          {
            label: 'TIME TAKEN',
            val: formatExamClock(st.totalTimeSpent),
            color: '#38bdf8',
            bg: 'rgba(14, 165, 233, 0.14)',
            border: 'rgba(56, 189, 248, 0.4)',
            x: 555,
            y: 945,
          },
        ];

        for (const box of kpis) {
          ctx.fillStyle = box.bg;
          ctx.beginPath();
          ctx.roundRect(box.x, box.y, 435, 150, 24);
          ctx.fill();
          ctx.strokeStyle = box.border;
          ctx.lineWidth = 2;
          ctx.stroke();

          ctx.fillStyle = '#94a3b8';
          ctx.font = '800 21px system-ui, -apple-system, sans-serif';
          ctx.fillText(box.label, box.x + 217, box.y + 52);

          ctx.fillStyle = box.color;
          ctx.font = '900 54px system-ui, -apple-system, sans-serif';
          ctx.fillText(box.val, box.x + 217, box.y + 118);
        }

        // Footer Banner
        ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
        ctx.beginPath();
        ctx.roundRect(90, 1125, 900, 72, 20);
        ctx.fill();

        const portalUrl = typeof window !== 'undefined' ? window.location.origin : '';
        ctx.fillStyle = '#e2e8f0';
        ctx.font = '700 22px system-ui, -apple-system, sans-serif';
        ctx.fillText(`🔗 Practice Bilingual NEET Tests at: ${portalUrl}`, 540, 1170);

        const dataUrl = canvas.toDataURL('image/png');
        const blob = await new Promise<Blob | null>((resolve) =>
          canvas.toBlob((b) => resolve(b), 'image/png', 1)
        );
        if (!blob) return null;
        return { blob, dataUrl };
      } catch {
        return null;
      }
    },
    [activeShareStats, studentName, studentBatch, testMeta.title, testMeta.subject]
  );

  // Trigger Web Share API (shares Scorecard PNG Image + Summary Link or opens Share Modal)
  const handleShareResult = useCallback(
    async (
      mode: 'open_modal' | 'native_image' | 'native_link' = 'open_modal',
      statsOverride?: typeof activeShareStats
    ) => {
      if (statsOverride) {
        setHtmlResultOverride(statsOverride);
      }
      setShowShareModal(true);
      setShareStatusMsg(null);
      setIsGeneratingShareCard(true);

      const generated = await generateScorecardPng(statsOverride);
      if (generated) {
        setShareCardPreviewUrl(generated.dataUrl);
      }
      setIsGeneratingShareCard(false);

      const summaryText = buildShareSummaryText(statsOverride);
      const shareUrl = typeof window !== 'undefined' ? window.location.origin : '';

      if (mode === 'open_modal') {
        // Also immediately invoke native Web Share API if available on mobile/supported browsers
        if (typeof navigator !== 'undefined' && typeof navigator.share === 'function' && generated) {
          try {
            const safeFileName = `${(testMeta.title || 'Vs_Tests')
              .replace(/[^a-zA-Z0-9_-]+/g, '_')
              .slice(0, 35)}_Scorecard.png`;
            const imageFile = new File([generated.blob], safeFileName, { type: 'image/png' });
            if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [imageFile] })) {
              await navigator.share({
                files: [imageFile],
                title: `${testMeta.title} — Official Scorecard`,
                text: summaryText,
              });
              setShareStatusMsg('✅ Scorecard image shared with your friends!');
              return;
            }
          } catch (err) {
            if ((err as Error)?.name === 'AbortError') return;
          }
        }
        return;
      }

      if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
        try {
          if (mode === 'native_image' && generated) {
            const safeFileName = `${(testMeta.title || 'Vs_Tests')
              .replace(/[^a-zA-Z0-9_-]+/g, '_')
              .slice(0, 35)}_Scorecard.png`;
            const imageFile = new File([generated.blob], safeFileName, { type: 'image/png' });
            if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [imageFile] })) {
              await navigator.share({
                files: [imageFile],
                title: `${testMeta.title} — Official Scorecard`,
                text: summaryText,
              });
              setShareStatusMsg('✅ Scorecard image shared successfully!');
              return;
            }
          }
          await navigator.share({
            title: `${testMeta.title} — Official Scorecard`,
            text: summaryText,
            url: shareUrl,
          });
          setShareStatusMsg('✅ Test result summary link shared successfully!');
          return;
        } catch (err) {
          if ((err as Error)?.name === 'AbortError') return;
        }
      }

      // Fallback if Web Share API is not supported on desktop browser: copy summary link automatically
      try {
        await navigator.clipboard.writeText(summaryText);
        setCopiedSummaryLink(true);
        setShareStatusMsg('📋 Web Share dialog not supported on this browser — Summary & Link copied to clipboard!');
        setTimeout(() => setCopiedSummaryLink(false), 3000);
      } catch {
        setShareStatusMsg('Use Download PNG or Copy Summary below to share.');
      }
    },
    [generateScorecardPng, buildShareSummaryText, testMeta.title]
  );

  const handleDownloadScorecardPng = useCallback(async () => {
    let url = shareCardPreviewUrl;
    if (!url) {
      const gen = await generateScorecardPng();
      if (gen) {
        url = gen.dataUrl;
        setShareCardPreviewUrl(url);
      }
    }
    if (!url) return;
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(testMeta.title || 'Vs_Tests')
      .replace(/[^a-zA-Z0-9_-]+/g, '_')
      .slice(0, 40)}_Scorecard.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setShareStatusMsg('📥 Scorecard HD Image downloaded!');
  }, [shareCardPreviewUrl, generateScorecardPng, testMeta.title]);

  const handleCopyShareSummary = useCallback(async () => {
    const text = buildShareSummaryText();
    try {
      await navigator.clipboard.writeText(text);
      setCopiedSummaryLink(true);
      setShareStatusMsg('📋 Score Summary & Portal Link copied to clipboard!');
      setTimeout(() => setCopiedSummaryLink(false), 3000);
    } catch {
      setShareStatusMsg('Could not copy automatically.');
    }
  }, [buildShareSummaryText]);

  const renderShareScorecardModal = () => {
    if (!showShareModal) return null;
    return (
      <div className="fixed inset-0 z-[120] bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-3 sm:p-4 overflow-y-auto no-print">
        <div className="w-full max-w-lg rounded-3xl bg-slate-900 border border-sky-400/40 text-white shadow-2xl overflow-hidden my-auto">
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800 bg-slate-950/60">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-sky-500/20 border border-sky-400/40 flex items-center justify-center text-sky-400">
                <Share2 className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm sm:text-base font-extrabold text-white">
                  Share Test Scorecard &amp; Summary Link
                </h3>
                <p className="text-[11px] text-slate-400">
                  Share your HD Scorecard image or result summary with friends
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setShowShareModal(false)}
              className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 transition"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="p-4 sm:p-5 space-y-4">
            {/* Live Preview of Generated Scorecard Image */}
            <div className="rounded-2xl overflow-hidden border border-slate-700 bg-slate-950 flex items-center justify-center min-h-[260px] max-h-[380px] p-2">
              {isGeneratingShareCard ? (
                <div className="flex flex-col items-center gap-2 text-sky-400 py-12">
                  <Loader2 className="w-7 h-7 animate-spin" />
                  <span className="text-xs font-bold">Generating HD Scorecard Image...</span>
                </div>
              ) : shareCardPreviewUrl ? (
                <img
                  src={shareCardPreviewUrl}
                  alt="Test Scorecard Preview"
                  className="max-h-[350px] w-auto mx-auto object-contain rounded-xl shadow-lg"
                />
              ) : (
                <div className="text-xs text-slate-400 py-8">Scorecard preview ready</div>
              )}
            </div>

            {shareStatusMsg && (
              <div className="px-3.5 py-2.5 rounded-xl bg-emerald-500/15 border border-emerald-500/40 text-emerald-200 text-xs font-bold text-center">
                {shareStatusMsg}
              </div>
            )}

            {/* Primary Web Share API Buttons */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={() => handleShareResult('native_image')}
                className="min-h-[46px] px-4 py-2.5 rounded-xl bg-gradient-to-r from-emerald-500 to-sky-500 hover:from-emerald-600 hover:to-sky-600 text-white text-xs sm:text-sm font-extrabold flex items-center justify-center gap-2 shadow-md transition cursor-pointer"
              >
                <Share2 className="w-4 h-4" />
                <span>Share Scorecard Image</span>
              </button>

              <button
                type="button"
                onClick={() => handleShareResult('native_link')}
                className="min-h-[46px] px-4 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-xs sm:text-sm font-extrabold flex items-center justify-center gap-2 shadow-md transition cursor-pointer"
              >
                <Share2 className="w-4 h-4" />
                <span>Share Summary Link</span>
              </button>
            </div>

            {/* Secondary Download & Copy Actions */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={handleDownloadScorecardPng}
                className="min-h-[42px] px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-100 text-xs font-bold flex items-center justify-center gap-2 transition cursor-pointer"
              >
                <Download className="w-4 h-4 text-sky-400" />
                <span>Download Scorecard PNG</span>
              </button>

              <button
                type="button"
                onClick={handleCopyShareSummary}
                className="min-h-[42px] px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-100 text-xs font-bold flex items-center justify-center gap-2 transition cursor-pointer"
              >
                {copiedSummaryLink ? (
                  <>
                    <Check className="w-4 h-4 text-emerald-400" />
                    <span className="text-emerald-300">Copied Summary &amp; Link!</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-4 h-4 text-amber-400" />
                    <span>Copy Summary &amp; Link</span>
                  </>
                )}
              </button>
            </div>

            {/* Complete Question Paper PDF with VS Watermark */}
            <button
              type="button"
              disabled={isGeneratingQuestionPdf}
              onClick={() => handleDownloadQuestionPaperPdf()}
              className="w-full min-h-[46px] px-4 py-2.5 rounded-xl bg-gradient-to-r from-indigo-600 via-sky-600 to-cyan-600 hover:from-indigo-500 hover:to-cyan-500 disabled:opacity-60 text-white text-xs sm:text-sm font-extrabold flex items-center justify-center gap-2 shadow-lg border border-sky-300/30 transition cursor-pointer"
            >
              {isGeneratingQuestionPdf ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>{pdfProgressStep || 'Generating VS Watermarked PDF...'} ({pdfProgressPercent}%)</span>
                </>
              ) : (
                <>
                  <FileDown className="w-4 h-4" />
                  <span>Download Full Question Paper PDF (VS Watermark)</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    );
  };

  // Generate and download complete Question Paper + Answer Key + Solutions PDF with VS Watermark
  const handleDownloadQuestionPaperPdf = useCallback(
    async (statsOverride?: typeof activeShareStats) => {
      if (isGeneratingQuestionPdf) return;
      const activeSt = statsOverride || activeShareStats;
      setIsGeneratingQuestionPdf(true);
      setPdfProgressStep('Preparing questions & VS watermark...');
      setPdfProgressPercent(5);

      try {
        const activeAns =
          Object.keys(answersRef.current || {}).length > 0 ? answersRef.current : answers;
        await generateQuestionPaperPdfWithWatermark(
          {
            testMeta,
            questions,
            rawHtmlContent,
            answers: activeAns,
            stats: activeSt,
            studentName: studentName || 'NEET Aspirant',
            studentBatch: studentBatch || 'NEET UG Target Batch',
            includeSolutions: true,
            onProgress: (step, pct) => {
              setPdfProgressStep(step);
              setPdfProgressPercent(pct);
            },
          },
          true
        );
        setShareStatusMsg('📄 Complete Question Paper PDF (with VS Watermark) downloaded!');
      } catch (err) {
        console.error('Error generating Question Paper PDF:', err);
        setShareStatusMsg('⚠️ Could not generate PDF. Please try again.');
      } finally {
        window.setTimeout(() => {
          setIsGeneratingQuestionPdf(false);
          setPdfProgressStep('');
          setPdfProgressPercent(0);
        }, 600);
      }
    },
    [
      isGeneratingQuestionPdf,
      activeShareStats,
      answers,
      testMeta,
      questions,
      rawHtmlContent,
      studentName,
      studentBatch,
    ]
  );

  const renderPdfGeneratingOverlay = () => {
    if (!isGeneratingQuestionPdf) return null;
    return (
      <div className="fixed inset-0 z-[135] bg-slate-950/75 backdrop-blur-sm flex items-center justify-center p-4 no-print">
        <div className="w-full max-w-md rounded-3xl bg-slate-900 border border-sky-400/50 text-white p-6 shadow-2xl text-center space-y-4">
          <div className="w-14 h-14 rounded-2xl bg-sky-500/20 border border-sky-400/40 flex items-center justify-center mx-auto text-sky-400 font-black text-xl">
            VS
          </div>
          <div>
            <h3 className="text-base sm:text-lg font-extrabold text-white">
              Generating Complete Question Paper PDF
            </h3>
            <p className="text-xs text-sky-300 font-semibold mt-1">
              {pdfProgressStep || 'Adding VS Watermark, Diagrams & Solutions...'}
            </p>
          </div>
          <div className="w-full h-3 rounded-full bg-slate-800 overflow-hidden border border-slate-700">
            <div
              className="h-full bg-gradient-to-r from-sky-500 via-cyan-400 to-emerald-400 transition-all duration-200"
              style={{ width: `${Math.max(8, Math.min(100, pdfProgressPercent))}%` }}
            />
          </div>
          <div className="text-xs font-mono font-bold text-slate-300">
            {pdfProgressPercent}% Complete • Official VS Tests Watermark
          </div>
        </div>
      </div>
    );
  };

  // Extra-large readable font size class for questions and options
  const fontSizeClass = 'text-2xl sm:text-3xl md:text-4xl font-extrabold leading-relaxed tracking-tight';

  const currentQ = questions[currentIdx] || questions[0];
  const currentQTime = questionTimes[currentIdx] || 0;
  const isSlowQuestion = currentQTime >= 120;

  // Render table if question has match-the-column tableData (supports headers/rows AND headersHi/rowsHi/headersEn/rowsEn)
  const renderTable = (q: CbtQuestion) => {
    if (!q.tableData) return null;
    const { headers, rows, headersHi, headersEn, rowsHi, rowsEn } = q.tableData;
    const resolvedHeadersHi =
      Array.isArray(headersHi) && headersHi.length > 0
        ? headersHi
        : Array.isArray(headers) && headers.length > 0
          ? headers
          : ['सूची - I (List - I)', 'सूची - II (List - II)'];
    const resolvedHeadersEn =
      Array.isArray(headersEn) && headersEn.length > 0
        ? headersEn
        : Array.isArray(headers) && headers.length > 0
          ? headers
          : ['List - I', 'List - II'];

    const resolvedRowsHi =
      Array.isArray(rowsHi) && rowsHi.length > 0
        ? rowsHi
        : Array.isArray(rows) && rows.length > 0
          ? rows
          : [];
    const resolvedRowsEn =
      Array.isArray(rowsEn) && rowsEn.length > 0
        ? rowsEn
        : Array.isArray(rows) && rows.length > 0
          ? rows
          : [];

    const rowCount = Math.max(resolvedRowsHi.length, resolvedRowsEn.length);
    if (rowCount === 0) return null;

    const headerColCount = Math.max(resolvedHeadersHi.length, resolvedHeadersEn.length, 2);

    return (
      <div className="my-4 overflow-x-auto rounded-2xl border-2 border-sky-300/90 dark:border-slate-700 bg-white/95 dark:bg-slate-900/95 shadow-sm">
        <table className="w-full text-left border-collapse text-lg sm:text-xl">
          <thead>
            <tr className="bg-sky-100/95 dark:bg-slate-800 text-black dark:text-white border-b-2 border-sky-200 dark:border-slate-700">
              {Array.from({ length: headerColCount }).map((_, colIdx) => {
                const hHi = String(resolvedHeadersHi[colIdx] || '');
                const hEn = String(resolvedHeadersEn[colIdx] || '');
                const sameH = hHi.trim() === hEn.trim();
                return (
                  <th
                    key={colIdx}
                    className="py-3 px-3.5 font-extrabold border-r last:border-r-0 border-sky-200/80 dark:border-slate-700"
                  >
                    {(langMode !== 'en' || !hEn) && hHi && (
                      <div className="text-black dark:text-white">{hHi}</div>
                    )}
                    {langMode !== 'hi' && hEn && (!sameH || langMode === 'en') && (
                      <div className="text-sky-800 dark:text-sky-300 text-base sm:text-lg font-bold">
                        {hEn}
                      </div>
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-sky-200/80 dark:divide-slate-700">
            {Array.from({ length: rowCount }).map((_, rIdx) => {
              const rHi = Array.isArray(resolvedRowsHi[rIdx]) ? resolvedRowsHi[rIdx] : [];
              const rEn = Array.isArray(resolvedRowsEn[rIdx]) ? resolvedRowsEn[rIdx] : [];
              const colLen = Math.max(rHi.length, rEn.length, headerColCount);
              return (
                <tr key={rIdx} className="hover:bg-sky-50/70 dark:hover:bg-slate-800/60">
                  {Array.from({ length: colLen }).map((__, cIdx) => {
                    const cellHi = String(rHi[cIdx] || '');
                    const cellEn = String(rEn[cIdx] || '');
                    const sameCell = cellHi.trim() === cellEn.trim();
                    return (
                      <td
                        key={cIdx}
                        className="py-2.5 px-3.5 align-top border-r last:border-r-0 border-sky-100 dark:border-slate-800"
                      >
                        {(langMode !== 'en' || !cellEn) && cellHi && (
                          <div className="text-black dark:text-white font-semibold">{cellHi}</div>
                        )}
                        {langMode !== 'hi' && cellEn && (!sameCell || langMode === 'en') && (
                          <div className="text-black/85 dark:text-white/90 text-base sm:text-lg font-medium mt-0.5">
                            {cellEn}
                          </div>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  };

  // Render NCERT diagrams or full question image stems with language filtering & zoom capability
  const renderImages = (q: CbtQuestion) => {
    const isImageOnlyStem = !q.questionHi?.trim() && !q.questionEn?.trim();
    const rawUrls: string[] = [];
    if (q.imageUrls && q.imageUrls.length > 0) {
      rawUrls.push(...q.imageUrls);
    } else if (q.imageUrl) {
      rawUrls.push(q.imageUrl);
    }

    // Separate Hindi vs English images when question has bilingual image stems
    const hiImg = q.imageHi || (isImageOnlyStem && rawUrls.length >= 1 ? rawUrls[0] : undefined);
    const enImg =
      q.imageEn ||
      (isImageOnlyStem && rawUrls.length >= 2
        ? rawUrls[1]
        : isImageOnlyStem && rawUrls.length === 1
          ? rawUrls[0]
          : undefined);

    let urlsToRender: string[] = [];
    if (hiImg || enImg) {
      if (langMode === 'hi') {
        urlsToRender = [hiImg || enImg!];
      } else if (langMode === 'en') {
        urlsToRender = [enImg || hiImg!];
      } else {
        if (hiImg && enImg && hiImg !== enImg) {
          urlsToRender = [hiImg, enImg];
        } else {
          urlsToRender = [hiImg || enImg!];
        }
      }
    } else {
      urlsToRender = rawUrls;
    }

    if (urlsToRender.length === 0) return null;

    return (
      <div className="my-2.5 w-full min-w-0 flex flex-col gap-3">
        {urlsToRender.map((src, i) => (
          <div
            key={i}
            onClick={() => {
              setZoomScale(1.5);
              setZoomedImage(src);
            }}
            className="group relative w-full min-w-0 rounded-2xl overflow-hidden border border-slate-300 dark:border-slate-600 bg-white p-1 sm:p-3 shadow-xs cursor-zoom-in"
          >
            <img
              src={src}
              alt={`Question ${q.id} diagram ${i + 1}`}
              className="ultra-hd-img block w-full max-w-full h-auto mx-auto object-contain rounded-lg"
              loading="eager"
              decoding="sync"
              fetchPriority="high"
            />
          </div>
        ))}
      </div>
    );
  };

  // Build full-screen native HTML test document:
  // ALWAYS render the exact uploaded HTML file (`rawHtmlContent`) whenever present so 100% of HTML tests open with their exact original UI & questions.
  // Memoized strictly on `[exactHtmlMode, isSubmitted, rawHtmlContent, testMeta.id]` so `setAnswers()` on submit or SSE updates NEVER reload the iframe!
  const effectiveHtmlDoc = useMemo(() => {
    if (!exactHtmlMode || isSubmitted) return '';
    const trimmedRaw = (rawHtmlContent || '').trim();

    const sourceHtml =
      trimmedRaw.length > 20
        ? trimmedRaw
        : buildStandaloneCbtHtmlFromQuestions(testMeta, questions);

    // Strip trailing Cloudflare challenge script only in the tail slice so 12.6MB HTML strings aren't full-scanned
    const tailOffset = Math.max(0, sourceHtml.length - 4096);
    const rawBaseHtml =
      sourceHtml.slice(0, tailOffset) +
      sourceHtml
        .slice(tailOffset)
        .replace(
          /<script>\(function\(\)\{function c\(\)\{var b=a\.contentDocument[\s\S]*?<\/script>/gi,
          ''
        );

    // Pre-execution head script: isolates generic localStorage keys per testId AND clears any stale
    // `submitted: true` / `remainingSec <= 60` / expired `cbt_start` so uploaded HTML tests NEVER get stuck or refuse to run!
    const preBootSanitizerScript = `<script>
(function(){
  try {
    var TEST_ISO_ID = ${JSON.stringify(testMeta.id || 'default_test')};
    var GENERIC_CBT_KEYS = {
      cbt_answers: 1,
      cbt_marked: 1,
      cbt_visited: 1,
      cbt_start: 1,
      cbt_submitted: 1,
      cbt_timePerQ: 1,
      cbt_theme: 1
    };
    var origGetItem = Storage.prototype.getItem;
    var origSetItem = Storage.prototype.setItem;
    var origRemoveItem = Storage.prototype.removeItem;

    // Namespace generic keys like cbt_start / cbt_submitted per testId so different tests never collide
    Storage.prototype.getItem = function(k) {
      var mapped = (this === window.localStorage && GENERIC_CBT_KEYS[k]) ? ('vs_iso_' + TEST_ISO_ID + '_' + k) : k;
      return origGetItem.call(this, mapped);
    };
    Storage.prototype.setItem = function(k, v) {
      var mapped = (this === window.localStorage && GENERIC_CBT_KEYS[k]) ? ('vs_iso_' + TEST_ISO_ID + '_' + k) : k;
      return origSetItem.call(this, mapped, v);
    };
    Storage.prototype.removeItem = function(k) {
      var mapped = (this === window.localStorage && GENERIC_CBT_KEYS[k]) ? ('vs_iso_' + TEST_ISO_ID + '_' + k) : k;
      return origRemoveItem.call(this, mapped);
    };

    // Reset any previously submitted or expired timer state in localStorage so opening a test ALWAYS starts runnable
    var isoPrefix = 'vs_iso_' + TEST_ISO_ID + '_';
    var prevSubmitted = origGetItem.call(window.localStorage, isoPrefix + 'cbt_submitted');
    var prevStart = parseInt(origGetItem.call(window.localStorage, isoPrefix + 'cbt_start') || '0', 10);
    if (prevSubmitted === 'true' || (prevStart > 0 && (Date.now() - prevStart) > 9000 * 1000)) {
      origRemoveItem.call(window.localStorage, isoPrefix + 'cbt_submitted');
      origRemoveItem.call(window.localStorage, isoPrefix + 'cbt_start');
      origRemoveItem.call(window.localStorage, isoPrefix + 'cbt_answers');
      origRemoveItem.call(window.localStorage, isoPrefix + 'cbt_marked');
      origRemoveItem.call(window.localStorage, isoPrefix + 'cbt_visited');
      origRemoveItem.call(window.localStorage, isoPrefix + 'cbt_timePerQ');
    }

    for (var i = window.localStorage.length - 1; i >= 0; i--) {
      var key = window.localStorage.key(i);
      if (!key) continue;
      if (key.indexOf('neet_cbt_') === 0 || key.indexOf('_v4_state') !== -1 || key.indexOf('cbt_state') !== -1) {
        try {
          var rawVal = origGetItem.call(window.localStorage, key);
          if (rawVal && rawVal.charAt(0) === '{') {
            var parsed = JSON.parse(rawVal);
            if (parsed && (parsed.submitted === true || (typeof parsed.remainingSec === 'number' && parsed.remainingSec <= 60))) {
              origRemoveItem.call(window.localStorage, key);
            }
          }
        } catch (err) {}
      }
    }
  } catch (e) {}
})();
</script>`;

    // Hook into modern uploaded HTML tests (`computeResults(...)` inside `renderAnalysisDashboard` AND `buildAnalysis()` in AIATS)
    // so wrong answers, bookmarked questions, and final scores are 100% captured even inside IIFE closures!
    let baseHtml = rawBaseHtml
      .replace(
        /const\s+res\s*=\s*computeResults\s*\(([^)]*)\)\s*;/g,
        'const res = computeResults($1); try { if (typeof window.__vsOnHtmlAnalysisResult === "function") window.__vsOnHtmlAnalysisResult(res); } catch(e) {}'
      )
      .replace(
        /buildAnalysis\s*\(\s*\)\s*;\s*showAnalysis\s*\(\s*\)\s*;/g,
        'buildAnalysis(); showAnalysis(); try { if (typeof window.__vsNotifySubmitted === "function") window.__vsNotifySubmitted(); } catch(e) {}'
      );

    const headMatch = /<head[^>]*>/i.exec(baseHtml);
    if (headMatch && typeof headMatch.index === 'number') {
      const insertPos = headMatch.index + headMatch[0].length;
      baseHtml =
        baseHtml.slice(0, insertPos) + preBootSanitizerScript + baseHtml.slice(insertPos);
    } else {
      baseHtml = `${preBootSanitizerScript}${baseHtml}`;
    }

    const bridgeScript = `<script>
(function(){
  try {
    function fixBase64Img(val) {
      if (!val || typeof val !== 'string') return val;
      var s = val.trim();
      if (s.indexOf('data:image/') === 0 || s.indexOf('http') === 0 || (s.indexOf('/') === 0 && s.indexOf('/9j/') !== 0)) return s;
      var c = s.replace(/\\s+/g, '');
      if (c.indexOf('iVBORw0KGgo') === 0) return 'data:image/png;base64,' + c;
      if (c.indexOf('/9j/') === 0) return 'data:image/jpeg;base64,' + c;
      if (c.indexOf('UklGR') === 0) return 'data:image/webp;base64,' + c;
      if (c.indexOf('R0lGOD') === 0) return 'data:image/gif;base64,' + c;
      return val;
    }
    if (typeof DATA !== 'undefined' && Array.isArray(DATA)) {
      DATA.forEach(function(it){
        if (it && it.hi) it.hi = fixBase64Img(it.hi);
        if (it && it.en) it.en = fixBase64Img(it.en);
        if (it && it.hiImg) it.hiImg = fixBase64Img(it.hiImg);
        if (it && it.enImg) it.enImg = fixBase64Img(it.enImg);
      });
    }
    if (typeof PAGES !== 'undefined' && Array.isArray(PAGES)) {
      for (var p = 0; p < PAGES.length; p++) {
        PAGES[p] = fixBase64Img(PAGES[p]);
      }
    }
    if (typeof render === 'function') {
      try { render(); } catch(e) {}
    }

    // Add a clean Back to Portal button inside the HTML header without altering any test buttons
    var brand = document.querySelector('.brand, .exam-header, .hdr, .header, .topbar, header') || document.body;
    if (brand && !document.getElementById('vsPortalBackBtn')) {
      var backBtn = document.createElement('button');
      backBtn.id = 'vsPortalBackBtn';
      backBtn.type = 'button';
      backBtn.textContent = '← Home';
      backBtn.style.cssText = 'border:1px solid #b9dced;background:#ffffff;color:#145d88;border-radius:10px;padding:7px 11px;font-weight:800;font-size:12px;cursor:pointer;flex-shrink:0;margin-right:6px;z-index:2147483647;position:relative;';
      backBtn.onclick = function(e) {
        if (e && e.stopPropagation) e.stopPropagation();
        window.parent.postMessage({ type: 'VS_CBT_HTML_EXIT' }, '*');
      };
      if (brand === document.body) {
        backBtn.style.position = 'fixed';
        backBtn.style.top = '10px';
        backBtn.style.left = '10px';
        document.body.appendChild(backBtn);
      } else {
        brand.insertBefore(backBtn, brand.firstChild);
      }
    }
    window.parent.postMessage({ type: 'VS_CBT_HTML_BRIDGE_READY' }, '*');

    var lastShareStats = null;
    function injectHtmlShareButton(stats) {
      if (stats) lastShareStats = stats;
      setTimeout(function() {
        var topBtns = document.querySelector('.analysis-top-btns, .analysis-header, .analysis-head');
        if (topBtns) {
          if (!document.getElementById('vsShareResultBtn')) {
            var shareBtn = document.createElement('button');
            shareBtn.id = 'vsShareResultBtn';
            shareBtn.type = 'button';
            shareBtn.className = 'btn';
            shareBtn.innerHTML = '📤 Share Scorecard';
            shareBtn.style.cssText = 'background:linear-gradient(135deg,#059669,#0284c7);color:#ffffff;border:none;font-weight:900;padding:8px 14px;border-radius:10px;cursor:pointer;box-shadow:0 4px 12px rgba(2,132,199,0.28);margin-right:6px;';
            shareBtn.onclick = function(e) {
              if (e && e.stopPropagation) e.stopPropagation();
              window.parent.postMessage({
                type: 'VS_CBT_HTML_SHARE',
                stats: lastShareStats
              }, '*');
            };
            topBtns.insertBefore(shareBtn, topBtns.firstChild);
          }
          if (!document.getElementById('vsDownloadPdfBtn')) {
            var pdfBtn = document.createElement('button');
            pdfBtn.id = 'vsDownloadPdfBtn';
            pdfBtn.type = 'button';
            pdfBtn.className = 'btn';
            pdfBtn.innerHTML = '📥 Download Question PDF (VS)';
            pdfBtn.style.cssText = 'background:linear-gradient(135deg,#4f46e5,#0284c7);color:#ffffff;border:none;font-weight:900;padding:8px 14px;border-radius:10px;cursor:pointer;box-shadow:0 4px 12px rgba(79,70,229,0.32);margin-right:6px;';
            pdfBtn.onclick = function(e) {
              if (e && e.stopPropagation) e.stopPropagation();
              window.parent.postMessage({
                type: 'VS_CBT_HTML_DOWNLOAD_PDF',
                stats: lastShareStats
              }, '*');
            };
            topBtns.insertBefore(pdfBtn, topBtns.firstChild);
          }
        }
      }, 60);
    }

    var posted = false;

    // Handler for modern uploaded HTML tests (triggered when renderAnalysisDashboard computes res)
    window.__vsOnHtmlAnalysisResult = function(res) {
      try {
        if (!res || typeof res !== 'object') return;
        var items = Array.isArray(res.items) ? res.items : [];
        var zeroIndexedAnswers = {};
        var extractedMistakes = [];
        for (var i = 0; i < items.length; i++) {
          var it = items[i];
          if (!it) continue;
          var qIdx = (typeof it.qNum === 'number' && it.qNum >= 1) ? it.qNum - 1 : i;
          if (it.userAns !== undefined && it.userAns !== null && String(it.userAns) !== '') {
            zeroIndexedAnswers[qIdx] = String(it.userAns);
          }
          var isWrong = it.status === 'incorrect';
          var isMarked = Boolean(it.marked);
          if (isWrong || isMarked) {
            extractedMistakes.push({
              qNum: it.qNum || (i + 1),
              subject: it.subject || '',
              userAns: it.userAns ? String(it.userAns) : '',
              corrAns: it.corrAns ? String(it.corrAns) : '1',
              reason: (isWrong && isMarked) ? 'both' : (isWrong ? 'wrong' : 'bookmarked'),
              enImg: fixBase64Img(it.enImg || ''),
              hiImg: fixBase64Img(it.hiImg || ''),
              seImg: fixBase64Img(it.seImg || ''),
              shImg: fixBase64Img(it.shImg || ''),
              expEn: it.expEn || '',
              ref: it.ref || ''
            });
          }
        }
        var summaryStats = {
          score: Number(res.obtained || 0),
          maxMarks: Number(res.maxMarks || (items.length * 4) || 360),
          correctCount: Number(res.correct || 0),
          wrongCount: Number(res.incorrect || 0),
          unattemptedCount: Number(res.unattempted || 0),
          accuracy: Math.round(Number(res.accuracy || 0)),
          totalTimeSpent: Math.max(1, Math.round(Number(res.timeTaken || 60)))
        };
        injectHtmlShareButton(summaryStats);

        // Always sync mistakes immediately (works in both Test Analysis & Practice Analysis)
        if (extractedMistakes.length > 0) {
          window.parent.postMessage({
            type: 'VS_CBT_HTML_MISTAKES',
            extractedMistakes: extractedMistakes
          }, '*');
        }

        if (!posted) {
          posted = true;
          window.parent.postMessage({
            type: 'VS_CBT_HTML_SUBMIT',
            score: summaryStats.score,
            maxMarks: summaryStats.maxMarks,
            correctCount: summaryStats.correctCount,
            wrongCount: summaryStats.wrongCount,
            unattemptedCount: summaryStats.unattemptedCount,
            accuracy: summaryStats.accuracy,
            timeTakenSeconds: summaryStats.totalTimeSpent,
            answers: zeroIndexedAnswers,
            extractedMistakes: extractedMistakes
          }, '*');
        }
      } catch (err) {}
    };

    function notifyParentSubmitted() {
      if (posted) return;
      posted = true;
      try {
        var isAiatsTemplate = (typeof state !== 'undefined' && state && state.answers && typeof questions !== 'undefined' && Array.isArray(questions));
        var ansMap = isAiatsTemplate
          ? state.answers
          : (typeof A !== 'undefined' && A)
            ? A
            : (typeof userAnswers !== 'undefined' && userAnswers)
              ? userAnswers
              : (typeof answers !== 'undefined' && answers ? answers : {});
        var qArr = isAiatsTemplate
          ? questions
          : (typeof DATA !== 'undefined' && Array.isArray(DATA))
            ? DATA
            : (typeof QUESTIONS !== 'undefined' && Array.isArray(QUESTIONS) ? QUESTIONS : null);
        var totalQ = (typeof N !== 'undefined' && N) ? N : (qArr ? qArr.length : ${questions.length || 90});
        var maxM = (typeof MAX !== 'undefined' && MAX) ? MAX : totalQ * 4;
        var dur = (typeof DURATION !== 'undefined' && DURATION) ? DURATION : ${safeInitialSeconds};
        var rem = (typeof sec !== 'undefined' && typeof sec === 'number')
          ? sec
          : (typeof remaining !== 'undefined' && typeof remaining === 'number' ? remaining : 0);
        var spent = Math.max(1, dur - rem);
        var correct = 0, wrong = 0, blank = 0;
        var zeroIndexedAnswers = {};
        var extractedMistakes = [];
        for (var i = 0; i < totalQ; i++) {
          var qObj = qArr && qArr[i] ? qArr[i] : null;
          var picked = isAiatsTemplate
            ? (ansMap[i] !== undefined ? Number(ansMap[i]) + 1 : undefined)
            : (ansMap[i + 1] !== undefined ? ansMap[i + 1] : ansMap[i]);
          var rightAns = null;
          if (isAiatsTemplate && qObj && qObj.correct !== undefined) {
            rightAns = Number(qObj.correct) + 1;
          } else if (qObj && qObj.ans !== undefined) {
            rightAns = qObj.ans;
          } else if (typeof ANS !== 'undefined' && Array.isArray(ANS) && ANS[i] !== undefined) {
            rightAns = ANS[i];
          } else if (qObj) {
            rightAns = qObj.correctAnswer || qObj.correctOption || qObj.answer;
          }
          if (picked !== undefined && picked !== null && String(picked) !== '') {
            zeroIndexedAnswers[i] = String(picked);
            if (rightAns !== null && rightAns !== undefined) {
              if (String(picked) === String(rightAns)) {
                correct++;
              } else {
                wrong++;
                extractedMistakes.push({
                  qNum: i + 1,
                  subject: (qObj && (qObj.subject || qObj.sub || qObj.sec)) || '',
                  userAns: String(picked),
                  corrAns: String(rightAns),
                  reason: 'wrong',
                  enImg: fixBase64Img((qObj && (qObj.enImg || qObj.en || qObj.img)) || ''),
                  hiImg: fixBase64Img((qObj && (qObj.hiImg || qObj.hi)) || ''),
                  seImg: fixBase64Img((qObj && (qObj.seImg || qObj.solEn)) || ''),
                  shImg: fixBase64Img((qObj && (qObj.shImg || qObj.solHi)) || ''),
                  expEn: (qObj && (qObj.expEn || qObj.explanation || qObj.sol || '')) || ''
                });
              }
            } else {
              correct++;
            }
          } else {
            blank++;
          }
        }
        var score = correct * 4 - wrong;
        var attempted = correct + wrong;
        var acc = attempted > 0 ? Math.round((correct / attempted) * 100) : 0;
        var summaryStats = {
          score: score,
          maxMarks: maxM,
          correctCount: correct,
          wrongCount: wrong,
          unattemptedCount: blank,
          accuracy: acc,
          totalTimeSpent: spent
        };
        injectHtmlShareButton(summaryStats);

        window.parent.postMessage({
          type: 'VS_CBT_HTML_SUBMIT',
          score: score,
          maxMarks: maxM,
          correctCount: correct,
          wrongCount: wrong,
          unattemptedCount: blank,
          accuracy: acc,
          timeTakenSeconds: spent,
          answers: zeroIndexedAnswers,
          extractedMistakes: extractedMistakes
        }, '*');
      } catch (err) {}
    }
    window.__vsNotifySubmitted = notifyParentSubmitted;

    // Auto-Restore & Auto-Save progress inside HTML Test so power-cut or phone reload resumes where student left off
    var savedInitAnswers = ${JSON.stringify(answersRef.current || {})};
    var savedInitSecs = ${Number(remainingSecondsRef.current || safeInitialSeconds)};
    var savedInitIdx = ${Number(currentIdx || 0)};
    try {
      var ansTarget = (typeof A !== 'undefined' && A) ? A : (typeof userAnswers !== 'undefined' && userAnswers ? userAnswers : null);
      if (ansTarget && savedInitAnswers && typeof savedInitAnswers === 'object') {
        Object.keys(savedInitAnswers).forEach(function(k) {
          var numK = Number(k);
          if (!isNaN(numK) && savedInitAnswers[k]) {
            ansTarget[numK + 1] = isNaN(Number(savedInitAnswers[k])) ? savedInitAnswers[k] : Number(savedInitAnswers[k]);
          }
        });
      }
      if (typeof sec === 'number' && savedInitSecs > 60) {
        sec = savedInitSecs;
      }
      if (typeof cur === 'number' && savedInitIdx >= 0) {
        cur = savedInitIdx;
      }
      if (typeof render === 'function') {
        try { render(); } catch(e) {}
      }
    } catch (restoreErr) {}

    function postHtmlProgressSnapshot() {
      if (posted) return;
      try {
        var isAiats = (typeof state !== 'undefined' && state && state.answers);
        var ansMap = isAiats ? state.answers : ((typeof A !== 'undefined' && A) ? A : (typeof userAnswers !== 'undefined' && userAnswers ? userAnswers : {}));
        var totalQ = (typeof N !== 'undefined' && N) ? N : ${questions.length || 90};
        var rem = (typeof sec !== 'undefined' && typeof sec === 'number') ? sec : (typeof remaining === 'number' ? remaining : ${safeInitialSeconds});
        var activeCur = (typeof cur === 'number') ? cur : 0;
        var zeroIndexed = {};
        for (var i = 0; i < totalQ; i++) {
          var picked = isAiats ? (ansMap[i] !== undefined ? Number(ansMap[i]) + 1 : undefined) : (ansMap[i + 1] !== undefined ? ansMap[i + 1] : ansMap[i]);
          if (picked !== undefined && picked !== null && String(picked) !== '') {
            zeroIndexed[i] = String(picked);
          }
        }
        window.parent.postMessage({
          type: 'VS_CBT_HTML_PROGRESS',
          answers: zeroIndexed,
          remainingSeconds: rem,
          currentIdx: activeCur
        }, '*');
      } catch (e) {}
    }

    setInterval(postHtmlProgressSnapshot, 4000);
    document.addEventListener('click', function() {
      setTimeout(postHtmlProgressSnapshot, 120);
    });

    ['result', 'submit', 'doSubmit', 'buildAnalysis', 'showAnalysis', 'submitExam', 'finishExam', 'showResult', 'calculateScore', 'submitTest'].forEach(function(fnName) {
      if (typeof window[fnName] === 'function') {
        var origFn = window[fnName];
        window[fnName] = function() {
          var r = origFn.apply(this, arguments);
          if (fnName !== 'submit') {
            notifyParentSubmitted();
          }
          return r;
        };
      }
    });
  } catch (e) {}
})();
</script>`;

    const lastBodyCloseIdx = baseHtml.toLowerCase().lastIndexOf('</body>');
    if (lastBodyCloseIdx !== -1) {
      return (
        baseHtml.slice(0, lastBodyCloseIdx) +
        bridgeScript +
        baseHtml.slice(lastBodyCloseIdx)
      );
    }
    return `${baseHtml}${bridgeScript}`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exactHtmlMode, isSubmitted, rawHtmlContent, testMeta.id]);

  // Create a fast same-origin Blob URL for large HTML papers so 12.6MB strings never choke iframe srcDoc
  const htmlBlobUrl = useMemo(() => {
    if (!effectiveHtmlDoc || typeof URL === 'undefined' || typeof Blob === 'undefined') {
      return '';
    }
    try {
      const blob = new Blob([effectiveHtmlDoc], { type: 'text/html;charset=utf-8' });
      return URL.createObjectURL(blob);
    } catch {
      return '';
    }
  }, [effectiveHtmlDoc]);

  useEffect(() => {
    return () => {
      if (htmlBlobUrl) {
        try {
          URL.revokeObjectURL(htmlBlobUrl);
        } catch {
          // ignore
        }
      }
    };
  }, [htmlBlobUrl]);

  const hasRecordedHtmlSubmitRef = useRef(false);

  // Convert extracted HTML mistake items into MistakeNotebookItem[] and sync to App.tsx
  const syncExtractedHtmlMistakes = useCallback(
    (rawExtracted: unknown, cleanedAns: Record<number, string>) => {
      if (!onSyncMistakesAndBookmarks) return;
      const htmlMistakes: MistakeNotebookItem[] = [];

      if (Array.isArray(rawExtracted) && rawExtracted.length > 0) {
        rawExtracted.forEach((rawIt: Record<string, any>, mIdx: number) => {
          if (!rawIt) return;
          const qNum = Number(rawIt.qNum) || mIdx + 1;
          const qIdx = Math.max(0, qNum - 1);
          const fallbackQ = questions[qIdx];
          const corrAns = normalizeOptCode(
            rawIt.corrAns || fallbackQ?.correctAnswer || '1',
            '1'
          );
          const userAns = rawIt.userAns
            ? normalizeOptCode(rawIt.userAns, String(rawIt.userAns))
            : cleanedAns[qIdx] || '';
          const enImg =
            typeof rawIt.enImg === 'string' && rawIt.enImg.startsWith('data:image/')
              ? rawIt.enImg
              : fallbackQ?.imageEn;
          const hiImg =
            typeof rawIt.hiImg === 'string' && rawIt.hiImg.startsWith('data:image/')
              ? rawIt.hiImg
              : fallbackQ?.imageHi;
          const seImg =
            typeof rawIt.seImg === 'string' && rawIt.seImg.startsWith('data:image/')
              ? rawIt.seImg
              : '';
          const shImg =
            typeof rawIt.shImg === 'string' && rawIt.shImg.startsWith('data:image/')
              ? rawIt.shImg
              : '';
          const expText = String(rawIt.expEn || rawIt.ref || '').trim();
          const hasDiagram = Boolean(enImg || hiImg);

          const questionForNotebook: CbtQuestion = {
            ...(fallbackQ || {
              id: qNum,
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
            }),
            id: qNum,
            chapter: String(rawIt.subject || fallbackQ?.chapter || testMeta.subject || 'NEET Question'),
            questionHi: hasDiagram
              ? `प्रश्न संख्या ${qNum} (${rawIt.subject || testMeta.subject || 'NEET'})`
              : fallbackQ?.questionHi || `प्रश्न संख्या ${qNum}`,
            questionEn: hasDiagram
              ? `Question #${qNum} (${rawIt.subject || testMeta.subject || 'NEET'})`
              : fallbackQ?.questionEn || `Question #${qNum}`,
            imageHi: hiImg || enImg || fallbackQ?.imageHi,
            imageEn: enImg || hiImg || fallbackQ?.imageEn,
            imageUrl: hiImg || enImg || fallbackQ?.imageUrl,
            correctAnswer: corrAns,
            explanation: {
              hi: shImg || expText || fallbackQ?.explanation?.hi || '',
              en: seImg || expText || fallbackQ?.explanation?.en || '',
            },
          };

          htmlMistakes.push({
            uid: `${testMeta.id}_q_${qNum}`,
            testId: testMeta.id,
            testTitle: testMeta.title,
            subject: String(rawIt.subject || testMeta.subject || 'Biology'),
            question: questionForNotebook,
            chosenAnswer: userAns,
            reason:
              rawIt.reason === 'both' || rawIt.reason === 'bookmarked' ? rawIt.reason : 'wrong',
            savedAt: Date.now(),
          });
        });
      } else if (questions.length > 0) {
        questions.forEach((q, idx) => {
          const picked = cleanedAns[idx];
          if (picked) {
            const normCorrect = normalizeOptCode(q.correctAnswer, String(q.correctAnswer));
            const normAlso = q.alsoCorrect ? normalizeOptCode(q.alsoCorrect, String(q.alsoCorrect)) : '';
            if (picked !== normCorrect && (!normAlso || picked !== normAlso)) {
              htmlMistakes.push({
                uid: `${testMeta.id}_q_${q.id}`,
                testId: testMeta.id,
                testTitle: testMeta.title,
                subject: testMeta.subject,
                question: q,
                chosenAnswer: picked,
                reason: 'wrong',
                savedAt: Date.now(),
              });
            }
          }
        });
      }

      if (htmlMistakes.length > 0) {
        onSyncMistakesAndBookmarks(htmlMistakes);
      }
    },
    [onSyncMistakesAndBookmarks, questions, normalizeOptCode, testMeta.id, testMeta.title, testMeta.subject]
  );

  useEffect(() => {
    if (!exactHtmlMode || isSubmitted) {
      setHtmlBridgeReady(false);
      setShowHtmlFallbackExit(false);
      return;
    }
    setHtmlBridgeReady(false);
    setShowHtmlFallbackExit(false);
    const timer = window.setTimeout(() => {
      setShowHtmlFallbackExit(true);
    }, 700);
    return () => window.clearTimeout(timer);
  }, [exactHtmlMode, isSubmitted, rawHtmlContent]);

  useEffect(() => {
    if (!exactHtmlMode) return;
    const handleHtmlMessage = (event: MessageEvent) => {
      const data = event.data;
      if (!data || typeof data !== 'object') return;
      if (data.type === 'VS_CBT_HTML_BRIDGE_READY') {
        setHtmlBridgeReady(true);
        setShowHtmlFallbackExit(false);
      } else if (data.type === 'VS_CBT_HTML_EXIT') {
        persistInProgressSnapshot();
        onExit();
      } else if (data.type === 'VS_CBT_HTML_MISTAKES') {
        syncExtractedHtmlMistakes(data.extractedMistakes, answersRef.current);
      } else if (data.type === 'VS_CBT_HTML_SHARE') {
        const st = data.stats && typeof data.stats === 'object' ? data.stats : null;
        handleShareResult(
          'open_modal',
          st
            ? {
                score: Number(st.score ?? 0),
                maxMarks: Number(st.maxMarks ?? testMeta.maxMarks ?? 360),
                correctCount: Number(st.correctCount ?? 0),
                wrongCount: Number(st.wrongCount ?? 0),
                unattemptedCount: Number(st.unattemptedCount ?? 0),
                accuracy: Number(st.accuracy ?? 0),
                totalTimeSpent: Math.max(1, Number(st.totalTimeSpent ?? 60)),
              }
            : undefined
        );
      } else if (data.type === 'VS_CBT_HTML_DOWNLOAD_PDF') {
        const st = data.stats && typeof data.stats === 'object' ? data.stats : null;
        handleDownloadQuestionPaperPdf(
          st
            ? {
                score: Number(st.score ?? 0),
                maxMarks: Number(st.maxMarks ?? testMeta.maxMarks ?? 360),
                correctCount: Number(st.correctCount ?? 0),
                wrongCount: Number(st.wrongCount ?? 0),
                unattemptedCount: Number(st.unattemptedCount ?? 0),
                accuracy: Number(st.accuracy ?? 0),
                totalTimeSpent: Math.max(1, Number(st.totalTimeSpent ?? 60)),
              }
            : htmlResultOverride || undefined
        );
      } else if (data.type === 'VS_CBT_HTML_PROGRESS') {
        const rawAnsObj =
          data.answers && typeof data.answers === 'object' ? data.answers : {};
        const cleanedAns: Record<number, string> = {};
        Object.entries(rawAnsObj).forEach(([k, v]) => {
          const idxNum = Number(k);
          if (Number.isFinite(idxNum) && v !== undefined && v !== null && String(v) !== '') {
            cleanedAns[idxNum] = normalizeOptCode(v, String(v));
          }
        });
        answersRef.current = cleanedAns;
        if (typeof data.remainingSeconds === 'number' && data.remainingSeconds > 0) {
          remainingSecondsRef.current = data.remainingSeconds;
        }
        persistInProgressSnapshot(
          cleanedAns,
          remainingSecondsRef.current,
          typeof data.currentIdx === 'number' ? data.currentIdx : currentIdx
        );
      } else if (data.type === 'VS_CBT_HTML_SUBMIT' && !hasRecordedHtmlSubmitRef.current) {
        hasRecordedHtmlSubmitRef.current = true;
        const payload =
          data.payload && typeof data.payload === 'object'
            ? (data.payload as Record<string, any>)
            : (data as Record<string, any>);
        try {
          localStorage.removeItem(inProgressStorageKey);
          const rawLast = localStorage.getItem('vs_neet_last_unfinished_test_v1');
          if (rawLast) {
            const parsedLast = JSON.parse(rawLast) as UnfinishedTestSummary;
            if (parsedLast.testId === testMeta.id) {
              localStorage.removeItem('vs_neet_last_unfinished_test_v1');
            }
          }
        } catch {
          // ignore
        }
        const rawAnsSrc = payload.answers ?? payload.responses ?? {};
        const rawAnsObj = rawAnsSrc && typeof rawAnsSrc === 'object' ? rawAnsSrc : {};
        const cleanedAns: Record<number, string> = {};
        Object.entries(rawAnsObj).forEach(([k, v]) => {
          const idxNum = Number(k);
          if (Number.isFinite(idxNum) && v !== undefined && v !== null && String(v) !== '') {
            cleanedAns[idxNum >= 1 && !('0' in rawAnsObj) ? idxNum - 1 : idxNum] = normalizeOptCode(
              v,
              String(v)
            );
          }
        });
        answersRef.current = cleanedAns;
        setAnswers(cleanedAns);

        // Automatically sync all wrong & bookmarked questions from HTML test into Mistake Notebook
        syncExtractedHtmlMistakes(payload.extractedMistakes, cleanedAns);

        const cCount = Number(payload.correctCount ?? 0);
        const wCount = Number(payload.wrongCount ?? payload.incorrectCount ?? 0);
        const blankCount = Number(
          payload.unattemptedCount ?? payload.unansweredCount ?? Math.max(0, questions.length - cCount - wCount)
        );
        const attempted = cCount + wCount;
        const computedAcc = attempted > 0 ? Math.round((cCount / attempted) * 100) : 0;
        const finalStats = {
          score: Number(payload.score ?? 0),
          maxMarks: Number(payload.maxMarks ?? testMeta.maxMarks ?? 360),
          correctCount: cCount,
          wrongCount: wCount,
          unattemptedCount: blankCount,
          accuracy: Number(payload.accuracy ?? computedAcc),
          totalTimeSpent: Math.max(1, Number(payload.timeTakenSeconds ?? 60)),
        };
        setHtmlResultOverride(finalStats);

        onSubmitAttempt({
          testId: testMeta.id,
          testTitle: testMeta.title,
          studentId,
          studentEmail,
          studentName: studentName || 'NEET Aspirant',
          studentBatch,
          score: finalStats.score,
          maxMarks: finalStats.maxMarks,
          correctCount: finalStats.correctCount,
          wrongCount: finalStats.wrongCount,
          unattemptedCount: finalStats.unattemptedCount,
          accuracy: finalStats.accuracy,
          timeTakenSeconds: finalStats.totalTimeSpent,
          completedAt: Date.now(),
          answers: cleanedAns,
          questionTimes:
            payload.questionTimes && typeof payload.questionTimes === 'object'
              ? payload.questionTimes
              : {},
          bookmarked: {},
        });
      }
    };
    window.addEventListener('message', handleHtmlMessage);
    return () => window.removeEventListener('message', handleHtmlMessage);
  }, [
    exactHtmlMode,
    inProgressStorageKey,
    onExit,
    onSubmitAttempt,
    syncExtractedHtmlMistakes,
    handleShareResult,
    handleDownloadQuestionPaperPdf,
    htmlResultOverride,
    persistInProgressSnapshot,
    normalizeOptCode,
    currentIdx,
    questions,
    studentBatch,
    studentEmail,
    studentId,
    studentName,
    testMeta.id,
    testMeta.maxMarks,
    testMeta.subject,
    testMeta.title,
  ]);

  if (exactHtmlMode && !isSubmitted && effectiveHtmlDoc) {
    return (
      <div className="fixed inset-0 z-50 w-full h-dvh flex flex-col bg-[#effaff] overflow-hidden">
        {renderShareScorecardModal()}
        {renderPdfGeneratingOverlay()}
        {!htmlBridgeReady && showHtmlFallbackExit && (
          <button
            type="button"
            onClick={() => {
              persistInProgressSnapshot();
              onExit();
            }}
            className="fixed top-2.5 left-2.5 z-[60] px-3 py-1.5 rounded-xl bg-white/95 hover:bg-white text-sky-900 border border-sky-300 shadow-lg text-xs font-extrabold cursor-pointer"
          >
            ← Back to Home
          </button>
        )}
        {htmlResultOverride && (
          <div className="fixed bottom-4 right-4 z-[65] flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={isGeneratingQuestionPdf}
              onClick={() => handleDownloadQuestionPaperPdf(htmlResultOverride)}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-gradient-to-r from-indigo-600 via-sky-600 to-cyan-600 hover:from-indigo-500 hover:to-cyan-500 disabled:opacity-60 text-white text-xs sm:text-sm font-extrabold shadow-xl border border-white/30 cursor-pointer transition"
            >
              {isGeneratingQuestionPdf ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <FileDown className="w-4 h-4" />
              )}
              <span>Download Question PDF (VS)</span>
            </button>

            <button
              type="button"
              onClick={() => handleShareResult('open_modal', htmlResultOverride)}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-gradient-to-r from-emerald-600 to-sky-600 hover:from-emerald-500 hover:to-sky-500 text-white text-xs sm:text-sm font-extrabold shadow-xl border border-white/30 cursor-pointer transition"
            >
              <Share2 className="w-4 h-4" />
              <span>Share Scorecard</span>
            </button>
          </div>
        )}
        <iframe
          src={htmlBlobUrl || undefined}
          srcDoc={htmlBlobUrl ? undefined : effectiveHtmlDoc}
          title={testMeta.title}
          className="w-full flex-1 h-full border-0 bg-white"
        />
      </div>
    );
  }

  if (!currentQ) {
    return (
      <div className="p-8 text-center">
        <p className="text-black dark:text-white text-lg font-bold">No questions found in this test.</p>
        <button onClick={onExit} className="mt-4 px-4 py-2 rounded-xl ice-glow-btn">
          Return to Portal
        </button>
      </div>
    );
  }

  // Helper to decide if Hindi & English are identical so we don't duplicate identical text when langMode === 'both'
  const isBilingualIdentical =
    String(currentQ.questionHi || '').trim() === String(currentQ.questionEn || '').trim();

  // ============================================================================
  // POST-SUBMISSION RESULT & DETAILED SOLUTIONS VIEW
  // ============================================================================
  if (isSubmitted) {
    const filteredQuestions = questions.filter((q, idx) => {
      const chosen = answers[idx];
      const isCorrect =
        chosen &&
        (String(chosen) === String(q.correctAnswer) ||
          (q.alsoCorrect && String(chosen) === String(q.alsoCorrect)));
      const qTime = questionTimes[idx] || 0;
      if (solutionFilter === 'correct') return Boolean(isCorrect);
      if (solutionFilter === 'wrong') return Boolean(chosen && !isCorrect);
      if (solutionFilter === 'unattempted') return !chosen;
      if (solutionFilter === 'slow') return qTime >= 120;
      if (solutionFilter === 'bookmarked') return Boolean(bookmarked[idx]);
      return true;
    });

    return (
      <div className="min-h-screen pb-16 text-black dark:text-white">
        <HeartCelebrationCanvas active={showHeartCelebration} />
        {renderShareScorecardModal()}
        {renderPdfGeneratingOverlay()}

        {/* Top Result Header */}
        <header className="sticky top-0 z-30 ice-glass-strong border-b border-sky-200/80 dark:border-slate-800 px-4 py-3 no-print">
          <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <button
                onClick={onExit}
                className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl ice-glass hover:bg-white/90 dark:hover:bg-slate-800 text-black dark:text-white text-xs md:text-sm font-extrabold transition"
              >
                <ArrowLeft className="w-4 h-4 text-sky-600 dark:text-sky-400" />
                Back to Portal
              </button>
              <div>
                <h1 className="text-sm md:text-lg font-bold text-black dark:text-white line-clamp-1">
                  {testMeta.title} — Scorecard &amp; Solutions
                </h1>
                <p className="text-xs text-black/75 dark:text-white/80">{testMeta.subject}</p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={isGeneratingQuestionPdf}
                onClick={() => handleDownloadQuestionPaperPdf()}
                className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-gradient-to-r from-indigo-600 via-sky-600 to-cyan-600 hover:from-indigo-500 hover:to-cyan-500 disabled:opacity-60 text-white text-xs md:text-sm font-extrabold shadow-sm transition cursor-pointer"
              >
                {isGeneratingQuestionPdf ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <FileDown className="w-4 h-4" />
                )}
                <span>Download Question PDF (VS)</span>
              </button>

              <button
                type="button"
                onClick={() => handleShareResult('open_modal')}
                className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-sky-600 hover:from-emerald-500 hover:to-sky-500 text-white text-xs md:text-sm font-extrabold shadow-sm transition cursor-pointer"
              >
                <Share2 className="w-4 h-4" />
                <span>Share Scorecard</span>
              </button>

              <button
                onClick={() => window.print()}
                className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl ice-glass hover:bg-white dark:hover:bg-slate-800 text-black dark:text-white text-xs md:text-sm font-semibold transition"
              >
                <Printer className="w-4 h-4 text-sky-600 dark:text-sky-400" />
                Print Paper / Solutions
              </button>
            </div>
          </div>
        </header>

        <div className="max-w-6xl mx-auto px-4 pt-6 space-y-6">
          {/* Score Hero Banner */}
          <div className="ice-glass-strong rounded-2xl p-6 md:p-8 relative overflow-hidden">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
              <div>
                <div className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-black/75 dark:text-white/80 mb-2">
                  <Award className="w-4 h-4 text-rose-600 dark:text-rose-400" /> Vs Test Official Result Summary
                </div>
                <h2 className="text-2xl md:text-3xl font-extrabold text-black dark:text-white">
                  Well Done, {studentName || 'NEET Aspirant'}!
                </h2>
                <p className="text-sm text-black/80 dark:text-white/85 mt-1">
                  {testMeta.subTitle} · Completed in {formatTime(resultSummary.totalTimeSpent)}
                </p>
                <div className="flex flex-wrap items-center gap-2 mt-3 no-print">
                  <button
                    type="button"
                    disabled={isGeneratingQuestionPdf}
                    onClick={() => handleDownloadQuestionPaperPdf()}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-gradient-to-r from-indigo-600 to-sky-600 hover:from-indigo-500 hover:to-sky-500 disabled:opacity-60 text-white text-xs font-extrabold shadow-xs transition cursor-pointer"
                  >
                    {isGeneratingQuestionPdf ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <FileDown className="w-3.5 h-3.5" />
                    )}
                    <span>Download Full Question Paper PDF (VS Watermark)</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleShareResult('open_modal')}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-xs font-extrabold shadow-xs transition cursor-pointer"
                  >
                    <Share2 className="w-3.5 h-3.5" />
                    <span>Share Scorecard Image / Link</span>
                  </button>
                </div>
              </div>

              <div className="flex items-center gap-4 bg-slate-900 dark:bg-slate-800 text-white rounded-2xl px-6 py-4 shadow-sm border border-slate-700">
                <Award className="w-10 h-10 text-rose-400 shrink-0" />
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wider text-slate-300">
                    Final Score
                  </div>
                  <div className="text-3xl md:text-4xl font-extrabold text-white font-mono-tabular">
                    {resultSummary.score}{' '}
                    <span className="text-lg font-normal text-slate-300">/ {testMeta.maxMarks}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* 4-Metric Strip */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5 mt-6">
              <div className="ice-glass rounded-xl p-4 border-emerald-300 dark:border-emerald-700">
                <div className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4" /> Correct (+{testMeta.correctMarks})
                </div>
                <div className="text-2xl font-extrabold text-black dark:text-white font-mono-tabular mt-1">
                  {resultSummary.correctCount}
                </div>
              </div>

              <div className="ice-glass rounded-xl p-4 border-rose-300 dark:border-rose-700">
                <div className="text-xs font-semibold text-rose-700 dark:text-rose-400 flex items-center gap-1.5">
                  <XCircle className="w-4 h-4" /> Incorrect (-{testMeta.negativeMarks})
                </div>
                <div className="text-2xl font-extrabold text-black dark:text-white font-mono-tabular mt-1">
                  {resultSummary.wrongCount}
                </div>
              </div>

              <div className="ice-glass rounded-xl p-4">
                <div className="text-xs font-semibold text-black/80 dark:text-white/85 flex items-center gap-1.5">
                  <Clock className="w-4 h-4 text-sky-600 dark:text-sky-400" /> Unattempted (0)
                </div>
                <div className="text-2xl font-extrabold text-black dark:text-white font-mono-tabular mt-1">
                  {resultSummary.unattemptedCount}
                </div>
              </div>

              <div className="ice-glass rounded-xl p-4">
                <div className="text-xs font-semibold text-black/80 dark:text-white/85 flex items-center gap-1.5">
                  <Award className="w-4 h-4 text-blue-600 dark:text-blue-400" /> Accuracy Rate
                </div>
                <div className="text-2xl font-extrabold text-black dark:text-white font-mono-tabular mt-1">
                  {resultSummary.accuracy}%
                </div>
              </div>
            </div>
          </div>

          {/* =================================================================
              FEATURE 3: TEST-WISE TOPPER LIST, PERCENTILE (%) & NEET RANK PREDICTOR
             ================================================================= */}
          {(() => {
            const maxMarksSafe = Math.max(4, testMeta.maxMarks || questions.length * 4 || 360);
            const scorePct = Math.max(0, Math.min(100, (resultSummary.score / maxMarksSafe) * 100));
            const percentile =
              resultSummary.score <= 0
                ? 12.4
                : Math.min(99.98, Math.max(18.5, Number((35 + Math.pow(scorePct / 100, 0.72) * 64.95).toFixed(2))));

            const predictedNeetAir =
              scorePct >= 96
                ? 'AIR 1 – 250 (Top AIIMS Delhi Zone)'
                : scorePct >= 90
                  ? 'AIR 251 – 1,800 (Top Govt Medical College)'
                  : scorePct >= 82
                    ? 'AIR 1,801 – 8,500 (Govt MBBS Safe Zone)'
                    : scorePct >= 72
                      ? 'AIR 8,501 – 24,000 (State Quota Govt MBBS)'
                      : scorePct >= 58
                        ? 'AIR 24,001 – 65,000 (Borderline / Need Revision)'
                        : 'AIR 65,000+ (Focus on Mistake Notebook)';

            // Build Test-Wise Top 10 Rankers List (combining real student attempts for this test + benchmark coaching toppers)
            const benchmarkRatios = [
              { name: 'Aarav Sharma (Target Batch)', ratio: 0.97, acc: 98, timeRatio: 0.68 },
              { name: 'Priya Verma (Prayas Batch)', ratio: 0.94, acc: 95, timeRatio: 0.72 },
              { name: 'Rohan Yadav (AIIMS Batch)', ratio: 0.91, acc: 93, timeRatio: 0.75 },
              { name: 'Ananya Gupta (Ranker Series)', ratio: 0.88, acc: 91, timeRatio: 0.79 },
              { name: 'Vikramaditya Singh', ratio: 0.84, acc: 89, timeRatio: 0.81 },
              { name: 'Sneha Patel (NEET 2027)', ratio: 0.81, acc: 86, timeRatio: 0.84 },
              { name: 'Karan Malhotra', ratio: 0.77, acc: 84, timeRatio: 0.86 },
              { name: 'Neha कुमारी (Target 2027)', ratio: 0.73, acc: 81, timeRatio: 0.88 },
              { name: 'Aditya Raj', ratio: 0.69, acc: 78, timeRatio: 0.91 },
            ];
            const baseDurSecs = Math.max(1800, (testMeta.durationMinutes || 90) * 60);

            const realForThisTest = (Array.isArray(testAttempts) ? testAttempts : [])
              .filter((a) => a && a.testId === testMeta.id)
              .map((a) => ({
                name: a.studentName || 'NEET Student',
                score: a.score,
                maxMarks: a.maxMarks || maxMarksSafe,
                accuracy: a.accuracy || 0,
                timeTakenSeconds: a.timeTakenSeconds || 1800,
                isCurrentStudent:
                  (studentId && a.studentId === studentId) ||
                  (studentEmail && a.studentEmail?.toLowerCase() === studentEmail.toLowerCase()),
              }));

            const currentStudentEntry = {
              name: `${studentName || 'You'} (You)`,
              score: resultSummary.score,
              maxMarks: maxMarksSafe,
              accuracy: resultSummary.accuracy,
              timeTakenSeconds: Math.max(1, resultSummary.totalTimeSpent),
              isCurrentStudent: true,
            };

            const seedEntries = benchmarkRatios.map((b) => {
              const rawS = Math.round((maxMarksSafe * b.ratio) / 4) * 4;
              return {
                name: b.name,
                score: Math.min(maxMarksSafe, Math.max(4, rawS)),
                maxMarks: maxMarksSafe,
                accuracy: b.acc,
                timeTakenSeconds: Math.round(baseDurSecs * b.timeRatio),
                isCurrentStudent: false,
              };
            });

            const mergedByName = new Map<
              string,
              {
                name: string;
                score: number;
                maxMarks: number;
                accuracy: number;
                timeTakenSeconds: number;
                isCurrentStudent: boolean;
              }
            >();
            mergedByName.set('__current_user__', currentStudentEntry);
            for (const r of realForThisTest) {
              if (r.isCurrentStudent) continue;
              const key = r.name.trim().toLowerCase();
              const prev = mergedByName.get(key);
              if (!prev || r.score > prev.score) {
                mergedByName.set(key, r);
              }
            }
            for (const s of seedEntries) {
              const key = s.name.trim().toLowerCase();
              if (!mergedByName.has(key)) {
                mergedByName.set(key, s);
              }
            }

            const sortedBoard = Array.from(mergedByName.values()).sort((a, b) => {
              if (b.score !== a.score) return b.score - a.score;
              if (b.accuracy !== a.accuracy) return b.accuracy - a.accuracy;
              return a.timeTakenSeconds - b.timeTakenSeconds;
            });

            const myRankIndex = sortedBoard.findIndex((item) => item.isCurrentStudent);
            const myRank = myRankIndex >= 0 ? myRankIndex + 1 : 1;
            const topper = sortedBoard[0] || currentStudentEntry;
            const top10List = sortedBoard.slice(0, 10);

            return (
              <div className="ice-glass-strong rounded-2xl p-6 md:p-7 border border-sky-200/90 dark:border-slate-800 space-y-6 no-print">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-sky-200/70 dark:border-slate-800 pb-4">
                  <div>
                    <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md bg-amber-500/15 border border-amber-500/40 text-amber-700 dark:text-amber-300 text-[11px] font-extrabold uppercase tracking-wider">
                      <Award className="w-3.5 h-3.5" /> Test-Wise Rank, Percentile &amp; Topper Comparison
                    </div>
                    <h3 className="text-lg sm:text-xl font-black text-black dark:text-white mt-1">
                      {testMeta.title} — All-India Rank Predictor &amp; Top 10 Toppers
                    </h3>
                  </div>

                  <div className="flex flex-wrap items-center gap-2.5">
                    <div className="px-4 py-2 rounded-xl bg-amber-500/15 border border-amber-500/40 text-center">
                      <div className="text-[10px] font-extrabold uppercase text-amber-700 dark:text-amber-300">
                        Your Test Rank
                      </div>
                      <div className="text-xl font-black font-mono-tabular text-black dark:text-white">
                        #{myRank}{' '}
                        <span className="text-xs font-bold text-slate-600 dark:text-slate-400">
                          / {Math.max(sortedBoard.length, (testMeta.completionCount || 0) + 12)}
                        </span>
                      </div>
                    </div>

                    <div className="px-4 py-2 rounded-xl bg-sky-500/15 border border-sky-500/40 text-center">
                      <div className="text-[10px] font-extrabold uppercase text-sky-700 dark:text-sky-300">
                        Percentile
                      </div>
                      <div className="text-xl font-black font-mono-tabular text-sky-700 dark:text-sky-300">
                        {percentile}%ile
                      </div>
                    </div>
                  </div>
                </div>

                {/* NEET Expected AIR Predictor Banner */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="p-4 rounded-2xl ice-glass border border-emerald-300/80 dark:border-emerald-800 flex flex-col justify-between">
                    <div className="text-xs font-extrabold uppercase text-emerald-700 dark:text-emerald-400">
                      🎯 NEET 2027 Expected AIR Predictor
                    </div>
                    <div className="text-base sm:text-lg font-black text-black dark:text-white mt-1.5">
                      {predictedNeetAir}
                    </div>
                    <div className="text-[11px] font-semibold text-slate-600 dark:text-slate-400 mt-1">
                      Based on {Math.round(scorePct)}% marks &amp; {resultSummary.accuracy}% accuracy
                    </div>
                  </div>

                  {/* You vs Test Topper Comparison */}
                  <div className="md:col-span-2 p-4 rounded-2xl ice-glass space-y-3">
                    <div className="flex items-center justify-between text-xs font-extrabold text-black dark:text-white">
                      <span>⚡ You vs Test Topper ({topper.name})</span>
                      <span className="font-mono-tabular text-sky-700 dark:text-sky-300">
                        Topper Score: {topper.score}/{maxMarksSafe} ({topper.accuracy}% Acc)
                      </span>
                    </div>

                    <div className="space-y-2">
                      <div>
                        <div className="flex justify-between text-[11px] font-bold mb-1">
                          <span>Your Score: {resultSummary.score} / {maxMarksSafe}</span>
                          <span>Topper: {topper.score} / {maxMarksSafe}</span>
                        </div>
                        <div className="w-full h-2.5 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden flex">
                          <div
                            style={{
                              width: `${Math.max(4, Math.min(100, (Math.max(0, resultSummary.score) / maxMarksSafe) * 100))}%`,
                            }}
                            className="h-full bg-emerald-500 rounded-full"
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-3 pt-1 text-xs font-semibold">
                        <div className="p-2 rounded-xl bg-white/70 dark:bg-slate-900/70 border border-sky-200/70 dark:border-slate-700 flex items-center justify-between">
                          <span>Accuracy Gap:</span>
                          <span className="font-mono-tabular font-extrabold text-sky-700 dark:text-sky-300">
                            You {resultSummary.accuracy}% vs Topper {topper.accuracy}%
                          </span>
                        </div>
                        <div className="p-2 rounded-xl bg-white/70 dark:bg-slate-900/70 border border-sky-200/70 dark:border-slate-700 flex items-center justify-between">
                          <span>Time Taken:</span>
                          <span className="font-mono-tabular font-extrabold text-amber-700 dark:text-amber-300">
                            You {formatTime(resultSummary.totalTimeSpent)} vs {formatTime(topper.timeTakenSeconds)}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Top 10 Rankers Table for This Test */}
                <div>
                  <h4 className="text-xs sm:text-sm font-extrabold uppercase tracking-wider text-black/80 dark:text-white/85 mb-2.5">
                    🏆 Top 10 Rankers of {testMeta.title}
                  </h4>
                  <div className="overflow-x-auto rounded-2xl border border-sky-200/80 dark:border-slate-800">
                    <table className="w-full text-left border-collapse text-xs sm:text-sm">
                      <thead>
                        <tr className="bg-sky-100/80 dark:bg-slate-900 text-black dark:text-white border-b border-sky-200/80 dark:border-slate-800">
                          <th className="py-2.5 px-3 font-extrabold">Rank</th>
                          <th className="py-2.5 px-3 font-extrabold">Student Name</th>
                          <th className="py-2.5 px-3 font-extrabold text-right">Score</th>
                          <th className="py-2.5 px-3 font-extrabold text-right">Accuracy</th>
                          <th className="py-2.5 px-3 font-extrabold text-right">Time Taken</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-sky-100 dark:divide-slate-800">
                        {top10List.map((row, rIdx) => (
                          <tr
                            key={rIdx}
                            className={
                              row.isCurrentStudent
                                ? 'bg-emerald-500/15 dark:bg-emerald-950/60 font-extrabold'
                                : 'hover:bg-white/50 dark:hover:bg-slate-800/40'
                            }
                          >
                            <td className="py-2.5 px-3 font-mono-tabular font-black">
                              {rIdx === 0 ? '🥇 #1' : rIdx === 1 ? '🥈 #2' : rIdx === 2 ? '🥉 #3' : `#${rIdx + 1}`}
                            </td>
                            <td className="py-2.5 px-3 text-black dark:text-white">
                              {row.name}
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono-tabular font-black text-emerald-700 dark:text-emerald-400">
                              {row.score} / {row.maxMarks}
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono-tabular font-bold text-sky-700 dark:text-sky-300">
                              {row.accuracy}%
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono-tabular text-slate-700 dark:text-slate-300">
                              {formatTime(row.timeTakenSeconds)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* =================================================================
              WEAK TOPIC REVISION & MISTAKE ANALYSIS
             ================================================================= */}
          <div className="ice-glass-strong rounded-2xl p-6 md:p-7 border border-slate-200 dark:border-slate-800 space-y-5 no-print">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-start gap-3.5">
                <div className="w-12 h-12 rounded-xl bg-slate-900 dark:bg-slate-800 text-white flex items-center justify-center shrink-0">
                  <BookOpen className="w-6 h-6 text-rose-400" />
                </div>
                <div>
                  <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-[11px] font-bold uppercase tracking-wider text-black dark:text-white">
                    Vs Test · Weak Topic &amp; Mistake Analysis
                  </div>
                  <h3 className="text-lg sm:text-xl font-extrabold text-black dark:text-white mt-1">
                    Weak Topic Revision &amp; Notes (कमजोर टॉपिक्स का रिवीजन)
                  </h3>
                  <p className="text-xs sm:text-sm text-black/80 dark:text-white/85">
                    Review your weak chapters with short NCERT revision notes, memory tricks, and 3 practice questions.
                  </p>
                </div>
              </div>

              <button
                type="button"
                disabled={isLoadingRescue}
                onClick={handleGenerateWeakLinkRescue}
                className="min-h-[48px] px-5 py-3 rounded-xl ice-glow-btn text-xs sm:text-sm font-extrabold flex items-center justify-center gap-2 shrink-0 active:scale-[0.98] transition"
              >
                {isLoadingRescue ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Preparing Revision Notes...</span>
                  </>
                ) : (
                  <>
                    <BookOpen className="w-4 h-4" />
                    <span>
                      {rescuePlan ? 'Refresh Revision Notes' : 'Open Weak Topic Revision'}
                    </span>
                  </>
                )}
              </button>
            </div>

            {rescuePlan && (
              <div className="space-y-5 pt-4 border-t border-slate-200 dark:border-slate-800">
                {/* Bilingual Diagnosis Box */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-900/90 border border-slate-200 dark:border-slate-700 space-y-1.5">
                    <div className="text-xs font-extrabold uppercase tracking-wider text-black/80 dark:text-white/80">
                      हिंदी विश्लेषण (Topic Feedback)
                    </div>
                    <p className="text-sm sm:text-base font-semibold text-black dark:text-white leading-relaxed">
                      {rescuePlan.diagnosisHi}
                    </p>
                  </div>
                  <div className="p-4 rounded-xl bg-white dark:bg-slate-900/90 border border-slate-200 dark:border-slate-700 space-y-1.5">
                    <div className="text-xs font-extrabold uppercase tracking-wider text-black/80 dark:text-white/80">
                      Performance Report
                    </div>
                    <p className="text-sm sm:text-base font-medium text-black dark:text-white leading-relaxed">
                      {rescuePlan.diagnosisEn}
                    </p>
                  </div>
                </div>

                {/* Weak Chapters & Priority Boosters */}
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-extrabold uppercase text-rose-800 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-800 px-3 py-1 rounded-lg">
                    Focus Chapters:
                  </span>
                  {(Array.isArray(rescuePlan.weakChapters) ? rescuePlan.weakChapters : []).map((ch, idx) => (
                    <span
                      key={idx}
                      className="px-3 py-1 rounded-xl bg-white dark:bg-slate-800 border border-sky-300 dark:border-slate-700 text-xs font-extrabold text-black dark:text-white"
                    >
                      {ch}
                    </span>
                  ))}
                </div>

                {/* 3 NCERT Rescue Capsules */}
                <div className="space-y-3">
                  <h4 className="text-sm sm:text-base font-extrabold text-black dark:text-white flex items-center gap-2">
                    <Lightbulb className="w-4 h-4 text-amber-500" />
                    <span>NCERT High-Yield Revision Notes &amp; Mnemonics</span>
                  </h4>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {(Array.isArray(rescuePlan.rescueCapsules) ? rescuePlan.rescueCapsules : []).map((cap, idx) => (
                      <div
                        key={idx}
                        className="ice-glass rounded-2xl p-4 border border-sky-200/90 dark:border-slate-700 flex flex-col justify-between space-y-3"
                      >
                        <div className="space-y-2">
                          <span className="inline-block px-2.5 py-0.5 rounded-lg bg-sky-600 text-white text-xs font-extrabold">
                            Note #{idx + 1} · {cap.chapter}
                          </span>
                          <p className="text-sm font-bold text-black dark:text-white leading-snug">
                            {cap.conceptHi}
                          </p>
                          <p className="text-xs text-black/80 dark:text-white/85 leading-relaxed">
                            {cap.conceptEn}
                          </p>
                        </div>
                        <div className="p-2.5 rounded-xl bg-amber-50/95 dark:bg-amber-950/50 border border-amber-300 dark:border-amber-700 text-xs font-extrabold text-amber-950 dark:text-amber-200">
                          💡 Trick: {cap.ncertTrick}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* 3 Interactive Targeted Rescue MCQs */}
                {Array.isArray(rescuePlan.practiceMcqs) && rescuePlan.practiceMcqs.length > 0 && (
                  <div className="space-y-3">
                    <h4 className="text-sm sm:text-base font-extrabold text-black dark:text-white flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                      <span>Topic Practice Drill (3 Targeted NEET MCQs)</span>
                    </h4>
                    <div className="space-y-4">
                      {rescuePlan.practiceMcqs.map((mcq, mIdx) => {
                        const picked = rescueMcqAnswers[mIdx];
                        return (
                          <div
                            key={mIdx}
                            className="p-4 sm:p-5 rounded-2xl bg-white/90 dark:bg-slate-900/90 border border-sky-200 dark:border-slate-700 space-y-3"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="px-2.5 py-0.5 rounded-lg bg-sky-100 dark:bg-sky-950 text-sky-900 dark:text-sky-200 text-xs font-extrabold">
                                Practice MCQ #{mIdx + 1} · {mcq.chapter}
                              </span>
                              {picked && (
                                <span
                                  className={`text-xs font-extrabold px-2.5 py-0.5 rounded-lg ${
                                    picked === mcq.correctOption
                                      ? 'bg-emerald-100 text-emerald-800'
                                      : 'bg-rose-100 text-rose-800'
                                  }`}
                                >
                                  {picked === mcq.correctOption
                                    ? 'Correct! (+4)'
                                    : `Correct Option: (${mcq.correctOption})`}
                                </span>
                              )}
                            </div>

                            <div className="space-y-1">
                              <p className="text-base sm:text-lg font-bold text-black dark:text-white">
                                {mcq.questionHi}
                              </p>
                              <p className="text-sm sm:text-base text-black/85 dark:text-white/90">
                                {mcq.questionEn}
                              </p>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                              {(Array.isArray(mcq.options) ? mcq.options : []).map((optText, oIdx) => {
                                const optNum = String(oIdx + 1);
                                const isChosen = picked === optNum;
                                const isCorrectOpt = mcq.correctOption === optNum;
                                let btnStyle =
                                  'ice-glass hover:bg-sky-50 dark:hover:bg-slate-800 text-black dark:text-white border-sky-200 dark:border-slate-700';
                                if (picked) {
                                  if (isCorrectOpt) {
                                    btnStyle =
                                      'bg-emerald-50 dark:bg-emerald-950/70 border-emerald-500 text-emerald-950 dark:text-emerald-200 font-extrabold';
                                  } else if (isChosen) {
                                    btnStyle =
                                      'bg-rose-50 dark:bg-rose-950/70 border-rose-400 text-rose-950 dark:text-rose-200';
                                  }
                                }
                                return (
                                  <button
                                    key={oIdx}
                                    type="button"
                                    onClick={() =>
                                      setRescueMcqAnswers((prev) => ({
                                        ...prev,
                                        [mIdx]: optNum,
                                      }))
                                    }
                                    className={`min-h-[46px] p-3 rounded-xl border text-left text-xs sm:text-sm flex items-center gap-2.5 transition ${btnStyle}`}
                                  >
                                    <span className="w-6 h-6 rounded-lg bg-white dark:bg-slate-800 text-black dark:text-white border border-sky-300 dark:border-slate-600 flex items-center justify-center font-mono-tabular font-extrabold text-xs shrink-0">
                                      {optNum}
                                    </span>
                                    <span className="flex-1">{optText}</span>
                                  </button>
                                );
                              })}
                            </div>

                            {picked && (
                              <div className="p-3 rounded-xl bg-sky-50 dark:bg-slate-800/90 border border-sky-200 dark:border-slate-700 text-xs sm:text-sm text-black dark:text-white space-y-1">
                                <div className="font-extrabold text-sky-950 dark:text-sky-300">
                                  NCERT Explanation:
                                </div>
                                <p>{mcq.explanationHi}</p>
                                {mcq.explanationEn && mcq.explanationEn !== mcq.explanationHi && (
                                  <p className="text-black/80 dark:text-white/85">{mcq.explanationEn}</p>
                                )}
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

          {/* Chapter-wise Breakdown */}
          <div className="ice-glass rounded-3xl p-6">
            <h3 className="text-base md:text-lg font-bold text-black dark:text-white mb-4 flex items-center gap-2">
              <BookOpen className="w-5 h-5 text-sky-600 dark:text-sky-400" /> Chapter-Wise Accuracy &amp; Time Breakdown
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs md:text-sm">
                <thead>
                  <tr className="border-b border-sky-200/80 dark:border-slate-700 text-black/80 dark:text-white/85">
                    <th className="py-2.5 px-3 font-semibold">Chapter / Topic</th>
                    <th className="py-2.5 px-3 font-semibold text-right">Total Qs</th>
                    <th className="py-2.5 px-3 font-semibold text-right text-emerald-700 dark:text-emerald-400">Correct</th>
                    <th className="py-2.5 px-3 font-semibold text-right text-rose-700 dark:text-rose-400">Wrong</th>
                    <th className="py-2.5 px-3 font-semibold text-right">Skipped</th>
                    <th className="py-2.5 px-3 font-semibold text-right">Time Spent</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-sky-100 dark:divide-slate-800">
                  {Object.entries(resultSummary.chapterStats || {}).map(([chName, st]) => (
                    <tr key={chName} className="hover:bg-white/50 dark:hover:bg-slate-800/50">
                      <td className="py-2.5 px-3 font-medium text-black dark:text-white">{chName}</td>
                      <td className="py-2.5 px-3 text-right font-mono-tabular text-black dark:text-white">{st.total}</td>
                      <td className="py-2.5 px-3 text-right font-mono-tabular text-emerald-700 dark:text-emerald-400 font-semibold">
                        {st.correct}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono-tabular text-rose-700 dark:text-rose-400 font-semibold">
                        {st.wrong}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono-tabular text-black/70 dark:text-white/75">
                        {st.unattempted}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono-tabular text-black dark:text-white">
                        {formatTime(st.timeSpent)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Detailed Solutions Filter Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 no-print">
            <h3 className="text-lg font-bold text-black dark:text-white">
              Detailed NCERT Solutions ({filteredQuestions.length})
            </h3>
            <div className="flex flex-wrap gap-1.5">
              {(
                [
                  { id: 'all', label: `All (${questions.length})` },
                  { id: 'correct', label: `Correct (${resultSummary.correctCount})` },
                  { id: 'wrong', label: `Wrong (${resultSummary.wrongCount})` },
                  { id: 'unattempted', label: `Unattempted (${resultSummary.unattemptedCount})` },
                  { id: 'bookmarked', label: 'Bookmarked' },
                  { id: 'slow', label: 'Slow >2m' },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setSolutionFilter(tab.id)}
                  className={`px-3.5 py-2 rounded-xl text-xs font-semibold transition ${
                    solutionFilter === tab.id
                      ? 'ice-glow-btn'
                      : 'ice-glass text-black dark:text-white hover:bg-white/80 dark:hover:bg-slate-800'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          {/* Question-by-Question Review List */}
          <div className="space-y-4">
            {filteredQuestions.map((q) => {
              const qIdx = questions.findIndex((item) => item.id === q.id);
              const chosen = answers[qIdx];
              const isCorrect =
                chosen &&
                (String(chosen) === String(q.correctAnswer) ||
                  (q.alsoCorrect && String(chosen) === String(q.alsoCorrect)));
              const qTime = questionTimes[qIdx] || 0;
              const sameText =
                String(q.questionHi || '').trim() === String(q.questionEn || '').trim();

              return (
                <div key={q.id} className="ice-glass rounded-2xl p-5 md:p-6 space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-sky-200/70 dark:border-slate-700 pb-3">
                    <div className="flex items-center gap-2">
                      <span className="px-2.5 py-1 rounded-lg bg-sky-600 text-white text-xs font-bold font-mono-tabular">
                        Q.{q.id}
                      </span>
                      {q.chapter && (
                        <span className="text-xs font-medium text-sky-900 dark:text-sky-200 bg-sky-100/80 dark:bg-sky-950/70 px-2.5 py-1 rounded-lg">
                          {q.chapter}
                        </span>
                      )}
                      {qTime >= 120 && (
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-800 bg-amber-100/90 px-2.5 py-1 rounded-lg">
                          <AlertTriangle className="w-3.5 h-3.5" /> Slow ({formatTime(qTime)})
                        </span>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-2 text-xs font-semibold">
                      <button
                        type="button"
                        onClick={() => toggleBookmarkAtIdx(qIdx)}
                        className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border font-extrabold transition ${
                          bookmarked[qIdx]
                            ? 'bg-amber-400 text-amber-950 border-amber-500 shadow-xs'
                            : 'ice-glass text-black dark:text-white border-sky-300 dark:border-slate-700 hover:bg-amber-100'
                        }`}
                        title="Save this question to your Mistake & Bookmark Notebook"
                      >
                        <Bookmark className="w-3.5 h-3.5 fill-current" />
                        <span>{bookmarked[qIdx] ? 'Saved in Notebook' : 'Save to Notebook'}</span>
                      </button>

                      <span className="text-black/75 dark:text-white/80 font-mono-tabular">Time: {formatTime(qTime)}</span>
                      {!chosen ? (
                        <span className="text-black dark:text-white bg-slate-200/70 dark:bg-slate-800 px-2.5 py-1 rounded-lg">
                          Unattempted (0)
                        </span>
                      ) : isCorrect ? (
                        <span className="text-emerald-800 bg-emerald-100/90 px-2.5 py-1 rounded-lg flex items-center gap-1">
                          <CheckCircle2 className="w-3.5 h-3.5" /> +{testMeta.correctMarks} Correct
                        </span>
                      ) : (
                        <span className="text-rose-800 bg-rose-100/90 px-2.5 py-1 rounded-lg flex items-center gap-1">
                          <XCircle className="w-3.5 h-3.5" /> -{testMeta.negativeMarks} Incorrect
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Question Text (Extra-Large Scale) */}
                  <div className="space-y-2 text-xl sm:text-2xl md:text-3xl font-bold leading-relaxed">
                    <RichQuestionText
                      text={q.questionHi}
                      className="font-bold text-black dark:text-white"
                    />
                    {!sameText && (
                      <RichQuestionText text={q.questionEn} className="text-black/90 dark:text-white/95" />
                    )}
                  </div>

                  {renderTable(q)}
                  {renderImages(q)}

                  {/* Options Grid */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                    {(Array.isArray(q.optionsEn) ? q.optionsEn : []).map((optEn, oIdx) => {
                      const optHi = Array.isArray(q.optionsHi) ? q.optionsHi[oIdx] : undefined;
                      const isRightOpt =
                        String(optEn?.id) === String(q.correctAnswer) ||
                        (q.alsoCorrect && String(optEn?.id) === String(q.alsoCorrect));
                      const isUserSelected = String(chosen) === String(optEn?.id);
                      const sameOpt =
                        String(optHi?.text || '').trim() === String(optEn?.text || '').trim();

                      let boxStyle =
                        'border-sky-200/80 dark:border-slate-700 bg-white/60 dark:bg-slate-900/70 text-black dark:text-white';
                      if (isRightOpt) {
                        boxStyle =
                          'border-emerald-500 bg-emerald-50/90 dark:bg-emerald-950/60 text-emerald-950 dark:text-emerald-200 font-semibold';
                      } else if (isUserSelected && !isRightOpt) {
                        boxStyle =
                          'border-rose-400 bg-rose-50/90 dark:bg-rose-950/60 text-rose-950 dark:text-rose-200';
                      }

                      return (
                        <div
                          key={optEn.id}
                          className={`p-3.5 rounded-xl border text-base sm:text-lg md:text-xl flex items-start gap-2.5 ${boxStyle}`}
                        >
                          <span className="w-7 h-7 rounded-lg bg-white/90 dark:bg-slate-800 text-black dark:text-white border border-sky-200 dark:border-slate-600 flex items-center justify-center font-bold font-mono-tabular shrink-0">
                            {optEn.id}
                          </span>
                          <div className="flex-1">
                            {optHi && <RichQuestionText text={optHi.text} />}
                            {!sameOpt && (
                              <RichQuestionText
                                text={optEn.text}
                                className="text-black/85 dark:text-white/90"
                              />
                            )}
                          </div>
                          {isRightOpt && <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />}
                          {isUserSelected && !isRightOpt && (
                            <XCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* Explanation Box */}
                  {(q.explanation?.hi || q.explanation?.en) && (
                    <div className="rounded-xl bg-sky-50/85 dark:bg-slate-900/90 border border-sky-200/90 dark:border-slate-700 p-4 text-base sm:text-lg space-y-1.5">
                      <div className="font-bold text-sky-900 dark:text-sky-300">
                        Explanation / व्याख्या (Correct Answer: Option {q.correctAnswer}
                        {q.alsoCorrect ? ` or ${q.alsoCorrect}` : ''}):
                      </div>
                      {q.explanation?.hi && (
                        <RichQuestionText
                          text={q.explanation.hi}
                          className="text-black dark:text-white"
                        />
                      )}
                      {q.explanation?.en && q.explanation.en !== q.explanation.hi && (
                        <RichQuestionText
                          text={q.explanation.en}
                          className="text-black/85 dark:text-white/90"
                        />
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }



  // ============================================================================
  // LIVE INTERACTIVE TEST & PRACTICE RUNNER
  // ============================================================================
  return (
    <div className="min-h-screen flex flex-col text-black dark:text-white">
      {/* Top Exam Header */}
      <header className="sticky top-0 z-30 ice-glass-strong border-b border-sky-200/90 dark:border-slate-800 px-3 md:px-6 py-2.5">
        <div className="max-w-[1440px] mx-auto flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <button
              type="button"
              onClick={() => setShowConfirmExit(true)}
              className="p-2.5 rounded-xl ice-glass hover:bg-white dark:hover:bg-slate-800 text-black dark:text-white transition shrink-0"
              title="Exit Test"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
            <div className="min-w-0">
              <h1 className="text-xs sm:text-sm md:text-base font-bold text-black dark:text-white truncate">
                {testMeta.title}
              </h1>
              <p className="text-[11px] text-black/75 dark:text-white/80 truncate hidden sm:block">
                {testMeta.subject} · {questions.length} Qs · +{testMeta.correctMarks} / -{testMeta.negativeMarks}
              </p>
            </div>
          </div>

          {/* Center Controls: Mode Switch (Test Mode vs Practice Mode) & Language */}
          <div className="hidden md:flex items-center gap-2">
            <div className="inline-flex items-center rounded-xl ice-glass p-1">
              <button
                type="button"
                onClick={() => {
                  setExactHtmlMode(false);
                  setIsPracticeActive(false);
                }}
                className={`px-3 py-1.5 rounded-lg text-xs font-extrabold transition ${
                  !isPracticeActive
                    ? 'bg-emerald-600 text-white shadow-xs'
                    : 'text-black dark:text-white hover:bg-white/60 dark:hover:bg-slate-800'
                }`}
              >
                Test Mode
              </button>
              <button
                type="button"
                onClick={() => {
                  setExactHtmlMode(false);
                  setIsPracticeActive(true);
                }}
                className={`px-3 py-1.5 rounded-lg text-xs font-extrabold transition ${
                  isPracticeActive
                    ? 'bg-sky-600 text-white shadow-xs'
                    : 'text-black dark:text-white hover:bg-white/60 dark:hover:bg-slate-800'
                }`}
              >
                Practice Mode
              </button>
            </div>

            <div className="inline-flex items-center rounded-xl ice-glass p-1">
              <Languages className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400 ml-2 mr-1" />
              {(
                [
                  { id: 'both', label: 'HI + EN' },
                  { id: 'hi', label: 'हिंदी' },
                  { id: 'en', label: 'ENG' },
                ] as const
              ).map((l) => (
                <button
                  key={l.id}
                  onClick={() => setLangMode(l.id)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition ${
                    langMode === l.id
                      ? 'bg-sky-600 text-white shadow-xs'
                      : 'text-black dark:text-white hover:bg-white/60 dark:hover:bg-slate-800'
                  }`}
                >
                  {l.label}
                </button>
              ))}
            </div>
          </div>

          {/* Right Live Selected Badge, Timer & Submit */}
          <div className="flex items-center gap-2 shrink-0">
            <span
              onClick={() => setShowMobilePalette(true)}
              className={`cursor-pointer inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs font-mono-tabular font-extrabold border transition ${
                paletteCounts.totalAnswered > 0
                  ? 'bg-emerald-600 text-white border-emerald-500 shadow-xs'
                  : 'ice-glass text-black dark:text-white border-sky-200 dark:border-slate-700'
              }`}
              title="Total Answers Selected"
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>
                Selected: {paletteCounts.totalAnswered}/{questions.length}
              </span>
            </span>

            <IsolatedExamTimerBadge
              initialSeconds={remainingSecondsRef.current}
              isPaused={isSubmitted}
              isPracticeActive={isPracticeActive}
              currentIdx={currentIdx}
              remainingSecondsRef={remainingSecondsRef}
              questionTimesRef={questionTimesRef}
              onTimeUp={handleFinalizeSubmit}
            />

            <button
              type="button"
              onClick={() => {
                setQuestionTimes({ ...questionTimesRef.current });
                setShowConfirmSubmit(true);
              }}
              className="px-3.5 py-2 rounded-xl ice-glow-btn text-xs sm:text-sm font-bold whitespace-nowrap"
            >
              Submit Test
            </button>
          </div>
        </div>

        {/* Mobile Secondary Toolbar for Language & Mode Switch */}
        <div className="flex md:hidden items-center justify-between gap-2 pt-2 mt-2 border-t border-sky-200/60 dark:border-slate-800">
          <div className="inline-flex items-center rounded-lg ice-glass p-0.5">
            {(
              [
                { id: 'both', label: 'HI+EN' },
                { id: 'hi', label: 'हिंदी' },
                { id: 'en', label: 'EN' },
              ] as const
            ).map((l) => (
              <button
                key={l.id}
                onClick={() => setLangMode(l.id)}
                className={`px-2.5 py-1 rounded-md text-xs font-bold ${
                  langMode === l.id ? 'bg-sky-600 text-white' : 'text-black dark:text-white'
                }`}
              >
                {l.label}
              </button>
            ))}
          </div>

          <div className="inline-flex items-center rounded-lg ice-glass p-0.5">
            <button
              type="button"
              onClick={() => {
                setExactHtmlMode(false);
                setIsPracticeActive(false);
              }}
              className={`px-2.5 py-1 rounded-md text-xs font-extrabold ${
                !isPracticeActive ? 'bg-emerald-600 text-white' : 'text-black dark:text-white'
              }`}
            >
              Test Mode
            </button>
            <button
              type="button"
              onClick={() => {
                setExactHtmlMode(false);
                setIsPracticeActive(true);
              }}
              className={`px-2.5 py-1 rounded-md text-xs font-extrabold ${
                isPracticeActive ? 'bg-sky-600 text-white' : 'text-black dark:text-white'
              }`}
            >
              Practice Mode
            </button>
          </div>
        </div>
      </header>

      {/* Main Two-Zone Test & Practice Question Workspace */}
      <div className="flex-1 max-w-[1440px] w-full min-w-0 mx-auto grid grid-cols-1 lg:grid-cols-12 gap-4 p-2.5 sm:p-4 md:p-5 pb-36 lg:pb-6">
        {/* Left Zone: Interactive Question Stage (8 cols on lg) */}
        <div className="lg:col-span-8 xl:col-span-9 min-w-0 flex flex-col gap-4">
          <div className="ice-glass-strong rounded-3xl p-3.5 sm:p-6 md:p-7 flex-1 min-w-0 overflow-hidden flex flex-col justify-between">
            <div className="min-w-0">
              {/* Question Meta Strip */}
              <div className="flex flex-wrap items-center justify-between gap-2 pb-4 mb-5 border-b border-sky-200/80 dark:border-slate-800">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="px-3 py-1 rounded-xl bg-sky-600 text-white text-xs sm:text-sm font-extrabold font-mono-tabular shadow-xs">
                    Question {currentIdx + 1} / {questions.length}
                  </span>
                  {answers[currentIdx] ? (
                    <span className="inline-flex items-center gap-1 px-3 py-1 rounded-xl bg-emerald-600 text-white text-xs sm:text-sm font-extrabold shadow-xs">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      Option ({answers[currentIdx]}) Selected
                    </span>
                  ) : (
                    <span className="text-xs font-bold text-amber-800 dark:text-amber-300 bg-amber-100/90 dark:bg-amber-950/80 px-2.5 py-1 rounded-lg border border-amber-300 dark:border-amber-700">
                      Not Answered Yet
                    </span>
                  )}
                  {currentQ.chapter && (
                    <span className="text-xs font-semibold text-sky-900 dark:text-sky-200 bg-sky-100/85 dark:bg-sky-950/80 px-2.5 py-1 rounded-lg border border-sky-200 dark:border-sky-800">
                      {currentQ.chapter}
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-1.5 sm:gap-2">
                  <button
                    type="button"
                    onClick={toggleBookmark}
                    className={`p-1.5 rounded-lg border transition ${
                      bookmarked[currentIdx]
                        ? 'bg-amber-400 border-amber-500 text-amber-950'
                        : 'ice-glass text-black dark:text-white hover:bg-white dark:hover:bg-slate-800'
                    }`}
                    title="Bookmark Question for Revision"
                  >
                    <Bookmark className="w-3.5 h-3.5 fill-current" />
                  </button>

                  <span
                    className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-mono-tabular font-semibold ${
                      isSlowQuestion
                        ? 'bg-amber-100 dark:bg-amber-950 text-amber-900 dark:text-amber-200 border border-amber-300 dark:border-amber-700'
                        : 'bg-sky-50 dark:bg-slate-800 text-black dark:text-white border border-sky-200/70 dark:border-slate-700'
                    }`}
                    title="Time spent on this question"
                  >
                    <Clock className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400" />
                    {formatTime(currentQTime)}
                    {isSlowQuestion && ' (>2m)'}
                  </span>
                  <span className="text-xs font-mono-tabular font-bold text-emerald-800 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/80 border border-emerald-200 dark:border-emerald-800 px-2 py-1 rounded-lg">
                    +{testMeta.correctMarks}
                  </span>
                  <span className="text-xs font-mono-tabular font-bold text-rose-800 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/80 border border-rose-200 dark:border-rose-800 px-2 py-1 rounded-lg">
                    -{testMeta.negativeMarks}
                  </span>
                </div>
              </div>

              {/* Question Stem (Hindi + English, permanently in extra-large scale, white in Dark Mode) */}
              <div className={`space-y-3.5 ${fontSizeClass}`}>
                {(langMode !== 'en' || !currentQ.questionEn) && currentQ.questionHi && (
                  <RichQuestionText
                    text={currentQ.questionHi}
                    className="font-bold text-black dark:text-white"
                  />
                )}
                {langMode !== 'hi' &&
                  currentQ.questionEn &&
                  (!isBilingualIdentical || langMode === 'en') && (
                    <RichQuestionText
                      text={currentQ.questionEn}
                      className="font-bold text-black dark:text-white"
                    />
                  )}
              </div>

              {/* Match Table & NCERT Diagrams */}
              {renderTable(currentQ)}
              {renderImages(currentQ)}

              {/* Option Buttons (Matches the exact HTML test option style: 2x2 grid for Option (1)-(4) or full-width cards for text options) */}
              {(() => {
                const isCompactOptionLabels =
                  (!String(currentQ.questionHi || '').trim() &&
                    !String(currentQ.questionEn || '').trim() &&
                    currentQ.hasImage) ||
                  (Array.isArray(currentQ.optionsEn) &&
                    currentQ.optionsEn.length > 0 &&
                    currentQ.optionsEn.every((o, idx) => {
                      const t = String(o?.text || '').trim();
                      return (
                        !t ||
                        /^Option\s*\(?\d+\)?$/i.test(t) ||
                        /^विकल्प\s*\(?\d+\)?$/i.test(t) ||
                        t === `(${idx + 1})` ||
                        t === String(idx + 1)
                      );
                    }));

                return (
                  <div
                    className={
                      isCompactOptionLabels
                        ? 'mt-4 grid grid-cols-2 gap-3 sm:gap-3.5'
                        : 'mt-5 space-y-3.5'
                    }
                  >
                    {(Array.isArray(currentQ.optionsEn) ? currentQ.optionsEn : []).map((optEn, oIdx) => {
                      const optId = String(oIdx + 1);
                      const optHi = Array.isArray(currentQ.optionsHi) ? currentQ.optionsHi[oIdx] : undefined;
                      const isSelected = String(answers[currentIdx] || '') === optId;
                      const isRevealed = Boolean(isPracticeActive && revealedInPractice[currentIdx]);
                      const isRightOpt =
                        optId === String(currentQ.correctAnswer) ||
                        Boolean(currentQ.alsoCorrect && optId === String(currentQ.alsoCorrect));
                      const sameOptText =
                        String(optHi?.text || '').trim() === String(optEn?.text || '').trim();

                      let cardClass =
                        'ice-glass hover:bg-white/90 dark:hover:bg-slate-800/90 hover:border-sky-300 dark:hover:border-sky-500 text-black dark:text-white';
                      if (isRevealed) {
                        if (isRightOpt) {
                          cardClass =
                            'bg-emerald-50/95 dark:bg-emerald-950/80 border-emerald-500 ring-2 ring-emerald-400 text-black dark:text-white';
                        } else if (isSelected && !isRightOpt) {
                          cardClass =
                            'bg-rose-50/95 dark:bg-rose-950/80 border-rose-400 ring-2 ring-rose-300 text-black dark:text-white';
                        }
                      } else if (isSelected) {
                        cardClass =
                          'bg-emerald-50/95 dark:bg-emerald-950/80 border-emerald-500 shadow-[0_0_20px_rgba(16,185,129,0.28)] ring-2 ring-emerald-400 text-black dark:text-white';
                      }

                      return (
                        <button
                          key={optId}
                          type="button"
                          onClick={() => selectOption(optId)}
                          className={`w-full text-left p-3.5 sm:p-4 rounded-2xl border-2 transition-all flex items-center gap-3 active:scale-[0.99] ${cardClass}`}
                        >
                          <span
                            className={`w-9 h-9 sm:w-10 sm:h-10 rounded-xl flex items-center justify-center font-mono-tabular font-extrabold text-base sm:text-lg shrink-0 transition ${
                              isSelected
                                ? 'bg-emerald-600 text-white shadow-sm'
                                : 'bg-white/90 dark:bg-slate-800 text-black dark:text-white border border-sky-200 dark:border-slate-600'
                            }`}
                          >
                            {optId}
                          </span>

                          {isCompactOptionLabels ? (
                            <div className="flex-1 font-extrabold text-lg sm:text-xl text-black dark:text-white truncate">
                              {langMode === 'hi' ? `विकल्प (${optId})` : `Option (${optId})`}
                            </div>
                          ) : (
                            <div className={`flex-1 space-y-1 font-bold ${fontSizeClass}`}>
                              {(langMode !== 'en' || !optEn?.text) && optHi?.text && (
                                <RichQuestionText
                                  text={optHi.text}
                                  className="font-bold text-black dark:text-white"
                                />
                              )}
                              {langMode !== 'hi' &&
                                optEn?.text &&
                                (!sameOptText || langMode === 'en') && (
                                  <RichQuestionText
                                    text={optEn.text}
                                    className="text-black dark:text-white font-bold"
                                  />
                                )}
                            </div>
                          )}

                          {isSelected && !isCompactOptionLabels && (
                            <span className="px-2.5 py-1 rounded-lg bg-emerald-600 text-white text-xs font-extrabold shrink-0 self-center">
                              ✓ Selected
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                );
              })()}

              {/* Instant Solution Check in Practice Mode */}
              {isPracticeActive && (
                <div className="mt-5 pt-4 border-t border-sky-200/70 dark:border-slate-800">
                  <button
                    type="button"
                    onClick={() =>
                      setRevealedInPractice((prev) => ({
                        ...prev,
                        [currentIdx]: !prev[currentIdx],
                      }))
                    }
                    className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl ice-glass text-xs sm:text-sm font-bold text-black dark:text-white hover:bg-white dark:hover:bg-slate-800"
                  >
                    <Eye className="w-4 h-4 text-sky-600 dark:text-sky-400" />
                    {revealedInPractice[currentIdx]
                      ? 'Hide Answer & Explanation'
                      : 'Check Answer & Explanation (उत्तर और व्याख्या देखें)'}
                  </button>

                  {revealedInPractice[currentIdx] && (
                    <div className="mt-3 rounded-2xl bg-sky-50/90 dark:bg-slate-900/95 border border-sky-200 dark:border-slate-700 p-4 text-lg sm:text-xl space-y-2">
                      <div className="font-extrabold text-emerald-700 dark:text-emerald-400">
                        {langMode === 'hi'
                          ? `सही उत्तर: विकल्प (${currentQ.correctAnswer})`
                          : `Correct Answer: Option (${currentQ.correctAnswer})`}
                      </div>
                      {(langMode !== 'en' || !currentQ.explanation?.en) &&
                        currentQ.explanation?.hi && (
                          <RichQuestionText
                            text={currentQ.explanation.hi}
                            className="text-black dark:text-white font-medium"
                          />
                        )}
                      {langMode !== 'hi' &&
                        currentQ.explanation?.en &&
                        (langMode === 'en' ||
                          currentQ.explanation.en !== currentQ.explanation.hi) && (
                          <RichQuestionText
                            text={currentQ.explanation.en}
                            className="text-black/90 dark:text-white/95"
                          />
                        )}
                    </div>
                  )}
                </div>
              )}
            </div>

              {/* Desktop Action Footer inside Question Card */}
              <div className="hidden lg:flex items-center justify-between gap-3 pt-6 mt-8 border-t border-sky-200/80 dark:border-slate-800">
                <div className="flex items-center gap-2.5">
                  <button
                    type="button"
                    onClick={clearResponse}
                    className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl ice-glass hover:bg-white dark:hover:bg-slate-800 text-black dark:text-white text-xs sm:text-sm font-semibold transition"
                  >
                    <RotateCcw className="w-4 h-4 text-sky-600 dark:text-sky-400" />
                    Clear Response
                  </button>

                  <button
                    type="button"
                    onClick={markReviewAndNext}
                    className={`inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-xs sm:text-sm font-semibold border transition ${
                      markedForReview[currentIdx]
                        ? 'bg-purple-600 text-white border-purple-500'
                        : 'ice-glass hover:bg-white dark:hover:bg-slate-800 text-black dark:text-white border-purple-200 dark:border-purple-800'
                    }`}
                  >
                    <Flag className="w-4 h-4" />
                    {markedForReview[currentIdx] ? 'Marked for Review' : 'Mark for Review & Next'}
                  </button>
                </div>

                <div className="flex items-center gap-2.5">
                  <button
                    type="button"
                    disabled={currentIdx === 0}
                    onClick={() => goToQuestion(currentIdx - 1)}
                    className="inline-flex items-center gap-1 px-4 py-2.5 rounded-xl ice-glass hover:bg-white dark:hover:bg-slate-800 disabled:opacity-40 text-black dark:text-white text-xs sm:text-sm font-semibold transition"
                  >
                    <ChevronLeft className="w-4 h-4" /> Previous
                  </button>

                  <button
                    type="button"
                    onClick={saveAndNext}
                    className={`inline-flex items-center gap-1.5 px-6 py-2.5 rounded-xl text-xs sm:text-sm font-bold ${
                      currentIdx >= questions.length - 1
                        ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-md'
                        : 'ice-glow-btn'
                    }`}
                  >
                    {currentIdx >= questions.length - 1 ? (
                      <>Save &amp; Submit Test ✓</>
                    ) : (
                      <>
                        Save &amp; Next <ChevronRight className="w-4 h-4" />
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Right Zone: Question Navigation Sidebar (Desktop) */}
          <aside className="hidden lg:flex lg:col-span-4 xl:col-span-3 flex-col ice-glass-strong rounded-3xl p-5 h-[calc(100vh-96px)] sticky top-20">
            <div className="flex items-center justify-between pb-3 mb-3 border-b border-sky-200/80 dark:border-slate-800">
              <div>
                <h2 className="text-sm font-bold text-black dark:text-white">Question Palette</h2>
                <p className="text-xs text-black/75 dark:text-white/80 truncate max-w-[160px]">
                  {studentName || 'Student Mode'}
                </p>
              </div>
              <span className="text-xs font-mono-tabular font-bold text-sky-900 dark:text-sky-200 bg-sky-100/90 dark:bg-sky-950/80 px-2.5 py-1 rounded-lg">
                {paletteCounts.totalAnswered} / {questions.length} Done
              </span>
            </div>

            {/* Dedicated Sidebar Bookmark Action Button */}
            <button
              type="button"
              onClick={toggleBookmark}
              className={`w-full mb-3 py-2.5 px-3.5 rounded-2xl border text-xs font-bold flex items-center justify-between transition ${
                bookmarked[currentIdx]
                  ? 'bg-amber-400 border-amber-500 text-amber-950 shadow-xs'
                  : 'ice-glass hover:bg-white dark:hover:bg-slate-800 text-black dark:text-white border-sky-200/90 dark:border-slate-700'
              }`}
            >
              <span className="inline-flex items-center gap-2">
                <Bookmark
                  className={`w-4 h-4 ${
                    bookmarked[currentIdx] ? 'fill-amber-950 text-amber-950' : 'text-sky-600 dark:text-sky-400'
                  }`}
                />
                {bookmarked[currentIdx]
                  ? `Q.${currentIdx + 1} Bookmarked for Review`
                  : `Bookmark Q.${currentIdx + 1} for Review`}
              </span>
              <span className="px-2 py-0.5 rounded-md bg-white/80 dark:bg-slate-800 text-[10px] font-mono-tabular text-black dark:text-white">
                {paletteCounts.bookmarkedCount} saved
              </span>
            </button>

            {/* Status Legend */}
            <div className="grid grid-cols-2 gap-2 text-[11px] font-medium text-black dark:text-white pb-3 mb-2.5 border-b border-sky-200/80 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <span className="w-5 h-5 rounded-md bg-emerald-600 text-white flex items-center justify-center font-mono-tabular font-bold">
                  {paletteCounts.totalAnswered}
                </span>
                <span>Answered</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-5 h-5 rounded-md bg-rose-500 text-white flex items-center justify-center font-mono-tabular font-bold">
                  {paletteCounts.notAnswered}
                </span>
                <span>Not Answered</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-5 h-5 rounded-full bg-purple-600 text-white flex items-center justify-center font-mono-tabular font-bold">
                  {paletteCounts.marked + paletteCounts.answeredMarked}
                </span>
                <span>Marked Review</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-5 h-5 rounded-full bg-amber-500 text-white flex items-center justify-center font-mono-tabular font-bold">
                  {paletteCounts.bookmarkedCount}
                </span>
                <span>Bookmarked</span>
              </div>
            </div>

            {/* All vs Bookmarked Palette Filter */}
            <div className="grid grid-cols-2 gap-1.5 p-1 rounded-xl ice-glass mb-3">
              <button
                type="button"
                onClick={() => setPaletteFilter('all')}
                className={`py-1 rounded-lg text-[11px] font-bold transition ${
                  paletteFilter === 'all'
                    ? 'bg-sky-600 text-white'
                    : 'text-black dark:text-white hover:bg-white/60 dark:hover:bg-slate-800'
                }`}
              >
                All ({questions.length})
              </button>
              <button
                type="button"
                onClick={() => setPaletteFilter('bookmarked')}
                className={`py-1 rounded-lg text-[11px] font-bold flex items-center justify-center gap-1 transition ${
                  paletteFilter === 'bookmarked'
                    ? 'bg-amber-500 text-white'
                    : 'text-black dark:text-white hover:bg-white/60 dark:hover:bg-slate-800'
                }`}
              >
                <Bookmark className="w-3 h-3 fill-current" />
                Bookmarked ({paletteCounts.bookmarkedCount})
              </button>
            </div>

            {/* Question Scrollable Grid */}
            <div className="flex-1 overflow-y-auto pr-1">
              {paletteFilter === 'bookmarked' && paletteCounts.bookmarkedCount === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center p-4 text-xs text-black/75 dark:text-white/80">
                  <Bookmark className="w-6 h-6 text-amber-400 mb-1.5" />
                  No bookmarked questions yet. Use the Bookmark button above to flag questions for quick review!
                </div>
              ) : (
                <div className="grid grid-cols-5 gap-2">{memoizedPaletteButtons}</div>
              )}
            </div>

            <button
              type="button"
              onClick={() => {
                setQuestionTimes({ ...questionTimesRef.current });
                setShowConfirmSubmit(true);
              }}
              className="mt-4 w-full py-3 rounded-2xl bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold text-sm shadow-md cursor-pointer"
            >
              Submit Complete Test ✓
            </button>
          </aside>
        </div>

      {/* Mobile Sticky Bottom Navigation Bar */}
      <div className="lg:hidden fixed bottom-0 inset-x-0 z-30 ice-glass-strong border-t border-sky-200/90 dark:border-slate-800 px-2.5 py-2.5 flex flex-col gap-2">
        <div className="flex items-center justify-between gap-1.5">
          <button
            type="button"
            onClick={clearResponse}
            className="p-2 rounded-xl ice-glass text-black dark:text-white"
            title="Clear Response"
          >
            <RotateCcw className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={toggleBookmark}
            className={`p-2 rounded-xl border ${
              bookmarked[currentIdx]
                ? 'bg-amber-400 text-amber-950 border-amber-500'
                : 'ice-glass text-black dark:text-white'
            }`}
            title="Bookmark Question"
          >
            <Bookmark className="w-4 h-4 fill-current" />
          </button>

          <button
            type="button"
            disabled={currentIdx === 0}
            onClick={() => goToQuestion(currentIdx - 1)}
            className="px-2.5 py-2 rounded-xl ice-glass disabled:opacity-40 text-xs font-bold text-black dark:text-white"
          >
            Prev
          </button>

          <button
            type="button"
            onClick={saveAndNext}
            className={`flex-1 py-2 px-3 rounded-xl text-xs font-extrabold text-center ${
              currentIdx >= questions.length - 1
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'ice-glow-btn'
            }`}
          >
            {currentIdx >= questions.length - 1 ? 'Save & Submit ✓' : 'Save & Next'}
          </button>

          <button
            type="button"
            onClick={() => {
              setQuestionTimes({ ...questionTimesRef.current });
              setShowConfirmSubmit(true);
            }}
            className="px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-extrabold shadow-sm shrink-0"
          >
            Submit ✓
          </button>

          <button
            type="button"
            onClick={() => setShowMobilePalette(true)}
            className="p-2 rounded-xl ice-glass text-black dark:text-white font-mono-tabular text-xs font-bold flex items-center gap-1"
          >
            <LayoutGrid className="w-4 h-4" />
            <span>{paletteCounts.totalAnswered}/{questions.length}</span>
          </button>
        </div>
      </div>

      {/* Mobile Question Navigation Sidebar Drawer */}
      {showMobilePalette && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex justify-end lg:hidden">
          <div className="w-80 max-w-[88vw] h-full ice-glass-strong p-5 flex flex-col text-black dark:text-white">
            <div className="flex items-center justify-between pb-3 mb-3 border-b border-sky-200 dark:border-slate-700">
              <h3 className="font-bold text-black dark:text-white">Question Navigation</h3>
              <button
                onClick={() => setShowMobilePalette(false)}
                className="p-1.5 rounded-lg ice-glass text-black dark:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Mobile Sidebar Bookmark Button */}
            <button
              type="button"
              onClick={toggleBookmark}
              className={`w-full mb-3 py-2.5 px-3 rounded-xl border text-xs font-bold flex items-center justify-between transition ${
                bookmarked[currentIdx]
                  ? 'bg-amber-400 border-amber-500 text-amber-950'
                  : 'ice-glass text-black dark:text-white border-sky-200 dark:border-slate-700'
              }`}
            >
              <span className="inline-flex items-center gap-1.5">
                <Bookmark
                  className={`w-4 h-4 ${
                    bookmarked[currentIdx] ? 'fill-amber-950 text-amber-950' : 'text-sky-600 dark:text-sky-400'
                  }`}
                />
                {bookmarked[currentIdx]
                  ? `Q.${currentIdx + 1} Bookmarked`
                  : `Bookmark Q.${currentIdx + 1}`}
              </span>
              <span className="text-[10px] font-mono-tabular bg-white/80 dark:bg-slate-800 text-black dark:text-white px-2 py-0.5 rounded">
                {paletteCounts.bookmarkedCount} saved
              </span>
            </button>

            <div className="grid grid-cols-2 gap-1.5 text-xs mb-3 pb-3 border-b border-sky-200 dark:border-slate-700">
              <div>Answered: <strong className="text-emerald-600 dark:text-emerald-400">{paletteCounts.totalAnswered}</strong></div>
              <div>Not Answered: <strong>{questions.length - paletteCounts.totalAnswered}</strong></div>
              <div>Review: <strong>{paletteCounts.marked + paletteCounts.answeredMarked}</strong></div>
              <div>Bookmarked: <strong className="text-amber-600 dark:text-amber-400">{paletteCounts.bookmarkedCount}</strong></div>
            </div>

            {/* Mobile All vs Bookmarked Filter */}
            <div className="grid grid-cols-2 gap-1.5 p-1 rounded-xl ice-glass mb-3">
              <button
                type="button"
                onClick={() => setPaletteFilter('all')}
                className={`py-1 rounded-lg text-[11px] font-bold ${
                  paletteFilter === 'all' ? 'bg-sky-600 text-white' : 'text-black dark:text-white'
                }`}
              >
                All ({questions.length})
              </button>
              <button
                type="button"
                onClick={() => setPaletteFilter('bookmarked')}
                className={`py-1 rounded-lg text-[11px] font-bold flex items-center justify-center gap-1 ${
                  paletteFilter === 'bookmarked' ? 'bg-amber-500 text-white' : 'text-black dark:text-white'
                }`}
              >
                <Bookmark className="w-3 h-3 fill-current" />
                Bookmarked ({paletteCounts.bookmarkedCount})
              </button>
            </div>

            <div className="flex-1 overflow-y-auto grid grid-cols-5 gap-2 content-start">
              {memoizedPaletteButtons}
            </div>

            <button
              onClick={() => {
                setShowMobilePalette(false);
                setShowConfirmSubmit(true);
              }}
              className="mt-4 w-full py-3 rounded-xl ice-glow-btn font-bold text-sm"
            >
              Submit Test
            </button>
          </div>
        </div>
      )}

      {/* Ultra-HD Diagram & Question Image Zoom Modal */}
      {zoomedImage && (
        <div
          onClick={() => setZoomedImage(null)}
          className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex flex-col items-center justify-center p-2 sm:p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative max-w-5xl w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-3xl p-3 sm:p-5 flex flex-col gap-3 max-h-[92vh] shadow-2xl"
          >
            <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-200 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <div className="inline-flex items-center gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-xl">
                  {[1, 1.5, 2, 2.5].map((scale) => (
                    <button
                      key={scale}
                      type="button"
                      onClick={() => setZoomScale(scale)}
                      className={`px-2.5 py-1 rounded-lg text-xs font-extrabold transition ${
                        zoomScale === scale
                          ? 'bg-blue-600 text-white'
                          : 'text-black dark:text-white hover:bg-slate-200 dark:hover:bg-slate-700'
                      }`}
                    >
                      {scale}x
                    </button>
                  ))}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setZoomedImage(null)}
                className="px-3.5 py-1.5 rounded-xl bg-rose-600 text-white text-xs font-extrabold flex items-center gap-1"
              >
                <X className="w-4 h-4" /> Close
              </button>
            </div>

            <div className="flex-1 overflow-auto rounded-2xl bg-white p-3 border border-slate-200">
              <img
                src={zoomedImage}
                alt="Ultra HD Question View"
                style={{
                  width: `${Math.round(zoomScale * 100)}%`,
                  maxWidth: 'none',
                }}
                className="ultra-hd-img h-auto mx-auto block rounded-lg"
                decoding="sync"
              />
            </div>
          </div>
        </div>
      )}

      {/* Exit Confirmation Modal (Prevents Accidental Back/Exit Cutoffs Mid-Test) */}
      {showConfirmExit && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="max-w-md w-full ice-glass-strong rounded-3xl p-6 space-y-4 text-black dark:text-white">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-amber-100 border border-amber-300 text-amber-800 flex items-center justify-center shrink-0">
                <ShieldAlert className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-lg font-extrabold text-black dark:text-white">
                  Pause or Exit Active Test?
                </h3>
                <p className="text-xs text-black/75 dark:text-white/80">
                  आपकी प्रोग्रेस सुरक्षित है (Your answers are auto-saved).
                </p>
              </div>
            </div>

            <p className="text-sm text-black dark:text-white leading-relaxed">
              Do you want to continue taking <strong>{testMeta.title}</strong> or return to the home portal?
            </p>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowConfirmExit(false)}
                className="px-5 py-2.5 rounded-xl ice-glow-btn text-xs sm:text-sm font-extrabold"
              >
                Continue Test (टेस्ट जारी रखें)
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowConfirmExit(false);
                  onExit();
                }}
                className="px-4 py-2.5 rounded-xl ice-glass text-black dark:text-white text-xs sm:text-sm font-bold hover:bg-rose-50 hover:text-rose-700"
              >
                Exit to Home
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Submit Confirmation Modal */}
      {showConfirmSubmit && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="max-w-md w-full ice-glass-strong rounded-3xl p-6 space-y-5 text-black dark:text-white">
            <h3 className="text-xl font-bold text-black dark:text-white">Submit Test?</h3>
            <p className="text-sm text-black/80 dark:text-white/85">
              Please review your attempt summary before final submission:
            </p>

            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="ice-glass rounded-xl p-3">
                <div className="text-xs text-black/70 dark:text-white/75">Answered</div>
                <div className="text-lg font-bold text-emerald-600 dark:text-emerald-400 font-mono-tabular">
                  {paletteCounts.answered + paletteCounts.answeredMarked}
                </div>
              </div>
              <div className="ice-glass rounded-xl p-3">
                <div className="text-xs text-black/70 dark:text-white/75">Unattempted</div>
                <div className="text-lg font-bold text-black dark:text-white font-mono-tabular">
                  {questions.length - (paletteCounts.answered + paletteCounts.answeredMarked)}
                </div>
              </div>
              <div className="ice-glass rounded-xl p-3">
                <div className="text-xs text-black/70 dark:text-white/75">Marked for Review</div>
                <div className="text-lg font-bold text-purple-600 dark:text-purple-400 font-mono-tabular">
                  {paletteCounts.marked + paletteCounts.answeredMarked}
                </div>
              </div>
              <div className="ice-glass rounded-xl p-3">
                <div className="text-xs text-black/70 dark:text-white/75">Time Remaining</div>
                <div className="text-lg font-bold text-sky-700 dark:text-sky-300 font-mono-tabular">
                  {formatTime(remainingSecondsRef.current)}
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                onClick={() => setShowConfirmSubmit(false)}
                className="px-4 py-2.5 rounded-xl ice-glass text-black dark:text-white text-sm font-semibold"
              >
                Resume Exam
              </button>
              <button
                onClick={handleFinalizeSubmit}
                className="px-5 py-2.5 rounded-xl ice-glow-btn text-sm font-bold"
              >
                Confirm &amp; View Result
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
