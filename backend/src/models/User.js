const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema(
  {
    fullName: {
      type: String,
      trim: true,
      maxlength: 160,
      default: 'CareFlow Administrator',
    },
    username: {
      type: String,
      trim: true,
      lowercase: true,
      unique: true,
      sparse: true,
      maxlength: 80,
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, 'Invalid email format'],
    },
    mobileNumber: {
      type: String,
      trim: true,
      default: null,
    },
    roleNumber: {
      type: String,
      trim: true,
      default: null,
      maxlength: 40,
    },
    passwordHash: {
      type: String,
      required: true,
      select: false, // Never returned in queries by default
    },
    role: {
      type: String,
      enum: ['admin', 'receptionist'],
      default: 'receptionist',
      required: true,
    },
    passwordChangedAt: {
      type: Date,
      default: Date.now,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

// Hash password before saving
userSchema.pre('save', async function (next) {
  if (!this.isModified('passwordHash')) return next();
  this.passwordHash = await bcrypt.hash(this.passwordHash, 12);
  next();
});

// Instance method — compare plain password against stored hash
userSchema.methods.comparePassword = async function (plainPassword) {
  return bcrypt.compare(plainPassword, this.passwordHash);
};

module.exports = mongoose.model('User', userSchema);
