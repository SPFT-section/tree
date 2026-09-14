// Day/night cycle: REAL sun + moon, reactive sky dome, stars at night.
//
// Bodies (all procedural, no textures to download):
// - Sun: hot core sphere + two additive halo sprites (tight glow + wide
//   haze), halo swells and reddens near the horizon.
// - Moon: sphere with a procedural cratered surface (maria + rayed craters),
//   self-lit like the real night moon. It rides opposite the sun, so like
//   reality it is (near-)full whenever it is up.
// - Sky: gradient dome shader (zenith/horizon/below-horizon) with a sun
//   glow lobe that tracks the sun. Fog color still follows the same keys.
// Everything sky-bound lives in skyRig, which follows the camera — the dome
// can never be flown past, at any forest size.
// skyAt(t) is pure math (headless-testable); applyDayNight wires three objects.
import * as THREE from 'three';

export const dayState = { time: 10, cycling: true, speed: 24 / 180 }; // full day per 180s

const clamp01 = v => Math.max(0, Math.min(1, v));
const sstep = (e0, e1, x) => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};

// [hour, skyHex, hemiIntensity] — dawn/dusk warmth lives in the keys.
const KEYS = [
  [0, 0x060b16, 0.22], [4.5, 0x060b16, 0.22], [6, 0x6a5570, 0.45],
  [7, 0xd9986a, 0.62], [9, 0x9fc3e8, 0.85], [12, 0xbcd8f0, 0.95],
  [16, 0xa8c6e4, 0.9], [17.5, 0xe08a4e, 0.68], [19, 0x39496e, 0.42],
  [20.5, 0x0a1024, 0.28], [24, 0x060b16, 0.22],
];

// tiny seeded rng local to this module (stable stars + moon surface)
function mulberryLike(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const _c0 = new THREE.Color(), _c1 = new THREE.Color();

export function skyAt(t) {
  t = ((t % 24) + 24) % 24;
  let i = 0;
  while (i < KEYS.length - 2 && KEYS[i + 1][0] < t) i++;
  const [h0, bg0, he0] = KEYS[i], [h1, bg1, he1] = KEYS[i + 1];
  const k = clamp01((t - h0) / Math.max(1e-6, h1 - h0));
  _c0.setHex(bg0); _c1.setHex(bg1); _c0.lerp(_c1, k);
  const sunElev = Math.sin((t - 6) / 12 * Math.PI); // rise 6h, set 18h
  const moonElev = Math.sin((((t - 18 + 24) % 24) / 12) * Math.PI); // rise 18h, set 6h
  const sunI = 2.4 * sstep(-0.06, 0.25, sunElev);
  const sunWarm = sstep(0, 0.5, sunElev); // 0 horizon amber -> 1 noon white
  const moonI = 0.55 * sstep(-0.06, 0.2, moonElev);
  const starOp = sstep(0.06, -0.14, sunElev); // 1 when the sun is well down
  return {
    t, bg: '#' + _c0.getHexString(),
    hemiI: he0 + (he1 - he0) * k,
    sunElev, moonElev, sunI, sunWarm, moonI, starOp,
  };
}

let sun = null, hemi = null, moon = null;
let skyRig = null, dome = null, domeU = null;
let sunCore = null, sunHalo = null, sunHaze = null, moonBall = null, stars = null;
const _sunC0 = new THREE.Color(0xff8f3f), _sunC1 = new THREE.Color(0xfff2dd), _tmpC = new THREE.Color();
const _dir = new THREE.Vector3();

function radialGlowTexture(size, stops) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const c = cv.getContext('2d');
  const g = c.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [o, col] of stops) g.addColorStop(o, col);
  c.fillStyle = g;
  c.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Procedural lunar surface: gray regolith, dark maria blotches, rayed craters
