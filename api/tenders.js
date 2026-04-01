// Module-level cache — persists across warm Vercel invocations
let _cache = null;
let _cacheTime = 0;
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // ── TARGET CPV CODES ────────────────────────────────────────────────────────
  // Three categories only, as specified:
  //   71200000 – Architectural and related services
  //   71400000 – Urban planning and landscape architectural services
  //   70110000 – Development services of real estate

  // Prefix sets — catches the parent code AND every sub-code beneath it,
  // even when the API appends a qualifier suffix like "71200000-6".
  // We normalise codes before matching (see normCpv below).

  // 712xxxxx  →  Architectural & related services (71200000 and children)
  const ARCH_PREFIX     = '712';

  // 714xxxxx  →  Urban planning & landscape architecture (71400000 and children)
  const URBAN_PREFIX    = '714';

  // 7011xxxx  →  Development services of real estate (70110000 and children)
  // We also keep the broader 701 and 702 blocks for letting/management
  // notices that often accompany development briefs.
  const DEV_PREFIXES    = ['7011', '7012', '701', '702'];

  // Explicit sets for the three headline parent codes — belt-and-braces
  const EXACT_TARGETS   = new Set(['71200000', '71400000', '70110000']);

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

  // Strip any CPV qualifier suffix (e.g. "71200000-6" → "71200000")
  function normCpv(id) {
    if (!id) return null;
    return String(id).replace(/-\d+$/, '').trim();
  }

  // Collect and normalise all CPV codes from a release
  function getCpvs(release) {
    const tender = release.tender || {};
    const raw = [
      tender.classification?.id,
      ...(tender.items || []).flatMap(i => [
        i.classification?.id,
        ...(i.additionalClassifications || []).map(ac => ac.id),
      ]),
    ];
    return raw.map(normCpv).filter(Boolean);
  }

  // Return which category a normalised CPV code belongs to
  function cpvCategory(id) {
    if (!id) return null;
    if (id.startsWith(ARCH_PREFIX))            return 'arch';
    if (id.startsWith(URBAN_PREFIX))           return 'planning';
    if (DEV_PREFIXES.some(p => id.startsWith(p))) return 'property';
    if (EXACT_TARGETS.has(id))                return 'arch'; // fallback for exact match
    return null;
  }

  function isRelevantCpv(id) {
    if (!id) return false;
    if (EXACT_TARGETS.has(id))                return true;
    if (id.startsWith(ARCH_PREFIX))           return true;  // 712xxxxxx
    if (id.startsWith(URBAN_PREFIX))          return true;  // 714xxxxxx
    if (DEV_PREFIXES.some(p => id.startsWith(p))) return true; // 701x/702x
    return false;
  }

  function isRelevant(release) {
    const tender = release.tender || {};
    const title = (tender.title || release.description || '').toLowerCase();

    // Drop obvious supply/FM notices by title keyword
    if (EXCLUSION_TERMS.some(t => title.includes(t))) return false;

    const allCpvs = getCpvs(release);

    // Pass if ANY normalised CPV hits one of our three target families
    return allCpvs.some(isRelevantCpv);
  }

  function enrichRelease(release) {
    const allCpvs = getCpvs(release);
    const category = allCpvs.map(cpvCategory).find(Boolean) || 'other';

    const stageMap = {
      planning:           'Pipeline Notice',
      market_engagement:  'Market Engagement',
      tender:             'Tender',
      award:              'Contract Award',
      active:             'Active',
    };
    const stageLabel = stageMap[release.stage || ''] || release.stage || 'Notice';

    return {
      ...release,
      profession:   category,
      _stageLabel:  stageLabel,
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
    const recent = new Date(Date.now() -  60 * 24 * 60 * 60 * 1000); // 60 days
    const older  = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000); // 180 days

    const fmt  = d => d.toISOString().split('.')[0];
    const base = 'https://www.find-tender.service.gov.uk/api/1.0/ocdsReleasePackages';
    const headers = { 'Accept': 'application/json' };
    const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

    // ── Fetch all three notice types the user wants ──────────────────────────
    //   stages=tender             → Contract / Tender Notices
    //   stages=planning           → Pipeline / Prior Information Notices
    //   stages=market_engagement  → Preliminary Market Engagement Notices
    //     (introduced under the Procurement Act 2023)
    const urls = [
      // Tender notices — recent window
      `${base}?stages=tender&updatedFrom=${fmt(recent)}&updatedTo=${fmt(now)}&limit=100`,
      // Tender notices — older window (catch longer-running procurements)
      `${base}?stages=tender&updatedFrom=${fmt(older)}&updatedTo=${fmt(recent)}&limit=100`,
      // Pipeline / Prior Information Notices — recent
      `${base}?stages=planning&updatedFrom=${fmt(recent)}&updatedTo=${fmt(now)}&limit=100`,
      // Pipeline — older
      `${base}?stages=planning&updatedFrom=${fmt(older)}&updatedTo=${fmt(recent)}&limit=100`,
      // Preliminary Market Engagement — recent
      `${base}?stages=market_engagement&updatedFrom=${fmt(recent)}&updatedTo=${fmt(now)}&limit=100`,
      // Preliminary Market Engagement — older
      `${base}?stages=market_engagement&updatedFrom=${fmt(older)}&updatedTo=${fmt(recent)}&limit=100`,
    ];

    const allReleases = [];
    const fetchStatuses = [];
    for (const url of urls) {
      try {
        const resp = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
        fetchStatuses.push({ url, ok: resp.ok, status: resp.status });
        if (resp.ok) {
          const d = await resp.json();
          allReleases.push(...(d.releases || []));
        } else if (resp.status === 429) {
          if (_cache) {
            return res.status(200).json({ ..._cache.result, _cached: true, _rateLimited: true });
          }
          return res.status(200).json({ releases: [], error: 'Rate limited by upstream API. Try again in a few minutes.' });
        }
      } catch (e) {
        fetchStatuses.push({ url, ok: false, error: e.message });
      }
      await delay(800);
    }

    const seen    = new Set();
    const deduped = allReleases.filter(r => {
      if (seen.has(r.id)) return false;
      seen.add(r.id);
      return true;
    });

    const filtered = deduped.filter(isRelevant).map(enrichRelease);

    // Sort: Market Engagement first, then Pipeline, then Tender; newest within each group
    const stageOrder = { 'Market Engagement': 0, 'Pipeline Notice': 1, 'Tender': 2 };
    filtered.sort((a, b) => {
      const sa = stageOrder[a._stageLabel] ?? 3;
      const sb = stageOrder[b._stageLabel] ?? 3;
      if (sa !== sb) return sa - sb;
      return new Date(b.date || 0) - new Date(a.date || 0);
    });

    const result = { releases: filtered, _total: deduped.length, _filtered: filtered.length };

    // ── DEBUG payload ─────────────────────────────────────────────────────────
    const debugSample = deduped.map(r => {
      const tender  = r.tender || {};
      const allCpvs = getCpvs(r);
      const wouldPass   = isRelevant(r);
      const enriched    = wouldPass ? enrichRelease(r) : null;
      const excludedBy  = EXCLUSION_TERMS.find(t => (tender.title || '').toLowerCase().includes(t)) || null;
      return {
        id:         r.id,
        title:      tender.title || r.description || '(no title)',
        stage:      r.stage,
        cpvs:       allCpvs,
        wouldPass,
        excludedBy,
        profession: enriched ? enriched.profession : null,
        stageLabel: enriched ? enriched._stageLabel : null,
      };
    });

    const debugPayload = {
      _debug:           true,
      _fetchStatuses:   fetchStatuses,
      _totalFromApi:    allReleases.length,
      _afterDedup:      deduped.length,
      _wouldFilter:     filtered.length,
      _allCpvsInSample: Array.from(new Set(deduped.flatMap(getCpvs))).sort(),
      _sample:          debugSample,
    };

    _cache     = { result, _debug: debugPayload };
    _cacheTime = Date.now();

    if (req.query && req.query.debug === '1') {
      return res.status(200).json(debugPayload);
    }

    return res.status(200).json(result);

  } catch (e) {
    console.error('Tenders:', e.message);
    if (_cache) {
      return res.status(200).json({ ..._cache.result, _cached: true, _stale: true });
    }
    res.status(200).json({ releases: [], error: e.message });
  }
}
