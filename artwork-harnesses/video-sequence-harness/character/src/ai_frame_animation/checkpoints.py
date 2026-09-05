"""Optional offline content-bound frame cache, separate from delivery state."""
from pathlib import Path
from uuid import uuid4

from PIL import Image

from .canonical import SHA256_RE, fingerprint, load_json, stamp_document, verify_document, write_json_atomic


def reject_links(path: Path) -> None:
    for component in (path, *path.parents):
        if component.is_symlink() or (hasattr(component, "is_junction") and component.is_junction()):
            raise ValueError("checkpoint_path_invalid")


class FrameCheckpoints:
    def __init__(self, root: Path, binding: str):
        if not SHA256_RE.fullmatch(binding):
            raise ValueError("checkpoint_binding_invalid")
        reject_links(root)
        self.root = root / binding
        reject_links(self.root)
        self.root.mkdir(parents=True, exist_ok=True)
        self.binding = binding

    def load(self, index: int, size: tuple[int, int]):
        png, record = self.root / f"{index}.png", self.root / f"{index}.json"
        try:
            reject_links(png); reject_links(record)
            data = load_json(record)
            verify_document(data, "checkpoint_sha256")
            if data["binding"] != self.binding or data["index"] != index or data["image"] != fingerprint(png):
                return None
            if not isinstance(data["evidence"], dict):
                return None
            with Image.open(png) as image:
                if image.mode != "RGBA" or image.size != size:
                    return None
                return image.copy(), data["evidence"]
        except (OSError, ValueError, KeyError, TypeError):
            return None

    def save(self, index: int, image: Image.Image, evidence: dict) -> None:
        png = self.root / f"{index}.png"
        record = self.root / f"{index}.json"
        reject_links(png); reject_links(record)
        temporary = self.root / f".{uuid4().hex}.png"
        try:
            image.save(temporary, format="PNG", compress_level=1)
            temporary.replace(png)
            write_json_atomic(record, stamp_document({"binding": self.binding, "index": index,
                "image": fingerprint(png), "evidence": evidence}, "checkpoint_sha256"))
        finally:
            temporary.unlink(missing_ok=True)
