export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const RELEVANT_CPV_PREFIXES = ['71', '70', '45', '77310', '90710'];

  const RELEVANT_CPV_CODES = new Set([
    '71200000','71210000','71220000','71221000','71222000','71223000',
    '71400000','71410000','71420000','71421000',
    '71240000','71241000','71242000','71243000','71244000','71245000',
    '71310000','71311000','71312000','71313000','71315000',
    '71320000','71321000','71322000','71324000','71327000','71328000',
    '71350000','71351000','71354000','71355000','71356000',
    '70000000','70100000','70110000','70111000','70112000',
    '70120000','70121000','70122000','70123000','70130000',
    '70320000','70330000','70331000','70332000','70333000',
    '77310000','77311000','77312000','77313000','77314000','77315000',
    '45262000','45262700','45262800','45453000','45453100','45454000',
  ]);

  const REGEN_KEYWORDS = [
    'architect','architectural','landscape architect','landscape design',
    'landscape consultant','landscape and public realm',
    'urban designer','masterplan','master plan','masterplanning',
    'placemaking','public realm','urban design','urban renewal',
    'regeneration','development partner','developer partner',
    'development opportunity','redevelopment opportunity',
    'disposal opportunity','site disposal','land disposal',
    'joint venture','preferred developer','development agreement',
    'housing association','registered provider','affordable housing',
    'housing development','residential development',
    'brownfield','mixed use','mixed-use','town centre',
    'feasibility study','design team','design consultancy',
    'planning consultant','planning consultancy','planning policy',
    'heritage consultant','design code','design guide',
    'build to rent','co-living','garden city','new town',
    'development corporation','town deal','levelling up',
  ];

  function isCpvRelevant(id) {
    if (!id) return false;
    if (RELEVANT_CPV_CODES.has(id)) return true;
    return RELEVANT_CPV_PREFIXES.some(p => id.startsWith(p));
  }

  function isRelevant(release) {
    const tender = release.tender || {};
    const text = [
      tender.title,
      tender.description,
      release.description,
      ...(tender.items||[]).map(i => i.description),
    ].filter(Boolean).join(' ').toLowerCase();
    if (REGEN_KEYWORDS.some(kw => text.includes(kw))) return true;
    if (isCpvRelevant(tender.classification?.id)) return true;
    for (const item of (tender.items || [])) {
      if (isCpvRelevant(item.classification?.id)) return true;
      for (const ac of (item.additionalClassifications || []))
        if (isCpvRelevant(ac.id)) return true;
    }
    return false;
  }

  try {
    const now      = new Date();
    const recent   = new Date(Date.now() -  60 * 24 * 60 * 60 * 1000); // last 60 days
    const older    = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000); // 60–180 days ago
    const mid      = new Date(Date.now() -  60 * 24 * 60 * 60 * 1000); // boundary

    const fmt = d => d.toISOString().split('.')[0];
    const base = 'https://www.find-tender.service.gov.uk/api/1.0/ocdsReleasePackages';

    // Four parallel calls: tender + planning stages, across two time windows
    // Spreads the 100-result limit across more time and more notice types
    // 'planning' stage = PIN / early market engagement, popular with English councils
    const headers = { 'Accept': 'application/json' };
    const sig = () => ({ signal: AbortSignal.timeout(10000) });

    const [r1, r2, r3, r4] = await Promise.all([
      fetch(`${base}?stages=tender&updatedFrom=${fmt(recent)}&updatedTo=${fmt(now)}&limit=100`,  { headers, ...sig() }),
      fetch(`${base}?stages=tender&updatedFrom=${fmt(older)}&updatedTo=${fmt(mid)}&limit=100`,   { headers, ...sig() }),
      fetch(`${base}?stages=planning&updatedFrom=${fmt(recent)}&updatedTo=${fmt(now)}&limit=100`, { headers, ...sig() }),
      fetch(`${base}?stages=planning&updatedFrom=${fmt(older)}&updatedTo=${fmt(mid)}&limit=100`,  { headers, ...sig() }),
    ]);

    const allReleases = [];
    for (const res of [r1, r2, r3, r4]) {
      if (res.ok) { const d = await res.json(); allReleases.push(...(d.releases||[])); }
    }

    // Deduplicate by release id
    const seen = new Set();
    const deduped = allReleases.filter(r => {
      if (seen.has(r.id)) return false;
      seen.add(r.id); return true;
    });

    const releases = deduped.filter(isRelevant);
    res.status(200).json({ releases, _total: deduped.length, _filtered: releases.length });

  } catch (e) {
    console.error('Tenders:', e.message);
    res.status(200).json({ releases: [], error: e.message });
  }
}
