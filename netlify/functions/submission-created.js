
/**
 * submission-created — SMS with photo links
 * Env vars: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM, ALERT_PHONE
 */
export async function handler(event) {
  try {
    const env = process.env;
    const payload = JSON.parse(event.body || "{}").payload || {};
    const data = payload.data || {};
    const human = payload.human_fields || {};
    const files = Array.isArray(payload.files) ? payload.files : [];

    const SID = env.TWILIO_ACCOUNT_SID;
    const TOKEN = env.TWILIO_AUTH_TOKEN;
    const FROM = env.TWILIO_FROM;
    const TOCSV = env.ALERT_PHONE;
    if (!SID || !TOKEN || !FROM || !TOCSV) {
      console.error("Missing required env vars.");
      return { statusCode: 200, body: JSON.stringify({ ok:false, reason:"Missing env vars" }) };
    }

    // Collect photo URLs from Netlify payload (files[]) and any url-y fields
    const urls = [];
    for (const f of files) {
      if (f && typeof f.url === "string" && /^https?:\/\//i.test(f.url)) urls.push(f.url);
    }
    const photoFields = ["photo1","photo2","photo3","photo4","photo5","photo6","photos","photos[]"];
    for (const k of photoFields) {
      const v = data[k];
      if (typeof v === "string" && /^https?:\/\//i.test(v)) urls.push(v);
    }
    const firstTwo = urls.slice(0, 2);

    // Compose message
    const lines = [];
    lines.push(`New submission: ${payload.form_name || "unknown"}`);
    const nm = data.full_name || human["Full name"] || "";
    if (nm) lines.push(`Name: ${nm}`);
    const ph = data.phone || human["Mobile (for quick texts)"] || data.mobile || "";
    if (ph) lines.push(`Phone: ${ph}`);
    const em = data.email || human.Email || "";
    if (em) lines.push(`Email: ${em}`);
    const zipcode = data.zip || human["ZIP (vehicle location)"] || data.postal || "";
    if (zipcode) lines.push(`ZIP: ${zipcode}`);
    if (data.vin) lines.push(`VIN: ${data.vin}`);
    const veh = `${data.year||""} ${data.make||""} ${data.model||""}`.trim();
    if (veh) lines.push(`Vehicle: ${veh}`);
    if (urls.length) {
      lines.push(`Photos: ${urls.length}`);
      for (const u of firstTwo) lines.push(u);
    }
    const bodyText = lines.join("\n").slice(0, 1480);

    // Send via Twilio REST API
    const endpoint = `https://api.twilio.com/2010-04-01/Accounts/${SID}/Messages.json`;
    const auth = Buffer.from(`${SID}:${TOKEN}`).toString("base64");
    const recipients = TOCSV.split(",").map(s=>s.trim()).filter(Boolean);

    async function send(to){
      const form = new URLSearchParams();
      form.append("From", FROM);
      form.append("To", to);
      form.append("Body", bodyText);
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Authorization": `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
        body: form.toString()
      });
      const txt = await res.text();
      console.log("Twilio status", { to, status: res.status, ok: res.ok });
      if(!res.ok) console.error("Twilio response", txt);
    }

    await Promise.all(recipients.map(send));
    return { statusCode: 200, body: JSON.stringify({ ok:true, photos: urls.length }) };
  } catch (e) {
    console.error("submission-created error", e);
    return { statusCode: 200, body: JSON.stringify({ ok:false, error:String(e) }) };
  }
}
