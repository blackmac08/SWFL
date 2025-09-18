// netlify/functions/submission-created.js
// SWFL Auto Exchange - Combined handler (SMS/MMS + Email)
// End-user gets confirmation SMS if opted in
// Admins get MMS with photos + links (Dealer Quote, CarFax, other docs)
// Email summary via SendGrid (if configured).
// Email errors are caught and logged, never block SMS/MMS.

function normalizeUS(num) {
  if (!num) return null;
  const digits = String(num).replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) return "+" + digits;
  if (digits.length === 10) return "+1" + digits;
  if (String(num).startsWith("+")) return String(num);
  return null;
}

function isOptedIn(value) {
  if (value == null) return false;
  const v = String(value).trim().toLowerCase();
  return v === "yes" || v === "on" || v === "true" || v === "1";
}

function isImageUrl(u) { return typeof u === "string" && /\.(jpg|jpeg|png|gif|webp)(\?|#|$)/i.test(u); }
function isHttp(u) { return typeof u === "string" && /^https?:\/\//i.test(u.trim()); }

function extractUrls(value, { imagesOnly = false } = {}) {
  const urls = [];
  const pushIf = (u) => {
    if (!isHttp(u)) return;
    if (imagesOnly && !isImageUrl(u)) return;
    urls.push(u.trim());
  };
  const dig = (v) => {
    if (!v) return;
    if (typeof v === "string") pushIf(v);
    else if (Array.isArray(v)) v.forEach(dig);
    else if (typeof v === "object") {
      if (v.url) pushIf(v.url);
      if (v.href) pushIf(v.href);
      if (v.secure_url) pushIf(v.secure_url);
      if (v.public_url) pushIf(v.public_url);
    }
  };
  dig(value);
  return Array.from(new Set(urls));
}

function valueByKeysOrWords(fields, exactKeys, wordsAll) {
  for (const k of exactKeys) if (k in fields) return fields[k];
  const words = wordsAll.map(w => String(w).toLowerCase());
  for (const key of Object.keys(fields)) {
    const low = key.toLowerCase();
    if (words.every(w => low.includes(w))) return fields[key];
  }
  return undefined;
}

async function twilioSend({ to, body, mediaUrls = [] }) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken  = process.env.TWILIO_AUTH_TOKEN;
  const messagingSid = process.env.TWILIO_MESSAGING_SID;
  if (!accountSid || !authToken || !messagingSid) {
    throw new Error("Missing Twilio env vars.");
  }
  const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
  const params = new URLSearchParams();
  params.append("To", to);
  params.append("MessagingServiceSid", messagingSid);
  params.append("Body", body);
  mediaUrls.slice(0, 10).forEach(u => params.append("MediaUrl", u));

  const basic = Buffer.from(`${accountSid}:${authToken}`).toString("base64");
  const res = await fetch(url, {
    method: "POST",
    headers: { "Authorization": `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString()
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Twilio API error ${res.status}: ${text}`);
  try { return JSON.parse(text); } catch { return { raw: text }; }
}

async function sendEmail({ subject, html, text }) {
  const apiKey = process.env.SENDGRID_API_KEY;
  const from   = process.env.EMAIL_FROM;
  const toList = (process.env.EMAIL_TO || "").split(",").map(s => s.trim()).filter(Boolean);
  if (!apiKey || !from || !toList.length) {
    console.log("Email skipped (missing SENDGRID_API_KEY, EMAIL_FROM, or EMAIL_TO).");
    return;
  }
  const payload = {
    personalizations: [{ to: toList.map(email => ({ email })) }],
    from: { email: from },
    subject,
    content: [
      { type: "text/plain", value: text },
      { type: "text/html", value: html }
    ]
  };
  try {
    const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      const t = await res.text();
      console.error("SendGrid error:", res.status, t);
    } else {
      console.log("Email summary: sent");
    }
  } catch (e) {
    console.error("SendGrid exception:", e.message);
  }
}

exports.handler = async (event) => {
  try {
    const envelope = JSON.parse(event.body) || {};
    const payload  = envelope.payload || envelope || {};
    const fields   = payload.data || payload || {};

    const full_name = fields.full_name ?? fields["Full Name"] ?? fields.name ?? "there";
    const email     = fields.email ?? fields.Email;
    const phone     = fields.phone ?? fields.Phone;
    const zip       = fields.zip ?? fields.Zip;
    const vin       = fields.vin ?? fields.VIN;
    const year      = fields.year ?? fields.Year;
    const make      = fields.make ?? fields.Make;
    const model     = fields.model ?? fields.Model;
    const mileage   = fields.mileage ?? fields.Mileage;
    const issues    = fields.issues ?? fields.Issues;
    const options   = fields.options ?? fields.Options;
    const asking    = fields.asking_price ?? fields["Asking Price"];

    const dealerQuoteVal = valueByKeysOrWords(fields, ["dealer_quote", "Dealer Quote"], ["dealer", "quote"]);
    const recordsVal = valueByKeysOrWords(fields, ["records", "Carfax/Service records", "carfax"], ["carfax"]);

    // User confirmation
    const normalizedUser = normalizeUS(phone);
    const rawOpt = fields.sms_opt_in ?? fields["Sms Opt In"];
    if (isOptedIn(rawOpt) && normalizedUser) {
      const userBody = `SWFL Auto Exchange: Thanks ${full_name}! We received your info. We'll review it and text your offer today.`;
      try { await twilioSend({ to: normalizedUser, body: userBody }); } catch (e) { console.error("User SMS error:", e.message); }
    }

    const lines = [];
    lines.push("New website submission:");
    lines.push(`${year || ""} ${make || ""} ${model || ""}`.trim());
    const meta = [
      full_name ? `Name: ${full_name}` : null,
      phone ? `Phone: ${phone}` : null,
      email ? `Email: ${email}` : null,
      zip ? `ZIP: ${zip}` : null,
      vin ? `VIN: ${vin}` : null,
      mileage ? `Mileage: ${mileage}` : null,
    ].filter(Boolean).join(" • ");
    if (meta) lines.push(meta);
    if (issues)  lines.push(`Issues: ${issues}`);
    if (options) lines.push(`Options: ${options}`);
    if (asking)  lines.push(`Asking: ${asking}`);

    const dqUrls = extractUrls(dealerQuoteVal);
    if (dqUrls.length) lines.push(`Dealer quote link: ${dqUrls.join(" ")}`);
    else if (dealerQuoteVal != null) lines.push(`Dealer quote: ${dealerQuoteVal}`);
    const recUrls = extractUrls(recordsVal);
    if (recUrls.length) lines.push(`Records: ${recUrls.join(" ")}`);
    else if (recordsVal != null) lines.push(`Records: ${recordsVal}`);

    const otherFiles = [];
    for (const [key, val] of Object.entries(fields)) {
      const low = key.toLowerCase();
      if (low.includes("dealer") && low.includes("quote")) continue;
      if (low.includes("carfax") || low.includes("records")) continue;
      extractUrls(val).forEach(u => { if (!isImageUrl(u)) otherFiles.push(u); });
    }
    const uniqueOther = Array.from(new Set(otherFiles));
    if (uniqueOther.length) lines.push(`Files attached: ${uniqueOther.join(" ")}`);
    const adminBody = lines.join("\n");

    const media = [];
    for (const val of Object.values(fields)) media.push(...extractUrls(val, { imagesOnly: true }));
    const uniqueMedia = Array.from(new Set(media)).slice(0, 10);

    const rawAdmins = process.env.ADMIN_SMS || process.env.ALERT_PHONE || "+17409745169, +12392502000";
    const adminTargets = String(rawAdmins).split(",").map(s => normalizeUS(s)).filter(Boolean);
    for (const admin of adminTargets) {
      try { await twilioSend({ to: admin, body: adminBody, mediaUrls: uniqueMedia }); }
      catch (err) { try { await twilioSend({ to: admin, body: adminBody }); } catch (e2) {} }
    }

    const emailSubject = `New submission: ${[year, make, model].filter(Boolean).join(" ")}`;
    const emailText = adminBody + (uniqueOther.length ? `\nOther files: ${uniqueOther.join(" ")}` : "");
    const emailHtml = `<h2>New submission</h2><pre>${adminBody}</pre>`;
    await sendEmail({ subject: emailSubject, html: emailHtml, text: emailText });

    return { statusCode: 200, body: "OK" };
  } catch (err) {
    console.error("submission-created error:", err);
    return { statusCode: 500, body: err.message };
  }
};
