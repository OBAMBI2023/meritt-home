import { z } from 'zod';
import { assertAdmin, type MutationResult } from '@/lib/admin/products';
import { AdminQueryError } from '@/lib/admin/queries';
import { getSupabase } from '@/lib/supabase/client';

/**
 * Module d'encaissement : lectures (vue `v_order_payments`, historique, indicateurs) et écritures.
 * Toutes les écritures passent par les fonctions SQL `record_payment`, `confirm_payment` et `set_payment_status`
 * (réservées aux administrateurs, voir migration-encaissements.sql) : le navigateur n'écrit jamais directement.
 * Les montants dus et les soldes viennent de la base ; rien n'est calculé ni confirmé côté navigateur.
 */

type Row = Record<string, unknown>;
const isRow = (value: unknown): value is Row => typeof value === 'object' && value !== null;
const toRows = (data: unknown): Row[] => (Array.isArray(data) ? data.filter(isRow) : []);
const toStr = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null);
const toInt = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);

/** Codes renvoyés quand la migration des encaissements n'est pas (encore) appliquée. */
export const MODULE_MISSING_CODES = ['42P01', 'PGRST205', 'PGRST202', '42883'];
export const isModuleMissing = (code: string | null) => code !== null && MODULE_MISSING_CODES.includes(code);

function check(error: { code: string } | null): void {
  if (error) throw new AdminQueryError(error.code || null);
}

export type PaymentStatus = 'pending_confirmation' | 'confirmed' | 'rejected' | 'cancelled' | 'reversed';

export const STATUS_LABELS: Record<PaymentStatus, string> = {
  pending_confirmation: 'En attente de confirmation',
  confirmed: 'Confirmé',
  rejected: 'Refusé',
  cancelled: 'Annulé',
  reversed: 'Contrepassé',
};

export interface PaymentRow {
  id: string;
  orderId: string;
  orderReference: string;
  customerName: string;
  customerPhone: string;
  orderTotal: number;
  amount: number;
  methodCode: string;
  methodLabel: string;
  externalReference: string | null;
  paidAt: string;
  note: string | null;
  status: PaymentStatus;
  receiptNumber: string | null;
  recordedByEmail: string | null;
  confirmedByEmail: string | null;
  confirmedAt: string | null;
  createdAt: string;
  /** Total des paiements confirmés de la commande, aujourd'hui. */
  orderConfirmed: number;
}

const STATUSES: PaymentStatus[] = ['pending_confirmation', 'confirmed', 'rejected', 'cancelled', 'reversed'];

function toPayment(row: Row): PaymentRow | null {
  const id = toStr(row.id);
  const orderId = toStr(row.order_id);
  const orderReference = toStr(row.order_reference);
  const amount = toInt(row.amount_fcfa);
  const orderTotal = toInt(row.order_total_fcfa);
  const paidAt = toStr(row.paid_at);
  const status = STATUSES.find((value) => value === row.status);
  if (!id || !orderId || !orderReference || amount === null || orderTotal === null || !paidAt || !status) return null;
  return {
    id,
    orderId,
    orderReference,
    customerName: toStr(row.customer_name) ?? '—',
    customerPhone: toStr(row.customer_phone) ?? '—',
    orderTotal,
    amount,
    methodCode: toStr(row.method_code) ?? '',
    methodLabel: toStr(row.method_label) ?? '—',
    externalReference: toStr(row.external_reference),
    paidAt,
    note: toStr(row.note),
    status,
    receiptNumber: toStr(row.receipt_number),
    recordedByEmail: toStr(row.recorded_by_email),
    confirmedByEmail: toStr(row.confirmed_by_email),
    confirmedAt: toStr(row.confirmed_at),
    createdAt: toStr(row.created_at) ?? paidAt,
    orderConfirmed: toInt(row.order_confirmed_fcfa) ?? 0,
  };
}

/** Solde restant de la commande (total dû moins paiements confirmés). */
export const balanceOf = (payment: Pick<PaymentRow, 'orderTotal' | 'orderConfirmed'>) => payment.orderTotal - payment.orderConfirmed;

export interface PaymentFilters {
  from: string | null;
  to: string | null;
  method: string;
  status: string;
  search: string;
}

const SELECT = '*';

function applyFilters<T extends { gte: (c: string, v: string) => T; lt: (c: string, v: string) => T; eq: (c: string, v: string) => T; or: (f: string) => T }>(query: T, filters: PaymentFilters): T {
  let q = query;
  if (filters.from) q = q.gte('paid_at', filters.from);
  if (filters.to) q = q.lt('paid_at', filters.to);
  if (filters.method !== 'all') q = q.eq('method_code', filters.method);
  if (filters.status !== 'all') q = q.eq('status', filters.status);
  // Les caractères réservés de la syntaxe PostgREST sont retirés de la recherche.
  const needle = filters.search.replace(/[%,()*\\]/g, ' ').trim();
  if (needle) {
    q = q.or(`order_reference.ilike.%${needle}%,customer_name.ilike.%${needle}%,customer_phone.ilike.%${needle}%,receipt_number.ilike.%${needle}%,external_reference.ilike.%${needle}%`);
  }
  return q;
}

