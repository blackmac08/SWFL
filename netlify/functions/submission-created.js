// netlify/functions/submission-created.js
// Reads Netlify form fields from the most common shapes:
//  - payload.payload.data (webhook style for form notifications)
//  - payload.payload         (lambda trigger style)
//  - payload                 (fallback)
// Sends SMS via Twilio Messaging Service if user opted in.
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

async function sendTwilioSMS({ to, body }) {
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

    // Debug: log shapes and keys
    console.log("Top-level keys:", Object.keys(envelope).join(", "));
    console.log("payload keys:", body && typeof body === "object" ? Object.keys(body).join(", ") : "(none)");
    console.log("field keys:", Object.keys(fields).join(", "));
    console.log("sms_opt_in raw:", fields.sms_opt_in || fields["Sms Opt In"]);

    // Pull form fields (support both snake_case and titled keys)
    const rawOpt = fields.sms_opt_in ?? fields["Sms Opt In"];
    const opted = isOptedIn(rawOpt);

    if (!opted) {
      console.info("Submission received without SMS opt-in (interpreted). Skipping SMS.");
      return { statusCode: 200, body: "No SMS opt-in" };
    }

    const phone = fields.phone ?? fields.Phone;
    const full_name = fields.full_name ?? fields["Full Name"] ?? fields.name;
    const make = fields.make ?? fields.Make;
    const model = fields.model ?? fields.Model;
    const year = fields.year ?? fields.Year;

    const normalized = normalizeUS(phone);
    if (!normalized) {
      console.warn("Invalid phone number in submission:", phone);
      return { statusCode: 200, body: "Invalid phone number; SMS not sent." };
    }

    const name = full_name || "there";
    const yr = year ? `${year} ` : "";
    const mk = make || "";
    const md = model || "";

    const message =
      `SWFL Auto Exchange: Thanks ${name}, we received your ${yr}${mk} ${md}. ` +
      `We'll review and text you an offer shortly. Reply STOP to cancel, HELP for help.`;

    const result = await sendTwilioSMS({ to: normalized, body: message });

    console.log("Twilio message created:", { sid: result.sid, to: result.to, status: result.status });
    return { statusCode: 200, body: JSON.stringify({ ok: true, sid: result.sid }) };
  } catch (err) {
    console.error("submission-created error:", err);
    return { statusCode: 500, body: err.message };
  }
};
