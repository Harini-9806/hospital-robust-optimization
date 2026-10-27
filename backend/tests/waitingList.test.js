const assert = require('node:assert/strict');
const test = require('node:test');
const mongoose = require('mongoose');

const Admission = require('../src/models/Admission');
const Bed = require('../src/models/Bed');
const Patient = require('../src/models/Patient');
const Ward = require('../src/models/Ward');
const { admitWaitingPatients } = require('../src/services/waitingList');
const patientsRouter = require('../src/routes/patients');
const admissionsRouter = require('../src/routes/admissions');

const enqueueHandler = patientsRouter.stack
  .find((layer) => layer.route?.path === '/:id/waiting-list')
  .route.stack.at(-1).handle;
const admitHandler = admissionsRouter.stack
  .find((layer) => layer.route?.path === '/' && layer.route.methods.post)
  .route.stack.at(-1).handle;
const dischargeHandler = admissionsRouter.stack
  .find((layer) => layer.route?.path === '/:id' && layer.route.methods.put)
  .route.stack.at(-1).handle;

function query(value) {
  return {
    sort: async () => value,
    populate: async () => value,
    then(resolve, reject) {
      return Promise.resolve(value).then(resolve, reject);
    },
  };
}

function installModelMocks({ patients = [], beds = [], admissions = [] } = {}) {
  const originals = {
    patientFindOne: Patient.findOne,
    patientFindOneAndUpdate: Patient.findOneAndUpdate,
    patientFindById: Patient.findById,
    bedFindOne: Bed.findOne,
    bedFindOneAndUpdate: Bed.findOneAndUpdate,
    bedExists: Bed.exists,
    admissionCreate: Admission.create,
    admissionFindOne: Admission.findOne,
    admissionFindOneAndUpdate: Admission.findOneAndUpdate,
    admissionFindById: Admission.findById,
    wardFindById: Ward.findById,
    patientFindByIdAndUpdate: Patient.findByIdAndUpdate,
  };
  const createdAdmissions = [];

  Patient.findOne = (filter) => {
    const result = patients
      .filter((patient) => patient.status === filter.status
        && String(patient.requiredWard) === String(filter.requiredWard)
        && patient.waitingListAt)
      .sort((left, right) => new Date(left.waitingListAt) - new Date(right.waitingListAt)
        || String(left._id).localeCompare(String(right._id)))[0] || null;
    return query(result);
  };
  Patient.findOneAndUpdate = (filter, update) => {
    const patient = patients.find((item) => String(item._id) === String(filter._id));
    if (!patient) return query(null);
    if (typeof filter.status === 'string' && patient.status !== filter.status) return query(null);
    if (filter.status?.$ne === 'admitted' && patient.status === 'admitted') return query(null);
    if (filter.requiredWard && String(patient.requiredWard) !== String(filter.requiredWard)) return query(null);
    if (filter.waitingListAt && new Date(patient.waitingListAt).getTime() !== new Date(filter.waitingListAt).getTime()) return query(null);
    if (filter.admissionDate && new Date(patient.admissionDate).getTime() !== new Date(filter.admissionDate).getTime()) return query(null);
    if (filter.dischargeDate && new Date(patient.dischargeDate).getTime() !== new Date(filter.dischargeDate).getTime()) return query(null);
    Object.assign(patient, update.$set);
    return query(patient);
  };
  Patient.findById = (id) => query(patients.find((patient) => String(patient._id) === String(id)) || null);
  Patient.findByIdAndUpdate = (id, update) => {
    const patient = patients.find((item) => String(item._id) === String(id));
    if (patient) Object.assign(patient, update.$set);
    return query(patient || null);
  };
  Bed.findOne = (filter) => query(beds.find((bed) => bed.status === filter.status && String(bed.ward) === String(filter.ward)) || null);
  Bed.findOneAndUpdate = (filter, update) => {
    const bed = beds.find((item) => String(item._id) === String(filter._id)
      && (!filter.ward || String(item.ward) === String(filter.ward))
      && item.status === filter.status);
    if (!bed) return query(null);
    Object.assign(bed, update.$set);
    return query(bed);
  };
  Bed.exists = async (filter) => beds.some((bed) => bed.status === filter.status && String(bed.ward) === String(filter.ward));
  Admission.create = async (record) => {
    const admission = {
      ...record,
      populate: async () => admission,
    };
    createdAdmissions.push(admission);
    return admission;
  };
  Admission.findOne = (filter) => query(admissions.find((item) => String(item.patient) === String(filter.patient)
    && item.status === filter.status) || null);
  Admission.findOneAndUpdate = (filter, update) => {
    const admission = admissions.find((item) => String(item._id) === String(filter._id)
      && item.status === filter.status);
    if (admission) Object.assign(admission, update.$set);
    return query(admission || null);
  };
  Admission.findById = (id) => query(admissions.find((item) => String(item._id) === String(id)) || null);
  Ward.findById = async (id) => ({ _id: id, name: 'General' });

  return {
    createdAdmissions,
    restore() {
      Patient.findOne = originals.patientFindOne;
      Patient.findOneAndUpdate = originals.patientFindOneAndUpdate;
      Patient.findById = originals.patientFindById;
      Bed.findOne = originals.bedFindOne;
      Bed.findOneAndUpdate = originals.bedFindOneAndUpdate;
      Bed.exists = originals.bedExists;
      Admission.create = originals.admissionCreate;
      Admission.findOne = originals.admissionFindOne;
      Admission.findOneAndUpdate = originals.admissionFindOneAndUpdate;
      Admission.findById = originals.admissionFindById;
      Ward.findById = originals.wardFindById;
      Patient.findByIdAndUpdate = originals.patientFindByIdAndUpdate;
    },
  };
}

