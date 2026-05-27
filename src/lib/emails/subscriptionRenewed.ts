import { button, heading, infoBox, paragraph, wrap } from "./layout.js";
import { env } from "../../config/env.js";

export type SubscriptionRenewedInput = {
  ownerName: string;
  salonName: string;
  plan: "MONTHLY" | "LIFETIME";
  periodMonths: number;
  amountCents: number;
  currency: string;
  newPeriodEnd: Date | null; // null for LIFETIME
};

const formatDate = (d: Date) =>
  d.toLocaleDateString("es-EC", { day: "numeric", month: "long", year: "numeric" });

const money = (cents: number, currency: string) =>
  new Intl.NumberFormat("es-EC", { style: "currency", currency }).format(cents / 100);

export function subscriptionRenewedTemplate(input: SubscriptionRenewedInput) {
  const isLifetime = input.plan === "LIFETIME";
  const subject = isLifetime
    ? `Bienvenida al Plan Lifetime de Ecodama ✦`
    : `Tu plan Ecodama fue renovado ✨`;

  const body = `
    ${heading(
      isLifetime
        ? `${input.ownerName.split(" ")[0]}, eres oficialmente Lifetime ✦`
        : `${input.ownerName.split(" ")[0]}, tu plan está activo ✨`
    )}
    ${paragraph(
      isLifetime
        ? `Confirmamos tu pago único — <strong>${input.salonName}</strong> tiene Ecodama de por vida, con todas las funciones presentes y futuras incluidas. Gracias por confiar tan pronto en nosotras.`
        : `Confirmamos tu pago — <strong>${input.salonName}</strong> tiene Ecodama activo por ${
            input.periodMonths
          } mes${input.periodMonths === 1 ? "" : "es"} más.`
    )}
    ${infoBox([
      ["Plan", isLifetime ? "Lifetime ✦" : `Mensual × ${input.periodMonths}`],
      ["Monto", money(input.amountCents, input.currency)],
      ...(isLifetime
        ? ([["Vencimiento", "Nunca"]] as Array<[string, string]>)
        : ([["Vence el", input.newPeriodEnd ? formatDate(input.newPeriodEnd) : "—"]] as Array<[string, string]>)),
    ])}
    <div style="text-align:center;margin:8px 0 4px">
      ${button(`${env.APP_URL}/dashboard/billing`, "Ver mi suscripción")}
    </div>
    ${paragraph(`Si necesitas factura o tienes cualquier duda, responde este email — estamos aquí.`)}
  `;

  const text = [
    `Hola ${input.ownerName},`,
    ``,
    isLifetime
      ? `Confirmamos tu pago Lifetime de ${money(input.amountCents, input.currency)}. Ecodama es tuyo para siempre ✦`
      : `Confirmamos tu pago de ${money(input.amountCents, input.currency)}. Tu plan vence el ${input.newPeriodEnd ? formatDate(input.newPeriodEnd) : "—"}.`,
    ``,
    `Ver suscripción: ${env.APP_URL}/dashboard/billing`,
  ].join("\n");

  return {
    subject,
    html: wrap(body, {
      preheader: isLifetime
        ? "Lifetime activado — gracias"
        : `Activo hasta ${input.newPeriodEnd ? formatDate(input.newPeriodEnd) : "—"}`,
    }),
    text,
  };
}
