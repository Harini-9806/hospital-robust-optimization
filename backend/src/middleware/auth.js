const jwt = require('jsonwebtoken');
const User = require('../models/User');

/**
 * protect — verifies the JWT in the Authorization header.
 * Attaches the authenticated user document to req.user.
 */
const protect = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: 'Authentication required' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id).select('+passwordHash');

    if (!user || !user.isActive) {
      return res.status(401).json({ success: false, message: 'User not found or inactive' });
    }

    const passwordChangedAt = user.passwordChangedAt ? Math.floor(user.passwordChangedAt.getTime() / 1000) : null;
    if (passwordChangedAt && decoded.iat < passwordChangedAt) {
      return res.status(401).json({ success: false, message: 'Session expired. Please sign in again.' });
    }

    req.user = user;
    next();
  } catch {
    return res.status(401).json({ success: false, message: 'Invalid or expired token' });
  }
};

/**
 * authorize(...roles) — restricts a route to specific roles.
 * Must be used after protect.
 */
const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to access this resource',
      });
    }
    next();
  };
};

module.exports = { protect, authorize };