function waitingPatient(_id, requiredWard, minute) {
  return {
    _id,
    patientId: _id,
    name: _id,
    status: 'waiting',
    requiredWard,
    waitingListAt: new Date(`2026-10-14T09:${String(minute).padStart(2, '0')}:00.000Z`),
    admissionDate: null,
  };
}

test('allocates beds by FIFO within the compatible ward and leaves other wards waiting', async () => {
  const patientRecords = [
    waitingPatient('icu-first', 'icu', 1),
    waitingPatient('general-first', 'general', 2),
    waitingPatient('general-second', 'general', 3),
  ];
  const bedRecords = [
    { _id: 'general-bed-1', ward: 'general', status: 'available' },
    { _id: 'general-bed-2', ward: 'general', status: 'available' },
    { _id: 'icu-bed-1', ward: 'icu', status: 'available' },
  ];
  const mocks = installModelMocks({ patients: patientRecords, beds: bedRecords });
  try {
    const admitted = await admitWaitingPatients('general');

    assert.deepEqual(admitted.map((item) => item.patient), ['general-first', 'general-second']);
    assert.deepEqual(mocks.createdAdmissions.map((item) => item.bed), ['general-bed-1', 'general-bed-2']);
    assert.equal(patientRecords[0].status, 'waiting');
    assert.ok(patientRecords[0].waitingListAt);
    assert.equal(bedRecords.find((item) => item._id === 'icu-bed-1').status, 'available');
    assert.ok(patientRecords[1].admissionDate instanceof Date);
    assert.equal(patientRecords[1].waitingListAt, null);
  } finally {
    mocks.restore();
  }
});

test('leaves the queue unchanged when there is no compatible available bed', async () => {
  const patientRecords = [waitingPatient('icu-waiter', 'icu', 1)];
  const bedRecords = [{ _id: 'general-bed', ward: 'general', status: 'available' }];
  const mocks = installModelMocks({ patients: patientRecords, beds: bedRecords });
  try {
    const admitted = await admitWaitingPatients('icu');
    assert.equal(admitted.length, 0);
    assert.equal(patientRecords[0].status, 'waiting');
    assert.ok(patientRecords[0].waitingListAt);
    assert.equal(bedRecords[0].status, 'available');
  } finally {
    mocks.restore();
  }
});

test('keeps a released bed available when no patients are waiting', async () => {
  const bedRecords = [{ _id: 'general-bed', ward: 'general', status: 'available' }];
  const mocks = installModelMocks({ patients: [], beds: bedRecords });
  try {
    const admitted = await admitWaitingPatients('general');
    assert.equal(admitted.length, 0);
    assert.equal(bedRecords[0].status, 'available');
    assert.equal(mocks.createdAdmissions.length, 0);
  } finally {
    mocks.restore();
  }
});

