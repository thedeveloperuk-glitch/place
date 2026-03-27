// Planning London Datahub (PLD) — public Elasticsearch API
// No auth required for guest read access

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    // Date 60 days ago — PLD uses DD/MM/YYYY format for valid_date range queries
    const since = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
    const sinceStr = `${String(since.getDate()).padStart(2,'0')}/${String(since.getMonth()+1).padStart(2,'0')}/${since.getFullYear()}`;

    // Filter strategy:
    // - valid_date range covers last 60 days
    // - must have 10+ proposed residential units OR 1000m²+ GIA gained (major threshold)
    // - application_type NOT "All Other" / "Trees" / "Advertising" etc. — keep substantive types
    const query = {
      size: 50,
      query: {
        bool: {
          must: [
            {
              range: {
                valid_date: { gte: sinceStr, format: 'dd/MM/yyyy' }
              }
            }
          ],
          should: [
            {
              range: {
                'application_details.total_no_proposed_residential_units': { gte: 10 }
              }
            },
            {
              range: {
                'application_details.total_gia_gained': { gte: 1000 }
              }
            },
            {
              terms: {
                'application_type.raw': ['Major Dwellings', 'Major Other', 'Major Office', 'Major Retail', 'Major Industrial']
              }
            }
          ],
          minimum_should_match: 1,
          must_not: [
            { term: { 'application_type.raw': 'Trees' } },
            { term: { 'application_type.raw': 'Advertising' } },
            { term: { 'application_type.raw': 'Telecoms' } }
          ]
        }
      },
      _source: [
        'lpa_name', 'borough', 'lpa_app_no', 'description',
        'application_type', 'application_type_full',
        'valid_date', 'decision_date', 'decision', 'status',
        'site_name', 'site_number', 'street_name', 'postcode',
        'centroid',
        'application_details.total_no_proposed_residential_units',
        'application_details.total_gia_gained',
        'id', 'url_planning_app', 'pp_id'
      ],
      sort: [{ valid_date: { order: 'desc', format: 'dd/MM/yyyy' } }]
    };

    const upstream = await fetch(
      'https://planningdata.london.gov.uk/api-guest/applications/_search',
      {
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

    res.status(200).json({
      records,
      total: data?.hits?.total?.value || records.length,
    });

  } catch (e) {
    console.error('London PLD fetch error:', e.message);
    res.status(500).json({ error: e.message, records: [] });
  }
}
