// Sent when Recurrente fires a payment webhook for an email that has no
// Ecodama account yet. Tells the user their payment was received and
// prompts them to create their account with the same email.

import { button, heading, paragraph, wrap, escape } from "./layout.js";
import { env } from "../../config/env.js";

export type PaymentPendingInput = {
  email: string;
};

export function paymentPendingTemplate(input: PaymentPendingInput) {
  const registerUrl = `${env.APP_URL}/register`;

  const body = `
    ${heading("Tu pago fue recibido")}
    ${paragraph(
      `Recibimos tu pago de suscripción a Ecodama. Para activar tu salón, ` +
        `crea tu cuenta usando el botón de abajo — <strong>usa exactamente este email</strong> ` +
        `(<strong>${escape(input.email)}</strong>) y tu suscripción quedará activa de inmediato.`
    )}
    <div style="text-align:center;margin:24px 0">
      ${button(registerUrl, "Crear mi cuenta")}
    </div>
    ${paragraph(
      `Si tienes algún problema al registrarte, responde este correo y te ayudamos en minutos.`
    )}
  `;

  const text = [
    `Recibimos tu pago de suscripción a Ecodama.`,
    ``,
    `Para activar tu salón, crea tu cuenta en: ${registerUrl}`,
    `Importante: usa el mismo email con el que pagaste (${input.email}).`,
    `Tu suscripción quedará activa de inmediato.`,
    ``,
    `¿Problemas? Responde este correo.`,
  ].join("\n");

  return {
    subject: "Tu pago fue recibido — crea tu cuenta en Ecodama",
    html: wrap(body, {
      preheader: "Tu pago fue recibido. Crea tu cuenta con este email para activar tu salón.",
    }),
    text,
  };
}
