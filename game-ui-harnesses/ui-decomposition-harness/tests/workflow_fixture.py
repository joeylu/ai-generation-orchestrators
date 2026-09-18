"""Offline adapter: synthetic pictures, actual compiler/batch/process/PNG exporter.

Not a model provider and not a component-handoff or visual-acceptance substitute.
"""
from pathlib import Path
import time
from PIL import Image, ImageDraw
from ai_ui_decomposition.common import read_json, write_json, digest, sha256, require
from ai_ui_decomposition.vision_draft import compile_draft
from ai_ui_decomposition import batch


def draft():
    return dict(version='vision-draft-1',canvas=[200,160],unknowns=['No navigation target observed'],nodes=[
        dict(id='panel',type='Panel',parentId=None,rect=[10,10,180,140],text=None,fontSize=None,color=None,role='panel'),
        dict(id='action',type='Button',parentId='panel',rect=[30,100,100,32],text='OK',fontSize=16,color='#FFFFFF',role='action')])


class Fixture:
    def __init__(self, options): self.options=options
    def run(self,c):
        require(c['spec']['fixture'] is True,'FIXTURE_MODE_REQUIRED')
        job=Path(c['job']);out=Path(c['output']);node=c['node']
        with (job/'fixture-calls.txt').open('a',encoding='utf-8') as f:f.write(node+'\n')
        if self.options.get('crash')==node: raise RuntimeError('private endpoint token=must-not-leak')
        if self.options.get('slow')==node:time.sleep(5)
        def source(stage,name):
            return job/'nodes'/stage/'output'/c['receipts'][stage]['artifacts'][name]['path']
        def result(data=None, artifacts=None, status='ok'):
            return dict(status=status,data=data or {},artifacts=artifacts or {})
        if node in ('vision','repair'):
            response=self.options.get('response',draft())
            if self.options.get('invalid') and (node=='vision' or self.options.get('invalid')=='twice'):
                response={**response,'version':'invalid'}
            write_json(out/'response.json',response)
            return result(artifacts={'response':'response.json'})
        if node in ('compile','compile_repaired'):
            response=read_json(source('vision' if node=='compile' else 'repair','response'))
            try: compiled=compile_draft(response)
            except ValueError as exc:
                return result({'errorCode':str(exc)},status='invalid')
            for name,content in compiled.items():write_json(out/name,content)
            return result(artifacts={'document':'semantic-document.json','observations':'visual-observations.json','requirements':'layout-requirements.json'})
        compiled='compile_repaired' if 'compile_repaired' in c['receipts'] else 'compile'
        if node=='freeze':
            import shutil
            from ai_ui_decomposition.contract import validate
            from ai_ui_decomposition.capabilities import audit
            document=read_json(source(compiled,'document'));canvas=[200,160]
            assets=[dict(id='scene',role='background',route='generated_completion',source_region=[0,0,200,160],output_size=canvas,output_mode='opaque_canvas',prompt='Fixture scene only',source_asset=None),
                dict(id='panel',role='important_component',route='generated_isolation',source_region=[10,10,190,150],output_size=[180,140],output_mode='keyed_component',prompt='Fixture empty panel on #F808F8',source_asset=None),
                dict(id='button',role='important_component',route='generated_isolation',source_region=[30,100,130,132],output_size=[100,32],output_mode='keyed_component',prompt='Fixture button on #F808F8',source_asset=None)]
            shutil.copyfile(job/c['spec']['reference'],out/'original.png')
            plan=dict(kind='ai_ui_decomposition_plan_v1',id='workflow-fixture',canvas=canvas,source=dict(path='original.png',sha256=sha256(out/'original.png'),size=canvas),text_policy='remove_ordinary_text_preserve_graphic_symbols',granularity='important_components_only',delivery_policy='unreviewed_draft',assets=assets,
                nodes=[dict(id='scene',asset='scene',xy=[0,0]),dict(id='panel',asset='panel',xy=[10,10]),dict(id='button',asset='button',xy=[30,100])],groups=[dict(id='all',children=['scene','panel','button'])],document=dict(name='fixture',format='png_zip'))
            # Fixture geometry is authored here, never inferred for user artwork.
            spacing=dict(version='1.1',panelFooters=[dict(panelId='panel',componentIds=['action'],innerBottom=140,minimumGap=8,evidence='Synthetic fixture safe edge; not a source-image measurement')],scrollBottomSpaces=[],nonFooterButtons={})
            def walk(n):
                yield n
                for child in n.get('children',[]):yield from walk(child)
            capabilities=dict(kind='ui-decomposition-capability-request',version='1.0',planDigest=digest(plan),components=[dict(id=n['id'],type=n['type'],profiles=['base']) for n in walk(document['root'])])
            write_json(out/'plan.json',plan);write_json(out/'document.json',document);write_json(out/'spacing.json',spacing);write_json(out/'capabilities.json',capabilities)
            write_json(out/'check.json',validate(plan,source_base=out));write_json(out/'capability-report.json',audit(capabilities))
            frozen=batch.freeze(out/'plan.json',out/'workspace','fixture',capability_request=out/'capabilities.json',component_document=out/'document.json',layout_spacing=out/'spacing.json')
            return result(dict(planDigest=digest(plan),maximumCalls=frozen['maximum_calls']),{'plan':'plan.json','batch':'workspace/runs/fixture/batch.json','spacing':'spacing.json','document':'document.json','capabilities':'capabilities.json'})
        run=source('freeze','batch').parent
        if node=='generate':
            from ai_ui_decomposition.adapter import export_request,seal_result,import_result
            frozen,plan=batch.load(run)
            for key in frozen['dispatch_order']:
                bundle=out/key;export_request(run,key,bundle)
                asset=next(a for a in plan['assets'] if a['id']==key)
                image=Image.new('RGB',tuple(asset['output_size']),'#102030' if key=='scene' else '#F808F8')
                if key!='scene':
                    w,h=image.size;ImageDraw.Draw(image).rectangle((2,2,w-3,h-3),fill='#DDBB66')
                raw=out/(key+'.png');image.save(raw);seal_result(bundle,raw);import_result(run,bundle)
            write_json(out/'fixture-generation.json',dict(fixtureOnly=True,requests=len(frozen['dispatch_order'])))
            return result(artifacts={'evidence':'fixture-generation.json'})
        if node=='process':
            from ai_ui_decomposition.process import process
            process(run)
            write_json(out/'processed.json',dict(materialsSha256=sha256(run/'materials/materials.json')))
            if self.options.get('reviewMode')=='file':
                import shutil
                shutil.copyfile(job/c['spec']['reference'],out/'fixture-preview.png')
                shutil.copyfile(run/'materials/contact-sheet.png',out/'fixture-contact.png')
                return result({'fixtureOnly':True},dict(evidence='processed.json',preview='fixture-preview.png',contact='fixture-contact.png'))
            return result(artifacts={'evidence':'processed.json'})
        if node=='review':
            return result(dict(decision=self.options.get('review','accept'),human_visual_acceptance=False,fixtureOnly=True))
        if node=='acceptance':
            return result(dict(fixtureOnly=True,human_visual_acceptance=False))
        if node=='deliver':
            from ai_ui_decomposition.assembly import finalize,inspect_delivery
            from ai_ui_decomposition.png_zip import export_png_zip
            finalize(run,out/'draft',draft=True);exported=export_png_zip(out/'draft');inspect_delivery(out/'draft')
            return result(dict(acceptance='fixture_only',human_visual_acceptance=False),{'archive':'draft/'+exported['file']})
        raise ValueError('UNSUPPORTED_FIXTURE_STAGE')


def create(options):return Fixture(options)
