// Demo seed (HANDBOOK M1-B2), shaped like data/seed/*.json will be.
// Dates are relative to "today" in Hanoi so the demo never goes stale; day 3 is always today.

import type { Booking, GeoPoint, Money, Offer, Place, PlanItem, Trip } from "../types";

export const TIMEZONE = "Asia/Ho_Chi_Minh";
export const DEMO_NOW = "10:30";
export const TRIP_ID = "trip_hanoi_demo";

export function hanoiToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function at(date: string, time: string): string {
  return `${date}T${time}:00+07:00`;
}

const point = (lon: number, lat: number): GeoPoint => ({ type: "Point", coordinates: [lon, lat] });
const place = (name: string, address: string, lon: number, lat: number): Place => ({
  name,
  address,
  location: point(lon, lat),
});
const perPerson = (amount: number): Money => ({ amount, currency: "USD", per: "person" });
const perGroup = (amount: number): Money => ({ amount, currency: "USD", per: "group" });

export const HOTEL = place("Phố Cổ Boutique Hotel", "32 Hàng Bạc, Hoàn Kiếm", 105.8522, 21.0341);

export const PLACES = {
  eggCoffee: place("Café Giảng", "39 Nguyễn Hữu Huân, Hoàn Kiếm", 105.8541, 21.0339),
};

type ItemSeed = Omit<PlanItem, "start" | "end" | "source"> & { from: string; to: string };

function items(date: string, seeds: ItemSeed[]): PlanItem[] {
  return seeds.map(({ from, to, ...rest }) => ({
    ...rest,
    start: at(date, from),
    end: at(date, to),
    source: "seed",
  }));
}

