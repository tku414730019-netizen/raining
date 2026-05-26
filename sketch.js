/* ═══════════════════════════════════════════════════════════════
   臺北市水利處雨量站即時監測｜sketch.js
   p5.js 1.9.x  ×  Fetch API  ×  Taipei City OpenData
   ─────────────────────────────────────────────────────────────
   Architecture:
     Constants & Config
     State Variables
     Demo Data
     fetchRainData()       — async API call with timeout + fallback
     parseAPIResponse()    — field normalization & anomaly filter
     applyFilterSort()     — search / sort / level filter pipeline
     computeStats()        — aggregate statistics
     Particle System       — rain drops + floating bubbles
     p5 sketch             — setup / draw / events
       drawLoadingScreen()
       drawDashboard()
         drawStationGrid()
           drawStationCard()
         drawParticles()
     DOM helpers           — tooltip, stat bar, countdown updates
     DOM event listeners
═══════════════════════════════════════════════════════════════ */

'use strict';

// ─────────────────────────────────────────────────────────────
//  CONSTANTS
// ─────────────────────────────────────────────────────────────
const API_URL =
  'https://wic.gov.taipei/OpenData/API/Rain/Get' +
  '?stationNo=&loginId=open_rain&dataKey=85452C1D';

const REFRESH_SEC  = 300;   // auto-refresh every 5 minutes
const API_TIMEOUT  = 10000; // 10 s fetch timeout
const GAUGE_MAX_MM = 30;    // full-bar = 30 mm
const CARD_MIN_W   = 192;
const CARD_H       = 130;
const CARD_PAD_X   = 16;
const CARD_PAD_Y   = 14;
const CARD_GAP     = 10;

// Rain level thresholds (mm per 10-min observation)
const THRESHOLDS = [
  { level:0, min:0,    max:0,    label:'無雨', emoji:'☁',  color:[144,184,200] },
  { level:1, min:0.01, max:1,    label:'微雨', emoji:'🌦', color:[ 56,189,248] },
  { level:2, min:1,    max:4,    label:'小雨', emoji:'🌧', color:[ 45,212,191] },
  { level:3, min:4,    max:10,   label:'中雨', emoji:'⛈', color:[250,204, 21] },
  { level:4, min:10,   max:20,   label:'大雨', emoji:'🌊', color:[249,115, 22] },
  { level:5, min:20,   max:9999, label:'豪雨', emoji:'🚨', color:[239, 68, 68] },
];

// Palette (matches CSS tokens — used inside p5 canvas only)
const PAL = {
  bg:         [238, 248, 248],
  cardBg:     [255, 255, 255],
  cardHov:    [240, 251, 250],
  border:     [197, 232, 230],
  borderHov:  [ 45, 212, 191],
  txt1:       [ 30,  58,  58],
  txt2:       [ 61, 106, 106],
  txt3:       [122, 171, 171],
  txt4:       [168, 200, 200],
  teal500:    [ 20, 184, 166],
  sky400:     [ 56, 189, 248],
  gaugeTrack: [204, 242, 240],
};

// ─────────────────────────────────────────────────────────────
//  STATE
// ─────────────────────────────────────────────────────────────
let stations        = [];   // all normalized station objects
let filteredStations= [];   // after search / sort / level filter
let displayRain     = {};   // { stationNo: animatedRainValue }
let cardBounds      = [];   // [{ x, y, w, h, idx }]
let hoveredCard     = -1;
let selectedCard    = -1;
let isLoading       = true;
let isLive          = false;
let apiError        = '';
let lastUpdateStr   = '—';
let countdown       = REFRESH_SEC;
let scrollY         = 0;    // current (lerped)
let targetScrollY   = 0;    // desired
let maxScrollY      = 0;
let activeLevelFilter = -1; // -1 = all
let searchQuery     = '';
let sortMode        = 'default';
let pulseT          = 0;    // global animation time

// Particles
let rainDrops = [];
let bubbles   = [];

