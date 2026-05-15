/**
 * phase2.js — Microphone hit detection + timing evaluation for Drum Hero Jr.
 *
 * HitDetector     — accesses the mic, detects percussive transients via RMS
 * TimingEvaluator — matches detected hits to expected beat-step windows
 */

// ── HitDetector ─────────────────────────────────────────────────────────────────────────────

class HitDetector {
  constructor() {
    this.isActive    = false;
    /** RMS amplitude threshold (0-1). Lower = more sensitive. */
    this.sensitivity = 0.09;
    /** Seconds to ignore after a hit (prevents double-triggers). */
    this.cooldownSec = 0.12;

    this._audioCtx  = null;
    this._stream    = null;
    this._analyser  = null;
    this._buffer    = null;
    this._prevRms   = 0;
    this._coolUntil = 0;
    this._rafId     = null;

    /** callback(audioContextTime) — fired on each detected hit. */
    this.onHit   = null;
    /** callback(rms 0–1) — fired every frame, use for VU meter. */
    this.onLevel = null;
    /** callback() — fired every frame after level/hit checks. */
    this.onTick  = null;
  }

  /**
   * Request microphone access and start polling.
   * Throws if the user denies permission.
   */
  async start(audioContext) {
    if (this.isActive) return;
    this._audioCtx = audioContext;

    this._stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      video: false,
    });

    this._analyser = audioContext.createAnalyser();
    this._analyser.fftSize = 512;
    this._analyser.smoothingTimeConstant = 0; // raw signal — we want transients
    this._buffer = new Float32Array(this._analyser.fftSize);

    // Highpass to cut low-frequency rumble (reduces false triggers from kick/bass)
    const hp = audioContext.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 120;

    const src = audioContext.createMediaStreamSource(this._stream);
    src.connect(hp);
    hp.connect(this._analyser);
    // Deliberately NOT connected to destination — no feedback loop

    this.isActive = true;
    this._poll();
  }

  _poll() {
    if (!this.isActive) return;

    this._analyser.getFloatTimeDomainData(this._buffer);

    // RMS energy of this frame
    let sum = 0;
    for (let i = 0; i < this._buffer.length; i++) {
      sum += this._buffer[i] * this._buffer[i];
    }
    const rms = Math.sqrt(sum / this._buffer.length);

    if (this.onLevel) this.onLevel(Math.min(1, rms * 7));

    // Rising-edge detection: rms crosses threshold upward and cooldown elapsed
    const now = this._audioCtx.currentTime;
    if (rms >= this.sensitivity && this._prevRms < this.sensitivity && now >= this._coolUntil) {
      this._coolUntil = now + this.cooldownSec;
      if (this.onHit) this.onHit(now);
    }
    this._prevRms = rms;

    if (this.onTick) this.onTick();

    this._rafId = requestAnimationFrame(() => this._poll());
  }

  stop() {
    this.isActive = false;
    if (this._rafId) cancelAnimationFrame(this._rafId);
    if (this._stream) this._stream.getTracks().forEach(t => t.stop());
    this._stream   = null;
    this._analyser = null;
  }
}

// ── TimingEvaluator ─────────────────────────────────────────────────────────────────────────────

class TimingEvaluator {
  constructor() {
    /**
     * Open evaluation windows, keyed by step number.
     * Each: { centerAt, openAt, closeAt, claimedOffsetMs }
     */
    this._windows = new Map();

    /** Collected results for the current loop. */
    this.results = [];

    // Timing thresholds (seconds)
    this.windowSec  = 0.28; // ±280ms total acceptance window
    this.perfectSec = 0.08; // |offset| ≤ 80ms  → green (perfect)
    this.closeSec   = 0.20; // |offset| ≤ 200ms → yellow (close), else red (miss)

    this._audioCtx = null;

    /** callback(step, verdict) fired when a window is evaluated. */
    this.onResult = null;
  }

  setAudioContext(ctx) { this._audioCtx = ctx; }

  /**
   * Register an expected hit for a step.
   * Call this when the metronome schedules a step that contains drum notes.
   * @param {number} step  - 0-15 step index
   * @param {number} audioTime - AudioContext time of the beat
   */
  openWindow(step, audioTime) {
    this._windows.set(step, {
      centerAt:        audioTime,
      openAt:          audioTime - this.windowSec,
      closeAt:         audioTime + this.windowSec,
      claimedOffsetMs: null,
    });
  }

  /**
   * Try to match a detected hit against an open window.
   * Claims the nearest unclaimed window within range.
   * @param {number} hitTime - AudioContext time of the detected hit
   * @returns {number|null} matched step, or null
   */
  processHit(hitTime) {
    let bestStep = null;
    let bestDist = Infinity;

    for (const [step, win] of this._windows) {
      if (win.claimedOffsetMs !== null) continue;
      if (hitTime < win.openAt || hitTime > win.closeAt) continue;
      const dist = Math.abs(hitTime - win.centerAt);
      if (dist < bestDist) { bestDist = dist; bestStep = step; }
    }

    if (bestStep !== null) {
      const win = this._windows.get(bestStep);
      win.claimedOffsetMs = (hitTime - win.centerAt) * 1000;
      // Fire visual feedback immediately — don't wait for the window to expire
      const absMs = Math.abs(win.claimedOffsetMs);
      const verdict = absMs <= this.perfectSec * 1000 ? 'perfect'
                    : absMs <= this.closeSec   * 1000 ? 'close'
                    : 'miss';
      win._verdict = verdict;
      if (this.onResult) this.onResult(bestStep, verdict);
    }
    return bestStep;
  }

  /**
   * Expire windows whose close-time has passed.
   * Call this regularly (e.g. every animation frame via HitDetector.onTick).
   */
  tick() {
    if (!this._audioCtx) return;
    const now = this._audioCtx.currentTime;
    for (const [step, win] of this._windows) {
      if (now > win.closeAt + 0.04) {
        this._evaluate(step, win);
        this._windows.delete(step);
      }
    }
  }

  /** Force-evaluate and close all remaining windows (call at loop end). */
  flushAll() {
    for (const [step, win] of this._windows) {
      this._evaluate(step, win);
    }
    this._windows.clear();
  }

  _evaluate(step, win) {
    let verdict, offsetMs;
    if (win.claimedOffsetMs === null) {
      verdict  = 'miss';
      offsetMs = null;
    } else {
      offsetMs = win.claimedOffsetMs;
      const absMs = Math.abs(offsetMs);
      verdict = absMs <= this.perfectSec * 1000 ? 'perfect'
              : absMs <= this.closeSec   * 1000 ? 'close'
              : 'miss';
    }
    this.results.push({ step, verdict, offsetMs });
    // Only call onResult for misses — hits were already reported immediately in processHit
    if (!win._verdict && this.onResult) this.onResult(step, verdict);
  }

  /** Summary stats for completed results. */
  getScore() {
    const total   = this.results.length;
    const perfect = this.results.filter(r => r.verdict === 'perfect').length;
    const close   = this.results.filter(r => r.verdict === 'close').length;
    const misses  = this.results.filter(r => r.verdict === 'miss').length;
    return { total, perfect, close, misses, hits: perfect + close };
  }

  reset() {
    this._windows.clear();
    this.results = [];
  }
}
