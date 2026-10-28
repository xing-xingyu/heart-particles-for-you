const $ = (selector) => document.querySelector(selector);
const canvas = $("#particleCanvas");
const ctx = canvas.getContext("2d", { alpha: true });
const video = $("#webcam");

const els = {
  experience: $(".experience"), ambientStars: $("#ambientStars"), petalField: $("#petalField"),
  meteorField: $("#meteorField"), loveWhisper: $("#loveWhisper"), music: $("#musicButton"),
  intro: $("#intro"), dedication: $("#dedication"), status: $("#status"),
  statusText: $("#status b"), start: $("#startButton"), camera: $("#cameraButton"),
  preview: $("#cameraPreview"), gesture: $("#gestureCard"), picker: $("#shapePicker"),
  gestureTitle: $("#gestureTitle"), gestureHint: $("#gestureHint"),
  to: $("#toName"), from: $("#fromName"), message: $("#message"),
  editor: $("#editor"), edit: $("#editButton"), form: $("#editorForm"),
  toInput: $("#toInput"), fromInput: $("#fromInput"), messageInput: $("#messageInput"),
  share: $("#shareButton"), feedback: $("#copyFeedback"), fullscreen: $("#fullscreenButton"),
  cameraHelp: $("#cameraHelp"), cameraHelpTitle: $("#cameraHelpTitle"),
  cameraHelpText: $("#cameraHelpText"), retryCamera: $("#retryCamera"),
  openExternal: $("#openExternal"), helpClose: $("#helpClose")
};

const DEFAULTS = {
  to: "特别的你",
  message: "见到你的那一刻，\n星星都落进了心里。",
  from: "一个想把浪漫送给你的人"
};
const safeText = (value, fallback, limit) => (value || fallback).trim().slice(0, limit);
const params = new URLSearchParams(location.search);
const saved = JSON.parse(localStorage.getItem("heart-particle-dedication") || "{}");
let copy = {
  to: safeText(params.get("to") || saved.to, DEFAULTS.to, 16),
  message: safeText(params.get("msg") || saved.message, DEFAULTS.message, 60),
  from: safeText(params.get("from") || saved.from, DEFAULTS.from, 20)
};

let width = 0, height = 0, dpr = 1;
let particles = [], shapeTargets = {}, rings = [], trails = [];
let running = false, tracking = false, cameraStream = null, handLandmarker = null;
let handLoadPromise = null, cameraStarting = false, lastVideoTime = -1, lastDetectAt = 0, lostFrames = 0;
let mode = "form", previousMode = "form", interactionStarted = false;
let energy = { x: innerWidth * .5, y: innerHeight * .56, tx: innerWidth * .5, ty: innerHeight * .56 };
let formAmount = .94, targetFormAmount = .94, burstCooldown = 0, lastTrailAt = 0;
let fistStartedAt = 0, fistLatched = false, shapeCooldown = 0;
let activeShape = "heart";
let audioContext = null, musicMaster = null, musicDelay = null, musicTimer = null, musicPlaying = false;
let nextMusicAt = 0, musicStep = 0, quoteIndex = 0;
const shapeOrder = ["heart", "rose", "galaxy", "name"];
const prefersReducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

const palettes = {
  heart: [[255,236,211],[255,197,170],[255,111,145],[250,161,126],[255,247,235],[218,86,126]],
  rose: [[255,79,120],[185,29,72],[255,176,176],[255,224,197],[116,19,54],[255,248,238]],
  galaxy: [[174,210,255],[213,180,255],[255,231,176],[255,255,255],[104,130,255],[255,146,202]],
  name: [[255,243,219],[255,213,157],[255,255,255],[255,139,166],[236,179,115],[255,226,232]]
};

const loveQuotes = [
  "喜欢，是藏不住的星光。",
  "所有浪漫的想象，都开始与你有关。",
  "人海很大，而我恰好看见了你。",
  "想把每一次心动，都认真收藏。",
  "宇宙漫长，你是我偏爱的那颗星。"
];

