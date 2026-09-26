"""Find exact received sources for an existing complete processing preview."""
from pathlib import Path
import tempfile

from PIL import Image

from .adapt_frame import adapt as adapt_frame
from .adapt_strip import adapt as adapt_strip
from .evaluate import digest, read, save
from .experimental_executor import load_job
from .accepted_materials import received
from .extract_sheets import cells
from .freeze_visual import inspect
from .layer_package import portable_text
from .sheet_pixels import prepare


def discover(snapshot, preview, jobs_root, selection, known_differences=()):
    """Write an exact, fail-closed selection; never guess between matching variants."""
    jobs_root=Path(jobs_root)
    jobs=sorted((p for p in jobs_root.iterdir() if p.is_dir() and (p/'job.json').is_file()),key=lambda p:p.name)
    return discover_jobs(snapshot,preview,jobs,selection,known_differences)


def discover_jobs(snapshot, preview, jobs, selection, known_differences=()):
    """Match a complete preview against only the explicitly supplied received jobs."""
    snapshot,preview,selection=map(Path,(snapshot,preview,selection))
    jobs=[Path(job).resolve() for job in jobs]
    if len(jobs)!=len(set(jobs)):raise ValueError('DUPLICATE_RECEIVED_JOB')
    frozen=inspect(snapshot)
    placements=sorted(read(snapshot/'placements.json')['materials'],key=lambda p:p['drawIndex'])
    ids=[p['id'] for p in placements]
    if len(ids)!=len(set(ids)) or len({p['drawIndex'] for p in placements})!=len(ids):
        raise ValueError('FROZEN_LAYER_ORDER')
    visual_path=snapshot/'evidence/revised-visual-plan.json'
    visual=read(visual_path if visual_path.exists() else snapshot/'evidence/m1-draft.json')
    report_path=preview/'report.json';report=read(report_path)
    if report['snapshotDigest']!=frozen['digest']:raise ValueError('PREVIEW_SNAPSHOT_MISMATCH')
    rows={r['id']:r for r in report['records']}
    if len(rows)!=len(report['records']) or set(rows)!=set(ids):raise ValueError('COMPLETE_PREVIEW_REQUIRED')
    for mid in ids:
        row=rows[mid]
        if row['report']['status']!='processed_pending_visual_review' or digest(preview/mid/'material.png')!=row['report']['materialSha256']:
            raise ValueError('PREVIEW_MATERIAL_CHANGED')
    reference=snapshot/'reference.png';reference_sha=digest(reference)
    if not jobs:raise ValueError('NO_RECEIVED_JOBS')
    choices={mid:[] for mid in ids}
    with tempfile.TemporaryDirectory(prefix='ui-variant-discover-') as tmp:
        temp=Path(tmp)
        for job in jobs:
            config,requests=load_job(job)
            if digest(job/'snapshot/reference.png')!=reference_sha:continue
            for key in config['assets']:
                request=requests[key]
                mids=request.get('materialIds',[key])
                relevant=[mid for mid in mids if mid in choices]
                if not relevant or not (job/'attempts'/key/'received.json').exists():continue
                raw,_,_=received(job,key,reference_sha)
                base=temp/(job.name+'-'+key);base.mkdir()
                prepared=None;boxes=None
                if request.get('kind')=='sheet':
                    prepared=base/'prepared.png';prepare(raw,prepared)
                    with Image.open(prepared) as image:boxes=cells(image,request,actual_gaps=True)
                for mid in relevant:
                    row=rows[mid];placement=next(p for p in placements if p['id']==mid)
                    source=raw
                    if prepared:
                        source=base/(mid+'.png')
                        with Image.open(prepared) as image:
                            image.crop(tuple(boxes[mids.index(mid)])).save(source)
                    candidates=[('preserve',source)]
                    if digest(source)!=row['sourceSha256']:
                        for policy,adapt in (('simple-strip',adapt_strip),('horizontal-frame-slice',adapt_frame)):
                            folder=base/(mid+'-'+policy)
                            try:
                                adapt(source,digest(source),*placement['outputSize'],folder,policy=policy)
                            except ValueError:
                                continue
                            candidates.append((policy,folder/'adapted.png'))
                    for policy,path in candidates:
                        if digest(path)==row['sourceSha256']:
                            choices[mid].append(dict(snapshot=str(snapshot),snapshotDigest=frozen['digest'],
                                preview=str(preview),previewReportSha256=digest(report_path),
                                materialId=mid,job=str(job),requestId=key,sourceMaterialId=mid,
                                adaptationPolicy=policy))
    ambiguous={mid:len(found) for mid,found in choices.items() if len(found)!=1}
    if ambiguous:raise ValueError('VARIANT_SOURCE_UNRESOLVED: '+str(ambiguous))
    issues=list(known_differences) or ['素材来源已自动匹配，视觉外观仍待人工验收。']
    if len(issues)>128:raise ValueError('ISSUES_LIMIT')
    for issue in issues:portable_text(issue)
    result=dict(kind='ui_received_variant_selection_v1',reference=str(reference),
        referenceSha256=reference_sha,candidatePreview=str(preview/'partial-transparent.png'),
        candidatePreviewSha256=digest(preview/'partial-transparent.png'),
        textPolicy=visual['textPolicy'],backgroundMode=visual['backgroundMode'],
        knownDifferences=issues,expectedMaterialIds=ids,layers=[choices[mid][0] for mid in ids])
    save(selection,result)
    return dict(selection=str(selection),selectionSha256=digest(selection),layerCount=len(ids),
        sourceJobsCount=len({entry['job'] for entry in result['layers']}),automaticVariantDiscovery=True,
        generationCalls=0,modelCalls=0,humanVisualAcceptance=False)
