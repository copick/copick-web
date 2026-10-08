"""Configuration and objects routes."""

from pathlib import Path
from typing import Annotated, Optional, Tuple

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import ValidationError

from ..models import (
    ConfigResponse,
    FeaturesResponse,
    ObjectTypeFields,
    ObjectTypeRequest,
    ObjectTypesResponse,
    PickableObjectResponse,
)
from ..services import compat
from ..services.copick_service import CopickService, get_copick_service
from ..services.object_types import (
    FILAMENT_FIELDS,
    ObjectTypesConflict,
    ObjectTypesReadOnly,
    filament_spec_of,
)

router = APIRouter(prefix="/api", tags=["config"])
ServiceDependency = Annotated[CopickService, Depends(get_copick_service)]


@router.get("/config", response_model=ConfigResponse)
def get_config(service: ServiceDependency) -> ConfigResponse:
    """Get project configuration."""
    config = service.config
    return ConfigResponse(
        name=config.name,
        description=config.description,
        version=config.version,
        user_id=config.user_id,
        session_id=config.session_id,
        features=FeaturesResponse(**compat.features()),
    )


@router.get("/objects", response_model=list[PickableObjectResponse])
def get_objects(service: ServiceDependency) -> list[PickableObjectResponse]:
    """Get all pickable objects."""
    result = []
    for obj in service.pickable_objects:
        spec = compat.filament_spec(obj)
        result.append(
            PickableObjectResponse(
                name=obj.name,
                is_particle=obj.is_particle,
                label=obj.label,
                color=obj.color,
                radius=obj.radius,
                is_filament=spec is not None,
                filament=spec,
            )
        )
    return result


# --- Object types (configuration editing) ---


def _object_type(obj) -> ObjectTypeFields:
    spec = filament_spec_of(obj)
    return ObjectTypeFields(
        name=obj.name,
        is_particle=obj.is_particle,
        label=obj.label,
        color=tuple(obj.color),
        radius=obj.radius,
        map_threshold=getattr(obj, "map_threshold", None),
        emdb_id=getattr(obj, "emdb_id", None),
        pdb_id=getattr(obj, "pdb_id", None),
        identifier=getattr(obj, "identifier", None),
        filament={k: spec.get(k) for k in FILAMENT_FIELDS} if spec is not None else None,
    )


def _object_types(service: CopickService) -> ObjectTypesResponse:
    editor = service.object_types
    return ObjectTypesResponse(
        version=editor.version,
        editable=editor.editable,
        config_file=Path(service.config_path).name if service.config_path else None,
        suggested_label=editor.suggested_label(),
        objects=[_object_type(o) for o in editor.objects],
    )


def _edit(service: CopickService, action) -> ObjectTypesResponse:
    try:
        action()
    except ObjectTypesReadOnly as e:
        raise HTTPException(status_code=403, detail=str(e)) from e
    except ObjectTypesConflict as e:
        raise HTTPException(status_code=409, detail=str(e)) from e
    except KeyError as e:
        raise HTTPException(status_code=404, detail=f"No object type named {e.args[0]!r}") from e
    except ValidationError as e:
        # copick's validators report e.g. "Assertion failed, Label 0 is reserved for background."
        messages = [str(err.get("msg", "")).removeprefix("Assertion failed, ") for err in e.errors()]
        raise HTTPException(status_code=422, detail="; ".join(m for m in messages if m) or str(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e
    return _object_types(service)


def _fields(request: ObjectTypeRequest) -> Tuple[dict, Optional[dict]]:
    data = request.model_dump(exclude={"version", "filament"})
    filament = request.filament.model_dump() if request.filament is not None else None
    return data, filament


@router.get("/object-types", response_model=ObjectTypesResponse)
def get_object_types(service: ServiceDependency) -> ObjectTypesResponse:
    """All object types with every editable field, the list version and whether the configuration can be written."""
    return _object_types(service)


@router.post("/object-types", response_model=ObjectTypesResponse, status_code=201)
def create_object_type(
    request: ObjectTypeRequest,
    service: ServiceDependency,
) -> ObjectTypesResponse:
    """Add an object type and save the configuration file."""
    fields, filament = _fields(request)
    return _edit(service, lambda: service.object_types.create(request.version, fields, filament))


@router.put("/object-types/{name}", response_model=ObjectTypesResponse)
def update_object_type(
    name: str,
    request: ObjectTypeRequest,
    service: ServiceDependency,
) -> ObjectTypesResponse:
    """Change an object type (it may be renamed) and save the configuration file."""
    fields, filament = _fields(request)
    return _edit(service, lambda: service.object_types.update(request.version, name, fields, filament))


@router.delete("/object-types/{name}", response_model=ObjectTypesResponse)
def delete_object_type(
    name: str,
    service: ServiceDependency,
    version: Annotated[str, Query()],
) -> ObjectTypesResponse:
    """Remove an object type from the configuration file (its annotations stay on disk)."""
    return _edit(service, lambda: service.object_types.delete(version, name))
