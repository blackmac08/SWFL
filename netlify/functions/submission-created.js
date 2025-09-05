
// Netlify Function: submission-created
const sgMail = require('@sendgrid/mail');
const twilio = require('twilio');

exports.handler = async (event) => {
  try {
    const payload = JSON.parse(event.body || "{}").payload || {};
    const data = payload.data || {};
    const human = payload.human_fields || {};
    const filesArr = Array.isArray(payload.files) ? payload.files : [];

    // Collect file links
    function collectUrlsFrom(obj) {
      const list = [];
      if (!obj || typeof obj !== "object") return list;
      for (const [k, v] of Object.entries(obj)) {
        if (typeof v === "string" && /^https?:\/\//i.test(v)) {
          if (/(photo|file|records|carfax|dealer|image|upload)/i.test(k)) {
            list.push({ key: k, url: v });
          }
        }
        if (Array.isArray(v)) {
          v.forEach((item, i) => {
            if (typeof item === "string" && /^https?:\/\//i.test(item)) {
              list.push({ key: `${k}[${i}]`, url: item });
            }
          });
        }
      }
      return list;
    }

    const urls = [];
    for (const f of filesArr) {
      if (f && typeof f.url === "string" && /^https?:\/\//i.test(f.url)) {
        urls.push({ key: f.name || "file", url: f.url });
      }
    }
    urls.push(...collectUrlsFrom(data));
    urls.push(...collectUrlsFrom(human));

    const seen = new Set();
    const fileLinks = urls.filter(({ url }) => {
      if (seen.has(url)) return false;
      seen.add(url);
      return true;
    });

    // Email setup
    sgMail.setApiKey(process.env.SENDGRID_API_KEY);
    const emailTo = process.env.EMAIL_TO;
    const emailFrom = process.env.EMAIL_FROM || "alerts@swflautoexchange.com";

    const lines = [];
    lines.push(`New submission: ${payload.form_name}`);
    if (data.full_name) lines.push(`Name: ${data.full_name}`);
    if (data.phone) lines.push(`Phone: ${data.phone}`);
    if (data.email) lines.push(`Email: ${data.email}`);
    if (data.zip) lines.push(`ZIP: ${data.zip}`);
    if (data.vin) lines.push(`VIN: ${data.vin}`);
    if (data.year || data.make || data.model) {
      lines.push(`Vehicle: ${data.year || ""} ${data.make || ""} ${data.model || ""}`.trim());
    }
    lines.push("");
    lines.push(`Photos / Files: ${fileLinks.length}`);
    fileLinks.forEach(({ key, url }) => lines.push(`${key}: ${url}`));

    const msg = {
      to: emailTo,
      from: emailFrom,
      subject: `New lead: ${data.full_name || "Unknown"} (${payload.form_name})`,
      text: lines.join("\n"),
    };
    await sgMail.send(msg);

    // Twilio SMS (optional)
    if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
      const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
      const smsBody = `New lead from ${data.full_name || "Unknown"} (${payload.form_name}). Files: ${fileLinks.length > 0 ? fileLinks.slice(0,2).map(f => f.url).join(" ") : "None"}`;
      await client.messages.create({
        body: smsBody,
        from: process.env.TWILIO_FROM,
        to: process.env.ALERT_PHONE,
      });
    }

    return { statusCode: 200, body: JSON.stringify({ status: "ok" }) };
  } catch (err) {
    console.error("Error in submission-created:", err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
