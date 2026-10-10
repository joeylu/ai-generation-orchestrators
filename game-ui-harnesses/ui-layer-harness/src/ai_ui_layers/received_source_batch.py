"""Operation-local receipt verification; never cache trust between operations."""
from contextlib import contextmanager
from pathlib import Path

from PIL import Image

from .evaluate import digest
from .experimental_executor import load_job, status, verified
from .freeze_visual import inspect


class ReceivedSources:
    def __init__(self, job):
        from .host_material_review import files
        self.job = Path(job).resolve()
        self.config, self.index = load_job(self.job)
        self.states = status(self.job)['requests']
        self.manifest = inspect(self.job/'snapshot', self.config['snapshotDigest'])
        self.file_hashes = files(self.job)

    def check_files(self, job, expected):
        if Path(job).resolve() != self.job or any(self.file_hashes.get(n) != sha for n, sha in expected.items()):
            raise ValueError('OUTPUT_SOURCE_BINDING_CHANGED')

    def source(self, job, request_id):
        if (Path(job).resolve() != self.job or request_id not in self.config['assets']
                or self.states.get(request_id) != 'raw_received'):
            raise ValueError('RECEIVED_REQUEST_REQUIRED')
        receipt = verified(self.job/'attempts'/request_id/'received.json')
        raw = self.job/'attempts'/request_id/'raw.png'
        if digest(raw) != receipt['rawSha256']:
            raise ValueError('RESULT_CHANGED')
        with Image.open(raw) as image:
            image.load()
            if (image.format != 'PNG' or image.getexif().get(274, 1) != 1
                    or list(image.size) != receipt['size']
                    or image.convert('RGBA').getchannel('A').getextrema()[1] == 0):
                raise ValueError('RECEIVED_PNG_MISMATCH')
        return self.config, self.index[request_id], receipt, raw

    def verify_unchanged(self):
        from .host_material_review import files
        if files(self.job) != self.file_hashes:
            raise ValueError('RECEIVED_BATCH_INPUT_CHANGED')


@contextmanager
def received_sources(job):
    sources = ReceivedSources(job)
    try:
        yield sources
    finally:
        sources.verify_unchanged()
