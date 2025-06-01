# Kish Pair - Dual Deploy

This project supports **both Render and Vercel** deployments.

## For Render
- Runs as an Express server.
- `start` command is `node index.js`.

## For Vercel
- Vercel detects the `index.js` and uses the exported function.
- Frontend static files are served from `/public`.

Enjoy!