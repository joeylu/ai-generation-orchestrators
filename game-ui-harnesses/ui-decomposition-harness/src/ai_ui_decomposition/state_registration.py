"""Conservative common-alpha registration of an explicitly identified state pair."""
import numpy as np
from PIL import Image
from .common import require
from .media import normalize


def common_alpha_pair(first,second):
    require(first.mode==second.mode=='RGBA' and first.size==second.size,'STATE_PAIR_CANVAS')
    a=np.asarray(first);b=np.asarray(second);aa=a[:,:,3];ba=b[:,:,3]
    require(aa.min()==ba.min()==0 and aa.max()==ba.max()==255,'STATE_PAIR_ALPHA')
    common=np.minimum(aa,ba);require(common.max()==255,'STATE_PAIR_NO_COMMON_SUPPORT')
    losses=[1-int(common.sum())/int(x.sum()) for x in [aa,ba]]
    union=((aa>0)|(ba>0)).sum();iou=float(((aa>0)&(ba>0)).sum()/union)
    require(max(losses)<=.05 and iou>=.85,'STATE_PAIR_SHAPE_MISMATCH')
    require(not np.array_equal(a,b),'STATE_PAIR_DISTINCT_REQUIRED')
    outputs=[]
    for x in [a,b]:
        out=x.copy();out[:,:,3]=common;outputs.append(normalize(Image.fromarray(out,'RGBA')))
    require(outputs[0].tobytes()!=outputs[1].tobytes(),'STATE_PAIR_DISTINCT_REQUIRED')
    return outputs,{'operation':'common minimum alpha only; no RGB recolor, expansion, shift or new state art',
                    'removed_alpha_fraction':losses,'support_iou':iou,'maximum_allowed_loss':.05,
                    'semantic_identity':'explicit caller pair; not inferred','human_visual_acceptance':False}
