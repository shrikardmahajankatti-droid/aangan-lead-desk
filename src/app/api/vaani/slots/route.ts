import { toolRoute } from "../_tool";
import { handleSlots } from "@/lib/vaani/handlers";

export const maxDuration = 10;
export const POST = toolRoute("get_slots", handleSlots);
