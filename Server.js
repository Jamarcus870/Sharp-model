const https = require('https');
const http = require('http');

let cachedProps = [];
let lastFetch = null;

function setCORSHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, HEAD');
  res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  res.setHeader('Access-Control-Allow-Credentials', 'false');
  res.setHeader('Access-Control-Max-Age', '86400');
  res.setHeader('Vary', 'Origin');
}

function fetchProps() {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.prizepicks.com',
      path: '/projections?per_page=250&single_stat=true',
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
        'Accept-Language': 'en-US,en;q=0.9',
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
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
    req.setTimeout(20000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.end();
  });
}

fetchProps().catch(err => console.error('Initial fetch failed:', err.message));

setInterval(() => {
  fetchProps().catch(err => console.error('Refresh failed:', err.message));
}, 25 * 60 * 1000);

const server = http.createServer((req, res) => {
  setCORSHeaders(res);
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === 'HEAD') {
    res.writeHead(200);
    res.end();
    return;
  }

  const url = req.url.split('?')[0];

  if (url === '/props' || url === '/') {
    res.writeHead(200);
    res.end(JSON.stringify({
      props: cachedProps,
      count: cachedProps.length,
      lastFetch,
      status: 'ok'
    }));
    return;
  }

  if (url === '/health') {
    res.writeHead(200);
    res.end(JSON.stringify({
      status: 'ok',
      lastFetch,
      count: cachedProps.length,
      uptime: process.uptime()
    }));
    return;
  }

  res.writeHead(404);
  res.end(JSON.stringify({ error: 'Not found' }));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Sharp server running on port ${PORT}`);
});