// ─────────────────────────────────────────────────────────────
//  DEMO DATA  (used when API fails / CORS blocked)
// ─────────────────────────────────────────────────────────────
function getDemoData() {
  const t = currentTimeStr();
  return [
    { stationNo:'C0A9G0', stationName:'貴子坑', recTime:t, rain:18.2, count:27 },
    { stationNo:'C0A9H0', stationName:'百拉卡', recTime:t, rain:24.6, count:27 },
    { stationNo:'C0A9L1', stationName:'貓空',   recTime:t, rain:14.5, count:27 },
    { stationNo:'C0A9M0', stationName:'大安',   recTime:t, rain:0.4,  count:27 },
    { stationNo:'C0A9N0', stationName:'新生',   recTime:t, rain:0.0,  count:27 },
    { stationNo:'C0A9P0', stationName:'木柵',   recTime:t, rain:9.8,  count:27 },
    { stationNo:'C0A9Q0', stationName:'景美',   recTime:t, rain:7.2,  count:27 },
    { stationNo:'C0A9R0', stationName:'北投',   recTime:t, rain:21.0, count:27 },
    { stationNo:'C0A9S0', stationName:'士林',   recTime:t, rain:11.3, count:27 },
    { stationNo:'C0A9T0', stationName:'天母',   recTime:t, rain:5.5,  count:27 },
    { stationNo:'C0A9U0', stationName:'內湖',   recTime:t, rain:2.1,  count:27 },
    { stationNo:'C0A9V0', stationName:'南港',   recTime:t, rain:3.7,  count:27 },
    { stationNo:'C0A9W0', stationName:'信義',   recTime:t, rain:1.2,  count:27 },
    { stationNo:'C0A9X0', stationName:'松山',   recTime:t, rain:0.8,  count:27 },
    { stationNo:'C0A9Y0', stationName:'中山',   recTime:t, rain:0.0,  count:27 },
    { stationNo:'C0A9Z0', stationName:'中正',   recTime:t, rain:0.3,  count:27 },
    { stationNo:'C0A900', stationName:'萬華',   recTime:t, rain:0.0,  count:27 },
    { stationNo:'C0A901', stationName:'大同',   recTime:t, rain:0.6,  count:27 },
    { stationNo:'C0A902', stationName:'文山',   recTime:t, rain:16.8, count:27 },
    { stationNo:'C0A903', stationName:'指南宮', recTime:t, rain:19.4, count:27 },
    { stationNo:'C0A904', stationName:'陽明山', recTime:t, rain:28.2, count:27 },
    { stationNo:'C0A905', stationName:'竹子湖', recTime:t, rain:22.5, count:27 },
    { stationNo:'C0A906', stationName:'石碇',   recTime:t, rain:12.0, count:27 },
    { stationNo:'C0A907', stationName:'烏來',   recTime:t, rain:8.4,  count:27 },
    { stationNo:'C0A908', stationName:'汐止',   recTime:t, rain:4.6,  count:27 },
    { stationNo:'C0A909', stationName:'社子',   recTime:t, rain:1.8,  count:27 },
    { stationNo:'C0A910', stationName:'關渡',   recTime:t, rain:0.0,  count:27 },
  ];
}

function currentTimeStr() {
  const n = new Date();
  const p = x => String(x).padStart(2,'0');
  return `${n.getFullYear()}-${p(n.getMonth()+1)}-${p(n.getDate())} ` +
         `${p(n.getHours())}:${p(Math.floor(n.getMinutes()/10)*10)}:00`;
}

// ─────────────────────────────────────────────────────────────
//  DATA FETCH
// ─────────────────────────────────────────────────────────────
async function fetchRainData() {
  isLoading = true;
  apiError  = '';
  setRefreshBtnState(true);
  showLoadingOverlay(true);

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), API_TIMEOUT);

    const resp = await fetch(API_URL, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

    const raw    = await resp.json();
    const parsed = parseAPIResponse(raw);

    if (parsed.length === 0) throw new Error('API 回傳空陣列');

    stations     = parsed;
    isLive       = true;
    apiError     = '';
    lastUpdateStr = formatNow();
    console.info(`✅ 成功載入 ${stations.length} 個雨量站`);

  } catch (err) {
    console.warn('⚠️ API 失敗:', err.message, '→ 使用示範資料');
    stations     = parseAPIResponse(getDemoData());
    isLive       = false;
    apiError     = err.name === 'AbortError' ? '連線逾時（10s）' : err.message;
    lastUpdateStr = formatNow() + ' (DEMO)';

  } finally {
    isLoading  = false;
    countdown  = REFRESH_SEC;
    initDisplayRain();
    applyFilterSort();
    computeStats();
    updateDOMStats();
    updateStatusBadge();
    setRefreshBtnState(false);
    showLoadingOverlay(false);
    showErrorMsg(apiError);
    document.getElementById('last-update').textContent = lastUpdateStr;
  }
}

