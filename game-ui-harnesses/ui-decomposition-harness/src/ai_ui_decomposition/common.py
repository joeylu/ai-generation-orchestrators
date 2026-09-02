from __future__ import annotations

from pathlib import Path, PurePosixPath
import hashlib
import io
import json
import re

from PIL import Image, ImageOps, UnidentifiedImageError


MAX_IMAGE_PIXELS = 67_108_864
MAX_IMAGE_BYTES = 268_435_456


class ContractError(ValueError):
    pass


def require(value: object, code: str) -> None:
    if not value:
        raise ContractError(code)


def identifier(value: object) -> str:
    require(isinstance(value, str) and re.fullmatch(r"[a-z][a-z0-9_-]{0,63}", value),
            "INVALID_ID")
    reserved = {"con", "prn", "aux", "nul", *(f"com{i}" for i in range(1, 10)),
                *(f"lpt{i}" for i in range(1, 10))}
    require(value.lower() not in reserved, "RESERVED_ID")
    return value


def safe_relative(base: Path, value: object) -> Path:
    require(isinstance(value, str) and value and not any(c in value for c in "\\:\0"),
            "UNSAFE_PATH")
    path = PurePosixPath(value)
    parts = value.split("/")
    require(not path.is_absolute() and all(p and p not in {".", ".."} for p in parts),
            "UNSAFE_PATH")
    result = (base / value).resolve()
    require(result.is_relative_to(base.resolve()), "PATH_ESCAPE")
    return result


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load_verified_image(path: Path, expected_size: list[int] | None = None) -> tuple[Image.Image, dict]:
    require(path.is_file() and not path.is_symlink(), "IMAGE_FILE_REQUIRED")
    size_bytes = path.stat().st_size
    require(0 < size_bytes <= MAX_IMAGE_BYTES, "IMAGE_BYTE_LIMIT")
    payload = path.read_bytes()
    require(len(payload) == size_bytes, "IMAGE_CHANGED_DURING_READ")
    try:
        with Image.open(io.BytesIO(payload)) as source:
            width, height = source.size
            require(width > 0 and height > 0 and width * height <= MAX_IMAGE_PIXELS,
                    "IMAGE_PIXEL_LIMIT")
            original_mode = source.mode
            oriented = ImageOps.exif_transpose(source)
            oriented.load()
            picture = oriented.convert("RGBA")
    except (UnidentifiedImageError, Image.DecompressionBombError, OSError) as exc:
        raise ContractError("IMAGE_DECODE_FAILED") from exc
    actual = list(picture.size)
    if expected_size is not None:
        require(actual == expected_size, "IMAGE_DIMENSION_MISMATCH")
    alpha_extrema = list(picture.getchannel("A").getextrema())
    return picture, {"size": actual, "mode": original_mode,
                     "alpha_extrema": alpha_extrema, "bytes": size_bytes,
                     "sha256": hashlib.sha256(payload).hexdigest()}


def digest(value: object) -> str:
    data = json.dumps(value, ensure_ascii=False, sort_keys=True,
                      separators=(",", ":"), allow_nan=False).encode("utf-8")
    return hashlib.sha256(data).hexdigest()


def read_json(path: Path) -> dict:
    require(path.is_file() and path.stat().st_size <= 2_097_152, "JSON_INPUT_INVALID")
    def pairs(items):
        result = {}
        for key, value in items:
            require(key not in result, "DUPLICATE_JSON_KEY")
            result[key] = value
        return result
    def constant(_value):
        raise ContractError("NONFINITE_JSON_NUMBER")
    value = json.loads(path.read_text(encoding="utf-8-sig"),
                       object_pairs_hook=pairs, parse_constant=constant)
    require(isinstance(value, dict), "JSON_OBJECT_REQUIRED")
    return value


def write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    require(not path.exists(), "OUTPUT_EXISTS")
    with path.open("x", encoding="utf-8") as stream:
        json.dump(value, stream, ensure_ascii=False, indent=2, sort_keys=True,
                  allow_nan=False)
        stream.write("\n")
