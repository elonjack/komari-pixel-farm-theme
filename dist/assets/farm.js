(() => {
  "use strict";

  const API = Object.freeze({ public: "/api/public", nodes: "/api/nodes", recent: "/api/recent/", ping: "/api/records/ping" });
  const REFRESH_MIN_SECONDS = 15;
  const REFRESH_MAX_SECONDS = 300;
  const REQUEST_TIMEOUT_MS = 10000;
  const RECENT_CONCURRENCY = 6;
  const PING_CONCURRENCY = 3;
  const PING_LOOKBACK_HOURS = 1;
  const STALE_AFTER_MS = 150000;
  const UUID_PATTERN = /^[A-Za-z0-9-]{1,128}$/;

  const elements = {
    farmTitle: document.getElementById("farm-title"),
    farmGrid: document.getElementById("farm-grid"),
    summary: document.getElementById("farm-summary"),
    plotCount: document.getElementById("plot-count"),
    updated: document.getElementById("last-updated"),
    refresh: document.getElementById("refresh-button"),
    empty: document.getElementById("empty-state"),
    emptyRefresh: document.getElementById("empty-refresh-button"),
    hint: document.getElementById("status-hint"),
    dialog: document.getElementById("node-dialog"),
    closeDialog: document.getElementById("close-dialog"),
    dialogTitle: document.getElementById("dialog-title"),
    dialogSubtitle: document.getElementById("dialog-subtitle"),
    dialogHealth: document.getElementById("dialog-health"),
    facts: document.getElementById("node-facts"),
    bars: document.getElementById("resource-bars"),
    freshness: document.getElementById("node-freshness"),
    pingTasks: document.getElementById("ping-tasks")
  };

  const farmMap = document.getElementById("farm-map");
  const sceneButtons = Array.from(document.querySelectorAll(".scene-button"));
  const weatherControls = document.getElementById("weather-controls");
  const weatherLabel = document.getElementById("weather-label");
  const SCENE_STORAGE_KEY = "komari-pixel-farm-scene-v2";
  const SCENE_SEASONS = new Set(["spring", "summer", "autumn", "winter"]);
  const SCENE_TIMES = new Set(["day", "night"]);
  const RAIN_LEVELS = new Set(["none", "light", "medium", "heavy", "storm"]);
  const SNOW_LEVELS = new Set(["none", "light", "medium", "heavy", "blizzard"]);
  const WEATHER_LABELS = Object.freeze({ none: "晴朗", light: "小", medium: "中", heavy: "大", storm: "暴雨", blizzard: "暴雪" });

  const state = { nodes: [], snapshots: new Map(), pings: new Map(), settings: {}, loading: false, timer: null, lastLoaded: null };

  function readScenePreference() {
    try {
      const saved = JSON.parse(window.localStorage.getItem(SCENE_STORAGE_KEY) || "{}");
      return {
        season: SCENE_SEASONS.has(saved?.season) ? saved.season : "summer",
        time: SCENE_TIMES.has(saved?.time) ? saved.time : "day",
        weather: RAIN_LEVELS.has(saved?.weather) || SNOW_LEVELS.has(saved?.weather) ? saved.weather : "none"
      };
    } catch { return { season: "summer", time: "day", weather: "none" }; }
  }

  function weatherKind(season) { return season === "winter" ? "snow" : "rain"; }

  function allowedWeather(season, level) {
    const levels = weatherKind(season) === "snow" ? SNOW_LEVELS : RAIN_LEVELS;
    return levels.has(level) ? level : "none";
  }

  function renderWeatherButtons(scene) {
    if (!weatherControls || !weatherLabel) return;
    const kind = weatherKind(scene.season);
    const levels = kind === "snow"
      ? [["none", "无雪"], ["light", "小雪"], ["medium", "中雪"], ["heavy", "大雪"], ["blizzard", "暴雪"]]
      : [["none", "晴朗"], ["light", "小雨"], ["medium", "中雨"], ["heavy", "大雨"], ["storm", "暴雨"]];
    weatherLabel.textContent = kind === "snow" ? "降雪" : "降雨";
    const fragment = document.createDocumentFragment();
    fragment.appendChild(weatherLabel);
    for (const [level, label] of levels) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "scene-button weather-button";
      button.dataset.weather = level;
      button.textContent = label;
      const active = scene.weather === level;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
      button.addEventListener("click", () => applyScene({ ...readScenePreference(), weather: level }));
      fragment.appendChild(button);
    }
    weatherControls.replaceChildren(fragment);
  }

  function applyScene(scene, persist = true) {
    if (!farmMap) return;
    const next = {
      season: SCENE_SEASONS.has(scene?.season) ? scene.season : "summer",
      time: SCENE_TIMES.has(scene?.time) ? scene.time : "day",
      weather: allowedWeather(SCENE_SEASONS.has(scene?.season) ? scene.season : "summer", scene?.weather)
    };
    farmMap.dataset.season = next.season;
    farmMap.dataset.time = next.time;
    farmMap.dataset.weather = next.weather;
    farmMap.dataset.weatherKind = weatherKind(next.season);
    for (const button of sceneButtons) {
      const key = button.dataset.season ? "season" : "time";
      const active = button.dataset[key] === next[key];
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    }
    if (persist) {
      try { window.localStorage.setItem(SCENE_STORAGE_KEY, JSON.stringify(next)); } catch { /* Scene preferences are optional. */ }
    }
    renderWeatherButtons(next);
  }

  function seeded(seed) {
    let value = seed >>> 0;
    return () => {
      value += 0x6d2b79f5;
      let result = value;
      result = Math.imul(result ^ (result >>> 15), result | 1);
      result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
      return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Draw an original low-resolution tile map, then let the browser scale it without smoothing.
  // Keeping the map procedural means it remains responsive and doesn't copy any game tilesheet.
  function renderFarmMap() {
    const canvas = elements.farmCanvas;
    if (!canvas || !canvas.clientWidth || !canvas.clientHeight) return;
    const width = 240;
    const height = Math.max(148, Math.round((canvas.clientHeight / canvas.clientWidth) * width));
    if (canvas.width === width && canvas.height === height) return;
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) return;
    context.imageSmoothingEnabled = false;
    const random = seeded(width * 131 + height * 17);
    context.fillStyle = "#78a94b";
    context.fillRect(0, 0, width, height);

    // Grass texture: intentionally sparse, fixed-size pixel clusters.
    for (let index = 0; index < 1200; index += 1) {
      const x = Math.floor(random() * width);
      const y = Math.floor(random() * height);
      context.fillStyle = random() > .58 ? "#95bd5a" : "#5d9149";
      context.fillRect(x, y, random() > .82 ? 2 : 1, 1);
    }

    // Irregular stream and stone edging, all on a common 1px logical grid.
    const riverX = (y) => 204 + Math.floor(Math.sin(y / 13) * 6) + Math.floor(Math.sin(y / 5) * 2);
    for (let y = 0; y < height; y += 1) {
      const x = riverX(y);
      context.fillStyle = "#487d88";
      context.fillRect(x - 8, y, 19, 1);
      context.fillStyle = "#73b8c2";
      context.fillRect(x - 6, y, 15, 1);
      if (y % 4 === 0) { context.fillStyle = "#c3e4d4"; context.fillRect(x - 3 + Math.floor(random() * 7), y, 3, 1); }
      if (y % 3 === 0) {
        context.fillStyle = "#697064";
        context.fillRect(x - 10, y, 2, 2);
        context.fillRect(x + 11, y, 2, 2);
      }
    }

    // Two dirt paths with staggered pebble highlights.
    const path = (x, y, w, h) => {
      context.fillStyle = "#bd8b58";
      context.fillRect(x, y, w, h);
      for (let row = y + 2; row < y + h; row += 5) {
        context.fillStyle = "#d9b67a";
        context.fillRect(x + 2 + ((row * 7) % Math.max(4, w - 5)), row, 3, 1);
      }
    };
    path(9, 28, 184, 8);
    path(29, 31, 9, height - 35);
    path(38, height - 25, 158, 8);

    function fence(x, y, length, vertical = false) {
      context.fillStyle = "#563d2b";
      for (let offset = 0; offset < length; offset += 7) {
        const px = vertical ? x : x + offset;
        const py = vertical ? y + offset : y;
        context.fillRect(px, py, vertical ? 2 : 3, vertical ? 3 : 2);
        context.fillStyle = "#8f6139";
        context.fillRect(vertical ? px : px + 1, vertical ? py + 1 : py, 1, 1);
        context.fillStyle = "#563d2b";
      }
      context.fillRect(x, y + (vertical ? 0 : 1), vertical ? 2 : length, vertical ? length : 1);
    }
    fence(7, 19, 182); fence(7, 19, 92, true); fence(189, 19, 62, true);
    fence(43, height - 14, 151); fence(43, height - 41, 151);

    function tree(x, y, size) {
      context.fillStyle = "#4d422f";
      context.fillRect(x + Math.floor(size / 2) - 2, y + size - 5, 4, 7);
      context.fillStyle = "#275d43";
      context.fillRect(x + 2, y + 5, size - 4, size - 8);
      context.fillStyle = "#377849";
      context.fillRect(x, y + 8, size - 3, size - 11);
      context.fillStyle = "#5b9650";
      context.fillRect(x + 3, y + 3, size - 8, size - 13);
      context.fillStyle = "#9fc95c";
      context.fillRect(x + 5, y + 5, Math.max(2, size - 13), 3);
    }
    [[4, 3, 16], [20, 5, 13], [43, 1, 17], [63, 6, 12], [215, 3, 18], [226, 16, 15], [214, 64, 18], [220, 91, 15], [4, 88, 17], [14, 112, 13], [4, 132, 18]].forEach(([x, y, size]) => tree(x, y, size));

    // An original barn silhouette gives the map a farm anchor, without using any game artwork.
    context.fillStyle = "#573a31";
    context.fillRect(153, 6, 29, 19);
    context.fillStyle = "#a54f3c";
    context.fillRect(155, 10, 25, 15);
    context.fillStyle = "#d17b4d";
    context.fillRect(158, 13, 8, 12);
    context.fillStyle = "#e7c16c";
    context.fillRect(169, 14, 2, 11);
    context.fillStyle = "#354c4d";
    context.fillRect(151, 4, 33, 6);
    context.fillStyle = "#edf0b1";
    context.fillRect(166, 7, 4, 3);

    // Small flowers, rocks, and a footbridge make the ground feel lived-in.
    for (let index = 0; index < 74; index += 1) {
      const x = Math.floor(random() * 198);
      const y = 39 + Math.floor(random() * Math.max(1, height - 48));
      if (x > 36 && x < 192 && y > height - 44) continue;
      context.fillStyle = index % 3 === 0 ? "#f2d77a" : index % 3 === 1 ? "#f0a7bd" : "#e7eef2";
      context.fillRect(x, y, 1, 1);
      if (index % 4 === 0) { context.fillStyle = "#3d7143"; context.fillRect(x + 1, y + 1, 1, 2); }
    }
    context.fillStyle = "#6b4930";
    context.fillRect(194, height - 29, 22, 5);
    context.fillStyle = "#c68a4e";
    for (let x = 196; x < 214; x += 4) context.fillRect(x, height - 28, 2, 3);
  }

  function asText(value, fallback = "—") {
    if (typeof value !== "string") return fallback;
    const normalized = value.replace(/[\u0000-\u001f\u007f]/g, " ").trim();
    return normalized || fallback;
  }

  function asFiniteNumber(value, fallback = 0) {
    const number = typeof value === "number" ? value : Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function safePercent(value) { return Math.max(0, Math.min(100, asFiniteNumber(value))); }

  function formatBytes(value) {
    const bytes = asFiniteNumber(value, -1);
    if (bytes < 0) return "—";
    const units = ["B", "KB", "MB", "GB", "TB", "PB"];
    let amount = bytes;
    let unit = 0;
    while (amount >= 1024 && unit < units.length - 1) { amount /= 1024; unit += 1; }
    return `${amount >= 100 || unit === 0 ? amount.toFixed(0) : amount.toFixed(1)} ${units[unit]}`;
  }

  function formatSpeed(value) { return `${formatBytes(value)}/s`; }

  function formatUptime(value) {
    const seconds = Math.max(0, Math.floor(asFiniteNumber(value)));
    if (!seconds) return "—";
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    return days ? `${days} 天 ${hours} 小时` : `${hours} 小时`;
  }

  function parseDate(value) {
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) ? timestamp : null;
  }

  function relativeTime(timestamp) {
    if (!timestamp) return "无有效更新时间";
    const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
    if (seconds < 10) return "刚刚更新";
    if (seconds < 60) return `${seconds} 秒前更新`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes} 分钟前更新`;
    return `${Math.floor(minutes / 60)} 小时前更新`;
  }

  async function fetchJson(path) {
    // All requests are same-origin and use a fixed route prefix: no user-controlled URL is fetched.
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(path, { credentials: "same-origin", headers: { Accept: "application/json" }, signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      if (!payload || payload.status !== "success") throw new Error("Komari API returned an unsuccessful response");
      return payload.data;
    } finally {
      window.clearTimeout(timeout);
    }
  }

  function normalizeNode(raw) {
    if (!raw || typeof raw !== "object" || !UUID_PATTERN.test(raw.uuid || "")) return null;
    return {
      uuid: raw.uuid,
      name: asText(raw.name, "未命名田地"),
      group: asText(raw.group, "未分组"),
      region: asText(raw.region, "未知地区"),
      os: asText(raw.os),
      arch: asText(raw.arch),
      cpuName: asText(raw.cpu_name),
      cores: Math.max(0, Math.floor(asFiniteNumber(raw.cpu_cores))),
      memTotal: Math.max(0, asFiniteNumber(raw.mem_total)),
      diskTotal: Math.max(0, asFiniteNumber(raw.disk_total)),
      trafficLimit: Math.max(0, asFiniteNumber(raw.traffic_limit))
    };
  }

  function normalizeSnapshot(raw) {
    if (!raw || typeof raw !== "object") return null;
    const timestamp = parseDate(raw.updated_at);
    return {
      cpu: safePercent(raw.cpu?.usage),
      memoryUsed: Math.max(0, asFiniteNumber(raw.ram?.used)),
      memoryTotal: Math.max(0, asFiniteNumber(raw.ram?.total)),
      diskUsed: Math.max(0, asFiniteNumber(raw.disk?.used)),
      diskTotal: Math.max(0, asFiniteNumber(raw.disk?.total)),
      networkUp: Math.max(0, asFiniteNumber(raw.network?.up)),
      networkDown: Math.max(0, asFiniteNumber(raw.network?.down)),
      uptime: Math.max(0, asFiniteNumber(raw.uptime)),
      load: Math.max(0, asFiniteNumber(raw.load?.load1)),
      process: Math.max(0, Math.floor(asFiniteNumber(raw.process))),
      message: asText(raw.message, ""),
      timestamp
    };
  }

  function optionalNumber(value) {
    const number = typeof value === "number" ? value : Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function normalizePing(raw) {
    if (!raw || typeof raw !== "object" || !Array.isArray(raw.tasks)) return { tasks: [], primary: null };
    const tasks = raw.tasks.map((task) => {
      if (!task || typeof task !== "object") return null;
      return {
        id: optionalNumber(task.id),
        name: asText(task.name, "未命名检测点"),
        type: asText(task.type, "icmp"),
        defaultOn: task.default_on === true,
        loss: optionalNumber(task.loss),
        min: optionalNumber(task.min),
        max: optionalNumber(task.max),
        avg: optionalNumber(task.avg),
        total: optionalNumber(task.total)
      };
    }).filter(Boolean);
    return { tasks, primary: tasks.find((task) => task.defaultOn) || tasks[0] || null };
  }

  function countryLabel(region) {
    const source = asText(region, "未知地区");
    const flagPoints = Array.from(source).map((character) => character.codePointAt(0));
    const flagCode = flagPoints.length === 2 && flagPoints.every((point) => point >= 0x1f1e6 && point <= 0x1f1ff)
      ? String.fromCharCode(...flagPoints.map((point) => point - 0x1f1e6 + 65))
      : "";
    const code = flagCode || source.toUpperCase();
    if (/^[A-Z]{2}$/.test(code) && typeof Intl.DisplayNames === "function") {
      try { return `${source} · ${new Intl.DisplayNames(["zh-CN"], { type: "region" }).of(code) || code}`; } catch { return source; }
    }
    return source;
  }

  function formatMilliseconds(value) { return value === null ? "—" : `${Math.round(value)} ms`; }

  function formatLoss(value) { return value === null ? "—" : `${Math.max(0, value).toFixed(value % 1 ? 1 : 0)}%`; }

  function pingHeadline(ping) {
    if (!ping?.primary) return "Ping 未配置";
    return `${ping.primary.name} · ${formatMilliseconds(ping.primary.avg)} · 丢包 ${formatLoss(ping.primary.loss)}`;
  }

  function ratioPercent(used, total) { return total > 0 ? safePercent((used / total) * 100) : 0; }

  function getHealth(snapshot, ping) {
    if (!snapshot || !snapshot.timestamp || Date.now() - snapshot.timestamp > STALE_AFTER_MS) {
      return { key: "unknown", label: "休耕 · 状态待更新", explanation: "尚未取得最近 2 分半钟内的有效状态；这不一定代表节点离线。" };
    }
    const memory = ratioPercent(snapshot.memoryUsed, snapshot.memoryTotal);
    const disk = ratioPercent(snapshot.diskUsed, snapshot.diskTotal);
    const peak = Math.max(snapshot.cpu, memory, disk);
    const primary = ping?.primary;
    if (primary && ((primary.loss !== null && primary.loss >= 10) || (primary.avg !== null && primary.avg >= 500))) {
      return { key: "alert", label: "警讯 · 链路异常", explanation: "Ping 丢包率达到 10%，或平均延迟达到 500 ms。" };
    }
    if (primary && ((primary.loss !== null && primary.loss > 0) || (primary.avg !== null && primary.avg >= 200))) {
      return { key: "watch", label: "缺水 · 链路留意", explanation: "Ping 出现丢包，或平均延迟达到 200 ms。" };
    }
    if (peak >= 90) return { key: "alert", label: "警讯 · 需要查看", explanation: "CPU、内存或磁盘使用率至少有一项达到 90%。" };
    if (peak >= 70) return { key: "watch", label: "缺水 · 请留意", explanation: "CPU、内存或磁盘使用率至少有一项达到 70%。" };
    return { key: "healthy", label: "茁壮 · 状态良好", explanation: "最近状态正常，CPU、内存和磁盘使用率均低于 70%。" };
  }

  function cropFor(uuid) {
    let hash = 0;
    for (const char of uuid) hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0;
    return ["turnip", "tomato", "blueberry", "corn"][Math.abs(hash) % 4];
  }

  function createTextElement(tag, className, value) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    element.textContent = value;
    return element;
  }

  function renderSummary() {
    const totals = { healthy: 0, watch: 0, alert: 0, unknown: 0 };
    state.nodes.forEach((node) => { totals[getHealth(state.snapshots.get(node.uuid), state.pings.get(node.uuid)).key] += 1; });
    elements.summary.replaceChildren(
      summaryItem("田地", state.nodes.length),
      summaryItem("茁壮", totals.healthy),
      summaryItem("留意", totals.watch + totals.alert),
      summaryItem("待更新", totals.unknown)
    );
  }

  function summaryItem(label, value) {
    const item = document.createElement("div");
    item.className = "summary-item";
    item.append(createTextElement("span", "summary-number", String(value)), createTextElement("span", "summary-label", label));
    return item;
  }

  function renderPlots() {
    const fragment = document.createDocumentFragment();
    for (const node of state.nodes) {
      const snapshot = state.snapshots.get(node.uuid);
      const ping = state.pings.get(node.uuid);
      const health = getHealth(snapshot, ping);
      const card = document.createElement("article");
      card.className = `plot-card status-${health.key}`;
      const badge = createTextElement("span", "health-badge", "");
      badge.setAttribute("aria-label", health.label);
      badge.title = health.label;
      const sign = document.createElement("button");
      sign.type = "button";
      sign.className = "plot-sign";
      sign.setAttribute("aria-label", `查看 ${node.name} 的服务器详情，${health.label}`);
      sign.addEventListener("click", () => openNode(node.uuid));
      sign.append(createTextElement("span", "plot-name", node.name));
      card.append(badge, sign);
      fragment.appendChild(card);
    }
    elements.farmGrid.replaceChildren(fragment);
    elements.farmGrid.setAttribute("aria-busy", "false");
    elements.plotCount.textContent = `共 ${state.nodes.length} 块田地`;
    elements.empty.hidden = state.nodes.length > 0;
  }

  function fact(label, value) {
    const container = document.createElement("div");
    container.append(createTextElement("dt", "", label), createTextElement("dd", "", value));
    return container;
  }

  function meter(name, percent, detail) {
    const row = document.createElement("div");
    row.className = "resource-row";
    const bar = document.createElement("span");
    bar.className = "meter";
    const fill = document.createElement("span");
    const value = safePercent(percent);
    fill.style.width = `${value}%`;
    if (value >= 90) fill.className = "alert";
    else if (value >= 70) fill.className = "watch";
    bar.appendChild(fill);
    row.append(createTextElement("span", "", name), bar, createTextElement("strong", "", detail));
    return row;
  }

  function renderPingTasks(ping) {
    if (!ping?.tasks?.length) {
      elements.pingTasks.replaceChildren(createTextElement("p", "ping-empty", "此节点没有可展示的 Ping 检测记录。请在 Komari 后台配置并启用 Ping 任务。"));
      return;
    }
    const fragment = document.createDocumentFragment();
    for (const task of ping.tasks) {
      const row = document.createElement("article");
      row.className = "ping-task";
      const title = document.createElement("div");
      title.className = "ping-task-title";
      title.append(createTextElement("strong", "", task.name), createTextElement("span", "", task.type.toUpperCase()));
      const stats = document.createElement("div");
      stats.className = "ping-stats";
      stats.append(
        pingStat("平均", formatMilliseconds(task.avg)),
        pingStat("最低", formatMilliseconds(task.min)),
        pingStat("最高", formatMilliseconds(task.max)),
        pingStat("丢包", formatLoss(task.loss), task.loss !== null && task.loss > 0 ? "loss" : "")
      );
      row.append(title, stats);
      fragment.appendChild(row);
    }
    elements.pingTasks.replaceChildren(fragment);
  }

  function pingStat(label, value, extraClass = "") {
    const stat = document.createElement("span");
    if (extraClass) stat.className = extraClass;
    stat.append(createTextElement("small", "", label), createTextElement("strong", "", value));
    return stat;
  }

  function openNode(uuid) {
    const node = state.nodes.find((entry) => entry.uuid === uuid);
    if (!node) return;
    const snapshot = state.snapshots.get(uuid);
    const ping = state.pings.get(uuid);
    const health = getHealth(snapshot, ping);
    elements.dialogTitle.textContent = node.name;
    elements.dialogSubtitle.textContent = `${countryLabel(node.region)} · ${node.group} · ${node.os}`;
    elements.dialogHealth.className = `health-banner status-${health.key}`;
    elements.dialogHealth.textContent = `${health.label}：${health.explanation}`;
    renderPingTasks(ping);
    elements.facts.replaceChildren(
      fact("系统", `${node.os} (${node.arch})`),
      fact("处理器", node.cpuName),
      fact("逻辑核心", node.cores ? String(node.cores) : "—"),
      fact("总内存", formatBytes(node.memTotal)),
      fact("总磁盘", formatBytes(node.diskTotal)),
      fact("运行时间", snapshot ? formatUptime(snapshot.uptime) : "—"),
      fact("1 分钟负载", snapshot ? snapshot.load.toFixed(2) : "—"),
      fact("进程数", snapshot ? String(snapshot.process) : "—")
    );
    if (snapshot) {
      const memory = ratioPercent(snapshot.memoryUsed, snapshot.memoryTotal);
      const disk = ratioPercent(snapshot.diskUsed, snapshot.diskTotal);
      elements.bars.replaceChildren(
        meter("CPU", snapshot.cpu, `${snapshot.cpu.toFixed(1)}%`),
        meter("内存", memory, `${formatBytes(snapshot.memoryUsed)} / ${formatBytes(snapshot.memoryTotal)}`),
        meter("磁盘", disk, `${formatBytes(snapshot.diskUsed)} / ${formatBytes(snapshot.diskTotal)}`),
        meter("下行", 0, formatSpeed(snapshot.networkDown)),
        meter("上行", 0, formatSpeed(snapshot.networkUp))
      );
      elements.freshness.textContent = `${relativeTime(snapshot.timestamp)}。网络速度不参与健康评级；它们仅用于展示。`;
    } else {
      elements.bars.replaceChildren(createTextElement("p", "freshness", "还没有可用的实时状态数据。"));
      elements.freshness.textContent = "节点基础信息仍可显示；请稍后刷新以读取最新状态。";
    }
    if (!elements.dialog.open) elements.dialog.showModal();
  }

  async function mapWithConcurrency(items, limit, task) {
    const results = new Array(items.length);
    let nextIndex = 0;
    async function worker() {
      while (nextIndex < items.length) {
        const current = nextIndex++;
        try { results[current] = await task(items[current]); } catch { results[current] = null; }
      }
    }
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
    return results;
  }

  function setLoading(loading) {
    state.loading = loading;
    elements.refresh.disabled = loading;
    elements.refresh.textContent = loading ? "巡田中…" : "巡田刷新";
    elements.farmGrid.setAttribute("aria-busy", String(loading));
  }

  function getRefreshSeconds(settings) {
    const configured = Math.floor(asFiniteNumber(settings.refresh_seconds, 30));
    return Math.max(REFRESH_MIN_SECONDS, Math.min(REFRESH_MAX_SECONDS, configured));
  }

  function scheduleRefresh() {
    window.clearInterval(state.timer);
    state.timer = window.setInterval(() => { if (!state.loading) loadFarm(false); }, getRefreshSeconds(state.settings) * 1000);
  }

  async function loadFarm(manual) {
    if (state.loading) return;
    setLoading(true);
    try {
      const publicData = await fetchJson(API.public).catch(() => ({}));
      state.settings = publicData?.theme_settings && typeof publicData.theme_settings === "object" ? publicData.theme_settings : {};
      elements.farmTitle.textContent = asText(state.settings.farm_name, "云端田野");
      elements.hint.hidden = state.settings.show_status_hint === false;
      const rawNodes = await fetchJson(API.nodes);
      state.nodes = Array.isArray(rawNodes) ? rawNodes.map(normalizeNode).filter(Boolean) : [];
      const snapshots = await mapWithConcurrency(state.nodes, RECENT_CONCURRENCY, async (node) => {
        const data = await fetchJson(`${API.recent}${encodeURIComponent(node.uuid)}`);
        return Array.isArray(data) && data.length ? normalizeSnapshot(data[data.length - 1]) : null;
      });
      state.snapshots = new Map(state.nodes.map((node, index) => [node.uuid, snapshots[index]]));
      const pings = await mapWithConcurrency(state.nodes, PING_CONCURRENCY, async (node) => {
        const query = new URLSearchParams({ uuid: node.uuid, hours: String(PING_LOOKBACK_HOURS) });
        return normalizePing(await fetchJson(`${API.ping}?${query.toString()}`));
      });
      state.pings = new Map(state.nodes.map((node, index) => [node.uuid, pings[index] || { tasks: [], primary: null }]));
      state.lastLoaded = Date.now();
      renderSummary();
      renderPlots();
      elements.updated.textContent = `最近巡田：${new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date())}`;
      scheduleRefresh();
    } catch (error) {
      state.nodes = [];
      state.snapshots = new Map();
      state.pings = new Map();
      renderSummary();
      renderPlots();
      elements.updated.textContent = manual ? "巡田失败，请检查站点连接后重试" : "暂时无法读取监控数据";
      console.warn("Pixel Farm failed to load Komari monitoring data.", error);
    } finally {
      setLoading(false);
    }
  }

  elements.refresh.addEventListener("click", () => loadFarm(true));
  elements.emptyRefresh.addEventListener("click", () => loadFarm(true));
  sceneButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const current = readScenePreference();
      if (button.dataset.season) current.season = button.dataset.season;
      if (button.dataset.time) current.time = button.dataset.time;
      applyScene(current);
    });
  });
  elements.closeDialog.addEventListener("click", () => elements.dialog.close());
  elements.dialog.addEventListener("click", (event) => { if (event.target === elements.dialog) elements.dialog.close(); });
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && state.lastLoaded && Date.now() - state.lastLoaded > 60000) loadFarm(false); });
  applyScene(readScenePreference(), false);
  loadFarm(false);
})();