// ─────────────────────────────────────────────────────────────
//  PARSE & NORMALIZE
// ─────────────────────────────────────────────────────────────
function parseAPIResponse(raw) {
  if (!Array.isArray(raw)) return [];

  return raw
    .map(item => {
      const safeStr = v => (v != null) ? String(v).trim() : '';
      const safeNum = v => {
        const n = parseFloat(v);
        return (isNaN(n) || n < 0) ? 0 : n;
      };
      return {
        stationNo:   safeStr(item.stationNo),
        stationName: safeStr(item.stationName) || '未知站',
        recTime:     safeStr(item.recTime),
        rain:        Math.min(safeNum(item.rain), 500), // >500 = anomaly
        count:       parseInt(item.count) || 0,
      };
    })
    .filter(s => s.stationNo !== '');
}

// ─────────────────────────────────────────────────────────────
//  FILTER / SORT / SEARCH  PIPELINE
// ─────────────────────────────────────────────────────────────
function applyFilterSort() {
  let arr = [...stations];

  // 1. search query
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    arr = arr.filter(s =>
      s.stationName.includes(q) ||
      s.stationNo.toLowerCase().includes(q)
    );
  }

  // 2. level filter chip
  if (activeLevelFilter >= 0) {
    arr = arr.filter(s => getRainLevel(s.rain).level === activeLevelFilter);
  }

  // 3. sort
  switch (sortMode) {
    case 'rain-desc': arr.sort((a,b) => b.rain - a.rain); break;
    case 'rain-asc':  arr.sort((a,b) => a.rain - b.rain); break;
    case 'name':      arr.sort((a,b) => a.stationName.localeCompare(b.stationName,'zh-TW')); break;
    default: break; // keep API order
  }

  filteredStations = arr;
  // reset scroll when filter changes
  targetScrollY = 0;
}

// ─────────────────────────────────────────────────────────────
//  STATISTICS
// ─────────────────────────────────────────────────────────────
const stats = { total:0, raining:0, alert:0, avg:0, max:null };

function computeStats() {
  if (!stations.length) return;
  stats.total   = stations.length;
  stats.raining = stations.filter(s => s.rain > 0).length;
  stats.alert   = stations.filter(s => s.rain >= 10).length;
  stats.avg     = stations.reduce((s,x) => s + x.rain, 0) / stations.length;
  stats.max     = stations.reduce((m,x) => x.rain > m.rain ? x : m, stations[0]);
}

// ─────────────────────────────────────────────────────────────
//  HELPERS
// ─────────────────────────────────────────────────────────────
function getRainLevel(mm) {
  if (mm <= 0) return THRESHOLDS[0];
  for (const t of THRESHOLDS) {
    if (mm >= t.min && (mm < t.max || t.max === 9999)) return t;
  }
  return THRESHOLDS[0];
}

function lerpArr(a, b, t) {
  return [
    a[0] + (b[0]-a[0]) * t,
    a[1] + (b[1]-a[1]) * t,
    a[2] + (b[2]-a[2]) * t,
  ];
}

function formatNow() {
  const n = new Date();
  const p = x => String(x).padStart(2,'0');
  return `${p(n.getHours())}:${p(n.getMinutes())}:${p(n.getSeconds())}`;
}

function formatRecTime(rt) {
  if (!rt) return '—';
  const m = rt.match(/(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})/);
  return m ? `${m[1]} ${m[2]}` : rt;
}

/**
 * parseRecTime()
 * 將 API 的 recTime 字串（"YYYY-MM-DD HH:mm:ss"，台灣本地時間 UTC+8）
 * 轉為 Date 物件。
 * 加上 +08:00 後綴讓 Date.parse 正確解讀時區，避免被當 UTC 差 8 小時。
 */
