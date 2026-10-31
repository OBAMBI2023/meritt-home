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

const pexels = (id: number) => `https://images.pexels.com/photos/${id}/pexels-photo-${id}.jpeg?auto=compress&cs=tinysrgb&w=900`;

/** Contenu éditorial de l'accueil (bannière promo et inspirations). */
export const PROMO = {
  eyebrow: 'LE MOMENT IDÉAL POUR CHANGER',
  title: "Jusqu'à",
  highlight: '-30%',
  subtitle: 'sur notre sélection salon',
  text: 'Donnez une nouvelle dimension à votre intérieur.',
  button: "Profiter de l'offre",
  orbit: 'OFFRE LIMITÉE',
  image: pexels(27459712),
} as const;

export const COLLECTIONS = [
  { title: 'Salon contemporain', subtitle: 'Lignes douces, esprit affirmé', image: pexels(27459712) },
  { title: 'Minimalisme naturel', subtitle: 'Le beau dans la simplicité', image: pexels(36363110) },
  { title: 'Élégance africaine', subtitle: 'Des matières qui racontent', image: pexels(36777970) },
] as const;

/* Les zones de livraison et leurs tarifs ne sont pas définis ici : ils viennent de la table `delivery_fees` (voir lib/orders.ts). */

/** Seul mode de paiement ouvert pour l'instant ; correspond à la valeur `cash_on_delivery` de la base. */
export const PAYMENT_METHOD = {
  id: 'cash_on_delivery',
  label: 'Paiement à la livraison',
} as const;

export function whatsappLink(message: string): string {
  return `https://wa.me/${SITE.whatsappNumber}?text=${encodeURIComponent(message)}`;
}
