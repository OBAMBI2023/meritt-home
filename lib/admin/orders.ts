import { assertAdmin, type MutationResult } from '@/lib/admin/products';
import { getSupabase } from '@/lib/supabase/client';

/**
 * Changement de statut d'une commande : uniquement via la fonction SQL `admin_set_order_status`,
 * qui impose les transitions, réserve l'action aux administrateurs et restitue le stock à l'annulation.
 * Aucun statut de paiement n'est modifiable ici : aucune commande n'est marquée payée.
 */

export type OrderMode = 'delivery' | 'pickup';

/** Miroir de la matrice appliquée par la base (la base reste l'autorité). */
export function nextStatuses(mode: OrderMode, status: string): string[] {
  const delivery: Record<string, string[]> = {
    pending: ['confirmed', 'cancelled'],
    confirmed: ['preparing', 'cancelled'],
    preparing: ['shipped', 'cancelled'],
    shipped: ['delivered'],
  };
  const pickup: Record<string, string[]> = {
    pending: ['confirmed', 'cancelled'],
    confirmed: ['preparing', 'cancelled'],
    preparing: ['ready_for_pickup', 'cancelled'],
    ready_for_pickup: ['delivered', 'cancelled'],
  };
  return (mode === 'pickup' ? pickup : delivery)[status] ?? [];
}

const MESSAGES: Record<string, string> = {
  FORBIDDEN: 'Action réservée aux administrateurs.',
  ORDER_NOT_FOUND: 'Commande introuvable.',
  INVALID_TRANSITION: 'Ce changement de statut n’est pas autorisé pour cette commande. Actualisez la liste.',
};

/**
 * Unités de stock concernées par un changement de statut, renvoyées par la base (migration-historique-annulation.sql).
 * `null` : la base n'a pas cette migration ; aucune affirmation n'est alors faite sur le stock.
 */
export interface StatusChange {
  stockToRestore: number | null;
  stockRestored: number | null;
}

const unitCount = (value: unknown): number | null => (typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null);

/** Message exact après une annulation, selon ce que la base a réellement restitué. */
export function cancellationMessage(change: StatusChange): { level: 'success' | 'warning'; text: string } {
  const { stockToRestore, stockRestored } = change;
  if (stockToRestore === null || stockRestored === null) return { level: 'success', text: 'Commande annulée.' };
  if (stockToRestore === 0) return { level: 'success', text: 'Commande annulée. Aucun stock suivi à restituer.' };
  if (stockRestored === stockToRestore) {
    return { level: 'success', text: `Commande annulée. Stock restitué : ${stockRestored} unité${stockRestored > 1 ? 's' : ''}.` };
  }
  const missing = stockToRestore - stockRestored;
  return {
    level: 'warning',
    text: `Commande annulée, mais ${missing} unité${missing > 1 ? 's' : ''} n’${missing > 1 ? 'ont' : 'a'} pas pu être remise${missing > 1 ? 's' : ''} en stock (ligne de stock absente ou non renseignée). Vérifiez la section Stocks.`,
  };
}

export async function setOrderStatus(orderId: string, status: string): Promise<MutationResult<StatusChange>> {
  const denied = await assertAdmin();
  if (denied) return { ok: false, message: denied };
  try {
    const { data, error } = await getSupabase().rpc('admin_set_order_status', { p_order_id: orderId, p_new_status: status });
    if (error) return { ok: false, message: MESSAGES[error.message] ?? 'Le statut n’a pas pu être modifié. Réessayez.' };
    const row = typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : {};
    return { ok: true, data: { stockToRestore: unitCount(row.stock_units_to_restore), stockRestored: unitCount(row.stock_units_restored) } };
  } catch {
    return { ok: false, message: 'Le statut n’a pas pu être modifié. Vérifiez votre connexion puis réessayez.' };
  }
}
