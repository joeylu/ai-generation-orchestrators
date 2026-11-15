# 新地形的职责、来源与完整画刷交付

`coherent init` 默认采用 `explicit-terrain-completion-required-v2`，程序入口通过
同名 `terrainIntentPolicy` 选项启用。旧项目和冻结计划不迁移、不改请求字节。
该版本把“没有模板波浪”和“有完整可编辑收口”分开核验，不改变碰撞几何或美术接受。

## 冻结前：登记用途与暴露边界

每个 ground scope 的 `terrainIntent` 使用 `reference-terrain-intent-v2`，保留
v1 的 `contour` 和 `notes`，新增 `usage`：

- `material-study`：明确只研究连续材质或有限的轮廓修订，不宣称完整周边。
- `complete-brush`：用于可任意涂画的地形，必须携带 `perimeter`。已冻结的完整
  画刷来源修订不能删除意图、降回 v1 或改成 material-study 绕过检查。

`perimeter` 是 `{surfaceFamily, items}`。`surfaceFamily` 明确选 `natural` 或
`engineered-city`；不能根据素材名称自动判断。`items` 必须恰好各有一个：
`left-wall`、`right-wall`、`left-top-corner`、`right-top-corner`、`bottom-edge`、
`left-bottom-corner`、`right-bottom-corner`。每项格式为：

```json
{
  "role": "left-wall",
  "content": "该来源负责的物理形体、材质延续和必要端头，说明不可见部分的设计假设。",
  "exclusions": ["明确由相邻来源负责的内容"],
  "sourceAppearance": {
    "format": "ai_scene_source_appearance_v1",
    "profile": "source-owned-appearance-v1",
    "rules": ["从本次参考与材质提取的局部颜色、覆盖物、光照和笔触规则。"]
  }
}
```

通用的是职责和边界判定，具体外形由参考决定。工业边可保持直线并有装甲厚度、
倒角；自然边可能是裸岩、雪层或土层，不预设草/苔藓。左右光照和可见面分别描述，
不能镜像另一侧或把顶沿旋转成底边。连续顶面/body 仍由现有材质来源负责；七项
补足外露收口，不重复生成整座平台。多个 ground 共用材质时须有相同完整意图。

## 素材完成后：准确七项计划

整体参考先完成审核，当前基础来源批次的材质及所有环境来源均须完成技术回收。
如果材质先到，可以独立量测采样范围、检查短台和开口，并准备七项职责对照。
正式包边预览仍需当前基础批次齐备。随后：

```text
node scripts/coherent.mjs terrain-source-review --root PROJECT --batch-id ID --out NEW_JSON
node scripts/coherent.mjs terrain-freeze --root PROJECT --batch-id ID --proposal-sha PROPOSAL_SHA
node scripts/terrain-edges.mjs compute-review --workflow PROJECT/workflow --batch BATCH_SHA --out NEW_DIRECTORY
```

首两步是零调用。预览与冻结逐字匹配登记的七个 brief 和 appearance，并绑定当前
基础来源批次、原图及实际材质。固定选用 full-perimeter、bounded-native-4m 和
visible-alpha8-outward16-native-rgba；natural 另选 reference-defined-cover，保留
本次参考的覆盖物。职责有变化先修订来源计划，再重新预览/冻结，不改旧记录。

新的人造地形包边在 `terrain-source-review` 和 `terrain-freeze` 都加上
`--manufactured-material-profile reference-defined-manufactured-v1`。
七类原生边件的正面材质、接缝、表面过渡和附属细节由审核过的场景参考、
技术校验过的原生材质和逐项职责共同约束。冻结前核对七项提示词与实际材质
一致。省略该参数时保留历史人造包边的编译行为。

实际生成复用 `terrain-edges authorize / reserve / receive / stop-unknown`：
先展示 compute-review 的准确批次摘要，取得新的单次授权；每项持久预约后最多
调用一次，失败或未知即停。CLI 本身不调用模型，原来源授权不会自动授权这七项。
新计划的 [Alpha=1 边缘警告](terrain-edge-canvas-gutter-v1.md) 会随原始素材回收记录。
符合规则的素材保留原 PNG，继续该批次。
准备、计划、合成回归均不代表真实生图。原 PNG、失败 QA 和独立人类审查保留。

## 实际来源校准与交付

完整画刷的 `surface-review --terrain-rendering JSON` 使用：

```json
{
  "profile": "intent-bound-native-perimeter-v1",
  "terrainIntentSha256": "<完整 terrainIntent 的 digest>"
}
```

继续测量原有 surface observations；七个原生源的端头、内侧接缝、重复窗口和
尺度按[周边合同](terrain-bottom-edges-v1.md)测量，不复制其他样本坐标。
`deliver --terrain JSON` 的 JSON 包含 `{batchSha256, controls}`，可选
`footprintPolicy`。`controls` 使用现有原生 API：要求
`gridProfile: grid-solid-union-native-v1`、
`materialProfile: union-world-body-local-surface-v1`、`junctions` 和 `bottom`；
`bottom` 明确绑定 `nativeSizeProfile: bounded-native-4m-v1` 和
`renderEnvelopeProfile: visible-alpha8-outward16-native-rgba-v1`，不能混用旧尺寸控制。
其他控制项继续通过原生完整校验。参考尺寸预算和所需最小笔画仍应独立预检。

```text
node scripts/coherent.mjs deliver --root PROJECT --composition COMPOSITION_JSON --terrain TERRAIN_JSON --delivery DELIVERY
node scripts/coherent.mjs verify --root PROJECT --delivery DELIVERY
node scripts/coherent.mjs continue --root PROJECT --composition COMPOSITION_JSON --terrain TERRAIN_JSON --delivery DELIVERY --capture true
```

缺少 perimeter 输入时 driver 返回 `awaiting-terrain-perimeter`。包边接收与接缝
标定完成后，`continue` 可接收上述数据直接交付并打开 Studio 截图。来源计算、
作者标定和整景美术决定各自保留证据。
核验至少包括七项职责、当前基础批次、实际来源 brief/appearance、原生尺寸配置、
技术回收、完整拼接控制和派生重放。拿其他批次或四侧素材冒充七项不能通过。

`DELIVERY.base` 保留仅含材质的可重放基础候选，并在 terrain-intent 证据中标记
`perimeterComplete: false`；`DELIVERY` 保存既有原生边角交付，另由生产程序写入
`coherent-brush.json` 绑定当前项目、完整意图、基础候选、拼接参数与最终交付摘要。
验证会重放两者；两目录均须保留。不要手写或修补该证据。最终 kit 使用原生并集
地形，不能同时叠加 shared-field 声称兼容。material-study 仍采用 v1 shared-field
渲染参数，并明确其能力限制。

离线回归分别以工业板材、裸露自然岩层验证主流程门禁、原生交付、绘制及撤销。
真实美术还需检查自由端、上下接触、凹角、窄柱、开口、重复周期和实际 Studio：
内部接触不留外边，暴露处有收口，空洞保持空。合成通过不能保证模型画对或替代
最终人类美术接受；本规则也不会自动补全已有样本缺失的七张 PNG。
