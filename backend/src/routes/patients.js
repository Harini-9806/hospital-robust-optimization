const express = require('express');
const mongoose = require('mongoose');
const Patient = require('../models/Patient');
const Ward    = require('../models/Ward');
const Admission = require('../models/Admission');
const { admitWaitingPatients } = require('../services/waitingList');
const { protect } = require('../middleware/auth');

const router = express.Router();

router.use(protect);

const VALID_PRIORITIES = ['low', 'medium', 'high', 'critical'];
const VALID_STATUSES   = ['waiting', 'admitted', 'transferred', 'discharged'];
const VALID_GENDERS    = ['male', 'female', 'other'];

// ---------------------------------------------------------------------------
// GET /api/patients
// Query params: status, priority, ward
// Both roles
// ---------------------------------------------------------------------------
router.get('/', async (req, res) => {
  const filter = {};

  if (req.query.status) {
    if (!VALID_STATUSES.includes(req.query.status))
      return res.status(400).json({ success: false, message: `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}` });
    filter.status = req.query.status;
  }
  if (req.query.priority) {
    if (!VALID_PRIORITIES.includes(req.query.priority))
      return res.status(400).json({ success: false, message: `Invalid priority. Must be one of: ${VALID_PRIORITIES.join(', ')}` });
    filter.priority = req.query.priority;
  }
  if (req.query.ward) {
    if (!mongoose.isValidObjectId(req.query.ward))
      return res.status(400).json({ success: false, message: 'Invalid ward ID in query' });
    filter.requiredWard = req.query.ward;
  }

  const patients = await Patient.find(filter)
    .populate('requiredWard', 'name')
    .populate('createdBy', 'name email')
    .sort({ createdAt: -1 });

  return res.status(200).json({ success: true, count: patients.length, data: patients });
});

// ---------------------------------------------------------------------------
// POST /api/patients/:id/waiting-list — enqueue a patient for their required ward
// ---------------------------------------------------------------------------
router.post('/:id/waiting-list', async (req, res) => {
  let patientEnqueued = false;
  let enqueuedPatient = null;
  let automaticallyAdmitted = [];
  try {
    if (!mongoose.isValidObjectId(req.params.id))
      return res.status(400).json({ success: false, message: 'Invalid patient ID' });

    const patient = await Patient.findById(req.params.id);
    if (!patient) return res.status(404).json({ success: false, message: 'Patient not found' });
    if (patient.status === 'admitted')
      return res.status(409).json({ success: false, message: 'Patient is already admitted' });
    if (patient.status !== 'waiting')
      return res.status(409).json({ success: false, message: 'Only patients awaiting admission can join the waiting list' });
    if (patient.waitingListAt)
      return res.status(409).json({ success: false, message: 'Patient is already on the waiting list' });
    if (!patient.requiredWard)
      return res.status(400).json({ success: false, message: 'A required ward must be selected before joining the waiting list' });

    const ward = await Ward.findById(patient.requiredWard);
    if (!ward) return res.status(404).json({ success: false, message: 'Required ward not found' });

    const activeAdmission = await Admission.findOne({ patient: patient._id, status: 'active' });
    if (activeAdmission)
      return res.status(409).json({ success: false, message: 'Patient already has an active admission' });

    const waitingListAt = new Date();
    const updated = await Patient.findOneAndUpdate(
      {
        _id: patient._id,
        status: 'waiting',
        requiredWard: patient.requiredWard,
        $or: [{ waitingListAt: null }, { waitingListAt: { $exists: false } }],
      },
      { $set: { waitingListAt } },
      { new: true }
    ).populate('requiredWard', 'name');

    if (!updated)
      return res.status(409).json({ success: false, message: 'Patient status changed; refresh and try again' });

    enqueuedPatient = updated;
    patientEnqueued = true;
    automaticallyAdmitted = await admitWaitingPatients(patient.requiredWard);
    const currentPatient = await Patient.findById(updated._id).populate('requiredWard', 'name');
    return res.status(201).json({
      success: true,
      data: currentPatient,
      automaticallyAdmitted,
    });
  } catch (error) {
    console.error('Failed to add patient to waiting list:', error);
    if (patientEnqueued) {
      return res.status(201).json({
        success: true,
        data: enqueuedPatient,
        automaticallyAdmitted,
        automaticAdmissionWarning: `Patient was added to the waiting list, but follow-up bed allocation failed: ${error.message}`,
      });
    }
    return res.status(500).json({
      success: false,
      message: `Unable to add patient to the waiting list: ${error.message}`,
    });
  }
});

// ---------------------------------------------------------------------------
// GET /api/patients/:id
// Both roles
// ---------------------------------------------------------------------------
router.get('/:id', async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id))
    return res.status(400).json({ success: false, message: 'Invalid patient ID' });

  const patient = await Patient.findById(req.params.id)
    .populate('requiredWard', 'name')
    .populate('createdBy', 'name email');

  if (!patient) return res.status(404).json({ success: false, message: 'Patient not found' });
  return res.status(200).json({ success: true, data: patient });
});

