// Test de bout en bout du parcours de commande — À EXÉCUTER UNIQUEMENT CONTRE UN PROJET SUPABASE DE TEST.
//
// Ce script crée de VRAIES commandes dans la base de test (jamais en production : plusieurs garde-fous ci-dessous).
// Il n'utilise aucune clé service_role : la boutique est testée comme un visiteur, l'administration et les
// vérifications en base avec le compte administrateur de TEST (RLS respectée).
//
// Variables d'environnement requises (à définir dans VOTRE terminal, jamais dans un fichier du dépôt) :
//   TEST_SUPABASE_URL       ex. https://abcdefgh.supabase.co   (projet de TEST)
//   TEST_SUPABASE_KEY       clé « publishable » (anon) du projet de TEST
//   TEST_ADMIN_EMAIL        e-mail du compte admin de TEST
//   TEST_ADMIN_PASSWORD     mot de passe du compte admin de TEST
//   APP_URL                 (facultatif) http://localhost:3001 — application lancée avec les variables du projet de TEST
//   PLAYWRIGHT_MODULE_DIR   (facultatif) dossier node_modules contenant « playwright »
//
// STATUT : non exécuté (aucun projet de test n'existe encore).
import { createRequire } from 'node:module';

const PROD_REF = 'jvmvsaiduralhezrjeyg';
const APP = process.env.APP_URL ?? 'http://localhost:3001';
const SB = (process.env.TEST_SUPABASE_URL ?? '').replace(/\/$/, '');
const KEY = process.env.TEST_SUPABASE_KEY ?? '';
const EMAIL = process.env.TEST_ADMIN_EMAIL ?? '';
const PASSWORD = process.env.TEST_ADMIN_PASSWORD ?? '';

// ---------- Garde-fous : refus catégorique de toucher la production
if (!SB || !KEY || !EMAIL || !PASSWORD) throw new Error('Variables manquantes : TEST_SUPABASE_URL, TEST_SUPABASE_KEY, TEST_ADMIN_EMAIL, TEST_ADMIN_PASSWORD.');
if (SB.includes(PROD_REF) || APP.includes(PROD_REF)) throw new Error('REFUS : cette URL est celle de la PRODUCTION.');
if (!/^https:\/\/[a-z0-9]+\.supabase\.co$/.test(SB)) throw new Error('TEST_SUPABASE_URL invalide.');
if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(APP)) throw new Error('APP_URL doit être une application locale (http://localhost:PORT).');
const SB_HOST = new URL(SB).host;

const require = createRequire((process.env.PLAYWRIGHT_MODULE_DIR ?? 'C:/Users/HP/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules') + '/');
const { chromium } = require('playwright');

const PID = 'bbbbbbbb-0000-4000-8000-000000000001'; // produit de test (03-donnees-test.sql)
const results = [];
const rec = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`); };

// ---------- Accès base (PostgREST) avec le compte admin de TEST
async function signIn() {
  const r = await fetch(`${SB}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: KEY, 'content-type': 'application/json' }, body: JSON.stringify({ email: EMAIL, password: PASSWORD }) });
  if (!r.ok) throw new Error('Connexion du compte admin de test refusée (' + r.status + ').');
  return (await r.json()).access_token;
}
const rest = async (token, path) => { const r = await fetch(`${SB}/rest/v1/${path}`, { headers: { apikey: KEY, authorization: `Bearer ${token}` } }); return { status: r.status, body: await r.json() }; };
const rpc = async (token, name, args) => { const r = await fetch(`${SB}/rest/v1/rpc/${name}`, { method: 'POST', headers: { apikey: KEY, authorization: `Bearer ${token ?? KEY}`, 'content-type': 'application/json' }, body: JSON.stringify(args) }); return { status: r.status, body: await r.json() }; };
const stockOf = async (token) => (await rest(token, `product_inventory?product_id=eq.${PID}&select=stock_quantity`)).body[0]?.stock_quantity;
const orderByRef = async (token, ref) => (await rest(token, `orders?reference=eq.${encodeURIComponent(ref)}&select=*,order_items(*)`)).body[0];

const token = await signIn();
const browser = await chromium.launch({ channel: 'chrome', headless: true });
let foreignRequests = [];
const newContext = async () => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  // Toute requête vers un autre projet Supabase (donc potentiellement la production) est bloquée et fait échouer le test.
  await ctx.route(/https:\/\/[a-z0-9]+\.supabase\.co\//, (route) => {
    if (new URL(route.request().url()).host !== SB_HOST) { foreignRequests.push(route.request().url()); return route.abort(); }
    return route.continue();
  });
  return ctx;
};

