// Shared materials + wind injection (cheap WPO-like sway by height).
// Both materials share the wind uniform objects so one slider drives all trees.
import * as THREE from 'three';

export const wind = { time: { value: 0 }, strength: { value: 0.6 } };

export function addWind(mat, key) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = wind.time;
    sh.uniforms.uWind = wind.strength;
    sh.vertexShader = 'uniform float uTime;\nuniform float uWind;\n' + sh.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
       float baseY = position.y;
       vec3 wPhase = position;
       #ifdef USE_INSTANCING
         vec4 wPos = instanceMatrix * vec4(position, 1.0);
         baseY = wPos.y;
         wPhase = wPos.xyz;
       #endif
       float hgt = clamp(baseY / 6.0, 0.0, 1.5);
       float sway = sin(uTime * 1.6 + wPhase.x * 0.8 + wPhase.z * 0.6) * 0.12 * uWind * hgt * hgt
                  + sin(uTime * 4.2 + baseY * 2.0) * 0.02 * uWind * hgt;
       transformed.x += sway; transformed.z += sway * 0.6;`
    );
  };
  mat.customProgramCacheKey = () => 'wind_' + key;
}

export const barkMat = new THREE.MeshStandardMaterial({ color: 0x6b4a2f, roughness: 0.95 });
// White base so per-species tint via instanceColor multiplies correctly.
export const leafMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, side: THREE.DoubleSide });
addWind(barkMat, 'bark');
addWind(leafMat, 'leaf');
