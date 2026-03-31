export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // ── CPV CODE SETS ────────────────────────────────────────────────────────────

  // All 70xxxx real-estate codes → Developer / Partner chip
  const CPV_DEVELOPER = new Set([
    '70000000','70100000','70110000','70111000','70112000',
    '70120000','70121000','70122000','70123000','70130000',
    '70200000','70210000','70220000','70300000','70310000',
    '70320000','70330000','70331000','70332000','70333000',
  ]);

  // 71200–71250 architectural services → Architect chip
  const CPV_ARCHITECT = new Set([
    '71200000','71210000','71220000','71221000','71222000','71223000',
    '71230000','71231000','71232000',
    '71240000','71241000','71242000','71243000','71244000','71245000',
    '71246000','71247000','71248000','71250000','71251000',
  ]);

  // 71400000 urban planning (general) -> Urban Designer chip (data-prof='urban')
  const CPV_URBAN = new Set(['71400000']);

  // 71410-71413 town / spatial planning -> Planning Consultant chip (data-prof='consultant')
  const CPV_PLANNING = new Set(['71410000','71411000','71412000','71413000']);

  // 71420-71421 landscape architecture -> Landscape Architect chip (data-prof='landscape')
  const CPV_LANDSCAPE = new Set(['71420000','71421000']);

  // Engineering / surveying services
  const CPV_ENGINEER = new Set([
    '71300000','71310000','71311000','71312000','71313000','71315000',
    '71320000','71321000','71322000','71324000','71327000','71328000',
    '71330000','71340000','71350000','71354000','71355000','71356000',
    '71500000','71510000','71520000','71530000','71540000','71541000',
  ]);

  // Residential / housing construction
  const CPV_CONSTRUCTION = new Set([
    '45210000','45211000','45211100','45211340','45211341',
    '45212000','45212300','45215000',
  ]);

  const ALL_CPV = new Set([
    ...CPV_DEVELOPER, ...CPV_ARCHITECT,
    ...CPV_URBAN, ...CPV_PLANNING, ...CPV_LANDSCAPE,
    ...CPV_ENGINEER, ...CPV_CONSTRUCTION,
  ]);

  // Broad prefix matching for sub-codes not explicitly listed.
  const CPV_PREFIXES = [
    '700','701','702','703',                    // 70xxxx real estate
    '7120','7121','7122','7123','7124','7125',  // 712xxxx architectural
    '7130','7131','7132','7133','7134','7135',  // 713xxxx engineering
    '7140','7141','7142',                       // 714xxxx urban/landscape planning
    '7150','7151','7152','7153','7154',         // 715xxxx project management / supervision
  ];

  // ── EXCLUSION TERMS (title-only check) ──────────────────────────────────────
  const EXCLUSION_TERMS = [
    'waste chute','linen chute','boiler replacement','boiler service','fire alarm',
    'fire suppression','sprinkler','lift supply','elevator supply','windows supply',
    'doors supply','glazing supply','roofing supply','flooring supply','floor covering',
    'carpet supply','electrical supply','mechanical supply','hvac supply','plumbing supply',
    'catering equipment','kitchen equipment','laundry equipment','refuse collection',
    'cleaning contract','pest control','grounds maintenance','grass cutting','weed control',
    'security guard','cctv','it support','software licence','telecoms','broadband',
    'printing','stationery','fleet','fuel','audit service','insurance','pension',
    'recruitment agency','temporary staff','medical supply','pharmaceutical','clinical',
  ];

  // ── KEYWORD LISTS ────────────────────────────────────────────────────────────
  const DEVELOPER_KEYWORDS = [
    'development partner','development partnership','developer partner',
    'seeks developer','preferred developer','preferred partner',
    'development agreement','development agent','master developer',
    'land disposal','disposal of land','site disposal','disposal of site',
    'land sale','site for sale','surplus land','surplus site',
    'development opportunity','regeneration opportunity','site opportunity',
    'joint venture','joint development','public private partnership',
    'competitive dialogue','innovation partnership',
    'preliminary market engagement','early market engagement','market engagement',
    'request for information','invitation to tender','invitation to negotiate',
    'expression of interest','pre-qualification','qualification questionnaire',
    'call for competition','framework agreement',
    'build to rent','housing development','residential development',
    'mixed use development','mixed-use development',
    'brownfield development','regeneration project','town centre regeneration',
    'estate regeneration','urban regeneration','waterfront regeneration',
    'affordable housing scheme','social housing',
    'listed building conversion','building conversion','conversion to residential',
    'office to residential','heritage conversion','adaptive reuse',
    'new town','garden community','garden village','garden city',
    'levelling up','shared prosperity fund',
    'developer','development corporation',
  ];

  const ARCHITECT_KEYWORDS = [
    'architect','architectural services','architectural design',
    'design team','lead designer','design consultancy',
    'masterplan','masterplanning','master plan',
    'heritage consultant','conservation architect','listed building consent',
    'design code','design guide','design review',
    'feasibility study','feasibility assessment',
    'interior design','fit-out design',
  ];

  // Urban Designer chip keywords (data-prof='urban')
  const URBAN_KEYWORDS = [
    'urban design','urban designer',
    'placemaking','public realm',
    'townscape','streetscape',
    'urban regeneration','urban planning',
  ];

  // Planning Consultant chip keywords (data-prof='consultant')
  const PLANNING_KEYWORDS = [
    'town planning','spatial planning','planning policy',
    'planning consultant','planning consultancy','planning services',
    'planning application','development management',
    'local plan','neighbourhood plan','planning permission',
    'planning appeal','planning inspector',
  ];

  // Landscape Architect chip keywords (data-prof='landscape')
  const LANDSCAPE_KEYWORDS = [
    'landscape architect','landscape architecture',
    'landscape design','landscape consultant',
    'open space design','green infrastructure',
  ];

  const ENGINEERING_KEYWORDS = [
    'structural engineer','civil engineer','transport consultant',
    'quantity surveyor','project manager','project management',
    'building surveyor','building consultancy',
    'infrastructure design','drainage design','flood risk',
    'sustainability consultant','energy consultant','environmental consultant',
  ];

  const ALL_KEYWORDS = [
    ...DEVELOPER_KEYWORDS, ...ARCHITECT_KEYWORDS,
    ...URBAN_KEYWORDS, ...PLANNING_KEYWORDS, ...LANDSCAPE_KEYWORDS,
    ...ENGINEERING_KEYWORDS,
  ];

  // ── HELPERS ──────────────────────────────────────────────────────────────────

  function isCpvRelevant(id) {
    if (!id) return false;
    if (ALL_CPV.has(id)) return true;
    return CPV_PREFIXES.some(p => id.startsWith(p));
  }

  // Returns the data-prof value matching index.html chip filter buttons
  function cpvProfession(id) {
    if (!id) return null;
    if (CPV_DEVELOPER.has(id))    return 'developer';
    if (CPV_ARCHITECT.has(id))    return 'architect';
    if (CPV_PLANNING.has(id))     return 'consultant';  // Planning Consultant chip
    if (CPV_LANDSCAPE.has(id))    return 'landscape';   // Landscape Architect chip
    if (CPV_URBAN.has(id))        return 'urban';       // Urban Designer chip
    if (CPV_ENGINEER.has(id))     return 'consultant';
    if (CPV_CONSTRUCTION.has(id)) return 'developer';
    // Prefix fallback
    if (id.startsWith('700')||id.startsWith('701')||id.startsWith('702')||id.startsWith('703')) return 'developer';
    if (id.startsWith('7120')||id.startsWith('7121')||id.startsWith('7122')||
        id.startsWith('7123')||id.startsWith('7124')||id.startsWith('7125'))                    return 'architect';
    if (id.startsWith('7141')||id.startsWith('7142')||id.startsWith('7143'))                    return 'consultant'; // planning sub-codes
    if (id.startsWith('7142'))                                                                   return 'landscape';  // landscape sub-codes
    return null;
  }

  function keywordProfession(title, fullText) {
    const t = title.toLowerCase();
    const f = fullText.toLowerCase();
    if (DEVELOPER_KEYWORDS.some(kw => t.includes(kw) || f.includes(kw)))  return 'developer';
    if (PLANNING_KEYWORDS.some(kw => t.includes(kw) || f.includes(kw)))   return 'consultant'; // Planning Consultant chip
    if (LANDSCAPE_KEYWORDS.some(kw => t.includes(kw) || f.includes(kw)))  return 'landscape';  // Landscape Architect chip
    if (URBAN_KEYWORDS.some(kw => t.includes(kw) || f.includes(kw)))      return 'urban';      // Urban Designer chip
    if (ARCHITECT_KEYWORDS.some(kw => t.includes(kw) || f.includes(kw)))  return 'architect';
    if (ENGINEERING_KEYWORDS.some(kw => t.includes(kw) || f.includes(kw))) return 'consultant';
    return 'other';
  }

  function professionLabel(prof) {
    const map = {
      developer:  'Developer',
      architect:  'Architect',
      urban:      'Urban Designer',
      consultant: 'Planning Consultant',
      landscape:  'Landscape Architect',
      market:     'Market Engagement',
      other:      'Other',
    };
    return map[prof] || 'Other';
  }

  function isRelevant(release) {
    const tender = release.tender || {};
    const title = (tender.title || release.description || '').toLowerCase();
    const fullText = [
      tender.title, tender.description, release.description,
      ...(tender.items || []).map(i => i.description),
    ].filter(Boolean).join(' ').toLowerCase();

    // Hard exclude on title only (avoids false positives from long descriptions)
    if (EXCLUSION_TERMS.some(t => title.includes(t))) return false;

    const allCpvs = [
      tender.classification?.id,
      ...(tender.items || []).flatMap(i => [
        i.classification?.id,
        ...(i.additionalClassifications || []).map(ac => ac.id),
      ]),
    ].filter(Boolean);

    // Trusted CPVs: always include without keyword check
    if (allCpvs.some(id =>
      CPV_DEVELOPER.has(id) || CPV_ARCHITECT.has(id) ||
      CPV_URBAN.has(id) || CPV_PLANNING.has(id) || CPV_LANDSCAPE.has(id)
    )) return true;

    const hasCpv     = allCpvs.some(id => isCpvRelevant(id));
    const hasKeyword = ALL_KEYWORDS.some(kw => title.includes(kw) || fullText.includes(kw));

    return hasCpv || hasKeyword;
  }

  function enrichRelease(release) {
    const tender = release.tender || {};
    const title = tender.title || release.description || '';
    const fullText = [
      tender.title, tender.description, release.description,
      ...(tender.items || []).map(i => i.description),
    ].filter(Boolean).join(' ');

    const allCpvs = [
      tender.classification?.id,
      ...(tender.items || []).flatMap(i => [
        i.classification?.id,
        ...(i.additionalClassifications || []).map(ac => ac.id),
      ]),
    ].filter(Boolean);

    // CPV takes priority over keyword for profession
    const profession = allCpvs.map(cpvProfession).find(Boolean) || keywordProfession(title, fullText);

    const stageMap = {
      planning: 'Early Market Engagement',
      tender:   'Tender',
      award:    'Contract Award',
      active:   'Active',
    };
    const stageLabel = stageMap[release.stage || ''] || release.stage || 'Notice';

    return {
      ...release,
      profession,                         // ← chip filter key used by index.html setProf()
      _noticeType: professionLabel(profession),
      _stageLabel: stageLabel,
    };
  }

  // ── FETCH ────────────────────────────────────────────────────────────────────
  try {
    const now    = new Date();
    const recent = new Date(Date.now() -  60 * 24 * 60 * 60 * 1000); // 60 days ago  → upper bound for older window
    const older  = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000); // 180 days ago → lower bound for older window
    // BUG FIX: previously `mid` was set to same value as `recent` (both 60 days ago),
    // making the r2/r4 date window zero-width and returning no results at all.
    // `recent` is now correctly reused as the upper bound of the older window.

    const fmt  = d => d.toISOString().split('.')[0];
    const base = 'https://www.find-tender.service.gov.uk/api/1.0/ocdsReleasePackages';
    const headers = { 'Accept': 'application/json' };
    const delay = ms => new Promise(res => setTimeout(res, ms));

    // Sequential fetches with a gap between each to avoid 429 rate limiting
    const urls = [
      `${base}?stages=tender&updatedFrom=${fmt(recent)}&updatedTo=${fmt(now)}&limit=100`,
      `${base}?stages=planning&updatedFrom=${fmt(recent)}&updatedTo=${fmt(now)}&limit=100`,
      `${base}?stages=tender&updatedFrom=${fmt(older)}&updatedTo=${fmt(recent)}&limit=100`,
      `${base}?stages=planning&updatedFrom=${fmt(older)}&updatedTo=${fmt(recent)}&limit=100`,
    ];

    const allReleases = [];
    const fetchStatuses = [];
    for (const url of urls) {
      try {
        const resp = await fetch(url, { headers, signal: AbortSignal.timeout(12000) });
        fetchStatuses.push({ url, ok: resp.ok, status: resp.status });
        if (resp.ok) {
          const d = await resp.json();
          allReleases.push(...(d.releases || []));
        }
      } catch (e) {
        fetchStatuses.push({ url, ok: false, error: e.message });
      }
      await delay(600); // 600ms between requests
    }

    const seen    = new Set();
    const deduped = allReleases.filter(r => { if (seen.has(r.id)) return false; seen.add(r.id); return true; });

    // ── DEBUG MODE: hit /api/tenders?debug=1 to inspect raw API data ──────────
    if (req.query && req.query.debug === '1') {
      const sample = deduped.slice(0, 50).map(r => {
        const tender = r.tender || {};
        const allCpvs = [
          tender.classification && tender.classification.id,
          ...(tender.items || []).flatMap(i => [
            i.classification && i.classification.id,
            ...(i.additionalClassifications || []).map(ac => ac.id),
          ]),
        ].filter(Boolean);
        const wouldPass  = isRelevant(r);
        const enriched   = wouldPass ? enrichRelease(r) : null;
        const excludedBy = EXCLUSION_TERMS.find(t => (tender.title || '').toLowerCase().includes(t)) || null;
        return {
          id:          r.id,
          title:       tender.title || r.description || '(no title)',
          stage:       r.stage,
          cpvs:        allCpvs,
          wouldPass,
          excludedBy,
          profession:  enriched ? enriched.profession : null,
          noticeType:  enriched ? enriched._noticeType : null,
        };
      });
      const allCpvsInSample = Array.from(new Set(
        deduped.slice(0, 50).flatMap(r => {
          const tender = r.tender || {};
          return [
            tender.classification && tender.classification.id,
            ...(tender.items || []).flatMap(i => [
              i.classification && i.classification.id,
              ...(i.additionalClassifications || []).map(ac => ac.id),
            ]),
          ].filter(Boolean);
        })
      )).sort();
      return res.status(200).json({
        _debug:          true,
        _fetchStatuses:  fetchStatuses,
        _totalFromApi:   allReleases.length,
        _afterDedup:     deduped.length,
        _wouldFilter:    deduped.filter(isRelevant).length,
        _allCpvsInSample: allCpvsInSample,
        _sample:         sample,
      });
    }
    // ── END DEBUG MODE ────────────────────────────────────────────────────────

    const filtered = deduped.filter(isRelevant).map(enrichRelease);

    filtered.sort((a, b) => {
      if (a._stageLabel.includes('Market') && !b._stageLabel.includes('Market')) return -1;
      if (!a._stageLabel.includes('Market') && b._stageLabel.includes('Market')) return 1;
      return new Date(b.date || 0) - new Date(a.date || 0);
    });

    res.status(200).json({ releases: filtered, _total: deduped.length, _filtered: filtered.length });
  } catch (e) {
    console.error('Tenders:', e.message);
    res.status(200).json({ releases: [], error: e.message });
  }
}
