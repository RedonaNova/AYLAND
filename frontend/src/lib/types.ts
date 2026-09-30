// Shapes from HANDBOOK §8 (Contracts v1). Field names stay snake_case on purpose:
// the orchestrator sends them this way and the frontend does not convert them.

export type Currency = "USD";

export interface Money {
  amount: number;
  currency: Currency;
  per: "person" | "group";
}

/** GeoJSON point. Longitude comes first. */
export interface GeoPoint {
  type: "Point";
  coordinates: [lon: number, lat: number];
}

export interface Place {
  name: string;
  address: string;
  location: GeoPoint;
}

export type PlanItemKind = "activity" | "meal" | "transport" | "stay" | "free";
export type PlanItemStatus = "planned" | "proposed" | "booked" | "cancelled" | "done";

export interface PlanItem {
  item_id: string;
  start: string;
  end: string;
  kind: PlanItemKind;
  title: string;
  place: Place;
  cost: Money;
  indoor: boolean;
  status: PlanItemStatus;
  offer_id?: string;
  booking_id?: string;
  source: "seed" | "agent" | "user";
}

export interface Traveler {
  name: string;
  interests: string[];
}

export interface TripDay {
  date: string;
  items: PlanItem[];
}

export interface Trip {
  _id: string;
  owner_id: string;
  title: string;
  destination: { city: string; country: string; timezone: string; location: GeoPoint };
  travelers: Traveler[];
  party_size: number;
  budget: { currency: Currency; total: number; daily_limit: number; spent: number };
  hotel: Place;
  days: TripDay[];
  version: number;
  updated_at: string;
}

export type OfferCategory = "activity" | "food" | "culture" | "wellness" | "transport";

export interface Offer {
  _id: string;
  merchant_id: string;
  city: string;
  title: string;
  title_mn: string;
  description: string;
  category: OfferCategory;
  tags: string[];
  price: Money;
  duration_min: number;
  location: GeoPoint;
  address: string;
  rating: number;
  slots: { start: string; capacity_left: number }[];
  cancellation_policy: string;
}

export interface Proposal {
  _id: string;
  trip_id: string;
  offer_id: string;
  slot_start: string;
  party_size: number;
  total: Money;
  status: "proposed" | "approved" | "rejected" | "expired";
  created_at: string;
}

export interface Booking {
  _id: string;
  trip_id: string;
  proposal_id: string;
  offer_id: string;
  status: "held" | "confirmed" | "cancelled";
  confirmation_code: string;
  total: Money;
  consent: { approved_at: string; method: "tap" | "voice" };
  created_at: string;
}

export interface Weather {
  condition: "clear" | "clouds" | "rain";
  temp_c: number;
  precip_prob: number;
  /** Local time the condition is expected to last until, "HH:MM". */
  until?: string;
  /** True when a DEMO_MODE scenario override is active. */
  scenario: boolean;
}

/** Response of GET /api/trips/{trip_id}: the trip plus live context. */
export interface TripView {
  trip: Trip;
  bookings: Booking[];
  weather: Weather;
  /** Local "now" for the trip, ISO 8601 with offset (DEMO_NOW in demo mode). */
  now: string;
}

/**
 * One costed option, sent in the `options` event.
 * Proposed addition to §8.4: the contract had no event for option cards (M2-C2).
 */
export interface TripOption {
  rank: number;
  offer: Offer;
  slot_start: string;
  slot_end: string;
  price_total: Money;
  travel: { mode: "walk" | "drive"; duration_min: number; cost?: Money };
  reason: string;
}

export interface NudgeAction {
  label: string;
  kind: "send" | "dismiss";
  message?: string;
}

export type A2AStatus = "submitted" | "working" | "completed" | "failed";

/**
 * SSE events from POST /api/chat, POST /api/proposals/{id}/approve and the trip event stream.
 * `call_id` on tool events is a proposed §8.4 addition so parallel calls of one tool can be matched.
 */
export type AgentEvent =
  | { type: "message.delta"; data: { text: string } }
  | { type: "message.done"; data: { message_id: string } }
  | { type: "tool.start"; data: { run_id: string; call_id: string; name: string; input: Record<string, unknown> } }
  | { type: "tool.end"; data: { run_id: string; call_id: string; name: string; ok: boolean; summary: string; ms: number } }
  | { type: "a2a.call"; data: { agent: string; skill: string; status: A2AStatus } }
  | { type: "options"; data: { run_id: string; options: TripOption[] } }
  | { type: "proposal.created"; data: { proposal: Proposal } }
  | { type: "plan.updated"; data: { trip_id: string; version: number; changed_item_ids: string[] } }
  | { type: "booking.confirmed"; data: { booking: Booking } }
  | { type: "nudge"; data: { text: string; detail?: string; actions: NudgeAction[] } }
  | { type: "error"; data: { message: string } };

export type Lang = "mn" | "vi";
