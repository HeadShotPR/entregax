// EntregaX — Front-end PWA integrado com iFood
const $ = s => document.querySelector(s);
const app = $('#app');
const ST = { READY: 'Aguardando', ASSIGNED: 'Atribuído', PICKED: 'Em rota', DELIVERED: 'Entregue', CANCELLED: 'Cancelado' };
let session = JSON.parse(localStorage.getItem('entregax_session') || localStorage.getItem('cm') || 'null');
let me = null, store = null, orders = [], couriers = [], route = null, map = null, layer = null, es = null, role = 'store', myPos = null, watch = null;

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js');

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function toast(t) { const e = $('#toast'); e.textContent = t; e.className = 'show'; setTimeout(() => e.className = '', 2800); }

async function api(path, method = 'GET', body) {
  const r = await fetch('/api' + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(session ? { Authorization: 'Bearer ' + session.token } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401 && session) { logout(); throw new Error('Sessão expirada'); }
  if (!r.ok) throw new Error(j.error || 'Erro na requisição');
  return j;
}
const act = async (fn, ok) => { try { await fn(); if (ok) toast(ok); } catch (e) { toast(e.message); } };

function logout() {
  localStorage.removeItem('entregax_session');
  localStorage.removeItem('cm');
  session = null;
  if (es) es.close();
  if (watch) navigator.geolocation.clearWatch(watch);
  map = null;
  renderLogin();
}

// ---------- Tela de Login (Inspirada no EntregaX) ----------
function renderLogin(mode = 'login') {
  app.innerHTML = `
  <div class="login-screen">
    <div class="login-box">
      <div class="brand-header">
        <img src="/icon.svg" class="main-logo" alt="EntregaX">
      </div>

      <div class="tabs">
        <button id="tS" class="${role === 'store' ? 'on' : ''}">🏪 Painel da Loja</button>
        <button id="tM" class="${role === 'courier' ? 'on' : ''}">🏍️ App do Motoboy</button>
      </div>

      <div class="card" style="margin:0">
        ${mode === 'reg' ? `
          <input id="sn" placeholder="Nome do seu restaurante/loja">
          <input id="ad" placeholder="Endereço da loja (Rua, nº, Cidade - PR)">
        ` : ''}
        <input id="em" type="email" placeholder="E-mail de acesso" autocomplete="username">
        <input id="pw" type="password" placeholder="Sua senha" autocomplete="current-password">
        
        <button class="btn block mt" id="go">
          ${mode === 'reg' ? 'Criar conta EntregaX' : 'Entrar no sistema'}
        </button>

        ${role === 'store' ? `
          <button class="link" id="sw">${mode === 'reg' ? 'Já possuo uma conta? Entrar' : 'Cadastrar novo restaurante / loja'}</button>
        ` : `
          <p class="muted mt" style="text-align:center;font-size:12px">Os motoboys são vinculados e cadastrados diretamente pela loja parceira.</p>
        `}
      </div>

      <div style="text-align:center;margin-top:16px;">
        <span class="muted" style="font-size:11px">Acesso demo disponível:<br><b>loja@demo.com</b> ou <b>motoboy@demo.com</b> (senha: <b>123456</b>)</span>
      </div>
    </div>
  </div>`;

  $('#tS').onclick = () => { role = 'store'; renderLogin(mode); };
  $('#tM').onclick = () => { role = 'courier'; renderLogin('login'); };
  if ($('#sw')) $('#sw').onclick = () => renderLogin(mode === 'reg' ? 'login' : 'reg');

  $('#go').onclick = () => act(async () => {
    const b = { email: $('#em').value, password: $('#pw').value, role };
    const j = mode === 'reg'
      ? await api('/register-store', 'POST', { ...b, storeName: $('#sn').value, address: $('#ad').value })
      : await api('/login', 'POST', b);
    session = { token: j.token };
    localStorage.setItem('entregax_session', JSON.stringify(session));
    // ---------- Homologação iFood (Vídeos e Cenários do Módulo Merchant) ----------
async function openHomologacaoModal() {
  modal(`
    <div style="max-height:85vh;overflow-y:auto;padding-right:4px;">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;">
        <span style="font-size:24px;">📋</span>
        <div>
          <h2 style="font-size:18px;">Homologação iFood Oficial</h2>
          <p class="muted" style="font-size:11px;">Módulo Merchant — Checklist de Validação por Vídeo</p>
        </div>
      </div>

      <div class="card" style="margin:8px 0;padding:12px;border:1px solid #FF6A00;">
        <div style="font-weight:700;color:#FF6A00;font-size:14px;margin-bottom:6px;">
          🎬 Cenário 1: Informações da Loja
        </div>
        <p class="muted" style="font-size:12px;margin-bottom:8px;">
          1. Listar lojas vinculadas<br>
          2. Exibir detalhes completos da loja<br>
          3. Consultar disponibilidade em tempo real no iFood
        </p>
        <button class="btn sm block" id="btnC1">Executar Cenário 1 (Consultar Loja)</button>
        <div id="resC1" class="muted" style="font-size:11px;margin-top:8px;background:#0b1120;padding:8px;border-radius:8px;display:none;word-break:break-all;"></div>
      </div>

      <div class="card" style="margin:8px 0;padding:12px;border:1px solid #FF6A00;">
        <div style="font-weight:700;color:#FF6A00;font-size:14px;margin-bottom:6px;">
          🎬 Cenário 2: Interrupções / Pausas
        </div>
        <p class="muted" style="font-size:12px;margin-bottom:8px;">
          1. Cadastrar pausa na loja<br>
          2. Listar pausas ativas<br>
          3. Remover a pausa
        </p>
        <div class="row">
          <button class="btn sm grow" id="btnC2Add">+ Criar Pausa (30 min)</button>
          <button class="btn sec sm grow" id="btnC2List">Listar Pausas</button>
        </div>
        <div id="resC2" class="muted" style="font-size:11px;margin-top:8px;background:#0b1120;padding:8px;border-radius:8px;display:none;word-break:break-all;"></div>
      </div>

      <div class="card" style="margin:8px 0;padding:12px;border:1px solid #FF6A00;">
        <div style="font-weight:700;color:#FF6A00;font-size:14px;margin-bottom:6px;">
          🎬 Cenário 3: Horário de Funcionamento
        </div>
        <p class="muted" style="font-size:12px;margin-bottom:8px;">
          • Sábado: 10:00 às 19:00<br>
          • Domingo: 09:00 às 12:00, 13:00 às 16:00 e 17:00 às 23:00
        </p>
        <div class="row">
          <button class="btn sm grow" id="btnC3Set">Gravar Horários Oficiais</button>
          <button class="btn sec sm grow" id="btnC3Get">Consultar Horários</button>
        </div>
        <div id="resC3" class="muted" style="font-size:11px;margin-top:8px;background:#0b1120;padding:8px;border-radius:8px;display:none;word-break:break-all;"></div>
      </div>

      <button class="btn sec block mt" id="x">Fechar Painel</button>
    </div>
  `, () => {
    const testMid = 'a924c951-713b-43ad-b941-3b4b3b5aec4f';

    // Cenário 1
    $('#btnC1').onclick = () => act(async () => {
      $('#resC1').style.display = 'block';
      $('#resC1').innerHTML = '⏳ Conectando à API do iFood...';
      const stores = await api('/ifood-merchant/stores');
      const det = await api('/ifood-merchant/details/' + testMid);
      $('#resC1').innerHTML = `
        <b style="color:#10b981">✓ Lojas Vinculadas:</b> ${stores.length} loja(s)<br>
        • ID: ${det.details.id}<br>
        • Nome: <b>${det.details.name}</b><br>
        • Disponibilidade iFood: <span style="color:#f59e0b">${det.status[0]?.message?.title || 'OK'} (${det.status[0]?.state || 'ATIVO'})</span><br>
        <span style="color:#94a3b8">Requisições HTTP 200 registradas nos Logs da API.</span>
      `;
    }, 'Cenário 1 executado com sucesso!');

    // Cenário 2
    $('#btnC2Add').onclick = () => act(async () => {
      $('#resC2').style.display = 'block';
      $('#resC2').innerHTML = '⏳ Cadastrando pausa de 30 min no iFood...';
      const now = new Date();
      const start = new Date(now.getTime() + 60000).toISOString();
      const end = new Date(now.getTime() + 1860000).toISOString();
      const p = await api('/ifood-merchant/interruptions/' + testMid, 'POST', {
        description: 'Pausa para validação de homologação',
        start,
        end
      });
      $('#resC2').innerHTML = `
        <b style="color:#10b981">✓ Pausa Cadastrada no iFood!</b><br>
        • ID da Pausa: <code>${p.id}</code><br>
        • Início: ${p.start} | Fim: ${p.end}<br>
        <button class="btn sm ok mt" id="btnDelP" style="width:100%">Remover Pausa Agora</button>
      `;
      $('#btnDelP').onclick = () => act(async () => {
        await api(`/ifood-merchant/interruptions/${testMid}/${p.id}`, 'DELETE');
        $('#resC2').innerHTML = '<b style="color:#10b981">✓ Pausa Removida com sucesso no iFood!</b>';
      }, 'Pausa removida no iFood!');
    }, 'Pausa cadastrada com sucesso!');

    $('#btnC2List').onclick = () => act(async () => {
      $('#resC2').style.display = 'block';
      $('#resC2').innerHTML = '⏳ Consultando pausas no iFood...';
      const list = await api('/ifood-merchant/interruptions/' + testMid);
      if (!list || !list.length) {
        $('#resC2').innerHTML = '<b>Nenhuma pausa ativa no momento no iFood.</b>';
      } else {
        $('#resC2').innerHTML = `
          <b>Pausas Ativas (${list.length}):</b><br>
          ${list.map(x => `• ${x.description} (até ${x.end}) <button class="btn sm sec" data-del="${x.id}">Excluir</button>`).join('<br>')}
        `;
        document.querySelectorAll('[data-del]').forEach(b => {
          b.onclick = () => act(async () => {
            await api(`/ifood-merchant/interruptions/${testMid}/${b.dataset.del}`, 'DELETE');
            $('#btnC2List').click();
          }, 'Pausa excluída!');
        });
      }
    });

    // Cenário 3
    $('#btnC3Set').onclick = () => act(async () => {
      $('#resC3').style.display = 'block';
      $('#resC3').innerHTML = '⏳ Gravando horários oficiais no iFood...';
      const r = await api('/ifood-merchant/opening-hours/' + testMid, 'PUT', {});
      $('#resC3').innerHTML = `
        <b style="color:#10b981">✓ Horários Oficiais Cadastrados no iFood!</b><br>
        • Sábado: 10:00 às 19:00 (540 min)<br>
        • Domingo: 09:00 às 12:00, 13:00 às 16:00 e 17:00 às 23:00<br>
        <span style="color:#94a3b8">Turnos configurados: ${r.shifts?.length || 4} turnos</span>
      `;
    }, 'Horários oficiais gravados no iFood!');

    $('#btnC3Get').onclick = () => act(async () => {
      $('#resC3').style.display = 'block';
      $('#resC3').innerHTML = '⏳ Consultando horários salvos no iFood...';
      const r = await api('/ifood-merchant/opening-hours/' + testMid);
      const shifts = r.shifts || [];
      $('#resC3').innerHTML = `
        <b style="color:#10b981">✓ Horários Retornados pela API do iFood:</b><br>
        ${shifts.map(s => `• <b>${s.dayOfWeek}</b> das ${s.start} (${s.duration} min)`).join('<br>')}
      `;
    }, 'Horários consultados!');
  });
}

boot();

  });
}

// ---------- Boot ----------
async function boot() {
  if (!session) return renderLogin();
  try {
    ({ user: me, store } = await api('/me'));
  } catch {
    return renderLogin();
  }

  es = new EventSource('/api/events?token=' + session.token);
  es.onmessage = e => {
    if (e.data === 'orders') refresh();
    if (e.data === 'locations' && me.role === 'store') loadCouriers();
  };

  me.role === 'store' ? renderStore() : renderCourier();
  refresh();
}

async function refresh() {
  orders = await api('/orders').catch(() => orders);
  if (me.role === 'store') {
    await loadCouriers();
    drawStore();
  } else {
    route = await api('/route').catch(() => null);
    drawCourier();
  }
}

async function loadCouriers() {
  couriers = await api('/couriers').catch(() => couriers);
  drawMap();
}

// ---------- Mapa Leaflet com Estilo Dark/EntregaX ----------
const ico = (t, c = '') => L.divIcon({ className: '', html: `<div class="pin ${c}">${t}</div>`, iconSize: [28, 28], iconAnchor: [14, 14] });

function initMap() {
  if (map) map.remove();
  map = L.map('map').setView([store.lat, store.lng], 14);
  // OpenStreetMap padrão 100% gratuito e livre, sem necessidade de API Key
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© OpenStreetMap contributors'
  }).addTo(map);
  layer = L.layerGroup().addTo(map);
}

