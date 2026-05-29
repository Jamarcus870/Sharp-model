var https = require("https");
var http = require("http");
var cachedProps = [];
var lastFetch = null;

function setCORS(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS, HEAD");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept");
}

function fetchProps() {
  var options = {
    hostname: "api.prizepicks.com",
    path: "/projections?per_page=250&single_stat=true&league_id=2",
    method: "GET",
    headers: {
      "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)",
      "Accept": "application/json",
      "Referer": "https://app.prizepicks.com/",
      "Origin": "https://app.prizepicks.com"
    }
  };
  var req = https.request(options, function(res) {
    var data = "";
    res.on("data", function(chunk) { data += chunk; });
    res.on("end", function() {
      try {
        var json = JSON.parse(data);
        var players = {};
        var leagues = {};
        if (json.included) {
          json.included.forEach(function(item) {
            if (item.type === "new_player") {
              players[item.id] = { name: item.attributes.name || "Unknown", team: item.attributes.team || "" };
            }
            if (item.type === "league") {
              leagues[item.id] = item.attributes.name || "";
            }
          });
        }
        var props = [];
        if (json.data) {
          json.data.forEach(function(proj) {
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
              if (line > 0) {
                props.push({
                  id: proj.id,
                  player: player.name || "Unknown",
                  team: player.team || "",
                  sport: sport,
                  stat: attrs.stat_type || attrs.stat_display_name || "",
                  line: line,
                  flash: attrs.flash_sale_line_score || null,
                  gameTime: attrs.start_time || null
                });
              }
            } catch(e) {}
          });
        }
        cachedProps = props;
        lastFetch = new Date().toISOString();
        console.log("Fetched " + props.length + " props");
      } catch(e) {
        console.error("Parse error: " + e.message);
      }
    });
  });
  req.on("error", function(err) { console.error("Error: " + err.message); });
  req.setTimeout(20000, function() { req.destroy(); });
  req.end();
}

