import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from models.optimization_model import OptimizeRequest, WardInput
from services.optimizer import OptimizerService


def make_wards(capacity=12):
    return [
        WardInput(
            ward_id="icu",
            ward_name="ICU",
            available_beds=capacity,
            nominal_demand=5,
            maximum_deviation=4,
        ),
        WardInput(
            ward_id="general",
            ward_name="General",
            available_beds=capacity,
            nominal_demand=5,
            maximum_deviation=4,
        ),
    ]


class OptimizerMetricTests(unittest.TestCase):
    def setUp(self):
        self.service = OptimizerService()

    def test_capacity_limited_run_reports_actual_robust_slack(self):
        result = self.service.optimize(
            OptimizeRequest(gamma=2, wards=make_wards(capacity=6))
        )

        self.assertEqual(result.solver_status, "optimal")
        self.assertAlmostEqual(result.total_unmet_demand, 0, places=5)
        self.assertAlmostEqual(result.nominal_unmet_demand, 0, places=5)
        self.assertAlmostEqual(result.robust_slack_bed_equivalents, 6, places=4)
        self.assertAlmostEqual(
            result.robust_uncertainty_slack_bed_equivalents, 6, places=4
        )
        self.assertAlmostEqual(result.total_allocated_beds, 12, places=4)
        self.assertAlmostEqual(result.capacity_utilization, 1, places=5)
        self.assertGreaterEqual(result.execution_time_seconds, 0)

    def test_nominal_shortfall_is_not_labeled_uncertainty_slack(self):
        wards = make_wards(capacity=4)
        result = self.service.optimize(OptimizeRequest(gamma=0, wards=wards))

        self.assertAlmostEqual(result.nominal_unmet_demand, 2, places=4)
        self.assertAlmostEqual(result.robust_slack_bed_equivalents, 2, places=4)
        self.assertAlmostEqual(
            result.robust_uncertainty_slack_bed_equivalents, 0, places=4
        )

    def test_gamma_fractional_deviation_budget(self):
        self.assertAlmostEqual(
            self.service._gamma_deviation_budget(
                __import__("numpy").array([5.0, 10.0, 8.0]), 1.5
            ),
            14.0,
        )

    def test_failed_solver_does_not_return_zero_allocations_as_a_solution(self):
        self.service.solve = lambda problem: "error"
        result = self.service.optimize(
            OptimizeRequest(gamma=0, wards=make_wards())
        )

        self.assertEqual(result.solver_status, "error")
        self.assertEqual(result.ward_results, [])
        self.assertIsNone(result.total_allocated_beds)
        self.assertIsNone(result.total_unmet_demand)

    def test_gamma_above_dynamic_ward_count_is_rejected(self):
        request = OptimizeRequest(gamma=1.1, wards=make_wards()[:1])
        with self.assertRaisesRegex(ValueError, "cannot exceed"):
            self.service.validate_input(request)


if __name__ == "__main__":
    unittest.main()