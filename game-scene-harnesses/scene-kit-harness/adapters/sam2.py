"""Explicit offline CPU single-frame point/box candidates; no downloads, GPU or retries."""
import argparse
import contextlib
import importlib.metadata
import importlib.util
import io
import json
import os
from pathlib import Path
import re
import socket
import sys

spec = importlib.util.spec_from_file_location('scene_sam2_shared', Path(__file__).with_name('grabcut.py'))
shared = importlib.util.module_from_spec(spec); spec.loader.exec_module(shared)
require, sha, canonical, unseal, sealed = shared.require, shared.sha, shared.canonical, shared.unseal, shared.sealed
read, relative, write, write_json = shared.read, shared.relative, shared.write, shared.write_json


def installed_relative(site, name):
    # Installed wheel metadata may contain PEP 440 local versions such as +cpu.
    require(isinstance(name, str) and all(re.fullmatch(r'[a-zA-Z0-9_+-][a-zA-Z0-9_.+-]*', part)
            for part in name.split('/')), 'sam2_installed_relative_path')
    result = site / name
    require(result.absolute().is_relative_to(site.absolute()), 'sam2_installed_path_escape')
    return result


def validate_plan(plan):
    unseal(plan)
    require(set(plan) == {'format', 'specSha256', 'targetSha256', 'rawSha256', 'source', 'pixelSize', 'modelFiles',
            'modelFilesSha256', 'runtimeSha256', 'producerSha256', 'regions', 'algorithm', 'maximumModelLoads',
            'maximumCalls', 'networkRequests', 'automaticRetry', 'generationCalls', 'sha256'}, 'sam2_plan_fields')
    require(plan['format'] == 'ai_scene_prompt_segmentation_plan_v1' and plan['maximumModelLoads'] == 1
            and plan['maximumCalls'] == len(plan['regions']) and 1 <= len(plan['regions']) <= 24
            and plan['automaticRetry'] is False and plan['networkRequests'] == plan['generationCalls'] == 0
            and plan['algorithm'] == {'profile': 'point-box-cpu-v1', 'device': 'cpu', 'dtype': 'float32', 'threads': 1, 'threshold': 0,
                'boxPolicy': 'prompt-only-not-hard-crop', 'promptMismatchPolicy': 'report-without-mask-repair',
                'maskPostprocessing': 'native-size-threshold-only', 'overlapPolicy': 'unique-or-unknown'}, 'sam2_plan_profile')
    require(all(isinstance(plan[k], str) and re.fullmatch('[a-f0-9]{64}', plan[k]) for k in
            ['specSha256', 'targetSha256', 'rawSha256', 'modelFilesSha256', 'runtimeSha256', 'producerSha256']), 'sam2_plan_digests')
    require(sha(canonical(plan['modelFiles'])) == plan['modelFilesSha256'] and plan['source']['path'] == 'reference-native.png'
            and plan['source']['sha256'] == plan['rawSha256'], 'sam2_model_source_binding')
    size = plan['pixelSize']; require(set(size) == {'width', 'height'} and all(type(n) is int and 1 <= n <= 4096 for n in size.values()), 'sam2_frame')
    names, positive_owners = set(), set()
    for r in plan['regions']:
        require(set(r) == {'instanceId', 'box', 'points'} and isinstance(r['instanceId'], str)
                and re.fullmatch(r'[a-z0-9]+(?:[._-][a-z0-9]+)*', r['instanceId']) and r['instanceId'] not in names, 'sam2_region')
        names.add(r['instanceId']); points = r['points']
        require(isinstance(points, list) and 2 <= len(points) <= 256, 'sam2_points')
        seen, labels = set(), set()
        for p in points:
            require(set(p) == {'x', 'y', 'label'} and all(type(p[k]) is int for k in p)
                    and 0 <= p['x'] < size['width'] and 0 <= p['y'] < size['height'] and p['label'] in [0, 1], 'sam2_point')
            xy = (p['x'], p['y']); require(xy not in seen, 'sam2_duplicate_point'); seen.add(xy); labels.add(p['label'])
            if p['label']:
                require(xy not in positive_owners, 'sam2_positive_conflict'); positive_owners.add(xy)
        require(labels == {0, 1}, 'sam2_both_labels')
        b = r['box']
        if b is not None:
            require(set(b) == {'x', 'y', 'width', 'height'} and all(type(v) is int for v in b.values())
                    and b['x'] >= 0 and b['y'] >= 0 and b['width'] >= 2 and b['height'] >= 2
                    and b['x'] + b['width'] <= size['width'] and b['y'] + b['height'] <= size['height'], 'sam2_box')


