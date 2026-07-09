(function () {
  "use strict";

  const CONFIG_URL = "data/config.json";
  const AUTO_REFRESH_MS = 60000;

  let config = null;
  let countdownTimer = null;
  let refreshTimer = null;

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

  function fmtMoney(n) {
    const prefix = (config && config.currencyPrefix) || "";
    return prefix + Math.round(n).toLocaleString("en-US");
  }

  // ---------- Countdown ----------
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
        ["cd-days", "cd-hours", "cd-mins", "cd-secs"].forEach((id) => {
          document.getElementById(id).textContent = "00";
        });
        if (countdownTimer) clearInterval(countdownTimer);
        return;
      }

      closedBanner.classList.remove("show");
      countdownEl.style.opacity = "1";

      const s = Math.floor(diff / 1000);
      const days = Math.floor(s / 86400);
      const hours = Math.floor((s % 86400) / 3600);
      const mins = Math.floor((s % 3600) / 60);
      const secs = s % 60;

      document.getElementById("cd-days").textContent = String(days).padStart(2, "0");
      document.getElementById("cd-hours").textContent = String(hours).padStart(2, "0");
      document.getElementById("cd-mins").textContent = String(mins).padStart(2, "0");
      document.getElementById("cd-secs").textContent = String(secs).padStart(2, "0");
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

  // ---------- Rendering ----------
  function renderStats(agg) {
    document.getElementById("stat-participants").textContent = agg.participants.toLocaleString("en-US");
    document.getElementById("stat-bets").textContent = agg.totalBets.toLocaleString("en-US");
    document.getElementById("stat-total").textContent = fmtMoney(agg.totalAmount);
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

  function renderTeams(agg) {
    const container = document.getElementById("teams");
    container.innerHTML = "";

    agg.teams.forEach((team) => {
      const pct = agg.totalAmount > 0 ? (team.total / agg.totalAmount) * 100 : 0;
      const card = document.createElement("button");
      card.className = "team-card";
      card.style.setProperty("--tf", team.colorFrom || "#0bb37a");
      card.style.setProperty("--tt", team.colorTo || "#061a12");
      card.innerHTML = `
        <div class="top-row">
          <div class="flag">${flagEmoji(team.code)}</div>
          <div>
            <div class="name">${team.name}</div>
            <div class="backers-count">${team.backers.length} 人下注</div>
          </div>
        </div>
        <div class="amount">${fmtMoney(team.total)}</div>
        <div class="share-bar"><div style="width:${pct.toFixed(1)}%"></div></div>
        <div class="share-pct">佔總金額 ${pct.toFixed(1)}%</div>
        <div class="tap-hint">👉 點擊查看下注名單</div>
      `;
      card.addEventListener("click", () => openModal(team));
      container.appendChild(card);
    });
  }

  function openModal(team) {
    document.getElementById("modal-flag").textContent = flagEmoji(team.code);
    document.getElementById("modal-name").textContent = team.name;
    document.getElementById("modal-sub").textContent =
      `${team.backers.length} 人下注・總金額 ${fmtMoney(team.total)}`;

    const list = document.getElementById("modal-list");
    list.innerHTML = "";

    if (!team.backers.length) {
      list.innerHTML = `<div class="empty-note">目前還沒有人下注這隊</div>`;
    } else {
      const medals = ["🥇", "🥈", "🥉"];
      team.backers.forEach((b, i) => {
        const li = document.createElement("li");
        li.innerHTML = `
          <div class="rank">${medals[i] || i + 1}</div>
          <div class="b-name">${escapeHtml(b.name)}${b.note ? `<span class="b-note">${escapeHtml(b.note)}</span>` : ""}</div>
          <div class="b-amount">${fmtMoney(b.amount)}</div>
        `;
        list.appendChild(li);
      });
    }

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

      renderStats(agg);
      renderWarnings(agg);
      renderTeams(agg);

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

    startCountdown(config.deadlineISO);
    await loadBetsAndRender();

    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = setInterval(loadBetsAndRender, AUTO_REFRESH_MS);

    document.getElementById("refresh-btn").addEventListener("click", loadBetsAndRender);
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
