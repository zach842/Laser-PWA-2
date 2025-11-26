// Defender Pro – camera-based PWA red-laser detection

const videoEl = document.getElementById("cam");
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

// PLAY zones (normalized)
const PLAY_ZONES = {
  bullseye: { x: 0.4, y: 0.85, w: 0.2, h: 0.1 },
  tic_tac_toe: { x: 0.4, y: 0.85, w: 0.2, h: 0.1 },
  draw_dual: { x: 0.4, y: 0.85, w: 0.2, h: 0.1 },
  intruder: { x: 0.4, y: 0.85, w: 0.2, h: 0.1 },
};

let currentRound = null;
let roundHistory = [];
let replayAnimation = null;

let hiddenCanvas = document.createElement("canvas");
let hiddenCtx = hiddenCanvas.getContext("2d");

// detection thresholds – tweak these for your laser
const RED_MIN = 180;
const RED_GREEN_DIFF = 80;
const RED_BLUE_DIFF = 80;
const MIN_BLOB_AREA = 40; // px^2
const HIT_COOLDOWN_MS = 120;

let lastHitTime = 0;

window.addEventListener("load", () => {
  setTimeout(() => {
    document.getElementById("splash").classList.add("hidden");
    document.getElementById("app").classList.remove("hidden");
    initCamera();
    resizeOverlay();
    loadHistory();
    renderHistory();
    updateUI();
  }, 600);
});

window.addEventListener("resize", resizeOverlay);
function resizeOverlay() {
  const rect = videoEl.getBoundingClientRect();
  overlay.width = rect.width || 640;
  overlay.height = rect.height || 360;
}

async function initCamera() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment" },
      audio: false,
    });
    videoEl.srcObject = stream;
    videoEl.onloadedmetadata = () => {
      videoEl.play();
      statusText.textContent = "Camera ready";
      startDetectionLoop();
    };
  } catch (e) {
    console.error(e);
    statusText.textContent = "Camera blocked (allow access)";
  }
}

function startDetectionLoop() {
  function loop() {
    if (videoEl.readyState >= 2) {
      const vw = videoEl.videoWidth;
      const vh = videoEl.videoHeight;
      if (vw && vh) {
        hiddenCanvas.width = vw;
        hiddenCanvas.height = vh;
        hiddenCtx.drawImage(videoEl, 0, 0, vw, vh);
        runDetectionOnFrame(vw, vh);
      }
    }
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
}

function runDetectionOnFrame(vw, vh) {
  if (!currentRound) return;
  const now = performance.now();
  if (now - lastHitTime < HIT_COOLDOWN_MS) return;

  const frame = hiddenCtx.getImageData(0, 0, vw, vh);
  const data = frame.data;
  let minX = vw,
    minY = vh,
    maxX = -1,
    maxY = -1,
    count = 0;

  const stepX = 4 * 4; // sample every 4 pixels horizontally
  for (let y = 0; y < vh; y += 2) {
    let idx = y * vw * 4;
    for (let x = 0; x < vw; x += 4) {
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      if (
        r > RED_MIN &&
        r - g > RED_GREEN_DIFF &&
        r - b > RED_BLUE_DIFF
      ) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
        count++;
      }
      idx += stepX;
    }
  }

  const blobW = maxX - minX;
  const blobH = maxY - minY;
  const area = blobW * blobH;
  if (area < MIN_BLOB_AREA || count === 0) return;

  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const xNorm = cx / vw;
  const yNorm = cy / vh;

  const zone = PLAY_ZONES[currentRound.mode];

  if (currentRound.state === "armed" && zone) {
    if (
      xNorm >= zone.x &&
      xNorm <= zone.x + zone.w &&
      yNorm >= zone.y &&
      yNorm <= zone.y + zone.h
    ) {
      lastHitTime = now;
      sndBeep.play().catch(() => {});
      beginCountdown();
      return;
    }
  } else if (currentRound.state === "active") {
    lastHitTime = now;
    sndHit.play().catch(() => {});
    handleHit(xNorm, yNorm);
    drawOverlay();
  }
}

// Round lifecycle

btnStart.addEventListener("click", () => {
  startRound();
});
btnStop.addEventListener("click", () => {
  if (!currentRound) return;
  currentRound.state = "finished";
  addEvent("finish", { manual: true });
  finalizeRound();
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
    state: "armed",
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
  lastHitTime = 0;
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
  if (currentRound.state !== "armed") return;
  currentRound.state = "countdown";
  addEvent("countdown_start");
  updateUI();
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
  }, 600);
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

// History + replay

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
    localStorage.setItem(
      "defenderProCameraRounds",
      JSON.stringify(roundHistory)
    );
  } catch (e) {
    console.warn("Could not save history", e);
  }
}

function loadHistory() {
  try {
    const raw = localStorage.getItem("defenderProCameraRounds");
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

// Service worker registration
if ("serviceWorker" in navigator) {
  navigator.serviceWorker
    .register("service-worker.js")
    .catch((err) => console.warn("SW registration failed", err));
}
