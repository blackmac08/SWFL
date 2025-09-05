
/**
 * Netlify Function: submission-created
 * - Sends email alerts via SendGrid to ALL recipients (each as a separate email)
 * - No external npm packages required (uses SendGrid HTTP API via fetch)
 * - Includes links to uploaded photos/files
 * - Optional Twilio SMS remains supported when env is present
 *
 * Required env:
 *   SENDGRID_API_KEY, EMAIL_FROM, EMAIL_TO (comma-separated list)
 * Optional env:
 *   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM, ALERT_PHONE
 */
export async function handler(event) {
  const payload = JSON.parse(event.body || "{}").payload || {};
  const data = payload.data || {};
  const human = payload.human_fields || {};
  const filesArr = Array.isArray(payload.files) ? payload.files : [];
  const formName = payload.form_name || "unknown";

  // Core fields
  const nm = data.full_name || human["Full name"] || "";
  const ph = data.phone || human["Mobile (for quick texts)"] || data.mobile || "";
  const em = data.email || human.Email || "";
  const zipcode = data.zip || human["ZIP (vehicle location)"] || data.postal || "";
  const vin = data.vin || "";
  const veh = `${data.year||""} ${data.make||""} ${data.model||""}`.trim();

  // Collect file links from all sources
  function collectUrlsFrom(obj){
    const list = [];
    if (!obj || typeof obj !== "object") return list;
    for (const [k,v] of Object.entries(obj)){
      if (typeof v === "string" && /^https?:\/\//i.test(v) && /(photo|file|records|carfax|dealer|image|upload)/i.test(k)){
        list.push({ key:k, url:v });
      }
      if (Array.isArray(v)){
        v.forEach((item,i)=>{
          if (typeof item === "string" && /^https?:\/\//i.test(item)){
            list.push({ key:`${k}[${i}]`, url:item });
          }
        });
      }
    }
    return list;
  }
  const gathered = [];
  for (const f of filesArr){
    if (f && typeof f.url === "string" && /^https?:\/\//i.test(f.url)){
      gathered.push({ key: f.name || "file", url: f.url });
    }
  }
  gathered.push(...collectUrlsFrom(data));
  gathered.push(...collectUrlsFrom(human));
  const seen = new Set();
  const fileLinks = gathered.filter(({url})=> !seen.has(url) && seen.add(url));

  // Build message text
  const lines = [];
  lines.push(`New submission: ${formName}`);
  if (nm) lines.push(`Name: ${nm}`);
  if (ph) lines.push(`Phone: ${ph}`);
  if (em) lines.push(`Email: ${em}`);
  if (zipcode) lines.push(`ZIP: ${zipcode}`);
  if (vin) lines.push(`VIN: ${vin}`);
  if (veh) lines.push(`Vehicle: ${veh}`);
  lines.push("");
  lines.push(`Photos / Files: ${fileLinks.length}`);
  fileLinks.forEach(({key,url})=>lines.push(`${key}: ${url}`));
  const textBody = lines.join("\n");

  // --- SendGrid (no dependency) ---
  async function sendEmailToEach(){
    const key = process.env.SENDGRID_API_KEY;
    const from = process.env.EMAIL_FROM;
    const toCSV = process.env.EMAIL_TO;
    if(!key || !from || !toCSV) return { skipped: true, reason: "Missing email env vars" };

    const tos = toCSV.split(",").map(s=>s.trim()).filter(Boolean);
    const sgEndpoint = "https://api.sendgrid.com/v3/mail/send";

    const results = [];
    for (const to of tos){
      const payload = {
        personalizations: [{ to: [{ email: to }] }],
        from: { email: from, name: "SWFL Auto Exchange" },
        subject: `New lead: ${nm || "Unknown"} (${formName})`,
        content: [{ type: "text/plain", value: textBody }]
      };
      const res = await fetch(sgEndpoint, {
        method: "POST",
        headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const ok = res.status === 202;
      results.push({ to, ok, status: res.status });
    }
    return { ok: results.some(r=>r.ok), results };
  }

  // --- Optional Twilio SMS ---
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
    if (fileLinks.length){
      msgLines.push(`Photos: ${fileLinks.length}`);
      msgLines.push(...fileLinks.slice(0,2).map(x=>x.url)); // keep SMS short
    }
    const smsBody = msgLines.join("\n").slice(0,1480);

    async function send(to){
      const form = new URLSearchParams();
      form.append("From", FROM);
      form.append("To", to);
      form.append("Body", smsBody);
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Authorization": `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
        body: form.toString()
      });
      return { ok: res.ok, status: res.status };
    }

    const tos = TOCSV.split(",").map(s=>s.trim()).filter(Boolean);
    const results = await Promise.all(tos.map(send));
    return { ok: results.some(r=>r.ok), results };
  }

  const emailRes = await sendEmailToEach();
  const smsRes = await maybeSendSMS();

  return {
    statusCode: 200,
    body: JSON.stringify({ ok: true, email: emailRes, sms: smsRes, files: fileLinks.length })
  };
}
