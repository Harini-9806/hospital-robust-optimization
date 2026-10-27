const express = require('express');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const { protect, authorize } = require('../middleware/auth');

const router = express.Router();

// All routes below require a valid token AND admin role
router.use(protect, authorize('admin'));

// GET /api/users — list all users
router.get('/', async (req, res) => {
  const users = await User.find().select('-passwordHash').sort({ createdAt: -1 });
  return res.status(200).json({ success: true, count: users.length, data: users });
});

// GET /api/users/:id — get single user
router.get('/:id', async (req, res) => {
  const user = await User.findById(req.params.id).select('-passwordHash');
  if (!user) return res.status(404).json({ success: false, message: 'User not found' });
  return res.status(200).json({ success: true, data: user });
});

// POST /api/users — create user
router.post('/', async (req, res) => {
  const { name, email, password, role } = req.body;
  if (!name || !email || !password || !role) {
    return res.status(400).json({ success: false, message: 'name, email, password and role are required' });
  }

  const exists = await User.findOne({ email: email.toLowerCase().trim() });
  if (exists) return res.status(409).json({ success: false, message: 'Email already in use' });

  const user = await User.create({
    name,
    email,
    passwordHash: password, // pre-save hook hashes it
    role,
  });

  return res.status(201).json({
    success: true,
    data: { id: user._id, name: user.name, email: user.email, role: user.role },
  });
});

// PATCH /api/users/:id — update name, role, or isActive
router.patch('/:id', async (req, res) => {
  const allowed = ['name', 'role', 'isActive'];
  const updates = Object.fromEntries(
    Object.entries(req.body).filter(([k]) => allowed.includes(k))
  );

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ success: false, message: 'No valid fields to update' });
  }

  const user = await User.findByIdAndUpdate(req.params.id, updates, {
    new: true,
    runValidators: true,
  }).select('-passwordHash');

  if (!user) return res.status(404).json({ success: false, message: 'User not found' });
  return res.status(200).json({ success: true, data: user });
});

// DELETE /api/users/:id — deactivate (soft delete)
router.delete('/:id', async (req, res) => {
  if (req.params.id === req.user._id.toString()) {
    return res.status(400).json({ success: false, message: 'Cannot deactivate your own account' });
  }
  const user = await User.findByIdAndUpdate(
    req.params.id,
    { isActive: false },
    { new: true }
  ).select('-passwordHash');
  if (!user) return res.status(404).json({ success: false, message: 'User not found' });
  return res.status(200).json({ success: true, message: 'User deactivated', data: user });
});

module.exports = router;
