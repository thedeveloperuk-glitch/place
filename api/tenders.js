// Module-level cache — persists across warm Vercel invocations
let _cache = null;
let _cacheTime = 0;
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // ── CPV CODE SETS ────────────────────────────────────────────────────────────
  // Five categories only, matching exactly what was specified:
  // Architectural Services, Real Estate Development, Landscape Architecture,
  // Town Planning, Urban Design

  // Generic roots — the API uses these loosely; a notice with ONLY these is not specific enough
  const CPV_GENERIC_ROOTS = new Set(['70000000','71000000']);

  // Real estate development (70xxx) — property buying, selling, letting, management
  const CPV_DEVELOPER = new Set([
    '70100000','70110000','70111000','70112000',
    '70120000','70121000','70122000','70123000','70130000',
    '70200000','70210000','70220000','70300000','70310000',
    '70320000','70330000','70331000','70332000','70333000',
  ]);

  // Architectural services (71200–71251)
  const CPV_ARCHITECT = new Set([
    '71200000','71210000','71220000','71221000','71222000','71223000',
    '71230000','71231000','71232000',
    '71240000','71241000','71242000','71243000','71244000','71245000',
    '71246000','71247000','71248000','71250000','71251000',
  ]);

  // Town planning (71410–71413)
  const CPV_PLANNING = new Set([
    '71410000','71411000','71412000','71413000',
  ]);

  // Urban design (71400000 — urban planning general)
  const CPV_URBAN = new Set(['71400000']);

  // Landscape architecture (71420–71421) — NOT general grounds/horticulture
  const CPV_LANDSCAPE = new Set(['71420000','71421000']);

  const ALL_CPV = new Set([
    ...CPV_DEVELOPER, ...CPV_ARCHITECT,
    ...CPV_PLANNING, ...CPV_URBAN, ...CPV_LANDSCAPE,
  ]);

  // Prefix matching for sub-codes not explicitly listed above
  const CPV_PREFIXES = [
    '7120','7121','7122','7123','7124','7125',  // 712xxxx architectural
    '7140','7141','7142',                       // 714xxxx town planning / urban / landscape
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

  // Maps a CPV to a category for the plain-English filter chips in index.html
  function cpvCategory(id) {
    if (!id) return null;
    if (CPV_ARCHITECT.has(id)) return 'arch';
    if (CPV_PLANNING.has(id) || CPV_URBAN.has(id)) return 'planning';
    if (CPV_LANDSCAPE.has(id)) return 'landscape';
    if (CPV_DEVELOPER.has(id)) return 'property';
    // Prefix fallback
    if (id.startsWith('7120')||id.startsWith('7121')||id.startsWith('7122')||
        id.startsWith('7123')||id.startsWith('7124')||id.startsWith('7125')) return 'arch';
    if (id.startsWith('7140')||id.startsWith('7141')) return 'planning';
    if (id.startsWith('7142')) return 'landscape';
    return null;
  }

  function isRelevant(release) {
    const tender = release.tender || {};
    const title = (tender.title || release.description || '').toLowerCase();

    if (EXCLUSION_TERMS.some(t => title.includes(t))) return false;

    const allCpvs = getCpvs(release);

    // Pass if any non-generic CPV belongs to one of our five categories
    return allCpvs.some(id =>
      !CPV_GENERIC_ROOTS.has(id) && (
        CPV_ARCHITECT.has(id) || CPV_PLANNING.has(id) ||
        CPV_URBAN.has(id)     || CPV_LANDSCAPE.has(id) ||
        CPV_DEVELOPER.has(id) ||
        id.startsWith('7120') || id.startsWith('7121') ||
        id.startsWith('7122') || id.startsWith('7123') ||
        id.startsWith('7124') || id.startsWith('7125') ||
        id.startsWith('7140') || id.startsWith('7141') ||
        id.startsWith('7142')
      )
    );
  }

  function enrichRelease(release) {
    const tender = release.tender || {};
    const allCpvs = getCpvs(release);
    const category = allCpvs.map(cpvCategory).find(Boolean) || 'other';

    const stageMap = {
      planning: 'Early Market Engagement',
      tender:   'Tender',
      award:    'Contract Award',
      active:   'Active',
    };
    const stageLabel = stageMap[release.stage || ''] || release.stage || 'Notice';

    return {
      ...release,
      profession: category,   // index.html uses this for the cpvCategory filter
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
    const debugSample = deduped.map(r => {
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
      _allCpvsInSample: Array.from(new Set(deduped.flatMap(r => {
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
