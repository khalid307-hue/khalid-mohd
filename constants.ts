
import { CourseDay } from './types';

export const COURSE_30_DAYS: CourseDay[] = [
  { day: 1, title: "Introduction", hindi: "मेरा नाम राहुल है।", english: "My name is Rahul.", tip: "Use 'My name is' for basic self-introduction." },
  { day: 2, title: "Present Tense", hindi: "मैं स्कूल जाता हूँ।", english: "I go to school.", tip: "Use simple present for daily habits." },
  { day: 3, title: "Present Continuous", hindi: "मैं खाना खा रहा हूँ।", english: "I am eating food.", tip: "Use 'am/is/are + verb-ing' for ongoing actions." },
  { day: 4, title: "Past Tense", hindi: "मैं कल बाज़ार गया।", english: "I went to the market yesterday.", tip: "Use the second form of the verb for finished actions." },
  { day: 5, title: "Future Tense", hindi: "मैं कल आऊंगा।", english: "I will come tomorrow.", tip: "Use 'will' for future promises or plans." },
  { day: 6, title: "Daily Routine", hindi: "मैं सुबह जल्दी उठता हूँ।", english: "I wake up early in the morning.", tip: "Use simple present for routines." },
  { day: 7, title: "Family", hindi: "मेरे परिवार में पांच लोग हैं।", english: "There are five people in my family.", tip: "Use 'There are' to describe quantities." },
];

export const SYSTEM_PROMPTS = {
  chat: "You are a friendly English tutor. Engage in casual conversation. Correct mistakes gently.",
  correct: "You are an expert English editor. Analyze the user's input. Identify grammatical errors, spelling mistakes, and awkward phrasing. Provide a perfectly corrected version and a simple, encouraging explanation of the changes made.",
  translate: "Translate the user's input to clear, natural English. Explain any idiomatic differences.",
  ielts: "Act as an IELTS speaking examiner. Conduct a Mock Test Part 1, 2, or 3. Provide feedback after each answer.",
  exam: "Conduct a formal English proficiency speaking exam. Evaluate Fluency, Vocabulary, Grammar, and Pronunciation."
};
