
export enum LearningMode {
  CHAT = 'chat',
  CORRECT = 'correct',
  TRANSLATE = 'translate',
  HINDI_ENGLISH = 'hindi-english',
  IELTS = 'ielts',
  PRONUNCIATION = 'pronunciation',
  EXAM = 'exam',
  COURSE = 'course'
}

export type TutorId = 'khalid' | 'umar' | 'gazala';

export interface TutorConfig {
  id: TutorId;
  name: string;
  voice: string;
  role: string;
  instruction: string;
  avatar: string;
}

export interface Message {
  role: 'user' | 'model';
  text: string;
  timestamp: string;
}

export interface HistoryItem {
  mode: LearningMode;
  score?: number;
  timestamp: string;
  synced: boolean;
}

export interface UserProgress {
  totalAttempts: number;
  currentDay: number;
  scores: number[];
  history: HistoryItem[];
}

export interface CourseDay {
  day: number;
  title: string;
  hindi: string;
  english: string;
  tip: string;
}
