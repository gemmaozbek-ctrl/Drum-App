/**
 * app.js — Main application logic for Drum Hero Jr.
 *
 * Depends on:  patterns.js  → PATTERNS, INSTRUMENT_META, INSTRUMENT_ORDER
 *              audio.js     → AudioEngine
 *              rewards.js   → RewardSystem
 */

// ── Globals ───────────────────────────────────────────────────────────────────

const audio   = new AudioEngine();
const rewards = new RewardSystem();

/** Application state */
const state = {
  pattern:       null,   // currently selected pattern object
  isPlaying:     false,
  isLooping:     true,
  isPractice:    false,  // practice mode: auto-ramps BPM
  bpm:           80,
  currentStep:   -1,
  loopCount:     0,      // loops completed in current play session
  practiceBpm:   54,     // current BPM during practice mode
  activeLevel:   'all',  // which level tab is visible
};

// ── Boot ──────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  renderPatternList();
  renderBadges();
  updateStarCount();
  setupEventListeners();
  // Select the first pattern by default
  selectPattern(PATTERNS[0]);
});

// ── Pattern list ──────────────────────────────────────────────────────────────

function renderPatternList() {
  const container = document.getElementById('pattern-list');
  container.innerHTML = '';

  const visible = state.activeLevel === 'all'
    ? PATTERNS
    : PATTERNS.filter(p => p.level === Number(state.activeLevel));

  visible.forEach(p => {
    const card = buildPatternCard(p);
    container.appendChild(card);
  });
}

function buildPatternCard(p) {
  const card = document.createElement('div');
  card.className = 'pattern-card';
  card.dataset.id = p.id;
  if (state.pattern?.id === p.id) card.classList.add('selected');

  const stars  = rewards.getStars(p.id);
  const earned = '⭐'.repeat(stars) + '☆'.repeat(3 - stars);
  const levelDots = '●'.repeat(p.level) + '○'.repeat(5 - p.level);

  card.innerHTML = `
    <div class="card-emoji">${p.songEmoji}</div>
    <div class="card-name">${p.name}</div>
    ${p.artist ? `<div class="card-artist">${p.artist}</div>` : ''}
    <div class="card-level">Level ${p.level} <span class="level-dots">${levelDots}</span></div>
    <div class="card-stars">${earned}</div>
  `;

  card.addEventListener('click', () => selectPattern(p));
  return card;
}

function selectPattern(p) {
  stopPlayback();
  state.pattern     = p;
  state.loopCount   = 0;
  state.practiceBpm = Math.max(40, Math.round(p.targetBpm * 0.6));

  // Sync BPM slider to pattern target (or keep current if higher)
  setBpm(p.targetBpm);

  renderDrumGrid(p);
  updatePatternInfo(p);
  renderPatternList(); // refresh cards so selected is highlighted
}

// ── Pattern info panel ────────────────────────────────────────────────────────

function updatePatternInfo(p) {
  document.getElementById('pattern-name').textContent   = p.name;
  document.getElementById('pattern-artist').textContent = p.artist
    ? `🎵 From: "${p.song}" — ${p.artist}`
    : '';
  document.getElementById('pattern-tip').textContent    = p.tip;
  document.getElementById('target-bpm').textContent     = `Target: ${p.targetBpm} BPM`;

  // Show star rating
  const stars  = rewards.getStars(p.id);
  document.getElementById('pattern-stars').textContent =
    '⭐'.repeat(stars) + '☆'.repeat(3 - stars);
}

// ── Drum grid ─────────────────────────────────────────────────────────────────

/**
 * Renders the 16-step grid for the given pattern.
 * Rows = instruments (top: crash, bottom: kick).
 * Columns 0-15 = 16th-note steps.
 */
