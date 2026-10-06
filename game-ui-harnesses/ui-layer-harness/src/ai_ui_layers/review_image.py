"""Display-only resampling for close visual comparisons."""
from PIL import Image, ImageDraw

ALPHA_VISIBILITY_POLICY = 'opaque-checkerboard-native-alpha-v1'
ALPHA_VISIBILITY_GUIDANCE = (
    'The reference and generated observation attachments are opaque RGB display '
    'previews composited with their real PNG alpha on a neutral checkerboard. '
    'The checkerboard is a display aid, not owned or foreign artwork. Original '
    'PNGs and continuous alpha remain separately bound and unchanged. Judge '
    'appearance from this actual composite, not from hidden RGB or an '
    'alpha-ignoring preview. Very faint fringe must be judged by its visible '
    'effect; it is not an opaque added object merely because its RGB is bright. '
    'Visible extra objects, solid clipping, missing artwork and ownership or '
    'state errors still require their own findings. '
)


def alpha_visibility_rgb(image):
    """Composite display pixels without thresholding or changing source alpha."""
    rgba = image.convert('RGBA')
    board = Image.new('RGBA', rgba.size, (235, 235, 235, 255))
    draw = ImageDraw.Draw(board)
    tile = 24
    for y in range(0, rgba.height, tile):
        for x in range(0, rgba.width, tile):
            if (x // tile + y // tile) % 2:
                draw.rectangle((x, y, min(x + tile, rgba.width) - 1,
                                min(y + tile, rgba.height) - 1),
                               fill=(190, 190, 190, 255))
    return Image.alpha_composite(board, rgba).convert('RGB')


def fit_resampling(source_size, pane_size):
    """Show original pixels when enlarging; retain antialiasing when shrinking."""
    scale = min(pane_size[0] / source_size[0], pane_size[1] / source_size[1])
    return Image.Resampling.NEAREST if scale > 1 else Image.Resampling.LANCZOS
