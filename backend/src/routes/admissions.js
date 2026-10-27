const express = require('express');
const mongoose = require('mongoose');
const Admission = require('../models/Admission');
const Bed       = require('../models/Bed');
const Patient   = require('../models/Patient');
const { admitWaitingPatients } = require('../services/waitingList');
const { protect } = require('../middleware/auth');

const router = express.Router();

router.use(protect);

// ---------------------------------------------------------------------------
// GET /api/admissions
// Query params: status, ward, patient
// Both roles
// ---------------------------------------------------------------------------
router.get('/', async (req, res) => {
  const filter = {};
  if (req.query.status) filter.status = req.query.status;
  if (req.query.ward) {
    if (!mongoose.isValidObjectId(req.query.ward))
      return res.status(400).json({ success: false, message: 'Invalid ward ID' });
    filter.ward = req.query.ward;
  }
  if (req.query.patient) {
    if (!mongoose.isValidObjectId(req.query.patient))
      return res.status(400).json({ success: false, message: 'Invalid patient ID' });
    filter.patient = req.query.patient;
  }

  const admissions = await Admission.find(filter)
    .populate('patient', 'patientId name priority status')
    .populate('bed', 'bedNumber status')
    .populate('ward', 'name')
    .sort({ admissionDate: -1 });

  return res.status(200).json({ success: true, count: admissions.length, data: admissions });
});

// ---------------------------------------------------------------------------
// GET /api/admissions/:id
// Both roles
// ---------------------------------------------------------------------------
router.get('/:id', async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id))
    return res.status(400).json({ success: false, message: 'Invalid admission ID' });

  const admission = await Admission.findById(req.params.id)
    .populate('patient', 'patientId name age gender priority status')
    .populate('bed', 'bedNumber status')
    .populate('ward', 'name');

  if (!admission) return res.status(404).json({ success: false, message: 'Admission not found' });
  return res.status(200).json({ success: true, data: admission });
});

