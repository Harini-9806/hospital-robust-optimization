const express = require('express');
const mongoose = require('mongoose');
const Ward = require('../models/Ward');
const Bed  = require('../models/Bed');
const { protect, authorize } = require('../middleware/auth');

const router = express.Router();

// All ward routes require authentication
router.use(protect);

// ---------------------------------------------------------------------------
// Helper — attach live bed counts to one or many ward documents
// ---------------------------------------------------------------------------
async function attachBedStats(wards) {
  const isArray = Array.isArray(wards);
  const list = isArray ? wards : [wards];
  const wardIds = list.map((w) => w._id);

  // Single aggregation for all wards at once
  const stats = await Bed.aggregate([
    { $match: { ward: { $in: wardIds } } },
    {
      $group: {
        _id: { ward: '$ward', status: '$status' },
        count: { $sum: 1 },
      },
    },
  ]);

  // Build a lookup map: wardId -> { available, occupied, reserved, maintenance, total }
  const map = {};
  for (const s of stats) {
    const id = s._id.ward.toString();
    if (!map[id]) map[id] = { available: 0, occupied: 0, reserved: 0, maintenance: 0 };
    map[id][s._id.status] = s.count;
  }

  const result = list.map((w) => {
    const plain = w.toObject ? w.toObject() : { ...w };
    const counts = map[plain._id.toString()] || { available: 0, occupied: 0, reserved: 0, maintenance: 0 };
    return {
      ...plain,
      totalBeds:       counts.available + counts.occupied + counts.reserved + counts.maintenance,
      availableBeds:   counts.available,
      occupiedBeds:    counts.occupied,
      reservedBeds:    counts.reserved,
      maintenanceBeds: counts.maintenance,
    };
  });

  return isArray ? result : result[0];
}

// ---------------------------------------------------------------------------
// GET /api/wards — list all wards with bed stats
// Both roles
// ---------------------------------------------------------------------------
router.get('/', async (req, res) => {
  const wards = await Ward.find().sort({ name: 1 });
  const data  = await attachBedStats(wards);
  return res.status(200).json({ success: true, count: data.length, data });
});

// ---------------------------------------------------------------------------
// GET /api/wards/:id
// Both roles
// ---------------------------------------------------------------------------
router.get('/:id', async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id))
    return res.status(400).json({ success: false, message: 'Invalid ward ID' });

  const ward = await Ward.findById(req.params.id);
  if (!ward) return res.status(404).json({ success: false, message: 'Ward not found' });

  const data = await attachBedStats(ward);
  return res.status(200).json({ success: true, data });
});

// ---------------------------------------------------------------------------
// POST /api/wards — create ward
// Admin only
// ---------------------------------------------------------------------------
router.post('/', authorize('admin'), async (req, res) => {
  const { name, description } = req.body;
  if (!name) return res.status(400).json({ success: false, message: 'Ward name is required' });

  const exists = await Ward.findOne({ name: name.trim() });
  if (exists) return res.status(409).json({ success: false, message: 'Ward name already exists' });

  const ward = await Ward.create({ name: name.trim(), description });
  const data = await attachBedStats(ward);
  return res.status(201).json({ success: true, data });
});

// ---------------------------------------------------------------------------
// PUT /api/wards/:id — update ward name or description
// Admin only
// ---------------------------------------------------------------------------
router.put('/:id', authorize('admin'), async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id))
    return res.status(400).json({ success: false, message: 'Invalid ward ID' });

  const allowed = ['name', 'description'];
  const updates = Object.fromEntries(
    Object.entries(req.body).filter(([k]) => allowed.includes(k))
  );
  if (Object.keys(updates).length === 0)
    return res.status(400).json({ success: false, message: 'No valid fields to update' });

  const ward = await Ward.findByIdAndUpdate(req.params.id, updates, {
    new: true, runValidators: true,
  });
  if (!ward) return res.status(404).json({ success: false, message: 'Ward not found' });

  const data = await attachBedStats(ward);
  return res.status(200).json({ success: true, data });
});

module.exports = router;
