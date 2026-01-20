
import { GoogleGenAI, Type } from "@google/genai";
import { LearningMode } from './types';
import { SYSTEM_PROMPTS } from './constants';

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || '' });

export async function generateTutorResponse(mode: LearningMode, text: string) {
  const modelName = mode === LearningMode.EXAM || mode === LearningMode.IELTS 
    ? 'gemini-3-pro-preview' 
    : 'gemini-3-flash-preview';

  const systemInstruction = SYSTEM_PROMPTS[mode as keyof typeof SYSTEM_PROMPTS] || SYSTEM_PROMPTS.chat;

  try {
    if (mode === LearningMode.CORRECT) {
      const response = await ai.models.generateContent({
        model: modelName,
        contents: text,
        config: {
          systemInstruction: systemInstruction + " ALWAYS return the result strictly as a JSON object with 'correctedText' and 'explanation' keys. Do not include markdown code blocks.",
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              correctedText: { type: Type.STRING, description: "The perfectly polished and grammatically correct version of the sentence." },
              explanation: { type: Type.STRING, description: "A simple, friendly grammatical explanation of the core mistake and fix." }
            },
            required: ["correctedText", "explanation"]
          }
        },
      });
      return response.text;
    }

    const response = await ai.models.generateContent({
      model: modelName,
      contents: text,
      config: {
        systemInstruction,
        temperature: 0.7,
      },
    });

    return response.text || "I'm sorry, I couldn't process that. Please try again.";
  } catch (error) {
    console.error("Gemini API Error:", error);
    return JSON.stringify({ error: "Error communicating with AI. Check your connection." });
  }
}

export async function getPronunciationScore(text: string) {
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: `Evaluate the English pronunciation clarity for this text (simulation): "${text}". Provide a score from 1 to 10 and 2 bullet points for improvement.`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            score: { type: Type.NUMBER },
            feedback: { type: Type.ARRAY, items: { type: Type.STRING } }
          },
          required: ["score", "feedback"]
        }
      }
    });
    return JSON.parse(response.text);
  } catch (error) {
    return { score: 0, feedback: ["Unable to analyze at this moment."] };
  }
}
