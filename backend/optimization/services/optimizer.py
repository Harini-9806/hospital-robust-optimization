"""
services/optimizer.py

Γ-Robust Bed Allocation Optimizer Service.

This module is the single entry point for the optimization pipeline.
The FastAPI route (app.py) calls OptimizerService().optimize(request)
and receives a structured OptimizeResponse — it never touches CVXPY directly.

Pipeline stages
---------------
1. validate_input()               — sanity-check all inputs before touching CVXPY
2. prepare_data()                 — convert Pydantic models to plain NumPy arrays
3. build_decision_variables()     — declare CVXPY cp.Variable objects
4. build_constraints()            — hard constraints (capacity, non-negativity, etc.)
5. apply_gamma_robust_constraints() — Bertsimas-Sim Γ-robust counterpart constraints
6. build_objective()              — weighted objective function
7. solve()                        — call cp.Problem(...).solve()
8. build_response()               — map CVXPY solution back to OptimizeResponse

Mathematical notation (Bertsimas-Sim, 2004)
--------------------------------------------
  i         — ward index  (0 … N-1)
  N         — number of wards
  D_i       — nominal demand for ward i                  (scalar, >= 0)
  U_i       — maximum demand deviation for ward i        (scalar, >= 0)
  B_i       — available beds for ward i                  (scalar, integer >= 0)
  Γ         — uncertainty budget  (scalar, 0 <= Γ <= N)

Decision variables:
  x_i       — beds allocated to ward i                   (continuous, >= 0)
  s_i       — unmet demand slack for ward i              (continuous, >= 0)
  p         — dual scalar for the uncertainty budget     (continuous, >= 0)
  q_i       — per-ward dual variable                     (continuous, >= 0)

Objective (minimise):
  Σ_i [ w_unmet * s_i  +  w_reserve * max(0, x_i - D_i) ]

Subject to:
    x_i + s_i  >= D_i                  ∀ i   (nominal ward coverage)
    p  + q_i   >= U_i                  ∀ i   (uncertainty dual feasibility)
    Σ_i (x_i+s_i) >= Σ_i D_i + Γ*p + Σ_i q_i (robust aggregate coverage)
  x_i        <= B_i                  ∀ i   (bed capacity)
    x_i, s_i, p, q_i >= 0

Γ interpretation:
  Γ = 0  →  deterministic: only nominal demand D_i is considered
  Γ = k  →  at most k wards can simultaneously hit their worst-case demand
  Γ = N  →  all wards fully protected against worst-case demand
"""

import logging
import time
from typing import Optional

import cvxpy as cp          # imported now; used in Step 4B
import numpy as np          # imported now; used in Step 4B

from models.optimization_model import (
    OptimizeRequest,
    OptimizeResponse,
    WardInput,
    WardResult,
)

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Internal data container — populated by prepare_data()
# ---------------------------------------------------------------------------
class _ProblemData:
    """
    Plain-Python container holding NumPy arrays extracted from the request.
    Passed between pipeline stages so each stage is independently testable.
    """

    def __init__(
        self,
        n: int,
        ward_ids: list[str],
        ward_names: list[str],
        D: np.ndarray,   # nominal demand  (N,)
        U: np.ndarray,   # max deviation   (N,)
        B: np.ndarray,   # available beds  (N,)
        gamma: float,
        weight_unmet: float,
        weight_reserve: float,
    ) -> None:
        self.n              = n
        self.ward_ids       = ward_ids
        self.ward_names     = ward_names
        self.D              = D
        self.U              = U
        self.B              = B
        self.gamma          = gamma
        self.weight_unmet   = weight_unmet
        self.weight_reserve = weight_reserve


