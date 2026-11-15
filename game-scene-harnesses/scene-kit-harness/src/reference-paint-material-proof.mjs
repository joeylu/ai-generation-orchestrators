import { inspectPng, encodeRgbaPng } from './png.mjs';
import { hash, jsonBytes, seal } from './generation/common.mjs';
import { paintSourceReviewFiles } from './reference-paint-proof.mjs';

export function materialPaintReviewFiles(plan,bytes,base,material,guide,coverage) {
  const proof=paintSourceReviewFiles(plan,bytes,base),files=proof.files;
  files.delete('proof-bundle.json');
  const image=inspectPng(files.get('source-normalized-unmasked.png'),{includePixels:true}),marked=Buffer.from(image.rgba);
  for(const p of coverage.probes) for(let dy=-3;dy<=3;dy++) for(let dx=-3;dx<=3;dx++) {
    const x=p.x+dx,y=p.y+dy;
    if(x>=0&&y>=0&&x<image.width&&y<image.height&&(Math.abs(dx)===3||Math.abs(dy)===3))marked.set([255,30,130,255],(y*image.width+x)*4);
  }
  const template={probes:coverage.probes.map(p=>({probeId:p.probeId,verdict:'uncertain',notes:'Pending visual material and footprint review.'})),
    regions:coverage.regions.map(region=>({region,verdict:'uncertain',notes:'Review the complete core, paint halo and material boundary, not just sampled pixels.'}))};
  files.set('coverage-proposal.json',jsonBytes(coverage)); files.set('coverage-observation-template.json',jsonBytes(template));
  files.set('coverage-points.png',encodeRgbaPng(image.width,image.height,marked)); files.set('material-guide.png',guide);
  files.set('README.md',Buffer.from('# 三输入绘制源覆盖审阅\n\n先查看未遮罩源、材质引导及关键点坐标；粉色方框仅定位，不属于源。coverage-proposal.json 的 RGBA 是程序取样，不是材质判定。模板默认全部 uncertain，需逐个核对部件及主体/木/雪/完整交界区域；任何失败或未定项均禁止接受来源和应用Alpha。按准确覆盖提案提交独立审阅后，再审来源外观与准确应用。无自动擦灰、删枝、原图回填或分割模型。\n'));
  const report=seal({format:'ai_scene_material_paint_review_v1',planSha256:plan.sha256,rawSha256:coverage.rawSha256,
    baseReviewSha256:proof.report.sha256,materialControlsSha256:material.sha256,coverageProposalSha256:coverage.sha256,
    alphaApplied:false,coverageAcceptance:'not-assessed',sourceArtAcceptance:'not-assessed',generationCalls:0});
  files.set('report.json',jsonBytes(report));
  const bundle=seal({format:'ai_scene_material_paint_review_bundle_v1',reportSha256:report.sha256,
    artifacts:[...files].map(([path,b])=>({path,sha256:hash(b),byteLength:b.length})),generationCalls:0});
  files.set('proof-bundle.json',jsonBytes(bundle)); return {files,report,bundle};
}
