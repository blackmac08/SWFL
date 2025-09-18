// netlify/functions/submission-created.js
// SWFL Auto Exchange - Form submission handler (SMS/MMS + Email)
// - End-user: confirmation SMS (no media) if opted in
// - Admins: MMS with photos + links (Dealer Quote, CarFax, other docs)
// - Email: sends a detailed submission summary via SendGrid to EMAIL_TO
//
// Required env:
//   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_MESSAGING_SID
//   SENDGRID_API_KEY, EMAIL_FROM, EMAIL_TO
// Optional env:
//   ADMIN_SMS (comma-separated), ALERT_PHONE (comma-separated)
//
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

function isImageUrl(u) {
  if (typeof u !== "string") return false;
  return /\.(jpg|jpeg|png|gif|webp)(\?|#|$)/i.test(u);
}
function isDocUrl(u) {
  if (typeof u !== "string") return false;
  return /\.(pdf|doc|docx|xls|xlsx|csv|txt)(\?|#|$)/i.test(u);
}
function isHttp(u) {
  return typeof u === "string" && /^https?:\/\//i.test(u.trim());
}

// Extract URLs from string/object/array. Can filter by predicate.
function extractUrls(value, { predicate = null } = {}) {
  const urls = [];
  const pushIf = (u) => {
    if (!isHttp(u)) return;
    if (predicate && !predicate(u)) return;
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

// Find value by exact keys or by keys that include all provided words (case-insensitive)
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
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const messagingSid = process.env.TWILIO_MESSAGING_SID;

  if (!accountSid || !authToken || !messagingSid) {
    throw new Error("Missing Twilio env vars. Please set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_MESSAGING_SID.");
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
    headers: {
      "Authorization": `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: params.toString()
  });

  const text = await res.text();
  if (!res.ok) throw new Error(`Twilio API error ${res.status}: ${text}`);
  try { return JSON.parse(text); } catch { return { raw: text }; }
}

async function sendEmail({ subject, html, text }) {
  const apiKey = process.env.SENDGRID_API_KEY;
  const from = process.env.EMAIL_FROM;
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
  const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`SendGrid error ${res.status}: ${t}`);
  }
}

exports.handler = async (event) => {
  try {
    const envelope = JSON.parse(event.body) || {};
    const body = envelope.payload || envelope || {};
    const fields = body.data || body || {};

    console.log("Top-level keys:", Object.keys(envelope).join(", "));
    console.log("payload keys:", body && typeof body === "object" ? Object.keys(body).join(", ") : "(none)");
    console.log("field keys:", Object.keys(fields).join(", "));

    // Common fields
    const full_name = fields.full_name ?? fields["Full Name"] ?? fields.name ?? "there";
    const email = fields.email ?? fields.Email;
    const phone = fields.phone ?? fields.Phone;
    const zip = fields.zip ?? fields.Zip ?? fields["ZIP (vehicle location)"];
    const vin = fields.vin ?? fields.VIN ?? fields.Vin;
    const year = fields.year ?? fields.Year;
    const make = fields.make ?? fields.Make;
    const model = fields.model ?? fields.Model;
    const mileage = fields.mileage ?? fields.Mileage;
    const issues = fields.issues ?? fields.Issues ?? fields["Known issues / damage"];
    const options = fields.options ?? fields.Options ?? fields["Notable options / packages"];
    const asking = fields.asking_price ?? fields["Asking Price"] ?? fields["Asking price (optional)"];

    // Dealer quote & records
    const dealerQuoteVal = valueByKeysOrWords(
      fields,
      ["dealer_quote", "Dealer Quote", "Dealer trade-in quote to beat (optional)", "dealerquote"],
      ["dealer", "quote"]
    );
    const recordsVal = valueByKeysOrWords(
      fields,
      ["records", "Carfax/Service records", "carfax", "carfax_link", "Carfax Link"],
      ["carfax"]
    );

    const normalizedUser = normalizeUS(phone);

    // User confirmation (no media)
    const rawOpt = fields.sms_opt_in ?? fields["Sms Opt In"];
    console.log("sms_opt_in raw:", rawOpt);
    if (isOptedIn(rawOpt) && normalizedUser) {
      const userBody =
        `SWFL Auto Exchange: Thanks ${full_name}! We received your info. ` +
        `We’ll review it and text your offer today (usually same day). ` +
        `Reply STOP to cancel, HELP for help.`;
      try {
        const r = await twilioSend({ to: normalizedUser, body: userBody });
        console.log("User SMS created:", { sid: r.sid, to: r.to, status: r.status });
      } catch (e) {
        console.error("User SMS error:", e.message);
      }
    } else {
      console.log("User SMS not sent (no opt-in or missing phone).");
    }

    // Build admin body (SMS)
    const lines = [];
    lines.push("New website submission:");
    lines.push(`${year || ""} ${make || ""} ${model || ""}`.replace(/\s+/g, " ").trim());
    const meta = [
      full_name ? `Name: ${full_name}` : null,
      phone ? `Phone: ${phone}` : null,
      email ? `Email: ${email}` : null,
      zip ? `ZIP: ${zip}` : null,
      vin ? `VIN: ${vin}` : null,
      mileage ? `Mileage: ${mileage}` : null,
    ].filter(Boolean).join(" • ");
    if (meta) lines.push(meta);
    if (issues) lines.push(`Issues: ${String(issues).slice(0, 200)}${String(issues).length > 200 ? "..." : ""}`);
    if (options) lines.push(`Options: ${String(options).slice(0, 160)}${String(options).length > 160 ? "..." : ""}`);
    if (asking) lines.push(`Asking: ${asking}`);

    const dqDocUrls = extractUrls(dealerQuoteVal); // include any URL (pdf or otherwise)
    if (dqDocUrls.length) lines.push(`Dealer quote link: ${dqDocUrls.join(" ")}`);
    else if (dealerQuoteVal != null) lines.push(`Dealer quote: ${dealerQuoteVal}`);

    const recDocUrls = extractUrls(recordsVal);
    if (recDocUrls.length) lines.push(`Records: ${recDocUrls.join(" ")}`);
    else if (recordsVal != null) lines.push(`Records: ${recordsVal}`);

    // Other non-image file URLs
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

    // Media for admin MMS (images only)
    const media = [];
    for (const val of Object.values(fields)) {
      media.push(...extractUrls(val, { predicate: isImageUrl }));
    }
    const uniqueMedia = Array.from(new Set(media)).slice(0, 10);
    console.log("Admin media url count:", uniqueMedia.length);

    // Admin recipients
    const rawAdmins = process.env.ADMIN_SMS || process.env.ALERT_PHONE ||
      "+17409745169, +12392502000, +12395954021";
    const adminTargets = String(rawAdmins).split(",").map(s => normalizeUS(s)).filter(Boolean);

    // Send admin SMS/MMS
    for (const admin of adminTargets) {
      try {
        const r1 = await twilioSend({ to: admin, body: adminBody, mediaUrls: uniqueMedia });
        console.log("Admin MMS created:", { admin, sid: r1.sid, status: r1.status, mediaCount: uniqueMedia.length });
      } catch (err) {
        console.error("Admin MMS failed, retrying SMS-only:", admin, err.message);
        try {
          const r2 = await twilioSend({ to: admin, body: adminBody, mediaUrls: [] });
          console.log("Admin SMS fallback created:", { admin, sid: r2.sid, status: r2.status });
        } catch (e2) {
          console.error("Admin SMS fallback failed:", admin, e2.message);
        }
      }
    }

    // Build and send email summary
    const emailSubject = `New submission: ${[year, make, model].filter(Boolean).join(" ") || "Vehicle"}`;
    const htmlParts = [];
    htmlParts.push(`<h2>New website submission</h2>`);
    htmlParts.push(`<p><strong>${[year, make, model].filter(Boolean).join(" ")}</strong></p>`);
    htmlParts.push(`<p><strong>Name:</strong> ${full_name || ""}<br/>
<strong>Phone:</strong> ${phone || ""}<br/>
<strong>Email:</strong> ${email || ""}<br/>
<strong>ZIP:</strong> ${zip || ""}<br/>
<strong>VIN:</strong> ${vin || ""}<br/>
<strong>Mileage:</strong> ${mileage || ""}</p>`);
    if (issues) htmlParts.push(`<p><strong>Issues:</strong> ${String(issues)}</p>`);
    if (options) htmlParts.push(`<p><strong>Options:</strong> ${String(options)}</p>`);
    if (asking) htmlParts.push(`<p><strong>Asking:</strong> ${String(asking)}</p>`);

    if (dqDocUrls.length) htmlParts.push(`<p><strong>Dealer quote link(s):</strong> ${dqDocUrls.map(u => `<a href="${u}">${u}</a>`).join(" ")}</p>`);
    else if (dealerQuoteVal != null) htmlParts.push(`<p><strong>Dealer quote:</strong> ${dealerQuoteVal}</p>`);

    if (recDocUrls.length) htmlParts.push(`<p><strong>Records link(s):</strong> ${recDocUrls.map(u => `<a href="${u}">${u}</a>`).join(" ")}</p>`);
    else if (recordsVal != null) htmlParts.push(`<p><strong>Records:</strong> ${recordsVal}</p>`);

    if (uniqueOther.length) {
      htmlParts.push(`<p><strong>Other files:</strong> ${uniqueOther.map(u => `<a href="${u}">${u}</a>`).join(" ")}</p>`);
    }

    if (uniqueMedia.length) {
      htmlParts.push(`<p><strong>Photos:</strong><br/>` + uniqueMedia.map(u => `<a href="${u}"><img src="${u}" width="240" style="margin:4px"/></a>`).join("") + `</p>`);
    }

    const emailText = adminBody + (uniqueOther.length ? `\nOther files: ${uniqueOther.join(" ")}` : "") + (uniqueMedia.length ? `\nPhotos: ${uniqueMedia.join(" ")}` : "");

    try {
      await sendEmail({ subject: emailSubject, html: htmlParts.join(""), text: emailText });
      console.log("Email summary: sent");
    } catch (e) {
      console.error("Email summary error:", e.message);
    }

    return { statusCode: 200, body: "OK" };
  } catch (err) {
    console.error("submission-created error:", err);
    return { statusCode: 500, body: err.message };
  }
};
