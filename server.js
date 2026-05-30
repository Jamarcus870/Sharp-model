var https = require("https");
var http = require("http");
var fs = require("fs");
var path = require("path");

var cachedProps = [];
var lastFetch = null;
var playerStats = {};
var lastStatsUpdate = null;

function setCORS(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS, HEAD");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept");
}

function httpGet(hostname, pathStr, headers, callback) {
  var opts = {
    hostname: hostname,
    path: pathStr,
    method: "GET",
    headers: headers || { "User-Agent": "Mozilla/5.0", "Accept": "application/json" }
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
  req.setTimeout(20000, function() { req.destroy(); callback(new Error("Timeout")); });
  req.end();
}

var MLB_OFF_RATINGS = {
  "LAD":1,"NYY":2,"ATL":3,"HOU":4,"NYM":5,"PHI":6,"BOS":7,"SEA":8,"TOR":9,"SD":10,
  "CLE":11,"MIN":12,"ARI":13,"BAL":14,"STL":15,"CIN":16,"MIL":17,"CHC":18,"SF":19,"TB":20,
  "TEX":21,"PIT":22,"MIA":23,"DET":24,"COL":25,"LAA":26,"OAK":27,"KC":28,"CWS":29,"WAS":30
};

var NBA_DEF_RATINGS = {
  "OKC":1,"BOS":2,"MIN":3,"NYK":4,"MIL":5,"IND":6,"CLE":7,"LAL":8,"PHX":9,"MIA":10,
  "DEN":11,"GSW":12,"PHI":13,"ATL":14,"TOR":15,"CHI":16,"NOP":17,"MEM":18,"UTA":19,"SAS":20,
  "ORL":21,"BKN":22,"POR":23,"LAC":24,"HOU":25,"DAL":26,"SAC":27,"DET":28,"CHA":29,"WAS":30
};

function getOpponentPenalty(sport, team) {
  if (sport === "MLB") {
    var r = MLB_OFF_RATINGS[team] || 15;
    if (r <= 5) return -0.3;
    if (r <= 10) return -0.15;
    if (r >= 21) return 0.15;
  }
  if (sport === "NBA") {
    var d = NBA_DEF_RATINGS[team] || 15;
    if (d <= 5) return -0.2;
    if (d <= 10) return -0.1;
    if (d >= 21) return 0.15;
  }
  return 0;
}

function fetchMLBGameLogs() {
  console.log("Fetching MLB stats...");
  httpGet("statsapi.mlb.com", "/api/v1/stats?stats=season&group=pitching&season=2026&limit=300&sportId=1",
    { "User-Agent": "Mozilla/5.0", "Accept": "application/json" },
    function(err, data) {
      if (err) { console.error("MLB error:", err.message); return; }
      try {
        var splits = (data.stats && data.stats[0] && data.stats[0].splits) || [];
        var pitchers = [];
        splits.forEach(function(s) {
          var gs = parseInt((s.stat && s.stat.gamesStarted) || 0);
          if (gs >= 3 && s.player) pitchers.push({ id: s.player.id, name: s.player.fullName });
        });
        var idx = 0, done = 0, total = pitchers.length;
        function fetchOne() {
          if (idx >= total) return;
          var pitcher = pitchers[idx++];
          httpGet("statsapi.mlb.com",
            "/api/v1/people/" + pitcher.id + "/stats?stats=gameLog&group=pitching&season=2026&sportId=1",
            { "User-Agent": "Mozilla/5.0", "Accept": "application/json" },
            function(err2, data2) {
              if (!err2) {
                try {
                  var gl = (data2.stats && data2.stats[0] && data2.stats[0].splits) || [];
                  var starts = gl.filter(function(g) { return g.stat && parseInt(g.stat.gamesStarted) > 0; });
                  if (starts.length >= 3) processMLBGameLog(pitcher.name, starts);
                } catch(e2) {}
              }
              done++;
              if (done === total) { lastStatsUpdate = new Date().toISOString(); console.log("MLB done, keys:", Object.keys(playerStats).length); }
              fetchOne();
            }
          );
        }
        for (var i = 0; i < Math.min(5, total); i++) fetchOne();
      } catch(e) { console.error("MLB parse:", e.message); }
    }
  );
}

function processMLBGameLog(name, starts) {
  starts.sort(function(a,b) { return new Date(b.date) - new Date(a.date); });
  var recent = starts.slice(0, 10);
  var weights = [0.4, 0.3, 0.2, 0.1];
  function calc(getter) {
    var vals = recent.map(getter).filter(function(v) { return !isNaN(v); });
    if (vals.length < 3) return null;
    var avg = vals.reduce(function(a,b){return a+b;},0) / vals.length;
    var l4 = vals.slice(0, 4), rw = 0, wt = 0;
    l4.forEach(function(v,i) { rw += v*(weights[i]||0.05); wt += (weights[i]||0.05); });
    return { avg: +(avg.toFixed(1)), rwProj: +(rw/wt).toFixed(1), games: vals.length, raw: vals };
  }
  var ks = calc(function(g){ return parseFloat(g.stat.strikeOuts)||0; });
  var bb = calc(function(g){ return parseFloat(g.stat.baseOnBalls)||0; });
  var er = calc(function(g){ return parseFloat(g.stat.earnedRuns)||0; });
  var h  = calc(function(g){ return parseFloat(g.stat.hits)||0; });
  var ip = calc(function(g){ return parseFloat(g.stat.inningsPitched||0)*3; });
  if (ks) playerStats[name+"_Pitcher Strikeouts"] = ks;
  if (bb) playerStats[name+"_Walks Allowed"] = bb;
  if (er) playerStats[name+"_Earned Runs Allowed"] = er;
  if (h)  playerStats[name+"_Hits Allowed"] = h;
  if (ip) playerStats[name+"_Pitching Outs"] = ip;
}

function fetchNBAGameLogs() {
  console.log("Fetching NBA stats...");
  httpGet("stats.nba.com",
    "/stats/leaguedashplayerstats?LeagueID=00&Season=2025-26&SeasonType=Playoffs&MeasureType=Base&PerMode=PerGame&PaceAdjust=N&PlusMinus=N&Rank=N&PORound=0&Month=0&Period=0&LastNGames=0&OpponentTeamID=0&TeamID=0&TwoWay=0",
    { "User-Agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36","Accept":"application/json","Referer":"https://www.nba.com/","Origin":"https://www.nba.com","x-nba-stats-origin":"stats","x-nba-stats-token":"true" },
    function(err, data) {
      if (err) { console.error("NBA error:", err.message); return; }
      try {
        var headers = data.resultSets && data.resultSets[0] && data.resultSets[0].headers;
        var rows = data.resultSets && data.resultSets[0] && data.resultSets[0].rowSet;
        if (!headers || !rows) return;
        var idx = {};
        headers.forEach(function(h,i){ idx[h]=i; });
        rows.forEach(function(row) {
          var name = row[idx["PLAYER_NAME"]];
          var gp = row[idx["GP"]] || 0;
          if (!name || gp < 2) return;
          var pts = parseFloat(row[idx["PTS"]])||0;
          var reb = parseFloat(row[idx["REB"]])||0;
          var ast = parseFloat(row[idx["AST"]])||0;
          if (pts>0) playerStats[name+"_Points"] = { avg:+pts.toFixed(1), games:gp };
          if (reb>0) playerStats[name+"_Rebounds"] = { avg:+reb.toFixed(1), games:gp };
          if (ast>0) playerStats[name+"_Assists"] = { avg:+ast.toFixed(1), games:gp };
          if (pts&&reb) playerStats[name+"_Pts+Rebs"] = { avg:+(pts+reb).toFixed(1), games:gp };
          if (pts&&ast) playerStats[name+"_Pts+Asts"] = { avg:+(pts+ast).toFixed(1), games:gp };
          if (reb&&ast) playerStats[name+"_Rebs+Asts"] = { avg:+(reb+ast).toFixed(1), games:gp };
          if (pts&&reb&&ast) playerStats[name+"_Pts+Rebs+Asts"] = { avg:+(pts+reb+ast).toFixed(1), games:gp };
        });
        console.log("NBA done:", rows.length, "players");
      } catch(e) { console.error("NBA parse:", e.message); }
    }
  );
}

function fetchWNBAGameLogs() {
  console.log("Fetching WNBA stats...");
  httpGet("stats.wnba.com",
    "/stats/leaguedashplayerstats?LeagueID=10&Season=2026&SeasonType=Regular+Season&MeasureType=Base&PerMode=PerGame&PaceAdjust=N&PlusMinus=N&Rank=N&Month=0&Period=0&LastNGames=0&OpponentTeamID=0&TeamID=0",
    { "User-Agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36","Accept":"application/json","Referer":"https://www.wnba.com/","Origin":"https://www.wnba.com","x-nba-stats-origin":"stats","x-nba-stats-token":"true" },
    function(err, data) {
      if (err) { console.error("WNBA error:", err.message); return; }
      try {
        var headers = data.resultSets && data.resultSets[0] && data.resultSets[0].headers;
        var rows = data.resultSets && data.resultSets[0] && data.resultSets[0].rowSet;
        if (!headers || !rows) return;
        var idx = {};
        headers.forEach(function(h,i){ idx[h]=i; });
        rows.forEach(function(row) {
          var name = row[idx["PLAYER_NAME"]];
          var gp = row[idx["GP"]] || 0;
          if (!name || gp < 2) return;
          var pts = parseFloat(row[idx["PTS"]])||0;
          var reb = parseFloat(row[idx["REB"]])||0;
          var ast = parseFloat(row[idx["AST"]])||0;
          if (pts>0) playerStats[name+"_Points"] = { avg:+pts.toFixed(1), games:gp };
          if (reb>0) playerStats[name+"_Rebounds"] = { avg:+reb.toFixed(1), games:gp };
          if (ast>0) playerStats[name+"_Assists"] = { avg:+ast.toFixed(1), games:gp };
          if (pts&&reb) playerStats[name+"_Pts+Rebs"] = { avg:+(pts+reb).toFixed(1), games:gp };
          if (pts&&ast) playerStats[name+"_Pts+Asts"] = { avg:+(pts+ast).toFixed(1), games:gp };
          if (reb&&ast) playerStats[name+"_Rebs+Asts"] = { avg:+(reb+ast).toFixed(1), games:gp };
          if (pts&&reb&&ast) playerStats[name+"_Pts+Rebs+Asts"] = { avg:+(pts+reb+ast).toFixed(1), games:gp };
        });
        lastStatsUpdate = new Date().toISOString();
        console.log("WNBA done:", rows.length, "players");
      } catch(e) { console.error("WNBA parse:", e.message); }
    }
  );
}

function fetchProps() {
  var opts = {
    hostname: "api.prizepicks.com",
    path: "/projections?per_page=250&single_stat=true",
    method: "GET",
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      "Accept": "application/json, text/plain, */*",
      "Accept-Language": "en-US,en;q=0.9",
      "Referer": "https://app.prizepicks.com/board",
      "Origin": "https://app.prizepicks.com",
      "Cache-Control": "no-cache"
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
            var attrs = proj.attributes || {};
            var line = parseFloat(attrs.line_score || attrs.stat_score || 0);
            if (line > 0) props.push({ id:proj.id, player:player.name||"Unknown", team:player.team||"", sport:sport, stat:attrs.stat_type||attrs.stat_display_name||"", line:line, flash:attrs.flash_sale_line_score||null, gameTime:attrs.start_time||null });
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

// EXACT WHITELIST - only these stats get scored
var STAT_MAP = {
  "Pitcher Strikeouts":       "Pitcher Strikeouts",
  "Pitcher Strikeouts (Combo)":"Pitcher Strikeouts",
  "Pitching Outs":            "Pitching Outs",
  "Hits Allowed":             "Hits Allowed",
  "Earned Runs Allowed":      "Earned Runs Allowed",
  "Walks Allowed":            "Walks Allowed",
  "Points":                   "Points",
  "Rebounds":                 "Rebounds",
  "Assists":                  "Assists",
  "Pts+Rebs+Asts":            "Pts+Rebs+Asts",
  "Pts+Rebs":                 "Pts+Rebs",
  "Pts+Asts":                 "Pts+Asts",
  "Rebs+Asts":                "Rebs+Asts"
};

var MAX_LINES = {
  "Pitcher Strikeouts":12, "Walks Allowed":6, "Earned Runs Allowed":7,
  "Hits Allowed":10, "Pitching Outs":24, "Points":55, "Rebounds":25,
  "Assists":20, "Pts+Rebs+Asts":70, "Pts+Rebs":65, "Pts+Asts":60, "Rebs+Asts":35
};

function calcHitRate(raw, line, dir) {
  if (!raw || raw.length < 3) return null;
  var hits = raw.filter(function(v) { return dir === "HIGHER" ? v >= line : v <= line; });
  return +(hits.length / raw.length * 100).toFixed(0);
}

function getTier(cushion, hr) {
  if (cushion >= 2.0 && hr >= 75) return "STRONG LOCK";
  if (cushion >= 1.5 && hr >= 65) return "LOCK";
  if (cushion >= 1.0 && (hr >= 70 || hr === null)) return "LEAN";
  if (cushion >= 0.5) return "MONITOR";
  return null;
}

function scoreProps(props) {
  // Deduplicate: one line per player+stat (closest to average)
  var seen = {}, deduped = [];
  props.forEach(function(prop) {
    if (!(prop.stat in STAT_MAP)) return;
    var mapped = STAT_MAP[prop.stat];
    if (!mapped) return;
    if (MAX_LINES[mapped] && prop.line > MAX_LINES[mapped]) return;
    var key = prop.player + "_" + mapped;
    var entry = playerStats[key];
    if (!entry) return; // Skip unknown players
    var avg = entry.rwProj || entry.avg;
    var diff = Math.abs(prop.line - avg);
    if (!seen[key] || diff < seen[key].diff) {
      seen[key] = { diff: diff };
      deduped = deduped.filter(function(p) { return (p.player+"_"+(STAT_MAP[p.stat]||p.stat)) !== key; });
      deduped.push(prop);
    }
  });

  var results = [];
  deduped.forEach(function(prop) {
    var mapped = STAT_MAP[prop.stat];
    var entry = playerStats[prop.player + "_" + mapped];
    if (!entry) return;
    var avg = entry.rwProj || entry.avg;
    var line = prop.line;
    var overC = +(avg - line).toFixed(2);
    var underC = +(line - avg).toFixed(2);
    var penalty = getOpponentPenalty(prop.sport, prop.team);

    if (overC >= 0.5) {
      var adj = +(overC + penalty).toFixed(2);
      var hr = entry.raw ? calcHitRate(entry.raw, line, "HIGHER") : null;
      var tier = getTier(adj, hr !== null ? hr : 70);
      if (tier) results.push({ id:prop.id+"_H", player:prop.player, team:prop.team, sport:prop.sport, stat:prop.stat, line:line, direction:"HIGHER", cushion:adj, tier:tier, avg:entry.avg, rwProj:entry.rwProj||entry.avg, hitRate:hr, games:entry.games, flash:prop.flash, gameTime:prop.gameTime });
    }
    if (underC >= 0.5) {
      var adj2 = +(underC + penalty).toFixed(2);
      var hr2 = entry.raw ? calcHitRate(entry.raw, line, "LOWER") : null;
      var tier2 = getTier(adj2, hr2 !== null ? hr2 : 70);
      if (tier2) results.push({ id:prop.id+"_L", player:prop.player, team:prop.team, sport:prop.sport, stat:prop.stat, line:line, direction:"LOWER", cushion:adj2, tier:tier2, avg:entry.avg, rwProj:entry.rwProj||entry.avg, hitRate:hr2, games:entry.games, flash:prop.flash, gameTime:prop.gameTime });
    }
  });

  results.sort(function(a,b) { return b.cushion - a.cushion; });
  return results;
}

fetchProps();
fetchMLBGameLogs();
fetchNBAGameLogs();
fetchWNBAGameLogs();
setInterval(fetchProps, 25 * 60 * 1000);
setInterval(function() { fetchMLBGameLogs(); fetchNBAGameLogs(); fetchWNBAGameLogs(); }, 6 * 60 * 60 * 1000);

var SCANNER_HTML = fs.readFileSync(path.join(__dirname, "sharp-scanner.html"), "utf8");

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

  if (url === "/health") {
    res.writeHead(200);
    res.end(JSON.stringify({ status:"ok", props:cachedProps.length, statsPlayers:Object.keys(playerStats).length, lastFetch:lastFetch, lastStatsUpdate:lastStatsUpdate, uptime:process.uptime() }));
    return;
  }

  if (url === "/props") {
    res.writeHead(200);
    res.end(JSON.stringify({ props:cachedProps, count:cachedProps.length, lastFetch:lastFetch, status:"ok" }));
    return;
  }

  if (url === "/edges") {
    var edges = scoreProps(cachedProps);
    res.writeHead(200);
    res.end(JSON.stringify({ edges:edges, count:edges.length, statsPlayers:Object.keys(playerStats).length, status:"ok" }));
    return;
  }

  if (url === "/refresh") {
    fetchProps();
    res.writeHead(200);
    res.end(JSON.stringify({ status:"ok", message:"refresh triggered", time:new Date().toISOString() }));
    return;
  }

  if (url === "/score" && req.method === "POST") {
    var body = "";
    req.on("data", function(chunk) { body += chunk; });
    req.on("end", function() {
      try {
        var parsed = JSON.parse(body);
        var edges = scoreProps(parsed.props || []);
        res.writeHead(200);
        res.end(JSON.stringify({ edges:edges, count:edges.length, statsPlayers:Object.keys(playerStats).length, status:"ok" }));
      } catch(e) { res.writeHead(400); res.end(JSON.stringify({ error:e.message })); }
    });
    return;
  }

  if (url === "/stats-db") {
    res.writeHead(200);
    res.end(JSON.stringify(playerStats));
    return;
  }

  if (url === "/bookmarklet.js") {
    res.setHeader("Content-Type", "application/javascript");
    res.writeHead(200);
    res.end('(function() { var ex = document.getElementById(\'sharp-overlay\'); if (ex) { ex.remove(); return; } var overlay = document.createElement(\'div\'); overlay.id = \'sharp-overlay\'; overlay.style.cssText = \'position:fixed;top:0;left:0;right:0;bottom:0;background:#060810;z-index:2147483647;overflow-y:auto;font-family:monospace;padding:16px;-webkit-overflow-scrolling:touch;\'; overlay.innerHTML = \'<div style="color:#00E5A0;font-size:16px;font-weight:700;letter-spacing:0.2em;margin-bottom:4px;">â¡ SHARP SCANNER</div><button onclick="document.getElementById(\\\'sharp-overlay\\\').remove()" style="position:fixed;top:12px;right:12px;background:#1E2235;border:none;color:#C8CCE0;padding:8px 14px;border-radius:4px;cursor:pointer;font-size:12px;font-family:monospace;z-index:2147483648;">â</button><div id="sharp-status" style="color:#FFD166;font-size:11px;margin-bottom:12px;">Reading lines...</div><div id="sharp-results"></div>\'; document.body.appendChild(overlay); var statusEl = document.getElementById(\'sharp-status\'); var resultsEl = document.getElementById(\'sharp-results\'); var apiPaths = [ \'/api/v1/projections?per_page=250&single_stat=true\', \'/api/v2/projections?per_page=250&single_stat=true\', \'https: ]; function tryFetch(pathIndex) { if (pathIndex >= apiPaths.length) { statusEl.innerHTML = \'<span style="color:#FF4D6D;">Could not reach PrizePicks API. Try refreshing PrizePicks first.</span>\'; return; } var path = apiPaths[pathIndex]; statusEl.innerHTML = \'Trying API path \' + (pathIndex + 1) + \'...\'; fetch(path, { headers: { \'Accept\': \'application/json\' } }) .then(function(r) { if (!r.ok) throw new Error(\'Status \' + r.status); return r.json(); }) .then(function(ppData) { var players = {}, leagues = {}; (ppData.included || []).forEach(function(item) { if (item.type === \'new_player\') players[item.id] = { name: (item.attributes||{}).name||\'Unknown\', team: (item.attributes||{}).team||\'\' }; if (item.type === \'league\') leagues[item.id] = (item.attributes||{}).name||\'\'; }); var props = []; (ppData.data || []).forEach(function(proj) { try { var pid = proj.relationships.new_player.data.id; var lid = proj.relationships.league.data.id; var player = players[pid] || {}; var ln = (leagues[lid]||\'\').toUpperCase(); var sport = \'OTHER\'; if (ln.indexOf(\'NBA\')>-1) sport=\'NBA\'; else if (ln.indexOf(\'MLB\')>-1) sport=\'MLB\'; else if (ln.indexOf(\'WNBA\')>-1) sport=\'WNBA\'; else if (ln.indexOf(\'NFL\')>-1) sport=\'NFL\'; var attrs = proj.attributes||{}; var line = parseFloat(attrs.line_score||attrs.stat_score||0); if (line>0) props.push({id:proj.id,player:player.name||\'Unknown\',team:player.team||\'\',sport:sport,stat:attrs.stat_type||attrs.stat_display_name||\'\',line:line,flash:attrs.flash_sale_line_score||null}); } catch(e) {} }); statusEl.innerHTML = \'Got \' + props.length + \' props â scoring...\'; scoreProps(props); }) .catch(function() { tryFetch(pathIndex + 1); }); } function scoreProps(props) { fetch(\'https: method: \'POST\', headers: { \'Content-Type\': \'application/json\' }, body: JSON.stringify({ props: props }) }) .then(function(r) { return r.json(); }) .then(function(data) { var edges = data.edges || []; var strong = edges.filter(function(e) { return e.tier === \'STRONG LOCK\'; }); var locks = edges.filter(function(e) { return e.tier === \'LOCK\'; }); var leans = edges.filter(function(e) { return e.tier === \'LEAN\'; }); statusEl.innerHTML = \'<span style="color:#00E5A0;">â \' + edges.length + \' edges found â \' + data.statsPlayers + \' players tracked</span>\'; var SC = { MLB:\'#4ECDC4\', NBA:\'#FF6B35\', WNBA:\'#FF6B9D\', NFL:\'#45B7D1\' }; function card(e, color) { var sc = SC[e.sport] || \'#888\'; var dc = e.direction === \'HIGHER\' ? \'#00E5A0\' : \'#FF6B9D\'; return \'<div style="background:#0B0D16;border:1px solid \' + color + \'33;border-left:3px solid \' + color + \';border-radius:6px;padding:10px 12px;margin-bottom:8px;">\' + \'<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">\' + \'<span style="font-size:13px;font-weight:700;color:#E0E0E8;">\' + e.player + \'</span>\' + \'<span style="font-size:8px;font-weight:700;background:\' + sc + \'22;color:\' + sc + \';border:1px solid \' + sc + \'44;padding:2px 6px;border-radius:2px;">\' + e.sport + \'</span>\' + \'</div>\' + \'<div style="font-size:18px;font-weight:700;color:#FF8C42;">\' + e.line + \' <span style="font-size:11px;color:#4A4E6A;">\' + e.stat + \'</span> <span style="font-size:12px;font-weight:700;color:\' + dc + \';">\' + e.direction + \'</span></div>\' + \'<div style="font-size:10px;color:\' + color + \';margin-top:4px;">Avg \' + e.avg + \' â cushion +\' + e.cushion + (e.hitRate ? \' | \' + e.hitRate + \'% hit rate\' : \'\') + \'</div>\' + \'</div>\'; } var html = \'\'; if (strong.length) { html += \'<div style="color:#00E5A0;font-size:9px;font-weight:700;letter-spacing:0.15em;margin-bottom:8px;">ð STRONG LOCKS (\' + strong.length + \')</div>\'; strong.forEach(function(e) { html += card(e, \'#00E5A0\'); }); } if (locks.length) { html += \'<div style="color:#00E5A0;font-size:9px;font-weight:700;letter-spacing:0.15em;margin-bottom:8px;margin-top:12px;">LOCKS (\' + locks.length + \')</div>\'; locks.forEach(function(e) { html += card(e, \'#00E5A0\'); }); } if (leans.length) { html += \'<div style="color:#FFD166;font-size:9px;font-weight:700;letter-spacing:0.15em;margin-bottom:8px;margin-top:12px;">LEANS (\' + leans.length + \')</div>\'; leans.forEach(function(e) { html += card(e, \'#FFD166\'); }); } if (!edges.length) html += \'<div style="color:#4A4E6A;padding:20px;text-align:center;">No edges found right now.<br><span style="font-size:10px;">Check back when more games are posted.</span></div>\'; resultsEl.innerHTML = html; }) .catch(function(err) { statusEl.innerHTML = \'<span style="color:#FF4D6D;">Scoring error: \' + err.message + \'</span>\'; }); } tryFetch(0); })();');
    return;
  }

  if (url === "/bookmarklet") {
    res.setHeader("Content-Type", "text/html");
    res.writeHead(200);
    res.end('<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sharp Bookmarklet Setup</title><style>body{background:#060810;color:#C8CCE0;font-family:monospace;padding:20px;max-width:600px;margin:0 auto}.logo{color:#00E5A0;font-size:18px;font-weight:700;letter-spacing:.2em;margin-bottom:4px}.sub{color:#4A4E6A;font-size:10px;letter-spacing:.12em;margin-bottom:24px}.step{background:#0B0D16;border:1px solid #1E2235;border-radius:8px;padding:16px;margin-bottom:12px}.step-num{color:#00E5A0;font-size:10px;font-weight:700;letter-spacing:.15em;margin-bottom:8px}.step-text{font-size:12px;line-height:1.8;color:#C8CCE0}.highlight{color:#00E5A0;font-weight:700}.code{background:#060810;border:1px solid #1E2235;border-radius:4px;padding:10px;font-size:10px;color:#FFD166;word-break:break-all;cursor:pointer;margin-top:8px}.btn{display:block;width:100%;background:linear-gradient(135deg,#00E5A0,#4D9EFF);color:#060810;border:none;border-radius:6px;padding:12px;font-size:12px;font-family:monospace;font-weight:700;letter-spacing:.15em;cursor:pointer;margin-top:10px;text-align:center}.ok{color:#00E5A0;font-size:11px;margin-top:6px;display:none}</style></head><body><div class="logo">â¡ SHARP SCANNER</div><div class="sub">BOOKMARKLET SETUP</div><div class="step"><div class="step-num">STEP 1 â BOOKMARK ANY PAGE</div><div class="step-text">In Safari open any page. Tap <span class="highlight">Share</span> â <span class="highlight">Add Bookmark</span> â name it <span class="highlight">â¡ Sharp</span> â Save.</div></div><div class="step"><div class="step-num">STEP 2 â EDIT THE BOOKMARK</div><div class="step-text">Tap the <span class="highlight">book icon</span> in Safari â find <span class="highlight">â¡ Sharp</span> â tap <span class="highlight">Edit</span> â tap the bookmark â delete the URL â paste the code below.</div><div class="code" id="bm-code" onclick="copyCode()">TAP TO COPY BOOKMARKLET CODE</div><button class="btn" onclick="copyCode()">ð COPY CODE</button><div class="ok" id="ok-msg">â Copied! Paste into the bookmark URL field.</div></div><div class="step"><div class="step-num">STEP 3 â USE IT</div><div class="step-text">1. Open <span class="highlight">prizepicks.com</span> in Safari<br>2. Tap bookmarks â tap <span class="highlight">â¡ Sharp</span><br>3. Sharp edges appear instantly â STRONG LOCKS at top</div></div><script>var BM = ' + repr('javascript:' + code_clean) + ';document.getElementById("bm-code").textContent=BM;function copyCode(){try{navigator.clipboard.writeText(BM);}catch(e){}var t=document.createElement("textarea");t.value=BM;document.body.appendChild(t);t.select();document.execCommand("copy");document.body.removeChild(t);document.getElementById("ok-msg").style.display="block";}</script></body></html>');
    return;
  }

  res.writeHead(404);
  res.end(JSON.stringify({ error:"not found" }));
});

var PORT = process.env.PORT || 3000;
server.listen(PORT, "0.0.0.0", function() { console.log("Sharp server on port", PORT); });
