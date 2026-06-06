// Email sent when a trial has just expired and the subscription moves to OVERDUE.

import { button, heading, infoBox, paragraph, wrap, escape } from "./layout.js";
import { env } from "../../config/env.js";

export type TrialExpiredInput = {
  ownerName: string;
  salonName: string;
};

export function trialExpiredTemplate(input: TrialExpiredInput) {
  const firstName = input.ownerName.split(" ")[0] ?? input.ownerName;
  const billingUrl = `${env.APP_URL}/dashboard/billing`;

  const body = `
    ${heading(`Tu prueba gratuita ha terminado, ${escape(firstName)}`)}
    ${paragraph(
      `El período de prueba de <strong>${escape(input.salonName)}</strong> en Ecodama ha finalizado. ` +
        `Tu cuenta está en modo limitado — activa tu suscripción para recuperar el acceso completo ` +
        `a tu agenda, tus clientas y tu historial de pagos.`
    )}
    ${infoBox([
      ["Plan mensual", "$20 USD / mes"],
      ["Sin contratos", "Cancela cuando quieras"],
      ["Activa en", "menos de 2 minutos"],
    ])}
    <div style="text-align:center;margin:24px 0">
      ${button(billingUrl, "Activar mi suscripción ahora")}
    </div>
    ${paragraph(
      `¿Tienes alguna duda o necesitas más tiempo? Responde este correo y lo resolvemos juntas.`
    )}
  `;

  const text = [
    `Hola ${input.ownerName},`,
    ``,
    `Tu período de prueba gratuita en Ecodama para "${input.salonName}" ha terminado.`,
    `Tu cuenta está en modo limitado.`,
    ``,
    `Activa tu suscripción en: ${billingUrl}`,
    `Plan mensual: $20 USD / mes · Cancela cuando quieras.`,
    ``,
    `¿Dudas? Responde este correo.`,
  ].join("\n");

  return {
    subject: `Tu prueba de Ecodama terminó — activa tu suscripción`,
    html: wrap(body, {
      preheader: `Tu prueba gratuita terminó. Activa tu suscripción para recuperar el acceso completo.`,
    }),
    text,
  };
}
