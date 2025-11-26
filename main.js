// Defender Pro PWA – full standalone logic

const targetImg = document.getElementById("targetImg");
const overlay = document.getElementById("targetOverlay");
const modeSelect = document.getElementById("modeSelect");
const shotsSelect = document.getElementById("shotsSelect");
const yardsSelect = document.getElementById("yardsSelect");
const btnStart = document.getElementById("btnStart");
const btnStop = document.getElementById("btnStop");
const btnReplayLast = document.getElementById("btnReplayLast");
const statusText = document.getElementById("statusText");
const statRoundState = document.getElementById("statRoundState");
const statShots = document.getElementById("statShots");
const statShotsGoal = document.getElementById("statShotsGoal");
const statMode = document.getElementById("statMode");
const statWinner = document.getElementById("statWinner");
const historyList = document.getElementById("historyList");
const replayModal = document.getElementById("replayModal");
const btnCloseReplay = document.getElementById("btnCloseReplay");
const replayCanvas = document.getElementById("replayCanvas");
const sndHit = document.getElementById("sndHit");
const sndBeep = document.getElementById("sndBeep");

const TARGET_IMAGES = {
  bullseye: "assets/bullseye.png",
  tic_tac_toe: "assets/tic_tac_toe.png",
  draw_dual: "assets/draw_dual.png",
  intruder: "assets/intruder.png",
};

// play button zones in normalized coords
const PLAY_ZONES = {
  bullseye: { x: 0.4, y: 0.85, w: 0.2, h: 0.1 },
  tic_tac_toe: { x: 0.4, y: 0.85, w: 0.2, h: 0.1 },
  draw_dual: { x: 0.4, y: 0.85, w: 0.2, h: 0.1 },
  intruder: { x: 0.4, y: 0.85, w: 0.2, h: 0.1 },
};

let currentRound = null;
let roundHistory = [];
let replayAnimation = null;

window.addEventListener("load", () => {
  setTimeout(() => {
    document.getElementById("splash").classList.add("hidden");
    document.getElementById("app").classList.remove("hidden");
    setModeImage(modeSelect.value);
    resizeOverlay();
    loadHistory();
    renderHistory();
    updateUI();
  }, 600);
});

window.addEventListener("resize", resizeOverlay);
function resizeOverlay() {
  const rect = targetImg.getBoundingClientRect();
  overlay.width = rect.width || 640;
  overlay.height = rect.height || 360;
}

function setModeImage(mode) {
  targetImg.src = TARGET_IMAGES[mode] || TARGET_IMAGES["bullseye"];
}

modeSelect.addEventListener("change", () => {
  const mode = modeSelect.value;
  setModeImage(mode);
  document.getElementById("shotsSection").style.display =
    mode === "bullseye" ? "block" : "none";
  statMode.textContent = mode;
  drawOverlay();
});

btnStart.addEventListener("click", () => {
  startRound();
});

btnStop.addEventListener("click", () => {
  if (!currentRound) return;
  currentRound.state = "finished";
  addEvent("finish", { manual: true });
  finalizeRound();
});

overlay.addEventListener("click", (e) => {
  const rect = overlay.getBoundingClientRect();
  const xNorm = (e.clientX - rect.left) / rect.width;
  const yNorm = (e.clientY - rect.top) / rect.height;

  if (!currentRound) return;

  const zone = PLAY_ZONES[currentRound.mode];
  if (currentRound.state === "armed" && zone) {
    if (
      xNorm >= zone.x &&
      xNorm <= zone.x + zone.w &&
      yNorm >= zone.y &&
      yNorm <= zone.y + zone.h
    ) {
      beginCountdown();
      return;
    }
  }

  if (currentRound.state !== "active") return;

  sndHit.play().catch(() => {});
  handleHit(xNorm, yNorm);
  drawOverlay();
});

function startRound() {
  const mode = modeSelect.value;
  const shotsGoal =
    mode === "bullseye" ? parseInt(shotsSelect.value, 10) : 1;
  const yards = parseInt(yardsSelect.value, 10);

  currentRound = {
    id: Date.now(),
    mode,
    yards,
    shotsGoal,
    state: "armed", // armed -> countdown -> active -> finished
    startTs: performance.now(),
    events: [],
    shots: 0,
    winner: null,
    board: [
      ["", "", ""],
      ["", "", ""],
      ["", "", ""],
    ],
    currentPlayer: "X",
    goTs: null,
  };
  addEvent("armed");
  updateUI();
  drawOverlay();
}

function addEvent(kind, extra = {}) {
  if (!currentRound) return;
  const t = (performance.now() - currentRound.startTs) / 1000;
  currentRound.events.push({ ts: t, kind, ...extra });
}

