import * as THREE from 'three';
import { BG_GLSL } from './shaders.js';

export function createBackground() {
  const mat = new THREE.ShaderMaterial({
    depthTest: false,
    depthWrite: false,
    uniforms: {},
    vertexShader: /* glsl */ `
      varying vec2 vNdc;
      void main() { vNdc = position.xy; gl_Position = vec4(position.xy, 1.0, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      varying vec2 vNdc;
      ${BG_GLSL}
      float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
      void main() {
        vec3 c = bgColor(vNdc);
        // плёночное зерно + дизеринг против бэндинга
        float g = hash(gl_FragCoord.xy) - 0.5;
        c += g * (1.4 / 255.0) + g * 0.012 * c;
        gl_FragColor = vec4(pow(max(c, 0.0), vec3(2.2)), 1.0);
        #include <colorspace_fragment>
      }
    `,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -100;
  return mesh;
}