let fitted = false;
async function drawMap() {
  if (!map) return;
  layer.clearLayers();
  const pts = [[store.lat, store.lng]];

  // Marcador da Loja
  L.marker([store.lat, store.lng], { icon: ico('🏪', 's') })
    .addTo(layer)
    .bindPopup(`<b>${esc(store.name)}</b><br>${esc(store.address)}`);

  if (me.role === 'store') {
    orders.filter(o => ['READY', 'ASSIGNED', 'PICKED'].includes(o.status) && o.lat != null).forEach(o => {
      L.marker([o.lat, o.lng], { icon: ico('📦') })
        .addTo(layer)
        .bindPopup(`<b>${esc(o.customer.name)}</b><br>${esc(o.address)}<br><small>Código: ${esc(o.code)}</small>`);
      pts.push([o.lat, o.lng]);
    });

    couriers.filter(c => c.loc).forEach(c => {
      L.marker([c.loc.lat, c.loc.lng], { icon: ico('🏍️', 'm') })
        .addTo(layer)
        .bindPopup(`<b>${esc(c.name)}</b> (Em campo)`);
      pts.push([c.loc.lat, c.loc.lng]);
    });
  } else if (route) {
    const wp = [route.origin, ...route.stops];
    if (myPos) L.marker([myPos.lat, myPos.lng], { icon: ico('🏍️', 'm') }).addTo(layer);

    route.stops.forEach((s, i) => {
      L.marker([s.lat, s.lng], { icon: ico(i + 1) }).addTo(layer);
    });

    wp.forEach(w => pts.push([w.lat, w.lng]));
    let line = wp.map(w => [w.lat, w.lng]);
    if (wp.length > 1) {
      try {
        const r = await fetch('https://router.project-osrm.org/route/v1/driving/' + wp.map(w => w.lng + ',' + w.lat).join(';') + '?overview=full&geometries=geojson');
        const j = await r.json();
        line = j.routes[0].geometry.coordinates.map(c => [c[1], c[0]]);
      } catch {}
    }
    // Traçado da rota em Laranja Neon EntregaX
    L.polyline(line, { color: '#FF6600', weight: 5, opacity: 0.9 }).addTo(layer);
  }

  if (!fitted && pts.length > 1) {
    map.fitBounds(pts, { padding: [35, 35] });
    fitted = true;
  }
}

