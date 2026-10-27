/**
 * Informations de marque et de contact de Meritt Home.
 * Source unique : seules les coordonnées déjà présentes dans le prototype sont utilisées.
 */
export const SITE = {
  name: 'Meritt Home',
  tagline: "L'art de vivre autrement",
  description:
    'Mobilier, décoration et pièces uniques pour créer un intérieur qui vous ressemble.',
  location: "Abidjan, Côte d'Ivoire",
  whatsappNumber: '2250708038429',
  whatsappDisplay: '+225 07 08 03 84 29',
  heroImage: '/4c86dea1212299c6342afcd620aa7177.jpg',
} as const;

/** Frais de livraison indicatifs, à confirmer avec le commerçant avant la mise en production. */
export const DELIVERY = {
  zone: 'Abidjan',
  fee: 10000,
  communes: [
    'Cocody',
    'Marcory',
    'Yopougon',
    'Abobo',
    'Plateau',
    'Adjamé',
    'Treichville',
    'Port-Bouët',
    'Koumassi',
    'Bingerville',
    'Anyama',
  ],
} as const;

/** Seul mode de paiement ouvert pour l'instant ; correspond à la valeur `cash_on_delivery` de la base. */
export const PAYMENT_METHOD = {
  id: 'cash_on_delivery',
  label: 'Paiement à la livraison',
} as const;

export function whatsappLink(message: string): string {
  return `https://wa.me/${SITE.whatsappNumber}?text=${encodeURIComponent(message)}`;
}
