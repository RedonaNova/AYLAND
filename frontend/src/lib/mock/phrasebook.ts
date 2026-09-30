// Scripted interpreter turns for Act 4 (HANDBOOK §3). The real Interpreter Agent calls Claude.

import type { Lang } from "../types";

export interface Phrase {
  mn: string;
  vi: string;
  /** How a Mongolian speaker can read the Vietnamese aloud. */
  hint?: string;
}

export const PHRASES: Phrase[] = [
  {
    mn: "Сайн байна уу, бид 4 хүний хоол хийх ангид бүртгүүлсэн. Захиалгын код маань энэ байна.",
    vi: "Xin chào, chúng tôi đã đặt lớp nấu ăn cho 4 người. Đây là mã đặt chỗ của chúng tôi.",
    hint: "Син чао, чунг той да дат лоп нау ан чо бон нгыой.",
  },
  {
    mn: "Тавтай морил! Дотогшоо орцгооно уу. Хичээл яг 14 цагт эхэлнэ.",
    vi: "Chào mừng các bạn! Mời vào trong. Lớp học bắt đầu lúc 2 giờ chiều.",
  },
  {
    mn: "Бидний нэг нь газрын самрын харшилтай. Самаргүй хийж болох уу?",
    vi: "Một người trong nhóm chúng tôi bị dị ứng đậu phộng. Có thể nấu không có đậu phộng được không?",
  },
  {
    mn: "Болно оо, асуудалгүй. Бид газрын самар огт хэрэглэхгүй.",
    vi: "Được chứ, không vấn đề gì. Chúng tôi sẽ không dùng đậu phộng.",
  },
  {
    mn: "Маш их баярлалаа! Хоол нь үнэхээр амттай болжээ.",
    vi: "Cảm ơn rất nhiều! Món ăn thật sự rất ngon.",
    hint: "Кам он зат ньеу! Мон ан тат сы зат нгон.",
  },
];

/** Scripted lines each side "says" in the demo, in order. */
export const SCRIPT: Record<Lang, string[]> = {
  mn: [PHRASES[0].mn, PHRASES[2].mn, PHRASES[4].mn],
  vi: [PHRASES[1].vi, PHRASES[3].vi],
};

const normalize = (s: string) => s.toLowerCase().replace(/[\s.,!?]+/g, " ").trim();

export function lookup(text: string, source: Lang): Phrase | undefined {
  const needle = normalize(text);
  return PHRASES.find((p) => normalize(p[source]) === needle);
}
