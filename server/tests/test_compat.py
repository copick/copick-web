"""Unit tests of the copick feature-detection helpers."""

from types import SimpleNamespace

import numpy as np
import pytest

from copick_web.app.services import compat


def _seg(**flags):
    return SimpleNamespace(is_multilabel=False, **flags)


def test_seg_type_falls_back_on_flags(monkeypatch):
    monkeypatch.setattr(compat, "has_seg_types", lambda: False)
    assert compat.seg_type(_seg()) == "binary"
    assert compat.seg_type(SimpleNamespace(is_multilabel=True)) == "multilabel"
    assert compat.seg_type(_seg(is_instance=True)) == "instance"
    assert compat.seg_type(_seg(is_panoptic=True)) == "panoptic"


def test_seg_channels_only_for_panoptic(monkeypatch):
    monkeypatch.setattr(compat, "has_seg_types", lambda: False)
    assert compat.seg_channels(_seg(is_panoptic=True)) == ["label", "instance"]
    assert compat.seg_channels(_seg(is_instance=True)) is None


def test_filament_spec_from_metadata():
    obj = SimpleNamespace(metadata={"copick": {"filament": {"polar": True, "helical_twist_deg": None}}})
    assert compat.filament_spec(obj) == {"polar": True}
    assert compat.filament_spec(SimpleNamespace(metadata={})) is None
    assert compat.filament_spec(SimpleNamespace()) is None
    assert compat.filament_spec(SimpleNamespace(metadata={"copick": "legacy"})) is None


def test_full_position_adds_the_shift():
    t = np.eye(4)
    t[:3, 3] = (1.0, 2.0, 3.0)
    point = SimpleNamespace(location=SimpleNamespace(x=10.0, y=20.0, z=30.0), transformation_=t.tolist())
    assert compat.full_position(point) == pytest.approx((11.0, 22.0, 33.0))
    bare = SimpleNamespace(location=SimpleNamespace(x=1.0, y=2.0, z=3.0), transformation_=None)
    assert compat.full_position(bare) == pytest.approx((1.0, 2.0, 3.0))


def test_instance_count_ignores_unassigned():
    points = [SimpleNamespace(instance_id=i) for i in (0, None, 1, 1, 4)]
    assert compat.instance_count(points) == 2