function parseRecTime(rt) {
  if (!rt) return null;
  // 把空格換成 T，補上時區，讓 ISO 8601 解析正確
  const iso = rt.trim().replace(' ', 'T') + '+08:00';
  const d   = new Date(iso);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * timeAgo(rt)
 * 回傳人類可讀的時間差字串，例如：
 *   "剛剛"            ← < 1 分鐘
 *   "3 分鐘前"        ← 1–59 分鐘
 *   "1 小時 5 分前"   ← 60–119 分鐘
 *   "2 小時前"        ← ≥ 120 分鐘
 *   "資料可能異常"    ← > 60 分鐘（顯示警示色）
 * 同時也回傳 isStale 旗標供呼叫端決定顏色。
 */
function timeAgo(rt) {
  const d = parseRecTime(rt);
  if (!d) return { text: '—', isStale: false };

  const diffMs  = Date.now() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);

  let text, isStale;

  if (diffMin < 1) {
    text    = '剛剛';
    isStale = false;
  } else if (diffMin < 60) {
    text    = `${diffMin} 分鐘前`;
    isStale = diffMin > 30;  // 超過 30 分仍未更新 → 警示
  } else {
    const h = Math.floor(diffMin / 60);
    const m = diffMin % 60;
    text    = m > 0 ? `${h} 小時 ${m} 分前` : `${h} 小時前`;
    isStale = true;
  }

  return { text, isStale };
}

/**
 * formatTimeLabel(rt)
 * 卡片底部顯示用：「HH:mm · N 分鐘前」二合一格式
 * stale 時只顯示具體時間（讓使用者自行判斷）
 */
function formatTimeLabel(rt) {
  const timeStr = formatRecTime(rt).split(' ')[1] || '—'; // e.g. "14:30"
  const { text, isStale } = timeAgo(rt);
  return { timeStr, agoText: text, isStale };
}

function initDisplayRain() {
  stations.forEach(s => {
    if (displayRain[s.stationNo] === undefined) {
      displayRain[s.stationNo] = 0;
    }
  });
}

// ─────────────────────────────────────────────────────────────
//  PARTICLES
// ─────────────────────────────────────────────────────────────
function initParticles(W, H) {
  rainDrops = Array.from({ length: 140 }, () => ({
    x:     Math.random() * W,
    y:     Math.random() * H * 1.4 - H * 0.2,
    len:   5 + Math.random() * 18,
    spd:   4 + Math.random() * 8,
    alpha: 15 + Math.random() * 35,
    w:     0.5 + Math.random() * 0.8,
  }));

  bubbles = Array.from({ length: 18 }, () => ({
    x:   Math.random() * W,
    y:   Math.random() * H,
    r:   20 + Math.random() * 60,
    spd: 0.1 + Math.random() * 0.25,
    drift: (Math.random() - 0.5) * 0.3,
    alpha: 4 + Math.random() * 10,
    col: Math.random() < 0.6 ? [45,212,191] : [56,189,248],
  }));
}

