// Génère les icônes PWA et les images de lancement iOS à partir de public/logo-full.svg et logo-symbol.svg.
// Usage : node scripts/generate-pwa-assets.mjs   (nécessite Chrome ou Edge installé)
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const BG = '#F8F6F1'; // ivoire (= hsl(40 33% 96%) de splash-screen.css)
const FG = '#141A18'; // = --foreground
const root = resolve(import.meta.dirname, '..');
const outDir = join(root, 'public', 'icons');
const splashDir = join(root, 'public', 'splash');
mkdirSync(outDir, { recursive: true });
mkdirSync(splashDir, { recursive: true });

const browser = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find(existsSync);
if (!browser) throw new Error('Chrome ou Edge introuvable');

const svg = (name) => readFileSync(join(root, 'public', name), 'utf8').replace('fill="currentColor"', `fill="${FG}"`);
const full = svg('logo-full.svg');
const symbol = svg('logo-symbol.svg');
const tmp = mkdtempSync(join(tmpdir(), 'mh-pwa-'));

function render(file, w, h, logoSvg, logoWidth) {
  // Chrome headless impose une fenêtre d'au moins ~500 px : le logo est centré dans un cadre w×h exact (pas dans la fenêtre).
  const html = `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:${BG}}
body{width:${w}px;height:${h}px;overflow:hidden;display:flex;align-items:center;justify-content:center}
.l{width:${logoWidth}px}.l svg{display:block;width:100%;height:auto;overflow:visible}</style><div class="l">${logoSvg}</div>`;
  const page = join(tmp, `${w}x${h}-${Math.random().toString(36).slice(2)}.html`);
  writeFileSync(page, html);
  execFileSync(browser, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
    `--window-size=${w},${h}`, `--screenshot=${file}`, 'file:///' + page.replaceAll(String.fromCharCode(92), '/')], { stdio: 'ignore' });
}

// Icônes : « any » (symbole ~60 % du carré) et « maskable » (symbole dans la zone de sécurité de 80 %, ~46 %).
render(join(outDir, 'meritt-192.png'), 192, 192, symbol, 192 * 0.6);
render(join(outDir, 'meritt-512.png'), 512, 512, symbol, 512 * 0.6);
render(join(outDir, 'meritt-maskable-512.png'), 512, 512, symbol, 512 * 0.46);
// Apple touch icon (180 px = 60 pt @3x). iOS applique lui-même le masque arrondi : carré plein, sans transparence.
render(join(root, 'app', 'apple-icon.png'), 180, 180, symbol, 180 * 0.6);

// Images de lancement iOS : [largeur CSS, hauteur CSS, ratio]. Logo complet à ~34 % de la largeur (min. des deux côtés en paysage non géré : portrait uniquement).
export const DEVICES = [
  [440, 956, 3], [402, 874, 3], [430, 932, 3], [393, 852, 3], [428, 926, 3], [390, 844, 3], [375, 812, 3],
  [414, 896, 3], [414, 896, 2], [414, 736, 3], [375, 667, 2], [320, 568, 2], [360, 780, 3],
  [1032, 1376, 2], [1024, 1366, 2], [834, 1210, 2], [834, 1194, 2], [834, 1112, 2], [820, 1180, 2], [810, 1080, 2], [768, 1024, 2],
];
if (process.argv.includes('--list')) console.log(JSON.stringify(DEVICES));
// Portrait et paysage : même taille de logo, seul le cadre change.
for (const [w, h, r] of DEVICES) {
  const logoWidth = Math.min(w, 600) * r * 0.34;
  render(join(splashDir, `apple-splash-${w * r}-${h * r}.png`), w * r, h * r, full, logoWidth);
  render(join(splashDir, `apple-splash-${h * r}-${w * r}.png`), h * r, w * r, full, logoWidth);
}
console.log('OK');
