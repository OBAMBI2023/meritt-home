import { z } from 'zod';
import { assertAdmin, type MutationResult } from '@/lib/admin/products';
import { AdminQueryError } from '@/lib/admin/queries';
import { getSupabase } from '@/lib/supabase/client';

/**
 * Facturation : lectures (vue `v_invoices`, lignes, historique) et écritures.
 * Toutes les écritures passent par les fonctions SQL `create_invoice_draft`, `update_invoice_draft`, `issue_invoice`
 * et `cancel_invoice` (réservées aux administrateurs, voir migration-factures.sql) : le navigateur n'envoie jamais de
 * montant, n'attribue jamais de numéro et ne calcule jamais l'état de règlement (calculé en base à partir des paiements confirmés).
 */

type Row = Record<string, unknown>;
const isRow = (value: unknown): value is Row => typeof value === 'object' && value !== null;
const toRows = (data: unknown): Row[] => (Array.isArray(data) ? data.filter(isRow) : []);
const toStr = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null);
const toInt = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);

/** Codes renvoyés quand la migration des factures (ou des encaissements, dont elle dépend) n'est pas appliquée. */
export const INVOICE_MODULE_MISSING = ['42P01', 'PGRST205', 'PGRST202', '42883', '42703'];
export const isInvoiceModuleMissing = (code: string | null) => code !== null && INVOICE_MODULE_MISSING.includes(code);

function check(error: { code: string } | null): void {
  if (error) throw new AdminQueryError(error.code || null);
}

export type InvoiceStatus = 'draft' | 'issued' | 'cancelled';
export type DisplayStatus = 'draft' | 'cancelled' | 'paid' | 'overdue' | 'partially_paid' | 'issued';

export const DISPLAY_LABELS: Record<DisplayStatus, string> = {
  draft: 'Brouillon',
  issued: 'Émise',
  partially_paid: 'Partiellement payée',
  paid: 'Payée',
  overdue: 'En retard',
  cancelled: 'Annulée',
};

export interface CompanySnapshot {
  company_name?: string | null;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  tax_id?: string | null;
  rccm?: string | null;
  legal_notice?: string | null;
  payment_terms?: string | null;
  due_days?: number | null;
}

export interface InvoiceRow {
  id: string;
  number: string | null;
  orderId: string;
  orderReference: string;
  status: InvoiceStatus;
  displayStatus: DisplayStatus;
  issuedAt: string | null;
  dueAt: string | null;
  customerName: string;
  customerEmail: string | null;
  customerPhone: string | null;
  billingAddress: string | null;
  fulfillmentMethod: 'delivery' | 'pickup';
  currency: string;
  subtotal: number;
  deliveryFee: number;
  total: number;
  notes: string | null;
  company: CompanySnapshot | null;
  replacesNumber: string | null;
  createdByEmail: string | null;
  issuedByEmail: string | null;
  cancelledAt: string | null;
  cancelledByEmail: string | null;
  cancelReason: string | null;
  createdAt: string;
  paid: number;
  balance: number;
  isOverdue: boolean;
}

const STATUSES: InvoiceStatus[] = ['draft', 'issued', 'cancelled'];
const DISPLAY: DisplayStatus[] = ['draft', 'cancelled', 'paid', 'overdue', 'partially_paid', 'issued'];

