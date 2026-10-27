# Hospital Patient Flow and Bed Availability Management System
## Using Γ-Based Robust Optimization

---

## Project Objective

Allocate hospital beds efficiently while handling **uncertain patient demand** using
**Robust Optimization with a Gamma (Γ) uncertainty budget** (Bertsimas-Sim model).

---

## Architecture

```
┌─────────────────────────────────────┐
│         React + Tailwind CSS        │
│         (Port 3000)                 │
└──────────────┬──────────────────────┘
               │ HTTP / Axios
               ▼
┌─────────────────────────────────────┐
│      Node.js + Express              │
│      Main API Server (Port 5000)    │
└──────┬──────────────────────────────┘
       │                │
       │ Mongoose       │ HTTP POST /optimize
       ▼                ▼
┌──────────┐   ┌──────────────────────────┐
│ MongoDB  │   │  Python Optimization     │
│ (27017)  │   │  Microservice (Port 8000)│
└──────────┘   │  Flask + CVXPY           │
               │  Γ-Robust Model          │
               └──────────────────────────┘
```

---

## Technology Stack

| Layer              | Technology                          |
|--------------------|-------------------------------------|
| Frontend           | React, Tailwind CSS, CSS charts     |
| Main Backend       | Node.js, Express, Mongoose          |
| Database           | MongoDB                             |
| Optimization       | Python, FastAPI, CVXPY              |
| Optimization Model | Bertsimas-Sim Γ-robust counterpart  |

---

## MongoDB Collections

| Collection       | Purpose                                           |
|------------------|---------------------------------------------------|
| users            | Authentication and role-based access              |
| wards            | ICU, General, Surgical, Emergency                 |
| beds             | Individual beds with status per ward              |
| patients         | Patient records, required ward, and FIFO waiting-list timestamp |
| admissions       | Patient ↔ Bed assignment history (never deleted)  |
| demand           | D_i (nominal demand) and U_i (max deviation)      |
| optimizationruns | Each Γ-robust run with embedded ward-level results|
| alerts           | Severity-tagged system alerts                     |

### References

```
User        ──< Patient       (createdBy)
User        ──< OptimizationRun (runBy)
Ward        ──< Bed           (ward)
Ward        ──< Demand        (ward)
Ward        ──< Admission     (ward)
Patient     ──< Admission     (patient)
Bed         ──< Admission     (bed)
OptimizationRun embeds wardResults[]  (ward ref inside each element)
```

Patients awaiting placement are enqueued through `POST /api/patients/:id/waiting-list`. The `waitingListAt` timestamp and `requiredWard` are persisted on the patient. Discharging an admission atomically releases its bed and attempts FIFO allocation only within that bed's ward; patient and bed claims use conditional MongoDB updates, so this does not require transactions or a replica set.

---

## Robust Optimization Methodology

### Γ-Robust Counterpart (Bertsimas-Sim)

```
Variables:
  x_i  = beds allocated to ward i          (decision variable)
  s_i  = unmet demand slack for ward i
  z_i  = uncertainty variable ∈ [0, 1]
  p    = dual scalar for uncertainty budget
  q_i  = dual variable per ward

Minimize:   Σ (w_unmet * s_i)  +  Σ (w_reserve * max(0, x_i - D_i))
Minimize:   Σ_i (w_unmet * s_i)  +  Σ_i (w_reserve * max(0, x_i - D_i))

Subject to:
  x_i + s_i  >= D_i                  ∀ i   (nominal ward coverage)
  p + q_i    >= U_i                  ∀ i   (dual uncertainty constraints)
  Σ_i(x_i+s_i) >= Σ_i D_i + Γ*p + Σ_i q_i (aggregate robust coverage)
  x_i        <= available_beds_i     ∀ i   (bed capacity)
  x_i, s_i, p, q_i >= 0

Where:
  D_i  = nominal demand (nominalDemand)
  U_i  = maximum deviation (maximumDeviation)
│         (Vite default: 5173)        │
```

