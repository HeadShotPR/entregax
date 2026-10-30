// Service worker mínimo: habilita instalação do app (PWA). Dados sempre vêm da rede.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(clients.claim()));
self.addEventListener('fetch', () => {});