function toInvoice(row: Row): InvoiceRow | null {
  const id = toStr(row.id);
  const orderId = toStr(row.order_id);
  const orderReference = toStr(row.order_reference);
  const status = STATUSES.find((value) => value === row.status);
  const displayStatus = DISPLAY.find((value) => value === row.display_status);
  const subtotal = toInt(row.subtotal_fcfa);
  const deliveryFee = toInt(row.delivery_fee_fcfa);
  const total = toInt(row.total_fcfa);
  const paid = toInt(row.paid_fcfa);
  const balance = toInt(row.balance_fcfa);
  if (!id || !orderId || !orderReference || !status || !displayStatus || subtotal === null || deliveryFee === null || total === null || paid === null || balance === null) return null;
  return {
    id,
    number: toStr(row.number),
    orderId,
    orderReference,
    status,
    displayStatus,
    issuedAt: toStr(row.issued_at),
    dueAt: toStr(row.due_at),
    customerName: toStr(row.customer_name) ?? '—',
    customerEmail: toStr(row.customer_email),
    customerPhone: toStr(row.customer_phone),
    billingAddress: toStr(row.billing_address),
    fulfillmentMethod: row.fulfillment_method === 'pickup' ? 'pickup' : 'delivery',
    currency: toStr(row.currency) ?? 'FCFA',
    subtotal,
    deliveryFee,
    total,
    notes: toStr(row.notes),
    company: isRow(row.company_snapshot) ? (row.company_snapshot as CompanySnapshot) : null,
    replacesNumber: toStr(row.replaces_number),
    createdByEmail: toStr(row.created_by_email),
    issuedByEmail: toStr(row.issued_by_email),
    cancelledAt: toStr(row.cancelled_at),
    cancelledByEmail: toStr(row.cancelled_by_email),
    cancelReason: toStr(row.cancel_reason),
    createdAt: toStr(row.created_at) ?? '',
    paid,
    balance,
    isOverdue: row.is_overdue === true,
  };
}

export interface InvoiceFilters {
  from: string | null;
  to: string | null;
  status: string;
  settlement: string;
  search: string;
}

function applyFilters<T extends { gte: (c: string, v: string) => T; lt: (c: string, v: string) => T; eq: (c: string, v: string | number | boolean) => T; gt: (c: string, v: number) => T; lte: (c: string, v: number) => T; or: (f: string) => T }>(query: T, filters: InvoiceFilters): T {
  let q = query;
  if (filters.from) q = q.gte('created_at', filters.from);
  if (filters.to) q = q.lt('created_at', filters.to);
  if (filters.status !== 'all') q = q.eq('status', filters.status);
  // État de règlement : calculé en base (vue), uniquement pour les factures émises.
  if (filters.settlement === 'unpaid') q = q.eq('status', 'issued').eq('paid_fcfa', 0);
  if (filters.settlement === 'partial') q = q.eq('status', 'issued').gt('paid_fcfa', 0).gt('balance_fcfa', 0);
  if (filters.settlement === 'paid') q = q.eq('status', 'issued').lte('balance_fcfa', 0);
  if (filters.settlement === 'overdue') q = q.eq('is_overdue', true);
  const needle = filters.search.replace(/[%,()*\\]/g, ' ').trim();
  if (needle) q = q.or(`number.ilike.%${needle}%,customer_name.ilike.%${needle}%,customer_phone.ilike.%${needle}%,order_reference.ilike.%${needle}%`);
  return q;
}

export async function fetchInvoices(filters: InvoiceFilters, page: number, pageSize: number): Promise<{ rows: InvoiceRow[]; total: number }> {
  const base = getSupabase().from('v_invoices').select('*', { count: 'exact' });
  const { data, count, error } = await applyFilters(base, filters)
    .order('created_at', { ascending: false })
    .range(page * pageSize, page * pageSize + pageSize - 1);
  check(error);
  return { rows: toRows(data).flatMap((row) => toInvoice(row) ?? []), total: count ?? 0 };
}

export async function fetchInvoiceById(id: string): Promise<InvoiceRow | null> {
  const { data, error } = await getSupabase().from('v_invoices').select('*').eq('id', id).limit(1);
  check(error);
  return toRows(data).flatMap((row) => toInvoice(row) ?? [])[0] ?? null;
}

/** Facture active ou la plus récente d'une commande (pour le lien depuis la fiche de commande). */
export async function fetchInvoicesOfOrder(orderId: string): Promise<InvoiceRow[]> {
  const { data, error } = await getSupabase().from('v_invoices').select('*').eq('order_id', orderId).order('created_at', { ascending: false }).limit(20);
  check(error);
  return toRows(data).flatMap((row) => toInvoice(row) ?? []);
}

export interface InvoiceLine {
  position: number;
  description: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}

