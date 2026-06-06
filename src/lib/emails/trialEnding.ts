// Warning email sent when a trial is about to expire (7 days or 2 days out).

import { button, heading, infoBox, paragraph, wrap, escape } from "./layout.js";
import { env } from "../../config/env.js";

export type TrialEndingInput = {
  ownerName: string;
  salonName: string;
  daysLeft: number;
  trialEndsAt: Date;
};

export function trialEndingTemplate(input: TrialEndingInput) {
  const firstName = input.ownerName.split(" ")[0] ?? input.ownerName;
  const billingUrl = `${env.APP_URL}/dashboard/billing`;
  const urgent = input.daysLeft <= 2;

  const endsFormatted = input.trialEndsAt.toLocaleDateString("es-GT", {
    weekday: "long", day: "numeric", month: "long",
  });

  const body = `
    ${heading(urgent
      ? `Tu prueba termina en ${input.daysLeft === 1 ? "1 día" : `${input.daysLeft} días`}, ${escape(firstName)}`
      : `Te quedan ${input.daysLeft} días de prueba gratuita`
    )}
    ${paragraph(
      `Tu período de prueba en Ecodama para <strong>${escape(input.salonName)}</strong> ` +
        `termina el <strong>${escape(endsFormatted)}</strong>. ` +
        (urgent
          ? `Para no perder acceso a tu agenda, clientas e historial, activa tu suscripción hoy.`
          : `Activa tu suscripción cuando quieras — el proceso toma menos de 2 minutos.`)
    )}
    ${infoBox([
      ["Prueba gratuita termina", endsFormatted],
      ["Plan mensual", "$20 USD / mes"],
      ["Cancela cuando quieras", "Sin compromisos"],
    ])}
    <div style="text-align:center;margin:24px 0">
      ${button(billingUrl, "Activar mi suscripción")}
    </div>
    ${paragraph(`Cualquier duda, responde este correo y te ayudamos de inmediato.`)}
  `;

  const text = [
    `Hola ${input.ownerName},`,
    ``,
    urgent
      ? `Tu prueba en Ecodama termina en ${input.daysLeft === 1 ? "1 día" : `${input.daysLeft} días`} (${endsFormatted}).`
      : `Te quedan ${input.daysLeft} días de prueba gratuita en Ecodama (hasta el ${endsFormatted}).`,
    ``,
    `Para seguir usando tu panel, activa tu suscripción en: ${billingUrl}`,
    `Plan mensual: $20 USD / mes · Cancela cuando quieras.`,
  ].join("\n");

  return {
    subject: urgent
      ? `⚠ Tu prueba de Ecodama termina en ${input.daysLeft === 1 ? "1 día" : `${input.daysLeft} días`}`
      : `Tu prueba de Ecodama termina en ${input.daysLeft} días`,
    html: wrap(body, {
      preheader: `Tu prueba gratuita termina el ${endsFormatted}. Activa tu suscripción para no perder acceso.`,
    }),
    text,
  };
}
