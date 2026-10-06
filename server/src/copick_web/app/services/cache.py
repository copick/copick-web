"""A small in-memory cache bounded in size and age, for the server's derived data (thumbnails, instance
measurements, segmentation surfaces).

Entries are evicted least-recently-used once the cache holds more than ``max_bytes``, and dropped once they are
older than ``max_age`` seconds (checked on access and by :meth:`BoundedCache.sweep`, which the app runs
periodically). Thread-safe: FastAPI runs sync routes in a thread pool.
"""

import sys
import threading
import time
from collections import OrderedDict
from typing import Any, Callable, Generic, Hashable, Optional, TypeVar

import numpy as np

V = TypeVar("V")


def approximate_size(value: Any) -> int:
    """Rough memory size of a cached value: arrays and bytes exactly, containers summed, other objects shallowly."""
    if isinstance(value, np.ndarray):
        return int(value.nbytes)
    if isinstance(value, (bytes, bytearray)):
        return len(value)
    if isinstance(value, dict):
        return sum(approximate_size(v) for v in value.values()) + 64 * len(value)
    if isinstance(value, (list, tuple)):
        return sum(approximate_size(v) for v in value) + 8 * len(value)
    return sys.getsizeof(value)


class BoundedCache(Generic[V]):
    """LRU cache bounded by total size (bytes) and entry age (seconds)."""

    def __init__(
        self,
        max_bytes: int,
        max_age: Optional[float] = None,
        size_of: Callable[[Any], int] = approximate_size,
        clock: Callable[[], float] = time.monotonic,
    ):
        self.max_bytes = int(max_bytes)
        self.max_age = max_age
        self._size_of = size_of
        self._clock = clock
        self._items: "OrderedDict[Hashable, tuple[V, int, float]]" = OrderedDict()
        self._bytes = 0
        self._lock = threading.Lock()

    @property
    def total_bytes(self) -> int:
        return self._bytes

    def __len__(self) -> int:
        return len(self._items)

    def _expired(self, stored_at: float, now: float) -> bool:
        return self.max_age is not None and now - stored_at > self.max_age

    def _drop(self, key: Hashable) -> None:
        _value, size, _stored = self._items.pop(key)
        self._bytes -= size

    def get(self, key: Hashable) -> Optional[V]:
        with self._lock:
            entry = self._items.get(key)
            if entry is None:
                return None
            if self._expired(entry[2], self._clock()):
                self._drop(key)
                return None
            self._items.move_to_end(key)
            return entry[0]

    def put(self, key: Hashable, value: V) -> None:
        size = self._size_of(value)
        with self._lock:
            if key in self._items:
                self._drop(key)
            if size > self.max_bytes:  # never fits: don't flush everything else for it
                return
            self._items[key] = (value, size, self._clock())
            self._bytes += size
            while self._bytes > self.max_bytes:
                self._drop(next(iter(self._items)))

    def sweep(self) -> int:
        """Drop expired entries; returns how many."""
        if self.max_age is None:
            return 0
        now = self._clock()
        with self._lock:
            # Entries are in last-use order, not storage order, so check them all (caches are small).
            stale = [k for k, (_v, _s, stored) in self._items.items() if self._expired(stored, now)]
            for key in stale:
                self._drop(key)
        return len(stale)

    def clear(self) -> None:
        with self._lock:
            self._items.clear()
            self._bytes = 0
