import "server-only";
import { Resend } from "resend";
import { env } from "./env";
import type { Email } from "./email";

let client: Resend | null = null;

/** Sends one email. The idempotency key is also passed to Resend (it dedupes for 24 h). */
export async function sendEmail(to: string, email: Email, idempotencyKey: string): Promise<string> {
  const { RESEND_API_KEY, EMAIL_FROM } = env("resend");
  client ??= new Resend(RESEND_API_KEY);
  const { data, error } = await client.emails.send(
    { from: `Aangan Lead Desk <${EMAIL_FROM}>`, to: [to], subject: email.subject, html: email.html, text: email.text },
    { idempotencyKey },
  );
  if (error) throw new Error(`Resend: ${error.name}: ${error.message}`);
  return data!.id;
}
