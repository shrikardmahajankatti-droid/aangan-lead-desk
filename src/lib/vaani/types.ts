// Our own shapes. The adapter maps Vaani payloads to these; nothing else imports Vaani formats.

export type ToolName = "qualify" | "get_slots" | "book_slot";

export type ToolRequest = {
  tool: ToolName;
  vaani_call_id: string | null;
  caller_number: string | null;
  args: Record<string, unknown>;
};

export type CallEndedEvent = {
  event_id: string;
  event_type: "call.completed" | "call.failed";
  vaani_call_id: string;
  caller_number: string | null; // masked by Vaani per its docs
  started_at: string | null;
  duration_s: number | null;
  answer_delay_s: number | null;
  status: "completed" | "missed" | "dropped";
  transcript: string | null;
  recording_url: string | null;
  escalation: boolean;
  raw: unknown;
};

export type QualifyResult = {
  record_type: "lead" | "escalation" | "out_of_area" | "out_of_services";
  verdict: "qualified" | "not_qualified" | "nurture" | "needs_info" | "unknown";
  unclear_gate?: "real_project" | "service_area" | "timeline";
  ask_next?: string;
  reason_for_agent: string;
  offer_booking: boolean;
};
