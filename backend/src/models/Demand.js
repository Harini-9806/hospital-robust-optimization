const mongoose = require('mongoose');

/**
 * Demand stores the uncertain demand parameters per ward per date.
 *
 * nominalDemand   = D_i  — expected patient demand for ward i
 * maximumDeviation = U_i  — maximum possible deviation from D_i
 *
 * These values feed directly into the Γ-robust optimization model:
 *   Worst-case demand for ward i = D_i + z_i * U_i,  where z_i ∈ [0, 1]
 *   Subject to the uncertainty budget constraint:  Σ z_i <= Γ
 */
const demandSchema = new mongoose.Schema(
  {
    ward: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Ward',
      required: [true, 'Ward reference is required'],
    },
    demandDate: {
      type: Date,
      required: [true, 'Demand date is required'],
    },
    // D_i — expected patient demand
    nominalDemand: {
      type: Number,
      required: [true, 'Nominal demand is required'],
      min: [0, 'Nominal demand cannot be negative'],
    },
    // U_i — maximum possible deviation from nominal demand
    maximumDeviation: {
      type: Number,
      required: [true, 'Maximum deviation is required'],
      min: [0, 'Maximum deviation cannot be negative'],
    },
  },
  { timestamps: true }
);

// Indexes
demandSchema.index({ ward: 1, demandDate: -1 });
demandSchema.index({ demandDate: -1 });

module.exports = mongoose.model('Demand', demandSchema);
