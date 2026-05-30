var https = require("https");
var http = require("http");
var cachedProps = [];
var lastFetch = null;
var playerStats = {};
var lastStatsUpdate = null;

function setCORS(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS, HEAD");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept");
}

function httpGet(hostname, path, callback) {
  var opts = {
    hostname: hostname,
    path: path,
    method: "GET",
    headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/json" }
  };
  var req = https.request(opts, function(res) {
    var data = "";
    res.on("data", function(c) { data += c; });
    res.on("end", function() {
      try { callback(null, JSON.parse(data)); }
      catch(e) { callback(e); }
    });
  });
  req.on("error", callback);
  req.setTimeout(15000, function() { req.destroy(); callback(new Error("Timeout")); });
  req.end();
}

function fetchNBAStats() {
  console.log("Fetching NBA stats...");
  httpGet("api.balldontlie.io", "/v1/season_averages?season=2025", function(err, data) {
    if (err) { console.error("NBA error:", err.message); return; }
    try {
      var players = data.data || [];
      players.forEach(function(p) {
        if (!p.player) return;
        var name = p.player.first_name + " " + p.player.last_name;
        var g = p.games_played;
        if (p.pts > 0) { playerStats[name + "_Points"] = { avg: +p.pts.toFixed(1), games: g }; }
        if (p.reb > 0) { playerStats[name + "_Rebounds"] = { avg: +p.reb.toFixed(1), games: g }; }
        if (p.ast > 0) { playerStats[name + "_Assists"] = { avg: +p.ast.toFixed(1), games: g }; }
        if (p.stl > 0) { playerStats[name + "_Steals"] = { avg: +p.stl.toFixed(1), games: g }; }
        if (p.blk > 0) { playerStats[name + "_Blocked Shots"] = { avg: +p.blk.toFixed(1), games: g }; }
        if (p.pts && p.reb) { playerStats[name + "_Pts+Rebs"] = { avg: +(p.pts+p.reb).toFixed(1), games: g }; }
        if (p.pts && p.ast) { playerStats[name + "_Pts+Asts"] = { avg: +(p.pts+p.ast).toFixed(1), games: g }; }
        if (p.reb && p.ast) { playerStats[name + "_Rebs+Asts"] = { avg: +(p.reb+p.ast).toFixed(1), games: g }; }
        if (p.pts && p.reb && p.ast) { playerStats[name + "_Pts+Rebs+Asts"] = { avg: +(p.pts+p.reb+p.ast).toFixed(1), games: g }; }
        if (p.stl && p.blk) { playerStats[name + "_Blks+Stls"] = { avg: +(p.stl+p.blk).toFixed(1), games: g }; }
        if (p.turnover > 0) { playerStats[name + "_Turnovers"] = { avg: +p.turnover.toFixed(1), games: g }; }
      });
      console.log("NBA stats:", players.length, "players");
    } catch(e) { console.error("NBA parse:", e.message); }
  });
}

function fetchMLBStats() {
  console.log("Fetching MLB stats...");
  httpGet("statsapi.mlb.com", "/api/v1/stats?stats=season&group=pitching&season=2026&limit=300&sportId=1", function(err, data) {
    if (err) { console.error("MLB error:", err.message); return; }
    try {
      var splits = (data.stats && data.stats[0] && data.stats[0].splits) || [];
      splits.forEach(function(s) {
        var name = s.player && s.player.fullName;
        var st = s.stat;
        if (!name || !st) return;
        var gs = parseInt(st.gamesStarted) || 0;
        if (gs < 2) return;
        var ks = parseFloat(st.strikeOuts) || 0;
        var bb = parseFloat(st.baseOnBalls) || 0;
        var er = parseFloat(st.earnedRuns) || 0;
        var h  = parseFloat(st.hits) || 0;
        var ip = parseFloat(st.inningsPitched) || 0;
        if (ks > 0) playerStats[name + "_Pitcher Strikeouts"] = { avg: +(ks/gs).toFixed(1), games: gs };
        if (bb > 0) playerStats[name + "_Walks Allowed"] = { avg: +(bb/gs).toFixed(1), games: gs };
        playerStats[name + "_Earned Runs Allowed"] = { avg: +(er/gs).toFixed(1), games: gs };
        if (h > 0) playerStats[name + "_Hits Allowed"] = { avg: +(h/gs).toFixed(1), games: gs };
        if (ip > 0) playerStats[name + "_Pitching Outs"] = { avg: +((ip/gs)*3).toFixed(1), games: gs };
      });
      console.log("MLB stats:", splits.length, "pitchers");
    } catch(e) { console.error("MLB parse:", e.message); }
  });
}

