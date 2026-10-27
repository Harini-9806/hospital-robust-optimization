import { useEffect, useRef, useState } from 'react'
import './App.css'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000'
const EXCLUDED_WARD_NAMES = new Set(['TestWard_API', 'TestWard_API_20260828'])

function isExcludedWardRecord(record) {
  return Boolean(record && typeof record === 'object' && (
    (record._id && EXCLUDED_WARD_NAMES.has(record.name))
    || EXCLUDED_WARD_NAMES.has(record.wardName)
    || EXCLUDED_WARD_NAMES.has(record.ward_name)
  ))
}

function filterUserFacingWardData(value) {
  if (Array.isArray(value)) {
    return value
      .filter((record) => !isExcludedWardRecord(record) && !isExcludedWardRecord(record?.ward))
      .map(filterUserFacingWardData)
  }
  if (!value || typeof value !== 'object') return value

  const result = Object.fromEntries(Object.entries(value).map(([key, item]) => {
    if ((key === 'ward' || key === 'requiredWard') && isExcludedWardRecord(item)) {
      return [key, null]
    }
    return [key, filterUserFacingWardData(item)]
  }))

  if (Array.isArray(result.data) && typeof result.count === 'number') {
    result.count = result.data.length
  }

  for (const key of ['wardResults', 'ward_results']) {
    if (!Array.isArray(result[key]) || result[key].length === value[key].length) continue
    const wardResults = result[key]
    const sum = (camelKey, snakeKey) => wardResults.reduce(
      (total, ward) => total + Number(ward[camelKey] ?? ward[snakeKey] ?? 0),
      0,
    )
    const availableBeds = sum('availableBeds', 'available_beds')
    const allocatedBeds = sum('recommendedAllocation', 'recommended_allocation')
    const totals = {
      totalAvailableBeds: availableBeds,
      totalAllocatedBeds: allocatedBeds,
      totalReservedBeds: sum('reservedBeds', 'reserved_beds'),
      totalUnmetDemand: sum('unmetDemand', 'unmet_demand'),
      nominalUnmetDemand: wardResults.reduce(
        (total, ward) => total + Number(ward.nominalUnmetDemand ?? ward.nominal_unmet_demand ?? ward.unmetDemand ?? ward.unmet_demand ?? 0),
        0,
      ),
      capacityUtilization: availableBeds ? allocatedBeds / availableBeds : 0,
    }
    for (const [camelKey, total] of Object.entries(totals)) {
      const snakeKey = camelKey.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)
      if (camelKey in result) result[camelKey] = total
      if (snakeKey in result) result[snakeKey] = total
    }
    for (const keyName of ['objectiveValue', 'objective_value', 'robustSlackBedEquivalents', 'robust_slack_bed_equivalents', 'robustUncertaintySlackBedEquivalents', 'robust_uncertainty_slack_bed_equivalents']) {
      if (keyName in result) result[keyName] = null
    }
  }

  return result
}

async function apiFetch(path, token, options = {}) {
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(options.headers || {}),
    },
  })
  const data = await response.json()
  if (!response.ok) throw new Error(data.message || 'Request failed')
  return filterUserFacingWardData(data)
}

const navigation = [
  { label: 'Dashboard', path: '/', icon: 'DB', group: 'Overview' },
  { label: 'Patients', path: '/patients', icon: 'PT', group: 'Operations' },
  { label: 'Admit Patient', path: '/admit-patient', icon: 'AD', group: 'Operations' },
  { label: 'Wards', path: '/wards', icon: 'WD', group: 'Operations' },
  { label: 'Hospital Digital Twin', path: '/digital-twin', icon: 'DT', group: 'Operations' },
  { label: 'Patient Flow', path: '/patient-flow', icon: 'PF', group: 'Operations' },
  { label: 'Robust Optimization', path: '/robust-optimization', icon: 'RO', group: 'Planning' },
  { label: 'Surge Simulator', path: '/surge-simulator', icon: 'SS', group: 'Planning' },
  { label: 'Optimization Results', path: '/optimization-results', icon: 'OR', group: 'Planning' },
]

