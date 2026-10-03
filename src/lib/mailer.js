// Sends the app's (few) emails over SMTP. Defaults suit a Gmail account
// with an app password — free, and unlike most email APIs it doesn't need
// a domain of your own to send to anyone:
//
//   SMTP_USER   the sending address, e.g. yourname@gmail.com
//   SMTP_PASS   a Google app password (not the account password)
//   SMTP_HOST   optional, default smtp.gmail.com
//   SMTP_PORT   optional, default 465 (TLS)
//   EMAIL_FROM  optional display From, default "FPL Squad Check <SMTP_USER>"
import nodemailer from 'nodemailer';

let transport = null;

export function mailerConfigured() {
  return Boolean(process.env.SMTP_USER && process.env.SMTP_PASS);
}

export async function sendMail({ to, subject, text, html }) {
  if (!mailerConfigured()) throw new Error('Email sending is not configured (SMTP_USER / SMTP_PASS)');
  if (!transport) {
    const port = Number(process.env.SMTP_PORT) || 465;
    transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port,
      secure: port === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
  }
  const from = process.env.EMAIL_FROM || `FPL Squad Check <${process.env.SMTP_USER}>`;
  await transport.sendMail({ from, to, subject, text, html });
}
