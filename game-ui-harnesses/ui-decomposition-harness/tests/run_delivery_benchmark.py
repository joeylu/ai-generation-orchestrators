"""Offline procedural benchmark: real CLI/Pixi/Studio, no media/provider calls.

The reference fixture deliberately has unknown state. A blocked reference result
is expected and is NOT counted as successful visual delivery or a generation SLA.
"""
import argparse
import json
from pathlib import Path
import shutil
import subprocess
import time
import zipfile

from PIL import Image
from ai_ui_decomposition.common import read_json, write_json, sha256
from ai_ui_decomposition.reference_delivery import upgrade_reference_handoff
from ai_ui_decomposition.delivery_pipeline import run_delivery


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--component-root',type=Path,required=True);p.add_argument('--output',type=Path,required=True)
    args=p.parse_args();component=args.component_root.resolve();out=args.output.resolve();out.mkdir(parents=True,exist_ok=False)
    subprocess.run(['node',str(Path(__file__).with_name('stateful-fixtures.mjs')),str(component),str(out/'fixtures')],check=True,capture_output=True)
    original=out/'fixtures/Select-layout'
    with zipfile.ZipFile(original/'ui.component-handoff.draft.zip') as z:
        bundle=json.loads(z.read('component.ui-bundle.json'));binding=json.loads(z.read('appearance-binding.json'))
    node=bundle['document']['root']['children'][0];ident=node['id'];w,h=Image.open(original/'reference.png').size
    inputs=out/'inputs';inputs.mkdir();shutil.copyfile(original/'reference.png',inputs/'reference.png')
    unknown=dict(status='unknown',reason='Procedural test raster has no observed interaction state.')
    write_json(inputs/'reference-state.json',dict(kind='ui-reference-state',schemaVersion='1.0',components=[dict(componentId=ident,componentType='Select',fields=dict(selectedId=unknown,popupOpen=unknown))]))
    write_json(inputs/'scope.json',dict(kind='ui-acceptance-scope',schemaVersion='1.0',referenceState='reference/reference-state.json',components=[dict(componentId=n['id'],mode='compare',reason='Procedural benchmark') for n in (bundle['document']['root'],node)],derivedTestStates=[],human_visual_acceptance=False))
    write_json(inputs/'mapping.json',dict(coordinateSpace='raw-image-pixel-edges-to-runtime-canvas',sourceSize=[w,h],targetSize=[w,h],crop=[0,0,w,h],rotationDegrees=0,flipX=False,flipY=False,scale=[1,1],offset=[0,0]))
    upgrade_reference_handoff(original/'ui.component-handoff.draft.zip',inputs/'reference.png',inputs/'reference-state.json',inputs/'scope.json',inputs/'mapping.json',inputs/'source.zip')
    req=dict(kind='ui_layout_requirements_v1',panels=[],buttons=[],textBackgrounds=[],selects=[dict(componentId=ident,surface='opaque',reason='Procedural opaque popup support')])
    write_json(inputs/'layout.json',req)
    label=next(o['label'] for o in node['props']['options'] if o['id']==node['props']['selectedId'])
    region=dict(node['layout']);parent=bundle['document']['root']['layout'];region['x']+=parent['x'];region['y']+=parent['y']
    write_json(inputs/'observations.json',dict(kind='ui_visual_observations_v1',texts=[dict(componentId=ident,text=label,region=region,minFontSize=node['props']['style']['fontSize'])],dialogs=[]))
    ref=lambda name:dict(path=name,sha256=sha256(inputs/name))
    evidence=read_json(original/'evidence.json');evidence.update(handoffSha256=sha256(inputs/'source.zip'),reference=ref('reference.png'),visualObservations=ref('observations.json'),layoutRequirements=ref('layout.json'))
    write_json(inputs/'evidence.json',evidence)
    write_json(inputs/'plan.json',dict(kind='ui_delivery_run_plan_v1',source=ref('source.zip'),stateEvidence=ref('evidence.json')))
    start=time.monotonic();report=run_delivery(inputs/'plan.json',component,out/'run',1200)
    write_json(out/'benchmark.json',dict(kind='ui_local_delivery_benchmark_v1',elapsedSeconds=time.monotonic()-start,status=report['status'],generationCalls=0,scope='one procedural Select; not 16-type coverage or end-to-end generation SLA',human_visual_acceptance=False))
    print(json.dumps(report,indent=2))
    if report['status']!='blocked_reference':raise SystemExit(2)


if __name__=='__main__':main()