test('concurrent allocation attempts do not reuse the same patient or bed', async () => {
  const patientRecords = [
    waitingPatient('patient-1', 'general', 1),
    waitingPatient('patient-2', 'general', 2),
  ];
  const bedRecords = [
    { _id: 'bed-1', ward: 'general', status: 'available' },
    { _id: 'bed-2', ward: 'general', status: 'available' },
  ];
  const mocks = installModelMocks({ patients: patientRecords, beds: bedRecords });
  try {
    const results = await Promise.all([
      admitWaitingPatients('general'),
      admitWaitingPatients('general'),
    ]);
    const admissions = [...results[0], ...results[1]];
    assert.equal(admissions.length, 2);
    assert.equal(new Set(admissions.map((item) => String(item.patient))).size, 2);
    assert.equal(new Set(admissions.map((item) => String(item.bed))).size, 2);
    assert.equal(mocks.createdAdmissions.length, 2);
  } finally {
    mocks.restore();
  }
});

test('rejects duplicate waiting-list requests and rejects admitted patients', async () => {
  const ward = new mongoose.Types.ObjectId();
  const patient = {
    _id: new mongoose.Types.ObjectId(),
    status: 'waiting',
    requiredWard: ward,
    waitingListAt: null,
    name: 'Queue Test',
  };
  const mocks = installModelMocks({ patients: [patient], beds: [] });

  const call = async () => {
    const response = {
      statusCode: 200,
      body: null,
      status(code) { this.statusCode = code; return this; },
      json(body) { this.body = body; return this; },
    };
    await enqueueHandler({ params: { id: String(patient._id) } }, response);
    return response;
  };

  try {
    const first = await call();
    const duplicate = await call();
    assert.equal(first.statusCode, 201);
    assert.ok(patient.waitingListAt instanceof Date);
    assert.equal(duplicate.statusCode, 409);
    assert.match(duplicate.body.message, /already on the waiting list/);

    patient.status = 'admitted';
    const admitted = await call();
    assert.equal(admitted.statusCode, 409);
    assert.match(admitted.body.message, /already admitted/);
  } finally {
    mocks.restore();
  }
});

test('enqueueing a patient with an available ward bed processes the FIFO queue', async () => {
  const ward = new mongoose.Types.ObjectId();
  const patient = {
    _id: new mongoose.Types.ObjectId(),
    status: 'waiting',
    requiredWard: ward,
    waitingListAt: null,
    name: 'Queue Test',
  };
  const bed = { _id: new mongoose.Types.ObjectId(), ward, status: 'available' };
  const mocks = installModelMocks({ patients: [patient], beds: [bed] });
  const response = {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };

  try {
    await enqueueHandler({ params: { id: String(patient._id) } }, response);

    assert.equal(response.statusCode, 201);
    assert.equal(response.body.data.status, 'admitted');
    assert.equal(patient.status, 'admitted');
    assert.equal(patient.waitingListAt, null);
    assert.equal(bed.status, 'occupied');
    assert.equal(response.body.automaticallyAdmitted.length, 1);
    assert.equal(String(response.body.automaticallyAdmitted[0].patient), String(patient._id));
  } finally {
    mocks.restore();
  }
});

test('returns the persisted waiting-list status with a warning if allocation fails afterwards', async () => {
  const ward = new mongoose.Types.ObjectId();
  const patient = {
    _id: new mongoose.Types.ObjectId(),
    status: 'waiting',
    requiredWard: ward,
    waitingListAt: null,
    name: 'Queue Test',
  };
  const mocks = installModelMocks({ patients: [patient], beds: [] });
  const originalPatientFindOne = Patient.findOne;
  Patient.findOne = () => {
    throw new Error('simulated queue lookup failure');
  };
  const response = {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };

  try {
    await enqueueHandler({ params: { id: String(patient._id) } }, response);

    assert.equal(response.statusCode, 201);
    assert.equal(response.body.success, true);
    assert.equal(patient.status, 'waiting');
    assert.ok(patient.waitingListAt instanceof Date);
    assert.match(response.body.automaticAdmissionWarning, /simulated queue lookup failure/);
  } finally {
    mocks.restore();
    Patient.findOne = originalPatientFindOne;
  }
});

