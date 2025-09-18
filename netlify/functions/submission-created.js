// netlify/functions/submission-created.js
// SWFL Auto Exchange - Form submission handler
// Sends:
//  1) End-user confirmation SMS (NO media) if they opted into SMS.
//  2) Admin alert with details + photos (MMS) to configured admin numbers,
//     including links to CarFax/records and Dealer quote when present.
//
// Env vars required:
//   TWILIO_ACCOUNT_SID
//   TWILIO_AUTH_TOKEN
//   TWILIO_MESSAGING_SID
// Optional:
//   ADMIN_SMS  -> comma-separated admin numbers (E.164 or US 10-digit).
//   ALERT_PHONE -> legacy alternate for single or comma-separated admin numbers.
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

function isImageUrl(v) {
  if (!v || typeof v !== "string") return false;
  const s = v.trim().toLowerCase();
  if (!/^https?:\/\//.test(s)) return false;
  return /\.(jpg|jpeg|png|gif|webp)$/i.test(s);
}

function isUrl(v) {
  return typeof v === "string" && /^https?:\/\//i.test(v.trim());
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

exports.handler = async (event) => {
  try {
    const envelope = JSON.parse(event.body) || {};
    const body = envelope.payload || envelope || {};
    const fields = body.data || body || {};

    // Debug
    console.log("Top-level keys:", Object.keys(envelope).join(", "));
    console.log("payload keys:", body && typeof body === "object" ? Object.keys(body).join(", ") : "(none)");
    console.log("field keys:", Object.keys(fields).join(", "));

    // ---- Pull fields (title-cased or snake_case) ----
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
    const dealerQuoteVal = fields.dealer_quote ?? fields["Dealer Quote"] ?? fields["Dealer trade-in quote to beat (optional)"] ?? fields.dealerquote;
    const recordsVal = fields.records || fields["Carfax/Service records"] || fields.carfax || fields.carfax_link || fields["Carfax Link"];

    const normalizedUser = normalizeUS(phone);

    // ---- End-user confirmation (NO media) ----
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

    // ---- Build admin message body ----
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

    // Dealer quote: include numeric or text; if a URL, show as link
    if (dealerQuoteVal) {
      if (isUrl(dealerQuoteVal)) lines.push(`Dealer quote link: ${dealerQuoteVal}`);
      else lines.push(`Dealer quote: ${dealerQuoteVal}`);
    }

    // CarFax / Records: if URL present, include link
    if (recordsVal) {
      if (isUrl(recordsVal)) lines.push(`Records: ${recordsVal}`);
      else lines.push(`Records: ${recordsVal}`);
    }

    const adminBody = lines.join("\n");

    // ---- Collect media URLs for admin MMS ----
    const mediaUrls = [];
    for (const key of Object.keys(fields)) {
      if (!/photo|image|pic/i.test(key) && !/file/i.test(key)) continue;
      const val = fields[key];
      if (typeof val === "string" && isImageUrl(val)) mediaUrls.push(val);
      if (val && typeof val === "object" && typeof val.url === "string" && isImageUrl(val.url)) mediaUrls.push(val.url);
    }
    console.log("Admin media url count:", mediaUrls.length);

    // ---- Admin recipients ----
    const rawAdmins = process.env.ADMIN_SMS || process.env.ALERT_PHONE ||
      "+17409745169, +12392502000, +12395954021"; // fallback to provided numbers
    const adminTargets = String(rawAdmins).split(",").map(s => normalizeUS(s)).filter(Boolean);

    // ---- Send admin MMS; on failure, retry SMS-only ----
    for (const admin of adminTargets) {
      try {
        const r1 = await twilioSend({ to: admin, body: adminBody, mediaUrls });
        console.log("Admin MMS created:", { admin, sid: r1.sid, status: r1.status, mediaCount: mediaUrls.length });
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

    return { statusCode: 200, body: "OK" };
  } catch (err) {
    console.error("submission-created error:", err);
    return { statusCode: 500, body: err.message };
  }
};