function renderDrumGrid(p) {
  const grid = document.getElementById('drum-grid');
  grid.innerHTML = '';

  // Which instruments does this pattern actually use?
  const rows = INSTRUMENT_ORDER.filter(key => p.instruments[key]);

  // CSS grid: label column + 16 step columns
  grid.style.gridTemplateColumns = `auto repeat(16, 1fr)`;

  // ── Header row ────────────────────────────────────────────────────────────
  // empty top-left corner
  const corner = document.createElement('div');
  corner.className = 'grid-corner';
  // Beat group labels (1, 2, 3, 4) — span 4 columns each
  // We use a sub-div trick: just render individual step labels
  grid.appendChild(corner);

  for (let s = 0; s < 16; s++) {
    const label = document.createElement('div');
    label.className = 'step-label';
    label.dataset.step = s;
    // On-beat (every 4th): show beat number; off-beat: "+"
    if (s % 4 === 0) {
      label.textContent = String(Math.floor(s / 4) + 1);
      label.classList.add('on-beat');
    } else if (s % 2 === 0) {
      label.textContent = '+';
    } else {
      label.textContent = '';
    }
    grid.appendChild(label);
  }

  // ── Instrument rows ───────────────────────────────────────────────────────
  rows.forEach(key => {
    const meta  = INSTRUMENT_META[key];
    const steps = p.instruments[key];

    // Row label
    const rowLabel = document.createElement('div');
    rowLabel.className = 'row-label';
    rowLabel.style.borderLeftColor = meta.color;
    rowLabel.innerHTML = `<span class="row-emoji">${meta.emoji}</span><span class="row-name">${meta.label}</span>`;
    grid.appendChild(rowLabel);

    // Step cells
    for (let s = 0; s < 16; s++) {
      const cell = document.createElement('div');
      cell.className = 'grid-cell';
      cell.dataset.instrument = key;
      cell.dataset.step       = s;

      if (steps[s]) {
        cell.classList.add('has-note');
        cell.style.setProperty('--note-color', meta.color);
      }
      // Shade alternate beat groups for readability
      if (Math.floor(s / 4) % 2 === 1) cell.classList.add('alt-beat');

      grid.appendChild(cell);
    }
  });
}

/** Flash the active step column and animate hit cells. */
function highlightStep(step) {
  // Clear previous
  document.querySelectorAll('.grid-cell.current-step').forEach(el => {
    el.classList.remove('current-step');
  });
  document.querySelectorAll('.step-label.current-step').forEach(el => {
    el.classList.remove('current-step');
  });

  if (step < 0) return;

  // Highlight column
  document.querySelectorAll(`.grid-cell[data-step="${step}"]`).forEach(el => {
    el.classList.add('current-step');
    if (el.classList.contains('has-note')) {
      // Trigger hit animation
      el.classList.remove('hitting');
      void el.offsetWidth; // force reflow to restart animation
      el.classList.add('hitting');
    }
  });
  document.querySelectorAll(`.step-label[data-step="${step}"]`).forEach(el => {
    el.classList.add('current-step');
  });
}

// ── Metronome / playback ──────────────────────────────────────────────────────

/**
 * Web Audio scheduling metronome.
 * Uses the "setTimeout + scheduleAheadTime" pattern to avoid timer drift
 * while keeping visual updates close to real time.
 */
class Metronome {
  constructor() {
    this.isPlaying        = false;
    this.currentStep      = 0;
    this.nextStepTime     = 0;
    this.scheduleAhead    = 0.1;  // look 100 ms ahead when scheduling audio
    this.lookahead        = 25;   // check every 25 ms
    this._timerID         = null;
    this.onStep           = null; // callback(step, audioTime)
    this.onLoopComplete   = null; // callback(loopNumber)
  }

  get stepSeconds() {
    // Duration of one 16th note = (60 / BPM) / 4
    return 60 / (state.bpm * 4);
  }

  start() {
    if (this.isPlaying) return;
    audio.init();
    audio.resume();
    this.isPlaying    = true;
    this.currentStep  = 0;
    this.nextStepTime = audio.context.currentTime + 0.05; // tiny lead-in
    this._tick();
  }

  stop() {
    this.isPlaying = false;
    clearTimeout(this._timerID);
    this.currentStep = 0;
    highlightStep(-1);
  }

  _tick() {
    if (!this.isPlaying) return;
    while (this.nextStepTime < audio.context.currentTime + this.scheduleAhead) {
      this._scheduleStep(this.currentStep, this.nextStepTime);
      this._advance();
    }
    this._timerID = setTimeout(() => this._tick(), this.lookahead);
  }

  _scheduleStep(step, time) {
    const p = state.pattern;
    if (!p) return;

    // Play drum hits
    Object.entries(p.instruments).forEach(([inst, steps]) => {
      if (steps[step]) audio.playInstrument(inst, time);
    });

    // Metronome click on quarter notes (every 4th 16th-note step)
    if (step % 4 === 0) {
      audio.playClick(time, step === 0);
    }

    // Schedule visual update — delay matches audio lead-time
    const visualDelay = Math.max(0, (time - audio.context.currentTime) * 1000);
    setTimeout(() => {
      if (this.isPlaying) {
        highlightStep(step);
        if (this.onStep) this.onStep(step, time);
      }
    }, visualDelay);
  }

  _advance() {
    this.nextStepTime += this.stepSeconds;
    this.currentStep++;
    if (this.currentStep >= 16) {
      this.currentStep = 0;
      state.loopCount++;

      // Fire loop-complete a tiny bit before the downbeat hits visually
      const delay = Math.max(0, (this.nextStepTime - audio.context.currentTime) * 1000 - 50);
      setTimeout(() => {
        if (this.isPlaying && this.onLoopComplete) {
          this.onLoopComplete(state.loopCount);
        }
      }, delay);
    }
  }
}

