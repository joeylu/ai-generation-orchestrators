"""Bind new small-material boundary reviews to their source-pixel evidence."""
import json


def schema():
    """Transport-safe boundary entry; cross-field and dynamic checks run in Python."""
    return {'type':'object','additionalProperties':False,
            'required':['status','evidence','sourceBox','omittedSourcePixel'],
            'properties':{
                'status':{'type':'string','enum':['complete','clipped','uncertain']},
                'evidence':{'type':'string','minLength':1},
                'sourceBox':{'type':'array','minItems':4,'maxItems':4,
                             'items':{'type':'integer'}},
                'omittedSourcePixel':{'type':['array','null'],'minItems':2,'maxItems':2,
                                      'items':{'type':'integer'}}}}


def uses_bound_schema(review_schema):
    """Recognize the new stored schema without changing historical review policy."""
    definitions=review_schema.get('$defs',{})
    boundaries=[]
    for key in ('smallMaterialAuditEntry','smallBoundaryAuditEntry'):
        entry=definitions.get(key)
        if entry is not None:
            boundaries.append(entry['properties']['boundary'])
    if not boundaries:return False
    names={'sourceBox','omittedSourcePixel'}
    marked=[bool(names.intersection(boundary.get('properties',{})) or
                 names.intersection(boundary.get('required',[])))
            for boundary in boundaries]
    if not any(marked):return False
    if not all(marked) or any(not names.issubset(boundary.get('properties',{})) or
                              not names.issubset(boundary.get('required',[]))
                              for boundary in boundaries):
        raise ValueError('PARTIAL_BOUND_SMALL_REVIEW_SCHEMA')
    return True


def guidance(focus):
    """Give the model exact original-image coordinates for every focused material."""
    rows=[{'materialId':item['materialId'],'sourceBox':item['sourceBox'],
           'contextBox':item['contextBox']}
          for item in focus['items']+focus['boundaryOnlyItems']]
    return ('\n小素材轮廓坐标依据（均为原图像素，框为左上包含、右下不包含的半开区间）：'
            +json.dumps(rows,ensure_ascii=False,separators=(',',':'))
            +'\n每个 boundary.sourceBox 必须逐整数原样回填对应 sourceBox；不得从 bboxNorm 重新换算或取整，'
            '不得使用放大图、屏幕显示、标签或观察区坐标。clipped 时 omittedSourcePixel 必须是'
            '原图可见且归本素材、处于对应 contextBox 内而在 sourceBox 外的一个原图像素 [x,y]；'
            'complete 和 uncertain 时填 null。无法确认轮廓或像素归属时填 uncertain，'
            '不得靠坐标或文字证据把疑问判成 complete。\n')


def _integers(value, length):
    return (isinstance(value,list) and len(value)==length and
            all(type(number) is int for number in value))


def _contains(box, point):
    return box[0]<=point[0]<box[2] and box[1]<=point[1]<box[3]


def validate_boundaries(review, focus):
    """Reject unbound claims before assessment, repair, or a successful review node."""
    if not isinstance(focus,dict):
        raise ValueError('SMALL_BOUNDARY_FOCUS_REQUIRED')
    expected={}
    for field,audit in (('smallMaterialAudit',focus['items']),
                        ('smallBoundaryAudit',focus['boundaryOnlyItems'])):
        for item in audit:
            mid=item['materialId']
            if mid in expected:raise ValueError('DUPLICATE_SMALL_BOUNDARY_FOCUS')
            expected[mid]=(field,item)
    actual={}
    for field in ('smallMaterialAudit','smallBoundaryAudit'):
        entries=review.get(field,{})
        if not isinstance(entries,dict):raise ValueError('INVALID_BOUND_SMALL_AUDIT_FORMAT')
        for mid,entry in entries.items():
            if mid in actual:raise ValueError('DUPLICATE_SMALL_BOUNDARY_AUDIT')
            actual[mid]=(field,entry)
    if set(actual)!=set(expected) or any(actual[mid][0]!=expected[mid][0] for mid in expected):
        raise ValueError('SMALL_BOUNDARY_AUDIT_IDS_REQUIRED')
    for mid,(_,item) in expected.items():
        entry=actual[mid][1]
        if not isinstance(entry,dict):raise ValueError('INVALID_BOUND_SMALL_AUDIT_FORMAT')
        boundary=entry.get('boundary')
        if not isinstance(boundary,dict):raise ValueError('SMALL_BOUNDARY_REQUIRED:'+mid)
        source=item['sourceBox'];context=item['contextBox']
        if not _integers(source,4) or not _integers(context,4) or not (
                0<=context[0] and 0<=context[1] and
                context[0]<=source[0]<source[2]<=context[2] and
                context[1]<=source[1]<source[3]<=context[3]):
            raise ValueError('INVALID_SMALL_BOUNDARY_FOCUS:'+mid)
        if boundary.get('sourceBox')!=source or not _integers(boundary.get('sourceBox'),4):
            raise ValueError('SMALL_BOUNDARY_SOURCE_BOX_MISMATCH:'+mid)
        if 'omittedSourcePixel' not in boundary:
            raise ValueError('SMALL_BOUNDARY_OMITTED_PIXEL_FIELD_REQUIRED:'+mid)
        point=boundary.get('omittedSourcePixel')
        if boundary.get('status')=='clipped':
            if not _integers(point,2):
                raise ValueError('SMALL_BOUNDARY_OMITTED_PIXEL_REQUIRED:'+mid)
            if not _contains(context,point):
                raise ValueError('SMALL_BOUNDARY_OMITTED_PIXEL_OUTSIDE_CONTEXT:'+mid)
            if _contains(source,point):
                raise ValueError('SMALL_BOUNDARY_OMITTED_PIXEL_INSIDE_CROP:'+mid)
        elif boundary.get('status') in ('complete','uncertain'):
            if point is not None:
                raise ValueError('UNEXPECTED_SMALL_BOUNDARY_OMITTED_PIXEL:'+mid)
        else:
            raise ValueError('INVALID_SMALL_BOUNDARY_STATUS:'+mid)
