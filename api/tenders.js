export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // CPV codes relevant to place-making, regeneration, construction and planning
  // Organised by theme so it's easy to maintain
  const RELEVANT_CPV_PREFIXES = [
    '45',       // All construction work
    '71',       // Architecture, engineering, planning, surveying
    '70',       // Real estate services
    '79993',    // Facilities/building management
    '90714',    // Environmental site assessment
    '90710',    // Environmental management
  ];

  const RELEVANT_CPV_CODES = new Set([
    // Urban planning & design
    '71410000', '71400000', '71420000', '71240000', '71241000', '71242000',
    '71243000', '71244000', '71245000', '71246000', '71247000', '71248000',
    '71250000', '71251000',
    // Architecture
    '71200000', '71210000', '71220000', '71221000',
    // Real estate & land
    '70000000', '70100000', '70110000', '70111000', '70112000',
    '70120000', '70121000', '70122000', '70123000', '70130000',
    '70320000', '70330000', '70331000', '70332000', '70333000',
    // Master planning, development consultancy
    '71311000', '71312000', '71313000', '71315000', '71315100',
    '71315200', '71315210', '71315300', '71315400', '71315410',
    '71317000', '71318000', '71319000',
    // Construction management & surveying
    '71310000', '71320000', '71321000', '71322000', '71324000',
    '71327000', '71328000', '71330000', '71331000', '71332000',
    '71333000', '71334000', '71335000', '71336000', '71337000',
    // Infrastructure
    '71350000', '71351000', '71354000', '71355000', '71356000',
    // Demolition & site works
    '45110000', '45111000', '45112000', '45113000', '45120000',
    // Building construction
    '45210000', '45211000', '45211100', '45211200', '45211300',
    '45211310', '45211320', '45211340', '45211341', '45211350',
    '45211360', '45211370', '45212000', '45213000',
    // Civil engineering & public realm
    '45220000', '45221000', '45230000', '45231000', '45232000',
    '45233000', '45234000', '45240000', '45243000', '45244000',
    '45247000',
    // Landscape & public space
    '77310000', '77311000', '77312000', '77313000', '77314000',
    '77315000', '77320000', '77321000',
    // Community & social infrastructure
    '45215000', '45215100', '45215200', '45215210', '45215212',
    '45215213', '45215214', '45215220', '45215221',
    // Regeneration, housing development
    '45262000', '45262100', '45262200', '45262210', '45262211',
    '45262212', '45262300', '45262310', '45262311', '45262320',
    '45262321', '45262400', '45262500', '45262600', '45262700',
    '45262800',
    // Refurbishment & retrofit
    '45453000', '45453100', '45454000', '45454100',
  ]);

  // Keyword filter — must match title or description
  const REGEN_KEYWORDS = [
    'regeneration', 'masterplan', 'master plan', 'mixed use', 'mixed-use',
    'town centre', 'placemaking', 'place-making', 'urban renewal',
    'estate regeneration', 'high street', 'waterfront', 'cultural quarter',
    'innovation district', 'garden city', 'new town', 'opportunity area',
    'growth area', 'city centre', 'strategic development', 'housing zone',
    'urban extension', 'retrofit', 'meanwhile use', 'community land trust',
    'build to rent', 'build-to-rent', 'purpose-built', 'urban village',
    'heritage quarter', 'science park', 'knowledge quarter', 'enterprise zone',
    'freeport', 'development corporation', 'town deal', 'future high streets',
    'levelling up', 'compulsory purchase', 'land assembly', 'co-living',
    'brownfield', 'affordable housing', 'housing development', 'residential development',
    'planning permission', 'outline planning', 'planning application',
    'design team', 'architect', 'masterplanning', 'public realm',
    'landscape architect', 'urban design', 'feasibility study', 'development brief',
    'planning consultancy', 'development management', 'site assembly',
    'infrastructure delivery', 'development framework',
  ];

  function isCpvRelevant(cpvId) {
    if (!cpvId) return false;
    if (RELEVANT_CPV_CODES.has(cpvId)) return true;
    return RELEVANT_CPV_PREFIXES.some(prefix => cpvId.startsWith(prefix));
  }

  function hasRelevantCpv(release) {
    const tender = release.tender || {};
    // Check primary CPV
    if (isCpvRelevant(tender.classification?.id)) return true;
    // Check additional CPVs on items/lots
    const items = tender.items || [];
    for (const item of items) {
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
    const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split('.')[0];
    const until = new Date().toISOString().split('.')[0];

    // Fetch up to 200 recent planning-stage notices and filter server-side
    // The API doesn't support CPV filtering directly
    const url = `https://www.find-tender.service.gov.uk/api/1.0/ocdsReleasePackages?stages=planning&updatedFrom=${since}&updatedTo=${until}&limit=100`;
    const upstream = await fetch(url, {
      headers: { 'Accept': 'application/json' }
    });

    if (!upstream.ok) {
      return res.status(upstream.status).json({ error: `Upstream error: ${upstream.status}` });
    }

    const data = await upstream.json();
    const allReleases = data.releases || [];

    // Keep only releases that pass CPV OR keyword filter
    // CPV filter is the primary gate (more reliable), keyword is the fallback
    const filtered = allReleases.filter(r => hasRelevantCpv(r) || hasRelevantKeyword(r));

    // Return in same shape so the frontend doesn't need changing
    res.status(200).json({
      ...data,
      releases: filtered,
    });

  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
