const express = require('express');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const OtpRecord = require('../models/OtpRecord');
const LoginAudit = require('../models/LoginAudit');
const { protect, authorize } = require('../middleware/auth');
const { sanitizeAdminIdentity, generateOtpCode, hashOtp, compareOtp } = require('../utils/auth');
const ROLE_PERMISSIONS = require('../config/rolePermissions');

const router = express.Router();

const getClientIp = (req) => {
  const forwarded = req.headers['x-forwarded-for'];
  if (Array.isArray(forwarded)) return forwarded[0];
  if (typeof forwarded === 'string') return forwarded.split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
};

const recordAudit = async ({ req, adminId, adminName, roleNumber, loginResult, eventType, reasonCategory }) => {
  try {
    await LoginAudit.create({
      adminId: adminId || null,
      adminName: adminName || null,
      roleNumber: roleNumber || null,
      loginResult,
      eventType,
      reasonCategory: reasonCategory || null,
      ipAddress: getClientIp(req),
      userAgent: req.headers['user-agent'] || null,
    });
  } catch (error) {
    console.error('Failed to write login audit:', error.message);
  }
};

const signToken = (id, role) =>
  jwt.sign({ id, role }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  });

router.post('/login', async (req, res) => {
  const { identifier, email, username, password } = req.body;
  const lookup = (identifier || email || username || '').toString().trim();

  if (!lookup || !password) {
    await recordAudit({
      req,
      loginResult: 'failed',
      eventType: 'failed-sign-in',
      reasonCategory: 'missing_fields',
    });
    return res.status(400).json({ success: false, message: 'Admin username/email and password are required' });
  }

  try {
    const normalized = lookup.toLowerCase();
    const user = await User.findOne({
      $or: [{ email: normalized }, { username: normalized }],
    }).select('+passwordHash');

    if (!user || !user.isActive || user.role !== 'admin') {
      await recordAudit({
        req,
        loginResult: 'failed',
        eventType: 'failed-sign-in',
        reasonCategory: 'invalid_credentials',
      });
      return res.status(401).json({ success: false, message: 'Invalid admin credentials' });
    }

    const passwordMatch = await user.comparePassword(password);
    if (!passwordMatch) {
      await recordAudit({
        req,
        adminId: user._id,
        adminName: user.fullName || user.username || user.email,
        roleNumber: user.roleNumber,
        loginResult: 'failed',
        eventType: 'failed-sign-in',
        reasonCategory: 'invalid_credentials',
      });
      return res.status(401).json({ success: false, message: 'Invalid admin credentials' });
    }

    const token = signToken(user._id, user.role);
    await recordAudit({
      req,
      adminId: user._id,
      adminName: user.fullName || user.username || user.email,
      roleNumber: user.roleNumber,
      loginResult: 'success',
      eventType: 'sign-in',
      reasonCategory: null,
    });

    return res.status(200).json({
      success: true,
      token,
      user: {
        id: user._id,
        name: user.fullName || user.username || user.email,
        email: user.email,
        role: user.role,
        permissions: ROLE_PERMISSIONS[user.role],
      },
    });
  } catch (error) {
    console.error('Login failed:', error);
    await recordAudit({
      req,
      loginResult: 'failed',
      eventType: 'failed-sign-in',
      reasonCategory: 'invalid_credentials',
    });
    return res.status(500).json({ success: false, message: 'Unable to sign in right now' });
  }
});

router.get('/me', protect, (req, res) => {
  const admin = sanitizeAdminIdentity(req.user);
  return res.status(200).json({
    success: true,
    user: {
      ...admin,
      permissions: ROLE_PERMISSIONS[req.user.role],
    },
  });
});

router.post('/logout', protect, async (req, res) => {
  await recordAudit({
    req,
    adminId: req.user._id,
    adminName: req.user.fullName || req.user.username || req.user.email,
    roleNumber: req.user.roleNumber,
    loginResult: 'success',
    eventType: 'logout',
    reasonCategory: 'logout',
  });

  return res.status(200).json({ success: true, message: 'Logged out successfully' });
});