export async function fetchInvoiceLines(invoiceId: string): Promise<InvoiceLine[]> {
  const { data, error } = await getSupabase().from('invoice_lines').select('position, description, quantity, unit_price_fcfa, line_total_fcfa').eq('invoice_id', invoiceId).order('position', { ascending: true }).limit(200);
  check(error);
  return toRows(data).flatMap((row) => {
    const position = toInt(row.position);
    const description = toStr(row.description);
    const quantity = toInt(row.quantity);
    const unitPrice = toInt(row.unit_price_fcfa);
    const lineTotal = toInt(row.line_total_fcfa);
    return position !== null && description && quantity !== null && unitPrice !== null && lineTotal !== null ? [{ position, description, quantity, unitPrice, lineTotal }] : [];
  });
}

export interface InvoiceEvent {
  event: string;
  from: string | null;
  to: string | null;
  actorEmail: string | null;
  reason: string | null;
  createdAt: string;
}

export const EVENT_LABELS: Record<string, string> = { created: 'Brouillon créé', draft_updated: 'Brouillon modifié', issued: 'Facture émise', cancelled: 'Facture annulée' };

export async function fetchInvoiceEvents(invoiceId: string): Promise<InvoiceEvent[]> {
  const { data, error } = await getSupabase().from('invoice_events').select('event, from_status, to_status, actor_email, reason, created_at').eq('invoice_id', invoiceId).order('created_at', { ascending: true }).limit(100);
  check(error);
  return toRows(data).flatMap((row) => {
    const event = toStr(row.event);
    const createdAt = toStr(row.created_at);
    return event && createdAt ? [{ event, from: toStr(row.from_status), to: toStr(row.to_status), actorEmail: toStr(row.actor_email), reason: toStr(row.reason), createdAt }] : [];
  });
}

export interface InvoicesSummary {
  issuedCount: number;
  cancelledCount: number;
  draftCount: number;
  invoiced: number;
  collected: number;
  balance: number;
  paidCount: number;
  partialCount: number;
  unpaidCount: number;
  overdueCount: number;
  overdue: number;
}

export async function fetchInvoicesSummary(from: string, to: string): Promise<InvoicesSummary> {
  const { data, error } = await getSupabase().rpc('invoices_summary', { p_from: from, p_to: to });
  check(error);
  if (!isRow(data)) throw new AdminQueryError(null);
  const n = (key: string) => toInt(data[key]) ?? 0;
  return {
    issuedCount: n('issued_count'),
    cancelledCount: n('cancelled_count'),
    draftCount: n('draft_count'),
    invoiced: n('invoiced_fcfa'),
    collected: n('collected_fcfa'),
    balance: n('balance_fcfa'),
    paidCount: n('paid_count'),
    partialCount: n('partial_count'),
    unpaidCount: n('unpaid_count'),
    overdueCount: n('overdue_count'),
    overdue: n('overdue_fcfa'),
  };
}

/** Commandes non annulées pouvant recevoir une facture (la base refuse les doublons et les commandes annulées). */
export interface InvoiceableOrder {
  id: string;
  reference: string;
  customerName: string;
  total: number;
}

export async function fetchInvoiceableOrders(): Promise<InvoiceableOrder[]> {
  const { data, error } = await getSupabase().from('orders').select('id, reference, customer_name, total_fcfa').neq('status', 'cancelled').order('created_at', { ascending: false }).limit(300);
  check(error);
  return toRows(data).flatMap((row) => {
    const id = toStr(row.id);
    const reference = toStr(row.reference);
    const total = toInt(row.total_fcfa);
    return id && reference && total !== null ? [{ id, reference, customerName: toStr(row.customer_name) ?? '—', total }] : [];
  });
}

/* ------------------------------------------------------------------ */
/* Réglages de l'entreprise (imprimés sur les factures émises)         */
/* ------------------------------------------------------------------ */

export interface CompanySettings {
  companyName: string;
  address: string;
  phone: string;
  email: string;
  taxId: string;
  rccm: string;
  legalNotice: string;
  paymentTerms: string;
  dueDays: number | null;
}

