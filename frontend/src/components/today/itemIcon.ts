import { CarTaxiFront, ChefHat, Coffee, Drama, Hotel, Landmark, Plane, ShoppingBag, Ship, Utensils } from "lucide-react";
import type { PlanItem } from "@/lib/types";

// Components are picked from a static map (not returned by a function) so React can keep them stable.
export const ICONS = { CarTaxiFront, ChefHat, Coffee, Drama, Hotel, Landmark, Plane, ShoppingBag, Ship, Utensils };
export type IconKey = keyof typeof ICONS;

const BY_OFFER: Record<string, IconKey> = {
  off_cooking: "ChefHat",
  off_puppet: "Drama",
  off_museum: "Landmark",
};

const BY_KIND: Record<PlanItem["kind"], IconKey> = {
  meal: "Utensils",
  transport: "CarTaxiFront",
  stay: "Hotel",
  free: "ShoppingBag",
  activity: "Landmark",
};

export function itemIconKey(item: Pick<PlanItem, "kind" | "title" | "offer_id">): IconKey {
  if (item.offer_id && BY_OFFER[item.offer_id]) return BY_OFFER[item.offer_id];
  if (item.title.includes("Нислэг")) return "Plane";
  if (item.title.includes("кофе")) return "Coffee";
  if (item.title.includes("Ха Лонг")) return "Ship";
  return BY_KIND[item.kind];
}

export function offerIconKey(offerId: string): IconKey {
  return BY_OFFER[offerId] ?? "Landmark";
}
