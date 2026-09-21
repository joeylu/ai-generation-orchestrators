import unittest
import zipfile
from pathlib import Path
from PIL import Image
import test_compile_visual
from evaluate import read,save,digest
from freeze_visual import freeze
from layer_package import build,validate_archive,sources_from_preview


class LayerPackageTests(unittest.TestCase):
    def setUp(self):
        test_compile_visual.VisualCompileTests.setUp(self)
        import json
        self.visual.update(textPolicy='remove-business-text',backgroundMode='scene-only')
        for m in self.visual['materials']:m['preserveText']=[]
        (self.run/'m1/draft.json').write_text(json.dumps(self.visual),encoding='utf-8')
        for p in (self.run/'result.json',self.run/'m2/request.json'):
            data=read(p);data['sourcePlanSha256']=digest(self.run/'m1/draft.json');p.write_text(json.dumps(data))
        self.snapshot=self.root/'snapshot';freeze(self.run,self.snapshot,5)
        sources={}
        for i,row in enumerate(read(self.snapshot/'placements.json')['materials']):
            path=self.root/(str(i)+'.png');Image.new('RGBA',tuple(row['outputSize']),(30+i*20,60,90,255 if i==0 else 128)).save(path)
            sources[row['id']]=dict(path=str(path),sha256=digest(path))
        self.evidence=self.root/'sources.json';save(self.evidence,dict(sources=sources,issues=['Unreviewed fixture']))
        self.viewer=self.root/'viewer';self.viewer.mkdir()
        (self.viewer/'viewer.html').write_text('<html></html>');(self.viewer/'viewer.js').write_text('void 0;')

    def test_independent_portable_archive_and_recomposition(self):
        out=self.root/'out';result=build(self.snapshot,self.evidence,out,self.viewer)
        self.assertEqual(result['layerCount'],5);self.assertFalse(result['humanVisualAcceptance'])
        validate_archive(out/'ui-layers.zip')
        with zipfile.ZipFile(out/'ui-layers.zip') as z:
            self.assertEqual(z.namelist(),sorted(z.namelist()))
            self.assertNotIn('sourceSnapshotDigest',z.read('manifest.json').decode())
            self.assertNotIn(str(self.root),z.read('composition.json').decode())
            self.assertEqual(z.read('review.json').count(b'review-required'),1)
        with self.assertRaises(FileExistsError):build(self.snapshot,self.evidence,out,self.viewer)

    def test_changed_source_missing_layer_and_private_notes_rejected(self):
        data=read(self.evidence);first=next(iter(data['sources'].values()))
        Path(first['path']).write_bytes(b'changed')
        with self.assertRaisesRegex(ValueError,'SOURCE_CHANGED'):build(self.snapshot,self.evidence,self.root/'bad',self.viewer)
        data['sources'].pop(next(iter(data['sources'])))
        p=self.root/'missing.json';save(p,data)
        with self.assertRaisesRegex(ValueError,'COMPLETE_LAYER'):build(self.snapshot,p,self.root/'missing',self.viewer)
        data=read(self.evidence);data['issues']=['C:/Users/private/image.png'];p=self.root/'private.json';save(p,data)
        with self.assertRaisesRegex(ValueError,'NONPORTABLE'):build(self.snapshot,p,self.root/'private',self.viewer)

    def test_archive_hash_tampering_rejected(self):
        out=self.root/'out';build(self.snapshot,self.evidence,out,self.viewer)
        changed=self.root/'tampered.zip'
        with zipfile.ZipFile(out/'ui-layers.zip') as source,zipfile.ZipFile(changed,'w') as target:
            for name in source.namelist():target.writestr(name,b'changed' if name=='preview.png' else source.read(name))
        with self.assertRaisesRegex(ValueError,'PACKAGE_HASH'):validate_archive(changed)

    def test_preview_adapter_checks_complete_material_fingerprints(self):
        from preview_partial import preview
        evidence=read(self.evidence);config=self.root/'preview.json'
        save(config,dict(snapshot=str(self.snapshot),snapshotDigest=read(self.snapshot/'snapshot.json')['digest'],
                        materials={k:v['path'] for k,v in evidence['sources'].items()}))
        # Inputs here are opaque fixture rectangles; use a producer report fixture for the adapter boundary.
        folder=self.root/'preview';folder.mkdir();records=[]
        for key,entry in evidence['sources'].items():
            (folder/key).mkdir();(folder/key/'material.png').write_bytes(Path(entry['path']).read_bytes())
            records.append(dict(id=key,report=dict(status='processed_pending_visual_review',materialSha256=entry['sha256'])))
        save(folder/'report.json',dict(snapshotDigest=read(self.snapshot/'snapshot.json')['digest'],records=records))
        value=sources_from_preview(self.snapshot,folder)
        self.assertEqual(set(value['sources']),set(evidence['sources']))
        (folder/records[0]['id']/'material.png').write_bytes(b'changed')
        with self.assertRaisesRegex(ValueError,'PREVIEW_MATERIAL_CHANGED'):sources_from_preview(self.snapshot,folder)
