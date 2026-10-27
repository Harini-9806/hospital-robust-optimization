const assert = require('node:assert/strict');
const test = require('node:test');

const { buildSurgeDemandScenario } = require('../src/services/optimizationScenarios');

const wards = [
  { ward_id: 'icu', ward_name: 'ICU', available_beds: 8, nominal_demand: 10, maximum_deviation: 3 },
  { ward_id: 'general', ward_name: 'General', available_beds: 20, nominal_demand: 30, maximum_deviation: 5 },
  { ward_id: 'surgery', ward_name: 'Surgery', available_beds: 12, nominal_demand: 20, maximum_deviation: 4 },
];

test('surge demand changes without changing capacity or the original snapshot', () => {
  const before = structuredClone(wards);
  const result = buildSurgeDemandScenario(wards, {
    focus_ward_id: 'icu',
    total_arrivals: 80,
    focus_share: 0.65,
  });

  assert.deepEqual(wards, before);
  assert.deepEqual(result.wards.map((ward) => ward.available_beds), [8, 20, 12]);
  assert.deepEqual(result.wards.map((ward) => ward.nominal_demand), [62, 44, 34]);
  assert.equal(result.focusWardName, 'ICU');
  assert.equal(result.focusArrivals, 52);
  assert.equal(result.networkArrivals, 28);
});

test('rejects surge scenarios whose focus ward is not in the fixed optimizer snapshot', () => {
  assert.throws(
    () => buildSurgeDemandScenario(wards, {
      focus_ward_id: 'missing',
      total_arrivals: 40,
      focus_share: 0.5,
    }),
    /focus ward/,
  );
});

test('rejects non-focus arrivals without another eligible ward', () => {
  assert.throws(
    () => buildSurgeDemandScenario(wards.slice(0, 1), {
      focus_ward_id: 'icu',
      total_arrivals: 20,
      focus_share: 0.8,
    }),
    /other eligible ward/,
  );
});

test('distributes fractional focus shares and network arrivals as whole counts', () => {
  const result = buildSurgeDemandScenario(wards, {
    focus_ward_id: 'icu',
    total_arrivals: 11,
    focus_share: 0.45,
  });

  assert.deepEqual(result.wards.map((ward) => ward.nominal_demand), [15, 33, 23]);
  assert.equal(result.focusArrivals + result.networkArrivals, 11);
});