function buildAmbient() {
  for (let i = 0; i < 88; i++) {
    const star = document.createElement("i");
    star.style.cssText = `--x:${Math.random()*100}%;--y:${Math.random()*100}%;--s:${.5+Math.random()*2.1}px;--a:${.2+Math.random()*.65};--d:${2+Math.random()*5}s;--delay:${-Math.random()*7}s`;
    els.ambientStars.append(star);
  }
  for (let i = 0; i < 16; i++) {
    const petal = document.createElement("i");
    const drift = -18 + Math.random()*36;
    petal.style.cssText = `--x:${Math.random()*100}%;--w:${5+Math.random()*7}px;--drift:${drift}vw;--drift2:${-drift*.65}vw;--d:${11+Math.random()*13}s;--delay:${-Math.random()*22}s`;
    els.petalField.append(petal);
  }
  for (let i = 0; i < 6; i++) {
    const meteor = document.createElement("i");
    meteor.style.cssText = `--x:${-10+Math.random()*64}%;--y:${Math.random()*48}%;--len:${100+Math.random()*130}px;--d:${7+Math.random()*9}s;--delay:${-Math.random()*14}s`;
    els.meteorField.append(meteor);
  }
}

function updateLoveQuote() {
  quoteIndex = (quoteIndex + 1) % loveQuotes.length;
  els.loveWhisper.classList.add("is-changing");
  setTimeout(() => {
    els.loveWhisper.querySelector("p").textContent = loveQuotes[quoteIndex];
    els.loveWhisper.classList.remove("is-changing");
  }, 420);
}

const midiFrequency = (note) => 440 * Math.pow(2, (note - 69) / 12);
function playTone(note, when, duration, volume, type = "sine") {
  if (!audioContext || !musicMaster) return;
  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();
  oscillator.type = type; oscillator.frequency.setValueAtTime(midiFrequency(note), when);
  gain.gain.setValueAtTime(.0001, when);
  gain.gain.exponentialRampToValueAtTime(Math.max(.0002, volume), when + .035);
  gain.gain.exponentialRampToValueAtTime(.0001, when + duration);
  oscillator.connect(gain); gain.connect(musicMaster);
  oscillator.start(when); oscillator.stop(when + duration + .08);
}

function scheduleMusicStep(when, step) {
  const chords = [[48,55,59,64],[45,52,55,60],[41,48,52,57],[43,50,55,59]];
  const melody = [76,null,79,81,79,76,74,null,72,null,76,79,76,72,69,null,69,null,72,76,74,72,69,null,71,null,74,79,76,74,71,null];
  const local = step % 32;
  if (local % 8 === 0) {
    const chord = chords[Math.floor(local / 8)];
    chord.forEach((note, index) => playTone(note, when + index*.045, 3.1, .018, "sine"));
  }
  const note = melody[local];
  if (note) {
    playTone(note, when, .56, .05, "triangle");
    if (local % 4 === 0) playTone(note + 12, when + .08, .34, .018, "sine");
  }
  if (local % 8 === 6) playTone(84 + (local % 3), when + .12, .75, .012, "sine");
}

function musicScheduler() {
  if (!musicPlaying || !audioContext) return;
  while (nextMusicAt < audioContext.currentTime + .65) {
    scheduleMusicStep(nextMusicAt, musicStep++);
    nextMusicAt += .42;
  }
}

async function startMusic() {
  if (!audioContext) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    musicMaster = audioContext.createGain();
    musicDelay = audioContext.createDelay(1.2);
    const feedback = audioContext.createGain();
    const wet = audioContext.createGain();
    musicMaster.gain.value = .0001; musicDelay.delayTime.value = .29; feedback.gain.value = .21; wet.gain.value = .3;
    musicMaster.connect(audioContext.destination);
    musicMaster.connect(musicDelay); musicDelay.connect(wet); wet.connect(audioContext.destination);
    musicDelay.connect(feedback); feedback.connect(musicDelay);
  }
  await audioContext.resume();
  musicPlaying = true; musicStep = 0; nextMusicAt = audioContext.currentTime + .08;
  musicMaster.gain.cancelScheduledValues(audioContext.currentTime);
  musicMaster.gain.setTargetAtTime(.26, audioContext.currentTime, .7);
  clearInterval(musicTimer); musicScheduler(); musicTimer = setInterval(musicScheduler, 120);
  els.music.classList.add("is-playing"); els.music.setAttribute("aria-label", "暂停背景音乐");
}

