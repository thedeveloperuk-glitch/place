export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const url = `https://www.planning.data.gov.uk/entity.json?dataset=brownfield-land&limit=100&entries=active`;
    const upstream = await fetch(url, { headers: { 'Accept': 'application/json' } });
    if (!upstream.ok) {
      return res.status(upstream.status).json({ error: `Upstream error: ${upstream.status}` });
    }
    const data = await upstream.json();
    res.status(200).json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
