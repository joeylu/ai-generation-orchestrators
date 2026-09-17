"""Compile compact facts through the same native compiler and official CLI."""
from pathlib import Path
from .common import digest, sha256, write_json


def compile_shop_facts(reference, facts, output, component_root, maximum_calls):
    from .shop_facts import expand_shop_facts
    from .native_delivery import compile_native_delivery

    reference, output = Path(reference), Path(output)
    native = expand_shop_facts(reference, facts)
    result = compile_native_delivery(reference, native, output, component_root, maximum_calls)
    write_json(output / 'shop-facts.json', facts)
    report = dict(kind='ui_shop_facts_expansion_v1', version='1.0',
                  referenceSha256=sha256(reference), factsDigest=digest(facts),
                  nativeDigest=digest(native), planDigest=result['planDigest'],
                  componentCount=result['componentCount'], materialCount=len(native['materials']),
                  generatedRequests=result['maximumCalls'],
                  status='compiled_not_generated', human_visual_acceptance=False,
                  limitations=['Supplied observations are not independently verified image recognition.',
                               'Compilation is not material, interaction or visual acceptance.'])
    write_json(output / 'shop-facts-expansion.json', report)
    return {**result, 'factsDigest': report['factsDigest'], 'nativeDigest': report['nativeDigest']}
