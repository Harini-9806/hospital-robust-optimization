const express = require('express');
const { protect } = require('../middleware/auth');
const Ward = require('../models/Ward');
const Bed = require('../models/Bed');
const Demand = require('../models/Demand');
const OptimizationRun = require('../models/OptimizationRun');
const { buildSurgeDemandScenario } = require('../services/optimizationScenarios');
const { filterVisibleWards } = require('../utils/wardVisibility');

const router = express.Router();

const optimizationServiceUrl =
  process.env.OPTIMIZATION_SERVICE_URL || 'http://127.0.0.1:8000/optimize';

const optimizationTimeoutMs =
  Number(process.env.OPTIMIZATION_TIMEOUT_MS || 10000);

function siblingServiceUrl(serviceUrl, endpoint) {
  const url = new URL(serviceUrl);
  const path = url.pathname.replace(/\/+$/, '');
  url.pathname = path.endsWith('/optimize')
    ? `${path.slice(0, -'/optimize'.length)}/${endpoint}`
    : `${path}/${endpoint}`;
  return url.toString();
}

const optimizationAnalysisServiceUrl =
  process.env.OPTIMIZATION_ANALYSIS_SERVICE_URL ||
  siblingServiceUrl(optimizationServiceUrl, 'analyze');

async function getOptimizationWards(wardDocuments) {
  const wards = filterVisibleWards(wardDocuments || await Ward.find().sort({ name: 1 }).lean());
  const optimizationWards = [];

  for (const ward of wards) {
    const availableBeds = await Bed.countDocuments({ ward: ward._id, status: 'available' });
    if (availableBeds <= 0) continue;

    const latestDemand = await Demand.findOne({ ward: ward._id })
      .sort({ demandDate: -1, createdAt: -1 })
      .lean();
    if (!latestDemand) continue;

    optimizationWards.push({
      ward_id: ward._id.toString(),
      ward_name: ward.name,
      available_beds: availableBeds,
      nominal_demand: latestDemand.nominalDemand,
      maximum_deviation: latestDemand.maximumDeviation,
    });
  }
  return optimizationWards;
}

router.post('/analyze', protect, async (req, res) => {
  try {
    const gammaStep = Number(req.body?.gamma_step ?? 1);
    if (!Number.isFinite(gammaStep) || gammaStep <= 0) {
      return res.status(400).json({ success: false, message: 'gamma_step must be a positive finite number' });
    }

    const baselineWards = await getOptimizationWards();
    if (!baselineWards.length) {
      return res.status(400).json({
        success: false,
        message: 'No wards with both available beds and demand data were found',
      });
    }

    let surgeWards;
    let surgeMetadata;
    if (req.body?.surge) {
      const durationHours = Number(req.body.surge.duration_hours);
      if (!Number.isInteger(durationHours) || durationHours < 6 || durationHours > 72 || durationHours % 6 !== 0) {
        return res.status(400).json({
          success: false,
          message: 'duration_hours must be a multiple of 6 between 6 and 72',
        });
      }
      const surge = buildSurgeDemandScenario(baselineWards, req.body.surge);
      surgeWards = surge.wards;
      surgeMetadata = {
        focus_ward_name: surge.focusWardName,
        total_arrivals: Number(req.body.surge.total_arrivals),
        duration_hours: durationHours,
        focus_share: Number(req.body.surge.focus_share),
        focus_arrivals: surge.focusArrivals,
        network_arrivals: surge.networkArrivals,
        demand_mapping: 'Focus share is added to the focus ward; remaining arrivals are split evenly across other eligible wards.',
        horizon_note: 'The optimizer is single-period; duration is scenario context and does not model discharges or bed turnover.',
      };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), optimizationTimeoutMs);
    try {
      const response = await fetch(optimizationAnalysisServiceUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          baseline_wards: baselineWards,
          ...(surgeWards ? { surge_wards: surgeWards } : {}),
          gamma_step: gammaStep,
        }),
        signal: controller.signal,
      });
      const contentType = response.headers.get('content-type') || '';
      const payload = contentType.includes('application/json')
        ? await response.json()
        : await response.text();

      if (!response.ok) {
        return res.status(response.status).json({
          success: false,
          message: payload?.detail || payload?.message || 'Gamma analysis service rejected the request',
        });
      }

      return res.status(200).json({
        success: true,
        ...payload,
        ...(surgeMetadata ? { surge_scenario: surgeMetadata } : {}),
      });
    } finally {
      clearTimeout(timeout);
    }
  } catch (error) {
    if (error.name === 'AbortError') {
      return res.status(504).json({ success: false, message: 'Gamma analysis service timed out' });
    }
    if (error instanceof TypeError && /fetch|URL/.test(error.message)) {
      return res.status(503).json({ success: false, message: `Gamma analysis service is unavailable: ${error.message}` });
    }
    if (/^(total_arrivals|focus_share|The selected focus ward|At least one other eligible ward)/.test(error.message)) {
      return res.status(400).json({ success: false, message: error.message });
    }
    console.error('Gamma analysis request failed:', error.message);
    return res.status(500).json({ success: false, message: 'Unable to complete Gamma analysis' });
  }
});

