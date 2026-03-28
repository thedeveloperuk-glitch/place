export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    // ── SOURCE 1: planning.data.gov.uk brownfield register ──────────────────
    // Not-permissioned and pending-decision sites, 50+ dwellings
    const BASE = 'https://www.planning.data.gov.uk/entity.json?dataset=brownfield-land&entries=active&limit=100';
    const FIELDS = [
      'entity','name','reference','latitude','longitude','point',
      'site-address','site-name','site-hectares',
      'minimum-net-dwellings','maximum-net-dwellings',
      'planning-permission-status','planning-permission-url',
      'local-authority','organisation','notes'
    ].map(f => `field=${f}`).join('&');

    const [notPermissioned, pendingDecision] = await Promise.all([
      fetch(`${BASE}&planning-permission-status=not-permissioned&${FIELDS}`, {
        headers: { 'Accept': 'application/json', 'User-Agent': 'TheDeveloperIntelligence/1.0' }
      }),
      fetch(`${BASE}&planning-permission-status=pending-decision&${FIELDS}`, {
        headers: { 'Accept': 'application/json', 'User-Agent': 'TheDeveloperIntelligence/1.0' }
      }),
    ]);

    const results = [];
    for (const response of [notPermissioned, pendingDecision]) {
      if (!response.ok) continue;
      const data = await response.json();
      const entities = (data.entities || []).filter(e => {
        const min = parseInt(e['minimum-net-dwellings'] || e['maximum-net-dwellings'] || '0');
        return min >= 50;
      });
      results.push(...entities);
    }

    // Deduplicate
    const seen = new Set();
    const deduped = results.filter(e => {
      if (seen.has(e.entity)) return false;
      seen.add(e.entity);
      return true;
    });

    // ── SOURCE 2: Manchester SHLAA capacity sites (ArcGIS open data) ────────
    // Item ecff298c33e24253833a3cfb573c1f4b — capacity sites with no permission
    // Sites identified as suitable for housing but no planning permission yet
    // These are exactly what a developer/architect wants — unoptioned land
    const manchesterSites = [];
    try {
      // Try the standard ArcGIS Hub FeatureServer URL pattern
      // Layer 0 = capacity sites (no permission), 50+ homes filter
      const mcr = await fetch(
        'https://services1.arcgis.com/rMmfNkLG4FMT2N5d/arcgis/rest/services/OpenData_SHLAA/FeatureServer/0/query?' +
        new URLSearchParams({
          where: 'Capacity >= 50',
          outFields: 'OBJECTID,SiteRef,SiteName,Address,Capacity,LandType,Deliverable,x,y',
          outSR: '4326',
          returnGeometry: 'true',
          resultRecordCount: '200',
          f: 'json',
        }),
        { headers: { 'Accept': 'application/json', 'User-Agent': 'TheDeveloperIntelligence/1.0' },
          signal: AbortSignal.timeout(8000) }
      );
      if (mcr.ok) {
        const mcrData = await mcr.json();
        if (!mcrData.error && mcrData.features) {
          for (const f of mcrData.features) {
            const a = f.attributes || {};
            // Get centroid from polygon
            let lat = null, lng = null;
            if (f.geometry?.rings) {
              const ring = f.geometry.rings[0] || [];
              if (ring.length > 0) {
                lng = ring.reduce((s,p) => s+p[0], 0) / ring.length;
                lat = ring.reduce((s,p) => s+p[1], 0) / ring.length;
              }
            } else if (f.geometry?.x) {
              lng = f.geometry.x; lat = f.geometry.y;
            }
            manchesterSites.push({
              entity: 'mcr_' + a.OBJECTID,
              name: a.SiteRef || a.SiteName || 'Manchester SHLAA Site',
              reference: a.SiteRef || '',
              'site-address': a.Address || a.SiteName || 'Manchester',
              'site-name': a.SiteName || '',
              'minimum-net-dwellings': String(a.Capacity || 0),
              'maximum-net-dwellings': String(a.Capacity || 0),
              'planning-permission-status': 'not-permissioned',
              'local-authority': 'Manchester City Council',
              notes: a.LandType ? `Land type: ${a.LandType}. Deliverable: ${a.Deliverable || 'unknown'}` : '',
              latitude: lat ? String(lat) : null,
              longitude: lng ? String(lng) : null,
              _source: 'manchester-shlaa',
            });
          }
          console.log(`Manchester SHLAA: ${manchesterSites.length} capacity sites`);
        }
      }
    } catch(e) {
      console.log('Manchester SHLAA fetch failed (URL may need updating):', e.message);
    }

    res.status(200).json({ 
      entities: [...deduped, ...manchesterSites],
      sources: {
        brownfieldRegister: deduped.length,
        manchesterShlaa: manchesterSites.length,
      }
    });

  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