# ---------------------------------------------------------------------------
# Main service class
# ---------------------------------------------------------------------------
class OptimizerService:
    """
    Γ-Robust Bed Allocation Optimizer.

    Usage:
        service = OptimizerService()
        response = service.optimize(request)   # raises NotImplementedError until Step 4B
    """

    # ------------------------------------------------------------------
    # Public entry point
    # ------------------------------------------------------------------
    def optimize(self, request: OptimizeRequest) -> OptimizeResponse:
        """
        Run the full Γ-robust optimization pipeline.

        Args:
            request: Validated OptimizeRequest from the FastAPI route.

        Returns:
            OptimizeResponse with per-ward allocation and solver metadata.

        Raises:
            ValueError:          If input validation fails.
            NotImplementedError: Until the CVXPY model is implemented in Step 4B.
            RuntimeError:        If the CVXPY solver returns an unexpected status.
        """
        started_at = time.perf_counter()
        logger.info(
            "optimize() called | gamma=%.2f | wards=%d",
            request.gamma,
            len(request.wards),
        )

        self.validate_input(request)
        data = self.prepare_data(request)
        variables = self.build_decision_variables(data)
        constraints = self.build_constraints(data, variables)
        constraints.extend(self.apply_gamma_robust_constraints(data, variables))
        objective = self.build_objective(data, variables)
        problem = cp.Problem(objective, constraints)
        solver_status = self.solve(problem)

        objective_value = problem.value
        if objective_value is not None and not np.isfinite(objective_value):
            objective_value = None

        return self.build_response(
            data,
            variables,
            solver_status,
            objective_value,
            time.perf_counter() - started_at,
        )

    # ------------------------------------------------------------------
    # Stage 1 — Input validation
    # ------------------------------------------------------------------
    def validate_input(self, request: OptimizeRequest) -> None:
        """
        Sanity-check all inputs before any CVXPY objects are created.

        Checks:
        - At least one ward is provided.
        - gamma is within [0, number_of_wards].
        - All D_i >= 0, U_i >= 0, B_i >= 0.
        - No ward has available_beds < 0.

        Raises:
            ValueError: On any invalid input.
        """
        n = len(request.wards)
        if n == 0:
            raise ValueError("At least one ward must be provided.")

        if request.gamma > n:
            raise ValueError(
                f"gamma ({request.gamma}) cannot exceed the number of wards ({n}). "
                f"Valid range: [0, {n}]."
            )

        for ward in request.wards:
            if ward.nominal_demand < 0:
                raise ValueError(
                    f"Ward '{ward.ward_name}': nominal_demand (D_i) must be >= 0, "
                    f"got {ward.nominal_demand}."
                )
            if ward.maximum_deviation < 0:
                raise ValueError(
                    f"Ward '{ward.ward_name}': maximum_deviation (U_i) must be >= 0, "
                    f"got {ward.maximum_deviation}."
                )
            if ward.available_beds < 0:
                raise ValueError(
                    f"Ward '{ward.ward_name}': available_beds must be >= 0, "
                    f"got {ward.available_beds}."
                )

    # ------------------------------------------------------------------
    # Stage 2 — Data preparation
    # ------------------------------------------------------------------
    def prepare_data(self, request: OptimizeRequest) -> _ProblemData:
        """
        Convert the Pydantic request into NumPy arrays for CVXPY.

        Returns:
            _ProblemData with arrays D (N,), U (N,), B (N,) and scalar gamma.
        """
        n           = len(request.wards)
        ward_ids    = [w.ward_id   for w in request.wards]
        ward_names  = [w.ward_name for w in request.wards]
        D           = np.array([w.nominal_demand    for w in request.wards], dtype=float)
        U           = np.array([w.maximum_deviation for w in request.wards], dtype=float)
        B           = np.array([w.available_beds    for w in request.wards], dtype=float)

        return _ProblemData(
            n=n,
            ward_ids=ward_ids,
            ward_names=ward_names,
            D=D,
            U=U,
            B=B,
            gamma=request.gamma,
            weight_unmet=request.weight_unmet,
            weight_reserve=request.weight_reserve,
        )

    # ------------------------------------------------------------------
    # Stage 3 — Decision variables  (Step 4B)
    # ------------------------------------------------------------------
    def build_decision_variables(self, data: _ProblemData) -> dict:
        """
        Declare all CVXPY decision variables.

        Variables to be created:
            x  = cp.Variable(data.n, nonneg=True)   # beds allocated per ward
            s  = cp.Variable(data.n, nonneg=True)   # unmet demand slack per ward

        Returns:
            dict mapping variable names to cp.Variable objects.
        """
        return {
            "x": cp.Variable(data.n, nonneg=True),
            "s": cp.Variable(data.n, nonneg=True),
            "p": cp.Variable(nonneg=True),
            "q": cp.Variable(data.n, nonneg=True),
        }

    # ------------------------------------------------------------------
    # Stage 4 — Hard constraints  (Step 4B)
    # ------------------------------------------------------------------
    def build_constraints(self, data: _ProblemData, variables: dict) -> list:
        """
        Build hard (non-robust) constraints.

        Constraints to be added in Step 4B:
            x_i <= B_i          ∀ i   (cannot exceed available beds)
            x_i >= 0            ∀ i   (non-negativity, enforced by nonneg=True)
            s_i >= 0            ∀ i   (non-negativity, enforced by nonneg=True)

        Returns:
            list of cp.Constraint objects.
        """
        return [
            variables["x"] <= data.B,
            variables["x"] + variables["s"] >= data.D,
        ]

    # ------------------------------------------------------------------
    # Stage 5 — Γ-robust constraints  (Step 4B)
    # ------------------------------------------------------------------
    def apply_gamma_robust_constraints(
        self, data: _ProblemData, variables: dict
    ) -> list:
        """
        Apply the Bertsimas-Sim Γ-robust counterpart constraints.

        The shared uncertainty set is:
            0 <= ξ_i <= 1,  Σ ξ_i <= Γ.

        The worst-case aggregate deviation is dualized as:
            max Σ_i U_i ξ_i = min Γ*p + Σ_i q_i
            subject to p + q_i >= U_i, p >= 0, q_i >= 0.

        This makes Gamma a shared budget across wards rather than a
        decision variable that can be set to zero.

        Returns:
            list of cp.Constraint objects for the robust counterpart.
        """
        logger.info(
            "Applying shared Gamma-robust demand protection | gamma=%.2f",
            data.gamma,
        )
        x = variables["x"]
        s = variables["s"]
        p = variables["p"]
        q = variables["q"]
        return [
            p + q >= data.U,
            cp.sum(x + s)
            >= float(np.sum(data.D)) + data.gamma * p + cp.sum(q),
        ]

    # ------------------------------------------------------------------
    # Stage 6 — Objective function  (Step 4B)
    # ------------------------------------------------------------------
    def build_objective(self, data: _ProblemData, variables: dict) -> cp.Minimize:
        """
        Build the CVXPY objective function.

        Objective to be implemented in Step 4B:
            minimize  Σ_i [ w_unmet * s_i  +  w_reserve * cp.pos(x_i - D_i) ]

        where:
            w_unmet   = data.weight_unmet    (penalty for unmet demand)
            w_reserve = data.weight_reserve  (penalty for over-allocation / reserved beds)
            cp.pos(x_i - D_i) = max(0, x_i - D_i) = robust buffer held per ward

        Returns:
            cp.Minimize objective.
        """
        objective_value = cp.sum(
            data.weight_unmet * variables["s"]
            + data.weight_reserve * cp.pos(variables["x"] - data.D)
        )
        return cp.Minimize(objective_value)

    # ------------------------------------------------------------------
    # Stage 7 — Solve  (Step 4B)
    # ------------------------------------------------------------------
    def solve(self, problem: cp.Problem) -> str:
        """
        Call the CVXPY solver and return the solver status string.

        Solver selection in Step 4B:
            problem.solve(solver=cp.GLPK, verbose=False)
            # Fallback: cp.ECOS, cp.SCS

        Returns:
            Solver status string: 'optimal', 'infeasible', 'unbounded', or 'error'.
        """
        installed = set(cp.installed_solvers())
        solver_order = ["CLARABEL", "GLPK", "ECOS", "SCS"]
        available_solvers = [name for name in solver_order if name in installed]

        if not available_solvers:
            logger.error("No supported CVXPY solver is installed: %s", sorted(installed))
            return "error"

        for solver_name in available_solvers:
            try:
                logger.info("Solving optimization problem with %s", solver_name)
                problem.solve(solver=solver_name, verbose=False)
                status = problem.status
                logger.info("Optimization completed | solver=%s | status=%s", solver_name, status)
                return status or "error"
            except cp.error.SolverError as exc:
                logger.warning("Solver %s failed: %s", solver_name, exc)

        logger.error("All supported CVXPY solvers failed")
        return "error"

    # ------------------------------------------------------------------
    # Stage 8 — Build response  (Step 4B)
    # ------------------------------------------------------------------
    def build_response(
        self,
        data: _ProblemData,
        variables: dict,
        solver_status: str,
        objective_value: Optional[float],
        execution_time_seconds: float = 0.0,
    ) -> OptimizeResponse:
        """
        Map CVXPY solution values back to the OptimizeResponse schema.

        For each ward i, compute in Step 4B:
            recommended_allocation = float(variables['x'].value[i])
            reserved_beds          = max(0.0, x_i - D_i)
            unmet_demand           = max(0.0, D_i - x_i)

        Returns:
            OptimizeResponse with per-ward WardResult list and aggregate totals.
        """
        solution = variables["x"].value
        slack_solution = variables["s"].value
        has_solution = (
            solver_status in {"optimal", "optimal_inaccurate"}
            and solution is not None
            and slack_solution is not None
            and np.all(np.isfinite(solution))
            and np.all(np.isfinite(slack_solution))
        )
        if not has_solution:
            if solver_status in {"optimal", "optimal_inaccurate"}:
                solver_status = "error"
            logger.warning(
                "No finite optimal solution available | status=%s",
                solver_status,
            )
            return OptimizeResponse(
                gamma=float(data.gamma),
                solver_status=solver_status,
                objective_value=objective_value,
                total_available_beds=int(np.sum(data.B)),
                total_allocated_beds=None,
                total_reserved_beds=None,
                total_unmet_demand=None,
                nominal_unmet_demand=None,
                robust_slack_bed_equivalents=None,
                robust_uncertainty_slack_bed_equivalents=None,
                robust_demand_requirement=float(
                    np.sum(data.D) + self._gamma_deviation_budget(data.U, data.gamma)
                ),
                capacity_utilization=None,
                execution_time_seconds=max(0.0, float(execution_time_seconds)),
                ward_results=[],
            )

        allocations = np.maximum(0.0, np.asarray(solution, dtype=float))
        model_slack = float(np.sum(np.maximum(0.0, np.asarray(slack_solution, dtype=float))))

        reserved = np.maximum(0.0, allocations - data.D)
        unmet = np.maximum(0.0, data.D - allocations)
        nominal_unmet = float(np.sum(unmet))
        robust_slack = model_slack
        uncertainty_slack = max(0.0, robust_slack - nominal_unmet)
        deviation_budget = self._gamma_deviation_budget(data.U, data.gamma)
        total_capacity = float(np.sum(data.B))
        ward_results = [
            WardResult(
                ward_id=data.ward_ids[index],
                ward_name=data.ward_names[index],
                available_beds=int(data.B[index]),
                nominal_demand=float(data.D[index]),
                maximum_deviation=float(data.U[index]),
                recommended_allocation=float(allocations[index]),
                reserved_beds=float(reserved[index]),
                unmet_demand=float(unmet[index]),
                nominal_unmet_demand=float(unmet[index]),
                capacity_utilization=(
                    min(1.0, max(0.0, float(allocations[index] / data.B[index])))
                    if data.B[index] > 0 else None
                ),
            )
            for index in range(data.n)
        ]

        return OptimizeResponse(
            gamma=float(data.gamma),
            solver_status=solver_status,
            objective_value=objective_value,
            total_available_beds=int(np.sum(data.B)),
            total_allocated_beds=float(np.sum(allocations)),
            total_reserved_beds=float(np.sum(reserved)),
            total_unmet_demand=nominal_unmet,
            nominal_unmet_demand=nominal_unmet,
            robust_slack_bed_equivalents=robust_slack,
            robust_uncertainty_slack_bed_equivalents=uncertainty_slack,
            robust_demand_requirement=float(np.sum(data.D) + deviation_budget),
            capacity_utilization=(
                min(1.0, max(0.0, float(np.sum(allocations) / total_capacity)))
                if total_capacity > 0 else None
            ),
            execution_time_seconds=max(0.0, float(execution_time_seconds)),
            ward_results=ward_results,
        )

    @staticmethod
    def _gamma_deviation_budget(deviations: np.ndarray, gamma: float) -> float:
        """Return the Bertsimas-Sim sum of the largest Gamma deviations."""
        ordered = np.sort(np.asarray(deviations, dtype=float))[::-1]
        whole = int(np.floor(gamma))
        fraction = gamma - whole
        budget = float(np.sum(ordered[:whole]))
        if fraction > 0 and whole < len(ordered):
            budget += fraction * float(ordered[whole])
        return budget