export async function fetchPayments(filters: PaymentFilters, page: number, pageSize: number): Promise<{ rows: PaymentRow[]; total: number }> {
  const base = getSupabase().from('v_order_payments').select(SELECT, { count: 'exact' });
  const { data, count, error } = await applyFilters(base, filters)
    .order('paid_at', { ascending: false })
    .range(page * pageSize, page * pageSize + pageSize - 1);
  check(error);
  return { rows: toRows(data).flatMap((row) => toPayment(row) ?? []), total: count ?? 0 };
}

/** Export : jusqu'à 2 000 lignes correspondant aux filtres (au-delà, l'utilisateur est averti). */
export const EXPORT_LIMIT = 2000;
export async function fetchPaymentsForExport(filters: PaymentFilters): Promise<{ rows: PaymentRow[]; truncated: boolean }> {
  const base = getSupabase().from('v_order_payments').select(SELECT, { count: 'exact' });
  const { data, count, error } = await applyFilters(base, filters).order('paid_at', { ascending: false }).limit(EXPORT_LIMIT);
  check(error);
  return { rows: toRows(data).flatMap((row) => toPayment(row) ?? []), truncated: (count ?? 0) > EXPORT_LIMIT };
}

export async function fetchPaymentById(id: string): Promise<PaymentRow | null> {
  const { data, error } = await getSupabase().from('v_order_payments').select(SELECT).eq('id', id).limit(1);
  check(error);
  return toRows(data).flatMap((row) => toPayment(row) ?? [])[0] ?? null;
}

export async function fetchOrderPayments(orderId: string): Promise<PaymentRow[]> {
  const { data, error } = await getSupabase().from('v_order_payments').select(SELECT).eq('order_id', orderId).order('created_at', { ascending: true }).limit(200);
  check(error);
  return toRows(data).flatMap((row) => toPayment(row) ?? []);
}

export interface PaymentMethod {
  code: string;
  label: string;
  requiresVerification: boolean;
  requiresReference: boolean;
  active: boolean;
}

export async function fetchPaymentMethods(): Promise<PaymentMethod[]> {
  const { data, error } = await getSupabase().from('payment_methods').select('code, label, requires_verification, requires_reference, is_active').order('sort_order', { ascending: true });
  check(error);
  return toRows(data).flatMap((row) => {
    const code = toStr(row.code);
    const label = toStr(row.label);
    return code && label ? [{ code, label, requiresVerification: row.requires_verification === true, requiresReference: row.requires_reference === true, active: row.is_active === true }] : [];
  });
}

export interface PayableOrder {
  id: string;
  reference: string;
  customerName: string;
  total: number;
  paymentStatus: string;
}

/** Commandes non annulées, les plus récentes d'abord : le solde exact est relu depuis la base à la sélection. */
export async function fetchPayableOrders(): Promise<PayableOrder[]> {
  const { data, error } = await getSupabase()
    .from('orders')
    .select('id, reference, customer_name, total_fcfa, payment_status, status')
    .neq('status', 'cancelled')
    .order('created_at', { ascending: false })
    .limit(300);
  check(error);
  return toRows(data).flatMap((row) => {
    const id = toStr(row.id);
    const reference = toStr(row.reference);
    const total = toInt(row.total_fcfa);
    return id && reference && total !== null ? [{ id, reference, customerName: toStr(row.customer_name) ?? '—', total, paymentStatus: toStr(row.payment_status) ?? '—' }] : [];
  });
}

export interface PaymentEvent {
  paymentId: string;
  from: string | null;
  to: string;
  actorEmail: string | null;
  reason: string | null;
  createdAt: string;
}

export async function fetchPaymentEvents(paymentIds: string[]): Promise<PaymentEvent[]> {
  if (paymentIds.length === 0) return [];
  const { data, error } = await getSupabase()
    .from('order_payment_events')
    .select('payment_id, from_status, to_status, actor_email, reason, created_at')
    .in('payment_id', paymentIds)
    .order('created_at', { ascending: true })
    .limit(500);
  check(error);
  return toRows(data).flatMap((row) => {
    const paymentId = toStr(row.payment_id);
    const to = toStr(row.to_status);
    const createdAt = toStr(row.created_at);
    return paymentId && to && createdAt ? [{ paymentId, from: toStr(row.from_status), to, actorEmail: toStr(row.actor_email), reason: toStr(row.reason), createdAt }] : [];
  });
}

