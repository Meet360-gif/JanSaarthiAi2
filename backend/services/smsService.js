// Real SMS delivery, pluggable by provider.
//
// Set SMS_PROVIDER in your .env to one of: "console" | "twilio" | "msg91"
//
// "console"  costs nothing and needs no account — the OTP is printed in this
//             terminal window instead of a phone. Use it while developing.
// "twilio"   sends a real SMS anywhere in the world once you add your own
//             Account SID / Auth Token / From-number from twilio.com/console.
// "msg91"    sends a real SMS to Indian numbers once you add your own
//             Auth Key from control.msg91.com — usually cheaper for +91 numbers.
//
// Nothing else in the codebase needs to change when you switch providers —
// every route just calls sendSms(phone, message).

const axios = require('axios');

async function sendViaTwilio(phone, message) {
  const twilio = require('twilio')(
    process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_AUTH_TOKEN
  );
  return twilio.messages.create({
    body: message,
    from: process.env.TWILIO_FROM_NUMBER,
    to: phone.startsWith('+') ? phone : `+91${phone}`, // default to India country code
  });
}

async function sendViaMsg91(phone, message) {
  const bareNumber = phone.replace(/^\+?91/, '').replace(/\D/g, '');
  const url = 'https://control.msg91.com/api/v5/otp';
  return axios.post(
    url,
    {
      mobile: `91${bareNumber}`,
      message,
      sender: process.env.MSG91_SENDER_ID,
      template_id: process.env.MSG91_TEMPLATE_ID,
    },
    { headers: { authkey: process.env.MSG91_AUTH_KEY } }
  );
}

async function sendViaConsole(phone, message) {
  console.log('\n──────────── SMS (dev mode, no real network send) ────────────');
  console.log(`  TO:      ${phone}`);
  console.log(`  MESSAGE: ${message}`);
  console.log('  Switch SMS_PROVIDER in .env to "twilio" or "msg91" to send a real text.');
  console.log('────────────────────────────────────────────────────────────\n');
  return { simulated: true };
}

async function sendSms(phone, message) {
  const provider = (process.env.SMS_PROVIDER || 'console').toLowerCase();
  try {
    if (provider === 'twilio') return await sendViaTwilio(phone, message);
    if (provider === 'msg91') return await sendViaMsg91(phone, message);
    return await sendViaConsole(phone, message);
  } catch (err) {
    console.error('SMS send failed:', err.message);
    throw new Error('Could not send SMS. Check your SMS_PROVIDER credentials in .env');
  }
}

module.exports = { sendSms };