// ---------------------------------------------------------------------------
// POST /api/patients — register new patient
// Both roles
// ---------------------------------------------------------------------------
router.post('/', async (req, res) => {
  const {
    patientId, name, age, gender, medicalCondition,
    phoneNumber, emergencyContact,
    priority, requiredWard, expectedLengthOfStay,
    admissionDate, dischargeDate, status,
  } = req.body;

  // Required field validation
  if (!patientId || !name || age === undefined || !gender)
    return res.status(400).json({ success: false, message: 'patientId, name, age and gender are required' });

  if (!VALID_GENDERS.includes(gender))
    return res.status(400).json({ success: false, message: `Invalid gender. Must be one of: ${VALID_GENDERS.join(', ')}` });

  if (typeof age !== 'number' || age < 0 || age > 150)
    return res.status(400).json({ success: false, message: 'Age must be a number between 0 and 150' });

  if (priority && !VALID_PRIORITIES.includes(priority))
    return res.status(400).json({ success: false, message: `Invalid priority. Must be one of: ${VALID_PRIORITIES.join(', ')}` });

  if (status && !VALID_STATUSES.includes(status))
    return res.status(400).json({ success: false, message: `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}` });
  if (status === 'admitted')
    return res.status(400).json({ success: false, message: 'Patients must be admitted through the admissions API' });

  // Validate ward reference if provided
  if (requiredWard) {
    if (!mongoose.isValidObjectId(requiredWard))
      return res.status(400).json({ success: false, message: 'Invalid ward ID' });
    const wardDoc = await Ward.findById(requiredWard);
    if (!wardDoc) return res.status(404).json({ success: false, message: 'Ward not found' });
  }

  // Check unique patientId
  const exists = await Patient.findOne({ patientId: patientId.trim() });
  if (exists) return res.status(409).json({ success: false, message: `Patient ID '${patientId}' already exists` });

  const patient = await Patient.create({
    patientId: patientId.trim(),
    name: name.trim(),
    age,
    gender,
    phoneNumber,
    emergencyContact,
    medicalCondition,
    priority: priority || 'medium',
    requiredWard: requiredWard || null,
    expectedLengthOfStay: expectedLengthOfStay || null,
    admissionDate: admissionDate || null,
    dischargeDate: dischargeDate || null,
    status: status || 'waiting',
    createdBy: req.user._id,
  });

  await patient.populate('requiredWard', 'name');
  return res.status(201).json({ success: true, data: patient });
});

// ---------------------------------------------------------------------------
// PUT /api/patients/:id — update patient
// Both roles
// ---------------------------------------------------------------------------
router.put('/:id', async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id))
    return res.status(400).json({ success: false, message: 'Invalid patient ID' });

  const allowed = [
    'name', 'age', 'gender', 'phoneNumber', 'emergencyContact', 'medicalCondition', 'priority',
    'requiredWard', 'expectedLengthOfStay', 'admissionDate',
    'dischargeDate', 'status',
  ];
  const updates = Object.fromEntries(
    Object.entries(req.body).filter(([k]) => allowed.includes(k))
  );

  if (Object.keys(updates).length === 0)
    return res.status(400).json({ success: false, message: 'No valid fields to update' });

  // Validate individual fields if present
  if (updates.age !== undefined && (typeof updates.age !== 'number' || updates.age < 0 || updates.age > 150))
    return res.status(400).json({ success: false, message: 'Age must be a number between 0 and 150' });

  if (updates.gender && !VALID_GENDERS.includes(updates.gender))
    return res.status(400).json({ success: false, message: `Invalid gender. Must be one of: ${VALID_GENDERS.join(', ')}` });

  if (updates.priority && !VALID_PRIORITIES.includes(updates.priority))
    return res.status(400).json({ success: false, message: `Invalid priority. Must be one of: ${VALID_PRIORITIES.join(', ')}` });

  if (updates.status && !VALID_STATUSES.includes(updates.status))
    return res.status(400).json({ success: false, message: `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}` });

  if (updates.requiredWard) {
    if (!mongoose.isValidObjectId(updates.requiredWard))
      return res.status(400).json({ success: false, message: 'Invalid ward ID' });
    const wardDoc = await Ward.findById(updates.requiredWard);
    if (!wardDoc) return res.status(404).json({ success: false, message: 'Ward not found' });
  }

  if (updates.status === 'admitted')
    return res.status(409).json({ success: false, message: 'Patients must be admitted through the admissions API' });

  if (updates.status !== undefined || updates.requiredWard !== undefined) {
    const currentPatient = await Patient.findById(req.params.id);
    if (!currentPatient)
      return res.status(404).json({ success: false, message: 'Patient not found' });

    const activeAdmission = await Admission.findOne({ patient: currentPatient._id, status: 'active' });
    if ((currentPatient.status === 'admitted' || activeAdmission) && updates.status && updates.status !== 'admitted')
      return res.status(409).json({ success: false, message: 'Use the admissions API to discharge or transfer an admitted patient' });

    if (activeAdmission && updates.requiredWard !== undefined
      && String(updates.requiredWard || '') !== String(activeAdmission.ward)) {
      return res.status(409).json({ success: false, message: 'Required ward cannot differ from an active admission ward' });
    }

    if (currentPatient.waitingListAt && updates.requiredWard !== undefined
      && String(updates.requiredWard || '') !== String(currentPatient.requiredWard)) {
      return res.status(409).json({ success: false, message: 'Remove the patient from the waiting list before changing the required ward' });
    }
  }

  const patient = await Patient.findByIdAndUpdate(req.params.id, updates, {
    new: true, runValidators: true,
  })
    .populate('requiredWard', 'name')
    .populate('createdBy', 'name email');

  if (!patient) return res.status(404).json({ success: false, message: 'Patient not found' });
  return res.status(200).json({ success: true, data: patient });
});

module.exports = router;
