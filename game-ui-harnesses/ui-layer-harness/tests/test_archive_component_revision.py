import _bootstrap
from copy import deepcopy
import hashlib
import tempfile
from pathlib import Path
import unittest

from PIL import Image
from ai_ui_layers.evaluate import read,save,digest
from ai_ui_layers.layer_package import write_package,validate_archive
from ai_ui_layers import archive_component_exchange as exchange
from ai_ui_layers import archive_component_revision as revision
from ai_ui_layers import viewport_geometry_revision as viewport


class ComponentRevisionTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup);self.root=Path(self.temp.name)
        self.reference=self.root/'reference.png';Image.new('RGBA',(32,32),(20,40,60,255)).save(self.reference)
        self.viewer=self.root/'viewer';self.viewer.mkdir()
        (self.viewer/'viewer.html').write_text('<html></html>');(self.viewer/'viewer.js').write_text('void 0;')
        parent=self.root/'parent.png';image=Image.new('RGBA',(16,16));image.paste((45,60,80,128),(2,2,14,14));image.save(parent)
        keep=self.root/'keep.png';Image.new('RGBA',(4,4),(20,40,80,255)).save(keep)
        self.composition=dict(kind='ui_layer_composition_v1',canvas=dict(width=32,height=32),
            coordinates='top-left-pixels',order='array-back-to-front',textPolicy='remove-business-text',
            backgroundMode='scene-only',reference='reference.png',preview='preview.png',layers=[
                dict(id='panel',name='Panel',role='foreground',path='layers/layer-001.png',x=4,y=6,width=16,height=16,visible=True),
                dict(id='keep',name='Keep',role='foreground',path='layers/layer-002.png',x=24,y=24,width=4,height=4,visible=True)])
        self.sources=dict(panel=dict(path=str(parent),sha256=digest(parent)),keep=dict(path=str(keep),sha256=digest(keep)))
        write_package(self.reference,self.composition,self.sources,self.root/'source',self.viewer,['Inherited fixture finding'])
        self.archive=self.root/'source/ui-layers.zip'

    def component(self,cid,parent='panel',target=None,issues=None):
        job=self.root/('job-'+cid);frozen=exchange.freeze(self.archive,parent,cid,job,name=cid,
            purpose='Fixture independent owned component',owned=['owned visible fixture surface'],
            delete=['all complete foreign child frames'],reference_region=[0,0,32,32])
        exchange.authorize(job,frozen['digest'],'Fixture user explicitly authorizes one native component.')
        submission=exchange.next_request(job);raw=self.root/(cid+'-returned.png')
        image=Image.new('RGBA',(16,16));image.paste((60,90,120,255),(4,4,12,12));image.putpixel((0,0),(20,40,60,1));image.save(raw)
        evidence=self.root/(cid+'-native.json');request=read(job/'request.json')
        save(evidence,dict(kind='ui_native_component_return_v1',submissionDigest=submission['submissionDigest'],
            parentLayerId=parent,componentId=cid,referenceSha256=request['referenceSha256'],returnedSha256=digest(raw),
            hostObservedNativeReturn=True,notCryptographicallyProviderVerified=True))
        exchange.receive(job,submission['submissionDigest'],raw,evidence)
        item=self.root/('observation-'+cid);exchange.prepare_observation(job,item);r=read(item/'request.json')
        response=self.root/(cid+'-response.json');save(response,dict(kind='ui_host_geometry_answer_v1',layerId=cid,
            boundaryStatus='complete',sourceBodyBox=[4,4,12,12],targetBodyBox=target or [0,4,8,12],
            landmarkPairs=[],geometryIssues=issues or [],materialIssues=['Fixture material finding retained.'],
            evidence='Actual visible corresponding corners in offline test fixture.'))
        dispatch=self.root/(cid+'-dispatch.bin');dispatch.write_bytes(b'fixture dispatch '+cid.encode())
        returned=self.root/(cid+'-return.bin');returned.write_bytes(b'fixture return '+cid.encode())
        att=self.root/(cid+'-attestation.json');save(att,dict(kind='ui_host_geometry_attestation_v1',
            requestSha256=digest(item/'request.json'),responseSha256=digest(response),inputsSha256=r['inputsSha256'],
            reviewerId='fixture-reviewer',materialAuthors=['fixture-author'],hostAssertedModelResponse=True,
            notProviderReceipt=True,notCryptographicallyPlatformVerified=True,
            dispatchEvidenceSha256=digest(dispatch),returnEvidenceSha256=digest(returned)))
        exchange.receive_observation(item,response,host_attestation_path=att,dispatch_evidence_path=dispatch,return_evidence_path=returned)
        return dict(componentId=cid,observationDirectory=str(item),requestSha256=digest(item/'request.json'),
                    responseSha256=digest(item/'answer/response.json'))

    def selection(self,children,mode='replace-parent',parent='panel',name='selection'):
        loaded=exchange.load_archive(self.archive);layer=next(l for l in loaded['composition']['layers'] if l['id']==parent)
        path=self.root/(name+'.json');save(path,dict(kind=revision.KIND,sourceArchive=str(self.archive),
            sourceArchiveSha256=digest(self.archive),fitPolicy=dict(maximumResidualPixels=32),operations=[
                dict(mode=mode,parentLayerId=parent,parentSha256=hashlib.sha256(loaded['files'][layer['path']]).hexdigest(),children=children)]))
        return path

    def export(self,selection,name='out'):
        frozen=self.root/(name+'-frozen');config=revision.freeze(selection,frozen,
            'Fixture actual user approves structural edits and expanded-support-original-viewport-v1.')
        result=revision.revise(frozen,config['digest'],self.root/name,self.viewer)
        return result,config

    def test_replace_parent_once_with_independent_children_and_full_faint_alpha(self):
        children=[self.component('icon'),self.component('meter',target=[12,16,20,24])]
        result,_=self.export(self.selection(children));delivery=self.root/'out/delivery';composition=read(delivery/'package/composition.json')
        self.assertEqual([l['id'] for l in composition['layers']],['icon','meter','keep'])
        self.assertEqual(result['operations'][0]['removedParentIds'],['panel'])
        self.assertEqual(result['operations'][0]['status'],'applied')
        icon=composition['layers'][0]
        with Image.open(delivery/'package'/icon['path']) as image:self.assertEqual(image.getpixel((0,0))[3],1)
        self.assertEqual(result['viewport']['worldShift'],[4,0])
        self.assertEqual(digest(delivery/'original-reference.png'),digest(self.reference))
        self.assertEqual(digest(delivery/'package/layers/layer-003.png'),self.sources['keep']['sha256'])
        self.assertEqual(composition['layers'][2]['x']-4,24)
        self.assertFalse(result['strictBodyRegistrationPassed']);self.assertFalse(result['humanVisualAcceptance'])
        self.assertEqual(result['operations'][0]['children'][0]['assessment']['materialIssues'],['Fixture material finding retained.'])
        wrapper=viewport.validate_viewport_archive(delivery/'viewport-ui-layers.zip')
        self.assertEqual(wrapper['innerPackageSha256'],validate_archive(delivery/'ui-layers.zip')['sha256'])

    def test_append_retains_parent_native_bytes_and_order(self):
        child=self.component('wordmark');result,_=self.export(self.selection([child],mode='append-children'))
        comp=read(self.root/'out/delivery/package/composition.json')
        self.assertEqual([l['id'] for l in comp['layers']],['panel','wordmark','keep'])
        self.assertEqual(digest(self.root/'out/delivery/package/layers/layer-001.png'),self.sources['panel']['sha256'])
        self.assertEqual(comp['layers'][0]['x']-result['viewport']['worldShift'][0],4)
        self.assertEqual(result['operations'][0]['removedParentIds'],[])

    def test_one_unusable_child_and_all_unusable_leave_atomic_old_group(self):
        usable=self.component('icon');bad=self.component('meter',issues=['Fixture boundary ambiguous.'])
        result,_=self.export(self.selection([usable,bad]),name='partial')
        self.assertEqual([l['id'] for l in read(self.root/'partial/delivery/package/composition.json')['layers']],['panel','keep'])
        self.assertEqual(result['operations'][0]['addedComponentIds'],[])
        self.assertEqual(result['operations'][0]['failedChildren'],['meter'])
        all_bad=self.component('bad2',issues=['Fixture ambiguity.'])
        result,_=self.export(self.selection([bad,all_bad],name='all-bad-selection'),name='all-bad')
        self.assertEqual(result['operations'][0]['failedChildren'],['meter','bad2'])

    def test_missing_child_is_frozen_absent_and_cannot_be_added_later(self):
        good=self.component('icon');missing=dict(componentId='missing',observationDirectory=str(self.root/'missing-observation'),
                                               requestSha256='0'*64,responseSha256='0'*64)
        selection=self.selection([good,missing]);result,config=self.export(selection)
        self.assertEqual(result['operations'][0]['addedComponentIds'],[])
        self.assertEqual(result['operations'][0]['failedChildren'],['missing'])
        (self.root/'missing-observation').mkdir()
        with self.assertRaisesRegex(ValueError,'MISSING_COMPONENT_EVIDENCE_APPEARED'):
            revision.revise(self.root/'out-frozen',config['digest'],self.root/'later',self.viewer)

    def test_scope_parent_sha_and_collision_rejected(self):
        child=self.component('icon',parent='keep');selection=self.selection([child])
        with self.assertRaisesRegex(ValueError,'SCOPE_MISMATCH'):revision.freeze(selection,self.root/'bad','Fixture approval')
        spec=read(selection);spec['operations'][0]['parentSha256']='0'*64
        changed=self.root/'bad-sha.json';save(changed,spec)
        with self.assertRaisesRegex(ValueError,'PARENT_SHA_CHANGED'):revision.freeze(changed,self.root/'bad','Fixture approval')
        spec['operations'][0]['children'][0]['componentId']='keep';changed2=self.root/'bad-id.json';save(changed2,spec)
        with self.assertRaisesRegex(ValueError,'UNIQUE_COMPONENT_IDS'):revision.freeze(changed2,self.root/'bad','Fixture approval')
        spec=read(selection);spec['operations'].append(deepcopy(spec['operations'][0]));changed3=self.root/'duplicate.json';save(changed3,spec)
        with self.assertRaisesRegex(ValueError,'UNIQUE_OPERATION_PARENTS'):revision.freeze(changed3,self.root/'bad','Fixture approval')

    def wrapper_source(self):
        composition=deepcopy(self.composition);composition['canvas']['width']=40
        for layer in composition['layers']:layer['x']+=8
        reference=self.root/'world-reference.png';image=Image.new('RGBA',(40,32))
        with Image.open(self.reference) as original:image.paste(original,(8,0))
        image.save(reference);write_package(reference,composition,self.sources,self.root/'wrapped',self.viewer,[])
        delivery=self.root/'wrapped';(delivery/'original-reference.png').write_bytes(self.reference.read_bytes())
        with Image.open(delivery/'package/preview.png') as preview:preview.crop([8,0,40,32]).save(delivery/'viewport-preview.png')
        save(delivery/'viewport.json',dict(kind='ui_original_viewport_v1',policy=viewport.POLICY,
            worldBoundsInOriginalCoordinates=[-8,0,32,32],worldShift=[8,0],originalSize=[32,32],worldSize=[40,32],
            worldViewportBox=[8,0,40,32],originalReferenceSha256=digest(self.reference),worldReferenceSha256=digest(reference),
            displayPolicy='fixture exact original viewport'))
        viewport._wrapper(delivery);return delivery/'viewport-ui-layers.zip'

    def test_wrapper_rebases_unchanged_layers_to_original_coordinates(self):
        self.archive=self.wrapper_source();child=self.component('icon');result,_=self.export(self.selection([child],mode='append-children'))
        composition=read(self.root/'out/delivery/package/composition.json');shift=result['viewport']['worldShift']
        self.assertEqual(composition['layers'][0]['x']-shift[0],4)
        self.assertEqual(composition['layers'][2]['x']-shift[0],24)
        self.assertEqual(digest(self.root/'out/delivery/original-reference.png'),digest(self.reference))

    def test_cross_wrapper_scope_cannot_reuse_old_archive_observation(self):
        child=self.component('icon');self.archive=self.wrapper_source();selection=self.selection([child])
        with self.assertRaisesRegex(ValueError,'SCOPE_MISMATCH'):revision.freeze(selection,self.root/'bad','Fixture approval')

    def test_frozen_proposal_recomputed_and_evidence_tamper_rejected(self):
        child=self.component('icon');selection=self.selection([child]);result,config=self.export(selection)
        repeated=revision.revise(self.root/'out-frozen',config['digest'],self.root/'replayed',self.viewer)
        self.assertEqual(result['proposalDigest'],repeated['proposalDigest'])
        self.assertEqual(result['viewportArchiveSha256'],repeated['viewportArchiveSha256'])
        native=self.root/'job-icon/native-evidence.json';native.write_bytes(native.read_bytes()+b' ')
        with self.assertRaisesRegex(ValueError,'EVIDENCE_TREE_CHANGED'):
            revision.revise(self.root/'out-frozen',config['digest'],self.root/'bad',self.viewer)

    def test_request_response_reference_sha_and_empty_policy_rejected(self):
        child=self.component('icon');selection=self.selection([dict(child,responseSha256='0'*64)])
        with self.assertRaisesRegex(ValueError,'OBSERVATION_SHA_CHANGED'):revision.freeze(selection,self.root/'bad','Fixture approval')
        with self.assertRaisesRegex(ValueError,'POLICY_INSTRUCTION_REQUIRED'):revision.freeze(selection,self.root/'bad','')
        path=self.root/'observation-icon/reference.png';path.write_bytes(path.read_bytes()+b' ')
        valid=self.selection([child],name='valid')
        with self.assertRaises(ValueError):revision.freeze(valid,self.root/'bad','Fixture approval')


    def test_background_update_replays_native_region_and_keeps_original_canvas(self):
        from ai_ui_layers import archive_background_exchange as background
        raw_source=self.root/'background-source.png';Image.new('RGBA',(32,32),(20,40,60,255)).save(raw_source)
        comp=deepcopy(self.composition);comp['layers'].insert(0,dict(id='scene',name='Scene',role='background',
            path='layers/layer-001.png',x=0,y=0,width=32,height=32,visible=True))
        for index,layer in enumerate(comp['layers']):layer['path']=f'layers/layer-{index+1:03}.png'
        sources=dict(self.sources,scene=dict(path=str(raw_source),sha256=digest(raw_source)))
        write_package(self.reference,comp,sources,self.root/'background-source',self.viewer,[])
        self.archive=self.root/'background-source/ui-layers.zip'
        job=self.root/'background-job';frozen=background.freeze(self.archive,'scene',job,purpose='Fixture visible position correction',
            edit_region=[8,8,16,16],owned=['authentic scene'],delete=['misplaced fixture region content'])
        background.authorize(job,frozen['digest'],'Fixture actual user authorizes native background edit')
        submission=background.next_request(job)
        returned=self.root/'background-return.png';Image.new('RGBA',(32,32),(100,120,140,255)).save(returned)
        request=background.verify_frozen(job);evidence=self.root/'background-evidence.json'
        save(evidence,dict(kind='ui_native_background_edit_return_v1',submissionDigest=submission['submissionDigest'],
            layerId='scene',sourceSha256=request['sourceSha256'],referenceSha256=request['referenceSha256'],
            returnedSha256=digest(returned),hostObservedNativeReturn=True,notCryptographicallyProviderVerified=True))
        background.receive(job,submission['submissionDigest'],returned,evidence)
        child=self.component('icon');selection=self.selection([child])
        spec=read(selection);spec['backgroundUpdates']=[dict(layerId='scene',jobDirectory=str(job),receiptSha256=digest(job/'received.json'))]
        selection.unlink();save(selection,spec)
        result,config=self.export(selection);comp=read(self.root/'out/delivery/package/composition.json')
        scene=comp['layers'][0];shift=result['viewport']['worldShift']
        self.assertEqual([scene['x']-shift[0],scene['y']-shift[1],scene['width'],scene['height']],[0,0,32,32])
        with Image.open(self.root/'out/delivery/package'/scene['path']) as image:
            self.assertEqual(image.getpixel((0,0)),(20,40,60,255));self.assertEqual(image.getpixel((8,8)),(100,120,140,255))
        self.assertFalse(result['backgroundUpdates'][0]['bodyFitPerformed'])
        self.assertTrue(result['backgroundUpdates'][0]['canvasIdentityDoesNotProveInternalObjects'])
        path=job/'native-evidence.json';path.write_bytes(path.read_bytes()+b' ')
        with self.assertRaisesRegex(ValueError,'EVIDENCE_TREE_CHANGED'):
            revision.revise(self.root/'out-frozen',config['digest'],self.root/'bad',self.viewer)


if __name__=='__main__':unittest.main()