function beginCountdown() {
  if (!currentRound) return;
  currentRound.state = "countdown";
  addEvent("countdown_start");
  updateUI();
  sndBeep.play().catch(() => {});
  let count = 3;
  const interval = setInterval(() => {
    if (!currentRound || currentRound.state !== "countdown") {
      clearInterval(interval);
      return;
    }
    if (count <= 1) {
      clearInterval(interval);
      currentRound.state = "active";
      currentRound.goTs = performance.now();
      addEvent("go");
      updateUI();
      return;
    }
    count -= 1;
  }, 700);
}

function handleHit(xNorm, yNorm) {
  const mode = currentRound.mode;
  if (mode === "bullseye") {
    handleBullseyeHit(xNorm, yNorm);
  } else if (mode === "tic_tac_toe") {
    handleTicTacToeHit(xNorm, yNorm);
  } else if (mode === "draw_dual") {
    handleDrawDualHit(xNorm, yNorm);
  } else if (mode === "intruder") {
    handleIntruderHit(xNorm, yNorm);
  }
}

function handleBullseyeHit(x, y) {
  const dx = x - 0.5;
  const dy = y - 0.5;
  const r = Math.sqrt(dx * dx + dy * dy);
  let score = 0;
  if (r <= 0.08) score = 10;
  else if (r <= 0.16) score = 9;
  else if (r <= 0.24) score = 8;
  else if (r <= 0.32) score = 7;
  else if (r <= 0.4) score = 6;

  currentRound.shots += 1;
  addEvent("hit", { x, y, score, shot: currentRound.shots });
  statShots.textContent = currentRound.shots.toString();

  if (currentRound.shots >= currentRound.shotsGoal) {
    currentRound.state = "finished";
    addEvent("finish");
    finalizeRound();
  }
}

function handleTicTacToeHit(x, y) {
  const col = Math.min(2, Math.max(0, Math.floor(x * 3)));
  const row = Math.min(2, Math.max(0, Math.floor(y * 3)));
  if (currentRound.board[row][col] !== "") {
    addEvent("invalid_hit", { x, y, row, col });
    return;
  }
  const player = currentRound.currentPlayer;
  currentRound.board[row][col] = player;
  addEvent("hit", { x, y, row, col, player });

  const w = checkTTTWinner(currentRound.board);
  if (w) {
    currentRound.state = "finished";
    currentRound.winner = w;
    addEvent("finish", { winner: w });
    finalizeRound();
  } else if (boardFull(currentRound.board)) {
    currentRound.state = "finished";
    currentRound.winner = "draw";
    addEvent("finish", { winner: "draw" });
    finalizeRound();
  } else {
    currentRound.currentPlayer = player === "X" ? "O" : "X";
  }
}

function checkTTTWinner(b) {
  const lines = [];
  for (let i = 0; i < 3; i++) {
    lines.push([b[i][0], b[i][1], b[i][2]]);
    lines.push([b[0][i], b[1][i], b[2][i]]);
  }
  lines.push([b[0][0], b[1][1], b[2][2]]);
  lines.push([b[0][2], b[1][1], b[2][0]]);
  for (const line of lines) {
    if (line[0] && line[0] === line[1] && line[1] === line[2]) return line[0];
  }
  return null;
}

function boardFull(b) {
  return b.every((row) => row.every((c) => c !== ""));
}

function handleDrawDualHit(x, y) {
  if (currentRound.winner) {
    addEvent("hit_after_finish", { x, y });
    return;
  }
  const lane = x < 0.5 ? "A" : "B";
  const reaction =
    currentRound.goTs != null
      ? (performance.now() - currentRound.goTs) / 1000
      : null;
  currentRound.winner = lane;
  currentRound.state = "finished";
  addEvent("hit", { x, y, lane, reaction });
  addEvent("finish", { winner: lane, reaction });
  finalizeRound();
}

function handleIntruderHit(x, y) {
  if (currentRound.winner) {
    addEvent("hit_after_finish", { x, y });
    return;
  }
  const reaction =
    currentRound.goTs != null
      ? (performance.now() - currentRound.goTs) / 1000
      : null;
  currentRound.winner = "user";
  currentRound.state = "finished";
  addEvent("hit", { x, y, reaction });
  addEvent("finish", { winner: "user", reaction });
  finalizeRound();
}

