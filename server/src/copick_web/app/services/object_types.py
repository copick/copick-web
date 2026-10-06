"""Editing the pickable object types of the copick configuration (the web counterpart of the shared Qt
``EditObjectTypesDialog`` used by napari-copick and chimerax-copick).

Changes replace ``root.config.pickable_objects`` and the ``pickable_objects`` of the configuration file; the rest of
the file is left as it is. Every change names the version of the object list it was made against; a change against an
outdated version is refused, so two people editing at once never silently overwrite each other. Object types edited in
the file while the server runs (by hand, or by a desktop viewer) are picked up before every read and change.
"""

import copy
import hashlib
import json
import os
import tempfile
import threading
from pathlib import Path
from typing import Any, Callable, List, Optional

from ..validation import validate_copick_name

#: Object metadata namespace and key of the filament declaration (``FilamentSpec``).
FILAMENT_NAMESPACE = "copick"
FILAMENT_KEY = "filament"
#: Filament spec fields the form edits; other keys of a spec are kept.
FILAMENT_FIELDS = ("polar", "helical_rise_a", "helical_twist_deg")
#: Fields of a pickable object the form edits; everything else (metadata, fields of newer copick versions) is kept.
EDITABLE_FIELDS = (
    "name",
    "is_particle",
    "label",
    "color",
    "emdb_id",
    "pdb_id",
    "identifier",
    "map_threshold",
    "radius",
)


class ObjectTypesConflict(Exception):
    """The object list changed since the client read it."""


class ObjectTypesReadOnly(Exception):
    """The configuration file cannot be written."""


def objects_version(objects: List[Any]) -> str:
    """A short fingerprint of an object list (changes whenever any object does)."""
    payload = json.dumps([o.model_dump(mode="json") for o in objects], sort_keys=True, default=str)
    return hashlib.sha256(payload.encode()).hexdigest()[:16]


def config_writable(config_path: Optional[str]) -> bool:
    """Whether the configuration file (and its directory, for the atomic replace) can be written."""
    if not config_path:
        return False
    path = Path(config_path)
    return path.is_file() and os.access(path, os.W_OK) and os.access(path.parent, os.W_OK)


def write_objects(objects: List[Any], config_path: str) -> None:
    """Replace the ``pickable_objects`` of a configuration file, keeping everything else in it; atomically, so a crash
    never leaves a half-written file."""
    path = Path(config_path)
    data = json.loads(path.read_text())
    data["pickable_objects"] = [o.model_dump(mode="json") for o in objects]
    fd, tmp = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(fd, "w") as f:
            json.dump(data, f, indent=4)
        if path.exists():
            os.chmod(tmp, path.stat().st_mode & 0o777)
        os.replace(tmp, path)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise


def filament_spec_of(obj: Any) -> Optional[dict]:
    """The filament declaration stored on an object, as a dict (None if it is not a filament)."""
    metadata = getattr(obj, "metadata", None) or {}
    namespace = metadata.get(FILAMENT_NAMESPACE) if isinstance(metadata, dict) else None
    spec = namespace.get(FILAMENT_KEY) if isinstance(namespace, dict) else None
    return dict(spec) if isinstance(spec, dict) else None


def _with_filament(metadata: Optional[dict], spec: Optional[dict]) -> dict:
    metadata = copy.deepcopy(metadata or {})
    namespace = metadata.get(FILAMENT_NAMESPACE)
    namespace = dict(namespace) if isinstance(namespace, dict) else {}
    if spec is None:
        namespace.pop(FILAMENT_KEY, None)
    else:
        namespace[FILAMENT_KEY] = spec
    if namespace:
        metadata[FILAMENT_NAMESPACE] = namespace
    else:
        metadata.pop(FILAMENT_NAMESPACE, None)
    return metadata


def build_object(
    object_class: Callable[..., Any],
    fields: dict,
    filament: Optional[dict],
    previous: Any = None,
) -> Any:
    """A pickable object from the form's fields, starting from ``previous`` so fields the form does not show survive.

    Args:
        object_class: The configuration's pickable object class (``PickableObject``).
        fields: Values of :data:`EDITABLE_FIELDS`.
        filament: The filament spec fields (:data:`FILAMENT_FIELDS`), or None if the object is not a filament.
        previous: The object being edited, if any.
    """
    data = copy.deepcopy(previous.model_dump()) if previous is not None else {}
    data.update({k: fields.get(k) for k in EDITABLE_FIELDS})
    data["color"] = tuple(int(c) for c in fields["color"])
    if filament is not None:
        if not fields.get("is_particle"):
            raise ValueError("Only particle objects can be filaments.")
        spec = (filament_spec_of(previous) if previous is not None else None) or {}
        for key in FILAMENT_FIELDS:
            value = filament.get(key)
            if value is None:
                spec.pop(key, None)
            else:
                spec[key] = value
        if spec.get("helical_rise_a") is not None and spec["helical_rise_a"] <= 0:
            raise ValueError("The helical rise must be positive.")
    else:
        spec = None
    metadata = _with_filament(data.get("metadata"), spec)
    if metadata or "metadata" in data:
        data["metadata"] = metadata
    return object_class(**data)