test('discharge releases its bed and returns the automatically admitted patient', async () => {
  const ward = new mongoose.Types.ObjectId();
  const bedId = new mongoose.Types.ObjectId();
  const patientId = new mongoose.Types.ObjectId();
  const admissionId = new mongoose.Types.ObjectId();
  const activePatient = {
    _id: patientId,
    status: 'admitted',
    dischargeDate: null,
  };
  const waiting = waitingPatient(new mongoose.Types.ObjectId(), ward, 1);
  const bed = { _id: bedId, ward, status: 'occupied' };
  const admission = {
    _id: admissionId,
    patient: patientId,
    bed: bedId,
    ward,
    status: 'active',
    admissionDate: new Date('2026-10-14T08:00:00.000Z'),
    actualDischargeDate: null,
    dischargeNotes: '',
    dischargeReason: '',
    populate: async () => admission,
  };
  const mocks = installModelMocks({
    patients: [activePatient, waiting],
    beds: [bed],
    admissions: [admission],
  });
  const response = {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };

  try {
    await dischargeHandler({
      params: { id: String(admissionId) },
      body: { status: 'discharged', actualDischargeDate: new Date().toISOString() },
    }, response);

    assert.equal(response.statusCode, 200);
    assert.equal(admission.status, 'discharged');
    assert.equal(bed.status, 'occupied');
    assert.equal(activePatient.status, 'discharged');
    assert.ok(activePatient.dischargeDate instanceof Date);
    assert.equal(waiting.status, 'admitted');
    assert.equal(response.body.automaticallyAdmitted.length, 1);
    assert.equal(String(response.body.automaticallyAdmitted[0].patient), String(waiting._id));
    assert.equal(String(response.body.automaticallyAdmitted[0].bed), String(bedId));

    const duplicateResponse = {
      statusCode: 200,
      body: null,
      status(code) { this.statusCode = code; return this; },
      json(body) { this.body = body; return this; },
    };
    await dischargeHandler({
      params: { id: String(admissionId) },
      body: { status: 'discharged' },
    }, duplicateResponse);
    assert.equal(duplicateResponse.statusCode, 409);
    assert.equal(mocks.createdAdmissions.length, 1);
  } finally {
    mocks.restore();
  }
});

test('moving an active patient to the waiting list releases the bed and admits the next same-ward patient', async () => {
  const ward = new mongoose.Types.ObjectId();
  const bedId = new mongoose.Types.ObjectId();
  const activePatientId = new mongoose.Types.ObjectId();
  const waitingPatientId = new mongoose.Types.ObjectId();
  const admissionId = new mongoose.Types.ObjectId();
  const activePatient = {
    _id: activePatientId,
    status: 'admitted',
    requiredWard: ward,
    dischargeDate: null,
    waitingListAt: null,
  };
  const nextPatient = waitingPatient(waitingPatientId, ward, 1);
  const bed = { _id: bedId, ward, status: 'occupied' };
  const admission = {
    _id: admissionId,
    patient: activePatientId,
    bed: bedId,
    ward,
    status: 'active',
    admissionDate: new Date('2026-10-14T08:00:00.000Z'),
    actualDischargeDate: null,
    dischargeNotes: '',
    dischargeReason: '',
    populate: async () => admission,
  };
  const mocks = installModelMocks({
    patients: [activePatient, nextPatient],
    beds: [bed],
    admissions: [admission],
  });
  const response = {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };

  try {
    await dischargeHandler({
      params: { id: String(admissionId) },
      body: { status: 'waiting' },
    }, response);

    assert.equal(response.statusCode, 200);
    assert.equal(admission.status, 'transferred');
    assert.equal(admission.actualDischargeDate, null);
    assert.equal(activePatient.status, 'waiting');
    assert.ok(activePatient.waitingListAt instanceof Date);
    assert.equal(activePatient.dischargeDate, null);
    assert.equal(nextPatient.status, 'admitted');
    assert.equal(String(response.body.automaticallyAdmitted[0].patient), String(waitingPatientId));
    assert.equal(String(response.body.automaticallyAdmitted[0].bed), String(bedId));
    assert.equal(bed.status, 'occupied');
  } finally {
    mocks.restore();
  }
});

