"""Fresh host M1 exchange. Original model bytes and local evidence, never CLI receipts."""
from pathlib import Path
import json
import re
from jsonschema import Draft202012Validator
from PIL import Image
from .evaluate import read, save, digest
from . import host_review
from .planning_dag import BOX_TEXT_GUIDANCE, read_notes
from .visual_policy import load_input, planning_guidance, warnings_only

MODE = 'fresh-host-m1-independent-review'
FILES = ('reference.png', 'prompt.md', 'schema.json', 'request.json', 'draft.json',
         'host-attestation.json', 'host-dispatch-evidence.bin', 'host-return-evidence.bin',
         'exchange-provenance.json', 'accepted.json')

VISUAL_DESCRIPTION_CHECK = (
    '逐素材视觉描述自检（输出前完成，不另加自检字段）：\n'
    '先查看干净原图，再为每项保留图形核对唯一归属、实例数量、状态、完整轮廓、连接和间隙。'
    '在所属对象或素材的 label 中写出可见主体底色，以及显著渐变、纹理、描边、厚边和高光。\n'
    '若主体表面存在显著渐变，写明其实际方向和两端颜色；主体面的颜色过渡与边缘描边、厚边、'
    '局部高光和投影分别核对，不能用单一颜色或“亮色表面”概括后遗漏主体渐变。'
    '平涂表面不要臆造渐变，不确定细节按冻结策略处理。\n'
    '同类多实例逐项检查各自 label，不能只在其中一个实例或全局说明中描述。'
    '完整插画仍需逐区核对内部可辨结构：相邻大色块、孔洞、内外轮廓和附属部件须区分；'
    '不要把有明显面积或独立轮廓的浅色实体区域仅称为高光。'
    '人物或动物面部逐项核对眼部各区域及其相对关系、眉、鼻、口和可见附饰，'
    '服饰与道具核对扣件、带子、卷层和遮挡；只写原图确实可辨的结构，不凭类别补造细节。'
    '仅冻结视觉策略允许的细微表面差异可绑定原图；显著属性不能借此省略。'
    '描述已有可见属性，不新增图形、样本答案、绘制指令或 schema 字段。\n\n')


def prepare(root, config):
    root=Path(root);contract=Path(config['contract'])
    for name,sha in host_review.CONTRACT_DIGESTS.items():
        if digest(contract/name)!=sha:raise ValueError('HOST_PLANNING_CONTRACT_NOT_SUPPORTED:'+name)
    policy_bytes=load_input(config.get('visualPolicy'))
    policy=json.loads(policy_bytes.decode('utf-8-sig')) if policy_bytes else None
    notes=read_notes(config.get('planningNotes'))
    with Image.open(config['original']) as image:
        if image.format!='PNG' or image.getexif().get(274,1)!=1:
            raise ValueError('PNG_WITH_REFERENCE_COORDINATES_REQUIRED')
        image.load();width,height=image.size
    root.mkdir()
    (root/'reference.png').write_bytes(Path(config['original']).read_bytes())
    (root/'schema.json').write_bytes((contract/'schemas/visual-plan.schema.json').read_bytes())
    prompt=(VISUAL_DESCRIPTION_CHECK+BOX_TEXT_GUIDANCE+f'参考图原始画布：width={width}, height={height} 像素。'
        'bboxNorm 的 x 除以完整画布宽、y 除以完整画布高；不要使用显示尺寸或假定方形画布。'
        '从干净原图独立制定新的完整拆层计划；本请求不提供旧计划、图层数量、旧坐标或旧素材。'
        '全画布背景框不能代替可见图形覆盖；每项保留图形须有唯一所属素材。'
        '依据真实可见结构描述轮廓、数量、连接、间隙及外观。按九区自行清点，不能用类别名称代替细节。\n\n'
        +(contract/'prompts/visual-plan.md').read_text('utf-8-sig')
        +('' if warnings_only(policy) else planning_guidance(policy)))
    if warnings_only(policy):
        prompt=planning_guidance(policy)+prompt
    if notes:prompt+='\n用户规划约束：\n'+notes.decode('utf-8-sig')
    prompt+='\n输出前逐项核对上述视觉描述，显著属性须写入各自所属 label；只返回 schema 对应的完整 JSON 计划。不得改写输入，不生成图片，不使用其他模型。\n'
    (root/'prompt.md').write_text(prompt,encoding='utf-8')
    save(root/'request.json',dict(kind='ui_host_m1_request_v1',
        originalReferenceSha256=digest(root/'reference.png'),
        inputs={n:digest(root/n) for n in ('reference.png','prompt.md','schema.json')},
        plannerId=config['m1Planner'],candidateAuthors=config['candidateAuthors'],
        model=config['planningModel'],effort=config['planningEffort'],
        runtime=host_review.runtime_files(),mediaGenerationCalls=0,maximumCalls=1,
        oldPlanInputReused=False,oldImageReused=False,notProviderReceipt=True))


