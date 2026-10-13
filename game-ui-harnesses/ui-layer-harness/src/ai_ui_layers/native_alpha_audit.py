"""Offline raw-alpha evidence and an opaque preview using real PNG compositing."""
import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
from PIL import Image
from .review_image import alpha_visibility_rgb, ALPHA_VISIBILITY_POLICY
from .sheet_pixels import partition_observations, FAINT_GLOW_SEAM


def analyze(image, grid):
    if image.format!='PNG' or 'A' not in image.getbands():
        raise ValueError('NATIVE_ALPHA_PNG_REQUIRED')
    if (len(grid)!=2 or any(type(v) is not int or v<1 for v in grid) or
            image.width//grid[0]<32 or image.height//grid[1]<32 or
            image.width*image.height>16_777_216):
        raise ValueError('ALPHA_AUDIT_GRID_OR_SIZE')
    before=image.tobytes()
    rgba=np.asarray(image.convert('RGBA'));alpha=rgba[:,:,3]
    values,counts=np.unique(alpha,return_counts=True)
    columns,rows=grid
    bands=[]
    for name,count,length,axis in (('x',columns,image.width,1),('y',rows,image.height,0)):
        for i in range(1,count):
            center=i*length//count;lo=max(0,center-10);hi=min(length,center+10)
            a=alpha[:,lo:hi] if axis else alpha[lo:hi,:]
            bands.append(dict(axis=name,nominalCut=center,range=[lo,hi],
                samplePixels=int(a.size),nonzeroAlphaCount=int((a>0).sum()),
                alphaOneCount=int((a==1).sum()),atLeastEightCount=int((a>=8).sum()),
                maximumAlpha=int(a.max()),
                maximum8bitCompositeChannelChangeBound=int(a.max())))
    row=dict(grid=list(grid),materialIds=[str(i) for i in range(columns*rows)])
    result=dict(kind='ui_native_alpha_audit_v1',size=list(image.size),grid=list(grid),
        displayPolicy=ALPHA_VISIBILITY_POLICY,
        alphaHistogram={str(int(v)):int(n) for v,n in zip(values,counts)},
        hiddenRgbPixels=int(((alpha==0)&np.any(rgba[:,:,:3]!=0,axis=2)).sum()),
        nominalSeamBands=bands,partition=partition_observations(image,row,FAINT_GLOW_SEAM),
        interpretation='Nonzero-alpha counts are structural evidence, not visible contamination area. '
            'For 8-bit channels the composite change from the chosen background is bounded by alpha. '
            'Judge artwork on the real-alpha preview; this report does not classify noise or shadows.',
        sourcePixelsModified=False,modelCalls=0,humanVisualAcceptance=False,qualityAccepted=False)
    assert image.tobytes()==before
    return result


def audit(source, output, grid):
    source=Path(source);output=Path(output)
    data=source.read_bytes()
    if len(data)>64*1024*1024:raise ValueError('IMAGE_TOO_LARGE')
    sha=hashlib.sha256(data).hexdigest()
    with Image.open(source) as image:
        report=analyze(image,grid)
        preview=alpha_visibility_rgb(image)
    output.mkdir(parents=True,exist_ok=False)
    target=output/'actual-alpha-display.png';preview.save(target)
    report.update(sourceSha256=sha,preview='actual-alpha-display.png',
        previewSha256=hashlib.sha256(target.read_bytes()).hexdigest(),
        previewPurpose='Opaque RGB display only; never substitute for authoritative native PNG.')
    if hashlib.sha256(source.read_bytes()).hexdigest()!=sha:
        raise ValueError('ALPHA_AUDIT_SOURCE_CHANGED')
    (output/'audit.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    return report


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('command',choices=['audit-native-alpha'])
    p.add_argument('--source',required=True);p.add_argument('--output',required=True)
    p.add_argument('--grid',nargs=2,type=int,required=True,metavar=('COLS','ROWS'))
    args=p.parse_args()
    print(json.dumps(audit(args.source,args.output,args.grid),ensure_ascii=False))
