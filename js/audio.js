/**
 * audio.js — Web Audio API drum synthesizer for Drum Hero Jr.
 *
 * All drum sounds are synthesized (no audio files needed).
 * The AudioContext is created on first user interaction to satisfy
 * browser autoplay policies.
 */

class AudioEngine {
  constructor() {
    this.context = null;
    this.masterGain = null;
    this._noiseBuffer = null; // Shared white-noise buffer
  }

  /**
   * Call this once on the first user click/touch.
   * Safe to call multiple times.
   */
  init() {
    if (this.context) return;
    this.context = new (window.AudioContext || window.webkitAudioContext)();
    this.masterGain = this.context.createGain();
    this.masterGain.gain.value = 0.85;
    this.masterGain.connect(this.context.destination);
    this._noiseBuffer = this._buildNoiseBuffer();
  }

  /** Resume context if browser suspended it (e.g. after page focus change). */
  resume() {
    if (this.context && this.context.state === 'suspended') {
      this.context.resume();
    }
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  /** Build a 0.5-second buffer of white noise, reused by all noise sounds. */
  _buildNoiseBuffer() {
    const seconds = 0.5;
    const buf = this.context.createBuffer(
      1, this.context.sampleRate * seconds, this.context.sampleRate
    );
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    return buf;
  }

  /** Convenience: make an oscillator → gain → master chain. */
  _osc(type, freq, startTime, gainPeak, gainDecayEnd, decayDuration) {
    const ctx = this.context;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(gainPeak, startTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + decayDuration);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(startTime);
    osc.stop(startTime + decayDuration + 0.01);
  }

  /** Convenience: noise burst through a filter → gain → master chain. */
  _noise(filterType, filterFreq, filterQ, startTime, gainPeak, decayDuration) {
    const ctx = this.context;
    const noise = ctx.createBufferSource();
    noise.buffer = this._noiseBuffer;

    const filter = ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.value = filterFreq;
    if (filterQ !== null) filter.Q.value = filterQ;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(gainPeak, startTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + decayDuration);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);
    noise.start(startTime);
    noise.stop(startTime + decayDuration + 0.01);
  }

  // ── Drum sounds ───────────────────────────────────────────────────────────

  playKick(time) {
    const ctx = this.context;

    // Main body: sine swept from 150 Hz → 50 Hz
    const osc = ctx.createOscillator();
    const oscGain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(150, time);
    osc.frequency.exponentialRampToValueAtTime(50, time + 0.15);
    oscGain.gain.setValueAtTime(1.5, time);
    oscGain.gain.exponentialRampToValueAtTime(0.0001, time + 0.5);
    osc.connect(oscGain);
    oscGain.connect(this.masterGain);
    osc.start(time);
    osc.stop(time + 0.51);

    // Transient click (low-passed noise for attack punch)
    this._noise('lowpass', 200, null, time, 0.6, 0.06);
  }

  playSnare(time) {
    // Wire buzz: bandpass noise
    this._noise('bandpass', 2000, 0.8, time, 1.0, 0.22);
    // Body: triangle oscillator
    this._osc('triangle', 185, time, 0.6, 0, 0.12);
  }

  playHihat(time, isOpen = false) {
    const decay = isOpen ? 0.35 : 0.055;
    this._noise('highpass', 7500, null, time, 0.4, decay);
  }

  playTom(time, pitch = 'mid') {
    const ctx = this.context;
    const startFreq = { high: 250, mid: 130, low: 85 }[pitch];
    const endFreq   = { high: 130, mid:  70, low: 45 }[pitch];

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(startFreq, time);
    osc.frequency.exponentialRampToValueAtTime(endFreq, time + 0.35);
    gain.gain.setValueAtTime(1.3, time);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.45);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(time);
    osc.stop(time + 0.46);
  }

  playCrash(time) {
    this._noise('highpass', 4500, null, time, 0.7, 1.8);
    this._noise('bandpass', 9000, 0.5, time, 0.3, 1.2);
  }

  /**
   * Metronome click.
   * @param {number} time - AudioContext scheduled time
   * @param {boolean} isDownbeat - beat 1 gets a higher, louder click
   */
  playClick(time, isDownbeat = false) {
    const freq = isDownbeat ? 1400 : 900;
    const vol  = isDownbeat ? 0.45 : 0.25;
    this._osc('sine', freq, time, vol, 0, 0.04);
  }

  /**
   * Dispatch to the right synthesizer by instrument name.
   * Names match the keys used in PATTERNS.
   */
  playInstrument(name, time) {
    if (!this.context) return;
    switch (name) {
      case 'kick':     this.playKick(time);         break;
      case 'snare':    this.playSnare(time);         break;
      case 'hihat':    this.playHihat(time, false);  break;
      case 'openHihat':this.playHihat(time, true);   break;
      case 'tom':      this.playTom(time, 'mid');    break;
      case 'crash':    this.playCrash(time);         break;
    }
  }
}
