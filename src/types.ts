export type TestDifficulty = 'Easy' | 'Medium' | 'Hard';

export interface CbtOption {
  id: string;
  text: string;
}

export interface CbtTableData {
  headers?: string[];
  rows?: string[][];
  headersHi?: string[];
  headersEn?: string[];
  rowsHi?: string[][];
  rowsEn?: string[][];
}

export interface CbtQuestion {
  id: number;
  chapter: string;
  questionHi: string;
  questionEn: string;
  optionsHi: CbtOption[];
  optionsEn: CbtOption[];
  correctAnswer: string;
  alsoCorrect?: string;
  explanation?: {
    hi?: string;
    en?: string;
  };
  hasImage?: boolean;
  imageUrl?: string | null;
  imageUrls?: string[];
  imageHi?: string;
  imageEn?: string;
  hasTable?: boolean;
  tableData?: CbtTableData;
}

export interface TestFolder {
  id: string;
  name: string;
  description?: string;
  subject?: string;
  bannerUrl?: string;
  attachmentPdfId?: string;
  attachmentPdfName?: string;
  createdAt: number;
}

export interface CbtTestMeta {
  id: string;
  title: string;
  subTitle: string;
  chapter: string;
  subject: string;
  difficulty?: TestDifficulty;
  folderId?: string;
  folderName?: string;
  bannerUrl?: string;
  totalQuestions: number;
  maxMarks: number;
  correctMarks: number;
  negativeMarks: number;
  durationMinutes: number;
  openCount: number;
  playCount: number;
  completionCount: number;
  totalScoreSum?: number;
  highScore?: number;
  isBuiltIn?: boolean;
  assetUrl?: string;
  chunkCount?: number;
  htmlChunkCount?: number;
  scheduledAt?: number;
  isPinned?: boolean;
  pinnedAt?: number;
  attachmentPdfId?: string;
  attachmentPdfName?: string;
  isPdfOnly?: boolean;
  createdAt: number;
  lastPlayedAt?: number;
}

export interface GlobalAttachmentPdf {
  id: string;
  name: string;
  updatedAt: number;
}

export interface PortalNotification {
  id: string;
  title: string;
  message: string;
  targetBatch?: string;
  testId?: string;
  testTitle?: string;
  createdAt: number;
}

export interface StudentAccount {
  id: string;
  fullName: string;
  emailOrRoll: string;
  phone?: string;
  photoUrl?: string;
  passwordHash: string;
  passwordPlain?: string;
  securityQuestion?: string;
  securityAnswer?: string;
  targetBatch: string;
  city?: string;
  loginCount?: number;
  dailyStreak?: number;
  lastStreakDate?: string;
  bookmarkedQuestionIds?: string[];
  createdAt: number;
  lastLoginAt: number;
  lastOnlineAt?: number;
  activeTestId?: string;
  activeTestTitle?: string;
  activeTestStartedAt?: number;
  lastScore?: number;
  lastMaxMarks?: number;
  lastTestTitle?: string;
  lastTestCompletedAt?: number;
}

export interface TestAttempt {
  id?: string;
  testId: string;
  testTitle: string;
  studentId?: string;
  studentEmail?: string;
  studentName: string;
  studentBatch?: string;
  score: number;
  maxMarks: number;
  correctCount: number;
  wrongCount: number;
  unattemptedCount: number;
  accuracy: number;
  timeTakenSeconds: number;
  completedAt: number;
  answers?: Record<number, string>;
  questionTimes?: Record<number, number>;
  bookmarked?: Record<number, boolean>;
}

export interface WeakLinkRescuePlan {
  diagnosisHi: string;
  diagnosisEn: string;
  weakChapters: string[];
  priorityTopics: string[];
  rescueCapsules: {
    chapter: string;
    conceptHi: string;
    conceptEn: string;
    ncertTrick: string;
  }[];
  practiceMcqs: {
    chapter: string;
    questionHi: string;
    questionEn: string;
    options: string[];
    correctOption: string;
    explanationHi: string;
    explanationEn: string;
  }[];
}

export interface MistakeNotebookItem {
  uid: string; // `${testId}_q_${question.id}`
  testId: string;
  testTitle: string;
  subject: string;
  question: CbtQuestion;
  chosenAnswer?: string;
  reason: 'wrong' | 'bookmarked' | 'both';
  savedAt: number;
}

export interface UnfinishedTestSummary {
  testId: string;
  testTitle: string;
  subject: string;
  answeredCount: number;
  totalQuestions: number;
  remainingSeconds: number;
  updatedAt: number;
}

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  };
}
