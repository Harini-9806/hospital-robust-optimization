import os
import sys
import unittest
from unittest.mock import patch
from types import SimpleNamespace

from fastapi import HTTPException

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from models.optimization_model import GammaAnalysisRequest, OptimizeRequest, WardInput
from services.gamma_analysis import GammaAnalysisService
import app as optimization_app


def make_scenario():
    baseline = [
        WardInput(
            ward_id="w1",
            ward_name="ICU",
            available_beds=6,
            nominal_demand=5,
            maximum_deviation=4,
        ),
        WardInput(
            ward_id="w2",
            ward_name="General",
            available_beds=6,
            nominal_demand=5,
            maximum_deviation=4,
        ),
    ]
    surge = [
        baseline[0].model_copy(update={"nominal_demand": 8}),
        baseline[1].model_copy(update={"nominal_demand": 7}),
    ]
    return baseline, surge


def make_saturated_scenarios():
    baseline = [
        WardInput(ward_id="emergency", ward_name="Emergency", available_beds=9, nominal_demand=40, maximum_deviation=12),
        WardInput(ward_id="general", ward_name="General", available_beds=19, nominal_demand=60, maximum_deviation=10),
        WardInput(ward_id="icu", ward_name="ICU", available_beds=8, nominal_demand=28, maximum_deviation=6),
        WardInput(ward_id="surgical", ward_name="Surgical", available_beds=14, nominal_demand=35, maximum_deviation=8),
    ]
    surge_demands = [92, 70, 37, 44]
    surge = [
        ward.model_copy(update={"nominal_demand": demand})
        for ward, demand in zip(baseline, surge_demands)
    ]
    return baseline, surge


