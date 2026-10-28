const desktop = window.hatchedPet ?? {
  getDesktopState: async () => ({
    bounds: { x: 0, y: 0, width: 360, height: 800 },
    workArea: { x: 0, y: 0, width: window.screen.availWidth, height: window.screen.availHeight },
    roamingEnabled: false,
  }),
  moveTo: () => {},
  setClickThrough: () => {},
  setRoaming: () => {},
  hide: () => {},
  quit: () => {},
  openApp: async () => ({ opened: false, label: "that app" }),
  onRoamingChanged: () => () => {},
  onPetAction: () => () => {},
  onCalendarReminder: () => () => {},
};

const STORAGE_KEY = "hatched-ice-pet-state-v1";
const PET_NAME = "帽兜";
const OWNER_NAMES = ["悉尼"];
const OWNER_PLACES = ["纽约", "上海", "香港", "欧洲", "苏黎世", "巴黎", "奥克兰"];

function ownerName() {
  return OWNER_NAMES[Math.floor(Math.random() * OWNER_NAMES.length)];
}

function ownerPlace() {
  return OWNER_PLACES[Math.floor(Math.random() * OWNER_PLACES.length)];
}
const defaults = {
  sleeping: false,
  facingBack: false,
};

const appElement = document.querySelector("#app");
const bunny = document.querySelector("#bunny-image");
const petStage = document.querySelector("#pet-stage");
const speechBubble = document.querySelector("#speech-bubble");
const particles = document.querySelector("#particles");
const launcher = document.querySelector("#app-launcher");
const roamButton = document.querySelector("#roam-button");
const hideButton = document.querySelector("#hide-button");

let pet = loadPet();
let roamingEnabled = true;
let reactionState = null;
let reactionTimer;
let speechTimer;
let wanderTimer;
let napTimer;
let walkTimer;
let walkFrameTimer;
let walkFrameIndex = 0;
let walkStep = 1;
const walkFrames = [];
const sadFrames = [];
const turnFrames = [];
const sleepFrames = [];
const runJumpFrames = [];
const RUN_COUNT = 4;
let sadFrameTimer;
let turnFrameTimer;
let sleepFrameTimer;
let hopTimer;
let turnFrameIndex = 0;
let runFrameIndex = 0;
let dragging = null;
let ignoreMouseEvents = null;
let launcherTimer;
let bunnyHitMask = null;
let currentBunnyFrame = "normal";
let nextClickReaction = "happy";
const bunnyFrames = new Map();

// The frame Maodou returns to once any reaction finishes.
function baseFrame() {
  return pet.facingBack ? "back" : "normal";
}

function showBunnyFrame(frameName) {
  currentBunnyFrame = frameName;
  const frame = bunnyFrames.get(frameName);
  if (!frame) return;

  const outputContext = bunny.getContext("2d", { willReadFrequently: true });
  outputContext.clearRect(0, 0, bunny.width, bunny.height);
  outputContext.drawImage(frame.canvas, 0, 0);
  bunnyHitMask = frame.hitMask;
}