test('waiting patient can only be admitted to an available bed in their required ward', async () => {
  const requiredWard = new mongoose.Types.ObjectId();
  const wrongWard = new mongoose.Types.ObjectId();
  const patientId = new mongoose.Types.ObjectId();
  const bedId = new mongoose.Types.ObjectId();
  const patient = {
    _id: patientId,
    status: 'waiting',
    requiredWard,
    waitingListAt: new Date(),
    admissionDate: null,
  };
  const bed = { _id: bedId, ward: wrongWard, status: 'available' };
  const mocks = installModelMocks({ patients: [patient], beds: [bed] });
  const response = {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };

  try {
    await admitHandler({
      body: {
        patient: String(patientId),
        bed: String(bedId),
        admissionDate: new Date().toISOString(),
      },
    }, response);

    assert.equal(response.statusCode, 409);
    assert.equal(patient.status, 'waiting');
    assert.ok(patient.waitingListAt instanceof Date);
    assert.equal(bed.status, 'available');
    assert.equal(mocks.createdAdmissions.length, 0);
  } finally {
    mocks.restore();
  }
});

test('waiting patient is admitted to a compatible available bed and removed from the queue', async () => {
  const ward = new mongoose.Types.ObjectId();
  const patientId = new mongoose.Types.ObjectId();
  const bedId = new mongoose.Types.ObjectId();
  const patient = {
    _id: patientId,
    status: 'waiting',
    requiredWard: ward,
    waitingListAt: new Date(),
    admissionDate: null,
  };
  const bed = { _id: bedId, ward, status: 'available' };
  const mocks = installModelMocks({ patients: [patient], beds: [bed] });
  const response = {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };

  try {
    await admitHandler({
      body: {
        patient: String(patientId),
        bed: String(bedId),
        admissionDate: new Date().toISOString(),
      },
    }, response);

    assert.equal(response.statusCode, 201);
    assert.equal(patient.status, 'admitted');
    assert.equal(patient.waitingListAt, null);
    assert.equal(bed.status, 'occupied');
    assert.equal(mocks.createdAdmissions.length, 1);
    assert.equal(String(mocks.createdAdmissions[0].bed), String(bedId));
  } finally {
    mocks.restore();
  }
});

test('rolls patient and admission back when the bed cannot be released', async () => {
  const patientId = new mongoose.Types.ObjectId();
  const bedId = new mongoose.Types.ObjectId();
  const admissionId = new mongoose.Types.ObjectId();
  const patient = { _id: patientId, status: 'admitted', dischargeDate: null };
  const bed = { _id: bedId, ward: new mongoose.Types.ObjectId(), status: 'available' };
  const admission = {
    _id: admissionId,
    patient: patientId,
    bed: bedId,
    status: 'active',
    actualDischargeDate: null,
    dischargeNotes: '',
    dischargeReason: '',
  };
  const mocks = installModelMocks({ patients: [patient], beds: [bed], admissions: [admission] });
  const response = {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };

  try {
    await dischargeHandler({
      params: { id: String(admissionId) },
      body: { status: 'discharged' },
    }, response);

    assert.equal(response.statusCode, 409);
    assert.equal(patient.status, 'admitted');
    assert.equal(patient.dischargeDate, null);
    assert.equal(admission.status, 'active');
    assert.equal(bed.status, 'available');
  } finally {
    mocks.restore();
  }
});

test('keeps a successful discharge consistent when waiting-list processing fails', async () => {
  const ward = new mongoose.Types.ObjectId();
  const patientId = new mongoose.Types.ObjectId();
  const bedId = new mongoose.Types.ObjectId();
  const admissionId = new mongoose.Types.ObjectId();
  const patient = { _id: patientId, status: 'admitted', dischargeDate: null };
  const bed = { _id: bedId, ward, status: 'occupied' };
  const admission = {
    _id: admissionId,
    patient: patientId,
    bed: bedId,
    ward,
    status: 'active',
    actualDischargeDate: null,
    dischargeNotes: '',
    dischargeReason: '',
    populate: async () => admission,
  };
  const mocks = installModelMocks({ patients: [patient], beds: [bed], admissions: [admission] });
  const originalPatientFindOne = Patient.findOne;
  Patient.findOne = () => {
    throw new Error('simulated queue lookup failure');
  };
  const response = {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };

  try {
    await dischargeHandler({
      params: { id: String(admissionId) },
      body: { status: 'discharged' },
    }, response);

    assert.equal(response.statusCode, 200);
    assert.equal(admission.status, 'discharged');
    assert.equal(patient.status, 'discharged');
    assert.equal(bed.status, 'available');
    assert.match(response.body.automaticAdmissionWarning, /simulated queue lookup failure/);
  } finally {
    mocks.restore();
    Patient.findOne = originalPatientFindOne;
  }
});
