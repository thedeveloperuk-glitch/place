// planning.js — Idox Public Access scraper for major English cities outside London
// Idox is the most common planning portal system (~200 councils)
// Pattern: POST to /online-applications/search.do with form params, parse HTML results
// Birmingham uses Northgate (different scraper), handled separately

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Confirmed Idox portal URLs for major English cities outside London
  const IDOX_COUNCILS = [
    { name: 'Leeds',         url: 'https://publicaccess.leeds.gov.uk/online-applications' },
    { name: 'Nottingham',    url: 'https://publicaccess.nottinghamcity.gov.uk/online-applications' },
    { name: 'Bristol',       url: 'https://planningonline.bristol.gov.uk/online-applications' },
    { name: 'Sheffield',     url: 'https://planningapps.sheffield.gov.uk/online-applications' },
    { name: 'Liverpool',     url: 'https://planningonline.liverpool.gov.uk/online-applications' },
    { name: 'Manchester',    url: 'https://pa.manchester.gov.uk/online-applications' },
    { name: 'Newcastle',     url: 'https://publicaccess.newcastle.gov.uk/online-applications' },
    { name: 'Leicester',     url: 'https://planning.leicester.gov.uk/online-applications' },
    { name: 'Coventry',      url: 'https://planning.coventry.gov.uk/online-applications' },
    { name: 'Southampton',   url: 'https://planningpublicaccess.southampton.gov.uk/online-applications' },
  ];

  // Date 90 days ago in DD/MM/YYYY for Idox form
  const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const dateStr = `${String(since.getDate()).padStart(2,'0')}/${String(since.getMonth()+1).padStart(2,'0')}/${since.getFullYear()}`;
  const todayStr = `${String(new Date().getDate()).padStart(2,'0')}/${String(new Date().getMonth()+1).padStart(2,'0')}/${new Date().getFullYear()}`;

  // Parse Idox HTML results page into application objects
  function parseIdoxResults(html, councilName, baseUrl) {
    const apps = [];
    // Match each result row — Idox uses <li class="searchresult"> or <tr>
    // The summary URL pattern: /online-applications/applicationDetails.do?activeTab=summary&keyVal=XXXX
    const appPattern = /applicationDetails\.do\?activeTab=summary&keyVal=([^"']+)/g;
    const seen = new Set();
    let match;

    while ((match = appPattern.exec(html)) !== null) {
      const keyVal = match[1];
      if (seen.has(keyVal)) continue;
      seen.add(keyVal);

      // Extract surrounding context for this result
      const idx = match.index;
      const chunk = html.substring(Math.max(0, idx - 500), idx + 1000);

      // Extract reference number
      const refMatch = chunk.match(/class="[^"]*reference[^"]*"[^>]*>([^<]+)</i) ||
                       chunk.match(/Reference[^:]*:?\s*<[^>]+>([^<]+)</i);
      const reference = refMatch ? refMatch[1].trim() : keyVal;

      // Extract address
      const addrMatch = chunk.match(/class="[^"]*address[^"]*"[^>]*>([^<]+)</i) ||
                        chunk.match(/Address[^:]*:?\s*<[^>]+>([^<]+)</i);
      const address = addrMatch ? addrMatch[1].trim() : '';

      // Extract description/proposal
      const descMatch = chunk.match(/class="[^"]*proposal[^"]*"[^>]*>([\s\S]*?)<\/(?:p|span|td)/i) ||
                        chunk.match(/Proposal[^:]*:?\s*<[^>]+>([\s\S]*?)<\/(?:p|span|td)/i);
      const description = descMatch
        ? descMatch[1].replace(/<[^>]+>/g, '').trim().substring(0, 500)
        : '';

      // Extract status
      const statusMatch = chunk.match(/class="[^"]*status[^"]*"[^>]*>([^<]+)</i) ||
                          chunk.match(/Status[^:]*:?\s*<[^>]+>([^<]+)</i);
      const status = statusMatch ? statusMatch[1].trim() : '';

      // Extract validated date
      const dateMatch = chunk.match(/Validated[^:]*:?\s*<[^>]+>([^<]+)</i) ||
                        chunk.match(/Received[^:]*:?\s*<[^>]+>([^<]+)</i);
      const validDate = dateMatch ? dateMatch[1].trim() : '';

      if (!description && !address) continue; // skip empty

      apps.push({
        keyVal,
        reference,
        address,
        description,
        status,
        validDate,
        url: `${baseUrl}/applicationDetails.do?activeTab=summary&keyVal=${keyVal}`,
        council: councilName,
      });
    }
    return apps;
  }

  // Search a single Idox council for major applications
  async function searchIdox(council) {
    try {
      const searchUrl = `${council.url}/search.do?action=advanced`;

      // First GET to establish session cookie
      const init = await fetch(searchUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; TheDeveloperIntelligence/1.0)',
          'Accept': 'text/html,application/xhtml+xml',
        },
        signal: AbortSignal.timeout(8000),
      });

      if (!init.ok) return { council: council.name, apps: [], error: `Init ${init.status}` };

      const cookies = init.headers.get('set-cookie') || '';
      const sessionCookie = cookies.split(';')[0]; // grab JSESSIONID

      // POST the search form — Major applications, date range
      const formData = new URLSearchParams({
        'searchType': 'Application',
        'applicationType': 'Major',  // Major only
        'dateType': 'DC_Validated',
        'dateStart': dateStr,
        'dateEnd': todayStr,
        'caseStatus': '',
        'ward': '',
        'parish': '',
        'resultsPerPage': '50',
        '_csrf': '', // Idox doesn't always require CSRF for search
      });

      const searchRes = await fetch(`${council.url}/search.do`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'Mozilla/5.0 (compatible; TheDeveloperIntelligence/1.0)',
          'Referer': searchUrl,
          'Cookie': sessionCookie,
          'Accept': 'text/html',
        },
        body: formData.toString(),
        signal: AbortSignal.timeout(10000),
      });

      if (!searchRes.ok) return { council: council.name, apps: [], error: `Search ${searchRes.status}` };

      const html = await searchRes.text();
      const apps = parseIdoxResults(html, council.name, council.url);
      return { council: council.name, apps };

    } catch (e) {
      return { council: council.name, apps: [], error: e.message };
    }
  }

  try {
    // Run all councils in parallel with a 200ms stagger to be polite
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const promises = IDOX_COUNCILS.map((council, i) =>
      sleep(i * 200).then(() => searchIdox(council))
    );

    const results = await Promise.all(promises);
    const errors = results.filter(r => r.error).map(r => `${r.council}: ${r.error}`);
    const allApps = results.flatMap(r => r.apps);

    if (errors.length) console.error('Idox errors:', errors);

    // Return in PlanIt-compatible shape so frontend doesn't need changing
    const cities = results
      .filter(r => r.apps.length > 0)
      .map(r => ({ city: r.council, records: r.apps, total: r.apps.length }));

    res.status(200).json({ cities, total: allApps.length, errors: errors.length ? errors : undefined });

  } catch (e) {
    res.status(500).json({ error: e.message, cities: [] });
  }
}