function SplashScreen({ onContinue }) {
  const [visible, setVisible] = useState(true)

  useEffect(() => {
    const timer = setTimeout(() => setVisible(false), 1500)
    const redirectTimer = setTimeout(() => onContinue(), 1900)

    return () => {
      clearTimeout(timer)
      clearTimeout(redirectTimer)
    }
  }, [onContinue])

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#edf5f3] px-6">
      <div className={`w-full max-w-md rounded-[2rem] border border-[#d8e7ea] bg-white p-8 text-center shadow-[0_28px_80px_rgba(18,62,82,0.12)] transition-all duration-700 ${visible ? 'scale-100 opacity-100' : 'scale-[0.98] opacity-0'}`}>
        <div className="mx-auto mb-5 grid h-20 w-20 place-items-center rounded-[1.5rem] bg-[#123e52] text-3xl font-black text-white shadow-lg shadow-[#123e52]/20">
          CF
        </div>

        <p className="text-[0.7rem] font-black tracking-[0.35em] text-[#4d8b88]">
          CAREFLOW
        </p>

        <h1 className="mt-4 text-3xl font-bold tracking-tight text-[#17324d]">
          CareFlow
        </h1>

        <p className="mt-3 text-sm leading-6 text-[#718899]">
          Hospital operations intelligence for resilient patient flow and capacity planning.
        </p>

        <div className="mt-8 flex items-center justify-center gap-2">
          {[0, 1, 2].map((dot) => (
            <span
              key={dot}
              className="h-2.5 w-2.5 rounded-full bg-[#4d8b88] animate-pulse"
              style={{ animationDelay: `${dot * 180}ms` }}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

function LoginPage({ onLogin }) {
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [showPassword, setShowPassword] = useState(false)

  async function handleSubmit(event) {
    event.preventDefault()
    setLoading(true)
    setError('')

    if (!identifier.trim() || !password.trim()) {
      setError('Admin username/email and password are required.')
      setLoading(false)
      return
    }

    try {
      const response = await fetch(`${API_URL}/api/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          identifier,
          password,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.message || 'Invalid admin credentials')
      }

      localStorage.setItem('token', data.token)
      onLogin(data.token)
    } catch (err) {
      setError(err.message || 'Unable to sign in')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#edf5f3] px-6 py-10">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-5 grid h-16 w-16 place-items-center rounded-2xl bg-[#123e52] text-xl font-black text-white">
            CF
          </div>

          <p className="text-[0.7rem] font-black tracking-[0.32em] text-[#4d8b88]">
            CAREFLOW
          </p>

          <h1 className="mt-3 text-3xl font-bold text-[#17324d]">
            Admin Sign In
          </h1>

          <p className="mt-3 text-sm text-[#718899]">
            Secure access to the hospital operations dashboard.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="rounded-[1.75rem] border border-[#dce8e5] bg-white p-7 shadow-[0_18px_40px_rgba(18,62,82,0.08)]">
          {error && (
            <div className="mb-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}

          <div>
            <label className="block text-sm font-semibold text-[#17324d]">
              Admin username or email
            </label>

            <input
              type="text"
              value={identifier}
              onChange={(event) => setIdentifier(event.target.value)}
              className="mt-2 w-full rounded-xl border border-[#d5e2e4] bg-[#f8fbfc] px-4 py-3 text-sm outline-none transition focus:border-[#4d8b88] focus:ring-4 focus:ring-[#4d8b88]/10"
              placeholder="admin@hospital.com"
            />
          </div>

          <div className="mt-5">
            <label className="block text-sm font-semibold text-[#17324d]">
              Password
            </label>

            <div className="relative mt-2">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="w-full rounded-xl border border-[#d5e2e4] bg-[#f8fbfc] px-4 py-3 pr-11 text-sm outline-none transition focus:border-[#4d8b88] focus:ring-4 focus:ring-[#4d8b88]/10"
                placeholder="Enter password"
              />

              <button
                type="button"
                onClick={() => setShowPassword((value) => !value)}
                className="absolute inset-y-0 right-3 flex items-center text-xs font-bold text-[#4d8b88]"
              >
                {showPassword ? 'Hide' : 'Show'}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="mt-7 w-full rounded-xl bg-[#123e52] px-5 py-3.5 text-sm font-bold text-white transition hover:bg-[#0d2f41] disabled:cursor-not-allowed disabled:opacity-70"
          >
            {loading ? 'Signing in...' : 'Sign In'}
          </button>

          <div className="mt-5 text-right text-sm">
            <span className="text-[#8aa0ad]">Admin access only</span>
          </div>
        </form>
      </div>
    </div>
  )
}

function AuthFlow({ onLogin }) {
  const [screen, setScreen] = useState('splash')

  return (
    <>
      {screen === 'splash' && <SplashScreen onContinue={() => setScreen('login')} />}
      {screen === 'login' && <LoginPage onLogin={onLogin} />}
    </>
  )
}

function Shell({ token, onLogout }) {
  const [currentPath, setCurrentPath] = useState(() => window.location.pathname === '/gamma-analysis' ? '/robust-optimization' : window.location.pathname)

  function navigate(path) {
    const destination = new URL(path, window.location.origin)
    window.history.pushState({}, '', destination)
    setCurrentPath(destination.pathname)
  }

  useEffect(() => {
    function handlePopState() {
      if (window.location.pathname === '/gamma-analysis') {
        window.history.replaceState({}, '', '/robust-optimization#gamma-analysis')
        setCurrentPath('/robust-optimization')
      } else {
        setCurrentPath(window.location.pathname)
      }
    }

    window.addEventListener('popstate', handlePopState)

    return () => {
      window.removeEventListener('popstate', handlePopState)
    }
  }, [])

  useEffect(() => {
    if (window.location.pathname === '/gamma-analysis') {
      window.history.replaceState({}, '', '/robust-optimization#gamma-analysis')
    }

    const sectionId = window.location.hash.slice(1)
    if (sectionId) {
      requestAnimationFrame(() => document.getElementById(sectionId)?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
    }
  }, [currentPath])

  return (
    <div className="min-h-screen bg-[#f3f7f5] text-[#17324d]">
      <div className="flex min-h-screen">
        <aside className="hidden min-h-screen w-64 shrink-0 flex-col bg-[#123e52] text-white lg:flex">
          <div className="p-6">
            <div className="flex items-center gap-3">
              <div className="grid h-10 w-10 place-items-center rounded-xl bg-white/10 font-black">
                CF
              </div>

              <div>
                <p className="text-sm font-black tracking-widest">
                  CAREFLOW
                </p>
                <p className="text-[10px] text-[#a9c6ca]">
                  Hospital Operations
                </p>
              </div>
            </div>
          </div>

          <nav className="min-h-0 flex-1 overflow-y-auto px-4">
            {['Overview', 'Operations', 'Planning'].map((group) => (
              <div key={group} className="mb-6">
                <p className="px-3 mb-2 text-[10px] font-black uppercase tracking-[0.2em] text-[#8fb3ba]">
                  {group}
                </p>

                {navigation
                  .filter((item) => item.group === group)
                  .map((item) => (
                    <button
                      key={item.path}
                      onClick={() => navigate(item.path)}
                      className={`mb-1 flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-semibold ${
                        currentPath === item.path
                          ? 'bg-white/15 text-white'
                          : 'text-[#b8ced2] hover:bg-white/10 hover:text-white'
                      }`}
                    >
                      <span className="grid h-8 w-8 place-items-center rounded-lg bg-white/10 text-[10px] font-black">
                        {item.icon}
                      </span>

                      {item.label}
                    </button>
                  ))}
              </div>
            ))}
          </nav>

          <div className="mt-auto w-full shrink-0 p-4">
            <button
              onClick={onLogout}
              className="w-full rounded-xl border border-white/10 px-4 py-3 text-sm font-bold text-[#b8ced2] hover:bg-white/10 hover:text-white"
            >
              Sign out
            </button>
          </div>
        </aside>

        <main className="min-w-0 flex-1">
          <header className="border-b border-[#dce8e5] bg-white px-6 py-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-black tracking-[0.2em] text-[#4d8b88]">
                  CARE OPERATIONS
                </p>

                <h2 className="mt-1 text-xl font-bold">
                  Hospital Management System
                </h2>
              </div>

              <button
                onClick={onLogout}
                className="rounded-xl bg-[#eef5f3] px-4 py-2 text-sm font-bold text-[#123e52] lg:hidden"
              >
                Logout
              </button>
            </div>
          </header>

          <div className="p-6 md:p-8">
            <PageContent
              token={token}
              path={currentPath}
              onNavigate={navigate}
            />
          </div>
        </main>
      </div>
    </div>
  )
}

function PageContent({ token, path, onNavigate }) {
  if (path === '/admit-patient') return <AdmitPatientPage token={token} onNavigate={onNavigate} />
  if (path === '/patients') return <PatientsPage token={token} />
  if (path === '/beds') return <BedsPage token={token} />
  if (path === '/patient-flow') return <PatientFlowPage token={token} />
  if (path === '/wards') return <WardsPage token={token} />
  if (path === '/digital-twin') return <HospitalDigitalTwinPage token={token} onNavigate={onNavigate} />
  if (path === '/demand-management') return <DemandManagementPage token={token} />
  if (path === '/surge-simulator') return <SurgeSimulatorPage token={token} />
  if (path === '/optimization-results') return <OptimizationResultsPage token={token} />
  if (path === '/robust-optimization') {
    return <OptimizationPage token={token} />
  }

  if (path === '/') {
    return <Dashboard onNavigate={onNavigate} />
  }

  const item = navigation.find((nav) => nav.path === path)

  return (
    <div>
      <PageHeading
        eyebrow={item?.group || 'Careflow'}
        title={item?.label || 'Page'}
        description="Live hospital operations data from the connected backend."
      />

      <div className="mt-8 rounded-2xl border border-[#dce8e5] bg-white p-8">
        <p className="text-lg font-bold text-[#17324d]">
          {item?.label || 'Page'} module
        </p>

        <p className="mt-2 text-sm text-[#718899]">No records are available for this module yet.</p>
      </div>
    </div>
  )
}

function Dashboard({ onNavigate }) {
  const [summary, setSummary] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    const token = localStorage.getItem('token')
    Promise.all([
      apiFetch('/api/beds', token),
      apiFetch('/api/patients', token),
      apiFetch('/api/admissions', token),
      apiFetch('/api/wards', token),
    ]).then(([bedsResponse, patientsResponse, admissionsResponse, wardsResponse]) => {
      const beds = bedsResponse.data || []
      const patients = patientsResponse.data || []
      const admissions = admissionsResponse.data || []
      const today = new Date().toISOString().slice(0, 10)
      const countToday = (records, field) => records.filter((record) => record[field] && String(record[field]).slice(0, 10) === today).length
      const highDemandWards = (wardsResponse.data || []).filter((ward) => ward.availableBeds < (ward.occupiedBeds || 0)).length
      setSummary({
        total: beds.length,
        available: beds.filter((bed) => bed.status === 'available').length,
        occupied: beds.filter((bed) => bed.status === 'occupied').length,
        reserved: beds.filter((bed) => bed.status === 'reserved').length,
        maintenance: beds.filter((bed) => bed.status === 'maintenance').length,
        admitted: patients.filter((patient) => patient.status === 'admitted').length,
        admissionsToday: countToday(admissions, 'admissionDate'),
        dischargesToday: countToday(admissions.filter((admission) => admission.status === 'discharged'), 'actualDischargeDate'),
        highDemandWards,
      })
    }).catch((err) => setError(err.message))
  }, [])

  const metrics = summary || { total: '-', available: '-', occupied: '-', reserved: '-', maintenance: '-', admitted: '-', admissionsToday: '-', dischargesToday: '-', highDemandWards: '-' }

  return (
    <div>
      <PageHeading
        eyebrow="Overview"
        title="Hospital Operations Dashboard"
        description="Monitor beds, patient flow, demand and robust resource allocation."
        action="Admit Patient"
        onAction={() => onNavigate('/admit-patient')}
      />

      {error && <div className="mt-6 rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{error}</div>}

      <div className="mt-8 grid gap-5 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard
          label="Total Beds"
          value={metrics.total}
          note="Across all wards"
          tone="blue"
        />
        <StatCard
          label="Available Beds"
          value={metrics.available}
          note="Across active wards"
          tone="mint"
        />

        <StatCard
          label="Occupied Beds"
          value={metrics.occupied}
          note="Current occupancy"
          tone="blue"
        />

        <StatCard
          label="Admitted Patients"
          value={metrics.admitted}
          note="Currently admitted"
          tone="gold"
        />

        <StatCard
          label="Today's Admissions"
          value={metrics.admissionsToday}
          note={`${metrics.dischargesToday} discharges today`}
          tone="coral"
        />
      </div>

      <div className="mt-5 grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Reserved Beds" value={metrics.reserved} note="Held for upcoming care" tone="gold" />
        <StatCard label="Maintenance Beds" value={metrics.maintenance} note="Unavailable for allocation" tone="coral" />
        <StatCard label="Today's Discharges" value={metrics.dischargesToday} note="Completed patient journeys" tone="mint" />
        <StatCard label="High Demand Wards" value={metrics.highDemandWards} note="Capacity pressure detected" tone="blue" />
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <div className="rounded-2xl bg-[#123e52] p-7 text-white">
          <p className="text-xs font-black uppercase tracking-[0.2em] text-[#9fc2c8]">
            Robust Optimization
          </p>

          <h3 className="mt-3 text-2xl font-bold">
            Optimize bed allocation under uncertain demand.
          </h3>

          <p className="mt-3 text-sm leading-6 text-[#b8ced2]">
            Use the Gamma uncertainty budget to control how conservatively
            the hospital protects against demand deviations.
          </p>

          <button
            onClick={() => onNavigate('/robust-optimization')}
            className="mt-6 rounded-xl bg-white px-5 py-3 text-sm font-bold text-[#123e52]"
          >
            Open Optimization →
          </button>
        </div>

        <div className="rounded-2xl border border-[#dce8e5] bg-white p-7">
          <div className="quote-panel">
            <p className="quote-text">To cure sometimes, to relieve often, to comfort always.</p>
          </div>
        </div>
      </div>
    </div>
  )
}

function useResource(path, token) {
  const [state, setState] = useState({ data: [], loading: true, error: '' })
  const [refreshKey, setRefreshKey] = useState(0)
  useEffect(() => {
    let active = true
    setState((current) => ({ ...current, loading: true, error: '' }))
    apiFetch(path, token)
      .then((result) => active && setState({ data: result.data || [], loading: false, error: '' }))
      .catch((err) => active && setState({ data: [], loading: false, error: err.message }))
    return () => { active = false }
  }, [path, token, refreshKey])
  return { ...state, refresh: () => setRefreshKey((value) => value + 1) }
}

function BedsPage({ token }) {
  const beds = useResource('/api/beds', token)
  return (
    <div>
      <PageHeading eyebrow="Operations" title="Bed Management" description="Live bed status and current patient assignments from MongoDB." />
      {beds.error && <ErrorNotice message={beds.error} />}
      <div className="mt-8 overflow-x-auto rounded-2xl border border-[#dce8e5] bg-white p-6">
        <table className="w-full min-w-[680px] text-left text-sm">
          <thead><tr className="border-b border-[#e1ebea] text-xs uppercase tracking-wider text-[#8294a0]"><th className="pb-3">Bed Number</th><th className="pb-3">Ward</th><th className="pb-3">Status</th><th className="pb-3">Patient</th><th className="pb-3">Actions</th></tr></thead>
          <tbody>{beds.data.map((bed) => <tr key={bed._id} className="border-b border-[#eef3f2]"><td className="py-4 font-bold">{bed.bedNumber}</td><td>{bed.ward?.name || '-'}</td><td><StatusBadge status={bed.status} /></td><td>{bed.patient?.name || '—'}</td><td>{bed.status === 'occupied' ? <span className="text-xs text-[#8294a0]">Released by discharge</span> : <span className="text-xs text-[#8294a0]">Ready for assignment</span>}</td></tr>)}</tbody>
        </table>
        {!beds.loading && !beds.data.length && <EmptyState text="No beds found in MongoDB." />}
      </div>
    </div>
  )
}

function PatientsPage({ token }) {
  const patients = useResource('/api/patients', token)
  return <div><PageHeading eyebrow="Operations" title="Patients" description="Current patient status and ward placement." />{patients.error && <ErrorNotice message={patients.error} />}<div className="mt-8 overflow-x-auto rounded-2xl border border-[#dce8e5] bg-white p-6"><table className="w-full min-w-[680px] text-left text-sm"><thead><tr className="border-b border-[#e1ebea] text-xs uppercase tracking-wider text-[#8294a0]"><th className="pb-3">Patient</th><th className="pb-3">Age / Gender</th><th className="pb-3">Diagnosis</th><th className="pb-3">Ward</th><th className="pb-3">Status</th></tr></thead><tbody>{patients.data.map((patient) => <tr key={patient._id} className="border-b border-[#eef3f2]"><td className="py-4 font-bold">{patient.name}<span className="ml-2 text-xs font-normal text-[#8294a0]">{patient.patientId}</span></td><td>{patient.age} / {patient.gender}</td><td>{patient.medicalCondition || '—'}</td><td>{patient.requiredWard?.name || '—'}</td><td><StatusBadge status={patient.status} label={patient.status === 'waiting' ? (patient.waitingListAt ? 'Waiting List' : 'Waiting for Admission') : patient.status === 'admitted' ? 'Active / Admitted' : undefined} /></td></tr>)}</tbody></table>{patients.loading && !patients.data.length && <EmptyState text="Loading patient records..." />}{!patients.loading && !patients.data.length && <EmptyState text="No patients found in MongoDB." />}</div></div>
}

function AdmitPatientPage({ token, onNavigate }) {
  const wards = useResource('/api/wards', token)
  const beds = useResource('/api/beds?status=available', token)
  const [form, setForm] = useState({ name: '', age: '', gender: 'male', phoneNumber: '', emergencyContact: '', diagnosis: '', admissionDate: new Date().toISOString().slice(0, 10), admissionTime: new Date().toTimeString().slice(0, 5), admissionType: 'normal', requiredWard: '', doctorName: '', medicalNotes: '', bed: '' })
  const [state, setState] = useState({ saving: false, error: '', success: '' })
  const [successPath, setSuccessPath] = useState('/beds')
  const availableBeds = beds.data.filter((bed) => !form.requiredWard || bed.ward?._id === form.requiredWard)
  const addToQueue = Boolean(form.requiredWard) && !availableBeds.length
  function update(event) {
    const { name, value } = event.target
    setForm((current) => ({
      ...current,
      [name]: value,
      ...(name === 'requiredWard' ? { bed: '' } : {}),
    }))
  }
  async function submit(event) {
    event.preventDefault()
    setState({ saving: true, error: '', success: '' })
    setSuccessPath('/beds')
    let patientCreated = false
    try {
      const patient = await apiFetch('/api/patients', token, { method: 'POST', body: JSON.stringify({ patientId: `P-${Date.now()}`, name: form.name, age: Number(form.age), gender: form.gender, phoneNumber: form.phoneNumber, emergencyContact: form.emergencyContact, medicalCondition: form.diagnosis, requiredWard: form.requiredWard || null, priority: form.admissionType === 'emergency' ? 'critical' : 'medium', status: 'waiting' }) })
      patientCreated = true
      if (addToQueue) {
        const result = await apiFetch(`/api/patients/${patient.data._id}/waiting-list`, token, { method: 'POST', body: JSON.stringify({}) })
        const automaticAdmissions = result.automaticallyAdmitted || []
        setState({
          saving: false,
          error: '',
          success: automaticAdmissions.length
            ? `${automaticAdmissions.map((item) => item.patient?.name || 'A waiting patient').join(', ')} automatically admitted after a compatible bed became available.`
            : result.data?.status === 'admitted'
              ? `${form.name} was automatically admitted to ${wards.data.find((ward) => ward._id === form.requiredWard)?.name || 'the required ward'}.`
              : `${form.name} added to the ${wards.data.find((ward) => ward._id === form.requiredWard)?.name || 'required ward'} waiting list.`,
        })
        setSuccessPath('/patient-flow')
      } else {
        const admissionDate = new Date(`${form.admissionDate}T${form.admissionTime}`)
        await apiFetch('/api/admissions', token, { method: 'POST', body: JSON.stringify({ patient: patient.data._id, bed: form.bed, admissionDate: admissionDate.toISOString(), admissionType: form.admissionType, doctorName: form.doctorName, medicalNotes: form.medicalNotes }) })
        setState({ saving: false, error: '', success: `${form.name} admitted successfully. Bed availability has been updated.` })
      }
      beds.refresh()
      setForm({ ...form, name: '', age: '', diagnosis: '', phoneNumber: '', emergencyContact: '', medicalNotes: '', bed: '' })
    } catch (err) {
      setState({ saving: false, error: patientCreated ? `Patient was registered but could not be admitted or queued: ${err.message}` : err.message, success: '' })
    }
  }
  return <div><PageHeading eyebrow="Operations" title="Admit Patient" description="Collect patient details and assign a compatible bed, or persist the patient on the ward waiting list when capacity is full." />{beds.error && <ErrorNotice message={beds.error} />}{state.error && <ErrorNotice message={state.error} />}{state.success && <div role="status" className="mt-6 rounded-xl bg-[#e7f1eb] px-4 py-3 text-sm text-[#3f897b]">{state.success} <button onClick={() => onNavigate(successPath)} className="ml-2 font-bold underline">{successPath === '/beds' ? 'View beds' : 'View Patient Flow'}</button></div>}<form onSubmit={submit} className="mt-8 rounded-2xl border border-[#dce8e5] bg-white p-6"><div className="grid gap-5 md:grid-cols-2"><Field label="Patient Name" name="name" value={form.name} onChange={update} required /><Field label="Age" name="age" type="number" value={form.age} onChange={update} required /><SelectField label="Gender" name="gender" value={form.gender} onChange={update} options={['male', 'female', 'other']} /><Field label="Phone Number" name="phoneNumber" value={form.phoneNumber} onChange={update} /><Field label="Emergency Contact" name="emergencyContact" value={form.emergencyContact} onChange={update} /><Field label="Diagnosis" name="diagnosis" value={form.diagnosis} onChange={update} required /><Field label="Admission Date" name="admissionDate" type="date" value={form.admissionDate} onChange={update} required={!addToQueue} /><Field label="Admission Time" name="admissionTime" type="time" value={form.admissionTime} onChange={update} required={!addToQueue} /><SelectField label="Admission Type" name="admissionType" value={form.admissionType} onChange={update} options={['emergency', 'normal', 'surgery', 'icu']} /><SelectField label="Required Ward" name="requiredWard" value={form.requiredWard} onChange={update} options={wards.data.map((ward) => ({ value: ward._id, label: ward.name }))} placeholder="Select a ward" /><Field label="Doctor Name" name="doctorName" value={form.doctorName} onChange={update} /><SelectField label="Available Bed" name="bed" value={form.bed} onChange={update} options={availableBeds.map((bed) => ({ value: bed._id, label: `${bed.bedNumber} — ${bed.ward?.name || 'Ward'}` }))} placeholder={availableBeds.length ? 'Select an available bed' : 'No suitable beds available'} required={!addToQueue} /><TextAreaField label="Medical Notes" name="medicalNotes" value={form.medicalNotes} onChange={update} /></div><button disabled={state.saving || beds.loading || Boolean(beds.error) || !form.requiredWard || (!addToQueue && !form.bed)} className="mt-7 rounded-xl bg-[#123e52] px-5 py-3.5 text-sm font-bold text-white disabled:opacity-60">{state.saving ? 'Saving...' : addToQueue ? 'Add to Waiting List' : 'Confirm Admission'}</button></form></div>
}

function PatientFlowPage({ token }) {
  const admissions = useResource('/api/admissions', token)
  const patients = useResource('/api/patients', token)
  const beds = useResource('/api/beds?status=available', token)
  const wards = useResource('/api/wards', token)
  const [processingId, setProcessingId] = useState('')
  const processingIdRef = useRef('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const activePatients = patients.data.filter((patient) => patient.status === 'admitted')
  const waitingPatients = patients.data
    .filter((patient) => patient.status === 'waiting')
    .sort((left, right) => {
      if (left.waitingListAt && right.waitingListAt) return new Date(left.waitingListAt) - new Date(right.waitingListAt)
      if (left.waitingListAt) return -1
      if (right.waitingListAt) return 1
      return new Date(left.createdAt) - new Date(right.createdAt)
    })
  const queuePositions = new Map()
  for (const patient of waitingPatients.filter((item) => item.waitingListAt)) {
    const wardId = patient.requiredWard?._id || patient.requiredWard
    const position = (queuePositions.get(wardId) || 0) + 1
    queuePositions.set(wardId, position)
    queuePositions.set(patient._id, position)
  }

  async function updatePatientFlowStatus(item, currentStatus, selectedStatus) {
    const enqueueWaitingPatient = currentStatus === 'waiting'
      && selectedStatus === 'waiting'
      && !item.waitingListAt
    if ((selectedStatus === currentStatus && !enqueueWaitingPatient) || processingIdRef.current) return

    processingIdRef.current = item._id
    setProcessingId(item._id)
    setError('')
    setSuccess('')
    try {
      let result
      if (currentStatus === 'active') {
        if (selectedStatus === 'waiting' && !(item.patient?.requiredWard?._id || item.patient?.requiredWard || item.ward?._id || item.ward))
          throw new Error('Select a required ward for this patient before adding them to the waiting list.')
        result = await apiFetch(`/api/admissions/${item._id}`, token, {
          method: 'PUT',
          body: JSON.stringify(selectedStatus === 'discharged'
            ? { status: 'discharged', actualDischargeDate: new Date().toISOString() }
            : { status: 'waiting' }),
        })
      } else if (enqueueWaitingPatient) {
        result = await apiFetch(`/api/patients/${item._id}/waiting-list`, token, {
          method: 'POST',
          body: JSON.stringify({}),
        })
      } else if (selectedStatus === 'active') {
        const requiredWardId = item.requiredWard?._id || item.requiredWard
        if (!requiredWardId)
          throw new Error('Select a required ward before admitting this patient.')
        const bed = beds.data.find((availableBed) => (
          String(availableBed.ward?._id || availableBed.ward) === String(requiredWardId)
        ))
        if (!bed && item.waitingListAt)
          throw new Error('No available bed in the patient’s required ward. They remain on the waiting list.')
        if (!bed) {
          result = await apiFetch(`/api/patients/${item._id}/waiting-list`, token, {
            method: 'POST',
            body: JSON.stringify({}),
          })
        } else {
          result = await apiFetch('/api/admissions', token, {
            method: 'POST',
            body: JSON.stringify({
              patient: item._id,
              bed: bed._id,
              admissionDate: new Date().toISOString(),
            }),
          })
        }
      } else {
        return
      }

      const autoAdmitted = result.automaticallyAdmitted || []
      const patientName = currentStatus === 'active'
        ? item.patient?.name || 'patient'
        : item.name || 'patient'
      const transitionMessage = selectedStatus === 'discharged'
        ? `Discharged ${patientName}.`
        : selectedStatus === 'waiting'
          ? result.data?.status === 'admitted'
            ? `${patientName} admitted to the required ward.`
            : `${patientName} added to the waiting list.`
          : result.data?.status === 'waiting'
            ? `No compatible bed is available; ${patientName} remains on the waiting list.`
            : `${patientName} admitted to the required ward.`
      setSuccess(autoAdmitted.length
        ? `${transitionMessage} ${autoAdmitted.map((admitted) => `${admitted.patient?.name || 'A waiting patient'} (${admitted.ward?.name || 'compatible ward'})`).join(', ')} automatically admitted after a bed became available.`
        : result.automaticAdmissionWarning
          ? `${transitionMessage} The bed was released.`
          : transitionMessage)
      admissions.refresh()
      patients.refresh()
      beds.refresh()
      if (result.automaticAdmissionWarning)
        setError(result.automaticAdmissionWarning)
    } catch (err) {
      setError(err.message || 'Unable to update patient status')
    } finally {
      processingIdRef.current = ''
      setProcessingId('')
    }
  }

  async function updatePatientRequiredWard(patient, requiredWard) {
    if (!requiredWard || processingIdRef.current) return

    processingIdRef.current = patient._id
    setProcessingId(patient._id)
    setError('')
    setSuccess('')
    try {
      await apiFetch(`/api/patients/${patient._id}`, token, {
        method: 'PUT',
        body: JSON.stringify({ requiredWard }),
      })
      setSuccess(`${patient.name}’s required ward was saved. Select Waiting List to add them to the queue.`)
      patients.refresh()
    } catch (err) {
      setError(err.message || 'Unable to save the required ward')
      patients.refresh()
    } finally {
      processingIdRef.current = ''
      setProcessingId('')
    }
  }

  return (
    <div>
      <PageHeading eyebrow="Operations" title="Patient Flow" description="Current admissions, waiting-list priority, recent movement, and live bed capacity." />
      {error && <ErrorNotice message={error} />}
      {admissions.error && <ErrorNotice message={admissions.error} />}
      {patients.error && <ErrorNotice message={patients.error} />}
      {beds.error && <ErrorNotice message={beds.error} />}
      {wards.error && <ErrorNotice message={wards.error} />}
      {success && <div role="status" className="mt-6 rounded-xl border border-[#cde4d9] bg-[#e7f1eb] px-4 py-3 text-sm text-[#286d61]">{success}</div>}
      <div className="mt-8 grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Current Admissions" value={activePatients.length} note="Active patients" tone="blue" />
        <StatCard label="Available Beds" value={beds.data.length} note="Ready to assign" tone="mint" />
        <StatCard label="Today's Admissions" value={admissions.data.filter((item) => String(item.admissionDate).slice(0, 10) === new Date().toISOString().slice(0, 10)).length} note="Arrivals today" tone="gold" />
        <StatCard label="Today's Discharges" value={admissions.data.filter((item) => item.status === 'discharged' && String(item.actualDischargeDate).slice(0, 10) === new Date().toISOString().slice(0, 10)).length} note="Beds released today" tone="coral" />
        <StatCard label="Waiting List" value={waitingPatients.filter((patient) => patient.waitingListAt).length} note="Awaiting a compatible bed" tone="gold" />
      </div>
      <div className="mt-8 overflow-x-auto rounded-2xl border border-[#dce8e5] bg-white p-6">
        <p className="text-xs font-black uppercase tracking-[0.2em] text-[#4d8b88]">Recent patient movement</p>
        <table className="mt-5 w-full min-w-[900px] text-left text-sm">
          <thead><tr className="border-b border-[#e1ebea] text-xs uppercase tracking-wider text-[#8294a0]"><th className="pb-3">Patient</th><th className="pb-3">Required Ward</th><th className="pb-3">Bed</th><th className="pb-3">Admission / Wait Time</th><th className="pb-3">Status</th><th className="pb-3">Actions</th></tr></thead>
          <tbody>
            {admissions.data.slice(0, 12).map((item) => <tr key={item._id} className="border-b border-[#eef3f2]">
              <td className="py-4 font-bold">{item.patient?.name || '-'}</td>
              <td>{item.ward?.name || '-'}</td>
              <td>{item.bed?.bedNumber || '-'}</td>
              <td>{new Date(item.admissionDate).toLocaleString()}</td>
              <td><StatusBadge status={item.status} label={item.status === 'active' ? 'Active / Admitted' : undefined} /></td>
              <td>
                {item.status === 'active' ? (
                  <select
                    className="status-select"
                    aria-label={`Update status for ${item.patient?.name || 'patient'}`}
                    value="active"
                    disabled={processingId === item._id}
                    onChange={(event) => updatePatientFlowStatus(item, 'active', event.target.value)}
                  >
                    <option value="active">Active</option>
                    <option value="waiting">Waiting List</option>
                    <option value="discharged">Discharge</option>
                  </select>
                ) : (
                  <span className="action-status action-status-discharged">
                    {item.status === 'discharged' ? 'Discharged' : item.status === 'transferred' ? 'Transferred' : item.status}
                  </span>
                )}
              </td>
            </tr>)}
            {waitingPatients.map((patient) => {
              const requiredWardId = patient.requiredWard?._id || patient.requiredWard
              const available = beds.data.some((bed) => String(bed.ward?._id || bed.ward) === String(requiredWardId))
              const position = queuePositions.get(patient._id)
              return <tr key={`waiting-${patient._id}`} className="border-b border-[#eef3f2] bg-[#fbfdfc]">
                <td className="py-4 font-bold">{patient.name}<span className="ml-2 text-xs font-normal text-[#8294a0]">{patient.patientId}</span></td>
                <td>
                  {patient.requiredWard?.name || (
                    <select
                      className="status-select"
                      aria-label={`Select required ward for ${patient.name || 'patient'}`}
                      value=""
                      disabled={processingId === patient._id || wards.loading || Boolean(wards.error)}
                      onChange={(event) => updatePatientRequiredWard(patient, event.target.value)}
                    >
                      <option value="" disabled>Select a ward</option>
                      {wards.data.map((ward) => (
                        <option key={ward._id} value={ward._id}>{ward.name}</option>
                      ))}
                    </select>
                  )}
                </td>
                <td>—</td>
                <td>{patient.waitingListAt ? `Waiting since ${new Date(patient.waitingListAt).toLocaleString()}${position ? ` · #${position}` : ''}` : 'Not queued'}</td>
                <td><StatusBadge status="waiting" label={patient.waitingListAt ? 'Waiting List' : 'Waiting'} /></td>
                <td>
                  <select
                    className="status-select"
                    aria-label={`Update status for ${patient.name || 'patient'}`}
                    value={patient.waitingListAt ? 'waiting' : ''}
                    disabled={processingId === patient._id || beds.loading || Boolean(beds.error)}
                    onChange={(event) => updatePatientFlowStatus(patient, 'waiting', event.target.value)}
                  >
                    {!patient.waitingListAt && <option value="" disabled>Select status</option>}
                    <option value="active">Active</option>
                    <option value="waiting">Waiting List{position ? ` · #${position}` : ''}</option>
                    <option value="discharged" disabled>Discharge</option>
                  </select>
                  {!patient.requiredWard && <span className="ml-2 text-xs text-[#718899]">Select a ward</span>}
                  {patient.requiredWard && !beds.loading && !beds.error && !available && (
                    <span className="ml-2 text-xs text-[#718899]">No compatible bed</span>
                  )}
                </td>
              </tr>
            })}
          </tbody>
        </table>
        {!admissions.loading && !patients.loading && !admissions.data.length && !waitingPatients.length && <EmptyState text="No patient movement or waiting-list patients found." />}
      </div>
    </div>
  )
}

function Field({ label, name, value, onChange, type = 'text', required = false }) { return <label className="block text-sm font-semibold text-[#17324d]">{label}<input className="field mt-2" name={name} type={type} value={value} onChange={onChange} required={required} /></label> }
function TextAreaField({ label, name, value, onChange }) { return <label className="block text-sm font-semibold text-[#17324d] md:col-span-2">{label}<textarea className="field mt-2 min-h-24" name={name} value={value} onChange={onChange} /></label> }
function SelectField({ label, name, value, onChange, options, placeholder, required = name === 'requiredWard' || name === 'bed' }) { return <label className="block text-sm font-semibold text-[#17324d]">{label}<select className="field mt-2" name={name} value={value} onChange={onChange} required={required}><option value="">{placeholder || 'Select'}</option>{options.map((option) => { const item = typeof option === 'string' ? { value: option, label: option[0].toUpperCase() + option.slice(1) } : option; return <option key={item.value} value={item.value}>{item.label}</option> })}</select></label> }
function StatusBadge({ status, label = status }) { return <span className={`badge ${status === 'available' || status === 'discharged' || status === 'admitted' ? 'badge-success' : ''}`}>{label}</span> }
function ErrorNotice({ message }) { return <div className="mt-6 rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{message}</div> }
function EmptyState({ text }) { return <p className="py-8 text-center text-sm text-[#718899]">{text}</p> }

function WardsPage({ token }) {
  const wards = useResource('/api/wards', token)
  return <div><PageHeading eyebrow="Operations" title="Wards" description="Live ward capacity and bed status from MongoDB." />{wards.error && <ErrorNotice message={wards.error} />}<div className="mt-8 overflow-x-auto rounded-2xl border border-[#dce8e5] bg-white p-6"><table className="w-full min-w-[760px] text-left text-sm"><thead><tr className="border-b border-[#e1ebea] text-xs uppercase tracking-wider text-[#8294a0]"><th className="pb-3">Ward</th><th className="pb-3">Total Beds</th><th className="pb-3">Available</th><th className="pb-3">Occupied</th><th className="pb-3">Reserved</th><th className="pb-3">Maintenance</th></tr></thead><tbody>{wards.data.map((ward) => <tr key={ward._id} className="border-b border-[#eef3f2]"><td className="py-4 font-bold">{ward.name}</td><td>{ward.totalBeds}</td><td className="font-bold text-[#3f897b]">{ward.availableBeds}</td><td>{ward.occupiedBeds}</td><td>{ward.reservedBeds}</td><td>{ward.maintenanceBeds}</td></tr>)}</tbody></table>{!wards.loading && !wards.data.length && <EmptyState text="No wards found in MongoDB." />}</div></div>
}

function HospitalDigitalTwinPage({ token, onNavigate }) {
  const wards = useResource('/api/wards', token)
  const beds = useResource('/api/beds', token)
  const [selectedWardId, setSelectedWardId] = useState('')
  const [selectedBedId, setSelectedBedId] = useState('')
  const [viewMode, setViewMode] = useState('actual')
  const [surgeWardId, setSurgeWardId] = useState('')
  const [surgeArrivals, setSurgeArrivals] = useState(10)
  const [projection, setProjection] = useState(null)
  const [latestRun, setLatestRun] = useState(null)
  const [latestRunLoading, setLatestRunLoading] = useState(true)
  const [latestRunError, setLatestRunError] = useState('')
  const loading = wards.loading || beds.loading
  const error = wards.error || beds.error

  useEffect(() => {
    let active = true
    apiFetch('/api/optimization/latest', token)
      .then((response) => active && setLatestRun(response.data))
      .catch((err) => {
        if (active && !err.message.includes('No optimization run')) {
          setLatestRunError(err.message)
        }
      })
      .finally(() => active && setLatestRunLoading(false))
    return () => { active = false }
  }, [token])
  const canonicalOrder = ['icu', 'general', 'surgical', 'emergency']
  const sortedWards = [...wards.data].sort((left, right) => {
    const leftRank = canonicalOrder.indexOf(String(left.name).toLowerCase())
    const rightRank = canonicalOrder.indexOf(String(right.name).toLowerCase())
    if (leftRank >= 0 || rightRank >= 0) {
      return (leftRank < 0 ? canonicalOrder.length : leftRank)
        - (rightRank < 0 ? canonicalOrder.length : rightRank)
    }
    return left.name.localeCompare(right.name)
  })
  const selectedWard = sortedWards.find((ward) => ward._id === selectedWardId) || sortedWards[0]
  const selectedWardBeds = selectedWard
    ? beds.data.filter((bed) => bed.ward?._id === selectedWard._id)
    : []
  const wardStatusCounts = selectedWardBeds.reduce((counts, bed) => {
    counts[bed.status] = (counts[bed.status] || 0) + 1
    return counts
  }, { available: 0, occupied: 0, reserved: 0, maintenance: 0 })
  const activeProjection = viewMode === 'simulation' && projection
    ? projection
    : null
  const simulatedBedIds = new Set(activeProjection?.bedIds || [])
  const projectedCounts = {
    ...wardStatusCounts,
    available: wardStatusCounts.available - (activeProjection?.bedIds.length || 0),
    occupied: wardStatusCounts.occupied + (activeProjection?.bedIds.length || 0),
  }
  const selectedBed = beds.data.find((bed) => bed._id === selectedBedId)
  const refreshDisabled = loading

  function refreshSnapshot() {
    setProjection(null)
    setSelectedBedId('')
    wards.refresh()
    beds.refresh()
  }

  function chooseWard(wardId) {
    setSelectedWardId(wardId)
    setSelectedBedId('')
  }

  function runSurgeProjection(event) {
    event.preventDefault()
    const targetWardId = surgeWardId || selectedWard?._id
    if (!targetWardId) return
    const availableBeds = beds.data.filter((bed) =>
      bed.ward?._id === targetWardId && bed.status === 'available'
    )
    const projectedBedIds = availableBeds
      .slice(0, Number(surgeArrivals))
      .map((bed) => bed._id)
    setProjection({
      wardId: targetWardId,
      arrivals: Number(surgeArrivals),
      bedIds: projectedBedIds,
      unplaced: Math.max(0, Number(surgeArrivals) - projectedBedIds.length),
    })
    setViewMode('simulation')
    setSelectedWardId(targetWardId)
    setSelectedBedId('')
  }

  function resetSurgeProjection() {
    setProjection(null)
    setSurgeArrivals(10)
    setViewMode('actual')
  }

  return (
    <div className="page-enter twin-page">
      <PageHeading eyebrow="Operations / Live twin" title="Hospital Digital Twin" description="Explore live ward and bed status, or preview a local emergency-surge projection." />
      <div className="twin-toolbar">
        <div className="twin-mode-switch" role="group" aria-label="Digital twin view">
          <button type="button" aria-pressed={viewMode === 'actual'} onClick={() => setViewMode('actual')}>Actual snapshot</button>
          <button type="button" aria-pressed={viewMode === 'simulation'} onClick={() => setViewMode('simulation')}>Surge simulation</button>
        </div>
        <button type="button" className="twin-refresh-button" onClick={refreshSnapshot} disabled={refreshDisabled}>
          <span aria-hidden="true">↻</span> {loading ? 'Refreshing…' : 'Refresh data'}
        </button>
      </div>

      <div className="twin-status-legend" aria-label="Bed status legend">
        {[
          ['available', 'Available'],
          ['occupied', 'Occupied'],
          ['reserved', 'Reserved'],
          ['maintenance', 'Maintenance'],
          ...(activeProjection ? [['simulated', 'Simulated occupancy']] : []),
        ].map(([status, label]) => (
          <span className="twin-legend-item" key={status}>
            <i className={`twin-legend-swatch twin-status-${status}`} aria-hidden="true" />
            {label}
          </span>
        ))}
      </div>

      {error && <ErrorNotice message={error} />}
      {loading && !wards.data.length && !beds.data.length ? (
        <div className="twin-state-panel" role="status">Loading wards and bed status…</div>
      ) : error ? (
        <div className="twin-state-panel" role="alert">The complete ward and bed snapshot could not be loaded. Use Refresh data to try again.</div>
      ) : !wards.data.length ? (
        <div className="twin-state-panel">No wards are available in the current hospital data.</div>
      ) : !beds.data.length ? (
        <div className="twin-state-panel">Wards were found, but no bed records are available to visualize.</div>
      ) : (
        <div className="twin-dashboard">
          <section className="twin-map-panel" aria-label="Hospital ward and bed map">
            <div className="twin-panel-heading">
              <div>
                <p className="eyebrow">Ward map</p>
                <h2>{activeProjection ? 'Projected bed state' : 'Current bed state'}</h2>
              </div>
              <span className={`twin-data-tag ${activeProjection ? 'twin-data-tag-simulated' : ''}`}>
                {activeProjection ? 'SIMULATED' : 'LIVE DATA'}
              </span>
            </div>
            <div className="twin-ward-grid">
              {sortedWards.map((ward) => {
                const wardBeds = beds.data.filter((bed) => bed.ward?._id === ward._id)
                const wardProjection = activeProjection?.wardId === ward._id ? activeProjection : null
                return (
                  <article className={`twin-ward-zone ${selectedWard?._id === ward._id ? 'twin-ward-zone-selected' : ''}`} key={ward._id}>
                    <button type="button" className="twin-ward-select" onClick={() => chooseWard(ward._id)} aria-pressed={selectedWard?._id === ward._id}>
                      <span><strong>{ward.name}</strong><small>{wardBeds.length} beds</small></span>
                      <span className="twin-ward-arrow" aria-hidden="true">↗</span>
                    </button>
                    <div className="twin-floor-plane" aria-label={`${ward.name} beds`}>
                      {wardBeds.map((bed) => {
                        const isSimulated = Boolean(wardProjection && simulatedBedIds.has(bed._id))
                        const displayStatus = isSimulated ? 'simulated' : bed.status
                        const statusText = isSimulated ? 'simulated occupied' : bed.status
                        return (
                          <button
                            type="button"
                            key={bed._id}
                            className={`twin-bed twin-status-${displayStatus} ${selectedBedId === bed._id ? 'twin-bed-selected' : ''}`}
                            aria-label={`${ward.name}, bed ${bed.bedNumber}: ${statusText}${isSimulated ? ', actual status available' : ''}`}
                            aria-pressed={selectedBedId === bed._id}
                            onClick={() => { chooseWard(ward._id); setSelectedBedId(bed._id) }}
                            title={`${bed.bedNumber}: ${statusText}`}
                          >
                            <span className="twin-bed-number">{bed.bedNumber}</span>
                            <span className="twin-bed-code" aria-hidden="true">{isSimulated ? 'SIM' : bed.status.slice(0, 3).toUpperCase()}</span>
                          </button>
                        )
                      })}
                      {!wardBeds.length && <span className="twin-floor-empty">No beds recorded</span>}
                    </div>
                    <div className="twin-zone-foot"><span>{wardProjection ? `${wardProjection.bedIds.length} projected occupied` : `${wardBeds.filter((bed) => bed.status === 'available').length} available`}</span><span>{wardBeds.length} total</span></div>
                  </article>
                )
              })}
            </div>
          </section>

          <aside className="twin-detail-column">
            <section className="twin-detail-panel" aria-live="polite">
              <div className="twin-panel-heading">
                <div>
                  <p className="eyebrow">Selected ward</p>
                  <h2>{selectedWard?.name || 'Ward details'}</h2>
                </div>
                <span className={`twin-data-tag ${activeProjection ? 'twin-data-tag-simulated' : ''}`}>{activeProjection ? 'PROJECTED' : 'ACTUAL'}</span>
              </div>
              <div className="twin-count-grid">
                <TwinCount label="Total beds" value={selectedWardBeds.length} tone="total" />
                <TwinCount label="Available" value={activeProjection && activeProjection.wardId === selectedWard?._id ? projectedCounts.available : wardStatusCounts.available} tone="available" />
                <TwinCount label="Occupied" value={activeProjection && activeProjection.wardId === selectedWard?._id ? projectedCounts.occupied : wardStatusCounts.occupied} tone="occupied" />
                <TwinCount label="Reserved" value={wardStatusCounts.reserved} tone="reserved" />
                <TwinCount label="Maintenance" value={wardStatusCounts.maintenance} tone="maintenance" />
              </div>
              {activeProjection && activeProjection.wardId === selectedWard?._id && (
                <div className="twin-projection-summary" role="status">
                  <strong>Projection only</strong>
                  <span>{activeProjection.arrivals} hypothetical arrivals · {activeProjection.bedIds.length} placed in available beds · {activeProjection.unplaced} not placed in this ward</span>
                </div>
              )}
              {selectedBed && (
                <div className="twin-selected-bed">
                  <span>Selected bed</span>
                  <strong>{selectedBed.bedNumber}</strong>
                  <span>Actual status: {selectedBed.status}</span>
                  {activeProjection?.bedIds.includes(selectedBed._id) && <span className="twin-projected-label">Projected status: occupied</span>}
                </div>
              )}
            </section>

            <section className="twin-simulation-panel">
              <div className="twin-panel-heading">
                <div><p className="eyebrow">What-if mode</p><h2>Emergency surge</h2></div>
                <span className="twin-simulation-mark" aria-hidden="true">SIM</span>
              </div>
              <form onSubmit={runSurgeProjection}>
                <label className="twin-input-label" htmlFor="surgeTargetWard">Target ward</label>
                <select id="surgeTargetWard" className="field" value={surgeWardId || selectedWard?._id || ''} onChange={(event) => setSurgeWardId(event.target.value)}>
                  {sortedWards.map((ward) => <option value={ward._id} key={ward._id}>{ward.name}</option>)}
                </select>
                <label className="twin-input-label" htmlFor="surgeArrivalCount">Hypothetical arrivals</label>
                <input id="surgeArrivalCount" className="field" type="number" min="0" max="5000" step="1" value={surgeArrivals} onChange={(event) => setSurgeArrivals(Math.min(5000, Math.max(0, Math.floor(Number(event.target.value) || 0))))} />
                <p className="twin-simulation-note">Projection places arrivals only into currently available beds in the selected ward. Remaining arrivals are reported as unplaced; no cross-ward clinical routing is assumed.</p>
                <div className="twin-simulation-actions">
                  <button type="submit" className="twin-primary-button">Run projection</button>
                  <button type="button" className="twin-reset-button" onClick={resetSurgeProjection} disabled={!projection}>Reset</button>
                </div>
              </form>
              <p className="twin-readonly-note">Simulated values are local to this view. Patient, admission, ward, and bed records are not changed.</p>
            </section>
          </aside>
        </div>
      )}
      <section className="twin-optimizer-slot">
        <div className="twin-panel-heading">
          <div><p className="eyebrow">Gamma robust optimization</p><h2>Latest saved result</h2></div>
          <button type="button" className="twin-link-button" onClick={() => onNavigate('/robust-optimization#gamma-analysis')}>Open Gamma Analysis <span aria-hidden="true">↗</span></button>
        </div>
        {latestRunLoading ? <p className="twin-optimizer-message" role="status">Loading saved optimization result…</p>
          : latestRunError ? <p className="twin-optimizer-message twin-optimizer-error" role="alert">{latestRunError}</p>
            : latestRun ? (
              <>
                <p className="twin-optimizer-context">Saved optimizer snapshot · {latestRun.createdAt ? new Date(latestRun.createdAt).toLocaleString() : 'timestamp unavailable'} · separate from the live bed map</p>
                <div className="twin-optimizer-metrics">
                  <TwinCount label="Gamma" value={formatNumber(latestRun.gamma)} tone="total" />
                  <TwinCount label="Solver status" value={latestRun.solverStatus || '-'} tone="available" />
                  <TwinCount label="Allocated beds" value={formatNumber(latestRun.totalAllocatedBeds)} tone="occupied" />
                  <TwinCount label="Nominal unmet" value={formatNumber(latestRun.nominalUnmetDemand ?? latestRun.totalUnmetDemand)} tone="reserved" />
                  <TwinCount label="Model slack Σsᵢ" value={formatNumber(latestRun.robustSlackBedEquivalents)} tone="maintenance" />
                  <TwinCount label="Utilization" value={formatPercent(latestRun.capacityUtilization)} tone="total" />
                </div>
              </>
            ) : <p className="twin-optimizer-message">No saved optimization result is available yet. Live bed visualization and surge simulation work independently.</p>}
      </section>
    </div>
  )
}

function TwinCount({ label, value, tone }) {
  return (
    <div className={`twin-count twin-count-${tone}`}>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  )
}

function DemandManagementPage({ token }) {
  const demand = useResource('/api/demand', token)
  return <div><PageHeading eyebrow="Planning" title="Demand Management" description="Nominal demand and uncertainty values used by robust optimization." />{demand.error && <ErrorNotice message={demand.error} />}<div className="mt-8 overflow-x-auto rounded-2xl border border-[#dce8e5] bg-white p-6"><table className="w-full min-w-[680px] text-left text-sm"><thead><tr className="border-b border-[#e1ebea] text-xs uppercase tracking-wider text-[#8294a0]"><th className="pb-3">Ward</th><th className="pb-3">Demand Date</th><th className="pb-3">Nominal Demand</th><th className="pb-3">Maximum Deviation</th></tr></thead><tbody>{demand.data.map((record) => <tr key={record._id} className="border-b border-[#eef3f2]"><td className="py-4 font-bold">{record.ward?.name || '-'}</td><td>{new Date(record.demandDate).toLocaleDateString()}</td><td>{formatNumber(record.nominalDemand)}</td><td>{formatNumber(record.maximumDeviation)}</td></tr>)}</tbody></table>{!demand.loading && !demand.data.length && <EmptyState text="No demand records found in MongoDB." />}</div></div>
}

function SurgeSimulatorPage({ token }) {
  const wards = useResource('/api/wards', token)
  const demand = useResource('/api/demand', token)
  const [scenario, setScenario] = useState({ focusWard: '', arrivals: 80, duration: 12, focusShare: 65 })
  const eligibleWards = wards.data.filter((ward) =>
    Number(ward.availableBeds) > 0 && demand.data.some((record) => record.ward?._id === ward._id)
  )
  const focusWardId = scenario.focusWard || eligibleWards[0]?._id || ''
  const surgeScenario = focusWardId ? {
    focus_ward_id: focusWardId,
    total_arrivals: Number(scenario.arrivals),
    duration_hours: Number(scenario.duration),
    focus_share: Number(scenario.focusShare) / 100,
  } : null

  return (
    <div className="page-enter">
      <PageHeading eyebrow="Planning / Scenario Lab" title="Emergency Surge & Cascading Shortage Simulator" description="Evaluate a temporary surge-adjusted demand snapshot against the same live capacity and Gamma sweep as the baseline." />
      {(wards.error || demand.error) && <ErrorNotice message={wards.error || demand.error} />}
      {wards.loading || demand.loading ? <div className="mt-8 rounded-xl border border-[#dce8e5] bg-white p-8 text-sm text-[#718899]">Loading eligible wards and live capacity...</div> : !eligibleWards.length ? <div className="mt-8 rounded-xl border border-dashed border-[#bcd0d0] bg-white p-8 text-sm text-[#718899]">No ward currently has both available beds and demand data. The optimizer needs both to build a comparable scenario.</div> : (
        <>
          <div className="surge-layout mt-8">
            <SurgeScenarioControls eligibleWards={eligibleWards} scenario={scenario} onScenarioChange={setScenario} idPrefix="surge-simulator" />
            <GammaAnalysisRunner token={token} surgeScenario={surgeScenario} disabled={!surgeScenario || eligibleWards.length < 2} embedded />
          </div>
        </>
      )}
    </div>
  )
}

function SurgeScenarioControls({ eligibleWards, scenario, onScenarioChange, idPrefix }) {
  const focusWardId = scenario.focusWard || eligibleWards[0]?._id || ''

  function updateScenario(event) {
    const value = event.target.type === 'range' ? Number(event.target.value) : event.target.value
    onScenarioChange((current) => ({ ...current, [event.target.name]: value }))
  }

  return (
    <div className="surge-controls">
      <div className="surge-controls-head"><span className="eyebrow">Temporary scenario</span><span className="surge-live-dot">Read-only snapshot</span></div>
      <label className="surge-label" htmlFor={`${idPrefix}-focusWard`}>Focus ward</label>
      <select id={`${idPrefix}-focusWard`} name="focusWard" value={focusWardId} onChange={updateScenario} className="field">
        {eligibleWards.map((ward) => <option key={ward._id} value={ward._id}>{ward.name} · {ward.availableBeds} available</option>)}
      </select>
      <label className="surge-label" htmlFor={`${idPrefix}-arrivals`}>Additional arrivals <strong>{scenario.arrivals}</strong></label>
      <input id={`${idPrefix}-arrivals`} name="arrivals" type="range" min="10" max="300" step="5" value={scenario.arrivals} onChange={updateScenario} className="surge-range" />
      <div className="surge-range-ends"><span>10 arrivals</span><span>300 arrivals</span></div>
      <label className="surge-label" htmlFor={`${idPrefix}-duration`}>Scenario horizon <strong>{scenario.duration} hours</strong></label>
      <input id={`${idPrefix}-duration`} name="duration" type="range" min="6" max="72" step="6" value={scenario.duration} onChange={updateScenario} className="surge-range surge-range-teal" />
      <div className="surge-range-ends"><span>6 hours</span><span>72 hours</span></div>
      <label className="surge-label" htmlFor={`${idPrefix}-focusShare`}>Requiring focus ward <strong>{scenario.focusShare}%</strong></label>
      <input id={`${idPrefix}-focusShare`} name="focusShare" type="range" min="30" max="90" step="5" value={scenario.focusShare} onChange={updateScenario} className="surge-range surge-range-gold" />
      <div className="surge-range-ends"><span>30%</span><span>90%</span></div>
      <p className="surge-form-note">The selected share is rounded to whole arrivals for the focus ward; the remainder is split as evenly as possible across other eligible wards.</p>
    </div>
  )
}

function GammaAnalysisRunner({ token, surgeScenario = null, disabled = false, embedded = false }) {
  const [gammaStep, setGammaStep] = useState('1')
  const [maxNominalUnmet, setMaxNominalUnmet] = useState('0')
  const [maxRobustSlack, setMaxRobustSlack] = useState('0')
  const [analysis, setAnalysis] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function runAnalysis() {
    setLoading(true)
    setError('')
    setAnalysis(null)
    try {
      const result = await apiFetch('/api/optimization/analyze', token, {
        method: 'POST',
        body: JSON.stringify({
          gamma_step: Number(gammaStep),
          ...(surgeScenario ? { surge: surgeScenario } : {}),
        }),
      })
      setAnalysis(result)
    } catch (err) {
      setError(err.message || 'Unable to complete Gamma analysis')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className={`gamma-workspace ${embedded ? 'gamma-workspace-embedded' : 'mt-6'}`}>
      <div className="gamma-controls">
        <div className="gamma-control-field">
          <label htmlFor="gammaStep">Gamma spacing</label>
          <select id="gammaStep" value={gammaStep} onChange={(event) => setGammaStep(event.target.value)} className="field">
            <option value="1">1.0 ward</option><option value="0.5">0.5 ward</option><option value="0.25">0.25 ward</option>
          </select>
        </div>
        <div className="gamma-control-field">
          <label htmlFor="maxNominalUnmet">Maximum nominal unmet (bed-equivalent)</label>
          <input id="maxNominalUnmet" type="number" min="0" step="0.5" value={maxNominalUnmet} onChange={(event) => setMaxNominalUnmet(event.target.value)} className="field" />
        </div>
        <div className="gamma-control-field">
          <label htmlFor="maxRobustSlack">Maximum model slack Σsᵢ (bed-equivalent)</label>
          <input id="maxRobustSlack" type="number" min="0" step="0.5" value={maxRobustSlack} onChange={(event) => setMaxRobustSlack(event.target.value)} className="field" />
        </div>
        <button onClick={runAnalysis} disabled={loading || disabled} className="gamma-run-button">{loading ? 'Running comparison...' : 'Run Gamma comparison'}</button>
      </div>
      <p className="gamma-method-note">The server derives Γ ∈ [0, N] from the optimizer ward snapshot and always includes N. It runs all values against identical inputs; comparison runs are not saved as optimization history.</p>
      {error && <ErrorNotice message={error} />}
      {disabled && surgeScenario && <div className="gamma-inline-warning">Surge comparison requires at least two eligible wards because non-focus arrivals need destinations.</div>}
      {!analysis && !loading && !error && <div className="gamma-empty">{embedded ? 'Run a comparison to inspect allocated beds and capacity utilization.' : 'Run a comparison to inspect allocation, nominal shortage, robust model slack, utilization, objective, and solve time.'}</div>}
      {loading && <div className="gamma-empty">The optimizer is solving each tested Gamma against the same input snapshot...</div>}
      {analysis && <GammaTradeoffReport analysis={analysis} maxNominalUnmet={Number(maxNominalUnmet)} maxRobustSlack={Number(maxRobustSlack)} simplifiedChartMetrics={embedded} />}
    </div>
  )
}

function GammaTradeoffReport({ analysis, maxNominalUnmet, maxRobustSlack, simplifiedChartMetrics = false }) {
  const [chartMetric, setChartMetric] = useState('total_allocated_beds')
  const scenarios = [
    { key: 'baseline', label: 'Baseline' },
    ...(analysis.surge ? [{ key: 'surge', label: 'Surge' }] : []),
  ].map((scenario) => ({ ...scenario, rows: analysis[scenario.key] || [] }))
  const allMetricOptions = [
    { key: 'total_allocated_beds', label: 'Allocated beds', unit: 'bed-equivalent' },
    { key: 'nominal_unmet_demand', label: 'Nominal unmet', unit: 'bed-equivalent' },
    { key: 'robust_slack_bed_equivalents', label: 'Model slack Σsᵢ', unit: 'bed-equivalent' },
    { key: 'robust_uncertainty_slack_bed_equivalents', label: 'Uncertainty-added slack', unit: 'bed-equivalent' },
    { key: 'capacity_utilization', label: 'Capacity utilization', unit: 'ratio' },
    { key: 'objective_value', label: 'Objective value', unit: 'weighted model cost' },
    { key: 'execution_time_seconds', label: 'Execution time', unit: 'seconds' },
  ]
  const metricOptions = simplifiedChartMetrics
    ? allMetricOptions.filter((metric) => ['total_allocated_beds', 'capacity_utilization'].includes(metric.key))
    : allMetricOptions
  const selectedMetric = metricOptions.find((metric) => metric.key === chartMetric) || metricOptions[0]
  const successfulRows = scenarios.flatMap((scenario) => scenario.rows)
    .filter((row) => row.solver_status === 'optimal' || row.solver_status === 'optimal_inaccurate')
  const maxChartValue = Math.max(0, ...successfulRows.map((row) => Number(row[selectedMetric.key]) || 0))
  const recommendation = analysis.tested_gamma_values.find((gamma) => scenarios.every((scenario) => {
    const row = scenario.rows.find((result) => result.gamma === gamma)
    return row && (row.solver_status === 'optimal' || row.solver_status === 'optimal_inaccurate')
      && row.nominal_unmet_demand <= maxNominalUnmet + 1e-6
      && row.robust_slack_bed_equivalents <= maxRobustSlack + 1e-6
  }))

  function rowFor(scenario, gamma) {
    return scenario.rows.find((row) => row.gamma === gamma)
  }

  return (
    <div className="gamma-report">
      <div className="gamma-report-head">
        <div><span className="eyebrow">Fixed-snapshot comparison</span><h3>Γ range 0 to {formatNumber(analysis.gamma_max)} · step {formatNumber(analysis.gamma_step)}</h3></div>
        <span>{analysis.tested_gamma_values.length} values tested</span>
      </div>
      {scenarios.some((scenario) => scenario.rows.some((row) => row.solver_status !== 'optimal' && row.solver_status !== 'optimal_inaccurate')) && <p className="gamma-inline-warning">Some solver runs did not complete. Their unavailable metrics are left blank and are not treated as zero.</p>}
      <div className="gamma-criterion">
        <strong>{recommendation === undefined ? 'No tested Gamma meets the selected model limits.' : `Model-based candidate: Γ = ${formatNumber(recommendation)}`}</strong>
        <span>Lowest tested value meeting both limits for every displayed scenario: nominal unmet ≤ {formatNumber(maxNominalUnmet)} and total model slack Σsᵢ ≤ {formatNumber(maxRobustSlack)} bed-equivalent. This is a configurable model criterion, not a clinical recommendation or measured outcome.</span>
      </div>
      <section className="gamma-chart-panel">
        <div className="gamma-chart-head"><div><p className="eyebrow">Trade-off profile</p><h3>{selectedMetric.label}</h3><span>{selectedMetric.unit}</span></div><label className="gamma-chart-select-label" htmlFor="chartMetric">Chart metric<select id="chartMetric" value={selectedMetric.key} onChange={(event) => setChartMetric(event.target.value)} className="field">{metricOptions.map((metric) => <option key={metric.key} value={metric.key}>{metric.label}</option>)}</select></label></div>
        <div className="gamma-chart-legend">{scenarios.map((scenario, index) => <span key={scenario.key} className={`gamma-legend-item gamma-series-${index}`}><i />{scenario.label}</span>)}</div>
        <div className="gamma-bars">
          {analysis.tested_gamma_values.map((gamma) => (
            <div className="gamma-bar-row" key={gamma}>
              <strong>Γ {formatNumber(gamma)}</strong>
              <div className="gamma-bar-series">
                {scenarios.map((scenario, index) => {
                  const row = rowFor(scenario, gamma)
                  const value = row && (row.solver_status === 'optimal' || row.solver_status === 'optimal_inaccurate') ? row[selectedMetric.key] : null
                  const width = value === null || maxChartValue === 0 ? 0 : Math.max(1, Number(value) / maxChartValue * 100)
                  return <div className="gamma-bar-line" key={scenario.key}><span>{scenario.label}</span><div className="gamma-bar-track"><i className={`gamma-bar-fill gamma-series-${index}`} style={{ width: `${width}%` }} /></div><b>{selectedMetric.key === 'capacity_utilization' && value !== null ? `${(Number(value) * 100).toFixed(1)}%` : formatNumber(value)}</b></div>
                })}
              </div>
            </div>
          ))}
        </div>
      </section>
      <div className="gamma-table-wrap">
        <table className="gamma-table">
          <thead><tr><th>Scenario</th><th>Γ</th><th>Status</th><th>Objective*</th><th>Allocated beds</th><th>Nominal unmet</th><th>Model slack Σsᵢ</th><th>Uncertainty-added slack</th><th>Capacity</th><th>Utilization</th><th>Execution (s)</th></tr></thead>
          <tbody>{scenarios.flatMap((scenario) => scenario.rows.map((row) => <tr key={`${scenario.key}-${row.gamma}`}><td>{scenario.label}</td><td>{formatNumber(row.gamma)}</td><td><span className="badge">{row.solver_status}</span>{row.error && <span className="gamma-row-error">{row.error}</span>}</td><td>{formatNumber(row.objective_value)}</td><td>{formatNumber(row.total_allocated_beds)}</td><td>{formatNumber(row.nominal_unmet_demand)}</td><td>{formatNumber(row.robust_slack_bed_equivalents)}</td><td>{formatNumber(row.robust_uncertainty_slack_bed_equivalents)}</td><td>{formatNumber(row.total_available_beds)}</td><td>{row.capacity_utilization === null ? '-' : `${(row.capacity_utilization * 100).toFixed(1)}%`}</td><td>{formatNumber(row.execution_time_seconds)}</td></tr>))}</tbody>
        </table>
      </div>
      <p className="gamma-footnote">* Objective is the optimizer’s weighted model cost, not a real-world performance score. Σsᵢ is the actual CVXPY slack in bed-equivalent units and may include nominal undercoverage; uncertainty-added slack is max(0, Σsᵢ − nominal unmet). These are not observed patient counts. Utilization is allocated beds divided by currently available beds.</p>
      {analysis.surge_scenario && <p className="gamma-footnote">Surge mapping: {analysis.surge_scenario.demand_mapping} {analysis.surge_scenario.horizon_note}</p>}
    </div>
  )
}

function OptimizationResultsPage({ token }) {
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  useEffect(() => { apiFetch('/api/optimization/latest', token).then((response) => setResult(response.data)).catch((err) => { if (!err.message.includes('No optimization run')) setError(err.message) }).finally(() => setLoading(false)) }, [token])
  return <div><PageHeading eyebrow="Planning" title="Optimization Results" description="The latest saved result from the Gamma robust optimization service." />{error && <ErrorNotice message={error} />}{loading ? <div className="mt-8 rounded-2xl border border-[#dce8e5] bg-white p-10 text-center text-sm text-[#718899]">Loading latest optimization result...</div> : result ? <OptimizationResult result={result} /> : <div className="mt-8 rounded-2xl border border-dashed border-[#bcd0d0] bg-white p-10 text-center"><p className="text-lg font-bold text-[#17324d]">No optimization result yet</p><p className="mt-2 text-sm text-[#718899]">Run Robust Optimization first to save a result here.</p></div>}</div>
}

function OptimizationPage({ token }) {
  const [gamma, setGamma] = useState('2')
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [includeSurge, setIncludeSurge] = useState(false)
  const [surgeInputs, setSurgeInputs] = useState({ focusWard: '', arrivals: 80, duration: 12, focusShare: 65 })
  const wards = useResource('/api/wards', token)
  const beds = useResource('/api/beds', token)
  const demand = useResource('/api/demand', token)
  const activeWardCount = wards.data.filter((ward) => Number(ward.availableBeds) > 0 && demand.data.some((record) => record.ward?._id === ward._id)).length
  const eligibleWards = wards.data.filter((ward) =>
    Number(ward.availableBeds) > 0 && demand.data.some((record) => record.ward?._id === ward._id)
  )
  const surgeFocusWardId = surgeInputs.focusWard || eligibleWards[0]?._id || ''
  const comparisonSurge = includeSurge && surgeFocusWardId ? {
    focus_ward_id: surgeFocusWardId,
    total_arrivals: Number(surgeInputs.arrivals),
    duration_hours: Number(surgeInputs.duration),
    focus_share: Number(surgeInputs.focusShare) / 100,
  } : null
  const capacity = {
    total: beds.data.length,
    available: beds.data.filter((bed) => bed.status === 'available').length,
    occupied: beds.data.filter((bed) => bed.status === 'occupied').length,
    reserved: beds.data.filter((bed) => bed.status === 'reserved').length,
    maintenance: beds.data.filter((bed) => bed.status === 'maintenance').length,
  }

  async function runOptimization() {
    setLoading(true)
    setError('')
    setResult(null)

    try {
      const data = await apiFetch('/api/optimization/optimize', token, {
        method: 'POST',
        body: JSON.stringify({
          gamma: Number(gamma),
        }),
      })

      setResult(data)
    } catch (err) {
      setError(err.message || 'Unable to run optimization')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      <PageHeading
        eyebrow="Planning"
        title="Robust Optimization"
        description="Optimize hospital bed allocation using Gamma-based robust optimization."
      />

      <div className="mt-8 grid gap-6 lg:grid-cols-[360px_1fr]">
        <div className="rounded-2xl border border-[#dce8e5] bg-white p-6">
          <p className="text-xs font-black uppercase tracking-[0.2em] text-[#4d8b88]">
            Parameters
          </p>

          <label className="mt-6 block text-sm font-bold text-[#17324d]">
            Gamma uncertainty budget
          </label>

          <input
            type="number"
            min="0"
            max={activeWardCount || undefined}
            step="1"
            value={gamma}
            onChange={(event) => setGamma(event.target.value)}
            className="mt-2 w-full rounded-xl border border-[#d5e2e4] px-4 py-3 outline-none focus:border-[#4d8b88]"
          />

          <p className="mt-2 text-xs leading-5 text-[#8294a0]">
            Gamma must be between 0 and {activeWardCount || 'the number of active'} optimization wards.
          </p>

          <div className="mt-6 grid grid-cols-2 gap-3">
            <Metric label="Total Beds" value={capacity.total} />
            <Metric label="Available" value={capacity.available} />
            <Metric label="Occupied" value={capacity.occupied} />
            <Metric label="Reserved / Maintenance" value={`${capacity.reserved} / ${capacity.maintenance}`} />
          </div>

          <button
            onClick={runOptimization}
            disabled={loading}
            className="mt-6 w-full rounded-xl bg-[#123e52] px-5 py-3.5 text-sm font-bold text-white disabled:opacity-60"
          >
            {loading ? 'Running...' : 'Run Optimization'}
          </button>

          {error && (
            <div className="mt-5 rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}
        </div>

        <div>
          {!result && !loading && (
            <div className="rounded-2xl border border-dashed border-[#bcd0d0] bg-white p-10 text-center">
              <p className="text-lg font-bold text-[#17324d]">
                No optimization result yet
              </p>

              <p className="mt-2 text-sm text-[#718899]">
                Select a Gamma value and run the optimization model.
              </p>
            </div>
          )}

          {loading && (
            <div className="rounded-2xl border border-[#dce8e5] bg-white p-10 text-center">
              <p className="text-lg font-bold text-[#17324d]">
                Running robust optimization...
              </p>

              <p className="mt-2 text-sm text-[#718899]">
                Connecting to the optimization service.
              </p>
            </div>
          )}

          {result && <OptimizationResult result={result} />}
        </div>
      </div>

      <section id="gamma-analysis" className="mt-12 scroll-mt-8">
        <PageHeading eyebrow="Planning / Analysis" title="Gamma Analysis & Trade-off Comparison" description="Compare allocations and model slack across a server-derived Gamma range using a fixed demand and capacity snapshot." />
        <div className="mt-6 flex flex-wrap items-center justify-between gap-4 border-b border-[#dce8e5] pb-5">
          <p className="max-w-2xl text-sm leading-6 text-[#718899]">Run the baseline comparison on its own, or include a read-only surge scenario to compare both snapshots under the same tested Gamma values.</p>
          <label className="flex items-center gap-2 text-sm font-semibold text-[#17324d]">
            <input type="checkbox" checked={includeSurge} onChange={(event) => setIncludeSurge(event.target.checked)} className="h-4 w-4 accent-[#3f897b]" />
            Include surge comparison
          </label>
        </div>
        {includeSurge && (wards.loading || demand.loading) ? <p className="mt-4 text-sm text-[#718899]" role="status">Loading eligible wards and demand for the surge snapshot...</p>
          : includeSurge && (wards.error || demand.error) ? <ErrorNotice message={wards.error || demand.error} />
            : includeSurge && !eligibleWards.length ? <div className="gamma-inline-warning">No ward currently has both available beds and demand data for a surge comparison.</div>
              : includeSurge && <div className="surge-layout mt-5"><SurgeScenarioControls eligibleWards={eligibleWards} scenario={surgeInputs} onScenarioChange={setSurgeInputs} idPrefix="robust-surge" /><div className="self-start rounded-xl border border-[#dce8e5] bg-white p-4 text-sm leading-6 text-[#718899]">Surge inputs are applied to the same snapshot as the baseline. They do not change patient, admission, ward, or bed records.</div></div>}
        <GammaAnalysisRunner token={token} surgeScenario={comparisonSurge} disabled={includeSurge && (wards.loading || demand.loading || eligibleWards.length < 2)} />
      </section>
    </div>
  )
}

function OptimizationResult({ result }) {
  const wardResults = result.ward_results || result.wardResults || []

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Metric
          label="Solver Status"
          value={result.solver_status || result.solverStatus || '-'}
        />

        <Metric
          label="Gamma"
          value={result.gamma ?? '-'}
        />

        <Metric
          label="Available Beds"
          value={result.total_available_beds ?? result.totalAvailableBeds ?? '-'}
        />

        <Metric
          label="Nominal Unmet (bed-equivalent)"
          value={formatNumber(result.nominal_unmet_demand ?? result.nominalUnmetDemand ?? result.total_unmet_demand ?? result.totalUnmetDemand)}
        />

        <Metric label="Objective Value" value={formatNumber(result.objective_value ?? result.objectiveValue)} />
        <Metric label="Allocated Beds" value={formatNumber(result.total_allocated_beds ?? result.totalAllocatedBeds)} />
        <Metric label="Protected Capacity" value={formatNumber(result.total_reserved_beds ?? result.totalReservedBeds)} />
        <Metric label="Model Slack Σsᵢ (bed-equivalent)" value={formatNumber(result.robust_slack_bed_equivalents ?? result.robustSlackBedEquivalents)} />
        <Metric label="Uncertainty-Added Slack (bed-equivalent)" value={formatNumber(result.robust_uncertainty_slack_bed_equivalents ?? result.robustUncertaintySlackBedEquivalents)} />
        <Metric label="Capacity Utilization" value={formatPercent(result.capacity_utilization ?? result.capacityUtilization)} />
        <Metric label="Execution Time (seconds)" value={formatNumber(result.execution_time_seconds ?? result.executionTimeSeconds)} />
      </div>

      <div className="rounded-2xl border border-[#dce8e5] bg-white p-6">
        <p className="text-xs font-black uppercase tracking-[0.2em] text-[#4d8b88]">
          Allocation Results
        </p>

        <div className="mt-5 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-[#e1ebea] text-xs uppercase tracking-wider text-[#8294a0]">
                <th className="pb-3 pr-4">Ward</th>
                <th className="pb-3 pr-4">Available</th>
                <th className="pb-3 pr-4">Demand</th>
                <th className="pb-3 pr-4">Allocated</th>
                <th className="pb-3">Nominal unmet</th>
              </tr>
            </thead>

            <tbody>
              {wardResults.map((ward, index) => (
                <tr
                  key={ward.ward_id || index}
                  className="border-b border-[#eef3f2]"
                >
                  <td className="py-4 pr-4 font-bold text-[#17324d]">
                    {ward.ward_name || ward.wardName || '-'}
                  </td>

                  <td className="py-4 pr-4">
                    {formatNumber(ward.available_beds ?? ward.availableBeds)}
                  </td>

                  <td className="py-4 pr-4">
                    {formatNumber(ward.nominal_demand ?? ward.nominalDemand)}
                  </td>

                  <td className="py-4 pr-4 font-bold text-[#3f897b]">
                    {formatNumber(ward.recommended_allocation ?? ward.recommendedAllocation)}
                  </td>

                  <td className="py-4">
                    {formatNumber(ward.unmet_demand ?? ward.unmetDemand)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function PageHeading({
  eyebrow,
  title,
  description,
  action,
  onAction,
}) {
  return (
    <div className="flex flex-col justify-between gap-5 md:flex-row md:items-end">
      <div>
        <p className="text-xs font-black uppercase tracking-[0.2em] text-[#4d8b88]">
          {eyebrow}
        </p>

        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-[#17324d] sm:text-4xl">
          {title}
        </h1>

        <p className="mt-3 max-w-2xl text-[#718899]">
          {description}
        </p>
      </div>

      {action && (
        <button
          onClick={onAction}
          className="rounded-xl bg-[#123e52] px-4 py-3 text-sm font-bold text-white"
        >
          {action} →
        </button>
      )}
    </div>
  )
}

function Metric({ label, value }) {
  return (
    <div className="rounded-xl bg-[#123e52] p-5 text-white">
      <p className="text-2xl font-bold">
        {value}
      </p>

      <p className="mt-2 text-xs text-[#9fc2c8]">
        {label}
      </p>
    </div>
  )
}

function StatCard({ label, value, note, tone = 'blue' }) {
  const tones = {
    blue: 'bg-[#e8f1f6] text-[#3f8298]',
    mint: 'bg-[#e7f1eb] text-[#3f897b]',
    gold: 'bg-[#faf1df] text-[#b47a32]',
    coral: 'bg-[#fae9e4] text-[#c9634e]',
  }

  return (
    <div className="rounded-2xl border border-[#dce8e5] bg-white p-6">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-semibold text-[#718899]">
            {label}
          </p>

          <p className="mt-2 text-3xl font-black text-[#17324d]">
            {value}
          </p>

          <p className="mt-1 text-xs text-[#8aa0ad]">
            {note}
          </p>
        </div>

        <span
          className={`grid h-11 w-11 place-items-center rounded-xl text-xs font-black ${tones[tone]}`}
        >
          +
        </span>
      </div>
    </div>
  )
}

function formatNumber(value) {
  if (value === null || value === undefined) {
    return '-'
  }

  const number = Number(value)

  if (!Number.isFinite(number)) {
    return value
  }

  return number.toFixed(2).replace(/\.00$/, '')
}

function formatPercent(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '-'
  return `${(Number(value) * 100).toFixed(1)}%`
}

function App() {
  const [token, setToken] = useState(
    () => localStorage.getItem('token') || ''
  )

  function handleLogin(newToken) {
    localStorage.setItem('token', newToken)
    setToken(newToken)
  }

  function handleLogout() {
    localStorage.removeItem('token')
    setToken('')
    window.history.pushState({}, '', '/')
  }

  if (!token) {
    return <AuthFlow onLogin={handleLogin} />
  }

  return (
    <Shell
      token={token}
      onLogout={handleLogout}
    />
  )
}

export default App