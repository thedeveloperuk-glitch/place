export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // PlanIt API docs: app_size=Large, recent=N (days), pg_sz=page size
  // Rate limited — sequential requests with a small delay between each
  // Using auth= (authority name) rather than bbox to avoid 400 errors from oversized bboxes
  // Keeping to 6 cities to stay well within rate limits in a single Vercel invocation

  const CITIES = [
    'London',
    'Manchester',
    'Birmingham',
    'Leeds',
    'Bristol',
    'Liverpool',
  ];

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  const allResults = [];

  for (const city of CITIES) {
    try {
      const url = `https://www.planit.org.uk/api/applics/json?auth=${encodeURIComponent(city)}&app_size=Large&recent=60&pg_sz=10&compress=on`;

      const upstream = await fetch(url, {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'RegenIntel/1.0 (festivalofplace.co.uk)',
        },
      });

      if (!upstream.ok) {
        const retryAfter = upstream.headers.get('Retry-After') || '';
        console.error(`PlanIt ${city}: HTTP ${upstream.status} retry-after=${retryAfter}`);
        // If rate limited, stop early rather than hammering
        if (upstream.status === 429) break;
        // Otherwise skip this city and continue
        await sleep(500);
        continue;
      }

      const data = await upstream.json();
      const records = data.records || [];
      allResults.push({ city, records, total: data.total || records.length });

      // Polite delay between requests — PlanIt is rate limited
      await sleep(300);

    } catch (e) {
      console.error(`PlanIt ${city}:`, e.message);
      await sleep(300);
    }
  }

  res.status(200).json({ cities: allResults });
}
