export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const CPV_DEVELOPER = new Set([
    '70000000','70100000','70110000','70111000','70112000',
    '70120000','70121000','70122000','70123000','70130000',
    '70200000','70210000','70220000','70300000','70310000',
    '70320000','70330000','70331000','70332000','70333000',
  ]);
  const CPV_ARCHITECT = new Set([
    '71200000','71210000','71220000','71221000','71222000','71223000',
    '71240000','71241000','71242000','71243000','71244000','71245000',
    '71400000','71410000','71420000','71421000',
  ]);
  const CPV_ENGINEER = new Set([
    '71300000','71310000','71311000','71312000','71313000','71315000',
    '71320000','71321000','71322000','71324000','71327000','71328000',
    '71330000','71340000','71350000','71354000','71355000','71356000',
    '71500000','71510000','71520000','71530000','71540000','71541000',
  ]);
  const CPV_PLANNING = new Set(['71410000','71411000','71412000']);
  const CPV_LANDSCAPE = new Set(['77310000','77311000','77312000','77313000','77314000','77315000']);
  const CPV_CONSTRUCTION = new Set(['45210000','45211000','45211100','45211340','45211341','45212000','45212300','45215000']);
  const ALL_CPV = new Set([...CPV_DEVELOPER,...CPV_ARCHITECT,...CPV_ENGINEER,...CPV_PLANNING,...CPV_LANDSCAPE,...CPV_CONSTRUCTION]);
  const PREFIXES = ['701','702','703','704','711','712','713','714','715','7731'];

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
    'masterplan','masterplanning','master plan','urban design',
    'placemaking','public realm','landscape design','landscape architect',
    'heritage consultant','conservation architect','listed building consent',
    'design','design guide','design review',
    'planning consultant','planning consultancy','planning services',
    'feasibility study','feasibility assessment',
    'interior design','fit-out design',
  ];

  const ENGINEERING_KEYWORDS = [
    'structural engineer','civil engineer','transport consultant',
    'quantity surveyor','project manager','project management',
    'building surveyor','building consultancy',
    'infrastructure design','drainage design','flood risk',
    'sustainability consultant','energy consultant','environmental consultant',
  ];

  const ALL_KEYWORDS = [...DEVELOPER_KEYWORDS,...ARCHITECT_KEYWORDS,...ENGINEERING_KEYWORDS];

  function isCpvRelevant(id) {
    if (!id) return false;
    if (ALL_CPV.has(id)) return true;
    return PREFIXES.some(p => id.startsWith(p));
  }

  function cpvType(id) {
    if (!id) return null;
    if (CPV_DEVELOPER.has(id)) return 'Developer';
    if (CPV_ARCHITECT.has(id)) return 'Architect';
    if (CPV_ENGINEER.has(id)) return 'Engineer';
    if (CPV_PLANNING.has(id)) return 'Planner';
    if (CPV_LANDSCAPE.has(id)) return 'Landscape';
    if (CPV_CONSTRUCTION.has(id)) return 'Construction';
    return null;
  }

  function classifyNotice(title, fullText) {
    const t = title.toLowerCase();
    const f = fullText.toLowerCase();
    if (DEVELOPER_KEYWORDS.some(kw => t.includes(kw) || f.includes(kw))) return 'Developer';
    if (ARCHITECT_KEYWORDS.some(kw => t.includes(kw) || f.includes(kw))) return 'Architect';
    if (ENGINEERING_KEYWORDS.some(kw => t.includes(kw) || f.includes(kw))) return 'Engineer';
    return 'Other';
  }

  function isRelevant(release) {
    const tender = release.tender || {};
    const title = (tender.title || release.description || '').toLowerCase();
    const fullText = [
      tender.title, tender.description, release.description,
      ...(tender.items||[]).map(i => i.description),
    ].filter(Boolean).join(' ').toLowerCase();

    if (EXCLUSION_TERMS.some(t => title.includes(t))) return false;

    const allCpvs = [
      tender.classification?.id,
      ...(tender.items||[]).flatMap(i => [
        i.classification?.id,
        ...(i.additionalClassifications||[]).map(ac => ac.id),
      ]),
    ].filter(Boolean);

    // Trusted real-estate CPVs: pass without further keyword check
    if (allCpvs.some(id => CPV_DEVELOPER.has(id))) return true;

    const hasCpv = allCpvs.some(id => isCpvRelevant(id));
    const hasKeyword = ALL_KEYWORDS.some(kw => title.includes(kw) || fullText.includes(kw));

    return hasCpv || hasKeyword;
  }

  function enrichRelease(release) {
    const tender = release.tender || {};
    const title = tender.title || release.description || '';
    const fullText = [
      tender.title, tender.description, release.description,
      ...(tender.items||[]).map(i => i.description),
    ].filter(Boolean).join(' ');

    const allCpvs = [
      tender.classification?.id,
      ...(tender.items||[]).flatMap(i => [
        i.classification?.id,
        ...(i.additionalClassifications||[]).map(ac => ac.id),
      ]),
    ].filter(Boolean);

    let noticeType = allCpvs.map(cpvType).find(Boolean) || classifyNotice(title, fullText);
    const stageMap = { planning:'Early Market Engagement', tender:'Tender', award:'Contract Award', active:'Active' };
    const stage = release.stage || '';
    const stageLabel = stageMap[stage] || stage || 'Notice';
    return { ...release, _noticeType: noticeType, _stageLabel: stageLabel };
  }

  try {
    const now    = new Date();
    const recent = new Date(Date.now() -  60 * 24 * 60 * 60 * 1000);
    const older  = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000);
    const mid    = new Date(Date.now() -  60 * 24 * 60 * 60 * 1000);
    const fmt = d => d.toISOString().split('.')[0];
    const base = 'https://www.find-tender.service.gov.uk/api/1.0/ocdsReleasePackages';
    const headers = { 'Accept': 'application/json' };
    const sig = () => ({ signal: AbortSignal.timeout(12000) });

    const [r1,r2,r3,r4] = await Promise.all([
      fetch(`${base}?stages=tender&updatedFrom=${fmt(recent)}&updatedTo=${fmt(now)}&limit=100`,   { headers,...sig() }),
      fetch(`${base}?stages=tender&updatedFrom=${fmt(older)}&updatedTo=${fmt(mid)}&limit=100`,    { headers,...sig() }),
      fetch(`${base}?stages=planning&updatedFrom=${fmt(recent)}&updatedTo=${fmt(now)}&limit=100`, { headers,...sig() }),
      fetch(`${base}?stages=planning&updatedFrom=${fmt(older)}&updatedTo=${fmt(mid)}&limit=100`,  { headers,...sig() }),
    ]);

    const allReleases = [];
    for (const resp of [r1,r2,r3,r4]) {
      if (resp.ok) { const d = await resp.json(); allReleases.push(...(d.releases||[])); }
    }

    const seen = new Set();
    const deduped = allReleases.filter(r => { if(seen.has(r.id)) return false; seen.add(r.id); return true; });
    const filtered = deduped.filter(isRelevant).map(enrichRelease);

    filtered.sort((a, b) => {
      if (a._stageLabel.includes('Market') && !b._stageLabel.includes('Market')) return -1;
      if (!a._stageLabel.includes('Market') && b._stageLabel.includes('Market')) return 1;
      return new Date(b.date||0) - new Date(a.date||0);
    });

    res.status(200).json({ releases: filtered, _total: deduped.length, _filtered: filtered.length });
  } catch (e) {
    console.error('Tenders:', e.message);
    res.status(200).json({ releases: [], error: e.message });
  }
}
