const crypto = require('crypto');
const bcrypt = require('bcryptjs');

function sanitizeAdminIdentity(admin) {
  if (!admin) return null;

  return {
    id: admin._id,
    fullName: admin.fullName || admin.name || 'CareFlow Administrator',
    username: admin.username || admin.email,
    email: admin.email,
    role: admin.role,
    roleNumber: admin.roleNumber || null,
    mobileNumber: admin.mobileNumber || null,
  };
}

function generateOtpCode(length = 6) {
  const bytes = crypto.randomBytes(length);
  return Array.from(bytes, (byte) => (byte % 10).toString()).join('').slice(0, length);
}

async function hashOtp(value) {
  return bcrypt.hash(value, 10);
}

async function compareOtp(value, hash) {
  return bcrypt.compare(value, hash);
}

module.exports = {
  sanitizeAdminIdentity,
  generateOtpCode,
  hashOtp,
  compareOtp,
};
