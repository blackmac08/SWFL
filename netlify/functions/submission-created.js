
/**
 * Netlify Function: submission-created (Clean plain‑text + robust URL extraction)
 * - Sends emails via SendGrid HTTP API (no npm deps required)
 * - Formats one link per line with labels
 * - Extracts URLs from strings, objects {url}, or arrays
 * - Optional Twilio SMS is supported if env vars are present
 *
 * Required env vars:
 *   SENDGRID_API_KEY, EMAIL_FROM, EMAIL_TO  (EMAIL_TO can be comma-separated)
 * Optional env vars:
 *   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM, ALERT_PHONE
 */

export async function handler(event) {
  try {
    const body = JSON.parse(event.body || "{}");
    const payload = body.payload || {};
    const data = payload.data || {};
    const human = payload.human_fields || {};
    const filesArr = Array.isArray(payload.files) ? payload.files : [];
    const formName = payload.form_name || "unknown";

    // ---- core fields (best-effort) ----
    const name = data.full_name || human["Full name"] || "";
    const phone = data.phone || human["Mobile (for quick texts)"] || data.mobile || "";
    const email = data.email || human.Email || "";
    const zip = data.zip || human["ZIP (vehicle location)"] || data.postal || "";
    const vin = data.vin || "";
    const vehicle = `${data.year||""} ${data.make||""} ${data.model||""}`.trim();

    // ---- helpers to normalize any value into URLs ----
    function pushIfUrl(key, val, out) {
      if (val == null) return;

      // string URL
      if (typeof val === "string" && /^https?:\/\//i.test(val)) {
        out.push({ key, url: val });
        return;
      }
      // object with url field
      if (typeof val === "object" && !Array.isArray(val)) {
        if (typeof val.url === "string" && /^https?:\/\//i.test(val.url)) {
          out.push({ key, url: val.url });
        }
        return;
      }
      // array of strings/objects
      if (Array.isArray(val)) {
        val.forEach((v, i) => pushIfUrl(`${key}[${i}]`, v, out));
      }
    }

    // ---- gather from all sources ----
    const gathered = [];
    (filesArr || []).forEach((f, i) => {
      if (!f) return;
      if (typeof f === "string") {
        pushIfUrl(`file[${i}]`, f, gathered);
      } else {
        // support { name, url } or any object that may itself be {url}
        pushIfUrl(f.name || `file[${i}]`, f.url || f, gathered);
      }
    });
    Object.entries(data || {}).forEach(([k, v]) => pushIfUrl(k, v, gathered));
    Object.entries(human || {}).forEach(([k, v]) => pushIfUrl(k, v, gathered));

    // ---- de-dupe by URL ----
    const seen = new Set();
    const fileLinks = gathered.filter(({ url }) => {
      if (!url || seen.has(url)) return false;
      seen.add(url);
      return true;
    });

    // ---- classify into photos vs other files ----
    const photos = [];
    const otherFiles = [];
    for (const item of fileLinks) {
      const k = (item.key || "").toLowerCase();
      const u = (item.url || "").toLowerCase();
      const looksImage = /(photo|image|img)/.test(k) || /\.(jpg|jpeg|png|webp|gif)$/i.test(u);
      (looksImage ? photos : otherFiles).push(item);
    }

    // ---- build neat plain-text email ----
    const lines = [];
    lines.push(`New submission: ${formName}`);
    if (name) lines.push(`Name: ${name}`);
    if (phone) lines.push(`Phone: ${phone}`);
    if (email) lines.push(`Email: ${email}`);
    if (zip) lines.push(`ZIP: ${zip}`);
    if (vin) lines.push(`VIN: ${vin}`);
    if (vehicle) lines.push(`Vehicle: ${vehicle}`);
    lines.push("");

    lines.push(`Photos (${photos.length}):`);
    if (photos.length) {
      photos.forEach((p, i) => lines.push(`  Photo ${i + 1}: ${p.url}`));
    } else {
      lines.push("  (none)");
    }
    lines.push("");

    const labelMap = { records: "CarFax / Records", dealer_quote_file: "Dealer Quote" };
    lines.push(`Files (${otherFiles.length}):`);
    if (otherFiles.length) {
      otherFiles.forEach(({ key, url }) => {
        const label = labelMap[(key || "").toLowerCase()] || key || "File";
        lines.push(`  ${label}: ${url}`);
      });
    } else {
      lines.push("  (none)");
    }

    const textBody = lines.join("\n");

    // ---- SendGrid (dependency-free) ----
    async function sendEmailToEach() {
      const key = process.env.SENDGRID_API_KEY;
      const from = process.env.EMAIL_FROM;
      const toCSV = process.env.EMAIL_TO;
      if (!key || !from || !toCSV) return { skipped: true, reason: "Missing email env vars" };

      const tos = toCSV.split(",").map(s => s.trim()).filter(Boolean);
      const sgEndpoint = "https://api.sendgrid.com/v3/mail/send";

      const results = [];
      for (const to of tos) {
        const mail = {
          personalizations: [{ to: [{ email: to }] }],
          from: { email: from, name: "SWFL Auto Exchange" },
          subject: `New lead: ${name || "Unknown"} (${formName})`,
          content: [{ type: "text/plain", value: textBody }]
        };
        const res = await fetch(sgEndpoint, {
          method: "POST",
          headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" },
          body: JSON.stringify(mail)
        });
        results.push({ to, status: res.status });
      }
      return { ok: results.some(r => r.status === 202), results };
    }

    // ---- Optional Twilio SMS ----
    async function maybeSendSMS() {
      const SID = process.env.TWILIO_ACCOUNT_SID;
      const TOKEN = process.env.TWILIO_AUTH_TOKEN;
      const FROM = process.env.TWILIO_FROM;
      const TOCSV = process.env.ALERT_PHONE;
      if (!SID || !TOKEN || !FROM || !TOCSV) return { skipped: true, reason: "Missing SMS env vars" };

      const endpoint = `https://api.twilio.com/2010-04-01/Accounts/${SID}/Messages.json`;
      const auth = Buffer.from(`${SID}:${TOKEN}`).toString("base64");

      const smsPieces = [];
      smsPieces.push(`New lead: ${name || "Unknown"} (${formName})`);
      if (phone) smsPieces.push(`Phone: ${phone}`);
      if (vehicle) smsPieces.push(`Vehicle: ${vehicle}`);
      if (vin) smsPieces.push(`VIN: ${vin}`);
      if (photos.length) {
        smsPieces.push(`Photos: ${photos.length}`);
        smsPieces.push(...photos.slice(0, 2).map(x => x.url));
      }
      const smsBody = smsPieces.join("\n").slice(0, 1480);

      async function send(to) {
        const form = new URLSearchParams();
        form.append("From", FROM);
        form.append("To", to);
        form.append("Body", smsBody);
        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "Authorization": `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
          body: form.toString()
        });
        return { to, status: res.status };
      }

      const tos = TOCSV.split(",").map(s => s.trim()).filter(Boolean);
      const results = await Promise.all(tos.map(send));
      return { ok: results.some(r => r.status >= 200 && r.status < 300), results };
    }

    const emailRes = await sendEmailToEach();
    const smsRes = await maybeSendSMS();

    return {
      statusCode: 200,
      body: JSON.stringify({ ok: true, email: emailRes, sms: smsRes, files: fileLinks.length })
    };
  } catch (err) {
    console.error("submission-created error:", err);
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: err.message }) };
  }
}
