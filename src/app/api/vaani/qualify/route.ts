import { toolRoute } from "../_tool";
import { handleQualify } from "@/lib/vaani/handlers";

export const maxDuration = 10;
export const POST = toolRoute("qualify", handleQualify);
