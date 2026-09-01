"""Deterministic primary-model JPEG view; source/RGB/auxiliary stay unchanged."""
from PIL import ImageFilter

PROFILE = {
    "id": "jpeg_median3_primary_v1", "decoded_format": "JPEG",
    "filter": "median", "kernel_size": 3, "source_alpha": "fully_opaque_only",
    "primary_input": "filtered_rgb", "auxiliary_input": "original",
    "foreground_rgb_input": "original",
}
WARNING = "jpeg_primary_view_may_reduce_fine_detail"


def jpeg_view_applies(image, source_format):
    return source_format == "JPEG" and image.convert("RGBA").getchannel("A").getextrema() == (255, 255)


def primary_input_view(image, source_format):
    """No filename/character/coordinate routing, mask changes or source edits."""
    if not jpeg_view_applies(image, source_format):
        return image
    return image.convert("RGB").filter(ImageFilter.MedianFilter(3))
