// netlify/functions/submission-created.js
// Robust version: logs incoming keys and accepts multiple truthy values for checkbox.
// Sends SMS via Twilio Messaging Service on each Netlify form submission.
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
    const payload = JSON.parse(event.body);
    const data = payload && (payload.payload || payload) || {};

    // Debug: log the keys we received and the raw sms_opt_in value
    const keys = Object.keys(data).sort();
    console.log("Submission keys:", keys.join(", "));
    console.log("sms_opt_in raw value:", data.sms_opt_in);

    const { phone, full_name, make, model, year } = data;
    const opted = isOptedIn(data.sms_opt_in);

    if (!opted) {
      console.info("Submission received without SMS opt-in (interpreted). Skipping SMS.");
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

    console.log("Twilio message created:", { sid: result.sid, to: result.to, status: result.status });
    return { statusCode: 200, body: JSON.stringify({ ok: true, sid: result.sid }) };
  } catch (err) {
    console.error("submission-created error:", err);
    return { statusCode: 500, body: err.message };
  }
};
