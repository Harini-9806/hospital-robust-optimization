const mongoose = require('mongoose');

const otpRecordSchema = new mongoose.Schema(
  {
    adminId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    mobileNumber: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    otpHash: {
      type: String,
      required: true,
    },
    expiresAt: {
      type: Date,
      required: true,
      index: true,
    },
    attempts: {
      type: Number,
      default: 0,
    },
    maxAttempts: {
      type: Number,
      default: 5,
    },
    verifiedAt: {
      type: Date,
      default: null,
    },
    used: {
      type: Boolean,
      default: false,
    },
    purpose: {
      type: String,
      enum: ['password_reset'],
      default: 'password_reset',
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('OtpRecord', otpRecordSchema);
