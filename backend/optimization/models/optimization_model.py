"""
models/optimization_model.py

Pydantic schemas that define the contract between the Node.js backend
and the Python optimization service.

Mathematical notation used throughout:
  i         — ward index
  D_i       — nominal (expected) patient demand for ward i
  U_i       — maximum possible deviation from D_i  (uncertainty radius)
  x_i       — beds allocated to ward i              (decision variable)
  Γ (gamma) — uncertainty budget: controls how many wards can simultaneously
               experience their worst-case demand deviation
               0 → deterministic (only D_i considered)
               N → all N wards fully protected against worst-case demand
"""

from pydantic import BaseModel, Field, field_validator, model_validator
from typing import Optional


# ---------------------------------------------------------------------------
# Request schemas
# ---------------------------------------------------------------------------

class WardInput(BaseModel):
    """Per-ward input data sent from Node.js to the optimizer."""

    ward_id: str = Field(..., description="MongoDB ObjectId of the ward")
    ward_name: str = Field(..., description="Human-readable ward name")

    # Physical capacity
    available_beds: int = Field(..., ge=0, description="Number of beds available for allocation")

    # D_i — nominal/expected patient demand
    nominal_demand: float = Field(..., ge=0, description="D_i: expected patient demand for this ward")

    # U_i — maximum possible deviation from D_i
    maximum_deviation: float = Field(..., ge=0, description="U_i: maximum demand deviation for this ward")

    @field_validator("available_beds")
    @classmethod
    def beds_must_be_positive(cls, v: int) -> int:
        if v < 0:
            raise ValueError("available_beds must be >= 0")
        return v


class OptimizeRequest(BaseModel):
    """
    Full request payload for POST /optimize.

    gamma (Γ) is the Bertsimas-Sim uncertainty budget.
    It bounds the number of wards that can simultaneously deviate
    from their nominal demand:

        Σ z_i <= Γ,   z_i ∈ [0, 1]

    where z_i = 1 means ward i experiences its full worst-case deviation U_i.
    """

    gamma: float = Field(
        ...,
        ge=0,
        description="Γ: uncertainty budget (0 = deterministic, N = fully robust for N wards)",
    )
    wards: list[WardInput] = Field(..., min_length=1, description="Per-ward input data")

    # Optional objective weights — configurable for what-if analysis
    weight_unmet: float = Field(
        default=1.0, ge=0,
        description="Penalty weight for unmet demand in the objective function",
    )
    weight_reserve: float = Field(
        default=0.1, ge=0,
        description="Penalty weight for over-allocation (reserved beds) in the objective",
    )

    @field_validator("gamma")
    @classmethod
    def gamma_within_range(cls, v: float, info) -> float:
        # Γ is meaningful in [0, number_of_wards]; warn but don't hard-reject
        if v < 0:
            raise ValueError("gamma must be >= 0")
        return v


class GammaAnalysisRequest(BaseModel):
    """Fixed inputs for a Gamma sweep; scenario variants may change demand only."""

    baseline_wards: list[WardInput] = Field(..., min_length=1)
    surge_wards: Optional[list[WardInput]] = Field(
        default=None,
        description="Optional scenario with the same wards, capacities, and deviations as baseline.",
    )
    gamma_step: float = Field(
        default=1.0,
        gt=0,
        description="Positive spacing for the sweep; the dynamically discovered upper bound is always included.",
    )
    weight_unmet: float = Field(default=1.0, ge=0)
    weight_reserve: float = Field(default=0.1, ge=0)

    @field_validator("gamma_step")
    @classmethod
    def gamma_step_must_be_finite(cls, value: float) -> float:
        import math

        if not math.isfinite(value):
            raise ValueError("gamma_step must be finite")
        return value

    @model_validator(mode="after")
    def scenario_constraints_must_match(self):
        if self.surge_wards is None:
            return self
        baseline = [
            (ward.ward_id, ward.available_beds, ward.maximum_deviation)
            for ward in self.baseline_wards
        ]
        surge = [
            (ward.ward_id, ward.available_beds, ward.maximum_deviation)
            for ward in self.surge_wards
        ]
        if baseline != surge:
            raise ValueError(
                "surge_wards must preserve baseline ward order, IDs, capacities, and maximum deviations"
            )
        return self