function fetchWNBAStats() {
  console.log("Fetching WNBA stats...");
  httpGet("site.api.espn.com", "/apis/site/v2/sports/basketball/wnba/leaders?limit=100", function(err, data) {
    if (err) { console.error("WNBA error:", err.message); return; }
    try {
      var cats = data.leaders || [];
      cats.forEach(function(cat) {
        var statName = (cat.name || "").toLowerCase();
        cat.leaders && cat.leaders.forEach(function(l) {
          var a = l.athlete;
          if (!a) return;
          var name = a.displayName || (a.firstName + " " + a.lastName);
          var val = parseFloat(l.value);
          if (!name || isNaN(val)) return;
          var mapped = null;
          if (statName.includes("point")) mapped = "Points";
          else if (statName.includes("rebound")) mapped = "Rebounds";
          else if (statName.includes("assist")) mapped = "Assists";
          else if (statName.includes("steal")) mapped = "Steals";
          else if (statName.includes("block")) mapped = "Blocked Shots";
          if (mapped) playerStats[name + "_" + mapped] = { avg: +val.toFixed(1), games: null };
        });
      });
      // Compute combo stats
      var byPlayer = {};
      Object.keys(playerStats).forEach(function(k) {
        var parts = k.split("_");
        var pn = parts[0]; var st = parts[1];
        if (["Points","Rebounds","Assists"].indexOf(st) > -1) {
          if (!byPlayer[pn]) byPlayer[pn] = {};
          byPlayer[pn][st] = playerStats[k].avg;
        }
      });
      Object.keys(byPlayer).forEach(function(name) {
        var p = byPlayer[name];
        if (p.Points && p.Rebounds) playerStats[name + "_Pts+Rebs"] = { avg: +(p.Points+p.Rebounds).toFixed(1), games: null };
        if (p.Points && p.Assists) playerStats[name + "_Pts+Asts"] = { avg: +(p.Points+p.Assists).toFixed(1), games: null };
        if (p.Rebounds && p.Assists) playerStats[name + "_Rebs+Asts"] = { avg: +(p.Rebounds+p.Assists).toFixed(1), games: null };
        if (p.Points && p.Rebounds && p.Assists) playerStats[name + "_Pts+Rebs+Asts"] = { avg: +(p.Points+p.Rebounds+p.Assists).toFixed(1), games: null };
      });
      console.log("WNBA stats loaded, total keys:", Object.keys(playerStats).length);
    } catch(e) { console.error("WNBA parse:", e.message); }
  });
}

function fetchProps() {
  var opts = {
    hostname: "api.prizepicks.com",
    path: "/projections?per_page=250&single_stat=true",
    method: "GET",
    headers: {
      "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)",
      "Accept": "application/json",
      "Referer": "https://app.prizepicks.com/",
      "Origin": "https://app.prizepicks.com"
    }
  };
  var req = https.request(opts, function(res) {
    var data = "";
    res.on("data", function(c) { data += c; });
    res.on("end", function() {
      try {
        var json = JSON.parse(data);
        var players = {}, leagues = {};
        (json.included || []).forEach(function(item) {
          if (item.type === "new_player") players[item.id] = { name: item.attributes.name || "Unknown", team: item.attributes.team || "" };
          if (item.type === "league") leagues[item.id] = item.attributes.name || "";
        });
        var props = [];
        (json.data || []).forEach(function(proj) {
          try {
            var pid = proj.relationships.new_player.data.id;
            var lid = proj.relationships.league.data.id;
            var player = players[pid] || {};
            var ln = (leagues[lid] || "").toUpperCase();
            var sport = "OTHER";
            if (ln.indexOf("NBA") > -1) sport = "NBA";
            else if (ln.indexOf("MLB") > -1) sport = "MLB";
            else if (ln.indexOf("WNBA") > -1) sport = "WNBA";
            else if (ln.indexOf("NFL") > -1) sport = "NFL";
            else if (ln.indexOf("NHL") > -1) sport = "NHL";
            var attrs = proj.attributes || {};
            var line = parseFloat(attrs.line_score || attrs.stat_score || 0);
            if (line > 0) props.push({ id: proj.id, player: player.name || "Unknown", team: player.team || "", sport: sport, stat: attrs.stat_type || attrs.stat_display_name || "", line: line, flash: attrs.flash_sale_line_score || null, gameTime: attrs.start_time || null });
          } catch(e) {}
        });
        cachedProps = props;
        lastFetch = new Date().toISOString();
        console.log("Props:", props.length);
      } catch(e) { console.error("Props parse:", e.message); }
    });
  });
  req.on("error", function(e) { console.error("Props error:", e.message); });
  req.setTimeout(20000, function() { req.destroy(); });
  req.end();
}

