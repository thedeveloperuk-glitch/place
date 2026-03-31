export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // ── CPV code taxonomy ────────────────────────────────────────────────────
  // Any notice whose primary CPV or item CPV starts with one of these prefixes
  // is included. Profession is derived from which prefix matched.

  const CPV_GROUPS = [
    {
      profession: 'architect',
      label: 'Architecture',
      // 71200000 Architectural and related services — and all sub-codes
      prefixes: ['71200','71210','71220','71221','71222','71223','71240','71241',
                 '71242','71243','71244','71245','71250'],
    },
    {
      profession: 'urban',
      label: 'Urban Planning & Landscape',
      // 71400000 Urban planning and landscape architectural services
      prefixes: ['71400','71410','71411','71412','71420','71421'],
    },
    {
      profession: 'landscape',
      label: 'Landscape',
      // Landscape services (maintenance / consultancy)
      prefixes: ['77310','77311','77312','77313','77314','77315'],
    },
    {
      profession: 'developer',
      label: 'Developer / Land',
      // 70110000 Development services of real estate — and all real-estate sub-codes
      prefixes: ['7011','7012','7013','7032','7033'],
      // Also catch the broader 70000000 group
      exactCodes: new Set(['70000000','70100000','70110000','70111000','70112000',
                           '70120000','70121000','70122000','70123000','70130000',
                           '70200000','70210000','70220000','70300000','70310000',
                           '70320000','70330000','70331000','70332000','70333000']),
    },
    {
      profession: 'consultant',
      label: 'Planning Consultancy',
      // Engineering / technical consultancy related to built environment
      prefixes: ['71310','71311','71312','71313','71315','71320','71321','71322',
                 '71324','71327','71328','71330','71340','71350','71354','71355',
                 '71500','71510','71520','71530','71540','71541'],
    },
    {
      profession: 'masterplan',
      label: 'Masterplanning',
      prefixes: ['71251','71260','71270','71300'],
    },
  ];

  // Hard exclusions — reject regardless of CPV if title contains these
  const EXCLUSION_TERMS = [
    'waste chute','linen chute','boiler replacement','boiler service',
    'fire alarm','fire suppression','sprinkler','lift supply','elevator',
    'flooring supply','floor covering','carpet supply','curtain wall',
    'electrical supply','mechanical supply','hvac supply','plumbing supply',
    'catering equipment','kitchen equipment','laundry equipment',
    'refuse collection','cleaning contract','pest control',
    'grass cutting','weed control','security guard','it support',
    'software licence','telecoms','broadband','insurance','pension',
    'recruitment agency','temporary staff','medical supply','pharmaceutical',
  ];

  // UK notice stage labels
  const STAGE_LABELS = {
    planning: 'UK2 Market Engagement',  // Prior Information Notice / preliminary market engagement
    tender:   'UK1/UK3 Tender',
    award:    'UK3 Award',
    active:   'Active',
  };

  // ── CPV matching ──────────────────────────────────────────────────────────
  function matchCpv(cpvId) {
    if (!cpvId) return null;
    for (const group of CPV_GROUPS) {
      if (group.exactCodes?.has(cpvId)) return group;
      if (group.prefixes.some(p => cpvId.startsWith(p))) return group;
    }
    return null;
  }

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

  function isRelevant(release) {
    const tender = release.tender || {};
    const title = (tender.title || release.description || '').toLowerCase();

    // Hard exclusions on title
    if (EXCLUSION_TERMS.some(t => title.includes(t))) return false;

    // Require a matching CPV code for all stages including UK2 planning notices
    const cpvs = getAllCpvs(release);
    return cpvs.some(id => matchCpv(id) !== null);
  }

  function enrichRelease(release) {
    const tender = release.tender || {};
    const title = tender.title || release.description || '';
    const stage = release.stage || '';
    const stageLabel = STAGE_LABELS[stage] || stage || 'Notice';

    // Determine profession from CPV — first match wins
    const cpvs = getAllCpvs(release);
    let matchedGroup = null;
    for (const id of cpvs) {
      matchedGroup = matchCpv(id);
      if (matchedGroup) break;
    }

    // For planning-stage notices without a CPV match, default to developer
    // (UK2 market engagement notices are most commonly developer-facing)
    const profession = matchedGroup?.profession || (stage === 'planning' ? 'developer' : 'other');
    const noticeType = matchedGroup?.label || (stage === 'planning' ? 'Market Engagement' : 'Notice');

    return { ...release, _stageLabel: stageLabel, _noticeType: noticeType, _profession: profession };
  }

  try {
    const now    = new Date();
    const recent = new Date(Date.now() -  60 * 24 * 60 * 60 * 1000); // last 60 days
    const older  = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000); // 60–180 days ago
    const mid    = new Date(Date.now() -  60 * 24 * 60 * 60 * 1000);
    const fmt = d => d.toISOString().split('.')[0];
    const base = 'https://www.find-tender.service.gov.uk/api/1.0/ocdsReleasePackages';
    const headers = { 'Accept': 'application/json' };
    const sig = () => ({ signal: AbortSignal.timeout(12000) });

    // Four parallel calls: tender + planning (UK2), two time windows each
    const [r1, r2, r3, r4] = await Promise.all([
      fetch(`${base}?stages=tender&updatedFrom=${fmt(recent)}&updatedTo=${fmt(now)}&limit=100`,   { headers, ...sig() }),
      fetch(`${base}?stages=tender&updatedFrom=${fmt(older)}&updatedTo=${fmt(mid)}&limit=100`,    { headers, ...sig() }),
      fetch(`${base}?stages=planning&updatedFrom=${fmt(recent)}&updatedTo=${fmt(now)}&limit=100`, { headers, ...sig() }),
      fetch(`${base}?stages=planning&updatedFrom=${fmt(older)}&updatedTo=${fmt(mid)}&limit=100`,  { headers, ...sig() }),
    ]);

    const allReleases = [];
    for (const resp of [r1, r2, r3, r4]) {
      if (resp.ok) { const d = await resp.json(); allReleases.push(...(d.releases || [])); }
    }

    // Deduplicate
    const seen = new Set();
    const deduped = allReleases.filter(r => { if (seen.has(r.id)) return false; seen.add(r.id); return true; });

    const filtered = deduped.filter(isRelevant).map(enrichRelease);

    // Sort: UK2 market engagement first, then by date descending
    filtered.sort((a, b) => {
      const aMarket = a.stage === 'planning' ? 0 : 1;
      const bMarket = b.stage === 'planning' ? 0 : 1;
      if (aMarket !== bMarket) return aMarket - bMarket;
      return new Date(b.date || 0) - new Date(a.date || 0);
    });

    res.status(200).json({ releases: filtered, _total: deduped.length, _filtered: filtered.length });
  } catch (e) {
    console.error('Tenders:', e.message);
    res.status(200).json({ releases: [], error: e.message });
  }
}
