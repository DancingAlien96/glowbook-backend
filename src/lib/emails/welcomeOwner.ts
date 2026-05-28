// Welcome email for owners created manually by an ADMIN.
// Includes login URL and the temporary password so she can sign in once and
// then change it from /dashboard/settings.

import { button, heading, infoBox, paragraph, wrap, escape } from "./layout.js";
import { env } from "../../config/env.js";

export type WelcomeOwnerInput = {
  ownerName: string;
  ownerEmail: string;
  salonName: string;
  salonSlug: string;
  tempPassword: string;
  plan: "TRIAL" | "LIFETIME";
};

export function welcomeOwnerTemplate(input: WelcomeOwnerInput) {
  const firstName = input.ownerName.split(" ")[0] ?? input.ownerName;
  const subject = `Tu cuenta de Ecodama está lista, ${firstName} ✨`;
  const loginUrl = `${env.APP_URL}/login`;
  const publicUrl = `${env.APP_URL}/s/${input.salonSlug}`;

  const body = `
    ${heading(`Bienvenida a Ecodama, ${escape(firstName)}`)}
    ${paragraph(
      `Acabamos de crear la cuenta de <strong>${escape(input.salonName)}</strong> en Ecodama. ` +
        `Inicia sesión con las credenciales de abajo y, por favor, cambia la contraseña apenas entres ` +
        `(panel → Configuración → Cambiar contraseña).`
    )}
    ${infoBox([
      ["Email", input.ownerEmail],
      ["Contraseña temporal", input.tempPassword],
      ["Plan", input.plan === "LIFETIME" ? "Lifetime ✦" : "Prueba gratuita"],
      ["Tu página pública", `${env.APP_URL}/s/${input.salonSlug}`],
    ])}
    <div style="text-align:center;margin:8px 0 4px">
      ${button(loginUrl, "Iniciar sesión")}
    </div>
    ${paragraph(
      `Tu agenda, servicios, estilistas y pagos viven en el panel. Tu página pública ` +
        `(<a href="${escape(publicUrl)}" style="color:#8B4636">${escape(publicUrl)}</a>) ` +
        `es donde tus clientas reservan — compártela en Instagram, WhatsApp o donde prefieras.`
    )}
    ${paragraph(`Cualquier duda, responde este correo. Estamos a una respuesta de distancia.`)}
  `;

  const text = [
    `Hola ${input.ownerName},`,
    ``,
    `Acabamos de crear tu cuenta de Ecodama para "${input.salonName}".`,
    ``,
    `Email: ${input.ownerEmail}`,
    `Contraseña temporal: ${input.tempPassword}`,
    `Plan: ${input.plan === "LIFETIME" ? "Lifetime" : "Prueba gratuita"}`,
    ``,
    `Inicia sesión aquí: ${loginUrl}`,
    `Tu página pública: ${publicUrl}`,
    ``,
    `Importante: cambia tu contraseña apenas entres (Configuración → Cambiar contraseña).`,
  ].join("\n");

  return {
    subject,
    html: wrap(body, { preheader: "Tu cuenta de Ecodama está lista — inicia sesión y cambia tu contraseña." }),
    text,
  };
}
