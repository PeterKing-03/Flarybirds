(() => {
  "use strict";

  // ---------- Config ----------
  // physics values are tuned per 60fps frame and scaled by dt
  const W = 480;
  let H = 640; // grows on tall phone screens, see resize()
  const GRAVITY = 0.42;
  const FLAP_VELOCITY = -7.6;
  const MAX_FALL_SPEED = 10;
  const PIPE_WIDTH = 64;
  const PIPE_SPACING = 230; // px between pipes
  const BASE_SPEED = 2.6;
  const MAX_SPEED = 3.6;
  const BASE_GAP = 172;
  const MIN_GAP = 140;
  const GROUND_HEIGHT = 72;
  let GROUND_Y = H - GROUND_HEIGHT;
  const BIRD_RADIUS = 18;
  const HIT_RADIUS = 14; // a bit smaller than drawn, feels fair
  const BIRD_X = 130;
  const PALETTE_EVERY = 15; // score steps between sky changes

  const COLORS = [
    { name: "San hô", value: "#ff6b5b" },
    { name: "Hổ phách", value: "#ffb547" },
    { name: "Bạc hà", value: "#3ec1a6" },
    { name: "Trời", value: "#4d96ff" },
    { name: "Oải hương", value: "#8e7cff" },
    { name: "Hồng", value: "#ff8fb1" },
  ];

  const PALETTES = [
    // day
    { sky: "#f4efe6", sun: "#f7d9bf", far: "#ebe3d4", near: "#e2d8c6", ground: "#ddd2bd", dash: "#cfc3ab", pipe: "#2b2d33", ink: "#2b2d33" },
    // sunset
    { sky: "#f8e7dc", sun: "#f6b796", far: "#f0d6c8", near: "#e7c5b5", ground: "#ddb9a6", dash: "#cfa591", pipe: "#3b2c38", ink: "#3b2c38" },
    // dusk
    { sky: "#e4e5ef", sun: "#fbf1d6", far: "#d4d5e4", near: "#c5c6d9", ground: "#babbd1", dash: "#a9aac3", pipe: "#262838", ink: "#262838" },
  ];

  const STORAGE_KEY = "flaryBirdSettings";
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ---------- State ----------
  const state = {
    screen: "menu", // menu | ready | playing | dying | gameover
    color: COLORS[0].value,
    best: 0,
    muted: false,
  };

  // ---------- Persistence ----------
  function loadSettings() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (COLORS.some((c) => c.value === data.color)) state.color = data.color;
      if (data.best) state.best = data.best;
      if (data.muted) state.muted = true;
      // drop the old uploaded-avatar blob from earlier versions
      if (data.avatarDataUrl) saveSettings();
    } catch (e) {
      /* ignore corrupt storage */
    }
  }

  function saveSettings() {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ color: state.color, best: state.best, muted: state.muted })
      );
    } catch (e) {
      /* storage unavailable - game still works this session */
    }
  }

  // ---------- Color helpers ----------
  function hexToRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [n >> 16, (n >> 8) & 255, n & 255];
  }

  function rgb(c) {
    return `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;
  }

  function shade(hex, amount) {
    return rgb(hexToRgb(hex).map((v) => Math.max(0, Math.min(255, v + amount))));
  }

  // live palette that eases toward the target palette
  const palette = {};
  let paletteTarget = 0;
  function setPalette(index, instant) {
    paletteTarget = index;
    for (const k in PALETTES[index]) {
      const target = hexToRgb(PALETTES[index][k]);
      if (instant || !palette[k]) palette[k] = target.slice();
    }
  }

  function easePalette(dt) {
    const t = Math.min(1, dt * 0.035);
    const target = PALETTES[paletteTarget];
    for (const k in target) {
      const to = hexToRgb(target[k]);
      for (let i = 0; i < 3; i++) palette[k][i] += (to[i] - palette[k][i]) * t;
    }
  }

  // ---------- Sound ----------
  let audio = null;
  function ensureAudio() {
    if (audio) {
      if (audio.state === "suspended") audio.resume();
      return;
    }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (Ctx) audio = new Ctx();
  }

  function tone(freqFrom, freqTo, duration, type, volume, delay = 0) {
    if (!audio || state.muted) return;
    const t0 = audio.currentTime + delay;
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freqFrom, t0);
    osc.frequency.exponentialRampToValueAtTime(freqTo, t0 + duration);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(volume, t0 + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    osc.connect(gain).connect(audio.destination);
    osc.start(t0);
    osc.stop(t0 + duration + 0.02);
  }

  const sfx = {
    flap: () => tone(480, 760, 0.09, "sine", 0.07),
    score: () => {
      tone(880, 880, 0.08, "triangle", 0.06);
      tone(1320, 1320, 0.14, "triangle", 0.06, 0.07);
    },
    hit: () => {
      tone(200, 50, 0.3, "sine", 0.22);
      tone(120, 40, 0.18, "square", 0.04);
    },
    best: () => {
      [660, 880, 1100, 1320].forEach((f, i) => tone(f, f, 0.16, "triangle", 0.05, i * 0.08));
    },
  };

  // ---------- Canvas setup ----------
  const wrap = document.getElementById("game-wrap");
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");

  function resize() {
    const prevGround = GROUND_Y;
    H = Math.max(640, Math.round((W * wrap.clientHeight) / wrap.clientWidth));
    GROUND_Y = H - GROUND_HEIGHT;
    if (bird) bird.y += GROUND_Y - prevGround;
    for (const p of pipes || []) p.gapY += GROUND_Y - prevGround;
    const scale = (wrap.clientWidth * (window.devicePixelRatio || 1)) / W;
    canvas.width = Math.round(W * scale);
    canvas.height = Math.round(H * scale);
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
  }

  // ---------- World ----------
  let bird, pipes, score, distSincePipe, worldX, time;
  let particles = [];
  let rings = [];
  let shake = 0;
  let flash = 0;
  let scorePop = 0;
  let deadTimer = 0;
  let screenLockUntil = 0;

  function resetWorld() {
    bird = { x: BIRD_X, y: H * 0.42, vy: 0, angle: 0, flapT: 0, dead: false };
    pipes = [];
    score = 0;
    distSincePipe = PIPE_SPACING - 120; // first pipe arrives quickly
    rings = [];
    scorePop = 0;
    deadTimer = 0;
    setPalette(0, false);
  }

  function speed() {
    return Math.min(MAX_SPEED, BASE_SPEED + score * 0.04);
  }

  function gapSize() {
    return Math.max(MIN_GAP, BASE_GAP - score * 1.2);
  }

  function spawnPipe() {
    const gap = gapSize();
    const minY = 70;
    const maxY = GROUND_Y - 70 - gap;
    let gapY = minY + Math.random() * (maxY - minY);
    // keep consecutive gaps reachable
    const prev = pipes[pipes.length - 1];
    if (prev) gapY = Math.max(prev.gapY - 170, Math.min(prev.gapY + 170, gapY));
    pipes.push({ x: W + 10, gapY, gap, passed: false });
  }

  function puff(x, y, color, count, power) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = (0.4 + Math.random()) * power;
      particles.push({
        x, y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        r: 2 + Math.random() * 3.5,
        life: 1,
        decay: 0.025 + Math.random() * 0.02,
        color,
      });
    }
  }

  function flap() {
    bird.vy = FLAP_VELOCITY;
    bird.flapT = 1;
    // little puff trailing behind and below the bird
    for (let i = 0; i < 3; i++) {
      particles.push({
        x: bird.x - BIRD_RADIUS * 0.6,
        y: bird.y + BIRD_RADIUS * 0.5,
        vx: -1 - Math.random() * 1.2,
        vy: 0.6 + Math.random() * 1.2,
        r: 2.5 + Math.random() * 2.5,
        life: 0.8,
        decay: 0.04,
        color: "#ffffff",
      });
    }
    sfx.flap();
  }

  function circleRectCollide(cx, cy, r, rx, ry, rw, rh) {
    const closestX = Math.max(rx, Math.min(cx, rx + rw));
    const closestY = Math.max(ry, Math.min(cy, ry + rh));
    const dx = cx - closestX;
    const dy = cy - closestY;
    return dx * dx + dy * dy < r * r;
  }

  // ---------- Update ----------
  function updateBirdPhysics(dt) {
    bird.vy = Math.min(bird.vy + GRAVITY * dt, MAX_FALL_SPEED);
    bird.y += bird.vy * dt;
    const target = bird.dead ? 1.6 : bird.vy < 0 ? -0.45 : Math.min(1.3, bird.vy * 0.12);
    bird.angle += (target - bird.angle) * Math.min(1, dt * (bird.vy < 0 ? 0.35 : 0.12));
  }

  function update(dt) {
    time += dt;
    bird.flapT = Math.max(0, bird.flapT - dt * 0.08);
    scorePop = Math.max(0, scorePop - dt * 0.06);
    shake = Math.max(0, shake - dt * 0.6);
    flash = Math.max(0, flash - dt * 0.06);

    const s = state.screen;

    if (s === "menu" || s === "ready") {
      worldX += 1.2 * dt;
      const homeX = s === "menu" ? W / 2 : BIRD_X;
      const homeY = s === "menu" ? H * 0.3 : H * 0.42;
      bird.x += (homeX - bird.x) * Math.min(1, dt * 0.12);
      bird.y = homeY + Math.sin(time * 0.08) * 8;
      bird.angle = Math.sin(time * 0.08 + 1) * 0.08;
      if (Math.sin(time * 0.16) > 0.97 && bird.flapT === 0) bird.flapT = 0.6;
    }

    if (s === "playing") {
      const v = speed();
      worldX += v * dt;
      updateBirdPhysics(dt);

      if (bird.y < HIT_RADIUS) {
        bird.y = HIT_RADIUS;
        bird.vy = Math.max(0, bird.vy);
      }

      distSincePipe += v * dt;
      if (distSincePipe >= PIPE_SPACING) {
        distSincePipe -= PIPE_SPACING;
        spawnPipe();
      }

      for (const p of pipes) {
        p.x -= v * dt;
        if (!p.passed && p.x + PIPE_WIDTH / 2 < bird.x) {
          p.passed = true;
          score++;
          scorePop = 1;
          rings.push({ x: bird.x, y: bird.y, r: BIRD_RADIUS, life: 1 });
          sfx.score();
          const next = Math.floor(score / PALETTE_EVERY) % PALETTES.length;
          if (next !== paletteTarget) setPalette(next, false);
        }
      }
      pipes = pipes.filter((p) => p.x > -PIPE_WIDTH - 10);

      if (bird.y + HIT_RADIUS >= GROUND_Y) {
        die(false);
      } else {
        for (const p of pipes) {
          if (
            circleRectCollide(bird.x, bird.y, HIT_RADIUS, p.x, -60, PIPE_WIDTH, p.gapY + 60) ||
            circleRectCollide(bird.x, bird.y, HIT_RADIUS, p.x, p.gapY + p.gap, PIPE_WIDTH, H)
          ) {
            die(true);
            break;
          }
        }
      }
    }

    if (s === "dying") {
      if (bird.y + BIRD_RADIUS < GROUND_Y) {
        updateBirdPhysics(dt);
        if (bird.y + BIRD_RADIUS >= GROUND_Y) {
          bird.y = GROUND_Y - BIRD_RADIUS;
          puff(bird.x, GROUND_Y, rgb(palette.dash), 6, 1.5);
        }
      } else {
        bird.angle += (1.6 - bird.angle) * Math.min(1, dt * 0.2);
        deadTimer += dt;
        if (deadTimer > 30) showGameOver();
      }
    }

    for (const p of particles) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 0.08 * dt;
      p.vx *= 0.98;
      p.life -= p.decay * dt;
    }
    particles = particles.filter((p) => p.life > 0);

    for (const r of rings) {
      r.r += 2.2 * dt;
      r.life -= 0.045 * dt;
    }
    rings = rings.filter((r) => r.life > 0);

    easePalette(dt);
  }

  function die(hitPipe) {
    state.screen = "dying";
    bird.dead = true;
    bird.vy = hitPipe ? -4 : 0;
    if (!hitPipe) bird.y = GROUND_Y - BIRD_RADIUS;
    shake = reducedMotion ? 0 : 12;
    flash = 1;
    puff(bird.x, bird.y, state.color, 16, 3.2);
    sfx.hit();
  }

  // ---------- Drawing ----------
  function drawSkyAndHills() {
    ctx.fillStyle = rgb(palette.sky);
    ctx.fillRect(-20, -20, W + 40, H + 40);

    // sun
    ctx.fillStyle = rgb(palette.sun);
    ctx.beginPath();
    ctx.arc(W * 0.72, H * 0.26, 64, 0, Math.PI * 2);
    ctx.fill();

    // soft clouds
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    for (let i = 0; i < 3; i++) {
      const span = W + 160;
      const x = ((i * 190 + 60 - worldX * 0.08) % span + span) % span - 80;
      const y = 110 + i * 55;
      const w = 70 + i * 12;
      roundRect(x, y, w, 18, 9);
      ctx.fill();
    }

    drawHills(palette.far, GROUND_Y - 80, 26, 14, 0.15, 0.011, 0.023);
    drawHills(palette.near, GROUND_Y - 34, 18, 10, 0.35, 0.017, 0.031);
  }

  function drawHills(color, baseY, a1, a2, parallax, f1, f2) {
    const off = worldX * parallax;
    ctx.fillStyle = rgb(color);
    ctx.beginPath();
    ctx.moveTo(0, GROUND_Y + 1);
    for (let x = 0; x <= W; x += 8) {
      const y = baseY - a1 * Math.sin((x + off) * f1) - a2 * Math.sin((x + off) * f2 + 1.3);
      ctx.lineTo(x, y);
    }
    ctx.lineTo(W, GROUND_Y + 1);
    ctx.closePath();
    ctx.fill();
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawPipes() {
    const pipeColor = rgb(palette.pipe);
    for (const p of pipes) {
      const botY = p.gapY + p.gap;
      ctx.fillStyle = pipeColor;
      roundRect(p.x, -40, PIPE_WIDTH, p.gapY + 40, 14);
      ctx.fill();
      roundRect(p.x, botY, PIPE_WIDTH, GROUND_Y - botY + 40, 14);
      ctx.fill();

      // single soft highlight stripe
      ctx.fillStyle = "rgba(255,255,255,0.08)";
      ctx.fillRect(p.x + 10, -40, 8, p.gapY + 40 - 14);
      ctx.fillRect(p.x + 10, botY + 14, 8, GROUND_Y - botY);
    }
  }

  function drawGround() {
    ctx.fillStyle = rgb(palette.ground);
    ctx.fillRect(-20, GROUND_Y, W + 40, GROUND_HEIGHT + 20);
    ctx.fillStyle = rgb(palette.dash);
    const off = worldX % 32;
    for (let x = -off; x < W + 32; x += 32) {
      roundRect(x, GROUND_Y + 14, 14, 4, 2);
      ctx.fill();
    }
  }

  function drawBird(x, y, r, angle, color, flapT, dead) {
    // squash & stretch right after a flap
    const k = Math.sin(flapT * Math.PI) * 0.16;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.scale(1 - k, 1 + k);

    // body
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();

    // wing swings up while flapT is high
    ctx.fillStyle = shade(color, -28);
    ctx.save();
    ctx.translate(-r * 0.2, r * 0.12);
    ctx.rotate(-1.1 * flapT + 0.2);
    ctx.beginPath();
    ctx.ellipse(-r * 0.25, 0, r * 0.55, r * 0.3, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // beak
    ctx.fillStyle = color === "#ffb547" ? "#ff7a45" : "#ffb547";
    ctx.beginPath();
    ctx.moveTo(r * 0.78, -r * 0.08);
    ctx.lineTo(r * 1.32, r * 0.12);
    ctx.lineTo(r * 0.78, r * 0.32);
    ctx.closePath();
    ctx.fill();

    // eye
    const ex = r * 0.4;
    const ey = -r * 0.28;
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(ex, ey, r * 0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = ctx.fillStyle = "#2b2d33";
    if (dead) {
      const d = r * 0.14;
      ctx.lineWidth = 2.2;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(ex - d, ey - d);
      ctx.lineTo(ex + d, ey + d);
      ctx.moveTo(ex + d, ey - d);
      ctx.lineTo(ex - d, ey + d);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.arc(ex + r * 0.08, ey, r * 0.15, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  function drawEffects() {
    for (const p of particles) {
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * (0.5 + p.life * 0.5), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = state.color;
    for (const r of rings) {
      ctx.globalAlpha = Math.max(0, r.life) * 0.7;
      ctx.lineWidth = 3 * r.life;
      ctx.beginPath();
      ctx.arc(r.x, r.y, r.r, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  function drawHud() {
    const s = state.screen;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    if (s === "playing" || s === "dying") {
      const scale = 1 + Math.sin(scorePop * Math.PI) * 0.25;
      ctx.save();
      ctx.translate(W / 2, 78);
      ctx.scale(scale, scale);
      ctx.fillStyle = rgb(palette.ink);
      ctx.font = '700 64px "Outfit", "Segoe UI", sans-serif';
      ctx.fillText(score, 0, 0);
      ctx.restore();
    }

    if (s === "ready") {
      ctx.globalAlpha = 0.55 + Math.sin(time * 0.1) * 0.35;
      ctx.fillStyle = rgb(palette.ink);
      ctx.font = '500 18px "Outfit", "Segoe UI", sans-serif';
      ctx.fillText("Chạm để bay", W / 2, H * 0.62);
      ctx.globalAlpha = 1;
    }
  }

  function render() {
    ctx.save();
    if (shake > 0) {
      ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
    }
    drawSkyAndHills();
    drawPipes();
    drawGround();
    drawEffects();
    drawBird(bird.x, bird.y, BIRD_RADIUS, bird.angle, state.color, bird.flapT, bird.dead);
    ctx.restore();

    drawHud();

    if (flash > 0) {
      ctx.fillStyle = `rgba(255,255,255,${flash * 0.7})`;
      ctx.fillRect(0, 0, W, H);
    }
  }

  let lastTime = 0;
  function loop(now) {
    const dt = Math.min(now - lastTime, 50) / (1000 / 60);
    lastTime = now;
    update(dt);
    render();
    requestAnimationFrame(loop);
  }

  // ---------- Screens ----------
  const startScreen = document.getElementById("start-screen");
  const gameoverScreen = document.getElementById("gameover-screen");
  const finalScoreEl = document.getElementById("final-score");
  const bestScoreEl = document.getElementById("best-score");
  const newBestEl = document.getElementById("new-best");
  const startBtn = document.getElementById("start-btn");
  const retryBtn = document.getElementById("retry-btn");
  const menuBtn = document.getElementById("menu-btn");
  const soundBtn = document.getElementById("sound-btn");

  function toReady() {
    ensureAudio();
    resetWorld();
    state.screen = "ready";
    startScreen.classList.add("hidden");
    gameoverScreen.classList.add("hidden");
    screenLockUntil = performance.now() + 150;
  }

  function startPlaying() {
    state.screen = "playing";
    flap();
  }

  function showGameOver() {
    state.screen = "gameover";
    const isBest = score > state.best;
    if (isBest) {
      state.best = score;
      saveSettings();
      setTimeout(sfx.best, 250);
    }
    finalScoreEl.textContent = score;
    bestScoreEl.textContent = state.best;
    newBestEl.classList.toggle("hidden", !isBest);
    gameoverScreen.classList.remove("hidden");
    screenLockUntil = performance.now() + 450;
  }

  function showMenu() {
    resetWorld();
    state.screen = "menu";
    gameoverScreen.classList.add("hidden");
    startScreen.classList.remove("hidden");
  }

  // ---------- Input ----------
  function primaryAction() {
    if (performance.now() < screenLockUntil) return;
    ensureAudio();
    const s = state.screen;
    if (s === "ready") startPlaying();
    else if (s === "playing") flap();
    else if (s === "gameover" || s === "menu") toReady();
  }

  wrap.addEventListener("pointerdown", (e) => {
    if (e.target.closest("button")) return;
    const s = state.screen;
    if (s === "ready" || s === "playing") {
      e.preventDefault();
      primaryAction();
    }
  });

  window.addEventListener("keydown", (e) => {
    if (e.code === "Space" || e.code === "ArrowUp" || e.code === "KeyW") {
      e.preventDefault();
      if (!e.repeat) primaryAction();
    }
  });
  // stop a focused button from also firing on Space
  window.addEventListener("keyup", (e) => {
    if (e.code === "Space") e.preventDefault();
  });

  function onButton(btn, fn) {
    btn.addEventListener("click", () => {
      btn.blur();
      fn();
    });
  }
  onButton(startBtn, toReady);
  onButton(retryBtn, () => {
    if (performance.now() >= screenLockUntil) toReady();
  });
  onButton(menuBtn, showMenu);

  const ICON_ON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/></svg>';
  const ICON_OFF =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H3v6h3l5 4z"/><path d="m16 9 5 6"/><path d="m21 9-5 6"/></svg>';

  function renderSoundBtn() {
    soundBtn.innerHTML = state.muted ? ICON_OFF : ICON_ON;
    soundBtn.setAttribute("aria-pressed", String(!state.muted));
  }
  onButton(soundBtn, () => {
    state.muted = !state.muted;
    saveSettings();
    renderSoundBtn();
    ensureAudio();
  });

  // ---------- Color picker ----------
  const colorPickerEl = document.getElementById("color-picker");
  function buildColorPicker() {
    COLORS.forEach((c) => {
      const el = document.createElement("button");
      el.className = "swatch" + (c.value === state.color ? " selected" : "");
      el.style.background = c.value;
      el.title = c.name;
      el.setAttribute("role", "radio");
      el.setAttribute("aria-label", c.name);
      el.setAttribute("aria-checked", String(c.value === state.color));
      el.addEventListener("click", () => {
        state.color = c.value;
        saveSettings();
        for (const ch of colorPickerEl.children) {
          ch.classList.toggle("selected", ch === el);
          ch.setAttribute("aria-checked", String(ch === el));
        }
        // a happy hop to show off the new color
        bird.flapT = 1;
        puff(bird.x, bird.y, c.value, 10, 2);
        ensureAudio();
        sfx.flap();
      });
      colorPickerEl.appendChild(el);
    });
  }

  // ---------- Init ----------
  loadSettings();
  setPalette(0, true);
  resetWorld();
  bird.x = W / 2;
  worldX = 0;
  time = 0;
  buildColorPicker();
  renderSoundBtn();
  resize();
  window.addEventListener("resize", resize);
  requestAnimationFrame((now) => {
    lastTime = now;
    requestAnimationFrame(loop);
  });
})();
