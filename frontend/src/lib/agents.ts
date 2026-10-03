// Where each tool and agent lives (HANDBOOK §5.1, §8.2, §8.3). Drives the trace and the agent map.

export type NodeId = "orchestrator" | "travel-data" | "merchant" | "booking" | "interpreter" | "mongodb";
export type Protocol = "LLM" | "MCP" | "A2A" | "DB";

export interface AgentNode {
  id: NodeId;
  name: string;
  protocol: Protocol;
  port?: number;
  role: string;
  abilities: string[];
}

export const NODES: Record<NodeId, AgentNode> = {
  orchestrator: {
    id: "orchestrator",
    name: "AYLAND Orchestrator",
    protocol: "LLM",
    port: 8000,
    role: "Зорилгыг ойлгож, хэрэгсэл дуудаж, зөвшөөрлийн хаалгыг хамгаална",
    abilities: ["get_trip", "get_budget_status", "present_options", "update_trip_plan", "propose_booking"],
  },
  "travel-data": {
    id: "travel-data",
    name: "travel-data",
    protocol: "MCP",
    port: 8201,
    role: "Цаг агаар, газар, зам",
    abilities: ["get_weather", "search_places", "get_route"],
  },
  merchant: {
    id: "merchant",
    name: "merchant",
    protocol: "MCP",
    port: 8202,
    role: "Санал, сул суудал",
    abilities: ["search_offers", "get_offer", "check_availability"],
  },
  booking: {
    id: "booking",
    name: "Booking Agent",
    protocol: "A2A",
    port: 8301,
    role: "Захиалга барих, баталгаажуулах, цуцлах",
    abilities: ["confirm_booking", "cancel_booking"],
  },
  interpreter: {
    id: "interpreter",
    name: "Interpreter Agent",
    protocol: "A2A",
    port: 8302,
    role: "Монгол ⇄ орон нутгийн хэл",
    abilities: ["translate", "phrasebook"],
  },
  mongodb: {
    id: "mongodb",
    name: "MongoDB Atlas",
    protocol: "DB",
    role: "Аялал, захиалга, санах ой, агентын бүртгэл",
    abilities: ["trips", "offers", "bookings", "memories", "agent_events"],
  },
};

interface ToolMeta {
  label: string;
  node: NodeId;
}

const TOOLS: Record<string, ToolMeta> = {
  get_trip: { label: "Аяллын мэдээлэл", node: "mongodb" },
  get_budget_status: { label: "Төсөв шалгах", node: "mongodb" },
  update_trip_plan: { label: "Хөтөлбөр шинэчлэх", node: "mongodb" },
  propose_booking: { label: "Захиалгын санал", node: "mongodb" },
  undo_plan_change: { label: "Өөрчлөлт буцаах", node: "mongodb" },
  present_options: { label: "Хувилбар харуулах", node: "orchestrator" },
  get_weather: { label: "Цаг агаар", node: "travel-data" },
  search_places: { label: "Газар хайх", node: "travel-data" },
  get_route: { label: "Зам тооцоолох", node: "travel-data" },
  search_offers: { label: "Санал хайх", node: "merchant" },
  get_offer: { label: "Саналын дэлгэрэнгүй", node: "merchant" },
  check_availability: { label: "Сул суудал шалгах", node: "merchant" },
};

export const A2A_AGENTS: Record<string, NodeId> = {
  "booking-agent": "booking",
  "interpreter-agent": "interpreter",
};

export const A2A_SKILL_LABELS: Record<string, string> = {
  confirm_booking: "Захиалга баталгаажуулах",
  cancel_booking: "Захиалга цуцлах",
  translate: "Орчуулах",
};

export function toolMeta(name: string): ToolMeta {
  return TOOLS[name] ?? { label: name, node: "orchestrator" };
}

export function protocolLabel(node: NodeId): string {
  const n = NODES[node];
  return n.protocol === "DB" ? "MongoDB" : `${n.protocol} · ${n.name}`;
}