// ---------------------------------------------------------------------------
// POST /api/admissions — admit a patient to a bed
// Both roles
//
// Integrity sequence (no replica set required):
//   Step 1 — Validate patient and atomically claim an available bed
//   Step 2 — Verify ward compatibility and atomically claim the patient
//   Step 3 — Create admission record
//   Step 4 — If creation fails, restore patient and bed state
// ---------------------------------------------------------------------------
router.post('/', async (req, res) => {
  const {
    patient, bed, admissionDate, expectedDischargeDate,
    admissionType, doctorName, medicalNotes,
  } = req.body;

  if (!patient || !bed || !admissionDate)
    return res.status(400).json({ success: false, message: 'patient, bed and admissionDate are required' });

  if (!mongoose.isValidObjectId(patient))
    return res.status(400).json({ success: false, message: 'Invalid patient ID' });
  if (!mongoose.isValidObjectId(bed))
    return res.status(400).json({ success: false, message: 'Invalid bed ID' });

  const parsedAdmissionDate = new Date(admissionDate);
  if (Number.isNaN(parsedAdmissionDate.getTime()))
    return res.status(400).json({ success: false, message: 'Invalid admissionDate' });

  // Step 1 — Verify patient
  const patientDoc = await Patient.findById(patient);
  if (!patientDoc)
    return res.status(404).json({ success: false, message: 'Patient not found' });
  if (patientDoc.status === 'admitted')
    return res.status(409).json({ success: false, message: 'Patient is already admitted' });
  if (!patientDoc.requiredWard)
    return res.status(409).json({ success: false, message: 'Patient must have a required ward before admission' });

  // Step 2 — Atomically claim the bed (only if currently available)
  const claimedBed = await Bed.findOneAndUpdate(
    { _id: bed, status: 'available' },
    { $set: { status: 'occupied' } },
    { new: true }
  );

  if (!claimedBed) {
    // Bed either does not exist or was not available
    const bedDoc = await Bed.findById(bed);
    if (!bedDoc)
      return res.status(404).json({ success: false, message: 'Bed not found' });
    return res.status(409).json({
      success: false,
      message: `Bed is not available (current status: ${bedDoc.status})`,
    });
  }

  if (patientDoc.requiredWard.toString() !== claimedBed.ward.toString()) {
    await Bed.findOneAndUpdate(
      { _id: bed, status: 'occupied' },
      { $set: { status: 'available' } }
    );
    return res.status(409).json({ success: false, message: 'Selected bed is not in the required ward' });
  }

  // Step 3 — Prevent duplicate active admission for same patient
  const existingAdmission = await Admission.findOne({ patient, status: 'active' });
  if (existingAdmission) {
    // Rollback: restore bed to available
    await Bed.findOneAndUpdate(
      { _id: bed, status: 'occupied' },
      { $set: { status: 'available' } }
    );
    return res.status(409).json({
      success: false,
      message: 'Patient already has an active admission',
    });
  }

  let claimedPatient;
  try {
    claimedPatient = await Patient.findOneAndUpdate(
      { _id: patient, status: { $ne: 'admitted' } },
      {
        $set: {
          status: 'admitted',
          admissionDate: parsedAdmissionDate,
          waitingListAt: null,
        },
      },
      { new: true }
    );
  } catch (error) {
    await Bed.findOneAndUpdate(
      { _id: bed, status: 'occupied' },
      { $set: { status: 'available' } }
    );
    console.error('Failed to reserve patient during admission:', error);
    return res.status(500).json({ success: false, message: 'Failed to reserve patient; bed assignment was rolled back' });
  }

  if (!claimedPatient) {
    await Bed.findOneAndUpdate(
      { _id: bed, status: 'occupied' },
      { $set: { status: 'available' } }
    );
    return res.status(409).json({ success: false, message: 'Patient is already admitted or no longer eligible' });
  }

  // Step 4 — Create admission record
  let admission;
  try {
    admission = await Admission.create({
      patient,
      bed,
      ward: claimedBed.ward,
      admissionDate: parsedAdmissionDate,
      expectedDischargeDate: expectedDischargeDate ? new Date(expectedDischargeDate) : null,
      admissionType: admissionType || 'normal',
      doctorName,
      medicalNotes,
      status: 'active',
    });
  } catch (err) {
    await Patient.findOneAndUpdate(
      { _id: patient, status: 'admitted', admissionDate: parsedAdmissionDate },
      {
        $set: {
          status: patientDoc.status,
          admissionDate: patientDoc.admissionDate || null,
          waitingListAt: patientDoc.waitingListAt || null,
        },
      }
    );
    await Bed.findOneAndUpdate(
      { _id: bed, status: 'occupied' },
      { $set: { status: 'available' } }
    );
    return res.status(500).json({ success: false, message: 'Failed to create admission record' });
  }

  await admission.populate([
    { path: 'patient', select: 'patientId name priority status' },
    { path: 'bed',     select: 'bedNumber status' },
    { path: 'ward',    select: 'name' },
  ]);

  return res.status(201).json({ success: true, data: admission });
});

