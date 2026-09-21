import numpy as np
from .compile_visual import HARNESS  # Establish the source-distribution core import path.
from ai_ui_decomposition.media import KEY_RGB

def key_background_evidence(image: Image.Image) -> dict:
    """Bounded declared-key drift check, not semantic segmentation or a new key."""
    pixels=np.asarray(image.convert('RGBA'))
    edge=np.concatenate([pixels[0],pixels[-1],pixels[:,0],pixels[:,-1]])
    rgb=edge[:,:3].astype(float)
    distance=np.linalg.norm(rgb-KEY_RGB,axis=1)
    clear=(distance<45)|(edge[:,3]==0)
    fraction=float(np.mean(clear))
    if fraction>=.98:
        return dict(policy='declared-key-v2',passed=True,route='strict',strictClearFraction=fraction)
    opaque=rgb[edge[:,3]>0]
    # All visible perimeter pixels must remain in a small, explicitly magenta
    # neighborhood, well inside the existing matte's distance<145 removal band.
    # The median measures spread only; it NEVER replaces KEY_RGB in the matte.
    drift=np.linalg.norm(opaque-KEY_RGB,axis=1)
    spread=np.linalg.norm(opaque-np.median(opaque,axis=0),axis=1)
    bounded=bool(np.all(drift<85) and np.all(opaque[:,0]>=180)
                 and np.all(opaque[:,2]>=170) and np.all(opaque[:,1]<=65))
    spread99=float(np.percentile(spread,99))
    passed=bounded and spread99<=24
    return dict(policy='declared-key-v2',passed=passed,route='bounded-drift' if passed else 'rejected',
                strictClearFraction=fraction,maxDeclaredKeyDistance=float(drift.max()),
                perimeterSpread99=spread99,matteKeyUnchanged=True)
