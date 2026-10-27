const Admission = require('../models/Admission');
const Bed = require('../models/Bed');
const Patient = require('../models/Patient');

async function admitWaitingPatients(wardId) {
  const admitted = [];

  while (true) {
    const patient = await Patient.findOne({
      status: 'waiting',
      requiredWard: wardId,
      waitingListAt: { $ne: null },
    }).sort({ waitingListAt: 1, _id: 1 });

    if (!patient) return admitted;

    const activeAdmission = await Admission.findOne({ patient: patient._id, status: 'active' });
    if (activeAdmission) {
      await Patient.findOneAndUpdate(
        {
          _id: patient._id,
          status: 'waiting',
          requiredWard: wardId,
          waitingListAt: patient.waitingListAt,
        },
        {
          $set: {
            status: 'admitted',
            admissionDate: activeAdmission.admissionDate || patient.admissionDate || null,
            waitingListAt: null,
          },
        }
      );
      continue;
    }

    const bed = await Bed.findOne({
      ward: wardId,
      status: 'available',
    }).sort({ bedNumber: 1 });

    if (!bed) return admitted;

    const claimedBed = await Bed.findOneAndUpdate(
      { _id: bed._id, ward: wardId, status: 'available' },
      { $set: { status: 'occupied' } },
      { new: true }
    );

    if (!claimedBed) continue;

    const admissionDate = new Date();
    let claimedPatient;
    try {
      claimedPatient = await Patient.findOneAndUpdate(
        {
          _id: patient._id,
          status: 'waiting',
          requiredWard: wardId,
          waitingListAt: patient.waitingListAt,
        },
        {
          $set: {
            status: 'admitted',
            admissionDate,
            waitingListAt: null,
          },
        },
        { new: true }
      );
    } catch (error) {
      await Bed.findOneAndUpdate(
        { _id: claimedBed._id, status: 'occupied' },
        { $set: { status: 'available' } }
      );
      throw error;
    }

    if (!claimedPatient) {
      await Bed.findOneAndUpdate(
        { _id: claimedBed._id, status: 'occupied' },
        { $set: { status: 'available' } }
      );
      continue;
    }

    let admission;
    try {
      admission = await Admission.create({
        patient: claimedPatient._id,
        bed: claimedBed._id,
        ward: claimedBed.ward,
        admissionDate,
        status: 'active',
      });
    } catch (error) {
      await Bed.findOneAndUpdate(
        { _id: claimedBed._id, status: 'occupied' },
        { $set: { status: 'available' } }
      );
      await Patient.findOneAndUpdate(
        { _id: claimedPatient._id, status: 'admitted', admissionDate },
        {
          $set: {
            status: 'waiting',
            admissionDate: patient.admissionDate || null,
            waitingListAt: patient.waitingListAt,
          },
        }
      );
      throw error;
    }

    await admission.populate([
      { path: 'patient', select: 'patientId name priority status requiredWard waitingListAt' },
      { path: 'bed', select: 'bedNumber status' },
      { path: 'ward', select: 'name' },
    ]);
    admitted.push(admission);
  }
}

module.exports = { admitWaitingPatients };