router.post('/forgot-password', async (req, res) => {
  const { identifier, mobileNumber } = req.body;
  const lookup = (identifier || '').toString().trim();
  const normalizedMobile = (mobileNumber || '').toString().trim();

  if (!lookup || !normalizedMobile) {
    return res.status(400).json({ success: false, message: 'Admin identifier and mobile number are required' });
  }

  const user = await User.findOne({
    $or: [{ email: lookup.toLowerCase() }, { username: lookup.toLowerCase() }],
  });

  if (!user || user.role !== 'admin') {
    return res.status(404).json({ success: false, message: 'No matching admin account found' });
  }

  if (user.mobileNumber && user.mobileNumber !== normalizedMobile) {
    return res.status(400).json({ success: false, message: 'The mobile number does not match the registered admin account' });
  }

  const otpCode = generateOtpCode(6);
  const otpHash = await hashOtp(otpCode);
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

  await OtpRecord.create({
    adminId: user._id,
    mobileNumber: normalizedMobile,
    otpHash,
    expiresAt,
    attempts: 0,
    maxAttempts: 5,
    used: false,
    verifiedAt: null,
    purpose: 'password_reset',
  });

  await recordAudit({
    req,
    adminId: user._id,
    adminName: user.fullName || user.username || user.email,
    roleNumber: user.roleNumber,
    loginResult: 'success',
    eventType: 'password-reset',
    reasonCategory: 'password_reset',
  });

  const isDevMode = process.env.NODE_ENV !== 'production' && process.env.DEV_OTP_MODE === 'true';
  return res.status(200).json({
    success: true,
    message: 'OTP sent successfully.',
    ...(isDevMode ? { devOtp: otpCode } : {}),
  });
});

router.post('/verify-otp', async (req, res) => {
  const { mobileNumber, otp } = req.body;
  const normalizedMobile = (mobileNumber || '').toString().trim();
  const otpValue = (otp || '').toString().trim();

  if (!normalizedMobile || !otpValue) {
    return res.status(400).json({ success: false, message: 'Mobile number and OTP are required' });
  }

  const otpRecord = await OtpRecord.findOne({
    mobileNumber: normalizedMobile,
    purpose: 'password_reset',
    used: false,
    expiresAt: { $gt: new Date() },
  }).sort({ createdAt: -1 });

  if (!otpRecord) {
    return res.status(400).json({ success: false, message: 'OTP is invalid or has expired' });
  }

  const isValid = await compareOtp(otpValue, otpRecord.otpHash);
  if (!isValid) {
    otpRecord.attempts += 1;
    if (otpRecord.attempts >= otpRecord.maxAttempts) {
      otpRecord.used = true;
    }
    await otpRecord.save();

    await recordAudit({
      req,
      adminId: otpRecord.adminId,
      loginResult: 'failed',
      eventType: 'failed-sign-in',
      reasonCategory: 'otp_failed',
    });

    return res.status(401).json({ success: false, message: 'Invalid OTP' });
  }

  otpRecord.verifiedAt = new Date();
  await otpRecord.save();

  return res.status(200).json({
    success: true,
    message: 'OTP verified successfully',
  });
});

router.post('/reset-password', async (req, res) => {
  const { mobileNumber, otp, newPassword } = req.body;
  const normalizedMobile = (mobileNumber || '').toString().trim();
  const otpValue = (otp || '').toString().trim();
  const password = (newPassword || '').toString();

  if (!normalizedMobile || !otpValue || !password || password.length < 6) {
    return res.status(400).json({ success: false, message: 'Valid mobile number, OTP, and a new password (minimum 6 chars) are required' });
  }

  const otpRecord = await OtpRecord.findOne({
    mobileNumber: normalizedMobile,
    purpose: 'password_reset',
    used: false,
    expiresAt: { $gt: new Date() },
  }).sort({ createdAt: -1 });

  if (!otpRecord) {
    return res.status(400).json({ success: false, message: 'Your reset session has expired. Please request a new OTP.' });
  }

  const isValid = await compareOtp(otpValue, otpRecord.otpHash);
  if (!isValid) {
    return res.status(401).json({ success: false, message: 'Invalid OTP' });
  }

  const user = await User.findById(otpRecord.adminId);
  if (!user || user.role !== 'admin') {
    return res.status(404).json({ success: false, message: 'Admin account not found' });
  }

  user.passwordHash = password;
  user.passwordChangedAt = new Date();
  await user.save();

  otpRecord.used = true;
  otpRecord.verifiedAt = otpRecord.verifiedAt || new Date();
  await otpRecord.save();

  await recordAudit({
    req,
    adminId: user._id,
    adminName: user.fullName || user.username || user.email,
    roleNumber: user.roleNumber,
    loginResult: 'success',
    eventType: 'password-reset',
    reasonCategory: 'password_reset',
  });

  return res.status(200).json({
    success: true,
    message: 'Password reset successfully',
  });
});

router.get('/login-history', protect, authorize('admin'), async (req, res) => {
  const audits = await LoginAudit.find().sort({ createdAt: -1 }).limit(50);
  return res.status(200).json({
    success: true,
    count: audits.length,
    data: audits,
  });
});

module.exports = router;
