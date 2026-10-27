"""Stateless, same-input Gamma sensitivity analysis."""

import math
import time

from models.optimization_model import (
    GammaAnalysisRequest,
    GammaAnalysisResponse,
    GammaAnalysisRow,
    OptimizeRequest,
    WardInput,
)
from services.optimizer import OptimizerService


class GammaAnalysisService:
    """Run a bounded Gamma grid without persisting intermediate optimizer runs."""

    MAX_GAMMA_RUNS = 201

    def analyze(self, request: GammaAnalysisRequest) -> GammaAnalysisResponse:
        gamma_max = float(len(request.baseline_wards))
        if gamma_max / request.gamma_step > self.MAX_GAMMA_RUNS:
            raise ValueError(
                f"Gamma step produces more than {self.MAX_GAMMA_RUNS} runs."
            )
        gamma_values = self.gamma_grid(gamma_max, request.gamma_step)
        if len(gamma_values) > self.MAX_GAMMA_RUNS:
            raise ValueError(
                f"Gamma step produces {len(gamma_values)} runs; maximum is {self.MAX_GAMMA_RUNS}."
            )

        baseline = self._run_scenario(request, request.baseline_wards, gamma_values)
        surge = None
        if request.surge_wards is not None:
            surge = self._run_scenario(request, request.surge_wards, gamma_values)

        return GammaAnalysisResponse(
            gamma_min=0.0,
            gamma_max=gamma_max,
            gamma_step=request.gamma_step,
            tested_gamma_values=gamma_values,
            baseline=baseline,
            surge=surge,
        )

    @staticmethod
    def gamma_grid(gamma_max: float, step: float) -> list[float]:
        """Create a stable positive-step grid and always include the valid maximum."""
        whole_steps = int(math.floor(gamma_max / step + 1e-10))
        values = [round(index * step, 10) for index in range(whole_steps + 1)]
        if not math.isclose(values[-1], gamma_max, rel_tol=0.0, abs_tol=1e-9):
            values.append(float(gamma_max))
        return values

    def _run_scenario(
        self,
        request: GammaAnalysisRequest,
        wards: list[WardInput],
        gamma_values: list[float],
    ) -> list[GammaAnalysisRow]:
        optimizer = OptimizerService()
        rows = []
        available = sum(ward.available_beds for ward in wards)

        for gamma in gamma_values:
            started_at = time.perf_counter()
            try:
                response = optimizer.optimize(
                    OptimizeRequest(
                        gamma=gamma,
                        wards=wards,
                        weight_unmet=request.weight_unmet,
                        weight_reserve=request.weight_reserve,
                    )
                )
                successful = (
                    response.solver_status in {"optimal", "optimal_inaccurate"}
                    and response.total_allocated_beds is not None
                )
                rows.append(
                    GammaAnalysisRow(
                        gamma=gamma,
                        solver_status=response.solver_status,
                        objective_value=response.objective_value if successful else None,
                        total_available_beds=available,
                        total_allocated_beds=response.total_allocated_beds if successful else None,
                        total_reserved_beds=response.total_reserved_beds if successful else None,
                        nominal_unmet_demand=response.nominal_unmet_demand if successful else None,
                        robust_slack_bed_equivalents=(
                            response.robust_slack_bed_equivalents if successful else None
                        ),
                        robust_uncertainty_slack_bed_equivalents=(
                            response.robust_uncertainty_slack_bed_equivalents
                            if successful else None
                        ),
                        robust_demand_requirement=(
                            response.robust_demand_requirement if successful else None
                        ),
                        capacity_utilization=response.capacity_utilization if successful else None,
                        execution_time_seconds=response.execution_time_seconds,
                        error=(
                            None if successful
                            else f"Optimizer returned status '{response.solver_status}'."
                        ),
                    )
                )
            except Exception as exc:
                rows.append(
                    GammaAnalysisRow(
                        gamma=gamma,
                        solver_status="error",
                        total_available_beds=available,
                        execution_time_seconds=time.perf_counter() - started_at,
                        error=str(exc),
                    )
                )
        return rows