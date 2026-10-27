require('dotenv').config();
const express = require('express');
const cors = require('cors');
const connectDB = require('./config/db');

const authRouter       = require('./routes/auth');
const usersRouter      = require('./routes/users');
const wardsRouter      = require('./routes/wards');
const bedsRouter       = require('./routes/beds');
const patientsRouter   = require('./routes/patients');
const admissionsRouter = require('./routes/admissions');
const demandRouter     = require('./routes/demand');
const alertsRouter     = require('./routes/alerts');
const optimizationRouter = require('./routes/optimization');
const { ensureDefaultAdmin } = require('./config/adminBootstrap');

const app = express();

app.use(cors());
app.use(express.json());

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'hospital-robust-optimization-backend' });
});

// Routes
app.use('/api/auth',       authRouter);
app.use('/api/users',      usersRouter);
app.use('/api/wards',      wardsRouter);
app.use('/api/beds',       bedsRouter);
app.use('/api/patients',   patientsRouter);
app.use('/api/admissions', admissionsRouter);
app.use('/api/demand',     demandRouter);
app.use('/api/alerts',     alertsRouter);
app.use('/api/optimization', optimizationRouter);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ success: false, message: `Route ${req.originalUrl} not found` });
});

// Global error handler — catches any unhandled errors thrown in routes
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  console.error(err.stack);
  const status = err.statusCode || 500;
  res.status(status).json({ success: false, message: err.message || 'Internal server error' });
});

const PORT = process.env.PORT || 5000;

connectDB()
  .then(async () => {
    try {
      const admin = await ensureDefaultAdmin();
      console.log(`Admin secured: ${admin.email}`);
    } catch (error) {
      console.error('Admin bootstrap failed:', error.message);
    }

    app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
  })
  .catch((err) => {
    console.error('MongoDB connection failed:', err.message);
    process.exit(1);
  });

module.exports = app;
