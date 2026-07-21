import "./styles.css";
// skijump3d main.js —— UI 接線+跳次/距離/風向+播報(字幕+mp3 人聲)
// 玩法:按「出發」助滑;台端「綠燈」亮起按「起跳」;空中 W/S(或按鈕)調前傾吃浮力。
import { SkiJumpGame, DIFFICULTY_PRESETS } from "./game.js";
import { AudioManager } from "./audio.js";
import { loadSettings, saveSettings } from "./storage.js";
import { speakLine, setVoiceEnabled } from "./voice.js";

const $ = (id) => document.getElementById(id);
const ui = {
  canvas: $("gameCanvas"),
  scoreSheet: $("scoreSheet"),
  powerPanel: $("powerPanel"), powerFill: $("powerFill"), powerLabel: $("powerLabel"),
  statusMessage: $("statusMessage"), commentaryBar: $("commentaryBar"), strikeFlash: $("strikeFlash"),
  touchRoll: $("touchRoll"), touchLeft: $("touchLeft"), touchRight: $("touchRight"),
  menuButton: $("menuButton"), audioButton: $("audioButton"), cameraButton: $("cameraButton"),
  matchOverlay: $("matchOverlay"), overlayTitle: $("overlayTitle"), overlayText: $("overlayText"),
  overlayMenuButton: $("overlayMenuButton"), overlayReplayButton: $("overlayReplayButton"),
  homeScreen: $("homeScreen"),
  framesSelect: $("framesSelect"), difficultySelect: $("difficultySelect"), audioSelect: $("audioSelect"),
  startMatchButton: $("startMatchButton"),
};

const settings = loadSettings();
let selectedDifficulty = DIFFICULTY_PRESETS[settings.difficulty] ? settings.difficulty : "easy";
let selectedJumps = [1, 2, 3].includes(settings.frames) ? settings.frames : 2;
let audioEnabled = settings.audioEnabled !== false;

const audio = new AudioManager();
audio.setEnabled(audioEnabled);
setVoiceEnabled(audioEnabled);

const game = new SkiJumpGame({ canvas: ui.canvas });
window.__skijump3d = game; // dev hook

function pushCommentary(sub, tone = "info", say = "") {
  const bar = ui.commentaryBar;
  if (!bar || !sub) return;
  bar.hidden = false;
  bar.dataset.tone = tone;
  bar.textContent = sub;
  bar.style.animation = "none";
  void bar.offsetWidth;
  bar.style.animation = "";
  if (say) speakLine(say);
}
function flash(text, ms = 1200) {
  ui.strikeFlash.hidden = false;
  ui.strikeFlash.textContent = text;
  ui.strikeFlash.style.animation = "none";
  void ui.strikeFlash.offsetWidth;
  ui.strikeFlash.style.animation = "";
  setTimeout(() => { ui.strikeFlash.hidden = true; }, ms);
}

