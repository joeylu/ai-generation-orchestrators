# 通用 PNG / SVG 资源导入

`scripts/assets.mjs` 把图片与人工编写的语义信息导入可检索、可校验、支持增量版本的资源包。实现位于 `src/asset-library.mjs`；整个过程使用本地确定性程序，不调用模型或网络服务。

下面的命令在 `game-ui-harnesses/ui-panel-harness/` 中执行。每次导入都写入该目录内一个新的输出目录，输入素材、已有资源包与其他 Harness 保持原样。

## 准备清单

每批输入是一个 `AssetBatch 0.1` JSON，路径相对于该 JSON 所在目录解析。完整示例是 `examples/custom-assets/assets.json`，其中包含一个 SVG 图标与一张 PNG 面板背景。

```json
{
  "assetBatchVersion": "0.1",
  "namespace": "game-ui",
  "assets": [
    {
      "id": "mute",
      "version": "1.0.0",
      "file": "mute.svg",
      "name": "静音",
      "role": "icon",
      "family": "audio.mute",
      "style": "modern-mint",
      "variant": "outline",
      "tags": ["静音", "声音", "音频", "mute", "audio"],
      "size": { "width": 64, "height": 64 }
    }
  ]
}
```

`namespace/id@version` 是资源身份，例如 `game-ui/mute@1.0.0`。`namespace` 与 `id` 为字母开头的小写 slug；`version` 必须是无前导零的三段数字版本，每段最多 `1000000`。同一清单允许同一个 `id` 的多个版本，不能重复同一个完整身份。

`role` 必填，可为 `icon`、`shape`、`effect`、`layout-primitive` 或 `animation-part`。`name` 与 `tags` 由资源作者说明用途；程序不根据像素猜测含义。标签经过 NFKC、去除首尾空白、小写化与保序去重。`family`、`style`、`variant` 分别默认到当前 `id`、`custom`、`default`；这些值由描述符校验程序明确补齐。JSON Schema 中的默认值只作注释，不会自行修改数据。

每批支持 1–128 项，每项 1–32 个标签。尺寸必须显式填写，宽高各为 1–4096 的整数。PNG 的实际尺寸必须相符，SVG 按声明尺寸栅格化。`slice` 默认为 `null`，也可填写 `{ "left": 12, "top": 12, "right": 12, "bottom": 12 }`；边距以像素计，必须留下正宽度、正高度的中心区域。

`file` 只接受安全的相对 PNG/SVG 路径。绝对路径、向上穿越、反斜杠、控制字符、Windows 保留设备名以及尾空格或尾点会被拒绝。文件与所有路径祖先不能通过符号链接或 junction 转向其他位置。完整字段定义见 `schemas/asset-batch.schema.json`，程序入口为 `validateAssetBatch`。

## 首次导入与校验

```powershell
node scripts/assets.mjs import --manifest examples/custom-assets/assets.json --output output/custom-assets-v1 --id game-assets
node scripts/assets.mjs verify --library output/custom-assets-v1
node scripts/assets.mjs search --library output/custom-assets-v1 --query 静音
node scripts/assets.mjs resolve --library output/custom-assets-v1 --key game-ui/mute@1.0.0
```

命令使用已安装的本地 Sharp。默认从模块解析路径加载；需要显式指定时，可在任一命令后追加 `--sharp-module <installed-sharp-module-directory>`。命令本身不安装依赖，也不把本机模块路径写入交付物。再次执行导入时需要换一个新的 `--output`，已有目录不会被覆盖。

PNG 的原始字节保存在 `sources/<sha256>.png`，运行时使用的派生 PNG 保存在 `textures/<sha256>.png`。派生过程统一为 sRGB/RGBA，保留连续透明度，并把完全透明像素的 RGB 清零。因此运行时 PNG 的字节摘要可以与原文件不同，原件仍然保留。

SVG 原始字节保存在 `sources/<sha256>.svg`。SVG 必须先通过 `src/asset-svg.mjs` 的严格子集验证，再由本地适配器渲染。支持静态路径、矩形、圆、椭圆、线、多边形、分组、几何变换、本地线性/径向渐变，以及有限的高斯模糊。必须声明 SVG 命名空间和有效 viewBox；显式 width/height 须与清单一致。脚本、事件、DTD/实体、XML 处理指令、style/CSS、外链、image/use 和 text/字体不在支持范围。可将设计稿导出为简单路径 SVG，复杂图稿则使用 PNG。

