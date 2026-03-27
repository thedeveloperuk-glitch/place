export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    // Fetch active brownfield land entities with coordinate data
    const url = `https://www.planning.data.gov.uk/entity.json?dataset=brownfield-land&limit=100&entries=active&field=entity&field=name&field=reference&field=latitude&field=longitude&field=point&field=site-address&field=site-name&field=site-hectares&field=minimum-net-dwellings&field=maximum-net-dwellings&field=planning-permission-status&field=planning-permission-url&field=local-authority&field=organisation&field=notes`;
    const upstream = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'RegenIntel/1.0',
      }
    });
    if (!upstream.ok) {
      return res.status(upstream.status).json({ error: `Upstream error: ${upstream.status}` });
    }
    const data = await upstream.json();
    res.status(200).json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