const metronome = new Metronome();

metronome.onLoopComplete = (loopNum) => {
  handleLoopComplete(loopNum);
};

// ── Playback control ──────────────────────────────────────────────────────────

function handleLoopComplete(loopNum) {
  if (!state.pattern) return;

  const p = state.pattern;

  // Practice mode: ramp up BPM each loop
  if (state.isPractice) {
    const step = Math.max(4, Math.round(p.targetBpm * 0.05)); // ~5% each loop
    const next = Math.min(state.bpm + step, p.targetBpm);
    if (next !== state.bpm) {
      setBpm(next);
      showToast(`🐢 Speed up! ${next} BPM`);
    }
    // Award 3 stars when we hit the target
    if (state.bpm >= p.targetBpm && loopNum >= 2) {
      stopPlayback();
      grantReward(p.id, 3, true);
      return;
    }
  }

  // Normal mode: award stars after 2 full loops
  if (!state.isPractice && loopNum === 2) {
    const stars = state.bpm >= p.targetBpm ? 2 : 1;
    grantReward(p.id, stars, false);

    if (!state.isLooping) stopPlayback();
  }
}

function startPlayback() {
  if (!state.pattern) {
    showToast('Pick a pattern first!');
    return;
  }
  audio.init();
  doCountIn(() => {
    state.isPlaying = true;
    state.loopCount = 0;
    metronome.start();
    setPlayingUI(true);
  });
}

function stopPlayback() {
  state.isPlaying = false;
  metronome.stop();
  setPlayingUI(false);
}

function toggleLoop() {
  state.isLooping = !state.isLooping;
  const btn = document.getElementById('loop-btn');
  btn.classList.toggle('active', state.isLooping);
  btn.textContent = state.isLooping ? '↺ Loop: ON' : '↺ Loop: OFF';
}

function startPracticeMode() {
  if (!state.pattern) { showToast('Pick a pattern first!'); return; }
  state.isPractice = true;
  const minBpm     = Math.max(40, Math.round(state.pattern.targetBpm * 0.6));
  setBpm(minBpm);
  showToast(`🐢 Practice Mode! Starting at ${minBpm} BPM`);
  startPlayback();
}

function stopPracticeMode() {
  state.isPractice = false;
  setBpm(state.pattern?.targetBpm ?? 90);
}

// ── Count-in ──────────────────────────────────────────────────────────────────

/**
 * Shows a "3 … 2 … 1 … GO!" overlay with metronome clicks, then calls onDone.
 */
function doCountIn(onDone) {
  audio.init();
  const overlay = document.getElementById('count-overlay');
  const numEl   = document.getElementById('count-number');
  overlay.classList.remove('hidden');

  const beatMs = (60 / state.bpm) * 1000;
  let count    = 3;
  const ctx    = audio.context;

  // Schedule audio clicks for the count-in now
  [0, 1, 2].forEach(i => {
    audio.playClick(ctx.currentTime + (i * beatMs) / 1000, true);
  });

  numEl.textContent = String(count);
  numEl.classList.remove('pop');
  void numEl.offsetWidth;
  numEl.classList.add('pop');

  const tick = setInterval(() => {
    count--;
    if (count === 0) {
      numEl.textContent = 'GO! 🎉';
      numEl.classList.remove('pop');
      void numEl.offsetWidth;
      numEl.classList.add('pop');
      clearInterval(tick);
      setTimeout(() => {
        overlay.classList.add('hidden');
        onDone();
      }, beatMs * 0.8);
    } else {
      numEl.textContent = String(count);
      numEl.classList.remove('pop');
      void numEl.offsetWidth;
      numEl.classList.add('pop');
    }
  }, beatMs);
}

// ── BPM ───────────────────────────────────────────────────────────────────────

function setBpm(bpm) {
  state.bpm = bpm;
  const slider  = document.getElementById('bpm-slider');
  const display = document.getElementById('bpm-display');
  slider.value  = bpm;
  display.textContent = bpm;
  // Colour the turtle/rocket emoji hint
  const hint = document.getElementById('bpm-hint');
  if (hint) hint.textContent = bpm < 80 ? '🐢' : bpm < 120 ? '🎵' : '🚀';
}

// ── Rewards UI ────────────────────────────────────────────────────────────────