每条记录还包含名称、标签、角色、尺寸、九宫格、源文件与运行时文件引用、独立预览以及摘要。通用库预览是无文字缩略图，名称保留在元数据中，避免系统字体影响复验。`asset-library.json` 是索引，`delivery.json` 记录包内文件和摘要。校验会检查源文件处理结果与运行时 PNG、预览的对应关系，需使用包内记录的同版本图形后端；语义审核、人工视觉审核和原生引擎验收仍分别标为 `NOT_RUN`。

## 增量版本

更新示例 `examples/custom-assets/update.json` 把静音图标添加为 `game-ui/mute@1.1.0`：

```powershell
node scripts/assets.mjs import --manifest examples/custom-assets/update.json --base output/custom-assets-v1 --output output/custom-assets-v2 --id game-assets
node scripts/assets.mjs verify --library output/custom-assets-v2
node scripts/assets.mjs search --library output/custom-assets-v2 --query 静音
node scripts/assets.mjs search --library output/custom-assets-v2 --query 静音 --all-versions
node scripts/assets.mjs resolve --library output/custom-assets-v2 --key game-ui/mute@1.0.0
```

增量导入先验证 `--base`，再合并新的完整身份。源内容与规范化元数据均相同的现有版本直接复用；变更同一版本的内容或元数据会报 `ASSET_VERSION_CONFLICT`，需要显式增加版本号。仅移动或重命名输入文件，只要字节与元数据不变，就不会改变 `namespace/id@version`，也不会制造新版本。

旧版本始终保留，未出现在本次清单中的资源归入 `changes.retained`；重复且未变的资源归入 `changes.reused`；新增身份归入 `changes.added`。复用表示新包保留旧记录与派生文件。验证旧包时仍会重新执行源处理与预览生成以检查一致性，因此复用不意味着验证阶段完全没有图片处理开销。

搜索默认只查每个 `namespace/id` 的最高数字版本，并默认 `role=icon`。先确定最新版本，再应用角色、风格和关键词过滤；不会在最新版本不匹配时自动退回旧版本。使用 `--all-versions` 可以查所有版本。结果按 `style/family` 分组，选中后用返回的完整键调用 `resolve` 固定引用，不使用 `latest` 作为可交付引用。

```powershell
node scripts/assets.mjs search --library output/custom-assets-v2 --query 面板 --role shape --style modern-mint
```

没有关键词匹配时返回空结果，不会用任意素材补位。

## 从已筛选资源库迁移

`--base` 除了通用资源包，也接受已经验证的 `curated` 纹理包。现有 `panel-core` 筛选结果共 262 项；首次迁移把这些资源保留为 `modern-mint/<旧 texture-id>@0.1.0`，同时导入本次清单。

```powershell
node scripts/assets.mjs import --manifest examples/custom-assets/assets.json --base <curated-directory> --output output/game-assets-migrated --id game-assets
```

迁移保留各项的用途分类、风格、语义标签、矢量源与有效九宫格，并生成通用索引。之后继续用这个新通用包作为 `--base` 增量导入即可。迁移不会更改旧 `curated` 目录，也不会把已经排除的品牌平台、控件示意图或演示素材重新加入生成库。

资源包提供跨引擎适配所需的稳定身份、PNG、SVG 和元数据；当前命令不生成 Unity Prefab、Cocos/Godot/UE 原生包，也不把资源自动写入 PanelSpec。

## 本地验证入口

`npm test` 使用夹具和适配器替身，无额外图片后端依赖。另提供真实 PNG Alpha 回归：

```powershell
npm run test:images -- --sharp-module <installed-sharp-module-directory>
```

该检查使用仓库内 2×2 PNG 夹具，逐通道验证透明 RGB 清零、可见 RGB 与连续 Alpha 保留，
不写回源文件。实际样例交付和验证证据见 [任务记录](tasks.md)。
