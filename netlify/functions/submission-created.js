
// Netlify Function: submission-created
const sgMail = require('@sendgrid/mail');

exports.handler = async (event) => {
  const payload = JSON.parse(event.body).payload;
  const data = payload.data;

  sgMail.setApiKey(process.env.SENDGRID_API_KEY);

  // Collect photo/file links
  let fileLinks = [];
  ['photo1','photo2','photo3','photo4','photo5','photo6','records','dealer_quote_file'].forEach((field) => {
    if (data[field]) {
      fileLinks.push(`${field.toUpperCase()}: ${data[field]}`);
    }
  });

  const msg = {
    to: process.env.EMAIL_TO.split(','),
    from: process.env.EMAIL_FROM,
    subject: `New lead: ${data.full_name} (cash-for-cars)`,
    text: `
New submission: cash-for-cars
Name: ${data.full_name}
Phone: ${data.phone}
Email: ${data.email}
ZIP: ${data.zip}
VIN: ${data.vin}
Vehicle: ${data.year} ${data.make} ${data.model}

Photos & Files:
${fileLinks.length > 0 ? fileLinks.join('\n') : "None provided"}
`
  };

  try {
    await sgMail.send(msg);
    return { statusCode: 200, body: "Email sent successfully" };
  } catch (error) {
    console.error(error);
    return { statusCode: 500, body: "Error sending email" };
  }
};
