from pathlib import Path

from PIL import Image
from psd_tools.constants import ColorMode
from psd_tools.psd import PSD


def finalize_preview(source: Path, destination: Path, rgba: Image.Image) -> dict:
    with source.open("rb") as stream:
        record = PSD.read(stream)
    header = record.header
    if (header.version, header.depth, header.channels, header.color_mode) != (1, 8, 4, ColorMode.RGB):
        raise ValueError("PSD_PREVIEW_HEADER_UNSUPPORTED")
    info = record.layer_and_mask_information.layer_info
    if info is None or not info.layer_records:
        raise ValueError("PSD_LAYERS_MISSING")
    before = info.layer_count
    info.layer_count = -abs(before)
    white = Image.alpha_composite(Image.new("RGBA", rgba.size, "white"), rgba).convert("RGB")
    planes = [channel.tobytes() for channel in white.split()] + [rgba.getchannel("A").tobytes()]
    record.image_data.set_data(planes, header)
    with destination.open("xb") as stream:
        record.write(stream)
    return {"layer_count_before": before, "layer_count_after": info.layer_count,
            "merged_alpha": "first_alpha_channel", "pixel_layer_data_modified": False}