function loadBunnyArtwork(frameName, sourcePath) {
  const image = new Image();
  image.decoding = "async";
  image.src = sourcePath;

  image.addEventListener("load", () => {
    const source = document.createElement("canvas");
    source.width = image.naturalWidth;
    source.height = image.naturalHeight;
    const sourceContext = source.getContext("2d", { willReadFrequently: true });
    sourceContext.drawImage(image, 0, 0);

    const imageData = sourceContext.getImageData(0, 0, source.width, source.height);
    const pixels = imageData.data;
    const total = source.width * source.height;
    const background = new Uint8Array(total);
    const queue = new Int32Array(total);
    let readIndex = 0;
    let writeIndex = 0;

    const isBackgroundColor = (index) => {
      const offset = index * 4;
      const red = pixels[offset];
      const green = pixels[offset + 1];
      const blue = pixels[offset + 2];
      return (
        Math.min(red, green, blue) > 238 &&
        Math.max(red, green, blue) - Math.min(red, green, blue) < 18
      );
    };

    const enqueue = (index) => {
      if (background[index] || !isBackgroundColor(index)) return;
      background[index] = 1;
      queue[writeIndex] = index;
      writeIndex += 1;
    };

    for (let x = 0; x < source.width; x += 1) {
      enqueue(x);
      enqueue((source.height - 1) * source.width + x);
    }
    for (let y = 0; y < source.height; y += 1) {
      enqueue(y * source.width);
      enqueue(y * source.width + source.width - 1);
    }

    while (readIndex < writeIndex) {
      const index = queue[readIndex];
      readIndex += 1;
      const x = index % source.width;
      const y = Math.floor(index / source.width);
      if (x > 0) enqueue(index - 1);
      if (x < source.width - 1) enqueue(index + 1);
      if (y > 0) enqueue(index - source.width);
      if (y < source.height - 1) enqueue(index + source.width);
    }

    let minX = source.width;
    let minY = source.height;
    let maxX = 0;
    let maxY = 0;

    for (let index = 0; index < total; index += 1) {
      if (background[index]) {
        pixels[index * 4 + 3] = 0;
        continue;
      }
      const x = index % source.width;
      const y = Math.floor(index / source.width);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }

    sourceContext.putImageData(imageData, 0, 0);
    const frame = document.createElement("canvas");
    frame.width = bunny.width;
    frame.height = bunny.height;
    const frameContext = frame.getContext("2d", { willReadFrequently: true });

    const cropWidth = maxX - minX + 1;
    const cropHeight = maxY - minY + 1;
    const scale = Math.min(570 / cropWidth, 570 / cropHeight);
    const drawWidth = cropWidth * scale;
    const drawHeight = cropHeight * scale;
    const drawX = (bunny.width - drawWidth) / 2;
    const drawY = bunny.height - drawHeight - 14;

    frameContext.drawImage(
      source,
      minX,
      minY,
      cropWidth,
      cropHeight,
      drawX,
      drawY,
      drawWidth,
      drawHeight,
    );

    const rendered = frameContext.getImageData(0, 0, bunny.width, bunny.height).data;
    const hitMask = new Uint8Array(bunny.width * bunny.height);
    for (let index = 0; index < hitMask.length; index += 1) {
      hitMask[index] = rendered[index * 4 + 3];
    }

    bunnyFrames.set(frameName, { canvas: frame, hitMask });
    if (currentBunnyFrame === frameName) showBunnyFrame(frameName);
  });
}

function showWalkFrame(index) {
  if (!walkFrames.length) return;
  walkFrameIndex = ((index % walkFrames.length) + walkFrames.length) % walkFrames.length;
  const frame = walkFrames[walkFrameIndex];
  const outputContext = bunny.getContext("2d", { willReadFrequently: true });
  outputContext.clearRect(0, 0, bunny.width, bunny.height);
  outputContext.drawImage(frame.canvas, 0, 0);
  bunnyHitMask = frame.hitMask;
  currentBunnyFrame = "walk";
}

function playWalkCycle(step = 1) {
  if (walkFrameTimer && walkStep === step && currentBunnyFrame === "walk") return;
  walkStep = step;
  clearInterval(walkFrameTimer);
  clearInterval(hopTimer);
  hopTimer = null;
  if (!walkFrames.length) {
    showBunnyFrame("normal");
    return;
  }

  showWalkFrame(walkFrameIndex);
  walkFrameTimer = setInterval(() => {
    showWalkFrame(walkFrameIndex + walkStep);
  }, 140);
}

function showRunFrame(index) {
  if (runJumpFrames.length < RUN_COUNT) return;
  runFrameIndex = ((index % RUN_COUNT) + RUN_COUNT) % RUN_COUNT;
  paintSheetFrame(runJumpFrames, runFrameIndex, "run");
}

