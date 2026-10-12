"""Opt-in offline cost attribution; no runtime hooks, media or trust changes."""
import cProfile
from pathlib import Path
import pstats
import sys
import time
import zipfile

POLICY = 'offline-function-self-costs-v1'
CATEGORIES = ('png_encoding', 'image_decode', 'image_pixels', 'image_buffers',
              'file_open', 'file_read', 'file_write', 'file_other', 'filesystem',
              'hashing', 'crc', 'zip_compression', 'zip_decompression', 'zip_structure',
              'memory_io', 'other_codecs', 'other')


def _module(path):
    parts = str(path).replace('\\', '/').split('/')
    # Disambiguate package __init__.py without recording host paths.
    return '/'.join(parts[-2:]) if parts[-1] == '__init__.py' and len(parts)>1 else parts[-1]


def _category(path, name):
    module = _module(path)
    if path == '~':
        if '_hashlib.' in name or 'openssl_sha' in name:return 'hashing'
        if 'crc32' in name:return 'crc'
        if 'ImagingDecoder' in name:return 'image_decode'
        if 'ImagingEncoder' in name:return 'image_buffers'  # Split by caller below.
        if 'ImagingCore' in name or '_imaging.' in name:return 'image_pixels'
        if '_io.BytesIO' in name:return 'memory_io'
        if '_io.open' in name or name=='<built-in method io.open>':return 'file_open'
        if '_io.' in name:
            if any("'"+verb+"'" in name for verb in ('read','readinto','readline','readlines')):return 'file_read'
            if any("'"+verb+"'" in name for verb in ('write','writelines')):return 'file_write'
            return 'file_other'
        if 'zlib.' in name:return 'other_codecs'
        if any(prefix in name for prefix in ('nt.', 'posix.', 'os.')):return 'filesystem'
    if module in ('zipfile.py','zipfile/__init__.py'):return 'zip_structure'
    if module == 'PngImagePlugin.py':
        return 'png_encoding' if name in ('_save','_write_multiple_frames','putchunk','_crc32','_idat','write') else 'image_decode'
    if module == 'ImageFile.py':
        return 'png_encoding' if name in ('_save','_encode_tile') else 'image_decode'
    if module == 'Image.py':
        if name == 'save':return 'png_encoding'
        if name == 'tobytes':return 'image_buffers'
        if name in ('open','load','preinit','init','_open_core'):return 'image_decode'
        return 'image_pixels'
    return 'other'


def _parts(key, values):
    """Caller self times split shared native encoders without double counting."""
    path, _, name = key
    category = _category(path, name)
    _, calls, seconds, _, callers = values
    shared_encoder = path == '~' and 'ImagingEncoder' in name
    codec = path == '~' and ('zlib.Compress' in name or 'zlib.Decompress' in name)
    if not (shared_encoder or codec) or not callers:
        return [(category, seconds, calls)]
    parts=[];assigned=0.0;assigned_calls=0
    for (caller_path, _, caller_name), caller in callers.items():
        # cProfile caller tuples contain primitive calls, total calls, self, cumulative.
        count, own = caller[1], caller[2]
        selected=category
        if shared_encoder and _module(caller_path)=='ImageFile.py' and caller_name=='_encode_tile':
            selected='png_encoding'
        elif codec and _module(caller_path) in ('zipfile.py','zipfile/__init__.py'):
            selected='zip_decompression' if 'Decompress' in name else 'zip_compression'
        parts.append((selected, own, count));assigned+=own;assigned_calls+=count
    # Retain unclassified/native residual rather than inflate category totals.
    residual=max(0.0,seconds-assigned)
    if residual or calls>assigned_calls:parts.append((category,residual,max(0,calls-assigned_calls)))
    return parts


def summarize(stats, *, operation, wall, cpu, outcome):
    categories={name:dict(selfSeconds=0.0,functionCalls=0) for name in CATEGORIES}
    functions=[]
    for key, values in stats.items():
        for category, seconds, count in _parts(key, values):
            categories[category]['selfSeconds']+=seconds
            categories[category]['functionCalls']+=count
        path, _, name=key
        functions.append(dict(module=_module(path),function=name,calls=values[1],
                              selfSeconds=values[2],cumulativeSeconds=values[3]))
    functions.sort(key=lambda row:(-row['selfSeconds'],row['module'],row['function']))
    return dict(operation=operation,outcome=outcome,wallSeconds=wall,processCpuSeconds=cpu,
        profiledSelfSeconds=sum(v[2] for v in stats.values()),categories=categories,
        hottestSelfFunctions=functions[:20],
        hottestCumulativeFunctions=sorted(functions,key=lambda row:-row['cumulativeSeconds'])[:15])


class LocalProfile:
    def __init__(self, enabled=False):
        self.enabled=enabled
        self.operations=[]

    def call(self, operation, function, *args, **kwargs):
        if not self.enabled:return function(*args, **kwargs)
        if sys.getprofile() is not None:raise ValueError('LOCAL_PROFILE_ALREADY_ACTIVE')
        profiler=cProfile.Profile()
        wall=time.perf_counter();cpu=time.process_time();outcome='error'
        try:
            profiler.enable()
            result=function(*args, **kwargs)
            outcome='returned'
            return result
        finally:
            profiler.disable()
            elapsed=time.perf_counter()-wall;used_cpu=time.process_time()-cpu
            self.operations.append(summarize(pstats.Stats(profiler).stats,operation=operation,
                wall=elapsed,cpu=used_cpu,outcome=outcome))

    def report(self):
        return dict(kind='ui_layer_local_cost_profile_v1',policy=POLICY,operations=self.operations,
            scope='sequential offline replay operations; main-thread cProfile wall self time; process CPU may include other threads',
            categoryBasis='function self times partitioned once; native file encoder split from raw image buffers by caller; PNG-only replay',
            callCountBasis='profiled function invocations, not OS disk operations, bytes or provider calls',
            cpuBasis='process_time; wall minus CPU is not a measurement of disk waiting',
            limitations=['profiling overhead included; not an unprofiled latency benchmark',
                         'cumulative hotspots overlap; do not add them',
                         'native codec I/O may remain inside encoder time; no OS tracing'],
            generationCalls=0,modelCalls=0)


def archive_methods(root):
    """Observe new output metadata; never modify an archive or historical run."""
    counts={};archives=0
    for path in sorted(Path(root).rglob('*.zip')):
        with zipfile.ZipFile(path) as archive:
            archives+=1
            for row in archive.infolist():
                method=str(row.compress_type)
                counts[method]=counts.get(method,0)+1
    return dict(archiveCount=archives,memberCountsByMethod=counts,
                storedMethod=zipfile.ZIP_STORED,scope='new on-disk archives; embedded archive members not recursively opened')
