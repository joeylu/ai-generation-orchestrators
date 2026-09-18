import tempfile,unittest
from pathlib import Path
from PIL import Image,ImageDraw
from ai_ui_decomposition.common import sha256,ContractError
from ai_ui_decomposition.material_refit import apply_refit
from unittest.mock import patch

class MaterialRefitTests(unittest.TestCase):
    def test_background_replacement_binds_reference_raw_processed_bytes_and_role(self):
        with tempfile.TemporaryDirectory() as t:
            run=Path(t);source=run/'old.png';raw=run/'raw.png';reference=run/'reference.png'
            replacement=run/'new.png'
            for path,color in [(source,'blue'),(raw,'red'),(replacement,'red'),(reference,'white')]:
                Image.new('RGBA',(12,12),color).save(path)
            frozen=dict(digest='batch',plan_digest='plan',source_sha256=sha256(reference))
            item=dict(role='background',output_mode='opaque_canvas',output_size=[12,12])
            spec=dict(version='1.0',operation='verified-background-replacement',sourceSha256=sha256(source),
                      evidence='Reviewed missing static note',runDirectory=str(run),assetId='bg',
                      batchDigest='batch',rawSha256=sha256(raw),materialSha256=sha256(replacement))
            materials=dict(batch_digest='batch',assets=[dict(asset='bg',path='new.png')])
            with patch('ai_ui_decomposition.cached.verified_result',return_value=(frozen,item,{},raw)), \
                 patch('ai_ui_decomposition.process.read_materials',return_value=materials):
                out,evidence=apply_refit(source,spec,{},reference=reference)
                self.assertEqual(out.tobytes(),Image.open(replacement).tobytes())
                self.assertEqual(evidence['sourcePlanDigest'],'plan')
                for change,code in [({'rawSha256':'wrong'},'SOURCE_CHANGED'),({'materialSha256':'wrong'},'MATERIAL_CHANGED')]:
                    with self.assertRaisesRegex(ContractError,code):
                        apply_refit(source,{**spec,**change},{},reference=reference)
                Image.new('RGBA',(12,12),'black').save(reference)
                with self.assertRaisesRegex(ContractError,'REFERENCE_CHANGED'):
                    apply_refit(source,spec,{},reference=reference)
                frozen['source_sha256']=sha256(reference);item['role']='important_component'
                with self.assertRaisesRegex(ContractError,'BACKGROUND_GEOMETRY'):
                    apply_refit(source,spec,{},reference=reference)

    def test_same_tab_binding_alias_is_verified_then_recomputed(self):
        from ai_ui_decomposition.common import write_json
        from ai_ui_decomposition.binding_aliases import materialize
        from ai_ui_decomposition.material_refit import prepare_refit
        with tempfile.TemporaryDirectory() as t:
            base=Path(t); compiled=base/'compiled'; compiled.mkdir()
            run=base/'run'; (run/'materials').mkdir(parents=True)
            source=run/'glyph.png'; Image.new('RGBA',(12,12),'red').save(source)
            catalog=dict(original='original.png',parts=[dict(layerId='glyph')])
            appearance=dict(bindings=[dict(componentType='Tabs',componentId='tabs',parts=[
                dict(layerId='glyph',tabId='one',role='icon'),
                dict(layerId='glyph',tabId='one',role='active-icon')])])
            _,_,_,aliases=materialize(catalog,appearance,{'glyph':source})
            alias=aliases[0]['layerId']; alias_path=run/(alias+'.png'); alias_path.write_bytes(source.read_bytes())
            rows=[dict(asset='glyph',path=source.name),dict(asset=alias,path=alias_path.name)]
            write_json(compiled/'material-catalog.json',catalog)
            write_json(compiled/'appearance-plan.json',appearance)
            write_json(compiled/'plan.json',{})
            write_json(run/'materials/materials.json',dict(assets=rows))
            Image.new('RGB',(12,12),'white').save(compiled/'original.png')
            with patch('ai_ui_decomposition.process.read_materials',return_value=dict(assets=rows)),patch('ai_ui_decomposition.delivery_adapter._materialized_handoff',return_value='built') as join:
                self.assertEqual(prepare_refit(compiled,run,{},base/'out',base),'built')
                self.assertEqual(set(join.call_args.args[1]),{'glyph'})
                Image.new('RGBA',(12,12),'blue').save(alias_path)
                with self.assertRaisesRegex(ContractError,'REFIT_ALIAS_CHANGED'):
                    prepare_refit(compiled,run,{},base/'bad',base)

    def test_overlay_only_changes_explicit_owned_static_regions(self):
        with tempfile.TemporaryDirectory() as t:
            source,reference=Path(t)/'old.png',Path(t)/'reference.png'
            old=Image.new('RGBA',(12,12));ImageDraw.Draw(old).rectangle((1,1,10,10),fill='white');old.save(source)
            Image.new('RGB',(20,20),'gray').save(reference)
            region=dict(sourceRect=[2,4,8,1],targetRect=[2,6,8,1])
            spec=dict(version='1.0',operation='reference-regions-overlay',sourceSha256=sha256(source),referenceSha256=sha256(reference),regions=[region],staticContentOnly=True,evidence='Observed empty divider owned by Panel.')
            out,_=apply_refit(source,spec,{},reference=reference)
            for y in range(12):
                for x in range(12):
                    self.assertEqual(out.getpixel((x,y)),(128,128,128,255) if y==6 and 2<=x<10 else old.getpixel((x,y)))
            with self.assertRaisesRegex(ContractError,'OVERLAY_OVERLAP'):apply_refit(source,{**spec,'regions':[region,region]},{},reference=reference)

    def test_refit_rederives_aliases_instead_of_reusing_stale_targets(self):
        from ai_ui_decomposition.common import write_json
        from ai_ui_decomposition.material_refit import prepare_refit
        with tempfile.TemporaryDirectory() as t:
            base=Path(t);compiled=base/'compiled';compiled.mkdir();run=base/'run';(run/'materials').mkdir(parents=True)
            rows=[]
            for key in ('canonical','alias','derived'):
                p=run/(key+'.png');Image.new('RGBA',(12,12),'red').save(p);rows.append(dict(asset=key,path=p.name))
            Image.new('RGB',(20,20),'white').save(compiled/'original.png')
            write_json(compiled/'material-catalog.json',dict(original='original.png',parts=[dict(layerId='canonical'),dict(layerId='alias',sharedSource=dict(sourceLayerId='canonical')),dict(layerId='derived',derivedGlyph=dict(canonicalLayerId='canonical'))]))
            write_json(compiled/'plan.json',{});write_json(run/'materials/materials.json',dict(assets=rows))
            with patch('ai_ui_decomposition.process.read_materials',return_value=dict(assets=rows)),patch('ai_ui_decomposition.delivery_adapter._materialized_handoff',return_value='built') as join:
                self.assertEqual(prepare_refit(compiled,run,{},base/'out',base),'built')
                self.assertEqual(set(join.call_args.args[1]),{'canonical'})
                for key in ('alias','derived'):
                    with self.assertRaisesRegex(ContractError,'DERIVED_OR_SHARED_TARGET'):prepare_refit(compiled,run,{key:{}},base/('bad-'+key),base)

    def test_static_reference_interior_is_exact_and_does_not_infer_alpha(self):
        with tempfile.TemporaryDirectory() as t:
            source,reference=Path(t)/'old.png',Path(t)/'reference.png'
            Image.new('RGBA',(12,12),'blue').save(source)
            original=Image.new('RGB',(30,30),'gray');ImageDraw.Draw(original).rectangle((8,8,15,15),fill='orange');original.save(reference)
            spec=dict(version='1.0',operation='reference-region-copy',sourceSha256=sha256(source),referenceSha256=sha256(reference),sourceRect=[8,8,8,8],targetRect=[2,2,8,8],staticContentOnly=True,evidence='Reviewed fully visible static tile interior, no runtime control state or text.')
            out,proof=apply_refit(source,spec,{},reference=reference)
            self.assertEqual(out.crop((2,2,10,10)).tobytes(),original.convert('RGBA').crop((8,8,16,16)).tobytes())
            self.assertEqual(out.getpixel((0,0)),(0,0,0,0));self.assertFalse(proof['alphaRecovery'])
            for change,code in [({'referenceSha256':'0'*64},'REFERENCE_CHANGED'),({'sourceRect':[29,29,8,8]},'COPY_RECT'),({'targetRect':[2,2,7,8]},'RESAMPLE_FORBIDDEN'),({'staticContentOnly':False},'STATIC_CONTENT_REQUIRED')]:
                with self.subTest(change=change),self.assertRaisesRegex(ContractError,code):apply_refit(source,{**spec,**change},{},reference=reference)

    def test_visible_content_uses_uniform_contain_and_bound_source(self):
        with tempfile.TemporaryDirectory() as t:
            source=Path(t)/'icon.png';im=Image.new('RGBA',(30,30));ImageDraw.Draw(im).rectangle((10,5,19,24),fill='gold');im.save(source)
            spec=dict(version='1.0',operation='visible-content-contain',sourceSha256=sha256(source),alphaBounds=[10,5,20,25],padding=1,evidence='Measured static symbol support.')
            out,proof=apply_refit(source,spec,{})
            box=out.getchannel('A').getbbox();self.assertEqual(box[3]-box[1],28)
            self.assertLessEqual(abs((box[2]-box[0])/(box[3]-box[1])-.5),.08)
            self.assertTrue(proof['preserveAspectRatio'])
            with self.assertRaisesRegex(ContractError,'ALPHA_BOUNDS_CHANGED'):apply_refit(source,{**spec,'alphaBounds':[0,0,30,30]}, {})

    def test_frame_fills_visible_width_without_stretching_corner(self):
        with tempfile.TemporaryDirectory() as t:
            p=Path(t)/'frame.png';im=Image.new('RGBA',(100,40));ImageDraw.Draw(im).rectangle((25,2,74,37),fill='white',outline='red',width=3);im.save(p)
            spec=dict(version='1.0',operation='visible-frame-nine-slice',sourceSha256=sha256(p),evidence='Measured empty frame',alphaBounds=[25,2,75,38],insets=[5]*4,padding=2)
            out,_=apply_refit(p,spec,{})
            self.assertEqual(out.getchannel('A').getbbox(),(2,2,98,38));self.assertEqual(out.getpixel((3,3)),im.getpixel((26,3)))
            spec['sourceSha256']='0'*64
            with self.assertRaisesRegex(ContractError,'SOURCE_CHANGED'):apply_refit(p,spec,{})

    def test_canonical_alpha_palette_evidence_and_invalid_patch(self):
        with tempfile.TemporaryDirectory() as t:
            c,p=Path(t)/'c.png',Path(t)/'p.png'
            a=Image.new('RGBA',(30,30));ImageDraw.Draw(a).ellipse((2,2,27,27),fill='#173A3E');a.save(c)
            b=Image.new('RGBA',(30,30));ImageDraw.Draw(b).rectangle((2,2,27,27),fill='#FCF2D6');b.save(p)
            spec=dict(version='1.0',operation='monochrome-state-from-canonical',sourceSha256=sha256(p),evidence='Explicit palette and glyph',canonicalLayerId='c',canonicalSha256=sha256(c),paletteLayerId='p',paletteSha256=sha256(p),paletteRect=[12,12,3,3])
            out,proof=apply_refit(p,spec,dict(c=c,p=p))
            self.assertEqual(out.getchannel('A').tobytes(),a.getchannel('A').tobytes());self.assertEqual(proof['paletteRgb'],[252,242,214]);self.assertNotEqual(out.tobytes(),a.tobytes())
            spec['paletteRect']=[0,0,3,3]
            with self.assertRaisesRegex(ContractError,'NOT_SOLID'):apply_refit(p,spec,dict(c=c,p=p))
            spec['paletteRect']=[12,12,3,3];spec['canonicalSha256']='0'*64
            with self.assertRaisesRegex(ContractError,'REFERENCE_CHANGED'):apply_refit(p,spec,dict(c=c,p=p))
