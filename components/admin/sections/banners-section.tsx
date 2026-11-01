'use client';

import { useEffect, useRef, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { Toaster, toast } from 'sonner';
import { ErrorBlock, LoadingBlock, SectionHeader } from '@/components/admin/admin-ui';
import { ImagePicker } from '@/components/admin/image-picker';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useAdminQuery } from '@/hooks/use-admin-query';
import { DEFAULT_BANNERS, christmasStatus, fetchBannersForAdmin, saveBanners, validateBanners, type BannerErrors, type Banners } from '@/lib/banners';
import { COLLECTIONS } from '@/lib/site';

/** Identifiant du champ à partir de sa clé d'erreur (`promo.bg` → `promo-bg`, `collections.1` → `collection-1`). */
const fieldId = (key: string) => (key.startsWith('collections.') ? `collection-${key.split('.')[1]}` : key.replace('.', '-'));

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={`${id}-error`} role="alert" className="text-sm text-destructive">
      {message}
    </p>
  );
}

function TextField({ id, label, value, error, onChange, type, hint }: { id: string; label: string; value: string; error?: string; onChange: (value: string) => void; type?: string; hint?: string }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} type={type} value={value} aria-invalid={!!error} aria-describedby={error ? `${id}-error` : undefined} onChange={(event) => onChange(event.target.value)} />
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      <FieldError id={id} message={error} />
    </div>
  );
}

function ColorField({ id, label, value, error, onChange }: { id: string; label: string; value: string; error?: string; onChange: (value: string) => void }) {
  // Le sélecteur natif exige un #rrggbb valide : on lui donne une valeur de repli neutre, sans toucher à la saisie.
  const picker = /^#[0-9a-f]{6}$/i.test(value) ? value : '#000000';
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={`${label} (sélecteur)`}
          value={picker}
          onChange={(event) => onChange(event.target.value)}
          className="h-10 w-12 cursor-pointer rounded-md border bg-background p-1"
        />
        <Input id={id} value={value} maxLength={7} aria-invalid={!!error} aria-describedby={error ? `${id}-error` : undefined} onChange={(event) => onChange(event.target.value)} />
      </div>
      <FieldError id={id} message={error} />
    </div>
  );
}

function ImageField({
  id,
  label,
  value,
  error,
  onChange,
  onBusyChange,
}: {
  id: string;
  label: string;
  value: string;
  error?: string;
  onChange: (value: string) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-start gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {value ? <img src={value} alt="" className="h-20 w-28 shrink-0 rounded-md border bg-muted object-cover" /> : <div aria-hidden className="flex h-20 w-28 shrink-0 items-center justify-center rounded-md border border-dashed bg-muted text-center text-[11px] text-muted-foreground">Décor intégré</div>}
        <div className="min-w-0 flex-1 space-y-2">
          <Input id={id} value={value} placeholder="URL de l’image" aria-invalid={!!error} aria-describedby={error ? `${id}-error` : undefined} onChange={(event) => onChange(event.target.value)} />
          <FieldError id={id} message={error} />
          <ImagePicker onUploaded={onChange} onBusyChange={onBusyChange} />
        </div>
      </div>
    </div>
  );
}

function Panel({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4 rounded-lg border bg-card p-5">
      <div className="space-y-1">
        <h3 className="font-sans text-base font-semibold">{title}</h3>
        <p className="text-sm text-muted-foreground">{hint}</p>
      </div>
      <div className="grid gap-5 sm:grid-cols-2">{children}</div>
    </section>
  );
}

