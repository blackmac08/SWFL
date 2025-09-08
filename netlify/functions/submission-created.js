// netlify/functions/submission-created.js
// Robust emailer for Netlify Forms → SendGrid with per-recipient fallback.
//
// Env vars required:
//   SENDGRID_API_KEY - SendGrid API key
//   EMAIL_FROM       - Verified sender (e.g. alerts@swflautoexchange.com)
//   EMAIL_TO         - Comma-separated list of recipients
//
const sgMail = require('@sendgrid/mail');

function titleCase(key) {
  return key
    .replace(/[_\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, c => c.toUpperCase());
}

function isStringUrl(s) {
  return typeof s === 'string' && /^https?:\/\//i.test(s.trim());
}

// Extract one or more URLs from a value that might be:
// string | {url}|{href}|{publicURL}|{publicUrl}|{path} | [ ...same... ]
function extractUrls(val) {
  const urls = [];
  const tryPush = (maybe) => { if (isStringUrl(maybe)) urls.push(maybe); };

  if (isStringUrl(val)) tryPush(val);
  else if (Array.isArray(val)) {
    val.forEach(v => urls.push(...extractUrls(v)));
  } else if (val && typeof val === 'object') {
    const candidates = [val.url, val.href, val.publicURL, val.publicUrl, val.path, val.location];
    candidates.forEach(tryPush);
  }
  return urls;
}

function classifyFileKey(key) {
  const k = (key || '').toLowerCase();
  if (k.includes('photo') || /image|img/.test(k)) return 'photo';
  if (k.includes('carfax')) return 'carfax';
  if (k.includes('dealer') && (k.includes('quote') || k.includes('offer'))) return 'dealer';
  if (k.includes('record')) return 'records';
  return 'file';
}

function esc(val) {
  if (val == null) return '';
  return String(val).replace(/[<>]/g, s => ({'<':'&lt;','>':'&gt;'}[s]));
}

exports.handler = async (event) => {
  try {
    const API_KEY = process.env.SENDGRID_API_KEY;
    const FROM = process.env.EMAIL_FROM;
    const TO = (process.env.EMAIL_TO || '').split(',').map(s => s.trim()).filter(Boolean);

    if (!API_KEY || !FROM || !TO.length) {
      console.error('Missing env vars', { hasKey: !!API_KEY, hasFrom: !!FROM, toCount: TO.length });
      return { statusCode: 500, body: 'Missing required env vars' };
    }
    sgMail.setApiKey(API_KEY);

    const json = JSON.parse(event.body || '{}');
    const payload = json.payload || {};
    const data = payload.data || payload || {};

    const formName = payload.form_name || data['form-name'] || 'Auto Appraisal Request';

    // Collect fields (skip internal/consent)
    const excluded = new Set(['form-name','bot-field','g-recaptcha-response','agree','non_junker','sms_opt_in']);
    const allEntries = Object.entries(data).filter(([k,v]) => v != null && String(v).trim() !== '');
    const fieldEntries = allEntries.filter(([k,_]) => !excluded.has(k));

    // Split info vs file links (support arrays/objects)
    const photos = [];
    const files = [];
    for (const [key, val] of fieldEntries) {
      const urls = extractUrls(val);
      if (urls.length) {
        const type = classifyFileKey(key);
        urls.forEach(u => {
          if (type === 'photo') photos.push({ key, url: u });
          else files.push({ key, url: u, type });
        });
      }
    }

    // Info table rows (exclude anything that yielded urls OR non-primitive objects)
    const infoRows = fieldEntries
      .filter(([_,v]) => extractUrls(v).length === 0 && typeof v !== 'object')
      .map(([k,v]) => `<tr>
          <td style="padding:6px 8px;border-bottom:1px solid #eee;color:#111;"><strong>${titleCase(k)}</strong></td>
          <td style="padding:6px 8px;border-bottom:1px solid #eee;color:#333;">${esc(v)}</td>
        </tr>`)
      .join('');

    // Buttons
    const btn = (href, label, color) => `
      <a href="${href}" target="_blank"
         style="display:inline-block;margin:6px 8px 6px 0;padding:10px 14px;
                background:${color};color:#fff;text-decoration:none;border-radius:6px;
                font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:20px;">
        ${label}
      </a>`;

    const blue = '#0d6efd', green = '#28a745';
    const photoButtons = photos.map((p,i)=>btn(p.url, `View Photo ${i+1}`, blue)).join('');
    const fileButtons  = files.map((f,i)=>{
      const labelMap = { carfax: 'View CarFax', dealer: 'View Dealer Quote', records: 'View Records' };
      return btn(f.url, labelMap[f.type] || `View File ${i+1}`, green);
    }).join('');

    // Subject helper
    const name  = (data.full_name || data.name || '').toString().trim();
    const year  = (data.year || '').toString().trim();
    const make  = (data.make || '').toString().trim().toUpperCase();
    const model = (data.model || '').toString().trim();
    const subjectVehicle = [year, make, model].filter(Boolean).join(' ');
    const subject = `New submission: ${formName}${subjectVehicle ? ' — ' + subjectVehicle : ''}${name ? ' (' + name + ')' : ''}`;

    const html = `
      <div style="font-family:Arial,Helvetica,sans-serif;color:#111;font-size:16px;line-height:1.45;">
        <h2 style="margin:0 0 6px 0;">New submission: ${esc(formName)}</h2>
        ${name ? `<div><strong>Name:</strong> ${esc(name)}</div>` : ''}
        ${data.phone ? `<div><strong>Phone:</strong> ${esc(data.phone)}</div>` : ''}
        ${data.email ? `<div><strong>Email:</strong> ${esc(data.email)}</div>` : ''}
        ${data.zip ? `<div><strong>ZIP:</strong> ${esc(data.zip)}</div>` : ''}
        ${data.vin ? `<div><strong>VIN:</strong> ${esc(data.vin)}</div>` : ''}
        ${subjectVehicle ? `<div><strong>Vehicle:</strong> ${esc(subjectVehicle)}</div>` : ''}

        <div style="height:12px"></div>
        <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid #eee;">
          ${infoRows || '<tr><td style="padding:8px;color:#666;">(No additional fields)</td></tr>'}
        </table>

        ${(photos.length || files.length) ? '<div style="height:16px"></div>' : ''}
        ${photos.length ? `<div><strong>Photos (${photos.length}):</strong><br>${photoButtons}</div>` : ''}
        ${files.length ? `<div style="margin-top:6px;"><strong>Files (${files.length}):</strong><br>${fileButtons}</div>` : ''}
      </div>
    `;

    const textLines = [
      `New submission: ${formName}`,
      name ? `Name: ${name}` : '',
      data.phone ? `Phone: ${data.phone}` : '',
      data.email ? `Email: ${data.email}` : '',
      data.zip ? `ZIP: ${data.zip}` : '',
      data.vin ? `VIN: ${data.vin}` : '',
      subjectVehicle ? `Vehicle: ${subjectVehicle}` : '',
      '',
      ...fieldEntries
          .filter(([_,v]) => extractUrls(v).length === 0 && typeof v !== 'object')
          .map(([k,v]) => `${titleCase(k)}: ${v}`),
      '',
      ...photos.map((p,i) => `Photo ${i+1}: ${p.url}`),
      ...files.map((f,i) => `${(f.type||'FILE').toUpperCase()}: ${f.url}`)
    ].filter(Boolean);

    // Send to each recipient independently so one failure doesn't block others.
    const results = await Promise.allSettled(TO.map(async (rcpt) => {
      const msg = { to: rcpt, from: FROM, subject, text: textLines.join('\n'), html };
      await sgMail.send(msg);
      return rcpt;
    }));

    const anyOk = results.some(r => r.status === 'fulfilled');
    console.log('send summary:', results.map(r => r.status).join(','));
    return { statusCode: anyOk ? 200 : 502, body: anyOk ? 'ok' : 'all failed' };
  } catch (err) {
    console.error('Function error', err);
    return { statusCode: 500, body: 'error' };
  }
};