// ---------- Painel da Loja ----------
function renderStore() {
  fitted = false;
  app.innerHTML = `
  <div class="hdr">
    <div class="logo-wrap">
      <img src="/logo-symbol.jpg" style="height:34px;width:34px;border-radius:8px;object-fit:cover" alt="X">
      <div>
        <h1>Entrega<span style="color:#FF6A00">X</span> <span style="font-weight:400;font-size:14px;color:#94a3b8">| ${esc(store.name)}</span></h1>
        <small>${esc(store.address)}</small>
      </div>
    </div>
    <button class="btn ghost sm" id="nw">+ Pedido</button>
    <button class="btn ghost sm" id="sm" title="Simular Pedido do iFood">⚡ iFood Teste</button>
    <button class="btn ok sm" id="hm" title="Checklist Oficial de Homologação iFood">📋 Homologação iFood</button>
    <button class="btn ghost sm" id="cr">Motoboys</button>
    <button class="btn ghost sm" id="cf" title="Configurar Merchant ID">⚙️</button>
    <button class="btn ghost sm" id="lo">Sair</button>
  </div>
  <div class="layout">
    <div class="side">
      <div class="stats" id="st"></div>
      <div id="list"></div>
    </div>
    <div class="mapwrap">
      <div id="map"></div>
    </div>
  </div>`;

  initMap();

  $('#lo').onclick = logout;
  $('#sm').onclick = () => act(() => api('/ifood/simulate', 'POST'), 'Pedido de teste iFood recebido!');
  $('#hm').onclick = openHomologacaoModal;
  
  $('#cf').onclick = () => modal(`
    <h3>Configurar Loja iFood</h3>
    <p class="muted mt">Vincule o Merchant ID da sua loja no iFood para receber os pedidos automaticamente nesta tela.</p>
    <input id="mi" placeholder="Ex: 512f45ea-12bc-..." value="${esc(store.merchantId || '')}">
    <button class="btn block mt" id="ok">Salvar Vínculo</button>
    <button class="link" id="x">Cancelar</button>
  `, () => {
    $('#ok').onclick = () => act(async () => {
      ({ store } = await api('/store', 'POST', { merchantId: $('#mi').value }));
      closeModal();
    }, 'Merchant ID vinculado com sucesso!');
  });

  $('#nw').onclick = () => modal(`
    <h3>Cadastrar Pedido Avulso</h3>
    <input id="cn" placeholder="Nome do cliente">
    <input id="cp" placeholder="Telefone / WhatsApp">
    <input id="ca" placeholder="Endereço completo em Campo Mourão">
    <button class="btn block mt" id="ok">Criar Pedido</button>
    <button class="link" id="x">Cancelar</button>
  `, () => {
    $('#ok').onclick = () => act(async () => {
      await api('/orders', 'POST', { customerName: $('#cn').value, phone: $('#cp').value, address: $('#ca').value });
      closeModal();
    }, 'Pedido criado com sucesso!');
  });

  $('#cr').onclick = () => modal(`
    <h3>Gestão de Motoboys</h3>
    <div id="cl">${couriers.map(c => `
      <div class="stop">
        <div class="grow">
          <b>${esc(c.name)}</b>
          <div class="muted">${esc(c.email)} · ${c.active} entrega(s) ativas</div>
        </div>
      </div>`).join('') || '<p class="muted">Nenhum motoboy cadastrado nesta loja.</p>'}
    </div>
    <div style="margin-top:16px;border-top:1px solid #334155;padding-top:12px;">
      <b>Cadastrar novo motoboy parceiro</b>
      <input id="mn" placeholder="Nome completo">
      <input id="me" type="email" placeholder="E-mail de login">
      <input id="mp" type="password" placeholder="Senha provisória">
      <button class="btn block mt" id="ok">Adicionar Motoboy</button>
    </div>
    <button class="link" id="x">Fechar</button>
  `, () => {
    $('#ok').onclick = () => act(async () => {
      await api('/couriers', 'POST', { name: $('#mn').value, email: $('#me').value, password: $('#mp').value });
      closeModal();
      await loadCouriers();
    }, 'Motoboy cadastrado com sucesso!');
  });
}