function BannersForm({ initial }: { initial: Banners }) {
  const [form, setForm] = useState<Banners>(initial);
  const [errors, setErrors] = useState<BannerErrors>({});
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  // Garde synchrone contre les doubles clics (l'état React arrive un rendu plus tard).
  const inFlight = useRef(false);
  useEffect(() => {
    setForm(initial);
    setErrors({});
  }, [initial]);

  const clearError = (key: string) => setErrors((cur) => (cur[key] ? Object.fromEntries(Object.entries(cur).filter(([k]) => k !== key)) : cur));
  const setHero = (patch: Partial<Banners['hero']>) => {
    setForm((cur) => ({ ...cur, hero: { ...cur.hero, ...patch } }));
    Object.keys(patch).forEach((k) => clearError(`hero.${k}`));
  };
  const setPromo = (patch: Partial<Banners['promo']>) => {
    setForm((cur) => ({ ...cur, promo: { ...cur.promo, ...patch } }));
    Object.keys(patch).forEach((k) => clearError(`promo.${k}`));
  };
  const setXmas = (patch: Partial<Banners['christmas']>) => {
    setForm((cur) => ({ ...cur, christmas: { ...cur.christmas, ...patch } }));
    Object.keys(patch).forEach((k) => clearError(`christmas.${k}`));
  };
  const setCollection = (index: number, image: string) => {
    setForm((cur) => ({ ...cur, collections: cur.collections.map((item, i) => (i === index ? { image } : item)) }));
    clearError(`collections.${index}`);
  };

  async function submit() {
    if (inFlight.current || busy || uploading) return;
    // Validation explicite AVANT envoi : aucune valeur vide ou invalide n'est remplacée en silence.
    const found = validateBanners(form);
    if (Object.keys(found).length > 0) {
      setErrors(found);
      toast.error('Corrigez les champs signalés : rien n’a été enregistré.');
      const first = Object.keys(found)[0];
      setTimeout(() => document.getElementById(fieldId(first))?.focus(), 0);
      return;
    }
    inFlight.current = true;
    setBusy(true);
    const result = await saveBanners(form);
    inFlight.current = false;
    setBusy(false);
    // Échec : aucune confirmation, et les saisies restent telles quelles.
    if (!result.ok) return void toast.error(result.message);
    // Succès : le formulaire affiche exactement ce que la base a renvoyé.
    setForm(result.data);
    setErrors({});
    toast.success('Bannières enregistrées : elles sont visibles sur la boutique.');
  }

  const p = form.promo;
  const e = errors;
  return (
    <form
      noValidate
      className="space-y-6"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <Panel title="Bannière d’accueil" hint="Grande image en haut de la page d’accueil et texte du badge rond.">
        <ImageField id="hero-image" label="Image" value={form.hero.image} error={e['hero.image']} onChange={(image) => setHero({ image })} onBusyChange={setUploading} />
        <TextField id="hero-badge" label="Texte du badge rond" value={form.hero.badge} error={e['hero.badge']} onChange={(badge) => setHero({ badge })} />
      </Panel>

      <Panel title="Bannière promotionnelle" hint="Couleurs, image et textes de la grande bannière. Tous les champs sont obligatoires.">
        <div
          className="space-y-1 rounded-xl p-5 sm:col-span-2"
          style={{ backgroundColor: /^#[0-9a-f]{6}$/i.test(p.bg) ? p.bg : '#ffffff', color: /^#[0-9a-f]{6}$/i.test(p.fg) ? p.fg : '#000000' }}
          aria-label="Aperçu de la bannière"
        >
          <p className="text-xs font-bold tracking-[0.16em]" style={{ color: /^#[0-9a-f]{6}$/i.test(p.accent) ? p.accent : 'inherit' }}>
            {p.eyebrow}
          </p>
          <p className="text-2xl font-bold">
            {p.title} <em style={{ color: /^#[0-9a-f]{6}$/i.test(p.accent) ? p.accent : 'inherit' }}>{p.highlight}</em>
          </p>
          <p className="text-sm opacity-80">{p.subtitle}</p>
        </div>
        <ColorField id="promo-bg" label="Couleur de fond" value={p.bg} error={e['promo.bg']} onChange={(bg) => setPromo({ bg })} />
        <ColorField id="promo-fg" label="Couleur du texte" value={p.fg} error={e['promo.fg']} onChange={(fg) => setPromo({ fg })} />
        <ColorField id="promo-accent" label="Couleur d’accent" value={p.accent} error={e['promo.accent']} onChange={(accent) => setPromo({ accent })} />
        <ImageField id="promo-image" label="Image" value={p.image} error={e['promo.image']} onChange={(image) => setPromo({ image })} onBusyChange={setUploading} />
        <TextField id="promo-eyebrow" label="Sur-titre" value={p.eyebrow} error={e['promo.eyebrow']} onChange={(eyebrow) => setPromo({ eyebrow })} />
        <TextField id="promo-title" label="Titre" value={p.title} error={e['promo.title']} onChange={(title) => setPromo({ title })} />
        <TextField id="promo-highlight" label="Mot mis en avant" value={p.highlight} error={e['promo.highlight']} onChange={(highlight) => setPromo({ highlight })} />
        <TextField id="promo-subtitle" label="Sous-titre" value={p.subtitle} error={e['promo.subtitle']} onChange={(subtitle) => setPromo({ subtitle })} />
        <TextField id="promo-text" label="Description" value={p.text} error={e['promo.text']} onChange={(text) => setPromo({ text })} />
        <TextField id="promo-button" label="Texte du bouton" value={p.button} error={e['promo.button']} onChange={(button) => setPromo({ button })} />
        <TextField id="promo-orbit" label="Pastille" value={p.orbit} error={e['promo.orbit']} onChange={(orbit) => setPromo({ orbit })} />
      </Panel>

      <Panel title="Campagne de Noël" hint="Bannière de fin d’année sous la bannière d’accueil. Aucune réduction ni prix n’est affiché : n’en saisissez que s’ils sont validés commercialement.">
        <div className="flex items-center gap-3 sm:col-span-2">
          <Switch id="christmas-enabled" checked={form.christmas.enabled} onCheckedChange={(enabled) => setXmas({ enabled })} />
          <Label htmlFor="christmas-enabled">Afficher la campagne sur la boutique</Label>
        </div>
        <p id="christmas-status" role="status" className="text-sm text-muted-foreground sm:col-span-2">
          État selon les valeurs saisies : {christmasStatus(form.christmas, new Date().toLocaleDateString('sv-SE')).label} La date du jour est celle du navigateur du visiteur.
        </p>
        <TextField id="christmas-startsAt" type="date" label="Début (facultatif)" value={form.christmas.startsAt} error={e['christmas.startsAt']} hint="Vide : affichée dès l’enregistrement." onChange={(startsAt) => setXmas({ startsAt })} />
        <TextField id="christmas-endsAt" type="date" label="Fin (facultatif)" value={form.christmas.endsAt} error={e['christmas.endsAt']} hint="Vide : affichée jusqu’à désactivation. La fin est incluse." onChange={(endsAt) => setXmas({ endsAt })} />
        <ImageField id="christmas-image" label="Image (facultatif, laisser vide pour le décor intégré)" value={form.christmas.image} error={e['christmas.image']} onChange={(image) => setXmas({ image })} onBusyChange={setUploading} />
        <TextField id="christmas-badge" label="Badge" value={form.christmas.badge} error={e['christmas.badge']} onChange={(badge) => setXmas({ badge })} />
        <TextField id="christmas-title" label="Titre" value={form.christmas.title} error={e['christmas.title']} onChange={(title) => setXmas({ title })} />
        <TextField id="christmas-subtitle" label="Sous-titre" value={form.christmas.subtitle} error={e['christmas.subtitle']} onChange={(subtitle) => setXmas({ subtitle })} />
        <TextField id="christmas-button" label="Texte du bouton" value={form.christmas.button} error={e['christmas.button']} onChange={(button) => setXmas({ button })} />
        <TextField id="christmas-href" label="Lien du bouton" value={form.christmas.href} error={e['christmas.href']} hint="#catalogue, /chemin ou https://…" onChange={(href) => setXmas({ href })} />
      </Panel>

      <Panel title="Inspirations" hint="Images des trois collections de la page d’accueil.">
        {COLLECTIONS.map((collection, index) => (
          <ImageField
            key={collection.title}
            id={`collection-${index}`}
            label={collection.title}
            value={form.collections[index].image}
            error={e[`collections.${index}`]}
            onChange={(image) => setCollection(index, image)}
            onBusyChange={setUploading}
          />
        ))}
      </Panel>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={busy || uploading}>
          {busy ? 'Enregistrement…' : uploading ? 'Envoi de l’image…' : 'Enregistrer les bannières'}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          onClick={() => {
            setForm(DEFAULT_BANNERS);
            setErrors({});
            toast.info('Valeurs par défaut chargées dans le formulaire : cliquez sur « Enregistrer » pour les appliquer.');
          }}
        >
          <RotateCcw className="mr-2 h-4 w-4" aria-hidden />
          Valeurs par défaut
        </Button>
        {Object.keys(errors).length > 0 && (
          <p role="alert" className="text-sm text-destructive">
            {Object.keys(errors).length} champ{Object.keys(errors).length > 1 ? 's' : ''} à corriger.
          </p>
        )}
      </div>
    </form>
  );
}

export function BannersSection() {
  const { state, reload } = useAdminQuery(fetchBannersForAdmin);
  return (
    <div className="space-y-6">
      <Toaster position="top-center" richColors closeButton />
      <SectionHeader
        title="Bannières"
        description="Personnalisez les couleurs, images et textes des bannières de la boutique. Les changements sont visibles par tous les visiteurs après enregistrement."
      />
      {state.status === 'loading' && <LoadingBlock />}
      {state.status === 'error' && <ErrorBlock code={state.code} onRetry={reload} />}
      {state.status === 'ready' && state.data.tableMissing && (
        <p role="alert" className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
          La table des bannières n’est pas encore installée en base : appliquez <code>migration-bannieres.sql</code> dans l’éditeur SQL de Supabase, puis rechargez cette page.
        </p>
      )}
      {state.status === 'ready' && !state.data.tableMissing && <BannersForm initial={state.data.banners} />}
    </div>
  );
}