export async function fetchCompanySettings(): Promise<CompanySettings | null> {
  const { data, error } = await getSupabase().from('company_settings').select('company_name, address, phone, email, tax_id, rccm, legal_notice, payment_terms, due_days').limit(1);
  check(error);
  const row = toRows(data)[0];
  if (!row) return null;
  return {
    companyName: toStr(row.company_name) ?? '',
    address: toStr(row.address) ?? '',
    phone: toStr(row.phone) ?? '',
    email: toStr(row.email) ?? '',
    taxId: toStr(row.tax_id) ?? '',
    rccm: toStr(row.rccm) ?? '',
    legalNotice: toStr(row.legal_notice) ?? '',
    paymentTerms: toStr(row.payment_terms) ?? '',
    dueDays: toInt(row.due_days),
  };
}

const optional = (max: number, label: string) => z.string().trim().max(max, `${label} : ${max} caractères maximum.`);
export const companyFormSchema = z.object({
  companyName: z.string().trim().min(2, 'Le nom de l’entreprise doit contenir au moins 2 caractères.').max(120, 'Nom trop long (120 caractères maximum).'),
  address: optional(300, 'Adresse'),
  phone: optional(40, 'Téléphone'),
  email: z.string().trim().max(120, 'E-mail : 120 caractères maximum.').refine((value) => value === '' || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value), 'Adresse e-mail invalide.'),
  taxId: optional(60, 'Numéro fiscal'),
  rccm: optional(60, 'RCCM'),
  legalNotice: optional(600, 'Mentions légales'),
  paymentTerms: optional(400, 'Conditions de paiement'),
  dueDays: z
    .string()
    .trim()
    .refine((value) => value === '' || (/^\d{1,3}$/.test(value) && Number(value) <= 365), 'Délai en jours : un entier de 0 à 365, ou vide pour ne pas fixer d’échéance.'),
});
export type CompanyFormInput = z.input<typeof companyFormSchema>;
export type CompanyFormValues = z.output<typeof companyFormSchema>;

export const draftFormSchema = z.object({
  customerName: z.string().trim().min(2, 'Le nom du client doit contenir au moins 2 caractères.').max(120, 'Nom trop long (120 caractères maximum).'),
  customerEmail: z.string().trim().max(254, 'E-mail trop long.').refine((value) => value === '' || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value), 'Adresse e-mail invalide.'),
  customerPhone: optional(40, 'Téléphone'),
  billingAddress: optional(400, 'Adresse'),
  dueAt: z.string().refine((value) => value === '' || /^\d{4}-\d{2}-\d{2}$/.test(value), 'Date d’échéance invalide.'),
  notes: optional(500, 'Note'),
});
export type DraftFormInput = z.input<typeof draftFormSchema>;
export type DraftFormValues = z.output<typeof draftFormSchema>;

const MESSAGES: Record<string, string> = {
  FORBIDDEN: 'Action réservée aux administrateurs.',
  INVALID_REQUEST: 'La demande est incomplète. Actualisez la page puis réessayez.',
  ORDER_NOT_FOUND: 'Commande introuvable.',
  ORDER_CANCELLED: 'Cette commande est annulée : elle ne peut pas être facturée.',
  ORDER_HAS_NO_ITEMS: 'Cette commande n’a aucun article : impossible de la facturer.',
  TOTAL_MISMATCH: 'Les montants de la commande ne correspondent plus à la facture. Annulez le brouillon et recréez-le.',
  INVOICE_NOT_FOUND: 'Facture introuvable.',
  INVOICE_NOT_DRAFT: 'Cette facture n’est plus un brouillon : elle a déjà été émise ou annulée. Actualisez la page.',
  INVALID_TRANSITION: 'Ce changement d’état n’est pas autorisé : la facture a déjà été traitée. Actualisez la page.',
  COMPANY_SETTINGS_REQUIRED: 'Renseignez d’abord le nom de l’entreprise dans Paramètres > Entreprise et facturation : il est obligatoire pour émettre une facture.',
  PAYMENTS_EXIST: 'Des paiements confirmés sont rattachés à cette commande : contrepassez-les d’abord (Encaissements) avant d’annuler la facture.',
  REASON_REQUIRED: 'Indiquez un motif d’au moins 5 caractères.',
  INVALID_CUSTOMER: 'Les informations du client sont invalides (nom, e-mail, téléphone ou adresse).',
  INVALID_DATE: 'La date d’échéance ne peut pas être dans le passé.',
  INVALID_NOTE: 'La note est trop longue (500 caractères maximum).',
  INVOICE_IMMUTABLE: 'Une facture émise ne peut pas être modifiée.',
  INVOICE_DELETE_FORBIDDEN: 'Une facture ne peut jamais être supprimée.',
};
const GENERIC = 'L’opération n’a pas pu être confirmée. Actualisez la page pour vérifier l’état de la facture avant de réessayer : aucun doublon n’est possible.';

