"""Deterministic pixel limits plus conservative local-memory preflight checks."""
from __future__ import annotations

import os
import sys
from pathlib import Path, PurePosixPath

from .common import require


MIB = 1024 * 1024
GIB = 1024 * MIB

# These caps are independent of the machine.  They bound the amount of raster
# data retained by the deterministic pipeline and prevent an input provider
# from turning a small plan into an unexpectedly large matte operation.
MAX_KEYED_INPUT_PIXELS = 4_194_304
MAX_TOTAL_MATERIAL_PIXELS = 16_777_216
MAX_TOTAL_LAYER_PIXELS = 33_554_432
MAX_NODES = 256

DEFAULT_MEMORY_BUDGET_BYTES = 512 * MIB
MAX_MEMORY_BUDGET_BYTES = 2 * GIB
MEMORY_ADVISORY_PERCENT = 25


def _read(path: Path) -> str | None:
    try:
        return path.read_text(encoding="ascii")
    except (OSError, UnicodeError):
        return None


def _linux_memory_bytes() -> int | None:
    """Host reclaimable memory constrained by visible cgroup ancestors.

    No swap or reclaimable cgroup cache is added to hard-limit headroom.
    This is diagnostic evidence, not an allocation guarantee or reservation.
    """
    candidates = []
    for line in (_read(Path('/proc/meminfo')) or '').splitlines():
        fields = line.split()
        if len(fields) == 3 and fields[0] == 'MemAvailable:' and fields[2] == 'kB':
            try:
                candidates.append(max(0, int(fields[1]) * 1024))
            except ValueError:
                pass
    memberships = []
    for line in (_read(Path('/proc/self/cgroup')) or '').splitlines():
        parts = line.split(':', 2)
        if len(parts) == 3:
            memberships.append(parts)
    for line in (_read(Path('/proc/self/mountinfo')) or '').splitlines():
        before, separator, after = line.partition(' - ')
        fields, fs = before.split(), after.split()
        if not separator or len(fields) < 5 or len(fs) < 3 or fs[0] not in {'cgroup', 'cgroup2'}:
            continue
        v2 = fs[0] == 'cgroup2'
        if not v2 and 'memory' not in fs[2].split(','):
            continue
        mount_root, mount = PurePosixPath(fields[3]), Path(fields[4])
        for _, controllers, member in memberships:
            if (v2 and controllers != '') or (not v2 and 'memory' not in controllers.split(',')):
                continue
            try:
                relative = PurePosixPath(member).relative_to(mount_root)
            except ValueError:
                continue
            if '..' in relative.parts:
                continue
            current = mount.joinpath(*relative.parts)
            while True:
                limit = _read(current / ('memory.max' if v2 else 'memory.limit_in_bytes'))
                usage = _read(current / ('memory.current' if v2 else 'memory.usage_in_bytes'))
                try:
                    ceiling, used = int(limit), int(usage)
                    if 0 <= ceiling < (1 << 60) and used >= 0:
                        candidates.append(max(0, ceiling - used))
                except (ValueError, TypeError):
                    pass  # 'max', unavailable controllers and v1 unlimited.
                if current == mount:
                    break
                current = current.parent
    return min(candidates) if candidates else None


def available_memory_bytes() -> int | None:
    """Return currently available physical memory, without spawning a process."""
    if os.name == "nt":
        try:
            import ctypes

            class MemoryStatus(ctypes.Structure):
                _fields_ = [("dwLength", ctypes.c_ulong), ("dwMemoryLoad", ctypes.c_ulong),
                           ("ullTotalPhys", ctypes.c_ulonglong),
                           ("ullAvailPhys", ctypes.c_ulonglong),
                           ("ullTotalPageFile", ctypes.c_ulonglong),
                           ("ullAvailPageFile", ctypes.c_ulonglong),
                           ("ullTotalVirtual", ctypes.c_ulonglong),
                           ("ullAvailVirtual", ctypes.c_ulonglong),
                           ("ullAvailExtendedVirtual", ctypes.c_ulonglong)]

            status = MemoryStatus()
            status.dwLength = ctypes.sizeof(status)
            if ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(status)):
                return int(status.ullAvailPhys)
        except (AttributeError, OSError):
            return None
        return None
    if sys.platform.startswith("linux"):
        available = _linux_memory_bytes()
        if available is not None:
            return available
    try:
        pages = os.sysconf("SC_AVPHYS_PAGES")
        page_size = os.sysconf("SC_PAGE_SIZE")
        if isinstance(pages, int) and isinstance(page_size, int) and pages > 0 and page_size > 0:
            return pages * page_size
    except (AttributeError, OSError, ValueError):
        pass
    return None


