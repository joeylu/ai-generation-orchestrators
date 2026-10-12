"""Content changes cannot inherit a pure validation result, even in one operation."""
import _bootstrap
import os
from contextlib import contextmanager
import hashlib
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from ai_ui_layers import validation_scope as reuse
from ai_ui_layers import execution_preflight, context_references
from ai_ui_layers.freeze_visual import freeze
import test_context_references as fixtures


class ValidationScopeTests(unittest.TestCase):
    def test_fingerprint_includes_nested_names_empty_directories_and_current_bytes(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary).resolve();(root/'nested/empty').mkdir(parents=True)
            (root/'nested/input').write_bytes(b'content');(root/'other').write_bytes(b'different')
            expected=[('nested','directory'),('nested/empty','directory'),
                      ('nested/input',hashlib.sha256(b'content').hexdigest()),
                      ('other',hashlib.sha256(b'different').hexdigest())]
            self.assertEqual(reuse._fingerprint(root),(str(root),tuple(sorted(expected))))

    def test_empty_directory_inventory_changes_invalidate_cached_result(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary);calls=[]
            @reuse.tree_result
            def validate(folder):
                calls.append(1)
                return sorted(p.relative_to(root).as_posix() for p in root.rglob('*'))
            with reuse.scope():
                self.assertEqual(validate(root),[])
                (root/'empty').mkdir();self.assertEqual(validate(root),['empty'])
                (root/'empty').rename(root/'renamed');self.assertEqual(validate(root),['renamed'])
                (root/'renamed').rmdir();self.assertEqual(validate(root),[])
            self.assertEqual(len(calls),3)

    def test_link_junction_and_special_entries_cannot_produce_cached_trust(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary);(root/'input').write_bytes(b'fixture')
            for kind in ('symlink','junction','special'):
                with self.subTest(kind=kind):
                    class Entry:
                        name='input';path=str(root/'input')
                        def is_symlink(self):return kind=='symlink'
                        def is_junction(self):return kind=='junction'
                        def is_file(self,**kwargs):return False
                        def is_dir(self,**kwargs):return False
                    @contextmanager
                    def scan(directory):yield iter([Entry()])
                    calls=[]
                    @reuse.tree_result
                    def validate(folder):calls.append(1);return True
                    with patch.object(reuse.os,'scandir',side_effect=scan),reuse.scope():
                        self.assertTrue(validate(root));self.assertTrue(validate(root))
                    self.assertEqual(len(calls),2)

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