def validate_objects(objects: List[Any], changed: Any) -> None:
    """Check a changed object against the others: a valid, unique name and a unique label >= 1.

    Raises:
        ValueError: With a message for the user.
    """
    ok, _sanitized, message = validate_copick_name(changed.name or "")
    if not ok:
        raise ValueError(message)
    others = [o for o in objects if o is not changed]
    if changed.name.lower() in {o.name.lower() for o in others}:
        raise ValueError(f"An object named '{changed.name}' already exists.")
    if changed.label is None or int(changed.label) < 1:
        raise ValueError("The label must be a whole number of at least 1.")
    if changed.label in {o.label for o in others if o.label is not None}:
        raise ValueError(f"Label {changed.label} is already used by another object.")
    if len(changed.color) != 4 or any(not 0 <= int(c) <= 255 for c in changed.color):
        raise ValueError("The colour needs four values (red, green, blue, alpha) from 0 to 255.")
    if changed.radius is not None and changed.radius <= 0:
        raise ValueError("The radius must be positive.")


class ObjectTypesEditor:
    """Applies object type changes to a copick root and its configuration file, one at a time."""

    def __init__(self, root: Any, config_path: Optional[str]):
        self.root = root
        self.config_path = config_path
        self._lock = threading.RLock()
        self._file_stamp = self._stamp()

    def _stamp(self) -> Optional[tuple]:
        try:
            st = os.stat(self.config_path) if self.config_path else None
        except OSError:
            return None
        return (st.st_mtime_ns, st.st_size) if st is not None else None

    def _set_objects(self, objects: List[Any]) -> None:
        self.root.config.pickable_objects = objects
        # copick caches the objects built from the configuration
        if hasattr(self.root, "_objects"):
            self.root._objects = None

    def sync(self) -> None:
        """Reload the object types from the configuration file if it changed since the server last read or wrote it."""
        with self._lock:
            stamp = self._stamp()
            if stamp is None or stamp == self._file_stamp:
                return
            try:
                data = json.loads(Path(self.config_path).read_text())
                object_class = self._object_class()
                objects = [object_class(**o) for o in data.get("pickable_objects", [])]
            except Exception:  # a half-edited file: keep what we have, retry on the next request
                return
            self._set_objects(objects)
            self._file_stamp = stamp

    @property
    def objects(self) -> List[Any]:
        self.sync()
        return list(self.root.config.pickable_objects)

    @property
    def version(self) -> str:
        return objects_version(self.objects)

    @property
    def editable(self) -> bool:
        return config_writable(self.config_path)

    def _object_class(self) -> Callable[..., Any]:
        objects = self.root.config.pickable_objects
        if objects:
            return type(objects[0])
        from copick.models import PickableObject

        return PickableObject

    def _apply(self, version: str, change: Callable[[List[Any]], List[Any]]) -> List[Any]:
        if not self.editable:
            raise ObjectTypesReadOnly("The configuration file cannot be written.")
        with self._lock:
            current = self.objects
            if version != objects_version(current):
                raise ObjectTypesConflict("The object types were changed by someone else. Reload and try again.")
            updated = change(current)
            write_objects(updated, self.config_path)
            self._file_stamp = self._stamp()
            self._set_objects(updated)
            return updated

    def create(self, version: str, fields: dict, filament: Optional[dict]) -> Any:
        new = build_object(self._object_class(), fields, filament)

        def change(objects):
            validate_objects(objects + [new], new)
            return objects + [new]

        self._apply(version, change)
        return new

    def update(self, version: str, name: str, fields: dict, filament: Optional[dict]) -> Any:
        edited = None

        def change(objects):
            nonlocal edited
            index = next((i for i, o in enumerate(objects) if o.name == name), None)
            if index is None:
                raise KeyError(name)
            edited = build_object(type(objects[index]), fields, filament, previous=objects[index])
            updated = objects[:index] + [edited] + objects[index + 1 :]
            validate_objects(updated, edited)
            return updated

        self._apply(version, change)
        return edited

    def delete(self, version: str, name: str) -> None:
        def change(objects):
            if not any(o.name == name for o in objects):
                raise KeyError(name)
            return [o for o in objects if o.name != name]

        self._apply(version, change)

    def suggested_label(self) -> int:
        labels = [o.label for o in self.objects if o.label is not None]
        return (max(labels) + 1) if labels else 1
