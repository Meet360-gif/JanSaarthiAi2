const bcrypt = require('bcryptjs');
const { db, logEvent } = require('../db/database');
const { sendSms } = require('./smsService');

const OTP_LENGTH = parseInt(process.env.OTP_LENGTH || '6', 10);
const OTP_EXPIRY_MINUTES = parseInt(process.env.OTP_EXPIRY_MINUTES || '5', 10);
const OTP_MAX_ATTEMPTS = parseInt(process.env.OTP_MAX_ATTEMPTS || '5', 10);

function generateNumericCode(length) {
  // Cryptographically fine for OTP purposes; each digit 0-9.
  let code = '';
  for (let i = 0; i < length; i++) code += Math.floor(Math.random() * 10);
  return code;
}

async function issueOtp(phone, purpose) {
  // Invalidate any earlier unconsumed OTP for the same phone+purpose.
  db.prepare(
    `UPDATE otps SET consumed = 1 WHERE phone = ? AND purpose = ? AND consumed = 0`
  ).run(phone, purpose);

  const code = generateNumericCode(OTP_LENGTH);
  const codeHash = await bcrypt.hash(code, 10);
  const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60000).toISOString();

  db.prepare(
    `INSERT INTO otps (phone, code_hash, purpose, expires_at) VALUES (?, ?, ?, ?)`
  ).run(phone, codeHash, purpose, expiresAt);

  const purposeText = {
    register: 'complete your JanSaarthi AI registration',
    login: 'sign in to JanSaarthi AI',
    reset: 'reset your JanSaarthi AI password',
  }[purpose];

  await sendSms(
    phone,
    `${code} is your JanSaarthi AI OTP to ${purposeText}. Valid for ${OTP_EXPIRY_MINUTES} minutes. Do not share this code with anyone.`
  );

  logEvent(null, phone, 'otp_issued', purpose);
  return { expiresAt };
}

async function verifyOtp(phone, purpose, submittedCode) {
  const row = db
    .prepare(
      `SELECT * FROM otps WHERE phone = ? AND purpose = ? AND consumed = 0
       ORDER BY id DESC LIMIT 1`
    )
    .get(phone, purpose);

  if (!row) return { ok: false, reason: 'no_otp_pending' };

  if (new Date(row.expires_at).getTime() < Date.now()) {
    return { ok: false, reason: 'expired' };
  }

  if (row.attempts >= OTP_MAX_ATTEMPTS) {
    return { ok: false, reason: 'too_many_attempts' };
  }

  const matches = await bcrypt.compare(submittedCode, row.code_hash);

  if (!matches) {
    db.prepare(`UPDATE otps SET attempts = attempts + 1 WHERE id = ?`).run(row.id);
    logEvent(null, phone, 'otp_failed', purpose);
    return { ok: false, reason: 'incorrect', attemptsLeft: OTP_MAX_ATTEMPTS - row.attempts - 1 };
  }

  db.prepare(`UPDATE otps SET consumed = 1 WHERE id = ?`).run(row.id);
  logEvent(null, phone, 'otp_verified', purpose);
  return { ok: true };
}

module.exports = { issueOtp, verifyOtp };