// ─────────────────────────────────────────────────────────────
//  P5 SKETCH
// ─────────────────────────────────────────────────────────────
new p5(function(p) {

  // ── Canvas dimensions (tracks canvas-wrap element) ──────
  let CW, CH;

  function getCanvasSize() {
    const el = document.getElementById('canvas-wrap');
    return { w: el.clientWidth, h: el.clientHeight };
  }

  // ── setup ───────────────────────────────────────────────
  p.setup = function () {
    const { w, h } = getCanvasSize();
    CW = w; CH = h;
    const cnv = p.createCanvas(CW, CH);
    cnv.parent('canvas-wrap');
    p.frameRate(60);
    p.textFont('Noto Sans TC');
    initParticles(CW, CH);
    fetchRainData();
  };

  // ── draw ────────────────────────────────────────────────
  p.draw = function () {
    pulseT += 0.018;

    p.background(...PAL.bg);
    drawBubbles();
    drawRainDrops();

    if (isLoading) {
      drawLoadingScreen();
    } else {
      // smooth scroll lerp
      scrollY = p.lerp(scrollY, targetScrollY, 0.13);
      drawDashboard();
    }

    // ── countdown tick (once per second) ──
    if (p.frameCount % 60 === 0 && !isLoading) {
      countdown = Math.max(0, countdown - 1);
      updateCountdownDOM();
      if (countdown === 0) fetchRainData();
    }
  };

  // ────────────────────────────────────────────────────────
  //  LOADING SCREEN  (canvas-level, behind the overlay)
  // ────────────────────────────────────────────────────────
  function drawLoadingScreen() {
    // just keep particles animating under the HTML overlay
    // (see #loading-overlay in HTML)
  }

  // ────────────────────────────────────────────────────────
  //  DASHBOARD
  // ────────────────────────────────────────────────────────
  function drawDashboard() {
    if (!filteredStations.length) {
      drawEmptyState();
      return;
    }
    p.push();
    p.translate(0, -scrollY);
    drawStationGrid();
    p.pop();
    drawScrollFades();
  }

  // ────────────────────────────────────────────────────────
  //  STATION GRID
  // ────────────────────────────────────────────────────────
  function drawStationGrid() {
    const cols = Math.max(2, Math.floor(
      (CW - CARD_PAD_X * 2 + CARD_GAP) / (CARD_MIN_W + CARD_GAP)
    ));
    const cardW = Math.floor(
      (CW - CARD_PAD_X * 2 - CARD_GAP * (cols - 1)) / cols
    );
    const rows  = Math.ceil(filteredStations.length / cols);
    const totalGridH = rows * (CARD_H + CARD_GAP) + CARD_PAD_Y * 2;

    maxScrollY   = Math.max(0, totalGridH - CH);
    targetScrollY = Math.max(0, Math.min(targetScrollY, maxScrollY));

    cardBounds = [];

    filteredStations.forEach((s, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x   = CARD_PAD_X + col * (cardW + CARD_GAP);
      const y   = CARD_PAD_Y + row * (CARD_H  + CARD_GAP);
      cardBounds.push({ x, y, w: cardW, h: CARD_H, idx: i });
      drawStationCard(s, x, y, cardW, CARD_H, i);
    });
  }

  // ────────────────────────────────────────────────────────
  //  STATION CARD
  // ────────────────────────────────────────────────────────
  function drawStationCard(s, x, y, cw, ch, idx) {
    const actualRain = s.rain;
    const level      = getRainLevel(actualRain);
    const isHov      = idx === hoveredCard;
    const isSel      = idx === selectedCard;
    const lc         = level.color;           // shorthand

    // ── animate rain value toward target ──
    const prev = displayRain[s.stationNo] ?? 0;
    displayRain[s.stationNo] = p.lerp(prev, actualRain, 0.08);
    const animRain = displayRain[s.stationNo];

    // ── Drop shadow on hover / selected ──
    if (isHov || isSel) {
      p.noStroke();
      for (let g = 5; g > 0; g--) {
        p.fill(...lc, 8 * g);
        p.rect(x - g*2, y - g*2, cw + g*4, ch + g*4, 10);
      }
    }

    // ── Card body ──
    p.noStroke();
    p.fill(...(isSel ? [220, 248, 246] : isHov ? PAL.cardHov : PAL.cardBg));
    p.rect(x, y, cw, ch, 8);

    // ── Card border ──
    p.stroke(...lc, isHov || isSel ? 180 : 70);
    p.strokeWeight(1.5);
    p.noFill();
    p.rect(x, y, cw, ch, 8);
    p.noStroke();

    // ── Top accent stripe (gradient-like) ──
    const stripeH = 4;
    for (let bx = 0; bx < cw - 2; bx++) {
      const t = bx / (cw - 2);
      const col = lerpArr([197, 232, 230], lc, Math.pow(t, 0.5));
      p.stroke(...col, 255);
      p.strokeWeight(1);
      p.line(x + 1 + bx, y, x + 1 + bx, y + stripeH);
    }
    p.noStroke();

    // ── Station name ──
    p.textFont('Noto Sans TC, sans-serif');
    p.textSize(14);
    p.fill(...PAL.txt1);
    p.textAlign(p.LEFT, p.TOP);
    p.text(s.stationName, x + 12, y + 12);

    // ── Station code (hover/selected only) ──
    if (isHov || isSel) {
      p.textFont('Share Tech Mono, monospace');
      p.textSize(9);
      p.fill(...PAL.txt4);
      p.text(s.stationNo, x + 12, y + 30);
    }

    // ── Level badge ──
    const badgeW = 42;
    const badgeH = 20;
    const bx     = x + cw - badgeW - 10;
    const by     = y + 10;
    p.fill(...lc, 28);
    p.stroke(...lc, 120);
    p.strokeWeight(1);
    p.rect(bx, by, badgeW, badgeH, 4);
    p.noStroke();
    p.textFont('Noto Sans TC, sans-serif');
    p.textSize(10);
    p.fill(...lc);
    p.textAlign(p.CENTER, p.CENTER);
    p.text(level.label, bx + badgeW/2, by + badgeH/2);
    p.textAlign(p.LEFT);

    // ── Rain value ──
    p.textFont('Share Tech Mono, monospace');
    p.textAlign(p.RIGHT, p.BOTTOM);
    p.textSize(24);
    p.fill(...lc, 240);
    p.text(actualRain.toFixed(1), x + cw - 10, y + ch - 22);
    p.textSize(10);
    p.fill(...PAL.txt3);
    p.text('mm', x + cw - 10, y + ch - 10);
    p.textAlign(p.LEFT);

    // ── Gauge bar ──
    const gx     = x + 12;
    const gy     = y + ch - 34;
    const gw     = cw - 90;
    const gh     = 8;
    const ratio  = Math.min(animRain / GAUGE_MAX_MM, 1.0);

    // track
    p.fill(...PAL.gaugeTrack);
    p.rect(gx, gy, gw, gh, 4);

    // fill with gradient
    if (ratio > 0) {
      const fillW = Math.max(0, gw * ratio);
      // clip inner rect rounded corners workaround: draw pixel columns
      for (let bxi = 0; bxi < fillW; bxi++) {
        const t    = bxi / Math.max(1, fillW - 1);
        const col  = lerpArr([197, 232, 230], lc, t);
        const topY = (bxi < 4 || bxi > fillW - 5)
          ? gy + 1 : gy;    // faux rounded ends
        p.stroke(...col, 230);
        p.strokeWeight(1);
        p.line(gx + bxi, topY, gx + bxi, gy + gh - (topY - gy));
      }
      p.noStroke();

      // bright tip dot
      p.fill(...lc, 200);
      p.circle(gx + fillW, gy + gh / 2, gh + 2);
    }
    p.noStroke();

    // ── Time label：「HH:mm · N 分鐘前」，stale 時標橘色警示 ──
    const { timeStr, agoText, isStale } = formatTimeLabel(s.recTime);
    p.textFont('Share Tech Mono, monospace');
    p.noStroke();

    // 具體時間（左側）
    p.textSize(9);
    p.fill(...(isStale ? [249, 115, 22] : PAL.txt4));
    p.textAlign(p.LEFT, p.BOTTOM);
    p.text(timeStr, x + 12, y + ch - 8);

    // 時間差（緊接在後，稍淡）
    const _tw = p.textWidth(timeStr);
    p.fill(...(isStale ? [249, 115, 22, 180] : PAL.txt4), isStale ? 180 : 140);
    p.text(' · ' + agoText, x + 12 + _tw, y + ch - 8);

    // stale 驚嘆號圖示
    if (isStale) {
      p.textSize(9);
      p.fill(249, 115, 22, 200);
      p.textAlign(p.RIGHT, p.BOTTOM);
      p.text('⚠', x + cw - 10, y + ch - 8);
    }
    p.textAlign(p.LEFT);

    // ── Animated rain streaks for high-rain cards (hover only) ──
    if (actualRain >= 4 && isHov) {
      for (let ri = 0; ri < 6; ri++) {
        const phase = (pulseT * 2.5 + ri * 1.7) % 1;
        const rx    = x + 18 + ri * ((cw - 36) / 5);
        const ry    = y + 38 + phase * 30;
        const alpha = 140 * (1 - phase);
        p.stroke(...lc, alpha);
        p.strokeWeight(1.2);
        p.line(rx, ry, rx + 1, ry + 7);
        p.noStroke();
      }
    }
  }

  // ────────────────────────────────────────────────────────
  //  SCROLL EDGE FADES
  // ────────────────────────────────────────────────────────
  function drawScrollFades() {
    // top fade
    for (let i = 0; i < 20; i++) {
      p.noStroke();
      p.fill(...PAL.bg, p.map(i, 0, 20, 255, 0));
      p.rect(0, i, CW, 1);
    }
    // bottom fade
    for (let i = 0; i < 28; i++) {
      p.noStroke();
      p.fill(...PAL.bg, p.map(i, 0, 28, 0, 255));
      p.rect(0, CH - 28 + i, CW, 1);
    }
    // scroll position indicator (right edge thin bar)
    if (maxScrollY > 0) {
      const trackH = CH - 24;
      const thumbH = Math.max(30, trackH * (CH / (CH + maxScrollY)));
      const thumbY = p.map(scrollY, 0, maxScrollY, 0, trackH - thumbH);
      p.noStroke();
      p.fill(...PAL.border, 180);
      p.rect(CW - 4, 4, 3, trackH, 2);
      p.fill(...PAL.teal500, 180);
      p.rect(CW - 4, 4 + thumbY, 3, thumbH, 2);
    }
  }

  // ────────────────────────────────────────────────────────
  //  EMPTY STATE
  // ────────────────────────────────────────────────────────
  function drawEmptyState() {
    p.textAlign(p.CENTER, p.CENTER);
    p.textFont('Share Tech Mono, monospace');
    p.textSize(14);
    p.fill(...PAL.txt3);
    p.text('找不到符合條件的雨量站', CW/2, CH/2 - 14);
    p.textSize(11);
    p.fill(...PAL.txt4);
    p.text('請調整搜尋或篩選條件', CW/2, CH/2 + 12);
    p.textAlign(p.LEFT);
  }

  // ────────────────────────────────────────────────────────
  //  PARTICLES
  // ────────────────────────────────────────────────────────
  function drawRainDrops() {
    rainDrops.forEach(d => {
      p.stroke(56, 189, 248, d.alpha);
      p.strokeWeight(d.w);
      p.line(d.x, d.y, d.x + 1, d.y + d.len);
      d.y += d.spd;
      if (d.y > CH + d.len) {
        d.y = -d.len;
        d.x = Math.random() * CW;
      }
    });
    p.noStroke();
  }

  function drawBubbles() {
    p.noStroke();
    bubbles.forEach(b => {
      // soft radial gradient approximation
      for (let i = 4; i > 0; i--) {
        p.fill(...b.col, b.alpha * (i / 4));
        p.circle(b.x, b.y, b.r * (i / 4) * 2);
      }
      b.y  -= b.spd;
      b.x  += b.drift;
      if (b.y < -b.r) {
        b.y = CH + b.r;
        b.x = Math.random() * CW;
      }
    });
  }

  // ────────────────────────────────────────────────────────
  //  EVENTS
  // ────────────────────────────────────────────────────────
  p.mousePressed = function () {
    // card hit-test (adjust for canvas position + scroll)
    const canvasTop = document.getElementById('canvas-wrap').getBoundingClientRect().top;
    const mx = p.mouseX;
    const my = p.mouseY + scrollY;

    let hit = false;
    cardBounds.forEach((b, i) => {
      if (mx >= b.x && mx <= b.x + b.w && my >= b.y && my <= b.y + b.h) {
        selectedCard = (selectedCard === i) ? -1 : i;
        hit = true;
        if (selectedCard >= 0) updateTooltip(filteredStations[i], p.mouseX, p.mouseY);
        else                   hideTooltip();
      }
    });
    if (!hit) {
      selectedCard = -1;
      hideTooltip();
    }
  };

  p.mouseMoved = function () {
    const my = p.mouseY + scrollY;
    hoveredCard = -1;
    cardBounds.forEach((b, i) => {
      if (p.mouseX >= b.x && p.mouseX <= b.x + b.w && my >= b.y && my <= b.y + b.h) {
        hoveredCard = i;
      }
    });
    p.cursor(hoveredCard >= 0 ? p.HAND : p.ARROW);

    if (hoveredCard >= 0 && selectedCard < 0) {
      updateTooltip(filteredStations[hoveredCard], p.mouseX + 14, p.mouseY + 14);
    } else if (hoveredCard < 0 && selectedCard < 0) {
      hideTooltip();
    }
  };

  p.mouseWheel = function (e) {
    targetScrollY += e.delta * 0.8;
    targetScrollY = Math.max(0, Math.min(targetScrollY, maxScrollY));
    return false; // prevent page scroll
  };

  p.windowResized = function () {
    const { w, h } = getCanvasSize();
    CW = w; CH = h;
    p.resizeCanvas(CW, CH);
    initParticles(CW, CH);
  };
});

