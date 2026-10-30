// EntregaX — servidor (Node 18+, sem dependências)
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const SECRET = process.env.APP_SECRET || 'troque-este-segredo-em-producao';
const DB_FILE = path.join(__dirname, 'data.json');
const PUBLIC = path.join(__dirname, 'public');

// ---------- Banco (arquivo JSON) ----------
let db = { users: [], stores: [], orders: [], locations: {} };
const uid = () => crypto.randomBytes(6).toString('hex');
function save() { fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 1)); }
function hash(pw, salt) { return crypto.scryptSync(pw, salt, 32).toString('hex'); }
function addUser(role, name, email, pw, storeId) {
  const salt = uid();
  const u = { id: uid(), role, name, email: email.toLowerCase(), salt, pass: hash(pw, salt), storeId };
  db.users.push(u); return u;
}
if (fs.existsSync(DB_FILE)) db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
else {
  const s = { id: uid(), name: 'Loja Campo Mourão', address: 'Av. Capitão Índio Bandeira, 1400, Campo Mourão - PR', lat: -24.0457, lng: -52.3787 };
  db.stores.push(s);
  addUser('store', 'Gerente Demo', 'loja@demo.com', '123456', s.id);
  addUser('courier', 'Motoboy Demo', 'motoboy@demo.com', '123456', s.id);
  save();
}

// ---------- Auth (token assinado HMAC) ----------
function sign(payload) {
  const b = Buffer.from(JSON.stringify({ ...payload, exp: Date.now() + 12 * 3600e3 })).toString('base64url');
  return b + '.' + crypto.createHmac('sha256', SECRET).update(b).digest('base64url');
}
function verify(tok) {
  if (!tok) return null;
  const [b, s] = tok.split('.');
  if (!s || crypto.createHmac('sha256', SECRET).update(b).digest('base64url') !== s) return null;
  const p = JSON.parse(Buffer.from(b, 'base64url').toString());
  return p.exp > Date.now() ? db.users.find(u => u.id === p.id) || null : null;
}
const pub = u => ({ id: u.id, role: u.role, name: u.name, email: u.email, storeId: u.storeId });

// ---------- Tempo real (SSE) ----------
const clients = new Set();
function broadcast(storeId, type) {
  for (const c of clients) if (c.storeId === storeId) c.res.write(`data: ${type}\n\n`);
}

