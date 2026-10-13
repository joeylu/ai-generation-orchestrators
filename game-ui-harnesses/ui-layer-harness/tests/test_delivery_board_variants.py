"""Complete diagnostic jobs bind tested canonical board choices without fake reuse."""
import _bootstrap
import unittest
from ai_ui_layers import experimental_executor as exchange,sheet_layout_reference as board
from ai_ui_layers.evaluate import read,digest
import test_context_references as fixtures

class DeliveryBoardVariantTests(unittest.TestCase):
    setUp=fixtures.ContextReferencesTests.setUp
    bind=fixtures.ContextReferencesTests.bind
    frozen=fixtures.ContextReferencesTests.frozen

    def test_complete_inventory_uses_selected_variant_and_new_authorization(self):
        snapshot,manifest=self.frozen(version='v16')
        before={str(p.relative_to(snapshot)):digest(p) for p in snapshot.rglob('*') if p.is_file()}
        rows=read(snapshot/'requests.json')['requests']
        sheet=next(r for r in rows if r.get('kind')=='sheet')
        choices={sheet['asset']:dict(promptVersion='v11',referencePolicy=None)}
        job=self.root/'full'
        config=exchange.prepare(snapshot,manifest['digest'],job,delivery_board_variants=choices)
        self.assertEqual(config['maximumCalls'],len(rows))
        self.assertEqual(set(config['assets']),{r['asset'] for r in rows})
        self.assertEqual(exchange.status(job)['assignedCalls'],0)
        self.assertEqual(exchange.status(job)['status'],'awaiting_authorization')
        _,index=exchange.load_job(job)
        _,png,prompt=board.build(snapshot,sheet,prompt_version='v11')
        self.assertEqual(exchange.frozen_request_arguments(job,config,index[sheet['asset']])['prompt'],prompt.rstrip('\n'))
        old=self.root/'old'
        old_config=exchange.prepare(snapshot,manifest['digest'],old)
        self.assertEqual(old_config['contextBoardReferences'][sheet['asset']]['promptVersion'],'v9')
        self.assertEqual(before,{str(p.relative_to(snapshot)):digest(p) for p in snapshot.rglob('*') if p.is_file()})

    def test_reject_subset_and_arbitrary_prompt_version_before_creating_job(self):
        snapshot,manifest=self.frozen(version='v16')
        row=next(r for r in read(snapshot/'requests.json')['requests'] if r.get('kind')=='sheet')
        choices={row['asset']:dict(promptVersion='v11',referencePolicy=None)}
        with self.assertRaisesRegex(ValueError,'COMPLETE_V16'):
            exchange.prepare(snapshot,manifest['digest'],self.root/'subset',assets=[row['asset']],delivery_board_variants=choices)
        choices[row['asset']]['promptVersion']='arbitrary'
        with self.assertRaisesRegex(ValueError,'CANONICAL_DELIVERY'):
            exchange.prepare(snapshot,manifest['digest'],self.root/'arbitrary',delivery_board_variants=choices)
        self.assertFalse((self.root/'subset').exists());self.assertFalse((self.root/'arbitrary').exists())

if __name__=='__main__':unittest.main()
