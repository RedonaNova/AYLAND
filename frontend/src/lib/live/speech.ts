// Browser speech for the English side of the interpreter (D4): Anir and tsuurAI are Mongolian only.

import type { Lang } from "../types";

const LOCALE: Record<Lang, string> = { mn: "mn-MN", en: "en-US" };

/** Speaks with a matching browser voice, if the system has one. */
export function speakInBrowser(text: string, lang: Lang): void {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  const voice = window.speechSynthesis.getVoices().find((v) => v.lang.toLowerCase().startsWith(lang));
  if (!voice) return;
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.voice = voice;
  utterance.lang = voice.lang;
  utterance.rate = 0.95;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);
}

export async function playAudio(blob: Blob): Promise<void> {
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  audio.addEventListener("ended", () => URL.revokeObjectURL(url), { once: true });
  await audio.play();
}

// The Web Speech recognition API is not in TypeScript's DOM types yet; this is the part we use.
interface RecognitionResult {
  readonly isFinal: boolean;
  readonly 0: { readonly transcript: string };
}
interface Recognition {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((event: { results: ArrayLike<RecognitionResult> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}
type RecognitionCtor = new () => Recognition;

function recognitionCtor(): RecognitionCtor | undefined {
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

export function canRecognize(): boolean {
  return typeof window !== "undefined" && recognitionCtor() !== undefined;
}

export interface Listening {
  /** Resolves with the final transcript when speech ends (or `stop()` is called). */
  result: Promise<string>;
  stop(): void;
}

/** Browser speech recognition with live partial transcripts. */
export function recognize(lang: Lang, onPartial: (text: string) => void): Listening {
  const Ctor = recognitionCtor();
  if (!Ctor) throw new Error("Speech recognition is not available in this browser");
  const recognition = new Ctor();
  recognition.lang = LOCALE[lang];
  recognition.interimResults = true;
  recognition.continuous = false;
  let transcript = "";
  const result = new Promise<string>((resolve, reject) => {
    recognition.onresult = (event) => {
      transcript = Array.from(event.results, (r) => r[0].transcript).join(" ").trim();
      onPartial(transcript);
    };
    recognition.onerror = (event) => {
      if (event.error === "no-speech") resolve("");
      else reject(new Error(event.error));
    };
    recognition.onend = () => resolve(transcript);
  });
  recognition.start();
  return { result, stop: () => recognition.stop() };
}
