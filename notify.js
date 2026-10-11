/* Vercel serverless funksiyası: klan və ya oyun çatında yeni mesaj olanda bildiriş göndərir */
const admin = require('firebase-admin');

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT))
  });
}

const GAMES = {
  'pubg-mobile': 'PUBG Mobile', 'fortnite': 'Fortnite', 'valorant': 'Valorant', 'cs2': 'CS2',
  'standoff2': 'Standoff 2', 'codm': 'Call of Duty Mobile', 'minecraft': 'Minecraft',
  'brawl-stars': 'Brawl Stars', 'efootball': 'eFootball', 'fifa': 'FIFA'
};
const lastSent = new Map(); /* oyun çatlarında çox tez-tez bildiriş getməsin */

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method' });
  try {
    const idToken = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const user = await admin.auth().verifyIdToken(idToken);

    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const text = String(body.text || '').slice(0, 120);
    if (!text) return res.status(400).json({ error: 'bad request' });

    const db = admin.firestore();
    const sender = user.name || 'Üzv';
    let pairs = [], title, url, tag;

    if (body.clanId) {
      const clanId = String(body.clanId);
      const snap = await db.doc('clans/' + clanId).get();
      if (!snap.exists) return res.status(404).json({ error: 'no clan' });
      const clan = snap.data();
      if (!(clan.members || []).includes(user.uid)) return res.status(403).json({ error: 'not a member' });
      const others = clan.members.filter(u => u !== user.uid);
      const docs = await Promise.all(others.map(u => db.doc('tokens/' + u).get()));
      docs.forEach((d, i) => { if (d.exists) (d.data().list || []).forEach(t => pairs.push({ uid: others[i], token: t })); });
      title = clan.name + ' · ' + sender; url = '/#/chat/clan-' + clanId; tag = 'clan-' + clanId;
    } else if (body.gameId) {
      const gameId = String(body.gameId);
      if (!GAMES[gameId]) return res.status(400).json({ error: 'bad game' });
      const now = Date.now();
      if (now - (lastSent.get(gameId) || 0) < 8000) return res.json({ sent: 0, throttled: true });
      lastSent.set(gameId, now);
      const q = await db.collection('tokens').where('games', 'array-contains', gameId).get();
      q.forEach(d => { if (d.id !== user.uid) (d.data().list || []).forEach(t => pairs.push({ uid: d.id, token: t })); });
      title = GAMES[gameId] + ' · ' + sender; url = '/#/chat/' + gameId; tag = 'game-' + gameId;
    } else {
      return res.status(400).json({ error: 'bad request' });
    }

    if (!pairs.length) return res.json({ sent: 0 });

    const r = await admin.messaging().sendEachForMulticast({
      tokens: pairs.map(p => p.token),
      data: { title, body: text, url, tag },
      webpush: { headers: { Urgency: 'high', TTL: '3600' } }
    });

    /* köhnəlmiş tokenləri təmizlə */
    const dead = [];
    r.responses.forEach((x, i) => {
      const c = x.error && x.error.code;
      if (c === 'messaging/registration-token-not-registered' || c === 'messaging/invalid-registration-token') dead.push(pairs[i]);
    });
    await Promise.all(dead.map(p => db.doc('tokens/' + p.uid).update({ list: admin.firestore.FieldValue.arrayRemove(p.token) }).catch(() => {})));

    return res.json({ sent: r.successCount });
  } catch (e) {
    return res.status(401).json({ error: 'auth' });
  }
};
