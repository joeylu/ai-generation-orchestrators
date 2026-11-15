# Pixi 消费适配 v1

自 0.3.0 起提供独立入口 `ai-scene-kit-contracts/pixi`，当前 0.14.0 支持按节点外观解析和曲线/混合 Mesh，对应
[`src/pixi/scene-view.mjs`](../src/pixi/scene-view.mjs)。当前尚未发布标签/不可变制品，
不声明已在目标消费项目安装或通过其 Scene Loader 验收。

输入必须是经 Node 核心验证/重放的 `ai_scene_compiled_v1/v2/v3`，以及消费方已准备好的 Pixi
纹理。适配不自行加载文件、不访问网络、不推导地形规则，不替代资产摘要校验。

```js
import { createSceneView } from 'ai-scene-kit-contracts/pixi';

// scene：由核心编译或由 openSceneExport 验证后的场景。
// preparedTextures：宿主资源准备阶段填入的 Map<assetId, Texture>。
const view = createSceneView({
  resolveTexture: assetId => preparedTextures.get(assetId),
});
view.update(scene);
viewport.addChild(view.root);

function updateCamera() {
  view.setCamera({
    center: viewport.center,
    visible: viewport.getVisibleBounds(),
    preview: true,
  });
}
viewport.on('moved', updateCamera);
viewport.on('zoomed', updateCamera);
updateCamera();

// 离开场景时解除宿主事件；纹理由资源准备方管理。
function dispose() {
  viewport.off('moved', updateCamera);
  viewport.off('zoomed', updateCamera);
  view.destroy();
}
```

目标项目若要求通过 Scene Loader 管理资源，应在其资源准备阶段建立纹理映射，再把
纹理传入适配；不要把本地 Studio 的 `Assets.load` 复制进玩法层。Studio 自己的
加载器仅加载已验证快照的同源 PNG，不是消费项目的 Scene Loader 实现。

API：

| 成员 | 行为 |
| --- | --- |
| root | 置于 pixi-viewport 内的 Container；HUD 留在 viewport 外 |
| update(scene) | 按编译顺序重建图层与 Sprite/TilingSprite/曲线 Mesh，逻辑坐标和尺寸不重新解释；缺纹理时拒绝替换旧视图 |
| setCamera({center,visible,preview}) | 刷新视差和可见横向条带；镜头及 visible 都使用逻辑世界单位 |
| setHiddenLayers(Set) | 临时隐藏图层，不改作者文档或编译结果 |
| destroy() | 释放自身场景树，不销毁宿主共享纹理 |

0.9.0 的可选 `resolveCurveMaterial(curve)` 返回 `{body,cap}` 两张 Texture，或以空值
选择工程色。渲染使用核心已经编译好的 MeshGeometry，不重新插值；几何由适配释放，
纹理由宿主管理。宿主须设置 body 双轴重复、cap 横轴重复/纵轴钳制和线性采样。
全部曲线材质也在替换旧视图前解析。坐标/弧长 UV、v2 兼容及试样来源边界见
[曲线合同](curves-v1.md)。导出仍不携带外部试样纹理，不能将此预览当作正式 kit。

0.11.0 中，同一 resolveCurveMaterial 也接收 v3 mixedTerrains 项，以 patchId 标识，
包含 source.curveIds/gridCells；其几何完全来自核心。视图只替换这些关联节点，
未关联图块照常呈现。连通平台整块换为统一材质网格的视觉边界见
[混合合同](mixed-terrain-v1.md)，不把这个变化隐藏在 v1/v2 编译结果里。

0.8.0 可传入可选 `resolveNodeTexture(node)`，返回纹理时优先用于该节点；返回
null/undefined 时沿用 `resolveTexture`。每个节点分别解析，不能按基础 assetId 缓存，
因为同一基础资产在不同世界格需要不同相位。新视图全部资源解析成功后才替换旧树；
解析抛错或缺纹理会保留旧视图。适配器仍不下载资源或修改编译来源。

同入口导出纯函数 `terrainStudyTextureKey(node)`：非地形节点返回 null；仅接受完整
归一化签名、整数世界格、64×64/1:1、无偏移的声明几何，返回如 `p11-blob-007` 的
稳定键。负坐标使用正模，镜头、随机 seed 和地图宽度不参与。宿主必须从已验证的
连续取样快照准备纹理，缺键时明确抛错，不能静默换成任意相位。

这是试样预览扩展，不修改 `ai_scene_compiled_v1` 或基础 kit/rules 身份。编译 JSON
和原目录导出不携带这个外观；若要跨项目复现，须另行验证和提供外观来源及相位规则。
当前本地使用见 [Studio 说明](studio-v1.md)，尚无正式美术 kit 或目标项目安装证据。

0.16.0 的显式 kit v2 / compiled v4 则把地形相位与曲线材质变成包本身的数据，
无需上述外部外观覆盖。loadTerrainMaterial(scene.terrainMaterial, loadTexture) 返回
统一采样配置的 body/cap，传给 resolveCurveMaterial。缺少声明材质时 v4 曲线
拒绝呈现，不能悄悄降级成工程色。普通节点直接使用编译出的实际 PNG。
参见 [自包含候选合同](candidate-kit-v2.md) 和
[可执行消费例子](../examples/consume-scene.mjs)。该例子的 loadSourceTexture
由消费项目的资源准备阶段实现；world/viewport 及 dispose 挂到其场景生命周期，
不引入宿主文件路径、远程提供商或新的 Scene Loader。例子经过合成挂载/释放回归，
并未在目标项目实际安装。

普通节点应用编译好的 position/size。条带按 `sourceToLogical` 的等价尺寸缩放纹理，
覆盖当前视窗，纹理相位始终锚定编译位置；视窗移动不会以新左边界重新开始图案。
本版条带在 X 方向双向重复，Y 保持节点位置和单张逻辑高度，不自动纵向重复或补画。

视差锚定文档默认镜头中心：图层偏移为
`(当前镜头中心 - 默认中心) * (1 - parallax)`，适配根仍接受 viewport 统一变换。
`preview:false` 时关闭额外偏移，供编辑坐标对齐；`parallax=1` 的地形始终跟随世界。
变更镜头、隐藏层或预览模式不写回作者文档。

适配与 Studio 共用一份呈现实现，浏览器实际验证缩放后的画刷、环境拖动、组合、
纯预览与保存打开；远距离条带相位和视差还有独立数值回归。未实测超大场景、分块
加载/卸载、纹理 atlas、任意透视、触控惯性或正式美术像素接缝。
