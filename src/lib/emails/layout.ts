// Shared HTML scaffold for all transactional emails.
// Inlined styles only (most email clients strip <style> tags).
// Premium feminine palette consistent with the web UI.

import { env } from "../../config/env.js";

export type LayoutOptions = {
  preheader?: string;       // Hidden preview text shown by Gmail/Outlook before opening
  brandColor?: string;      // Accent — defaults to Ecodama rose nude
};

const PALETTE = {
  bg: "#FBF8F3",
  card: "#FFFCF7",
  text: "#21161B",
  textSoft: "#5C4751",
  textMuted: "#8A6E78",
  line: "rgba(56,39,47,0.10)",
  brand: "#D89888",
  gold: "#C9A876",
};

export function escape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function button(href: string, label: string, brandColor = PALETTE.brand): string {
  return `
    <a href="${escape(href)}"
       style="display:inline-block;background:${escape(brandColor)};color:#21161B;text-decoration:none;
              padding:14px 28px;border-radius:9999px;font-weight:600;font-size:15px;letter-spacing:0.01em;">
      ${escape(label)}
    </a>
  `;
}

export function divider(): string {
  return `<tr><td style="padding:24px 0"><div style="height:1px;background:linear-gradient(90deg,transparent,${PALETTE.line},transparent)"></div></td></tr>`;
}

export function wrap(body: string, opts: LayoutOptions = {}): string {
  const preheader = opts.preheader ?? "";

  return `<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <meta name="color-scheme" content="light only">
    <meta name="supported-color-schemes" content="light only">
    <title>Ecodama</title>
  </head>
  <body style="margin:0;padding:0;background:${PALETTE.bg};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${PALETTE.text};">
    ${preheader ? `<div style="display:none;font-size:1px;color:${PALETTE.bg};line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${escape(preheader)}</div>` : ""}

    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:${PALETTE.bg};padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:560px;background:${PALETTE.card};border:1px solid ${PALETTE.line};border-radius:20px;overflow:hidden;">
            <!-- Brand header -->
            <tr>
              <td style="padding:28px 32px 0" align="center">
                <img src="${env.APP_URL}/ecodamalogo.png" alt="Ecodama" width="120" height="120"
                     style="display:inline-block;width:120px;height:auto;border:0;outline:none;text-decoration:none">
              </td>
            </tr>

            <!-- Body content -->
            <tr>
              <td style="padding:24px 32px 32px">
                ${body}
              </td>
            </tr>

            <!-- Footer -->
            <tr>
              <td style="padding:0 32px 28px">
                <div style="height:1px;background:${PALETTE.line};margin-bottom:18px"></div>
                <p style="margin:0;font-size:11px;color:${PALETTE.textMuted};line-height:1.5">
                  Recibiste este email porque tu cita / suscripción está vinculada a Ecodama.<br>
                  Si crees que es un error, simplemente ignora este mensaje.
                </p>
              </td>
            </tr>
          </table>

          <p style="margin:18px 0 0;font-size:11px;color:${PALETTE.textMuted}">
            © Ecodama · Reservas premium para salones de belleza
          </p>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

export function heading(text: string): string {
  return `<h1 style="margin:0 0 12px;font-family:Georgia,'Times New Roman',serif;font-size:26px;line-height:1.2;color:${PALETTE.text};letter-spacing:-0.01em;font-weight:400">${escape(text)}</h1>`;
}

export function paragraph(html: string): string {
  return `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:${PALETTE.textSoft}">${html}</p>`;
}

export function infoBox(rows: Array<[string, string]>): string {
  const inner = rows
    .map(
      ([label, value]) => `
      <tr>
        <td style="padding:6px 0;font-size:12px;color:${PALETTE.textMuted};text-transform:uppercase;letter-spacing:0.08em">${escape(label)}</td>
        <td style="padding:6px 0;font-size:14px;color:${PALETTE.text};font-weight:500;text-align:right">${escape(value)}</td>
      </tr>
    `
    )
    .join("");

  return `
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#F6F1EA;border-radius:14px;padding:16px 20px;margin:8px 0 24px">
      ${inner}
    </table>
  `;
}

export { PALETTE };
