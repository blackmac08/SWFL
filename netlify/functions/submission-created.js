// netlify/functions/submission-created.js
// SWFL Auto Exchange — SMS/MMS + Email with clean CarFax / Dealer Quote links
// - Submitter: confirmation SMS (no media) when opted in
// - Admins: MMS with photos + labeled links (CarFax PDF, Dealer Quote PDF, other docs)
// - Email: full summary with BUTTONS for CarFax / Dealer Quote
// Email errors are caught/logged and NEVER block SMS/MMS.

function normalizeUS(num) {
  if (!num) return null;
  const d = String(num).replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("1")) return "+" + d;
  if (d.length === 10) return "+1" + d;
  if (String(num).startsWith("+")) return String(num);
  return null;
}

function isOptedIn(v) {
  if (v == null) return false;
  const s = String(v).trim().toLowerCase();
  return s === "yes" || s === "on" || s === "true" || s === "1";
}

function isHttp(u) {
  return typeof u === "string" && /^https?:\/\//i.test(u.trim());
}
function isImageUrl(u) {
  return typeof u === "string" && /\.(jpg|jpeg|png|gif|webp)(\?|#|$)/i.test(u);
}
function isDocUrl(u) {
  return typeof u === "string" && /\.(pdf|doc|docx|xls|xlsx|csv|txt)(\?|#|$)/i.test(u);
}
// Filter out obvious homepages (no path/extension)
function isLikelyHomepage(u) {
  try {
    const x = new URL(u);
    const noPath = (x.pathname === "/" || x.pathname === "");
    const noExt  = !/\.[a-z0-9]{2,8}$/i.test(x.pathname);
    return noPath && noExt;
  } catch { return false; }
}

// Extract URLs from strings/arrays/objects; optional predicate (isImageUrl/isDocUrl)
function extractUrls(value, { predicate = null } = {}) {
  const out = [];
  const pushIf = (u) => {
    if (!isHttp(u)) return;
    if (predicate && !predicate(u)) return;
    out.push(u.trim());
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
  // de-dupe & drop homepages
  return Array.from(new Set(out)).filter(u => !isLikelyHomepage(u));
}

// Find value by exact keys or by keys that include ALL provided words (case-insensitive)
function valueByKeysOrWords(fields, exactKeys, wordsAll) {
  for (const k of exactKeys) if (k in fields) return fields[k];
  const words = wordsAll.map(w => String(w).toLowerCase());
  for (const key of Object.keys(fields)) {
    const low = key.toLowerCase();
    if (words.every(w => low.includes(w))) return fields[key];
  }
  return undefined;
}

// NEW: find doc URLs anywhere by matching words in the field name (e.g., "dealer"+"quote")
function docUrlsByKeyWords(fields, wordsAll) {
  const words = wordsAll.map(w => String(w).toLowerCase());
  const out = [];
  for (const [key, val] of Object.entries(fields)) {
    const low = key.toLowerCase();
    if (words.every(w => low.includes(w))) {
      extractUrls(val, { predicate: isDocUrl }).forEach(u => out.push(u));
    }
  }
  return Array.from(new Set(out));
}

async function twilioSend({ to, body, mediaUrls = [] }) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken  = process.env.TWILIO_AUTH_TOKEN;
  const messagingSid = process.env.TWILIO_MESSAGING_SID;
  if (!accountSid || !authToken || !messagingSid) {
    throw new Error("Missing Twilio env vars (TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN/TWILIO_MESSAGING_SID).");
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

    // Common fields
    const full_name = fields.full_name ?? fields["Full Name"] ?? fields.name ?? "there";
    const email     = fields.email ?? fields.Email;
    const phone     = fields.phone ?? fields.Phone;
    const zip       = fields.zip ?? fields.Zip ?? fields["ZIP (vehicle location)"];
    const vin       = fields.vin ?? fields.VIN ?? fields.Vin;
    const year      = fields.year ?? fields.Year;
    const make      = fields.make ?? fields.Make;
    const model     = fields.model ?? fields.Model;
    const mileage   = fields.mileage ?? fields.Mileage;
    const issues    = fields.issues ?? fields.Issues ?? fields["Known issues / damage"];
    const options   = fields.options ?? fields.Options ?? fields["Notable options / packages"];
    const asking    = fields.asking_price ?? fields["Asking Price"] ?? fields["Asking price (optional)"];

    // Specific inputs that may hold links/uploads
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

    // Submitter confirmation (no media)
    const normalizedUser = normalizeUS(phone);
    const rawOpt = fields.sms_opt_in ?? fields["Sms Opt In"];
    if (isOptedIn(rawOpt) && normalizedUser) {
      const userBody =
        `SWFL Auto Exchange: Thanks ${full_name}! We received your info. ` +
        `We’ll review it and text your offer today (usually same day). ` +
        `Reply STOP to cancel, HELP for help.`;
      try { await twilioSend({ to: normalizedUser, body: userBody }); } catch (e) { console.error("User SMS error:", e.message); }
    }

    // Build admin SMS/MMS body
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
    if (issues)  lines.push(`Issues: ${String(issues).slice(0, 200)}${String(issues).length > 200 ? "..." : ""}`);
    if (options) lines.push(`Options: ${String(options).slice(0, 160)}${String(options).length > 160 ? "..." : ""}`);
    if (asking)  lines.push(`Asking: ${asking}`);

    // Labeled doc links (SMS/MMS) — Dealer Quote now mirrors CarFax behavior
    const dqDocs = Array.from(new Set([
      ...extractUrls(dealerQuoteVal, { predicate: isDocUrl }),
      ...docUrlsByKeyWords(fields, ["dealer", "quote"])
    ]));
    const cfDocs = Array.from(new Set([
      ...extractUrls(recordsVal, { predicate: isDocUrl }),
      ...docUrlsByKeyWords(fields, ["carfax"])
    ]));
    if (dqDocs.length) lines.push(`Dealer Quote (PDF): ${dqDocs.join(" ")}`);
    if (cfDocs.length) lines.push(`CarFax (PDF): ${cfDocs.join(" ")}`);

    // Other non-image document links found anywhere in payload (filtered)
    const otherDocs = [];
    for (const [key, val] of Object.entries(fields)) {
      const low = key.toLowerCase();
      if (low.includes("dealer") && low.includes("quote")) continue;
      if (low.includes("carfax") || low.includes("records")) continue;
      extractUrls(val, { predicate: isDocUrl }).forEach(u => otherDocs.push(u));
    }
    const uniqueOtherDocs = Array.from(new Set(otherDocs));
    if (uniqueOtherDocs.length) lines.push(`Other files: ${uniqueOtherDocs.join(" ")}`);

    const adminBody = lines.join("\n");

    // Photos for MMS (images only)
    const media = [];
    for (const val of Object.values(fields)) {
      extractUrls(val, { predicate: isImageUrl }).forEach(u => media.push(u));
    }
    const uniqueMedia = Array.from(new Set(media)).slice(0, 10);

    // Send to admins
    const rawAdmins = process.env.ADMIN_SMS || process.env.ALERT_PHONE ||
      "+17409745169, +12392502000, +12395954021";
    const adminTargets = String(rawAdmins).split(",").map(s => normalizeUS(s)).filter(Boolean);
    for (const admin of adminTargets) {
      try { await twilioSend({ to: admin, body: adminBody, mediaUrls: uniqueMedia }); }
      catch (err) {
        console.error("Admin MMS failed, retrying SMS-only:", admin, err.message);
        try { await twilioSend({ to: admin, body: adminBody, mediaUrls: [] }); } catch (e2) {
          console.error("Admin SMS fallback failed:", admin, e2.message);
        }
      }
    }

    // ===== Email (non-blocking) =====
    const emailSubject = `New submission: ${[year, make, model].filter(Boolean).join(" ") || "Vehicle"}`;

    // Buttons for email (inline CSS so it renders everywhere)
    const button = (url, label) =>
      `<a href="${url}" target="_blank" style="display:inline-block;margin:6px 8px 0 0;padding:10px 14px;background:#0B5ED7;color:#fff;text-decoration:none;border-radius:6px;font-weight:600;">${label}</a>`;

    const dqButtons = dqDocs.map(u => button(u, "View Dealer Quote PDF")).join("");
    const cfButtons = cfDocs.map(u => button(u, "View CarFax PDF")).join("");
    const otherLinks = uniqueOtherDocs.map(u => `<a href="${u}">${u}</a>`).join(" ");

    const emailHtml = [
      `<h2>New submission</h2>`,
      `<p><strong>${[year, make, model].filter(Boolean).join(" ")}</strong></p>`,
      `<p><strong>Name:</strong> ${full_name || ""}<br/>
<strong>Phone:</strong> ${phone || ""}<br/>
<strong>Email:</strong> ${email || ""}<br/>
<strong>ZIP:</strong> ${zip || ""}<br/>
<strong>VIN:</strong> ${vin || ""}<br/>
<strong>Mileage:</strong> ${mileage || ""}</p>`,
      issues ? `<p><strong>Issues:</strong> ${String(issues)}</p>` : "",
      options ? `<p><strong>Options:</strong> ${String(options)}</p>` : "",
      asking  ? `<p><strong>Asking:</strong> ${String(asking)}</p>` : "",
      (dqButtons || cfButtons) ? `<p>${dqButtons}${cfButtons}</p>` : "",
      otherLinks ? `<p><strong>Other files:</strong> ${otherLinks}</p>` : "",
      uniqueMedia.length ? `<p><strong>Photos:</strong><br/>${uniqueMedia.map(u => `<a href="${u}"><img src="${u}" width="220" style="margin:4px;border-radius:4px"/></a>`).join("")}</p>` : ""
    ].filter(Boolean).join("");

    const emailTextLines = [
      ...lines, // same as SMS body with labeled links
      uniqueOtherDocs.length ? `Other files: ${uniqueOtherDocs.join(" ")}` : ""
    ].filter(Boolean);
    const emailText = emailTextLines.join("\n");

    await sendEmail({ subject: emailSubject, html: emailHtml, text: emailText });
    // (sendEmail logs errors; it won't stop SMS/MMS)

    return { statusCode: 200, body: "OK" };
  } catch (err) {
    console.error("submission-created error:", err);
    return { statusCode: 500, body: err.message };
  }
};
