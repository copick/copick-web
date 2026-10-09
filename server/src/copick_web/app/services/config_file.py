"""A project's copick configuration file, where its object types are saved.

- **Local projects**: the file the server was started with (``LocalConfigFile``).
- **Registry projects**: the ``config.json`` in the overlay root on the cluster, reached over SSH with the service
  account (``RemoteConfigFile``; see ``project_registry.registry_config_file``).

Local writes replace the file atomically (a temporary file next to it, then a rename over it), so a crash never leaves
a half-written configuration. Remote writes overwrite the file in place, which keeps its owner, group and permissions.
"""

import os
import posixpath
import tempfile
import uuid
from pathlib import Path
from typing import Any, Callable, Optional, Protocol


class ConfigFile(Protocol):
    """Where a project's configuration is read from and saved to."""

    @property
    def name(self) -> str:
        """File name, shown to the user."""

    def stamp(self) -> Optional[tuple]:
        """Something that changes whenever the file does (None if it cannot be read)."""

    def read_text(self) -> str: ...

    def writable(self) -> bool:
        """Whether the file (and its directory, for the atomic replace) can be written."""

    def write_text(self, text: str) -> None:
        """Replace the file's content, keeping its permissions."""


class LocalConfigFile:
    """A configuration file on this machine."""

    def __init__(self, path: str):
        self.path = Path(path)

    @property
    def name(self) -> str:
        return self.path.name

    def __str__(self) -> str:
        return str(self.path)

    def stamp(self) -> Optional[tuple]:
        try:
            st = os.stat(self.path)
        except OSError:
            return None
        return (st.st_mtime_ns, st.st_size)

    def read_text(self) -> str:
        return self.path.read_text()

    def writable(self) -> bool:
        path = self.path
        return path.is_file() and os.access(path, os.W_OK) and os.access(path.parent, os.W_OK)

    def write_text(self, text: str) -> None:
        path = self.path
        fd, tmp = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=path.parent)
        try:
            with os.fdopen(fd, "w") as f:
                f.write(text)
            if path.exists():
                os.chmod(tmp, path.stat().st_mode & 0o777)
            os.replace(tmp, path)
        except BaseException:
            Path(tmp).unlink(missing_ok=True)
            raise


class RemoteConfigFile:
    """A configuration file on another machine, through an fsspec filesystem (``sshfs`` for registry projects).

    ``open_fs`` is called for every access: fsspec caches filesystem instances, so this is cheap, connects only when
    the file is first used, and picks up a fresh connection after a reload dropped the cached one.
    """

    def __init__(self, open_fs: Callable[[], Any], path: str, location: Optional[str] = None):
        self._open_fs = open_fs
        self.path = path
        self._location = location or path

    @property
    def fs(self) -> Any:
        return self._open_fs()

    @property
    def name(self) -> str:
        return posixpath.basename(self.path)

    def __str__(self) -> str:
        return self._location

    def _sibling(self, suffix: str) -> str:
        return posixpath.join(posixpath.dirname(self.path), f".{self.name}.{uuid.uuid4().hex[:8]}.{suffix}")

    def stamp(self) -> Optional[tuple]:
        try:
            info = self.fs.info(self.path)
        except (OSError, FileNotFoundError):
            return None
        return (info.get("mtime"), info.get("size"))

    def read_text(self) -> str:
        return self.fs.cat_file(self.path).decode()

    def writable(self) -> bool:
        # SFTP has no access(); try what a save does: create a file next to the configuration and remove it.
        if self.stamp() is None:
            return False
        probe = self._sibling("probe")
        try:
            self.fs.pipe_file(probe, b"")
        except OSError:
            return False
        try:
            self.fs.rm_file(probe)
        except OSError:
            pass
        return True

    def write_text(self, text: str) -> None:
        # In place, not replaced: a new file would belong to the service account (owner, group, umask), and the
        # person whose project it is could lose write access to their own configuration.
        self.fs.pipe_file(self.path, text.encode())
