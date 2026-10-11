"""Versioned prompt projection of explicit ownership; never edits source catalogs.

This is deliberately a limited clause projection, not semantic label rewriting.
Only a declared foreign identity in an explicit assembly/occlusion suffix is
removed. Unrecognized wording remains reference evidence, subject to review.
"""
import re


_DIRECTIVE = re.compile(
    r'\b(?:keep|preserve|draw|render|copy|generate|retain|delete|remove|must|should)\b'
    r'|保留|删除|绘制|生成|复制|必须|应该|请', re.I)
_HEAD_END = re.compile(
    r'[，,；;。.!?！？\n:]|位于|处于|放在|置于|覆盖|遮挡|为|呈|带有|配有|包含'
    r'|\s+(?:with|at|on|under|behind|above|below|sits?|lies?|is|has|and)\b', re.I)
_ASSEMBLY = re.compile(
    r'由|被|(?:带有|配有|附有|包含)(?:独立|另属)|不含|不包含'
    r'|\b(?:covered\s+by|occluded\s+by|overlaid\s+by|overlapping\s+with|'
    r'without|excluding|with\s+(?:(?:a|an|the)\s+)?(?:separate(?:ly\s+owned)?|independent(?:ly\s+owned)?))\b',
    re.I)
_LOCATION_ONLY = re.compile(
    r'^(?:其|在|的|右端|左端|上端|下端|顶部|底部|上方|下方|左侧|右侧|表面|中心|中部|边缘|端部|\s)*$'
    r'|^(?:(?:its|the)\s+)?(?:right|left|upper|lower|top|bottom)?\s*(?:end|side|surface|edge)?$', re.I)
_CLAUSES = re.compile(r'([，,；;。!?！？\n]|\.(?=\s|$))')


def readable(identifier):
    return re.sub(r'[_\-\s]+', ' ', re.sub(r'(?<=[a-z0-9])(?=[A-Z])', ' ', identifier)).strip()


def visual_name(item):
    """Use a short nominal head as DELETE identity, never foreign instructions."""
    label = item['appearance'].strip()
    head = _HEAD_END.split(label, maxsplit=1)[0].strip()
    if not head or len(head) > 80 or len(head.split()) > 12 or _DIRECTIVE.search(head):
        return readable(item.get('objectId', item.get('id', 'object')))
    return head


def _identity(text):
    # Normalize grammar only for matching; never rewrite drawing descriptions.
    # Match the complete nominal head, not a generic final word such as "edge".
    text=re.sub(r'\b(?:a|an|the|separate|separately|independent|independently|owned)\b',
                '',text,flags=re.I)
    return re.sub(r'\s+',' ',text.casefold().replace('色','')).strip()


def _mentions(text, names):
    return any(_identity(name) and _identity(name) in _identity(text) for name in names)


def _foreign_suffix(text, names):
    value=_identity(text)
    for name in names:
        identity=_identity(name)
        if not identity:continue
        match=re.search(r'(?:^|\s|独立|另属)'+re.escape(identity)+
                        r'(?:\s*(?:覆盖|遮挡|叠加))?\s*$',value)
        if match:return True
    return False


def owned_appearance(item, foreign, siblings=()):
    """Drop only an explicit foreign assembly suffix, retaining owned clauses."""
    label = item['appearance']
    names = [visual_name(row) for row in foreign]
    sibling_names = [visual_name(row) for row in siblings
                     if row.get('objectId', row.get('id')) != item.get('objectId', item.get('id'))]
    pieces = _CLAUSES.split(label)
    result = []
    changed = False
    for index in range(0, len(pieces), 2):
        clause = pieces[index]
        delimiter = pieces[index+1] if index+1 < len(pieces) else ''
        for match in _ASSEMBLY.finditer(clause):
            tail = clause[match.end():]
            if _foreign_suffix(tail, names) and not _mentions(tail, sibling_names):
                prefix = clause[:match.start()].rstrip()
                clause = '' if _LOCATION_ONLY.fullmatch(prefix) else prefix
                changed = True
                break
        if clause.strip():
            result.append(clause+delimiter)
    if not changed:
        return label
    return ''.join(result).strip(' ，,；;。.!?！？\n') or visual_name(item)


def project(owned, foreign):
    """Copy only model-facing fields; frozen ownership/geometry stay untouched."""
    return [{**item, 'appearance': owned_appearance(item, foreign, owned)} for item in owned]


SCOPE_RULE = (
    'KEEP descriptions below describe only owned artwork. DELETE names are visual identifiers, '
    'never objects to preserve. An assembled reference is evidence of the owned substrate, '
    'not a target to reproduce as a complete control. For a removed overlay, return the complete '
    'owned substrate with its existing surface continued through the occluded area; '
    'no foreign disk, handle, outline, shadow, recess or duplicate may remain.')

EDIT_SCOPE_RULE = (
    'KEEP descriptions identify only original owned artwork. DELETE names identify elements to remove, '
    'never elements to keep. Remove the assigned foreign units from the reference while preserving '
    'the original KEEP subject, its contours, appearance, openings and translucency. '
    'A parent keeps its own substrate and decorations; separately assigned children and foreign backing '
    'are absent. Descriptive text does not change ownership.')