export interface PaymentsSummary {
  confirmedTotal: number;
  confirmedCount: number;
  pendingTotal: number;
  pendingCount: number;
  outstandingTotal: number;
  ordersUnpaid: number;
  ordersPartial: number;
  ordersPaid: number;
  inconsistentOrders: number;
  byMethod: { method: string; total: number; count: number }[];
  byAgent: { agent: string; total: number; count: number }[];
  byDay: { day: string; total: number; count: number }[];
}

const groups = (value: unknown, key: string) =>
  (Array.isArray(value) ? value : []).flatMap((item: unknown) => {
    if (!isRow(item)) return [];
    const label = toStr(item[key]);
    const total = toInt(item.total_fcfa);
    const count = toInt(item.count);
    return label && total !== null && count !== null ? [{ label, total, count }] : [];
  });

export async function fetchPaymentsSummary(from: string, to: string): Promise<PaymentsSummary> {
  const { data, error } = await getSupabase().rpc('payments_summary', { p_from: from, p_to: to });
  check(error);
  if (!isRow(data)) throw new AdminQueryError(null);
  const n = (key: string) => toInt(data[key]) ?? 0;
  return {
    confirmedTotal: n('confirmed_total_fcfa'),
    confirmedCount: n('confirmed_count'),
    pendingTotal: n('pending_total_fcfa'),
    pendingCount: n('pending_count'),
    outstandingTotal: n('outstanding_total_fcfa'),
    ordersUnpaid: n('orders_unpaid_count'),
    ordersPartial: n('orders_partial_count'),
    ordersPaid: n('orders_paid_count'),
    inconsistentOrders: n('inconsistent_orders_count'),
    byMethod: groups(data.by_method, 'method').map((g) => ({ method: g.label, total: g.total, count: g.count })),
    byAgent: groups(data.by_agent, 'agent').map((g) => ({ agent: g.label, total: g.total, count: g.count })),
    byDay: groups(data.by_day, 'day').map((g) => ({ day: g.label, total: g.total, count: g.count })),
  };
}

/* ------------------------------------------------------------------ */
/* Écritures                                                           */
/* ------------------------------------------------------------------ */

export const paymentFormSchema = z.object({
  orderId: z.string().min(1, 'Choisissez une commande.'),
  amount: z
    .string()
    .trim()
    .min(1, 'Saisissez le montant versé.')
    .regex(/^\d+$/, 'Le montant doit être un nombre entier de FCFA, sans signe ni décimales.')
    .transform(Number)
    .refine((value) => value > 0, 'Le montant doit être supérieur à 0.')
    .refine((value) => value <= 2_000_000_000, 'Montant trop élevé.'),
  method: z.string().min(1, 'Choisissez un moyen de paiement.'),
  reference: z.string().trim().max(80, 'La référence est trop longue (80 caractères maximum).'),
  paidAt: z.string().min(1, 'Indiquez la date du paiement.'),
  note: z.string().trim().max(500, 'La note est trop longue (500 caractères maximum).'),
  confirmNow: z.boolean(),
});
export type PaymentFormInput = z.input<typeof paymentFormSchema>;
export type PaymentFormValues = z.output<typeof paymentFormSchema>;

const MESSAGES: Record<string, string> = {
  FORBIDDEN: 'Action réservée aux administrateurs.',
  INVALID_REQUEST: 'La demande est incomplète. Actualisez la page puis réessayez.',
  INVALID_AMOUNT: 'Le montant doit être supérieur à 0.',
  INVALID_METHOD: 'Ce moyen de paiement n’existe pas ou n’est plus actif.',
  REFERENCE_REQUIRED: 'La référence de transaction est obligatoire pour ce moyen de paiement.',
  INVALID_REFERENCE: 'La référence de transaction doit contenir entre 3 et 80 caractères.',
  INVALID_DATE: 'La date du paiement ne peut pas être dans le futur.',
  INVALID_NOTE: 'La note est trop longue (500 caractères maximum).',
  ORDER_NOT_FOUND: 'Commande introuvable.',
  ORDER_CANCELLED: 'Cette commande est annulée : aucun paiement ne peut lui être rattaché.',
  AMOUNT_EXCEEDS_BALANCE: 'Le montant dépasse le solde restant à encaisser (paiements en attente compris).',
  VERIFICATION_REQUIRED: 'Ce moyen de paiement doit d’abord être vérifié : enregistrez-le « en attente », puis confirmez-le après vérification.',
  DUPLICATE_REFERENCE: 'Cette transaction (même moyen, même référence) est déjà enregistrée.',
  PAYMENT_NOT_FOUND: 'Paiement introuvable.',
  INVALID_TRANSITION: 'Ce changement de statut n’est pas autorisé : le paiement a déjà été traité. Actualisez la liste.',
  ATTESTATION_REQUIRED: 'Cochez la case d’attestation pour confirmer ce paiement.',
  REASON_REQUIRED: 'Indiquez un motif (3 caractères minimum, 5 pour une contrepassation).',
  PAYMENT_DELETE_FORBIDDEN: 'Un paiement ne peut jamais être supprimé.',
};