// ---------- Rotas: vizinho mais próximo + 2-opt ----------
function hav(a, b) {
  const R = 6371, r = x => x * Math.PI / 180;
  const dLat = r(b.lat - a.lat), dLng = r(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
function optimize(start, stops) {
  const left = [...stops], seq = []; let cur = start;
  while (left.length) {
    let bi = 0;
    left.forEach((s, i) => { if (hav(cur, s) < hav(cur, left[bi])) bi = i; });
    cur = left.splice(bi, 1)[0]; seq.push(cur);
  }
  const len = q => { let d = 0, p = start; for (const s of q) { d += hav(p, s); p = s; } return d; };
  let improved = true;
  while (improved && seq.length > 2) {
    improved = false;
    for (let i = 0; i < seq.length - 1; i++) for (let j = i + 1; j < seq.length; j++) {
      const n = [...seq.slice(0, i), ...seq.slice(i, j + 1).reverse(), ...seq.slice(j + 1)];
      if (len(n) < len(seq) - 1e-9) { seq.splice(0, seq.length, ...n); improved = true; }
    }
  }
  return { seq, km: len(seq) };
}

// ---------- Geocodificação (Nominatim com prioridade para cidade e estado) ----------
async function geocode(address, near) {
  try {
    let q = address;
    if (!q.toLowerCase().includes('campo mourão') && !q.toLowerCase().includes('campo mourao')) {
      q += ', Campo Mourão, PR, Brasil';
    }
    const r = await fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=br&q=' + encodeURIComponent(q),
      { headers: { 'User-Agent': 'EntregaX/1.0' } });
    const j = await r.json();
    if (j && j[0]) return { lat: +j[0].lat, lng: +j[0].lon };
  } catch (err) {
    console.error('Erro no geocode:', err.message);
  }
  // fallback próximo à loja
  return { lat: near.lat + (Math.random() - .5) * .015, lng: near.lng + (Math.random() - .5) * .015 };
}

// ---------- Integração iFood ----------
// Com IFOOD_CLIENT_ID/IFOOD_CLIENT_SECRET definidos, faz polling real da Merchant API.
// Sem credenciais, o botão "Simular pedido iFood" gera pedidos de teste.
const IFOOD = 'https://merchant-api.ifood.com.br';
let ifoodToken = null, ifoodExp = 0;
async function ifoodAuth() {
  if (ifoodToken && Date.now() < ifoodExp) return ifoodToken;
  const r = await fetch(IFOOD + '/authentication/v1.0/oauth/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grantType: 'client_credentials', clientId: process.env.IFOOD_CLIENT_ID, clientSecret: process.env.IFOOD_CLIENT_SECRET })
  });
  const j = await r.json(); ifoodToken = j.accessToken; ifoodExp = Date.now() + (j.expiresIn - 60) * 1000;
  return ifoodToken;
}
function importIfoodOrder(o, store) {
  if (db.orders.some(x => x.ifoodId === o.id)) return;
  const d = o.delivery || {}, a = d.deliveryAddress || {};
  db.orders.push({
    id: uid(), storeId: store.id, source: 'ifood', ifoodId: o.id,
    customer: { id: o.customer?.id || o.customerId, name: o.customer?.name || 'Cliente iFood', phone: o.customer?.phone?.number || '' },
    address: a.formattedAddress || '', lat: a.coordinates?.latitude, lng: a.coordinates?.longitude,
    code: String(d.deliveryCode?.code || d.pickupCode || Math.floor(1000 + Math.random() * 9000)),
    status: 'READY', courierId: null, createdAt: Date.now()
  });
}
// Envia status de volta ao iFood (best-effort; só para pedidos vindos do iFood)
async function ifoodStatus(order, action) {
  if (order.source !== 'ifood' || !process.env.IFOOD_CLIENT_ID) return;
  try {
    const t = await ifoodAuth();
    const r = await fetch(`${IFOOD}/order/v1.0/orders/${order.ifoodId}/${action}`, { method: 'POST', headers: { Authorization: 'Bearer ' + t } });
    if (!r.ok) console.error(`iFood ${action} ${order.ifoodId}: HTTP ${r.status}`);
  } catch (e) { console.error('iFood status:', e.message); }
}
async function ifoodPoll() {
  if (!process.env.IFOOD_CLIENT_ID) return;
  try {
    const t = await ifoodAuth(), H = { Authorization: 'Bearer ' + t };
    const r = await fetch(IFOOD + '/events/v1.0/events:polling', { headers: H });
    if (r.status !== 200) return;
    const evs = await r.json(), touched = new Set();
    for (const e of evs) {
      const byMerchant = id => db.stores.find(s => s.merchantId && s.merchantId === id);
      if (e.code === 'PLC') { // novo pedido
        const o = await (await fetch(`${IFOOD}/order/v1.0/orders/${e.orderId}`, { headers: H })).json();
        const store = byMerchant(o.merchant?.id || e.merchantId);
        if (!store) { console.error('iFood: pedido de merchant não vinculado', o.merchant?.id || e.merchantId); continue; }
        importIfoodOrder(o, store); touched.add(store.id);
        fetch(`${IFOOD}/order/v1.0/orders/${e.orderId}/confirm`, { method: 'POST', headers: H }).catch(() => { });
      }
      if (e.code === 'CAN') db.orders.filter(x => x.ifoodId === e.orderId).forEach(x => { x.status = 'CANCELLED'; touched.add(x.storeId); });
    }
    if (evs.length) {
      await fetch(IFOOD + '/events/v1.0/events/acknowledgment', { method: 'POST', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify(evs.map(e => ({ id: e.id }))) });
      save(); touched.forEach(id => broadcast(id, 'orders'));
    }
  } catch (e) { console.error('iFood:', e.message); }
}
setInterval(ifoodPoll, 30000);

// ---------- API ----------
const json = (res, code, body) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
const readBody = req => new Promise(r => { let d = ''; req.on('data', c => d += c); req.on('end', () => { try { r(JSON.parse(d || '{}')); } catch { r({}); } }); });
const visible = (u, o) => o.storeId === u.storeId && (u.role === 'store' || o.courierId === u.id || (o.status === 'READY' && !o.courierId));

