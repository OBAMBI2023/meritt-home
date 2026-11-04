// Diagnostic Playwright du catalogue — LECTURE SEULE, projet de TEST uniquement.
// Usage : node test-env/playwright-catalogue-test.mjs   (serveur de test déjà lancé sur le port 3001)
// Ne clique sur rien, n'appelle aucune RPC, n'utilise aucun identifiant. Seules les requêtes GET/POST de lecture de la page sont observées.
import { createRequire } from 'node:module';

const APP = 'http://localhost:3001/?x=1#catalogue';
const TEST_REF = 'kmjoyioeanjrvohmfash';
const PROD_REF = 'jvmvsaiduralhezrjeyg';

const require = createRequire((process.env.PLAYWRIGHT_MODULE_DIR ?? 'C:/Users/HP/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules') + '/');
const { chromium } = require('playwright');

// Masque tout ce qui ressemble à une clé ou un jeton (clés sb_*, JWT, en-têtes d'authentification).
const mask = (text) =>
  String(text ?? '')
    .replace(/sb_(publishable|secret)_[A-Za-z0-9_-]+/g, 'sb_$1_***')
    .replace(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, '<jwt masqué>')
    .replace(/(apikey|authorization)(["'\s:=]+)[^"',\s}]+/gi, '$1$2***');

// ---------- Préflight : serveur joignable (3 essais, le premier rendu en mode développement compile la page)
const serverUp = async () => {
  try { return (await fetch('http://localhost:3001/', { signal: AbortSignal.timeout(30000) })).ok; } catch { return false; }
};
let up = false;
for (let attempt = 1; attempt <= 3 && !up; attempt++) {
  up = await serverUp();
  if (!up) await new Promise((resolve) => setTimeout(resolve, 3000));
}
if (!up) {
  console.log('ARRÊT : serveur inaccessible sur localhost:3001. Démarrez-le : .\\test-env\\lancer-test.ps1 -Cible serveur-isole -Detache');
  console.log('        (journaux : %LOCALAPPDATA%\\meritt-home-test\\server.err.log)');
  process.exit(2);
}

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage();

const consoleErrors = [];
const jsErrors = [];
const supabase = []; // { method, url, status, body? }
const hosts = new Set();

page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(mask(msg.text())); });
page.on('pageerror', (error) => jsErrors.push(mask(error.message)));

// Garde-fou : toute requête vers la production est bloquée avant d'être envoyée.
await page.route('**/*', (route) => {
  if (route.request().url().includes(PROD_REF)) return route.abort();
  return route.continue();
});

page.on('response', async (response) => {
  const url = response.url();
  const host = new URL(url).hostname;
  if (!host.endsWith('.supabase.co')) return;
  hosts.add(host);
  const entry = { method: response.request().method(), url: mask(url.replace(/\?.*$/, '')), status: response.status() };
  if (response.status() >= 400) {
    try { entry.body = mask((await response.text()).slice(0, 600)); } catch { entry.body = '(corps illisible)'; }
  }
  supabase.push(entry);
});
page.on('requestfailed', (request) => {
  if (new URL(request.url()).hostname.endsWith('.supabase.co')) {
    supabase.push({ method: request.method(), url: mask(request.url().replace(/\?.*$/, '')), status: 'ÉCHEC RÉSEAU', body: request.failure()?.errorText });
  }
});

await page.goto(APP, { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForTimeout(3000);

// ---------- Contrôles du DOM
const unavailable = await page.getByText(/catalogue est momentanément indisponible/i).count();
const catalogue = page.locator('#catalogue');
const cards = await catalogue.locator('article, [data-product-id], [data-testid*="product"]').count();
const addButtons = await catalogue.getByRole('button', { name: /ajouter|panier/i }).count();
await browser.close();
const stillUp = await serverUp();

// ---------- Rapport
const refs = [...hosts].map((h) => h.replace('.supabase.co', ''));
const productsReq = supabase.filter((r) => r.url.includes('/rest/v1/products'));
const prodSeen = refs.includes(PROD_REF);
const testOnly = refs.length > 0 && refs.every((ref) => ref === TEST_REF);

console.log('URL testée            :', APP);
console.log('Référence(s) détectée :', refs.join(', ') || 'aucune');
console.log('Projet TEST exclusif  :', testOnly ? 'OUI' : 'NON', prodSeen ? '(PRODUCTION CONTACTÉE !)' : '');
console.log('Cartes produit (DOM)  :', cards, `(boutons d'ajout : ${addButtons})`);
console.log('Serveur 3001 après test:', stillUp ? 'toujours disponible' : 'INDISPONIBLE (arrêté pendant le test)');
console.log('Message indisponible  :', unavailable > 0 ? 'AFFICHÉ' : 'absent');
console.log('Requêtes Supabase     :');
for (const r of supabase) console.log(`  ${r.status}  ${r.method}  ${r.url}${r.body ? `\n        corps : ${r.body}` : ''}`);
console.log('Statuts /rest/v1/products :', productsReq.map((r) => r.status).join(', ') || 'aucune requête');
console.log('Erreurs console       :', consoleErrors.length ? `\n  - ${consoleErrors.join('\n  - ')}` : 'aucune');
console.log('Erreurs JavaScript    :', jsErrors.length ? `\n  - ${jsErrors.join('\n  - ')}` : 'aucune');

const pass = testOnly && unavailable === 0 && cards > 0 && productsReq.length > 0 && productsReq.every((r) => r.status === 200);
console.log('CONCLUSION            :', pass ? 'PASS' : 'FAIL');
if (!pass) {
  const first = productsReq.find((r) => r.status !== 200);
  const badKey = supabase.some((r) => r.status === 401 && /Invalid API key/i.test(r.body ?? ''));
  console.log('Cause probable        :', badKey
    ? 'clé publishable refusée par le projet TEST (Invalid API key) : relancer le lanceur avec la clé de kmjoyioeanjrvohmfash'
    : first ? `requête produits en ${first.status} — voir le corps ci-dessus` : 'aucune requête produits observée');
  console.log('Fichiers à examiner   : lib/catalogue.ts:132 (erreur levée), components/shop/catalogue-states.tsx:56 (message), configuration de la clé du serveur de test');
}
process.exit(pass ? 0 : 1);
