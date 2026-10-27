'use client';

import { useMemo, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  BarChart3,
  Bell,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Check,
  ClipboardList,
  CreditCard,
  DollarSign,
  Heart,
  Home as HomeIcon,
  LayoutGrid,
  Menu,
  MessageCircle,
  Minus,
  MoreHorizontal,
  PackageCheck,
  Plus,
  Search,
  Smartphone,
  ShoppingBag,
  SlidersHorizontal,
  Settings,
  ShieldCheck,
  Sparkles,
  Star,
  Store,
  Tag,
  Truck,
  UserRound,
  Users,
  X,
} from 'lucide-react';

type Product = {
  id: number;
  name: string;
  category: string;
  price: number;
  oldPrice?: number;
  rating: number;
  reviews: number;
  image: string;
  tag?: string;
};

type NavItem = 'home' | 'shop' | 'cart' | 'favorites' | 'account';

const images = {
  hero: 'https://images.pexels.com/photos/5997978/pexels-photo-5997978.jpeg?auto=compress&cs=tinysrgb&h=650&w=940',
  heroMain: 'https://images.pexels.com/photos/7973750/pexels-photo-7973750.jpeg?auto=compress&cs=tinysrgb&h=650&w=940',
  greenRoom: 'https://images.pexels.com/photos/27459712/pexels-photo-27459712.jpeg?auto=compress&cs=tinysrgb&h=650&w=940',
  lounge: 'https://images.pexels.com/photos/6580396/pexels-photo-6580396.jpeg?auto=compress&cs=tinysrgb&h=650&w=940',
  warmRoom: 'https://images.pexels.com/photos/36363110/pexels-photo-36363110.jpeg?auto=compress&cs=tinysrgb&h=650&w=940',
  curated: 'https://images.pexels.com/photos/36777970/pexels-photo-36777970.jpeg?auto=compress&cs=tinysrgb&h=650&w=940',
};

const products: Product[] = [
  { id: 1, name: 'Canapé Oslo', category: 'Salon', price: 450000, oldPrice: 520000, rating: 4.9, reviews: 18, image: images.greenRoom, tag: 'Bestseller' },
  { id: 2, name: 'Fauteuil Lounge', category: 'Mobilier', price: 185000, oldPrice: 225000, rating: 4.8, reviews: 24, image: images.lounge, tag: 'Nouveau' },
  { id: 3, name: 'Table basse Teck', category: 'Tables', price: 150000, rating: 4.7, reviews: 12, image: images.warmRoom },
  { id: 4, name: 'Table à manger Nature', category: 'Salle à manger', price: 550000, rating: 4.9, reviews: 9, image: images.hero },
  { id: 5, name: 'Chaise contemporaine', category: 'Chaises', price: 75000, oldPrice: 90000, rating: 4.6, reviews: 31, image: images.lounge },
  { id: 6, name: 'Meuble TV Premium', category: 'Rangements', price: 280000, rating: 4.8, reviews: 15, image: images.curated },
  { id: 7, name: 'Tapis berbère', category: 'Décoration', price: 120000, rating: 4.7, reviews: 21, image: images.warmRoom, tag: 'Nouveau' },
  { id: 8, name: 'Lampe design', category: 'Éclairage', price: 65000, rating: 4.5, reviews: 8, image: images.hero },
];

const categories = [
  { name: 'Salon', count: '48 produits', image: images.greenRoom },
  { name: 'Chambre', count: '32 produits', image: images.warmRoom },
  { name: 'Décoration', count: '76 produits', image: images.curated },
  { name: 'Tables', count: '24 produits', image: images.hero },
  { name: 'Éclairage', count: '18 produits', image: images.lounge },
];

const collections = [
  { title: 'Salon contemporain', subtitle: 'Lignes douces, esprit affirmé', image: images.greenRoom },
  { title: 'Minimalisme naturel', subtitle: 'Le beau dans la simplicité', image: images.warmRoom },
  { title: 'Élégance africaine', subtitle: 'Des matières qui racontent', image: images.curated },
];

