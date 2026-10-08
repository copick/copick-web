"""The bounded in-memory cache behind thumbnails, instance measurements and segmentation surfaces."""

from __future__ import annotations

import numpy as np

from copick_web.app.services.cache import BoundedCache, approximate_size


class Clock:
    def __init__(self):
        self.t = 0.0

    def __call__(self):
        return self.t


def test_size_limit_evicts_least_recently_used():
    cache = BoundedCache(max_bytes=300, size_of=len)
    cache.put("a", b"x" * 100)
    cache.put("b", b"x" * 100)
    cache.put("c", b"x" * 100)
    assert cache.get("a") is not None  # a is now the most recently used
    cache.put("d", b"x" * 100)
    assert cache.get("b") is None and cache.get("a") and cache.get("c") and cache.get("d")
    assert cache.total_bytes <= 300 and len(cache) == 3


def test_oversized_entries_are_not_stored_and_replacing_updates_size():
    cache = BoundedCache(max_bytes=100, size_of=len)
    cache.put("small", b"x" * 40)
    cache.put("huge", b"x" * 500)
    assert cache.get("huge") is None and cache.get("small") is not None
    cache.put("small", b"x" * 10)
    assert cache.total_bytes == 10


def test_entries_expire_on_access_and_by_sweep():
    clock = Clock()
    cache = BoundedCache(max_bytes=10_000, max_age=60, size_of=len, clock=clock)
    cache.put("old", b"1")
    clock.t = 30
    cache.put("new", b"2")
    clock.t = 70
    assert cache.get("old") is None  # expired on access
    assert cache.get("new") == b"2"
    clock.t = 95
    assert cache.sweep() == 1 and len(cache) == 0 and cache.total_bytes == 0


def test_approximate_size_counts_arrays():
    value = {"positions": np.zeros((1000, 3), np.float32), "level": 1}
    assert approximate_size(value) >= 12_000


def test_service_caches_are_bounded_and_swept(service):
    assert service.thumbnails.max_bytes > 0 and service._measurements.max_bytes > 0
    assert service.thumbnails.max_age == 3600
    assert service.sweep_caches() == 0