// ─────────────────────────────────────────────────────────────
//  DOM HELPERS
// ─────────────────────────────────────────────────────────────

// Tooltip
function updateTooltip(s, tx, ty) {
  if (!s) return;
  const lv = getRainLevel(s.rain);
  document.getElementById('tt-name').textContent  = s.stationName;
  document.getElementById('tt-no').textContent    = `站碼：${s.stationNo}`;
  document.getElementById('tt-rain').textContent  = `雨量：${s.rain.toFixed(1)} mm`;
  document.getElementById('tt-level').textContent = `等級：${lv.emoji} ${lv.label}`;
  document.getElementById('tt-level').style.color = `rgb(${lv.color.join(',')})`;
  const { text: _ago, isStale: _stale } = timeAgo(s.recTime);
  const _timeDisplay = `${formatRecTime(s.recTime)}  (${_ago})`;
  document.getElementById('tt-time').textContent  = `觀測：${_timeDisplay}`;
  document.getElementById('tt-time').style.color  = _stale ? '#f97316' : '';
  const el = document.getElementById('tooltip');
  el.classList.remove('hidden');
  const vw = window.innerWidth, vh = window.innerHeight;
  el.style.left = Math.min(tx, vw - 190) + 'px';
  el.style.top  = Math.min(ty, vh - 150) + 'px';
}
function hideTooltip() {
  document.getElementById('tooltip').classList.add('hidden');
}