function playRunCycle(step = 1) {
  if (walkFrameTimer && walkStep === step && currentBunnyFrame === "run") return;
  walkStep = step;
  clearInterval(walkFrameTimer);
  clearInterval(hopTimer);
  hopTimer = null;
  if (runJumpFrames.length < RUN_COUNT) {
    playWalkCycle(step);
    return;
  }

  showRunFrame(runFrameIndex);
  walkFrameTimer = setInterval(() => {
    showRunFrame(runFrameIndex + walkStep);
  }, 110);
}

function playHop(onDone) {
  clearInterval(walkFrameTimer);
  clearInterval(hopTimer);
  walkFrameTimer = null;
  if (runJumpFrames.length < 8) {
    onDone?.();
    return;
  }

  let index = RUN_COUNT;
  paintSheetFrame(runJumpFrames, index, "hop");
  setVisualState("hop");
  hopTimer = setInterval(() => {
    index += 1;
    if (index >= runJumpFrames.length) {
      clearInterval(hopTimer);
      hopTimer = null;
      onDone?.();
      return;
    }
    paintSheetFrame(runJumpFrames, index, "hop");
  }, 130);
}

function prepareWalkCell(source, sx, sy, sw, sh, sharedY = null) {
  const imageData = source.getContext("2d").getImageData(sx, sy, sw, sh);
  const pixels = imageData.data;
  let minX = sw;
  let minY = sh;
  let maxX = 0;
  let maxY = 0;

  for (let index = 0; index < sw * sh; index += 1) {
    const offset = index * 4;
    if (pixels[offset] + pixels[offset + 1] + pixels[offset + 2] < 36) {
      pixels[offset + 3] = 0;
      continue;
    }
    const x = index % sw;
    const y = Math.floor(index / sw);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }

  if (maxX < minX) return null;

  const cut = document.createElement("canvas");
  cut.width = sw;
  cut.height = sh;
  cut.getContext("2d").putImageData(imageData, 0, 0);

  const cropX = minX;
  const cropY = sharedY ? sharedY.minY : minY;
  const cropWidth = maxX - minX + 1;
  const cropHeight = sharedY ? sharedY.maxY - sharedY.minY + 1 : maxY - minY + 1;
  const frame = document.createElement("canvas");
  frame.width = bunny.width;
  frame.height = bunny.height;
  const frameContext = frame.getContext("2d", { willReadFrequently: true });
  const scale = Math.min(570 / cropWidth, 570 / cropHeight);
  const drawWidth = cropWidth * scale;
  const drawHeight = cropHeight * scale;
  frameContext.drawImage(
    cut,
    cropX,
    cropY,
    cropWidth,
    cropHeight,
    (bunny.width - drawWidth) / 2,
    bunny.height - drawHeight - 14,
    drawWidth,
    drawHeight,
  );

  const rendered = frameContext.getImageData(0, 0, bunny.width, bunny.height).data;
  const hitMask = new Uint8Array(bunny.width * bunny.height);
  for (let index = 0; index < hitMask.length; index += 1) {
    hitMask[index] = rendered[index * 4 + 3];
  }

  return { canvas: frame, hitMask };
}

