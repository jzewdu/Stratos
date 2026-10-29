import { AIRCRAFT_SPECS, CONTROL_LEVELS } from '../aircraft/specs.js';
import { TIME_PRESETS } from '../world/sky.js';
import { QUALITY_LEVELS, QUALITY_SETTINGS } from '../core/quality.js';
import { pad } from '../core/utils.js';

const ENV_PRESETS = ['dawn', 'day', 'golden', 'night'];

const CONTROLS_HTML = `    <div class="key-grid">
    <div><span>Guns</span><b>V / LMB</b></div>
    <div><span>Pitch</span><b>W / S</b></div>
    <div><span>Roll</span><b>A / D</b></div>
    <div><span>Rudder</span><b>Q / E</b></div>
    <div><span>Throttle</span><b>SHIFT / CTRL</b></div>
    <div><span>Wheel brakes</span><b>SPACE</b></div>
    <div><span>Landing gear</span><b>G</b></div>
    <div><span>Flaps</span><b>F</b></div>
    <div><span>Landing light</span><b>L</b></div>
    <div><span>Camera</span><b>C</b></div>
    <div><span>Time of day</span><b>T</b></div>
    <div><span>Sound</span><b>M</b></div>
    <div><span>Restart</span><b>R</b></div>
    <div><span>Controls</span><b>H</b></div>
    <div><span>Park at bay 01 stand</span><b>P</b></div>
    <div><span>Pause</span><b>ESC</b></div>
  </div>
  <p class="help-note">Hangar starts begin in bay 01, just inside the doors, nose-out. Taxi to the ramp with <b>SHIFT/CTRL</b>; steer with <b>Q/E</b> and use <b>SPACE</b> to stop. For takeoff, line up on runway 14, hold <b>SHIFT</b>, and ease back at rotation speed. To park, stop on the marked bay 01 stand with gear down and press <b>P</b>. In a dogfight, put the green pipper on the bandit and fire with <b>V</b> or the left mouse button.</p>
  <p class="help-note">Airframe models: Cessna 182T by VTX, B-2 by CloudHubOmniTeam, F-22 by NLM (Sketchfab, CC-BY). Cessna model is CC-BY-NC-SA — personal use only.</p>
`;

export class UI {
  constructor(root, callbacks) {
    this.root = root;
    this.callbacks = callbacks || {};
    this.selection = null;
    this.spec = null;
    this.toastTimer = null;
    this.screens = {};
    this.build();
    this.wire();
  }

