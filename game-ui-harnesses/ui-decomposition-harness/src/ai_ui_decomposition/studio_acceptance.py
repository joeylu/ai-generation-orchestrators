"""Bounded local Studio entry, independent of sample names and workspace paths."""
import subprocess
import json
import time
import zipfile
from pathlib import Path
from .common import require, read_json, write_json, sha256


def verify_reference_roundtrip(source, target):
    with zipfile.ZipFile(source) as a,zipfile.ZipFile(target) as b:
        names=[n for n in a.namelist() if n.startswith('reference/') or n=='acceptance-scope.json']
        require(len(a.namelist())==len(set(a.namelist())) and len(b.namelist())==len(set(b.namelist())),'STUDIO_DUPLICATE_MEMBER')
        require(all(n in b.namelist() and a.read(n)==b.read(n) for n in names),'STUDIO_REFERENCE_CHANGED')
        if 'handoff.json' in a.namelist():
            original=json.loads(a.read('handoff.json'))
            require('handoff.json' in b.namelist(),'STUDIO_MANIFEST_MISSING')
            restored=json.loads(b.read('handoff.json'))
            require(original.get('reference')==restored.get('reference'),'STUDIO_REFERENCE_MAPPING_CHANGED')
    return {'status':'byte_identical' if names else 'legacy_missing_reference_evidence','members':names}


def run_studio(source, component_root, output, timeout_seconds=600):
    require(type(timeout_seconds) is int and 1<=timeout_seconds<=1800,'STUDIO_TIMEOUT')
    require(source.is_file() and (component_root/'dist/index.html').is_file(),'STUDIO_LOCAL_BUILD_REQUIRED')
    require(not output.exists(),'OUTPUT_EXISTS');output.mkdir(parents=True)
    start=time.monotonic();report={'kind':'ui_studio_receipt_v1','status':'failed','handoffSha256':sha256(source),'human_visual_acceptance':False}
    try:
        result=subprocess.run(['node',str(Path(__file__).with_name('studio-acceptance.mjs')),str(component_root),str(source),str(output/'browser'),str(timeout_seconds)],capture_output=True,text=True,timeout=timeout_seconds+10)
        write_json(output/'process.json',{'exitCode':result.returncode,'stdout':result.stdout[-3000:],'stderr':result.stderr[-3000:]})
        require(result.returncode==0,'STUDIO_BROWSER_FAILED')
        report['referenceEvidence']=verify_reference_roundtrip(source,output/'browser/roundtrip.zip')
        report['browserReportSha256']=sha256(output/'browser/report.json');report['status']='technical_passed'
    except subprocess.TimeoutExpired:
        report['error']='STUDIO_TIMEOUT'
        require(False,'STUDIO_TIMEOUT')
    except Exception as exc:
        report['error']=str(exc);raise
    finally:
        report['elapsedSeconds']=time.monotonic()-start;write_json(output/'receipt.json',report)
    return report


def run_composition(bundle, screenshot, plan_path, output):
    from .composition_checks import check_composition
    require(not output.exists(),'OUTPUT_EXISTS');output.mkdir(parents=True)
    try:
        data=read_json(bundle,max_bytes=64*1024*1024)
        report=check_composition(data.get('document',data),screenshot,read_json(plan_path),plan_path.parent)
    except Exception as exc:
        write_json(output/'report.json',{'status':'rejected','error':str(exc),'human_visual_acceptance':False})
        raise
    report['bundleSha256']=sha256(bundle);report['screenshotSha256']=sha256(screenshot);report['planSha256']=sha256(plan_path)
    write_json(output/'report.json',report)
    require(report['status']!='failed','COMPOSITION_CHECK_FAILED')
    return report
