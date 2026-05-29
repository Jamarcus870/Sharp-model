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
var server = http.createServer(function(req, res) {
  setCORS(res);
  res.setHeader("Content-Type", "application/json");
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }
  var url = req.url.split("?")[0];
  if (url === "/props" || url === "/") {
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