def _request(root):
    request=read(root/'request.json')
    if (request.get('kind')!='ui_host_m1_request_v1' or
            request.get('runtime')!=host_review.runtime_files() or
            request.get('candidateAuthors')!=[request.get('plannerId')] or
            request.get('oldPlanInputReused') is not False or
            request.get('oldImageReused') is not False):
        raise ValueError('HOST_M1_REQUEST_CHANGED')
    host_review._bound_files(root,request['inputs'])
    if request['originalReferenceSha256']!=digest(root/'reference.png'):
        raise ValueError('HOST_M1_REFERENCE_CHANGED')
    return request


def verify_exchange(root):
    root=Path(root);request=_request(root)
    att=read(root/'host-attestation.json')
    expected={'kind','requestSha256','responseSha256','plannerId','model','effort',
        'hostAssertedModelResponse','notProviderReceipt','notCryptographicallyPlatformVerified',
        'dispatchEvidenceSha256','returnEvidenceSha256'}
    if set(att)!=expected or att['kind']!='ui_host_m1_attestation_v1':
        raise ValueError('HOST_M1_ATTESTATION_REQUIRED')
    for name in ('requestSha256','responseSha256','dispatchEvidenceSha256','returnEvidenceSha256'):
        if not isinstance(att[name],str) or re.fullmatch('[0-9a-f]{64}',att[name]) is None:
            raise ValueError('HOST_M1_ATTESTATION_DIGEST_REQUIRED')
    if (att['requestSha256']!=digest(root/'request.json') or
            att['responseSha256']!=digest(root/'draft.json') or
            any(att[k]!=request[k] for k in ('plannerId','model','effort')) or
            any(att[k] is not True for k in ('hostAssertedModelResponse','notProviderReceipt','notCryptographicallyPlatformVerified')) or
            att['dispatchEvidenceSha256']!=digest(root/'host-dispatch-evidence.bin') or
            att['returnEvidenceSha256']!=digest(root/'host-return-evidence.bin') or
            att['dispatchEvidenceSha256']==att['returnEvidenceSha256']):
        raise ValueError('HOST_M1_ATTESTATION_BINDING_MISMATCH')
    provenance=dict(kind='ui_host_m1_exchange_provenance_v1',requestSha256=digest(root/'request.json'),
        responseSha256=digest(root/'draft.json'),hostAttestationSha256=digest(root/'host-attestation.json'),
        originalReferenceSha256=request['originalReferenceSha256'],plannerId=request['plannerId'],
        responseOrigin='host-attested-model-response',notProviderReceipt=True,
        notCryptographicallyPlatformVerified=True,cliSessionAsserted=False,m1ModelExecuted=True)
    if (root/'exchange-provenance.json').exists() and read(root/'exchange-provenance.json')!=provenance:
        raise ValueError('HOST_M1_PROVENANCE_CHANGED')
    return provenance


def receive(root, response, *, host_attestation, dispatch_evidence, return_evidence):
    root=Path(root);response=Path(response).resolve();_request(root)
    if response.is_relative_to(root) or (root/'draft.json').exists():
        raise ValueError('FRESH_EXTERNAL_HOST_M1_RESPONSE_REQUIRED')
    for path,name in ((response,'draft.json'),(host_attestation,'host-attestation.json'),
            (dispatch_evidence,'host-dispatch-evidence.bin'),(return_evidence,'host-return-evidence.bin')):
        (root/name).write_bytes(Path(path).read_bytes())
    provenance=verify_exchange(root)
    save(root/'exchange-provenance.json',provenance)
    plan=read(root/'draft.json')
    Draft202012Validator(read(root/'schema.json')).validate(plan)
    if plan.get('kind')!='ui_visual_plan_v5':raise ValueError('V5_REQUIRED')
    save(root/'accepted.json',dict(kind='ui_host_m1_accepted_v1',responseSha256=digest(root/'draft.json'),
        requestSha256=digest(root/'request.json'),provenanceSha256=digest(root/'exchange-provenance.json')))
    return verify(root)


def verify(root):
    root=Path(root);provenance=verify_exchange(root)
    if not (root/'exchange-provenance.json').is_file():raise ValueError('HOST_M1_PROVENANCE_REQUIRED')
    expected=dict(kind='ui_host_m1_accepted_v1',responseSha256=digest(root/'draft.json'),
        requestSha256=digest(root/'request.json'),provenanceSha256=digest(root/'exchange-provenance.json'))
    if read(root/'accepted.json')!=expected:raise ValueError('HOST_M1_ACCEPTANCE_CHANGED')
    plan=read(root/'draft.json');Draft202012Validator(read(root/'schema.json')).validate(plan)
    return plan,provenance


def bind_candidate(root, candidate, authors, reference_sha):
    plan,provenance=verify(root)
    if (digest(Path(candidate))!=provenance['responseSha256'] or
            authors!=[provenance['plannerId']] or reference_sha!=provenance['originalReferenceSha256']):
        raise ValueError('HOST_M1_CANDIDATE_BINDING_MISMATCH')
    return plan,provenance