  build() {
    this.root.innerHTML = `
      <div id="loading" class="screen loading-screen">
        <div class="load-content">
          <div class="load-kicker">FLIGHT SYSTEMS / INITIALISING</div>
          <h1 class="load-logo">STRATOS</h1>
          <div class="load-bar"><div id="load-fill"></div></div>
          <div class="load-bottom">
            <span id="load-text">Calibrating altimeters…</span>
            <span id="load-percent">0%</span>
          </div>
          <div class="load-foot">HYPER-REAL FLIGHT · THREE AIRFRAMES · ONE SKY</div>
        </div>
      </div>

      <div id="menu" class="screen menu-screen hidden">
        <div class="menu-gradient"></div>
        <header class="menu-header">
          <div class="brand">
            <div class="brand-rule"></div>
            <h1>STRATOS</h1>
            <p>HYPER-REAL FLIGHT SIMULATOR</p>
          </div>
          <div class="menu-meta">
            <span class="live-dot"></span>
            <span>WORLD ONLINE</span>
            <span class="meta-sep"></span>
            <span>OCT 2026</span>
          </div>
        </header>

        <main class="menu-main">
          <aside class="panel hangar-panel">
            <div class="panel-head"><span>01</span> AIRFRAME</div>
            <div id="aircraft-list" class="aircraft-list"></div>
            <div class="aircraft-info">
              <p id="aircraft-blurb" class="aircraft-blurb"></p>
              <div id="spec-strip" class="spec-strip"></div>
            </div>
            <div class="panel-foot">
              <span class="foot-mark"></span>
              REAL-WORLD AIRFRAMES · CC-BY CREDITS
            </div>
          </aside>

          <div class="menu-center">
            <div class="menu-coords">
              <span id="coord-field">SCOTT AFB · 38°33'N 89°50'W</span>
              <span id="coord-weather">ILLINOIS · VIS 30 KM · WIND 320/09</span>
            </div>
          </div>

          <aside class="panel setup-panel">
            <div class="panel-head"><span>02</span> FLIGHT PLAN</div>

            <div class="field-block">
              <label class="field-label">CONDITIONS</label>
              <div class="env-presets" id="env-presets">
                ${ENV_PRESETS.map(
                  (key) =>
                    `<button class="env-btn" data-env="${key}"><i class="env-dot ${key}"></i>${TIME_PRESETS[key].label}</button>`
                ).join('')}
              </div>
              <div class="time-control">
                <div class="time-readout"><span id="time-label">LOCAL TIME</span><b id="time-readout">18:00</b></div>
                <input id="time-slider" class="time-slider" type="range" min="0" max="24" step="0.05" value="18.02" />
                <div class="time-scale"><span>00</span><span>06</span><span>12</span><span>18</span><span>24</span></div>
              </div>
            </div>

            <div class="field-block">
              <label class="field-label">CONTROL LEVEL</label>
              <div class="segmented three" id="control-levels">
                ${Object.values(CONTROL_LEVELS)
                  .map(
                    (level) =>
                      `<button data-control="${level.id}"><b>${level.name}</b><span>${level.label}</span></button>`
                  )
                  .join('')}
              </div>
              <p id="control-detail" class="field-note"></p>
            </div>

            <div class="field-block">
              <label class="field-label">DEPARTURE</label>
              <div class="segmented four" id="start-modes">
                <button data-start="airborne"><b>Airborne</b><span>On the wing</span></button>
                <button data-start="runway"><b>Runway</b><span>Cold start</span></button>
                <button data-start="hangar"><b>Hangar</b><span>Parked at Scott</span></button>
                <button data-start="dogfight"><b>Dogfight</b><span>1v1 guns</span></button>
              </div>
            </div>

            <button id="launch-btn" class="launch-btn">
              <span class="launch-label">TAKE FLIGHT</span>
              <span class="launch-arrow">→</span>
            </button>
            <p class="launch-note">Press <b>H</b> in flight for controls · <b>ESC</b> to pause</p>
          </aside>
        </main>

        <footer class="menu-footer">
          <div class="footer-hints">
            <span><b>W/S</b> PITCH</span>
            <span><b>A/D</b> ROLL</span>
            <span><b>Q/E</b> RUDDER</span>
            <span><b>SHIFT/CTRL</b> THROTTLE</span>
            <span><b>V</b> GUNS</span>
            <span><b>C</b> CAMERA</span>
          </div>
          <button id="menu-controls" class="text-btn">CONTROLS ↗</button>
        </footer>
      </div>

      <div id="pause" class="screen overlay-screen hidden">
        <div class="overlay-bg"></div>
        <div class="modal pause-modal">
          <div class="modal-kicker">FLIGHT SUSPENDED</div>
          <h2>PAUSED</h2>
          <p id="pause-sub" class="modal-sub"></p>
          <div class="modal-actions">
        <button id="resume-btn" class="primary-btn">RESUME FLIGHT <span>→</span></button>
        <button id="restart-btn" class="ghost-btn">RESTART</button>
        <button id="hangar-btn" class="ghost-btn">RETURN TO HANGAR</button>
          </div>
          <div class="pause-grid">
            <div>
              <label class="field-label">TIME OF DAY</label>
              <div class="env-presets compact" id="pause-env-presets">
                ${ENV_PRESETS.map(
                  (key) =>
                    `<button class="env-btn" data-env="${key}"><i class="env-dot ${key}"></i>${TIME_PRESETS[key].label}</button>`
                ).join('')}
              </div>
              <input id="pause-time-slider" class="time-slider" type="range" min="0" max="24" step="0.05" value="18.02" />
              <div class="time-readout small"><span>LOCAL TIME</span><b id="pause-time-readout">18:00</b></div>
            </div>
            <div>
              <label class="field-label">CONTROLS</label>
              <div class="mini-controls">
                <span>W/S pitch</span><span>A/D roll</span><span>Q/E rudder</span>
                <span>Shift/Ctrl throttle</span><span>G gear</span><span>F flaps</span>
                <span>C camera</span><span>M sound</span>
              </div>
            </div>
          </div>
          <div class="pause-graphics">
            <label class="field-label">GRAPHICS</label>
            <div class="quality-row" id="quality-row">
              <button class="env-btn" data-quality="auto">Auto</button>
              ${QUALITY_LEVELS.map(
                (key) => `<button class="env-btn" data-quality="${key}">${QUALITY_SETTINGS[key].label}</button>`
              ).join('')}
            </div>
            <div class="quality-status">
              <span id="quality-status">AUTO</span>
              <span>ADAPTS TO YOUR GPU</span>
            </div>
          </div>
          <div class="modal-foot"><button id="pause-sound" class="text-btn">SOUND ON</button><span>ESC TO RESUME</span></div>
        </div>
      </div>

      <div id="help" class="screen overlay-screen hidden">
        <div class="overlay-bg"></div>
        <div class="modal help-modal">
          <div class="modal-kicker">FLIGHT MANUAL</div>
          <h2>CONTROLS</h2>
          ${CONTROLS_HTML}
          <button id="help-close" class="primary-btn">CLOSE <span>×</span></button>
        </div>
      </div>

      <div id="crash" class="screen overlay-screen crash-screen hidden">
        <div class="crash-glow"></div>
        <div class="modal crash-modal">
          <div class="modal-kicker danger">AIRFRAME LOST</div>
          <h2>IMPACT</h2>
          <p id="crash-reason" class="modal-sub"></p>
          <div class="modal-actions">
            <button id="crash-restart" class="primary-btn">FLY AGAIN <span>R</span></button>
            <button id="crash-hangar" class="ghost-btn">HANGAR</button>
          </div>
          <p class="crash-tip">Stay above the terrain and watch your speed on approach.</p>
        </div>
      </div>

      <div id="toast" class="toast"><span class="toast-dot"></span><span id="toast-text"></span></div>
    `;

    for (const id of ['loading', 'menu', 'pause', 'help', 'crash']) {
      this.screens[id] = this.root.querySelector(`#${id}`);
    }
    this.toastEl = this.root.querySelector('#toast');
    this.toastText = this.root.querySelector('#toast-text');
    this.aircraftList = this.root.querySelector('#aircraft-list');
    this.specStrip = this.root.querySelector('#spec-strip');
    this.blurb = this.root.querySelector('#aircraft-blurb');
    this.controlDetail = this.root.querySelector('#control-detail');
    this.timeSlider = this.root.querySelector('#time-slider');
    this.timeReadout = this.root.querySelector('#time-readout');
    this.pauseTimeSlider = this.root.querySelector('#pause-time-slider');
    this.pauseTimeReadout = this.root.querySelector('#pause-time-readout');
    this.soundBtn = this.root.querySelector('#pause-sound');
    this.launchBtn = this.root.querySelector('#launch-btn');

    this.buildAircraftCards();
  }

