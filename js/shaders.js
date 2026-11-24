// Общие куски GLSL: студийное окружение (cube) и градиент фона.

export const ENV_GLSL = /* glsl */ `
uniform samplerCube uEnv;
uniform mat3 uEnvRot;
vec3 envSample(vec3 d, float lod) { return textureLod(uEnv, uEnvRot * d, lod).rgb; }
`;

// Градиент фона в display-пространстве (значения сняты с референса).
// ndc: -1..1, y вверх.
export const BG_GLSL = /* glsl */ `
vec3 bgColor(vec2 ndc) {
  float nx = ndc.x * 0.5 + 0.5;
  float ny = 0.5 - ndc.y * 0.5;           // 0 сверху, 1 снизу
  float s = ny + 0.09 * (nx - 0.5);
  float v = 0.89 * pow(smoothstep(0.26, 0.92, s), 1.3);
  vec3 tint = mix(vec3(0.80, 0.95, 1.06), vec3(0.985, 0.995, 1.0), smoothstep(0.0, 0.8, v));
  return clamp(vec3(v) * tint, 0.0, 1.0);
}
`;
