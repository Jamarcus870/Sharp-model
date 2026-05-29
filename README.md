# Sharp Server

Prop feed server for Sharp Terminal. Fetches PrizePicks props every 30 minutes and serves them with CORS headers so Sharp Terminal can access them from the browser.

## Endpoints

- `GET /props` — returns all current props
- `GET /health` — returns server status

## Deploy on Render

1. Push this repo to GitHub
1. Connect to Render.com
1. Create a new Web Service
1. Set start command: `node server.js`
1. Deploy