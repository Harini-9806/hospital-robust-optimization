const mongoose = require('mongoose');

const wardSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Ward name is required'],
      unique: true,
      trim: true,
      maxlength: 100,
    },
    description: {
      type: String,
      trim: true,
    },
  },
  {
    timestamps: true,
    // Virtual fields are included when converting to JSON/Object
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Virtual: total beds (populated via Bed model in queries)
// Computed counts are resolved at the route/service layer using Bed.countDocuments()
// to avoid stale embedded counts.

module.exports = mongoose.model('Ward', wardSchema);
