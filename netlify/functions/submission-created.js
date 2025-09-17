// netlify/functions/submission-created.js
// This function is automatically triggered by Netlify on every FORM submission.
// It sends a compliant SMS via Twilio using your Messaging Service SID.
//
// Required Netlify environment variables:
//   TWILIO_ACCOUNT_SID   -> ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
//   TWILIO_AUTH_TOKEN    -> your auth token
//   TWILIO_MESSAGING_SID -> MGxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
//
// Form fields expected (names from your index.html):
//   phone, full_name, make, model, year, sms_opt_in ("yes" when checked)

/** Normalize US phone numbers to E.164 (+1XXXXXXXXXX) */
function normalizeUS(num) {
  if (!num) return null;
  const digits = String(num).replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) return "+" + digits;
  if (digits.length === 10) return "+1" + digits;
  // Already E.164 or other
  if (String(num).startsWith("+")) return String(num);
  return null;
}

/** Send SMS using Twilio REST API (no SDK needed) */
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
    const payload = JSON.parse(event.body);        // Netlify event wrapper
    const data = payload && (payload.payload || payload); // form data lives under payload.payload

    const {
      phone,
      full_name,
      make,
      model,
      year,
      sms_opt_in
    } = data || {};

    // Only send if the user explicitly opted in
    if (sms_opt_in !== "yes") {
      console.log("Submission received without SMS opt-in. Skipping SMS.");
      return { statusCode: 200, body: "No SMS opt-in" };
    }

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

    console.log("Twilio message created:", {
      sid: result.sid,
      to: result.to,
      status: result.status
    });

    return {
      statusCode: 200,
      body: JSON.stringify({ ok: true, sid: result.sid })
    };
  } catch (err) {
    console.error("submission-created error:", err);
    return { statusCode: 500, body: err.message };
  }
};
