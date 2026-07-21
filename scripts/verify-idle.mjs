// verify-idle.mjs —— skijump3d「idle 生動」獨立 Playwright 驗證
// 自起 vite preview（專屬 port=5416，strictPort），驗完 kill。絕不用共用 MCP 瀏覽器。
// 驗:0 pageerror / 0 console error、主角待機轉頭會動、觀眾舉手人浪會動。
// 截圖:①臉部特寫 ②舉手人浪 ③全景 → scripts/shots/
import { createRequire } from "module";
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";

const require = createRequire(import.meta.url);
const { chromium } = require("C:/Users/HFP/node_modules/playwright");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(__dirname, "..");
const shotsDir = path.join(__dirname, "shots");
fs.mkdirSync(shotsDir, { recursive: true });
const PORT = 5416;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitPort(url, tries = 60) {
  for (let i = 0; i < tries; i += 1) {
    try { const r = await fetch(url); if (r.ok) return true; } catch { /* not up yet */ }
    await sleep(500);
  }
  throw new Error("preview 未起來:" + url);
}

let preview, browser;
const fail = (m) => { console.error("❌ " + m); process.exitCode = 1; };

try {
  preview = spawn("npx", ["vite", "preview", "--port", String(PORT), "--strictPort"], { cwd: repo, shell: true });
  preview.stdout.on("data", () => {});
  preview.stderr.on("data", () => {});
  const url = `http://localhost:${PORT}/`;
  await waitPort(url);

  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const consoleErrors = [];
  const pageErrors = [];
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
  page.on("pageerror", (e) => pageErrors.push(String(e)));

  await page.goto(url, { waitUntil: "load" });
  await page.bringToFront(); // 分頁背景化 → RAF 1fps 像凍結,先拉到前景
  await page.waitForFunction(() => !!window.__skijump3d, null, { timeout: 10000 });

  // 進入比賽 → gate 待機(主角此時 idle 轉頭)
  await page.click("#startMatchButton");
  await sleep(400);
  const phase = await page.evaluate(() => window.__skijump3d.phase);
  console.log("phase after start =", phase);
  if (phase !== "gate") fail("開賽後未進 gate 待機,得到:" + phase);

  // ── 動態採樣:主角待機頭轉(gate,~7s)+ 觀眾手臂(~3s)──
  const samples = await page.evaluate(async () => {
    const g = window.__skijump3d;
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const head = [], arm = [];
    for (let i = 0; i < 70; i += 1) {
      head.push(g.skier.userData.headGroup.rotation.y);
      const c = g.crowdFigures && g.crowdFigures[0];
      arm.push(c ? c.fig.leftArm.pivot.rotation.x : 0);
      await wait(100);
    }
    return {
      head, arm,
      nCrowd: g.crowdFigures ? g.crowdFigures.length : 0,
      hasHeadGroup: !!g.skier.userData.headGroup,
      hasSmile: !!g.skier.userData.smile,
    };
  });
  const range = (a) => Math.max(...a) - Math.min(...a);
  const headRange = range(samples.head);
  const armRange = range(samples.arm);
  console.log("crowd figures =", samples.nCrowd, "| headGroup?", samples.hasHeadGroup, "| smile?", samples.hasSmile);
  console.log("主角待機轉頭 rotation.y 幅度 =", headRange.toFixed(3), "rad");
  console.log("觀眾手臂 pivot.rotation.x 幅度 =", armRange.toFixed(3), "rad");
  if (samples.nCrowd === 0) fail("crowdFigures 為 0（應有前排個別觀眾）");
  if (headRange < 0.05) fail("主角待機頭幾乎不動（idle 未生效）");
  if (armRange < 0.3) fail("觀眾手臂幾乎不動（人浪未生效）");

  // ── 截圖:凍結 render(改成 no-op)避免 RAF 覆蓋,手動擺鏡頭渲染一幀 ──
  async function shot(name, camFn) {
    await page.evaluate((info) => {
      const g = window.__skijump3d;
      if (!g.__origRender) { g.__origRender = g.render.bind(g); g.render = () => {}; }
      const cam = g.camera;
      cam.aspect = 1280 / 720; cam.updateProjectionMatrix();
      // 用 Function 還原傳入的鏡頭設定
      const f = new Function("g", "cam", "THREE", info.body);
      f(g, cam, window.THREE);
      g.renderer.render(g.scene, g.camera);
    }, { body: camFn });
    await sleep(120);
    await page.screenshot({ path: path.join(shotsDir, name) });
  }

  // ①臉部特寫:選手在閘門(0,~26.6,44)面朝 -z,鏡頭擺在 -z 前方回望
  await shot("01-face-closeup.png", `
    const p = g.skier.position;
    cam.position.set(0.5, p.y + 1.9, p.z - 3.4);
    cam.lookAt(0, p.y + 1.8, p.z + 0.5);
  `);
  // ②舉手人浪:對準左看台前排個別人偶群(取其世界座標平均);鏡頭在內側偏高、俯角夠陡以越過落地坡
  await shot("02-crowd-wave.png", `
    const left = g.crowdFigures.filter(c => c.fig.rig.position.x < 0).map(c => c.fig.rig.position);
    let cx=0,cy=0,cz=0; for (const v of left){cx+=v.x;cy+=v.y;cz+=v.z;}
    const n=left.length; cx/=n; cy/=n; cz/=n;
    cam.position.set(cx + 2.5, cy + 9, cz + 6);
    cam.lookAt(cx, cy + 0.8, cz);
  `);
  // ③全景:高處後方俯瞰全跳台
  await shot("03-overview.png", `
    cam.position.set(28, 30, 58);
    cam.lookAt(0, 2, -35);
  `);

  if (consoleErrors.length) fail("console error x" + consoleErrors.length + ": " + consoleErrors.join(" | "));
  if (pageErrors.length) fail("pageerror x" + pageErrors.length + ": " + pageErrors.join(" | "));

  console.log(pageErrors.length + consoleErrors.length === 0 ? "✅ 0 pageerror / 0 console error" : "有錯誤(見上)");
  console.log("截圖 →", shotsDir);
} catch (e) {
  fail("驗證腳本例外:" + (e && e.stack ? e.stack : e));
} finally {
  if (browser) await browser.close();
  if (preview) { try { preview.kill(); } catch { /* ignore */ } }
  // Windows:vite preview 由 npx 起,killtree 保險
  try { spawn("taskkill", ["/F", "/T", "/PID", String(preview.pid)], { shell: true }); } catch { /* ignore */ }
  setTimeout(() => process.exit(process.exitCode || 0), 1500); // 強制收尾,別讓 preview 管道吊住事件迴圈
}
