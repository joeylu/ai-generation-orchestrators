"""Fresh host M1 exchange. Original model bytes and local evidence, never CLI receipts."""
from pathlib import Path
import json
import re
from jsonschema import Draft202012Validator
from PIL import Image
from .evaluate import read, save, digest
from .host_timing import measured
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
    'label 只描述该对象自己拥有的图形；不要把独立归属另一素材的子件、覆盖物或父底板的装配描述'
    '写入本体 label。分别归属的部件用各自对象记录及坐标表达相对位置，避免把完整组装态写成本体外观。\n'
    '若主体表面存在显著渐变，写明其实际方向和两端颜色；主体面的颜色过渡与边缘描边、厚边、'
    '局部高光和投影分别核对，不能用单一颜色或“亮色表面”概括后遗漏主体渐变。'
    '平涂表面不要臆造渐变，不确定细节按冻结策略处理。\n'
    '同类多实例逐项检查各自 label，不能只在其中一个实例或全局说明中描述。'
    '全画布背景中的显著场景主体须记录原图中的相对位置、可见轮廓范围和尺度关系，'
    '不能只写主体类别；去除UI不意味着重新构图或放大主体填补空位。'
    '半透明底板须区分自身色调、边框与透过它可见的场景；透见内容仍归背景，不能重复归入底板。'
    '完整插画仍需逐区核对内部可辨结构：相邻大色块、孔洞、内外轮廓和附属部件须区分；'
    '不要把有明显面积或独立轮廓的浅色实体区域仅称为高光。'
    '人物或动物面部逐项核对眼部各区域及其相对关系、眉、鼻、口和可见附饰，'
    '服饰与道具核对扣件、带子、卷层和遮挡；只写原图确实可辨的结构，不凭类别补造细节。'
    '仅冻结视觉策略允许的细微表面差异可绑定原图；显著属性不能借此省略。'
    '描述已有可见属性，不新增图形、样本答案、绘制指令或 schema 字段。\n\n')


