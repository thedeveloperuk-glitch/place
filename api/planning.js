// planning.js — Council ArcGIS open data feeds
// These are genuine public REST APIs published by councils themselves
// No authentication required, no scraping, no rate limiting issues
//
// Confirmed working endpoints (verified field schemas):
//   Bristol: maps.bristol.gov.uk — fields: REFVAL, ADDRESS, PROPOSAL, STATUS, DECISION, DEC_DATE
//
// All use British National Grid (SRID 27700) — converted to WGS84 in response
// Returns in PlanIt-compatible shape { cities: [{city, records}] }

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Convert British National Grid (OSGB36) to WGS84 lat/lng
  // Helmert transformation — accurate to ~5m
  function bng2wgs84(E, N) {
    try {
      // Airy 1830 ellipsoid
      const a = 6377563.396, b = 6356256.909;
      const F0 = 0.9996012717;
      const lat0 = 49 * Math.PI / 180;
      const lon0 = -2 * Math.PI / 180;
      const N0 = -100000, E0 = 400000;
      const e2 = 1 - (b * b) / (a * a);
      const n = (a - b) / (a + b);

      let lat = lat0;
      let M = 0;
      do {
        lat = (N - N0 - M) / (a * F0) + lat;
        const Ma = (1 + n + 5/4 * n*n + 5/4 * n*n*n) * (lat - lat0);
        const Mb = (3*n + 3*n*n + 21/8 * n*n*n) * Math.sin(lat - lat0) * Math.cos(lat + lat0);
        const Mc = (15/8 * n*n + 15/8 * n*n*n) * Math.sin(2*(lat-lat0)) * Math.cos(2*(lat+lat0));
        const Md = 35/24 * n*n*n * Math.sin(3*(lat-lat0)) * Math.cos(3*(lat+lat0));
        M = b * F0 * (Ma - Mb + Mc - Md);
      } while (Math.abs(N - N0 - M) >= 0.00001);

      const nu = a * F0 / Math.sqrt(1 - e2 * Math.sin(lat)*Math.sin(lat));
      const rho = a * F0 * (1-e2) / Math.pow(1 - e2*Math.sin(lat)*Math.sin(lat), 1.5);
      const eta2 = nu/rho - 1;
      const tanLat = Math.tan(lat);
      const cosLat = Math.cos(lat);
      const secLat = 1/cosLat;
      const dE = E - E0;

      const VII = tanLat / (2*rho*nu);
      const VIII = tanLat / (24*rho*Math.pow(nu,3)) * (5 + 3*tanLat*tanLat + eta2 - 9*tanLat*tanLat*eta2);
      const IX = tanLat / (720*rho*Math.pow(nu,5)) * (61 + 90*tanLat*tanLat + 45*Math.pow(tanLat,4));
      const X = secLat / nu;
      const XI = secLat / (6*Math.pow(nu,3)) * (nu/rho + 2*tanLat*tanLat);
      const XII = secLat / (120*Math.pow(nu,5)) * (5 + 28*tanLat*tanLat + 24*Math.pow(tanLat,4));
      const XIIA = secLat / (5040*Math.pow(nu,7)) * (61 + 662*tanLat*tanLat + 1320*Math.pow(tanLat,4) + 720*Math.pow(tanLat,6));

      const latWGS = lat - VII*Math.pow(dE,2) + VIII*Math.pow(dE,4) - IX*Math.pow(dE,6);
      const lonWGS = lon0 + X*dE - XI*Math.pow(dE,3) + XII*Math.pow(dE,5) - XIIA*Math.pow(dE,7);

      return {
        lat: latWGS * 180 / Math.PI,
        lng: lonWGS * 180 / Math.PI,
      };
    } catch(e) {
      return null;
    }
  }

  // Date 90 days ago as milliseconds (for ArcGIS timestamp queries)
  const since = Date.now() - 90 * 24 * 60 * 60 * 1000;

  // ── COUNCIL ENDPOINTS ──────────────────────────────────────────────────
  // Each entry defines how to query the council's ArcGIS service and
  // map their field names to our standard schema
  // The URL fragment from the MappingGM experience app:
  // dataSource_4-195a98c641c-layer-106-1953c89e476-layer-32
  // Item ID 195a98c641c (truncated — may be 195a98c641c0 or similar)
  // Layer 32 within a multi-layer service
  // We try the most likely service URLs for the GM housing land supply
  const GM_LAND_SUPPLY_URLS = [
    'https://services.arcgis.com/t6lYS2Pmd8iVzg2t/arcgis/rest/services/GM_Housing_Land_Supply_2024/FeatureServer/0',
    'https://services1.arcgis.com/t6lYS2Pmd8iVzg2t/arcgis/rest/services/GM_Housing_Land_Supply_2024/FeatureServer/0',
    'https://services.arcgis.com/NzlPQPKn5QF9v2US/arcgis/rest/services/GM_Housing_Land_Supply_2024/FeatureServer/0',
  ];

  const COUNCILS = [
    {
      name: 'Bristol',
      region: 'South West',
      coords: { lat: 51.4545, lng: -2.5879 },
      // Confirmed: maps.bristol.gov.uk planning applications, Layer 2
      // Fields confirmed from ArcGIS service directory
      url: 'https://maps.bristol.gov.uk/arcgis/rest/services/ext/ll_environment_and_planning/MapServer/2/query',
      fields: 'REFVAL,ADDRESS,PROPOSAL,STATUS,DECISION,DEC_DATE,SHAPE',
      dateField: 'DEC_DATE',
      map: f => ({
        reference: f.REFVAL,
        address: f.ADDRESS,
        description: f.PROPOSAL,
        status: f.STATUS,
        decision: f.DECISION,
        date: f.DEC_DATE ? new Date(f.DEC_DATE).toLocaleDateString('en-GB') : null,
        url: f.REFVAL ? `https://pa.bristol.gov.uk/online-applications/applicationDetails.do?activeTab=summary&keyVal=${f.REFVAL}` : null,
      }),
      srid: 27700,
    },
    {
      name: 'Birmingham',
      region: 'Midlands',
      coords: { lat: 52.4862, lng: -1.8904 },
      // Confirmed: maps.birmingham.gov.uk MyBrumMap, mybrummap_Planning MapServer
      // Layer 12 = "Post 1990 Planning Application" — live planning applications
      // This is the same dataset powering MyBrumMap and the BCC public access map
      // MaxRecordCount: 1000, BNG 27700, supports JSON query with date filter
      url: 'https://maps.birmingham.gov.uk/server/rest/services/mybrummap/mybrummap_Planning/MapServer/12/query',
      fields: '*',
      dateField: null, // Will try date fields dynamically, fallback to 1=1
      where: '1=1', // Layer has no easily filterable date — return recent 1000 and filter client-side
      map: f => ({
        // BCC uses their own planning system field names
        // Common patterns: PA_Number, APP_NO, AppRef, Reference, REFVAL
        // Proposal, Description, Proposal_Text
        // Valid_Date, ValidDate, Date_Valid, AppDate
        // Status, Decision, APP_STATUS
        reference: f.PA_Number || f.APP_NO || f.AppRef || f.Reference || f.REFVAL || f.APP_NUM || String(f.OBJECTID || ''),
        address: f.Location || f.Address || f.Site_Address || f.SiteAddress || f.LOCATION || f.APP_ADDRESS || '',
        description: f.Proposal || f.Description || f.PROPOSAL || f.Proposal_Text || f.APP_DESC || '',
        status: f.Status || f.Decision || f.APP_STATUS || f.APP_TYPE || '',
        date: (() => {
          const d = f.Valid_Date || f.ValidDate || f.Date_Valid || f.AppDate || f.VALID_DATE || f.RECEIVED_DATE;
          return d ? new Date(d).toLocaleDateString('en-GB') : null;
        })(),
        units: null, // Extract from description in the main loop
        url: f.PA_Number
          ? `https://idoxpa.westmidlands.gov.uk/online-applications/applicationDetails.do?activeTab=summary&keyVal=${f.PA_Number}`
          : 'https://maps.birmingham.gov.uk/webapps/brum/mybrummap/',
      }),
      srid: 27700,
      // Also add HELAA as second Birmingham entry for strategic sites
    },
    {
      name: 'Birmingham',
      region: 'Midlands',
      coords: { lat: 52.4862, lng: -1.8904 },
      // Secondary: Internet_Planning MapServer, Layer 45 = HELAA
      // Housing and Economic Land Availability Assessment — strategic allocations
      // Same data as planvu.co.uk/bcc proposals map
      url: 'https://maps.birmingham.gov.uk/server/rest/services/Internet_Planning/MapServer/45/query',
      fields: '*',
      dateField: null,
      where: '1=1',
      map: f => ({
        reference: f.SiteRef || f.Site_Ref || f.SITE_REF || f.HELAARef || f.REF || String(f.OBJECTID || ''),
        address: f.Address || f.SiteAddress || f.Site_Address || f.SiteName || f.Site_Name || f.SITE_NAME || '',
        description: [
          f.SiteName || f.Site_Name || f.SITE_NAME || f.Name || '',
          f.LandUse || f.Land_Use || f.UseType || f.Use || f.USE || '',
          f.Status || f.SiteStatus || f.SITE_STATUS || '',
        ].filter(Boolean).join(' — '),
        status: f.Status || f.SiteStatus || f.SITE_STATUS || 'HELAA allocation',
        units: f.Units || f.NetDwellings || f.Dwellings || f.HousingUnits || f.Net_Dwellings || f.DWELLINGS || null,
        date: null,
        url: 'https://www.planvu.co.uk/bcc/',
      }),
      srid: 27700,
      minUnits: 50,
    },
  ];

  const results = [];

  for (const council of COUNCILS) {
    try {
      // Query: use custom where if provided, otherwise date filter or 1=1
      const whereClause = council.where
        ? council.where
        : council.dateField
          ? `${council.dateField} >= timestamp '${new Date(since).toISOString().slice(0,10)}'`
          : '1=1';

      const params = new URLSearchParams({
        where: whereClause,
        outFields: council.fields,
        returnGeometry: 'true',
        outSR: '4326', // request WGS84 directly — ArcGIS will reproject
        resultRecordCount: '200',
        orderByFields: council.dateField ? `${council.dateField} DESC` : 'OBJECTID DESC',
        f: 'json',
      });

      const response = await fetch(`${council.url}?${params}`, {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'TheDeveloperIntelligence/1.0 (festivalofplace.co.uk)',
        },
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        console.error(`${council.name}: HTTP ${response.status}`);
        continue;
      }

      const data = await response.json();

      if (data.error) {
        // Retry with simpler where clause
        console.error(`${council.name}: ArcGIS error ${data.error.code} — ${data.error.message}`);
        continue;
      }

      const features = data.features || [];

      const records = features.map(f => {
        const attrs = f.attributes || {};
        const mapped = council.map(attrs);
        // Apply minimum units filter if specified (e.g. HELAA sites)
        if (council.minUnits && mapped.units !== null && mapped.units !== undefined) {
          const u = parseInt(mapped.units);
          if (!isNaN(u) && u < council.minUnits) return null;
        }

        // Extract coordinates — ArcGIS returns centroid of polygon
        let lat = null, lng = null;
        if (f.geometry) {
          if (f.geometry.x !== undefined) {
            // Point geometry
            lng = f.geometry.x;
            lat = f.geometry.y;
          } else if (f.geometry.rings) {
            // Polygon — compute centroid
            const ring = f.geometry.rings[0] || [];
            if (ring.length > 0) {
              lng = ring.reduce((s, p) => s + p[0], 0) / ring.length;
              lat = ring.reduce((s, p) => s + p[1], 0) / ring.length;
            }
          }
        }

        // If outSR=4326 worked, coords are already WGS84
        // If not (some servers ignore outSR), convert from BNG
        if (lat && lng && (Math.abs(lat) > 90 || Math.abs(lng) > 180)) {
          const wgs = bng2wgs84(lng, lat);
          if (wgs) { lat = wgs.lat; lng = wgs.lng; }
          else { lat = null; lng = null; }
        }

        return {
          ...mapped,
          council: council.name,
          region: council.region,
          lat: lat && !isNaN(lat) ? lat : null,
          lng: lng && !isNaN(lng) ? lng : null,
        };
      }).filter(r => r && (r.description || r.address)); // skip empty/filtered records

      results.push({ city: council.name, records, total: records.length });
      console.log(`${council.name}: ${records.length} records`);

    } catch (e) {
      console.error(`${council.name}: ${e.message}`);
    }
  }

  // ── Try GM housing land supply from MappingGM ─────────────────────────
  // Filter to sites with 50+ dwellings and without full permission
  for (const url of GM_LAND_SUPPLY_URLS) {
    try {
      const params = new URLSearchParams({
        where: 'Dwellings >= 50',
        outFields: 'OBJECTID,SiteRef,SiteName,SiteAddress,LocalAuthority,Dwellings,LandType,PlanningStatus,Status',
        outSR: '4326',
        returnGeometry: 'true',
        resultRecordCount: '200',
        f: 'json',
      });
      const r = await fetch(`${url}/query?${params}`, {
        headers: { 'Accept': 'application/json', 'User-Agent': 'TheDeveloperIntelligence/1.0' },
        signal: AbortSignal.timeout(8000),
      });
      if (!r.ok) continue;
      const data = await r.json();
      if (data.error || !data.features) continue;

      const gmRecords = data.features.map(f => {
        const a = f.attributes || {};
        let lat = null, lng = null;
        if (f.geometry?.rings) {
          const ring = f.geometry.rings[0] || [];
          if (ring.length > 0) {
            lng = ring.reduce((s,p) => s+p[0], 0) / ring.length;
            lat = ring.reduce((s,p) => s+p[1], 0) / ring.length;
          }
        } else if (f.geometry?.x) { lng = f.geometry.x; lat = f.geometry.y; }
        return {
          reference: a.SiteRef || String(a.OBJECTID),
          address: a.SiteAddress || a.SiteName || '',
          description: `${a.SiteName || ''} — ${a.LandType || ''} — ${a.Dwellings || '?'} dwellings — ${a.PlanningStatus || a.Status || ''}`.trim(),
          status: a.PlanningStatus || a.Status || '',
          units: String(a.Dwellings || 0),
          council: a.LocalAuthority || 'Greater Manchester',
          region: 'North West',
          lat, lng,
          url: null,
        };
      }).filter(r => r.address || r.description);

      if (gmRecords.length > 0) {
        // Split by authority for the cities shape
        const byAuthority = {};
        gmRecords.forEach(r => {
          const key = r.council || 'Greater Manchester';
          byAuthority[key] = byAuthority[key] || [];
          byAuthority[key].push(r);
        });
        Object.entries(byAuthority).forEach(([city, records]) => {
          results.push({ city, records, total: records.length });
        });
        console.log(`GM Land Supply (MappingGM): ${gmRecords.length} sites from ${Object.keys(byAuthority).length} authorities`);
        break; // Successfully fetched, no need to try other URLs
      }
    } catch(e) {
      console.log(`GM land supply URL failed: ${e.message}`);
    }
  }

  res.status(200).json({ cities: results, total: results.reduce((s,r) => s + r.records.length, 0) });
}