const GENERIC = 'L’opération n’a pas pu être confirmée. Actualisez la liste pour vérifier son état avant de réessayer : un doublon est impossible avec la même saisie.';

function describe(error: { code?: string; message?: string } | null): string {
  if (error?.code === '23505') return MESSAGES.DUPLICATE_REFERENCE;
  if (isModuleMissing(error?.code ?? null)) return 'Le module d’encaissement n’est pas encore installé en base (migration-encaissements.sql).';
  return (error?.message && MESSAGES[error.message]) || GENERIC;
}

export type PaymentSummary = { id: string; status: string; receiptNumber: string | null; balance: number; replay: boolean };

function parseSummary(data: unknown): PaymentSummary | null {
  if (!isRow(data)) return null;
  const id = toStr(data.id);
  const status = toStr(data.status);
  const balance = toInt(data.balance_fcfa);
  return id && status && balance !== null ? { id, status, receiptNumber: toStr(data.receipt_number), balance, replay: data.idempotent_replay === true } : null;
}

async function call(name: string, args: Record<string, unknown>): Promise<MutationResult<PaymentSummary>> {
  const denied = await assertAdmin();
  if (denied) return { ok: false, message: denied };
  try {
    const { data, error } = await getSupabase().rpc(name, args);
    if (error) return { ok: false, message: describe(error) };
    const summary = parseSummary(data);
    return summary ? { ok: true, data: summary } : { ok: false, message: GENERIC };
  } catch {
    return { ok: false, message: GENERIC };
  }
}

export function recordPayment(values: PaymentFormValues, idempotencyKey: string) {
  return call('record_payment', {
    p_order_id: values.orderId,
    p_amount: values.amount,
    p_method: values.method,
    p_reference: values.reference === '' ? null : values.reference,
    p_paid_at: new Date(values.paidAt).toISOString(),
    p_note: values.note === '' ? null : values.note,
    p_idempotency_key: idempotencyKey,
    p_confirm: values.confirmNow,
  });
}

export const confirmPayment = (paymentId: string) => call('confirm_payment', { p_payment_id: paymentId, p_attest: true });

export const setPaymentStatus = (paymentId: string, status: 'rejected' | 'cancelled' | 'reversed', reason: string) =>
  call('set_payment_status', { p_payment_id: paymentId, p_new_status: status, p_reason: reason.trim() });

/* ------------------------------------------------------------------ */
/* Périodes et export                                                  */
/* ------------------------------------------------------------------ */

export type PeriodKey = 'today' | 'week' | 'month' | 'custom';

/** Bornes [début, fin[ en heure locale du navigateur, converties en ISO. */
export function periodBounds(key: PeriodKey, customFrom: string, customTo: string): { from: string; to: string } | null {
  const now = new Date();
  const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const addDays = (date: Date, days: number) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
  if (key === 'today') return { from: startOfDay(now).toISOString(), to: addDays(startOfDay(now), 1).toISOString() };
  if (key === 'week') return { from: addDays(startOfDay(now), -6).toISOString(), to: addDays(startOfDay(now), 1).toISOString() };
  if (key === 'month') return { from: new Date(now.getFullYear(), now.getMonth(), 1).toISOString(), to: addDays(startOfDay(now), 1).toISOString() };
  if (!customFrom || !customTo) return null;
  const from = new Date(`${customFrom}T00:00:00`);
  const to = addDays(new Date(`${customTo}T00:00:00`), 1);
  return Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from >= to ? null : { from: from.toISOString(), to: to.toISOString() };
}

const csvCell = (value: string | number | null) => {
  const text = value === null ? '' : String(value);
  // Neutralise l'injection de formules dans les tableurs, puis protège les séparateurs.
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[";\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export function paymentsToCsv(rows: PaymentRow[]): string {
  const header = ['Date du paiement', 'Reçu', 'Commande', 'Client', 'Téléphone', 'Moyen', 'Référence transaction', 'Statut', 'Montant (FCFA)', 'Total commande (FCFA)', 'Solde commande (FCFA)', 'Enregistré par', 'Confirmé par'];
  const lines = rows.map((row) =>
    [row.paidAt, row.receiptNumber, row.orderReference, row.customerName, row.customerPhone, row.methodLabel, row.externalReference, STATUS_LABELS[row.status], row.amount, row.orderTotal, balanceOf(row), row.recordedByEmail, row.confirmedByEmail].map(csvCell).join(';')
  );
  return '﻿' + [header.map(csvCell).join(';'), ...lines].join('\r\n');
}
