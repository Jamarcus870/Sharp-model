const https = require('https');
const http = require('http');

let cachedProps = [];
let lastFetch = null;

// Fetch props from PrizePicks
function fetchProps() {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.prizepicks.com',
      path: '/projections?per_page=250&single_stat=true',
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0',
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);

          // Build player lookup
          const players = {};
          const leagues = {};
          if (json.included) {
            json.included.forEach(item => {
              if (item.type === 'new_player') {
                players[item.id] = {
                  name: item.attributes?.name || 'Unknown',
                  team: item.attributes?.team || '',
                };
              }
              if (item.type === 'league') {
                leagues[item.id] = item.attributes?.name || '';
              }
            });
          }

          // Parse props
          const props = (json.data || []).map(proj => {
            const playerId = proj.relationships?.new_player?.data?.id;
            const leagueId = proj.relationships?.league?.data?.id;
            const player = players[playerId] || {};
            const leagueName = leagues[leagueId] || '';
            const ln = leagueName.toUpperCase();
            let sport = 'OTHER';
            if (ln.includes('NBA')) sport = 'NBA';
            else if (ln.includes('MLB')) sport = 'MLB';
            else if (ln.includes('WNBA')) sport = 'WNBA';
            else if (ln.includes('NFL')) sport = 'NFL';
            else if (ln.includes('NHL')) sport = 'NHL';

            const attrs = proj.attributes || {};
            return {
              id: proj.id,
              player: player.name || 'Unknown',
              team: player.team || '',
              sport,
              stat: attrs.stat_type || attrs.stat_display_name || '—',
              line: parseFloat(attrs.line_score || attrs.stat_score || 0),
              flash: attrs.flash_sale_line_score || null,
              isPromo: attrs.is_promo || false,
              gameTime: attrs.start_time || null,
              opponent: attrs.opponent_name || '',
            };
          }).filter(p => p.line > 0);

          cachedProps = props;
          lastFetch = new Date().toISOString();
          console.log(`Fetched ${props.length} props at ${lastFetch}`);
          resolve(props);
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', reject);
    req.end();
  });
}

// Refresh every 30 minutes
fetchProps().catch(err => console.error('Initial fetch failed:', err.message));
setInterval(() => {
  fetchProps().catch(err => console.error('Refresh failed:', err.message));
}, 30 * 60 * 1000);

// HTTP server
const server = http.createServer((req, res) => {
  // CORS headers — allow Sharp Terminal on Netlify
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  if (req.url === '/props' || req.url === '/') {
    res.writeHead(200);
    res.end(JSON.stringify({
      props: cachedProps,
      count: cachedProps.length,
      lastFetch,
      status: 'ok'
    }));
    return;
  }

  if (req.url === '/health') {
    res.writeHead(200);
    res.end(JSON.stringify({ status: 'ok', lastFetch, count: cachedProps.length }));
    return;
  }

  res.writeHead(404);
  res.end(JSON.stringify({ error: 'Not found' }));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Sharp server running on port ${PORT}`);
});
