const mongoose = require('mongoose');

const bedSchema = new mongoose.Schema(
  {
    bedNumber: {
      type: String,
      required: [true, 'Bed number is required'],
      trim: true,
      maxlength: 20,
    },
    ward: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Ward',
      required: [true, 'Ward reference is required'],
    },
    status: {
      type: String,
      enum: ['available', 'occupied', 'reserved', 'maintenance'],
      default: 'available',
      required: true,
    },
  },
  { timestamps: true }
);

// bedNumber must be unique within a ward
bedSchema.index({ ward: 1, bedNumber: 1 }, { unique: true });

// Index for fast status-based queries (e.g. count available beds per ward)
bedSchema.index({ ward: 1, status: 1 });

module.exports = mongoose.model('Bed', bedSchema);
