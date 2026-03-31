
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const q = req.query.q;
  if (!q) return res.status(400).json({ error: 'Query required' });

  try {
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q + ' regeneration property development')}&hl=en-GB&gl=GB&ceid=GB:en`;
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; TheDeveloperIntelligence/1.0)' },
      signal: AbortSignal.timeout(6000),
    });
    if (!resp.ok) return res.status(200).json({ items: [] });

    const xml = await resp.text();
    const items = [];
    const rx = /<item>([\s\S]*?)<\/item>/g;
    let m;
    while ((m = rx.exec(xml)) !== null && items.length < 5) {
      const x = m[1];
      const title   = (x.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) || x.match(/<title>(.*?)<\/title>/) || [])[1]?.trim();
      const link    = (x.match(/<link>(.*?)<\/link>/)    || [])[1]?.trim();
      const pubDate = (x.match(/<pubDate>(.*?)<\/pubDate>/) || [])[1]?.trim();
      const source  = (x.match(/<source[^>]*>(.*?)<\/source>/) || [])[1]?.replace(/<!\[CDATA\[|\]\]>/g,'').trim();
      if (title && link) items.push({ title, link, pubDate, source });
    }

    res.setHeader('Cache-Control', 'public, s-maxage=3600, max-age=3600');
    res.status(200).json({ items });
  } catch (e) {
    res.status(200).json({ items: [], error: e.message });
  }
}
