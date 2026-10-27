const mongoose = require('mongoose');

const patientSchema = new mongoose.Schema(
  {
    // Human-readable unique ID e.g. "P-0001"
    patientId: {
      type: String,
      required: [true, 'Patient ID is required'],
      unique: true,
      trim: true,
      maxlength: 20,
    },
    name: {
      type: String,
      required: [true, 'Patient name is required'],
      trim: true,
      maxlength: 150,
    },
    age: {
      type: Number,
      required: [true, 'Age is required'],
      min: [0, 'Age cannot be negative'],
      max: [150, 'Age cannot exceed 150'],
    },
    gender: {
      type: String,
      required: [true, 'Gender is required'],
      enum: ['male', 'female', 'other'],
    },
    phoneNumber: {
      type: String,
      trim: true,
      maxlength: 30,
    },
    emergencyContact: {
      type: String,
      trim: true,
      maxlength: 150,
    },
    medicalCondition: {
      type: String,
      trim: true,
      maxlength: 255,
    },
    priority: {
      type: String,
      enum: ['low', 'medium', 'high', 'critical'],
      default: 'medium',
      required: true,
    },
    requiredWard: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Ward',
      default: null,
    },
    waitingListAt: {
      type: Date,
      default: null,
    },
    expectedLengthOfStay: {
      type: Number,
      min: 0,
      default: null, // days
    },
    admissionDate: {
      type: Date,
      default: null,
    },
    dischargeDate: {
      type: Date,
      default: null,
    },
    status: {
      type: String,
      enum: ['waiting', 'admitted', 'transferred', 'discharged'],
      default: 'waiting',
      required: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  { timestamps: true }
);

// Indexes (patientId unique:true already creates its index)
patientSchema.index({ status: 1 });
patientSchema.index({ requiredWard: 1 });
patientSchema.index({ requiredWard: 1, waitingListAt: 1, status: 1 });
patientSchema.index({ priority: 1 });

module.exports = mongoose.model('Patient', patientSchema);
