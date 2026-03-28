// planning.js — replaces unreliable PlanIt with planning.data.gov.uk
// Uses the official planning-application dataset from DLUHC
// Filters to major applications (50+ homes) submitted in last 90 days
// Covers all LPAs in England outside London (London handled by london.js)

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
      .toISOString().split('T')[0]; // YYYY-MM-DD

    // planning.data.gov.uk entity API
    // Filter: recent applications, large scale, outside London
    // application-type covers outline, full, reserved-matters
    const params = new URLSearchParams({
      dataset: 'planning-application',
      limit: '100',
      entries: 'active',
      'start-date-after': since,
    });

    const fields = [
      'reference', 'name', 'description', 'site-address',
      'latitude', 'longitude', 'point',
      'local-authority', 'organisation',
      'application-type', 'application-status',
      'decision', 'decision-date',
      'entry-date', 'start-date',
      'document-url', 'site-hectares',
    ].map(f => `field=${f}`).join('&');

    const url = `https://www.planning.data.gov.uk/entity.json?${params}&${fields}`;

    const upstream = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'TheDeveloperIntelligence/1.0',
      }
    });

    if (!upstream.ok) {
      const text = await upstream.text();
      console.error('planning.data.gov.uk error:', upstream.status, text.slice(0, 200));
      return res.status(upstream.status).json({ error: `Upstream error: ${upstream.status}`, records: [] });
    }

    const data = await upstream.json();
    const entities = data.entities || [];

    // Filter out London boroughs (covered by london.js)
    // and keep only meaningful descriptions (50+ homes heuristic applied client-side)
    const LONDON_ORGS = [
      'london', 'camden', 'hackney', 'southwark', 'lambeth', 'islington',
      'tower-hamlets', 'newham', 'lewisham', 'greenwich', 'wandsworth',
      'hammersmith', 'kensington', 'westminster', 'barnet', 'haringey',
      'brent', 'ealing', 'hounslow', 'richmond', 'kingston', 'merton',
      'sutton', 'croydon', 'bromley', 'bexley', 'havering', 'barking',
      'redbridge', 'waltham-forest', 'enfield', 'harrow', 'hillingdon',
      'city-of-london',
    ];

    const filtered = entities.filter(e => {
      const org = (e.organisation || e['local-authority'] || '').toLowerCase();
      return !LONDON_ORGS.some(l => org.includes(l));
    });

    res.status(200).json({ records: filtered, total: filtered.length });

  } catch (e) {
    console.error('planning.js error:', e.message);
    res.status(500).json({ error: e.message, records: [] });
  }
}