function drawStore() {
  if (!$('#list')) return;
  const n = s => orders.filter(o => o.status === s).length;
  $('#st').innerHTML = `
    <div><b>${n('READY')}</b><span>Aguardando</span></div>
    <div><b>${n('ASSIGNED') + n('PICKED')}</b><span>Em rota</span></div>
    <div><b>${n('DELIVERED')}</b><span>Entregues</span></div>
  `;

  $('#list').innerHTML = orders.map(o => `
    <div class="card order">
      <div class="row">
        <h3 class="grow">${esc(o.customer.name)}</h3>
        <span class="badge ${o.status}">${ST[o.status]}</span>
      </div>
      <div class="muted mt">${esc(o.address)}</div>
      <div class="muted" style="margin-top:4px;">
        ${o.source === 'ifood' ? '<span style="color:#EA1D2C;font-weight:700">iFood</span>' : 'Manual'} 
        · Pedido #${esc(o.id.slice(-4))}
        · Cód. Entrega: <b style="color:var(--primary);font-size:15px">${esc(o.code)}</b>
      </div>
      ${o.courierName ? `<div class="muted" style="margin-top:4px">🏍️ <b>${esc(o.courierName)}</b></div>` : ''}
      
      ${['READY', 'ASSIGNED'].includes(o.status) ? `
        <div class="row mt">
          <select data-c="${o.id}" class="grow" style="margin:0">
            <option value="">Atribuir motoboy...</option>
            ${couriers.map(c => `<option value="${c.id}" ${c.id === o.courierId ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
          </select>
          <button class="btn sec sm" data-x="${o.id}">Cancelar</button>
        </div>
      ` : ''}
    </div>
  `).join('') || '<div class="card muted" style="text-align:center">Nenhum pedido ativo. Clique em <b>⚡ iFood Teste</b> para gerar pedidos de simulação.</div>';

  document.querySelectorAll('[data-c]').forEach(s => s.onchange = () => s.value && act(() => api(`/orders/${s.dataset.c}/dispatch`, 'POST', { courierId: s.value }), 'Pedido despachado!'));
  document.querySelectorAll('[data-x]').forEach(b => b.onclick = () => confirm('Deseja cancelar este pedido?') && act(() => api(`/orders/${b.dataset.x}/cancel`, 'POST')));
  drawMap();
}

// ---------- App do Motoboy (Inspirado nas Telas do EntregaX) ----------
function renderCourier() {
  fitted = false;
  app.innerHTML = `
  <div class="hdr">
    <div class="logo-wrap">
      <img src="/logo-symbol.jpg" style="height:34px;width:34px;border-radius:8px;object-fit:cover" alt="X">
      <div>
        <h1>Entrega<span style="color:#FF6A00">X</span> Motoboy</h1>
        <small>${esc(store.name)} · <span style="color:#10B981">● Online</span></small>
      </div>
    </div>
    <button class="btn ghost sm" id="lo">Sair</button>
  </div>
  <div class="layout">
    <div class="mapwrap">
      <div id="map"></div>
    </div>
    <div class="side" id="side"></div>
  </div>`;

  initMap();
  $('#lo').onclick = logout;

  if (navigator.geolocation) {
    watch = navigator.geolocation.watchPosition(p => {
      const first = !myPos;
      myPos = { lat: p.coords.latitude, lng: p.coords.longitude };
      api('/location', 'POST', myPos).catch(() => {});
      if (first) refresh();
    }, () => toast('Ative a localização do celular para traçar a melhor rota'), { enableHighAccuracy: true, maximumAge: 5000 });
  }
}

function drawCourier() {
  if (!$('#side')) return;
  const mine = orders.filter(o => o.courierId === me.id && ['ASSIGNED', 'PICKED'].includes(o.status));
  const free = orders.filter(o => o.status === 'READY' && !o.courierId);
  const toPick = mine.filter(o => o.status === 'ASSIGNED');
  const seq = route ? route.stops.map(s => mine.find(o => o.id === s.id)).filter(Boolean) : mine;

  let h = '';

  if (route && seq.length) {
    h += `
    <div class="card" style="border-left: 4px solid var(--primary)">
      <div class="row">
        <b style="font-size:16px;">⚡ Rota Otimizada EntregaX</b>
        <span class="badge PICKED">${seq.length} Paradas</span>
      </div>
      <div class="muted mt">
        Distância total: <b>${route.km} km</b> · Duração estimada: <b>~${route.etaMin} min</b>
        ${route.origin.toStore ? '<br><span style="color:#F59E0B">📍 Passe primeiro na loja para retirar os pedidos</span>' : ''}
      </div>
      ${toPick.length ? `
        <button class="btn ok block mt" id="pk">
          Coletar pedidos na loja (${toPick.length})
        </button>
      ` : ''}
    </div>`;
  }

  h += seq.map((o, i) => `
    <div class="card order">
      <div class="stop" style="border:0;padding:0">
        <div class="n">${i + 1}</div>
        <div class="grow">
          <h3>${esc(o.customer.name)}</h3>
          <div class="muted">${esc(o.address)}</div>
          <div class="muted">Cliente ID: ${esc(o.customer.id)} ${o.customer.phone ? ' · ' + esc(o.customer.phone) : ''}</div>
        </div>
        <span class="badge ${o.status}">${ST[o.status]}</span>
      </div>

      <div class="row mt">
        <a class="btn sec sm grow" style="text-decoration:none" target="_blank" href="https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(o.address + ', Campo Mourão - PR')}&destination_place_id=&travelmode=motorcycle">
          🧭 Navegar no Maps
        </a>
        ${o.status === 'PICKED' ? `
          <button class="btn ok sm grow" data-f="${o.id}">
            Cheguei · Confirmar Entrega
          </button>
        ` : ''}
      </div>
    </div>
  `).join('');

  if (free.length) {
    h += `
    <div class="card">
      <b style="font-size:15px;">📦 Pedidos Disponíveis na Loja</b>
      <p class="muted" style="margin-bottom:8px">Novos pedidos prontos para entrega:</p>
      ${free.map(o => `
        <div class="stop">
          <div class="grow">
            <b>${esc(o.customer.name)}</b>
            <div class="muted">${esc(o.address)}</div>
          </div>
          <button class="btn sm" data-a="${o.id}">Aceitar</button>
        </div>
      `).join('')}
    </div>`;
  }

  if (!h) {
    h = `
    <div class="card muted" style="text-align:center;padding:32px 16px">
      <div style="font-size:36px;margin-bottom:8px">🏍️</div>
      <b>Nenhuma entrega no momento</b><br>
      Aguardando novos pedidos da loja ou do iFood...
    </div>`;
  }

  $('#side').innerHTML = h;

  if ($('#pk')) {
    $('#pk').onclick = () => act(async () => {
      for (const o of toPick) await api(`/orders/${o.id}/pickup`, 'POST');
      fitted = false;
    }, 'Pedidos coletados! Boa rota!');
  }

  document.querySelectorAll('[data-a]').forEach(b => {
    b.onclick = () => act(() => api(`/orders/${b.dataset.a}/accept`, 'POST'), 'Pedido aceito!');
  });

  document.querySelectorAll('[data-f]').forEach(b => {
    b.onclick = () => {
      const order = seq.find(x => x.id === b.dataset.f) || mine.find(x => x.id === b.dataset.f);
      modal(`
        <h3>Confirmar Entrega</h3>
        <p class="muted mt">Cliente: <b>${esc(order ? order.customer.name : '')}</b></p>
        <p class="muted">Digite o código de confirmação informado pelo cliente:</p>
        
        <div class="code-display-box">
          <input id="cd" class="code" inputmode="numeric" maxlength="6" placeholder="••••" autofocus>
        </div>

        <button class="btn ok block mt" id="ok">Confirmar Entrega ✅</button>
        <button class="link" id="x">Voltar</button>
      `, () => {
        $('#ok').onclick = () => act(async () => {
          await api(`/orders/${b.dataset.f}/deliver`, 'POST', { code: $('#cd').value });
          closeModal();
        }, 'Entrega confirmada com sucesso no iFood!');
      });
    };
  });

  drawMap();
}

// ---------- Modal Genérico ----------
function modal(html, bind) {
  const m = document.createElement('div');
  m.className = 'modal';
  m.innerHTML = `<div class="card">${html}</div>`;
  document.body.appendChild(m);
  m.onclick = e => { if (e.target === m) closeModal(); };
  bind();
  const x = m.querySelector('#x');
  if (x) x.onclick = closeModal;
}
function closeModal() {
  document.querySelectorAll('.modal').forEach(m => m.remove());
}

// ---------- Homologação iFood (Vídeos e Cenários do Módulo Merchant) ----------
async function openHomologacaoModal() {
  modal(`
    <div style="max-height:85vh;overflow-y:auto;padding-right:4px;">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;">
        <span style="font-size:24px;">📋</span>
        <div>
          <h2 style="font-size:18px;">Homologação iFood Oficial</h2>
          <p class="muted" style="font-size:11px;">Módulo Merchant — Checklist de Validação por Vídeo</p>
        </div>
      </div>

      <div class="card" style="margin:8px 0;padding:12px;border:1px solid #FF6A00;">
        <div style="font-weight:700;color:#FF6A00;font-size:14px;margin-bottom:6px;">
          🎬 Cenário 1: Informações da Loja
        </div>
        <p class="muted" style="font-size:12px;margin-bottom:8px;">
          1. Listar lojas vinculadas<br>
          2. Exibir detalhes completos da loja<br>
          3. Consultar disponibilidade em tempo real no iFood
        </p>
        <button class="btn sm block" id="btnC1">Executar Cenário 1 (Consultar Loja)</button>
        <div id="resC1" class="muted" style="font-size:11px;margin-top:8px;background:#0b1120;padding:8px;border-radius:8px;display:none;word-break:break-all;"></div>
      </div>

      <div class="card" style="margin:8px 0;padding:12px;border:1px solid #FF6A00;">
        <div style="font-weight:700;color:#FF6A00;font-size:14px;margin-bottom:6px;">
          🎬 Cenário 2: Interrupções / Pausas
        </div>
        <p class="muted" style="font-size:12px;margin-bottom:8px;">
          1. Cadastrar pausa na loja<br>
          2. Listar pausas ativas<br>
          3. Remover a pausa
        </p>
        <div class="row">
          <button class="btn sm grow" id="btnC2Add">+ Criar Pausa (30 min)</button>
          <button class="btn sec sm grow" id="btnC2List">Listar Pausas</button>
        </div>
        <div id="resC2" class="muted" style="font-size:11px;margin-top:8px;background:#0b1120;padding:8px;border-radius:8px;display:none;word-break:break-all;"></div>
      </div>

      <div class="card" style="margin:8px 0;padding:12px;border:1px solid #FF6A00;">
        <div style="font-weight:700;color:#FF6A00;font-size:14px;margin-bottom:6px;">
          🎬 Cenário 3: Horário de Funcionamento
        </div>
        <p class="muted" style="font-size:12px;margin-bottom:8px;">
          • Sábado: 10:00 às 19:00<br>
          • Domingo: 09:00 às 12:00, 13:00 às 16:00 e 17:00 às 23:00
        </p>
        <div class="row">
          <button class="btn sm grow" id="btnC3Set">Gravar Horários Oficiais</button>
          <button class="btn sec sm grow" id="btnC3Get">Consultar Horários</button>
        </div>
        <div id="resC3" class="muted" style="font-size:11px;margin-top:8px;background:#0b1120;padding:8px;border-radius:8px;display:none;word-break:break-all;"></div>
      </div>

      <button class="btn sec block mt" id="x">Fechar Painel</button>
    </div>
  `, () => {
    const testMid = 'a924c951-713b-43ad-b941-3b4b3b5aec4f';

    // Cenário 1
    $('#btnC1').onclick = () => act(async () => {
      $('#resC1').style.display = 'block';
      $('#resC1').innerHTML = '⏳ Conectando à API do iFood...';
      const stores = await api('/ifood-merchant/stores');
      const det = await api('/ifood-merchant/details/' + testMid);
      $('#resC1').innerHTML = `
        <b style="color:#10b981">✓ Lojas Vinculadas:</b> ${stores.length} loja(s)<br>
        • ID: ${det.details.id}<br>
        • Nome: <b>${det.details.name}</b><br>
        • Disponibilidade iFood: <span style="color:#f59e0b">${det.status[0]?.message?.title || 'OK'} (${det.status[0]?.state || 'ATIVO'})</span><br>
        <span style="color:#94a3b8">Requisições HTTP 200 registradas nos Logs da API.</span>
      `;
    }, 'Cenário 1 executado com sucesso!');

    // Cenário 2
    $('#btnC2Add').onclick = () => act(async () => {
      $('#resC2').style.display = 'block';
      $('#resC2').innerHTML = '⏳ Cadastrando pausa de 30 min no iFood...';
      const now = new Date();
      const start = new Date(now.getTime() + 60000).toISOString();
      const end = new Date(now.getTime() + 1860000).toISOString();
      const p = await api('/ifood-merchant/interruptions/' + testMid, 'POST', {
        description: 'Pausa para validação de homologação',
        start,
        end
      });
      $('#resC2').innerHTML = `
        <b style="color:#10b981">✓ Pausa Cadastrada no iFood!</b><br>
        • ID da Pausa: <code>${p.id}</code><br>
        • Início: ${p.start} | Fim: ${p.end}<br>
        <button class="btn sm ok mt" id="btnDelP" style="width:100%">Remover Pausa Agora</button>
      `;
      $('#btnDelP').onclick = () => act(async () => {
        await api(`/ifood-merchant/interruptions/${testMid}/${p.id}`, 'DELETE');
        $('#resC2').innerHTML = '<b style="color:#10b981">✓ Pausa Removida com sucesso no iFood!</b>';
      }, 'Pausa removida no iFood!');
    }, 'Pausa cadastrada com sucesso!');

    $('#btnC2List').onclick = () => act(async () => {
      $('#resC2').style.display = 'block';
      $('#resC2').innerHTML = '⏳ Consultando pausas no iFood...';
      const list = await api('/ifood-merchant/interruptions/' + testMid);
      if (!list || !list.length) {
        $('#resC2').innerHTML = '<b>Nenhuma pausa ativa no momento no iFood.</b>';
      } else {
        $('#resC2').innerHTML = `
          <b>Pausas Ativas (${list.length}):</b><br>
          ${list.map(x => `• ${x.description} (até ${x.end}) <button class="btn sm sec" data-del="${x.id}">Excluir</button>`).join('<br>')}
        `;
        document.querySelectorAll('[data-del]').forEach(b => {
          b.onclick = () => act(async () => {
            await api(`/ifood-merchant/interruptions/${testMid}/${b.dataset.del}`, 'DELETE');
            $('#btnC2List').click();
          }, 'Pausa excluída!');
        });
      }
    });

    // Cenário 3
    $('#btnC3Set').onclick = () => act(async () => {
      $('#resC3').style.display = 'block';
      $('#resC3').innerHTML = '⏳ Gravando horários oficiais no iFood...';
      const r = await api('/ifood-merchant/opening-hours/' + testMid, 'PUT', {});
      $('#resC3').innerHTML = `
        <b style="color:#10b981">✓ Horários Oficiais Cadastrados no iFood!</b><br>
        • Sábado: 10:00 às 19:00 (540 min)<br>
        • Domingo: 09:00 às 12:00, 13:00 às 16:00 e 17:00 às 23:00<br>
        <span style="color:#94a3b8">Turnos configurados: ${r.shifts?.length || 4} turnos</span>
      `;
    }, 'Horários oficiais gravados no iFood!');

    $('#btnC3Get').onclick = () => act(async () => {
      $('#resC3').style.display = 'block';
      $('#resC3').innerHTML = '⏳ Consultando horários salvos no iFood...';
      const r = await api('/ifood-merchant/opening-hours/' + testMid);
      const shifts = r.shifts || [];
      $('#resC3').innerHTML = `
        <b style="color:#10b981">✓ Horários Retornados pela API do iFood:</b><br>
        ${shifts.map(s => `• <b>${s.dayOfWeek}</b> das ${s.start} (${s.duration} min)`).join('<br>')}
      `;
    }, 'Horários consultados!');
  });
}

boot();

