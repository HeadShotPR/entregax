const fs = require('fs');
const path = require('path');

const pub = path.join(__dirname, 'public');
const imgPath = path.join(pub, 'logo-symbol.jpg');

const b64 = fs.readFileSync(imgPath).toString('base64');
const dataUri = 'data:image/jpeg;base64,' + b64;

// 1. Logo completa horizontal
const fullLogoSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 540 140" fill="none">
  <defs>
    <linearGradient id="xg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#FF6A00"/>
      <stop offset="100%" stop-color="#FF9000"/>
    </linearGradient>
  </defs>
  <!-- Simbolo Exato da Foto -->
  <image href="${dataUri}" x="-5" y="-5" width="150" height="150" preserveAspectRatio="xMidYMid meet"/>
  <!-- Tipografia Oficial EntregaX -->
  <text x="145" y="86" font-family="'Montserrat', system-ui, sans-serif" font-weight="900" font-size="62" fill="#FFFFFF" letter-spacing="-1.5">Entrega<tspan fill="url(#xg)">X</tspan></text>
  <text x="148" y="114" font-family="'Montserrat', system-ui, sans-serif" font-weight="700" font-size="11.5" fill="#94A3B8" letter-spacing="3.5">SUAS ENTREGAS NO CAMINHO CERTO</text>
</svg>`;

fs.writeFileSync(path.join(pub, 'icon.svg'), fullLogoSvg);

// 2. Icone do App / Favicon
const appIconSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" fill="none">
  <rect width="512" height="512" rx="100" fill="#020617"/>
  <image href="${dataUri}" x="16" y="16" width="480" height="480" preserveAspectRatio="xMidYMid meet"/>
</svg>`;

fs.writeFileSync(path.join(pub, 'app-icon.svg'), appIconSvg);
console.log('Logos geradas com sucesso!');
