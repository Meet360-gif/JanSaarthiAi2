# JanSaarthi AI — Full-Stack Version

This turns the front-end-only prototype into a real full-stack app:

- **Real backend** — Node.js + Express (`/backend`)
- **Real database** — SQLite file (`/backend/db/jansaarthi.db`), created automatically. Every customer and officer registration is an actual row you can open in a tool like [DB Browser for SQLite](https://sqlitebrowser.org/).
- **Real security** — passwords hashed with bcrypt (never stored in plain text), JWT session tokens, account lockout after repeated failed logins, rate-limited OTP requests.
- **Registration, Login, Forgot Password** — all live on `index.html`, for both the Customer and Bank Officer roles, all wired to the backend via `fetch()`.
- **Real phone OTP** — the code is written to send an actual SMS via Twilio or MSG91. See "About the OTP / SMS part" below — this is the one piece that needs *your own* account, because sending a real text message to a real phone always requires a paid SMS provider.

```
jansaarthi-fullstack/
├── backend/                  ← Node.js/Express API + SQLite database
│   ├── server.js
│   ├── db/database.js        ← schema + creates jansaarthi.db
│   ├── routes/auth.js        ← register / login / OTP / forgot-password
│   ├── routes/officer.js     ← real customer list for the bank dashboard
│   ├── services/otpService.js
│   ├── services/smsService.js← Twilio / MSG91 / console(dev) providers
│   ├── middleware/auth.js
│   ├── utils/validators.js
│   └── .env.example
└── frontend/
    ├── index.html            ← sign in / create account / forgot password (rewritten)
    ├── api.js                ← shared fetch() helper the pages use to call the backend
    ├── jansaarthi_app.html         (unchanged prototype — customer app)
    ├── jansaarthi_web.html         (unchanged prototype — web portal)
    └── jansaarthi_bank_dashboard.html (unchanged prototype — officer console)
```

## 1. Run the backend

You need [Node.js](https://nodejs.org) 18+ installed.

```bash
cd backend
npm install
cp .env.example .env
npm start
```

You should see:
```
JanSaarthi backend running on http://localhost:4000
SMS provider: CONSOLE
```

That starts the API **and** creates `backend/db/jansaarthi.db` — a real SQLite database — automatically on first run.

## 2. Open the frontend

Just open `frontend/index.html` in your browser (double-click it, or serve the `frontend` folder with any static server, e.g. `npx serve frontend`). It talks to `http://localhost:4000/api` by default (see the top of `frontend/api.js` if you deploy the backend elsewhere).

Try it:
1. Pick a role (Customer or Bank officer) → **Create account** → fill the form → submit.
2. Because `SMS_PROVIDER=console` by default, the 6-digit OTP is printed **in the backend terminal window**, not sent to a phone yet. Copy it from there and type it into the OTP screen.
3. You're now a real, verified row in `jansaarthi.db`. Sign out and sign back in with the same phone/password — you'll get a fresh OTP (again printed in the terminal) as the second factor.
4. Try **Forgot password** the same way.

## 3. About the OTP / SMS part — read this

Everything in this project is fully real **except one physical fact**: making an SMS actually arrive on a phone requires a paid SMS gateway account, because carriers don't let random servers text numbers for free. There's no way around that from any codebase — mine or anyone else's — without you owning an account with a provider. I can't send it from this environment either, since I don't have network access or a provider account of my own to use on your behalf.

What I've built handles the *real* delivery path correctly — you just switch it on with your own credentials:

1. Create a free trial account at **[Twilio](https://www.twilio.com/try-twilio)** (works worldwide) or **[MSG91](https://control.msg91.com/signup/)** (often cheaper for Indian numbers, and used by many Indian fintech apps).
2. Grab your Account SID / Auth Token / phone number (Twilio) or Auth Key (MSG91).
3. In `backend/.env`, set:
   ```
   SMS_PROVIDER=twilio
   TWILIO_ACCOUNT_SID=xxxxxxxx
   TWILIO_AUTH_TOKEN=xxxxxxxx
   TWILIO_FROM_NUMBER=+1xxxxxxxxxx
   ```
   (or the equivalent `MSG91_*` values for MSG91)
4. Restart the backend (`npm start`). No other code changes needed — every OTP call (`services/otpService.js`) already routes through `services/smsService.js`, which picks whichever provider you configured. From that point on, real SMS messages go to real phones.

Until you add those credentials, the app is 100% functional for development/demo purposes — the OTP just shows up in your terminal instead of your phone, which is exactly how most companies test this locally before flipping on the paid provider for production.

## 4. Database

- Engine: **SQLite** (via `better-sqlite3`), file at `backend/db/jansaarthi.db`.
- Tables: `users` (customers + officers, one table with a `role` column), `otps` (every code ever issued, hashed, with expiry/attempts), `audit_log` (every register/login/reset event, for real audit trail).
- Inspect it any time with DB Browser for SQLite, or from the command line:
  ```bash
  sqlite3 backend/db/jansaarthi.db "select id, role, full_name, phone, is_verified from users;"
  ```
- For production you'd swap SQLite for Postgres/MySQL by changing only `backend/db/database.js` — every route uses parameterized queries already, so the SQL itself barely changes.

## 5. API reference (for wiring the other pages)

All under `http://localhost:4000/api`:

| Method | Path | Body | Purpose |
|---|---|---|---|
| POST | `/auth/register` | `{role, fullName, phone, email, password, branch}` | Create account, send OTP |
| POST | `/auth/verify-registration-otp` | `{phone, code}` | Activate account, returns JWT |
| POST | `/auth/login` | `{role, phone, password}` | Check password, send login OTP |
| POST | `/auth/verify-login-otp` | `{role, phone, code}` | Complete login, returns JWT |
| POST | `/auth/resend-otp` | `{phone, purpose}` | Resend any pending OTP |
| POST | `/auth/forgot-password` | `{role, phone}` | Send reset OTP |
| POST | `/auth/reset-password` | `{role, phone, code, newPassword}` | Set new password |
| GET | `/officer/customers` | — (needs `Authorization: Bearer <token>` of an officer) | Real customer list from the DB |

On success, `index.html` stores the JWT in `localStorage` as `jansaarthi_token` — use that same key from `jansaarthi_app.html` / `jansaarthi_bank_dashboard.html` if you want them to call protected endpoints like `/officer/customers` next.

## 6. Security notes

- Passwords: bcrypt, 12 rounds — never stored or logged in plain text.
- OTPs: hashed at rest, single-use, expire in 5 minutes, max 5 guesses, rate-limited to 6 requests / 15 min per phone number.
- Login lockout: 5 wrong passwords locks the account for 15 minutes.
- Change `JWT_SECRET` in `.env` to a long random string before this goes anywhere near production.
- This is still a learning/demo-grade project (no HTTPS, no email verification, no admin panel) — solid foundation, not a production banking system.
