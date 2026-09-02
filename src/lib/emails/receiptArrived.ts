import { button, heading, infoBox, paragraph, wrap } from "./layout.js";
import { env } from "../../config/env.js";

export type ReceiptArrivedInput = {
  ownerName: string;
  salonName: string;
  clientName: string;
  serviceName: string;
  startAt: Date;
  amountCents: number;
  currency: string;
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

const money = (cents: number, currency: string) =>
  new Intl.NumberFormat("es-EC", { style: "currency", currency }).format(cents / 100);

export function receiptArrivedTemplate(input: ReceiptArrivedInput) {
  const subject = `Nuevo comprobante de ${input.clientName} por revisar`;

  const body = `
    ${heading(`Hola ${input.ownerName.split(" ")[0]}, tienes un nuevo comprobante ✦`)}
    ${paragraph(
      `<strong>${input.clientName}</strong> acaba de subir el comprobante de su anticipo. Revísalo cuando puedas — al aprobarlo, su cita queda confirmada automáticamente y le enviamos el email de confirmación.`
    )}
    ${infoBox([
      ["Clienta", input.clientName],
      ["Servicio", input.serviceName],
      ["Cuándo", formatDate(input.startAt, input.timezone)],
      ["Monto", money(input.amountCents, input.currency)],
    ])}
    <div style="text-align:center;margin:8px 0 4px">
      ${button(`${env.APP_URL}/dashboard/payments`, "Revisar comprobante")}
    </div>
  `;

  const text = [
    `Hola ${input.ownerName},`,
    ``,
    `${input.clientName} subió un comprobante por ${money(input.amountCents, input.currency)}.`,
    `Servicio: ${input.serviceName}`,
    `Fecha: ${formatDate(input.startAt, input.timezone)}`,
    ``,
    `Revisar: ${env.APP_URL}/dashboard/payments`,
  ].join("\n");

  return { subject, html: wrap(body, { preheader: `${input.clientName} · ${money(input.amountCents, input.currency)}` }), text };
}