// Stats bar
function updateDOMStats() {
  document.getElementById('stat-total').querySelector('.stat-val').textContent   = stats.total;
  document.getElementById('stat-raining').querySelector('.stat-val').textContent = stats.raining;
  document.getElementById('stat-alert').querySelector('.stat-val').textContent   = stats.alert;
  document.getElementById('stat-avg').querySelector('.stat-val').textContent     = stats.avg.toFixed(1) + ' mm';
  document.getElementById('stat-max').querySelector('.stat-val').textContent     = (stats.max?.rain ?? 0).toFixed(1) + ' mm';
  document.getElementById('stat-max-name').textContent = stats.max?.stationName ?? '—';
}

// Countdown
function updateCountdownDOM() {
  const el  = document.getElementById('countdown-val');
  const bar = document.getElementById('countdown-bar-fill');
  if (el)  el.textContent = countdown + 's';
  if (bar) {
    const pct = countdown / REFRESH_SEC * 100;
    bar.style.width = pct + '%';
    if (pct < 20) {
      bar.style.background = 'linear-gradient(90deg, #f97316, #ef4444)';
    } else {
      bar.style.background = 'linear-gradient(90deg, var(--teal-400), var(--sky-400))';
    }
  }
}

// Status badge
function updateStatusBadge() {
  const badge = document.getElementById('status-badge');
  if (isLive) {
    badge.textContent = '● LIVE';
    badge.className   = 'badge-live';
  } else {
    badge.textContent = '● DEMO';
    badge.className   = 'badge-demo';
  }
}

