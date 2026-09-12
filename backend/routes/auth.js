const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const { db, logEvent } = require('../db/database');
const { issueOtp, verifyOtp } = require('../services/otpService');
const {
  normalizePhone,
  isValidPhone,
  isValidEmail,
  passwordStrengthError,
} = require('../utils/validators');

const router = express.Router();

const MAX_LOGIN_ATTEMPTS = parseInt(process.env.MAX_LOGIN_ATTEMPTS || '5', 10);
const LOCKOUT_MINUTES = parseInt(process.env.LOCKOUT_MINUTES || '15', 10);

// Generic limiter for anything that triggers an SMS, so nobody can spam a phone number.
const otpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 6,
  keyGenerator: (req) => normalizePhone(req.body.phone) || req.ip,
  message: { error: 'Too many codes requested. Please wait a few minutes and try again.' },
});

function maskPhone(phone) {
  return phone ? `••••••${phone.slice(-4)}` : '';
}

function signToken(user) {
  return jwt.sign(
    { id: user.id, role: user.role, phone: user.phone },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
}

function publicUser(user) {
  return {
    id: user.id,
    role: user.role,
    fullName: user.full_name,
    phone: user.phone,
    email: user.email,
    accountNumber: user.account_number,
    employeeId: user.employee_id,
    branch: user.branch,
  };
}

function generateAccountNumber() {
  return 'JS' + Math.floor(1000000000 + Math.random() * 8999999999);
}
function generateEmployeeId() {
  return 'JSO' + Math.floor(10000 + Math.random() * 89999);
}

/* ---------------------------------------------------------------------- */
/* REGISTER                                                                */
/* ---------------------------------------------------------------------- */
router.post('/register', otpLimiter, async (req, res) => {
  try {
    let { role, fullName, phone, email, password, branch } = req.body;
    phone = normalizePhone(phone);
    role = role === 'officer' ? 'officer' : 'customer';

    if (!fullName || fullName.trim().length < 2) {
      return res.status(400).json({ error: 'Please enter your full name.' });
    }
    if (!isValidPhone(phone)) {
      return res.status(400).json({ error: 'Enter a valid 10-digit mobile number.' });
    }
    if (!isValidEmail(email)) {
      return res.status(400).json({ error: 'Enter a valid email address.' });
    }
    const pwError = passwordStrengthError(password);
    if (pwError) return res.status(400).json({ error: pwError });

    const existing = db.prepare(`SELECT id, is_verified FROM users WHERE phone = ?`).get(phone);
    if (existing && existing.is_verified) {
      return res.status(409).json({ error: 'An account with this mobile number already exists.' });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    if (existing && !existing.is_verified) {
      // Re-registration attempt before verifying — refresh their details & resend OTP.
      db.prepare(
        `UPDATE users SET full_name=?, email=?, password_hash=?, branch=?, updated_at=datetime('now') WHERE id=?`
      ).run(fullName.trim(), email || null, passwordHash, branch || null, existing.id);
    } else {
      db.prepare(
        `INSERT INTO users (role, full_name, phone, email, password_hash, account_number, employee_id, branch)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        role,
        fullName.trim(),
        phone,
        email || null,
        passwordHash,
        role === 'customer' ? generateAccountNumber() : null,
        role === 'officer' ? generateEmployeeId() : null,
        branch || null
      );
    }

    await issueOtp(phone, 'register');
    logEvent(null, phone, 'register_initiated', role);

    res.json({ ok: true, phoneMasked: maskPhone(phone), message: 'OTP sent to your mobile number.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Registration failed. Please try again.' });
  }
});

router.post('/verify-registration-otp', otpLimiter, async (req, res) => {
  try {
    const phone = normalizePhone(req.body.phone);
    const { code } = req.body;
    const user = db.prepare(`SELECT * FROM users WHERE phone = ?`).get(phone);
    if (!user) return res.status(404).json({ error: 'No pending registration for this number.' });

    const result = await verifyOtp(phone, 'register', code);
    if (!result.ok) return res.status(400).json({ error: otpErrorMessage(result) });

    db.prepare(`UPDATE users SET is_verified = 1, updated_at = datetime('now') WHERE id = ?`).run(user.id);
    logEvent(user.id, phone, 'register_completed', user.role);

    const token = signToken(user);
    res.json({ ok: true, token, user: publicUser(user) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Verification failed. Please try again.' });
  }
});

/* ---------------------------------------------------------------------- */
/* LOGIN (password, then phone OTP as second factor)                      */
/* ---------------------------------------------------------------------- */
router.post('/login', otpLimiter, async (req, res) => {
  try {
    let { role, phone, password } = req.body;
    phone = normalizePhone(phone);
    role = role === 'officer' ? 'officer' : 'customer';

    const user = db.prepare(`SELECT * FROM users WHERE phone = ? AND role = ?`).get(phone, role);
    if (!user) {
      return res.status(401).json({ error: 'No account found with these details.' });
    }
    if (!user.is_verified) {
      return res.status(403).json({ error: 'Account not verified yet. Please complete registration OTP first.' });
    }
    if (user.is_locked && user.locked_until && new Date(user.locked_until) > new Date()) {
      const mins = Math.ceil((new Date(user.locked_until) - new Date()) / 60000);
      return res.status(423).json({ error: `Account temporarily locked. Try again in ${mins} minute(s).` });
    }

    const matches = await bcrypt.compare(password || '', user.password_hash);
    if (!matches) {
      const attempts = user.failed_attempts + 1;
      if (attempts >= MAX_LOGIN_ATTEMPTS) {
        const lockedUntil = new Date(Date.now() + LOCKOUT_MINUTES * 60000).toISOString();
        db.prepare(
          `UPDATE users SET failed_attempts = ?, is_locked = 1, locked_until = ? WHERE id = ?`
        ).run(attempts, lockedUntil, user.id);
        logEvent(user.id, phone, 'account_locked', `after ${attempts} failed attempts`);
        return res.status(423).json({ error: `Too many incorrect attempts. Account locked for ${LOCKOUT_MINUTES} minutes.` });
      }
      db.prepare(`UPDATE users SET failed_attempts = ? WHERE id = ?`).run(attempts, user.id);
      logEvent(user.id, phone, 'login_failed', `attempt ${attempts}`);
      return res.status(401).json({ error: 'Incorrect password.', attemptsLeft: MAX_LOGIN_ATTEMPTS - attempts });
    }

    // Password correct -> reset counters, but still require OTP as 2nd factor.
    db.prepare(`UPDATE users SET failed_attempts = 0, is_locked = 0, locked_until = NULL WHERE id = ?`).run(user.id);
    await issueOtp(phone, 'login');
    logEvent(user.id, phone, 'login_password_ok_otp_sent', role);

    res.json({ ok: true, otpRequired: true, phoneMasked: maskPhone(phone) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Login failed. Please try again.' });
  }
});

router.post('/verify-login-otp', otpLimiter, async (req, res) => {
  try {
    let { role, phone, code } = req.body;
    phone = normalizePhone(phone);
    role = role === 'officer' ? 'officer' : 'customer';

    const user = db.prepare(`SELECT * FROM users WHERE phone = ? AND role = ?`).get(phone, role);
    if (!user) return res.status(404).json({ error: 'Account not found.' });

    const result = await verifyOtp(phone, 'login', code);
    if (!result.ok) return res.status(400).json({ error: otpErrorMessage(result) });

    logEvent(user.id, phone, 'login_success', role);
    const token = signToken(user);
    res.json({ ok: true, token, user: publicUser(user) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Verification failed. Please try again.' });
  }
});

router.post('/resend-otp', otpLimiter, async (req, res) => {
  try {
    const phone = normalizePhone(req.body.phone);
    const purpose = ['register', 'login', 'reset'].includes(req.body.purpose) ? req.body.purpose : 'login';
    await issueOtp(phone, purpose);
    res.json({ ok: true, message: 'A new OTP has been sent.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not resend OTP right now.' });
  }
});

/* ---------------------------------------------------------------------- */
/* FORGOT PASSWORD  (phone OTP based reset — no email server required)    */
/* ---------------------------------------------------------------------- */
router.post('/forgot-password', otpLimiter, async (req, res) => {
  try {
    let { role, phone } = req.body;
    phone = normalizePhone(phone);
    role = role === 'officer' ? 'officer' : 'customer';

    const user = db.prepare(`SELECT * FROM users WHERE phone = ? AND role = ?`).get(phone, role);
    // Always respond success-shaped (don't reveal whether a number is registered).
    if (user) {
      await issueOtp(phone, 'reset');
      logEvent(user.id, phone, 'password_reset_requested', role);
    }
    res.json({ ok: true, message: 'If that account exists, an OTP has been sent to it.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

router.post('/reset-password', otpLimiter, async (req, res) => {
  try {
    let { role, phone, code, newPassword } = req.body;
    phone = normalizePhone(phone);
    role = role === 'officer' ? 'officer' : 'customer';

    const user = db.prepare(`SELECT * FROM users WHERE phone = ? AND role = ?`).get(phone, role);
    if (!user) return res.status(404).json({ error: 'Account not found.' });

    const result = await verifyOtp(phone, 'reset', code);
    if (!result.ok) return res.status(400).json({ error: otpErrorMessage(result) });

    const pwError = passwordStrengthError(newPassword);
    if (pwError) return res.status(400).json({ error: pwError });

    const passwordHash = await bcrypt.hash(newPassword, 12);
    db.prepare(
      `UPDATE users SET password_hash = ?, failed_attempts = 0, is_locked = 0, locked_until = NULL, updated_at = datetime('now') WHERE id = ?`
    ).run(passwordHash, user.id);
    logEvent(user.id, phone, 'password_reset_completed', role);

    res.json({ ok: true, message: 'Password updated. You can now sign in.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not reset password. Please try again.' });
  }
});

function otpErrorMessage(result) {
  switch (result.reason) {
    case 'expired':
      return 'That code has expired. Please request a new one.';
    case 'too_many_attempts':
      return 'Too many incorrect attempts. Please request a new code.';
    case 'incorrect':
      return `Incorrect code.${result.attemptsLeft >= 0 ? ` ${result.attemptsLeft} attempt(s) left.` : ''}`;
    case 'no_otp_pending':
      return 'No code was requested for this number. Please request a new one.';
    default:
      return 'Verification failed.';
  }
}

module.exports = router;
