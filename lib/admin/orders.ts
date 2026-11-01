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

export async function setOrderStatus(orderId: string, status: string): Promise<MutationResult> {
  const denied = await assertAdmin();
  if (denied) return { ok: false, message: denied };
  try {
    const { error } = await getSupabase().rpc('admin_set_order_status', { p_order_id: orderId, p_new_status: status });
    if (error) return { ok: false, message: MESSAGES[error.message] ?? 'Le statut n’a pas pu être modifié. Réessayez.' };
    return { ok: true, data: undefined };
  } catch {
    return { ok: false, message: 'Le statut n’a pas pu être modifié. Vérifiez votre connexion puis réessayez.' };
  }
}
