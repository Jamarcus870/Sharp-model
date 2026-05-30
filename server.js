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

// ─── HTTP GET HELPER ─────────────────────────────────────────────────────────
function httpGet(hostname, path, headers, callback) {
  var opts = {
    hostname: hostname,
    path: path,
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

// ─── OPPONENT QUALITY RATINGS ─────────────────────────────────────────────
// Lower = better defense (harder for players to score)
// Scale 1-30, 1 = best defense, 30 = worst defense
var NBA_DEF_RATINGS = {
  "OKC": 1, "BOS": 2, "MIN": 3, "NYK": 4, "MIL": 5,
  "IND": 6, "CLE": 7, "LAL": 8, "PHX": 9, "MIA": 10,
  "DEN": 11, "GSW": 12, "PHI": 13, "ATL": 14, "TOR": 15,
  "CHI": 16, "NOP": 17, "MEM": 18, "UTA": 19, "SAS": 20,
  "ORL": 21, "BKN": 22, "POR": 23, "LAC": 24, "HOU": 25,
  "DAL": 26, "SAC": 27, "DET": 28, "CHA": 29, "WAS": 30
};

// MLB team offense ratings (higher = better offense = harder for pitcher unders)
var MLB_OFF_RATINGS = {
  "LAD": 1, "NYY": 2, "ATL": 3, "HOU": 4, "NYM": 5,
  "PHI": 6, "BOS": 7, "SEA": 8, "TOR": 9, "SD": 10,
  "CLE": 11, "MIN": 12, "ARI": 13, "BAL": 14, "STL": 15,
  "CIN": 16, "MIL": 17, "CHC": 18, "SF": 19, "TB": 20,
  "TEX": 21, "PIT": 22, "MIA": 23, "DET": 24, "COL": 25,
  "LAA": 26, "OAK": 27, "KC": 28, "CWS": 29, "WAS": 30
};

function getOpponentPenalty(sport, opponentTeam, propType) {
  if (sport === "MLB") {
    var rank = MLB_OFF_RATINGS[opponentTeam] || 15;
    // Top 5 offenses = -0.3 cushion penalty on pitcher unders
    if (rank <= 5) return -0.3;
    // Top 10 = -0.15
    if (rank <= 10) return -0.15;
    // Bottom 10 offenses = +0.15 bonus on pitcher unders
    if (rank >= 21) return 0.15;
  }
  if (sport === "NBA") {
    var defRank = NBA_DEF_RATINGS[opponentTeam] || 15;
    // Top 5 defenses = -0.2 cushion penalty on player overs
    if (defRank <= 5) return -0.2;
    if (defRank <= 10) return -0.1;
    // Bottom 10 defenses = +0.15 bonus
    if (defRank >= 21) return 0.15;
  }
  return 0;
}

// ─── MLB GAME LOGS (Official MLB API - free) ─────────────────────────────
function fetchMLBGameLogs() {
  console.log("Fetching MLB pitcher game logs...");
  // Get all pitchers with season stats first
  httpGet("statsapi.mlb.com", "/api/v1/stats?stats=season&group=pitching&season=2026&limit=300&sportId=1", {
    "User-Agent": "Mozilla/5.0",
    "Accept": "application/json"
  }, function(err, data) {
    if (err) { console.error("MLB season stats error:", err.message); return; }
    try {
      var splits = (data.stats && data.stats[0] && data.stats[0].splits) || [];
      var pitchers = [];
      splits.forEach(function(s) {
        var gs = parseInt((s.stat && s.stat.gamesStarted) || 0);
        if (gs >= 3 && s.player) {
          pitchers.push({ id: s.player.id, name: s.player.fullName, gs: gs });
        }
      });
      console.log("Fetching game logs for", pitchers.length, "pitchers");
      // Fetch game logs for each pitcher (stagger to avoid rate limits)
      // Fetch up to 5 pitchers concurrently for faster startup
      var idx = 0;
      var active = 0;
      var CONCURRENCY = 5;
      var total = pitchers.length;
      var done = 0;

      function fetchOne() {
        if (idx >= total) return;
        var pitcher = pitchers[idx++];
        active++;
        httpGet("statsapi.mlb.com",
          "/api/v1/people/" + pitcher.id + "/stats?stats=gameLog&group=pitching&season=2026&sportId=1",
          { "User-Agent": "Mozilla/5.0", "Accept": "application/json" },
          function(err2, data2) {
            if (!err2) {
              try {
                var glSplits = (data2.stats && data2.stats[0] && data2.stats[0].splits) || [];
                var starts = glSplits.filter(function(g) {
                  return g.stat && parseInt(g.stat.gamesStarted) > 0;
                });
                if (starts.length >= 3) {
                  processMLBGameLog(pitcher.name, starts);
                }
              } catch(e2) {}
            }
            active--;
            done++;
            if (done === total) {
              console.log("MLB game logs complete, total keys:", Object.keys(playerStats).length);
              lastStatsUpdate = new Date().toISOString();
            }
            // Fetch next batch
            fetchOne();
          }
        );
      }

      // Start initial batch of concurrent requests
      for (var i = 0; i < Math.min(CONCURRENCY, total); i++) {
        fetchOne();
      }
    } catch(e) { console.error("MLB season stats parse:", e.message); }
  });
}

function processMLBGameLog(name, starts) {
  // Sort newest first
  starts.sort(function(a, b) {
    return new Date(b.date) - new Date(a.date);
  });

  var recent = starts.slice(0, 10); // Last 10 starts
  var last4 = starts.slice(0, 4);   // Last 4 for recency weighting
  var weights = [0.4, 0.3, 0.2, 0.1];

  function calcStats(statKey, getter) {
    var vals = recent.map(getter).filter(function(v) { return !isNaN(v); });
    if (vals.length < 3) return null;
    
    // Season avg
    var avg = vals.reduce(function(a,b){return a+b;},0) / vals.length;
    
    // Recency weighted projection (last 4)
    var l4 = vals.slice(0, 4);
    var rwTotal = 0, wTotal = 0;
    l4.forEach(function(v, i) {
      rwTotal += v * (weights[i] || 0.05);
      wTotal += (weights[i] || 0.05);
    });
    var rwProj = wTotal > 0 ? rwTotal / wTotal : avg;
    
    return { avg: +avg.toFixed(1), rwProj: +rwProj.toFixed(1), games: vals.length, raw: vals };
  }

  function hitRate(vals, line, dir) {
    if (!vals || !vals.length) return 0;
    var hits = vals.filter(function(v) { return dir === "over" ? v >= line : v <= line; });
    return +(hits.length / vals.length * 100).toFixed(0);
  }

  var ksStats  = calcStats("ks",  function(g) { return parseFloat(g.stat.strikeOuts) || 0; });
  var bbStats  = calcStats("bb",  function(g) { return parseFloat(g.stat.baseOnBalls) || 0; });
  var erStats  = calcStats("er",  function(g) { return parseFloat(g.stat.earnedRuns) || 0; });
  var hStats   = calcStats("h",   function(g) { return parseFloat(g.stat.hits) || 0; });
  var ipStats  = calcStats("ip",  function(g) { return parseFloat(g.stat.inningsPitched || 0) * 3; });

  if (ksStats) playerStats[name + "_Pitcher Strikeouts"] = { avg: ksStats.avg, rwProj: ksStats.rwProj, games: ksStats.games, raw: ksStats.raw, hitRateFn: function(line) { return hitRate(ksStats.raw, line, "over"); } };
  if (bbStats) playerStats[name + "_Walks Allowed"] = { avg: bbStats.avg, rwProj: bbStats.rwProj, games: bbStats.games, raw: bbStats.raw };
  if (erStats) playerStats[name + "_Earned Runs Allowed"] = { avg: erStats.avg, rwProj: erStats.rwProj, games: erStats.games, raw: erStats.raw };
  if (hStats)  playerStats[name + "_Hits Allowed"] = { avg: hStats.avg, rwProj: hStats.rwProj, games: hStats.games, raw: hStats.raw };
  if (ipStats) playerStats[name + "_Pitching Outs"] = { avg: ipStats.avg, rwProj: ipStats.rwProj, games: ipStats.games, raw: ipStats.raw };
}

// ─── NBA GAME LOGS (stats.nba.com - free) ────────────────────────────────
function fetchNBAGameLogs() {
  console.log("Fetching NBA game logs...");
  httpGet("stats.nba.com",
    "/stats/leaguedashplayerstats?College=&Conference=&Country=&DateFrom=&DateTo=&Division=&DraftPick=&DraftYear=&GameScope=&GameSegment=&Height=&LastNGames=0&LeagueID=00&Location=&MeasureType=Base&Month=0&OpponentTeamID=0&Outcome=&PORound=0&PaceAdjust=N&PerMode=PerGame&Period=0&PlayerExperience=&PlayerPosition=&PlusMinus=N&Rank=N&Season=2025-26&SeasonSegment=&SeasonType=Playoffs&ShotClockRange=&StarterBench=&TeamID=0&TwoWay=0&VsConference=&VsDivision=&Weight=",
    {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      "Accept": "application/json, text/plain, */*",
      "Accept-Language": "en-US,en;q=0.9",
      "Referer": "https://www.nba.com/",
      "Origin": "https://www.nba.com",
      "x-nba-stats-origin": "stats",
      "x-nba-stats-token": "true"
    },
    function(err, data) {
      if (err) { console.error("NBA stats error:", err.message); return; }
      try {
        var headers = data.resultSets && data.resultSets[0] && data.resultSets[0].headers;
        var rows = data.resultSets && data.resultSets[0] && data.resultSets[0].rowSet;
        if (!headers || !rows) { console.error("NBA: no data"); return; }
        
        var idx = {};
        headers.forEach(function(h, i) { idx[h] = i; });
        
        rows.forEach(function(row) {
          var name = row[idx["PLAYER_NAME"]];
          var gp = row[idx["GP"]] || 0;
          if (!name || gp < 2) return;
          
          var pts = parseFloat(row[idx["PTS"]]) || 0;
          var reb = parseFloat(row[idx["REB"]]) || 0;
          var ast = parseFloat(row[idx["AST"]]) || 0;
          var stl = parseFloat(row[idx["STL"]]) || 0;
          var blk = parseFloat(row[idx["BLK"]]) || 0;
          var tov = parseFloat(row[idx["TOV"]]) || 0;
          var fg3m = parseFloat(row[idx["FG3M"]]) || 0;

          if (pts > 0) playerStats[name + "_Points"] = { avg: +pts.toFixed(1), games: gp };
          if (reb > 0) playerStats[name + "_Rebounds"] = { avg: +reb.toFixed(1), games: gp };
          if (ast > 0) playerStats[name + "_Assists"] = { avg: +ast.toFixed(1), games: gp };
          if (stl > 0) playerStats[name + "_Steals"] = { avg: +stl.toFixed(1), games: gp };
          if (blk > 0) playerStats[name + "_Blocked Shots"] = { avg: +blk.toFixed(1), games: gp };
          if (fg3m > 0) playerStats[name + "_3-PT Made"] = { avg: +fg3m.toFixed(1), games: gp };
          if (tov > 0) playerStats[name + "_Turnovers"] = { avg: +tov.toFixed(1), games: gp };
          if (pts && reb) playerStats[name + "_Pts+Rebs"] = { avg: +(pts+reb).toFixed(1), games: gp };
          if (pts && ast) playerStats[name + "_Pts+Asts"] = { avg: +(pts+ast).toFixed(1), games: gp };
          if (reb && ast) playerStats[name + "_Rebs+Asts"] = { avg: +(reb+ast).toFixed(1), games: gp };
          if (pts && reb && ast) playerStats[name + "_Pts+Rebs+Asts"] = { avg: +(pts+reb+ast).toFixed(1), games: gp };
          if (stl && blk) playerStats[name + "_Blks+Stls"] = { avg: +(stl+blk).toFixed(1), games: gp };
        });
        console.log("NBA stats loaded:", rows.length, "players");
      } catch(e) { console.error("NBA parse:", e.message); }
    }
  );
}

// ─── WNBA GAME LOGS (stats.wnba.com - free) ──────────────────────────────
function fetchWNBAGameLogs() {
  console.log("Fetching WNBA stats...");
  httpGet("stats.wnba.com",
    "/stats/leaguedashplayerstats?College=&Conference=&Country=&DateFrom=&DateTo=&Division=&DraftPick=&DraftYear=&GameScope=&GameSegment=&Height=&LastNGames=0&LeagueID=10&Location=&MeasureType=Base&Month=0&OpponentTeamID=0&Outcome=&PORound=0&PaceAdjust=N&PerMode=PerGame&Period=0&PlayerExperience=&PlayerPosition=&PlusMinus=N&Rank=N&Season=2026&SeasonSegment=&SeasonType=Regular+Season&ShotClockRange=&StarterBench=&TeamID=0&TwoWay=0&VsConference=&VsDivision=&Weight=",
    {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      "Accept": "application/json, text/plain, */*",
      "Accept-Language": "en-US,en;q=0.9",
      "Referer": "https://www.wnba.com/",
      "Origin": "https://www.wnba.com",
      "x-nba-stats-origin": "stats",
      "x-nba-stats-token": "true"
    },
    function(err, data) {
      if (err) { console.error("WNBA stats error:", err.message); return; }
      try {
        var headers = data.resultSets && data.resultSets[0] && data.resultSets[0].headers;
        var rows = data.resultSets && data.resultSets[0] && data.resultSets[0].rowSet;
        if (!headers || !rows) { console.error("WNBA: no data"); return; }
        
        var idx = {};
        headers.forEach(function(h, i) { idx[h] = i; });
        
        rows.forEach(function(row) {
          var name = row[idx["PLAYER_NAME"]];
          var gp = row[idx["GP"]] || 0;
          if (!name || gp < 2) return;
          
          var pts = parseFloat(row[idx["PTS"]]) || 0;
          var reb = parseFloat(row[idx["REB"]]) || 0;
          var ast = parseFloat(row[idx["AST"]]) || 0;
          var stl = parseFloat(row[idx["STL"]]) || 0;
          var blk = parseFloat(row[idx["BLK"]]) || 0;
          var fg3m = parseFloat(row[idx["FG3M"]]) || 0;

          if (pts > 0) playerStats[name + "_Points"] = { avg: +pts.toFixed(1), games: gp };
          if (reb > 0) playerStats[name + "_Rebounds"] = { avg: +reb.toFixed(1), games: gp };
          if (ast > 0) playerStats[name + "_Assists"] = { avg: +ast.toFixed(1), games: gp };
          if (stl > 0) playerStats[name + "_Steals"] = { avg: +stl.toFixed(1), games: gp };
          if (blk > 0) playerStats[name + "_Blocked Shots"] = { avg: +blk.toFixed(1), games: gp };
          if (fg3m > 0) playerStats[name + "_3-PT Made"] = { avg: +fg3m.toFixed(1), games: gp };
          if (pts && reb) playerStats[name + "_Pts+Rebs"] = { avg: +(pts+reb).toFixed(1), games: gp };
          if (pts && ast) playerStats[name + "_Pts+Asts"] = { avg: +(pts+ast).toFixed(1), games: gp };
          if (reb && ast) playerStats[name + "_Rebs+Asts"] = { avg: +(reb+ast).toFixed(1), games: gp };
          if (pts && reb && ast) playerStats[name + "_Pts+Rebs+Asts"] = { avg: +(pts+reb+ast).toFixed(1), games: gp };
        });
        console.log("WNBA stats loaded:", rows.length, "players");
        lastStatsUpdate = new Date().toISOString();
      } catch(e) { console.error("WNBA parse:", e.message); }
    }
  );
}

// ─── PRIZEPICKS PROPS ────────────────────────────────────────────────────
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
            if (line > 0) props.push({
              id: proj.id,
              player: player.name || "Unknown",
              team: player.team || "",
              sport: sport,
              stat: attrs.stat_type || attrs.stat_display_name || "",
              line: line,
              flash: attrs.flash_sale_line_score || null,
              gameTime: attrs.start_time || null
            });
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

// ─── STAT NAME MAPPING ────────────────────────────────────────────────────
var STAT_MAP = {
  // MLB PITCHER STATS ONLY
  "Pitcher Strikeouts": "Pitcher Strikeouts",
  "Pitcher Strikeouts (Combo)": "Pitcher Strikeouts",
  "Pitching Outs": "Pitching Outs",
  "Hits Allowed": "Hits Allowed",
  "Earned Runs Allowed": "Earned Runs Allowed",
  "Walks Allowed": "Walks Allowed",
  "1st Inning Runs Allowed": null,
  "1st Inning Walks Allowed": null,
  "Pitcher Fantasy Score": null,
  "Pitches Thrown": null,
  // MLB HITTER STATS - EXPLICITLY EXCLUDED
  "Total Bases": null,
  "Hits+Runs+RBIs": null,
  "Hitter Strikeouts": null,
  "Hits": null,
  "RBIs": null,
  "Runs": null,
  "Singles": null,
  "Doubles": null,
  "Home Runs": null,
  "Walks": null,
  "Stolen Bases": null,
  "Triples": null,
  "Hitter Fantasy Score": null,
  // NBA/WNBA PLAYER STATS
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
  "3-PT Made": "3-PT Made",
  "3-Point Field Goals Made": "3-PT Made",
  // EXPLICITLY EXCLUDE EVERYTHING ELSE
  "Fantasy Score": null,
  "Fantasy Points": null,
  "Double-Double": null,
  "Triple-Double": null
};

// ─── SCORING ENGINE ──────────────────────────────────────────────────────
function calcHitRate(raw, line, dir) {
  if (!raw || raw.length < 3) return null;
  var hits = raw.filter(function(v) { return dir === "HIGHER" ? v >= line : v <= line; });
  return +(hits.length / raw.length * 100).toFixed(0);
}

function getTier(cushion, hitRate) {
  // Both cushion AND hit rate must clear thresholds
  if (cushion >= 2.0 && hitRate >= 75) return "STRONG LOCK";
  if (cushion >= 1.5 && hitRate >= 75) return "LOCK";
  if (cushion >= 1.5 && hitRate >= 65) return "LOCK";
  if (cushion >= 1.0 && hitRate >= 70) return "LEAN";
  if (cushion >= 1.0 && hitRate === null) return "LEAN"; // No game log but avg supports it
  if (cushion >= 0.5) return "MONITOR";
  return null;
}

function getScoredProps() {
  // Deduplicate: keep only one line per player+stat combo
  // Pick the line closest to the player's average (most meaningful matchup)
  var seen = {};
  var dedupedProps = [];
  cachedProps.forEach(function(prop) {
    var mapped = STAT_MAP[prop.stat] || prop.stat;
    if (mapped === null) return;
    var key = prop.player + "_" + mapped;
    var entry = playerStats[key];
    if (!entry) {
      // No stats for this player/stat - still include once for display
      var dk = prop.player + "_" + prop.stat;
      if (!seen[dk]) { seen[dk] = true; dedupedProps.push(prop); }
      return;
    }
    var avg = entry.rwProj || entry.avg;
    var diff = Math.abs(prop.line - avg);
    if (!seen[key] || diff < seen[key].diff) {
      seen[key] = { diff: diff };
      // Remove any previous entry for this key
      dedupedProps = dedupedProps.filter(function(p) {
        var pm = STAT_MAP[p.stat] || p.stat;
        return (p.player + "_" + pm) !== key;
      });
      dedupedProps.push(prop);
    }
  });

  var results = [];
  dedupedProps.forEach(function(prop) {
    // Skip if stat is explicitly excluded (null) or unknown
    if (prop.stat in STAT_MAP && STAT_MAP[prop.stat] === null) return;
    var mapped = STAT_MAP[prop.stat] || prop.stat;

    // Realistic line limits — filter out impossible alt lines
    var MAX_LINES = {
      "Pitcher Strikeouts": 12,
      "Walks Allowed": 6,
      "Earned Runs Allowed": 7,
      "Hits Allowed": 10,
      "Pitching Outs": 24,
      "Points": 55,
      "Rebounds": 25,
      "Assists": 20,
      "Pts+Rebs+Asts": 70,
      "Pts+Rebs": 65,
      "Pts+Asts": 60,
      "Rebs+Asts": 35,
      "Blks+Stls": 10,
      "Steals": 5,
      "Blocked Shots": 6,
      "3-PT Made": 8
    };
    if (MAX_LINES[mapped] && prop.line > MAX_LINES[mapped]) return;

    var key = prop.player + "_" + mapped;
    var entry = playerStats[key];
    if (!entry) return;

    var avg = entry.rwProj || entry.avg; // Use recency-weighted proj if available
    var line = prop.line;

    var overC = +(avg - line).toFixed(2);
    var underC = +(line - avg).toFixed(2);

    // Apply opponent quality penalty
    var penalty = getOpponentPenalty(prop.sport, prop.team, prop.stat);

    if (overC >= 0.5) {
      var adjCushion = +(overC + penalty).toFixed(2);
      var hr = entry.raw ? calcHitRate(entry.raw, line, "HIGHER") : null;
      var tier = getTier(adjCushion, hr !== null ? hr : 70);
      if (tier) {
        results.push({
          id: prop.id + "_H",
          player: prop.player,
          team: prop.team,
          sport: prop.sport,
          stat: prop.stat,
          line: line,
          direction: "HIGHER",
          cushion: adjCushion,
          rawCushion: overC,
          tier: tier,
          avg: entry.avg,
          rwProj: entry.rwProj || entry.avg,
          hitRate: hr,
          games: entry.games,
          flash: prop.flash,
          gameTime: prop.gameTime,
          opponentPenalty: penalty
        });
      }
    }

    if (underC >= 0.5) {
      var adjCushion2 = +(underC + penalty).toFixed(2);
      var hr2 = entry.raw ? calcHitRate(entry.raw, line, "LOWER") : null;
      var tier2 = getTier(adjCushion2, hr2 !== null ? hr2 : 70);
      if (tier2) {
        results.push({
          id: prop.id + "_L",
          player: prop.player,
          team: prop.team,
          sport: prop.sport,
          stat: prop.stat,
          line: line,
          direction: "LOWER",
          cushion: adjCushion2,
          rawCushion: underC,
          tier: tier2,
          avg: entry.avg,
          rwProj: entry.rwProj || entry.avg,
          hitRate: hr2,
          games: entry.games,
          flash: prop.flash,
          gameTime: prop.gameTime,
          opponentPenalty: penalty
        });
      }
    }
  });  // close dedupedProps.forEach

  results.sort(function(a,b) { return b.cushion - a.cushion; });
  return results;
}

// ─── INIT ────────────────────────────────────────────────────────────────
fetchProps();
fetchMLBGameLogs();
fetchNBAGameLogs();
fetchWNBAGameLogs();

setInterval(fetchProps, 25 * 60 * 1000);
setInterval(function() {
  fetchMLBGameLogs();
  fetchNBAGameLogs();
  fetchWNBAGameLogs();
  console.log("Stats refresh cycle complete");
}, 6 * 60 * 60 * 1000);

// ─── SCANNER HTML ────────────────────────────────────────────────────────
var fs = require("fs");
var path = require("path");

var BOOKMARKLET_JS = `
(function() {
  // Remove existing overlay
  var ex = document.getElementById('ss-overlay');
  if (ex) { ex.remove(); return; }

  // Create overlay
  var overlay = document.createElement('div');
  overlay.id = 'ss-overlay';
  overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:#060810;z-index:2147483647;overflow-y:auto;font-family:monospace;padding:16px;-webkit-overflow-scrolling:touch;';
  overlay.innerHTML = '<div style="color:#00E5A0;font-size:16px;font-weight:700;letter-spacing:0.2em;margin-bottom:4px;">⚡ SHARP SCANNER</div><div style="color:#4A4E6A;font-size:9px;letter-spacing:0.12em;margin-bottom:16px;">READING PRIZEPICKS LINES...</div><button onclick="document.getElementById(\'ss-overlay\').remove()" style="position:fixed;top:16px;right:16px;background:#1E2235;border:none;color:#C8CCE0;padding:8px 14px;border-radius:4px;cursor:pointer;font-family:monospace;font-size:12px;z-index:2147483648;">✕ CLOSE</button><div id="ss-results" style="font-size:12px;color:#C8CCE0;margin-top:8px;">Reading props...</div>';
  document.body.appendChild(overlay);

  var resultsEl = document.getElementById('ss-results');

  // Fetch from PrizePicks API (same domain - no CORS)
  fetch('/api/v1/projections?per_page=250&single_stat=true', {
    headers: { 'Accept': 'application/json' }
  })
  .then(function(r) {
    if (!r.ok) throw new Error('API error ' + r.status);
    return r.json();
  })
  .then(function(ppData) {
    var players = {}, leagues = {};
    (ppData.included || []).forEach(function(item) {
      if (item.type === 'new_player') players[item.id] = { name: (item.attributes||{}).name||'Unknown', team: (item.attributes||{}).team||'' };
      if (item.type === 'league') leagues[item.id] = (item.attributes||{}).name||'';
    });
    var props = [];
    (ppData.data || []).forEach(function(proj) {
      try {
        var pid = proj.relationships.new_player.data.id;
        var lid = proj.relationships.league.data.id;
        var player = players[pid] || {};
        var ln = (leagues[lid]||'').toUpperCase();
        var sport = 'OTHER';
        if (ln.indexOf('NBA')>-1) sport='NBA';
        else if (ln.indexOf('MLB')>-1) sport='MLB';
        else if (ln.indexOf('WNBA')>-1) sport='WNBA';
        else if (ln.indexOf('NFL')>-1) sport='NFL';
        var attrs = proj.attributes||{};
        var line = parseFloat(attrs.line_score||attrs.stat_score||0);
        if (line>0) props.push({id:proj.id,player:player.name||'Unknown',team:player.team||'',sport:sport,stat:attrs.stat_type||attrs.stat_display_name||'',line:line,flash:attrs.flash_sale_line_score||null});
      } catch(e) {}
    });

    resultsEl.innerHTML = 'Got ' + props.length + ' props — scoring...';

    return fetch('https://sharp-model-production.up.railway.app/score', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ props: props })
    });
  })
  .then(function(r) { return r.json(); })
  .then(function(data) {
    var edges = data.edges || [];
    var strong = edges.filter(function(e) { return e.tier === 'STRONG LOCK'; });
    var locks = edges.filter(function(e) { return e.tier === 'LOCK'; });
    var leans = edges.filter(function(e) { return e.tier === 'LEAN'; });

    var SC = { MLB:'#4ECDC4', NBA:'#FF6B35', WNBA:'#FF6B9D', NFL:'#45B7D1' };

    function card(e, color) {
      var sc = SC[e.sport] || '#888';
      var dc = e.direction === 'HIGHER' ? '#00E5A0' : '#FF6B9D';
      return '<div style="background:#0B0D16;border:1px solid ' + color + '33;border-left:3px solid ' + color + ';border-radius:6px;padding:10px 12px;margin-bottom:8px;">' +
        '<div style="display:flex;justify-content:space-between;margin-bottom:3px;">' +
          '<span style="font-size:13px;font-weight:700;color:#E0E0E8;">' + e.player + '</span>' +
          '<span style="font-size:8px;font-weight:700;background:' + sc + '22;color:' + sc + ';border:1px solid ' + sc + '44;padding:1px 5px;border-radius:2px;">' + e.sport + '</span>' +
        '</div>' +
        '<div style="font-size:18px;font-weight:700;color:#FF8C42;">' + e.line + ' <span style="font-size:11px;color:#4A4E6A;">' + e.stat + '</span> <span style="font-size:12px;color:' + dc + ';">' + e.direction + '</span></div>' +
        '<div style="font-size:10px;color:' + color + ';margin-top:3px;">Avg ' + e.avg + ' → cushion +' + e.cushion + (e.hitRate ? ' | ' + e.hitRate + '% hit rate' : '') + '</div>' +
      '</div>';
    }

    var html = '<div style="color:#00E5A0;font-size:10px;font-weight:700;letter-spacing:0.15em;margin-bottom:12px;">' + edges.length + ' EDGES · ' + data.statsPlayers + ' PLAYERS TRACKED</div>';

    if (strong.length) {
      html += '<div style="color:#00E5A0;font-size:9px;font-weight:700;letter-spacing:0.15em;margin-bottom:8px;">🔒 STRONG LOCKS (' + strong.length + ')</div>';
      strong.forEach(function(e) { html += card(e, '#00E5A0'); });
    }
    if (locks.length) {
      html += '<div style="color:#00E5A0;font-size:9px;font-weight:700;letter-spacing:0.15em;margin-bottom:8px;margin-top:12px;">LOCKS (' + locks.length + ')</div>';
      locks.forEach(function(e) { html += card(e, '#00E5A0'); });
    }
    if (leans.length) {
      html += '<div style="color:#FFD166;font-size:9px;font-weight:700;letter-spacing:0.15em;margin-bottom:8px;margin-top:12px;">LEANS (' + leans.length + ')</div>';
      leans.forEach(function(e) { html += card(e, '#FFD166'); });
    }
    if (!edges.length) html += '<div style="color:#4A4E6A;padding:20px;text-align:center;">No edges found right now</div>';

    resultsEl.innerHTML = html;
  })
  .catch(function(err) {
    resultsEl.innerHTML = '<div style="color:#FF4D6D;">Error: ' + err.message + '</div>';
  });
})();
`;

var SCANNER_HTML = fs.readFileSync(path.join(__dirname, "sharp-scanner.html"), "utf8");

// ─── HTTP SERVER ─────────────────────────────────────────────────────────
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
    res.end(JSON.stringify({
      edges: edges,
      count: edges.length,
      statsPlayers: Object.keys(playerStats).length,
      lastStatsUpdate: lastStatsUpdate,
      status: "ok"
    }));
    return;
  }

  if (url === "/health") {
    res.writeHead(200);
    res.end(JSON.stringify({
      status: "ok",
      props: cachedProps.length,
      statsPlayers: Object.keys(playerStats).length,
      lastFetch: lastFetch,
      lastStatsUpdate: lastStatsUpdate,
      uptime: process.uptime()
    }));
    return;
  }

  if (url === "/stats-db") {
    res.writeHead(200);
    res.end(JSON.stringify(playerStats));
    return;
  }

  if (url === "/score" && req.method === "POST") {
    var body = "";
    req.on("data", function(chunk) { body += chunk; });
    req.on("end", function() {
      try {
        var parsed = JSON.parse(body);
        var props = parsed.props || [];
        var tempCache = cachedProps;
        cachedProps = props;
        var edges = getScoredProps();
        cachedProps = tempCache;
        if (props.length > 0) { cachedProps = props; lastFetch = new Date().toISOString(); }
        res.writeHead(200);
        res.end(JSON.stringify({ edges: edges, count: edges.length, statsPlayers: Object.keys(playerStats).length, status: "ok" }));
      } catch(e) { res.writeHead(400); res.end(JSON.stringify({ error: e.message })); }
    });
    return;
  }
  if (url === "/refresh") {
    fetchProps();
    res.writeHead(200);
    res.end(JSON.stringify({ status: "ok", message: "refresh triggered", time: new Date().toISOString() }));
    return;
  }

  if (url === "/score" && req.method === "POST") {
    var body = "";
    req.on("data", function(chunk) { body += chunk; });
    req.on("end", function() {
      try {
        var parsed = JSON.parse(body);
        var props = parsed.props || [];
        var tempCache = cachedProps;
        cachedProps = props;
        var edges = getScoredProps();
        cachedProps = tempCache;
        if (props.length > 0) { cachedProps = props; lastFetch = new Date().toISOString(); }
        res.writeHead(200);
        res.end(JSON.stringify({ edges: edges, count: edges.length, statsPlayers: Object.keys(playerStats).length, status: "ok" }));
      } catch(e) { res.writeHead(400); res.end(JSON.stringify({ error: e.message })); }
    });
    return;
  }

  if (url === "/bookmarklet.js") {
    res.setHeader("Content-Type", "application/javascript");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.writeHead(200);
    res.end(BOOKMARKLET_JS);
    return;
  }

  res.writeHead(404);
  res.end(JSON.stringify({ error: "not found" }));
});

var PORT = process.env.PORT || 3000;
server.listen(PORT, "0.0.0.0", function() {
  console.log("Sharp server v2 on port", PORT);
});
