const EXCLUDED_WARD_NAMES = new Set(['TestWard_API', 'TestWard_API_20260828']);

function filterVisibleWards(wards) {
  return wards.filter((ward) => !EXCLUDED_WARD_NAMES.has(ward.name));
}

module.exports = { EXCLUDED_WARD_NAMES, filterVisibleWards };