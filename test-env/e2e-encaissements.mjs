// Test de bout en bout du module d'encaissement — À EXÉCUTER UNIQUEMENT CONTRE UN PROJET SUPABASE DE TEST.
//
// Prérequis : projet de test préparé (voir LISEZ-MOI.md) avec test-env/01-schema-base.sql, migration-commandes.sql (partie 1),
// migration-encaissements.sql (partie 1) et test-env/03-donnees-test.sql ; application lancée sur le projet de test
// (npx next dev -p 3001 avec les variables NEXT_PUBLIC_SUPABASE_* du projet de TEST).
// Ce script crée de VRAIES commandes et de VRAIS paiements fictifs dans la base de test. Il n'utilise aucune clé service_role.
//
// Variables d'environnement (à saisir dans VOTRE terminal, jamais dans un fichier du dépôt) :
//   TEST_SUPABASE_URL, TEST_SUPABASE_KEY (clé publishable), TEST_ADMIN_EMAIL, TEST_ADMIN_PASSWORD,
//   APP_URL (facultatif, http://localhost:3001), PLAYWRIGHT_MODULE_DIR (facultatif)
//
// STATUT : écrit, non exécuté (aucun projet de test accessible à ce jour).
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';

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
const rec = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + String(detail).slice(0, 160) : ''}`); };

const signIn = async () => {
  const r = await fetch(`${SB}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: KEY, 'content-type': 'application/json' }, body: JSON.stringify({ email: EMAIL, password: PASSWORD }) });
  if (!r.ok) throw new Error('Connexion du compte admin de test refusée (' + r.status + ').');
  return (await r.json()).access_token;
};
const call = async (method, path, token, body) => {
  const r = await fetch(`${SB}/rest/v1/${path}`, { method, headers: { apikey: KEY, authorization: `Bearer ${token ?? KEY}`, 'content-type': 'application/json', prefer: 'return=representation' }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  return { status: r.status, body: text ? JSON.parse(text) : null };
};
const rpc = (token, name, args) => call('POST', `rpc/${name}`, token, args);
const rest = (token, path) => call('GET', path, token);
const uuid = () => crypto.randomUUID();

const token = await signIn();
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const foreign = [];
const newContext = async () => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  // Toute requête vers un autre projet Supabase (donc potentiellement la production) est bloquée.
  await ctx.route(/https:\/\/[a-z0-9]+\.supabase\.co\//, (route) => {
    if (new URL(route.request().url()).host !== SB_HOST) { foreign.push(route.request().url()); return route.abort(); }
    return route.continue();
  });
  return ctx;
};

// Deux commandes en retrait créées par l'API publique (comme la boutique), total 25 000 chacune.
const makeOrder = async (phone) => {
  const r = await rpc(null, 'create_order', { p_idempotency_key: uuid(), p_customer_name: 'Client Encaissement', p_customer_email: 'enc-test@example.com', p_customer_phone: phone, p_fulfillment_method: 'pickup', p_delivery_commune: null, p_delivery_address: null, p_customer_notes: null, p_items: [{ product_id: PID, quantity: 1 }], p_website: '' });
  if (r.status !== 200) throw new Error('Création de commande de test impossible : ' + JSON.stringify(r.body).slice(0, 120));
  return (await rest(token, `orders?reference=eq.${r.body.reference}&select=id,reference,total_fcfa,payment_status`)).body[0];
};
const paymentsOf = async (orderId) => (await rest(token, `order_payments?order_id=eq.${orderId}&select=*&order=created_at.asc`)).body;
const orderOf = async (id) => (await rest(token, `orders?id=eq.${id}&select=payment_status,status,total_fcfa`)).body[0];
const stockOf = async () => (await rest(token, `product_inventory?product_id=eq.${PID}&select=stock_quantity`)).body[0]?.stock_quantity;