function stopMusic() {
  musicPlaying = false; clearInterval(musicTimer); musicTimer = null;
  if (musicMaster && audioContext) musicMaster.gain.setTargetAtTime(.0001, audioContext.currentTime, .35);
  els.music.classList.remove("is-playing"); els.music.setAttribute("aria-label", "播放背景音乐");
}

function toggleMusic() { return musicPlaying ? stopMusic() : startMusic(); }

function applyCopy() {
  els.to.textContent = copy.to;
  els.from.textContent = copy.from;
  els.message.innerHTML = "";
  copy.message.split(/\n|，(?=.{3,})/).slice(0, 2).forEach((line, index) => {
    if (index) els.message.append(document.createElement("br"));
    els.message.append(document.createTextNode(line));
  });
  document.title = `给${copy.to} · 心动粒子`;
  if (particles.length) {
    shapeTargets.name = makeTextTargets(particles.length, copy.to);
    if (activeShape === "name") selectShape("name", false);
  }
}

function heartPoint(index) {
  const t = Math.random() * Math.PI * 2;
  const fill = index % 5 === 0 ? .94 + Math.random() * .08 : Math.sqrt(Math.random());
  const x = 16 * Math.pow(Math.sin(t), 3);
  const y = 13 * Math.cos(t) - 5 * Math.cos(2*t) - 2 * Math.cos(3*t) - Math.cos(4*t);
  return { x: x / 18 * fill, y: -y / 18 * fill };
}

function rosePoint(index) {
  const t = Math.random() * Math.PI * 2;
  const petal = .28 + .7 * Math.abs(Math.sin(5 * t));
  const fill = index % 4 === 0 ? .98 : Math.sqrt(Math.random());
  const curl = index % 9 === 0 ? .35 + t / (Math.PI * 2) * .35 : 1;
  return { x: Math.cos(t) * petal * fill * curl, y: Math.sin(t) * petal * fill * curl };
}

function galaxyPoint(index) {
  const arm = index % 3;
  const progress = Math.sqrt(Math.random());
  const angle = progress * Math.PI * 4.6 + arm * Math.PI * 2 / 3;
  const fuzz = (Math.random() - .5) * (.16 + progress * .28);
  return {
    x: Math.cos(angle) * progress + Math.cos(angle + Math.PI/2) * fuzz,
    y: Math.sin(angle) * progress * .66 + Math.sin(angle + Math.PI/2) * fuzz
  };
}

function makeTextTargets(count, text) {
  const board = document.createElement("canvas");
  board.width = 900; board.height = 360;
  const bctx = board.getContext("2d", { willReadFrequently: true });
  const clean = safeText(text, "你", 8);
  let size = clean.length <= 2 ? 230 : clean.length <= 4 ? 185 : 135;
  bctx.font = `700 ${size}px Georgia, \"Songti SC\", \"Microsoft YaHei\", serif`;
  const measured = bctx.measureText(clean).width;
  if (measured > 780) size *= 780 / measured;
  bctx.font = `700 ${size}px Georgia, \"Songti SC\", \"Microsoft YaHei\", serif`;
  bctx.textAlign = "center"; bctx.textBaseline = "middle"; bctx.fillStyle = "white";
  bctx.fillText(clean, board.width / 2, board.height / 2);
  const pixels = bctx.getImageData(0, 0, board.width, board.height).data;
  const candidates = [];
  for (let y = 20; y < board.height - 20; y += 6) {
    for (let x = 25; x < board.width - 25; x += 6) {
      if (pixels[(y * board.width + x) * 4 + 3] > 80) {
        candidates.push({ x: (x - board.width/2) / 390, y: (y - board.height/2) / 390 });
      }
    }
  }
  if (!candidates.length) return Array.from({ length: count }, (_, i) => heartPoint(i));
  return Array.from({ length: count }, () => {
    const p = candidates[Math.floor(Math.random() * candidates.length)];
    return { x: p.x + (Math.random()-.5)*.012, y: p.y + (Math.random()-.5)*.012 };
  });
}