var STAT_MAP = {
  "Pitcher Strikeouts": "Pitcher Strikeouts",
  "Pitcher Strikeouts (Combo)": "Pitcher Strikeouts",
  "Pitching Outs": "Pitching Outs",
  "Hits Allowed": "Hits Allowed",
  "Earned Runs Allowed": "Earned Runs Allowed",
  "Walks Allowed": "Walks Allowed",
  "Points": "Points",
  "Rebounds": "Rebounds",
  "Assists": "Assists",
  "Pts+Rebs+Asts": "Pts+Rebs+Asts",
  "Pts+Rebs": "Pts+Rebs",
  "Pts+Asts": "Pts+Asts",
  "Rebs+Asts": "Rebs+Asts",
  "Blks+Stls": "Blks+Stls",
  "Blocked Shots": "Blocked Shots",
  "Steals": "Steals",
  "Turnovers": "Turnovers",
  "3-PT Made": "3-PT Made"
};

function getScoredProps() {
  var results = [];
  cachedProps.forEach(function(prop) {
    var mapped = STAT_MAP[prop.stat] || prop.stat;
    var key = prop.player + "_" + mapped;
    var entry = playerStats[key];
    if (!entry) return;
    var avg = entry.avg;
    var line = prop.line;
    var overC = +(avg - line).toFixed(2);
    var underC = +(line - avg).toFixed(2);
    function tier(c) {
      if (c >= 2.0) return "STRONG LOCK";
      if (c >= 1.5) return "LOCK";
      if (c >= 1.0) return "LEAN";
      if (c >= 0.5) return "MONITOR";
      return null;
    }
    if (overC >= 0.5) {
      var t = tier(overC);
      if (t) results.push({ id: prop.id+"_H", player: prop.player, team: prop.team, sport: prop.sport, stat: prop.stat, line: line, direction: "HIGHER", cushion: overC, tier: t, avg: avg, games: entry.games, flash: prop.flash, gameTime: prop.gameTime });
    }
    if (underC >= 0.5) {
      var t2 = tier(underC);
      if (t2) results.push({ id: prop.id+"_L", player: prop.player, team: prop.team, sport: prop.sport, stat: prop.stat, line: line, direction: "LOWER", cushion: underC, tier: t2, avg: avg, games: entry.games, flash: prop.flash, gameTime: prop.gameTime });
    }
  });
  results.sort(function(a,b) { return b.cushion - a.cushion; });
  return results;
}

fetchProps();
fetchNBAStats();
fetchMLBStats();
fetchWNBAStats();
setInterval(fetchProps, 25 * 60 * 1000);
setInterval(function() {
  fetchNBAStats(); fetchMLBStats(); fetchWNBAStats();
  lastStatsUpdate = new Date().toISOString();
  console.log("Stats refreshed");
}, 6 * 60 * 60 * 1000);

