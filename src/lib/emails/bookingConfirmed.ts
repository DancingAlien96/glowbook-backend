import { button, heading, infoBox, paragraph, wrap } from "./layout.js";
import { env } from "../../config/env.js";

export type BookingConfirmedInput = {
  clientName: string;
  salonName: string;
  salonSlug: string;
  serviceName: string;
  stylistName: string | null;
  startAt: Date;
  durationMin: number;
};

const formatDate = (d: Date) =>
  d.toLocaleString("es-EC", {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });

export function bookingConfirmedTemplate(input: BookingConfirmedInput) {
  const subject = `Tu cita en ${input.salonName} está confirmada ✨`;

  const body = `
    ${heading(`¡Listo, ${input.clientName.split(" ")[0]}! Tu cita está confirmada ✨`)}
    ${paragraph(
      `Tu comprobante fue validado por <strong>${input.salonName}</strong> y tu reserva quedó oficialmente agendada. Te esperamos.`
    )}
    ${infoBox([
      ["Servicio", input.serviceName],
      ["Estilista", input.stylistName ?? "Te asignamos al llegar"],
      ["Cuándo", formatDate(input.startAt)],
      ["Duración", `${input.durationMin} min`],
    ])}
    <div style="text-align:center;margin:8px 0 4px">
      ${button(`${env.APP_URL}/book/${input.salonSlug}`, "Ver el salón")}
    </div>
    ${paragraph(
      `Te recomendamos llegar 5 minutos antes. Si necesitas cancelar o reprogramar, contacta directamente al salón con al menos 24h de anticipación para no perder tu anticipo.`
    )}
  `;

  const text = [
    `¡Hola ${input.clientName}!`,
    ``,
    `Tu cita en ${input.salonName} está confirmada.`,
    `Servicio: ${input.serviceName}`,
    `Estilista: ${input.stylistName ?? "por asignar"}`,
    `Fecha: ${formatDate(input.startAt)}`,
    `Duración: ${input.durationMin} min`,
    ``,
    `Te esperamos ✨`,
  ].join("\n");

  return { subject, html: wrap(body, { preheader: `Confirmada · ${formatDate(input.startAt)}` }), text };
}
