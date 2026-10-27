const express = require('express');
const mongoose = require('mongoose');
const Bed  = require('../models/Bed');
const Ward = require('../models/Ward');
const Admission = require('../models/Admission');
const { protect, authorize } = require('../middleware/auth');

const router = express.Router();

router.use(protect);

const VALID_STATUSES = ['available', 'occupied', 'reserved', 'maintenance'];

// ---------------------------------------------------------------------------
// GET /api/beds
// Query params: ward=<id>, status=<status>
// Both roles
// ---------------------------------------------------------------------------
router.get('/', async (req, res) => {
  const filter = {};
  if (req.query.ward) {
    if (!mongoose.isValidObjectId(req.query.ward))
      return res.status(400).json({ success: false, message: 'Invalid ward ID in query' });
    filter.ward = req.query.ward;
  }
  if (req.query.status) {
    if (!VALID_STATUSES.includes(req.query.status))
      return res.status(400).json({ success: false, message: `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}` });
    filter.status = req.query.status;
  }

  const beds = await Bed.find(filter)
    .populate('ward', 'name')
    .sort({ ward: 1, bedNumber: 1 });

  const activeAdmissions = await Admission.find({
    status: 'active',
    bed: { $in: beds.map((bed) => bed._id) },
  }).populate('patient', 'patientId name');
  const occupants = new Map(activeAdmissions.map((admission) => [
    admission.bed.toString(), admission.patient,
  ]));
  const data = beds.map((bed) => ({
    ...bed.toObject(),
    patient: occupants.get(bed._id.toString()) || null,
  }));

  return res.status(200).json({ success: true, count: data.length, data });
});

// ---------------------------------------------------------------------------
// GET /api/beds/:id
// Both roles
// ---------------------------------------------------------------------------
router.get('/:id', async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id))
    return res.status(400).json({ success: false, message: 'Invalid bed ID' });

  const bed = await Bed.findById(req.params.id).populate('ward', 'name');
  if (!bed) return res.status(404).json({ success: false, message: 'Bed not found' });

  return res.status(200).json({ success: true, data: bed });
});

// ---------------------------------------------------------------------------
// POST /api/beds — create bed
// Admin only
// ---------------------------------------------------------------------------
router.post('/', authorize('admin'), async (req, res) => {
  const { bedNumber, ward, status } = req.body;

  if (!bedNumber || !ward)
    return res.status(400).json({ success: false, message: 'bedNumber and ward are required' });

  if (!mongoose.isValidObjectId(ward))
    return res.status(400).json({ success: false, message: 'Invalid ward ID' });

  const wardDoc = await Ward.findById(ward);
  if (!wardDoc) return res.status(404).json({ success: false, message: 'Ward not found' });

  if (status && !VALID_STATUSES.includes(status))
    return res.status(400).json({ success: false, message: `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}` });

  const bed = await Bed.create({ bedNumber: bedNumber.trim(), ward, status: status || 'available' });
  await bed.populate('ward', 'name');
  return res.status(201).json({ success: true, data: bed });
});

// ---------------------------------------------------------------------------
// PUT /api/beds/:id — update bed status
// Admin: any field
// Receptionist: status only (operational updates)
// ---------------------------------------------------------------------------
router.put('/:id', async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id))
    return res.status(400).json({ success: false, message: 'Invalid bed ID' });

  // Receptionist may only update status
  const allowedFields = req.user.role === 'admin'
    ? ['bedNumber', 'ward', 'status']
    : ['status'];

  const updates = Object.fromEntries(
    Object.entries(req.body).filter(([k]) => allowedFields.includes(k))
  );

  if (Object.keys(updates).length === 0)
    return res.status(400).json({ success: false, message: 'No valid fields to update' });

  if (updates.status && !VALID_STATUSES.includes(updates.status))
    return res.status(400).json({ success: false, message: `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}` });

  if (updates.ward) {
    if (!mongoose.isValidObjectId(updates.ward))
      return res.status(400).json({ success: false, message: 'Invalid ward ID' });
    const wardDoc = await Ward.findById(updates.ward);
    if (!wardDoc) return res.status(404).json({ success: false, message: 'Ward not found' });
  }

  const bed = await Bed.findByIdAndUpdate(req.params.id, updates, {
    new: true, runValidators: true,
  }).populate('ward', 'name');

  if (!bed) return res.status(404).json({ success: false, message: 'Bed not found' });
  return res.status(200).json({ success: true, data: bed });
});

module.exports = router;
