export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    // Fetch brownfield sites in two passes:
    // 1. Not-permissioned sites (most actionable for developers) — 100 results
    // 2. Pending-decision sites — 100 results
    // Filter to minimum-net-dwellings >= 10 to keep only meaningful sites
    // The API has 36k+ entries so we must filter at source

    const BASE = 'https://www.planning.data.gov.uk/entity.json?dataset=brownfield-land&entries=active&limit=100';
    const FIELDS = [
      'entity','name','reference','latitude','longitude','point',
      'site-address','site-name','site-hectares',
      'minimum-net-dwellings','maximum-net-dwellings',
      'planning-permission-status','planning-permission-url',
      'local-authority','organisation','notes'
    ].map(f => `field=${f}`).join('&');

    const [notPermissioned, pendingDecision] = await Promise.all([
      fetch(`${BASE}&planning-permission-status=not-permissioned&${FIELDS}`, {
        headers: { 'Accept': 'application/json', 'User-Agent': 'RegenIntel/1.0' }
      }),
      fetch(`${BASE}&planning-permission-status=pending-decision&${FIELDS}`, {
        headers: { 'Accept': 'application/json', 'User-Agent': 'RegenIntel/1.0' }
      }),
    ]);

    const results = [];

    for (const response of [notPermissioned, pendingDecision]) {
      if (!response.ok) continue;
      const data = await response.json();
      const entities = (data.entities || []).filter(e => {
        const minDwellings = parseInt(e['minimum-net-dwellings'] || e['maximum-net-dwellings'] || '0');
        return minDwellings >= 10;
      });
      results.push(...entities);
    }

    // Deduplicate by entity id
    const seen = new Set();
    const deduped = results.filter(e => {
      if (seen.has(e.entity)) return false;
      seen.add(e.entity);
      return true;
    });

    res.status(200).json({ entities: deduped });

  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
