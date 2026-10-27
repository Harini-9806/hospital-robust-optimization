const mongoose = require('mongoose');

/**
 * Admission links a Patient to a Bed for a specific period.
 * Records are NEVER deleted — discharge/transfer updates the status field only.
 * This preserves full admission history for reporting.
 */
const admissionSchema = new mongoose.Schema(
  {
    patient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Patient',
      required: [true, 'Patient reference is required'],
    },
    bed: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Bed',
      required: [true, 'Bed reference is required'],
    },
    ward: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Ward',
      required: [true, 'Ward reference is required'],
    },
    admissionType: {
      type: String,
      enum: ['emergency', 'normal', 'surgery', 'icu'],
      default: 'normal',
    },
    doctorName: {
      type: String,
      trim: true,
      maxlength: 150,
    },
    medicalNotes: {
      type: String,
      trim: true,
      maxlength: 2000,
    },
    admissionDate: {
      type: Date,
      required: [true, 'Admission date is required'],
    },
    expectedDischargeDate: {
      type: Date,
      default: null,
    },
    actualDischargeDate: {
      type: Date,
      default: null,
    },
    dischargeNotes: {
      type: String,
      trim: true,
      maxlength: 2000,
    },
    dischargeReason: {
      type: String,
      trim: true,
      maxlength: 255,
    },
    status: {
      type: String,
      enum: ['active', 'discharged', 'transferred'],
      default: 'active',
      required: true,
    },
  },
  { timestamps: true }
);

// Indexes
admissionSchema.index({ patient: 1 });
admissionSchema.index({ bed: 1 });
admissionSchema.index({ ward: 1 });
admissionSchema.index({ status: 1 });
admissionSchema.index({ admissionDate: -1 });

module.exports = mongoose.model('Admission', admissionSchema);