function sheetCellBounds(source, sx, sy, sw, sh) {
  const { data } = source.getContext("2d").getImageData(sx, sy, sw, sh);
  let minY = sh;
  let maxY = 0;
  for (let index = 0; index < sw * sh; index += 1) {
    const offset = index * 4;
    if (data[offset] + data[offset + 1] + data[offset + 2] < 36) continue;
    const y = Math.floor(index / sw);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  return maxY >= minY ? { minY, maxY } : null;
}

function loadSheet(sourcePath, frames, columns = 8, onLoad, options = {}) {
  const image = new Image();
  image.decoding = "async";
  image.src = sourcePath;
  image.addEventListener("load", () => {
    const source = document.createElement("canvas");
    source.width = image.naturalWidth;
    source.height = image.naturalHeight;
    source.getContext("2d", { willReadFrequently: true }).drawImage(image, 0, 0);

    const cellWidth = Math.floor(source.width / columns);
    let sharedY = null;
    if (options.preserveY) {
      let minY = source.height;
      let maxY = 0;
      for (let column = 0; column < columns; column += 1) {
        const bounds = sheetCellBounds(source, column * cellWidth, 0, cellWidth, source.height);
        if (!bounds) continue;
        minY = Math.min(minY, bounds.minY);
        maxY = Math.max(maxY, bounds.maxY);
      }
      if (maxY >= minY) sharedY = { minY, maxY };
    }

    frames.length = 0;
    for (let column = 0; column < columns; column += 1) {
      const frame = prepareWalkCell(source, column * cellWidth, 0, cellWidth, source.height, sharedY);
      if (frame) frames.push(frame);
    }
    onLoad?.(frames);
  });
}

function loadDefaultStanding() {
  const image = new Image();
  image.decoding = "async";
  image.src = "./assets/maodou-turn-around-preview.png";
  image.addEventListener("load", () => {
    const source = document.createElement("canvas");
    source.width = image.naturalWidth;
    source.height = image.naturalHeight;
    source.getContext("2d", { willReadFrequently: true }).drawImage(image, 0, 0);
    const cellWidth = Math.floor(source.width / 10);
    const frame = prepareWalkCell(source, 0, 0, cellWidth, source.height);
    if (!frame) return;
    bunnyFrames.set("normal", frame);
    if (currentBunnyFrame === "normal") showBunnyFrame("normal");
  });
}

function paintSheetFrame(frames, index, frameName) {
  const frame = frames[index];
  if (!frame) return;
  const outputContext = bunny.getContext("2d", { willReadFrequently: true });
  outputContext.clearRect(0, 0, bunny.width, bunny.height);
  outputContext.drawImage(frame.canvas, 0, 0);
  bunnyHitMask = frame.hitMask;
  currentBunnyFrame = frameName;
}

function clearSleepAnimation() {
  clearInterval(sleepFrameTimer);
  sleepFrameTimer = null;
}

function playSleepTransition(toSleep) {
  clearSleepAnimation();
  if (!sleepFrames.length) {
    if (!toSleep) showBunnyFrame(baseFrame());
    return;
  }

  const last = sleepFrames.length - 1;
  let index = toSleep ? 0 : last;
  const step = toSleep ? 1 : -1;
  const end = toSleep ? last : 0;
  const paint = () => paintSheetFrame(sleepFrames, index, toSleep ? "sleep" : "normal");

  paint();
  sleepFrameTimer = setInterval(() => {
    if (index === end) {
      clearSleepAnimation();
      if (!toSleep) {
        reactionState = null;
        showBunnyFrame(baseFrame());
        setVisualState();
      }
      return;
    }
    index += step;
    paint();
  }, 160);
}

function playSadTransition() {
  clearInterval(sadFrameTimer);
  if (!sadFrames.length) {
    showBunnyFrame("sad");
    return;
  }

  let index = 0;
  const paint = () => paintSheetFrame(sadFrames, index, "sad");

  paint();
  sadFrameTimer = setInterval(() => {
    if (index >= sadFrames.length - 1) {
      clearInterval(sadFrameTimer);
      sadFrameTimer = null;
      return;
    }
    index += 1;
    paint();
  }, 180);
}

function playTurnAround(toBack, fromIndex = null) {
  clearInterval(turnFrameTimer);
  turnFrameTimer = null;
  if (!turnFrames.length) {
    showBunnyFrame(toBack ? "back" : "normal");
    return;
  }

  const last = turnFrames.length - 1;
  let index = fromIndex == null ? (toBack ? 0 : last) : fromIndex;
  index = Math.max(0, Math.min(last, index));
  const step = toBack ? 1 : -1;
  const end = toBack ? last : 0;
  const dest = toBack ? "back" : "normal";
  const paint = () => {
    turnFrameIndex = index;
    paintSheetFrame(turnFrames, index, dest);
  };

  paint();
  if (index === end) {
    showBunnyFrame(dest);
    return;
  }
  turnFrameTimer = setInterval(() => {
    if (index === end) {
      clearInterval(turnFrameTimer);
      turnFrameTimer = null;
      showBunnyFrame(dest);
      return;
    }
    index += step;
    paint();
  }, 150);
}

function clearTurnAnimation() {
  clearInterval(turnFrameTimer);
  turnFrameTimer = null;
}

function isOverBunny(event) {
  if (!bunnyHitMask) return false;
  const bounds = bunny.getBoundingClientRect();
  const x = Math.floor(((event.clientX - bounds.left) / bounds.width) * bunny.width);
  const y = Math.floor(((event.clientY - bounds.top) / bounds.height) * bunny.height);
  if (x < 0 || y < 0 || x >= bunny.width || y >= bunny.height) return false;
  return bunnyHitMask[y * bunny.width + x] > 24;
}

function loadPet() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return { ...defaults, ...saved, facingBack: false, sleeping: false };
  } catch {
    return { ...defaults };
  }
}