# ---------------------------------------------------------------------------
# Response schemas
# ---------------------------------------------------------------------------

class WardResult(BaseModel):
    """Per-ward output from the CVXPY solver."""

    ward_id: str
    ward_name: str
    available_beds: int

    # Inputs echoed back for traceability
    nominal_demand: float       # D_i
    maximum_deviation: float    # U_i

    # Solver outputs
    recommended_allocation: float = Field(
        ..., ge=0,
        description="x_i*: optimal beds to allocate to this ward",
    )
    reserved_beds: float = Field(
        ..., ge=0,
        description="Robust buffer = max(0, x_i* - D_i): beds held against demand uncertainty",
    )
    unmet_demand: float = Field(
        ..., ge=0,
        description="max(0, D_i - x_i*): demand not covered by allocation",
    )
    nominal_unmet_demand: float = Field(
        ..., ge=0,
        description="Nominal unmet demand in bed-equivalent units; alias of unmet_demand.",
    )
    capacity_utilization: Optional[float] = Field(
        default=None, ge=0,
        description="recommended_allocation / available_beds; a ratio from 0 to 1 when capacity is positive.",
    )


class OptimizeResponse(BaseModel):
    """Full response returned by POST /optimize."""

    # Γ value actually used in the solve
    gamma: float

    # Solver metadata
    solver_status: str = Field(
        ...,
        description="CVXPY solver status: 'optimal', 'infeasible', 'unbounded', 'error'",
    )
    objective_value: Optional[float] = Field(
        default=None,
        description="Optimal objective value returned by the solver",
    )

    # Aggregate totals
    total_available_beds: int
    total_allocated_beds: Optional[float]
    total_reserved_beds: Optional[float]
    total_unmet_demand: Optional[float]
    nominal_unmet_demand: Optional[float]

    # Sum of the actual CVXPY s_i slack variables. Bed-equivalent model slack;
    # it is not a count of actual patients and includes nominal undercoverage.
    robust_slack_bed_equivalents: Optional[float] = Field(
        default=None, ge=0,
        description="Sum of CVXPY s_i in bed-equivalent units; includes any nominal undercoverage.",
    )
    robust_uncertainty_slack_bed_equivalents: Optional[float] = Field(
        default=None, ge=0,
        description="Positive part of sum(s_i) minus nominal unmet demand, in bed-equivalent units.",
    )
    robust_demand_requirement: float = Field(
        ..., ge=0,
        description="Sum of nominal demand plus the Gamma-budgeted worst-case deviation, in bed-equivalent units.",
    )
    capacity_utilization: Optional[float] = Field(
        default=None, ge=0,
        description="total_allocated_beds / total_available_beds; a ratio from 0 to 1 when capacity is positive.",
    )
    execution_time_seconds: float = Field(
        ..., ge=0,
        description="Optimizer wall-clock execution time in seconds, including model construction and solve.",
    )

    # Per-ward breakdown
    ward_results: list[WardResult]


class GammaAnalysisRow(BaseModel):
    """One Gamma run; unavailable metrics remain null when the solve fails."""

    gamma: float
    solver_status: str
    objective_value: Optional[float] = None
    total_available_beds: int
    total_allocated_beds: Optional[float] = None
    total_reserved_beds: Optional[float] = None
    nominal_unmet_demand: Optional[float] = None
    robust_slack_bed_equivalents: Optional[float] = None
    robust_uncertainty_slack_bed_equivalents: Optional[float] = None
    robust_demand_requirement: Optional[float] = None
    capacity_utilization: Optional[float] = None
    execution_time_seconds: Optional[float] = None
    error: Optional[str] = None


class GammaAnalysisResponse(BaseModel):
    """Unpersisted comparison over identical baseline/surge capacity constraints."""

    gamma_min: float = 0
    gamma_max: float
    gamma_step: float
    tested_gamma_values: list[float]
    baseline: list[GammaAnalysisRow]
    surge: Optional[list[GammaAnalysisRow]] = None
