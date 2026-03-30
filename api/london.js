export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const since = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
    const sinceStr = `${String(since.getDate()).padStart(2,'0')}/${String(since.getMonth()+1).padStart(2,'0')}/${since.getFullYear()}`;

    const query = {
      size: 50,
      query: {
        bool: {
          must: [
            { range: { valid_date: { gte: sinceStr, format: 'dd/MM/yyyy' } } },
          ],
          should: [
            // 50+ proposed residential units
            { range: { 'application_details.total_no_proposed_residential_units': { gte: 50 } } },
            // OR large GIA (3,500m² ≈ 50 homes at ~70m² each)
            { range: { 'application_details.total_gia_gained': { gte: 3500 } } },
          ],
          minimum_should_match: 1,
          must_not: [
            { term: { 'application_type_full.raw': 'Householder planning permission' } },
            { term: { 'application_type_full.raw': 'Lawful development: Proposed use' } },
            { term: { 'application_type_full.raw': 'Lawful development: Existing use' } },
          ]
        }
      },
      _source: [
        'lpa_name', 'borough', 'lpa_app_no', 'description',
        'application_type', 'application_type_full',
        'valid_date', 'decision_date', 'decision', 'status',
        'site_name', 'site_number', 'street_name', 'postcode',
        'centroid',
        'application_details.total_gia_gained',
        'application_details.total_no_proposed_residential_units',
        'id', 'url_planning_app', 'pp_id'
      ],
      sort: [{ valid_date: { order: 'desc', format: 'dd/MM/yyyy' } }]
    };

    const upstream = await fetch(
      'https://planningdata.london.gov.uk/api-guest/applications/_search',
      {
        signal: AbortSignal.timeout(12000),
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(query),
      }
    );

    if (!upstream.ok) {
      const text = await upstream.text();
      console.error('PLD error:', upstream.status, text.slice(0, 300));
      return res.status(upstream.status).json({ error: `PLD returned ${upstream.status}`, records: [] });
    }

    const data = await upstream.json();
    const hits = data?.hits?.hits || [];
    const records = hits.map(h => h._source);

    res.status(200).json({ records, total: data?.hits?.total?.value || records.length });

  } catch (e) {
    console.error('London PLD fetch error:', e.message);
    res.status(500).json({ error: e.message, records: [] });
  }
}