export function seedTrip(today: string): Trip {
  const d1 = addDays(today, -2);
  const d2 = addDays(today, -1);
  const d4 = addDays(today, 1);
  const d5 = addDays(today, 2);

  return {
    _id: TRIP_ID,
    owner_id: "user_bat",
    title: "Ханойн аялал",
    destination: { city: "Hanoi", country: "VN", timezone: TIMEZONE, location: point(105.8542, 21.0285) },
    travelers: [
      { name: "Бат", interests: ["түүх", "гэрэл зураг"] },
      { name: "Сараа", interests: ["хоол", "зах"] },
      { name: "Тэмүүлэн", interests: ["адал явдал", "спорт"] },
      { name: "Номин", interests: ["урлаг", "кофе"] },
    ],
    party_size: 4,
    budget: { currency: "USD", total: 2400, daily_limit: 200, spent: 1236 },
    hotel: HOTEL,
    version: 8,
    updated_at: at(today, "08:00"),
    days: [
      {
        date: d1,
        items: items(d1, [
          { item_id: "d1-1", from: "13:05", to: "15:10", kind: "transport", title: "Нислэг Улаанбаатар → Ханой", place: place("Nội Bài International Airport", "Sóc Sơn, Hà Nội", 105.8067, 21.2187), cost: perPerson(0), indoor: true, status: "done" },
          { item_id: "d1-2", from: "16:30", to: "17:00", kind: "stay", title: "Буудалд буух", place: HOTEL, cost: perGroup(0), indoor: true, status: "done" },
          { item_id: "d1-3", from: "19:00", to: "21:00", kind: "meal", title: "Шар айрагны гудамжинд оройн хоол", place: place("Tạ Hiện", "Tạ Hiện, Hoàn Kiếm", 105.8517, 21.035), cost: perPerson(9), indoor: false, status: "done" },
        ]),
      },
      {
        date: d2,
        items: items(d2, [
          { item_id: "d2-1", from: "09:00", to: "11:00", kind: "activity", title: "Уран зохиолын сүм", place: place("Văn Miếu – Quốc Tử Giám", "58 Quốc Tử Giám, Đống Đa", 105.8355, 21.0277), cost: perPerson(1.2), indoor: false, status: "done" },
          { item_id: "d2-2", from: "12:00", to: "13:00", kind: "meal", title: "Бань ми үдийн хоол", place: place("Bánh Mì 25", "25 Hàng Cá, Hoàn Kiếm", 105.8488, 21.0367), cost: perPerson(2.5), indoor: true, status: "done" },
          { item_id: "d2-3", from: "15:00", to: "16:30", kind: "activity", title: "Хоа Лоо шоронгийн музей", place: place("Hỏa Lò Prison", "1 Hỏa Lò, Hoàn Kiếm", 105.8465, 21.0254), cost: perPerson(1.4), indoor: true, status: "done" },
          { item_id: "d2-4", from: "19:30", to: "21:30", kind: "activity", title: "Шөнийн зах", place: place("Chợ đêm phố cổ", "Hàng Đào, Hoàn Kiếm", 105.8508, 21.0348), cost: perPerson(6), indoor: false, status: "done" },
        ]),
      },
      {
        date: today,
        items: items(today, [
          { item_id: "d3-1", from: "08:00", to: "09:00", kind: "meal", title: "Фо өглөөний цай", place: place("Phở Bát Đàn", "49 Bát Đàn, Hoàn Kiếm", 105.8468, 21.0335), cost: perPerson(4), indoor: true, status: "done" },
          { item_id: "d3-2", from: "09:15", to: "10:15", kind: "activity", title: "Хоан Кием нуураар алхах", place: place("Đền Ngọc Sơn", "Hồ Hoàn Kiếm", 105.8524, 21.0307), cost: perPerson(1), indoor: false, status: "done" },
          { item_id: "d3-3", from: "12:00", to: "13:00", kind: "meal", title: "Бун ча үдийн хоол", place: place("Bún chả Hương Liên", "24 Lê Văn Hưu, Hai Bà Trưng", 105.8526, 21.0182), cost: perPerson(3), indoor: true, status: "planned" },
          { item_id: "d3-4", from: "14:00", to: "16:00", kind: "activity", title: "Цикло аялал", place: place("Phố cổ Hà Nội", "Hàng Bạc, Hoàn Kiếm", 105.8512, 21.0355), cost: perPerson(10), indoor: false, status: "planned" },
          { item_id: "d3-5", from: "16:30", to: "18:00", kind: "activity", title: "Нар жаргах алхалт", place: place("Cầu Long Biên", "Long Biên, Hà Nội", 105.859, 21.043), cost: perGroup(0), indoor: false, status: "planned" },
          { item_id: "d3-6", from: "19:00", to: "20:30", kind: "meal", title: "Вьетнам оройн хоол", place: place("Quán Ăn Ngon", "18 Phan Bội Châu, Hoàn Kiếm", 105.8436, 21.0262), cost: perPerson(7), indoor: true, status: "planned" },
        ]),
      },
      {
        date: d4,
        items: items(d4, [
          { item_id: "d4-1", from: "07:30", to: "19:30", kind: "activity", title: "Ха Лонг булангийн аялал", place: place("Hạ Long Bay", "Quảng Ninh", 107.0843, 20.9101), cost: perPerson(65), indoor: false, status: "booked", booking_id: "bkg_halong" },
        ]),
      },
      {
        date: d5,
        items: items(d5, [
          { item_id: "d5-1", from: "09:30", to: "12:00", kind: "free", title: "Бэлэг дурсгал авах", place: place("Chợ Đồng Xuân", "Đồng Xuân, Hoàn Kiếm", 105.8494, 21.0381), cost: perPerson(20), indoor: true, status: "planned" },
          { item_id: "d5-2", from: "16:20", to: "20:40", kind: "transport", title: "Нислэг Ханой → Улаанбаатар", place: place("Nội Bài International Airport", "Sóc Sơn, Hà Nội", 105.8067, 21.2187), cost: perPerson(0), indoor: true, status: "planned" },
        ]),
      },
    ],
  };
}

export function seedBookings(today: string): Booking[] {
  const base = { trip_id: TRIP_ID, consent: { approved_at: at(addDays(today, -5), "20:10"), method: "tap" as const } };
  return [
    { ...base, _id: "bkg_flight", proposal_id: "prp_flight", offer_id: "off_flight", status: "confirmed", confirmation_code: "ULN-HAN-4Q7", total: perGroup(1480), created_at: at(addDays(today, -9), "11:00") },
    { ...base, _id: "bkg_hotel", proposal_id: "prp_hotel", offer_id: "off_hotel", status: "confirmed", confirmation_code: "PCB-22918", total: perGroup(360), created_at: at(addDays(today, -9), "11:05") },
    { ...base, _id: "bkg_halong", proposal_id: "prp_halong", offer_id: "off_halong", status: "confirmed", confirmation_code: "HLB-7731", total: perGroup(260), created_at: at(addDays(today, -1), "21:40") },
  ];
}