class GammaAnalysisTests(unittest.TestCase):
    def setUp(self):
        self.service = GammaAnalysisService()

    def test_grid_includes_dynamic_upper_bound_and_fractional_points(self):
        self.assertEqual(self.service.gamma_grid(3, 0.5), [0, 0.5, 1, 1.5, 2, 2.5, 3])
        self.assertEqual(self.service.gamma_grid(3, 2), [0, 2, 3])

    def test_baseline_and_surge_use_same_gammas_and_capacity(self):
        baseline, surge = make_scenario()
        result = self.service.analyze(
            GammaAnalysisRequest(
                baseline_wards=baseline,
                surge_wards=surge,
                gamma_step=0.5,
            )
        )

        self.assertEqual(result.gamma_max, 2)
        self.assertEqual(result.tested_gamma_values, [0, 0.5, 1, 1.5, 2])
        self.assertEqual([row.gamma for row in result.baseline], result.tested_gamma_values)
        self.assertEqual([row.gamma for row in result.surge], result.tested_gamma_values)
        self.assertTrue(all(row.total_available_beds == 12 for row in result.baseline))
        self.assertTrue(all(row.total_available_beds == 12 for row in result.surge))
        self.assertTrue(all(row.solver_status == "optimal" for row in result.baseline))
        self.assertTrue(all(row.solver_status == "optimal" for row in result.surge))

    def test_saturated_capacity_gamma_sweep_metrics_for_baseline_and_surge(self):
        baseline_wards, surge_wards = make_saturated_scenarios()
        comparison = self.service.analyze(
            GammaAnalysisRequest(
                baseline_wards=baseline_wards,
                surge_wards=surge_wards,
                gamma_step=1,
            )
        )

        self.assertEqual(comparison.tested_gamma_values, [0, 1, 2, 3, 4])
        self.assertEqual(comparison.gamma_max, len(baseline_wards))
        self.assertEqual(
            [(ward.ward_id, ward.available_beds, ward.maximum_deviation) for ward in baseline_wards],
            [(ward.ward_id, ward.available_beds, ward.maximum_deviation) for ward in surge_wards],
        )

        expected_scenarios = (
            (comparison.baseline, 113, [113, 125, 135, 143, 149]),
            (comparison.surge, 193, [193, 205, 215, 223, 229]),
        )
        expected_uncertainty_slack = [0, 12, 22, 30, 36]

        for rows, nominal_unmet, expected_objective_and_slack in expected_scenarios:
            self.assertEqual(len(rows), 5)
            for index, row in enumerate(rows):
                with self.subTest(scenario="baseline" if nominal_unmet == 113 else "surge", gamma=row.gamma):
                    self.assertEqual(row.solver_status, "optimal")
                    self.assertAlmostEqual(row.total_available_beds, 50, delta=1e-6)
                    self.assertAlmostEqual(row.total_allocated_beds, 50, delta=1e-3)
                    self.assertAlmostEqual(row.nominal_unmet_demand, nominal_unmet, delta=1e-3)
                    self.assertAlmostEqual(
                        row.robust_slack_bed_equivalents,
                        expected_objective_and_slack[index],
                        delta=1e-3,
                    )
                    self.assertAlmostEqual(
                        row.objective_value,
                        expected_objective_and_slack[index],
                        delta=1e-3,
                    )
                    self.assertAlmostEqual(
                        row.robust_uncertainty_slack_bed_equivalents,
                        expected_uncertainty_slack[index],
                        delta=1e-3,
                    )
                    self.assertAlmostEqual(row.capacity_utilization, 1, delta=1e-5)

    def test_surge_must_preserve_capacity_and_uncertainty_inputs(self):
        baseline, surge = make_scenario()
        surge[0] = surge[0].model_copy(update={"available_beds": 5})
        with self.assertRaisesRegex(ValueError, "preserve baseline"):
            GammaAnalysisRequest(baseline_wards=baseline, surge_wards=surge)

    def test_per_gamma_solver_errors_have_null_metrics(self):
        baseline, _ = make_scenario()
        with patch(
            "services.gamma_analysis.OptimizerService.optimize",
            side_effect=RuntimeError("solver unavailable"),
        ):
            result = self.service.analyze(
                GammaAnalysisRequest(baseline_wards=baseline, gamma_step=2)
            )

        self.assertEqual([row.solver_status for row in result.baseline], ["error"] * 2)
        self.assertTrue(all(row.total_allocated_beds is None for row in result.baseline))
        self.assertTrue(all("solver unavailable" in row.error for row in result.baseline))

    def test_infeasible_status_is_preserved_without_numeric_results(self):
        baseline, _ = make_scenario()
        infeasible = SimpleNamespace(
            solver_status="infeasible",
            objective_value=None,
            total_allocated_beds=None,
            total_reserved_beds=None,
            nominal_unmet_demand=None,
            robust_slack_bed_equivalents=None,
            robust_uncertainty_slack_bed_equivalents=None,
            robust_demand_requirement=None,
            capacity_utilization=None,
            execution_time_seconds=0.01,
        )
        with patch("services.gamma_analysis.OptimizerService.optimize", return_value=infeasible):
            result = self.service.analyze(
                GammaAnalysisRequest(baseline_wards=baseline, gamma_step=2)
            )

        self.assertEqual([row.solver_status for row in result.baseline], ["infeasible"] * 2)
        self.assertTrue(all(row.total_allocated_beds is None for row in result.baseline))
        self.assertTrue(all(row.error for row in result.baseline))

    def test_fastapi_analyze_endpoint_returns_typed_same_snapshot_comparison(self):
        baseline, surge = make_scenario()
        response = optimization_app.analyze(
            GammaAnalysisRequest(baseline_wards=baseline, surge_wards=surge, gamma_step=1)
        )

        self.assertEqual(response.gamma_max, 2)
        self.assertEqual(response.tested_gamma_values, [0, 1, 2])
        self.assertEqual(len(response.baseline), len(response.surge))

    def test_single_optimize_api_maps_infeasible_to_422(self):
        optimize_request = OptimizeRequest(
            gamma=0,
            wards=make_scenario()[0],
        )
        with patch("app.OptimizerService") as service_class:
            service_class.return_value.optimize.return_value = SimpleNamespace(
                solver_status="infeasible_inaccurate"
            )
            with self.assertRaises(HTTPException) as caught:
                optimization_app.optimize(optimize_request)

        self.assertEqual(caught.exception.status_code, 422)

    def test_tiny_step_is_rejected_before_sweep(self):
        baseline, _ = make_scenario()
        request = GammaAnalysisRequest(baseline_wards=baseline, gamma_step=1e-8)
        with self.assertRaisesRegex(ValueError, "more than"):
            self.service.analyze(request)


if __name__ == "__main__":
    unittest.main()