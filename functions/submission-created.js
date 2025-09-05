
/**
 * submission-created — sends Email (SendGrid) with file links, and SMS (Twilio) if configured.
 * Env vars (Email):
 *   SENDGRID_API_KEY, EMAIL_FROM, EMAIL_TO (comma-separated)
 * Env vars (SMS, optional until your campaign is approved):
 *   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM, ALERT_PHONE
 */
export async function handler(event) {
  const payload = JSON.parse(event.body || "{}").payload || {};
  const data = payload.data || {};
  const human = payload.human_fields || {};
  const files = Array.isArray(payload.files) ? payload.files : [];

  // Compose core fields
  const nm = data.full_name || human["Full name"] || "";
  const ph = data.phone || human["Mobile (for quick texts)"] || data.mobile || "";
  const em = data.email || human.Email || "";
  const zipcode = data.zip || human["ZIP (vehicle location)"] || data.postal || "";
  const vin = data.vin || "";
  const veh = `${data.year||""} ${data.make||""} ${data.model||""}`.trim();
  const formName = payload.form_name || "unknown";

  // Collect file links (photos and any other files)
  const urls = [];
  for (const f of files) {
    if (f && typeof f.url === "string" && /^https?:\/\//i.test(f.url)) urls.push(f.url);
  }
  const photoFields = ["photo1","photo2","photo3","photo4","photo5","photo6","photos","photos[]","dealer_quote_file","records"];
  for (const k of photoFields) {
    const v = data[k];
    if (typeof v === "string" && /^https?:\/\//i.test(v)) urls.push(v);
  }

  // Build plain-text body
  const lines = [];
  lines.push(`New submission: ${formName}`);
  if (nm) lines.push(`Name: ${nm}`);
  if (ph) lines.push(`Phone: ${ph}`);
  if (em) lines.push(`Email: ${em}`);
  if (zipcode) lines.push(`ZIP: ${zipcode}`);
  if (vin) lines.push(`VIN: ${vin}`);
  if (veh) lines.push(`Vehicle: ${veh}`);
  lines.push("");
  lines.push(`Photos / Files: ${urls.length}`);
  for (const u of urls) lines.push(u);
  const textBody = lines.join("\n");

  async function maybeSendEmail(){
    const key = process.env.SENDGRID_API_KEY;
    const from = process.env.EMAIL_FROM;
    const toCSV = process.env.EMAIL_TO;
    if(!key || !from || !toCSV) return { skipped: true, reason: "Missing email env vars" };
    const tos = toCSV.split(",").map(s=>s.trim()).filter(Boolean);
    const sgEndpoint = "https://api.sendgrid.com/v3/mail/send";

    const content = [ { type: "text/plain", value: textBody } ];
    const personalizations = [{ to: tos.map(t=>({ email: t })) }];
    const payload = { personalizations, from: { email: from, name: "SWFL Auto Exchange" }, subject: `New lead: ${nm || "Unknown"} (${formName})`, content };

    const res = await fetch(sgEndpoint, {
      method: "POST",
      headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const ok = res.status === 202;
    const txt = await res.text();
    if(!ok) console.error("SendGrid error", res.status, txt);
    return { ok, status: res.status };
  }

  async function maybeSendSMS(){
    const SID = process.env.TWILIO_ACCOUNT_SID;
    const TOKEN = process.env.TWILIO_AUTH_TOKEN;
    const FROM = process.env.TWILIO_FROM;
    const TOCSV = process.env.ALERT_PHONE;
    if(!SID || !TOKEN || !FROM || !TOCSV) return { skipped: true, reason: "Missing SMS env vars" };

    const endpoint = `https://api.twilio.com/2010-04-01/Accounts/${SID}/Messages.json`;
    const auth = Buffer.from(`${SID}:${TOKEN}`).toString("base64");

    const msgLines = [];
    msgLines.push(`New lead: ${nm||"Unknown"}`);
    if (ph) msgLines.push(`Phone: ${ph}`);
    if (veh) msgLines.push(`Vehicle: ${veh}`);
    if (vin) msgLines.push(`VIN: ${vin}`);
    if (urls.length) msgLines.push(`Photos: ${urls.length}`, urls.slice(0,2).join("\n"));
    const smsBody = msgLines.join("\n").slice(0, 1480);

    async function send(to){
      const form = new URLSearchParams();
      form.append("From", FROM);
      form.append("To", to);
      form.append("Body", smsBody);
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Authorization": `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
        body: form.toString()
      });
      const ok = res.ok;
      const txt = await res.text();
      if(!ok) console.error("Twilio error", res.status, txt);
      return { ok, status: res.status };
    }

    const tos = TOCSV.split(",").map(s=>s.trim()).filter(Boolean);
    const results = await Promise.all(tos.map(send));
    return { ok: results.some(r=>r.ok), results };
  }

  const emailRes = await maybeSendEmail();
  const smsRes = await maybeSendSMS();

  return {
    statusCode: 200,
    body: JSON.stringify({ ok: true, email: emailRes, sms: smsRes, files: urls.length })
  };
}
