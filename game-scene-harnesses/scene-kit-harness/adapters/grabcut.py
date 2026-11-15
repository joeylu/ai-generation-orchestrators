"""Explicit offline CPU candidate producer. No network, models, GPU or retries."""
import argparse
import hashlib
import importlib.metadata
import io
import json
from pathlib import Path
import re
import sys


def require(value, code):
    if not value:
        raise ValueError(code)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode('utf-8')


def unseal(value):
    body = {k: v for k, v in value.items() if k != 'sha256'}
    require(value.get('sha256') == sha(canonical(body)), 'record_integrity')
    return body


def sealed(value):
    return {**value, 'sha256': sha(canonical(value))}


def read(path, limit=16 * 1024 * 1024):
    path = Path(path).absolute()
    require(not str(path).startswith('\\\\'), 'local_path_required')
    for p in [path, *path.parents]:
        require(not p.is_symlink() and not (getattr(p.stat(), 'st_file_attributes', 0) & 1024), 'linked_path_rejected')
    require(path.is_file() and path.stat().st_size <= limit, 'input_size_or_type')
    return path.read_bytes()


def relative(root, name):
    require(isinstance(name, str) and re.fullmatch(r'(?:[a-zA-Z0-9_-][a-zA-Z0-9_.-]*/)*[a-zA-Z0-9_-][a-zA-Z0-9_.-]*', name), 'portable_path_required')
    result = root / name
    require(result.absolute().is_relative_to(root.absolute()), 'path_escape')
    return result


def write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('xb') as output:
        output.write(data)


def write_json(path, value):
    write(path, canonical(value) + b'\n')


def runtime(config):
    require(set(config) == {'site', 'opencv', 'distribution', 'numpy', 'files'}, 'runtime_config_fields')
    site = Path(config['site']).absolute()
    require(isinstance(config['files'], list) and 1 <= len(config['files']) <= 10000, 'runtime_inventory')
    names = set()
    for item in config['files']:
        require(set(item) == {'path', 'sha256', 'byteLength'} and item['path'].lower() not in names, 'runtime_inventory')
        names.add(item['path'].lower())
        data = read(relative(site, item['path']), 512 * 1024 * 1024)
        require(len(data) == item['byteLength'] and sha(data) == item['sha256'], 'runtime_file_changed')
    require('cv2/cv2.pyd' in names or any(n.endswith('cv2.so') for n in names), 'runtime_binary_not_bound')
    require('cv2' not in sys.modules, 'runtime_ambiguous_import')
    import numpy as np
    sys.path.insert(0, str(site))
    try:
        import cv2
        distribution = importlib.metadata.distribution('opencv-python-headless')
        require(Path(cv2.__file__).resolve().is_relative_to(site.resolve())
                and Path(distribution.locate_file('')).resolve() == site.resolve(), 'runtime_import_origin')
        require(cv2.__version__ == config['opencv'] and distribution.version == config['distribution']
                and np.__version__ == config['numpy'], 'runtime_version_changed')
    finally:
        sys.path.remove(str(site))
    cv2.setNumThreads(1)
    cv2.ocl.setUseOpenCL(False)
    require(cv2.getNumThreads() == 1 and not cv2.ocl.useOpenCL(), 'cpu_profile_required')
    evidence = {'backend': 'opencv-grabcut-cpu', 'opencv': cv2.__version__, 'distribution': distribution.version,
                'numpy': np.__version__, 'threads': 1, 'openCL': False, 'installedFiles': len(config['files']),
                'installedInventorySha256': sha(canonical(config['files']))}
    return cv2, np, evidence


