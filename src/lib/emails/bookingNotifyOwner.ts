// Email sent to salon owner when a new booking is received from the public portal.
// Quick summary of the reservation so the owner can review and follow up.

import { button, heading, infoBox, paragraph, wrap, escape } from "./layout.js";
import { env } from "../../config/env.js";

export type BookingNotifyOwnerInput = {
  ownerName: string;
  clientName: string;
  clientEmail: string | null;
  clientPhone: string;
  salonName: string;
  serviceName: string;
  stylistName: string | null;
  startAt: Date;
  durationMin: number;
  depositCents: number;
  currency: string;
  requiresReceipt: boolean;
  timezone: string;
};

export function bookingNotifyOwnerTemplate(input: BookingNotifyOwnerInput) {
  const firstName = input.ownerName.split(" ")[0] ?? input.ownerName;
  const appointmentUrl = `${env.APP_URL}/dashboard/appointments`;
  const depositUSD = (input.depositCents / 100).toLocaleString("es-EC", { style: "currency", currency: input.currency });
  const appointmentTime = new Date(input.startAt).toLocaleString("es-EC", {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: input.timezone,
  });

  const body = `
    ${heading(`Nueva reserva en ${escape(input.salonName)} ✨`)}
    ${paragraph(
      `Una cliente acaba de reservar en tu página pública. ` +
      `Revísala en tu panel o responde por WhatsApp para confirmar.`
    )}
    ${infoBox([
      ["Cliente", input.clientEmail ? `${escape(input.clientName)} (${escape(input.clientEmail)})` : escape(input.clientName)],
      ["Teléfono", escape(input.clientPhone)],
      ["Servicio", escape(input.serviceName)],
      ["Estilista", input.stylistName ? escape(input.stylistName) : "Por asignar"],
      ["Fecha y hora", appointmentTime],
      ["Duración", `${input.durationMin} minutos`],
      ["Depósito", input.requiresReceipt ? depositUSD : "Sin depósito"],
    ])}
    <div style="text-align:center;margin:24px 0">
      ${button(appointmentUrl, "Ver en el panel")}
    </div>
    ${paragraph(
      `Responde a ${escape(input.clientPhone)} por WhatsApp para confirmar la reserva. ` +
      (input.clientEmail ? `La cliente ya recibió un correo con los detalles.` : `No dejó email, así que solo la puedes contactar por WhatsApp.`)
    )}
  `;

  const text = [
    `Hola ${input.ownerName},`,
    ``,
    `¡Nueva reserva en ${input.salonName}!`,
    ``,
    `Cliente: ${input.clientName}`,
    ...(input.clientEmail ? [`Email: ${input.clientEmail}`] : []),
    `Teléfono: ${input.clientPhone}`,
    ``,
    `Servicio: ${input.serviceName}`,
    `Estilista: ${input.stylistName || "Por asignar"}`,
    `Fecha: ${appointmentTime}`,
    `Duración: ${input.durationMin} minutos`,
    input.requiresReceipt ? `Depósito: ${depositUSD}` : "Sin depósito",
    ``,
    `Ve a tu panel: ${appointmentUrl}`,
    ``,
    `Responde a ${input.clientPhone} por WhatsApp para confirmar.`,
  ].join("\n");

  return {
    subject: `Nueva reserva: ${input.clientName} · ${input.serviceName}`,
    html: wrap(body, {
      preheader: `${input.clientName} quiere reservar ${input.serviceName}. Revisa los detalles.`,
    }),
    text,
  };
}
