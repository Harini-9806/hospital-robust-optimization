const mongoose = require('mongoose');
/**
 * wardResultSchema — embedded sub-document.
 * Stores the per-ward output of a single optimization run.
 * Embedded (not a separate collection) because results are always
 * read together with their parent run and never queried independently.
 *
 * Fields:
 *   availableBeds          — beds available in this ward at run time
 *   nominalDemand          — D_i used in this run
 *   maximumDeviation       — U_i used in this run
 *   recommendedAllocation  — x_i* returned by CVXPY solver
 *   reservedBeds           — robust buffer = x_i* - D_i  (>= 0)
 *   unmetDemand            — max(0, D_i - x_i*)
 */
const wardResultSchema = new mongoose.Schema(
  {
    ward: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Ward',
      required: true,
    },
    wardName: {
      type: String,
      required: true,
    },
    availableBeds: {
      type: Number,
      required: true,
      min: 0,
    },
    nominalDemand: {
      type: Number,
      required: true,
      min: 0,
    },
    maximumDeviation: {
      type: Number,
      required: true,
      min: 0,
    },
    recommendedAllocation: {
      type: Number,
      required: true,
      min: 0,
    },
    reservedBeds: {
      type: Number,
      required: true,
      min: 0,
    },
    unmetDemand: {
      type: Number,
      required: true,
      min: 0,
    },
    nominalUnmetDemand: {
      type: Number,
      default: null,
      min: 0,
    },
    capacityUtilization: {
      type: Number,
      default: null,
      min: 0,
      max: 1,
    },
  },
  { _id: false } // No separate _id for embedded sub-documents
);

/**
 * OptimizationRun — top-level document.
 *
 * gamma (Γ) is the uncertainty budget passed to the CVXPY solver.
 * It controls how many wards can simultaneously experience their
 * worst-case demand deviation:
 *   Γ = 0  →  deterministic (nominal demand only)
 *   Γ = N  →  all N wards fully protected against worst-case demand
 *
 * wardResults is an embedded array — one entry per ward per run.
 */
const optimizationRunSchema = new mongoose.Schema(
  {
    runBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    // Γ — uncertainty budget (0 ≤ gamma ≤ number of wards)
    gamma: {
      type: Number,
      required: [true, 'Gamma is required'],
      min: [0, 'Gamma must be >= 0'],
    },
    totalAvailableBeds: {
      type: Number,
      required: true,
      min: 0,
    },
    totalAllocatedBeds: {
      type: Number,
      default: null,
      min: 0,
    },
    totalReservedBeds: {
      type: Number,
      default: null,
      min: 0,
    },
    totalUnmetDemand: {
      type: Number,
      default: null,
      min: 0,
    },
    nominalUnmetDemand: {
      type: Number,
      default: null,
      min: 0,
    },
    robustSlackBedEquivalents: {
      type: Number,
      default: null,
      min: 0,
    },
    robustUncertaintySlackBedEquivalents: {
      type: Number,
      default: null,
      min: 0,
    },
    capacityUtilization: {
      type: Number,
      default: null,
      min: 0,
      max: 1,
    },
    executionTimeSeconds: {
      type: Number,
      default: null,
      min: 0,
    },
    objectiveValue: {
      type: Number,
      default: null,
    },
    // e.g. "optimal", "infeasible", "unbounded", "error"
    solverStatus: {
      type: String,
      required: [true, 'Solver status is required'],
      trim: true,
    },
    // Embedded per-ward results — no separate collection needed
    wardResults: {
      type: [wardResultSchema],
      default: [],
    },
  },
  { timestamps: true }
);

// Indexes
optimizationRunSchema.index({ runBy: 1 });
optimizationRunSchema.index({ gamma: 1 });
optimizationRunSchema.index({ createdAt: -1 });
optimizationRunSchema.index({ solverStatus: 1 });

module.exports = mongoose.model('OptimizationRun', optimizationRunSchema);
