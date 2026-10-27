"""
tests/test_optimizer.py

Tests for the OptimizerService stub.

Run from backend/optimization/:
    python -m pytest tests/ -v
"""

import sys
import os

# Ensure the optimization package root is on the path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest
from models.optimization_model import OptimizeRequest, WardInput
from services.optimizer import OptimizerService


# ---------------------------------------------------------------------------
# Shared fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def sample_request() -> OptimizeRequest:
    """
    A valid OptimizeRequest using the demo hospital scenario:
        ICU       — 30 beds, D_i=25, U_i=5
        General   — 80 beds, D_i=60, U_i=10
        Surgical  — 50 beds, D_i=35, U_i=8
        Emergency — 40 beds, D_i=40, U_i=12
    """
    return OptimizeRequest(
        gamma=2.0,
        wards=[
            WardInput(ward_id="ward_icu",       ward_name="ICU",       available_beds=30, nominal_demand=25, maximum_deviation=5),
            WardInput(ward_id="ward_general",   ward_name="General",   available_beds=80, nominal_demand=60, maximum_deviation=10),
            WardInput(ward_id="ward_surgical",  ward_name="Surgical",  available_beds=50, nominal_demand=35, maximum_deviation=8),
            WardInput(ward_id="ward_emergency", ward_name="Emergency", available_beds=40, nominal_demand=40, maximum_deviation=12),
        ],
    )


@pytest.fixture
def service() -> OptimizerService:
    return OptimizerService()


# ---------------------------------------------------------------------------
# Test 1 — Imports
# ---------------------------------------------------------------------------

def test_imports():
    """Optimizer and model classes import without errors."""
    from services.optimizer import OptimizerService
    from models.optimization_model import (
        OptimizeRequest, OptimizeResponse, WardInput, WardResult,
    )
    import cvxpy as cp
    import numpy as np

    assert OptimizerService is not None
    assert OptimizeRequest  is not None
    assert OptimizeResponse is not None
    assert WardInput        is not None
    assert WardResult       is not None
    assert cp               is not None
    assert np               is not None


# ---------------------------------------------------------------------------
# Test 2 — Valid request construction
# ---------------------------------------------------------------------------

def test_valid_request_construction(sample_request):
    """A valid OptimizeRequest can be constructed and its fields are correct."""
    assert sample_request.gamma == 2.0
    assert len(sample_request.wards) == 4

    icu = sample_request.wards[0]
    assert icu.ward_name       == "ICU"
    assert icu.available_beds  == 30
    assert icu.nominal_demand  == 25.0   # D_i
    assert icu.maximum_deviation == 5.0  # U_i

    gen = sample_request.wards[1]
    assert gen.ward_name        == "General"
    assert gen.nominal_demand   == 60.0
    assert gen.maximum_deviation == 10.0


# ---------------------------------------------------------------------------
# Test 3 — optimize() returns an optimal feasible solution
# ---------------------------------------------------------------------------

def test_optimize_returns_optimal_solution(service, sample_request):
    """
    A feasible request should produce an optimal solution with valid allocations.
    """
    response = service.optimize(sample_request)

    assert response.solver_status == "optimal"
    assert response.objective_value is not None
    assert response.total_allocated_beds >= 0
    assert response.total_reserved_beds >= 0
    assert response.total_unmet_demand >= 0
    assert all(
        ward.recommended_allocation >= 0
        and ward.reserved_beds >= 0
        and ward.unmet_demand >= 0
        for ward in response.ward_results
    )


# ---------------------------------------------------------------------------
# Test 4 — optimize() returns one result per ward
# ---------------------------------------------------------------------------

def test_optimize_returns_valid_ward_allocations(service, sample_request):
    """
    The response should contain valid nonnegative allocations for every ward.
    """
    response = service.optimize(sample_request)

    assert len(response.ward_results) == len(sample_request.wards)
    for result in response.ward_results:
        assert result.recommended_allocation >= 0
        assert result.recommended_allocation <= result.available_beds + 1e-6
        assert result.reserved_beds >= 0
        assert result.unmet_demand >= 0


