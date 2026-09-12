import copy
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from PIL import Image
from ai_ui_decomposition.switch_state_images import validate_state_images
from ai_ui_decomposition.component_handoff import _validate_state_text_colors, _validate_bound_layers
from ai_ui_decomposition.common import ContractError


def fixture():
    return {'componentId':'switch','componentType':'Switch','parts':[{'role':r,'layerId':r+'-off'} for r in ('track','thumb')], 'states':{'switch':{'stateImages':{'version':'1.0',**{s:{r+'LayerId':r+'-'+s for r in ('track','thumb')} for s in ('off','on')}}}}}


class SwitchImagesTests(unittest.TestCase):
    def test_valid_and_legacy_do_not_imply_equal_coverage(self):
        row=fixture();before=copy.deepcopy(row)
        sizes={r+'-'+s:[20,10] if r=='track' else [6,6] for r in ('track','thumb') for s in ('off','on')}
        self.assertEqual(validate_state_images(row,sizes),row['states']['switch']['stateImages'])
        _validate_state_text_colors({'bindings':[row]});self.assertEqual(row,before)
        del row['states']['switch']['stateImages'];self.assertIsNone(validate_state_images(row,sizes))

    def test_missing_version_reference_size_and_base_fail(self):
        for mutation,code in [('side','FIELDS'),('version','VERSION'),('field','PAIR'),('unknown','UNKNOWN_LAYER'),('size','SIZE_MISMATCH'),('base','BASE_PART_REQUIRED')]:
            row=fixture(); images=row['states']['switch']['stateImages']; sizes={r+'-'+s:[20,10] if r=='track' else [6,6] for r in ('track','thumb') for s in ('off','on')}
            if mutation=='side': del images['on']
            elif mutation=='version': images['version']='2.0'
            elif mutation=='field': del images['on']['thumbLayerId']
            elif mutation=='unknown': images['on']['trackLayerId']='../absent.png'
            elif mutation=='size': sizes['thumb-on']=[7,6]
            elif mutation=='base': row['parts']=[]
            with self.subTest(mutation=mutation), self.assertRaisesRegex(ContractError,code): validate_state_images(row,sizes)

    def test_native_export_checks_unlisted_state_layers_and_their_hashes(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp); layers=[]
            for r in ('track','thumb'):
                for s in ('off','on'):
                    key=r+'-'+s;size=(20,10) if r=='track' else (6,6); im=Image.new('RGBA',size,'blue' if s=='on' else 'gray');im.putpixel((0,0),(0,0,0,0));im.save(root/(key+'.png'))
                    layers.append({'id':key,'png':key+'.png','size':list(size),'sha256':hashlib.sha256((root/(key+'.png')).read_bytes()).hexdigest()})
            (root/'scene.json').write_text(json.dumps({'tree':[{'children':layers}]}),encoding='utf8')
            binding={'bindings':[fixture()]}; doc={'root':{'id':'switch','type':'Switch'}}
            _validate_bound_layers(root,binding,doc)
            Image.new('RGBA',(6,6),'red').save(root/'thumb-on.png')
            with self.assertRaisesRegex(ContractError,'LAYER_CHANGED'): _validate_bound_layers(root,binding,doc)
