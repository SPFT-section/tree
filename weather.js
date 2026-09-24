import * as THREE from 'three';
import { wind } from './materials.js';
import { mulberry32 } from './rng.js';

const MAX_PARTICLES = 700;
const WEATHER_LABELS = Object.freeze({
  clear: 'Clear',
  cloudy: 'Overcast',
  rain: 'Rain',
  storm: 'Thunderstorm',
  fog: 'Dense fog',
  snow: 'Snow',
});

export function createWeather(scene) {
  const random = mulberry32(0x72a4b913);
  const positions = new Float32Array(MAX_PARTICLES * 6);
  const particles = [];
  for (let i = 0; i < MAX_PARTICLES; i++) {
    particles.push({
      x: (random() - 0.5) * 90,
      y: random() * 45,
      z: (random() - 0.5) * 90,
      speed: 9 + random() * 10,
      drift: random() * TAU,
    });
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const material = new THREE.LineBasicMaterial({
    color: 0xb9d7e5,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    fog: true,
  });
  const mesh = new THREE.LineSegments(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 5;
  scene.add(mesh);
  return {
    scene,
    mesh,
    particles,
    kind: 'clear',
    intensity: 0,
    windSpeed: 1.5,
    label: WEATHER_LABELS.clear,
  };
}

const TAU = Math.PI * 2;

export function setWeather(weather, kind, intensity = 0, windSpeed = 1.5) {
  weather.kind = WEATHER_LABELS[kind] ? kind : 'clear';
  weather.intensity = Math.max(0, Math.min(1, intensity));
  weather.windSpeed = Math.max(0, Math.min(15, windSpeed));
  weather.label = WEATHER_LABELS[weather.kind];
  const visible = weather.intensity > 0.02 && weather.kind !== 'clear' && weather.kind !== 'cloudy';
  weather.mesh.visible = visible;
  weather.mesh.material.color.setHex(weather.kind === 'snow' ? 0xf2f6f7 : 0xaacbdc);
  weather.mesh.material.opacity = weather.kind === 'snow' ? 0.68 * weather.intensity : 0.42 * weather.intensity;
}

export function updateWeather(weather, dt, camera) {
  wind.strength.value = 0.25 + weather.windSpeed * 0.13;
  const fog = weather.scene.fog;
  if (fog) {
    const far = weather.kind === 'storm' ? 100 : weather.kind === 'rain' ? 135 : weather.kind === 'snow' ? 165 : weather.kind === 'fog' ? 65 : weather.kind === 'cloudy' ? 185 : 225;
    fog.near = weather.kind === 'fog' ? 5 : far * 0.12;
    fog.far += (far - fog.far) * Math.min(1, dt * 0.8);
  }
  if (!weather.mesh.visible || !camera) return;
  const position = weather.mesh.geometry.attributes.position;
  const snow = weather.kind === 'snow';
  const count = Math.max(1, Math.floor(MAX_PARTICLES * weather.intensity));
  weather.mesh.geometry.setDrawRange(0, count * 2);
  for (let i = 0; i < count; i++) {
    const particle = weather.particles[i];
    particle.y -= particle.speed * dt * (snow ? 0.22 : 1);
    particle.x += (weather.windSpeed * 0.55 + Math.sin(weather.mesh.material.opacity * 10 + particle.drift) * 0.8) * dt;
    if (snow) particle.z += Math.sin(performance.now() * 0.001 + particle.drift) * dt * 0.7;
    const dx = camera.position.x - particle.x;
    const dz = camera.position.z - particle.z;
    if (dx > 45) particle.x -= 90;
    else if (dx < -45) particle.x += 90;
    if (dz > 45) particle.z -= 90;
    else if (dz < -45) particle.z += 90;
    if (particle.y < camera.position.y - 16) {
      particle.y = camera.position.y + 28 + (i % 9) * 1.7;
      particle.x = camera.position.x + ((i * 37) % 90) - 45;
      particle.z = camera.position.z + ((i * 53) % 90) - 45;
    }
    const length = snow ? 0.12 : 0.8 + weather.intensity * 1.2;
    const offset = i * 6;
    position.array[offset] = particle.x;
    position.array[offset + 1] = particle.y;
    position.array[offset + 2] = particle.z;
    position.array[offset + 3] = particle.x - weather.windSpeed * 0.035 * length;
    position.array[offset + 4] = particle.y + length;
    position.array[offset + 5] = particle.z;
  }
  position.needsUpdate = true;
}

export function disposeWeather(weather) {
  if (!weather) return;
  weather.scene.remove(weather.mesh);
  weather.mesh.geometry.dispose();
  weather.mesh.material.dispose();
}

export function weatherLabel(kind) {
  return WEATHER_LABELS[kind] || WEATHER_LABELS.clear;
}