fetchProps();
setInterval(fetchProps, 25 * 60 * 1000);

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
.status{font-size:10px;padding:4px 10px;border-radius:4px;border:1px solid #141828;}
.sport-bar{display:flex;gap:5px;padding:10px 16px;background:#0B0D16;border-bottom:1px solid #141828;overflow-x:auto;}
.sport-btn{padding:5px 14px;font-size:10px;font-weight:700;font-family:'IBM Plex Mono',monospace;letter-spacing:0.08em;border-radius:4px;cursor:pointer;white-space:nowrap;border:1px solid #1E2235;background:#060810;color:#4A4E6A;transition:all .15s;}
.sport-btn.active{border-color:#00E5A0;background:rgba(0,229,160,0.1);color:#00E5A0;}
.main{padding:12px 16px;max-width:700px;margin:0 auto;}
.section-title{font-size:9px;font-weight:700;letter-spacing:0.18em;margin-bottom:10px;display:flex;align-items:center;gap:8px;}
.prop-card{background:#0B0D16;border-radius:8px;padding:12px 14px;margin-bottom:8px;border-left:3px solid;cursor:pointer;transition:opacity .15s;}
.prop-card:hover{opacity:.85;}
.prop-card.green{border-left-color:#00E5A0;border:1px solid rgba(0,229,160,0.2);border-left:3px solid #00E5A0;}
.prop-card.yellow{border-left-color:#FFD166;border:1px solid rgba(255,209,102,0.2);border-left:3px solid #FFD166;}
.prop-card.blue{border-left-color:#4D9EFF;border:1px solid rgba(77,158,255,0.2);border-left:3px solid #4D9EFF;}
.player-name{font-size:14px;font-weight:700;color:#E0E0E8;margin-bottom:3px;}
.prop-line{font-size:20px;font-weight:700;color:#FF8C42;}
.prop-stat{font-size:11px;color:#4A4E6A;margin-left:6px;}
.edge-badge{font-size:9px;font-weight:700;padding:2px 8px;border-radius:3px;letter-spacing:0.08em;}
.cushion-bar{height:3px;border-radius:2px;margin-top:8px;background:#1E2235;}
.cushion-fill{height:100%;border-radius:2px;transition:width .3s;}
.verdict{font-size:10px;font-weight:700;margin-top:6px;line-height:1.5;}
.sport-tag{font-size:8px;font-weight:700;padding:1px 5px;border-radius:2px;}
.scan-btn{width:100%;background:linear-gradient(135deg,#00E5A0,#4D9EFF);color:#060810;border:none;border-radius:7px;padding:13px;font-size:12px;font-family:'IBM Plex Mono',monospace;font-weight:700;letter-spacing:0.15em;cursor:pointer;margin-bottom:14px;}
.scan-btn:disabled{background:#1A1E2E;color:#4A4E6A;cursor:not-allowed;}
.empty{text-align:center;padding:40px 20px;color:#4A4E6A;}
.search-bar{width:100%;background:#0B0D16;border:1px solid #1E2235;border-radius:6px;padding:9px 12px;font-size:12px;font-family:'IBM Plex Mono',monospace;color:#C8CCE0;outline:none;margin-bottom:12px;}
.count-badge{background:#1E2235;border-radius:4px;padding:3px 8px;font-size:9px;color:#4D9EFF;font-weight:700;}
.flash-badge{background:rgba(255,209,102,0.15);border:1px solid rgba(255,209,102,0.4);color:#FFD166;font-size:8px;font-weight:700;padding:1px 6px;border-radius:3px;margin-left:5px;}
::-webkit-scrollbar{width:3px;height:3px;}
::-webkit-scrollbar-track{background:#060810;}
::-webkit-scrollbar-thumb{background:#1E2235;border-radius:2px;}
input::placeholder{color:#2A2E45;}
</style>
</head>
<body>

<div class="header">
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
    <div>
      <div class="logo">â¡ SHARP SCANNER</div>
      <div class="sub">FINDS EDGES AUTOMATICALLY</div>
    </div>
    <div id="status-badge" class="status" style="color:#4A4E6A;">IDLE</div>
  </div>
  <div style="display:flex;gap:6px;align-items:center;">
    <button class="scan-btn" id="scan-btn" onclick="startScan()" style="margin:0;flex:1;padding:9px;">â¶ SCAN FOR VALUE</button>
    <div id="prop-count" class="count-badge" style="white-space:nowrap;">0 EDGES</div>
  </div>
</div>

<div class="sport-bar">
  <button class="sport-btn active" id="sb-ALL" onclick="filterSport('ALL')">ALL</button>
  <button class="sport-btn" id="sb-MLB" onclick="filterSport('MLB')">MLB</button>
  <button class="sport-btn" id="sb-NBA" onclick="filterSport('NBA')">NBA</button>
  <button class="sport-btn" id="sb-WNBA" onclick="filterSport('WNBA')">WNBA</button>
  <button class="sport-btn" id="sb-NFL" onclick="filterSport('NFL')">NFL</button>
  <button class="sport-btn" id="sb-OTHER" onclick="filterSport('OTHER')">OTHER</button>
</div>

<div class="main">
  <input class="search-bar" id="search" placeholder="Search player name..." oninput="renderProps()"/>
  <div id="sharp-section" style="display:none;">
    <div class="section-title" style="color:#00E5A0;">
      <span style="width:8px;height:8px;border-radius:50%;background:#00E5A0;box-shadow:0 0 8px #00E5A0;display:inline-block;animation:pulse 1.5s infinite;"></span>
      SHARP EDGES DETECTED
      <span id="sharp-count" class="count-badge" style="color:#00E5A0;border-color:rgba(0,229,160,0.3);background:rgba(0,229,160,0.1);"></span>
    </div>
    <div id="sharp-list"></div>
  </div>

  <div id="lean-section" style="display:none;margin-top:16px;">
    <div class="section-title" style="color:#FFD166;">
      LEAN CANDIDATES
      <span id="lean-count" class="count-badge" style="color:#FFD166;border-color:rgba(255,209,102,0.3);background:rgba(255,209,102,0.1);"></span>
    </div>
    <div id="lean-list"></div>
  </div>

  <div id="all-section" style="display:none;margin-top:16px;">
    <div class="section-title" style="color:#4A4E6A;">
      ALL PROPS â <span id="all-count">0</span> LOADED
      <span id="last-update" style="font-size:8px;color:#2A2E45;font-weight:400;margin-left:auto;"></span>
    </div>
    <div id="all-list"></div>
  </div>

  <div id="empty-state" class="empty">
    <div style="font-size:28px;margin-bottom:10px;">â¡</div>
    <div style="font-size:12px;margin-bottom:6px;">Tap SCAN FOR VALUE to start</div>
    <div style="font-size:10px;color:#2A2E45;">Automatically finds sharp edges across all sports</div>
  </div>
</div>

<style>
@keyframes pulse{0%,100%{opacity:1;}50%{opacity:.4;}}
</style>

<script>
// âââ 2026 PLAYER DATABASE âââââââââââââââââââââââââââââââââââââââââââââââââââââ
// Format: 'Player Name_Stat Type': { avg, sport, note }
// OR 'Player Name': { stat, avg, sport, note } for primary stat
const DB = {
  // ââ MLB PITCHERS â STRIKEOUTS ââ
  'Zack Wheeler_Strikeouts':        { avg: 7.2,  sport: 'MLB', note: 'Elite May â 1.67 ERA, 30:5 K:BB' },
  'Max Meyer_Strikeouts':           { avg: 6.2,  sport: 'MLB', note: '5-0, 2.52 ERA, 68 Ks in 60.2 IP' },
  'MacKenzie Gore_Strikeouts':      { avg: 5.5,  sport: 'MLB', note: '62 Ks, short outing risk last 5 starts' },
  'Spencer Arrighetti_Strikeouts':  { avg: 5.5,  sport: 'MLB', note: 'Road K/9 6.89 vs Home 10.18' },
  'Grant Holmes_Strikeouts':        { avg: 4.2,  sport: 'MLB', note: '25 Ks in 32.1 IP â 4.2 avg' },
  'Jack Flaherty_Strikeouts':       { avg: 4.6,  sport: 'MLB', note: '5.94 ERA, command issues' },
  'Chris Sale_Strikeouts':          { avg: 7.8,  sport: 'MLB', note: 'Elite 2026 â 1.89 ERA' },
  'Braxton Ashcraft_Strikeouts':    { avg: 6.5,  sport: 'MLB', note: '3-2, 2.89 ERA, 65 Ks' },
  'Lucas Giolito_Strikeouts':       { avg: 3.0,  sport: 'MLB', note: 'Only 1 MLB start â 3 Ks' },
  'Chris Paddack_Strikeouts':       { avg: 4.5,  sport: 'MLB', note: 'Limited 2026 data' },
  'Freddy Peralta_Strikeouts':      { avg: 5.7,  sport: 'MLB', note: '3-4, 3.52 ERA' },
  'George Kirby_Strikeouts':        { avg: 5.0,  sport: 'MLB', note: 'Contact pitcher â low K upside' },
  'Luis Severino_Strikeouts':       { avg: 5.8,  sport: 'MLB', note: 'Athletics â solid K rate' },
  'Justin Wrobleski_Strikeouts':    { avg: 3.4,  sport: 'MLB', note: 'Low K rate â 3.4 avg' },

  // ââ MLB PITCHERS â WALKS ALLOWED ââ
  'Jack Flaherty_Walks Allowed':    { avg: 2.9,  sport: 'MLB', note: '14% walk rate â career worst' },
  'Grant Holmes_Walks Allowed':     { avg: 2.3,  sport: 'MLB', note: '14 BB in 32.1 IP' },
  'Lucas Giolito_Walks Allowed':    { avg: 3.5,  sport: 'MLB', note: '3 walks in debut, career 3.5 avg' },
  'Max Meyer_Walks Allowed':        { avg: 3.3,  sport: 'MLB', note: '22 BB in 60.2 IP â 3.3 per start' },
  'Zack Wheeler_Walks Allowed':     { avg: 1.8,  sport: 'MLB', note: 'Elite command â 30:5 K:BB in May' },
  'Spencer Arrighetti_Walks Allowed':{ avg: 2.8, sport: 'MLB', note: '4 straight starts with 3+ walks' },
  'MacKenzie Gore_Walks Allowed':   { avg: 2.2,  sport: 'MLB', note: 'Moderate walk rate' },

  // ââ MLB PITCHERS â EARNED RUNS ââ
  'Zack Wheeler_Earned Runs Allowed':   { avg: 0.8,  sport: 'MLB', note: '0 ERs last 2 starts, 1.67 ERA in May' },
  'Max Meyer_Earned Runs Allowed':      { avg: 1.5,  sport: 'MLB', note: '2.52 ERA â 1.5 avg per start' },
  'Grant Holmes_Earned Runs Allowed':   { avg: 2.0,  sport: 'MLB', note: '3.62 ERA â 2.0 avg per start' },
  'Jack Flaherty_Earned Runs Allowed':  { avg: 3.2,  sport: 'MLB', note: '5.94 ERA â allows runs regularly' },
  'Chris Sale_Earned Runs Allowed':     { avg: 0.9,  sport: 'MLB', note: '1.89 ERA â elite run prevention' },
  'Lucas Giolito_Earned Runs Allowed':  { avg: 2.5,  sport: 'MLB', note: '5.40 ERA â 1 MLB start' },
  'MacKenzie Gore_Earned Runs Allowed': { avg: 2.2,  sport: 'MLB', note: 'Moderate ERA' },
  'Chris Paddack_Earned Runs Allowed':  { avg: 2.5,  sport: 'MLB', note: '5 runs in 10 IP last 2 starts' },

  // ââ MLB PITCHERS â HITS ALLOWED ââ
  'Zack Wheeler_Hits Allowed':      { avg: 3.5,  sport: 'MLB', note: '0.77 WHIP â elite hit prevention' },
  'Max Meyer_Hits Allowed':         { avg: 3.8,  sport: 'MLB', note: '1.05 WHIP â solid hit prevention' },
  'Grant Holmes_Hits Allowed':      { avg: 4.8,  sport: 'MLB', note: '1.00 WHIP â 4-5 hits per start' },
  'Jack Flaherty_Hits Allowed':     { avg: 5.5,  sport: 'MLB', note: 'Command issues â allows more contact' },
  'Chris Sale_Hits Allowed':        { avg: 3.2,  sport: 'MLB', note: 'Elite â 0.89 WHIP' },
  'MacKenzie Gore_Hits Allowed':    { avg: 4.5,  sport: 'MLB', note: 'Average hit rate' },
  'Lucas Giolito_Hits Allowed':     { avg: 2.0,  sport: 'MLB', note: '1 hit in debut â tiny sample' },
  'Chris Paddack_Hits Allowed':     { avg: 6.5,  sport: 'MLB', note: '13 hits in 10 IP last 2 starts' },

  // ââ MLB PITCHERS â PITCHING OUTS ââ
  'Zack Wheeler_Pitching Outs':     { avg: 18.5, sport: 'MLB', note: '7.1, 6.0, 6.0 IP last 3 starts' },
  'Max Meyer_Pitching Outs':        { avg: 18.0, sport: 'MLB', note: '7.0 IP last start â 60.2 IP total' },
  'Grant Holmes_Pitching Outs':     { avg: 14.4, sport: 'MLB', note: '4 of 4 starts under 16.5 outs' },
  'Jack Flaherty_Pitching Outs':    { avg: 13.5, sport: 'MLB', note: 'Short outings â command issues' },
  'Chris Sale_Pitching Outs':       { avg: 18.0, sport: 'MLB', note: 'Goes deep â quality start machine' },
  'MacKenzie Gore_Pitching Outs':   { avg: 15.0, sport: 'MLB', note: 'Hasnt cleared 5 frames last 5 starts' },
  'Lucas Giolito_Pitching Outs':    { avg: 15.0, sport: 'MLB', note: '5+ innings in debut' },
  'Chris Paddack_Pitching Outs':    { avg: 15.0, sport: 'MLB', note: '10 IP in 2 starts avg 5 IP' },

  // ââ NBA PLAYERS â POINTS ââ
  'Shai Gilgeous-Alexander_Points': { avg: 31.4, sport: 'NBA', note: 'MVP favorite â elite scorer' },
  'Victor Wembanyama_Points':       { avg: 26.4, sport: 'NBA', note: 'Elite scorer â foul trouble risk' },
  "De'Aaron Fox_Points":            { avg: 18.6, sport: 'NBA', note: 'Ankle limiting scoring' },
  'Nikola Jokic_Points':            { avg: 26.2, sport: 'NBA', note: 'Triple double machine' },
  'Luka Doncic_Points':             { avg: 29.0, sport: 'NBA', note: 'Elite scorer' },
  'Jayson Tatum_Points':            { avg: 26.9, sport: 'NBA', note: 'Celtics star' },
  'Anthony Edwards_Points':         { avg: 27.6, sport: 'NBA', note: 'Explosive scorer' },
  'Isaiah Hartenstein_Points':      { avg: 9.5,  sport: 'NBA', note: 'Role player â floater specialist' },

  // ââ NBA PLAYERS â REBOUNDS ââ
  'Isaiah Hartenstein_Rebounds':    { avg: 9.2,  sport: 'NBA', note: 'Elite rebounder for his role' },
  'Nikola Jokic_Rebounds':          { avg: 12.7, sport: 'NBA', note: 'Best rebounder in NBA' },
  'Victor Wembanyama_Rebounds':     { avg: 10.6, sport: 'NBA', note: 'Elite rebounder' },
  "De'Aaron Fox_Rebounds":          { avg: 3.8,  sport: 'NBA', note: 'Guard â limited rebounding' },

  // ââ NBA PLAYERS â ASSISTS ââ
  "De'Aaron Fox_Assists":           { avg: 6.2,  sport: 'NBA', note: 'Elite playmaker' },
  'Nikola Jokic_Assists':           { avg: 9.8,  sport: 'NBA', note: 'Best passing big in NBA' },
  'Shai Gilgeous-Alexander_Assists':{ avg: 6.4,  sport: 'NBA', note: 'Two-way star' },

  // ââ NBA PLAYERS â PRA ââ
  'Isaiah Hartenstein_Points+Rebounds+Assists': { avg: 21.5, sport: 'NBA', note: '81% hit rate at 21+ min' },
  "De'Aaron Fox_Points+Rebounds+Assists":       { avg: 28.6, sport: 'NBA', note: 'Ankle limiting but still producing' },
  'Nikola Jokic_Points+Rebounds+Assists':       { avg: 52.0, sport: 'NBA', note: 'Dominant all-around' },

  // ââ NBA PLAYERS â R+A ââ
  "De'Aaron Fox_Rebounds+Assists":  { avg: 11.1, sport: 'NBA', note: '100% hit rate WCF (3/3)' },

  // ââ WNBA PLAYERS ââ
  'Caitlin Clark_Points':           { avg: 22.3, sport: 'WNBA', note: 'Elite scorer â back injury monitor' },
  'Caitlin Clark_Assists':          { avg: 9.0,  sport: 'WNBA', note: '4 straight games 9+ assists' },
  'Paige Bueckers_Points':          { avg: 22.1, sport: 'WNBA', note: 'Elite scorer vs weak defenses' },
  "A'ja Wilson_Points":             { avg: 27.0, sport: 'WNBA', note: 'Best player in WNBA' },
  'Kelsey Mitchell_Points':         { avg: 22.3, sport: 'WNBA', note: '22.3 PPG but GSV matchup concern' },
  'Sabrina Ionescu_Points':         { avg: 18.5, sport: 'WNBA', note: 'Elite scorer and shooter' },
  'Breanna Stewart_Points':         { avg: 22.0, sport: 'WNBA', note: 'Liberty star' },
  'Arike Ogunbowale_Points':        { avg: 23.1, sport: 'WNBA', note: 'Wings â volume scorer' },
  'Gabby Williams_Points':          { avg: 16.0, sport: 'WNBA', note: 'Volatile â 7 to 19 range' },
  'Gabby Williams_Rebounds':        { avg: 6.0,  sport: 'WNBA', note: '6.0 RPG but minutes dependent' },
};

// Smart lookup â tries player+stat combo then fuzzy match
function getAvg(player, stat) {
  // Direct combo key
  const key = player + '_' + stat;
  if (DB[key]) return DB[key];
  
  // Try stat variations
  // EXACT PrizePicks stat names from API
  const statVariants = {
    // MLB Pitcher
    'Pitcher Strikeouts': 'Strikeouts',
    'Pitcher Strikeouts (Combo)': 'Strikeouts',
    'Pitching Outs': 'Pitching Outs',
    'Hits Allowed': 'Hits Allowed',
    'Earned Runs Allowed': 'Earned Runs Allowed',
    'Walks Allowed': 'Walks Allowed',
    '1st Inning Runs Allowed': null,
    '1st Inning Walks Allowed': null,
    'Pitcher Fantasy Score': null,
    'Pitches Thrown': null,
    // MLB Hitter
    'Hits': null,
    'Total Bases': null,
    'Hits+Runs+RBIs': null,
    'Hitter Strikeouts': null,
    'Walks': null,
    'RBIs': null,
    'Runs': null,
    'Singles': null,
    'Doubles': null,
    'Home Runs': null,
    'Stolen Bases': null,
    'Triples': null,
    'Hitter Fantasy Score': null,
    // NBA
    'Points': 'Points',
    'Total Rebounds': 'Rebounds',
    'Rebounds': 'Rebounds',
    'Assists': 'Assists',
    'PTS+AST+RB': 'Points+Rebounds+Assists',
    'PTS+RB': 'Points+Rebounds',
    'PTS+AST': 'Points+Assists',
    'RB+AST': 'Rebounds+Assists',
    '3-Point Field Goals Made': '3PM',
    'Blocks': 'Blocks',
    'Steals': 'Steals',
  };
  
  const mappedStat = statVariants[stat] || stat;
  if (!mappedStat) return null;
  
  const key2 = player + '_' + mappedStat;
  if (DB[key2]) return DB[key2];
  
  return null;
}

function getCushion(avg, line, stat) {
  // Lower is better for certain stats
  const lowerStats = ['ERA', 'WHIP', 'Earned Runs'];
  const isLower = lowerStats.some(s => stat.includes(s));
  return isLower ? line - avg : avg - line;
}

function getVerdict(cushion) {
  if (cushion >= 2.0) return { label: 'STRONG LOCK', color: '#00E5A0', tier: 'sharp' };
  if (cushion >= 1.5) return { label: 'LOCK', color: '#00E5A0', tier: 'sharp' };
  if (cushion >= 1.0) return { label: 'LEAN', color: '#FFD166', tier: 'lean' };
  if (cushion >= 0.5) return { label: 'MONITOR', color: '#4D9EFF', tier: 'lean' };
  return { label: 'PASS', color: '#4A4E6A', tier: 'pass' };
}

// âââ STATE âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
let allProps = [];
let filteredProps = [];
let currentSport = 'ALL';
let lastFetch = null;
let isScanning = false;

// âââ FETCH âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
async function startScan() {
  if (isScanning) return;
  isScanning = true;
  document.getElementById('scan-btn').disabled = true;
  document.getElementById('scan-btn').textContent = 'â³ SCANNING...';
  setStatus('Waking server...', '#FFD166');
  document.getElementById('empty-state').style.display = 'none';

  try {
    // Wake server
    try { await fetch('https://sharp-model-production.up.railway.app/health'); } catch(e) {}
    
    setStatus('Pulling live props...', '#FFD166');
    
    const res = await fetch('https://sharp-model-production.up.railway.app/props', {
      cache: 'no-cache',
    });
    
    if (!res.ok) throw new Error('Server error ' + res.status);
    const data = await res.json();
    
    allProps = (data.props || []).filter(p => p.line > 0 && p.sport !== 'OTHER');
    lastFetch = data.lastFetch;
    
    setStatus('â ' + allProps.length + ' props â scanning for edges...', '#00E5A0');
    document.getElementById('last-update').textContent = lastFetch ? 'Updated ' + new Date(lastFetch).toLocaleTimeString() : '';
    
    analyzeAndRender();
    
    // Auto-refresh every 30 min
    setTimeout(startScan, 30 * 60 * 1000);
    
  } catch(err) {
    setStatus('â  ' + (err.name === 'AbortError' ? 'Timeout â tap scan again' : err.message), '#FF4D6D');
    document.getElementById('empty-state').style.display = 'block';
  }
  
  isScanning = false;
  document.getElementById('scan-btn').disabled = false;
  document.getElementById('scan-btn').textContent = 'â» REFRESH SCAN';
}

function setStatus(msg, color) {
  const el = document.getElementById('status-badge');
  el.textContent = msg;
  el.style.color = color;
  el.style.borderColor = color + '44';
  el.style.background = color + '11';
}

// âââ ANALYZE âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
function analyzeAndRender() {
  // Score every prop
  const scored = allProps.map(p => {
    const dbEntry = getAvg(p.player, p.stat);
    if (!dbEntry) return { ...p, cushion: null, verdict: null, dbEntry: null };
    
    const cushion = getCushion(dbEntry.avg, p.line, p.stat);
    const verdict = getVerdict(cushion);
    const direction = cushion > 0 ? 'HIGHER' : 'LOWER';
    
    return { ...p, cushion, verdict, dbEntry, direction, avg: dbEntry.avg };
  });

  // Sort by cushion desc
  scored.sort((a, b) => (Math.abs(b.cushion || 0)) - (Math.abs(a.cushion || 0)));
  
  filteredProps = scored;
  renderProps();
}

// âââ RENDER ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
function filterSport(sport) {
  currentSport = sport;
  ['ALL','MLB','NBA','WNBA','NFL','OTHER'].forEach(s => {
    const btn = document.getElementById('sb-' + s);
    if (!btn) return;
    btn.className = 'sport-btn' + (s === sport ? ' active' : '');
  });
  renderProps();
}

function renderProps() {
  const search = document.getElementById('search').value.toLowerCase();
  const sport = currentSport;
  
  let props = filteredProps.filter(p => {
    if (sport !== 'ALL' && p.sport !== sport) return false;
    if (search && !p.player.toLowerCase().includes(search) && !p.stat.toLowerCase().includes(search)) return false;
    return true;
  });

  const sharp = props.filter(p => p.verdict?.tier === 'sharp');
  const lean  = props.filter(p => p.verdict?.tier === 'lean');
  const all   = props.filter(p => !p.verdict || p.verdict.tier === 'pass');

  // Sharp section
  const sharpSection = document.getElementById('sharp-section');
  const sharpList = document.getElementById('sharp-list');
  document.getElementById('sharp-count').textContent = sharp.length + ' FOUND';
  if (sharp.length) {
    sharpSection.style.display = 'block';
    sharpList.innerHTML = sharp.map(p => propCard(p, 'green')).join('');
  } else {
    sharpSection.style.display = filteredProps.length ? 'block' : 'none';
    sharpList.innerHTML = filteredProps.length ? '<div style="font-size:11px;color:#4A4E6A;padding:10px 0;">No strong edges in current filter â try ALL sports</div>' : '';
  }

  // Lean section
  const leanSection = document.getElementById('lean-section');
  const leanList = document.getElementById('lean-list');
  document.getElementById('lean-count').textContent = lean.length + ' FOUND';
  leanSection.style.display = lean.length ? 'block' : 'none';
  leanList.innerHTML = lean.map(p => propCard(p, 'yellow')).join('');

  // All section
  const allSection = document.getElementById('all-section');
  document.getElementById('all-count').textContent = props.length;
  document.getElementById('prop-count').textContent = (sharp.length + lean.length) + ' EDGES';
  allSection.style.display = props.length ? 'block' : 'none';
  document.getElementById('all-list').innerHTML = all.slice(0, 50).map(p => propCard(p, 'blue')).join('');
}

const SPORT_COLORS = { MLB:'#4ECDC4', NBA:'#FF6B35', WNBA:'#FF6B9D', NFL:'#45B7D1', NHL:'#96CEB4' };

function propCard(p, tier) {
  const vc = p.verdict?.color || '#4A4E6A';
  const sc = SPORT_COLORS[p.sport] || '#888';
  const hasEdge = p.cushion !== null && p.verdict;
  const cushionPct = hasEdge ? Math.min(Math.abs(p.cushion) / 3 * 100, 100) : 0;
  
  return \`<div class="prop-card \${tier}" onclick="copyProp('\${p.player.replace(/'/g,"\\\\'")}','\${p.stat}',\${p.line},'\${p.sport}')">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:4px;">
      <div>
        <span class="player-name">\${p.player}</span>
        \${p.flash ? '<span class="flash-badge">â¡ FLASH</span>' : ''}
      </div>
      <div style="display:flex;gap:5px;align-items:center;flex-shrink:0;">
        <span class="sport-tag" style="background:\${sc}22;color:\${sc};border:1px solid \${sc}44;">\${p.sport}</span>
        \${hasEdge ? \`<span class="edge-badge" style="background:\${vc}18;color:\${vc};border:1px solid \${vc}44;">\${p.verdict.label}</span>\` : ''}
      </div>
    </div>
    <div style="display:flex;align-items:baseline;gap:4px;margin-bottom:\${hasEdge?'6px':'0'};">
      <span class="prop-line">\${p.line}</span>
      <span class="prop-stat">\${p.stat}</span>
    </div>
    \${hasEdge ? \`
      <div style="font-size:10px;color:\${vc};margin-bottom:4px;">
        \${p.direction} â avg \${p.avg} â cushion \${p.cushion > 0 ? '+' : ''}\${p.cushion.toFixed(1)}
      </div>
      <div style="font-size:9px;color:#4A4E6A;margin-bottom:6px;">\${p.dbEntry.note}</div>
      <div class="cushion-bar">
        <div class="cushion-fill" style="width:\${cushionPct}%;background:\${vc};"></div>
      </div>
    \` : ''}
    <div style="font-size:9px;color:#4D9EFF;margin-top:6px;letter-spacing:0.06em;">TAP TO COPY â SEND TO CLAUDE</div>
  </div>\`;
}

function copyProp(player, stat, line, sport) {
  try {
    const entry = getAvg(player, stat);
    const avg = entry ? entry.avg : '?';
    const rawCushion = entry ? (entry.avg - line) : 0;
    const cushion = rawCushion.toFixed(1);
    const dir = rawCushion > 0 ? 'HIGHER' : 'LOWER';
    const note = entry ? entry.note : '';
    const msg = player + ' | ' + stat + ' ' + line + ' ' + dir + ' | Avg: ' + avg + ' | Cushion: ' + cushion + (note ? ' | ' + note : '');
    const el = document.getElementById('selected-prop');
    if (el) {
      el.innerHTML = '<strong style="color:#00E5A0">SELECTED: </strong>' + msg + '<br><span style="color:#4A4E6A;font-size:9px;">Read this to Claude for full analysis</span>';
      el.style.display = 'block';
    }
    setStatus('Selected: ' + player, '#00E5A0');
  } catch(e) {
    console.log('copyProp error:', e);
  }
}
</script>
<div id="selected-prop" style="display:none;position:fixed;bottom:0;left:0;right:0;background:#0B0D16;border-top:2px solid #00E5A0;padding:12px 16px;font-size:11px;color:#C8CCE0;line-height:1.6;z-index:999;"></div>
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
  if (url === "/health") {
    res.writeHead(200);
    res.end(JSON.stringify({ status: "ok", count: cachedProps.length, uptime: process.uptime() }));
    return;
  }
  res.writeHead(404);
  res.end(JSON.stringify({ error: "not found" }));
});

var PORT = process.env.PORT || 3000;
server.listen(PORT, "0.0.0.0", function() { console.log("Sharp server on port " + PORT); });
