// Module-level cache — persists across warm Vercel invocations
let _cache = null;
let _cacheTime = 0;
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // ── CPV CODE SETS ────────────────────────────────────────────────────────────

  // Specific real-estate CPVs only — 70000000 excluded (too generic, used on unrelated notices)
  const CPV_DEVELOPER = new Set([
    '70100000','70110000','70111000','70112000',
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

  // Generic root codes used loosely by the API — never trust alone, require keyword confirmation
  const CPV_GENERIC_ROOTS = new Set(['70000000','71000000']);

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

  // Prefix matching — deliberately NOT including 70xxxx (too many false positives)
  // Only 71xxxx ranges where we know the sub-codes are relevant
  const CPV_PREFIXES = [
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

  // ── HELPERS ──────────────────────────────────────────────────────────────────

  // Helper: extract all CPV codes from a release
  function getCpvs(release) {
    const tender = release.tender || {};
    return [
      tender.classification?.id,
      ...(tender.items || []).flatMap(i => [
        i.classification?.id,
        ...(i.additionalClassifications || []).map(ac => ac.id),
      ]),
    ].filter(Boolean);
  }

  // Maps a CPV to the data-prof chip value used in index.html
  function cpvProfession(id) {
    if (!id) return null;
    if (CPV_DEVELOPER.has(id))    return 'developer';
    if (CPV_ARCHITECT.has(id))    return 'architect';
    if (CPV_PLANNING.has(id))     return 'consultant';  // Planning Consultant chip
    if (CPV_LANDSCAPE.has(id))    return 'landscape';   // Landscape Architect chip
    if (CPV_URBAN.has(id))        return 'urban';       // Urban Designer chip
    if (CPV_ENGINEER.has(id))     return 'consultant';
    if (CPV_CONSTRUCTION.has(id)) return 'developer';
    // Prefix fallback for sub-codes not in explicit sets
    if (id.startsWith('7120')||id.startsWith('7121')||id.startsWith('7122')||
        id.startsWith('7123')||id.startsWith('7124')||id.startsWith('7125')) return 'architect';
    if (id.startsWith('7141')||id.startsWith('7143'))                        return 'consultant';
    if (id.startsWith('7142'))                                                return 'landscape';
    if (id.startsWith('7130')||id.startsWith('7131')||id.startsWith('7132')||
        id.startsWith('7133')||id.startsWith('7134')||id.startsWith('7135')||
        id.startsWith('7150')||id.startsWith('7151')||id.startsWith('7152')||
        id.startsWith('7153')||id.startsWith('7154'))                        return 'consultant';
    return null;
  }

  function professionLabel(prof) {
    const map = {
      developer:  'Developer',
      architect:  'Architect',
      urban:      'Urban Designer',
      consultant: 'Planning / Engineering Consultant',
      landscape:  'Landscape Architect',
      other:      'Other',
    };
    return map[prof] || 'Other';
  }

  function isRelevant(release) {
    const tender = release.tender || {};
    const title = (tender.title || release.description || '').toLowerCase();

    // Exclude on title
    if (EXCLUSION_TERMS.some(t => title.includes(t))) return false;

    const allCpvs = getCpvs(release);

    // Architect/planning/landscape CPVs: pass if at least one non-generic CPV is ours.
    // Guards against these codes appearing incidentally in large multi-CPV frameworks
    // (e.g. 71421000 in a building-services subcontractor notice alongside 50+ other CPVs).
    const hasArchCpv = allCpvs.some(id =>
      CPV_ARCHITECT.has(id) || CPV_URBAN.has(id) ||
      CPV_PLANNING.has(id)  || CPV_LANDSCAPE.has(id)
    );
    if (hasArchCpv) {
      return allCpvs.some(id =>
        !CPV_GENERIC_ROOTS.has(id) &&
        (CPV_ARCHITECT.has(id)||CPV_URBAN.has(id)||CPV_PLANNING.has(id)||CPV_LANDSCAPE.has(id))
      );
    }

    // Specific real-estate developer CPVs: always pass
    if (allCpvs.some(id => CPV_DEVELOPER.has(id))) return true;

    // Engineer CPVs: pass only if the primary (first) CPV is engineering —
    // prevents e.g. a fire-safety works notice with incidental 71317000 slipping through
    if (allCpvs.length > 0 && CPV_ENGINEER.has(allCpvs[0])) return true;

    return false;
  }

  function enrichRelease(release) {
    const tender = release.tender || {};
    const title = tender.title || release.description || '';
    const allCpvs = getCpvs(release);
    const profession = allCpvs.map(cpvProfession).find(Boolean) || 'other';

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

  // ── SERVE FROM CACHE if still fresh ─────────────────────────────────────────
  const forceRefresh = req.query && req.query.refresh === '1';
  if (_cache && !forceRefresh && (Date.now() - _cacheTime) < CACHE_TTL_MS) {
    const age = Math.round((Date.now() - _cacheTime) / 1000);
    if (req.query && req.query.debug === '1') {
      return res.status(200).json({ ..._cache._debug, _servedFromCache: true, _cacheAgeSeconds: age });
    }
    return res.status(200).json({ ..._cache.result, _cached: true, _cacheAgeSeconds: age });
  }

  // ── FETCH ────────────────────────────────────────────────────────────────────
  try {
    const now    = new Date();
    const recent = new Date(Date.now() -  60 * 24 * 60 * 60 * 1000);
    const older  = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000);

    const fmt  = d => d.toISOString().split('.')[0];
    const base = 'https://www.find-tender.service.gov.uk/api/1.0/ocdsReleasePackages';
    const headers = { 'Accept': 'application/json' };
    const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

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
        const resp = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
        fetchStatuses.push({ ok: resp.ok, status: resp.status });
        if (resp.ok) {
          const d = await resp.json();
          allReleases.push(...(d.releases || []));
        } else if (resp.status === 429) {
          // Hit rate limit mid-fetch — stop immediately, return cache if we have it
          if (_cache) {
            return res.status(200).json({ ..._cache.result, _cached: true, _rateLimited: true });
          }
          return res.status(200).json({ releases: [], error: 'Rate limited by upstream API. Try again in a few minutes.' });
        }
      } catch (e) {
        fetchStatuses.push({ ok: false, error: e.message });
      }
      await delay(800);
    }

    const seen    = new Set();
    const deduped = allReleases.filter(r => { if (seen.has(r.id)) return false; seen.add(r.id); return true; });
    const filtered = deduped.filter(isRelevant).map(enrichRelease);

    filtered.sort((a, b) => {
      if (a._stageLabel.includes('Market') && !b._stageLabel.includes('Market')) return -1;
      if (!a._stageLabel.includes('Market') && b._stageLabel.includes('Market')) return 1;
      return new Date(b.date || 0) - new Date(a.date || 0);
    });

    const result = { releases: filtered, _total: deduped.length, _filtered: filtered.length };

    // ── DEBUG payload (built but only returned if ?debug=1) ───────────────────
    const debugSample = deduped.slice(0, 50).map(r => {
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
        id:         r.id,
        title:      tender.title || r.description || '(no title)',
        stage:      r.stage,
        cpvs:       allCpvs,
        wouldPass,
        excludedBy,
        profession: enriched ? enriched.profession : null,
        noticeType: enriched ? enriched._noticeType : null,
      };
    });
    const debugPayload = {
      _debug:           true,
      _fetchStatuses:   fetchStatuses,
      _totalFromApi:    allReleases.length,
      _afterDedup:      deduped.length,
      _wouldFilter:     filtered.length,
      _allCpvsInSample: Array.from(new Set(deduped.slice(0,50).flatMap(r => {
        const tender = r.tender || {};
        return [tender.classification && tender.classification.id,
          ...(tender.items||[]).flatMap(i=>[i.classification&&i.classification.id,...(i.additionalClassifications||[]).map(ac=>ac.id)])
        ].filter(Boolean);
      }))).sort(),
      _sample: debugSample,
    };

    // Store in cache
    _cache = { result, _debug: debugPayload };
    _cacheTime = Date.now();

    if (req.query && req.query.debug === '1') {
      return res.status(200).json(debugPayload);
    }

    return res.status(200).json(result);
  } catch (e) {
    console.error('Tenders:', e.message);
    // Return stale cache rather than empty on error
    if (_cache) {
      return res.status(200).json({ ..._cache.result, _cached: true, _stale: true });
    }
    res.status(200).json({ releases: [], error: e.message });
  }
}
