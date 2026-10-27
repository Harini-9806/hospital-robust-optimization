const assert = require('node:assert/strict');
const test = require('node:test');

const { filterVisibleWards } = require('../src/utils/wardVisibility');

test('filters only the exact development test ward names', () => {
  const wards = [
    { name: 'ICU' },
    { name: 'TestWard_API' },
    { name: 'TestWard_API_20260828' },
    { name: 'testward_api' },
    { name: 'General' },
  ];

  assert.deepEqual(filterVisibleWards(wards), [
    { name: 'ICU' },
    { name: 'testward_api' },
    { name: 'General' },
  ]);
});