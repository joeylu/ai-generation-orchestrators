"""Shared prompt rules for new warning-policy runs, independent of sample IDs."""

VERSION = 'ui-visual-prompt-contract-v1'

OWNERSHIP = '''
视觉提示词规范 ui-visual-prompt-contract-v1：
逐个可见对象建立唯一归属和实例数量。父底板只拥有自身连续表面、边框及明确归属的装饰；
分配给子图层的卡片、按钮、图标、槽轨、填充和插画不得再烘焙到父板中。
清除其他归属的内容时，只补全本素材自己的表面，保留自身孔洞与半透明区域。
参考裁框用于定位，不能当作裁切蒙版；不以裁框内出现的全部内容作为本素材的内容。
'''

APPEARANCE = '''
逐素材描述并核对主体底色、显著渐变方向、描边、材质、完整外轮廓及附属部件。
完整插画保留内部可辨结构和相对位置；眼白、实体浅色块、孔洞与表面高光分开识别。
高光、反射、阴影、渐变、倒角是所属表面的渲染属性，不额外命名成独立对象。
同类实例逐项记录状态、朝向和数量，不从类别常识补造细节，不把多个实例复制成一个答案。
'''

GENERATION = OWNERSHIP + APPEARANCE + '''
只生成本次指定素材，严格使用其 keep/exclude 和状态说明。
单素材请求输出一张完整 PNG；合板请求按冻结格位逐个放置指定素材，每个主体只出现一次。
前景与合板使用原生透明 alpha，保留全部实体与柔边，不画棋盘格或不透明背景。
参考完整主体的宽高比例和内部布局；透明留白大小不代表主体尺寸。
不把单个素材切片或拼接重构，不单轴拉伸；最终统一缩放和平移由程序归位。
输出前按唯一归属、数量、完整轮廓、状态、比例五项自查，避免重复、缺件和位移。
warning 是后续报告处置方式，生成目标仍为基本还原原图。
'''

DISPOSITION = '''
如实记录差异及证据，保留 minor/major/uncertain 的真实判断，不为通过而降级或省略。
程序把本政策下所有模型视觉发现记录为 warning，继续整图回拼，最终由人工比较原图验收。
共享参考合同中“阻断/必须修正”等视觉处置措辞在本次由 v5 warning 政策覆盖；
仍填写真实观察与建议，不自行宣布通过或失败。结构化字段及证据绑定要求保持有效。
技术输入、摘要、schema、回执、alpha 与几何测量完整性由程序校验，模型不得宣称这些已经通过。
'''

REVIEW = OWNERSHIP + APPEARANCE + '''
所属表面内部的高光、光泽、渐变或倒角变化填 style/other；
extra-artwork 仅指新增可辨对象或独立内容，说明其独立轮廓与归属依据，不能仅凭多一个光点判定。
表面变化与新增对象无法区分时填 uncertain，并写明不确定依据。
重复、遗漏、归属、状态、形状和位置问题仍逐项报告；不因为使用 warning 政策就填空 findings。
''' + DISPOSITION

BODY = '''
本次使用视觉 warning 政策：materialIssues 记录所有可见外观或内容差异，包含 major/uncertain，
不以局部风格、光泽或可测量比例差异停止观察。保留真实证据，不移动测量边缘以迎合拟合阈值。
issues 仅记录无法可靠完成主体对应和测量的原因；boundaryStatus=complete 只能在完整主体边界
及对应关系确实可辨时填写。无法识别、主体实心裁断或缺失使对应关系不可建立时，仍填 uncertain/not-whole
并使用 null 框。不得假造完整主体框。原生 alpha 支持检查和完整存储规则保持有效。
'''

BODY_SUPPORT = '''
Also report outsideBodySupport on all four unique sides: none, external-soft-effect,
owned-artwork or uncertain, with concrete evidence. Distinguish the visible complete
body from its antialiasing fringe, external shadows/glow, sparse faint alpha residue
and identifiable independent artwork. An opacity preview alone cannot establish
ownership. Use external-soft-effect only for observed shadows/glow; do not relabel
owned-artwork or uncertainty as a shadow to pass.
Under this v5 policy, exterior classification, opacity, disconnected exterior
components and anchor-envelope coverage mismatches are visual warnings. Record their actual classification and
appearance/content concerns in materialIssues. They alone do not require issues,
null boxes or uncertain/not-whole if complete-body correspondence is reliable.
issues remains reserved for inability to establish or measure that correspondence.
Measure the actual complete body, including its solid outlines and internal symbols;
never anchor only an inner icon, move an edge to pass a threshold, or enlarge the
body to absorb faint residue or shadows. The program still requires a solid core
inside the body. It measures all alpha>=240 pixels outside the body plus its frozen
native margin and records the actual count and sides as warnings; high opacity alone
does not prove that an exterior pixel is owned solid artwork. Do not claim pixel
checks passed. Every nonzero alpha pixel,
including exterior owned-artwork or uncertain residue, remains stored unchanged;
there is no alpha cleanup or body-mask crop. Final appearance awaits human review.
'''
