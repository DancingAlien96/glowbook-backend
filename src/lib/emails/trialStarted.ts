// Sent when Recurrente fires subscription.create for an email that has no
// Ecodama account yet. Card is saved, 14-day trial has started — prompts
// the user to create their account with the same email.

import { button, heading, infoBox, paragraph, wrap, escape } from "./layout.js";
import { env } from "../../config/env.js";

export type TrialStartedInput = {
  email: string;
  trialDays?: number;
};

export function trialStartedTemplate(input: TrialStartedInput) {
  const days = input.trialDays ?? 14;
  const registerUrl = `${env.APP_URL}/register`;

  const body = `
    ${heading(`Tu prueba gratuita de ${days} días ha comenzado`)}
    ${paragraph(
      `Recibimos tu tarjeta y tu período de prueba de <strong>${days} días</strong> acaba de comenzar. ` +
        `Para acceder a tu salón, crea tu cuenta usando el botón de abajo — ` +
        `<strong>usa exactamente este email</strong> (<strong>${escape(input.email)}</strong>).`
    )}
    ${infoBox([
      ["Período de prueba", `${days} días gratis`],
      ["Primer cobro", `Al finalizar la prueba — $20 USD/mes`],
      ["Puedes cancelar", "En cualquier momento antes del cobro"],
    ])}
    <div style="text-align:center;margin:24px 0">
      ${button(registerUrl, "Crear mi cuenta ahora")}
    </div>
    ${paragraph(
      `Si tienes algún problema al registrarte, responde este correo y te ayudamos de inmediato.`
    )}
  `;

  const text = [
    `Tu prueba gratuita de ${days} días en Ecodama ha comenzado.`,
    ``,
    `Para acceder, crea tu cuenta en: ${registerUrl}`,
    `Importante: usa el mismo email con el que te suscribiste (${input.email}).`,
    ``,
    `Período de prueba: ${days} días gratis`,
    `Primer cobro: al finalizar la prueba — $20 USD/mes`,
    `Puedes cancelar en cualquier momento antes del cobro.`,
    ``,
    `¿Problemas? Responde este correo.`,
  ].join("\n");

  return {
    subject: `Tu prueba gratuita de ${days} días en Ecodama ha comenzado`,
    html: wrap(body, {
      preheader: `${days} días gratis para probar Ecodama. Crea tu cuenta con este email para empezar.`,
    }),
    text,
  };
}
