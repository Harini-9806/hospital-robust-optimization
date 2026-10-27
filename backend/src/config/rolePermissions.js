/**
 * ROLE_PERMISSIONS
 * Single source of truth for page/feature access per role.
 * Used by the auth route (/me) so the frontend can build its navigation
 * without hardcoding role logic in React.
 */
const ROLE_PERMISSIONS = {
  admin: {
    pages: [
      'dashboard',
      'patients',
      'beds',
      'wards',
      'patient_flow',
      'demand_management',
      'robust_optimization',
      'gamma_analysis',
      'optimization_results',
      'what_if_analysis',
      'alerts',
      'reports',
      'user_management',
      'settings',
    ],
    canRunOptimization: true,
    canModifyGamma: true,
    canManageUsers: true,
    canManageSettings: true,
  },

  receptionist: {
    pages: [
      'dashboard',
      'patients',
      'beds',
      'wards',
      'patient_flow',
      'demand_management',
      'optimization_results',
      'alerts',
    ],
    canRunOptimization: false,
    canModifyGamma: false,
    canManageUsers: false,
    canManageSettings: false,
  },
};

module.exports = ROLE_PERMISSIONS;