  buildAircraftCards() {
    this.aircraftList.innerHTML = Object.values(AIRCRAFT_SPECS)
      .map(
        (spec, index) => `
        <button class="aircraft-card" data-aircraft="${spec.id}">
          <span class="card-index">${pad(index + 1, 2)}</span>
          <span class="card-main">
            <span class="card-name">${spec.name}</span>
            <span class="card-role">${spec.category}</span>
          </span>
          <span class="card-speed">${spec.topSpeedLabel.split('·')[0].trim()}<small>${spec.maxMach ? 'MACH' : 'TOP'}</small></span>
          <span class="card-mark"></span>
        </button>`
      )
      .join('');
  }

  wire() {
    this.screens.menu.addEventListener('click', (event) => {
      const aircraft = event.target.closest('[data-aircraft]');
      if (aircraft) {
        this.callbacks.onAircraft?.(aircraft.dataset.aircraft);
        return;
      }
      const env = event.target.closest('[data-env]');
      if (env) {
        this.callbacks.onEnvironment?.(env.dataset.env);
        return;
      }
      const control = event.target.closest('[data-control]');
      if (control) {
        this.callbacks.onControl?.(control.dataset.control);
        return;
      }
      const start = event.target.closest('[data-start]');
      if (start) {
        this.callbacks.onStartMode?.(start.dataset.start);
        return;
      }
    });

    this.launchBtn.addEventListener('click', () => this.callbacks.onLaunch?.());
    this.timeSlider.addEventListener('input', (e) => {
      const hours = parseFloat(e.target.value);
      this.updateTimeLabel(hours);
      this.callbacks.onTime?.(hours);
    });
    this.root.querySelector('#menu-controls').addEventListener('click', () => this.callbacks.onHelp?.());

    this.root.querySelector('#resume-btn').addEventListener('click', () => this.callbacks.onResume?.());
    this.root.querySelector('#restart-btn').addEventListener('click', () => this.callbacks.onRestart?.());
    this.root.querySelector('#hangar-btn').addEventListener('click', () => this.callbacks.onHangar?.());
    this.root.querySelector('#crash-restart').addEventListener('click', () => this.callbacks.onRestart?.());
    this.root.querySelector('#crash-hangar').addEventListener('click', () => this.callbacks.onHangar?.());
    this.soundBtn.addEventListener('click', () => this.callbacks.onSoundToggle?.());

    this.screens.pause.addEventListener('click', (event) => {
      const env = event.target.closest('[data-env]');
      if (env) {
        this.callbacks.onEnvironment?.(env.dataset.env);
        return;
      }
      const quality = event.target.closest('[data-quality]');
      if (quality) this.callbacks.onQuality?.(quality.dataset.quality);
    });
    this.pauseTimeSlider.addEventListener('input', (e) => {
      const hours = parseFloat(e.target.value);
      this.updateTimeLabel(hours, true);
      this.callbacks.onTime?.(hours);
    });

    this.root.querySelector('#help-close').addEventListener('click', () => this.callbacks.onCloseHelp?.());
    this.screens.help.addEventListener('click', (event) => {
      if (event.target === this.screens.help) this.callbacks.onCloseHelp?.();
    });
  }

