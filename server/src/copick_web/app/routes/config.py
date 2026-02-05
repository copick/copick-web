"""Configuration and objects routes."""

from fastapi import APIRouter, Depends

from ..models import ConfigResponse, PickableObjectResponse
from ..services.copick_service import CopickService, get_copick_service

router = APIRouter(prefix="/api", tags=["config"])


@router.get("/config", response_model=ConfigResponse)
def get_config(service: CopickService = Depends(get_copick_service)) -> ConfigResponse:
    """Get project configuration."""
    config = service.config
    return ConfigResponse(
        name=config.name,
        description=config.description,
        version=config.version,
        user_id=config.user_id,
        session_id=config.session_id,
    )


@router.get("/objects", response_model=list[PickableObjectResponse])
def get_objects(service: CopickService = Depends(get_copick_service)) -> list[PickableObjectResponse]:
    """Get all pickable objects."""
    return [
        PickableObjectResponse(
            name=obj.name,
            is_particle=obj.is_particle,
            label=obj.label,
            color=obj.color,
            radius=obj.radius,
        )
        for obj in service.pickable_objects
    ]
