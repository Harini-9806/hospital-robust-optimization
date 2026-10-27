function buildSurgeDemandScenario(baselineWards, scenario) {
  const focusWardId = String(scenario?.focus_ward_id || '')
  const totalArrivals = Number(scenario?.total_arrivals)
  const focusShare = Number(scenario?.focus_share)

  if (!Number.isInteger(totalArrivals) || totalArrivals < 1 || totalArrivals > 5000) {
    throw new Error('total_arrivals must be an integer between 1 and 5000');
  }
  if (!Number.isFinite(focusShare) || focusShare < 0 || focusShare > 1) {
    throw new Error('focus_share must be a number between 0 and 1');
  }

  const focusIndex = baselineWards.findIndex((ward) => ward.ward_id === focusWardId);
  if (focusIndex < 0) {
    throw new Error('The selected focus ward must have both demand data and available beds');
  }

  const otherIndexes = baselineWards
    .map((ward, index) => index)
    .filter((index) => index !== focusIndex);
  const focusArrivals = Math.round(totalArrivals * focusShare);
  const networkArrivals = totalArrivals - focusArrivals;
  if (networkArrivals > 0 && otherIndexes.length === 0) {
    throw new Error('At least one other eligible ward is required for non-focus arrivals');
  }

  const surgeWards = baselineWards.map((ward) => ({ ...ward }));
  surgeWards[focusIndex].nominal_demand += focusArrivals;
  if (otherIndexes.length) {
    const baseArrivals = Math.floor(networkArrivals / otherIndexes.length);
    const remainder = networkArrivals % otherIndexes.length;
    for (const [position, index] of otherIndexes.entries()) {
      surgeWards[index].nominal_demand += baseArrivals + (position < remainder ? 1 : 0);
    }
  }

  return {
    wards: surgeWards,
    focusWardName: baselineWards[focusIndex].ward_name,
    focusArrivals,
    networkArrivals,
  };
}

module.exports = { buildSurgeDemandScenario };