const formatPrice = (price: number) => `${price.toLocaleString('fr-FR')} FCFA`;

function Logo() {
  return (
    <div className="brand-mark" aria-label="Meritt Home">
      <span>MERITT</span>
      <small>HOME</small>
    </div>
  );
}

function ProductCard({ product, favorite, onFavorite, onAdd, onOpen }: { product: Product; favorite: boolean; onFavorite: () => void; onAdd: () => void; onOpen: () => void }) {
  return (
    <article className="product-card">
      <button className={`favorite-button ${favorite ? 'is-favorite' : ''}`} onClick={onFavorite} aria-label="Ajouter aux favoris">
        <Heart size={17} fill={favorite ? 'currentColor' : 'none'} />
      </button>
      {product.tag && <span className="product-tag">{product.tag}</span>}
      <button className="product-image-wrap" onClick={onOpen} aria-label={`Voir ${product.name}`}>
        <img src={product.image} alt={product.name} className="product-image" />
      </button>
      <div className="product-info">
        <div className="product-meta"><span>{product.category}</span><span className="rating"><Star size={12} fill="currentColor" /> {product.rating}</span></div>
        <button className="product-name" onClick={onOpen}>{product.name}</button>
        <div className="price-row"><strong>{formatPrice(product.price)}</strong>{product.oldPrice && <del>{formatPrice(product.oldPrice)}</del>}</div>
        <button className="add-button" onClick={onAdd}>Ajouter au panier <Plus size={15} /></button>
      </div>
    </article>
  );
}

function BottomNavigation({ active, cartCount, onChange }: { active: NavItem; cartCount: number; onChange: (item: NavItem) => void }) {
  const items: { id: NavItem; label: string; icon: typeof HomeIcon }[] = [
    { id: 'home', label: 'Accueil', icon: HomeIcon },
    { id: 'shop', label: 'Catalogue', icon: LayoutGrid },
    { id: 'cart', label: 'Panier', icon: ShoppingBag },
    { id: 'favorites', label: 'Favoris', icon: Heart },
    { id: 'account', label: 'Profil', icon: UserRound },
  ];
  return <nav className="bottom-nav">{items.map(({ id, label, icon: Icon }) => <button key={id} className={active === id ? 'active' : ''} onClick={() => onChange(id)}><span className="nav-icon"><Icon size={19} fill={active === id && id === 'home' ? 'currentColor' : 'none'} />{id === 'cart' && cartCount > 0 && <b>{cartCount}</b>}</span><small>{label}</small></button>)}</nav>;
}

function CartPanel({ cart, onClose, onUpdate, onCheckout }: { cart: Product[]; onClose: () => void; onUpdate: (id: number, delta: number) => void; onCheckout: () => void }) {
  const grouped = cart.reduce<{ product: Product; quantity: number }[]>((items, product) => {
    const found = items.find((item) => item.product.id === product.id);
    if (found) found.quantity += 1;
    else items.push({ product, quantity: 1 });
    return items;
  }, []);
  const subtotal = cart.reduce((sum, product) => sum + product.price, 0);
  return <div className="cart-overlay" role="dialog" aria-modal="true">
    <div className="cart-backdrop" onClick={onClose} />
    <aside className="cart-panel">
      <div className="panel-heading"><div><span className="eyebrow">Meritt Home</span><h2>Mon panier <em>{cart.length} article{cart.length > 1 ? 's' : ''}</em></h2></div><button className="icon-button" onClick={onClose} aria-label="Fermer"><X size={20} /></button></div>
      {grouped.length === 0 ? <div className="empty-state"><ShoppingBag size={36} /><h3>Votre panier est vide</h3><p>Ajoutez une pièce qui vous ressemble.</p><button className="primary-button" onClick={onClose}>Découvrir la collection</button></div> : <>
        <div className="cart-items">{grouped.map(({ product, quantity }) => <div className="cart-item" key={product.id}><img src={product.image} alt={product.name} /><div className="cart-item-content"><div><strong>{product.name}</strong><span>{product.category} · Collection naturelle</span></div><b>{formatPrice(product.price)}</b><div className="quantity"><button onClick={() => onUpdate(product.id, -1)}><Minus size={13} /></button><span>{quantity}</span><button onClick={() => onUpdate(product.id, 1)}><Plus size={13} /></button></div></div></div>)}</div>
        <div className="promo-input"><input placeholder="Code promo" /><button>Appliquer</button></div>
        <div className="cart-summary"><div><span>Sous-total</span><b>{formatPrice(subtotal)}</b></div><div><span>Livraison à Abidjan</span><b>10 000 FCFA</b></div><div className="summary-total"><span>Total</span><b>{formatPrice(subtotal + 10000)}</b></div></div>
        <button className="primary-button checkout-button" onClick={onCheckout}>Passer la commande <ArrowRight size={17} /></button>
      </>}
    </aside>
  </div>;
}

