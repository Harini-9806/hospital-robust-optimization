const mongoose = require('mongoose');

const alertSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, 'Alert title is required'],
      trim: true,
      maxlength: 200,
    },
    message: {
      type: String,
      required: [true, 'Alert message is required'],
      trim: true,
    },
    severity: {
      type: String,
      enum: ['info', 'warning', 'critical', 'success'],
      default: 'info',
      required: true,
    },
    // Which subsystem generated this alert
    source: {
      type: String,
      enum: ['bed_capacity', 'patient_flow', 'demand', 'optimization'],
      required: [true, 'Alert source is required'],
    },
    isRead: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

// Indexes
alertSchema.index({ severity: 1 });
alertSchema.index({ isRead: 1 });
alertSchema.index({ source: 1 });
alertSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Alert', alertSchema);