var SCANNER_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>Sharp Scanner</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;700&display=swap');
*{box-sizing:border-box;margin:0;padding:0;}
body{background:#060810;color:#C8CCE0;font-family:'IBM Plex Mono',monospace;min-height:100vh;}
.header{background:#0B0D16;border-bottom:1px solid #141828;padding:14px 16px;position:sticky;top:0;z-index:99;}
.logo{font-size:16px;font-weight:700;color:#00E5A0;letter-spacing:0.2em;}
.sub{font-size:9px;color:#4A4E6A;letter-spacing:0.12em;}
.status{font-size:10px;padding:4px 10px;border-radius:4px;border:1px solid #141828;max-width:200px;text-overflow:ellipsis;overflow:hidden;white-space:nowrap;}
.sport-bar{display:flex;gap:5px;padding:10px 16px;background:#0B0D16;border-bottom:1px solid #141828;overflow-x:auto;}
.sport-btn{padding:5px 14px;font-size:10px;font-weight:700;font-family:'IBM Plex Mono',monospace;letter-spacing:0.08em;border-radius:4px;cursor:pointer;white-space:nowrap;border:1px solid #1E2235;background:#060810;color:#4A4E6A;transition:all .15s;}
.sport-btn.active{border-color:#00E5A0;background:rgba(0,229,160,0.1);color:#00E5A0;}
.main{padding:12px 16px;max-width:700px;margin:0 auto;}
.section-title{font-size:9px;font-weight:700;letter-spacing:0.18em;margin-bottom:10px;display:flex;align-items:center;gap:8px;}
.prop-card{background:#0B0D16;border-radius:8px;padding:12px 14px;margin-bottom:8px;cursor:pointer;transition:opacity .15s;}
.prop-card:hover{opacity:.85;}
.prop-card.strong-lock{border:1px solid rgba(0,229,160,0.3);border-left:3px solid #00E5A0;}
.prop-card.lock{border:1px solid rgba(0,229,160,0.15);border-left:3px solid #00E5A0;}
.prop-card.lean{border:1px solid rgba(255,209,102,0.2);border-left:3px solid #FFD166;}
.prop-card.monitor{border:1px solid rgba(77,158,255,0.2);border-left:3px solid #4D9EFF;}
.player-name{font-size:14px;font-weight:700;color:#E0E0E8;margin-bottom:3px;}
.prop-line{font-size:20px;font-weight:700;color:#FF8C42;}
.edge-badge{font-size:9px;font-weight:700;padding:2px 8px;border-radius:3px;letter-spacing:0.08em;}
.sport-tag{font-size:8px;font-weight:700;padding:1px 5px;border-radius:2px;}
.scan-btn{width:100%;background:linear-gradient(135deg,#00E5A0,#4D9EFF);color:#060810;border:none;border-radius:7px;padding:13px;font-size:12px;font-family:'IBM Plex Mono',monospace;font-weight:700;letter-spacing:0.15em;cursor:pointer;margin-bottom:14px;}
.scan-btn:disabled{background:#1A1E2E;color:#4A4E6A;cursor:not-allowed;}
.empty{text-align:center;padding:40px 20px;color:#4A4E6A;}
.search-bar{width:100%;background:#0B0D16;border:1px solid #1E2235;border-radius:6px;padding:9px 12px;font-size:12px;font-family:'IBM Plex Mono',monospace;color:#C8CCE0;outline:none;margin-bottom:12px;}
.count-badge{background:#1E2235;border-radius:4px;padding:3px 8px;font-size:9px;color:#4D9EFF;font-weight:700;}
.flash-badge{background:rgba(255,209,102,0.15);border:1px solid rgba(255,209,102,0.4);color:#FFD166;font-size:8px;font-weight:700;padding:1px 6px;border-radius:3px;margin-left:5px;}
.cushion-bar{height:3px;border-radius:2px;margin-top:8px;background:#1E2235;}
.cushion-fill{height:100%;border-radius:2px;}
.selected-bar{display:none;position:fixed;bottom:0;left:0;right:0;background:#0B0D16;border-top:2px solid #00E5A0;padding:12px 16px;font-size:11px;color:#C8CCE0;line-height:1.6;z-index:999;}
::-webkit-scrollbar{width:3px;height:3px;}
::-webkit-scrollbar-track{background:#060810;}
::-webkit-scrollbar-thumb{background:#1E2235;border-radius:2px;}
input::placeholder{color:#2A2E45;}
@keyframes pulse{0%,100%{opacity:1;}50%{opacity:.4;}}
</style>
</head>
<body>

<div class="header">
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
    <div>
      <div class="logo">â¡ SHARP SCANNER</div>
      <div class="sub">LIVE EDGES â BOTH DIRECTIONS â REAL 2026 DATA</div>
    </div>
    <div id="status-badge" class="status" style="color:#4A4E6A;">IDLE</div>
  </div>
  <div style="display:flex;gap:6px;align-items:center;">
    <button class="scan-btn" id="scan-btn" onclick="startScan()" style="margin:0;flex:1;padding:9px;">â¶ SCAN FOR EDGES</button>
    <div id="edge-count" class="count-badge" style="white-space:nowrap;">0 EDGES</div>
  </div>
</div>

<div class="sport-bar">
  <button class="sport-btn active" id="sb-ALL" onclick="filterSport('ALL')">ALL</button>
  <button class="sport-btn" id="sb-MLB" onclick="filterSport('MLB')">MLB</button>
  <button class="sport-btn" id="sb-NBA" onclick="filterSport('NBA')">NBA</button>
  <button class="sport-btn" id="sb-WNBA" onclick="filterSport('WNBA')">WNBA</button>
  <button class="sport-btn" id="sb-NFL" onclick="filterSport('NFL')">NFL</button>
</div>

<div class="main">
  <input class="search-bar" id="search" placeholder="Search player or stat..." oninput="renderEdges()"/>

  <div id="strong-lock-section" style="display:none;">
    <div class="section-title" style="color:#00E5A0;">
      <span style="width:8px;height:8px;border-radius:50%;background:#00E5A0;box-shadow:0 0 8px #00E5A0;display:inline-block;animation:pulse 1.5s infinite;"></span>
      STRONG LOCKS
      <span id="sl-count" class="count-badge" style="color:#00E5A0;border-color:rgba(0,229,160,0.3);background:rgba(0,229,160,0.1);"></span>
    </div>
    <div id="strong-lock-list"></div>
  </div>

  <div id="lock-section" style="display:none;margin-top:14px;">
    <div class="section-title" style="color:#00E5A0;">
      LOCKS
      <span id="lock-count" class="count-badge" style="color:#00E5A0;border-color:rgba(0,229,160,0.3);background:rgba(0,229,160,0.1);"></span>
    </div>
    <div id="lock-list"></div>
  </div>

  <div id="lean-section" style="display:none;margin-top:14px;">
    <div class="section-title" style="color:#FFD166;">
      LEANS
      <span id="lean-count" class="count-badge" style="color:#FFD166;border-color:rgba(255,209,102,0.3);background:rgba(255,209,102,0.1);"></span>
    </div>
    <div id="lean-list"></div>
  </div>

  <div id="empty-state" class="empty">
    <div style="font-size:28px;margin-bottom:10px;">â¡</div>
    <div style="font-size:12px;margin-bottom:6px;">Tap SCAN FOR EDGES to start</div>
    <div style="font-size:10px;color:#2A2E45;">Pulls live 2026 stats â scores both HIGHER and LOWER automatically</div>
  </div>
</div>

<div class="selected-bar" id="selected-bar"></div>

<script>
var allEdges = [];
var currentSport = "ALL";
var SERVER = "https://sharp-model-production.up.railway.app";

var SPORT_COLORS = { MLB:"#4ECDC4", NBA:"#FF6B35", WNBA:"#FF6B9D", NFL:"#45B7D1", NHL:"#96CEB4" };
var TIER_COLORS = { "STRONG LOCK":"#00E5A0", "LOCK":"#00E5A0", "LEAN":"#FFD166", "MONITOR":"#4D9EFF" };

function filterSport(sport) {
  currentSport = sport;
  ["ALL","MLB","NBA","WNBA","NFL"].forEach(function(s) {
    var btn = document.getElementById("sb-" + s);
    if (!btn) return;
    if (s === sport) {
      btn.className = "sport-btn active";
    } else {
      btn.className = "sport-btn";
    }
  });
  renderEdges();
}

function setStatus(msg, color) {
  var el = document.getElementById("status-badge");
  el.textContent = msg;
  el.style.color = color || "#4A4E6A";
  el.style.borderColor = (color || "#4A4E6A") + "44";
  el.style.background = (color || "#4A4E6A") + "11";
}

async function startScan() {
  document.getElementById("scan-btn").disabled = true;
  document.getElementById("scan-btn").textContent = "â³ SCANNING...";
  document.getElementById("empty-state").style.display = "none";
  setStatus("Waking server...", "#FFD166");

  try {
    // Wake server
    try { await fetch(SERVER + "/health"); } catch(e) {}

    setStatus("Pulling live edges...", "#FFD166");

    var res = await fetch(SERVER + "/edges", { cache: "no-cache" });
    if (!res.ok) throw new Error("Server returned " + res.status);
    var data = await res.json();

    allEdges = data.edges || [];
    var statsPlayers = data.statsPlayers || 0;

    setStatus("â " + allEdges.length + " edges â " + statsPlayers + " players tracked", "#00E5A0");
    document.getElementById("edge-count").textContent = allEdges.length + " EDGES";

    renderEdges();

    // Auto refresh every 30 min
    setTimeout(startScan, 30 * 60 * 1000);

  } catch(err) {
    setStatus("â  " + err.message, "#FF4D6D");
    document.getElementById("empty-state").style.display = "block";
    document.getElementById("empty-state").innerHTML = '<div style="font-size:11px;color:#FF4D6D;">Error: ' + err.message + '</div><div style="font-size:10px;color:#4A4E6A;margin-top:8px;">Make sure server is running at ' + SERVER + '</div>';
  }

  document.getElementById("scan-btn").disabled = false;
  document.getElementById("scan-btn").textContent = "â» REFRESH SCAN";
}

function renderEdges() {
  var search = document.getElementById("search").value.toLowerCase();

  var filtered = allEdges.filter(function(e) {
    if (currentSport !== "ALL" && e.sport !== currentSport) return false;
    if (search && !e.player.toLowerCase().includes(search) && !e.stat.toLowerCase().includes(search)) return false;
    return true;
  });

  var strongLocks = filtered.filter(function(e) { return e.tier === "STRONG LOCK"; });
  var locks       = filtered.filter(function(e) { return e.tier === "LOCK"; });
  var leans       = filtered.filter(function(e) { return e.tier === "LEAN"; });

  renderSection("strong-lock-section", "strong-lock-list", "sl-count", strongLocks, "strong-lock", strongLocks.length + " FOUND");
  renderSection("lock-section", "lock-list", "lock-count", locks, "lock", locks.length + " FOUND");
  renderSection("lean-section", "lean-list", "lean-count", leans, "lean", leans.length + " FOUND");

  document.getElementById("edge-count").textContent = filtered.length + " EDGES";

  if (filtered.length === 0 && allEdges.length > 0) {
    document.getElementById("empty-state").style.display = "block";
    document.getElementById("empty-state").innerHTML = '<div style="font-size:11px;color:#4A4E6A;">No edges found in current filter</div>';
  } else {
    document.getElementById("empty-state").style.display = "none";
  }
}

function renderSection(sectionId, listId, countId, edges, cssClass, countText) {
  var section = document.getElementById(sectionId);
  var list = document.getElementById(listId);
  var countEl = document.getElementById(countId);
  if (countEl) countEl.textContent = countText;
  if (!edges.length) { section.style.display = "none"; return; }
  section.style.display = "block";
  list.innerHTML = edges.map(function(e) { return propCard(e, cssClass); }).join("");
}

function propCard(e, cssClass) {
  var tc = TIER_COLORS[e.tier] || "#4A4E6A";
  var sc = SPORT_COLORS[e.sport] || "#888";
  var cushPct = Math.min((e.cushion / 3) * 100, 100);
  var dirColor = e.direction === "HIGHER" ? "#00E5A0" : "#FF6B9D";
  var gamesStr = e.games ? "(" + e.games + " games)" : "";

  return '<div class="prop-card ' + cssClass + '" onclick="selectProp(\\'' +
    e.player.replace(/'/g,"\\\\'") + "','" + e.stat + "'," + e.line + ",'" + e.direction + "'," + e.avg + ",'" + e.tier + "'," + e.cushion + ")"  + '">' +
    '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:4px;">' +
      '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">' +
        '<span class="player-name">' + e.player + '</span>' +
        (e.flash ? '<span class="flash-badge">â¡ FLASH</span>' : '') +
      '</div>' +
      '<div style="display:flex;gap:5px;align-items:center;flex-shrink:0;">' +
        '<span class="sport-tag" style="background:' + sc + '22;color:' + sc + ';border:1px solid ' + sc + '44;">' + e.sport + '</span>' +
        '<span class="edge-badge" style="background:' + tc + '18;color:' + tc + ';border:1px solid ' + tc + '44;">' + e.tier + '</span>' +
      '</div>' +
    '</div>' +
    '<div style="display:flex;align-items:baseline;gap:6px;margin-bottom:4px;">' +
      '<span class="prop-line">' + e.line + '</span>' +
      '<span style="font-size:11px;color:#4A4E6A;">' + e.stat + '</span>' +
      '<span style="font-size:12px;font-weight:700;color:' + dirColor + ';">' + e.direction + '</span>' +
    '</div>' +
    '<div style="font-size:10px;color:' + tc + ';margin-bottom:4px;">' +
      'Avg ' + e.avg + ' ' + gamesStr + ' â cushion ' + (e.cushion > 0 ? "+" : "") + e.cushion +
    '</div>' +
    '<div class="cushion-bar"><div class="cushion-fill" style="width:' + cushPct + '%;background:' + tc + ';"></div></div>' +
    '<div style="font-size:9px;color:#4D9EFF;margin-top:6px;letter-spacing:0.06em;">TAP TO SELECT â SEND TO CLAUDE</div>' +
  '</div>';
}

function selectProp(player, stat, line, direction, avg, tier, cushion) {
  var msg = player + " | " + stat + " " + line + " " + direction + " | Avg: " + avg + " | Cushion: +" + cushion + " | " + tier;
  var bar = document.getElementById("selected-bar");
  bar.innerHTML = '<strong style="color:#00E5A0">SELECTED: </strong>' + msg +
    '<br><span style="font-size:9px;color:#4A4E6A;">Read this to Claude for full framework analysis</span>' +
    '<span onclick="document.getElementById(\\'selected-bar\\').style.display=\\'none\\'" style="position:absolute;right:16px;top:12px;cursor:pointer;color:#4A4E6A;font-size:16px;">Ã</span>';
  bar.style.display = "block";
}
</script>
</body>
</html>
`;

var server = http.createServer(function(req, res) {
  setCORS(res);
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }
  var url = req.url.split("?")[0];
  if (url === "/" || url === "/scanner") {
    res.setHeader("Content-Type", "text/html");
    res.writeHead(200);
    res.end(SCANNER_HTML);
    return;
  }
  res.setHeader("Content-Type", "application/json");
  if (url === "/props") {
    res.writeHead(200);
    res.end(JSON.stringify({ props: cachedProps, count: cachedProps.length, lastFetch: lastFetch, status: "ok" }));
    return;
  }
  if (url === "/edges") {
    var edges = getScoredProps();
    res.writeHead(200);
    res.end(JSON.stringify({ edges: edges, count: edges.length, statsPlayers: Object.keys(playerStats).length, lastStatsUpdate: lastStatsUpdate, status: "ok" }));
    return;
  }
  if (url === "/health") {
    res.writeHead(200);
    res.end(JSON.stringify({ status: "ok", props: cachedProps.length, statsPlayers: Object.keys(playerStats).length, lastFetch: lastFetch, uptime: process.uptime() }));
    return;
  }
  if (url === "/stats-db") {
    res.writeHead(200);
    res.end(JSON.stringify(playerStats));
    return;
  }
  res.writeHead(404);
  res.end(JSON.stringify({ error: "not found" }));
});
var PORT = process.env.PORT || 3000;
server.listen(PORT, "0.0.0.0", function() { console.log("Sharp server on port", PORT); });
