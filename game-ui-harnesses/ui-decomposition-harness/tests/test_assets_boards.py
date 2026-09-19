from copy import deepcopy
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import zipfile
from PIL import Image
from test_assets_cli import FixtureProvider,fixture_coverage
from test_component_boards import paint
from ai_ui_decomposition import planning,assets_boards,assets_generation
from ai_ui_decomposition.common import read_json,write_json,digest,sha256,ContractError
from ai_ui_decomposition.assembly import finalize
from ai_ui_decomposition.png_zip import export_png_zip


class AssetBoardsTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name).resolve()
        Image.new('RGB',(64,48),'blue').save(self.root/'reference.png')
        p=planning.materialize(FixtureProvider().plan(),self.root,[64,48],3,output_format='png_zip')
        second=deepcopy(p['assets'][1]);second['id']='button-two';second['source_region']=[36,30,56,42]
        p['assets'].append(second);p['nodes'][2]['asset']='button-two'
        p['reference_coverage']=fixture_coverage(p['source']['sha256'],[a['id'] for a in p['assets']],p['canvas'])
        write_json(self.root/'target.json',p)
        self.groups={'kind':'ui_assets_board_groups_v1','groups':[dict(id='icons',assetIds=['button','button-two'],packingCanvas=[128,64],
            extractionPolicy=dict(version='1.0',mode='relative-cell',target_padding=2,max_canvas_aspect_error=.15))]}
        write_json(self.root/'groups.json',self.groups)
        self.compiled=self.root/'compiled';self.output=self.root/'processed'

    def tearDown(self):self.temp.cleanup()

    def compile(self):
        return assets_boards.compile_boards(self.root/'target.json',self.root/'groups.json',self.compiled)

    def receive(self,broken=False,changed_canvas=False):
        self.compile();frozen=assets_boards.freeze(self.compiled,self.root/'workspace','generation')
        self.run=self.root/'workspace/runs/generation'
        assets_generation.authorize(self.run,frozen['plan_digest'],'offline fixture approval')
        response=assets_generation.exchange(self.run)
        while response['nextRequest']:
            request=response['nextRequest'];key=request['asset']
            raw=self.root/(key+'.png')
            if key=='scene':Image.new('RGB',(64,48),'blue').save(raw)
            else:
                board=read_json(self.compiled/'strategy-icons.json')['boards'][0]
                image=paint(board,keyed=True)
                if changed_canvas:
                    larger=Image.new('RGBA',(128,128),'#f808f8');larger.paste(image,(0,0));image=larger
                if broken:image=Image.new('RGB',image.size,'#f808f8')
                image.save(raw)
            response=assets_generation.exchange(self.run,request['requestDigest'],raw)

    def test_grouped_generation_extracts_independent_layers_and_exports(self):
        self.receive()
        self.assertEqual(assets_boards.preflight(self.compiled,self.run,self.root/'quality.json')['status'],'passed')
        with patch('subprocess.Popen',side_effect=AssertionError('Pure asset processing must not start a consumer')):
            result=assets_boards.materialize(self.compiled,self.run,self.output)
        self.assertEqual(result['status'],'materials_ready_for_review')
        final=self.root/'delivery';finalize(Path(result['runDirectory']),final,draft=True)
        exported=export_png_zip(final)
        with zipfile.ZipFile(final/exported['file']) as archive:
            self.assertEqual(len([n for n in archive.namelist() if n.startswith('layers/')]),3)
            self.assertNotIn('layers/board-icons.png',archive.namelist())
        scene=read_json(final/'scene.json')
        layers={n['id']:n for g in scene['tree'] for n in g['children']}
        self.assertEqual(layers['button_one']['size'],[20,12])
        self.assertEqual(layers['button_two']['size'],[20,12])
        self.assertEqual(read_json(self.output/'lineage.json')['sourceBatchDigest'],read_json(self.run/'batch.json')['digest'])
        self.assertEqual(len(read_json(self.output/'lineage.json')['extractions']),1)

    def test_board_quality_failure_cannot_be_materialized(self):
        self.receive(broken=True)
        self.assertEqual(assets_boards.preflight(self.compiled,self.run,self.root/'quality.json')['status'],'failed')
        with self.assertRaises(ContractError):assets_boards.materialize(self.compiled,self.run,self.output)
        self.assertFalse(self.output.exists())

    def test_reviewed_regions_recover_changed_canvas_without_consumer_or_quality_rewrite(self):
        self.receive(changed_canvas=True)
        report=assets_boards.preflight(self.compiled,self.run,self.root/'quality.json')
        self.assertEqual(report['failed'],1)
        failed=next(r for r in report['materials'] if r['status']=='failed')
        self.assertEqual(failed['errors'],['BOARD_RELATIVE_CANVAS_ASPECT'])
        before={str(p):sha256(p) for p in self.run.rglob('quality.json')}
        board=read_json(self.compiled/'strategy-icons.json')['boards'][0]
        spec=dict(version='1.0',batchDigest=report['batchDigest'],revisions={'board-icons':dict(
            kind='board-regions',rawSha256=failed['rawSha256'],reason='Fixture canvas changed; original complete parts retain clear borders.',
            sourceRegions={s['asset_id']:s['crop'] for s in board['slots']})})
        bad=deepcopy(spec);bad['revisions']['board-icons']['rawSha256']='0'*64
        with self.assertRaisesRegex(ContractError,'RECOVERY_RAW_CHANGED'):
            assets_boards.recover(self.compiled,self.run,bad,self.output)
        self.assertFalse(self.output.exists())
        with patch('subprocess.Popen',side_effect=AssertionError('No component consumer')):
            partial=self.root/'partial'
            subset=assets_boards.recover(self.compiled,self.run,spec,partial,materials_only=True)
            self.assertEqual(subset['recoveredAssets'],['button','button-two'])
            self.assertEqual(subset['remainingAssets'],['scene'])
            self.assertFalse(subset['completePackage'])
            self.assertFalse((partial/'project/plan.json').exists())
            result=assets_boards.recover(self.compiled,self.run,spec,self.output)
        self.assertEqual(result['generationCalls'],0)
        self.assertEqual(before,{str(p):sha256(p) for p in self.run.rglob('quality.json')})
        self.assertFalse((self.run/'materials').exists())
        lineage=read_json(self.output/'recovery-lineage.json')
        self.assertEqual(next(s for s in lineage['sources'] if s['asset']=='board-icons')['originalQualityStatus'],'failed')
        final=self.root/'delivery';finalize(Path(result['runDirectory']),final,draft=True)
        exported=export_png_zip(final)
        with zipfile.ZipFile(final/exported['file']) as archive:
            self.assertEqual(len([n for n in archive.namelist() if n.startswith('layers/')]),3)

    def test_target_and_mapping_changes_rejected(self):
        self.compile()
        p=read_json(self.compiled/'target-plan.json');p['nodes'][1]['xy']=[5,30]
        (self.compiled/'target-plan.json').write_text(__import__('json').dumps(p),encoding='utf-8')
        with self.assertRaisesRegex(ContractError,'PLAN_CHANGED'):assets_boards.verify(self.compiled)

    def test_separately_received_replacement_keeps_both_source_identities(self):
        self.receive()
        original=assets_boards.preflight(self.compiled,self.run,self.root/'original-quality.json')
        frozen=assets_boards.freeze(self.compiled,self.root/'replacement','generation')
        newer=self.root/'replacement/runs/generation'
        assets_generation.authorize(newer,frozen['plan_digest'],'offline replacement fixture')
        response=assets_generation.exchange(newer)
        while response['nextRequest']:
            request=response['nextRequest'];raw=self.root/('new-'+request['asset']+'.png')
            if request['asset']=='scene':Image.new('RGB',(64,48),'green').save(raw)
            else:paint(read_json(self.compiled/'strategy-icons.json')['boards'][0],keyed=True).save(raw)
            response=assets_generation.exchange(newer,request['requestDigest'],raw)
        quality=assets_boards.preflight(self.compiled,newer,self.root/'replacement-quality.json')
        old=next(r for r in original['materials'] if r['asset']=='scene')
        new=next(r for r in quality['materials'] if r['asset']=='scene')
        spec=dict(version='1.0',batchDigest=original['batchDigest'],revisions={'scene':dict(
            kind='verified-replacement-source',rawSha256=old['rawSha256'],reason='Reviewed separate replacement fixture',
            sourceRunDirectory=str(newer),sourceAsset='scene',sourceBatchDigest=quality['batchDigest'],sourceRawSha256=new['rawSha256'])})
        bad=deepcopy(spec);bad['revisions']['scene']['sourceRawSha256']='0'*64
        with self.assertRaisesRegex(ContractError,'REPLACEMENT_SOURCE_CHANGED'):
            assets_boards.recover(self.compiled,self.run,bad,self.output)
        self.assertFalse(self.output.exists())
        assets_boards.recover(self.compiled,self.run,spec,self.output)
        row=next(r for r in read_json(self.output/'recovery-lineage.json')['sources'] if r['asset']=='scene')
        self.assertEqual(row['rawSha256'],old['rawSha256'])
        self.assertEqual(row['replacementSource']['rawSha256'],new['rawSha256'])
        self.assertNotEqual(row['rawSha256'],row['replacementSource']['rawSha256'])
        with Image.open(self.output/'scene.png') as image:self.assertEqual(image.getpixel((0,0)),(0,128,0,255))

    def test_invalid_group_is_precompute_failure(self):
        self.groups['groups'][0]['assetIds']=['scene','button']
        write_json(self.root/'bad.json',self.groups)
        with self.assertRaisesRegex(ContractError,'MEMBER_UNSUPPORTED'):
            assets_boards.compile_boards(self.root/'target.json',self.root/'bad.json',self.compiled)
        self.assertFalse(self.compiled.exists())

    def test_maximum_length_target_id_remains_valid(self):
        p=read_json(self.root/'target.json');p['id']='a'*64
        write_json(self.root/'long-id.json',p)
        result=assets_boards.compile_boards(self.root/'long-id.json',self.root/'groups.json',self.compiled)
        self.assertEqual(result['generatedRequests'],2)
        assets_boards.verify(self.compiled)


if __name__=='__main__':unittest.main()