function CheckoutPanel({ cart, onClose, onComplete }: { cart: Product[]; onClose: () => void; onComplete: (orderId: string) => void }) {
  const [step, setStep] = useState(1);
  const [submitted, setSubmitted] = useState(false);
  const [orderId, setOrderId] = useState('');
  const [form, setForm] = useState({ firstName: '', lastName: '', phone: '', email: '', commune: 'Cocody', address: '', instructions: '', payment: 'Orange Money' });
  const [error, setError] = useState('');
  const subtotal = cart.reduce((sum, product) => sum + product.price, 0);
  const total = subtotal + 10000;
  const updateField = (field: keyof typeof form, value: string) => setForm((current) => ({ ...current, [field]: value }));
  const nextStep = () => {
    if (step === 1 && (!form.firstName.trim() || !form.lastName.trim() || !form.phone.trim() || !form.email.trim())) { setError('Renseignez vos coordonnées pour continuer.'); return; }
    if (step === 2 && !form.address.trim()) { setError('Indiquez votre adresse de livraison.'); return; }
    setError('');
    if (step < 3) setStep((current) => current + 1);
    else { setOrderId(`MR-${new Date().getFullYear()}-${Math.floor(10000 + Math.random() * 89999)}`); setSubmitted(true); }
  };
  if (submitted) return <div className="checkout-overlay"><div className="confirmation-card"><div className="confirmation-icon"><Check size={30} /></div><span className="eyebrow">Commande confirmée</span><h2>Merci {form.firstName}, votre intérieur prend forme.</h2><p>Votre commande est bien enregistrée. Nous vous contacterons au <strong>{form.phone}</strong> pour confirmer la livraison à {form.commune}.</p><div className="confirmation-detail"><span>Total réglé à la livraison</span><strong>{formatPrice(total)}</strong></div><button className="primary-button" onClick={() => { onComplete(orderId); onClose(); }}>Retourner à l'accueil <ArrowRight size={17} /></button></div></div>;
  return <div className="checkout-overlay"><div className="checkout-card"><header className="checkout-header"><button className="back-button" onClick={step === 1 ? onClose : () => setStep((current) => current - 1)}><ArrowLeft size={18} /></button><div><span className="eyebrow">Meritt Home</span><h2>Finaliser ma commande</h2></div><button className="icon-button" onClick={onClose}><X size={18} /></button></header><div className="checkout-steps">{['Coordonnées', 'Livraison', 'Paiement'].map((label, index) => <div className={`checkout-step ${step >= index + 1 ? 'active' : ''}`} key={label}><span>{step > index + 1 ? <Check size={13} /> : index + 1}</span><small>{label}</small></div>)}</div><div className="checkout-body"><div className="checkout-form"><span className="eyebrow">Étape {step} sur 3</span>{step === 1 && <><h3>Parlez-nous de vous</h3><p className="form-intro">Ces informations nous permettront de vous tenir au courant.</p><div className="form-grid"><label>Prénom<input value={form.firstName} onChange={(event) => updateField('firstName', event.target.value)} placeholder="Aminata" /></label><label>Nom<input value={form.lastName} onChange={(event) => updateField('lastName', event.target.value)} placeholder="Koné" /></label><label>Téléphone<input value={form.phone} onChange={(event) => updateField('phone', event.target.value)} placeholder="07 07 07 07 07" /></label><label>Email<input type="email" value={form.email} onChange={(event) => updateField('email', event.target.value)} placeholder="vous@email.com" /></label></div></>}{step === 2 && <><h3>Où souhaitez-vous être livré ?</h3><p className="form-intro">Livraison à Abidjan sous 2 à 5 jours ouvrés.</p><label>Commune<select value={form.commune} onChange={(event) => updateField('commune', event.target.value)}>{['Cocody', 'Marcory', 'Yopougon', 'Abobo', 'Plateau', 'Adjamé', 'Treichville', 'Port-Bouët', 'Koumassi', 'Bingerville', 'Anyama'].map((commune) => <option key={commune}>{commune}</option>)}</select></label><label>Adresse complète<textarea value={form.address} onChange={(event) => updateField('address', event.target.value)} placeholder="Rue, quartier, repère..." rows={3} /></label><label>Instructions de livraison <span className="optional">Optionnel</span><textarea value={form.instructions} onChange={(event) => updateField('instructions', event.target.value)} placeholder="Ex : appeler avant d'arriver" rows={2} /></label></>}{step === 3 && <><h3>Choisissez votre paiement</h3><p className="form-intro">Un paiement simple et sécurisé, adapté à Abidjan.</p><div className="payment-options">{[{ name: 'Orange Money', icon: Smartphone }, { name: 'MTN Mobile Money', icon: Smartphone }, { name: 'Wave', icon: Smartphone }, { name: 'Carte bancaire', icon: CreditCard }, { name: 'Paiement à la livraison', icon: Truck }].map(({ name, icon: Icon }) => <button key={name} className={form.payment === name ? 'selected' : ''} onClick={() => updateField('payment', name)}><Icon size={19} /><span>{name}</span>{form.payment === name && <Check size={15} />}</button>)}</div></>}{error && <p className="form-error">{error}</p>}<button className="primary-button continue-button" onClick={nextStep}>{step === 3 ? 'Confirmer la commande' : 'Continuer'} <ArrowRight size={17} /></button></div><aside className="checkout-summary"><span className="eyebrow">Votre sélection</span><h3>Résumé</h3><div className="checkout-summary-items">{cart.slice(0, 3).map((product) => <div key={product.id}><img src={product.image} alt={product.name} /><span>{product.name}<small>{formatPrice(product.price)}</small></span></div>)}</div><div className="checkout-summary-lines"><div><span>Sous-total</span><b>{formatPrice(subtotal)}</b></div><div><span>Livraison</span><b>10 000 FCFA</b></div><div className="summary-total"><span>Total</span><b>{formatPrice(total)}</b></div></div></aside></div></div></div>;
}