game.onEvent = (event) => {
  switch (event.type) {
    case "match-start":
      audio.startCrowd();
      pushCommentary("大跳台之巔——K 點 90 公尺,飛得越遠越好!", "info", "歡迎來到大跳台,滑雪跳台開始!");
      break;
    case "gate": {
      const windTxt = event.wind >= 0 ? `逆風 ${event.wind.toFixed(1)}(有利浮力)` : `順風 ${(-event.wind).toFixed(1)}(小心下沉)`;
      const isLast = event.n === game.totalJumps && game.totalJumps > 1;
      pushCommentary(`第 ${event.n}/${game.totalJumps} 跳・${windTxt}`, "info", isLast ? "最後一跳,全力以赴!" : (event.wind > 0.8 ? "逆風正好,抓住浮力!" : (event.wind < -0.8 ? "順風要小心,壓低一點!" : "")));
      break;
    }
    case "inrun":
      audio.uiTap();
      speakLine("出發!");
      break;
    case "takeoff":
      audio.kick(0.7);
      if (event.quality > 0.75) { flash("完美起跳!", 900); pushCommentary("完美起跳!壓低吃浮力!", "hot", "完美起跳!"); }
      else if (event.quality > 0.4) { flash("起跳!", 700); speakLine("起跳!"); }
      else pushCommentary("按太早了……盡量壓低穩住!", "cool", "太早了,浮不起來!");
      break;
    case "land": {
      audio.bounce();
      audio.crowdCheer(event.beyondK ? 1 : 0.7);
      flash(`${event.dist.toFixed(1)} m${event.beyondK ? " 🥇" : ""}`, 1500);
      if (event.beyondK) pushCommentary(`飛越 K 點!${event.dist.toFixed(1)} 公尺!`, "hot", "飛越K點!不可思議!");
      else pushCommentary(`落地 ${event.dist.toFixed(1)} 公尺!`, "hot", "漂亮的落地!");
      if (event.newPb) setTimeout(() => speakLine("新的個人最佳!"), 1400);
      break;
    }
    case "status":
      pushCommentary(event.text, "info", "");
      break;
    case "match-end":
      audio.horn(); audio.cheer(); audio.crowdCheer(1);
      setTimeout(() => audio.stopCrowd(), 3200);
      ui.matchOverlay.classList.add("visible");
      ui.overlayTitle.textContent = event.title;
      ui.overlayText.textContent = event.text;
      speakLine("比賽結束,精彩的表現!");
      try { if (!['localhost','127.0.0.1'].includes(location.hostname)) {   // -done:玩完一局(t=本局秒數,/stats 使用次數與平均停留吃這個)
        var __dt = Math.round((Date.now() - (window.__matchT0 || Date.now())) / 1000);
        navigator.sendBeacon?.('https://hfpc-play-stats.summer09201017.workers.dev/api/ping?g=skijump3d-done&t=' + __dt);
      } } catch (_) {}
      break;
    default:
      break;
  }
};

// 記分板+起跳綠燈(力道大條通則:中下方大條=時機燈)
game.onHud = (s) => {
  ui.statusMessage.textContent = s.message;
  // 大條:助滑時=速度條+進綠區整條亮綠;飛行時=前傾度
  if (s.phase === "inrun") {
    ui.powerPanel.hidden = false;
    ui.powerLabel.textContent = s.inWindow ? "起跳!" : `${s.speedKmh} km/h`;
    ui.powerFill.style.transform = `scaleX(${Math.min(1, s.speedKmh / 95)})`;
    ui.powerFill.classList.toggle("full", s.inWindow);
  } else if (s.phase === "flying") {
    ui.powerPanel.hidden = false;
    ui.powerLabel.textContent = `前傾 ${Math.round(s.lean * 100)}%・${s.dist.toFixed(0)}m`;
    ui.powerFill.style.transform = `scaleX(${s.lean})`;
    ui.powerFill.classList.remove("full");
  } else {
    ui.powerPanel.hidden = true;
  }
  // 出發/起跳鈕文案
  if (ui.touchRoll) {
    ui.touchRoll.hidden = false;
    ui.touchRoll.disabled = !["gate", "inrun"].includes(s.phase);
    ui.touchRoll.textContent = s.phase === "gate" ? "🚦 出發 (空白鍵)" : (s.phase === "inrun" ? (s.inWindow ? "✅ 起跳!(空白鍵)" : "⏳ 等台端…(空白鍵)") : "—");
  }
  if (ui.touchLeft) { ui.touchLeft.hidden = s.phase !== "flying"; }
  if (ui.touchRight) { ui.touchRight.hidden = s.phase !== "flying"; }
  if (s.phase === "menu") { ui.scoreSheet.hidden = true; return; }
  ui.scoreSheet.hidden = false;
  const rows = (s.results || []).map((r, i) => `<tr><td class="pname">第 ${i + 1} 跳</td><td class="total">${r.toFixed(1)}m</td></tr>`).join("");
  const windArrow = s.wind >= 0 ? "⬆逆" : "⬇順";
  ui.scoreSheet.innerHTML = `<table>${rows}</table><div class="stones-left">第 ${s.jumpIdx}/${s.total} 跳・風 ${windArrow}${Math.abs(s.wind).toFixed(1)}・PB ${s.pb.toFixed(1)}m</div>`;
};

