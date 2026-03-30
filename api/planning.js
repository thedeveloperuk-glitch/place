// api/planning.js — Planning pipeline data
// Sources:
//   - PlanIt cache (from /api/fetch-planit nightly cron) — 417 councils, large apps
//   - Bristol City Council ArcGIS (confirmed endpoint, live)
//   - Birmingham MyBrumMap layer 12 (live planning apps)
//   - Birmingham HELAA layer 45 (strategic housing sites)
//   - GM housing land supply (MappingGM, URL candidates)
//
// PlanIt is NOT called live — it's a hobby project (1 req/min limit, no SLA).
// Instead we read from the Vercel Blob cache written by the nightly cron.

import { list, head } from '@vercel/blob';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // BNG → WGS84 Helmert transform
  function bng2wgs84(E, N) {
    try {
      const a=6377563.396,b=6356256.909,F0=0.9996012717;
      const lat0=49*Math.PI/180,lon0=-2*Math.PI/180,N0=-100000,E0=400000;
      const e2=1-(b*b)/(a*a),n=(a-b)/(a+b);
      let lat=lat0,M=0;
      do {
        lat=(N-N0-M)/(a*F0)+lat;
        const Ma=(1+n+5/4*n*n+5/4*n*n*n)*(lat-lat0);
        const Mb=(3*n+3*n*n+21/8*n*n*n)*Math.sin(lat-lat0)*Math.cos(lat+lat0);
        const Mc=(15/8*n*n+15/8*n*n*n)*Math.sin(2*(lat-lat0))*Math.cos(2*(lat+lat0));
        const Md=35/24*n*n*n*Math.sin(3*(lat-lat0))*Math.cos(3*(lat+lat0));
        M=b*F0*(Ma-Mb+Mc-Md);
      } while(Math.abs(N-N0-M)>=0.00001);
      const nu=a*F0/Math.sqrt(1-e2*Math.sin(lat)*Math.sin(lat));
      const rho=a*F0*(1-e2)/Math.pow(1-e2*Math.sin(lat)*Math.sin(lat),1.5);
      const eta2=nu/rho-1,tanLat=Math.tan(lat),secLat=1/Math.cos(lat),dE=E-E0;
      const VII=tanLat/(2*rho*nu);
      const VIII=tanLat/(24*rho*Math.pow(nu,3))*(5+3*tanLat*tanLat+eta2-9*tanLat*tanLat*eta2);
      const IX=tanLat/(720*rho*Math.pow(nu,5))*(61+90*tanLat*tanLat+45*Math.pow(tanLat,4));
      const X=secLat/nu;
      const XI=secLat/(6*Math.pow(nu,3))*(nu/rho+2*tanLat*tanLat);
      const XII=secLat/(120*Math.pow(nu,5))*(5+28*tanLat*tanLat+24*Math.pow(tanLat,4));
      const XIIA=secLat/(5040*Math.pow(nu,7))*(61+662*tanLat*tanLat+1320*Math.pow(tanLat,4)+720*Math.pow(tanLat,6));
      return {
        lat:(lat-VII*Math.pow(dE,2)+VIII*Math.pow(dE,4)-IX*Math.pow(dE,6))*180/Math.PI,
        lng:(lon0+X*dE-XI*Math.pow(dE,3)+XII*Math.pow(dE,5)-XIIA*Math.pow(dE,7))*180/Math.PI,
      };
    } catch(e){return null;}
  }

  function arcgisCentroid(f) {
    let lat=null,lng=null;
    if (!f.geometry) return {lat,lng};
    if (f.geometry.x !== undefined) { lng=f.geometry.x; lat=f.geometry.y; }
    else if (f.geometry.rings) {
      const ring=f.geometry.rings[0]||[];
      if (ring.length) {
        lng=ring.reduce((s,p)=>s+p[0],0)/ring.length;
        lat=ring.reduce((s,p)=>s+p[1],0)/ring.length;
      }
    }
    if (lat&&lng&&(Math.abs(lat)>90||Math.abs(lng)>180)) {
      const w=bng2wgs84(lng,lat);
      if(w){lat=w.lat;lng=w.lng;}else{lat=null;lng=null;}
    }
    return {lat,lng};
  }

  const results = [];
  const since90 = new Date(Date.now()-90*24*60*60*1000).toISOString().slice(0,10);

  // ── 1. PLANIT — read from nightly cache ──────────────────────────────────
  // Cache written by /api/fetch-planit cron (runs 3am UTC daily).
  // If cache is missing (first deploy), this section returns nothing gracefully.
  try {
    const blob = await head('planit-cache.json');
    if (blob?.url) {
      const cr = await fetch(blob.url, {signal:AbortSignal.timeout(8000)});
      if (cr.ok) {
        const cached = await cr.json();
        const apps = cached.apps || [];
        const cacheAge = cached.fetchedAt
          ? Math.round((Date.now()-new Date(cached.fetchedAt).getTime())/(1000*60*60))
          : null;
        console.log(`PlanIt cache: ${apps.length} apps, fetched ${cacheAge}h ago`);

        const byAuthority = {};
        for (const app of apps) {
          const desc = app.description || '';
          const m = desc.match(/(\d+)\s*(?:no\.?\s*)?(?:dwelling|unit|apartment|flat|home|house|bed)/i);
          const auth = app.authority_name || 'Unknown';
          byAuthority[auth] = byAuthority[auth] || [];
          byAuthority[auth].push({
            reference: app.uid || app.reference || app.name || '',
            address:   app.address || '',
            description: desc,
            status:    app.app_state || '',
            app_type:  app.app_type || '',
            date:      app.start_date || app.decided_date || '',
            units:     m ? String(parseInt(m[1])) : null,
            lat:       parseFloat(app.lat) || null,
            lng:       parseFloat(app.lng) || null,
            url:       app.url || app.link || '',
            council:   auth,
            region:    null,
            _source:   'planit',
          });
        }
        Object.entries(byAuthority).forEach(([city,records])=>{
          results.push({city,records,total:records.length,_cacheAge:cacheAge});
        });
      }
    } else {
      console.log('PlanIt cache: not yet populated (run /api/fetch-planit to prime)');
    }
  } catch(e) {
    // Blob not set up or cache missing — fail silently, other sources still load
    console.log('PlanIt cache unavailable:', e.message);
  }

  // ── 2. BRISTOL ArcGIS (confirmed, live) ──────────────────────────────────
  try {
    const br = await fetch(
      'https://maps.bristol.gov.uk/arcgis/rest/services/ext/ll_environment_and_planning/MapServer/2/query?'
      + new URLSearchParams({
          where:`DEC_DATE >= timestamp '${since90}'`,
          outFields:'REFVAL,ADDRESS,PROPOSAL,STATUS,DECISION,DEC_DATE',
          returnGeometry:'true',outSR:'4326',resultRecordCount:'200',
          orderByFields:'DEC_DATE DESC',f:'json',
        }),
      {headers:{'Accept':'application/json','User-Agent':'TheDeveloperIntelligence/1.0'},signal:AbortSignal.timeout(10000)}
    );
    if (br.ok) {
      const bd = await br.json();
      if (!bd.error && bd.features?.length) {
        const records = bd.features.map(f=>{
          const a=f.attributes||{};
          const {lat,lng}=arcgisCentroid(f);
          return {
            reference:a.REFVAL||'',address:a.ADDRESS||'',description:a.PROPOSAL||'',
            status:a.STATUS||'',date:a.DEC_DATE?new Date(a.DEC_DATE).toLocaleDateString('en-GB'):null,
            units:null,lat,lng,
            url:a.REFVAL?`https://pa.bristol.gov.uk/online-applications/applicationDetails.do?activeTab=summary&keyVal=${a.REFVAL}`:'',
            council:'Bristol',region:'South West',_source:'bristol-arcgis',
          };
        }).filter(r=>r.description||r.address);
        results.push({city:'Bristol',records,total:records.length});
        console.log(`Bristol: ${records.length}`);
      }
    }
  } catch(e){console.error('Bristol:',e.message);}

  // ── 3. BIRMINGHAM MyBrumMap — live applications ───────────────────────────
  try {
    const bhr = await fetch(
      'https://maps.birmingham.gov.uk/server/rest/services/mybrummap/mybrummap_Planning/MapServer/12/query?'
      + new URLSearchParams({where:'1=1',outFields:'*',returnGeometry:'true',outSR:'4326',resultRecordCount:'200',orderByFields:'OBJECTID DESC',f:'json'}),
      {headers:{'Accept':'application/json','User-Agent':'TheDeveloperIntelligence/1.0'},signal:AbortSignal.timeout(10000)}
    );
    if (bhr.ok) {
      const bhd = await bhr.json();
      if (!bhd.error && bhd.features?.length) {
        const records = bhd.features.map(f=>{
          const a=f.attributes||{};
          const {lat,lng}=arcgisCentroid(f);
          const ref=a.PA_Number||a.APP_NO||a.AppRef||a.Reference||String(a.OBJECTID||'');
          const desc=a.Proposal||a.Description||a.PROPOSAL||a.Proposal_Text||'';
          const addr=a.Location||a.Address||a.Site_Address||a.SiteAddress||'';
          if(!desc&&!addr) return null;
          const m=desc.match(/(\d+)\s*(?:no\.?\s*)?(?:dwelling|unit|apartment|flat|home|house|bed)/i);
          const d=a.Valid_Date||a.ValidDate||a.Date_Valid||a.AppDate||a.VALID_DATE;
          return {
            reference:ref,address:addr,description:desc,
            status:a.Status||a.Decision||a.APP_STATUS||'',
            date:d?new Date(d).toLocaleDateString('en-GB'):null,
            units:m?String(parseInt(m[1])):null,lat,lng,
            url:`https://idoxpa.westmidlands.gov.uk/online-applications/applicationDetails.do?activeTab=summary&keyVal=${ref}`,
            council:'Birmingham',region:'Midlands',_source:'birmingham-mybrummap',
          };
        }).filter(Boolean);
        if(records.length) results.push({city:'Birmingham',records,total:records.length});
        console.log(`Birmingham: ${records.length}`);
      }
    }
  } catch(e){console.error('Birmingham:',e.message);}

  // ── 4. BIRMINGHAM HELAA — strategic sites ────────────────────────────────
  try {
    const her = await fetch(
      'https://maps.birmingham.gov.uk/server/rest/services/Internet_Planning/MapServer/45/query?'
      + new URLSearchParams({where:'1=1',outFields:'*',returnGeometry:'true',outSR:'4326',resultRecordCount:'200',f:'json'}),
      {headers:{'Accept':'application/json','User-Agent':'TheDeveloperIntelligence/1.0'},signal:AbortSignal.timeout(10000)}
    );
    if (her.ok) {
      const hed = await her.json();
      if (!hed.error && hed.features?.length) {
        const records = hed.features.map(f=>{
          const a=f.attributes||{};
          const {lat,lng}=arcgisCentroid(f);
          const units=parseInt(a.Units||a.NetDwellings||a.Dwellings||a.HousingUnits||0);
          if(units>0&&units<50) return null;
          const desc=[a.SiteName||a.Site_Name||a.Name||'',a.LandUse||a.Land_Use||a.UseType||'',a.Status||a.SiteStatus||''].filter(Boolean).join(' — ');
          const addr=a.Address||a.SiteAddress||a.SiteName||a.Site_Name||'';
          if(!desc&&!addr) return null;
          return {
            reference:a.SiteRef||a.Site_Ref||a.HELAARef||String(a.OBJECTID||''),
            address:addr,description:desc||'Birmingham HELAA site',
            status:a.Status||a.SiteStatus||'HELAA allocation',
            units:units?String(units):null,date:null,lat,lng,
            url:'https://www.planvu.co.uk/bcc/',
            council:'Birmingham',region:'Midlands',_source:'birmingham-helaa',
          };
        }).filter(Boolean);
        if(records.length) results.push({city:'Birmingham (HELAA)',records,total:records.length});
        console.log(`Birmingham HELAA: ${records.length}`);
      }
    }
  } catch(e){console.error('Birmingham HELAA:',e.message);}

  // ── 5. GREATER MANCHESTER land supply ────────────────────────────────────
  const GM_URLS=[
    'https://services.arcgis.com/t6lYS2Pmd8iVzg2t/arcgis/rest/services/GM_Housing_Land_Supply_2024/FeatureServer/0',
    'https://services1.arcgis.com/t6lYS2Pmd8iVzg2t/arcgis/rest/services/GM_Housing_Land_Supply_2024/FeatureServer/0',
    'https://services.arcgis.com/NzlPQPKn5QF9v2US/arcgis/rest/services/GM_Housing_Land_Supply_2024/FeatureServer/0',
  ];
  for(const url of GM_URLS){
    try{
      const gmr=await fetch(url+'/query?'+new URLSearchParams({
        where:'Dwellings >= 50',
        outFields:'OBJECTID,SiteRef,SiteName,SiteAddress,LocalAuthority,Dwellings,LandType,PlanningStatus,Status',
        outSR:'4326',returnGeometry:'true',resultRecordCount:'200',f:'json',
      }),{headers:{'Accept':'application/json','User-Agent':'TheDeveloperIntelligence/1.0'},signal:AbortSignal.timeout(8000)});
      if(!gmr.ok) continue;
      const gmd=await gmr.json();
      if(gmd.error||!gmd.features?.length) continue;
      const byAuth={};
      gmd.features.forEach(f=>{
        const a=f.attributes||{};
        const {lat,lng}=arcgisCentroid(f);
        const auth=a.LocalAuthority||'Greater Manchester';
        byAuth[auth]=byAuth[auth]||[];
        byAuth[auth].push({
          reference:a.SiteRef||String(a.OBJECTID),
          address:a.SiteAddress||a.SiteName||'',
          description:[a.SiteName||'',a.LandType||'',(a.Dwellings||'?')+' dwellings',a.PlanningStatus||a.Status||''].filter(Boolean).join(' — '),
          status:a.PlanningStatus||a.Status||'',units:String(a.Dwellings||0),
          lat,lng,url:null,council:auth,region:'North West',_source:'gm-land-supply',
        });
      });
      Object.entries(byAuth).forEach(([city,records])=>results.push({city,records,total:records.length}));
      console.log(`GM Land Supply: ${gmd.features.length} sites`);
      break;
    }catch(e){console.log('GM URL failed:',e.message);}
  }

  res.status(200).json({cities:results,total:results.reduce((s,r)=>s+r.records.length,0)});
}