def memory_budget_policy() -> dict:
    """Return one coherent snapshot of the informational memory calculation."""
    available = available_memory_bytes()
    if available is None:
        budget = DEFAULT_MEMORY_BUDGET_BYTES
        source = "fallback"
    else:
        budget = min(MAX_MEMORY_BUDGET_BYTES,
                     max(0, available * MEMORY_ADVISORY_PERCENT // 100))
        source = "available_memory"
    return {"memory_available_bytes": available, "memory_budget_bytes": budget,
            "memory_budget_percent": MEMORY_ADVISORY_PERCENT,
            "memory_budget_source": source, "memory_admission_enforced": False}


def memory_budget_bytes() -> int:
    """Return the informational budget retained for diagnostics."""
    return memory_budget_policy()["memory_budget_bytes"]


def _with_memory_advisory(estimated_peak: int) -> dict:
    policy = memory_budget_policy()
    return {**policy, "estimated_peak_bytes": estimated_peak,
            "memory_advisory": ("estimated_peak_exceeds_budget"
                                if estimated_peak > policy["memory_budget_bytes"]
                                else "within_budget")}


def _pixels(size: list[int]) -> int:
    return size[0] * size[1]


def require_keyed_input_limit(size: list[int]) -> None:
    require(_pixels(size) <= MAX_KEYED_INPUT_PIXELS, "KEYED_INPUT_PIXEL_LIMIT")


def plan_resources(plan: dict) -> dict:
    """Validate machine-independent caps and estimate the highest local stage peak."""
    assets = plan["assets"]
    nodes = plan["nodes"]
    canvas_pixels = _pixels(plan["canvas"])
    material_pixels = sum(_pixels(asset["output_size"]) for asset in assets)
    require(material_pixels <= MAX_TOTAL_MATERIAL_PIXELS, "TOTAL_MATERIAL_PIXEL_LIMIT")
    require(len(nodes) <= MAX_NODES, "NODE_LIMIT")
    assets_by_id = {asset["id"]: asset for asset in assets}
    layer_pixels = sum(_pixels(assets_by_id[node["asset"]]["output_size"]) for node in nodes)
    require(layer_pixels <= MAX_TOTAL_LAYER_PIXELS, "TOTAL_LAYER_PIXEL_LIMIT")
    keyed = [asset for asset in assets if asset["output_mode"] == "keyed_component"]
    for asset in keyed:
        if asset["route"] == "source_crop":
            left, top, right, bottom = asset["source_region"]
            require_keyed_input_limit([right - left, bottom - top])

    # `matte_key` operates on one keyed raw result at a time.  Its NumPy/SciPy
    # buffers are deliberately estimated at 64 bytes/pixel, leaving headroom
    # above the named RGBA, float RGB and distance-transform-index arrays.
    keyed_working_set = 64 * MAX_KEYED_INPUT_PIXELS if keyed else 0
    process_peak = 128 * MIB + keyed_working_set + 4 * material_pixels
    finalize_peak = 128 * MIB + 4 * canvas_pixels + 4 * layer_pixels
    export_peak = (16 * MIB if plan["document"]["format"] == "png_zip"
                   else _export_peak(canvas_pixels, layer_pixels))
    estimated_peak = max(process_peak, finalize_peak, export_peak)
    advisory = _with_memory_advisory(estimated_peak)
    return {**advisory,
            "material_pixels": material_pixels, "layer_pixels": layer_pixels,
            "canvas_pixels": canvas_pixels, "keyed_input_pixel_limit": MAX_KEYED_INPUT_PIXELS}


def delivery_resources(scene: dict) -> dict:
    """Reapply the finalized-layer limits before PSD export allocates its caches."""
    canvas_pixels = _pixels(scene["canvas"])
    layers = [layer for group in scene["tree"] for layer in group["children"]]
    require(len(layers) <= MAX_NODES, "NODE_LIMIT")
    layer_pixels = sum(_pixels(layer["size"]) for layer in layers)
    require(layer_pixels <= MAX_TOTAL_LAYER_PIXELS, "TOTAL_LAYER_PIXEL_LIMIT")
    export_peak = _export_peak(canvas_pixels, layer_pixels)
    advisory = _with_memory_advisory(export_peak)
    return {**advisory,
            "layer_pixels": layer_pixels, "canvas_pixels": canvas_pixels}


def _export_peak(canvas_pixels: int, layer_pixels: int) -> int:
    # Single record writer, no SDK composite, released before roundtrip read.
    # Include preview conversion/difference arrays and encoded layer storage.
    return 96 * MIB + 32 * canvas_pixels + 16 * layer_pixels
