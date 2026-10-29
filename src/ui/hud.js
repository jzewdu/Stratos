import { clamp, pad } from '../core/utils.js';

const FONT_MONO = '"Cascadia Mono","SFMono-Regular",Consolas,"Liberation Mono",monospace';
const FONT_DISPLAY = '"Bahnschrift","DIN Alternate","Segoe UI",sans-serif';

const COLORS = {
  primary: 'rgba(197, 249, 226, 0.92)',
  dim: 'rgba(197, 249, 226, 0.44)',
  faint: 'rgba(197, 249, 226, 0.16)',
  amber: 'rgba(255, 198, 121, 0.96)',
  red: 'rgba(255, 104, 86, 0.98)',
  combat: 'rgba(120, 255, 172, 0.94)',
  panel: 'rgba(4, 10, 13, 0.20)',
  panelEdge: 'rgba(170, 240, 215, 0.12)',
};

function roundRect(ctx, x, y, w, h, r) {
  const radius = Math.min(r, h / 2, w / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

export class HUD {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.dpr = 1;
    this.w = 0;
    this.h = 0;
    this.visible = false;
    this.time = 0;
    this.accum = 0;
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    // The HUD is a full-screen Canvas2D redraw with shadows and blur; at 2x on
    // a 1440p panel that alone costs several milliseconds per frame.
    this.dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    this.w = window.innerWidth;
    this.h = window.innerHeight;
    this.canvas.width = Math.floor(this.w * this.dpr);
    this.canvas.height = Math.floor(this.h * this.dpr);
    this.canvas.style.width = `${this.w}px`;
    this.canvas.style.height = `${this.h}px`;
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  setVisible(visible) {
    this.visible = visible;
    this.canvas.style.opacity = visible ? '1' : '0';
  }

  draw(dt, telem, spec, options) {
    if (!this.visible || !telem) return;
    // Telemetry does not need 60 redraws a second; 30 is indistinguishable
    // behind a 3D scene and halves the canvas cost.
    this.accum += dt;
    if (this.accum < 1 / 30) return;
    this.time += this.accum;
    this.accum = 0;
    const ctx = this.ctx;
    const w = this.w;
    const h = this.h;
    ctx.clearRect(0, 0, w, h);
    if (!telem || telem.crashed) return;

    const scale = clamp(Math.min(w / 1600, h / 900), 0.72, 1.3);
    const levelLabel = options.controlLabel || 'PILOT';
    const timeLabel = options.timeLabel || '00:00';
    const fps = options.fps || 60;
    const cameraMode = options.cameraMode || 'CHASE';
    const t = this.time;

    ctx.save();
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.55)';
    ctx.shadowBlur = 5 * this.dpr;
    ctx.shadowOffsetY = 1;

    this.drawBrand(ctx, spec, levelLabel, cameraMode, w, scale);
    this.drawEnvironment(ctx, timeLabel, fps, w, scale);
    this.drawCompass(ctx, telem, w, scale);
    this.drawSpeedTape(ctx, telem, w, h, scale);
    this.drawAltitudeTape(ctx, telem, w, h, scale);
    this.drawAttitude(ctx, telem, w, h, scale, t);
    if (options.combat?.active) this.drawCombat(ctx, options.combat, w, h, scale, t);
    this.drawStatus(ctx, telem, spec, w, h, scale);
    this.drawWarnings(ctx, telem, spec, w, h, scale, t);

    ctx.restore();
  }

  drawBrand(ctx, spec, levelLabel, cameraMode, w, s) {
    const x = 38 * s;
    const y = 46 * s;
    ctx.font = `600 ${11 * s}px ${FONT_DISPLAY}`;
    ctx.fillStyle = COLORS.dim;
    ctx.fillText('AIRFRAME', x, y);
    ctx.font = `600 ${20 * s}px ${FONT_DISPLAY}`;
    ctx.fillStyle = COLORS.primary;
    ctx.fillText(spec.name.toUpperCase(), x, y + 22 * s);
    ctx.font = `500 ${10 * s}px ${FONT_MONO}`;
    ctx.fillStyle = COLORS.amber;
    ctx.fillText(`${levelLabel.toUpperCase()} · ${cameraMode}`, x, y + 44 * s);
  }

  drawEnvironment(ctx, timeLabel, fps, w, s) {
    const x = w - 38 * s;
    ctx.textAlign = 'right';
    ctx.font = `500 ${10 * s}px ${FONT_MONO}`;
    ctx.fillStyle = COLORS.dim;
    ctx.fillText('LOCAL', x, 44 * s);
    ctx.font = `600 ${22 * s}px ${FONT_MONO}`;
    ctx.fillStyle = COLORS.primary;
    ctx.fillText(timeLabel, x, 66 * s);
    ctx.font = `500 ${9 * s}px ${FONT_MONO}`;
    ctx.fillStyle = COLORS.faint;
    ctx.fillText(`${Math.round(fps)} FPS · LIVE`, x, 84 * s);
    ctx.textAlign = 'left';
  }

  drawCompass(ctx, telem, w, s) {
    const cx = w / 2;
    const width = Math.min(440 * s, w * 0.37);
    const top = 26 * s;
    const height = 46 * s;
    const x = cx - width / 2;
    ctx.fillStyle = COLORS.panel;
    roundRect(ctx, x, top, width, height, 5 * s);
    ctx.fill();
    ctx.strokeStyle = COLORS.panelEdge;
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.save();
    roundRect(ctx, x, top, width, height, 5 * s);
    ctx.clip();
    const heading = telem.heading;
    const pxPerDeg = width / 90;
    const start = heading - 45;
    const end = heading + 45;
    ctx.textAlign = 'center';
    for (let deg = Math.ceil(start / 5) * 5; deg <= end; deg += 5) {
      const dx = (deg - heading) * pxPerDeg;
      const px = cx + dx;
      const norm = ((deg % 360) + 360) % 360;
      const major = norm % 30 === 0;
      ctx.strokeStyle = major ? COLORS.dim : COLORS.faint;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(px, top + 6 * s);
      ctx.lineTo(px, top + (major ? 16 : 11) * s);
      ctx.stroke();
      if (major) {
        ctx.fillStyle = COLORS.dim;
        ctx.font = `500 ${9 * s}px ${FONT_MONO}`;
        const label = pad(Math.round(norm), 3);
        ctx.fillText(label, px, top + 25 * s);
      }
    }
    // Cardinal letters.
    ctx.font = `600 ${10 * s}px ${FONT_DISPLAY}`;
    ctx.fillStyle = COLORS.amber;
    for (const [ang, label] of [[0, 'N'], [90, 'E'], [180, 'S'], [270, 'W']]) {
      let d = ((ang - heading + 540) % 360) - 180;
      if (Math.abs(d) < 45) {
        const px = cx + d * pxPerDeg;
        ctx.fillText(label, px, top + 25 * s);
      }
    }
    ctx.restore();

    // Center caret and digital heading.
    ctx.fillStyle = COLORS.amber;
    ctx.beginPath();
    ctx.moveTo(cx, top + height + 1 * s);
    ctx.lineTo(cx - 4 * s, top + height + 7 * s);
    ctx.lineTo(cx + 4 * s, top + height + 7 * s);
    ctx.closePath();
    ctx.fill();
    ctx.font = `600 ${10 * s}px ${FONT_MONO}`;
    ctx.textAlign = 'center';
    ctx.fillStyle = COLORS.primary;
    ctx.fillText(`${pad(Math.round(telem.heading) % 360, 3)}°`, cx, top + height + 20 * s);
    ctx.textAlign = 'left';
  }

  drawSpeedTape(ctx, telem, w, h, s) {
    const panelW = 112 * s;
    const px = 26 * s;
    const centerY = h * 0.53;
    const panelH = Math.min(300 * s, h * 0.4);
    const top = centerY - panelH / 2;
    ctx.fillStyle = COLORS.panel;
    roundRect(ctx, px, top, panelW, panelH, 8 * s);
    ctx.fill();
    ctx.strokeStyle = COLORS.panelEdge;
    ctx.stroke();

    const pxPerKt = 2.15 * s;
    const kts = telem.kts;
    ctx.save();
    roundRect(ctx, px, top, panelW, panelH, 8 * s);
    ctx.clip();
    ctx.textAlign = 'right';
    for (let v = Math.ceil((kts - panelH / 2 / pxPerKt) / 10) * 10; v <= kts + panelH / 2 / pxPerKt; v += 10) {
      if (v < 0) continue;
      const y = centerY - (v - kts) * pxPerKt;
      const major = v % 20 === 0;
      const alpha = clamp(1 - Math.abs(y - centerY) / (panelH * 0.5), 0, 1);
      ctx.globalAlpha = 0.3 + alpha * 0.7;
      ctx.strokeStyle = major ? COLORS.primary : COLORS.dim;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(px + panelW - 8 * s, y);
      ctx.lineTo(px + panelW - (major ? 22 : 15) * s, y);
      ctx.stroke();
      if (major) {
        ctx.textAlign = 'left';
        ctx.fillStyle = COLORS.dim;
        ctx.font = `500 ${9.5 * s}px ${FONT_MONO}`;
        ctx.fillText(String(v), px + 10 * s, y);
      }
    }
    ctx.globalAlpha = 1;
    ctx.restore();

    // Hairline from the tape into the readout.
    ctx.strokeStyle = COLORS.amber;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(px + panelW, centerY);
    ctx.lineTo(px + panelW + 13 * s, centerY);
    ctx.stroke();

    // Digital airspeed block beside the tape.
    const boxW = 92 * s;
    const boxH = 58 * s;
    const boxX = px + panelW + 16 * s;
    ctx.fillStyle = 'rgba(3, 8, 10, 0.66)';
    roundRect(ctx, boxX, centerY - boxH / 2, boxW, boxH, 4 * s);
    ctx.fill();
    ctx.strokeStyle = COLORS.panelEdge;
    ctx.stroke();
    ctx.textAlign = 'center';
    ctx.fillStyle = COLORS.primary;
    ctx.font = `600 ${27 * s}px ${FONT_MONO}`;
    ctx.fillText(String(Math.round(kts)).padStart(2, '0'), boxX + boxW / 2, centerY - 4 * s);
    ctx.font = `500 ${8 * s}px ${FONT_MONO}`;
    ctx.fillStyle = COLORS.dim;
    ctx.fillText('KNOTS', boxX + boxW / 2, centerY + 15 * s);

    // Secondary units.
    ctx.textAlign = 'left';
    ctx.fillStyle = COLORS.dim;
    ctx.font = `500 ${9 * s}px ${FONT_MONO}`;
    ctx.fillText(`KM/H  ${Math.round(telem.kmh)}`, boxX, centerY + boxH / 2 + 15 * s);
    ctx.fillText(`MACH  ${telem.mach.toFixed(2)}`, boxX, centerY + boxH / 2 + 28 * s);
  }

  drawAltitudeTape(ctx, telem, w, h, s) {
    const panelW = 112 * s;
    const px = w - 26 * s - panelW;
    const centerY = h * 0.53;
    const panelH = Math.min(300 * s, h * 0.4);
    const top = centerY - panelH / 2;
    ctx.fillStyle = COLORS.panel;
    roundRect(ctx, px, top, panelW, panelH, 8 * s);
    ctx.fill();
    ctx.strokeStyle = COLORS.panelEdge;
    ctx.stroke();

    const ft = telem.altitudeFT;
    const pxPerFt = 0.16 * s;
    ctx.save();
    roundRect(ctx, px, top, panelW, panelH, 8 * s);
    ctx.clip();
    for (
      let v = Math.ceil((ft - panelH / 2 / pxPerFt) / 200) * 200;
      v <= ft + panelH / 2 / pxPerFt;
      v += 200
    ) {
      const y = centerY - (v - ft) * pxPerFt;
      const major = v % 1000 === 0;
      const alpha = clamp(1 - Math.abs(y - centerY) / (panelH * 0.5), 0, 1);
      ctx.globalAlpha = 0.3 + alpha * 0.7;
      ctx.strokeStyle = major ? COLORS.primary : COLORS.dim;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(px + 8 * s, y);
      ctx.lineTo(px + (major ? 22 : 15) * s, y);
      ctx.stroke();
      if (major) {
        ctx.textAlign = 'right';
        ctx.fillStyle = COLORS.dim;
        ctx.font = `500 ${9.5 * s}px ${FONT_MONO}`;
        ctx.fillText(String(v), px + panelW - 10 * s, y);
      }
    }
    ctx.globalAlpha = 1;
    ctx.restore();

    ctx.strokeStyle = COLORS.amber;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(px - 13 * s, centerY);
    ctx.lineTo(px, centerY);
    ctx.stroke();

    const boxW = 96 * s;
    const boxH = 58 * s;
    const boxX = px - 16 * s - boxW;
    ctx.fillStyle = 'rgba(3, 8, 10, 0.66)';
    roundRect(ctx, boxX, centerY - boxH / 2, boxW, boxH, 4 * s);
    ctx.fill();
    ctx.strokeStyle = COLORS.panelEdge;
    ctx.stroke();
    ctx.textAlign = 'center';
    ctx.fillStyle = COLORS.primary;
    ctx.font = `600 ${24 * s}px ${FONT_MONO}`;
    ctx.fillText(String(Math.round(ft)), boxX + boxW / 2, centerY - 4 * s);
    ctx.font = `500 ${8 * s}px ${FONT_MONO}`;
    ctx.fillStyle = COLORS.dim;
    ctx.fillText('FEET MSL', boxX + boxW / 2, centerY + 15 * s);

    ctx.textAlign = 'right';
    ctx.fillStyle = COLORS.dim;
    ctx.font = `500 ${9 * s}px ${FONT_MONO}`;
    const vs = telem.vsFpm;
    ctx.fillText(`V/S ${vs >= 0 ? '+' : ''}${Math.round(vs)}`, boxX + boxW, centerY + boxH / 2 + 15 * s);
    ctx.fillText(`AGL ${Math.round(telem.agl * 3.28084)}`, boxX + boxW, centerY + boxH / 2 + 28 * s);
  }

  drawAttitude(ctx, telem, w, h, s, t) {
    const cx = w / 2;
    const cy = h * 0.47;
    const radius = Math.min(158 * s, h * 0.19, w * 0.16);
    const scalePx = radius / 45;
    const roll = telem.roll;
    const pitch = telem.pitch;

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.clip();

    ctx.translate(cx, cy);
    ctx.rotate(-roll * Math.PI / 180);
    ctx.translate(0, pitch * scalePx);

    // Subtle sky/ground tints.
    ctx.fillStyle = 'rgba(105, 174, 210, 0.05)';
    ctx.fillRect(-radius * 2, -radius * 3, radius * 4, radius * 3);
    ctx.fillStyle = 'rgba(180, 145, 93, 0.05)';
    ctx.fillRect(-radius * 2, 0, radius * 4, radius * 3);

    ctx.strokeStyle = 'rgba(197, 249, 226, 0.65)';
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.moveTo(-radius * 1.7, 0);
    ctx.lineTo(radius * 1.7, 0);
    ctx.stroke();

    ctx.font = `500 ${9 * s}px ${FONT_MONO}`;
    ctx.textAlign = 'center';
    for (let deg = -40; deg <= 40; deg += 10) {
      if (deg === 0) continue;
      const y = -deg * scalePx;
      const lineW = (deg % 20 === 0 ? 0.58 : 0.3) * radius;
      ctx.strokeStyle = deg > 0 ? 'rgba(197, 249, 226, 0.5)' : 'rgba(197, 249, 226, 0.32)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(-lineW, y);
      ctx.lineTo(-radius * 0.14, y);
      ctx.moveTo(radius * 0.14, y);
      ctx.lineTo(lineW, y);
      ctx.stroke();
      if (deg % 20 === 0) {
        ctx.fillStyle = COLORS.dim;
        ctx.fillText(String(Math.abs(deg)), -(lineW + 10 * s), y);
        ctx.fillText(String(Math.abs(deg)), lineW + 10 * s, y);
      }
    }
    ctx.restore();

    // Ring and bank scale.
    ctx.strokeStyle = 'rgba(197, 249, 226, 0.16)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.stroke();

    ctx.save();
    for (let a = -60; a <= 60; a += 15) {
      const ang = (-90 + a) * Math.PI / 180;
      const r1 = radius + 5 * s;
      const r2 = radius + (a % 30 === 0 ? 14 : 9) * s;
      ctx.strokeStyle = a === 0 ? COLORS.amber : COLORS.dim;
      ctx.lineWidth = a === 0 ? 1.6 : 1;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(ang) * r1, cy + Math.sin(ang) * r1);
      ctx.lineTo(cx + Math.cos(ang) * r2, cy + Math.sin(ang) * r2);
      ctx.stroke();
    }
    const bankAng = (-90 + roll) * Math.PI / 180;
    ctx.fillStyle = COLORS.amber;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(bankAng) * (radius + 2 * s), cy + Math.sin(bankAng) * (radius + 2 * s));
    ctx.lineTo(cx + Math.cos(bankAng + 0.04) * (radius + 12 * s), cy + Math.sin(bankAng + 0.04) * (radius + 12 * s));
    ctx.lineTo(cx + Math.cos(bankAng - 0.04) * (radius + 12 * s), cy + Math.sin(bankAng - 0.04) * (radius + 12 * s));
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // Flight path marker.
    const fpmY = cy + clamp(telem.alphaDeg * scalePx * 0.72, -radius * 0.7, radius * 0.7);
    const fpmAlpha = 0.8;
    ctx.strokeStyle = `rgba(255, 198, 121, ${fpmAlpha})`;
    ctx.fillStyle = `rgba(255, 198, 121, ${fpmAlpha})`;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(cx, fpmY, 5 * s, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - 14 * s, fpmY);
    ctx.lineTo(cx - 5 * s, fpmY);
    ctx.moveTo(cx + 5 * s, fpmY);
    ctx.lineTo(cx + 14 * s, fpmY);
    ctx.moveTo(cx, fpmY - 5 * s);
    ctx.lineTo(cx, fpmY - 10 * s);
    ctx.stroke();

    // Aircraft reference symbol.
    ctx.strokeStyle = COLORS.primary;
    ctx.fillStyle = COLORS.primary;
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(cx - 28 * s, cy);
    ctx.lineTo(cx - 10 * s, cy);
    ctx.lineTo(cx - 6 * s, cy + 5 * s);
    ctx.lineTo(cx + 6 * s, cy + 5 * s);
    ctx.lineTo(cx + 10 * s, cy);
    ctx.lineTo(cx + 28 * s, cy);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, 1.8 * s, 0, Math.PI * 2);
    ctx.fill();

    // Faint crosshair tick marks.
    ctx.strokeStyle = 'rgba(197, 249, 226, 0.14)';
    ctx.lineWidth = 1;
    for (const [x, y] of [[cx, cy - radius - 18 * s], [cx, cy + radius + 18 * s]]) {
      ctx.beginPath();
      ctx.moveTo(x - 5 * s, y);
      ctx.lineTo(x + 5 * s, y);
      ctx.stroke();
    }
  }

  drawStatus(ctx, telem, spec, w, h, s) {
    const bottom = h - 34 * s;
    // Throttle block.
    const tx = 34 * s;
    const tw = 170 * s;
    ctx.font = `500 ${9 * s}px ${FONT_MONO}`;
    ctx.fillStyle = COLORS.dim;
    ctx.fillText('THROTTLE', tx, bottom - 26 * s);
    ctx.fillStyle = 'rgba(3, 8, 10, 0.5)';
    roundRect(ctx, tx, bottom - 19 * s, tw, 7 * s, 3 * s);
    ctx.fill();
    const fill = clamp(telem.throttle, 0, 1);
    ctx.fillStyle = telem.afterburner > 0.1 ? COLORS.red : COLORS.primary;
    roundRect(ctx, tx, bottom - 19 * s, tw * fill, 7 * s, 3 * s);
    ctx.fill();
    ctx.font = `600 ${11 * s}px ${FONT_MONO}`;
    ctx.fillStyle = COLORS.amber;
    ctx.textAlign = 'right';
    ctx.fillText(`${Math.round(fill * 100)}%`, tx + tw, bottom - 28 * s);
    ctx.textAlign = 'left';

    // Gear / flaps / brake.
    let indent = bottom + 2 * s;
    ctx.font = `500 ${9 * s}px ${FONT_MONO}`;
    const gearLabel = spec.fixedGear ? 'FIXED' : telem.gearDown ? 'GEAR DOWN' : 'GEAR UP';
    const flapDeg = Math.round(telem.flaps);
    ctx.fillStyle = COLORS.dim;
    ctx.fillText(`${gearLabel}   FLAPS ${String(flapDeg).padStart(2, '0')}°`, tx, indent);
    if (telem.stallWarning) {
      ctx.fillStyle = COLORS.red;
      ctx.fillText('● STALL', tx + 8 * s, indent + 15 * s);
    } else if (telem.onGround && Math.abs(telem.speed) < 0.8) {
      ctx.fillStyle = COLORS.amber;
      ctx.fillText('● READY FOR DEPARTURE', tx + 8 * s, indent + 15 * s);
    }
    if (telem.onGround && telem.parkingAvailable) {
      ctx.fillStyle = COLORS.primary;
      ctx.fillText('P PARK AT BAY 01 STAND', tx + 8 * s, indent + 30 * s);
    }

    // Right-hand data.
    const rx = w - 34 * s;
    ctx.textAlign = 'right';
    ctx.font = `500 ${9 * s}px ${FONT_MONO}`;
    ctx.fillStyle = COLORS.dim;
    ctx.fillText('G LOAD', rx - 148 * s, bottom - 26 * s);
    ctx.fillText('ALPHA', rx - 74 * s, bottom - 26 * s);
    ctx.font = `600 ${17 * s}px ${FONT_MONO}`;
    ctx.fillStyle = telem.gLoad > 7 ? COLORS.amber : COLORS.primary;
    ctx.fillText(`${telem.gLoad.toFixed(1)}G`, rx - 148 * s + 42 * s, bottom - 6 * s);
    ctx.fillStyle = COLORS.primary;
    ctx.fillText(`${telem.alphaDeg.toFixed(1)}°`, rx - 74 * s + 36 * s, bottom - 6 * s);
    ctx.textAlign = 'left';

    // Flight hint.
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(197, 249, 226, 0.30)';
    ctx.font = `500 ${9 * s}px ${FONT_MONO}`;
    ctx.fillText('C CAMERA   ·   H CONTROLS   ·   ESC PAUSE', w / 2, h - 16 * s);
    ctx.textAlign = 'left';
  }

  /**
   * Gunsight and target tally. The pipper is the real ballistic lead point, so
   * putting it on the bandit and shooting actually connects.
   */
  drawCombat(ctx, c, w, h, s, t) {
    const cx = w / 2;
    const cy = h * 0.47;

    // Boresight. Small and low-contrast; it should not compete with the pipper.
    ctx.strokeStyle = 'rgba(197, 249, 226, 0.38)';
    ctx.lineWidth = 1;
    ctx.setLineDash([5 * s, 5 * s]);
    ctx.beginPath();
    ctx.moveTo(cx - 62 * s, cy);
    ctx.lineTo(cx - 12 * s, cy);
    ctx.moveTo(cx + 12 * s, cy);
    ctx.lineTo(cx + 62 * s, cy);
    ctx.moveTo(cx, cy - 40 * s);
    ctx.lineTo(cx, cy - 10 * s);
    ctx.moveTo(cx, cy + 10 * s);
    ctx.lineTo(cx, cy + 40 * s);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = COLORS.dim;
    ctx.beginPath();
    ctx.arc(cx, cy, 1.6 * s, 0, Math.PI * 2);
    ctx.fill();

    // Target bracket and lead pipper.
    const target = c.target;
    if (target) {
      const rangeLabel = target.dist < 1000
        ? `${Math.round(target.dist)} M`
        : `${(target.dist / 1000).toFixed(1)} KM`;
      if (target.screen.visible) {
        const x = target.screen.x;
        const y = target.screen.y;
        const r = target.size * 0.5;
        const arm = Math.max(5 * s, r * 0.35);
        ctx.strokeStyle = COLORS.combat;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        // Four corner brackets, gap in the middle so the aircraft is visible.
        ctx.moveTo(x - r, y - r + arm);
        ctx.lineTo(x - r, y - r);
        ctx.lineTo(x - r + arm, y - r);
        ctx.moveTo(x + r - arm, y - r);
        ctx.lineTo(x + r, y - r);
        ctx.lineTo(x + r, y - r + arm);
        ctx.moveTo(x - r, y + r - arm);
        ctx.lineTo(x - r, y + r);
        ctx.lineTo(x - r + arm, y + r);
        ctx.moveTo(x + r - arm, y + r);
        ctx.lineTo(x + r, y + r);
        ctx.lineTo(x + r, y + r - arm);
        ctx.stroke();

        ctx.textAlign = 'center';
        ctx.font = `600 ${10 * s}px ${FONT_MONO}`;
        ctx.fillStyle = COLORS.combat;
        ctx.fillText(target.name, x, y - r - 19 * s);
        ctx.font = `500 ${9 * s}px ${FONT_MONO}`;
        ctx.fillStyle = COLORS.dim;
        ctx.fillText(`${rangeLabel}${target.closure > 8 ? ' · CLOSING' : target.closure < -8 ? ' · OPENING' : ''}`, x, y - r - 7 * s);

        // Small health bar on the box.
        const hpW = Math.max(34 * s, r * 1.25);
        const hp = clamp(target.health / 100, 0, 1);
        ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
        ctx.fillRect(x - hpW / 2, y + r + 6 * s, hpW, 3 * s);
        ctx.fillStyle = hp > 0.5 ? COLORS.combat : hp > 0.22 ? COLORS.amber : COLORS.red;
        ctx.fillRect(x - hpW / 2, y + r + 6 * s, hpW * hp, 3 * s);
      } else {
        // Off-screen arrow at the edge of the HUD, still range-tagged.
        let dx = target.screen.x - cx;
        let dy = target.screen.y - cy;
        if (!target.screen.inFront) {
          dx = -dx;
          dy = -dy;
        }
        const angle = Math.atan2(dy, dx);
        const radius = Math.min(w, h) * 0.31;
        const ax = cx + Math.cos(angle) * radius;
        const ay = cy + Math.sin(angle) * radius;
        ctx.save();
        ctx.translate(ax, ay);
        ctx.rotate(angle);
        ctx.fillStyle = COLORS.combat;
        ctx.beginPath();
        ctx.moveTo(10 * s, 0);
        ctx.lineTo(-5 * s, -6 * s);
        ctx.lineTo(-5 * s, 6 * s);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
        ctx.textAlign = 'center';
        ctx.font = `500 ${9 * s}px ${FONT_MONO}`;
        ctx.fillStyle = COLORS.dim;
        ctx.fillText(rangeLabel, ax - Math.cos(angle) * 23 * s, ay - Math.sin(angle) * 23 * s);
      }
    }

    // Lead pipper.
    if (c.gun?.ready) {
      const p = c.gun.screen;
      if (p.inFront) {
        const radius = 8 * s;
        ctx.strokeStyle = COLORS.combat;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = COLORS.combat;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 1.7 * s, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(p.x - radius - 6 * s, p.y);
        ctx.lineTo(p.x - radius - 1.5 * s, p.y);
        ctx.moveTo(p.x + radius + 1.5 * s, p.y);
        ctx.lineTo(p.x + radius + 6 * s, p.y);
        ctx.stroke();
        if (c.gun.inCone) {
          ctx.textAlign = 'left';
          ctx.font = `700 ${11 * s}px ${FONT_DISPLAY}`;
          ctx.fillStyle = COLORS.amber;
          ctx.fillText('SHOOT', p.x + radius + 10 * s, p.y - 1 * s);
        }
      }
    }

    // Ammunition, kills and player health.
    ctx.textAlign = 'center';
    ctx.font = `500 ${10 * s}px ${FONT_MONO}`;
    ctx.fillStyle = c.ammo <= 0 ? COLORS.red : COLORS.combat;
    ctx.fillText(
      c.ammo <= 0 ? 'GUN EMPTY' : `GUN  ${String(c.ammo).padStart(3, '0')}`,
      cx,
      h - 62 * s
    );
    ctx.fillStyle = COLORS.dim;
    ctx.fillText(`KILLS  ${c.kills}`, cx, h - 47 * s);
    ctx.textAlign = 'left';

    const rx = w - 38 * s;
    ctx.textAlign = 'right';
    ctx.font = `500 ${9 * s}px ${FONT_MONO}`;
    ctx.fillStyle = COLORS.dim;
    ctx.fillText('AIRFRAME', rx, 102 * s);
    const hp = clamp(c.health / 100, 0, 1);
    const hpW = 128 * s;
    ctx.fillStyle = 'rgba(3, 8, 10, 0.55)';
    roundRect(ctx, rx - hpW, 109 * s, hpW, 5 * s, 2 * s);
    ctx.fill();
    ctx.fillStyle = hp > 0.5 ? COLORS.primary : hp > 0.25 ? COLORS.amber : COLORS.red;
    roundRect(ctx, rx - hpW, 109 * s, hpW * hp, 5 * s, 2 * s);
    ctx.fill();
    ctx.textAlign = 'left';

    if (c.noTarget) {
      ctx.textAlign = 'center';
      ctx.font = `600 ${10 * s}px ${FONT_MONO}`;
      ctx.fillStyle = COLORS.dim;
      const label = c.respawnIn > 0.5 ? `NEXT CONTACT  ${Math.ceil(c.respawnIn)}s` : 'SEARCHING · NO CONTACT';
      ctx.fillText(label, cx, cy - 96 * s);
      ctx.textAlign = 'left';
    }

    // Hit marker: a short, bright X when rounds are striking the bandit.
    if (c.hitMarker > 0) {
      ctx.save();
      ctx.globalAlpha = clamp(c.hitMarker, 0, 1);
      ctx.strokeStyle = COLORS.amber;
      ctx.lineWidth = 2 * s;
      ctx.beginPath();
      for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        ctx.moveTo(cx + sx * 8 * s, cy + sy * 8 * s);
        ctx.lineTo(cx + sx * 16 * s, cy + sy * 16 * s);
      }
      ctx.stroke();
      ctx.restore();
    }

    // Red edge warning when the airframe is badly hurt.
    if (c.health < 34) {
      const strength = clamp((34 - c.health) / 34, 0, 1) * 0.32;
      const grad = ctx.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, `rgba(190, 30, 20, ${strength})`);
      grad.addColorStop(0.28, 'rgba(190, 30, 20, 0)');
      grad.addColorStop(0.72, 'rgba(190, 30, 20, 0)');
      grad.addColorStop(1, `rgba(190, 30, 20, ${strength})`);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
    }
  }

  drawWarnings(ctx, telem, spec, w, h, s, t) {
    const warnings = [];
    if (telem.stallWarning) warnings.push({ text: 'STALL', color: COLORS.red });
    if (telem.overspeedWarning) warnings.push({ text: 'OVERSPEED', color: COLORS.amber });
    if (
      !spec.fixedGear &&
      !telem.gearDown &&
      telem.agl < 350 &&
      !telem.onGround &&
      telem.vs < 5
    ) {
      warnings.push({ text: 'GEAR UP', color: COLORS.red });
    }
    if (!telem.onGround && telem.agl < 220 && telem.vs < -18) {
      warnings.push({ text: 'PULL UP', color: COLORS.red });
    }
    if (!warnings.length) return;

    const blink = 0.65 + 0.35 * Math.sin(t * 9);
    const cx = w / 2;
    let y = h * 0.47 + Math.min(158 * s, h * 0.19, w * 0.16) + 44 * s;
    ctx.textAlign = 'center';
    for (const warn of warnings) {
      ctx.globalAlpha = blink;
      ctx.font = `700 ${15 * s}px ${FONT_DISPLAY}`;
      ctx.fillStyle = warn.color;
      ctx.shadowColor = 'rgba(0,0,0,0.8)';
      ctx.shadowBlur = 10 * s;
      ctx.fillText(warn.text, cx, y);
      y += 19 * s;
    }
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 5 * this.dpr;
    ctx.textAlign = 'left';
  }
}