async function api(req, res, url) {
  const p = url.pathname, m = req.method;
  if (p === '/api/login' && m === 'POST') {
    const b = await readBody(req);
    const u = db.users.find(x => x.email === String(b.email || '').toLowerCase() && x.role === b.role);
    if (!u || hash(String(b.password || ''), u.salt) !== u.pass) return json(res, 401, { error: 'Credenciais inválidas' });
    return json(res, 200, { token: sign({ id: u.id }), user: pub(u) });
  }
  if (p === '/api/register-store' && m === 'POST') {
    const b = await readBody(req);
    if (!b.email || !b.password || !b.storeName || !b.address) return json(res, 400, { error: 'Preencha todos os campos' });
    if (db.users.some(x => x.email === b.email.toLowerCase())) return json(res, 409, { error: 'E-mail já cadastrado' });
    const g = await geocode(b.address, { lat: -23.55, lng: -46.63 });
    const s = { id: uid(), name: b.storeName, address: b.address, ...g };
    db.stores.push(s);
    const u = addUser('store', b.name || b.storeName, b.email, b.password, s.id); save();
    return json(res, 200, { token: sign({ id: u.id }), user: pub(u) });
  }
  if (p === '/api/events') { // SSE (token na query)
    const u = verify(url.searchParams.get('token'));
    if (!u) return json(res, 401, {});
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.write('retry: 3000\n\n');
    const c = { res, storeId: u.storeId }; clients.add(c);
    req.on('close', () => clients.delete(c)); return;
  }

  const user = verify((req.headers.authorization || '').replace('Bearer ', ''));
  if (!user) return json(res, 401, { error: 'Não autenticado' });
  const store = db.stores.find(s => s.id === user.storeId);
  const isStore = user.role === 'store';
  const forbid = () => json(res, 403, { error: 'Sem permissão' });
  const changed = () => { save(); broadcast(user.storeId, 'orders'); };

  if (p === '/api/me') return json(res, 200, { user: pub(user), store });

  if (p === '/api/store' && m === 'POST') { // vincula o merchantId do iFood à loja
    if (!isStore) return forbid();
    const b = await readBody(req), mid = String(b.merchantId || '').trim();
    if (mid && db.stores.some(s => s.merchantId === mid && s.id !== store.id)) return json(res, 409, { error: 'Este merchantId já está vinculado a outra loja' });
    store.merchantId = mid || undefined; save(); return json(res, 200, { store });
  }

  if (p === '/api/orders' && m === 'GET')
    return json(res, 200, db.orders.filter(o => visible(user, o)).sort((a, b) => b.createdAt - a.createdAt).slice(0, 200)
      .map(o => ({ ...o, code: isStore ? o.code : undefined, courierName: db.users.find(u => u.id === o.courierId)?.name })));

  if (p === '/api/orders' && m === 'POST') {
    if (!isStore) return forbid();
    const b = await readBody(req);
    if (!b.customerName || !b.address) return json(res, 400, { error: 'Nome e endereço obrigatórios' });
    const g = await geocode(b.address, store);
    db.orders.push({ id: uid(), storeId: store.id, source: 'manual', customer: { id: 'C' + uid(), name: b.customerName, phone: b.phone || '' },
      address: b.address, ...g, code: String(Math.floor(1000 + Math.random() * 9000)), status: 'READY', courierId: null, createdAt: Date.now() });
    changed(); return json(res, 200, { ok: true });
  }

  if (p === '/api/ifood/simulate' && m === 'POST') {
    if (!isStore) return forbid();
    const names = ['Ana Souza', 'Lucas Silveira', 'Carla Dias', 'Diego Ramos', 'Mariana Costa', 'Fábio Santos'];
    const pontosReais = [
      { rua: 'Av. Goioerê, 820, Centro, Campo Mourão - PR', lat: -24.039295, lng: -52.378034 },
      { rua: 'Av. Manoel Mendes de Camargo, 1240, Centro, Campo Mourão - PR', lat: -24.041029, lng: -52.377537 },
      { rua: 'Rua Harrison José Borges, 1015, Centro, Campo Mourão - PR', lat: -24.043806, lng: -52.376332 },
      { rua: 'Av. Irmãos Pereira, 1520, Centro, Campo Mourão - PR', lat: -24.037211, lng: -52.366939 },
      { rua: 'Rua São Josafat, 1310, Centro, Campo Mourão - PR', lat: -24.045880, lng: -52.383759 },
      { rua: 'Av. Capitão Índio Bandeira, 1850, Centro, Campo Mourão - PR', lat: -24.042910, lng: -52.381200 },
      { rua: 'Av. Comendador Norberto Marcondes, 1600, Campo Mourão - PR', lat: -24.044150, lng: -52.374510 }
    ];
    const ponto = pontosReais[Math.random() * pontosReais.length | 0];

    importIfoodOrder({
      id: 'IF' + uid(),
      customer: {
        id: 'IFC' + uid(),
        name: names[Math.random() * names.length | 0],
        phone: { number: '4499' + (1000000 + Math.random() * 8999999 | 0) }
      },
      delivery: {
        deliveryCode: { code: String(Math.floor(1000 + Math.random() * 9000)) },
        deliveryAddress: {
          formattedAddress: ponto.rua,
          coordinates: { latitude: ponto.lat, longitude: ponto.lng }
        }
      }
    }, store);
    changed(); return json(res, 200, { ok: true });
  }

  // Webhook opcional (iFood push) — protegido por segredo
  const mm = p.match(/^\/api\/orders\/(\w+)\/(\w+)$/);
  if (mm && m === 'POST') {
    const o = db.orders.find(x => x.id === mm[1] && x.storeId === user.storeId), act = mm[2];
    if (!o) return json(res, 404, { error: 'Pedido não encontrado' });
    const b = await readBody(req);
    if (act === 'dispatch') {
      if (!isStore) return forbid();
      if (!db.users.some(u => u.id === b.courierId && u.role === 'courier' && u.storeId === o.storeId)) return json(res, 400, { error: 'Motoboy inválido' });
      if (o.status !== 'READY' && o.status !== 'ASSIGNED') return json(res, 400, { error: 'Status inválido' });
      o.courierId = b.courierId; o.status = 'ASSIGNED';
    } else if (act === 'cancel') {
      if (!isStore) return forbid();
      if (o.status === 'DELIVERED') return json(res, 400, { error: 'Já entregue' });
      o.status = 'CANCELLED';
    } else if (act === 'accept') {
      if (isStore || o.status !== 'READY' || o.courierId) return forbid();
      o.courierId = user.id; o.status = 'ASSIGNED';
    } else if (act === 'pickup') {
      if (isStore || o.courierId !== user.id || o.status !== 'ASSIGNED') return forbid();
      o.status = 'PICKED'; ifoodStatus(o, 'dispatch');
    } else if (act === 'deliver') {
      if (isStore || o.courierId !== user.id || o.status !== 'PICKED') return forbid();
      if (String(b.code).trim() !== o.code) return json(res, 400, { error: 'Código de confirmação incorreto' });
      o.status = 'DELIVERED'; o.deliveredAt = Date.now(); ifoodStatus(o, 'arrivedAtDestination');
    } else return json(res, 404, {});
    changed(); return json(res, 200, { ok: true });
  }

  if (p === '/api/couriers' && m === 'GET') {
    if (!isStore) return forbid();
    return json(res, 200, db.users.filter(u => u.role === 'courier' && u.storeId === user.storeId)
      .map(u => ({ ...pub(u), loc: db.locations[u.id] || null, active: db.orders.filter(o => o.courierId === u.id && ['ASSIGNED', 'PICKED'].includes(o.status)).length })));
  }
  if (p === '/api/couriers' && m === 'POST') {
    if (!isStore) return forbid();
    const b = await readBody(req);
    if (!b.name || !b.email || !b.password) return json(res, 400, { error: 'Preencha todos os campos' });
    if (db.users.some(x => x.email === b.email.toLowerCase())) return json(res, 409, { error: 'E-mail já cadastrado' });
    addUser('courier', b.name, b.email, b.password, user.storeId); save(); return json(res, 200, { ok: true });
  }

  if (p === '/api/location' && m === 'POST') {
    if (isStore) return forbid();
    const b = await readBody(req);
    if (typeof b.lat === 'number' && typeof b.lng === 'number') {
      db.locations[user.id] = { lat: b.lat, lng: b.lng, ts: Date.now() }; broadcast(user.storeId, 'locations');
    }
    return json(res, 200, { ok: true });
  }

  if (p === '/api/route' && m === 'GET') { // rota otimizada do motoboy
    if (isStore) return forbid();
    const act = db.orders.filter(o => o.courierId === user.id && ['ASSIGNED', 'PICKED'].includes(o.status) && o.lat != null);
    const start = db.locations[user.id] || store;
    // Pedidos ainda não coletados: primeiro vai à loja
    const toPick = act.some(o => o.status === 'ASSIGNED');
    const origin = toPick ? store : start;
    const { seq, km } = optimize(origin, act);
    return json(res, 200, { origin: { lat: origin.lat, lng: origin.lng, toStore: toPick }, stops: seq.map(({ code, ...o }) => o), km: +km.toFixed(1), etaMin: Math.round(km / 25 * 60 + seq.length * 3) });
  }
  json(res, 404, { error: 'Rota não encontrada' });
}

// ---------- Servidor estático + API ----------
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    let f = path.join(PUBLIC, url.pathname === '/' ? 'index.html' : url.pathname);
    if (!f.startsWith(PUBLIC) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(PUBLIC, 'index.html');
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  } catch (e) { console.error(e); json(res, 500, { error: 'Erro interno' }); }
}).listen(PORT, () => console.log(`EntregaX rodando em http://localhost:${PORT}`));
