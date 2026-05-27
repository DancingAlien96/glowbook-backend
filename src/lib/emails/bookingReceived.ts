import { button, heading, infoBox, paragraph, wrap } from "./layout.js";
import { env } from "../../config/env.js";

export type BookingReceivedInput = {
  clientName: string;
  salonName: string;
  salonSlug: string;
  serviceName: string;
  stylistName: string | null;
  startAt: Date;
  durationMin: number;
  depositCents: number;
  currency: string;
  requiresReceipt: boolean;
};

const formatDate = (d: Date) =>
  d.toLocaleString("es-EC", {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });

const money = (cents: number, currency: string) =>
  new Intl.NumberFormat("es-EC", { style: "currency", currency }).format(cents / 100);

export function bookingReceivedTemplate(input: BookingReceivedInput) {
  const subject = `Tu reserva en ${input.salonName} fue recibida ✦`;

  const body = `
    ${heading(`Hola ${input.clientName.split(" ")[0]}, gracias por reservar con nosotras ✨`)}
    ${paragraph(
      input.requiresReceipt
        ? `Recibimos tu solicitud de cita en <strong>${input.salonName}</strong>. Está pendiente de confirmación: en cuanto validemos tu comprobante de transferencia (usualmente en menos de 2h) te enviaremos otro email confirmándola.`
        : `Recibimos tu reserva en <strong>${input.salonName}</strong>. Te esperamos el día de la cita.`
    )}
    ${infoBox([
      ["Servicio", input.serviceName],
      ["Estilista", input.stylistName ?? "Te asignamos al llegar"],
      ["Cuándo", formatDate(input.startAt)],
      ["Duración", `${input.durationMin} min`],
      ...(input.requiresReceipt
        ? ([["Anticipo enviado", money(input.depositCents, input.currency)]] as Array<[string, string]>)
        : []),
    ])}
    <div style="text-align:center;margin:8px 0 4px">
      ${button(`${env.APP_URL}/book/${input.salonSlug}`, "Ver mi reserva")}
    </div>
    ${paragraph(
      `Si necesitas cancelar o reprogramar, contacta directamente al salón.<br>¡Te esperamos! ✦`
    )}
  `;

  const text = [
    `Hola ${input.clientName},`,
    ``,
    `Recibimos tu reserva en ${input.salonName}.`,
    `Servicio: ${input.serviceName}`,
    `Estilista: ${input.stylistName ?? "por asignar"}`,
    `Fecha: ${formatDate(input.startAt)}`,
    `Duración: ${input.durationMin} min`,
    input.requiresReceipt ? `Anticipo: ${money(input.depositCents, input.currency)} (pendiente de validación)` : "",
    ``,
    `Ver tu reserva: ${env.APP_URL}/book/${input.salonSlug}`,
  ]
    .filter(Boolean)
    .join("\n");

  return { subject, html: wrap(body, { preheader: `Esperando confirmación · ${input.serviceName}` }), text };
}
