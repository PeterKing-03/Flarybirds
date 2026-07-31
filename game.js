(() => {
  "use strict";

  // ---------- Config ----------
  const GRAVITY = 0.45;
  const FLAP_VELOCITY = -8;
  const MAX_FALL_SPEED = 11;
  const PIPE_WIDTH = 70;
  const PIPE_GAP = 165;
  const PIPE_SPEED = 2.6;
  const PIPE_INTERVAL = 1500; // ms
  const GROUND_HEIGHT = 80;
  const BIRD_RADIUS = 20;
  const BIRD_X = 130;

  const COLORS = [
    { name: "Đỏ", value: "#ff4d4d" },
    { name: "Cam", value: "#ff9f43" },
    { name: "Vàng", value: "#ffd93d" },
    { name: "Xanh lá", value: "#6bcB77" },
    { name: "Xanh dương", value: "#4d96ff" },
    { name: "Tím", value: "#9b59b6" },
    { name: "Hồng", value: "#ff6fa5" },
  ];

  const STORAGE_KEY = "flaryBirdSettings";

  // ---------- State ----------
  const state = {
    screen: "menu", // menu | playing | gameover
    color: COLORS[0].value,
    avatarDataUrl: null,
    avatarImg: null,
    best: 0,
  };

  // ---------- Persistence ----------
  function loadSettings() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const data = JSON.parse(raw);
        if (data.color) state.color = data.color;
        if (data.avatarDataUrl) {
          state.avatarDataUrl = data.avatarDataUrl;
          setAvatarImage(data.avatarDataUrl);
        }
        if (data.best) state.best = data.best;
      }
    } catch (e) {
      /* ignore corrupt storage */
    }
  }

  function saveSettings() {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          color: state.color,
          avatarDataUrl: state.avatarDataUrl,
          best: state.best,
        })
      );
    } catch (e) {
      /* storage quota exceeded - ignore, game still works this session */
    }
  }

  function setAvatarImage(dataUrl) {
    const img = new Image();
    img.onload = () => {
      state.avatarImg = img;
      drawPreview();
    };
    img.src = dataUrl;
  }

  // ---------- Color helpers ----------
  function shade(hex, percent) {
    const num = parseInt(hex.slice(1), 16);
    let r = (num >> 16) + percent;
    let g = ((num >> 8) & 0x00ff) + percent;
    let b = (num & 0x0000ff) + percent;
    r = Math.max(Math.min(255, r), 0);
    g = Math.max(Math.min(255, g), 0);
    b = Math.max(Math.min(255, b), 0);
    return "#" + (0x1000000 + r * 0x10000 + g * 0x100 + b).toString(16).slice(1);
  }

  // ---------- Bird drawing (shared by preview + game) ----------
  function drawBird(ctx, x, y, radius, angle, color, avatarImg) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);

    // tail / back wing
    ctx.beginPath();
    ctx.ellipse(-radius * 0.6, radius * 0.1, radius * 0.55, radius * 0.35, 0.4, 0, Math.PI * 2);
    ctx.fillStyle = shade(color, -30);
    ctx.fill();

    // body
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = shade(color, -50);
    ctx.lineWidth = 2;
    ctx.stroke();

    // belly highlight
    ctx.beginPath();
    ctx.ellipse(radius * 0.1, radius * 0.35, radius * 0.6, radius * 0.4, 0, 0, Math.PI * 2);
    ctx.fillStyle = shade(color, 40);
    ctx.globalAlpha = 0.5;
    ctx.fill();
    ctx.globalAlpha = 1;

    // wing (flap, front)
    ctx.beginPath();
    ctx.ellipse(-radius * 0.1, radius * 0.15, radius * 0.5, radius * 0.32, -0.3, 0, Math.PI * 2);
    ctx.fillStyle = shade(color, -15);
    ctx.fill();

    // beak
    ctx.beginPath();
    ctx.moveTo(radius * 0.75, -radius * 0.05);
    ctx.lineTo(radius * 1.35, radius * 0.05);
    ctx.lineTo(radius * 0.75, radius * 0.35);
    ctx.closePath();
    ctx.fillStyle = "#ff9f1c";
    ctx.fill();
    ctx.strokeStyle = "#c97400";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // bird's own eye (always shown)
    const eyeX = radius * 0.35;
    const eyeY = -radius * 0.35;
    const eyeR = radius * 0.22;
    ctx.beginPath();
    ctx.arc(eyeX, eyeY, eyeR, 0, Math.PI * 2);
    ctx.fillStyle = "#fff";
    ctx.fill();
    ctx.beginPath();
    ctx.arc(eyeX + eyeR * 0.35, eyeY, eyeR * 0.5, 0, Math.PI * 2);
    ctx.fillStyle = "#2c2c2c";
    ctx.fill();

    // rider on top of the bird (only once an avatar photo is uploaded)
    if (avatarImg) {
      drawRider(ctx, radius, color, avatarImg);
    }

    ctx.restore();
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // draws a small rider sitting on the bird's back, called from inside
  // drawBird's already-translated/rotated context so it moves with the bird
  function drawRider(ctx, radius, birdColor, avatarImg) {
    const hipY = -radius * 0.85;
    const legX = radius * 0.55;
    const footY = -radius * 0.05;
    const shoulderY = hipY - radius * 0.5;
    const headR = radius * 0.4;
    const headY = shoulderY - headR * 1.05;

    // legs straddling the bird's back
    ctx.strokeStyle = "#3d3d3d";
    ctx.lineWidth = Math.max(2, radius * 0.22);
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(0, hipY);
    ctx.lineTo(-legX, footY);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, hipY);
    ctx.lineTo(legX, footY);
    ctx.stroke();

    // torso
    ctx.fillStyle = "#f4f4f4";
    ctx.strokeStyle = shade(birdColor, -40);
    ctx.lineWidth = 2;
    roundRect(ctx, -radius * 0.32, shoulderY, radius * 0.64, hipY - shoulderY, radius * 0.18);
    ctx.fill();
    ctx.stroke();

    // arms raised up beside the head
    ctx.strokeStyle = "#f4f4f4";
    ctx.lineWidth = Math.max(2, radius * 0.16);
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(-radius * 0.28, shoulderY + radius * 0.1);
    ctx.lineTo(-radius * 0.58, headY + radius * 0.15);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(radius * 0.28, shoulderY + radius * 0.1);
    ctx.lineTo(radius * 0.58, headY + radius * 0.15);
    ctx.stroke();

    // head with the uploaded avatar as the face
    ctx.save();
    ctx.beginPath();
    ctx.arc(0, headY, headR, 0, Math.PI * 2);
    ctx.clip();
    const iw = avatarImg.width;
    const ih = avatarImg.height;
    const size = Math.min(iw, ih);
    const sx = (iw - size) / 2;
    const sy = (ih - size) / 2;
    ctx.drawImage(avatarImg, sx, sy, size, size, -headR, headY - headR, headR * 2, headR * 2);
    ctx.restore();
    ctx.beginPath();
    ctx.arc(0, headY, headR, 0, Math.PI * 2);
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#fff";
    ctx.stroke();
  }

  // ---------- Preview canvas ----------
  const previewCanvas = document.getElementById("bird-preview");
  const previewCtx = previewCanvas.getContext("2d");

  function drawPreview() {
    previewCtx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
    drawBird(
      previewCtx,
      previewCanvas.width / 2 - 6,
      previewCanvas.height / 2 + 20,
      34,
      0,
      state.color,
      state.avatarImg
    );
  }

  // ---------- Color picker UI ----------
  const colorPickerEl = document.getElementById("color-picker");
  function buildColorPicker() {
    colorPickerEl.innerHTML = "";
    COLORS.forEach((c) => {
      const el = document.createElement("div");
      el.className = "swatch" + (c.value === state.color ? " selected" : "");
      el.style.background = c.value;
      el.title = c.name;
      el.addEventListener("click", () => {
        state.color = c.value;
        saveSettings();
        [...colorPickerEl.children].forEach((ch) => ch.classList.remove("selected"));
        el.classList.add("selected");
        drawPreview();
      });
      colorPickerEl.appendChild(el);
    });
  }

  // ---------- Avatar upload ----------
  const avatarInput = document.getElementById("avatar-input");
  const avatarClearBtn = document.getElementById("avatar-clear");

  avatarInput.addEventListener("change", (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      state.avatarDataUrl = ev.target.result;
      setAvatarImage(state.avatarDataUrl);
      saveSettings();
    };
    reader.readAsDataURL(file);
  });

  avatarClearBtn.addEventListener("click", () => {
    state.avatarDataUrl = null;
    state.avatarImg = null;
    avatarInput.value = "";
    saveSettings();
    drawPreview();
  });

  // ---------- Game canvas ----------
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  const W = canvas.width;
  const H = canvas.height;

  const startScreen = document.getElementById("start-screen");
  const gameoverScreen = document.getElementById("gameover-screen");
  const scoreHud = document.getElementById("score-hud");
  const finalScoreEl = document.getElementById("final-score");
  const bestScoreEl = document.getElementById("best-score");
  const startBtn = document.getElementById("start-btn");
  const retryBtn = document.getElementById("retry-btn");
  const menuBtn = document.getElementById("menu-btn");

  let bird, pipes, score, lastPipeTime, groundOffset, running;

  function resetGame() {
    bird = { x: BIRD_X, y: H / 2, vy: 0, angle: 0 };
    pipes = [];
    score = 0;
    lastPipeTime = 0;
    groundOffset = 0;
    running = false;
  }

  function spawnPipe() {
    const margin = 60;
    const gapY = margin + Math.random() * (H - GROUND_HEIGHT - margin * 2 - PIPE_GAP);
    pipes.push({ x: W, gapY, passed: false });
  }

  function flap() {
    if (state.screen !== "playing") return;
    bird.vy = FLAP_VELOCITY;
  }

  function circleRectCollide(cx, cy, r, rx, ry, rw, rh) {
    const closestX = Math.max(rx, Math.min(cx, rx + rw));
    const closestY = Math.max(ry, Math.min(cy, ry + rh));
    const dx = cx - closestX;
    const dy = cy - closestY;
    return dx * dx + dy * dy < r * r;
  }

  function update(dt, now) {
    // bird physics
    bird.vy = Math.min(bird.vy + GRAVITY, MAX_FALL_SPEED);
    bird.y += bird.vy;
    bird.angle = Math.max(-0.5, Math.min(1.2, bird.vy / 12));

    // ground scroll
    groundOffset = (groundOffset + PIPE_SPEED) % 24;

    // pipes
    if (now - lastPipeTime > PIPE_INTERVAL) {
      spawnPipe();
      lastPipeTime = now;
    }

    for (const p of pipes) {
      p.x -= PIPE_SPEED;
      if (!p.passed && p.x + PIPE_WIDTH < bird.x - BIRD_RADIUS) {
        p.passed = true;
        score++;
      }
    }
    pipes = pipes.filter((p) => p.x > -PIPE_WIDTH);

    // collisions: ground / ceiling
    if (bird.y + BIRD_RADIUS > H - GROUND_HEIGHT || bird.y - BIRD_RADIUS < 0) {
      return gameOver();
    }

    // collisions: pipes
    for (const p of pipes) {
      const topH = p.gapY;
      const botY = p.gapY + PIPE_GAP;
      if (
        circleRectCollide(bird.x, bird.y, BIRD_RADIUS - 2, p.x, 0, PIPE_WIDTH, topH) ||
        circleRectCollide(bird.x, bird.y, BIRD_RADIUS - 2, p.x, botY, PIPE_WIDTH, H - botY)
      ) {
        return gameOver();
      }
    }

    scoreHud.textContent = score;
  }

  function drawBackground() {
    // sky
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, "#70c5ce");
    grad.addColorStop(1, "#a8e0e6");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    // simple clouds (static-ish, cheap decoration)
    ctx.fillStyle = "rgba(255,255,255,0.6)";
    for (let i = 0; i < 4; i++) {
      const cx = (i * 150 + 40 - groundOffset * 0.3) % (W + 100);
      ctx.beginPath();
      ctx.ellipse(cx, 80 + (i % 2) * 60, 30, 16, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawPipes() {
    for (const p of pipes) {
      const topH = p.gapY;
      const botY = p.gapY + PIPE_GAP;
      ctx.fillStyle = "#4caf50";
      ctx.strokeStyle = "#2e7d32";
      ctx.lineWidth = 3;

      // top pipe
      ctx.fillRect(p.x, 0, PIPE_WIDTH, topH);
      ctx.strokeRect(p.x, 0, PIPE_WIDTH, topH);
      ctx.fillRect(p.x - 4, topH - 24, PIPE_WIDTH + 8, 24);
      ctx.strokeRect(p.x - 4, topH - 24, PIPE_WIDTH + 8, 24);

      // bottom pipe
      ctx.fillRect(p.x, botY, PIPE_WIDTH, H - botY);
      ctx.strokeRect(p.x, botY, PIPE_WIDTH, H - botY);
      ctx.fillRect(p.x - 4, botY, PIPE_WIDTH + 8, 24);
      ctx.strokeRect(p.x - 4, botY, PIPE_WIDTH + 8, 24);
    }
  }

  function drawGround() {
    const groundY = H - GROUND_HEIGHT;
    ctx.fillStyle = "#ded895";
    ctx.fillRect(0, groundY, W, GROUND_HEIGHT);
    ctx.fillStyle = "#c2b280";
    for (let x = -24 + -groundOffset; x < W + 24; x += 24) {
      ctx.fillRect(x, groundY, 12, 10);
    }
    ctx.fillStyle = "#8bc34a";
    ctx.fillRect(0, groundY, W, 6);
  }

  function render() {
    drawBackground();
    drawPipes();
    drawGround();
    drawBird(ctx, bird.x, bird.y, BIRD_RADIUS, bird.angle, state.color, state.avatarImg);
  }

  let rafId = null;
  function loop(now) {
    if (state.screen === "playing") {
      update(0, now);
      render();
      rafId = requestAnimationFrame(loop);
    }
  }

  function gameOver() {
    state.screen = "gameover";
    if (score > state.best) {
      state.best = score;
      saveSettings();
    }
    finalScoreEl.textContent = score;
    bestScoreEl.textContent = state.best;
    scoreHud.classList.add("hidden");
    gameoverScreen.classList.remove("hidden");
    cancelAnimationFrame(rafId);
  }

  function startGame() {
    resetGame();
    state.screen = "playing";
    startScreen.classList.add("hidden");
    gameoverScreen.classList.add("hidden");
    scoreHud.classList.remove("hidden");
    scoreHud.textContent = "0";
    lastPipeTime = performance.now();
    rafId = requestAnimationFrame(loop);
  }

  function showMenu() {
    state.screen = "menu";
    gameoverScreen.classList.add("hidden");
    scoreHud.classList.add("hidden");
    startScreen.classList.remove("hidden");
    drawPreview();
  }

  // ---------- Input ----------
  function handleInput(e) {
    if (state.screen === "playing") {
      e.preventDefault();
      flap();
    }
  }

  canvas.addEventListener("pointerdown", handleInput);
  window.addEventListener("keydown", (e) => {
    if (e.code === "Space") {
      e.preventDefault();
      if (state.screen === "playing") flap();
    }
  });

  startBtn.addEventListener("click", startGame);
  retryBtn.addEventListener("click", startGame);
  menuBtn.addEventListener("click", showMenu);

  // ---------- Init ----------
  loadSettings();
  buildColorPicker();
  drawPreview();
  resetGame();
  render();
})();