def run(input_root, config_path, out):
    from PIL import Image
    root, output = Path(input_root).absolute(), Path(out).absolute()
    source_root = Path(__file__).absolute().parents[1]
    require(not output.is_relative_to(root) and not output.is_relative_to(source_root), 'output_overlap')
    require(output.parent.is_dir() and not output.exists(), 'fresh_output_required')
    # Verify the parent through a regular input before creating anything below it.
    for p in [output.parent, *output.parent.parents]:
        require(not p.is_symlink() and not (getattr(p.stat(), 'st_file_attributes', 0) & 1024), 'linked_output_rejected')
    plan_bytes = read(root / 'seed-plan.json', 2 * 1024 * 1024)
    plan = json.loads(plan_bytes); unseal(plan)
    require(plan.get('format') == 'ai_scene_seeded_segmentation_plan_v1' and plan.get('generationCalls') == 0
            and plan.get('automaticRetry') is False and 1 <= len(plan['regions']) <= 24, 'seed_plan_invalid')
    algorithm = plan['algorithm']
    require(set(algorithm) == {'backend', 'iterations', 'rngSeed', 'threads', 'openCL', 'initialization', 'outsideRoi', 'otherForegroundSeeds', 'componentPolicy'}
            and algorithm['backend'] == 'opencv-grabcut-cpu' and algorithm['threads'] == 1 and algorithm['openCL'] is False
            and algorithm['initialization'] == 'explicit-mask-labels'
            and algorithm['outsideRoi'] == 'probable-background-not-hard-mask' and algorithm['otherForegroundSeeds'] == 'definite-background'
            and algorithm['componentPolicy'] == 'retain-components-touching-definite-foreground'
            and type(algorithm['iterations']) is int and 1 <= algorithm['iterations'] <= 8
            and type(algorithm['rngSeed']) is int and 0 <= algorithm['rngSeed'] <= 2147483647
            and plan.get('maximumCalls') == len(plan['regions']), 'cpu_profile_invalid')
    output.mkdir()
    masks, calls = [], 0
    try:
        cv2, np, evidence = runtime(json.loads(read(config_path, 4 * 1024 * 1024)))
        raw = read(relative(root, plan['source']['path']))
        require(len(raw) == plan['source']['byteLength'] and sha(raw) == plan['rawSha256'] == plan['source']['sha256'], 'raw_identity')
        image = Image.open(io.BytesIO(raw)); require(image.mode in ('RGB', 'RGBA'), 'source_png_mode')
        image = np.array(image.convert('RGBA'))
        width, height = plan['pixelSize']['width'], plan['pixelSize']['height']
        require(1 <= width <= 4096 and 1 <= height <= 4096 and image.shape == (height, width, 4)
                and np.all(image[..., 3] == 255), 'opaque_native_reference_required')
        names = set()
        # All inputs validate before the first CPU call.
        inputs = []
        for region in plan['regions']:
            identity = region['instanceId']
            require(isinstance(identity, str) and len(identity) <= 100 and re.fullmatch(r'[a-z0-9]+(?:[._-][a-z0-9]+)*', identity)
                    and identity not in names and region['path'] == f'seeds/{identity}.png', 'seed_identity')
            names.add(identity)
            data = read(relative(root, region['path']))
            require(sha(data) == region['sha256'] and len(data) == region['byteLength'], 'seed_identity')
            im = Image.open(io.BytesIO(data)); require(im.mode == 'RGBA', 'seed_mode')
            pixels = np.array(im)
            require(pixels.shape == (height, width, 4) and np.all(pixels[..., 3] == 255)
                    and np.array_equal(pixels[..., 0], pixels[..., 1]) and np.array_equal(pixels[..., 0], pixels[..., 2])
                    and np.isin(pixels[..., 0], [0, 85, 170, 255]).all(), 'seed_labels_invalid')
            labels = (pixels[..., 0] // 85).astype(np.uint8)
            require(np.count_nonzero(labels == 1) == region['foregroundPixels'] > 0
                    and np.count_nonzero(labels == 0) == region['backgroundPixels'] > 0, 'seed_counts_invalid')
            inputs.append(labels)
        write_json(output / 'started.json', sealed({'format': 'ai_scene_cpu_segmentation_started_v1',
                   'planSha256': plan['sha256'], 'maximumCalls': len(inputs), 'generationCalls': 0, 'automaticRetry': False}))
        for region, initial in zip(plan['regions'], inputs):
            labels = initial.copy()
            cv2.setRNGSeed(algorithm['rngSeed'])
            calls += 1
            cv2.grabCut(np.ascontiguousarray(image[..., :3]), labels, None,
                        np.zeros((1, 65), np.float64), np.zeros((1, 65), np.float64), algorithm['iterations'], cv2.GC_INIT_WITH_MASK)
            require(np.all(labels[initial == 0] == 0) and np.all(labels[initial == 1] == 1), 'definite_seeds_changed')
            binary = ((labels == 1) | (labels == 3)).astype(np.uint8)
            _, components = cv2.connectedComponents(binary, connectivity=8)
            roots = np.unique(components[initial == 1])
            require(np.all(roots > 0), 'foreground_component_lost')
            selected = np.isin(components, roots)
            require(np.all(selected[initial == 1]) and not np.any(selected[initial == 0]), 'filtered_seeds_changed')
            pixels = np.repeat((selected.astype(np.uint8) * 255)[..., None], 4, axis=2); pixels[..., 3] = 255
            stream = io.BytesIO(); Image.fromarray(pixels).save(stream, format='PNG'); data = stream.getvalue()
            path = f"masks/{region['instanceId']}.png"; write(relative(output, path), data)
            masks.append({'instanceId': region['instanceId'], 'path': path, 'sha256': sha(data), 'byteLength': len(data),
                          'selectedPixels': int(np.count_nonzero(selected))})
            print(json.dumps({'completed': region['instanceId'], 'selectedPixels': masks[-1]['selectedPixels'], 'generationCalls': 0}), flush=True)
        require(read(root / 'seed-plan.json', 2 * 1024 * 1024) == plan_bytes and read(relative(root, plan['source']['path'])) == raw, 'input_changed_during_cpu_run')
        result = sealed({'format': 'ai_scene_cpu_segmentation_result_v1', 'planSha256': plan['sha256'], 'rawSha256': plan['rawSha256'],
                         'status': 'cpu-candidates-unreviewed', 'runtime': evidence, 'implementationSha256': sha(read(Path(__file__))),
                         'calls': calls, 'masks': masks, 'generationCalls': 0})
        write_json(output / 'cpu-result.json', result)
        return result
    except Exception as error:
        code = str(error) if isinstance(error, ValueError) and re.fullmatch('[a-z0-9_]+', str(error)) else 'cpu_operation_failed'
        write_json(output / 'failure.json', sealed({'format': 'ai_scene_cpu_segmentation_failure_v1', 'planSha256': plan['sha256'],
                   'status': 'failed-no-automatic-retry', 'calls': calls, 'masks': masks, 'error': code, 'generationCalls': 0}))
        raise ValueError(code) from None


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', required=True); parser.add_argument('--runtime', required=True); parser.add_argument('--out', required=True)
    args = parser.parse_args()
    try:
        result = run(args.input, args.runtime, args.out)
        print(json.dumps({'status': result['status'], 'sha256': result['sha256'], 'calls': result['calls'], 'generationCalls': 0}))
    except Exception as error:
        print(json.dumps({'status': 'stopped-no-automatic-retry', 'error': str(error) if isinstance(error, ValueError) else 'cpu_operation_failed', 'generationCalls': 0}))
        sys.exit(1)