function savePet() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(pet));
}

function naturalState() {
  return pet.sleeping ? "sleep" : "idle";
}

function setVisualState(state = naturalState()) {
  appElement.dataset.state = state;
}

function say(message, duration = 2400) {
  clearTimeout(speechTimer);
  speechBubble.textContent = String(message)
    .replace(/[，,。.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  speechBubble.classList.add("visible");
  speechTimer = setTimeout(() => speechBubble.classList.remove("visible"), duration);
}

function react(state, message, duration = 1700, bunnyFrame = baseFrame()) {
  clearTimeout(reactionTimer);
  clearInterval(sadFrameTimer);
  sadFrameTimer = null;
  clearInterval(hopTimer);
  hopTimer = null;
  clearTurnAnimation();
  clearSleepAnimation();
  reactionState = state;
  if (state === "sad") {
    playSadTransition();
  } else {
    showBunnyFrame(bunnyFrame);
  }
  setVisualState(state);
  if (message) say(message, duration);
  reactionTimer = setTimeout(() => {
    reactionState = null;
    clearInterval(sadFrameTimer);
    sadFrameTimer = null;
    clearTurnAnimation();
    showBunnyFrame(baseFrame());
    setVisualState();
  }, duration);
}

function burst(symbols = ["✦", "❄", "✧", "❄", "✦"]) {
  symbols.forEach((symbol, index) => {
    const particle = document.createElement("i");
    const angle = -Math.PI + (Math.PI * index) / Math.max(1, symbols.length - 1);
    const distance = 55 + Math.random() * 35;
    particle.className = "particle";
    particle.textContent = symbol;
    particle.style.setProperty("--x", `${Math.cos(angle) * distance}px`);
    particle.style.setProperty("--y", `${Math.sin(angle) * distance - 15}px`);
    particle.style.setProperty("--r", `${Math.round(Math.random() * 80 - 40)}deg`);
    particle.style.animationDelay = `${index * 45}ms`;
    particles.append(particle);
    particle.addEventListener("animationend", () => particle.remove(), { once: true });
  });
}

function feedPet() {
  if (pet.sleeping) {
    say(`${ownerName()} 瑰丽的蛋挞比较好吃`);
    return;
  }

  react("munch", `${ownerName()} 这是哪里的蛋挞`);
  burst(["❄", "❄", "✧", "❄"]);
}

function playWithPet() {
  if (pet.sleeping) {
    say(`${ownerName()} 先别玩 我还在跑model`);
    return;
  }

  react("happy", `开心`, 1700, "happy");
  burst(["✦", "✧", "❄", "✦", "✧", "❄"]);
}

function toggleSleep() {
  const toSleep = !pet.sleeping;
  pet.sleeping = toSleep;
  reactionState = "sleep";
  clearTimeout(reactionTimer);
  clearInterval(sadFrameTimer);
  sadFrameTimer = null;
  clearTurnAnimation();
  stopWalking();
  playSleepTransition(toSleep);
  setVisualState();
  say(toSleep ? `晚安 ${ownerName()}` : `我醒了 ${ownerName()}`);
  clearTimeout(napTimer);
  if (!toSleep) {
    burst(["☀", "✦", "❄"]);
    scheduleWander(8000);
    scheduleNap();
  }
  savePet();
}

function petBunny() {
  const reaction = nextClickReaction;
  nextClickReaction = reaction === "happy" ? "sad" : "happy";
  react(reaction, null, reaction === "sad" ? 2000 : 1600, reaction);
}

function turnAround() {
  const toBack = !pet.facingBack;
  pet.facingBack = toBack;
  clearTimeout(reactionTimer);
  clearInterval(sadFrameTimer);
  sadFrameTimer = null;
  clearSleepAnimation();
  stopWalking();
  reactionState = "turn";
  playTurnAround(toBack);
  setVisualState();
  say(toBack ? `${ownerName()} 等一下` : `${ownerName()} 我回来了`);
  savePet();
  reactionTimer = setTimeout(() => {
    reactionState = null;
    clearTurnAnimation();
    showBunnyFrame(baseFrame());
    setVisualState();
  }, turnFrames.length ? 1700 : 200);
}

function setRoaming(enabled) {
  roamingEnabled = enabled;
  roamButton.textContent = enabled ? "Pause" : "Roam";
  if (enabled) {
    scheduleWander(2500);
  } else {
    stopWalking();
    clearTimeout(wanderTimer);
  }
}

function stopWalking() {
  clearInterval(walkTimer);
  clearInterval(walkFrameTimer);
  clearInterval(hopTimer);
  walkTimer = null;
  walkFrameTimer = null;
  hopTimer = null;
  if (!reactionState) {
    showBunnyFrame(baseFrame());
    setVisualState();
  }
  petStage.classList.remove("facing-left");
}

function scheduleWander(delay = 18_000 + Math.random() * 22_000) {
  clearTimeout(wanderTimer);
  if (!roamingEnabled || pet.sleeping) return;
  wanderTimer = setTimeout(wander, delay);
}

function scheduleNap(delay = 4 * 60_000 + Math.random() * 4 * 60_000) {
  clearTimeout(napTimer);
  if (pet.sleeping) return;
  napTimer = setTimeout(() => {
    if (pet.sleeping || dragging || reactionState) {
      scheduleNap(60_000);
      return;
    }
    toggleSleep();
  }, delay);
}

async function wander() {
  if (!roamingEnabled || pet.sleeping || dragging || reactionState) {
    scheduleWander(5000);
    return;
  }

  const { bounds, workArea } = await desktop.getDesktopState();
  const roomLeft = bounds.x - workArea.x;
  const roomRight = workArea.x + workArea.width - bounds.width - bounds.x;
  const preferredDirection =
    roomRight < 70 ? -1 : roomLeft < 70 ? 1 : Math.random() > 0.5 ? 1 : -1;
  const distance = Math.min(
    90 + Math.random() * 150,
    preferredDirection > 0 ? roomRight : roomLeft,
  );

  if (distance < 20) {
    scheduleWander(4000);
    return;
  }

  const finishWander = () => {
    stopWalking();
    if (Math.random() < 0.12) {
      scheduleNap(25_000);
    } else {
      scheduleWander();
    }
  };

  if (Math.random() < 0.22 && runJumpFrames.length >= 8) {
    playHop(finishWander);
    return;
  }

  const destination = bounds.x + distance * preferredDirection;
  const useRun = Math.random() < 0.55 && runJumpFrames.length >= RUN_COUNT;
  const duration = Math.max(useRun ? 1100 : 1800, distance * (useRun ? 10 : 15));
  const startedAt = Date.now();
  if (preferredDirection > 0) petStage.classList.add("facing-left");
  else petStage.classList.remove("facing-left");
  const gaitStep = preferredDirection > 0 ? -1 : 1;
  if (useRun) playRunCycle(gaitStep);
  else playWalkCycle(gaitStep);
  setVisualState(useRun ? "run" : "walk");

  clearInterval(walkTimer);
  walkTimer = setInterval(() => {
    const progress = Math.min(1, (Date.now() - startedAt) / duration);
    const eased = 0.5 - Math.cos(progress * Math.PI) / 2;
    desktop.moveTo(bounds.x + (destination - bounds.x) * eased, bounds.y);

    if (progress >= 1) finishWander();
  }, 50);
}

function beginDrag(event) {
  if (event.button !== 0 || !isOverBunny(event)) return;

  stopWalking();
  bunny.setPointerCapture(event.pointerId);
  dragging = {
    pointerId: event.pointerId,
    startX: event.screenX,
    startY: event.screenY,
    offsetX: null,
    offsetY: null,
    moved: false,
  };
  playWalkCycle();
  setVisualState("walk");

  desktop.getDesktopState().then(({ bounds }) => {
    if (!dragging || dragging.pointerId !== event.pointerId) return;
    dragging.offsetX = dragging.startX - bounds.x;
    dragging.offsetY = dragging.startY - bounds.y;
  });
}

function continueDrag(event) {
  if (!dragging || dragging.pointerId !== event.pointerId || dragging.offsetX === null) return;
  const distance = Math.hypot(event.screenX - dragging.startX, event.screenY - dragging.startY);
  dragging.moved ||= distance > 5;
  const travel = event.screenX - dragging.startX;
  if (Math.abs(travel) > 4) {
    petStage.classList.toggle("facing-left", travel > 0);
    playWalkCycle(travel > 0 ? -1 : 1);
  }
  desktop.moveTo(event.screenX - dragging.offsetX, event.screenY - dragging.offsetY);
}

function endDrag(event) {
  if (!dragging || dragging.pointerId !== event.pointerId) return;
  const wasMoved = dragging.moved;
  dragging = null;
  stopWalking();
  if (!wasMoved) petBunny();
  scheduleWander(7000);
}

function setClickThrough(ignore) {
  if (ignore === ignoreMouseEvents) return;
  ignoreMouseEvents = ignore;
  desktop.setClickThrough(ignore);
}

function runPetAction(action) {
  if (action === "feed") feedPet();
  if (action === "play") playWithPet();
  if (action === "sleep") toggleSleep();
  if (action === "turn") turnAround();
}

function remindFromCalendar(reminder) {
  const title = reminder?.title?.trim() || "your event";
  let message = `${ownerName()} 别忘了: ${title}`;
  if (reminder.phase === "today") message = `${ownerName()} 今天: ${title}`;
  if (reminder.phase === "soon") {
    message =
      reminder.minutes <= 1
        ? `${ownerName()} 等一下: ${title}`
        : `${ownerName()} ${reminder.minutes} 分钟后: ${title}`;
  }
  if (reminder.phase === "now") message = `${ownerName()} 到点了: ${title}`;
  if (pet.sleeping) message = `reminder: ${message}`;
  say(message, 5200);
}

launcher.addEventListener("click", async (event) => {
  const appId = event.target.closest("button")?.dataset.app;
  if (!appId) return;

  const { opened, label } = await desktop.openApp(appId);
  say(opened ? `${ownerName()}，帮你打开 ${label}` : `${ownerName()}，找不到 ${label}`);
});

roamButton.addEventListener("click", () => {
  desktop.setRoaming(!roamingEnabled);
  setRoaming(!roamingEnabled);
  say(
    roamingEnabled
      ? `${ownerName()} 我去${ownerPlace()}玩一圈`
      : `${ownerName()} 我不走了 困`,
  );
});

hideButton.addEventListener("click", () => {
  desktop.hide();
});

hideButton.addEventListener("pointerenter", () => {
  if (pet.facingBack) {
    showBunnyFrame("back");
    return;
  }
  clearTimeout(reactionTimer);
  clearInterval(sadFrameTimer);
  sadFrameTimer = null;
  stopWalking();
  reactionState = "hide-turn";
  playTurnAround(true, turnFrameTimer ? turnFrameIndex : 0);
});

hideButton.addEventListener("pointerleave", () => {
  if (pet.facingBack) {
    if (reactionState === "hide-turn") reactionState = null;
    showBunnyFrame("back");
    return;
  }
  if (reactionState && reactionState !== "hide-turn") {
    showBunnyFrame(baseFrame());
    return;
  }
  playTurnAround(false, turnFrameTimer ? turnFrameIndex : turnFrames.length - 1);
  reactionTimer = setTimeout(() => {
    if (reactionState === "hide-turn") {
      reactionState = null;
      showBunnyFrame(baseFrame());
    }
  }, turnFrames.length ? 1700 : 200);
});

bunny.addEventListener("pointerdown", beginDrag);
bunny.addEventListener("pointermove", continueDrag);
bunny.addEventListener("pointerup", endDrag);
bunny.addEventListener("pointercancel", endDrag);

// The launcher is hidden until the cursor is actually on Maodou's pixels, and a
// short grace period keeps it open while the cursor crosses the gap to reach it.
function setLauncherVisible(visible) {
  clearTimeout(launcherTimer);
  if (visible) {
    launcher.classList.add("visible");
  } else {
    launcherTimer = setTimeout(() => launcher.classList.remove("visible"), 400);
  }
}

window.addEventListener("mousemove", (event) => {
  const target = event.target;
  const overLauncher = target instanceof Element && Boolean(target.closest("#app-launcher"));
  const overBunny =
    target instanceof Element &&
    Boolean(target.closest("#bunny-image")) &&
    isOverBunny(event);

  setLauncherVisible(overBunny || overLauncher);
  setClickThrough(!(overBunny || overLauncher));
});

window.addEventListener("mouseleave", () => {
  setLauncherVisible(false);
  setClickThrough(true);
});
window.addEventListener("beforeunload", savePet);

desktop.onRoamingChanged((enabled) => setRoaming(enabled));
desktop.onPetAction((action) => runPetAction(action));
desktop.onCalendarReminder((reminder) => remindFromCalendar(reminder));

loadDefaultStanding();
loadBunnyArtwork("sad", "./assets/maodou-bunny-sad.jpg");
loadBunnyArtwork("happy", "./assets/maodou-bunny-happy.jpg");
loadBunnyArtwork("back", "./assets/maodou-bunny-back.jpg");
loadBunnyArtwork("right", "./assets/maodou-bunny-right.jpg");
loadBunnyArtwork("left", "./assets/maodou-bunny-left.jpg");
loadSheet("./assets/maodou-leg-swing-walk.png", walkFrames);
loadSheet("./assets/maodou-sad-transition-preview.png", sadFrames);
loadSheet("./assets/maodou-turn-around-preview.png", turnFrames, 10);
loadSheet("./assets/maodou-sleep-transition-preview.png", sleepFrames, 8, (frames) => {
  if (pet.sleeping && frames.length) {
    paintSheetFrame(frames, frames.length - 1, "sleep");
  }
});
loadSheet("./assets/maodou-run-jump-preview.png", runJumpFrames, 8, undefined, { preserveY: true });
showBunnyFrame(baseFrame());
setVisualState();
setClickThrough(true);
desktop.getDesktopState().then(({ roamingEnabled: enabled }) => setRoaming(enabled));
say(
  pet.sleeping
    ? `${ownerName()} 我还困 再睡一下`
    : `${ownerName()} 我是${PET_NAME} 刚从${ownerPlace()}回来`,
  2800,
);
if (!pet.sleeping) scheduleNap();
