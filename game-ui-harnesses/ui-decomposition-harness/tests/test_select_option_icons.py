"""Offline validation of the official Select icon extension; no media services."""
import copy
import hashlib
import io
import json
from pathlib import Path
import tempfile
import unittest
import zipfile

from PIL import Image
from ai_ui_decomposition.common import ContractError, digest, sha256, write_json
from ai_ui_decomposition.component_handoff import _validate_bound_layers, _validate_state_text_colors, export_component_handoff
from ai_ui_decomposition.select_option_icons import validate_option_icons, contain_rect
from ai_ui_decomposition.png_zip import export_png_zip


def export_fixture(source, output, reference_components=None):
    """Recompose a procedural fixture, then exercise both real producer exporters."""
    output.mkdir()
    with zipfile.ZipFile(source) as outer:
        manifest = json.loads(outer.read('handoff.json'))
        bundle = json.loads(outer.read(manifest['component_bundle']['path']))
        binding = json.loads(outer.read(manifest['appearance_binding']['path']))
        nested = outer.read(manifest['decomposition']['path'])
    with zipfile.ZipFile(io.BytesIO(nested)) as archive:
        # This helper reads only allowlisted members from our generated local fixture.
        scene = json.loads(archive.read('scene.json'))
        receipt = json.loads(archive.read('delivery.json'))
        canvas = Image.new('RGBA', tuple(scene['canvas']))
        for layer in (l for g in scene['tree'] for l in g['children']):
            payload = archive.read(layer['png'])
            target = output/'layers'/f"{layer['id']}.png"
            target.parent.mkdir(exist_ok=True)
            target.write_bytes(payload)
            canvas.alpha_composite(Image.open(io.BytesIO(payload)), (layer['left'], layer['top']))
    canvas.save(output/'preview.png')
    scene['preview_sha256'] = sha256(output/'preview.png')
    scene['document']['format'] = 'png_zip'
    write_json(output/'scene.json', scene)
    receipt['scene_sha256'] = sha256(output/'scene.json')
    receipt['preview_sha256'] = scene['preview_sha256']
    receipt['digest'] = digest({k:v for k,v in receipt.items() if k != 'digest'})
    write_json(output/'delivery.json', receipt)
    png = export_png_zip(output)
    binding.update(deliveryDigest=receipt['digest'], sceneSha256=receipt['scene_sha256'], archiveSha256=png['zip_sha256'])
    write_json(output/'target.json', bundle)
    write_json(output/'binding.json', binding)
    # Procedural raster is explicitly synthetic, with no inferred reference selection.
    unknown = {'status':'unknown','reason':'Procedural fixture, no observed selection or popup state.'}
    state = {'kind':'ui-reference-state','schemaVersion':'1.0','components':[{'componentId':'region','componentType':'Select','fields':{'selectedId':unknown,'popupOpen':unknown}}]}
    if reference_components is not None:
        state['components'] = reference_components
    def walk(n):
        yield n
        for child in n.get('children', []):
            yield from walk(child)
    scope = {'kind':'ui-acceptance-scope','schemaVersion':'1.0','referenceState':'reference/reference-state.json','human_visual_acceptance':False,'derivedTestStates':[],
             'components':[{'componentId':n['id'],'mode':'exclude','reason':'Synthetic fixture tests, not reference visual acceptance.'} for n in walk(bundle['document']['root'])]}
    mapping = {'coordinateSpace':'raw-image-pixel-edges-to-runtime-canvas','sourceSize':scene['canvas'],'targetSize':scene['canvas'],'crop':[0,0,*scene['canvas']],
               'rotationDegrees':0,'flipX':False,'flipY':False,'scale':[1,1],'offset':[0,0]}
    for name,value in [('state',state),('scope',scope),('mapping',mapping)]:write_json(output/f'{name}.json',value)
    return export_component_handoff(output,output/'target.json',output/'binding.json',reference_original=output/'preview.png',
        reference_state=output/'state.json',acceptance_scope=output/'scope.json',reference_mapping=output/'mapping.json')


