
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality, Blob } from '@google/genai';
import { LearningMode, Message, UserProgress, TutorConfig, TutorId, HistoryItem } from './types';
import { COURSE_30_DAYS } from './constants';
import { generateTutorResponse, getPronunciationScore } from './geminiService';
import { 
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer 
} from 'recharts';

const TUTORS: Record<TutorId, TutorConfig> = {
  khalid: {
    id: 'khalid',
    name: 'Mohd Khalid',
    voice: 'Fenrir',
    role: 'Expert Linguist',
    instruction: "You are Mohd Khalid, a distinguished English linguist. You speak with authority, wisdom, and a deep male voice. Your sentences are perfectly structured. When correcting the user, be precise and explain the historical or logical reason behind the grammar rule. You are formal yet very patient and encouraging.",
    avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=Khalid&backgroundColor=b6e3f4"
  },
  umar: {
    id: 'umar',
    name: 'Mohd Umar',
    voice: 'Puck',
    role: 'Junior Buddy',
    instruction: "You are Mohd Umar, a curious 5-year-old boy. You speak simply and with high energy. You use words like 'Wow!', 'Cool!', and 'Can you teach me?'. Your English is simple but enthusiastic. When the user speaks to you, act like a playful little brother who is also trying to learn and have fun.",
    avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=Umar&backgroundColor=ffdfbf"
  },
  gazala: {
    id: 'gazala',
    name: 'Gazala',
    voice: 'Kore',
    role: 'Gentle Coach',
    instruction: "You are Gazala, a warm and nurturing female English coach. You speak softly and slowly. Your goal is to build the user's confidence. You focus more on situational usage and daily life. You use phrases like 'Take your time' and 'That's a great effort!'.",
    avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=Gazala&backgroundColor=ffd5dc"
  }
};

// --- Audio Helpers ---
const decode = (base64: string) => {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
};

const encode = (bytes: Uint8Array) => {
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
};

const decodeAudioData = async (data: Uint8Array, ctx: AudioContext, sampleRate: number, numChannels: number): Promise<AudioBuffer> => {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);
  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
  }
  return buffer;
};

const createBlob = (data: Float32Array): Blob => {
  const int16 = new Int16Array(data.length);
  for (let i = 0; i < data.length; i++) int16[i] = data[i] * 32768;
  return { data: encode(new Uint8Array(int16.buffer)), mimeType: 'audio/pcm;rate=16000' };
};

