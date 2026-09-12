function normalizePhone(raw) {
  if (!raw) return '';
  const digits = String(raw).replace(/\D/g, '');
  // Store as bare 10-digit Indian mobile number, e.g. "9876543210".
  return digits.length > 10 ? digits.slice(-10) : digits;
}

function isValidPhone(phone) {
  return /^[6-9]\d{9}$/.test(phone); // Indian mobile numbering rule
}

function isValidEmail(email) {
  if (!email) return true; // email optional
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function passwordStrengthError(password) {
  if (!password || password.length < 8) return 'Password must be at least 8 characters.';
  if (!/[A-Z]/.test(password)) return 'Password must include an uppercase letter.';
  if (!/[a-z]/.test(password)) return 'Password must include a lowercase letter.';
  if (!/[0-9]/.test(password)) return 'Password must include a number.';
  return null;
}

module.exports = { normalizePhone, isValidPhone, isValidEmail, passwordStrengthError };