class SelectOptionIconsTests(unittest.TestCase):
    def state(self):
        return {'popupContentLayout':{'coordinateSpace':'target-popup-local','x':4,'y':4,'width':192,'height':64},
                'optionIcons':{'version':'1.0','coordinateSpace':'popup-row-local','items':[
                    {'optionId':ident,'icon':{'layerId':ident,'layout':{'x':2,'y':2,'width':28,'height':28}},
                     'labelLayout':{'x':36,'y':2,'width':150,'height':28}} for ident in ['b','a']]}}

    def test_valid_shuffled_explicit_null_and_legacy(self):
        state=self.state()
        self.assertEqual(len(validate_option_icons(state,['a','b'],{'a','b'},[200,72])),2)
        state['optionIcons']['items'][0]['icon']=None
        self.assertIsNone(validate_option_icons(state,['a','b'],{'a'},[200,72])[0]['icon'])
        self.assertIsNone(validate_option_icons({},['a','b']))

    def test_malformed_contracts_fail_explicitly(self):
        cases=[('version',lambda s:s['optionIcons'].update(version='2.0'),'VERSION'),
               ('missing',lambda s:s['optionIcons']['items'].pop(),'COVERAGE'),
               ('unknown',lambda s:s['optionIcons']['items'][0].update(optionId='c'),'COVERAGE'),
               ('duplicate',lambda s:s['optionIcons']['items'][0].update(optionId='a'),'COVERAGE'),
               ('layer',lambda s:s['optionIcons']['items'][0]['icon'].update(layerId='missing'),'UNKNOWN_LAYER'),
               ('empty',lambda s:s['optionIcons']['items'][0]['icon'].update(layerId=''),'REFERENCE_INVALID'),
               ('extra',lambda s:s['optionIcons'].update(guess=True),'INVALID'),
               ('safe',lambda s:s.pop('popupContentLayout'),'SAFE_AREA'),
               ('safe overflow',lambda s:s['popupContentLayout'].update(height=100),'LAYOUT'),
               ('row overflow',lambda s:s['optionIcons']['items'][0]['icon']['layout'].update(height=40),'LAYOUT'),
               ('NaN',lambda s:s['optionIcons']['items'][0]['labelLayout'].update(x=float('nan')),'LAYOUT'),
               ('bool',lambda s:s['optionIcons']['items'][0]['labelLayout'].update(x=True),'LAYOUT'),
               ('negative',lambda s:s['optionIcons']['items'][0]['icon']['layout'].update(x=-1),'LAYOUT'),
               ('overlap',lambda s:s['optionIcons']['items'][0]['labelLayout'].update(x=20),'OVERLAP')]
        for label,mutate,code in cases:
            with self.subTest(label=label):
                state=self.state();mutate(state)
                with self.assertRaisesRegex(ContractError,code):validate_option_icons(state,['a','b'],{'a','b'},[200,72])

    def test_contain_preserves_full_source_canvas(self):
        self.assertEqual(contain_rect({'x':6,'y':10,'width':28,'height':28},[20,32],[72,124]),[83.25,134,17.5,28])

    def test_export_validator_authenticates_icons_not_in_parts(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);layers=[]
            for ident,size in [('popup',[200,72]),('a',[20,32]),('b',[36,18])]:
                image=Image.new('RGBA',size);image.putpixel((2,2),(255,0,0,255));image.save(root/f'{ident}.png')
                layers.append({'id':ident,'size':size,'png':f'{ident}.png','sha256':sha256(root/f'{ident}.png')})
            write_json(root/'scene.json',{'tree':[{'children':layers}]})
            binding={'registration':{'transform':{'scale':1}},'bindings':[{'componentId':'region','componentType':'Select','parts':[{'role':'popup','layerId':'popup'}],'states':{'select':self.state()}}]}
            document={'root':{'id':'region','type':'Select','props':{'options':[{'id':'a'},{'id':'b'}]}}}
            _validate_state_text_colors(binding);_validate_bound_layers(root,binding,document)
            (root/'a.png').write_bytes((root/'b.png').read_bytes())
            with self.assertRaises(ContractError):_validate_bound_layers(root,binding,document)

    def test_schema_strict_extension(self):
        import jsonschema
        schema=json.loads((Path(__file__).resolve().parents[1]/'references/select-tabs-states.schema.json').read_text())
        state=self.state();state.update(labelLayout={'coordinateSpace':'target-component-local','x':0,'y':0,'width':20,'height':20},popupPlacement={'coordinateSpace':'target-component-local','anchor':'below-start','gap':0})
        jsonschema.validate({'select':state},schema)
        state.pop('popupContentLayout')
        with self.assertRaises(jsonschema.ValidationError):jsonschema.validate({'select':state},schema)