function buildShapeTargets(count) {
  shapeTargets = {
    heart: Array.from({ length: count }, (_, i) => heartPoint(i)),
    rose: Array.from({ length: count }, (_, i) => rosePoint(i)),
    galaxy: Array.from({ length: count }, (_, i) => galaxyPoint(i)),
    name: makeTextTargets(count, copy.to)
  };
}

function resetParticles() {
  const count = Math.min(2400, Math.max(1050, Math.round(width * height / 480)));
  const spawnScale = Math.min(width, height) * (width < 700 ? .24 : .28);
  buildShapeTargets(count);
  particles = shapeTargets[activeShape].map((target, index) => {
    const palette = palettes[activeShape];
    return {
      x: energy.x + target.x * spawnScale + (Math.random() - .5) * 34,
      y: energy.y + target.y * spawnScale + (Math.random() - .5) * 34,
      vx: (Math.random() - .5) * 2, vy: (Math.random() - .5) * 2,
      size: .55 + Math.random() * 2.05, alpha: .38 + Math.random() * .62,
      phase: Math.random() * Math.PI * 2,
      color: palette[index % palette.length], target
    };
  });
}

function resize() {
  dpr = Math.min(devicePixelRatio || 1, 2);
  width = innerWidth; height = innerHeight;
  canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
  canvas.style.width = `${width}px`; canvas.style.height = `${height}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const openingX = width > 820 && !interactionStarted ? width * .68 : width * .5;
  energy.x = energy.tx = openingX;
  energy.y = energy.ty = height * (width < 700 && !interactionStarted ? .66 : .56);
  resetParticles();
}
addEventListener("resize", resize, { passive: true });

function addRing(power = 1, color = "255,111,145") {
  rings.push({ x: energy.x, y: energy.y, radius: 10, alpha: .7, speed: 5 * power, color });
  if (rings.length > 8) rings.shift();
}

function burst(power = 1) {
  if (burstCooldown > 0) return;
  burstCooldown = 22; addRing(power);
  particles.forEach((p) => {
    const dx = p.x - energy.x, dy = p.y - energy.y;
    const len = Math.hypot(dx, dy) || 1;
    const force = (3 + Math.random() * 9) * power;
    p.vx += dx / len * force + (Math.random() - .5) * 2.4;
    p.vy += dy / len * force + (Math.random() - .5) * 2.4;
  });
}

function selectShape(shape, announce = true) {
  if (!shapeTargets[shape]) return;
  const changed = activeShape !== shape;
  activeShape = shape;
  const palette = palettes[shape];
  particles.forEach((p, index) => {
    p.target = shapeTargets[shape][index];
    p.color = palette[index % palette.length];
  });
  els.picker.querySelectorAll("button").forEach((button) => button.classList.toggle("is-active", button.dataset.shape === shape));
  if (changed) {
    burstCooldown = 0; burst(.46); setMode("form");
    addRing(.8, shape === "galaxy" ? "160,190,255" : "255,150,176");
  }
  if (announce) {
    const names = { heart: "心动爱心", rose: "粒子玫瑰", galaxy: "旋转星河", name: `${copy.to}的名字` };
    setStatus(`造型 · ${names[shape]}`, tracking ? "live" : "");
  }
}

function cycleShape() {
  if (shapeCooldown > 0) return;
  shapeCooldown = 90;
  const next = shapeOrder[(shapeOrder.indexOf(activeShape) + 1) % shapeOrder.length];
  selectShape(next);
}

function setMode(next) {
  if (next === mode) return;
  previousMode = mode; mode = next;
  els.experience.dataset.gesture = next;
  if (mode === "open" && previousMode !== "open") burst(1);
  els.gesture.classList.toggle("is-open", mode === "open");
  const content = {
    open: ["星光正在绽放", "捏合指尖，让它重新聚拢"],
    form: ["心意正在聚拢", "张开手掌，让它散成星河"],
    fist: ["保持握拳", "即将切换下一个粒子造型"],
    hover: ["移动指尖", "星光会跟随你的轨迹"]
  }[mode] || ["正在感应手势", "把手放在镜头前"];
  els.gestureTitle.textContent = content[0]; els.gestureHint.textContent = content[1];
}

function pushTrail(x, y, strength = 1) {
  const now = performance.now();
  if (now - lastTrailAt < 24) return;
  lastTrailAt = now;
  for (let i = 0; i < 3; i++) trails.push({
    x: x + (Math.random()-.5)*18, y: y + (Math.random()-.5)*18,
    vx: (Math.random()-.5)*.9, vy: (Math.random()-.5)*.9,
    alpha: .6*strength, size: 1 + Math.random()*3, hue: activeShape
  });
  if (trails.length > 130) trails.splice(0, trails.length - 130);
}

function animate(time = 0) {
  ctx.clearRect(0, 0, width, height);
  energy.x += (energy.tx - energy.x) * .12; energy.y += (energy.ty - energy.y) * .12;
  targetFormAmount = mode === "open" ? .07 : mode === "form" ? 1 : mode === "fist" ? .82 : .52;
  formAmount += (targetFormAmount - formAmount) * .055;
  if (burstCooldown > 0) burstCooldown--; if (shapeCooldown > 0) shapeCooldown--;

  ctx.globalCompositeOperation = "lighter";
  trails.forEach((trail) => {
    trail.x += trail.vx; trail.y += trail.vy; trail.alpha *= .955; trail.size *= .992;
    const color = trail.hue === "galaxy" ? "174,210,255" : "255,145,177";
    ctx.fillStyle = `rgba(${color},${trail.alpha})`;
    ctx.beginPath(); ctx.arc(trail.x, trail.y, trail.size, 0, Math.PI*2); ctx.fill();
  });
  trails = trails.filter((trail) => trail.alpha > .025);

  rings.forEach((ring) => {
    ring.radius += ring.speed; ring.alpha *= .95;
    ctx.strokeStyle = `rgba(${ring.color},${ring.alpha})`; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.arc(ring.x, ring.y, ring.radius, 0, Math.PI*2); ctx.stroke();
  });
  rings = rings.filter((ring) => ring.alpha > .025);

  let baseScale = Math.min(width, height) * (width < 700 ? (interactionStarted ? .31 : .24) : .28);
  if (activeShape === "name") baseScale *= 1.12;
  if (activeShape === "galaxy") baseScale *= 1.08;
  particles.forEach((p, index) => {
    const twinkle = .72 + Math.sin(time * .002 + p.phase) * .28;
    const spin = activeShape === "galaxy" && mode !== "form" ? time * .00008 : 0;
    const cos = Math.cos(spin), sin = Math.sin(spin);
    const rx = p.target.x * cos - p.target.y * sin;
    const ry = p.target.x * sin + p.target.y * cos;
    const tx = energy.x + rx * baseScale, ty = energy.y + ry * baseScale;
    const spring = .012 + formAmount * .035;
    p.vx += (tx - p.x) * spring * formAmount; p.vy += (ty - p.y) * spring * formAmount;
    if (mode === "open") {
      const dx = p.x - energy.x, dy = p.y - energy.y, len = Math.hypot(dx,dy) || 1;
      p.vx += dx / len * .018; p.vy += dy / len * .018;
    } else {
      p.vx += Math.sin(time*.0012+p.phase)*.002; p.vy += Math.cos(time*.001+p.phase)*.002;
    }
    const damping = mode === "open" ? .988 : .91;
    p.vx *= damping; p.vy *= damping; p.x += p.vx; p.y += p.vy;
    if (p.x < -100 || p.x > width+100 || p.y < -100 || p.y > height+100) {
      p.x += (energy.x-p.x)*.03; p.y += (energy.y-p.y)*.03;
    }
    const [r,g,b] = p.color;
    const size = p.size * (mode === "open" ? .8 : 1) * (prefersReducedMotion ? 1 : twinkle);
    ctx.fillStyle = `rgba(${r},${g},${b},${p.alpha*twinkle})`;
    ctx.beginPath(); ctx.arc(p.x,p.y,Math.max(.45,size),0,Math.PI*2); ctx.fill();
    if (index % 58 === 0) {
      ctx.strokeStyle = `rgba(${r},${g},${b},${.2*twinkle})`;
      ctx.beginPath(); ctx.moveTo(p.x-size*3.5,p.y); ctx.lineTo(p.x+size*3.5,p.y); ctx.stroke();
    }
  });
  ctx.globalCompositeOperation = "source-over";
  requestAnimationFrame(animate);
}

function distance(a,b) { return Math.hypot(a.x-b.x, a.y-b.y); }
function processHand(landmarks) {
  lostFrames = 0; tracking = true;
  const thumb = landmarks[4], index = landmarks[8], wrist = landmarks[0];
  const palmSize = distance(landmarks[5], landmarks[17]) || .16;
  const pinch = distance(thumb,index) / palmSize;
  const openness = [8,12,16,20].reduce((sum,i)=>sum+distance(landmarks[i],wrist),0) / 4 / palmSize;
  const midX = 1-(thumb.x+index.x)/2, midY = (thumb.y+index.y)/2;
  energy.tx = midX*width; energy.ty = midY*height; pushTrail(energy.tx, energy.ty, mode === "open" ? .45 : 1);
  const now = performance.now();
  if (pinch < .48) {
    fistStartedAt = 0; fistLatched = false; setMode("form");
  } else if (openness > 2.18 && pinch > .68) {
    fistStartedAt = 0; fistLatched = false; setMode("open");
  } else if (openness < 1.45) {
    setMode("fist");
    if (!fistStartedAt) fistStartedAt = now;
    if (!fistLatched && now-fistStartedAt > 650) { fistLatched = true; cycleShape(); }
  } else {
    fistStartedAt = 0; fistLatched = false; setMode("hover");
  }
}

async function loadHandTracking() {
  if (handLandmarker) return handLandmarker;
  if (handLoadPromise) return handLoadPromise;
  handLoadPromise = (async () => {
    setStatus("正在启动本地手势模型…");
    const moduleUrl = new URL("./vendor/mediapipe/vision_bundle.js", import.meta.url).href;
    const wasmUrl = new URL("./vendor/mediapipe/wasm/", import.meta.url).href;
    const modelUrl = new URL("./vendor/mediapipe/hand_landmarker.task", import.meta.url).href;
    const module = await import(moduleUrl);
    const make = async (delegate) => {
      const vision = await module.FilesetResolver.forVisionTasks(wasmUrl);
      return module.HandLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: modelUrl, delegate }, runningMode: "VIDEO", numHands: 1,
        minHandDetectionConfidence: .5, minHandPresenceConfidence: .48, minTrackingConfidence: .48
      });
    };
    try { return await make("GPU"); }
    catch (gpuError) {
      console.warn("GPU hand tracking unavailable; falling back to CPU", gpuError);
      setStatus("GPU 不可用，正在切换兼容模式…");
      return make("CPU");
    }
  })();
  try { handLandmarker = await handLoadPromise; return handLandmarker; }
  catch (error) { handLoadPromise = null; throw error; }
}

function revealExperience() {
  els.intro.classList.add("is-hidden"); els.dedication.classList.add("is-visible");
  els.gesture.classList.add("is-visible"); els.picker.classList.add("is-visible");
  els.experience.classList.add("is-awake");
  interactionStarted = true;
}

function showCameraHelp(title, text) {
  els.cameraHelpTitle.textContent = title; els.cameraHelpText.textContent = text;
  els.cameraHelp.classList.add("is-visible");
}
function hideCameraHelp() { els.cameraHelp.classList.remove("is-visible"); }

function cameraErrorMessage(error, stage) {
  const embedded = window.self !== window.top;
  if (stage === "policy") return ["当前窗口禁止摄像头", "这个内嵌预览没有获得摄像头权限。请点击“在新窗口打开”，再允许浏览器访问摄像头。"];
  if (stage === "model") return ["相机已连接，但识别模型未启动", "已自动尝试 GPU 和兼容模式。请更新 Chrome、Edge 或 Safari 后重试；鼠标/触控模式仍可使用全部造型。"];
  if (error?.name === "NotAllowedError") return ["没有获得摄像头权限", embedded ? "内嵌窗口可能拦截了权限。请在新窗口打开，并在地址栏的摄像头设置里选择“允许”。" : "请点击地址栏旁的摄像头图标，将权限改为“允许”，然后重新尝试。"];
  if (error?.name === "NotFoundError") return ["没有找到摄像头", "请确认设备有可用摄像头，或连接外接摄像头后重新尝试。"];
  if (error?.name === "NotReadableError") return ["摄像头正被占用", "请先关闭微信、腾讯会议或其他正在使用摄像头的软件，然后重新尝试。"];
  return ["摄像头没有启动", "请在新窗口打开并允许摄像头权限。你也可以直接用鼠标按住/松开体验所有粒子效果。"];
}

async function startCamera() {
  if (cameraStarting) return;
  if (cameraStream) { stopCamera(); return; }
  revealExperience(); hideCameraHelp(); cameraStarting = true;
  try {
    if (!isSecureContext && !["localhost","127.0.0.1"].includes(location.hostname)) throw Object.assign(new Error("Camera requires HTTPS"), { code: "INSECURE" });
    if (!navigator.mediaDevices?.getUserMedia) throw Object.assign(new Error("getUserMedia unavailable"), { code: "UNSUPPORTED" });
    const policy = document.permissionsPolicy || document.featurePolicy;
    if (policy?.allowsFeature && !policy.allowsFeature("camera")) {
      const [title,text] = cameraErrorMessage(null,"policy"); showCameraHelp(title,text); setStatus("内嵌窗口未开放摄像头权限","error"); return;
    }
    setStatus("正在请求摄像头权限…");
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode:"user", width:{ideal:960}, height:{ideal:720} }, audio:false
    });
    video.srcObject = cameraStream; await video.play();
    els.preview.classList.add("is-visible");
    try { await loadHandTracking(); }
    catch (error) {
      console.error("Hand model failed", error); stopCamera(false);
      const [title,text] = cameraErrorMessage(error,"model"); showCameraHelp(title,text); setStatus("手势模型启动失败 · 鼠标模式可用","error"); return;
    }
    els.camera.classList.add("is-active"); setStatus("手势识别中 · 捏合 / 张手 / 握拳","live");
    running = true; detectHands();
  } catch (error) {
    console.error("Camera start failed", error); stopCamera(false);
    const [title,text] = cameraErrorMessage(error,"camera"); showCameraHelp(title,text); setStatus(`${title} · 鼠标模式可用`,"error");
  } finally { cameraStarting = false; }
}

function stopCamera(updateStatus = true) {
  running = false; tracking = false;
  cameraStream?.getTracks().forEach((track)=>track.stop()); cameraStream = null; video.srcObject = null;
  els.preview.classList.remove("is-visible"); els.camera.classList.remove("is-active");
  if (updateStatus) setStatus("摄像头已关闭 · 鼠标模式");
}

function detectHands() {
  if (!running) return;
  const now = performance.now();
  if (video.readyState >= 2 && video.currentTime !== lastVideoTime && now-lastDetectAt > 32) {
    lastVideoTime = video.currentTime; lastDetectAt = now;
    try {
      const result = handLandmarker.detectForVideo(video, now);
      if (result.landmarks?.length) processHand(result.landmarks[0]);
      else if (++lostFrames > 12) { tracking = false; setMode("form"); }
    } catch (error) { console.warn("Hand detection frame skipped", error); }
  }
  requestAnimationFrame(detectHands);
}

function setStatus(text, state="") {
  els.statusText.textContent = text;
  els.status.classList.toggle("is-live", state === "live"); els.status.classList.toggle("is-error", state === "error");
}

function pointerPosition(event) { energy.tx = event.clientX; energy.ty = event.clientY; pushTrail(energy.tx,energy.ty); }
canvas.addEventListener("pointermove", (event)=>{ if(!tracking) pointerPosition(event); });
canvas.addEventListener("pointerdown", (event)=>{
  revealExperience(); if(!tracking){ pointerPosition(event); setMode("form"); canvas.setPointerCapture?.(event.pointerId); }
});
canvas.addEventListener("pointerup", (event)=>{ if(!tracking){ pointerPosition(event); setMode("open"); } });

els.start.addEventListener("click", () => { startMusic().catch((error)=>console.warn("Music unavailable",error)); startCamera(); });
els.camera.addEventListener("click", startCamera);
els.music.addEventListener("click", toggleMusic);
els.retryCamera.addEventListener("click", ()=>{ hideCameraHelp(); if(cameraStream) stopCamera(false); startCamera(); });
els.openExternal.addEventListener("click", ()=>window.open(location.href,"_blank","noopener,noreferrer"));
els.helpClose.addEventListener("click", hideCameraHelp);
els.fullscreen.addEventListener("click", ()=>{
  if(!document.fullscreenElement) document.documentElement.requestFullscreen?.(); else document.exitFullscreen?.();
});
els.picker.addEventListener("click", (event)=>{
  const button = event.target.closest("button[data-shape]"); if(button) selectShape(button.dataset.shape);
});

els.edit.addEventListener("click", ()=>{
  els.toInput.value=copy.to; els.messageInput.value=copy.message; els.fromInput.value=copy.from;
  els.feedback.textContent=""; els.editor.showModal();
});
function readEditor(){
  copy={to:safeText(els.toInput.value,DEFAULTS.to,16),message:safeText(els.messageInput.value,DEFAULTS.message,60),from:safeText(els.fromInput.value,DEFAULTS.from,20)};
  localStorage.setItem("heart-particle-dedication",JSON.stringify(copy)); applyCopy();
}
els.form.addEventListener("submit",(event)=>{
  const action=event.submitter?.value; readEditor();
  if(action==="share"){
    event.preventDefault(); const url=new URL(location.href);
    url.search=new URLSearchParams({to:copy.to,msg:copy.message,from:copy.from}).toString(); history.replaceState(null,"",url);
    navigator.clipboard?.writeText(url.href).then(()=>{els.feedback.textContent="专属链接已复制 ✓";setTimeout(()=>els.editor.close(),850);}).catch(()=>{els.feedback.textContent="已生成链接，请复制浏览器地址栏";});
  }
});
addEventListener("keydown",(event)=>{
  if(/[1-4]/.test(event.key)) selectShape(shapeOrder[Number(event.key)-1]);
  if(event.key.toLowerCase()==="h") setMode(mode==="form"?"open":"form");
});

buildAmbient(); applyCopy(); resize(); requestAnimationFrame(animate);
setInterval(updateLoveQuote, 7200);
setInterval(() => {
  if (interactionStarted && !tracking && !els.editor.open && document.visibilityState === "visible") cycleShape();
}, 15000);
setTimeout(()=>{ if(!interactionStarted) energy.tx=width*(width>820?.68:.5); },700);