try {
  const stock0 = await stockOf();
  const o1 = await makeOrder('0700000401');
  const o2 = await makeOrder('0700000402');
  rec('P0 commandes de test créées (total 25 000 chacune, paiement en attente)', o1.total_fcfa === 25000 && o2.total_fcfa === 25000 && o1.payment_status === 'pending', `${o1.reference} / ${o2.reference}`);

  // ---------- P1 : accès administrateur et accès non autorisé
  const anonCtx = await newContext();
  const visitor = await anonCtx.newPage();
  await visitor.goto(APP + '/admin/encaissements');
  await visitor.waitForSelector('#admin-email', { timeout: 30000 });
  rec('P1a visiteur non connecté : formulaire de connexion, aucun contenu d’encaissement', (await visitor.locator('text=Total encaissé').count()) === 0);
  await anonCtx.close();
  const anonRead = await rest(null, 'order_payments?select=id');
  const anonWrite = await rpc(null, 'record_payment', { p_order_id: o1.id, p_amount: 1000, p_method: 'cash', p_reference: null, p_paid_at: new Date().toISOString(), p_note: null, p_idempotency_key: uuid(), p_confirm: true });
  rec('P1b API publique : lecture et enregistrement de paiement refusés (aucun droit)', [401, 403].includes(anonRead.status) && [401, 403, 404].includes(anonWrite.status) && (await paymentsOf(o1.id)).length === 0, `${anonRead.status}/${anonWrite.status}`);

  const adminCtx = await newContext();
  const admin = await adminCtx.newPage();
  await admin.goto(APP + '/admin');
  await admin.fill('#admin-email', EMAIL); await admin.fill('#admin-password', PASSWORD);
  await admin.getByRole('button', { name: /connecter|connexion/i }).first().click();
  await admin.waitForSelector('text=Vue d’ensemble', { timeout: 20000 });
  await admin.goto(APP + '/admin/encaissements');
  await admin.waitForSelector('text=Total encaissé', { timeout: 30000 });
  rec('P1c administrateur : page Encaissements et indicateurs affichés', true);

  const openDialog = async (order) => {
    await admin.getByRole('button', { name: 'Nouvel encaissement' }).click();
    await admin.waitForSelector('#pay-order');
    await admin.selectOption('#pay-order', order.id);
    await admin.waitForSelector('text=solde disponible');
  };
  const fill = async (amount, method, reference = '') => {
    await admin.fill('#pay-amount', String(amount));
    await admin.selectOption('#pay-method', method);
    if (reference) await admin.fill('#pay-reference', reference);
  };

  // ---------- P2 : paiement partiel en espèces confirmé, puis règlement du solde
  await openDialog(o1);
  await fill(10000, 'cash');
  await admin.locator('[role=dialog] input[type=checkbox]').check();
  await admin.getByRole('button', { name: 'Enregistrer le paiement' }).click();
  await admin.waitForSelector('text=Paiement confirmé, reçu RC-');
  let p = await paymentsOf(o1.id);
  rec('P2a acompte 10 000 en espèces : confirmé, reçu RC-AAAA-NNNNNN, solde 15 000, commande encore « pending »', p.length === 1 && p[0].status === 'confirmed' && /^RC-\d{4}-\d{6}$/.test(p[0].receipt_number) && (await orderOf(o1.id)).payment_status === 'pending');
  await admin.waitForTimeout(800);
  await openDialog(o1);
  await fill(15000, 'cash');
  await admin.locator('[role=dialog] input[type=checkbox]').check();
  await admin.getByRole('button', { name: 'Enregistrer le paiement' }).click();
  await admin.waitForSelector('text=Solde restant : 0');
  p = await paymentsOf(o1.id);
  rec('P2b solde réglé : 2 paiements confirmés (total 25 000), commande « paid », reçus distincts', p.length === 2 && p.every((x) => x.status === 'confirmed') && p[0].receipt_number !== p[1].receipt_number && (await orderOf(o1.id)).payment_status === 'paid');

  // ---------- P3 : surpaiement refusé (interface puis base)
  await admin.waitForTimeout(800);
  await openDialog(o1);
  await fill(1, 'cash');
  await admin.getByRole('button', { name: 'Enregistrer le paiement' }).click();
  const over = await admin.locator('[role=dialog]').innerText();
  const overDb = await rpc(token, 'record_payment', { p_order_id: o1.id, p_amount: 1, p_method: 'cash', p_reference: null, p_paid_at: new Date().toISOString(), p_note: null, p_idempotency_key: uuid(), p_confirm: true });
  rec('P3 surpaiement refusé par l’interface ET par la base (AMOUNT_EXCEEDS_BALANCE)', /dépasse le solde/.test(over) && /AMOUNT_EXCEEDS_BALANCE/.test(JSON.stringify(overDb.body)) && (await paymentsOf(o1.id)).length === 2);
  await admin.getByRole('button', { name: 'Annuler', exact: true }).click();

  // ---------- P4 : Mobile Money en attente, double clic, confirmation attestée, double confirmation
  await admin.waitForTimeout(500);
  await openDialog(o2);
  await fill(10000, 'mobile_money', 'MM-E2E-0001');
  rec('P4a Mobile Money : aucune case de confirmation à la saisie', (await admin.locator('[role=dialog] input[type=checkbox]').count()) === 0);
  await admin.getByRole('button', { name: 'Enregistrer le paiement' }).dblclick();
  await admin.waitForSelector('text=en attente de confirmation');
  p = await paymentsOf(o2.id);
  rec('P4b double clic : un seul paiement « pending_confirmation », sans reçu, commande non payée', p.length === 1 && p[0].status === 'pending_confirmation' && p[0].receipt_number === null && (await orderOf(o2.id)).payment_status === 'pending', `lignes=${p.length}`);
  const dup = await rpc(token, 'record_payment', { p_order_id: o2.id, p_amount: 5000, p_method: 'mobile_money', p_reference: ' mm-e2e-0001 ', p_paid_at: new Date().toISOString(), p_note: null, p_idempotency_key: uuid(), p_confirm: false });
  rec('P4c même transaction saisie une seconde fois : refusée (DUPLICATE_REFERENCE)', /DUPLICATE_REFERENCE/.test(JSON.stringify(dup.body)));
  await admin.waitForTimeout(800);
  await admin.getByRole('button', { name: 'Confirmer', exact: true }).first().click();
  await admin.getByRole('button', { name: 'Confirmer l’encaissement' }).click();
  rec('P4d confirmation sans attestation refusée', /Cochez la case d’attestation/.test(await admin.locator('[role=dialog]').innerText()) && (await paymentsOf(o2.id))[0].status === 'pending_confirmation');
  await admin.locator('[role=dialog] input[type=checkbox]').check();
  await admin.getByRole('button', { name: 'Confirmer l’encaissement' }).click();
  await admin.waitForSelector('text=Paiement confirmé, reçu RC-');
  p = await paymentsOf(o2.id);
  const again = await rpc(token, 'confirm_payment', { p_payment_id: p[0].id, p_attest: true });
  rec('P4e confirmation attestée : confirmé avec reçu ; seconde confirmation refusée (INVALID_TRANSITION)', p[0].status === 'confirmed' && !!p[0].receipt_number && /INVALID_TRANSITION/.test(JSON.stringify(again.body)));

  // ---------- P5 : contrepassation (aucune suppression, historique conservé)
  await admin.waitForTimeout(800);
  const reverseBtn = admin.locator('tr:has-text("MM-E2E-0001")').getByRole('button', { name: 'Contrepasser' });
  await reverseBtn.click();
  await admin.getByRole('button', { name: 'Contrepasser', exact: true }).last().click();
  rec('P5a contrepassation sans motif refusée', /Indiquez un motif/.test(await admin.locator('[role=dialog]').innerText()));
  await admin.fill('#pay-reason', 'Erreur de rapprochement (test)');
  await admin.getByRole('button', { name: 'Contrepasser', exact: true }).last().click();
  await admin.waitForSelector('text=contrepassé');
  p = await paymentsOf(o2.id);
  const events = (await rest(token, `order_payment_events?payment_id=eq.${p[0].id}&select=to_status,actor_email,reason&order=created_at.asc`)).body;
  rec('P5b statut « reversed », ligne et reçu conservés, historique complet avec auteur et motif', p.length === 1 && p[0].status === 'reversed' && !!p[0].receipt_number && events.map((e) => e.to_status).join() === 'pending_confirmation,confirmed,reversed' && events.every((e) => !!e.actor_email) && events[2].reason.includes('rapprochement'), events.map((e) => e.to_status).join());
  const del = await call('DELETE', `order_payments?id=eq.${p[0].id}`, token);
  rec('P5c suppression directe d’un paiement impossible', [401, 403, 404].includes(del.status) && (await paymentsOf(o2.id)).length === 1, `HTTP ${del.status}`);

  // ---------- P6 : liste, reçu, impression, export, cohérence
  await admin.reload();
  await admin.waitForSelector('text=Total encaissé');
  const list = await admin.locator('main').innerText();
  rec('P6a liste : paiements des deux commandes, statuts Confirmé et Contrepassé', list.includes(o1.reference) && list.includes(o2.reference) && /Confirmé/.test(list) && /Contrepassé/.test(list));
  const receiptNumber = (await paymentsOf(o1.id))[0].receipt_number;
  const receipt = await adminCtx.newPage();
  await receipt.goto(`${APP}/admin/encaissements/recu?id=${(await paymentsOf(o1.id))[0].id}`);
  await receipt.waitForSelector('article');
  await receipt.emulateMedia({ media: 'print' });
  const printed = await receipt.evaluate(() => { const vis = (el) => !!el && el.getBoundingClientRect().width > 0; return { aside: vis(document.querySelector('aside')), article: vis(document.querySelector('article')) }; });
  rec('P6b reçu : numéro et montants affichés ; à l’impression le menu est masqué', (await receipt.locator('article').innerText()).includes(receiptNumber) && !printed.aside && printed.article);
  const [download] = await Promise.all([admin.waitForEvent('download'), admin.getByRole('button', { name: 'Exporter en CSV' }).click()]);
  const csv = await readFile(await download.path(), 'utf8');
  rec('P6c export CSV : reçu et référence de commande présents', csv.includes(receiptNumber) && csv.includes(o1.reference));
  const stock1 = await stockOf();
  rec('P6d stock inchangé par les paiements (seules les 2 commandes de test ont diminué le stock)', stock0 - 2 === stock1, `${stock0} -> ${stock1}`);
  const summary = await rpc(token, 'payments_summary', { p_from: new Date(Date.now() - 86400000).toISOString(), p_to: new Date(Date.now() + 86400000).toISOString() });
  rec('P6e rapport cohérent : encaissé = 25 000 (commande 1), aucune incohérence', summary.body.confirmed_total_fcfa === 25000 && summary.body.inconsistent_orders_count === 0, JSON.stringify(summary.body).slice(0, 100));
  await adminCtx.close();

  rec('P7 aucune requête n’est partie vers un autre projet Supabase', foreign.length === 0, foreign.join(', '));
} catch (error) {
  rec('ERREUR D’EXÉCUTION', false, String(error?.message ?? error).split('\n')[0]);
} finally {
  await browser.close();
}
const failed = results.filter((r) => !r.ok);
console.log(`\nTOTAL ${results.length - failed.length}/${results.length}`);
process.exit(failed.length === 0 ? 0 : 1);
