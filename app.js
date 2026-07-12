(function () {
  "use strict";

  const CONFIG_URL = "data/config.json";
  const AUTO_REFRESH_MS = 60000;
  const SVG_NS = "http://www.w3.org/2000/svg";
  const R = 80;
  const CIRC = 2 * Math.PI * R;

  let config = null;
  let countdownTimer = null;
  let refreshTimer = null;
  let lastAgg = null;
  let chartArcs = {}; // teamId -> <circle>
  let prevUnitText = {};
  let overviewBets = []; // flattened bets for the overview modal, with filters applied on top

  // ---------- CSV parsing (supports quoted fields with commas/newlines) ----------
  function parseCSV(text) {
    const rows = [];
    let row = [];
    let field = "";
    let inQuotes = false;

    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; }
          else inQuotes = false;
        } else {
          field += c;
        }
      } else if (c === '"') {
        inQuotes = true;
      } else if (c === ",") {
        row.push(field);
        field = "";
      } else if (c === "\n") {
        row.push(field);
        rows.push(row);
        row = [];
        field = "";
      } else if (c === "\r") {
        // skip
      } else {
        field += c;
      }
    }
    if (field.length || row.length) {
      row.push(field);
      rows.push(row);
    }
    return rows.filter((r) => !(r.length === 1 && r[0].trim() === ""));
  }

  function csvToObjects(text) {
    const rows = parseCSV(text);
    if (!rows.length) return [];
    const headers = rows[0].map((h) => h.trim().toLowerCase());
    return rows.slice(1).map((r) => {
      const obj = {};
      headers.forEach((h, i) => { obj[h] = (r[i] || "").trim(); });
      return obj;
    });
  }

  // ---------- Flag emoji from ISO alpha-2 code ----------
  function flagEmoji(code) {
    if (!code || code.length !== 2) return "🏳️";
    return code
      .toUpperCase()
      .replace(/./g, (c) => String.fromCodePoint(127397 + c.charCodeAt(0)));
  }

  // UK home nations don't have their own ISO alpha-2 code, and the Unicode
  // subdivision "tag sequence" flags (e.g. England's) render as a blank
  // black flag on many systems (Windows, older macOS/Android) since font
  // support is inconsistent. Draw them as inline SVG instead so they look
  // right everywhere. Only usable where markup is inserted via innerHTML
  // (not .textContent, and not inside a native <select><option>).
  // Square viewBox (not the flag's real 3:2 ratio) so it fills the same
  // square badge shape the emoji flags render as (measured 1em x 1em).
  const SPECIAL_FLAG_SVG = {
    ENG:
      '<svg class="flag-svg" viewBox="0 0 36 36" xmlns="http://www.w3.org/2000/svg" aria-label="England">' +
      '<rect width="36" height="36" fill="#fff"/>' +
      '<rect x="14" width="8" height="36" fill="#CE1124"/>' +
      '<rect y="14" width="36" height="8" fill="#CE1124"/>' +
      "</svg>",
  };

  function flagMarkup(code) {
    const upper = (code || "").toUpperCase();
    if (SPECIAL_FLAG_SVG[upper]) return SPECIAL_FLAG_SVG[upper];
    return flagEmoji(code);
  }

  function fmtMoney(n) {
    const prefix = (config && config.currencyPrefix) || "";
    return prefix + Math.round(n).toLocaleString("en-US");
  }

  function hexToRgba(hex, alpha) {
    const h = (hex || "").replace("#", "");
    const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
    const num = parseInt(full, 16);
    if (isNaN(num)) return `rgba(255,255,255,${alpha})`;
    const r = (num >> 16) & 255, g = (num >> 8) & 255, b = num & 255;
    return `rgba(${r},${g},${b},${alpha})`;
  }

  // ---------- Number count-up animation ----------
  function animateValue(el, to, opts) {
    opts = opts || {};
    const duration = opts.duration || 800;
    const prefix = opts.prefix || "";
    const from = parseFloat(el.dataset.rawValue || "0") || 0;
    el.dataset.rawValue = String(to);
    const start = performance.now();

    function step(now) {
      const p = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      const val = from + (to - from) * eased;
      el.textContent = prefix + Math.round(val).toLocaleString("en-US");
      if (p < 1) requestAnimationFrame(step);
      else el.textContent = prefix + Math.round(to).toLocaleString("en-US");
    }
    requestAnimationFrame(step);
  }

  // ---------- Ambient particles ----------
  function createParticles() {
    const container = document.getElementById("particles");
    const colors = [
      "rgba(255,199,44,0.8)",
      "rgba(11,179,122,0.8)",
      "rgba(61,125,216,0.8)",
      "rgba(228,87,46,0.7)",
      "rgba(255,255,255,0.6)",
    ];
    const count = 26;
    for (let i = 0; i < count; i++) {
      const p = document.createElement("span");
      p.className = "particle";
      const size = 2 + Math.random() * 4;
      const duration = 10 + Math.random() * 14;
      const delay = -Math.random() * duration;
      const drift = (Math.random() * 80 - 40).toFixed(0) + "px";
      p.style.left = Math.random() * 100 + "%";
      p.style.width = size + "px";
      p.style.height = size + "px";
      p.style.background = colors[Math.floor(Math.random() * colors.length)];
      p.style.animationDuration = duration + "s";
      p.style.animationDelay = delay + "s";
      p.style.setProperty("--drift", drift);
      container.appendChild(p);
    }
  }

  // ---------- Countdown ----------
  function setUnit(id, value) {
    const el = document.getElementById(id);
    const text = String(value).padStart(2, "0");
    if (prevUnitText[id] !== undefined && prevUnitText[id] !== text) {
      const unitEl = el.closest(".unit");
      unitEl.classList.remove("bump");
      // eslint-disable-next-line no-unused-expressions
      void unitEl.offsetWidth; // restart animation
      unitEl.classList.add("bump");
    }
    prevUnitText[id] = text;
    el.textContent = text;
  }

  function startCountdown(deadlineISO) {
    const deadline = new Date(deadlineISO).getTime();
    document.getElementById("deadline-label").textContent = new Date(deadline).toLocaleString("zh-TW", {
      year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit"
    });

    function tick() {
      const now = Date.now();
      const diff = deadline - now;
      const closedBanner = document.getElementById("closed-banner");
      const countdownEl = document.getElementById("countdown");

      if (diff <= 0) {
        closedBanner.classList.add("show");
        countdownEl.style.opacity = "0.4";
        ["cd-days", "cd-hours", "cd-mins", "cd-secs"].forEach((id) => setUnit(id, 0));
        if (countdownTimer) clearInterval(countdownTimer);
        return;
      }

      closedBanner.classList.remove("show");
      countdownEl.style.opacity = "1";

      const s = Math.floor(diff / 1000);
      setUnit("cd-days", Math.floor(s / 86400));
      setUnit("cd-hours", Math.floor((s % 86400) / 3600));
      setUnit("cd-mins", Math.floor((s % 3600) / 60));
      setUnit("cd-secs", s % 60);
    }

    if (countdownTimer) clearInterval(countdownTimer);
    tick();
    countdownTimer = setInterval(tick, 1000);
  }

  // ---------- Data aggregation ----------
  function matchTeam(team, csvValue) {
    const v = csvValue.trim().toLowerCase();
    return v === team.name.trim().toLowerCase() || v === team.id.trim().toLowerCase();
  }

  function aggregate(bets) {
    const teams = config.teams.map((t) => ({ ...t, backers: [], total: 0 }));
    const unmatched = [];
    const participants = new Set();
    let totalAmount = 0;
    let totalBets = 0;

    bets.forEach((b) => {
      const amount = parseFloat((b.amount || "0").replace(/[^0-9.\-]/g, ""));
      if (!b.name || !b.team || isNaN(amount)) {
        if (b.name || b.team || b.amount) unmatched.push(b);
        return;
      }
      const team = teams.find((t) => matchTeam(t, b.team));
      if (!team) {
        unmatched.push(b);
        return;
      }
      team.backers.push({ name: b.name, amount, note: b.note || "" });
      team.total += amount;
      participants.add(b.name.trim().toLowerCase());
      totalAmount += amount;
      totalBets += 1;
    });

    teams.forEach((t) => t.backers.sort((a, b) => b.amount - a.amount));

    return { teams, unmatched, participants: participants.size, totalAmount, totalBets };
  }

  // ---------- Rendering: stats ----------
  function renderStats(agg) {
    animateValue(document.getElementById("stat-participants"), agg.participants);
    animateValue(document.getElementById("stat-bets"), agg.totalBets);
    animateValue(document.getElementById("stat-total"), agg.totalAmount, { prefix: config.currencyPrefix || "" });
  }

  function renderWarnings(agg) {
    const el = document.getElementById("warn-banner");
    if (!agg.unmatched.length) {
      el.classList.remove("show");
      el.textContent = "";
      return;
    }
    const lines = agg.unmatched
      .slice(0, 8)
      .map((r) => `「${r.name || "?"}／${r.team || "?"}／${r.amount || "?"}」`)
      .join("、");
    el.textContent = `⚠️ 有 ${agg.unmatched.length} 筆資料無法對應到四強隊伍或格式不完整，請檢查 bets.csv：${lines}`;
    el.classList.add("show");
  }

  // ---------- Rendering: donut chart ----------
  function setupChart(teams) {
    const defs = document.getElementById("donut-defs");
    const arcsGroup = document.getElementById("donut-arcs");
    defs.innerHTML = "";
    arcsGroup.innerHTML = "";
    chartArcs = {};

    teams.forEach((team) => {
      const gradId = "grad-" + team.id;
      const lg = document.createElementNS(SVG_NS, "linearGradient");
      lg.setAttribute("id", gradId);
      lg.setAttribute("x1", "0%");
      lg.setAttribute("y1", "0%");
      lg.setAttribute("x2", "100%");
      lg.setAttribute("y2", "100%");
      const stop1 = document.createElementNS(SVG_NS, "stop");
      stop1.setAttribute("offset", "0%");
      stop1.setAttribute("stop-color", team.colorFrom || "#0bb37a");
      const stop2 = document.createElementNS(SVG_NS, "stop");
      stop2.setAttribute("offset", "100%");
      stop2.setAttribute("stop-color", team.colorTo || "#061a12");
      lg.appendChild(stop1);
      lg.appendChild(stop2);
      defs.appendChild(lg);

      const circle = document.createElementNS(SVG_NS, "circle");
      circle.setAttribute("class", "arc-slice");
      circle.setAttribute("cx", "100");
      circle.setAttribute("cy", "100");
      circle.setAttribute("r", String(R));
      circle.setAttribute("stroke", `url(#${gradId})`);
      circle.setAttribute("stroke-dasharray", `0 ${CIRC}`);
      circle.setAttribute("stroke-dashoffset", "0");
      circle.style.setProperty("--glow-color", team.colorFrom || "#0bb37a");
      circle.addEventListener("click", () => openModalById(team.id));
      arcsGroup.appendChild(circle);
      chartArcs[team.id] = circle;
    });
  }

  function updateChart(agg) {
    const total = agg.totalAmount;
    let cumulative = 0;
    agg.teams.forEach((team) => {
      const circle = chartArcs[team.id];
      if (!circle) return;
      const frac = total > 0 ? team.total / total : 0;
      const len = frac * CIRC;
      const gap = frac > 0 ? 3 : 0;
      const segLen = Math.max(len - gap, 0);
      circle.setAttribute("stroke-dasharray", `${segLen} ${CIRC - segLen}`);
      circle.setAttribute("stroke-dashoffset", String(-cumulative));
      cumulative += len;
    });
    animateValue(document.getElementById("donut-total"), total, { prefix: config.currencyPrefix || "" });
  }

  // ---------- Rendering: legend ----------
  function renderLegend(agg) {
    const container = document.getElementById("legend");
    container.innerHTML = "";

    const sortedTeams = [...agg.teams].sort((a, b) => b.total - a.total);

    sortedTeams.forEach((team) => {
      const pct = agg.totalAmount > 0 ? (team.total / agg.totalAmount) * 100 : 0;
      const chip = document.createElement("button");
      chip.className = "legend-chip";
      chip.style.setProperty("--tc", team.colorFrom || "#0bb37a");
      chip.style.setProperty("--tc-glow", hexToRgba(team.colorFrom, 0.4));
      chip.innerHTML = `
        <span class="chip-flag">${flagMarkup(team.code)}</span>
        <span class="chip-info">
          <span class="chip-name">${escapeHtml(team.name)}</span>
          <span class="chip-meta">${team.backers.length} 人下注・佔 ${pct.toFixed(1)}%</span>
        </span>
        <span class="chip-amount">${fmtMoney(team.total)}</span>
      `;
      chip.addEventListener("click", () => openModal(team));
      container.appendChild(chip);
    });
  }

  // ---------- Modal ----------
  function openModalById(teamId) {
    if (!lastAgg) return;
    const team = lastAgg.teams.find((t) => t.id === teamId);
    if (team) openModal(team);
  }

  function renderBettorList(entries, emptyText) {
    const list = document.getElementById("modal-list");
    list.innerHTML = "";

    if (!entries.length) {
      list.innerHTML = `<div class="empty-note">${emptyText}</div>`;
      return;
    }
    const medals = ["🥇", "🥈", "🥉"];
    entries.forEach((b, i) => {
      const li = document.createElement("li");
      li.style.animationDelay = (i * 0.04) + "s";
      li.innerHTML = `
        <div class="rank">${medals[i] || i + 1}</div>
        <div class="b-name">${escapeHtml(b.name)}${b.teamLabel ? `<span class="b-team">${b.teamLabel}</span>` : ""}${b.note ? `<span class="b-note">${escapeHtml(b.note)}</span>` : ""}</div>
        <div class="b-amount">${fmtMoney(b.amount)}</div>
      `;
      list.appendChild(li);
    });
  }

  function openModal(team) {
    document.getElementById("modal-filters").classList.remove("show");
    document.getElementById("modal-flag").innerHTML = flagMarkup(team.code);
    document.getElementById("modal-name").textContent = team.name;
    document.getElementById("modal-sub").textContent =
      `${team.backers.length} 人下注・總金額 ${fmtMoney(team.total)}`;

    renderBettorList(team.backers, "目前還沒有人下注這隊");
    document.getElementById("modal-overlay").classList.add("show");
  }

  function populateTeamFilterOptions() {
    const select = document.getElementById("filter-team");
    const options = ['<option value="">全部國家</option>'].concat(
      config.teams.map((t) => `<option value="${t.id}">${flagEmoji(t.code)} ${escapeHtml(t.name)}</option>`)
    );
    select.innerHTML = options.join("");
  }

  function populateNoteFilterOptions() {
    const select = document.getElementById("filter-note");
    const noteOptions = config.noteOptions || [];
    const options = ['<option value="">全部投注條件</option>'].concat(
      noteOptions.map((n) => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`)
    );
    select.innerHTML = options.join("");
  }

  function applyOverviewFilters() {
    const nameQuery = document.getElementById("filter-name").value.trim().toLowerCase();
    const teamId = document.getElementById("filter-team").value;
    const note = document.getElementById("filter-note").value;

    const filtered = overviewBets
      .filter((b) =>
        (!nameQuery || b.name.toLowerCase().includes(nameQuery)) &&
        (!teamId || b.teamId === teamId) &&
        (!note || (b.note || "").trim() === note)
      )
      .sort((a, b) => b.amount - a.amount);

    const uniqueNames = new Set(filtered.map((b) => b.name.trim().toLowerCase())).size;
    const sum = filtered.reduce((s, b) => s + b.amount, 0);
    document.getElementById("modal-sub").textContent =
      `${uniqueNames} 人・${filtered.length} 筆投注・總金額 ${fmtMoney(sum)}`;

    renderBettorList(filtered, nameQuery || teamId || note ? "沒有符合條件的下注紀錄" : "目前還沒有人下注");
  }

  function openOverviewModal() {
    if (!lastAgg) return;
    overviewBets = [];
    lastAgg.teams.forEach((team) => {
      team.backers.forEach((b) => {
        overviewBets.push({ ...b, teamId: team.id, teamLabel: `${flagMarkup(team.code)} ${escapeHtml(team.name)}` });
      });
    });

    document.getElementById("modal-flag").textContent = "🏆";
    document.getElementById("modal-name").textContent = "全部下注總覽";
    document.getElementById("filter-name").value = "";
    document.getElementById("filter-team").value = "";
    document.getElementById("filter-note").value = "";
    document.getElementById("modal-filters").classList.add("show");

    applyOverviewFilters();
    document.getElementById("modal-overlay").classList.add("show");
  }

  function closeModal() {
    document.getElementById("modal-overlay").classList.remove("show");
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  // ---------- Loading pipeline ----------
  async function loadBetsAndRender() {
    const btn = document.getElementById("refresh-btn");
    btn.classList.add("loading");
    try {
      const res = await fetch(config.csvUrl + "?t=" + Date.now(), { cache: "no-store" });
      const text = await res.text();
      const bets = csvToObjects(text);
      const agg = aggregate(bets);
      lastAgg = agg;

      renderStats(agg);
      renderWarnings(agg);
      updateChart(agg);
      renderLegend(agg);

      const now = new Date();
      document.getElementById("updated-text").textContent =
        "資料更新於 " + now.toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    } catch (err) {
      console.error("讀取 bets.csv 失敗", err);
      document.getElementById("updated-text").textContent = "⚠️ 讀取投注資料失敗，請確認 data/bets.csv 存在且透過網頁伺服器開啟";
    } finally {
      btn.classList.remove("loading");
    }
  }

  async function init() {
    createParticles();

    try {
      const res = await fetch(CONFIG_URL + "?t=" + Date.now(), { cache: "no-store" });
      config = await res.json();
    } catch (err) {
      console.error("讀取 config.json 失敗", err);
      document.getElementById("updated-text").textContent = "⚠️ 讀取設定檔失敗，請確認 data/config.json 存在";
      return;
    }

    document.getElementById("page-title").textContent = config.title || "2026 世界盃冠軍預測";
    document.getElementById("page-subtitle").textContent = config.subtitle || "";
    document.title = config.title || document.title;

    setupChart(config.teams);
    populateTeamFilterOptions();
    populateNoteFilterOptions();
    startCountdown(config.deadlineISO);
    await loadBetsAndRender();

    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = setInterval(loadBetsAndRender, AUTO_REFRESH_MS);

    document.getElementById("filter-name").addEventListener("input", applyOverviewFilters);
    document.getElementById("filter-team").addEventListener("change", applyOverviewFilters);
    document.getElementById("filter-note").addEventListener("change", applyOverviewFilters);
    document.getElementById("refresh-btn").addEventListener("click", loadBetsAndRender);
    document.querySelectorAll(".stats .stat-card").forEach((card) => {
      card.addEventListener("click", openOverviewModal);
      card.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          openOverviewModal();
        }
      });
    });
    document.getElementById("modal-close").addEventListener("click", closeModal);
    document.getElementById("modal-overlay").addEventListener("click", (e) => {
      if (e.target.id === "modal-overlay") closeModal();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeModal();
    });
  }

  document.addEventListener("DOMContentLoaded", init);
})();