function describe(error: { code?: string; message?: string } | null): string {
  if (error?.code === '23505') return 'Une facture active existe déjà pour cette commande.';
  if (isInvoiceModuleMissing(error?.code ?? null)) return 'Le module de facturation n’est pas encore installé en base (migration-factures.sql).';
  return (error?.message && MESSAGES[error.message]) || GENERIC;
}

export type InvoiceSummaryResult = { id: string; number: string | null; status: string; alreadyExists: boolean };

function parseResult(data: unknown): InvoiceSummaryResult | null {
  if (!isRow(data)) return null;
  const id = toStr(data.id);
  const status = toStr(data.status);
  return id && status ? { id, number: toStr(data.number), status, alreadyExists: data.already_exists === true } : null;
}

async function call(name: string, args: Record<string, unknown>): Promise<MutationResult<InvoiceSummaryResult>> {
  const denied = await assertAdmin();
  if (denied) return { ok: false, message: denied };
  try {
    const { data, error } = await getSupabase().rpc(name, args);
    if (error) return { ok: false, message: describe(error) };
    const result = parseResult(data);
    return result ? { ok: true, data: result } : { ok: false, message: GENERIC };
  } catch {
    return { ok: false, message: GENERIC };
  }
}

export const createInvoiceDraft = (orderId: string) => call('create_invoice_draft', { p_order_id: orderId });
export const issueInvoice = (invoiceId: string) => call('issue_invoice', { p_invoice_id: invoiceId });
export const cancelInvoice = (invoiceId: string, reason: string) => call('cancel_invoice', { p_invoice_id: invoiceId, p_reason: reason.trim() });
export const updateInvoiceDraft = (invoiceId: string, values: DraftFormValues) =>
  call('update_invoice_draft', {
    p_invoice_id: invoiceId,
    p_customer_name: values.customerName,
    p_customer_email: values.customerEmail === '' ? null : values.customerEmail,
    p_customer_phone: values.customerPhone === '' ? null : values.customerPhone,
    p_billing_address: values.billingAddress === '' ? null : values.billingAddress,
    p_due_at: values.dueAt === '' ? null : values.dueAt,
    p_notes: values.notes === '' ? null : values.notes,
  });

export async function saveCompanySettings(values: CompanyFormValues): Promise<MutationResult> {
  const denied = await assertAdmin();
  if (denied) return { ok: false, message: denied };
  const nul = (value: string) => (value === '' ? null : value);
  try {
    const { data, error } = await getSupabase()
      .from('company_settings')
      .update({
        company_name: values.companyName,
        address: nul(values.address),
        phone: nul(values.phone),
        email: nul(values.email),
        tax_id: nul(values.taxId),
        rccm: nul(values.rccm),
        legal_notice: nul(values.legalNotice),
        payment_terms: nul(values.paymentTerms),
        due_days: values.dueDays === '' ? null : Number(values.dueDays),
      })
      .eq('id', true)
      .select('id');
    if (error) return { ok: false, message: describe(error) };
    // La RLS filtre sans erreur : zéro ligne = rien d'enregistré.
    if (!data || data.length === 0) return { ok: false, message: 'Aucune modification enregistrée : réglages introuvables ou droit refusé.' };
    return { ok: true, data: undefined };
  } catch {
    return { ok: false, message: GENERIC };
  }
}
