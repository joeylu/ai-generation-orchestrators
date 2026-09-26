import _bootstrap
import unittest
from ai_ui_layers.extract_sheets import review_entries


class OwnershipTests(unittest.TestCase):
    def test_overlaid_control_is_excluded_but_integrated_icon_is_owned(self):
        visual=dict(materials=[
            dict(id='row',label='row surface',role='foreground',bboxNorm=[.1,.2,.9,.4]),
            dict(id='toggle',label='on switch',role='foreground',bboxNorm=[.7,.25,.85,.35]),
            dict(id='elsewhere',label='unrelated button',role='foreground',bboxNorm=[.1,.7,.3,.8])],
            objects=[dict(id='surface',materialId='row',label='thin frame'),
                     dict(id='icon',materialId='row',label='music symbol'),
                     dict(id='state',materialId='toggle',label='green track and white knob')])
        entry=review_entries(visual,['row'])[0]
        self.assertEqual([o['id'] for o in entry['objects']],['surface','icon'])
        self.assertEqual(entry['excludedForeignArtwork'],[
            dict(material='on switch',referenceBox=[.7,.25,.85,.35],excludeArtwork=['green track and white knob'])])

    def test_ownership_is_scoped_per_cell_not_sheet_wide(self):
        visual=dict(materials=[
            dict(id='a',label='frame',role='foreground',bboxNorm=[0,0,1,1]),
            dict(id='b',label='symbol',role='foreground',bboxNorm=[.2,.2,.3,.3])],
            objects=[dict(materialId='a',label='frame'),dict(materialId='b',label='symbol')])
        a,b=review_entries(visual,['a','b'])
        self.assertEqual(a['excludedForeignArtwork'][0]['material'],'symbol')
        self.assertEqual(b['objects'][0]['label'],'symbol')
        self.assertEqual(b['excludedForeignArtwork'][0]['material'],'frame')
