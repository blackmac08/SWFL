
# SWFL Auto Exchange — Easy Deploy (Sheets + SMS + HTML Email)

This ZIP is ready for Netlify. On each form submission, you’ll get:
- A row in your **Google Sheet** (`Leads` tab),
- An **SMS alert** via Twilio,
- An **HTML confirmation email** to the seller (with your logo).

## Deploy

1) **Upload to Netlify**
   Netlify → *Add new site* → *Deploy manually* → drag this ZIP.

2) **Environment Variables** (Site settings → Build & deploy → Environment)
```
GOOGLE_SERVICE_ACCOUNT_EMAIL=service-account@your-project.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----\nABC...\n-----END PRIVATE KEY-----\n
GOOGLE_SHEET_ID=<the spreadsheet ID>

ALERT_PHONE=+17409745169

TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_FROM=+1XXXXXXXXXX

SENDGRID_API_KEY=SG.xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
FROM_EMAIL=offers@swflautoexchange.com
BRAND_NAME=SWFL Auto Exchange
PUBLIC_BASE_URL=https://<your-netlify-site>.netlify.app
```

3) **Create the Google Sheet**
- In Google Drive, create a Google Sheet, copy its ID into `GOOGLE_SHEET_ID`.
- Share the Sheet with `GOOGLE_SERVICE_ACCOUNT_EMAIL` (Editor).
- Optional: import `assets/leads-sheet-template.csv` for headers.

4) **Test**
- Submit the form on your live site.
- Check **Forms**, **Functions logs**, your **Sheet**, your **phone**, and verify the **HTML email** arrives.
