// netlify/functions/submission-created.js
// Enhanced: includes key fields in the SMS body and attaches image files (MMS).
// Reads Netlify form fields from payload.payload.data, payload.payload, or payload.
//
// Env vars required: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_MESSAGING_SID

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

// Heuristics: treat value as a public image URL if it looks like a URL and has an image extension
function isImageUrl(v) {
  if (!v || typeof v !== "string") return false;
  const s = v.trim().toLowerCase();
  if (!/^https?:\/\//.test(s)) return false;
  return /\.(jpg|jpeg|png|gif|webp)$/i.test(s);
}

async function sendTwilio({ to, body, mediaUrls = [] }) {
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

  // Add up to 10 media URLs
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

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Twilio API error ${res.status}: ${text}`);
  }
  return res.json();
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

    // Accept both snake_case and title-cased keys
    const rawOpt = fields.sms_opt_in ?? fields["Sms Opt In"];
    console.log("sms_opt_in raw:", rawOpt);
    const opted = isOptedIn(rawOpt);
    if (!opted) {
      console.info("Submission received without SMS opt-in (interpreted). Skipping SMS.");
      return { statusCode: 200, body: "No SMS opt-in" };
    }

    const phone = fields.phone ?? fields.Phone;
    const full_name = fields.full_name ?? fields["Full Name"] ?? fields.name;
    const zip = fields.zip ?? fields.Zip ?? fields["ZIP (vehicle location)"];
    const vin = fields.vin ?? fields.VIN ?? fields.Vin;
    const year = fields.year ?? fields.Year;
    const make = fields.make ?? fields.Make;
    const model = fields.model ?? fields.Model;
    const mileage = fields.mileage ?? fields.Mileage;
    const issues = fields.issues ?? fields.Issues ?? fields["Known issues / damage"];
    const options = fields.options ?? fields.Options ?? fields["Notable options / packages"];

    const normalized = normalizeUS(phone);
    if (!normalized) {
      console.warn("Invalid phone number in submission:", phone);
      return { statusCode: 200, body: "Invalid phone number; SMS not sent." };
    }

    // Build a concise body (SMS-friendly)
    const line1 = `SWFL Auto Exchange: Thanks ${full_name || "there"}!`;
    const line2 = `${year || ""} ${make || ""} ${model || ""}`.replace(/\s+/g, " ").trim();
    const line3 = [
      vin ? `VIN ${String(vin).slice(-8)}` : null,
      mileage ? `${mileage} mi` : null,
      zip ? `ZIP ${zip}` : null
    ].filter(Boolean).join(" • ");
    const line4 = issues ? `Issues: ${String(issues).slice(0, 100)}${String(issues).length > 100 ? "..." : ""}` : null;

    const bodyParts = [line1, line2, line3, line4, "Reply STOP to cancel, HELP for help."];
    const smsBody = bodyParts.filter(Boolean).join("\n");

    // Collect media from known fields (photo1..photo10 etc.)
    const candidateKeys = Object.keys(fields).filter(k => /photo|image|pic/i.test(k) || /file/i.test(k));
    const mediaUrls = [];
    for (const key of candidateKeys) {
      const val = fields[key];
      if (typeof val === "string" && isImageUrl(val)) mediaUrls.push(val);
      // Some integrations send { url: "..." }
      if (val && typeof val === "object" && typeof val.url === "string" && isImageUrl(val.url)) {
        mediaUrls.push(val.url);
      }
    }

    const result = await sendTwilio({ to: normalized, body: smsBody, mediaUrls });

    console.log("Twilio message created:", { sid: result.sid, to: result.to, status: result.status, mediaCount: mediaUrls.length });
    return { statusCode: 200, body: JSON.stringify({ ok: true, sid: result.sid, mediaCount: mediaUrls.length }) };
  } catch (err) {
    console.error("submission-created error:", err);
    return { statusCode: 500, body: err.message };
  }
};
