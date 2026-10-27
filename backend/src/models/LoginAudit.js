const mongoose = require('mongoose');

const loginAuditSchema = new mongoose.Schema(
  {
    adminId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true,
    },
    adminName: {
      type: String,
      default: null,
      trim: true,
    },
    roleNumber: {
      type: String,
      default: null,
      trim: true,
    },
    loginResult: {
      type: String,
      enum: ['success', 'failed'],
      required: true,
      index: true,
    },
    eventType: {
      type: String,
      enum: ['sign-in', 'failed-sign-in', 'password-reset', 'logout'],
      required: true,
      index: true,
    },
    reasonCategory: {
      type: String,
      default: null,
      enum: [
        'invalid_credentials',
        'missing_fields',
        'account_inactive',
        'otp_failed',
        'password_reset',
        'session_invalid',
        'logout',
        null,
      ],
    },
    ipAddress: {
      type: String,
      default: null,
      trim: true,
    },
    userAgent: {
      type: String,
      default: null,
      trim: true,
    },
    createdAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
  },
  { timestamps: false }
);

module.exports = mongoose.model('LoginAudit', loginAuditSchema);
