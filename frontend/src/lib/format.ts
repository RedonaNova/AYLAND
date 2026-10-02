import type { Money, PlanItemStatus, Trip, TripDay, TripView } from "./types";

export function usd(amount: number, decimals = 0): string {
  return `$${amount.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`;
}

/** Group total of a price, given how many people are in the party. */
export function groupAmount(money: Money, partySize: number): number {
  return money.per === "person" ? money.amount * partySize : money.amount;
}

/** "HH:MM" straight from an ISO string with offset, so the viewer's own timezone never shifts it. */
export function hhmm(iso: string): string {
  return iso.slice(11, 16);
}

export function minutesOf(iso: string): number {
  return Number(iso.slice(11, 13)) * 60 + Number(iso.slice(14, 16));
}

/** Shifts an "HH:MM" time by some minutes: addMinutes("14:00", 50) → "14:50". */
export function addMinutes(time: string, minutes: number): string {
  const total = Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5)) + minutes;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

const WEEKDAYS_MN = ["Ням", "Даваа", "Мягмар", "Лхагва", "Пүрэв", "Баасан", "Бямба"];

/** "Лхагва, 9 сарын 30" */
export function dateMn(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  return `${WEEKDAYS_MN[d.getUTCDay()]}, ${d.getUTCMonth() + 1} сарын ${d.getUTCDate()}`;
}

export function dayOf(trip: Trip, date: string): TripDay | undefined {
  return trip.days.find((d) => d.date === date);
}

export interface DayBudget {
  limit: number;
  spent: number;
  booked: number;
  planned: number;
  remaining: number;
}

const cents = (amount: number) => Math.round(amount * 100) / 100;

/**
 * Today's money: done items count as spent, booked items as committed,
 * planned items as expected. Remaining is what is free to spend.
 * The same formula as the backend's budget service (backend/ayland/budget.py `day`), rounding included.
 */
export function dayBudget(trip: Trip, date: string): DayBudget {
  const items = dayOf(trip, date)?.items ?? [];
  const sum = (status: PlanItemStatus) =>
    cents(
      items
        .filter((i) => i.status === status)
        .reduce((total, i) => total + groupAmount(i.cost, trip.party_size), 0),
    );
  const spent = sum("done");
  const booked = sum("booked");
  const planned = sum("planned");
  const limit = trip.budget.daily_limit;
  return { limit, spent, booked, planned, remaining: cents(limit - spent - booked - planned) };
}

/** Mongolian attributive numerals for small counts ("хоёр гадаа хөтөлбөр"). */
export function countMn(n: number): string {
  return ["тэг", "нэг", "хоёр", "гурван", "дөрвөн", "таван"][n] ?? String(n);
}

/** 1-based day of the trip that the trip's "now" falls on. */
export function tripDay(view: TripView): number {
  return view.trip.days.findIndex((d) => d.date === view.now.slice(0, 10)) + 1;
}