const App: React.FC = () => {
  const [loggedIn, setLoggedIn] = useState(false);
  const [authData, setAuthData] = useState({ email: '', password: '' });
  const [mode, setMode] = useState<LearningMode>(LearningMode.CHAT);
  const [selectedTutor, setSelectedTutor] = useState<TutorId>('khalid');
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [isLive, setIsLive] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'success' | 'error'>('idle');
  const [correctionResult, setCorrectionResult] = useState<{ original: string, correctedText: string, explanation: string } | null>(null);
  const [progress, setProgress] = useState<UserProgress>({
    totalAttempts: 0,
    currentDay: 1,
    scores: [],
    history: []
  });

  const chatEndRef = useRef<HTMLDivElement>(null);
  const audioContextInRef = useRef<AudioContext | null>(null);
  const audioContextOutRef = useRef<AudioContext | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const activeSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const liveSessionRef = useRef<any>(null);
  const currentTranscriptionRef = useRef({ input: '', output: '' });

  const unsyncedCount = useMemo(() => progress.history.filter(h => !h.synced).length, [progress.history]);

  useEffect(() => {
    const saved = localStorage.getItem('khalidai_progress');
    if (saved) {
      const parsed = JSON.parse(saved);
      if (parsed.history) parsed.history = parsed.history.map((h: any) => ({ ...h, synced: h.synced ?? true }));
      setProgress(parsed);
    } else {
      // Show guide for first-time users
      setShowGuide(true);
    }
  }, []);

  useEffect(() => { localStorage.setItem('khalidai_progress', JSON.stringify(progress)); }, [progress]);
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const syncData = async () => {
    if (unsyncedCount === 0 || syncStatus === 'syncing') return;
    setSyncStatus('syncing');
    try {
      await new Promise(r => setTimeout(r, 1500));
      setProgress(prev => ({ ...prev, history: prev.history.map(h => ({ ...h, synced: true })) }));
      setSyncStatus('success');
      setTimeout(() => setSyncStatus('idle'), 3000);
    } catch (e) {
      setSyncStatus('error');
      setTimeout(() => setSyncStatus('idle'), 3000);
    }
  };

  const handleLogin = () => { if (authData.email && authData.password) setLoggedIn(true); };

  const stopLiveSession = useCallback(() => {
    if (liveSessionRef.current) { liveSessionRef.current.close?.(); liveSessionRef.current = null; }
    activeSourcesRef.current.forEach(s => s.stop());
    activeSourcesRef.current.clear();
    setIsLive(false);
    if (audioContextInRef.current) audioContextInRef.current.close();
    if (audioContextOutRef.current) audioContextOutRef.current.close();
  }, []);

  const startLiveSession = async () => {
    try {
      setLoading(true);
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || '' });
      const inCtx = new AudioContext({ sampleRate: 16000 });
      const outCtx = new AudioContext({ sampleRate: 24000 });
      audioContextInRef.current = inCtx; audioContextOutRef.current = outCtx; nextStartTimeRef.current = 0;
      const tutor = TUTORS[selectedTutor];
      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        callbacks: {
          onopen: () => {
            const source = inCtx.createMediaStreamSource(stream);
            const proc = inCtx.createScriptProcessor(4096, 1, 1);
            proc.onaudioprocess = (e) => {
              const inputData = e.inputBuffer.getChannelData(0);
              sessionPromise.then(s => s.sendRealtimeInput({ media: createBlob(inputData) }));
            };
            source.connect(proc); proc.connect(inCtx.destination);
            setIsLive(true); setLoading(false);
          },
          onmessage: async (message: LiveServerMessage) => {
            if (message.serverContent?.inputTranscription) currentTranscriptionRef.current.input += message.serverContent.inputTranscription.text;
            if (message.serverContent?.outputTranscription) currentTranscriptionRef.current.output += message.serverContent.outputTranscription.text;
            if (message.serverContent?.turnComplete) {
              const { input, output } = currentTranscriptionRef.current;
              if (input || output) setMessages(prev => [...prev, { role: 'user', text: input, timestamp: new Date().toLocaleTimeString() }, { role: 'model', text: output, timestamp: new Date().toLocaleTimeString() }]);
              currentTranscriptionRef.current = { input: '', output: '' };
            }
            const b64 = message.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
            if (b64) {
              const buf = await decodeAudioData(decode(b64), outCtx, 24000, 1);
              const src = outCtx.createBufferSource(); src.buffer = buf; src.connect(outCtx.destination);
              nextStartTimeRef.current = Math.max(nextStartTimeRef.current, outCtx.currentTime);
              src.start(nextStartTimeRef.current); nextStartTimeRef.current += buf.duration;
              activeSourcesRef.current.add(src); src.onended = () => activeSourcesRef.current.delete(src);
            }
          },
          onerror: (e) => stopLiveSession(),
          onclose: () => stopLiveSession(),
        },
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: tutor.voice as any } } },
          inputAudioTranscription: {}, outputAudioTranscription: {},
          systemInstruction: tutor.instruction
        }
      });
      liveSessionRef.current = await sessionPromise;
    } catch (err) { setLoading(false); alert("Microphone access is required for voice sessions."); }
  };

  const handleSend = async () => {
    if (!input.trim() || loading || isLive) return;
    const tutor = TUTORS[selectedTutor];
    setLoading(true);
    let aiResponseText = "";
    let score = 0;

    if (mode === LearningMode.CORRECT) {
      const res = await generateTutorResponse(mode, `[Tutor: ${tutor.name}] Sentence: "${input}"`);
      try {
        const parsed = JSON.parse(res);
        setCorrectionResult({ original: input, ...parsed });
      } catch (e) { alert("Could not analyze sentence. Please try again."); }
    } else if (mode === LearningMode.PRONUNCIATION) {
      const res = await getPronunciationScore(input);
      aiResponseText = `Score: ${res.score}/10\n\nFeedback:\n${res.feedback.map((f: string) => `• ${f}`).join('\n')}`;
      score = res.score;
      setMessages(prev => [...prev, { role: 'user', text: input, timestamp: new Date().toLocaleTimeString() }, { role: 'model', text: aiResponseText, timestamp: new Date().toLocaleTimeString() }]);
    } else {
      aiResponseText = await generateTutorResponse(mode, `[Tutor: ${tutor.name}] ${input}`);
      setMessages(prev => [...prev, { role: 'user', text: input, timestamp: new Date().toLocaleTimeString() }, { role: 'model', text: aiResponseText, timestamp: new Date().toLocaleTimeString() }]);
    }

    if (mode !== LearningMode.CORRECT) setInput('');
    setLoading(false);
    setProgress(prev => ({
      ...prev, totalAttempts: prev.totalAttempts + 1,
      scores: score > 0 ? [...prev.scores, score] : prev.scores,
      history: [...prev.history, { mode, score: score > 0 ? score : undefined, timestamp: new Date().toISOString(), synced: navigator.onLine }]
    }));
  };

  const tutor = TUTORS[selectedTutor];

  if (!loggedIn) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-indigo-700 to-blue-900 p-6">
        <div className="bg-white p-10 rounded-3xl shadow-2xl w-full max-w-md transform transition-all">
          <div className="text-center mb-10">
            <div className="bg-indigo-100 w-24 h-24 rounded-3xl flex items-center justify-center mx-auto mb-6 shadow-inner">
              <i className="fa-solid fa-microphone-lines text-5xl text-indigo-600"></i>
            </div>
            <h1 className="text-4xl font-black text-gray-900 tracking-tight">KhalidAI</h1>
            <p className="text-gray-500 font-medium mt-2">Next-Gen Spoken English Mastery</p>
          </div>
          <div className="space-y-4">
            <input type="email" placeholder="Email Address" className="w-full px-5 py-4 rounded-2xl border-2 border-gray-100 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-50/50 outline-none transition-all" onChange={e => setAuthData({...authData, email: e.target.value})} />
            <input type="password" placeholder="Password" className="w-full px-5 py-4 rounded-2xl border-2 border-gray-100 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-50/50 outline-none transition-all" onChange={e => setAuthData({...authData, password: e.target.value})} />
            <button onClick={handleLogin} className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-black py-5 rounded-2xl shadow-xl shadow-indigo-200 transition-all transform active:scale-95">Start Learning</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#fcfdfe] flex flex-col md:flex-row">
      {/* Help Modal */}
      {showGuide && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-black/60 backdrop-blur-sm animate-[fadeIn_0.3s_ease-out]">
          <div className="bg-white w-full max-w-2xl rounded-[40px] shadow-2xl overflow-hidden flex flex-col">
            <div className="bg-indigo-600 p-10 text-white">
              <h2 className="text-3xl font-black mb-2">Welcome to KhalidAI! 🚀</h2>
              <p className="text-indigo-100 font-medium">Follow these simple steps to start your English journey:</p>
            </div>
            <div className="p-10 space-y-6 flex-1 overflow-y-auto max-h-[60vh] scrollbar-hide">
              <div className="flex gap-6">
                <div className="w-12 h-12 rounded-2xl bg-indigo-50 flex items-center justify-center text-indigo-600 font-black shrink-0">1</div>
                <div>
                  <h4 className="font-black text-gray-900">Choose a Tutor</h4>
                  <p className="text-gray-500 text-sm">Select Khalid (Formal), Umar (Child/Fun), or Gazala (Friendly) from the sidebar.</p>
                </div>
              </div>
              <div className="flex gap-6">
                <div className="w-12 h-12 rounded-2xl bg-indigo-50 flex items-center justify-center text-indigo-600 font-black shrink-0">2</div>
                <div>
                  <h4 className="font-black text-gray-900">Select Mode</h4>
                  <p className="text-gray-500 text-sm">Use 'Conversation' for talking, or 'Correct My English' to check specific sentences.</p>
                </div>
              </div>
              <div className="flex gap-6">
                <div className="w-12 h-12 rounded-2xl bg-indigo-50 flex items-center justify-center text-indigo-600 font-black shrink-0">3</div>
                <div>
                  <h4 className="font-black text-gray-900">Start Talking</h4>
                  <p className="text-gray-500 text-sm">In Conversation mode, click the <b>Microphone icon</b> to start a real-time voice call.</p>
                </div>
              </div>
              <div className="flex gap-6">
                <div className="w-12 h-12 rounded-2xl bg-indigo-50 flex items-center justify-center text-indigo-600 font-black shrink-0">4</div>
                <div>
                  <h4 className="font-black text-gray-900">Daily Path</h4>
                  <p className="text-gray-500 text-sm">Try the '30-Day Course' for a structured learning routine.</p>
                </div>
              </div>
            </div>
            <div className="p-10 bg-gray-50 flex justify-end">
              <button onClick={() => setShowGuide(false)} className="bg-indigo-600 text-white px-10 py-4 rounded-2xl font-black shadow-lg shadow-indigo-100 transform transition-all active:scale-95">
                Got it, let's go!
              </button>
            </div>
          </div>
        </div>
      )}

      <aside className="w-full md:w-80 bg-white border-r border-gray-100 p-8 flex-shrink-0 flex flex-col shadow-sm">
        <div className="flex items-center gap-4 mb-10">
          <div className="bg-indigo-600 p-3 rounded-2xl shadow-lg shadow-indigo-100">
            <i className="fa-solid fa-brain text-white text-2xl"></i>
          </div>
          <h1 className="text-3xl font-black text-gray-900 tracking-tighter uppercase">KhalidAI</h1>
        </div>

        <button onClick={() => setShowGuide(true)} className="mb-6 flex items-center gap-3 w-full bg-indigo-50 text-indigo-600 font-black px-4 py-3 rounded-xl border border-indigo-100 hover:bg-indigo-100 transition-all">
          <i className="fa-solid fa-circle-question"></i> How to use?
        </button>

        <div className="mb-10 space-y-4">
          <div className="flex items-center justify-between px-2">
            <p className="text-[11px] font-black text-gray-400 uppercase tracking-widest">Active Tutor</p>
            <div className={`flex items-center gap-1.5 px-2 py-1 rounded-full text-[10px] font-bold ${navigator.onLine ? 'bg-green-50 text-green-600' : 'bg-orange-50 text-orange-600'}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${navigator.onLine ? 'bg-green-500' : 'bg-orange-500 animate-pulse'}`}></span>
              {navigator.onLine ? 'Online' : 'Offline Mode'}
            </div>
          </div>
          <div className="space-y-3">
            {(Object.values(TUTORS)).map(t => (
              <button key={t.id} onClick={() => { stopLiveSession(); setSelectedTutor(t.id); }} className={`w-full flex items-center gap-4 p-3 rounded-2xl transition-all border-2 group ${selectedTutor === t.id ? 'border-indigo-500 bg-indigo-50/50 shadow-sm' : 'border-transparent hover:bg-gray-50'}`}>
                <div className="relative">
                  <img src={t.avatar} className="w-12 h-12 rounded-2xl bg-white border-2 border-gray-100" alt={t.name} />
                  {selectedTutor === t.id && <div className="absolute -top-1 -right-1 w-4 h-4 bg-indigo-500 rounded-full border-2 border-white flex items-center justify-center text-[8px] text-white"><i className="fa-solid fa-check"></i></div>}
                </div>
                <div className="text-left">
                  <p className={`text-sm font-black ${selectedTutor === t.id ? 'text-indigo-900' : 'text-gray-800'}`}>{t.name}</p>
                  <p className="text-[10px] text-gray-500 font-bold uppercase tracking-tight">{t.role}</p>
                </div>
              </button>
            ))}
          </div>
        </div>

        <nav className="space-y-2 flex-1 overflow-y-auto scrollbar-hide">
          <p className="text-[11px] font-black text-gray-400 uppercase tracking-widest mb-4 px-2">Learning Lab</p>
          {[
            { id: LearningMode.CHAT, icon: 'fa-comments', label: 'Conversation' },
            { id: LearningMode.CORRECT, icon: 'fa-wand-magic-sparkles', label: 'Correct My English' },
            { id: LearningMode.PRONUNCIATION, icon: 'fa-waveform-lines', label: 'Speak & Score' },
            { id: LearningMode.TRANSLATE, icon: 'fa-language', label: 'Quick Translator' },
            { id: LearningMode.HINDI_ENGLISH, icon: 'fa-flag', label: 'Hindi → English' },
            { id: LearningMode.IELTS, icon: 'fa-graduation-cap', label: 'IELTS Prep' },
            { id: LearningMode.COURSE, icon: 'fa-calendar-day', label: '30-Day Path' }
          ].map(item => (
            <button key={item.id} onClick={() => { stopLiveSession(); setMode(item.id); setCorrectionResult(null); }} className={`w-full flex items-center gap-4 px-4 py-4 rounded-2xl transition-all ${mode === item.id ? 'bg-indigo-600 text-white shadow-xl shadow-indigo-100' : 'text-gray-600 hover:bg-gray-100 hover:text-indigo-600'}`}>
              <i className={`fa-solid ${item.icon} w-6 text-center text-lg`}></i>
              <span className="font-bold text-sm tracking-tight">{item.label}</span>
            </button>
          ))}
        </nav>

        {unsyncedCount > 0 && (
          <button onClick={syncData} disabled={syncStatus === 'syncing' || !navigator.onLine} className="mt-6 flex items-center justify-center gap-3 w-full bg-orange-50 text-orange-700 font-black py-4 rounded-2xl border-2 border-orange-100 hover:bg-orange-100 transition-all disabled:opacity-50">
            {syncStatus === 'syncing' ? <i className="fa-solid fa-rotate fa-spin"></i> : <i className="fa-solid fa-cloud-arrow-up"></i>}
            {syncStatus === 'syncing' ? 'Syncing...' : `Sync ${unsyncedCount} Sessions`}
          </button>
        )}
      </aside>

      <main className="flex-1 flex flex-col h-screen overflow-hidden">
        <header className="bg-white border-b border-gray-100 px-10 py-6 flex items-center justify-between">
          <div className="flex flex-col">
            <span className="text-[10px] font-black text-indigo-500 uppercase tracking-widest mb-1">Current Laboratory</span>
            <h2 className="text-xl font-black text-gray-900 flex items-center gap-3">
              {mode.toUpperCase().replace('-', ' ')}
              {isLive && <span className="flex items-center gap-1.5 px-3 py-1 bg-rose-50 text-rose-600 rounded-full text-[10px] animate-pulse"><i className="fa-solid fa-circle"></i> LIVE</span>}
            </h2>
          </div>
          <div className="flex items-center gap-6">
            <div className="text-right">
              <p className="text-xs font-black text-gray-900">Student Beta</p>
              <p className="text-[10px] text-gray-400 font-bold uppercase tracking-tighter">Day {progress.currentDay} of 30</p>
            </div>
            <div className="w-12 h-12 rounded-2xl bg-indigo-50 border-2 border-indigo-100 flex items-center justify-center text-indigo-600 font-black shadow-sm">S</div>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-8 md:p-12 space-y-10 bg-[#f8f9fd]">
          {mode === LearningMode.CORRECT ? (
            <div className="max-w-4xl mx-auto w-full space-y-10">
              <div className="bg-white p-10 rounded-[40px] shadow-xl shadow-indigo-100/20 border border-gray-100">
                <div className="flex items-center gap-4 mb-8">
                  <div className="w-14 h-14 rounded-3xl bg-indigo-600 flex items-center justify-center text-white shadow-lg shadow-indigo-200">
                    <i className="fa-solid fa-spell-check text-2xl"></i>
                  </div>
                  <div>
                    <h3 className="text-2xl font-black text-gray-900 tracking-tight">Correct My English</h3>
                    <p className="text-gray-500 font-medium">{tutor.name} will analyze your grammar and explain improvements.</p>
                  </div>
                </div>
                <div className="space-y-6">
                  <textarea value={input} onChange={e => setInput(e.target.value)} placeholder="Type a sentence like: 'I has went to school'..." className="w-full h-40 p-8 bg-gray-50 border-2 border-gray-100 rounded-[32px] font-medium text-lg outline-none focus:border-indigo-500 focus:bg-white transition-all resize-none shadow-inner" />
                  <button onClick={handleSend} disabled={loading || !input.trim()} className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-black py-6 rounded-[28px] shadow-2xl shadow-indigo-200 flex items-center justify-center gap-4 transition-all transform active:scale-[0.98] disabled:opacity-50">
                    {loading ? <i className="fa-solid fa-spinner fa-spin text-xl"></i> : <i className="fa-solid fa-bolt-lightning text-xl"></i>}
                    Analyze Grammar
                  </button>
                </div>
              </div>

              {correctionResult && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 animate-[fadeIn_0.5s_ease-out]">
                  <div className="bg-white p-10 rounded-[40px] border-2 border-green-100 shadow-xl shadow-green-100/20">
                    <p className="text-[11px] font-black text-green-600 uppercase tracking-widest mb-6 flex items-center gap-2">
                      <i className="fa-solid fa-sparkles"></i> Polished Version
                    </p>
                    <p className="text-2xl font-black text-gray-800 leading-relaxed italic mb-8">"{correctionResult.correctedText}"</p>
                    <div className="flex gap-4">
                      <button onClick={() => {
                        const ut = new SpeechSynthesisUtterance(correctionResult.correctedText);
                        ut.lang = 'en-US'; window.speechSynthesis.speak(ut);
                      }} className="flex-1 bg-green-600 text-white font-black py-4 rounded-2xl hover:bg-green-700 shadow-lg shadow-green-100 transition-all flex items-center justify-center gap-3">
                        <i className="fa-solid fa-volume-high"></i> Listen
                      </button>
                    </div>
                  </div>
                  <div className="bg-indigo-900 p-10 rounded-[40px] text-white shadow-2xl shadow-indigo-900/20 flex flex-col">
                    <div className="flex items-center gap-4 mb-6">
                      <img src={tutor.avatar} className="w-10 h-10 rounded-full border-2 border-indigo-400" alt="Tutor" />
                      <p className="text-[11px] font-black text-indigo-200 uppercase tracking-widest">Grammar Insight</p>
                    </div>
                    <p className="text-lg font-medium leading-relaxed flex-1">{correctionResult.explanation}</p>
                    <div className="mt-10 pt-6 border-t border-indigo-800 text-[10px] font-bold text-indigo-400 uppercase tracking-widest flex items-center justify-between">
                      <span>Explanation by {tutor.name}</span>
                      <i className="fa-solid fa-lightbulb text-amber-400"></i>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="max-w-5xl mx-auto w-full space-y-10 h-full flex flex-col">
              <div className="bg-white rounded-[48px] shadow-2xl shadow-indigo-100/20 border border-gray-100 flex flex-col flex-1 relative overflow-hidden min-h-[60vh]">
                {isLive && (
                  <div className="absolute inset-0 bg-indigo-950/90 flex flex-col items-center justify-center z-50 animate-[fadeIn_0.3s_ease-out]">
                    <div className="flex items-center gap-6 mb-12 h-24">
                      {[1, 2, 3, 4, 5, 6, 7, 8].map(i => (
                        <div key={i} className="w-3 bg-indigo-400 rounded-full animate-pulse" style={{ height: `${20 + Math.random() * 80}%`, animationDelay: `${i * 0.1}s` }}></div>
                      ))}
                    </div>
                    <div className="text-center">
                      <img src={tutor.avatar} className="w-24 h-24 rounded-[32px] mx-auto mb-6 border-4 border-indigo-500 shadow-2xl" alt="Tutor" />
                      <h4 className="text-2xl font-black text-white tracking-tight">Speaking with {tutor.name}</h4>
                      <p className="text-indigo-300 font-bold mt-2 uppercase tracking-widest text-xs">Live Voice Processing Active</p>
                    </div>
                    <button onClick={stopLiveSession} className="mt-16 bg-rose-600 hover:bg-rose-700 text-white font-black px-12 py-5 rounded-2xl shadow-2xl shadow-rose-900/20 transition-all transform active:scale-95 flex items-center gap-4">
                      <i className="fa-solid fa-phone-slash text-xl"></i>
                      END CALL
                    </button>
                  </div>
                )}

                <div className="flex-1 overflow-y-auto p-12 space-y-8 scrollbar-hide">
                  {messages.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-center py-20">
                      <div className="w-32 h-32 rounded-[40px] bg-gray-50 flex items-center justify-center mb-8 border-2 border-dashed border-gray-200">
                        <i className="fa-solid fa-comments text-4xl text-gray-200"></i>
                      </div>
                      <h4 className="text-xl font-black text-gray-900">Your session with {tutor.name}</h4>
                      <p className="max-w-xs font-medium text-gray-400 mt-2">Start a real-time voice conversation or type a message below to begin.</p>
                    </div>
                  ) : (
                    messages.map((msg, idx) => (
                      <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} animate-[fadeIn_0.3s_ease-out]`}>
                        <div className={`flex gap-5 max-w-[85%] ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
                          <div className={`w-12 h-12 rounded-2xl flex-shrink-0 flex items-center justify-center shadow-sm ${msg.role === 'user' ? 'bg-indigo-600 text-white' : 'bg-gray-100'}`}>
                            {msg.role === 'model' ? <img src={tutor.avatar} className="rounded-2xl" /> : <i className="fa-solid fa-user-astronaut"></i>}
                          </div>
                          <div className={`rounded-3xl px-8 py-5 shadow-sm border ${msg.role === 'user' ? 'bg-indigo-600 text-white border-indigo-500 rounded-tr-none' : 'bg-white text-gray-800 border-gray-100 rounded-tl-none'}`}>
                            <p className="text-[17px] font-medium leading-relaxed whitespace-pre-wrap tracking-tight">{msg.text}</p>
                            <span className="text-[9px] font-black uppercase tracking-widest opacity-40 mt-3 block">{msg.timestamp}</span>
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                  <div ref={chatEndRef} />
                </div>

                <div className="p-8 border-t border-gray-50 bg-white">
                  <div className="flex items-center gap-4 bg-gray-50 p-3 rounded-[32px] border-2 border-gray-100 shadow-inner">
                    {mode === LearningMode.CHAT && (
                      <button onClick={isLive ? stopLiveSession : startLiveSession} disabled={loading} className="bg-indigo-600 hover:bg-indigo-700 text-white w-16 h-16 rounded-[24px] shadow-lg shadow-indigo-100 transition-all flex items-center justify-center flex-shrink-0 group transform active:scale-95">
                        {loading ? <i className="fa-solid fa-spinner fa-spin"></i> : <i className="fa-solid fa-microphone text-xl group-hover:scale-110 transition-transform"></i>}
                      </button>
                    )}
                    <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSend()} disabled={isLive || loading} placeholder={`Say something to ${tutor.name}...`} className="flex-1 bg-transparent px-6 py-4 text-gray-800 font-bold text-lg outline-none placeholder:text-gray-300 disabled:opacity-50" />
                    {!isLive && <button onClick={handleSend} disabled={loading || !input.trim()} className="bg-white text-indigo-600 w-14 h-14 rounded-[22px] shadow-lg border border-gray-100 hover:text-indigo-700 transition-all flex items-center justify-center transform active:scale-95"><i className="fa-solid fa-paper-plane"></i></button>}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
};

export default App;