export function seedOffers(today: string): Offer[] {
  const slot = (time: string, capacity_left: number) => ({ start: at(today, time), capacity_left });
  const base = { city: "Hanoi", description: "" };
  return [
    { ...base, _id: "off_cooking", merchant_id: "m_bepviet", title: "Bếp Việt Cooking Class", title_mn: "Вьетнам хоол хийх анги", category: "food", tags: ["indoor", "rainy-day", "food", "group"], price: perPerson(18), duration_min: 180, location: point(105.8575, 21.0172), address: "12 Hàng Chuối, Hai Bà Trưng", rating: 4.8, slots: [slot("14:00", 6), slot("17:30", 8)], cancellation_policy: "13:00 цагаас өмнө цуцалбал үнэгүй" },
    { ...base, _id: "off_puppet", merchant_id: "m_thanglong", title: "Thăng Long Water Puppet Theatre", title_mn: "Усан хүүхэлдэйн театр", category: "culture", tags: ["indoor", "rainy-day", "culture", "family"], price: perPerson(8), duration_min: 50, location: point(105.8532, 21.0318), address: "57B Đinh Tiên Hoàng, Hoàn Kiếm", rating: 4.6, slots: [slot("15:00", 12), slot("16:10", 20), slot("18:30", 30)], cancellation_policy: "Буцаалтгүй тасалбар" },
    { ...base, _id: "off_museum", merchant_id: "m_vme", title: "Vietnam Museum of Ethnology + egg coffee", title_mn: "Угсаатны зүйн музей ба өндөгтэй кофе", category: "culture", tags: ["indoor", "rainy-day", "history", "budget"], price: perPerson(5), duration_min: 180, location: point(105.7985, 21.0404), address: "Nguyễn Văn Huyên, Cầu Giấy", rating: 4.7, slots: [slot("13:30", 40)], cancellation_policy: "Хүссэн үедээ үнэгүй цуцална" },
    { ...base, _id: "off_lacquer", merchant_id: "m_sonmai", title: "Lacquer Painting Workshop", title_mn: "Лакан зургийн дугуйлан", category: "culture", tags: ["indoor", "rainy-day", "art"], price: perPerson(22), duration_min: 120, location: point(105.8431, 21.0302), address: "8 Tống Duy Tân, Hoàn Kiếm", rating: 4.5, slots: [slot("14:30", 4)], cancellation_policy: "24 цагийн өмнө" },
    { ...base, _id: "off_spa", merchant_id: "m_lotus", title: "Lotus Herbal Foot Spa", title_mn: "Ургамлын хөлийн иллэг", category: "wellness", tags: ["indoor", "rainy-day", "wellness"], price: perPerson(16), duration_min: 60, location: point(105.8495, 21.0329), address: "21 Hàng Bè, Hoàn Kiếm", rating: 4.4, slots: [slot("15:00", 4)], cancellation_policy: "2 цагийн өмнө" },
    { ...base, _id: "off_escape", merchant_id: "m_lockin", title: "Lock-in Escape Room", title_mn: "Оргох өрөө", category: "activity", tags: ["indoor", "rainy-day", "group"], price: perPerson(12), duration_min: 60, location: point(105.8398, 21.0231), address: "5 Trần Quốc Toản, Hoàn Kiếm", rating: 4.3, slots: [slot("14:00", 1)], cancellation_policy: "Буцаалтгүй" },
    { ...base, _id: "off_coffee", merchant_id: "m_robusta", title: "Vietnamese Coffee Workshop", title_mn: "Вьетнам кофе бэлтгэх сургалт", category: "food", tags: ["indoor", "rainy-day", "food"], price: perPerson(14), duration_min: 90, location: point(105.8519, 21.0297), address: "3 Lý Quốc Sư, Hoàn Kiếm", rating: 4.6, slots: [slot("15:30", 6)], cancellation_policy: "4 цагийн өмнө үнэгүй" },
    { ...base, _id: "off_kayak", merchant_id: "m_westlake", title: "West Lake Kayak Tour", title_mn: "Баруун нуурт каяк", category: "activity", tags: ["outdoor", "adventure"], price: perPerson(24), duration_min: 120, location: point(105.8194, 21.0588), address: "Tây Hồ, Hà Nội", rating: 4.5, slots: [slot("15:00", 8)], cancellation_policy: "24 цагийн өмнө" },
  ];
}

/** Why each top offer fits this group; the orchestrator's model would write these. */
export const OPTION_REASONS: Record<string, string> = {
  off_cooking: "Сараа хоолонд дуртай — дөрвүүлээ фо, нэм хийж сурна. Бүхэлдээ дотор.",
  off_puppet: "Номин урлагт дуртай — 1000 жилийн түүхтэй уламжлалт урлаг, 7 минут алхаад хүрнэ.",
  off_museum: "Бат түүхэнд дуртай — хамгийн хямд, дараа нь алдартай өндөгтэй кофе.",
};

export const TOP_OFFER_ORDER = ["off_puppet", "off_cooking", "off_museum"] as const;

export const TRAVEL: Record<string, { mode: "walk" | "drive"; duration_min: number; cost?: number }> = {
  off_puppet: { mode: "walk", duration_min: 7 },
  off_cooking: { mode: "drive", duration_min: 10, cost: 3 },
  off_museum: { mode: "drive", duration_min: 24, cost: 8 },
};
