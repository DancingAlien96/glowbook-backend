import { Resend } from "resend";
import { env } from "../config/env.js";

/**
 * Resend client — lazily initialized. If RESEND_API_KEY is missing, sendEmail()
 * is a no-op (logs a warning) so development without email setup still works.
 */
const resend = env.RESEND_API_KEY ? new Resend(env.RESEND_API_KEY) : null;

if (!resend) {
  console.warn(
    "[email] RESEND_API_KEY not set — outgoing emails will be skipped (dev mode)."
  );
}

export type SendEmailInput = {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
};

/**
 * Fire-and-forget email send. NEVER throws — logs on failure so a flaky
 * email provider can't break the booking / payment flow.
 */
export function sendEmail(input: SendEmailInput): void {
  if (!resend) {
    console.info(`[email:skip] would send to ${input.to} — ${input.subject}`);
    return;
  }

  void resend.emails
    .send({
      from: env.EMAIL_FROM,
      to: Array.isArray(input.to) ? input.to : [input.to],
      subject: input.subject,
      html: input.html,
      text: input.text,
      replyTo: input.replyTo,
    })
    .then((res) => {
      if (res.error) {
        console.error(`[email:error] ${input.subject} → ${input.to}`, res.error);
      } else {
        console.info(`[email:sent] ${input.subject} → ${input.to} (${res.data?.id})`);
      }
    })
    .catch((err) => {
      console.error(`[email:crash] ${input.subject} → ${input.to}`, err);
    });
}
