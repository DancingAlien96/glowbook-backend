// Welcome email sent when a new owner registers directly without prior payment.
// They get a 14-day free trial, and the first charge happens on day 15.

import { button, heading, paragraph, infoBox, wrap, escape } from "./layout.js";
import { env } from "../../config/env.js";

export type WelcomeTrialInput = {
  ownerName: string;
  salonName: string;
  salonSlug: string;
  trialDays?: number;
};

export function welcomeTrialTemplate(input: WelcomeTrialInput) {
  const firstName = input.ownerName.split(" ")[0] ?? input.ownerName;
  const trialDays = input.trialDays ?? 14;
  const dashboardUrl = `${env.APP_URL}/dashboard`;
  const publicUrl = `${env.APP_URL}/book/${input.salonSlug}`;

  const body = `
    ${heading(`Bienvenida a Ecodama, ${escape(firstName)} ✨`)}
    ${paragraph(
      `Tu cuenta está lista. Tienes <strong>${trialDays} días gratis</strong> para probar Ecodama — ` +
      `después, cobraremos $20 USD/mes a tu tarjeta de crédito. Puedes cancelar en cualquier momento.`
    )}
    ${infoBox([
      ["Período de prueba", `${trialDays} días gratis`],
      ["Primer cobro", `$20 USD — el día ${trialDays + 1}`],
      ["Puedes cancelar", "Antes del primer cobro, sin penalización"],
      ["Tu salón", `${env.APP_URL}/book/${input.salonSlug}`],
    ])}
    <div style="text-align:center;margin:24px 0">
      ${button(dashboardUrl, "Ir al panel")}
    </div>
    ${paragraph(
      `En el panel configuras tu agenda, servicios, estilistas y pagos. ` +
      `Tu página pública (<a href="${escape(publicUrl)}" style="color:#8B4636">${escape(publicUrl)}</a>) ` +
      `es donde tus clientas reservan — compártela en Instagram, WhatsApp o donde prefieras.`
    )}
    ${paragraph(
      `Cualquier pregunta, responde este correo. Estamos acá para ayudarte. 💜`
    )}
  `;

  const text = [
    `Hola ${input.ownerName},`,
    ``,
    `¡Bienvenida a Ecodama! Tu salón "${input.salonName}" ya está listo.`,
    ``,
    `Tienes ${trialDays} días gratis. Después, cobraremos $20 USD/mes.`,
    `Puedes cancelar en cualquier momento antes del primer cobro.`,
    ``,
    `Ve al panel: ${dashboardUrl}`,
    `Tu página pública: ${publicUrl}`,
    ``,
    `¿Preguntas? Responde este correo. Estamos acá para ayudarte.`,
  ].join("\n");

  return {
    subject: `Tu salón en Ecodama está listo, ${firstName}`,
    html: wrap(body, {
      preheader: `${trialDays} días gratis para probar Ecodama. Configura tu agenda y empieza a recibir reservas.`,
    }),
    text,
  };
}
