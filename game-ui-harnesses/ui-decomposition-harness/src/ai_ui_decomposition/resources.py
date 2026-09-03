"""Deterministic pixel limits plus conservative local-memory preflight checks."""
from __future__ import annotations

import os

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
    try:
        pages = os.sysconf("SC_AVPHYS_PAGES")
        page_size = os.sysconf("SC_PAGE_SIZE")
        if isinstance(pages, int) and isinstance(page_size, int) and pages > 0 and page_size > 0:
            return pages * page_size
    except (AttributeError, OSError, ValueError):
        pass
    return None


def memory_budget_bytes() -> int:
    """Use at most one quarter of currently available RAM, capped at 2 GiB."""
    available = available_memory_bytes()
    if available is None:
        return DEFAULT_MEMORY_BUDGET_BYTES
    return min(MAX_MEMORY_BUDGET_BYTES, max(0, available // 4))


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
    export_peak = 256 * MIB + 16 * canvas_pixels + 8 * layer_pixels
    estimated_peak = max(process_peak, finalize_peak, export_peak)
    budget = memory_budget_bytes()
    require(estimated_peak <= budget, "MEMORY_BUDGET_EXCEEDED")
    return {"memory_budget_bytes": budget, "estimated_peak_bytes": estimated_peak,
            "material_pixels": material_pixels, "layer_pixels": layer_pixels,
            "canvas_pixels": canvas_pixels, "keyed_input_pixel_limit": MAX_KEYED_INPUT_PIXELS}


def delivery_resources(scene: dict) -> dict:
    """Reapply the finalized-layer limits before PSD export allocates its caches."""
    canvas_pixels = _pixels(scene["canvas"])
    layers = [layer for group in scene["tree"] for layer in group["children"]]
    require(len(layers) <= MAX_NODES, "NODE_LIMIT")
    layer_pixels = sum(_pixels(layer["size"]) for layer in layers)
    require(layer_pixels <= MAX_TOTAL_LAYER_PIXELS, "TOTAL_LAYER_PIXEL_LIMIT")
    export_peak = 256 * MIB + 16 * canvas_pixels + 8 * layer_pixels
    budget = memory_budget_bytes()
    require(export_peak <= budget, "MEMORY_BUDGET_EXCEEDED")
    return {"memory_budget_bytes": budget, "estimated_peak_bytes": export_peak,
            "layer_pixels": layer_pixels, "canvas_pixels": canvas_pixels}
