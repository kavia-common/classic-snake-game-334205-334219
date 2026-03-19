/* global window, localStorage, performance, requestAnimationFrame */
import "./style.css";

/**
 * Classic Snake (grid-based) implemented with an HTMLCanvasElement and a simple UI.
 * - Arrow keys / WASD to move
 * - Space to pause/resume
 * - R to restart (also button)
 * - Responsive canvas (keeps crisp pixels using devicePixelRatio)
 */

const GRID_SIZE = 21; // 21x21 grid
const INITIAL_SPEED_MS = 130; // lower = faster
const MIN_SPEED_MS = 70;
const SPEEDUP_EVERY_FOOD = 2; // speed increases every N foods eaten
const HIGHSCORE_KEY = "snake.highScore.v1";

const DIRECTIONS = {
  Up: { x: 0, y: -1 },
  Down: { x: 0, y: 1 },
  Left: { x: -1, y: 0 },
  Right: { x: 1, y: 0 },
};

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function posKey(p) {
  return `${p.x},${p.y}`;
}

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function loadHighScore() {
  try {
    const raw = localStorage.getItem(HIGHSCORE_KEY);
    const n = raw ? Number(raw) : 0;
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

function saveHighScore(score) {
  try {
    localStorage.setItem(HIGHSCORE_KEY, String(score));
  } catch {
    // ignore
  }
}

function isOpposite(a, b) {
  return a.x + b.x === 0 && a.y + b.y === 0;
}

function createLayout() {
  const app = document.querySelector("#app");
  app.innerHTML = `
    <div class="app-shell">
      <header class="topbar">
        <div class="brand">
          <div class="brand__dot" aria-hidden="true"></div>
          <div class="brand__text">
            <h1>Snake</h1>
            <p class="subtitle">Classic grid-based gameplay</p>
          </div>
        </div>

        <div class="stats" aria-label="Game stats">
          <div class="stat">
            <div class="stat__label">Score</div>
            <div class="stat__value" id="scoreValue">0</div>
          </div>
          <div class="stat">
            <div class="stat__label">High</div>
            <div class="stat__value" id="highScoreValue">0</div>
          </div>
          <div class="stat stat--small">
            <div class="stat__label">Speed</div>
            <div class="stat__value" id="speedValue">1.0×</div>
          </div>
        </div>
      </header>

      <main class="game-area">
        <div class="board-card">
          <div class="board-wrap">
            <canvas id="gameCanvas" class="board" aria-label="Snake game board"></canvas>

            <div class="overlay" id="overlay" aria-live="polite">
              <div class="overlay__card">
                <div class="overlay__title" id="overlayTitle">Press any arrow key</div>
                <div class="overlay__text" id="overlayText">
                  Use <span class="kbd">←</span><span class="kbd">↑</span><span class="kbd">→</span><span class="kbd">↓</span> or <span class="kbd">W</span><span class="kbd">A</span><span class="kbd">S</span><span class="kbd">D</span>.
                  <br />
                  <span class="hint">Space: pause • R: restart</span>
                </div>
                <div class="overlay__actions">
                  <button class="btn btn--primary" id="startBtn" type="button">Start</button>
                  <button class="btn" id="restartBtnOverlay" type="button">Restart</button>
                </div>
              </div>
            </div>
          </div>

          <div class="controls">
            <button class="btn btn--primary" id="restartBtn" type="button">Restart</button>
            <button class="btn" id="pauseBtn" type="button" aria-pressed="false">Pause</button>
            <div class="help">
              <span class="help__label">Controls:</span>
              <span class="help__keys">
                <span class="kbd">Arrows</span> / <span class="kbd">WASD</span>,
                <span class="kbd">Space</span> pause,
                <span class="kbd">R</span> restart
              </span>
            </div>
          </div>
        </div>
      </main>

      <footer class="footer">
        <span>Eat food, grow longer, avoid walls & yourself.</span>
      </footer>
    </div>
  `;

  return {
    canvas: /** @type {HTMLCanvasElement} */ (document.getElementById("gameCanvas")),
    overlay: document.getElementById("overlay"),
    overlayTitle: document.getElementById("overlayTitle"),
    overlayText: document.getElementById("overlayText"),
    scoreValue: document.getElementById("scoreValue"),
    highScoreValue: document.getElementById("highScoreValue"),
    speedValue: document.getElementById("speedValue"),
    startBtn: document.getElementById("startBtn"),
    restartBtn: document.getElementById("restartBtn"),
    restartBtnOverlay: document.getElementById("restartBtnOverlay"),
    pauseBtn: document.getElementById("pauseBtn"),
  };
}

function createGameState() {
  const mid = Math.floor(GRID_SIZE / 2);
  const snake = [
    { x: mid - 1, y: mid },
    { x: mid, y: mid },
    { x: mid + 1, y: mid },
  ];

  return {
    snake,
    direction: DIRECTIONS.Right,
    pendingDirection: DIRECTIONS.Right,
    food: { x: 3, y: 3 },
    score: 0,
    foodsEaten: 0,
    speedMs: INITIAL_SPEED_MS,
    paused: false,
    running: false,
    gameOver: false,
    lastTickMs: 0,
  };
}

function spawnFood(state) {
  const occupied = new Set(state.snake.map(posKey));
  // Simple retry loop; grid is small so this is fine.
  for (let tries = 0; tries < 3000; tries++) {
    const candidate = { x: randInt(0, GRID_SIZE - 1), y: randInt(0, GRID_SIZE - 1) };
    if (!occupied.has(posKey(candidate))) {
      state.food = candidate;
      return;
    }
  }
  // If we fail (should be extremely rare), treat as win condition.
  state.gameOver = true;
}

function computeSpeedMultiplier(speedMs) {
  return INITIAL_SPEED_MS / speedMs;
}

function updateSpeedAfterFood(state) {
  if (state.foodsEaten > 0 && state.foodsEaten % SPEEDUP_EVERY_FOOD === 0) {
    state.speedMs = clamp(Math.round(state.speedMs * 0.92), MIN_SPEED_MS, INITIAL_SPEED_MS);
  }
}

function step(state) {
  // Apply queued direction at tick boundary to avoid mid-tick changes.
  state.direction = state.pendingDirection;

  const head = state.snake[state.snake.length - 1];
  const next = { x: head.x + state.direction.x, y: head.y + state.direction.y };

  // Wall collision
  if (next.x < 0 || next.x >= GRID_SIZE || next.y < 0 || next.y >= GRID_SIZE) {
    state.gameOver = true;
    return;
  }

  // Self collision: allow moving into the tail only if it will move away (i.e. not growing this tick)
  const willEat = next.x === state.food.x && next.y === state.food.y;
  const bodyToCheck = willEat ? state.snake : state.snake.slice(1); // exclude tail when not growing
  if (bodyToCheck.some((p) => p.x === next.x && p.y === next.y)) {
    state.gameOver = true;
    return;
  }

  state.snake.push(next);

  if (willEat) {
    state.score += 10;
    state.foodsEaten += 1;
    updateSpeedAfterFood(state);
    spawnFood(state);
  } else {
    state.snake.shift();
  }
}

function createRenderer(canvas) {
  const ctx = canvas.getContext("2d", { alpha: false });

  // Render sizing:
  // - CSS controls display size
  // - Canvas width/height are set in device pixels for crisp lines
  let dpr = 1;
  let cssSize = 420;
  let cellPx = 20;

  function resize() {
    dpr = window.devicePixelRatio || 1;

    const parent = canvas.parentElement;
    const parentWidth = parent ? parent.clientWidth : 420;
    // Keep it square, within reasonable limits
    cssSize = clamp(parentWidth, 260, 620);
    canvas.style.width = `${cssSize}px`;
    canvas.style.height = `${cssSize}px`;

    const backing = Math.floor(cssSize * dpr);
    canvas.width = backing;
    canvas.height = backing;

    cellPx = backing / GRID_SIZE;

    // Ensure crisp edges
    ctx.imageSmoothingEnabled = false;
  }

  function draw(state) {
    // Background
    ctx.fillStyle = "#f8fafc";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Subtle grid
    ctx.strokeStyle = "rgba(15, 23, 42, 0.06)";
    ctx.lineWidth = Math.max(1, Math.floor(dpr));
    for (let i = 0; i <= GRID_SIZE; i++) {
      const p = Math.round(i * cellPx) + 0.5; // 0.5 for crisp
      ctx.beginPath();
      ctx.moveTo(p, 0);
      ctx.lineTo(p, canvas.height);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(0, p);
      ctx.lineTo(canvas.width, p);
      ctx.stroke();
    }

    // Food (cyan)
    const fx = state.food.x * cellPx;
    const fy = state.food.y * cellPx;
    const pad = cellPx * 0.14;
    ctx.fillStyle = "#06b6d4";
    roundRect(ctx, fx + pad, fy + pad, cellPx - 2 * pad, cellPx - 2 * pad, cellPx * 0.25);
    ctx.fill();

    // Snake
    // Body gradient-like via two tones:
    const body = "#3b82f6";
    const body2 = "#2563eb";
    for (let i = 0; i < state.snake.length; i++) {
      const s = state.snake[i];
      const x = s.x * cellPx;
      const y = s.y * cellPx;
      const isHead = i === state.snake.length - 1;

      const inset = cellPx * (isHead ? 0.10 : 0.16);
      ctx.fillStyle = isHead ? body2 : body;

      roundRect(ctx, x + inset, y + inset, cellPx - 2 * inset, cellPx - 2 * inset, cellPx * 0.22);
      ctx.fill();

      if (isHead) {
        // Eyes
        ctx.fillStyle = "rgba(255,255,255,0.95)";
        const ex = x + cellPx * 0.62;
        const ey = y + cellPx * 0.32;
        const r = cellPx * 0.08;
        ctx.beginPath();
        ctx.arc(ex, ey, r, 0, Math.PI * 2);
        ctx.fill();

        ctx.beginPath();
        ctx.arc(x + cellPx * 0.62, y + cellPx * 0.68, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Border
    ctx.strokeStyle = "rgba(2, 6, 23, 0.18)";
    ctx.lineWidth = Math.max(2, Math.floor(dpr * 1.2));
    ctx.strokeRect(0, 0, canvas.width, canvas.height);
  }

  // Adapted helper for rounded rectangles
  function roundRect(c, x, y, w, h, r) {
    const radius = Math.min(r, w / 2, h / 2);
    c.beginPath();
    c.moveTo(x + radius, y);
    c.arcTo(x + w, y, x + w, y + h, radius);
    c.arcTo(x + w, y + h, x, y + h, radius);
    c.arcTo(x, y + h, x, y, radius);
    c.arcTo(x, y, x + w, y, radius);
    c.closePath();
  }

  return { resize, draw };
}

function wireControls(ui, state, renderFrame) {
  function showOverlay(title, text, showStart = true) {
    ui.overlayTitle.textContent = title;
    ui.overlayText.innerHTML = text;
    ui.overlay.classList.remove("overlay--hidden");
    ui.startBtn.style.display = showStart ? "" : "none";
  }

  function hideOverlay() {
    ui.overlay.classList.add("overlay--hidden");
  }

  function updateStats() {
    ui.scoreValue.textContent = String(state.score);
    const high = loadHighScore();
    ui.highScoreValue.textContent = String(high);
    ui.speedValue.textContent = `${computeSpeedMultiplier(state.speedMs).toFixed(2)}×`;
  }

  function setPaused(paused) {
    state.paused = paused;
    ui.pauseBtn.setAttribute("aria-pressed", paused ? "true" : "false");
    ui.pauseBtn.textContent = paused ? "Resume" : "Pause";

    if (state.running && paused && !state.gameOver) {
      showOverlay(
        "Paused",
        `Press <span class="kbd">Space</span> to resume.<br /><span class="hint">R: restart</span>`,
        false
      );
    } else if (state.running && !paused && !state.gameOver) {
      hideOverlay();
    }
  }

  function restart() {
    const high = loadHighScore();
    const fresh = createGameState();
    Object.assign(state, fresh);
    spawnFood(state);
    updateStats();
    setPaused(false);
    state.running = false;
    state.gameOver = false;

    showOverlay(
      "Press any arrow key",
      `Use <span class="kbd">←</span><span class="kbd">↑</span><span class="kbd">→</span><span class="kbd">↓</span> or <span class="kbd">W</span><span class="kbd">A</span><span class="kbd">S</span><span class="kbd">D</span>.<br />
       <span class="hint">Space: pause • R: restart</span>`,
      true
    );

    ui.highScoreValue.textContent = String(high);
    renderFrame();
  }

  function startIfNeeded() {
    if (!state.running && !state.gameOver) {
      state.running = true;
      hideOverlay();
      // ensure tick starts immediately
      state.lastTickMs = performance.now();
    }
  }

  function handleDirection(nextDir) {
    // Ignore opposite direction changes to avoid instant reversal.
    if (isOpposite(state.pendingDirection, nextDir)) return;
    state.pendingDirection = nextDir;
    startIfNeeded();
  }

  function onKeyDown(e) {
    const key = e.key;
    if (
      key === "ArrowUp" ||
      key === "ArrowDown" ||
      key === "ArrowLeft" ||
      key === "ArrowRight" ||
      key === "w" ||
      key === "a" ||
      key === "s" ||
      key === "d" ||
      key === "W" ||
      key === "A" ||
      key === "S" ||
      key === "D" ||
      key === " " ||
      key === "r" ||
      key === "R"
    ) {
      e.preventDefault();
    }

    if (key === " " && state.running && !state.gameOver) {
      setPaused(!state.paused);
      return;
    }
    if (key === "r" || key === "R") {
      restart();
      return;
    }
    if (state.gameOver) return;

    switch (key) {
      case "ArrowUp":
      case "w":
      case "W":
        handleDirection(DIRECTIONS.Up);
        break;
      case "ArrowDown":
      case "s":
      case "S":
        handleDirection(DIRECTIONS.Down);
        break;
      case "ArrowLeft":
      case "a":
      case "A":
        handleDirection(DIRECTIONS.Left);
        break;
      case "ArrowRight":
      case "d":
      case "D":
        handleDirection(DIRECTIONS.Right);
        break;
      default:
        break;
    }
  }

  ui.startBtn.addEventListener("click", () => {
    startIfNeeded();
    renderFrame();
  });
  ui.restartBtn.addEventListener("click", () => restart());
  ui.restartBtnOverlay.addEventListener("click", () => restart());
  ui.pauseBtn.addEventListener("click", () => {
    if (!state.running || state.gameOver) return;
    setPaused(!state.paused);
    renderFrame();
  });

  window.addEventListener("keydown", onKeyDown, { passive: false });

  return { restart, updateStats, showOverlay, hideOverlay, setPaused };
}

function main() {
  const ui = createLayout();
  const state = createGameState();
  const renderer = createRenderer(ui.canvas);

  const renderFrame = () => renderer.draw(state);

  renderer.resize();
  window.addEventListener("resize", () => {
    renderer.resize();
    renderFrame();
  });

  spawnFood(state);

  ui.highScoreValue.textContent = String(loadHighScore());
  ui.scoreValue.textContent = "0";
  ui.speedValue.textContent = `${computeSpeedMultiplier(state.speedMs).toFixed(2)}×`;

  const controls = wireControls(ui, state, renderFrame);

  // Initial overlay
  controls.showOverlay(
    "Press any arrow key",
    `Use <span class="kbd">←</span><span class="kbd">↑</span><span class="kbd">→</span><span class="kbd">↓</span> or <span class="kbd">W</span><span class="kbd">A</span><span class="kbd">S</span><span class="kbd">D</span>.<br />
     <span class="hint">Space: pause • R: restart</span>`,
    true
  );

  function gameOver() {
    state.running = false;
    state.gameOver = true;
    const high = loadHighScore();
    if (state.score > high) saveHighScore(state.score);

    ui.highScoreValue.textContent = String(loadHighScore());

    controls.showOverlay(
      "Game over",
      `Score: <strong>${state.score}</strong><br />
       Press <span class="kbd">R</span> to restart.`,
      false
    );
  }

  // Game loop using RAF but fixed-step timing for consistent snake speed.
  function loop(now) {
    if (state.running && !state.paused && !state.gameOver) {
      const elapsed = now - state.lastTickMs;
      if (elapsed >= state.speedMs) {
        // Avoid spiral-of-death: advance one step and reset tick time (not accumulate).
        state.lastTickMs = now;
        step(state);
        if (state.gameOver) {
          gameOver();
        } else {
          controls.updateStats();
        }
      }
    }

    renderFrame();
    requestAnimationFrame(loop);
  }

  // Render once before loop
  renderFrame();
  requestAnimationFrame((t) => {
    state.lastTickMs = t;
    requestAnimationFrame(loop);
  });

  // Expose a restart on load (useful for future automation)
  controls.restart();
}

main();
