// Email sent when an appointment is confirmed (either via payment approval or
// when owner creates it directly). Notifies client of their confirmed booking.

import { button, heading, infoBox, paragraph, wrap, escape } from "./layout.js";
import { env } from "../../config/env.js";

export type AppointmentConfirmedInput = {
  clientName: string;
  salonName: string;
  salonSlug: string;
  serviceName: string;
  stylistName: string | null;
  startAt: Date;
  durationMin: number;
  timezone: string;
};

const formatDate = (d: Date, tz: string) =>
  d.toLocaleString("es-EC", {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: tz,
  });

export function appointmentConfirmedTemplate(input: AppointmentConfirmedInput) {
  const firstName = input.clientName.split(" ")[0] ?? input.clientName;
  const subject = `Tu cita en ${escape(input.salonName)} está confirmada ✨`;

  const body = `
    ${heading(`¡Listo, ${escape(firstName)}! Tu cita está confirmada ✨`)}
    ${paragraph(
      `Tu reserva en <strong>${escape(input.salonName)}</strong> está oficialmente agendada. Te esperamos.`
    )}
    ${infoBox([
      ["Servicio", escape(input.serviceName)],
      ["Estilista", input.stylistName ? escape(input.stylistName) : "Te asignamos al llegar"],
      ["Cuándo", formatDate(input.startAt, input.timezone)],
      ["Duración", `${input.durationMin} min`],
    ])}
    <div style="text-align:center;margin:8px 0 4px">
      ${button(`${env.APP_URL}/book/${escape(input.salonSlug)}`, "Ver el salón")}
    </div>
    ${paragraph(
      `Te recomendamos llegar 5 minutos antes. Si necesitas cancelar o reprogramar, contacta directamente al salón con al menos 24h de anticipación.`
    )}
  `;

  const text = [
    `¡Hola ${input.clientName}!`,
    ``,
    `Tu cita en ${input.salonName} está confirmada.`,
    ``,
    `Servicio: ${input.serviceName}`,
    `Estilista: ${input.stylistName ?? "por asignar"}`,
    `Fecha: ${formatDate(input.startAt, input.timezone)}`,
    `Duración: ${input.durationMin} min`,
    ``,
    `Te esperamos ✨`,
  ].join("\n");

  return {
    subject,
    html: wrap(body, { preheader: `Confirmada · ${formatDate(input.startAt, input.timezone)}` }),
    text,
  };
}
