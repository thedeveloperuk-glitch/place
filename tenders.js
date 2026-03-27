export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split('.')[0];
    const url = `https://www.find-tender.service.gov.uk/api/1.0/ocdsReleasePackages?stages=planning&updatedFrom=${since}&limit=100`;
    const upstream = await fetch(url, {
      headers: { 'Accept': 'application/json' }
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
