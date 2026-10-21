"""Bounded file caches for immutable derivatives, behind each caller's access checks."""
import hashlib
import io
import os
from pathlib import Path
import re
import tempfile
import threading
from contextlib import closing

MAX_MEDIA_BYTES = 20 * 1024 * 1024
MAX_CACHE_BYTES = 512 * 1024 * 1024
_FETCH_LOCKS = tuple(threading.Lock() for _ in range(32))
_WRITE_LOCK = threading.Lock()


def cache_path(root, checksum):
    if not root or not re.fullmatch(r'[0-9a-f]{64}', checksum or ''):
        return None
    return Path(root) / checksum


def store_cached(path, content):
    # Cache failure must not make an otherwise readable photo unavailable.
    # Only checksum-named files belonging to this cache are eligible for eviction.
    temporary = None
    try:
        with _WRITE_LOCK:
            path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
            path.parent.chmod(0o700)
            entries = []
            with os.scandir(path.parent) as directory:
                for entry in directory:
                    if re.fullmatch(r'[0-9a-f]{64}', entry.name) and entry.is_file(follow_symlinks=False):
                        try:
                            stat = entry.stat(follow_symlinks=False)
                        except FileNotFoundError:
                            continue
                        entries.append((stat.st_mtime, stat.st_size, Path(entry.path)))
            total = sum(size for _, size, _ in entries)
            for _, size, old in sorted(entries):
                if total + len(content) <= MAX_CACHE_BYTES:
                    break
                old.unlink(missing_ok=True)
                total -= size
            # NamedTemporaryFile creates a private 0600 file. Atomic replacement
            # prevents threads and workers from observing partially written bytes.
            with tempfile.NamedTemporaryFile(dir=path.parent, prefix='.', delete=False) as output:
                temporary = Path(output.name)
                output.write(content)
            os.replace(temporary, path)
    except OSError:
        pass
    finally:
        if temporary is not None:
            try:
                temporary.unlink(missing_ok=True)
            except OSError:
                pass


def open_cached(root, checksum, opener, max_bytes=MAX_MEDIA_BYTES):
    path = cache_path(root, checksum)
    if path is None:
        return opener()
    try:
        return path.open('rb')
    except OSError:
        pass
    # Coalesce simultaneous misses in this worker without an unbounded lock map.
    with _FETCH_LOCKS[int(checksum[:8], 16) % len(_FETCH_LOCKS)]:
        try:
            return path.open('rb')
        except OSError:
            pass
        with closing(opener()) as stream:
            content = stream.read(max_bytes + 1)
        if len(content) > max_bytes:
            raise ConnectionError('Media larger than any permitted derivative.')
        if hashlib.sha256(content).hexdigest() == checksum:
            store_cached(path, content)
        # A mismatched payload is never persisted under a trusted checksum.
        return io.BytesIO(content)
