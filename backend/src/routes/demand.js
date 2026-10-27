const express = require('express');
const mongoose = require('mongoose');
const Demand = require('../models/Demand');
const Ward   = require('../models/Ward');
const { protect, authorize } = require('../middleware/auth');

const router = express.Router();

router.use(protect);

// ---------------------------------------------------------------------------
// GET /api/demand
// Query params: ward, date (YYYY-MM-DD)
// Both roles
// ---------------------------------------------------------------------------
router.get('/', async (req, res) => {
  const filter = {};

  if (req.query.ward) {
    if (!mongoose.isValidObjectId(req.query.ward))
      return res.status(400).json({ success: false, message: 'Invalid ward ID' });
    filter.ward = req.query.ward;
  }
  if (req.query.date) {
    const d = new Date(req.query.date);
    if (isNaN(d)) return res.status(400).json({ success: false, message: 'Invalid date format. Use YYYY-MM-DD' });
    // Match the full day
    const next = new Date(d);
    next.setDate(next.getDate() + 1);
    filter.demandDate = { $gte: d, $lt: next };
  }

  const records = await Demand.find(filter)
    .populate('ward', 'name')
    .sort({ demandDate: -1, ward: 1 });

  return res.status(200).json({ success: true, count: records.length, data: records });
});

// ---------------------------------------------------------------------------
// GET /api/demand/:id
// Both roles
// ---------------------------------------------------------------------------
router.get('/:id', async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id))
    return res.status(400).json({ success: false, message: 'Invalid demand ID' });

  const record = await Demand.findById(req.params.id).populate('ward', 'name');
  if (!record) return res.status(404).json({ success: false, message: 'Demand record not found' });
  return res.status(200).json({ success: true, data: record });
});

// ---------------------------------------------------------------------------
// POST /api/demand — create demand record
// Admin only
// ---------------------------------------------------------------------------
router.post('/', authorize('admin'), async (req, res) => {
  const { ward, demandDate, nominalDemand, maximumDeviation } = req.body;

  if (!ward || demandDate === undefined || nominalDemand === undefined || maximumDeviation === undefined)
    return res.status(400).json({ success: false, message: 'ward, demandDate, nominalDemand and maximumDeviation are required' });

  if (!mongoose.isValidObjectId(ward))
    return res.status(400).json({ success: false, message: 'Invalid ward ID' });

  const wardDoc = await Ward.findById(ward);
  if (!wardDoc) return res.status(404).json({ success: false, message: 'Ward not found' });

  const parsedDate = new Date(demandDate);
  if (isNaN(parsedDate)) return res.status(400).json({ success: false, message: 'Invalid demandDate. Use YYYY-MM-DD' });

  // D_i >= 0
  if (typeof nominalDemand !== 'number' || nominalDemand < 0)
    return res.status(400).json({ success: false, message: 'nominalDemand (D_i) must be a non-negative number' });

  // U_i >= 0
  if (typeof maximumDeviation !== 'number' || maximumDeviation < 0)
    return res.status(400).json({ success: false, message: 'maximumDeviation (U_i) must be a non-negative number' });

  const record = await Demand.create({ ward, demandDate: parsedDate, nominalDemand, maximumDeviation });
  await record.populate('ward', 'name');
  return res.status(201).json({ success: true, data: record });
});

// ---------------------------------------------------------------------------
// PUT /api/demand/:id — update demand values
// Admin only
// ---------------------------------------------------------------------------
router.put('/:id', authorize('admin'), async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id))
    return res.status(400).json({ success: false, message: 'Invalid demand ID' });

  const { nominalDemand, maximumDeviation, demandDate } = req.body;
  const updates = {};

  if (nominalDemand !== undefined) {
    if (typeof nominalDemand !== 'number' || nominalDemand < 0)
      return res.status(400).json({ success: false, message: 'nominalDemand (D_i) must be a non-negative number' });
    updates.nominalDemand = nominalDemand;
  }
  if (maximumDeviation !== undefined) {
    if (typeof maximumDeviation !== 'number' || maximumDeviation < 0)
      return res.status(400).json({ success: false, message: 'maximumDeviation (U_i) must be a non-negative number' });
    updates.maximumDeviation = maximumDeviation;
  }
  if (demandDate !== undefined) {
    const d = new Date(demandDate);
    if (isNaN(d)) return res.status(400).json({ success: false, message: 'Invalid demandDate. Use YYYY-MM-DD' });
    updates.demandDate = d;
  }

  if (Object.keys(updates).length === 0)
    return res.status(400).json({ success: false, message: 'No valid fields to update' });

  const record = await Demand.findByIdAndUpdate(req.params.id, updates, {
    new: true, runValidators: true,
  }).populate('ward', 'name');

  if (!record) return res.status(404).json({ success: false, message: 'Demand record not found' });
  return res.status(200).json({ success: true, data: record });
});

module.exports = router;