### Gamma Interpretation

| Γ | Meaning                                                   |
|---|-----------------------------------------------------------|
| 0 | Deterministic — only nominal demand considered            |
| 1 | At most 1 ward can hit worst-case demand simultaneously   |
| 2 | At most 2 wards can hit worst-case demand simultaneously  |
| 4 | All 4 wards fully protected against worst-case demand     |

## Gamma Analyzer and Surge API

│  FastAPI + CVXPY         │

```json
{
  "gamma_step": 0.5,
  "surge": {
    "focus_ward_id": "<ward id>",
    "total_arrivals": 80,
    "focus_share": 0.65,
    "duration_hours": 12
  }
}
```

The surge demand is a temporary copy of the same snapshot: the focus share is added to the selected ward, and the remaining arrivals are split evenly among other eligible wards. Capacities and maximum deviations are unchanged, and no demand or bed records are modified. The current optimizer is single-period, so duration is descriptive context rather than a time-indexed flow model. Comparison runs are not persisted.

Each Gamma row reports solver status, objective value, allocated beds, nominal unmet demand, actual model slack `Σ s_i`, the positive portion of that slack beyond nominal undercoverage, available beds, capacity utilization, and execution time. `total_unmet_demand` remains a compatibility alias for nominal unmet demand. Utilization is the ratio `allocated / available`; objective value is weighted model cost, not a real-world performance score.

## Focused Tests

From `backend/optimization/` run:

```bash
python -m unittest tests.test_optimizer_metrics tests.test_gamma_analysis -v
```

From `backend/` run:

```bash
node --test tests/optimizationScenarios.test.js tests/optimizationRoute.test.js tests/waitingList.test.js
```

---

## Installation

### Prerequisites

- Node.js 18+
- MongoDB 7+ (running locally or Atlas URI)
- Python 3.11+ (for optimization service — later phase)

### 1. Backend Setup

```bash
cd backend

# Copy environment file
copy .env.example .env
# Edit .env — set MONGODB_URI if not using localhost

# Install dependencies
npm install
```

### 2. Seed the Database

```bash
# From backend/
node seed.js
```

### 3. Start the Backend

```bash
# Development (auto-restart)
npm run dev

# Production
npm start
```

### 4. Drop and Re-seed (if needed)

```bash
mongosh hospital_db --eval "db.dropDatabase()"
node seed.js
```

---

## Demo Data

After seeding:

| Ward      | Beds | Nominal Demand (D_i) | Max Deviation (U_i) | Occupied | Available |
|-----------|------|----------------------|---------------------|----------|-----------|
| ICU       |  30  |         25           |          5          |    18    |     8     |
| General   |  80  |         60           |         10          |    52    |    20     |
| Surgical  |  50  |         35           |          8          |    30    |    14     |
| Emergency |  40  |         40           |         12          |    28    |     8     |
| **Total** |**200**|                     |                     |  **128** |  **50**   |

### Demo Credentials

| Email                  | Password      | Role        |
|------------------------|---------------|-------------|
| admin@hospital.com     | Admin@1234    | admin       |
| doctor@hospital.com    | Doctor@1234   | doctor      |
| manager@hospital.com   | Manager@1234  | bed_manager |

---

## Project Structure

```
hospital-robust-optimization/
├── frontend/                        # React, Vite, Tailwind CSS
│   └── src/
│       ├── App.jsx                  # Dashboard, planning, and scenario views
│       └── App.css
├── backend/                         # Node.js + Express + MongoDB
│   ├── src/
│   │   ├── models/
│   │   ├── routes/
│   │   └── services/optimizationScenarios.js
│   ├── tests/                       # Node API scenario tests
│   └── optimization/                # FastAPI + CVXPY microservice
│       ├── app.py
│       ├── models/optimization_model.py
│       ├── services/
│       └── tests/
├── database/seed_data.json
└── README.md
```