function grantReward(patternId, stars, isPracticeDone) {
  const { newStars, earnedBadges } = rewards.awardStars(
    patternId, stars, { practiceDone: isPracticeDone }
  );

  updateStarCount();
  renderPatternList();
  updatePatternInfo(state.pattern);
  renderBadges();

  showRewardModal(stars, earnedBadges);
}

function showRewardModal(stars, earnedBadges) {
  const modal     = document.getElementById('reward-modal');
  const emojiEl   = document.getElementById('reward-emoji');
  const titleEl   = document.getElementById('reward-title');
  const msgEl     = document.getElementById('reward-message');
  const badgeArea = document.getElementById('reward-badges');

  const messages3 = ['You\'re a drumming superstar! 🌟', 'Incredible! You nailed it! 🏆', 'You rock the whole stage! 🎸'];
  const messages2 = ['Awesome drumming! 👏', 'You\'re getting so good! 🎉', 'Great job! Keep going! 💪'];
  const messages1 = ['You did it! 🎊', 'First time complete! ⭐', 'Nice work, drummer! 🥁'];

  const pools = { 3: messages3, 2: messages2, 1: messages1 };
  const pool  = pools[stars] || messages1;
  const msg   = pool[Math.floor(Math.random() * pool.length)];

  emojiEl.textContent = '⭐'.repeat(stars);
  titleEl.textContent = msg;
  msgEl.textContent   = stars === 3
    ? 'You used Practice Mode and reached full speed!'
    : stars === 2
    ? `You played at ${state.bpm} BPM — that\'s the target!`
    : 'You listened through the whole pattern!';

  if (earnedBadges.length) {
    badgeArea.innerHTML = earnedBadges
      .map(b => `<div class="new-badge">${b.emoji} <strong>${b.name}</strong></div>`)
      .join('');
    badgeArea.classList.remove('hidden');
  } else {
    badgeArea.classList.add('hidden');
  }

  modal.classList.remove('hidden');
}

function updateStarCount() {
  const el = document.getElementById('total-stars');
  if (el) el.textContent = rewards.getTotalStars();
}

function renderBadges() {
  const container = document.getElementById('badges-container');
  if (!container) return;
  container.innerHTML = '';
  rewards.getAllBadges().forEach(b => {
    const el = document.createElement('div');
    el.className = 'badge-item' + (b.earned ? ' earned' : ' locked');
    el.title     = b.desc;
    el.innerHTML = `<span class="badge-emoji">${b.earned ? b.emoji : '🔒'}</span>
                    <span class="badge-label">${b.name}</span>`;
    container.appendChild(el);
  });
}

// ── Level filter ──────────────────────────────────────────────────────────────

function setActiveLevel(level) {
  state.activeLevel = level;
  document.querySelectorAll('.level-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.level === String(level));
  });
  renderPatternList();
}

// ── Toast notification ────────────────────────────────────────────────────────

let _toastTimer = null;
function showToast(msg) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = msg;
  toast.classList.remove('hidden', 'fade-out');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => {
    toast.classList.add('fade-out');
    setTimeout(() => toast.classList.add('hidden'), 500);
  }, 2500);
}

// ── UI state helpers ──────────────────────────────────────────────────────────

function setPlayingUI(playing) {
  const playBtn = document.getElementById('play-btn');
  playBtn.textContent    = playing ? '⏸ PAUSE' : '▶ PLAY!';
  playBtn.classList.toggle('playing', playing);
  document.getElementById('practice-btn').disabled = playing;
  document.getElementById('bpm-slider').disabled   = playing && !state.isPractice;
}

// ── Event listeners ───────────────────────────────────────────────────────────

function setupEventListeners() {
  // Play / pause
  document.getElementById('play-btn').addEventListener('click', () => {
    if (state.isPlaying) { stopPlayback(); } else { startPlayback(); }
  });

  // Loop toggle
  document.getElementById('loop-btn').addEventListener('click', toggleLoop);

  // Practice mode
  document.getElementById('practice-btn').addEventListener('click', () => {
    if (state.isPractice) {
      stopPracticeMode();
      stopPlayback();
      showToast('Practice mode off');
    } else {
      startPracticeMode();
    }
  });

  // BPM slider
  const slider = document.getElementById('bpm-slider');
  slider.addEventListener('input', () => {
    setBpm(Number(slider.value));
  });

  // Level filter buttons
  document.querySelectorAll('.level-btn').forEach(btn => {
    btn.addEventListener('click', () => setActiveLevel(btn.dataset.level));
  });

  // Reward modal close
  document.getElementById('reward-close').addEventListener('click', () => {
    document.getElementById('reward-modal').classList.add('hidden');
  });

  // Close modal on outside click
  document.getElementById('reward-modal').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) {
      e.currentTarget.classList.add('hidden');
    }
  });
}