def test_gamma_sensitivity_increases_robust_protection(service):
    """Higher Gamma increases shared protection against demand deviation."""
    wards = [
        WardInput(
            ward_id="icu",
            ward_name="ICU",
            available_beds=12,
            nominal_demand=5,
            maximum_deviation=4,
        ),
        WardInput(
            ward_id="general",
            ward_name="General",
            available_beds=12,
            nominal_demand=5,
            maximum_deviation=4,
        ),
    ]

    responses = [
        service.optimize(OptimizeRequest(gamma=gamma, wards=wards))
        for gamma in (0.0, 0.5, 1.0, 2.0)
    ]

    assert all(response.solver_status == "optimal" for response in responses)
    allocations = [response.ward_results[0].recommended_allocation for response in responses]
    reserved = [response.total_reserved_beds for response in responses]
    objectives = [response.objective_value for response in responses]

    assert allocations[0] < allocations[1] < allocations[2]
    assert allocations[2] < allocations[3]
    assert reserved[0] < reserved[1] < reserved[2]
    assert reserved[2] < reserved[3]
    assert objectives[0] < objectives[1] < objectives[2]
    assert objectives[2] < objectives[3]
    assert all(response.total_unmet_demand == pytest.approx(0.0, abs=1e-5) for response in responses)
    assert allocations == pytest.approx([5.0, 6.0, 7.0, 9.0], abs=1e-5)
    assert reserved == pytest.approx([0.0, 2.0, 4.0, 8.0], abs=1e-5)


# ---------------------------------------------------------------------------
# Bonus — validate_input() and prepare_data() work independently
# ---------------------------------------------------------------------------

def test_validate_input_passes_for_valid_request(service, sample_request):
    """validate_input() should not raise for a well-formed request."""
    service.validate_input(sample_request)   # must not raise


def test_validate_input_rejects_gamma_exceeding_ward_count(service):
    """gamma > number of wards must raise ValueError."""
    request = OptimizeRequest(
        gamma=10.0,   # 10 > 4 wards
        wards=[
            WardInput(ward_id="w1", ward_name="ICU", available_beds=30,
                      nominal_demand=25, maximum_deviation=5),
        ],
    )
    with pytest.raises(ValueError, match="gamma"):
        service.validate_input(request)


def test_prepare_data_shapes(service, sample_request):
    """prepare_data() must return arrays of shape (N,) matching ward count."""
    import numpy as np
    data = service.prepare_data(sample_request)

    assert data.n == 4
    assert data.D.shape == (4,)
    assert data.U.shape == (4,)
    assert data.B.shape == (4,)
    assert data.gamma   == 2.0

    # Verify values match the fixture
    np.testing.assert_array_equal(data.D, [25, 60, 35, 40])
    np.testing.assert_array_equal(data.U, [5,  10,  8, 12])
    np.testing.assert_array_equal(data.B, [30, 80, 50, 40])


def test_pydantic_rejects_negative_nominal_demand():
    """Pydantic schema must reject negative D_i at construction time."""
    with pytest.raises(Exception):
        WardInput(
            ward_id="w1", ward_name="ICU",
            available_beds=30, nominal_demand=-1, maximum_deviation=5,
        )


def test_pydantic_rejects_negative_maximum_deviation():
    """Pydantic schema must reject negative U_i at construction time."""
    with pytest.raises(Exception):
        WardInput(
            ward_id="w1", ward_name="ICU",
            available_beds=30, nominal_demand=25, maximum_deviation=-3,
        )


def test_pydantic_rejects_negative_gamma():
    """Pydantic schema must reject negative gamma."""
    with pytest.raises(Exception):
        OptimizeRequest(
            gamma=-1.0,
            wards=[
                WardInput(ward_id="w1", ward_name="ICU",
                          available_beds=30, nominal_demand=25, maximum_deviation=5),
            ],
        )
