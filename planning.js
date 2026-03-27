export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    // Single bbox covering all of England — one request, no rate-limit issues.
    // app_size=Large  → major developments only (PlanIt's classification)
    // recent=60       → validated in the last 60 days
    // pg_sz=50        → up to 50 results
    // compress=on     → smaller payload
    const bbox = '-6,49.8,2,55.8';
    const url = `https://www.planit.org.uk/api/applics/json?bbox=${bbox}&app_size=Large&recent=60&pg_sz=50&compress=on`;

    const upstream = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'RegenIntel/1.0 (festivalofplace.co.uk)',
      },
    });

    if (!upstream.ok) {
      const retryAfter = upstream.headers.get('Retry-After') || '';
      return res.status(upstream.status).json({
        error: `PlanIt returned ${upstream.status}`,
        retryAfter,
        cities: [],
      });
    }

    const data = await upstream.json();
    const records = data.records || [];

    // Return as a single "England" city group — the frontend already does
    // city matching from area_name / address fields on each record.
    res.status(200).json({
      cities: [{ city: 'England', records }],
      total: data.total || records.length,
    });

  } catch (e) {
    console.error('PlanIt fetch error:', e.message);
    res.status(500).json({ error: e.message, cities: [] });
  }
}
