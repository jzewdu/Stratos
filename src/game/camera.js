import * as THREE from 'three';
import { clamp, terrainHeight, noise1 } from '../core/utils.js';

const MODES = ['CHASE', 'COCKPIT', 'CINEMA'];

export class SimCamera {
  constructor(camera) {
    this.camera = camera;
    this.mode = 0;
    this.orbitAngle = 0;
    this.initialized = false;
    this.shakeTime = 0;
    this.fov = 60;
    this.up = new THREE.Vector3(0, 1, 0);
    this.desired = new THREE.Vector3();
    this.target = new THREE.Vector3();
  }

  reset() {
    this.initialized = false;
    this.orbitAngle = Math.PI * 0.35;
  }

  cycle() {
    this.mode = (this.mode + 1) % MODES.length;
    this.initialized = false;
    this.orbitAngle = Math.PI * 0.35;
    return MODES[this.mode];
  }

  get modeName() {
    return MODES[this.mode];
  }

  update(dt, state, model, spec, time, shakeAmount = 0) {
    const camera = this.camera;
    const position = state.position;
    const quaternion = state.quaternion;
    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(quaternion);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(quaternion);
    const speed = state.speed || 0;
    const span = Math.sqrt(spec.aspect * spec.wingArea);
    const speedFactor = clamp(speed / Math.max(spec.startSpeed, 1), 0.35, 2.6);
    const ground = Math.max(terrainHeight(position.x, position.z), 0);
    this.shakeTime += dt;

    if (this.mode === 0) {
      const distance = span * 1.15 + speedFactor * (spec.id === 'f22' ? 11 : 4);
      const height = span * 0.24 + 1.3;
      this.desired.copy(position).addScaledVector(forward, -distance);
      this.desired.y += height;
      const minY = ground + 3.0;
      if (this.desired.y < minY) this.desired.y = minY;
      if (!this.initialized) {
        camera.position.copy(this.desired);
        this.fov = 60;
        this.initialized = true;
      }
      const smoothing = 1 - Math.exp(-dt * 4.2);
      camera.position.lerp(this.desired, smoothing);
      this.target.copy(position).addScaledVector(forward, span * 0.3 + 2);
      this.target.y += 1.0;
      camera.up.copy(this.up);
      camera.lookAt(this.target);
      this.fov = clamp(57 + speedFactor * 5.0, 57, 72);
    } else if (this.mode === 1) {
      const local = model.cockpit.clone();
      camera.position.copy(local.applyQuaternion(quaternion)).add(position);
      camera.quaternion.copy(quaternion);
      camera.rotateY(Math.PI);
      this.fov = 74;
      this.initialized = true;
    } else {
      this.orbitAngle += dt * 0.16;
      const distance = span * 1.25;
      this.desired.set(
        position.x + Math.cos(this.orbitAngle) * distance,
        position.y + span * 0.22 + 2,
        position.z + Math.sin(this.orbitAngle) * distance
      );
      const minY = ground + 2.5;
      if (this.desired.y < minY) this.desired.y = minY;
      if (!this.initialized) {
        camera.position.copy(this.desired);
        this.initialized = true;
      }
      camera.position.lerp(this.desired, 1 - Math.exp(-dt * 3.0));
      this.target.copy(position);
      this.target.y += 0.8;
      camera.up.copy(this.up);
      camera.lookAt(this.target);
      this.fov = 46;
    }

    // Shake / buffet.
    const buffet =
      (state.stallSeverity || 0) * 0.9 +
      shakeAmount +
      (state.afterburner || 0) * (this.mode === 1 ? 0.35 : 0.18);
    if (buffet > 0.001) {
      const amp = (this.mode === 1 ? 0.055 : 0.22) * buffet;
      const t = this.shakeTime;
      const sx = noise1(t * 13, 1) * amp;
      const sy = noise1(t * 11.3, 2) * amp;
      const sz = noise1(t * 9.7, 3) * amp * 0.5;
      camera.position.x += sx;
      camera.position.y += sy;
      camera.position.z += sz;
      camera.rotateX(noise1(t * 7.3, 4) * buffet * 0.003);
      camera.rotateY(noise1(t * 6.1, 5) * buffet * 0.003);
    }

    // Ease FOV.
    camera.fov += (this.fov - camera.fov) * Math.min(1, dt * 3.0);
    camera.updateProjectionMatrix();
  }
}