// Refresh button state
function setRefreshBtnState(loading) {
  const btn = document.getElementById('refresh-btn');
  if (loading) {
    btn.classList.add('loading');
    btn.textContent = '載入中…';
  } else {
    btn.classList.remove('loading');
    btn.textContent = '↺ 更新';
  }
}

// Loading overlay
function showLoadingOverlay(show) {
  let el = document.getElementById('loading-overlay');
  if (!el) {
    el = document.createElement('div');
    el.id = 'loading-overlay';
    el.innerHTML = `
      <div class="loader-ring"></div>
      <div class="loader-text">CONNECTING TO RAIN SENSOR NETWORK</div>
      <div class="loader-sub">臺北市水利處 API 連線中…</div>
    `;
    document.body.appendChild(el);
  }
  el.classList.toggle('hidden', !show);
}

// Error message
function showErrorMsg(msg) {
  const el = document.getElementById('error-msg');
  if (!el) return;
  if (msg) {
    el.textContent = '⚠ API: ' + msg.substring(0, 40);
    el.classList.remove('hidden');
  } else {
    el.classList.add('hidden');
  }
}

// ─────────────────────────────────────────────────────────────
//  DOM EVENT LISTENERS
// ─────────────────────────────────────────────────────────────

// Search
document.getElementById('search-input').addEventListener('input', function () {
  searchQuery = this.value.trim();
  applyFilterSort();
});

// Sort
document.getElementById('sort-select').addEventListener('change', function () {
  sortMode = this.value;
  applyFilterSort();
});

// Refresh button
document.getElementById('refresh-btn').addEventListener('click', function () {
  if (isLoading) return;
  fetchRainData();
});

// Level filter chips
document.querySelectorAll('.chip').forEach(btn => {
  btn.addEventListener('click', function () {
    document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
    this.classList.add('active');
    activeLevelFilter = parseInt(this.dataset.level);
    applyFilterSort();
  });
});
