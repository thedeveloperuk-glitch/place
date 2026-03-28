export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // PlanIt API — single bbox query covering England (outside London)
  // bbox: west, south, east, north
  // England bbox: -6.0, 49.8, 2.0, 55.8
  // We exclude inner London by using a filter on the results (London covered by london.js)
  // app_size=Large filters to major applications only
  // recent=90 gives us last 90 days

  const LONDON_AUTHORITIES = [
    'camden', 'hackney', 'southwark', 'lambeth', 'islington', 'tower hamlets',
    'newham', 'lewisham', 'greenwich', 'wandsworth', 'hammersmith', 'fulham',
    'kensington', 'chelsea', 'westminster', 'barnet', 'haringey', 'brent',
    'ealing', 'hounslow', 'richmond', 'kingston', 'merton', 'sutton',
    'croydon', 'bromley', 'bexley', 'havering', 'barking', 'dagenham',
    'redbridge', 'waltham forest', 'enfield', 'harrow', 'hillingdon',
    'city of london', 'london',
  ];

  // Try multiple city-based queries in parallel (safer than bbox for PlanIt)
  // Focus on major cities outside London where we're most likely to get results
  const CITIES = [
    'Manchester', 'Birmingham', 'Leeds', 'Bristol', 'Liverpool',
    'Sheffield', 'Newcastle', 'Nottingham', 'Leicester', 'Southampton',
    'Brighton', 'Oxford', 'Cambridge', 'York', 'Coventry',
  ];

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const results = [];
  const errors = [];

  // Fire requests with small stagger to avoid hitting rate limit
  const fetches = CITIES.map((city, i) =>
    sleep(i * 150).then(() =>
      fetch(
        `https://www.planit.org.uk/api/applics/json?auth=${encodeURIComponent(city)}&app_size=Large&recent=90&pg_sz=10&compress=on`,
        { headers: { 'Accept': 'application/json', 'User-Agent': 'TheDeveloperIntelligence/1.0' } }
      )
      .then(async r => {
        if (r.status === 429) { errors.push(`${city}: rate limited`); return null; }
        if (!r.ok) { errors.push(`${city}: ${r.status}`); return null; }
        const data = await r.json();
        return { city, records: data.records || [], total: data.total || 0 };
      })
      .catch(e => { errors.push(`${city}: ${e.message}`); return null; })
    )
  );

  const settled = await Promise.all(fetches);

  for (const result of settled) {
    if (!result) continue;
    // Filter out London authorities in case any slip through
    const filtered = result.records.filter(app => {
      const auth = (app.area_name || app.authority_name || '').toLowerCase();
      return !LONDON_AUTHORITIES.some(l => auth.includes(l));
    });
    results.push({ city: result.city, records: filtered, total: result.total });
  }

  if (errors.length > 0) console.error('PlanIt errors:', errors);

  res.status(200).json({
    cities: results,
    errors: errors.length > 0 ? errors : undefined,
  });
}
