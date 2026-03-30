export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // CPV prefixes covering architecture, planning, construction, landscape, real estate
  const RELEVANT_CPV_PREFIXES = [
    '71',     // Architecture, engineering, planning, surveying — the core category
    '70',     // Real estate services
    '45',     // Construction
    '77310',  // Landscape
    '90710',  // Environmental management
  ];

  const RELEVANT_CPV_CODES = new Set([
    // Architecture & design
    '71200000','71210000','71220000','71221000','71222000','71223000',
    // Urban planning & design
    '71400000','71410000','71420000','71421000',
    // Engineering consultancy
    '71240000','71241000','71242000','71243000','71244000','71245000',
    '71246000','71247000','71248000','71250000','71251000',
    // Master planning & development
    '71310000','71311000','71312000','71313000','71315000',
    '71315100','71315200','71315300','71315400',
    '71317000','71318000','71319000',
    '71320000','71321000','71322000','71324000',
    '71327000','71328000','71330000','71334000','71336000',
    // Surveying & feasibility
    '71350000','71351000','71354000','71355000','71356000',
    // Real estate
    '70000000','70100000','70110000','70111000','70112000',
    '70120000','70121000','70122000','70123000','70130000',
    '70320000','70330000','70331000','70332000','70333000',
    // Landscape
    '77310000','77311000','77312000','77313000','77314000','77315000',
    // Housing construction
    '45210000','45211000','45211100','45211200','45211300',
    '45211340','45211341','45211350','45211360','45212000','45213000',
    // Regeneration & refurbishment
    '45262000','45262700','45262800','45453000','45453100','45454000',
  ]);

  // Broad keyword list — catches notices that use generic CPV codes
  const REGEN_KEYWORDS = [
    // Professions sought
    'architect', 'architectural', 'landscape architect', 'landscape design',
    'landscape and public realm', 'urban designer', 'landscape consultant',
    'masterplanner', 'masterplanning', 'urban design', 'placemaking',
    'planning consultant', 'planning consultancy', 'design team',
    'development partner', 'developer partner', 'development management', 'project manager',
    'development opportunity', 'redevelopment opportunity', 'disposal opportunity',
    'preferred developer', 'developer led', 'land disposal', 'site disposal',
    'residential development opportunity', 'development agreement', 'joint venture partner',
    // Place types
    'regeneration', 'masterplan', 'master plan', 'mixed use', 'mixed-use',
    'town centre', 'urban renewal', 'estate regeneration', 'high street',
    'waterfront', 'cultural quarter', 'innovation district', 'city centre',
    'strategic development', 'public realm', 'open space',
    // Housing
    'affordable housing', 'housing development', 'residential development',
    'build to rent', 'build-to-rent', 'co-living', 'housing association',
    'registered provider', 'social housing',
    // Site types
    'brownfield', 'development brief', 'feasibility study',
    'outline planning', 'reserved matters', 'planning application',
    'land assembly', 'compulsory purchase', 'development framework',
    // Specific schemes
    'garden city', 'new town', 'enterprise zone', 'development corporation',
    'town deal', 'levelling up', 'future high streets', 'heritage quarter',
  ];

  function isCpvRelevant(cpvId) {
    if (!cpvId) return false;
    if (RELEVANT_CPV_CODES.has(cpvId)) return true;
    return RELEVANT_CPV_PREFIXES.some(p => cpvId.startsWith(p));
  }

  function hasRelevantCpv(release) {
    const tender = release.tender || {};
    if (isCpvRelevant(tender.classification?.id)) return true;
    for (const item of (tender.items || [])) {
      if (isCpvRelevant(item.classification?.id)) return true;
      for (const ac of (item.additionalClassifications || [])) {
        if (isCpvRelevant(ac.id)) return true;
      }
    }
    return false;
  }

  function hasRelevantKeyword(release) {
    const tender = release.tender || {};
    const text = `${tender.title || ''} ${tender.description || ''} ${release.description || ''}`.toLowerCase();
    return REGEN_KEYWORDS.some(kw => text.includes(kw));
  }

  try {
    const since = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString().split('.')[0]; // 6 months — catches 2025 notices, use 'Active only' filter to see live ones
    const until = new Date().toISOString().split('.')[0];
    const base = `https://www.find-tender.service.gov.uk/api/1.0/ocdsReleasePackages`;
    // Use publishedFrom not updatedFrom — landscape/developer notices 
    // often aren't updated after initial publication so updatedFrom misses them
    const params = `publishedFrom=${since}&limit=100`;

    // Fetch planning, tender AND prior-information stages in parallel
    // prior-information = early market engagement notices — very useful for developers/architects
    const [planningRes, tenderRes, priorRes] = await Promise.all([
      fetch(`${base}?stages=planning&${params}`, { headers: { 'Accept': 'application/json' }, signal: AbortSignal.timeout(12000) }),
      fetch(`${base}?stages=tender&${params}`,   { headers: { 'Accept': 'application/json' }, signal: AbortSignal.timeout(12000) }),
      fetch(`${base}?stages=prior-information&${params}`, { headers: { 'Accept': 'application/json' }, signal: AbortSignal.timeout(12000) }),
    ]);

    const allReleases = [];

    if (planningRes.ok) {
      const d = await planningRes.json();
      allReleases.push(...(d.releases || []));
    }
    if (tenderRes.ok) {
      const d = await tenderRes.json();
      allReleases.push(...(d.releases || []));
    }
    if (priorRes.ok) {
      const d = await priorRes.json();
      allReleases.push(...(d.releases || []));
    }

    // Deduplicate by release id
    const seen = new Set();
    const deduped = allReleases.filter(r => {
      if (seen.has(r.id)) return false;
      seen.add(r.id);
      return true;
    });

    // Filter: CPV match OR keyword match
    const filtered = deduped.filter(r => hasRelevantCpv(r) || hasRelevantKeyword(r));

    res.status(200).json({ releases: filtered });

  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
