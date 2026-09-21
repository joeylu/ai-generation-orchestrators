import copy
from pathlib import Path
import tempfile
import unittest
from evaluate import read, save, digest
from local_patch import merge_patch

BASE = Path(__file__).resolve().parents[2]/'game-ui-harnesses/ui-decomposition-harness/planning-harness'


class LocalPatchTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.source = Path(self.tmp.name)/'source.json'
        self.plan = read(BASE/'examples/visual-plan.json')
        self.schema = read(BASE/'schemas/visual-plan.schema.json')
        save(self.source, self.plan)
        self.sha = digest(self.source)
        self.patch = {'sourcePlanSha256': self.sha, 'materials': {'upsert': [], 'remove': []},
                      'objects': {'upsert': [], 'remove': []}, 'unknowns': None, 'unresolvedIssues': []}

    def test_local_edit_preserves_other_records_and_source(self):
        row = copy.deepcopy(self.plan['objects'][2]);row['label'] = 'fixed crest'
        self.patch['objects']['upsert'] = [row]
        result, report = merge_patch(self.source, self.patch, self.schema, self.sha)
        self.assertEqual(result['materials'], self.plan['materials'])
        self.assertEqual(result['objects'][:2], self.plan['objects'][:2])
        self.assertEqual(result['objects'][3:], self.plan['objects'][3:])
        self.assertEqual(result['objects'][2]['label'], 'fixed crest')
        self.assertEqual(digest(self.source), self.sha)
        self.assertEqual(report['programIssues'], [])
        self.assertEqual(report['visualReviewStatus'], 'pending')

    def test_scope_patch_updates_only_requested_fields(self):
        self.plan.update(backgroundMode='scene-only',textPolicy='remove-business-text')
        for m in self.plan['materials']:m['preserveText']=[]
        self.source.write_text(__import__('json').dumps(self.plan))
        self.sha=digest(self.source);self.patch['sourcePlanSha256']=self.sha
        self.patch.update(backgroundMode='preserve-underlay',textPolicy=None)
        result,report=merge_patch(self.source,self.patch,self.schema,self.sha)
        self.assertEqual(result['backgroundMode'],'preserve-underlay')
        self.assertEqual(result['textPolicy'],'remove-business-text')
        self.assertEqual(result['materials'],self.plan['materials'])
        self.assertEqual(report['programIssues'],[])

    def test_stale_source_and_ambiguous_edits_rejected(self):
        with self.assertRaises(ValueError):
            merge_patch(self.source, self.patch, self.schema, 'wrong')
        self.patch['objects']['upsert'] = [self.plan['objects'][0]]*2
        with self.assertRaises(ValueError):
            merge_patch(self.source, self.patch, self.schema, self.sha)

    def test_deleted_material_does_not_hide_dangling_reference(self):
        self.patch['materials']['remove'] = ['asset-coin-a']
        _, report = merge_patch(self.source, self.patch, self.schema, self.sha)
        self.assertIn('MISSING_MATERIAL', [x['code'] for x in report['programIssues']])


if __name__ == '__main__': unittest.main()
