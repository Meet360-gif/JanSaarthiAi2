// Talks to the real backend in ../backend (run `npm start` there first).
// Change API_BASE if you deploy the backend somewhere other than localhost:4000.
const API_BASE = window.JANSAARTHI_API_BASE || 'http://localhost:4000/api';

async function apiCall(path, body) {
  let res, data;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
    data = await res.json();
  } catch (err) {
    throw new Error('Could not reach the server. Is the backend running on ' + API_BASE + '?');
  }
  if (!res.ok) {
    const err = new Error(data.error || 'Request failed.');
    err.data = data;
    err.status = res.status;
    throw err;
  }
  return data;
}

const Api = {
  register: (payload) => apiCall('/auth/register', payload),
  verifyRegistrationOtp: (payload) => apiCall('/auth/verify-registration-otp', payload),
  login: (payload) => apiCall('/auth/login', payload),
  verifyLoginOtp: (payload) => apiCall('/auth/verify-login-otp', payload),
  resendOtp: (payload) => apiCall('/auth/resend-otp', payload),
  forgotPassword: (payload) => apiCall('/auth/forgot-password', payload),
  resetPassword: (payload) => apiCall('/auth/reset-password', payload),
};
