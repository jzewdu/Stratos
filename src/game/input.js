import { clamp } from '../core/utils.js';

const CONTROL_CODES = new Set([
  'KeyW', 'KeyS', 'KeyA', 'KeyD', 'KeyQ', 'KeyE',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',      'ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight', 'Space', 'KeyP', 'Escape',
]);

export class InputManager {
  constructor() {
    this.keys = new Set();
    this.pitch = 0;
    this.roll = 0;
    this.yaw = 0;
    this.throttle = 0;
    this.throttleTarget = 0;
    this.brake = false;
    this.firing = false;
    this.mouseDown = false;
    this.enabled = true;
    this.onAction = null;
    this.canvas = document.getElementById('viewport');

    this._keydown = (event) => {
      if (event.target && /INPUT|TEXTAREA|SELECT/.test(event.target.tagName)) return;
      const code = event.code;
      if (CONTROL_CODES.has(code) && this.enabled) event.preventDefault();
      if (this.keys.has(code)) return;
      this.keys.add(code);
      if (!this.enabled) return;
      if (this.onAction) {
        if (code === 'KeyC') this.onAction('camera');
        else if (code === 'KeyG') this.onAction('gear');
        else if (code === 'KeyF') this.onAction('flaps');
        else if (code === 'KeyH') this.onAction('help');
        else if (code === 'KeyM') this.onAction('mute');
        else if (code === 'KeyT') this.onAction('time');
        else if (code === 'KeyR') this.onAction('restart');
        else if (code === 'KeyL') this.onAction('lights');
        else if (code === 'KeyP') this.onAction('park');
        else if (code === 'Escape') this.onAction('pause');
      }
    };

    this._keyup = (event) => {
      this.keys.delete(event.code);
    };

    this._blur = () => {
      this.keys.clear();
      this.mouseDown = false;
      this.firing = false;
    };

    this._pointerDown = (event) => {
      if (!this.enabled || event.button !== 0) return;
      this.mouseDown = true;
    };
    this._pointerUp = (event) => {
      if (event.button === 0) this.mouseDown = false;
    };

    window.addEventListener('keydown', this._keydown);
    window.addEventListener('keyup', this._keyup);
    window.addEventListener('blur', this._blur);
    // Only the viewport fires the gun; clicking pause or help does not.
    this.canvas?.addEventListener('pointerdown', this._pointerDown);
    window.addEventListener('pointerup', this._pointerUp);
    window.addEventListener('pointercancel', this._pointerUp);
  }

  reset(initialThrottle = 0) {
    this.pitch = 0;
    this.roll = 0;
    this.yaw = 0;
    this.throttle = initialThrottle;
    this.throttleTarget = initialThrottle;
    this.brake = false;
    this.firing = false;
    this.mouseDown = false;
    this.keys.clear();
  }

  setThrottle(value) {
    this.throttle = clamp(value, 0, 1);
    this.throttleTarget = this.throttle;
  }

  update(dt) {
    const keys = this.keys;
    const up = keys.has('KeyW') || keys.has('ArrowUp');
    const down = keys.has('KeyS') || keys.has('ArrowDown');
    const left = keys.has('KeyA') || keys.has('ArrowLeft');
    const right = keys.has('KeyD') || keys.has('ArrowRight');
    const yawLeft = keys.has('KeyQ');
    const yawRight = keys.has('KeyE');
    const throttleUp = keys.has('ShiftLeft') || keys.has('ShiftRight');
    const throttleDown = keys.has('ControlLeft') || keys.has('ControlRight');

    const pitchTarget = (up ? 1 : 0) - (down ? 1 : 0);
    const rollTarget = (right ? 1 : 0) - (left ? 1 : 0);
    const yawTarget = (yawRight ? 1 : 0) - (yawLeft ? 1 : 0);
    const rate = 6.5;
    const k = 1 - Math.exp(-rate * dt);
    this.pitch += (pitchTarget - this.pitch) * k;
    this.roll += (rollTarget - this.roll) * k;
    this.yaw += (yawTarget - this.yaw) * (1 - Math.exp(-4.5 * dt));

    if (throttleUp) this.throttleTarget = clamp(this.throttleTarget + dt * 0.6, 0, 1);
    if (throttleDown) this.throttleTarget = clamp(this.throttleTarget - dt * 0.6, 0, 1);
    this.throttle += (this.throttleTarget - this.throttle) * (1 - Math.exp(-4 * dt));

    this.brake = keys.has('Space');
    this.firing = keys.has('KeyV') || this.mouseDown;
  }

  controls() {
    return {
      pitch: this.pitch,
      roll: this.roll,
      yaw: this.yaw,
      throttle: this.throttle,
      brake: this.brake,
    };
  }

  dispose() {
    window.removeEventListener('keydown', this._keydown);
    window.removeEventListener('keyup', this._keyup);
    window.removeEventListener('blur', this._blur);
    this.canvas?.removeEventListener('pointerdown', this._pointerDown);
    window.removeEventListener('pointerup', this._pointerUp);
    window.removeEventListener('pointercancel', this._pointerUp);
  }
}
