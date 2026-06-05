// Sent when a new user registers and their pre-payment (PendingActivation)
// is found — the subscription is activated immediately, not as a trial.

import { button, heading, infoBox, paragraph, wrap, escape } from "./layout.js";
import { env } from "../../config/env.js";

export type SubscriptionActivatedInput = {
  ownerName: string;
  salonName: string;
  email: string;
  periodEnd: Date;
};

export function subscriptionActivatedTemplate(input: SubscriptionActivatedInput) {
  const firstName = input.ownerName.split(" ")[0] ?? input.ownerName;
  const dashboardUrl = `${env.APP_URL}/dashboard`;
  const periodEndFormatted = input.periodEnd.toLocaleDateString("es-GT", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  const body = `
    ${heading(`¡Bienvenida a Ecodama, ${escape(firstName)}!`)}
    ${paragraph(
      `Tu cuenta para <strong>${escape(input.salonName)}</strong> está lista y ` +
        `tu suscripción ya está activa. Puedes empezar a recibir reservas desde hoy.`
    )}
    ${infoBox([
      ["Salón", input.salonName],
      ["Plan", "Mensual — $20 USD/mes"],
      ["Próximo cobro", periodEndFormatted],
    ])}
    <div style="text-align:center;margin:8px 0 4px">
      ${button(dashboardUrl, "Ir a mi panel")}
    </div>
    ${paragraph(
      `Lo primero: agrega tus servicios y configura tus horarios para que tus clientas ` +
        `puedan reservar. Si tienes alguna duda, responde este correo.`
    )}
  `;

  const text = [
    `¡Bienvenida a Ecodama, ${input.ownerName}!`,
    ``,
    `Tu cuenta para "${input.salonName}" está lista y tu suscripción ya está activa.`,
    ``,
    `Plan: Mensual — $20 USD/mes`,
    `Próximo cobro: ${periodEndFormatted}`,
    ``,
    `Ir a tu panel: ${dashboardUrl}`,
    ``,
    `¿Dudas? Responde este correo.`,
  ].join("\n");

  return {
    subject: `¡Bienvenida! Tu suscripción de Ecodama está activa, ${firstName}`,
    html: wrap(body, {
      preheader: `Tu suscripción está activa. Empieza a recibir reservas hoy.`,
    }),
    text,
  };
}