async function order(mode) {
  const ctx = await newContext();
  const page = await ctx.newPage();
  await page.goto(APP + '/');
  await page.getByRole('button', { name: 'Ajouter au panier' }).first().click();
  await page.getByRole('button', { name: /^Panier/ }).first().click();
  await page.getByRole('button', { name: 'Passer la commande' }).click();
  await page.fill('#checkout-firstName', 'Client'); await page.fill('#checkout-lastName', mode === 'pickup' ? 'Retrait' : 'Livraison');
  await page.fill('#checkout-phone', mode === 'pickup' ? '0700000011' : '0700000012'); await page.fill('#checkout-email', 'client-test@example.com');
  await page.getByRole('button', { name: 'Continuer' }).click();
  await page.waitForSelector('input[name=reception-mode]', { state: 'attached' });
  await page.waitForTimeout(1500);
  if (mode === 'pickup') {
    await page.locator('input[value=pickup]').check({ force: true });
  } else {
    await page.selectOption('#checkout-commune', 'Zone Test');
    await page.fill('#checkout-address', '12 rue des tests');
  }
  await page.getByRole('button', { name: 'Continuer' }).click();
  await page.waitForSelector('text=Confirmer la commande');
  const responsePromise = page.waitForResponse((r) => /rpc\/create_order/.test(r.url()) && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Confirmer la commande' }).click();
  const response = await responsePromise;
  const request = JSON.parse(response.request().postData());
  const body = await response.json();
  await page.waitForSelector('text=Commande enregistrée');
  const confirmationText = await page.locator('[role=dialog]').innerText();
  await ctx.close();
  return { status: response.status(), request, body, confirmationText };
}

try {
  const before = await stockOf(token);
  rec('S0 stock de départ du produit de test = 5', before === 5, `stock=${before}`);

  // ---------- S1 : commande en LIVRAISON (interface réelle, base de test)
  const d = await order('delivery');
  const dRef = d.body.reference;
  rec('S1a référence renvoyée par PostgreSQL (MH-AAAA-NNNNNN) et affichée à l’écran', /^MH-\d{4}-\d{6}$/.test(dRef ?? '') && d.confirmationText.includes(dRef), dRef);
  const dRow = await orderByRef(token, dRef);
  rec('S1b ligne enregistrée : livraison, statut pending, paiement pending, frais 1 500, total 26 500',
    dRow?.fulfillment_method === 'delivery' && dRow.status === 'pending' && dRow.payment_status === 'pending' && dRow.payment_method === 'cash_on_delivery' && dRow.delivery_fee_fcfa === 1500 && dRow.subtotal_fcfa === 25000 && dRow.total_fcfa === 26500 && dRow.delivery_commune === 'Zone Test',
    JSON.stringify({ fee: dRow?.delivery_fee_fcfa, total: dRow?.total_fcfa, status: dRow?.status }));
  rec('S1c lignes enregistrées : 1 article « Produit Test », 25 000 × 1', dRow?.order_items?.length === 1 && dRow.order_items[0].product_name === 'Produit Test' && dRow.order_items[0].unit_price_fcfa === 25000 && dRow.order_items[0].quantity === 1 && dRow.order_items[0].line_total_fcfa === 25000);
  rec('S1d aucun montant n’a été envoyé par le navigateur', !Object.keys(d.request).some((k) => /price|fee|total|amount/i.test(k)));
  rec('S1e stock : 5 → 4 (diminution exacte)', (await stockOf(token)) === 4, `stock=${await stockOf(token)}`);

  // ---------- S2 : commande en RETRAIT SUR PLACE
  const p = await order('pickup');
  const pRef = p.body.reference;
  const pRow = await orderByRef(token, pRef);
  rec('S2a retrait : frais 0, total 25 000, pas d’adresse de livraison enregistrée', pRow?.fulfillment_method === 'pickup' && pRow.delivery_fee_fcfa === 0 && pRow.total_fcfa === 25000 && pRow.delivery_address === null && pRow.delivery_commune === null, JSON.stringify({ fee: pRow?.delivery_fee_fcfa, total: pRow?.total_fcfa }));
  rec('S2b adresse de retrait de test affichée dans la confirmation', /ADRESSE DE TEST/.test(p.confirmationText));
  rec('S2c stock : 4 → 3', (await stockOf(token)) === 3, `stock=${await stockOf(token)}`);
  rec('S2d références distinctes et croissantes', dRef !== pRef && pRef > dRef, `${dRef} / ${pRef}`);

  // ---------- S3 : idempotence (même clé rejouée)
  const replay = await rpc(null, 'create_order', d.request);
  const sameCount = (await rest(token, `orders?idempotency_key=eq.${d.request.p_idempotency_key}&select=id`)).body.length;
  rec('S3 rejeu avec la même clé : même référence, idempotent_replay, 1 seule commande, stock inchangé', replay.status === 200 && replay.body.reference === dRef && replay.body.idempotent_replay === true && sameCount === 1 && (await stockOf(token)) === 3, `réf=${replay.body.reference} lignes=${sameCount} stock=${await stockOf(token)}`);

  // ---------- S4 : administration (interface réelle, compte admin de test)
  const adminCtx = await newContext();
  const admin = await adminCtx.newPage();
  await admin.goto(APP + '/admin');
  await admin.fill('#admin-email', EMAIL); await admin.fill('#admin-password', PASSWORD);
  await admin.getByRole('button', { name: /connecter|connexion/i }).first().click();
  await admin.waitForSelector('text=Vue d’ensemble', { timeout: 20000 });
  await admin.goto(APP + '/admin/commandes');
  await admin.waitForSelector(`text=${dRef}`, { timeout: 20000 });
  rec('S4a /admin/commandes affiche les deux commandes de test', (await admin.locator(`tr:has-text("${dRef}")`).count()) === 1 && (await admin.locator(`tr:has-text("${pRef}")`).count()) === 1);
  rec('S4b modes et totaux affichés', /Livraison/.test(await admin.locator(`tr:has-text("${dRef}")`).innerText()) && /Retrait/.test(await admin.locator(`tr:has-text("${pRef}")`).innerText()) && /26\s?500/.test(await admin.locator(`tr:has-text("${dRef}")`).innerText()));

  const open = async (ref) => { await admin.locator(`tr:has-text("${ref}")`).getByRole('button', { name: 'Voir' }).click(); await admin.waitForSelector('[role=dialog]'); };
  const buttons = async () => (await admin.locator('[role=dialog] button').allInnerTexts()).filter((t) => /Passer à|Annuler la commande/.test(t)).map((t) => t.trim()).sort();
  const waitStatus = async (label) => admin.locator('[role=dialog] dd', { hasText: new RegExp(`^${label}$`) }).first().waitFor({ timeout: 15000 });
  const click = async (name) => { await admin.getByRole('button', { name }).click(); };

  // Livraison : pending → confirmed → preparing → shipped → delivered
  await open(dRef);
  rec('S4c livraison / En attente : seules « Confirmée » et « Annuler » sont proposées', JSON.stringify(await buttons()) === JSON.stringify(['Annuler la commande', 'Passer à « Confirmée »']), JSON.stringify(await buttons()));
  await click('Passer à « Confirmée »'); await waitStatus('Confirmée');
  await click('Passer à « En préparation »'); await waitStatus('En préparation');
  rec('S4d livraison / En préparation : « En livraison » proposé, « Prête au retrait » jamais', (await buttons()).includes('Passer à « En livraison »') && !(await buttons()).some((b) => /Prête au retrait/.test(b)), JSON.stringify(await buttons()));
  await click('Passer à « En livraison »'); await waitStatus('En livraison');
  rec('S4e livraison / En livraison : annulation non proposée', JSON.stringify(await buttons()) === JSON.stringify(['Passer à « Terminée »']), JSON.stringify(await buttons()));
  await click('Passer à « Terminée »'); await waitStatus('Terminée');
  rec('S4f livraison / Terminée : état final, aucun bouton', (await buttons()).length === 0);
  rec('S4g stock inchangé après livraison terminée (3)', (await stockOf(token)) === 3);
  await admin.keyboard.press('Escape');

  // Retrait : pending → confirmed → preparing → ready_for_pickup → annulation
  await open(pRef);
  await click('Passer à « Confirmée »'); await waitStatus('Confirmée');
  await click('Passer à « En préparation »'); await waitStatus('En préparation');
  rec('S4h retrait / En préparation : « Prête au retrait » proposé, « En livraison » jamais', (await buttons()).includes('Passer à « Prête au retrait »') && !(await buttons()).some((b) => /En livraison/.test(b)), JSON.stringify(await buttons()));
  await click('Passer à « Prête au retrait »'); await waitStatus('Prête au retrait');
  await click('Annuler la commande'); await waitStatus('Annulée');
  const afterCancel = await stockOf(token);
  rec('S4i annulation : stock restitué une seule fois (3 → 4)', afterCancel === 4, `stock=${afterCancel}`);
  rec('S4j commande annulée : plus aucun bouton', (await buttons()).length === 0);
  const again = await rpc(token, 'admin_set_order_status', { p_order_id: pRow.id, p_new_status: 'cancelled' });
  rec('S4k seconde annulation refusée par la base (INVALID_TRANSITION), stock inchangé (4)', again.status >= 400 && /INVALID_TRANSITION/.test(JSON.stringify(again.body)) && (await stockOf(token)) === 4, JSON.stringify(again.body).slice(0, 80));
  const cancelledRow = await orderByRef(token, pRef);
  rec('S4l la commande annulée garde son paiement « pending » (jamais payée)', cancelledRow.status === 'cancelled' && cancelledRow.payment_status === 'pending' && cancelledRow.stock_restored_at !== null);
  await adminCtx.close();

  rec('S5 aucune requête n’est partie vers un autre projet Supabase', foreignRequests.length === 0, foreignRequests.join(', '));
} catch (error) {
  rec('ERREUR D’EXÉCUTION', false, String(error?.message ?? error).split('\n')[0]);
} finally {
  await browser.close();
}
const failed = results.filter((r) => !r.ok);
console.log(`\nTOTAL ${results.length - failed.length}/${results.length}`);
process.exit(failed.length === 0 ? 0 : 1);