def verify_runtime(config, plan):
    require(set(config) == {'site', 'modelDirectory', 'runtime', 'files'}, 'sam2_runtime_config')
    r = config['runtime']; unseal(r)
    require(set(r) == {'format', 'pythonVersion', 'pythonSha256', 'packages', 'inventorySha256', 'sha256'}
            and r['format'] == 'ai_scene_sam2_cpu_runtime_v1' and r['sha256'] == plan['runtimeSha256']
            and r['pythonVersion'] == sys.version.split()[0] and sha(read(sys.executable, 10000000)) == r['pythonSha256'], 'sam2_runtime_identity')
    require(sha(canonical(config['files'])) == r['inventorySha256'] and 1 <= len(config['files']) <= 30000, 'sam2_runtime_inventory')
    site = Path(config['site']).absolute(); names = set()
    for f in config['files']:
        require(set(f) == {'path', 'byteLength', 'sha256'} and f['path'].lower() not in names, 'sam2_runtime_inventory')
        names.add(f['path'].lower()); data = read(installed_relative(site, f['path']), 512 * 1024 * 1024)
        require(len(data) == f['byteLength'] and sha(data) == f['sha256'], 'sam2_installed_file_changed')
    require({'torch/__init__.py', 'transformers/__init__.py', 'safetensors/__init__.py', 'torchvision/__init__.py'}.issubset(names)
            and any(n.endswith('.pyd') and n.startswith('torch/') for n in names), 'sam2_runtime_binary_missing')
    model = Path(config['modelDirectory']).absolute()
    import_spec = importlib.util.spec_from_file_location('scene_sam2_catalog', Path(__file__).with_name('model_setup.py'))
    catalog = importlib.util.module_from_spec(import_spec); import_spec.loader.exec_module(catalog)
    require(plan['modelFiles'] == catalog.ARTIFACTS, 'sam2_locked_catalog')
    for f in plan['modelFiles']:
        data = read(relative(model, f['path']), 512 * 1024 * 1024)
        require(len(data) == f['byteLength'] and sha(data) == f['sha256'], 'sam2_model_file_changed')
    cfg = json.loads(read(model / 'config.json'))
    require(cfg.get('model_type') == 'sam2_video' and cfg.get('architectures') == ['Sam2VideoModel'], 'sam2_architecture')
    require(all(importlib.metadata.version(p['name']) == p['version'] for p in r['packages']), 'sam2_package_version')
    return site, model


@contextlib.contextmanager
def offline():
    def denied(*_args, **_kwargs):
        raise ValueError('sam2_network_forbidden')
    original_connect, original_create = socket.socket.connect, socket.create_connection
    socket.socket.connect, socket.create_connection = denied, denied
    os.environ['HF_HUB_OFFLINE'] = '1'; os.environ['TRANSFORMERS_OFFLINE'] = '1'
    try:
        yield
    finally:
        socket.socket.connect, socket.create_connection = original_connect, original_create


class Sam2Cpu:
    def __init__(self, config, plan):
        site, model_directory = verify_runtime(config, plan)
        import torch
        import numpy as np
        import transformers
        import torchvision
        import safetensors
        require(all(Path(m.__file__).resolve().is_relative_to(site.resolve()) for m in [torch, np, transformers, torchvision, safetensors])
                and torch.version.cuda is None, 'sam2_cpu_import_origin')
        torch.set_num_threads(1); torch.set_num_interop_threads(1); torch.use_deterministic_algorithms(True); torch.manual_seed(0)
        from transformers import Sam2VideoModel, Sam2VideoProcessor
        self.model, info = Sam2VideoModel.from_pretrained(str(model_directory), local_files_only=True, use_safetensors=True,
            trust_remote_code=False, output_loading_info=True, dtype=torch.float32)
        require(all(not info.get(k) for k in ['missing_keys', 'unexpected_keys', 'mismatched_keys', 'error_msgs']), 'sam2_weight_mapping')
        self.model.to(device='cpu', dtype=torch.float32).eval()
        require(all(p.device.type == 'cpu' for p in self.model.parameters()) and torch.get_num_threads() == 1, 'sam2_cpu_only')
        self.processor = Sam2VideoProcessor.from_pretrained(str(model_directory), local_files_only=True, trust_remote_code=False)
        self.torch, self.np, self.inputs = torch, np, None

    def predict(self, image, region):
        torch = self.torch
        if self.inputs is None:
            self.inputs = self.processor(images=image.convert('RGB'), device='cpu', return_tensors='pt')
        session = self.processor.init_video_session(inference_device='cpu', inference_state_device='cpu', processing_device='cpu',
            video_storage_device='cpu', dtype=torch.float32)
        points = [[p['x'], p['y']] for p in region['points']]; labels = [p['label'] for p in region['points']]
        b = region['box']; boxes = None if b is None else [[[b['x'], b['y'], b['x'] + b['width'] - 1, b['y'] + b['height'] - 1]]]
        self.processor.add_inputs_to_inference_session(inference_session=session, frame_idx=0, obj_ids=1, input_points=[[points]],
            input_labels=[[labels]], input_boxes=boxes, original_size=(image.height, image.width))
        with torch.inference_mode():
            out = self.model(inference_session=session, frame=self.inputs.pixel_values[0])
            masks = self.processor.post_process_masks([out.pred_masks], original_sizes=self.inputs.original_sizes,
                mask_threshold=0.0, binarize=False, max_hole_area=0.0, max_sprinkle_area=0.0, apply_non_overlapping_constraints=False)[0]
            require(tuple(masks.shape) == (1, 1, image.height, image.width) and bool(torch.isfinite(masks).all()), 'sam2_output_frame_or_values')
            return (masks[0, 0] > 0).cpu().numpy()


