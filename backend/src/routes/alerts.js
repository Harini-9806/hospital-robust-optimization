const express = require('express');
const mongoose = require('mongoose');
const Alert = require('../models/Alert');
const { protect, authorize } = require('../middleware/auth');

const router = express.Router();

router.use(protect);

const VALID_SEVERITIES = ['info', 'warning', 'critical', 'success'];
const VALID_SOURCES    = ['bed_capacity', 'patient_flow', 'demand', 'optimization'];

// ---------------------------------------------------------------------------
// GET /api/alerts
// Query params: severity, source, isRead (true/false)
// Both roles
// ---------------------------------------------------------------------------
router.get('/', async (req, res) => {
  const filter = {};

  if (req.query.severity) {
    if (!VALID_SEVERITIES.includes(req.query.severity))
      return res.status(400).json({ success: false, message: `Invalid severity. Must be one of: ${VALID_SEVERITIES.join(', ')}` });
    filter.severity = req.query.severity;
  }
  if (req.query.source) {
    if (!VALID_SOURCES.includes(req.query.source))
      return res.status(400).json({ success: false, message: `Invalid source. Must be one of: ${VALID_SOURCES.join(', ')}` });
    filter.source = req.query.source;
  }
  if (req.query.isRead !== undefined) {
    filter.isRead = req.query.isRead === 'true';
  }

  const alerts = await Alert.find(filter).sort({ createdAt: -1 });
  return res.status(200).json({ success: true, count: alerts.length, data: alerts });
});

// ---------------------------------------------------------------------------
// GET /api/alerts/:id
// Both roles
// ---------------------------------------------------------------------------
router.get('/:id', async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id))
    return res.status(400).json({ success: false, message: 'Invalid alert ID' });

  const alert = await Alert.findById(req.params.id);
  if (!alert) return res.status(404).json({ success: false, message: 'Alert not found' });
  return res.status(200).json({ success: true, data: alert });
});

// ---------------------------------------------------------------------------
// PUT /api/alerts/:id — mark as read or update
// Admin only
// ---------------------------------------------------------------------------
router.put('/:id', authorize('admin'), async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id))
    return res.status(400).json({ success: false, message: 'Invalid alert ID' });

  const allowed = ['isRead', 'title', 'message', 'severity'];
  const updates = Object.fromEntries(
    Object.entries(req.body).filter(([k]) => allowed.includes(k))
  );

  if (Object.keys(updates).length === 0)
    return res.status(400).json({ success: false, message: 'No valid fields to update' });

  if (updates.severity && !VALID_SEVERITIES.includes(updates.severity))
    return res.status(400).json({ success: false, message: `Invalid severity. Must be one of: ${VALID_SEVERITIES.join(', ')}` });

  const alert = await Alert.findByIdAndUpdate(req.params.id, updates, {
    new: true, runValidators: true,
  });
  if (!alert) return res.status(404).json({ success: false, message: 'Alert not found' });
  return res.status(200).json({ success: true, data: alert });
});

module.exports = router;
