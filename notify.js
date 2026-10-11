/* Vercel serverless funksiyası: klan çatında yeni mesaj olanda digər üzvlərə push göndərir */
const admin = require('firebase-admin');

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT))
  });
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method' });
  try {
    const idToken = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const user = await admin.auth().verifyIdToken(idToken);

    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const clanId = String(body.clanId || '');
    const text = String(body.text || '').slice(0, 120);
    if (!clanId || !text) return res.status(400).json({ error: 'bad request' });

    const db = admin.firestore();
    const snap = await db.doc('clans/' + clanId).get();
    if (!snap.exists) return res.status(404).json({ error: 'no clan' });
    const clan = snap.data();
    if (!(clan.members || []).includes(user.uid)) return res.status(403).json({ error: 'not a member' });

    const others = clan.members.filter(u => u !== user.uid);
    const docs = await Promise.all(others.map(u => db.doc('tokens/' + u).get()));
    const pairs = [];
    docs.forEach((d, i) => { if (d.exists) (d.data().list || []).forEach(t => pairs.push({ uid: others[i], token: t })); });
    if (!pairs.length) return res.json({ sent: 0 });

    const sender = user.name || (clan.memberNames && clan.memberNames[user.uid]) || 'Üzv';
    const r = await admin.messaging().sendEachForMulticast({
      tokens: pairs.map(p => p.token),
      data: { title: clan.name + ' · ' + sender, body: text, url: '/#/chat/clan-' + clanId, tag: 'clan-' + clanId },
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