  setLoading(progress, text) {
    const fill = this.root.querySelector('#load-fill');
    const percent = this.root.querySelector('#load-percent');
    const label = this.root.querySelector('#load-text');
    const pct = Math.round(progress * 100);
    if (fill) fill.style.width = `${pct}%`;
    if (percent) percent.textContent = `${pct}%`;
    if (label && text) label.textContent = text;
  }

  hideLoading() {
    this.screens.loading.classList.add('hidden');
  }

  updateTime(hours) {
    if (this.selection) this.selection.hours = hours;
    this.timeSlider.value = String(hours);
    this.pauseTimeSlider.value = String(hours);
    this.updateTimeLabel(hours);
    this.updateTimeLabel(hours, true);
    for (const btn of this.root.querySelectorAll('#env-presets [data-env]')) {
      const preset = TIME_PRESETS[btn.dataset.env];
      btn.classList.toggle('active', Math.abs(preset.hours - hours) < 0.4);
    }
    for (const btn of this.root.querySelectorAll('#pause-env-presets [data-env]')) {
      const preset = TIME_PRESETS[btn.dataset.env];
      btn.classList.toggle('active', Math.abs(preset.hours - hours) < 0.4);
    }
  }

  updateTimeLabel(hours, pause = false) {
    const h = Math.floor(hours + 24) % 24;
    const m = Math.floor((hours % 1) * 60);
    const label = `${pad(h, 2)}:${pad(m, 2)}`;
    if (pause) {
      this.pauseTimeReadout.textContent = label;
    } else {
      this.timeReadout.textContent = label;
    }
  }

