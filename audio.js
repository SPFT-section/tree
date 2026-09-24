import { mulberry32 } from './rng.js';

const clampVolume = value => Math.max(0, Math.min(0.45, value));

export function createGameAudio() {
  let context = null;
  let master = null;
  let windGain = null;
  let rainGain = null;
  let noiseSource = null;
  let unlocked = false;
  let desiredWeather = { kind: 'clear', intensity: 0, windSpeed: 1.4 };
  let underwater = false;

  function build() {
    if (context) return;
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    context = new AudioContext();
    master = context.createGain();
    master.gain.value = 0.45;
    master.connect(context.destination);
    const random = mulberry32(0x6a09e667);
    const buffer = context.createBuffer(1, context.sampleRate * 3, context.sampleRate);
    const data = buffer.getChannelData(0);
    let previous = 0;
    for (let i = 0; i < data.length; i++) {
      const white = random() * 2 - 1;
      previous = previous * 0.82 + white * 0.18;
      data[i] = previous * 0.7;
    }
    noiseSource = context.createBufferSource();
    noiseSource.buffer = buffer;
    noiseSource.loop = true;
    const windFilter = context.createBiquadFilter();
    windFilter.type = 'lowpass';
    windFilter.frequency.value = 520;
    const rainFilter = context.createBiquadFilter();
    rainFilter.type = 'highpass';
    rainFilter.frequency.value = 1700;
    windGain = context.createGain();
    rainGain = context.createGain();
    windGain.gain.value = 0.035;
    rainGain.gain.value = 0;
    setWeather(desiredWeather.kind, desiredWeather.intensity, desiredWeather.windSpeed);
    setUnderwater(underwater);
    noiseSource.connect(windFilter).connect(windGain).connect(master);
    noiseSource.connect(rainFilter).connect(rainGain).connect(master);
    noiseSource.start();
  }

  function unlock() {
    build();
    if (context?.state === 'suspended') context.resume();
    unlocked = true;
  }

  function tone(frequency, duration, type = 'sine', volume = 0.08, endFrequency = frequency) {
    if (!unlocked || !context || !master) return;
    const now = context.currentTime;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(Math.max(30, frequency), now);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(30, endFrequency), now + duration);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(clampVolume(volume), now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    oscillator.connect(gain).connect(master);
    oscillator.start(now);
    oscillator.stop(now + duration + 0.02);
  }

  function burst(duration, volume, frequency) {
    if (!unlocked || !context || !master) return;
    const length = Math.max(1, Math.floor(context.sampleRate * duration));
    const buffer = context.createBuffer(1, length, context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length);
    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const gain = context.createGain();
    filter.type = 'bandpass';
    filter.frequency.value = frequency;
    gain.gain.value = volume;
    source.buffer = buffer;
    source.connect(filter).connect(gain).connect(master);
    source.start();
  }

  function play(name) {
    if (name === 'step') burst(0.09, 0.035, 170);
    else if (name === 'gather') burst(0.16, 0.055, 430);
    else if (name === 'mine') burst(0.2, 0.07, 260);
    else if (name === 'hit') {
      burst(0.12, 0.08, 520);
      tone(110, 0.1, 'square', 0.045, 70);
    } else if (name === 'damage') tone(72, 0.32, 'sawtooth', 0.08, 42);
    else if (name === 'bow') burst(0.08, 0.055, 950);
    else if (name === 'craft') {
      tone(330, 0.18, 'triangle', 0.045, 440);
      window.setTimeout(() => tone(520, 0.22, 'triangle', 0.035, 660), 110);
    } else if (name === 'discover') {
      tone(440, 0.3, 'sine', 0.04, 660);
      window.setTimeout(() => tone(660, 0.36, 'sine', 0.035, 880), 130);
    } else if (name === 'craft_fire') {
      burst(0.45, 0.05, 700);
      tone(180, 0.4, 'triangle', 0.035, 320);
    } else if (name === 'objective') {
      tone(392, 0.25, 'sine', 0.035, 523);
      window.setTimeout(() => tone(523, 0.3, 'sine', 0.03, 659), 150);
    } else if (name === 'ui') tone(240, 0.06, 'sine', 0.018, 280);
  }

  function setWeather(kind, intensity, windSpeed) {
    desiredWeather = { kind, intensity, windSpeed };
    if (!context || !windGain || !rainGain) return;
    const now = context.currentTime;
    const wind = 0.018 + clampVolume(windSpeed * 0.008);
    const rain = ['rain', 'storm'].includes(kind) ? clampVolume(intensity * 0.11) : kind === 'snow' ? clampVolume(intensity * 0.018) : 0;
    windGain.gain.setTargetAtTime(wind, now, 0.5);
    rainGain.gain.setTargetAtTime(rain, now, 0.4);
  }

  function setUnderwater(value) {
    underwater = !!value;
    if (!context || !master) return;
    master.gain.setTargetAtTime(value ? 0.18 : 0.45, context.currentTime, 0.25);
  }

  function dispose() {
    if (noiseSource) noiseSource.stop();
    context?.close();
    context = null;
    unlocked = false;
  }

  return { unlock, play, setWeather, setUnderwater, dispose };
}
