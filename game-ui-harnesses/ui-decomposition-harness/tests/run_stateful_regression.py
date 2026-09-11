"""Persist fresh local fixture/CLI/browser evidence; never use historical deliveries."""
import argparse
import json
from pathlib import Path
import subprocess
from ai_ui_decomposition.common import ContractError, sha256, write_json
from ai_ui_decomposition.stateful import accept


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--component-root',required=True,type=Path)
    parser.add_argument('--output',required=True,type=Path)
    args=parser.parse_args();root=args.output.resolve();component=args.component_root.resolve()
    if root.exists():raise ContractError('OUTPUT_EXISTS')
    subprocess.run(['node',str(Path(__file__).with_name('stateful-fixtures.mjs')),str(component),str(root)],check=True)
    results=[]
    for case in sorted(root.iterdir()):
        archive=case/'ui.component-handoff.draft.zip';before=sha256(archive)
        expected='STATE_DISTINCT_DUPLICATE' if case.name=='Tabs-identical' else None
        try:
            report=accept(archive,case/'evidence.json',component,case/'acceptance')
            passed=expected is None and report['status']=='technical_passed'
            result={'case':case.name,'passed':passed,'status':report['status']}
        except ContractError as exc:
            result={'case':case.name,'passed':bool(expected and expected in str(exc)),'error':str(exc)}
        result.update(sourceUnchanged=before==sha256(archive),handoffSha256=before)
        results.append(result);print(json.dumps(result),flush=True)
    report={'kind':'ui_state_regression_v1','results':results,'human_visual_acceptance':False,
            'passed':all(r['passed'] and r['sourceUnchanged'] for r in results)}
    write_json(root/'regression.json',report)
    return 0 if report['passed'] else 2


if __name__=='__main__':raise SystemExit(main())