def run(input_root, config_path, out, factory=Sam2Cpu):
    from PIL import Image
    import numpy as np
    root, output = Path(input_root).absolute(), Path(out).absolute()
    require(not output.is_relative_to(root) and not output.is_relative_to(Path(__file__).absolute().parents[1])
            and output.parent.is_dir() and not output.exists(), 'sam2_fresh_output_required')
    for p in [output.parent, *output.parent.parents]:
        require(not p.is_symlink() and not (getattr(p.stat(), 'st_file_attributes', 0) & 1024), 'sam2_linked_output')
    plan_bytes = read(root / 'prompt-plan.json'); plan = json.loads(plan_bytes); validate_plan(plan)
    require(plan['producerSha256'] == sha(read(Path(__file__))), 'sam2_producer_changed')
    raw = read(relative(root, plan['source']['path']))
    require(sha(raw) == plan['rawSha256'] and len(raw) == plan['source']['byteLength'], 'sam2_source_changed')
    image = Image.open(io.BytesIO(raw)); require(image.format == 'PNG' and image.mode in ['RGB', 'RGBA']
        and image.size == (plan['pixelSize']['width'], plan['pixelSize']['height'])
        and image.convert('RGBA').getextrema()[3] == (255, 255), 'sam2_opaque_native_source')
    config = json.loads(read(config_path, 16 * 1024 * 1024)); output.mkdir(); calls, loads, masks = 0, 0, []
    try:
        write_json(output / 'started.json', sealed({'format': 'ai_scene_prompt_segmentation_started_v1', 'planSha256': plan['sha256'],
                   'maximumCalls': plan['maximumCalls'], 'maximumModelLoads': 1, 'automaticRetry': False, 'generationCalls': 0}))
        with offline():
            loads += 1; backend = factory(config, plan)
            for region in plan['regions']:
                write_json(output / f"reserved-{region['instanceId']}.json", sealed({'planSha256': plan['sha256'], 'instanceId': region['instanceId']}))
                calls += 1; selected = backend.predict(image, region)
                require(isinstance(selected, np.ndarray) and selected.dtype == np.bool_ and selected.shape == (image.height, image.width), 'sam2_output_binary_frame')
                pixels = np.repeat((selected.astype(np.uint8) * 255)[..., None], 4, axis=2); pixels[..., 3] = 255
                stream = io.BytesIO(); Image.fromarray(pixels).save(stream, format='PNG'); data = stream.getvalue()
                path = f"masks/{region['instanceId']}.png"; write(relative(output, path), data)
                masks.append({'instanceId': region['instanceId'], 'path': path, 'sha256': sha(data), 'byteLength': len(data),
                              'selectedPixels': int(np.count_nonzero(selected))})
                print(json.dumps({'completed': region['instanceId'], 'selectedPixels': masks[-1]['selectedPixels']}), flush=True)
        require(read(root / 'prompt-plan.json') == plan_bytes and read(relative(root, plan['source']['path'])) == raw, 'sam2_input_changed')
        result = sealed({'format': 'ai_scene_prompt_segmentation_result_v1', 'planSha256': plan['sha256'], 'rawSha256': plan['rawSha256'],
            'status': 'unreviewed-prompt-candidates', 'runtimeSha256': plan['runtimeSha256'], 'producerSha256': plan['producerSha256'],
            'modelFilesSha256': plan['modelFilesSha256'], 'modelLoads': loads, 'calls': calls, 'masks': masks, 'networkRequests': 0, 'generationCalls': 0})
        write_json(output / 'prompt-result.json', result); return result
    except Exception as error:
        code = str(error) if isinstance(error, ValueError) and re.fullmatch('[a-z0-9_]+', str(error)) else 'sam2_operation_failed'
        write_json(output / 'failure.json', sealed({'format': 'ai_scene_prompt_segmentation_failure_v1', 'planSha256': plan['sha256'],
            'status': 'failed-no-automatic-retry', 'modelLoadAttempts': loads, 'calls': calls, 'masks': masks,
            'error': code, 'errorType': type(error).__name__, 'networkRequests': 0, 'generationCalls': 0}))
        raise ValueError(code) from None


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', required=True); parser.add_argument('--runtime', required=True); parser.add_argument('--out', required=True)
    args = parser.parse_args()
    try:
        print(json.dumps(run(args.input, args.runtime, args.out)))
    except Exception as error:
        print(json.dumps({'status': 'stopped', 'error': str(error) if isinstance(error, ValueError) else 'sam2_operation_failed'}))
        raise SystemExit(1)
