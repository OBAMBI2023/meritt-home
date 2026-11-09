import { assertAdmin, type MutationResult } from '@/lib/admin/products';
import { AdminQueryError } from '@/lib/admin/queries';
import { CUSTOM_REQUEST_BUCKET } from '@/lib/custom-requests';
import { getSupabase } from '@/lib/supabase/client';

/**
 * Administration des demandes « Création sur mesure » (tables custom_requests*, voir migration-sur-mesure.sql).
 * Lectures : session de l'administrateur, la RLS (`is_admin()`) est la barrière réelle.
 * Écritures : uniquement par les fonctions SQL admin_*, qui journalisent chaque changement.
 * Images : bucket privé, lues par URL signée (durée limitée) avec la session de l'administrateur.
 */

type Row = Record<string, unknown>;
const isRow = (value: unknown): value is Row => typeof value === 'object' && value !== null;
const toRows = (data: unknown): Row[] => (Array.isArray(data) ? data.filter(isRow) : []);
const toStr = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null);
const toInt = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);

function check(error: { code: string } | null): void {
  if (error) throw new AdminQueryError(error.code || null);
}

/** Codes renvoyés quand la migration n'est pas appliquée (table ou fonction absente). */
const MODULE_MISSING_CODES = ['42P01', '42883', 'PGRST205', 'PGRST202'];
export const isCustomModuleMissing = (code: string | null) => code !== null && MODULE_MISSING_CODES.includes(code);

export const STATUSES = ['new', 'in_review', 'info_needed', 'quote_preparing', 'quote_sent', 'accepted', 'refused', 'completed'] as const;
export type CustomStatus = (typeof STATUSES)[number];

export const STATUS_LABELS: Record<CustomStatus, string> = {
  new: 'Nouvelle demande',
  in_review: 'En étude',
  info_needed: 'Informations complémentaires requises',
  quote_preparing: 'Devis en préparation',
  quote_sent: 'Devis envoyé',
  accepted: 'Acceptée',
  refused: 'Refusée',
  completed: 'Terminée',
};

export const EVENT_LABELS: Record<string, string> = {
  created: 'Demande reçue',
  status_changed: 'Statut modifié',
  assigned: 'Responsable modifié',
  quote_set: 'Montant du devis modifié',
  converted: 'Convertie en commande',
};

const isStatus = (value: unknown): value is CustomStatus => typeof value === 'string' && (STATUSES as readonly string[]).includes(value);

export interface CustomRequestRow {
  id: string;
  reference: string;
  status: CustomStatus;
  createdAt: string;
  name: string;
  phone: string;
  email: string | null;
  commune: string | null;
  contact: string;
  projectType: string;
  source: string | null;
  referenceUrl: string | null;
  description: string;
  width: number | null;
  height: number | null;
  depth: number | null;
  materials: string | null;
  colors: string | null;
  finishes: string | null;
  quantity: number;
  constraints: string | null;
  budget: string;
  deadlineKind: string;
  deadlineDate: string | null;
  assignedTo: string | null;
  quoteAmount: number | null;
  convertedOrderId: string | null;
}

const COLUMNS =
  'id, reference, status, created_at, customer_name, customer_phone, customer_email, commune, preferred_contact, project_type, inspiration_source, reference_url, description, width_cm, height_cm, depth_cm, materials, colors, finishes, quantity, constraints_text, budget_range, deadline_kind, deadline_date, assigned_to, quote_amount_fcfa, converted_order_id';

