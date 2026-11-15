import {Shader,Buffer,BufferUsage,compileHighShaderGlProgram,compileHighShaderGpuProgram,
  localUniformBit,localUniformBitGl,textureBit,textureBitGl,roundPixelsBit,roundPixelsBitGl} from 'pixi.js';
import {validateMeshCoverage} from '../mesh-coverage.mjs';

let programs;
export function attachVertexCoverage(geometry,data){
  if(!validateMeshCoverage(data))throw Error('Vertex coverage is required');
  geometry.addAttribute('aCoverage',{buffer:new Buffer({data:new Float32Array(data.vertexCoverage),
    usage:BufferUsage.VERTEX|BufferUsage.COPY_DST}),format:'float32',stride:4,offset:0});
}
export function createVertexCoverageShader(texture){
  programs??={
    glProgram:compileHighShaderGlProgram({name:'scene-linear-coverage',bits:[localUniformBitGl,textureBitGl,roundPixelsBitGl,
      {name:'scene-coverage',vertex:{header:'in float aCoverage;',main:'vColor *= aCoverage;'}}]}),
    gpuProgram:compileHighShaderGpuProgram({name:'scene-linear-coverage',bits:[localUniformBit,textureBit,roundPixelsBit,
      {name:'scene-coverage',vertex:{header:'@in aCoverage: f32;',main:'vColor *= aCoverage;'}}]}),
  };
  texture.textureMatrix.update();
  return new Shader({...programs,resources:{uTexture:texture.source,uSampler:texture.source.style,
    textureUniforms:{uTextureMatrix:{type:'mat3x3<f32>',value:texture.textureMatrix.mapCoord}}}});
}