@measured('planning')
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
    schema=read(contract/'schemas/visual-plan.schema.json')
    from .host_layout_registration import PLANNING
    layout=config.get('layoutPlanningPolicy')==PLANNING
    if layout:
        schema['required'].append('layoutRegistration')
        save(root/'schema.json',schema)
    else:
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
    if config.get('planningCapacityPolicy'):
        prompt+=('\n本轮有限调用预算：生图最多 '+str(config['maximumImageCalls'])+' 次，独立素材复审最多 '
            +str(config['maximumMaterialReviews'])+' 次；generationMode='+config['generationMode']
            +'，合板策略='+config.get('generationGroupingPolicy','none')+'。'
            '素材数量不等于生图请求数量，同类素材可合板生成后分别交付；'
            '合板只是传输与生图分组，不决定素材归属，也不要求把卡框、可替换内容和状态合为一张。'
            '先按基础规划合同区分可替换内容槽与固定构图插画、固定读数卡，再确定唯一归属；'
            '不得因调用预算强制合并或机械拆碎完整插画。'
            '保持全部原图可见图形、独立归属和原始尺寸，不为凑预算删除素材、缩图或强拼不兼容大图。'
            '程序会在独立M2之前按真实尺寸核算请求数；预算确实不足时明确失败，不会自动增加预算或重试。\n')
        from .composite_review import enabled as composite_review_enabled
        if composite_review_enabled(config):
            prompt+=('本轮素材复审采用 final-composite-once-v1：全部素材生成并自动回拼后，只做一次整图独立复审。'
                     '复审预算不随素材或生图请求数增长；不能因为只复审一次而减少素材或限制为一次生图。'
                     '逐生图请求复审和逐主体观察均为零次。\n')
    if notes:prompt+='\n用户规划约束：\n'+notes.decode('utf-8-sig')
    if layout:
        prompt+=('\n本轮须在 layoutRegistration 中同时声明归位合同；它是本次计划的一部分，'
            '不得复用旧坐标、旧素材 ID 或旧答案。referenceSha256 必须为 '+digest(root/'reference.png')+'. '
            '覆盖每项 foreground，materialId 与本轮材料严格一致。目标外框只来自 bboxNorm，不能另写 targetBox。'
            'frame 仅用于允许保护边角并拉伸内部的面板、条带、按钮和控件外框；'
            'uniform 用于图标、圆钮及不可拉伸图形。measurementAlphaThreshold 通常为 128，'
            '它只测量主体边界，不删除半透明像素。'
            'frame 的 bboxNorm 与 constraints 使用同一刚性主体边框口径，不能把外侧柔影当实体边距；'
            '阴影仍须完整保留在所属图形，生成会提供外扩上下文，不得裁掉阴影来满足归位。'
            '明确相连、同轴、对齐或间隙关系写入 constraints，expectedDelta 为 a.edge 减 b.edge，'
            '单位为原图像素，容差建议 1 至 2 像素；不要为无关素材建立约束。'
            '仅为面板内清晰可辨的全宽水平细分隔线声明 horizontalDividerTargets，'
            '使用原图 Y 像素坐标升序；无此结构则省略。不要把分区色带边界或外边框当作细分隔线。'
            '所属底板的 label 须描述各分区色带和相邻留白的相对位置，包括外框与首个色带之间'
            '实际可见的窄留白；不能只记录行线而遗漏这些结构。对清晰可辨、贯通底板内部的较暗分区色带，'
            '还须声明 horizontalBandTargets：按上下顺序列出每条色带 [top,bottom) 的原图 Y 像素范围，'
            '同时约束上沿和下沿，保留色带之间及页签下方的真实白间隙。不要纳入外来页签、控件或细行线。'
            'horizontalBandTargets 的两端必须严格位于所属 bboxNorm 的 top+3 与 bottom-3 像素之间；'
            '贴顶部或底部外框的色带不属于成对内部色带目标，应在所属 label 中精确描述比例和贴边关系，'
            '不能为凑内部目标而添加原图不存在的留白。'
            '静态完整控件的底座、旋钮、状态填充和附属图形优先归同一素材；只有用户明确要求分别控制或运动时'
            '才拆开，并明确各自唯一归属，禁止为了合板把一个完整控件无理由拆碎。只声明参考图支持的几何关系，'
            '不得把文字留白当作缺失图形，也不要创建额外素材补空白。\n')
        prompt+=('底板归位须区分可伸缩表面与完整插画：独立导出的背包底壳、详情面板、导航底条等'
            '可伸缩面板表面优先声明 frame，不能因为它承载插画卡片就把底板也设成 uniform；'
            '那些单独导出的插画卡片仍为 uniform。若面板自身拥有不可变形插画或复杂装饰，使用 uniform，'
            '并在 knownDifferences 明确其等比适配可能无法同时贴合四边，不能假设目标框会自动补齐差异。\n')
        prompt+=('归位能力边界：程序只能缩放和平移一个素材整体，frame 只适配已许可的可伸缩表面；'
            '它不能独立校正同图内被放大或移位的插画、金币、徽饰，也不能还原加粗边框。'
            '可替换内容与槽底板按基础合同分别归属后，刚性内容使用 uniform、可伸缩空底板才可使用 frame。'
            '固定读数卡和固定附饰仍遵守基础合同，不因这种能力边界一律拆开；'
            '仅在用户约束提供了实际整卡比例或轮廓失败证据时，按基础合同复查是否应改为独立刚性图形与底板。'
            '对仍整图保留的复杂素材，核对内部图形与另属按钮、状态标记的真实间隙、边框厚薄和文字留白；'
            '需要定位的内嵌刚性图形给出完整辅助框。留白继续留空，不能把图形放大或移向去字区域。'
            '底板 frame 与整图 uniform 都不证明内部几何已验收。\n')
        if config.get('layoutInternalTargetsPolicy')=='uniform-internal-targets-observe-only-v1':
            prompt+=('完整插图卡片使用 uniform，禁止为对齐内部行线改成 frame。'
                'uniform 也可声明原图清晰可见的内部行线和色带：它们约束生成并在回拼后测量，'
                '不会授权内部拉伸或形变；未达到目标的结果保留为 warning。'
                '所有内部目标必须严格位于所属 bboxNorm 的 top+3 与 bottom-3 像素之间。\n')
    prompt+=('\nThe frozen request directory and its enclosing host run are read-only. '
        'If a response file is requested, write it outside the host run; keep every helper script '
        'and scratch file outside the host run as well. Do not add files beside these inputs.\n')
    prompt+='\n输出前逐项核对上述视觉描述，显著属性须写入各自所属 label；只返回 schema 对应的完整 JSON 计划。不得改写输入，不生成图片，不使用其他模型。\n'
    (root/'prompt.md').write_text(prompt,encoding='utf-8')
    save(root/'request.json',dict(kind='ui_host_m1_request_v1',
        originalReferenceSha256=digest(root/'reference.png'),
        inputs={n:digest(root/n) for n in ('reference.png','prompt.md','schema.json')},
        plannerId=config['m1Planner'],candidateAuthors=config['candidateAuthors'],
        model=config['planningModel'],effort=config['planningEffort'],
        runtime=host_review.runtime_files(),mediaGenerationCalls=0,maximumCalls=1,
        oldPlanInputReused=False,oldImageReused=False,notProviderReceipt=True,
        **({'schemaErrorsRepairable':True} if config.get('planningRepairPolicy')=='one-repair-independent-rereview-v1' else {})))


