const User = require('../models/User');

function getEnvAdminConfig() {
  const email = (process.env.ADMIN_EMAIL || 'admin@hospital.com').trim().toLowerCase();
  const username = (process.env.ADMIN_USERNAME || 'admin').trim().toLowerCase();
  return {
    email,
    username,
    fullName: process.env.ADMIN_FULL_NAME || 'CareFlow Administrator',
    mobileNumber: process.env.ADMIN_MOBILE || '+15551234567',
    roleNumber: process.env.ADMIN_ROLE_NUMBER || 'CF-ADMIN-001',
    password: process.env.ADMIN_PASSWORD || 'admin@123',
  };
}

async function ensureDefaultAdmin() {
  const config = getEnvAdminConfig();
  const query = {
    role: 'admin',
    $or: [
      { email: config.email },
      { username: config.username },
    ],
  };

  let admin = await User.findOne(query).select('+passwordHash');
  if (admin) {
    const passwordMatches = await admin.comparePassword(config.password);
    const needsProfileUpdate = !admin.fullName || admin.fullName !== config.fullName || !admin.mobileNumber || admin.mobileNumber !== config.mobileNumber || !admin.roleNumber || admin.roleNumber !== config.roleNumber || !admin.username || admin.username !== config.username;

    if (needsProfileUpdate || !passwordMatches) {
      admin.fullName = config.fullName;
      admin.mobileNumber = config.mobileNumber;
      admin.roleNumber = config.roleNumber;
      admin.username = config.username;
      admin.email = config.email;
      admin.passwordHash = config.password;
      admin.isActive = true;
      await admin.save();
    }

    return admin;
  }

  admin = await User.create({
    fullName: config.fullName,
    username: config.username,
    email: config.email,
    mobileNumber: config.mobileNumber,
    roleNumber: config.roleNumber,
    passwordHash: config.password,
    role: 'admin',
    isActive: true,
  });

  return admin;
}

module.exports = { getEnvAdminConfig, ensureDefaultAdmin };