function toRequest(row: Row): CustomRequestRow | null {
  const id = toStr(row.id);
  const reference = toStr(row.reference);
  const createdAt = toStr(row.created_at);
  const name = toStr(row.customer_name);
  const phone = toStr(row.customer_phone);
  const description = toStr(row.description);
  if (!id || !reference || !createdAt || !name || !phone || !description || !isStatus(row.status)) return null;
  return {
    id,
    reference,
    status: row.status,
    createdAt,
    name,
    phone,
    email: toStr(row.customer_email),
    commune: toStr(row.commune),
    contact: toStr(row.preferred_contact) ?? 'whatsapp',
    projectType: toStr(row.project_type) ?? 'other',
    source: toStr(row.inspiration_source),
    referenceUrl: toStr(row.reference_url),
    description,
    width: toInt(row.width_cm),
    height: toInt(row.height_cm),
    depth: toInt(row.depth_cm),
    materials: toStr(row.materials),
    colors: toStr(row.colors),
    finishes: toStr(row.finishes),
    quantity: toInt(row.quantity) ?? 1,
    constraints: toStr(row.constraints_text),
    budget: toStr(row.budget_range) ?? 'to_define',
    deadlineKind: toStr(row.deadline_kind) ?? 'none',
    deadlineDate: toStr(row.deadline_date),
    assignedTo: toStr(row.assigned_to),
    quoteAmount: toInt(row.quote_amount_fcfa),
    convertedOrderId: toStr(row.converted_order_id),
  };
}

export const LIST_LIMIT = 500;

export async function fetchCustomRequests(): Promise<{ requests: CustomRequestRow[]; truncated: boolean }> {
  const { data, error } = await getSupabase().from('custom_requests').select(COLUMNS).order('created_at', { ascending: false }).limit(LIST_LIMIT);
  check(error);
  const requests = toRows(data).flatMap((row) => {
    const parsed = toRequest(row);
    return parsed ? [parsed] : [];
  });
  return { requests, truncated: requests.length >= LIST_LIMIT };
}

/** Nombre de demandes au statut « Nouvelle demande » (compteur du tableau de bord). */
export async function fetchNewRequestCount(): Promise<number> {
  const { count, error } = await getSupabase().from('custom_requests').select('id', { count: 'exact', head: true }).eq('status', 'new');
  check(error);
  return count ?? 0;
}

export interface CustomImage {
  id: string;
  kind: 'inspiration' | 'space';
  mime: string;
  size: number;
  /** URL signée à durée limitée ; null si la génération a échoué. */
  url: string | null;
}

export interface CustomNote {
  id: string;
  kind: 'note' | 'exchange';
  body: string;
  author: string | null;
  createdAt: string;
}

export interface CustomEvent {
  id: string;
  event: string;
  from: string | null;
  to: string | null;
  actor: string | null;
  createdAt: string;
}

export interface CustomRequestDetail {
  request: CustomRequestRow;
  images: CustomImage[];
  notes: CustomNote[];
  events: CustomEvent[];
  orderReference: string | null;
}

const SIGNED_URL_SECONDS = 3600;

export async function fetchCustomRequestDetail(id: string): Promise<CustomRequestDetail | null> {
  const supabase = getSupabase();
  const { data, error } = await supabase.from('custom_requests').select(COLUMNS).eq('id', id).limit(1);
  check(error);
  const request = toRows(data).map(toRequest)[0] ?? null;
  if (!request) return null;

  const [images, notes, events, order] = await Promise.all([
    supabase.from('custom_request_images').select('id, kind, storage_path, mime_type, size_bytes').eq('request_id', id).order('created_at', { ascending: true }).limit(50),
    supabase.from('custom_request_notes').select('id, kind, body, author_email, created_at').eq('request_id', id).order('created_at', { ascending: false }).limit(200),
    supabase.from('custom_request_events').select('id, event, from_value, to_value, actor_email, created_at').eq('request_id', id).order('created_at', { ascending: false }).limit(200),
    request.convertedOrderId ? supabase.from('orders').select('reference').eq('id', request.convertedOrderId).limit(1) : Promise.resolve({ data: null, error: null }),
  ]);
  check(images.error);
  check(notes.error);
  check(events.error);

  const imageRows = toRows(images.data);
  const paths = imageRows.map((row) => toStr(row.storage_path)).filter((path): path is string => path !== null);
  const signed = new Map<string, string>();
  if (paths.length > 0) {
    const { data: urls } = await supabase.storage.from(CUSTOM_REQUEST_BUCKET).createSignedUrls(paths, SIGNED_URL_SECONDS);
    for (const entry of urls ?? []) if (entry.path && entry.signedUrl) signed.set(entry.path, entry.signedUrl);
  }

  return {
    request,
    images: imageRows.flatMap((row) => {
      const imageId = toStr(row.id);
      const path = toStr(row.storage_path);
      if (!imageId || !path) return [];
      return [{ id: imageId, kind: row.kind === 'space' ? ('space' as const) : ('inspiration' as const), mime: toStr(row.mime_type) ?? '', size: toInt(row.size_bytes) ?? 0, url: signed.get(path) ?? null }];
    }),
    notes: toRows(notes.data).flatMap((row) => {
      const noteId = toStr(row.id);
      const body = toStr(row.body);
      const createdAt = toStr(row.created_at);
      return noteId && body && createdAt ? [{ id: noteId, kind: row.kind === 'exchange' ? ('exchange' as const) : ('note' as const), body, author: toStr(row.author_email), createdAt }] : [];
    }),
    events: toRows(events.data).flatMap((row) => {
      const eventId = toStr(row.id);
      const event = toStr(row.event);
      const createdAt = toStr(row.created_at);
      return eventId && event && createdAt ? [{ id: eventId, event, from: toStr(row.from_value), to: toStr(row.to_value), actor: toStr(row.actor_email), createdAt }] : [];
    }),
    orderReference: toStr(toRows(order.data)[0]?.reference),
  };
}

