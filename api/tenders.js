// Simple in-memory cache — survives across warm serverless invocations
// Prevents hammering the FTS API on every page load
let _cache = null;
let _cacheTime = 0;
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // ── CPV whitelist ─────────────────────────────────────────────────────────
  // Three saved searches on find-tender.service.gov.uk:
  //   71200000  Architectural and related services
  //   71400000  Urban planning and landscape architectural services
  //   70110000  Development services of real estate
  //
  // Exact code matching ONLY — no prefix/startsWith logic.
  // 70000000 and 71000000 (broad parents) deliberately excluded.

  const CPV_ARCHITECT = new Set([
    '71200000','71210000','71220000','71221000','71222000','71223000',
    '71240000','71241000','71242000','71243000','71244000','71245000',
    '71250000','71251000',
  ]);

  const CPV_URBAN = new Set([
    '71400000','71410000','71411000','71412000','71420000','71421000',
  ]);

  const CPV_DEVELOPER = new Set([
    '70110000','70111000','70112000',
    '70120000','70121000','70122000','70123000','70130000',
    '70200000','70210000','70220000',
    '70300000','70310000','70320000',
    '70330000','70331000','70332000','70333000',
  ]);

  // Landscape maintenance — only valid when combined with architecture/urban CPV
  const CPV_LANDSCAPE = new Set([
    '77310000','77311000','77313000','77314000','77315000',
  ]);

  // Tight planning/design consultancy — excludes fire safety, electrical,
  // rail, instruments, building maintenance (71314100, 71315000, 71317xxx,
  // 71334000, 71350000, 71356300, 71500000, 71510000, 71520000 all excluded)
  const CPV_PLANNING = new Set([
    '71311000','71312000','71313000',
    '71321000','71322000','71324000',
    '71540000','71541000',
  ]);

  const CPV_DESIGN = new Set([...CPV_ARCHITECT, ...CPV_URBAN]); // used for landscape check

  const ALL_CPV = new Set([
    ...CPV_ARCHITECT, ...CPV_URBAN, ...CPV_DEVELOPER,
    ...CPV_LANDSCAPE, ...CPV_PLANNING,
  ]);

  // Hard title exclusions
  const EXCLUSION_TERMS = [
    'steam clean','valeting','boiler','pipework','ductwork','hvac','plumbing',
    'fire alarm','fire suppression','sprinkler',
    'electrical supply','mechanical supply',
    'catering','kitchen equipment','laundry',
    'refuse','waste collection','pest control','grass cutting','weed control',
    'security guard','cctv','it support','software licence','software maintenance',
    'telecoms','broadband','insurance','pension','banking','audit',
    'recruitment','temporary staff',
    'medical supply','pharmaceutical','clinical','dental','nursing',
    'vehicle','fleet','removals','rolling stock','vessel','marine',
    'appliance test','pat testing',
    'microscop','imaging equipment','laboratory equipment',
    'prison healthcare','health check','care service',
    'psychological','counselling','advocacy',
  ];

  function getAllCpvs(release) {
    const tender = release.tender || {};
    return [
      tender.classification?.id,
      ...(tender.items || []).flatMap(item => [
        item.classification?.id,
        ...(item.additionalClassifications || []).map(ac => ac.id),
      ]),
    ].filter(Boolean);
  }

  function matchGroup(cpvId) {
    if (CPV_ARCHITECT.has(cpvId))  return { profession: 'architect',  label: 'Architecture' };
    if (CPV_URBAN.has(cpvId))      return { profession: 'urban',      label: 'Urban Planning & Landscape' };
    if (CPV_DEVELOPER.has(cpvId))  return { profession: 'developer',  label: 'Developer / Land' };
    if (CPV_LANDSCAPE.has(cpvId))  return { profession: 'landscape',  label: 'Landscape' };
    if (CPV_PLANNING.has(cpvId))   return { profession: 'consultant', label: 'Planning Consultancy' };
    return null;
  }

  function isRelevant(release) {
    const tender = release.tender || {};
    const title = (tender.title || release.description || '').toLowerCase();

    if (EXCLUSION_TERMS.some(t => title.includes(t))) return false;

    const cpvs = getAllCpvs(release);

    // Landscape CPVs (77xxx) only pass if the notice ALSO has an
    // architecture or urban planning CPV — blocks pure grounds maintenance
    if (cpvs.some(id => CPV_LANDSCAPE.has(id)) && !cpvs.some(id => CPV_DESIGN.has(id))) {
      return false;
    }

    return cpvs.some(id => ALL_CPV.has(id));
  }

  function enrichRelease(release) {
    const stage = release.stage || '';
    const stageLabels = {
      planning: 'UK2 Market Engagement',
      tender:   'UK1/UK3 Tender',
      award:    'UK4 Contract Award',
    };
    const cpvs = getAllCpvs(release);
    let group = null;
    for (const id of cpvs) {
      group = matchGroup(id);
      if (group) break;
    }
    return {
      ...release,
      _stageLabel: stageLabels[stage] || 'Notice',
      _noticeType: group?.label || 'Notice',
      _profession: group?.profession || 'other',
    };
  }

  try {
    // Return cached result if fresh
    if (_cache && (Date.now() - _cacheTime) < CACHE_TTL_MS) {
      return res.status(200).json({ ..._cache, _servedFromCache: true });
    }

    const now    = new Date();
    const recent = new Date(Date.now() -  60 * 24 * 60 * 60 * 1000);
    const older  = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000);
    const mid    = new Date(Date.now() -  60 * 24 * 60 * 60 * 1000);
    const fmt = d => d.toISOString().split('.')[0];
    const base = 'https://www.find-tender.service.gov.uk/api/1.0/ocdsReleasePackages';
    const headers = { 'Accept': 'application/json' };
    // 8s per fetch — well within the 30s function budget even if all four are slow
    const sig = () => ({ signal: AbortSignal.timeout(8000) });

    // allSettled: a slow or failed call returns its releases or [] without aborting the rest
    const results = await Promise.allSettled([
      fetch(`${base}?stages=tender&updatedFrom=${fmt(recent)}&updatedTo=${fmt(now)}&limit=100`,   { headers, ...sig() }),
      fetch(`${base}?stages=tender&updatedFrom=${fmt(older)}&updatedTo=${fmt(mid)}&limit=100`,    { headers, ...sig() }),
      fetch(`${base}?stages=planning&updatedFrom=${fmt(recent)}&updatedTo=${fmt(now)}&limit=100`, { headers, ...sig() }),
      fetch(`${base}?stages=planning&updatedFrom=${fmt(older)}&updatedTo=${fmt(mid)}&limit=100`,  { headers, ...sig() }),
    ]);

    const allReleases = [];
    for (const result of results) {
      if (result.status === 'fulfilled' && result.value.ok) {
        try {
          const d = await result.value.json();
          allReleases.push(...(d.releases || []));
        } catch (_) { /* malformed JSON — skip */ }
      }
    }

    const seen = new Set();
    const deduped = allReleases.filter(r => {
      if (seen.has(r.id)) return false;
      seen.add(r.id);
      return true;
    });

    const filtered = deduped.filter(isRelevant).map(enrichRelease);

    filtered.sort((a, b) => {
      const aM = a.stage === 'planning' ? 0 : 1;
      const bM = b.stage === 'planning' ? 0 : 1;
      if (aM !== bM) return aM - bM;
      return new Date(b.date || 0) - new Date(a.date || 0);
    });

    const payload = { releases: filtered, _total: deduped.length, _filtered: filtered.length };
    _cache = payload;
    _cacheTime = Date.now();
    res.status(200).json(payload);
  } catch (e) {
    console.error('Tenders:', e.message);
    res.status(200).json({ releases: [], error: e.message });
  }
}