function AdminDashboard({ onClose }: { onClose: () => void }) {
  const [module, setModule] = useState('dashboard');
  const modules: { id: string; label: string; icon: typeof BarChart3 }[] = [
    { id: 'dashboard', label: 'Vue d’ensemble', icon: BarChart3 },
    { id: 'orders', label: 'Commandes', icon: ClipboardList },
    { id: 'products', label: 'Produits', icon: PackageCheck },
    { id: 'categories', label: 'Catégories', icon: PackageCheck },
    { id: 'vendors', label: 'Vendeurs', icon: Store },
    { id: 'customers', label: 'Clients', icon: Users },
    { id: 'promotions', label: 'Promotions', icon: Tag },
    { id: 'payments', label: 'Paiements', icon: DollarSign },
    { id: 'settings', label: 'Paramètres', icon: Settings },
  ];
  const activeModule = modules.find((item) => item.id === module) ?? modules[0];
  const rows = module === 'orders' ? [['#MR-2026-00821', 'Aminata Koné', '450 000 FCFA', 'En préparation'], ['#MR-2026-00820', 'Koffi Yao', '185 000 FCFA', 'Confirmée'], ['#MR-2026-00819', 'Nadia Bamba', '730 000 FCFA', 'Livrée'], ['#MR-2026-00818', 'Moussa Traoré', '280 000 FCFA', 'En livraison']] : [['Canapé Oslo', 'Salon', '24', '450 000 FCFA'], ['Fauteuil Lounge', 'Mobilier', '18', '185 000 FCFA'], ['Table basse Teck', 'Tables', '12', '150 000 FCFA'], ['Meuble TV Premium', 'Rangements', '9', '280 000 FCFA']];
  return <div className="admin-overlay"><div className="admin-layout"><aside className="admin-sidebar"><div className="admin-brand"><Logo /><span>ADMIN</span></div><div className="admin-workspace"><span className="admin-workspace-dot" /><div><strong>Meritt Home</strong><small>Administration</small></div><ChevronDown size={15} /></div><nav className="admin-nav">{modules.map(({ id, label, icon: Icon }) => <button key={id} className={module === id ? 'active' : ''} onClick={() => setModule(id)}><Icon size={17} /><span>{label}</span>{id === 'orders' && <b>12</b>}</button>)}</nav><div className="admin-sidebar-foot"><div className="admin-security"><ShieldCheck size={17} /><span><strong>Mode démo</strong><small>Aucune donnée réelle</small></span></div><button onClick={onClose}><ArrowLeft size={16} /> Retour à la boutique</button></div></aside><main className="admin-main"><header className="admin-header"><button className="admin-mobile-menu" aria-label="Menu"><Menu size={19} /></button><div><span className="eyebrow">Administration · 12 octobre 2026</span><h1>{activeModule.label}</h1></div><div className="admin-header-actions"><div className="admin-search"><Search size={16} /><input placeholder="Rechercher..." /></div><button className="circle-action"><Bell size={17} /></button><div className="admin-avatar">AK</div></div></header>{module === 'dashboard' ? <><section className="admin-welcome"><div><span className="eyebrow">Bonjour Aïcha</span><h2>Votre activité en un coup d’œil.</h2><p>Voici ce qui se passe sur Meritt Home aujourd’hui.</p></div><button className="admin-primary"><Plus size={16} /> Ajouter un produit</button></section><section className="admin-stats"><div className="admin-stat"><span className="stat-icon green"><DollarSign size={18} /></span><small>Chiffre d’affaires</small><strong>8 420 000 FCFA</strong><em>+18,4% ce mois-ci</em></div><div className="admin-stat"><span className="stat-icon beige"><ClipboardList size={18} /></span><small>Commandes</small><strong>128</strong><em>+12,8% ce mois-ci</em></div><div className="admin-stat"><span className="stat-icon orange"><Users size={18} /></span><small>Clients actifs</small><strong>1 842</strong><em>+9,6% ce mois-ci</em></div><div className="admin-stat"><span className="stat-icon blue"><Store size={18} /></span><small>Produits en ligne</small><strong>46</strong><em>+4 ajoutés</em></div></section><section className="admin-dashboard-grid"><div className="admin-panel sales-panel"><div className="admin-panel-heading"><div><span className="eyebrow">Performance</span><h3>Ventes sur les 7 derniers jours</h3></div><button className="admin-select">Cette semaine <ChevronDown size={14} /></button></div><div className="sales-chart"><div className="chart-y"><span>2M</span><span>1.5M</span><span>1M</span><span>0.5M</span><span>0</span></div><div className="chart-area">{[42, 58, 48, 78, 63, 90, 72].map((height, index) => <div className="chart-column" key={index}><div className="chart-bar" style={{ height: `${height}%` }} /><span>{['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'][index]}</span></div>)}</div></div></div><div className="admin-panel channel-panel"><div className="admin-panel-heading"><div><span className="eyebrow">Répartition</span><h3>Canaux de vente</h3></div><MoreHorizontal size={17} color="#8e9993" /></div><div className="donut-wrap"><div className="donut"><strong>8,4M</strong><small>FCFA</small></div><div className="donut-legend"><span><i className="dot green-dot" />Site web <b>62%</b></span><span><i className="dot beige-dot" />Instagram <b>24%</b></span><span><i className="dot gray-dot" />Boutique <b>14%</b></span></div></div></div></section><section className="admin-panel admin-table-panel"><div className="admin-panel-heading"><div><span className="eyebrow">Suivi opérationnel</span><h3>Dernières commandes</h3></div><button className="admin-link" onClick={() => setModule('orders')}>Voir toutes <ArrowRight size={14} /></button></div><div className="admin-table"><div className="table-head"><span>Commande</span><span>Client</span><span>Montant</span><span>Statut</span><span /></div>{[['#MR-2026-00821', 'Aminata Koné', '450 000 FCFA', 'En préparation'], ['#MR-2026-00820', 'Koffi Yao', '185 000 FCFA', 'Confirmée'], ['#MR-2026-00819', 'Nadia Bamba', '730 000 FCFA', 'Livrée']].map((row) => <div className="table-row" key={row[0]}><strong>{row[0]}</strong><span>{row[1]}</span><span>{row[2]}</span><em className={`status status-${row[3].replace(' ', '-').toLowerCase()}`}>{row[3]}</em><MoreHorizontal size={16} /></div>)}</div></section></> : <section className="admin-module-page"><div className="admin-module-intro"><div><span className="eyebrow">Module administrateur</span><h2>Gérez votre {activeModule.label.toLowerCase()}.</h2><p>Cette vue de démonstration est prête à accueillir vos données Meritt Home.</p></div><button className="admin-primary"><Plus size={16} /> {module === 'orders' ? 'Nouvelle commande' : 'Ajouter'}</button></div><div className="admin-panel admin-table-panel"><div className="admin-panel-heading"><div><span className="eyebrow">Données récentes</span><h3>{module === 'orders' ? 'Commandes récentes' : 'Éléments populaires'}</h3></div><button className="admin-select">Exporter <ChevronDown size={14} /></button></div><div className="admin-table"><div className="table-head"><span>{module === 'orders' ? 'Référence' : 'Nom'}</span><span>{module === 'orders' ? 'Client' : 'Catégorie'}</span><span>{module === 'orders' ? 'Montant' : 'Stock'}</span><span>{module === 'orders' ? 'Statut' : 'Valeur'}</span><span /></div>{rows.map((row) => <div className="table-row" key={row[0]}><strong>{row[0]}</strong><span>{row[1]}</span><span>{row[2]}</span><em className={module === 'orders' ? 'status status-confirmée' : 'admin-value'}>{row[3]}</em><MoreHorizontal size={16} /></div>)}</div></div></section>}</main></div></div>;
}

