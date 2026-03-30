// api/fetch-planit.js — Nightly cron job (runs at 3am UTC via vercel.json)
// Fetches large planning applications from PlanIt API once per day.
// PlanIt FAQ: "one request per minute" rate limit, hobby project, no SLA.
// We make ONE request per run — well within limits.
// Results cached in Vercel Blob Storage (or KV if available).
//
// To trigger manually: GET /api/fetch-planit?secret=YOUR_CRON_SECRET

import { put, list, getDownloadUrl } from '@vercel/blob';

const CRON_SECRET = process.env.CRON_SECRET;
const CACHE_KEY   = 'planit-cache.json';

export default async function handler(req, res) {
  // Auth: Vercel calls crons with CRON_SECRET header, or allow manual trigger
  const authHeader = req.headers['authorization'];
  const querySecret = req.query.secret;
  if (CRON_SECRET) {
    const valid = authHeader === `Bearer ${CRON_SECRET}` || querySecret === CRON_SECRET;
    if (!valid) return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const today     = new Date().toISOString().slice(0, 10);
    const ninetyAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    // Single request — large apps only, England bbox, last 90 days, 100 results
    // PlanIt FAQ: safely make 1 request/minute. We make 1 per day.
    const url = new URL('https://www.planit.org.uk/api/applics/json');
    url.searchParams.set('app_size',   'large');
    url.searchParams.set('start_date', ninetyAgo);
    url.searchParams.set('end_date',   today);
    url.searchParams.set('bbox',       '-6.0,49.8,2.0,56.0'); // England
    url.searchParams.set('pg_sz',      '100');
    url.searchParams.set('limit',      '100');

    const pr = await fetch(url.toString(), {
      headers: {
        'Accept':     'application/json',
        'User-Agent': 'TheDeveloperIntelligence/1.0 (festivalofplace.co.uk; 1 req/day cron)',
      },
      signal: AbortSignal.timeout(20000),
    });

    if (!pr.ok) {
      const msg = `PlanIt returned ${pr.status}`;
      console.error(msg);
      return res.status(502).json({ error: msg });
    }

    const data     = await pr.json();
    const apps     = data.results || data.applics || (Array.isArray(data) ? data : []);
    const cached   = { fetchedAt: new Date().toISOString(), count: apps.length, apps };

    // Store in Vercel Blob
    await put(CACHE_KEY, JSON.stringify(cached), {
      access:      'public',
      contentType: 'application/json',
      addRandomSuffix: false, // overwrite same key each time
    });

    console.log(`PlanIt cron: cached ${apps.length} large apps`);
    return res.status(200).json({ ok: true, count: apps.length, fetchedAt: cached.fetchedAt });

  } catch (e) {
    console.error('PlanIt cron error:', e.message);
    return res.status(500).json({ error: e.message });
  }
}
