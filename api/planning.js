export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const since = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  const cityQueries = [
    { name: 'London',     bbox: [-0.51, 51.28, 0.33, 51.69] },
    { name: 'Manchester', bbox: [-2.4, 53.38, -2.1, 53.57] },
    { name: 'Birmingham', bbox: [-2.0, 52.37, -1.7, 52.57] },
    { name: 'Liverpool',  bbox: [-3.1, 53.32, -2.85, 53.47] },
    { name: 'Leeds',      bbox: [-1.7, 53.73, -1.4, 53.88] },
    { name: 'Bristol',    bbox: [-2.7, 51.39, -2.5, 51.52] },
    { name: 'Newcastle',  bbox: [-1.75, 54.94, -1.55, 55.02] },
  ];

  const allResults = [];

  for (const city of cityQueries) {
    try {
      const [w, s, e, n] = city.bbox;
      const url = `https://www.planit.org.uk/api/applics/json?bbox=${w},${s},${e},${n}&app_size=large&start_date=${since}&pg_sz=20&limit=20`;
      const upstream = await fetch(url, { headers: { 'Accept': 'application/json' } });
      if (!upstream.ok) continue;
      const data = await upstream.json();
      const records = data.records || data.applications || data.features || [];
      allResults.push({ city: city.name, records });
    } catch (e) {
      // silently skip failed cities
      console.error(`PlanIt ${city.name}:`, e.message);
    }
  }

  res.status(200).json({ cities: allResults });
}

  res.status(200).json({ cities: allResults });
}
