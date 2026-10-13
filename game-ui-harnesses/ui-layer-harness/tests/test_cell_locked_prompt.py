"""Regression for six independent cards collapsing into one backing panel."""
import _bootstrap
from copy import deepcopy
import json
import unittest

from ai_ui_layers import cell_locked_prompt as locked, sheet_layout_reference as board
from ai_ui_layers import experimental_executor as exchange
from ai_ui_layers.evaluate import read, digest
from ai_ui_layers.execution_preflight import preflight
import test_context_references as fixtures


class CellLockedPromptTests(unittest.TestCase):
    setUp=fixtures.ContextReferencesTests.setUp
    bind=fixtures.ContextReferencesTests.bind
    frozen=fixtures.ContextReferencesTests.frozen

    def test_exclusions_are_intersected_with_own_crop_without_mutation(self):
        def obj(name, box):return dict(objectId=name,visualName=name,referenceBox=box)
        cell=dict(location=dict(boardCropBox=[.1,.2,.4,.5]),remove=[
            dict(relation='underlay',objects=[obj('parent',[-1,-2,2,3])]),
            dict(relation='same-depth',objects=[obj('neighbor',[.35,.3,.7,.6]),
                obj('other-slot',[.6,.2,.9,.5]),obj('touch-only',[.4,.2,.6,.5])]),
            dict(relation='overlay',objects=[obj('item',[.2,.3,.3,.4])])])
        before=deepcopy(cell)
        result=locked.local_actions(cell)
        self.assertEqual([o['objectId'] for o in result],['parent','neighbor','item'])
        self.assertEqual([o['visibleReferenceBox'] for o in result],
            [[.1,.2,.4,.5],[.35,.3,.4,.5],[.2,.3,.3,.4]])
        self.assertEqual(cell,before)

    def test_new_version_routes_board_and_preserves_old_snapshot_and_pixels(self):
        snapshot,manifest=self.frozen(version='v15')
        self.assertEqual(preflight(snapshot,manifest['digest'])['inputChecks'],'passed')
        before={p.relative_to(snapshot).as_posix():digest(p) for p in snapshot.rglob('*') if p.is_file()}
        row=next(r for r in read(snapshot/'requests.json')['requests'] if r.get('kind')=='sheet')
        old_meta,old_png,old_prompt=board.build(snapshot,row,prompt_version='v7')
        meta,png,prompt=board.build(snapshot,row,prompt_version='v8')
        self.assertEqual((meta,png),(old_meta,old_png))
        self.assertNotEqual(prompt,old_prompt)
        slots=json.loads(next(line[len('OUTPUT SLOTS: '):] for line in prompt.splitlines()
                             if line.startswith('OUTPUT SLOTS: ')))
        self.assertEqual([s['materialId'] for s in slots],row['materialIds'])
        self.assertEqual(len(slots),len(row['references']))
        for line in prompt.splitlines():
            if line.startswith('LOCATION: '):crop=json.loads(line[10:])['boardCropBox']
            for prefix in ('CLEAR OVERLAYS IN THIS SLOT ONLY: ', 'DISCARD SURROUNDING CONTEXT IN THIS SLOT ONLY: '):
                if line.startswith(prefix):
                    for action in json.loads(line[len(prefix):]):
                        x,y,r,b=action['visibleReferenceBox']
                        self.assertTrue(crop[0]<=x<r<=crop[2] and crop[1]<=y<b<=crop[3])
        job=self.root/'new-job';config=exchange.prepare(snapshot,manifest['digest'],job)
        self.assertEqual({d['promptVersion'] for d in config['contextBoardReferences'].values()},{'v8'})
        self.assertFalse((job/'authorization.json').exists())
        self.assertEqual(before,{p.relative_to(snapshot).as_posix():digest(p) for p in snapshot.rglob('*') if p.is_file()})

    def test_v14_still_selects_v7(self):
        snapshot,manifest=self.frozen(version='v14')
        config=exchange.prepare(snapshot,manifest['digest'],self.root/'historical-job')
        self.assertEqual({d['promptVersion'] for d in config['contextBoardReferences'].values()},{'v7'})


if __name__=='__main__':unittest.main()
