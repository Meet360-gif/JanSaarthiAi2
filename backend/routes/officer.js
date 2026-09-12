const express = require('express');
const { db } = require('../db/database');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

// GET /api/officer/customers  -> real rows from the SQLite customers table
router.get('/customers', requireAuth, requireRole('officer'), (req, res) => {
  const rows = db
    .prepare(
      `SELECT id, full_name, phone, email, account_number, is_verified, is_locked, created_at
       FROM users WHERE role = 'customer' ORDER BY created_at DESC`
    )
    .all();
  res.json({ ok: true, customers: rows });
});

router.get('/customers/:id', requireAuth, requireRole('officer'), (req, res) => {
  const row = db
    .prepare(
      `SELECT id, full_name, phone, email, account_number, is_verified, is_locked, created_at
       FROM users WHERE id = ? AND role = 'customer'`
    )
    .get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Customer not found.' });
  res.json({ ok: true, customer: row });
});

module.exports = router;