/* ------------------------------------------------------------------ */
/* Écritures                                                           */
/* ------------------------------------------------------------------ */

const ERRORS: Record<string, string> = {
  NOT_ADMIN: 'Action réservée aux administrateurs.',
  NOT_FOUND: 'Cette demande n’existe plus.',
  INVALID_STATUS: 'Statut invalide.',
  INVALID_ASSIGNEE: 'Le nom du responsable est trop long (80 caractères maximum).',
  INVALID_QUOTE: 'Le montant du devis doit être compris entre 0 et 2 000 000 000 FCFA.',
  INVALID_KIND: 'Type de message invalide.',
  INVALID_BODY: 'Le message doit contenir entre 1 et 2 000 caractères.',
  INVALID_LABEL: 'Le libellé de la commande doit contenir entre 3 et 200 caractères.',
  ALREADY_CONVERTED: 'Cette demande a déjà été convertie en commande.',
  NOT_ACCEPTED: 'Seule une demande au statut « Acceptée » peut être convertie en commande.',
  NO_QUOTE: 'Renseignez d’abord le montant du devis (supérieur à 0) et enregistrez-le.',
};
const GENERIC = 'L’enregistrement a échoué. Vérifiez votre connexion puis réessayez.';

function describeError(error: { code?: string; message?: string }): string {
  if (isCustomModuleMissing(error.code ?? null)) return 'Le module n’est pas encore installé en base (migration-sur-mesure.sql).';
  return (error.message && ERRORS[error.message]) || GENERIC;
}

async function call<T>(name: string, args: Record<string, unknown>, parse: (data: unknown) => T): Promise<MutationResult<T>> {
  const denied = await assertAdmin();
  if (denied) return { ok: false, message: denied };
  try {
    const { data, error } = await getSupabase().rpc(name, args);
    if (error) return { ok: false, message: describeError(error) };
    return { ok: true, data: parse(data) };
  } catch {
    return { ok: false, message: GENERIC };
  }
}

export const updateRequest = (id: string, status: CustomStatus, assignedTo: string, quoteAmount: number | null) =>
  call('admin_update_custom_request', { p_request_id: id, p_status: status, p_assigned_to: assignedTo, p_quote_amount_fcfa: quoteAmount }, () => undefined);

export const addNote = (id: string, kind: 'note' | 'exchange', body: string) =>
  call('admin_add_custom_request_note', { p_request_id: id, p_kind: kind, p_body: body }, () => undefined);

export type ConversionResult = { orderId: string; orderReference: string };

export const convertToOrder = (id: string, label: string, commune: string, address: string) =>
  call<ConversionResult | null>('admin_convert_custom_request', { p_request_id: id, p_label: label, p_commune: commune, p_address: address }, (data) => {
    if (!isRow(data)) return null;
    const orderId = toStr(data.order_id);
    const orderReference = toStr(data.order_reference);
    return orderId && orderReference ? { orderId, orderReference } : null;
  });