  updateSelection(selection, spec) {
    this.selection = selection;
    this.spec = spec;
    for (const card of this.aircraftList.querySelectorAll('.aircraft-card')) {
      card.classList.toggle('active', card.dataset.aircraft === selection.aircraftId);
    }
    for (const btn of this.root.querySelectorAll('#env-presets [data-env]')) {
      const preset = TIME_PRESETS[btn.dataset.env];
      btn.classList.toggle('active', Math.abs(preset.hours - selection.hours) < 0.4);
    }
    for (const btn of this.root.querySelectorAll('#pause-env-presets [data-env]')) {
      const preset = TIME_PRESETS[btn.dataset.env];
      btn.classList.toggle('active', Math.abs(preset.hours - selection.hours) < 0.4);
    }
    for (const btn of this.root.querySelectorAll('[data-control]')) {
      btn.classList.toggle('active', btn.dataset.control === selection.controlId);
    }
    for (const btn of this.root.querySelectorAll('[data-start]')) {
      btn.classList.toggle('active', btn.dataset.start === selection.startMode);
    }
    this.timeSlider.value = String(selection.hours);
    this.pauseTimeSlider.value = String(selection.hours);
    this.updateTimeLabel(selection.hours);
    this.updateTimeLabel(selection.hours, true);
    this.controlDetail.textContent = CONTROL_LEVELS[selection.controlId].detail;
    this.blurb.textContent = spec.blurb;
    this.specStrip.innerHTML = spec.stats
      .map(
        ([label, value]) =>
          `<div class="spec"><span>${label}</span><b>${value}</b></div>`
      )
      .join('');
    this.root.querySelector('#time-label').textContent = `LOCAL TIME · ${spec.maker.toUpperCase()}`;
    this.launchBtn.querySelector('.launch-label').textContent =
      selection.startMode === 'dogfight'
        ? 'START ENGAGEMENT'
        : selection.startMode === 'hangar'
          ? 'TAXI FROM HANGAR'
          : selection.startMode === 'runway'
            ? 'START ENGINE'
            : 'TAKE FLIGHT';
  }

  setSoundLabel(muted) {
    this.soundBtn.textContent = muted ? 'SOUND OFF' : 'SOUND ON';
  }

  showMenu() {
    this.screens.menu.classList.remove('hidden');
    this.screens.pause.classList.add('hidden');
    this.screens.help.classList.add('hidden');
    this.screens.crash.classList.add('hidden');
    this.root.classList.add('menu-open');
  }

  hideScreens() {
    this.screens.menu.classList.add('hidden');
    this.screens.pause.classList.add('hidden');
    this.screens.help.classList.add('hidden');
    this.screens.crash.classList.add('hidden');
    this.root.classList.remove('menu-open');
  }

  updateQuality(mode, tier, scale) {
    const label = QUALITY_SETTINGS[tier]?.label?.toUpperCase() || tier.toUpperCase();
    const status = this.root.querySelector('#quality-status');
    if (status) {
      const auto = mode === 'auto' ? 'AUTO · ' : '';
      const res = scale < 0.995 ? ` · ${Math.round(scale * 100)}% RES` : '';
      status.textContent = `${auto}${label}${res}`;
    }
    for (const btn of this.root.querySelectorAll('#quality-row [data-quality]')) {
      btn.classList.toggle('active', btn.dataset.quality === mode);
    }
  }

  showPause(spec, selection) {
    this.screens.pause.classList.remove('hidden');
    this.root.querySelector('#pause-sub').textContent =
      `${spec.name.toUpperCase()} · ${CONTROL_LEVELS[selection.controlId].name.toUpperCase()} · ${selection.startMode.toUpperCase()} START`;
    this.updateSelection(selection, spec);
  }

  hidePause() {
    this.screens.pause.classList.add('hidden');
  }

  showHelp() {
    this.screens.help.classList.remove('hidden');
  }

  hideHelp() {
    this.screens.help.classList.add('hidden');
  }

  isHelpOpen() {
    return !this.screens.help.classList.contains('hidden');
  }

  showCrash(reason) {
    this.screens.crash.classList.remove('hidden');
    this.root.querySelector('#crash-reason').textContent =
      `${reason}. The flight has ended — the sky is still waiting.`;
  }

  hideCrash() {
    this.screens.crash.classList.add('hidden');
  }

  toast(text, duration = 2200) {
    this.toastText.textContent = text;
    this.toastEl.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.toastEl.classList.remove('show'), duration);
  }
}