export default function Home() {
  const [activeNav, setActiveNav] = useState<NavItem>('home');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('Tous');
  const [favorites, setFavorites] = useState<number[]>([2]);
  const [cart, setCart] = useState<Product[]>([products[0]]);
  const [cartOpen, setCartOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [notice, setNotice] = useState('');
  const [adminOpen, setAdminOpen] = useState(false);

  const filteredProducts = useMemo(() => products.filter((product) => {
    const matchesCategory = category === 'Tous' || product.category === category || (category === 'Canapés' && product.name.includes('Canapé'));
    const normalizedQuery = query.trim().toLowerCase();
    return matchesCategory && (!normalizedQuery || `${product.name} ${product.category}`.toLowerCase().includes(normalizedQuery));
  }), [category, query]);

  const addToCart = (product: Product) => {
    setCart((current) => [...current, product]);
    setNotice(`${product.name} ajouté au panier`);
    window.setTimeout(() => setNotice(''), 2600);
  };

  const toggleFavorite = (id: number) => setFavorites((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  const updateCart = (id: number, delta: number) => setCart((current) => { const index = current.findIndex((product) => product.id === id); if (delta < 0 && index >= 0) return [...current.slice(0, index), ...current.slice(index + 1)]; const product = products.find((item) => item.id === id); return product ? [...current, product] : current; });
  const changeNav = (item: NavItem) => { if (item === 'cart') setCartOpen(true); else setActiveNav(item); };
  const completeOrder = (orderId: string) => { setCart([]); setCheckoutOpen(false); setNotice(`Commande ${orderId} confirmée`); window.setTimeout(() => setNotice(''), 3200); };

  return <main className="app-shell">
    <header className="topbar"><Logo /><div className="desktop-links"><button className="active">Accueil</button><button onClick={() => setActiveNav('shop')}>Catalogue</button><button>Inspirations</button><button>À propos</button><button className="admin-entry" onClick={() => setAdminOpen(true)}><ShieldCheck size={14} /> Admin</button></div><div className="top-actions"><button className="circle-action notification-action" aria-label="Notifications"><Bell size={19} /><i /></button><button className="circle-action cart-action" aria-label="Panier" onClick={() => setCartOpen(true)}><ShoppingBag size={19} />{cart.length > 0 && <b>{cart.length}</b>}</button><button className="account-chip" onClick={() => setActiveNav('account')}><span>AK</span><ChevronDown size={14} /></button></div></header>

    <section className="hero-section">
      <div className="hero-copy"><span className="eyebrow"><Sparkles size={13} /> L'art de vivre autrement</span><h1>Sublimez votre <span>intérieur.</span></h1><p>Découvrez du mobilier, de la décoration et des pièces uniques pour créer un intérieur qui vous ressemble.</p><button className="primary-button" onClick={() => document.getElementById('products')?.scrollIntoView({ behavior: 'smooth' })}>Découvrir la collection <ArrowRight size={17} /></button><div className="hero-proof"><div className="avatar-stack"><span>AM</span><span>KB</span><span>YS</span></div><span><strong>+2 000</strong> intérieurs inspirés</span></div></div>
      <div className="hero-visual"><img src="/4c86dea1212299c6342afcd620aa7177.jpg" alt="Salon chaleureux Meritt Home" /><div className="hero-floating-card"><span>Collection</span><strong>Éclat naturel</strong><small>Pièces choisies avec soin <ArrowRight size={13} /></small></div><div className="hero-stamp">Depuis<br /><strong>2026</strong></div></div>
    </section>

    <section className="search-section"><div className="search-field"><Search size={19} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Rechercher un meuble, une décoration..." /><kbd>⌘ K</kbd></div><button className="filter-button"><SlidersHorizontal size={18} /><span>Filtres</span></button></section>

    <section className="section-block category-section"><div className="section-heading"><div><span className="eyebrow">Trouvez votre style</span><h2>Explorer par catégorie</h2></div><button className="text-button" onClick={() => setActiveNav('shop')}>Voir tout <ArrowRight size={15} /></button></div><div className="category-scroll">{categories.map((item) => <button key={item.name} className="category-card" onClick={() => { setCategory(item.name); document.getElementById('products')?.scrollIntoView({ behavior: 'smooth' }); }}><img src={item.image} alt={item.name} /><span><strong>{item.name}</strong><small>{item.count}</small></span><ChevronRight size={17} /></button>)}</div></section>

    <section className="section-block" id="products"><div className="section-heading"><div><span className="eyebrow">La sélection du moment</span><h2>Nos incontournables</h2></div><button className="text-button" onClick={() => setActiveNav('shop')}>Voir tout <ArrowRight size={15} /></button></div><div className="filter-tabs">{['Tous', 'Canapés', 'Fauteuils', 'Tables', 'Chaises', 'Décoration', 'Éclairage'].map((item) => <button key={item} className={category === item ? 'active' : ''} onClick={() => setCategory(item)}>{item}</button>)}</div>{filteredProducts.length ? <div className="product-grid">{filteredProducts.slice(0, 4).map((product) => <ProductCard key={product.id} product={product} favorite={favorites.includes(product.id)} onFavorite={() => toggleFavorite(product.id)} onAdd={() => addToCart(product)} onOpen={() => setSelectedProduct(product)} />)}</div> : <div className="inline-empty"><Search size={24} /><strong>Aucune pièce trouvée</strong><span>Essayez une autre recherche ou catégorie.</span></div>}</section>

    <section className="promo-banner"><div className="promo-copy"><span className="eyebrow">Le moment idéal pour changer</span><h2>Jusqu'à <strong>-30%</strong><br />sur notre sélection salon</h2><p>Donnez une nouvelle dimension à votre intérieur.</p><button className="light-button">Profiter de l'offre <ArrowRight size={16} /></button></div><img src={images.lounge} alt="Sélection salon en promotion" /><div className="promo-orbit">OFFRE<br /><strong>LIMITÉE</strong></div></section>

    <section className="section-block"><div className="section-heading"><div><span className="eyebrow">Tout juste arrivées</span><h2>Nouveautés</h2></div><button className="text-button">Voir tout <ArrowRight size={15} /></button></div><div className="product-grid">{products.slice(4, 8).map((product) => <ProductCard key={product.id} product={product} favorite={favorites.includes(product.id)} onFavorite={() => toggleFavorite(product.id)} onAdd={() => addToCart(product)} onOpen={() => setSelectedProduct(product)} />)}</div></section>

    <section className="section-block collections-section"><div className="section-heading"><div><span className="eyebrow">Laissez-vous guider</span><h2>Inspirations Meritt Home</h2></div><div className="carousel-actions"><button aria-label="Précédent"><ChevronLeft size={17} /></button><button aria-label="Suivant"><ChevronRight size={17} /></button></div></div><div className="collections-grid">{collections.map((item) => <button className="collection-card" key={item.title}><img src={item.image} alt={item.title} /><div><span>{item.subtitle}</span><strong>{item.title}</strong><ArrowRight size={17} /></div></button>)}</div></section>

    <footer className="footer"><Logo /><p>Des intérieurs qui ont une âme, sélectionnés avec passion en Côte d'Ivoire.</p><span>© 2026 Meritt Home · Abidjan, Côte d'Ivoire</span></footer>
    <BottomNavigation active={activeNav} cartCount={cart.length} onChange={changeNav} />
    {notice && <div className="toast"><span>✓</span>{notice}</div>}
    {cartOpen && <CartPanel cart={cart} onClose={() => setCartOpen(false)} onUpdate={updateCart} onCheckout={() => { setCartOpen(false); setCheckoutOpen(true); }} />}
    {checkoutOpen && <CheckoutPanel cart={cart} onClose={() => setCheckoutOpen(false)} onComplete={completeOrder} />}
    {adminOpen && <AdminDashboard onClose={() => setAdminOpen(false)} />}
    <a className="whatsapp-float" href="https://wa.me/2250708038429?text=Bonjour%20Meritt%20Home%2C%20je%20souhaite%20avoir%20plus%20d%27informations." target="_blank" rel="noreferrer" aria-label="Contacter Meritt Home sur WhatsApp"><MessageCircle size={22} /><span><strong>Besoin d'aide ?</strong><small>+225 07 08 03 84 29</small></span></a>
    {selectedProduct && <div className="product-modal"><div className="cart-backdrop" onClick={() => setSelectedProduct(null)} /><div className="product-modal-card"><button className="modal-close" onClick={() => setSelectedProduct(null)}><X size={18} /></button><img src={selectedProduct.image} alt={selectedProduct.name} /><div className="modal-info"><span className="eyebrow">{selectedProduct.category}</span><h2>{selectedProduct.name}</h2><div className="modal-rating"><Star size={15} fill="currentColor" /> {selectedProduct.rating} <span>({selectedProduct.reviews} avis)</span></div><strong className="modal-price">{formatPrice(selectedProduct.price)}</strong><p>Une pièce pensée pour durer, aux lignes généreuses et aux matières choisies pour accompagner votre quotidien.</p><div className="modal-colors"><span>Coloris</span><i /><i /><i /><i /></div><button className="primary-button" onClick={() => { addToCart(selectedProduct); setSelectedProduct(null); }}>Ajouter au panier <ShoppingBag size={17} /></button></div></div></div>}
  </main>;
}
