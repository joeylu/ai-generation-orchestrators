import { Filter, GlProgram, GpuProgram, defaultFilterVert } from 'pixi.js';

const fragment = `
in vec2 vTextureCoord;
uniform sampler2D uTexture;
uniform vec4 uRed;
uniform vec4 uGreen;
uniform vec4 uBlue;
out vec4 finalColor;
void main() {
  vec4 pixel = texture(uTexture, vTextureCoord);
  vec4 rgb = vec4(pixel.rgb / max(pixel.a, 0.000001), 1.0);
  vec3 adjusted = vec3(dot(uRed, rgb), dot(uGreen, rgb), dot(uBlue, rgb));
  finalColor = vec4(clamp(adjusted, 0.0, 1.0) * pixel.a, pixel.a);
}`;

const gpuSource = `
struct Frame {
  uInputSize: vec4<f32>, uInputPixel: vec4<f32>, uInputClamp: vec4<f32>,
  uOutputFrame: vec4<f32>, uGlobalFrame: vec4<f32>, uOutputTexture: vec4<f32>,
};
struct Appearance { uRed: vec4<f32>, uGreen: vec4<f32>, uBlue: vec4<f32> };
struct Vertex { @builtin(position) position: vec4<f32>, @location(0) uv: vec2<f32> };
@group(0) @binding(0) var<uniform> frame: Frame;
@group(0) @binding(1) var uTexture: texture_2d<f32>;
@group(0) @binding(2) var uSampler: sampler;
@group(1) @binding(0) var<uniform> appearanceUniforms: Appearance;
@vertex fn mainVertex(@location(0) quad: vec2<f32>) -> Vertex {
  let world = quad * frame.uOutputFrame.zw + frame.uOutputFrame.xy;
  let clip = vec2<f32>(world.x * 2.0 / frame.uOutputTexture.x - 1.0,
    (world.y * 2.0 / frame.uOutputTexture.y - 1.0) * frame.uOutputTexture.z);
  return Vertex(vec4<f32>(clip, 0.0, 1.0), quad * frame.uOutputFrame.zw * frame.uInputSize.zw);
}
@fragment fn mainFragment(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
  let pixel = textureSample(uTexture, uSampler, uv);
  let rgb = vec4<f32>(pixel.rgb / max(pixel.a, 0.000001), 1.0);
  let adjusted = vec3<f32>(dot(appearanceUniforms.uRed, rgb), dot(appearanceUniforms.uGreen, rgb), dot(appearanceUniforms.uBlue, rgb));
  return vec4<f32>(clamp(adjusted, vec3<f32>(0.0), vec3<f32>(1.0)) * pixel.a, pixel.a);
}`;

export function createAppearanceFilter(matrix) {
  const [red, green, blue] = matrix;
  return new Filter({
    glProgram: GlProgram.from({ vertex: defaultFilterVert, fragment, name: 'scene-appearance' }),
    gpuProgram: GpuProgram.from({ vertex: { source: gpuSource, entryPoint: 'mainVertex' }, fragment: { source: gpuSource, entryPoint: 'mainFragment' } }),
    resources: { appearanceUniforms: {
      uRed: { value: red, type: 'vec4<f32>' }, uGreen: { value: green, type: 'vec4<f32>' }, uBlue: { value: blue, type: 'vec4<f32>' },
    } },
  });
}
