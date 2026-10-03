// The app's emails. Built for email clients, which ignore <style> blocks
// and most modern CSS: table layout, inline styles, a solid background
// colour behind every gradient, and a plain-text version alongside.

const BRAND = {
  cyan: '#04F9FC',
  violet: '#7573F7',
  magenta: '#BF1CF0',
  ink: '#0A081E',
  text: '#2A2840',
  muted: '#6B6987',
  page: '#EEEEF8',
};

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Shared frame: branded header, white card for `body`, small footer.
// `preheader` is the grey preview line inbox lists show after the subject.
function layout({ appUrl, preheader, body }) {
  const host = appUrl.replace(/^https?:\/\//, '');
  const font = "font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>FPL Squad Check</title>
</head>
<body style="margin:0;padding:0;background:${BRAND.page};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${BRAND.page};">
  <tr>
    <td align="center" style="padding:32px 16px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;">
        <tr>
          <td bgcolor="${BRAND.violet}" style="background:${BRAND.violet};background-image:linear-gradient(135deg, ${BRAND.cyan} 0%, ${BRAND.violet} 55%, ${BRAND.magenta} 100%);border-radius:14px 14px 0 0;padding:26px 32px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="padding-right:12px;vertical-align:middle;">
                  <img src="${appUrl}/icons/icon-192.png" width="40" height="40" alt="" style="display:block;border:0;border-radius:10px;">
                </td>
                <td style="vertical-align:middle;${font}font-size:19px;font-weight:700;letter-spacing:0.02em;color:#FFFFFF;">
                  FPL Squad Check
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td bgcolor="#FFFFFF" style="background:#FFFFFF;border-radius:0 0 14px 14px;padding:34px 32px 30px;${font}color:${BRAND.text};">
            ${body}
          </td>
        </tr>
        <tr>
          <td align="center" style="padding:20px 16px 0;${font}font-size:12px;line-height:18px;color:${BRAND.muted};">
            Predicted points, captain and transfer picks for your FPL squad.<br>
            <a href="${appUrl}" style="color:${BRAND.muted};text-decoration:underline;">${escapeHtml(host)}</a>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}

export function resetPasswordEmail({ username, link, appUrl, expiresMinutes = 30 }) {
  const name = escapeHtml(username);
  const href = escapeHtml(link);
  const subject = 'Reset your FPL Squad Check password';

  const body = `
            <h1 style="margin:0 0 18px;font-size:24px;line-height:30px;font-weight:700;color:${BRAND.ink};">Reset your password</h1>
            <p style="margin:0 0 14px;font-size:15px;line-height:23px;">Hi ${name},</p>
            <p style="margin:0 0 26px;font-size:15px;line-height:23px;">We got a request to reset the password for your FPL Squad Check account. Tap the button to choose a new one.</p>
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 26px;">
              <tr>
                <td align="center" bgcolor="${BRAND.ink}" style="background:${BRAND.ink};border-radius:10px;">
                  <a href="${href}" style="display:inline-block;padding:14px 28px;font-size:15px;font-weight:700;color:#FFFFFF;text-decoration:none;border-radius:10px;">Choose a new password</a>
                </td>
              </tr>
            </table>
            <p style="margin:0 0 22px;font-size:14px;line-height:21px;color:${BRAND.muted};">This link works once and expires in ${expiresMinutes} minutes.</p>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr><td style="border-top:1px solid #E4E3F0;font-size:0;line-height:0;height:1px;">&nbsp;</td></tr>
            </table>
            <p style="margin:20px 0 6px;font-size:13px;line-height:19px;color:${BRAND.muted};">Button not working? Paste this link into your browser:</p>
            <p style="margin:0 0 20px;font-size:13px;line-height:19px;word-break:break-all;"><a href="${href}" style="color:${BRAND.violet};">${href}</a></p>
            <p style="margin:0;font-size:13px;line-height:19px;color:${BRAND.muted};">Didn't ask for this? You can ignore this email; your password won't change.</p>`;

  const text = `Reset your password

Hi ${username},

We got a request to reset the password for your FPL Squad Check account. Open this link to choose a new one:

${link}

This link works once and expires in ${expiresMinutes} minutes.

Didn't ask for this? You can ignore this email; your password won't change.

FPL Squad Check
${appUrl}`;

  return {
    subject,
    text,
    html: layout({ appUrl, preheader: `Choose a new password for ${username}. The link expires in ${expiresMinutes} minutes.`, body }),
  };
}
