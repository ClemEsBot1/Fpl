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
<title>FPL Checker</title>
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
                  FPL Checker
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

// A one-time code: 'verify' checks the account's email address, 'reset'
// lets them choose a new password.
export function codeEmail({ username, code, purpose, appUrl, expiresMinutes = 15 }) {
  const name = escapeHtml(username);
  const digits = escapeHtml(code);
  const reset = purpose === 'reset';
  const subject = reset ? `${code} is your FPL Checker password reset code` : `${code} is your FPL Checker verification code`;
  const heading = reset ? 'Reset your password' : 'Confirm your email';
  const why = reset
    ? 'We got a request to reset the password for your FPL Checker account. Enter this code to choose a new one:'
    : 'Enter this code in FPL Checker to confirm this is your email address:';
  const ignore = reset
    ? 'Didn’t ask for this? You can ignore this email; your password won’t change.'
    : 'Didn’t create an FPL Checker account? You can ignore this email.';

  const body = `
            <h1 style="margin:0 0 18px;font-size:24px;line-height:30px;font-weight:700;color:${BRAND.ink};">${heading}</h1>
            <p style="margin:0 0 14px;font-size:15px;line-height:23px;">Hi ${name},</p>
            <p style="margin:0 0 20px;font-size:15px;line-height:23px;">${why}</p>
            <p style="margin:0 0 20px;font-size:34px;line-height:40px;font-weight:700;letter-spacing:8px;color:${BRAND.ink};font-family:'SFMono-Regular',Menlo,Consolas,monospace;">${digits}</p>
            <p style="margin:0 0 22px;font-size:14px;line-height:21px;color:${BRAND.muted};">The code works once and expires in ${expiresMinutes} minutes. Never share it with anyone.</p>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr><td style="border-top:1px solid #E4E3F0;font-size:0;line-height:0;height:1px;">&nbsp;</td></tr>
            </table>
            <p style="margin:20px 0 0;font-size:13px;line-height:19px;color:${BRAND.muted};">${ignore}</p>`;

  const text = `${heading}

Hi ${username},

${why}

${code}

The code works once and expires in ${expiresMinutes} minutes. Never share it with anyone.

${ignore}

FPL Checker
${appUrl}`;

  return {
    subject,
    text,
    html: layout({ appUrl, preheader: `Your code is ${code}. It expires in ${expiresMinutes} minutes.`, body }),
  };
}

// A post for X that's due (src/lib/social.js): the text, and a button that
// opens X with it filled in, ready to post.
export function socialDraftEmail({ label, text, intentUrl, appUrl }) {
  const href = escapeHtml(intentUrl);
  const subject = `Post on X: ${label}`;
  const body = `
            <h1 style="margin:0 0 18px;font-size:22px;line-height:28px;font-weight:700;color:${BRAND.ink};">${escapeHtml(label)} is ready to post</h1>
            <p style="margin:0 0 22px;padding:14px 16px;border-radius:10px;background:${BRAND.page};font-size:15px;line-height:23px;white-space:pre-wrap;">${escapeHtml(text)}</p>
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 22px;">
              <tr>
                <td align="center" bgcolor="${BRAND.ink}" style="background:${BRAND.ink};border-radius:10px;">
                  <a href="${href}" style="display:inline-block;padding:14px 28px;font-size:15px;font-weight:700;color:#FFFFFF;text-decoration:none;border-radius:10px;">Post on X</a>
                </td>
              </tr>
            </table>
            <p style="margin:0;font-size:13px;line-height:19px;color:${BRAND.muted};">Opens X with the post filled in; check it and press Post. It's also on the Social tab of the admin page.</p>`;
  return {
    subject,
    text: `${label} is ready to post on X:\n\n${text}\n\nPost it: ${intentUrl}`,
    html: layout({ appUrl, preheader: text.split('\n')[0], body }),
  };
}

// The deadline email (src/lib/digest.js): this team's best captain and
// best transfer for the gameweek, and how to stop them.
export function deadlineDigestEmail({ username, event, captain, transfer, appUrl, unsubscribeUrl }) {
  const fmt = n => (Math.round(n * 10) / 10).toFixed(1);
  const deadline = new Date(event.deadline_time).toLocaleString('en-GB', { weekday: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' });
  const subject = `${event.name}: captain ${captain.name}${transfer ? `, bring in ${transfer.in.name}` : ''}`;
  const href = escapeHtml(appUrl);
  const row = (label, value) => `<tr><td style="padding:10px 0;border-top:1px solid #E4E3F0;font-size:13px;color:${BRAND.muted};width:110px;">${label}</td><td style="padding:10px 0;border-top:1px solid #E4E3F0;font-size:15px;line-height:22px;">${value}</td></tr>`;
  const body = `
            <h1 style="margin:0 0 6px;font-size:22px;line-height:28px;font-weight:700;color:${BRAND.ink};">${escapeHtml(event.name)} is nearly here</h1>
            <p style="margin:0 0 18px;font-size:15px;line-height:23px;">Hi ${escapeHtml(username)}, the deadline is <b>${escapeHtml(deadline)}</b> (UK time). For your team:</p>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 22px;">
              ${row('Captain', `<b>${escapeHtml(captain.name)}</b>, predicted ${fmt(captain.points)} pts`)}
              ${row('Transfer', transfer ? `<b>${escapeHtml(transfer.out.name)}</b> out, <b>${escapeHtml(transfer.in.name)}</b> (£${transfer.in.price.toFixed(1)}m) in: +${fmt(transfer.gain)} pts over the next 5 gameweeks` : 'Nothing worth it this week. Save the free transfer.')}
            </table>
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 22px;">
              <tr>
                <td align="center" bgcolor="${BRAND.ink}" style="background:${BRAND.ink};border-radius:10px;">
                  <a href="${href}" style="display:inline-block;padding:14px 28px;font-size:15px;font-weight:700;color:#FFFFFF;text-decoration:none;border-radius:10px;">See my whole team</a>
                </td>
              </tr>
            </table>
            <p style="margin:0;font-size:12px;line-height:18px;color:${BRAND.muted};">You get this because you asked for deadline emails. <a href="${escapeHtml(unsubscribeUrl)}" style="color:${BRAND.muted};">Stop these emails</a>.</p>`;
  const text = `${event.name} deadline: ${deadline} (UK time)

Captain: ${captain.name}, predicted ${fmt(captain.points)} pts
Transfer: ${transfer ? `${transfer.out.name} out, ${transfer.in.name} (£${transfer.in.price.toFixed(1)}m) in, +${fmt(transfer.gain)} pts over the next 5 gameweeks` : 'nothing worth it this week; save the free transfer'}

Your whole team: ${appUrl}

Stop these emails: ${unsubscribeUrl}`;
  return { subject, text, html: layout({ appUrl, preheader: `Captain ${captain.name}${transfer ? `, ${transfer.out.name} → ${transfer.in.name}` : ''}`, body }) };
}
