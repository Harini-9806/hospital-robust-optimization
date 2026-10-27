/**
 * seed.js — Inserts realistic demo data into MongoDB.
 *
 * Demo scenario (200 beds total):
 * ┌───────────┬──────┬──────────────────┬───────────────────┐
 * │ Ward      │ Beds │ Nominal Demand   │ Max Deviation     │
 * │           │      │ D_i              │ U_i               │
 * ├───────────┼──────┼──────────────────┼───────────────────┤
 * │ ICU       │  30  │       25         │        5          │
 * │ General   │  80  │       60         │       10          │
 * │ Surgical  │  50  │       35         │        8          │
 * │ Emergency │  40  │       40         │       12          │
 * └───────────┴──────┴──────────────────┴───────────────────┘
 *
 * Run:  node seed.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const User           = require('./src/models/User');
const Ward           = require('./src/models/Ward');
const Bed            = require('./src/models/Bed');
const Patient        = require('./src/models/Patient');
const Admission      = require('./src/models/Admission');
const Demand         = require('./src/models/Demand');
const OptimizationRun = require('./src/models/OptimizationRun');
const Alert          = require('./src/models/Alert');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const daysAgo = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(0, 0, 0, 0);
  return d;
};

const daysFromNow = (n) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  d.setHours(0, 0, 0, 0);
  return d;
};

const randBetween = (min, max) =>
  Math.round((Math.random() * (max - min) + min) * 10) / 10;

// ---------------------------------------------------------------------------
// Ward configuration
// ---------------------------------------------------------------------------
const WARD_CONFIG = [
  {
    name: 'ICU',
    description: 'Intensive Care Unit — critical patients requiring continuous monitoring',
    nominalDemand: 25,
    maximumDeviation: 5,
    // [status, count]
    bedDistribution: [
      ['occupied',    18],
      ['available',    8],
      ['reserved',     3],
      ['maintenance',  1],
    ],
  },
  {
    name: 'General',
    description: 'General Ward — standard inpatient care',
    nominalDemand: 60,
    maximumDeviation: 10,
    bedDistribution: [
      ['occupied',    52],
      ['available',   20],
      ['reserved',     6],
      ['maintenance',  2],
    ],
  },
  {
    name: 'Surgical',
    description: 'Surgical Ward — pre- and post-operative patients',
    nominalDemand: 35,
    maximumDeviation: 8,
    bedDistribution: [
      ['occupied',    30],
      ['available',   14],
      ['reserved',     5],
      ['maintenance',  1],
    ],
  },
  {
    name: 'Emergency',
    description: 'Emergency Department — acute and trauma patients',
    nominalDemand: 40,
    maximumDeviation: 12,
    bedDistribution: [
      ['occupied',    28],
      ['available',    8],
      ['reserved',     3],
      ['maintenance',  1],
    ],
  },
];

// ---------------------------------------------------------------------------
// Patient templates
// [name, age, gender, condition, priority, wardName, losdays, status]
// ---------------------------------------------------------------------------
const PATIENT_TEMPLATES = [
  // ICU — admitted
  ['Alice Johnson',  45, 'female', 'Cardiac Arrest',        'critical', 'ICU',       7,  'admitted'],
  ['Bob Martinez',   62, 'male',   'Post-CABG Recovery',    'high',     'ICU',       5,  'admitted'],
  ['Carol White',    38, 'female', 'Severe Pneumonia',      'high',     'ICU',       6,  'admitted'],
  ['David Lee',      71, 'male',   'Stroke',                'critical', 'ICU',       10, 'admitted'],
  // Surgical — admitted
  ['Emma Davis',     29, 'female', 'Appendectomy',          'medium',   'Surgical',  3,  'admitted'],
  ['Frank Wilson',   55, 'male',   'Hip Replacement',       'medium',   'Surgical',  5,  'admitted'],
  ['Grace Taylor',   48, 'female', 'Cholecystectomy',       'medium',   'Surgical',  2,  'admitted'],
  ['Henry Brown',    67, 'male',   'Bowel Resection',       'high',     'Surgical',  7,  'admitted'],
  // General — admitted
  ['Irene Clark',    34, 'female', 'Hypertension',          'low',      'General',   4,  'admitted'],
  ['James Lewis',    52, 'male',   'Diabetes Management',   'low',      'General',   3,  'admitted'],
  ['Karen Hall',     41, 'female', 'Asthma Exacerbation',   'medium',   'General',   2,  'admitted'],
  ['Liam Young',     78, 'male',   'COPD',                  'high',     'General',   6,  'admitted'],
  // Emergency — admitted
  ['Mia Allen',      25, 'female', 'Trauma - MVA',          'critical', 'Emergency', 1,  'admitted'],
  ['Noah Scott',     33, 'male',   'Acute Abdomen',         'high',     'Emergency', 1,  'admitted'],
  ['Olivia King',    60, 'female', 'Chest Pain',            'high',     'Emergency', 1,  'admitted'],
  ['Paul Adams',     44, 'male',   'Fracture - Femur',      'medium',   'Emergency', 2,  'admitted'],
  // Waiting
  ['Quinn Baker',    30, 'male',   'Elective Surgery',      'low',      'Surgical',  3,  'waiting'],
  ['Rachel Carter',  55, 'female', 'Cardiac Monitoring',    'medium',   'ICU',       4,  'waiting'],
  ['Samuel Evans',   47, 'male',   'Infection',             'medium',   'General',   5,  'waiting'],
  ['Tina Foster',    39, 'female', 'Abdominal Pain',        'high',     'Emergency', 1,  'waiting'],
  // Discharged (historical)
  ['Uma Green',      58, 'female', 'Pneumonia - Resolved',  'medium',   'General',   5,  'discharged'],
  ['Victor Harris',  65, 'male',   'Post-Op Recovery',      'low',      'Surgical',  4,  'discharged'],
];

// ---------------------------------------------------------------------------
// Seed functions
// ---------------------------------------------------------------------------
async function seedUsers() {
  const users = [
    {
      name: 'Admin User',
      email: 'admin@hospital.com',
      passwordHash: await bcrypt.hash('Admin@1234', 12),
      role: 'admin',
    },
    {
      name: 'Receptionist User',
      email: 'receptionist@hospital.com',
      passwordHash: await bcrypt.hash('Receptionist@1234', 12),
      role: 'receptionist',
    },
  ];

  // insertMany bypasses the pre-save hook so we pass pre-hashed passwords directly
  const created = await User.insertMany(users);
  console.log(`  ✓ Users: ${created.length}`);
  return Object.fromEntries(created.map((u) => [u.role, u]));
}

async function seedWardsAndBeds(wardConfig) {
  const wardMap = {};
  let totalBeds = 0;

  for (const cfg of wardConfig) {
    const ward = await Ward.create({ name: cfg.name, description: cfg.description });
    wardMap[cfg.name] = ward;

    const beds = [];
    let bedIndex = 1;
    const prefix = cfg.name.slice(0, 3).toUpperCase();

    for (const [status, count] of cfg.bedDistribution) {
      for (let i = 0; i < count; i++) {
        beds.push({
          bedNumber: `${prefix}-${String(bedIndex).padStart(2, '0')}`,
          ward: ward._id,
          status,
        });
        bedIndex++;
      }
    }

    await Bed.insertMany(beds);
    totalBeds += beds.length;
  }

  console.log(`  ✓ Wards: ${Object.keys(wardMap).length}`);
  console.log(`  ✓ Beds:  ${totalBeds}`);
  return wardMap;
}

async function seedDemand(wardMap, wardConfig) {
  const records = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (const cfg of wardConfig) {
    const ward = wardMap[cfg.name];
    for (let daysBack = 0; daysBack < 7; daysBack++) {
      const date = new Date(today);
      date.setDate(date.getDate() - daysBack);
      // Slight variation on historical days to make reports interesting
      const variation = daysBack > 0 ? randBetween(-2, 2) : 0;
      records.push({
        ward: ward._id,
        demandDate: date,
        nominalDemand: Math.max(0, cfg.nominalDemand + variation),
        maximumDeviation: cfg.maximumDeviation,
      });
    }
  }

  await Demand.insertMany(records);
  console.log(`  ✓ Demand records: ${records.length}`);
}

async function seedPatientsAndAdmissions(wardMap, users) {
  const doctor = users['admin']; // admin acts as the creator for seed data
  let admissionCount = 0;

  // Build a pool of occupied beds per ward to assign to admitted patients
  const occupiedBedPool = {};
  for (const [wardName, ward] of Object.entries(wardMap)) {
    occupiedBedPool[wardName] = await Bed.find({ ward: ward._id, status: 'occupied' });
  }
  const bedCursors = Object.fromEntries(Object.keys(wardMap).map((n) => [n, 0]));

  for (let idx = 0; idx < PATIENT_TEMPLATES.length; idx++) {
    const [name, age, gender, condition, priority, wardName, los, status] =
      PATIENT_TEMPLATES[idx];

    const ward = wardMap[wardName];
    const admDate = daysAgo(Math.floor(Math.random() * los));
    const expDischarge = new Date(admDate);
    expDischarge.setDate(expDischarge.getDate() + los);

    const patient = await Patient.create({
      patientId: `P-${String(idx + 1).padStart(4, '0')}`,
      name,
      age,
      gender,
      medicalCondition: condition,
      priority,
      requiredWard: ward._id,
      expectedLengthOfStay: los,
      admissionDate: ['admitted', 'discharged'].includes(status) ? admDate : null,
      dischargeDate: status === 'discharged' ? daysAgo(1) : null,
      status,
      createdBy: doctor._id,
    });

    // Create admission record for admitted and discharged patients
    if (['admitted', 'discharged'].includes(status)) {
      const pool = occupiedBedPool[wardName] || [];
      const cursor = bedCursors[wardName];
      if (cursor < pool.length) {
        const bed = pool[cursor];
        bedCursors[wardName]++;
        await Admission.create({
          patient: patient._id,
          bed: bed._id,
          ward: ward._id,
          admissionDate: admDate,
          expectedDischargeDate: expDischarge,
          actualDischargeDate: status === 'discharged' ? daysAgo(1) : null,
          status: status === 'admitted' ? 'active' : 'discharged',
        });
        admissionCount++;
      }
    }
  }

  console.log(`  ✓ Patients:   ${PATIENT_TEMPLATES.length}`);
  console.log(`  ✓ Admissions: ${admissionCount}`);
}

async function seedAlerts() {
  const alerts = [
    {
      title: 'ICU Capacity Critical',
      message:
        'ICU occupancy has reached 90%. Only 3 beds remain available. Immediate action required.',
      severity: 'critical',
      source: 'bed_capacity',
    },
    {
      title: 'Emergency Demand Increasing',
      message:
        'Emergency ward demand is approaching maximum capacity. Current demand is near nominal + deviation.',
      severity: 'warning',
      source: 'demand',
    },
    {
      title: 'Patients Waiting for Beds',
      message:
        '4 patients are currently in waiting status. Run Gamma-robust optimization to allocate beds.',
      severity: 'warning',
      source: 'patient_flow',
    },
    {
      title: 'Optimization Recommended',
      message:
        'Demand data has been updated. Consider running Gamma-robust optimization to refresh bed allocation.',
      severity: 'info',
      source: 'optimization',
    },
    {
      title: 'General Ward — Sufficient Capacity',
      message: 'General ward has adequate capacity for current demand levels.',
      severity: 'info',
      source: 'bed_capacity',
      isRead: true,
    },
  ];

  await Alert.insertMany(alerts);
  console.log(`  ✓ Alerts: ${alerts.length}`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/hospital_db';
  await mongoose.connect(uri);
  console.log('MongoDB connected.\n');

  // Guard: skip if already seeded
  const existingUsers = await User.countDocuments();
  if (existingUsers > 0) {
    console.log('Database already contains data. Drop the database first to re-seed.');
    console.log('  mongosh hospital_db --eval "db.dropDatabase()"');
    await mongoose.disconnect();
    return;
  }

  console.log('Seeding...');

  const users   = await seedUsers();
  const wardMap = await seedWardsAndBeds(WARD_CONFIG);
  await seedDemand(wardMap, WARD_CONFIG);
  await seedPatientsAndAdmissions(wardMap, users);
  await seedAlerts();

  // Final summary
  console.log('\n✅ Seed complete.\n');
  console.log('  Collections:');
  console.log(`    users            ${await User.countDocuments()}`);
  console.log(`    wards            ${await Ward.countDocuments()}`);
  console.log(`    beds             ${await Bed.countDocuments()}`);
  console.log(`    patients         ${await Patient.countDocuments()}`);
  console.log(`    admissions       ${await Admission.countDocuments()}`);
  console.log(`    demand           ${await Demand.countDocuments()}`);
  console.log(`    optimizationruns ${await OptimizationRun.countDocuments()}`);
  console.log(`    alerts           ${await Alert.countDocuments()}`);

  console.log('\n  Bed counts per ward:');
  for (const [name, ward] of Object.entries(wardMap)) {
    const total     = await Bed.countDocuments({ ward: ward._id });
    const available = await Bed.countDocuments({ ward: ward._id, status: 'available' });
    const occupied  = await Bed.countDocuments({ ward: ward._id, status: 'occupied' });
    const reserved  = await Bed.countDocuments({ ward: ward._id, status: 'reserved' });
    const maint     = await Bed.countDocuments({ ward: ward._id, status: 'maintenance' });
    console.log(
      `    ${name.padEnd(12)} total=${total}  available=${available}  ` +
      `occupied=${occupied}  reserved=${reserved}  maintenance=${maint}`
    );
  }

  console.log('\n  Demo credentials:');
  console.log('    admin@hospital.com        / Admin@1234         (role: admin)');
  console.log('    receptionist@hospital.com / Receptionist@1234  (role: receptionist)');

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('\n❌ Seed failed:', err.message);
  mongoose.disconnect();
  process.exit(1);
});
