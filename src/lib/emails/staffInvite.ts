// Invitation email sent when a salon owner adds a new team member (stylist or staff).
// Includes login credentials and instructions.

import { button, heading, infoBox, paragraph, wrap, escape } from "./layout.js";
import { env } from "../../config/env.js";

export type StaffInviteInput = {
  name: string;
  email: string;
  password: string;
  salonName: string;
  role: "STYLIST" | "STAFF";
};

export function staffInviteTemplate(input: StaffInviteInput) {
  const firstName = input.name.split(" ")[0] ?? input.name;
  const loginUrl = `${env.APP_URL}/login`;
  const roleLabel = input.role === "STYLIST" ? "Estilista" : "Personal";

  const body = `
    ${heading(`¡Bienvenida a ${escape(input.salonName)}, ${escape(firstName)}!`)}
    ${paragraph(
      `Te han agregado al equipo de <strong>${escape(input.salonName)}</strong> en Ecodama como <strong>${roleLabel}</strong>. ` +
      `Usa las credenciales de abajo para ingresar y empezar a ver tu agenda.`
    )}
    ${infoBox([
      ["Email", input.email],
      ["Contraseña", input.password],
      ["Salón", escape(input.salonName)],
    ])}
    <div style="text-align:center;margin:24px 0">
      ${button(loginUrl, "Ingresar a Ecodama")}
    </div>
    ${paragraph(
      `<strong>Importante:</strong> Por seguridad, te recomendamos que cambies tu contraseña apenas ingreses ` +
      `(en tu perfil → Seguridad → Cambiar contraseña).`
    )}
    ${paragraph(
      `En Ecodama verás tu agenda, horarios y la información de tus citas. ` +
      `Si tienes preguntas, responde este correo — estamos acá para ayudarte. 💜`
    )}
  `;

  const text = [
    `Hola ${input.name},`,
    ``,
    `¡Bienvenida a Ecodama! Te han agregado al equipo de "${input.salonName}".`,
    ``,
    `Tus credenciales:`,
    `Email: ${input.email}`,
    `Contraseña: ${input.password}`,
    ``,
    `Inicia sesión aquí: ${loginUrl}`,
    ``,
    `IMPORTANTE: cambia tu contraseña apenas ingreses (Perfil → Seguridad → Cambiar contraseña).`,
    ``,
    `¿Preguntas? Responde este correo.`,
  ].join("\n");

  return {
    subject: `Bienvenida a Ecodama — Tu acceso a ${escape(input.salonName)}`,
    html: wrap(body, {
      preheader: `${input.email} • Inicia sesión en Ecodama y cambia tu contraseña.`,
    }),
    text,
  };
}
