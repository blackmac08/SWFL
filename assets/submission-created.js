
const { google } = require('googleapis');
const twilio = require('twilio');
const https = require('https');

exports.handler = async (event, context) => {
  try {
    const body = JSON.parse(event.body || "{}");
    const submission = body && body.payload ? body.payload : null;
    if (!submission) return { statusCode: 200, body: JSON.stringify({ ok: true }) };

    const d = submission.data || {};
    const createdAt = submission.created_at || new Date().toISOString();
    const id = submission.id || "";
    const year = d.year || "";
    const make = d.make || "";
    const model = d.model || "";
    const trim = d.trim || "";
    const vin = d.vin || "";
    const mileage = d.mileage || "";
    const asking = d.asking_price || "";
    const dealerQuote = d.dealer_quote || "";
    const zip = d.zip || "";
    const name = d.full_name || "";
    const email = d.email || "";
    const phone = d.phone || "";
    const titleStatus = d.title_status || "";
    const runs = d.runs || "";
    const issues = (d.issues || "").toString().replace(/\s+/g,' ').trim();
    const options = (d.options || "").toString().replace(/\s+/g,' ').trim();

    // ----- Google Sheets -----
    const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    const privateKey = (process.env.GOOGLE_PRIVATE_KEY || "").replace(/\\n/g, "\n");
    const sheetId = process.env.GOOGLE_SHEET_ID;

    if (clientEmail && privateKey && sheetId) {
      try {
        const jwt = new google.auth.JWT(clientEmail, null, privateKey, ['https://www.googleapis.com/auth/spreadsheets']);
        const sheets = google.sheets({ version: 'v4', auth: jwt });
        const header = [
          "Timestamp","Submission ID","Name","Email","Phone",
          "ZIP","VIN","Year","Make","Model","Trim","Mileage",
          "Title Status","Runs","Asking Price","Dealer Quote",
          "Issues","Options"
        ];
        const row = [
          createdAt, id, name, email, phone,
          zip, vin, year, make, model, trim, mileage,
          titleStatus, runs, asking, dealerQuote,
          issues, options
        ];
        async function ensureSheetAndAppend() {
          try {
            await sheets.spreadsheets.values.append({
              spreadsheetId: sheetId,
              range: 'Leads!A1',
              valueInputOption: 'RAW',
              requestBody: { values: [row] }
            });
          } catch (err) {
            if (err && err.response && err.response.status === 400) {
              const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId: sheetId });
              const exists = spreadsheet.data.sheets.some(s => s.properties.title === 'Leads');
              if (!exists) {
                await sheets.spreadsheets.batchUpdate({
                  spreadsheetId: sheetId,
                  requestBody: { requests: [{ addSheet: { properties: { title: 'Leads' } } }] }
                });
                await sheets.spreadsheets.values.update({
                  spreadsheetId: sheetId,
                  range: 'Leads!A1',
                  valueInputOption: 'RAW',
                  requestBody: { values: [header, row] }
                });
              } else {
                throw err;
              }
            } else {
              throw err;
            }
          }
        }
        await ensureSheetAndAppend();
      } catch (sheetErr) {
        console.error("Sheets error:", sheetErr);
      }
    } else {
      console.warn("Missing Google Sheets env vars — skipping sheet write.");
    }

    // ----- Twilio SMS -----
    try {
      const ALERT_PHONE = process.env.ALERT_PHONE;
      const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
      const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
      const TWILIO_FROM = process.env.TWILIO_FROM;
      if (ALERT_PHONE && TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && TWILIO_FROM) {
        const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
        const title = [year, make, model].filter(Boolean).join(' ');
        const dashboardLink = submission.admin_url || "";
        const sms = `New lead: ${title || 'Vehicle'} | ZIP ${zip} | ${name} ${phone} | VIN ${vin} | ${dashboardLink}`.slice(0, 150);
        await client.messages.create({ to: ALERT_PHONE, from: TWILIO_FROM, body: sms });
      } else {
        console.warn("Missing Twilio env vars — skipping SMS send.");
      }
    } catch (smsErr) {
      console.error("Twilio error:", smsErr);
    }

    // ----- SendGrid HTML autoresponder -----
    try {
      const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY;
      const FROM_EMAIL = process.env.FROM_EMAIL;
      const BRAND_NAME = process.env.BRAND_NAME || "SWFL Auto Exchange";
      const PUBLIC_BASE = process.env.PUBLIC_BASE_URL || "";
      if (SENDGRID_API_KEY && FROM_EMAIL && email) {
        const title = [year, make, model].filter(Boolean).join(' ').trim();
        const subject = title ? `Thanks — we’re working on your ${title} offer` : "Thanks — we received your submission";
        const logoSrc = PUBLIC_BASE ? `${PUBLIC_BASE}/assets/logo.png` : "https://via.placeholder.com/300x80?text=SWFL+Auto+Exchange";

        const html = `<!doctype html>
<html><body style="margin:0;padding:0;background:#0b0f16;color:#f3f7ff;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#0b0f16;padding:24px 0;">
    <tr><td align="center">
      <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="background:#111725;border-radius:12px;overflow:hidden">
        <tr><td align="center" style="padding:24px;border-bottom:1px solid #24324a;">
          <img alt="${BRAND_NAME}" src="${logoSrc}" style="max-width:260px;height:auto;display:block;">
        </td></tr>
        <tr><td style="padding:24px 28px 12px 28px;">
          <h2 style="margin:0 0 8px 0;font-size:22px;color:#2dd4bf;">Thanks — we’ve got your info</h2>
          <p style="margin:0 0 10px 0;line-height:1.6;color:#cfe3ff;">Hi ${name || ""}, thanks for submitting your vehicle to <strong>${BRAND_NAME}</strong>. Our team is reviewing your details and photos now. We’ll reach out shortly with any questions or with your cash offer.</p>
          <p style="margin:0 0 10px 0;line-height:1.6;color:#cfe3ff;">If you have a dealer trade‑in number, feel free to reply with it — we aim to beat it. No dealer quote? No problem — you’ll still get a fast, fair offer.</p>
        </td></tr>
        <tr><td style="padding:0 28px 20px 28px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#0b0f16;border:1px solid #24324a;border-radius:10px;">
            <tr><td style="padding:14px 16px;color:#9fb3c8;font-size:14px">
              <div><strong style="color:#f3f7ff">Vehicle:</strong> ${title || "—"}</div>
              <div><strong style="color:#f3f7ff">VIN:</strong> ${vin || "—"} &nbsp; <strong style="color:#f3f7ff">ZIP:</strong> ${zip || "—"}</div>
            </td></tr>
          </table>
        </td></tr>
        <tr><td style="padding:0 28px 28px 28px;color:#9fb3c8;font-size:12px;border-top:1px solid #24324a">
          <div>© ${new Date().getFullYear()} ${BRAND_NAME}. SWFL</div>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

        const payload = JSON.stringify({
          personalizations: [{ to: [{ email }] }],
          from: { email: FROM_EMAIL, name: BRAND_NAME },
          subject,
          content: [{ type: "text/html", value: html }]
        });

        const options = {
          method: 'POST',
          hostname: 'api.sendgrid.com',
          path: '/v3/mail/send',
          headers: {
            'Authorization': `Bearer ${SENDGRID_API_KEY}`,
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload)
          }
        };

        await new Promise((resolve, reject) => {
          const req = https.request(options, (res) => {
            res.on('data', () => {});
            res.on('end', resolve);
          });
          req.on('error', reject);
          req.write(payload);
          req.end();
        });
      } else {
        console.warn("Missing SendGrid env vars or recipient email — skipping autoresponder.");
      }
    } catch (emailErr) {
      console.error("SendGrid error:", emailErr);
    }

    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  } catch (e) {
    console.error("Handler error", e);
    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  }
};