// ── 鍵盤:空白=出發/起跳;W/S=前傾 ──
window.addEventListener("keydown", (e) => {
  if (e.target && ["INPUT", "SELECT", "TEXTAREA"].includes(e.target.tagName)) return;
  if (["Space", "ArrowUp", "ArrowDown", "KeyW", "KeyS"].includes(e.code)) e.preventDefault();
  if (game.phase === "menu" || game.phase === "done") return;
  audio.unlock();
  if (e.code === "Space" && !e.repeat) game.action();
  if (e.code === "KeyW" || e.code === "ArrowUp") game.nudgeLean(0.06);
  if (e.code === "KeyS" || e.code === "ArrowDown") game.nudgeLean(-0.06);
  if (e.code === "KeyV" && !e.repeat) game.cycleCamView();
});
// 點畫面=出發/起跳(手機單指流)
ui.canvas.addEventListener("pointerdown", (e) => {
  if (game.phase === "menu" || game.phase === "done") return;
  e.preventDefault();
  audio.unlock();
  game.action();
});
window.addEventListener("contextmenu", (e) => { if (e.target.closest(".touch-action") || e.target.id === "gameCanvas") e.preventDefault(); });

// 觸控鈕:出發/起跳+前傾兩鈕(按住連續調)
ui.touchRoll.addEventListener("pointerdown", (e) => { e.preventDefault(); audio.unlock(); game.action(); });
let holdL = null, holdR = null;
ui.touchLeft.addEventListener("pointerdown", (e) => { e.preventDefault(); audio.unlock(); holdL = setInterval(() => game.nudgeLean(0.05), 60); });
ui.touchRight.addEventListener("pointerdown", (e) => { e.preventDefault(); audio.unlock(); holdR = setInterval(() => game.nudgeLean(-0.05), 60); });
for (const ev of ["pointerup", "pointerleave", "pointercancel"]) {
  ui.touchLeft.addEventListener(ev, () => clearInterval(holdL));
  ui.touchRight.addEventListener(ev, () => clearInterval(holdR));
}

// HUD 鈕
ui.cameraButton.addEventListener("click", () => { audio.uiTap(); game.cycleCamView(); });
ui.menuButton.addEventListener("click", () => {
  audio.uiTap();
  audio.stopCrowd();
  game.phase = "menu";
  ui.homeScreen.classList.add("visible");
  ui.matchOverlay.classList.remove("visible");
  ui.scoreSheet.hidden = true;
  ui.powerPanel.hidden = true;
});
const setAudio = (on) => {
  audioEnabled = on;
  audio.setEnabled(on);
  setVoiceEnabled(on);
  ui.audioButton.textContent = on ? "音效開啟" : "音效靜音";
  persist();
};
ui.audioButton.addEventListener("click", () => setAudio(!audioEnabled));
ui.audioSelect.addEventListener("change", (e) => setAudio(e.target.value === "on"));

function persist() {
  saveSettings({ modeId: "solo", difficulty: selectedDifficulty, frames: selectedJumps, audioEnabled });
}
function syncMenu() {
  ui.difficultySelect.value = selectedDifficulty;
  ui.framesSelect.value = String(selectedJumps);
  ui.audioSelect.value = audioEnabled ? "on" : "off";
}
ui.difficultySelect.addEventListener("change", (e) => { selectedDifficulty = e.target.value; persist(); });
ui.framesSelect.addEventListener("change", (e) => { selectedJumps = Number(e.target.value); persist(); });

ui.startMatchButton.addEventListener("click", () => {
  window.__matchT0 = Date.now();   // -done beacon 用:本局開始時間
  audio.unlock(); audio.uiTap();
  persist();
  game.applyPresentation({ difficulty: selectedDifficulty, frames: selectedJumps });
  ui.homeScreen.classList.remove("visible");
  ui.matchOverlay.classList.remove("visible");
  game.startMatch();
});
ui.overlayReplayButton.addEventListener("click", () => {
  audio.uiTap();
  ui.matchOverlay.classList.remove("visible");
  game.startMatch();
});
ui.overlayMenuButton.addEventListener("click", () => {
  audio.uiTap();
  ui.matchOverlay.classList.remove("visible");
  game.phase = "menu";
  ui.homeScreen.classList.add("visible");
  ui.scoreSheet.hidden = true;
});

const doResize = () => game.resize();
window.addEventListener("resize", doResize);
syncMenu();
doResize();
game.startLoop();
