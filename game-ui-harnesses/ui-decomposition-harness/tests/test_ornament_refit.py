from copy import deepcopy
from pathlib import Path
import tempfile
import unittest
from PIL import Image,ImageDraw
from ai_ui_decomposition.common import sha256,read_json,write_json,ContractError
from ai_ui_decomposition.material_refit import apply_refit
from ai_ui_decomposition.media import require_long_control_geometry,matte_key


def recipe(path):
    with Image.open(path) as im:box=im.getchannel('A').getbbox()
    w=box[2]-box[0]
    return dict(version='1.0',operation='visible-horizontal-band-fit',role='ornamented-rule',
        sourceSha256=sha256(path),evidence='Measured center emblem and end caps; other bands contain straight rail only.',
        alphaBounds=list(box),sourceX=[0,12,210,290,w-12,w],targetX=[0,12,160,240,388,400],
        protectedColumns=[0,2,4],offset=[50,2])


class OrnamentRefitTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name)
        self.source=self.root/'source.png'
        im=Image.new('RGBA',(500,26));d=ImageDraw.Draw(im)
        d.line((0,13,499,13),fill=(180,120,30,255),width=2)
        d.polygon([(250,2),(262,13),(250,23),(238,13)],fill=(30,130,220,255))
        im.putpixel((244,10),(25,110,190,93));im.save(self.source)

    def tearDown(self):self.temp.cleanup()

    def test_full_height_emblem_and_ends_copied_exactly_with_soft_alpha(self):
        s=recipe(self.source);im=Image.open(self.source).convert('RGBA');support=im.crop(s['alphaBounds'])
        with self.assertRaisesRegex(ContractError,'LONG_CONTROL'):require_long_control_geometry(im,[500,26])
        out,e=apply_refit(self.source,s,{})
        require_long_control_geometry(out,[500,26])
        for i in s['protectedColumns']:
            old=support.crop((s['sourceX'][i],0,s['sourceX'][i+1],support.height))
            new=out.crop((50+s['targetX'][i],2,50+s['targetX'][i+1],2+support.height))
            self.assertEqual(old.tobytes(),new.tobytes())
        self.assertEqual(out.size,im.size);self.assertTrue(e['fullSourceTiling'])
        self.assertEqual(out.getpixel((0,0)),(0,0,0,0))

    def test_bad_mapping_and_unprotected_ends_cannot_discard_or_distort_art(self):
        for mutation in ('hash','bounds','coverage','order','protect','distort','outside','scale','role'):
            s=recipe(self.source)
            if mutation=='hash':s['sourceSha256']='0'*64
            if mutation=='bounds':s['alphaBounds'][1]+=1
            if mutation=='coverage':s['sourceX'][-1]-=1
            if mutation=='order':s['sourceX'][2]=s['sourceX'][1]
            if mutation=='protect':s['protectedColumns']=[1,2,4]
            if mutation=='distort':s['targetX'][3]+=1
            if mutation=='outside':s['offset']=[101,2]
            if mutation=='scale':s['targetX'][2]=13
            if mutation=='role':s['role']='icon'
            with self.subTest(mutation=mutation),self.assertRaises(ContractError):apply_refit(self.source,s,{})

    def test_formal_recovery_preserves_failed_quality_and_rechecks_geometry(self):
        from ai_ui_decomposition.assets_brief import prepare
        from ai_ui_decomposition import assets_generation,assets_boards
        from ai_ui_decomposition.reviewed_recovery import prepare_materials
        # Plain compact plan plus a minimal official-format catalog for the same
        # non-board materialization producer (no generated provider is invoked).
        ref=self.root/'ref.png';Image.new('RGB',(600,120),'blue').save(ref)
        b=dict(kind='ui_assets_brief_v1',id='ornament',reviewed=True,boards=[],assets=[
            dict(id='scene',role='background',region=[0,0,600,120],description='Blue scene'),
            dict(id='rule',role='important_component',region=[10,40,500,26],description='Gold rule and center diamond')],
            elements=[dict(id='sky',label='Blue scene',region=[0,0,600,120],owner='scene'),
                      dict(id='rule-art',label='Rule and diamond',region=[10,40,500,26],owner='rule')])
        bp=self.root/'brief.json';write_json(bp,b);prepared=self.root/'prepared'
        # This recovery fixture deliberately exercises an archived v1 plan.
        # Current preparation requires an explicit compatibility opt-in.
        p=prepare(ref,bp,prepared,legacy_brief=True);run=Path(p['runDirectory'])
        assets_generation.authorize(run,p['planDigest'],'Offline fixture only')
        response=assets_generation.exchange(run)
        while response['nextRequest']:
            req=response['nextRequest'];raw=self.root/(req['asset']+'-raw.png')
            if req['asset']=='scene':Image.new('RGB',(600,120),'blue').save(raw)
            else:
                im=Image.new('RGB',(520,50),'#f808f8');d=ImageDraw.Draw(im)
                d.line((10,25,509,25),fill='gold',width=3)
                d.polygon([(260,16),(272,25),(260,34),(248,25)],fill='gold');im.save(raw)
            response=assets_generation.exchange(run,req['requestDigest'],raw)
        from ai_ui_decomposition.material_preflight import check_batch
        report=check_batch(None,run,self.root/'quality.json')
        self.assertEqual(report['failed'],1)
        q=next(r for r in report['materials'] if r['asset']=='rule')
        self.assertEqual(q['errors'],['LONG_CONTROL_SUPPORT_ASPECT_MISMATCH'])
        from ai_ui_decomposition.batch import load
        frozen,plan=load(run);entry=frozen['requests']['rule']
        raw=run/'requests'/entry['id']/'raw.png';before=sha256(raw.parent/'quality.json')
        processed=self.root/'processed.png';matte_key(Image.open(raw),[500,26]).save(processed)
        spec=dict(version='1.0',batchDigest=frozen['digest'],revisions={'rule':dict(kind='processed-ornament-refit',
            rawSha256=q['rawSha256'],reason='Measured protected ornamental bands',recipe=recipe(processed))})
        catalog=dict(parts=[dict(generationAsset=a['id'],layerId=a['id'],board=None,rect=[0,0,*a['output_size']]) for a in plan['assets']])
        paths,record=prepare_materials(prepared,run,spec,self.root/'recovered',catalog=catalog)
        require_long_control_geometry(Image.open(paths['rule']),[500,26])
        self.assertEqual(sha256(raw.parent/'quality.json'),before)
        self.assertEqual(next(x for x in record['sources'] if x['asset']=='rule')['originalQualityStatus'],'failed')
        bad=deepcopy(spec);bad['revisions']['rule']['recipe']['targetX']=[0,12,208,288,484,496]
        bad['revisions']['rule']['recipe']['offset']=[2,2]
        with self.assertRaisesRegex(ContractError,'LONG_CONTROL_SUPPORT_ASPECT_MISMATCH'):
            prepare_materials(prepared,run,bad,self.root/'bad',catalog=catalog)
