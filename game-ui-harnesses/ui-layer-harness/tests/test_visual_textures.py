import _bootstrap
import copy
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from PIL import Image
from ai_ui_layers import visual_textures as vt


class VisualTexturesTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory(); self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name)
        self.reference = self.root/'reference.png'
        Image.new('RGB', (1000, 1000), '#ddd').save(self.reference)
        self.doc = dict(kind=vt.KIND, referenceSha256=self.sha(self.reference), canvas=[1000, 1000],
            regions=[dict(id='tiny-print', sourceBox=[100, 100, 120, 120],
                          appearance='三排浅色细笔画', protectedArtwork='保留标签底和外圈条纹')])
        self.plan = dict(materials=[dict(id='item', bboxNorm=[.05,.05,.2,.2]),
                                   dict(id='other', bboxNorm=[.3,.3,.5,.5])],
                         objects=[dict(id='ink', materialId='item', bboxNorm=[.09,.09,.13,.13])])
        self.review = dict(visualTextureAudit={'tiny-print':dict(status='confirmed', materialId='item',
            objectId='ink',sourceEvidence='原图该标签内浅色细印',preservationEvidence='笔画与条纹分离')})

    def sha(self, path):
        return hashlib.sha256(path.read_bytes()).hexdigest()

    def write(self, name, doc):
        path=self.root/name;path.parent.mkdir(parents=True,exist_ok=True)
        path.write_text(json.dumps(doc,ensure_ascii=False),encoding='utf-8');return path

    def test_legacy_none_does_not_add_permission(self):
        self.assertIsNone(vt.load_input(None,self.reference))
        self.assertIsNone(vt.read_input(self.root,dict(inputs={})))
        self.assertEqual(vt.assess(None,self.plan,{}),([],None))
        self.assertEqual(vt.guidance(None),'')
        self.assertEqual(vt.generation_guidance(None,None,['item'],self.plan),'')
        with self.assertRaises(ValueError):vt.assess(None,self.plan,self.review)

    def test_strict_input_reference_and_json(self):
        path=self.write(vt.INPUT_NAME,self.doc)
        self.assertEqual(vt.load_input(path,self.reference),path.read_bytes())
        changed=copy.deepcopy(self.doc);changed['referenceSha256']='0'*64
        with self.assertRaises(ValueError):vt.load_input(self.write(vt.INPUT_NAME,changed),self.reference)
        changed=copy.deepcopy(self.doc);changed['canvas']=[999,1000]
        with self.assertRaises(ValueError):vt.load_input(self.write(vt.INPUT_NAME,changed),self.reference)
        for raw in ['{"kind":1,"kind":2}', '{"kind":NaN}', '{"kind":1e999}']:
            path.write_text(raw,encoding='utf-8')
            with self.assertRaises(ValueError):vt.load_input(path,self.reference)

    def test_region_geometry_duplicate_overlap_and_limits(self):
        for box in [[-1,100,120,120],[100,100,100,120],[100.0,100,120,120],
                    [True,100,120,120],[0,0,1000,1000],[0,0,101,100]]:
            doc=copy.deepcopy(self.doc);doc['regions'][0]['sourceBox']=box
            with self.subTest(box=box),self.assertRaises(ValueError):vt.validate(doc)
        for identity in ['tiny-print','another']:
            doc=copy.deepcopy(self.doc);doc['regions'].append(dict(doc['regions'][0],id=identity))
            with self.assertRaises(ValueError):vt.validate(doc)
        doc=copy.deepcopy(self.doc);doc['regions']=[dict(self.doc['regions'][0],id='r'+str(i),
            sourceBox=[i*100,0,(i+1)*100,100]) for i in range(6)]
        with self.assertRaises(ValueError):vt.validate(doc)
        doc=copy.deepcopy(self.doc);doc['regions'][0]['path']='private'
        with self.assertRaises(ValueError):vt.validate(doc)

    def test_confirmed_bindings_preserve_exact_source_data(self):
        blockers,bindings=vt.assess(self.doc,self.plan,self.review)
        self.assertEqual(blockers,[])
        self.assertEqual(vt.validate_bindings(self.doc,self.plan,bindings),bindings)
        self.assertEqual(bindings['regions'][0]['sourceBox'],[100,100,120,120])
        self.assertEqual(vt.review_schema(self.doc,self.plan)['required'],['tiny-print'])
        schema=vt.bind_review_schema({'type':'object','properties':{},'required':[]},self.doc,self.plan)
        self.assertIn('visualTextureAudit',schema['required'])

    def test_uncertain_foreign_owner_wrong_object_and_outside_block(self):
        for updates in [dict(status='uncertain'),dict(materialId=None),dict(materialId='foreign'),
                        dict(materialId='other'),dict(objectId='foreign'),dict(objectId=None)]:
            review=copy.deepcopy(self.review);review['visualTextureAudit']['tiny-print'].update(updates)
            self.assertTrue(vt.assess(self.doc,self.plan,review)[0])
        plan=copy.deepcopy(self.plan);plan['materials'][0]['bboxNorm']=[.11,.11,.2,.2]
        self.assertTrue(vt.assess(self.doc,plan,self.review)[0])
        plan=copy.deepcopy(self.plan);plan['objects'][0]['bboxNorm']=[.11,.11,.13,.13]
        self.assertTrue(vt.assess(self.doc,plan,self.review)[0])
        for audit in [{},{'foreign':self.review['visualTextureAudit']['tiny-print']}]:
            with self.assertRaises(ValueError):vt.assess(self.doc,self.plan,dict(visualTextureAudit=audit))

    def test_planning_pins_and_request_binding(self):
        run=self.root/'run';inputs=run/'.dag/inputs';inputs.mkdir(parents=True)
        (inputs/'reference.png').write_bytes(self.reference.read_bytes())
        file=inputs/vt.INPUT_NAME;file.write_text(json.dumps(self.doc),encoding='utf-8')
        config=dict(inputs={vt.INPUT_NAME:self.sha(file)},visualTexturePolicy=vt.POLICY)
        cfg=run/'.dag/config.json';cfg.write_text(json.dumps(config),encoding='utf-8')
        (run/'.dag/config-digest.json').write_text(json.dumps(dict(sha256=self.sha(cfg))),encoding='utf-8')
        (run/'m1').mkdir();request=run/'m1/request.json'
        request.write_text(json.dumps(dict(visualTexturesSha256=self.sha(file))),encoding='utf-8')
        self.assertEqual(vt.planning_input(run),self.doc)
        request.write_text('{}',encoding='utf-8')
        with self.assertRaises(ValueError):vt.planning_input(run)
        with self.assertRaises(ValueError):vt.read_input(inputs,dict(inputs=config['inputs']))

    def test_generation_owned_regions_and_context_mapping(self):
        _,bindings=vt.assess(self.doc,self.plan,self.review)
        text=vt.generation_guidance(self.doc,bindings,['item'],self.plan,
            context=[dict(materialId='item',cropRegion=[50,50,200,200],referenceSize=[150,150],referenceIndex=1)])
        self.assertIn('not OCR',text);self.assertIn('invent no words',text)
        self.assertIn('"contextBox":[50,50,70,70]',text)
        self.assertIn('"cellIndex":0',text)
        foreign=vt.generation_guidance(self.doc,bindings,['other'],self.plan)
        self.assertNotIn('三排浅色细笔画',foreign)
        self.assertIn('foreign regions',foreign)
        self.assertIn('普通业务字仍按精确片段删除',vt.guidance(self.doc))

    def test_snapshot_missing_pin_and_tamper_fail_closed(self):
        file=self.write(vt.INPUT_NAME,self.doc)
        _,bindings=vt.assess(self.doc,self.plan,self.review)
        bound=self.write(vt.BINDINGS_NAME,bindings)
        manifest=dict(files={vt.INPUT_NAME:self.sha(file),vt.BINDINGS_NAME:self.sha(bound)},
            visualTexturePolicy=vt.POLICY,visualTexturesSha256=self.sha(file),
            visualTextureBindingsSha256=self.sha(bound))
        self.assertEqual(vt.snapshot_bindings(self.root,manifest,self.plan),bindings)
        with self.assertRaises(ValueError):vt.snapshot_input(self.root,dict(files={}))
        broken=copy.deepcopy(manifest);broken['files'].pop(vt.BINDINGS_NAME)
        with self.assertRaises(ValueError):vt.snapshot_bindings(self.root,broken,self.plan)
        changed=copy.deepcopy(bindings);changed['regions'][0]['appearance']='被修改的笔画'
        self.write(vt.BINDINGS_NAME,changed)
        with self.assertRaises(ValueError):vt.snapshot_bindings(self.root,manifest,self.plan)
        manifest['files'][vt.BINDINGS_NAME]=self.sha(bound)
        manifest['visualTextureBindingsSha256']=self.sha(bound)
        with self.assertRaises(ValueError):vt.snapshot_bindings(self.root,manifest,self.plan)


if __name__=='__main__':unittest.main()
