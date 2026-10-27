"""FastAPI entry point for the hospital bed optimization service."""

import logging

from fastapi import FastAPI, HTTPException

from models.optimization_model import (
    GammaAnalysisRequest,
    GammaAnalysisResponse,
    OptimizeRequest,
    OptimizeResponse,
)
from services.gamma_analysis import GammaAnalysisService
from services.optimizer import OptimizerService

logger = logging.getLogger(__name__)

app = FastAPI(
    title="Hospital Robust Optimization Service",
    version="1.0.0",
)


@app.get("/health")
def health() -> dict[str, str]:
    """Return the service health status."""
    return {"status": "ok", "service": "optimization"}


@app.post("/optimize", response_model=OptimizeResponse)
def optimize(request: OptimizeRequest) -> OptimizeResponse:
    """Run the robust bed allocation optimizer."""
    try:
        response = OptimizerService().optimize(request)
    except ValueError as exc:
        logger.warning("Optimization request validation failed: %s", exc)
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Optimization request failed")
        raise HTTPException(
            status_code=500,
            detail="Optimization service failed to process the request.",
        ) from exc

    if response.solver_status in {"infeasible", "infeasible_inaccurate"}:
        raise HTTPException(
            status_code=422,
            detail="The optimization problem is infeasible.",
        )
    if response.solver_status in {"unbounded", "unbounded_inaccurate"}:
        raise HTTPException(
            status_code=500,
            detail="The optimization problem is unbounded.",
        )
    if response.solver_status not in {"optimal", "optimal_inaccurate"}:
        raise HTTPException(
            status_code=500,
            detail="No solver could complete the optimization.",
        )

    return response


@app.post("/analyze", response_model=GammaAnalysisResponse)
def analyze(request: GammaAnalysisRequest) -> GammaAnalysisResponse:
    """Compare Gamma values over one fixed baseline and optional surge snapshot."""
    try:
        return GammaAnalysisService().analyze(request)
    except ValueError as exc:
        logger.warning("Gamma analysis request rejected: %s", exc)
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Gamma analysis request failed")
        raise HTTPException(
            status_code=500,
            detail="Gamma analysis service failed to process the request.",
        ) from exc
