// Planning London Datahub (PLD) API route
// Elasticsearch-backed API covering all 33 London boroughs
// Guest access: https://planningdata.london.gov.uk/api-guest/
// Header required: X-API-AllowRequest: be2rmRnt&

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    // Date 60 days ago in DD/MM/YYYY format (PLD uses this format)
    const since = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
    const sinceStr = `${String(since.getDate()).padStart(2,'0')}/${String(since.getMonth()+1).padStart(2,'0')}/${since.getFullYear()}`;

    // Search for large/major applications validated in the last 60 days
    // application_type "Major" covers large residential and commercial schemes
    const query = {
      size: 50,
      query: {
        bool: {
          must: [
            {
              terms: {
                'application_type.raw': [
                  'Major Dwellings',
                  'Major Other',
                  'Major Office',
                  'Major Retail',
                  'Major Industrial',
                  'Major All',
                ]
              }
            },
            {
              range: {
                valid_date: { gte: sinceStr }
              }
            }
          ]
        }
      },
      _source: [
        'lpa_name', 'lpa_app_no', 'development_description',
        'application_type', 'valid_date', 'decision_date', 'decision',
        'site_name', 'site_address', 'postcode',
        'latitude', 'longitude',
        'total_no_proposed_residential_units',
        'id', 'url_planning_app'
      ],
      sort: [{ valid_date: { order: 'desc' } }]
    };

    const upstream = await fetch(
      'https://planningdata.london.gov.uk/api-guest/applications/_search',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-AllowRequest': 'be2rmRnt&',
        },
        body: JSON.stringify(query),
      }
    );

    if (!upstream.ok) {
      return res.status(upstream.status).json({ error: `PLD upstream error: ${upstream.status}` });
    }

    const data = await upstream.json();
    // Elasticsearch wraps results in hits.hits
    const hits = data?.hits?.hits || [];
    res.status(200).json({ records: hits.map(h => h._source), total: data?.hits?.total?.value || hits.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
