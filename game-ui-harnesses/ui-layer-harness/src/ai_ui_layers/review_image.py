"""Display-only resampling for close visual comparisons."""
from PIL import Image


def fit_resampling(source_size, pane_size):
    """Show original pixels when enlarging; retain antialiasing when shrinking."""
    scale = min(pane_size[0] / source_size[0], pane_size[1] / source_size[1])
    return Image.Resampling.NEAREST if scale > 1 else Image.Resampling.LANCZOS
