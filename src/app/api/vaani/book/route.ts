import { toolRoute } from "../_tool";
import { handleBook } from "@/lib/vaani/handlers";

export const maxDuration = 10;
export const POST = toolRoute("book_slot", handleBook);