// ---------------------------------------------------------------------------
// PUT /api/admissions/:id — discharge or transfer
// Both roles
//
// Integrity sequence:
//   Step 1 — Atomically close an active admission; concurrent duplicate requests fail
//   Step 2 — Atomically update the admitted patient
//   Step 3 — Release the occupied bed
//   If a required step fails, restore the admission and patient before responding.
//   Waiting-list allocation runs after discharge commit and reports recoverable errors.
//
// Admission records are NEVER deleted — history is preserved.
// ---------------------------------------------------------------------------
router.put('/:id', async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id))
    return res.status(400).json({ success: false, message: 'Invalid admission ID' });

  const {
    status, actualDischargeDate, expectedDischargeDate,
    dischargeNotes, dischargeReason,
  } = req.body;

  const VALID_CLOSE_STATUSES = ['discharged', 'transferred', 'waiting'];
  if (status && !VALID_CLOSE_STATUSES.includes(status))
    return res.status(400).json({
      success: false,
      message: `Status must be one of: ${VALID_CLOSE_STATUSES.join(', ')}`,
    });

  const parsedDischargeDate = actualDischargeDate ? new Date(actualDischargeDate) : null;
  if (parsedDischargeDate && Number.isNaN(parsedDischargeDate.getTime()))
    return res.status(400).json({ success: false, message: 'Invalid actualDischargeDate' });
  const parsedExpectedDischargeDate = expectedDischargeDate ? new Date(expectedDischargeDate) : null;
  if (parsedExpectedDischargeDate && Number.isNaN(parsedExpectedDischargeDate.getTime()))
    return res.status(400).json({ success: false, message: 'Invalid expectedDischargeDate' });

  const admissionUpdates = {};
  const admissionStatus = status === 'waiting' ? 'transferred' : status;
  const waitingListAt = status === 'waiting' ? new Date() : null;
  if (admissionStatus)       admissionUpdates.status               = admissionStatus;
  if (parsedDischargeDate)   admissionUpdates.actualDischargeDate  = parsedDischargeDate;
  if (status === 'discharged' && !actualDischargeDate)
    admissionUpdates.actualDischargeDate = new Date();
  if (parsedExpectedDischargeDate) admissionUpdates.expectedDischargeDate = parsedExpectedDischargeDate;
  if (dischargeNotes !== undefined) admissionUpdates.dischargeNotes = dischargeNotes;
  if (dischargeReason !== undefined) admissionUpdates.dischargeReason = dischargeReason;

  if (Object.keys(admissionUpdates).length === 0)
    return res.status(400).json({ success: false, message: 'No valid fields to update' });

  // Step 1 — Atomically close the admission (only if currently active)
  const currentAdmission = await Admission.findById(req.params.id);
  if (!currentAdmission)
    return res.status(404).json({ success: false, message: 'Admission not found' });
  if (currentAdmission.status !== 'active')
    return res.status(409).json({
      success: false,
      message: `Admission is already ${currentAdmission.status}`,
    });

  const updated = await Admission.findOneAndUpdate(
    { _id: req.params.id, status: 'active' },
    { $set: admissionUpdates },
    { new: true }
  );

  if (!updated) {
    const existing = await Admission.findById(req.params.id);
    if (!existing)
      return res.status(404).json({ success: false, message: 'Admission not found' });
    return res.status(409).json({
      success: false,
      message: `Admission is already ${existing.status}`,
    });
  }

  let automaticallyAdmitted = [];
  if (status === 'discharged' || status === 'transferred' || status === 'waiting') {
    const patientStatus = status === 'discharged'
      ? 'discharged'
      : status === 'waiting' ? 'waiting' : 'transferred';
    const dischargeDate = status === 'discharged' ? updated.actualDischargeDate : null;
    const patientUpdate = { status: patientStatus };
    if (dischargeDate) patientUpdate.dischargeDate = dischargeDate;
    if (status === 'waiting') patientUpdate.waitingListAt = waitingListAt;

    const restoreAdmission = async () => {
      const fieldsToRestore = {
        status: 'active',
        actualDischargeDate: currentAdmission.actualDischargeDate || null,
        dischargeNotes: currentAdmission.dischargeNotes || '',
        dischargeReason: currentAdmission.dischargeReason || '',
      };
      const restoredAdmission = await Admission.findOneAndUpdate(
        {
          _id: updated._id,
          status: admissionStatus,
          ...(updated.actualDischargeDate
            ? { actualDischargeDate: updated.actualDischargeDate }
            : {}),
        },
        { $set: fieldsToRestore },
        { new: true }
      );
      if (!restoredAdmission)
        throw new Error('The admission record could not be restored');
    };

    let currentPatient;
    try {
      currentPatient = await Patient.findById(updated.patient);
    } catch (error) {
      try {
        await restoreAdmission();
      } catch (recoveryError) {
        console.error('Failed to restore admission after patient lookup error:', recoveryError);
        return res.status(500).json({
          success: false,
          message: `Patient lookup failed and admission recovery was incomplete: ${recoveryError.message}`,
        });
      }
      console.error('Failed to verify patient during status update:', error);
      return res.status(500).json({ success: false, message: 'Unable to verify patient status; the update was rolled back' });
    }

    const previousPatientDischargeDate = currentPatient?.dischargeDate || null;
    const previousWaitingListAt = currentPatient?.waitingListAt || null;
    const previousRequiredWard = currentPatient?.requiredWard || null;
    if (status === 'waiting' && !currentPatient?.requiredWard)
      patientUpdate.requiredWard = updated.ward;

    let claimedPatient = null;
    const restorePatient = async () => {
      if (!claimedPatient) return;
      const patientFields = { status: 'admitted' };
      if (dischargeDate)
        patientFields.dischargeDate = previousPatientDischargeDate;
      if (status === 'waiting')
        patientFields.waitingListAt = previousWaitingListAt;
      if (status === 'waiting' && !previousRequiredWard)
        patientFields.requiredWard = null;
      const restoredPatient = await Patient.findOneAndUpdate(
        {
          _id: updated.patient,
          status: patientStatus,
          ...(dischargeDate ? { dischargeDate } : {}),
          ...(status === 'waiting' ? { waitingListAt } : {}),
        },
        { $set: patientFields },
        { new: true }
      );
      if (!restoredPatient)
        throw new Error('The patient record could not be restored');
    };

    const recoverDischarge = async () => {
      const errors = [];
      try {
        await restorePatient();
      } catch (error) {
        errors.push(error.message);
      }
      try {
        await restoreAdmission();
      } catch (error) {
        errors.push(error.message);
      }
      if (errors.length)
        throw new Error(errors.join('; '));
    };

    if (currentPatient?.status !== 'admitted') {
      try {
        await restoreAdmission();
      } catch (error) {
        console.error('Failed to restore admission after patient status conflict:', error);
        return res.status(500).json({
          success: false,
          message: `Patient status changed and admission recovery was incomplete: ${error.message}`,
        });
      }
      return res.status(409).json({
        success: false,
        message: 'Only currently admitted patients can be discharged or transferred',
      });
    }

    try {
      claimedPatient = await Patient.findOneAndUpdate(
        { _id: updated.patient, status: 'admitted' },
        { $set: patientUpdate },
        { new: true }
      );
    } catch (error) {
      try {
        await restoreAdmission();
      } catch (recoveryError) {
        console.error('Failed to restore admission after patient update error:', recoveryError);
        return res.status(500).json({
          success: false,
          message: `Patient update failed and admission recovery was incomplete: ${recoveryError.message}`,
        });
      }
      console.error('Failed to update patient status:', error);
      return res.status(500).json({ success: false, message: 'Patient update failed; the status change was rolled back' });
    }

    if (!claimedPatient) {
      try {
        await restoreAdmission();
      } catch (error) {
        console.error('Failed to restore admission after patient status conflict:', error);
        return res.status(500).json({
          success: false,
          message: `Patient status changed and admission recovery was incomplete: ${error.message}`,
        });
      }
      return res.status(409).json({
        success: false,
        message: 'Only currently admitted patients can be discharged or transferred',
      });
    }

    let releasedBed;
    try {
      releasedBed = await Bed.findOneAndUpdate(
        { _id: updated.bed, status: 'occupied' },
        { $set: { status: 'available' } },
        { new: true }
      );
    } catch (error) {
      try {
        await recoverDischarge();
      } catch (recoveryError) {
        console.error('Failed to restore discharge state after bed release error:', recoveryError);
        return res.status(500).json({
          success: false,
          message: `Bed release failed and discharge recovery was incomplete: ${recoveryError.message}`,
        });
      }
      console.error('Failed to release bed during status update:', error);
      return res.status(500).json({ success: false, message: 'Bed release failed; the status change was rolled back' });
    }
    if (!releasedBed) {
      try {
        await recoverDischarge();
      } catch (error) {
        console.error('Failed to restore discharge state after bed was not releasable:', error);
        return res.status(500).json({
          success: false,
          message: `Bed was not occupied and discharge recovery was incomplete: ${error.message}`,
        });
      }
      return res.status(409).json({
        success: false,
        message: 'The admission bed was not occupied; the status change was rolled back',
      });
    }

    try {
      automaticallyAdmitted = await admitWaitingPatients(releasedBed.ward);
    } catch (error) {
      console.error('Waiting-list admission failed after bed release:', error);
      const resultMessage = status === 'waiting'
        ? 'Patient was added to the waiting list and the bed was released'
        : 'Discharge succeeded and the bed was released';
      return res.status(200).json({
        success: true,
        data: updated,
        automaticallyAdmitted,
        automaticAdmissionWarning: `${resultMessage}, but waiting-list processing failed: ${error.message}`,
      });
    }
  }

  await updated.populate([
    { path: 'patient', select: 'patientId name status' },
    { path: 'bed',     select: 'bedNumber status' },
    { path: 'ward',    select: 'name' },
  ]);

  return res.status(200).json({ success: true, data: updated, automaticallyAdmitted });
});

module.exports = router;