function drawOverlay() {
  const ctx = overlay.getContext("2d");
  ctx.clearRect(0, 0, overlay.width, overlay.height);
  if (!currentRound) return;

  const w = overlay.width;
  const h = overlay.height;

  // play zone
  const zone = PLAY_ZONES[currentRound.mode];
  if (zone && currentRound.state === "armed") {
    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,0.7)";
    ctx.lineWidth = 2;
    const zx = zone.x * w;
    const zy = zone.y * h;
    const zw = zone.w * w;
    const zh = zone.h * h;
    ctx.strokeRect(zx, zy, zw, zh);
    ctx.font = "bold 14px system-ui";
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("PLAY", zx + zw / 2, zy + zh / 2);
    ctx.restore();
  }

  // tic-tac-toe grid & marks
  if (currentRound.mode === "tic_tac_toe") {
    const b = currentRound.board;
    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,0.3)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(w / 3, 0);
    ctx.lineTo(w / 3, h);
    ctx.moveTo((2 * w) / 3, 0);
    ctx.lineTo((2 * w) / 3, h);
    ctx.moveTo(0, h / 3);
    ctx.lineTo(w, h / 3);
    ctx.moveTo(0, (2 * h) / 3);
    ctx.lineTo(w, (2 * h) / 3);
    ctx.stroke();

    const cellW = w / 3;
    const cellH = h / 3;
    ctx.font = "bold 32px system-ui";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        const val = b[r][c];
        if (!val) continue;
        const cx = c * cellW + cellW / 2;
        const cy = r * cellH + cellH / 2;
        ctx.fillStyle = val === "X" ? "#00ff99" : "#ffd35c";
        ctx.fillText(val, cx, cy);
      }
    }
    ctx.restore();
  }

  // hits
  const events = currentRound.events || [];
  for (const ev of events) {
    if (ev.kind !== "hit") continue;
    const x = (ev.x || 0.5) * w;
    const y = (ev.y || 0.5) * h;
    ctx.beginPath();
    ctx.arc(x, y, 8, 0, Math.PI * 2);
    ctx.strokeStyle = "#00ff99";
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}

function finalizeRound() {
  if (!currentRound) return;
  roundHistory.push(structuredClone(currentRound));
  saveHistory();
  renderHistory();
  updateUI();
}

function updateUI() {
  if (!currentRound) {
    statRoundState.textContent = "idle";
    statusText.textContent = "Idle";
    statShots.textContent = "0";
    statShotsGoal.textContent = shotsSelect.value;
    statMode.textContent = modeSelect.value;
    statWinner.textContent = "-";
  } else {
    statRoundState.textContent = currentRound.state;
    statusText.textContent = currentRound.state;
    statShots.textContent = currentRound.shots.toString();
    statShotsGoal.textContent = currentRound.shotsGoal.toString();
    statMode.textContent = currentRound.mode;
    statWinner.textContent = currentRound.winner || "-";
  }
}

btnReplayLast.addEventListener("click", () => {
  if (!roundHistory.length) {
    alert("No rounds yet.");
    return;
  }
  openReplay(roundHistory[roundHistory.length - 1]);
});

btnCloseReplay.addEventListener("click", () => {
  replayModal.classList.add("hidden");
  if (replayAnimation) cancelAnimationFrame(replayAnimation);
});

function openReplay(round) {
  replayModal.classList.remove("hidden");
  playReplay(round);
}

function playReplay(round) {
  const canvas = replayCanvas;
  const ctx = canvas.getContext("2d");
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width || 640;
  canvas.height = rect.height || 360;
  const w = canvas.width;
  const h = canvas.height;

  const img = new Image();
  img.src = TARGET_IMAGES[round.mode] || TARGET_IMAGES["bullseye"];

  const hits = (round.events || []).filter((e) => e.kind === "hit");
  if (!hits.length) {
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "#fff";
    ctx.font = "16px system-ui";
    ctx.fillText("No hits in this round.", 16, 32);
    return;
  }

  img.onload = () => {
    const startTs = performance.now();
    const firstTs = hits[0].ts || 0;
    const lastTs = hits[hits.length - 1].ts || 0;

    function frame(now) {
      const elapsed = (now - startTs) / 1000;
      const currentTime = firstTs + elapsed;

      ctx.drawImage(img, 0, 0, w, h);

      for (const ev of hits) {
        if ((ev.ts || 0) > currentTime) continue;
        const x = (ev.x || 0.5) * w;
        const y = (ev.y || 0.5) * h;
        ctx.beginPath();
        ctx.arc(x, y, 8, 0, Math.PI * 2);
        ctx.strokeStyle = "#00ff99";
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      if (currentTime < lastTs + 0.7) {
        replayAnimation = requestAnimationFrame(frame);
      }
    }

    replayAnimation = requestAnimationFrame(frame);
  };
}

function saveHistory() {
  try {
    localStorage.setItem("defenderProRoundsFull", JSON.stringify(roundHistory));
  } catch (e) {
    console.warn("Could not save history", e);
  }
}

function loadHistory() {
  try {
    const raw = localStorage.getItem("defenderProRoundsFull");
    roundHistory = raw ? JSON.parse(raw) : [];
  } catch (e) {
    roundHistory = [];
  }
}

function renderHistory() {
  historyList.innerHTML = "";
  for (const round of [...roundHistory].reverse()) {
    const div = document.createElement("div");
    div.className = "history-item";
    const ts = new Date(round.id).toLocaleTimeString();
    div.textContent =
      "[" +
      ts +
      "] " +
      round.mode +
      " | yards " +
      round.yards +
      " | shots " +
      round.shots;
    div.addEventListener("click", () => openReplay(round));
    historyList.appendChild(div);
  }
}

// service worker
if ("serviceWorker" in navigator) {
  navigator.serviceWorker
    .register("service-worker.js")
    .catch((err) => console.warn("SW registration failed", err));
}