router.get('/latest', protect, async (req, res) => {
  const result = await OptimizationRun.findOne().sort({ createdAt: -1 }).lean();
  if (!result) {
    return res.status(404).json({ success: false, message: 'No optimization run found' });
  }
  return res.status(200).json({ success: true, data: result });
});

router.post('/optimize', protect, async (req, res) => {
  try {
    // -----------------------------------------------------------------------
    // 1. Read Gamma from request
    // -----------------------------------------------------------------------
    const gamma =
      req.body && req.body.gamma !== undefined
        ? Number(req.body.gamma)
        : 2;

    if (!Number.isFinite(gamma) || gamma < 0) {
      return res.status(400).json({
        success: false,
        message: 'Gamma must be a non-negative number',
      });
    }

    // -----------------------------------------------------------------------
    // 2. Get all wards
    // -----------------------------------------------------------------------
    const wards = await Ward.find().sort({ name: 1 }).lean();

    if (!wards.length) {
      return res.status(404).json({
        success: false,
        message: 'No wards found',
      });
    }

    // -----------------------------------------------------------------------
    // 3. Build optimization data for each ward
    // -----------------------------------------------------------------------
    const optimizationWards = await getOptimizationWards(wards);

    // -----------------------------------------------------------------------
    // 4. Validate optimization input
    // -----------------------------------------------------------------------
    if (!optimizationWards.length) {
      return res.status(400).json({
        success: false,
        message: 'No wards with both available beds and demand data were found',
      });
    }

    if (gamma > optimizationWards.length) {
      return res.status(400).json({
        success: false,
        message: `Gamma (${gamma}) cannot exceed the number of wards (${optimizationWards.length})`,
      });
    }

    const optimizationBody = {
      wards: optimizationWards,
      gamma,
    };

    // -----------------------------------------------------------------------
    // 5. Call Python optimization microservice
    // -----------------------------------------------------------------------
    const controller = new AbortController();

    const timeout = setTimeout(
      () => controller.abort(),
      optimizationTimeoutMs
    );

    try {
      const response = await fetch(optimizationServiceUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(optimizationBody),
        signal: controller.signal,
      });

      const contentType =
        response.headers.get('content-type') || '';

      const payload = contentType.includes('application/json')
        ? await response.json()
        : await response.text();

      if (!response.ok) {
        return res.status(response.status).json({
          success: false,
          message: payload?.detail || payload?.message || 'Optimization service rejected the request',
          details: payload,
        });
      }

      await OptimizationRun.create({
        runBy: req.user._id,
        gamma: payload.gamma,
        totalAvailableBeds: payload.total_available_beds,
        totalAllocatedBeds: payload.total_allocated_beds,
        totalReservedBeds: payload.total_reserved_beds,
        totalUnmetDemand: payload.total_unmet_demand,
        nominalUnmetDemand: payload.nominal_unmet_demand,
        robustSlackBedEquivalents: payload.robust_slack_bed_equivalents,
        robustUncertaintySlackBedEquivalents: payload.robust_uncertainty_slack_bed_equivalents,
        capacityUtilization: payload.capacity_utilization,
        executionTimeSeconds: payload.execution_time_seconds,
        objectiveValue: payload.objective_value,
        solverStatus: payload.solver_status,
        wardResults: (payload.ward_results || []).map((ward) => ({
          ward: ward.ward_id,
          wardName: ward.ward_name,
          availableBeds: ward.available_beds,
          nominalDemand: ward.nominal_demand,
          maximumDeviation: ward.maximum_deviation,
          recommendedAllocation: ward.recommended_allocation,
          reservedBeds: ward.reserved_beds,
          unmetDemand: ward.unmet_demand,
          nominalUnmetDemand: ward.nominal_unmet_demand,
          capacityUtilization: ward.capacity_utilization,
        })),
      });

      return res.status(response.status).json({
        success: true,
        ...payload,
      });
    } finally {
      clearTimeout(timeout);
    }
  } catch (error) {
    if (error.name === 'AbortError') {
      return res.status(504).json({
        success: false,
        message: 'Optimization service timed out',
      });
    }

    console.error(
      'Optimization service request failed:',
      error.message
    );

    return res.status(503).json({
      success: false,
      message: `Optimization service is unavailable: ${error.message}`,
    });
  }
});

module.exports = router;
