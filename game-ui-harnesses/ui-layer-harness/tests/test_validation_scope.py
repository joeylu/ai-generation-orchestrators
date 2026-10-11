"""Content changes cannot inherit a pure validation result, even in one operation."""
import _bootstrap
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from ai_ui_layers import validation_scope as reuse
from ai_ui_layers import execution_preflight, context_references
from ai_ui_layers.freeze_visual import freeze
import test_context_references as fixtures


class ValidationScopeTests(unittest.TestCase):
    def test_hashes_bytes_not_size_or_mtime_and_copies_results(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary);path=root/'input';path.write_text('first')
            calls=[]
            @reuse.tree_result
            def validate(folder):
                calls.append(1)
                return {'value':[path.read_text()]}
            with reuse.scope():
                first=validate(root);first['value'].append('caller mutation')
                self.assertEqual(validate(root),{'value':['first']})
                stamp=path.stat();path.write_text('other')
                os.utime(path,ns=(stamp.st_atime_ns,stamp.st_mtime_ns))
                self.assertEqual(validate(root),{'value':['other']})
                (root/'optional').write_text('added')
                validate(root)
                (root/'optional').unlink();validate(root)
            self.assertEqual(len(calls),3)
            validate(root)
            with reuse.scope():validate(root)
            self.assertEqual(len(calls),5)  # No trust persists across operations.

    def test_failure_and_mid_validation_change_never_become_cached_success(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary);path=root/'input';path.write_text('old')
            @reuse.tree_result
            def validate(folder):
                path.write_text('new')
                return True
            with reuse.scope():
                with self.assertRaisesRegex(ValueError,'INPUT_CHANGED'):validate(root)
                self.assertTrue(validate(root))

    def test_disabled_scope_and_nested_operations(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary);(root/'input').write_bytes(b'fixture');calls=[]
            @reuse.tree_result
            def validate(folder):calls.append(1);return True
            @reuse.operation
            def operation():validate(root);validate(root)
            operation();self.assertEqual(len(calls),1)
            operation();self.assertEqual(len(calls),2)
            with reuse.scope(reuse=False):operation()
            self.assertEqual(len(calls),4)


class FrozenValidationScopeTests(unittest.TestCase):
    bind=fixtures.ContextReferencesTests.bind

    def setUp(self):
        fixtures.ContextReferencesTests.setUp(self)
        self.snapshot=self.root/'context-snapshot'
        self.frozen=freeze(self.run,self.snapshot,5,generation_reference='context-crops')

    def test_real_preflight_reuses_checks_but_detects_added_optional_input(self):
        with patch.object(context_references,'verify',wraps=context_references.verify) as checked:
            with reuse.scope():
                first=execution_preflight.preflight(self.snapshot,self.frozen['digest'])
                second=execution_preflight.preflight(self.snapshot,self.frozen['digest'])
                self.assertEqual(first,second);self.assertEqual(checked.call_count,1)
                (self.snapshot/'surface-details.json').write_text('[1]')
                with self.assertRaisesRegex(ValueError,'RETIRED_DRAWING_PLAN'):
                    execution_preflight.preflight(self.snapshot,self.frozen['digest'])

    def test_real_snapshot_tamper_same_length_and_mtime_rejected(self):
        with reuse.scope():
            execution_preflight.preflight(self.snapshot,self.frozen['digest'])
            path=self.snapshot/'reference.png';original=path.read_bytes();stamp=path.stat()
            path.write_bytes(original[:-1]+bytes([original[-1]^1]))
            os.utime(path,ns=(stamp.st_atime_ns,stamp.st_mtime_ns))
            with self.assertRaisesRegex(ValueError,'ARTIFACT_CHANGED:reference.png'):
                execution_preflight.preflight(self.snapshot,self.frozen['digest'])


if __name__=='__main__':unittest.main()
