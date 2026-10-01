// Scripted interpreter turns for Act 4 (HANDBOOK §3). The real Interpreter Agent uses Orchu (mn ⇄ en).

import type { Lang } from "../types";

export interface Phrase {
  mn: string;
  en: string;
  /** How a Mongolian speaker can read the English aloud. */
  hint?: string;
}

export const PHRASES: Phrase[] = [
  {
    mn: "Сайн байна уу, бид 4 хүний хоол хийх ангид бүртгүүлсэн. Захиалгын код маань энэ байна.",
    en: "Hello, we booked a cooking class for 4 people. Here is our booking code.",
    hint: "Хэлоу, ви букт э кукинг клас фор фор пийпл. Хиэр из ауэр букинг коуд.",
  },
  {
    mn: "Тавтай морил! Дотогшоо орцгооно уу. Хичээл яг 14 цагт эхэлнэ.",
    en: "Welcome! Please come in. The class starts at 2 p.m.",
  },
  {
    mn: "Бидний нэг нь газрын самрын харшилтай. Самаргүй хийж болох уу?",
    en: "One of us is allergic to peanuts. Can you make it without peanuts?",
  },
  {
    mn: "Болно оо, асуудалгүй. Бид газрын самар огт хэрэглэхгүй.",
    en: "Of course, no problem. We won't use any peanuts.",
  },
  {
    mn: "Маш их баярлалаа! Хоол нь үнэхээр амттай болжээ.",
    en: "Thank you so much! The food was delicious.",
    hint: "Сэнк ю соу мач! Зэ фүүд воз дэлишэс.",
  },
];

/** Scripted lines each side "says" in the demo, in order. */
export const SCRIPT: Record<Lang, string[]> = {
  mn: [PHRASES[0].mn, PHRASES[2].mn, PHRASES[4].mn],
  en: [PHRASES[1].en, PHRASES[3].en],
};

const normalize = (s: string) => s.toLowerCase().replace(/[\s.,!?']+/g, " ").trim();

export function lookup(text: string, source: Lang): Phrase | undefined {
  const needle = normalize(text);
  return PHRASES.find((p) => normalize(p[source]) === needle);
}