def _request(root, *, archived_runtime=None):
    request=read(root/'request.json')
    expected_runtime=host_review.runtime_files() if archived_runtime is None else archived_runtime
    if archived_runtime is not None and (not isinstance(archived_runtime,dict) or not archived_runtime or
            any(not isinstance(k,str) or not k.startswith('game-ui-harnesses/') or
                '\\' in k or ':' in k or '..' in Path(k).parts or not k.endswith('.py') or
                not isinstance(v,str) or re.fullmatch('[0-9a-f]{64}',v) is None
                for k,v in archived_runtime.items())):
        raise ValueError('HOST_M1_ARCHIVED_RUNTIME_INVALID')
    if (request.get('kind')!='ui_host_m1_request_v1' or
            request.get('runtime')!=expected_runtime or
            request.get('candidateAuthors')!=[request.get('plannerId')] or
            request.get('oldPlanInputReused') is not False or
            request.get('oldImageReused') is not False):
        raise ValueError('HOST_M1_REQUEST_CHANGED')
    host_review._bound_files(root,request['inputs'])
    if request['originalReferenceSha256']!=digest(root/'reference.png'):
        raise ValueError('HOST_M1_REFERENCE_CHANGED')
    return request


def verify_exchange(root, *, archived_runtime=None):
    root=Path(root);request=_request(root,archived_runtime=archived_runtime)
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
    if not _request(root).get('schemaErrorsRepairable'):
        Draft202012Validator(read(root/'schema.json')).validate(plan)
        if plan.get('kind')!='ui_visual_plan_v5':raise ValueError('V5_REQUIRED')
    save(root/'accepted.json',dict(kind='ui_host_m1_accepted_v1',responseSha256=digest(root/'draft.json'),
        requestSha256=digest(root/'request.json'),provenanceSha256=digest(root/'exchange-provenance.json')))
    return verify(root)


def verify(root, *, archived_runtime=None):
    root=Path(root);provenance=verify_exchange(root,archived_runtime=archived_runtime)
    if not (root/'exchange-provenance.json').is_file():raise ValueError('HOST_M1_PROVENANCE_REQUIRED')
    expected=dict(kind='ui_host_m1_accepted_v1',responseSha256=digest(root/'draft.json'),
        requestSha256=digest(root/'request.json'),provenanceSha256=digest(root/'exchange-provenance.json'))
    if read(root/'accepted.json')!=expected:raise ValueError('HOST_M1_ACCEPTANCE_CHANGED')
    plan=read(root/'draft.json')
    if not _request(root,archived_runtime=archived_runtime).get('schemaErrorsRepairable'):
        Draft202012Validator(read(root/'schema.json')).validate(plan)
    return plan,provenance


def bind_candidate(root, candidate, authors, reference_sha, *, archived_runtime=None):
    plan,provenance=verify(root,archived_runtime=archived_runtime)
    if (digest(Path(candidate))!=provenance['responseSha256'] or
            authors!=[provenance['plannerId']] or reference_sha!=provenance['originalReferenceSha256']):
        raise ValueError('HOST_M1_CANDIDATE_BINDING_MISMATCH')
    return plan,provenance