// (dark bowl + bright offset rim). Seeded so it is identical every load.
function moonTexture() {
  const S = 256;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const c = cv.getContext('2d');
  const r = mulberryLike(0xc0ffee);
  c.fillStyle = '#c9c9c9';
  c.fillRect(0, 0, S, S);
  for (let i = 0; i < 14; i++) { // maria
    const x = r() * S, y = r() * S, rad = 18 + r() * 42;
    const g = c.createRadialGradient(x, y, rad * 0.2, x, y, rad);
    g.addColorStop(0, 'rgba(105,105,112,0.5)');
    g.addColorStop(1, 'rgba(105,105,112,0)');
    c.fillStyle = g;
    c.beginPath(); c.arc(x, y, rad, 0, 7); c.fill();
  }
  for (let i = 0; i < 80; i++) { // craters
    const x = r() * S, y = r() * S, rad = 2 + r() * r() * 14;
    c.fillStyle = 'rgba(90,90,96,0.55)';
    c.beginPath(); c.arc(x, y, rad, 0, 7); c.fill();
    c.strokeStyle = 'rgba(235,235,240,0.7)';
    c.lineWidth = Math.max(1, rad * 0.18);
    c.beginPath(); c.arc(x - rad * 0.15, y - rad * 0.15, rad * 0.85, Math.PI * 0.9, Math.PI * 1.9); c.fill();
    c.stroke();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function initDayNight(scene, sunLight, hemiLight) {
  sun = sunLight; hemi = hemiLight;
  moon = new THREE.DirectionalLight(0x9fb8ff, 0);
  moon.position.set(-6, 10, -4);
  scene.add(moon);

  skyRig = new THREE.Group();
  scene.add(skyRig);

  // Gradient dome + sun glow lobe.
  domeU = {
    uTop: { value: new THREE.Color(0x0b1622) },
    uHor: { value: new THREE.Color(0x0b1622) },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uSunCol: { value: new THREE.Color(0xfff2dd) },
    uGlow: { value: 1 },
  };
  dome = new THREE.Mesh(
    new THREE.SphereGeometry(1200, 32, 20),
    new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: domeU,
      vertexShader: `
        varying vec3 vDir;
        void main() {
          vDir = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        varying vec3 vDir;
        uniform vec3 uTop, uHor, uSunCol, uSunDir;
        uniform float uGlow;
        void main() {
          vec3 d = normalize(vDir);
          vec3 col = mix(uHor, uTop, pow(clamp(d.y, 0.0, 1.0), 0.55));
          col = mix(col, uHor * 0.45, clamp(-d.y * 2.5, 0.0, 1.0));
          float s = max(dot(d, normalize(uSunDir)), 0.0);
          col += uSunCol * (pow(s, 350.0) * 1.2 + pow(s, 24.0) * 0.35 * uGlow);
          gl_FragColor = vec4(col, 1.0);
        }`,
    })
  );
  dome.renderOrder = -1;
  dome.frustumCulled = false;
  skyRig.add(dome);

  // Sun: hot core + tight glow + wide haze (additive, no fog).
  sunCore = new THREE.Mesh(
    new THREE.SphereGeometry(9, 20, 14),
    new THREE.MeshBasicMaterial({ color: 0xfff8e2, fog: false })
  );
  sunCore.frustumCulled = false;
  const haloTex = radialGlowTexture(256, [
    [0, 'rgba(255,252,240,1)'], [0.25, 'rgba(255,225,160,0.55)'],
    [0.6, 'rgba(255,190,120,0.16)'], [1, 'rgba(255,180,110,0)'],
  ]);
  const hazeTex = radialGlowTexture(256, [
    [0, 'rgba(255,220,170,0.5)'], [0.5, 'rgba(255,190,130,0.14)'], [1, 'rgba(255,180,120,0)'],
  ]);
  const haloMat = (tex, op) => new THREE.SpriteMaterial({
    map: tex, blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    transparent: true, opacity: op,
  });
  sunHalo = new THREE.Sprite(haloMat(haloTex, 0.95));
  sunHaze = new THREE.Sprite(haloMat(hazeTex, 0.6));
  skyRig.add(sunCore, sunHalo, sunHaze);

  // Moon: cratered ball, self-lit (full while up — consistent with its orbit).
  moonBall = new THREE.Mesh(
    new THREE.SphereGeometry(8, 28, 20),
    new THREE.MeshBasicMaterial({ map: moonTexture(), fog: false })
  );
  moonBall.frustumCulled = false;
  skyRig.add(moonBall);

  // Star dome (inside the sky dome, follows the camera via the rig).
  const N = 600, pos = new Float32Array(N * 3);
  const r = mulberryLike(0x2b99233);
  for (let i = 0; i < N; i++) {
    const a = r() * Math.PI * 2, e = Math.asin(r() * 1.1 - 0.1);
    pos[i * 3] = Math.cos(a) * Math.cos(e) * 1000;
    pos[i * 3 + 1] = Math.sin(e) * 1000;
    pos[i * 3 + 2] = Math.sin(a) * Math.cos(e) * 1000;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  stars = new THREE.Points(g, new THREE.PointsMaterial({
    color: 0xcfdcff, size: 1.7, sizeAttenuation: false,
    transparent: true, opacity: 0, depthWrite: false, fog: false,
  }));
  stars.frustumCulled = false;
  skyRig.add(stars);

  applyDayNight(scene, dayState.time, new THREE.Vector3());
}

function placeBody(elev, azim, out) {
  out.set(Math.cos(azim), Math.max(elev, -0.4), 0.35).normalize();
  return out;
}

export function applyDayNight(scene, t, camPos) {
  const s = skyAt(t);
  _tmpC.set(s.bg);
  scene.background.set(s.bg); // fallback behind the dome
  if (scene.fog) scene.fog.color.copy(_tmpC);
  if (hemi) hemi.intensity = s.hemiI;
  if (skyRig && camPos) skyRig.position.copy(camPos);

  // Sky dome gradient follows the keys; sun lobe tracks the sun.
  _tmpC.copy(_sunC0).lerp(_sunC1, s.sunWarm);
  if (domeU) {
    domeU.uHor.value.set(s.bg);
    domeU.uTop.value.set(s.bg).offsetHSL(0.005, 0.03, -0.09);
    domeU.uSunCol.value.copy(_tmpC);
    domeU.uGlow.value = 0.25 + 0.75 * (1 - s.sunWarm * 0.4);
    placeBody(s.sunElev, (t - 6) / 12 * Math.PI, domeU.uSunDir.value);
  }

  // Sun light + visible bodies (local to the camera-following rig).
  const sunAz = (t - 6) / 12 * Math.PI;
  placeBody(s.sunElev, sunAz, _dir);
  if (sun) {
    sun.position.set(_dir.x * 60, _dir.y * 60, _dir.z * 60);
    sun.color.copy(_tmpC);
    sun.intensity = s.sunI;
  }
  const sunVis = s.sunElev > -0.12;
  for (const [o, dist] of [[sunCore, 800], [sunHalo, 800], [sunHaze, 800]]) {
    if (!o) continue;
    o.position.set(_dir.x * dist, _dir.y * dist, _dir.z * dist);
    o.visible = sunVis;
  }
  if (sunHalo) {
    const swell = 1 + (1 - sstep(-0.1, 0.45, s.sunElev)) * 1.3; // bigger at horizon
    sunHalo.scale.set(150 * swell, 150 * swell, 1);
    sunHaze.scale.set(340 * swell, 340 * swell, 1);
    sunHalo.material.opacity = 0.5 + 0.5 * (1 - s.sunWarm * 0.3);
  }
  _tmpC.setHex(0x9fb8ff);
  const tm = ((t - 18 + 24) % 24);
  placeBody(s.moonElev, tm / 12 * Math.PI, _dir);
  if (moon) {
    moon.position.set(_dir.x * 60, _dir.y * 60, _dir.z * 60);
    moon.color.copy(_tmpC);
    moon.intensity = s.moonI;
  }
  if (moonBall) {
    moonBall.position.set(_dir.x * 800, _dir.y * 800, _dir.z * 800);
    moonBall.visible = s.moonElev > -0.12;
  }
  if (stars) stars.material.opacity = s.starOp * 0.9;
  return s;
}

export function updateDayNight(scene, dt, camera) {
  if (dayState.cycling) dayState.time = (dayState.time + dt * dayState.speed) % 24;
  return applyDayNight(scene, dayState.time, camera ? camera.position : null);
}

export function fmtTime(t) {
  const h = Math.floor(t), m = Math.floor((t - h) * 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
