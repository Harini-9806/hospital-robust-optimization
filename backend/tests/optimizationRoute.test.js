const assert = require('node:assert/strict');
const test = require('node:test');

const Ward = require('../src/models/Ward');
const Bed = require('../src/models/Bed');
const Demand = require('../src/models/Demand');
const OptimizationRun = require('../src/models/OptimizationRun');
const router = require('../src/routes/optimization');

const analyzeHandler = router.stack
  .find((layer) => layer.route?.path === '/analyze')
  .route.stack.at(-1).handle;

async function callAnalyze(body, upstream) {
  const snapshot = [
    { _id: { toString: () => 'icu' }, name: 'ICU', available: 8, demand: { nominalDemand: 10, maximumDeviation: 3 } },
    { _id: { toString: () => 'general' }, name: 'General', available: 20, demand: { nominalDemand: 30, maximumDeviation: 5 } },
    { _id: { toString: () => 'test-api' }, name: 'TestWard_API', available: 100, demand: { nominalDemand: 100, maximumDeviation: 20 } },
    { _id: { toString: () => 'test-api-date' }, name: 'TestWard_API_20260828', available: 100, demand: { nominalDemand: 100, maximumDeviation: 20 } },
  ];
  const originals = {
    wardFind: Ward.find,
    bedCount: Bed.countDocuments,
    demandFind: Demand.findOne,
    runCreate: OptimizationRun.create,
    fetch: global.fetch,
  };
  let forwarded;
  let persisted = false;
  Ward.find = () => ({ sort: () => ({ lean: async () => snapshot }) });
  Bed.countDocuments = async ({ ward }) => snapshot.find((item) => item._id.toString() === String(ward)).available;
  Demand.findOne = ({ ward }) => ({
    sort: () => ({ lean: async () => snapshot.find((item) => item._id.toString() === String(ward)).demand }),
  });
  OptimizationRun.create = async () => { persisted = true; };
  global.fetch = async (url, options) => {
    forwarded = { url, body: JSON.parse(options.body) };
    return upstream;
  };

  const response = {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
  };
  try {
    await analyzeHandler({ body }, response);
    return { response, forwarded, persisted };
  } finally {
    Ward.find = originals.wardFind;
    Bed.countDocuments = originals.bedCount;
    Demand.findOne = originals.demandFind;
    OptimizationRun.create = originals.runCreate;
    global.fetch = originals.fetch;
  }
}

test('analyzer proxy forwards baseline and surge with unchanged capacity and does not persist', async () => {
  const upstreamPayload = {
    gamma_min: 0,
    gamma_max: 2,
    gamma_step: 1,
    tested_gamma_values: [0, 1, 2],
    baseline: [],
    surge: [],
  };
  const { response, forwarded, persisted } = await callAnalyze({
    gamma_step: 1,
    surge: {
      focus_ward_id: 'icu',
      total_arrivals: 80,
      focus_share: 0.65,
      duration_hours: 12,
    },
  }, {
    ok: true,
    status: 200,
    headers: { get: () => 'application/json' },
    json: async () => upstreamPayload,
  });

  assert.equal(response.statusCode, 200);
  assert.equal(forwarded.body.baseline_wards[0].available_beds, 8);
  assert.equal(forwarded.body.surge_wards[0].available_beds, 8);
  assert.deepEqual(forwarded.body.surge_wards.map((ward) => ward.nominal_demand), [62, 58]);
  assert.deepEqual(forwarded.body.baseline_wards.map((ward) => ward.nominal_demand), [10, 30]);
  assert.equal(response.body.surge_scenario.duration_hours, 12);
  assert.equal(persisted, false);
});

test('analyzer proxy surfaces upstream service errors without fabricated comparison rows', async () => {
  const { response } = await callAnalyze({ gamma_step: 1 }, {
    ok: false,
    status: 503,
    headers: { get: () => 'application/json' },
    json: async () => ({ detail: 'solver service unavailable' }),
  });

  assert.equal(response.statusCode, 503);
  assert.equal(response.body.success, false);
  assert.equal(response.body.message, 'solver service unavailable');
});