'use client';

import { useEffect, useState } from 'react';
import { Toaster, toast } from 'sonner';
import { ErrorBlock, LoadingBlock } from '@/components/admin/admin-ui';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useAdminQuery } from '@/hooks/use-admin-query';
import { companyFormSchema, fetchCompanySettings, isInvoiceModuleMissing, saveCompanySettings, type CompanyFormInput, type CompanySettings } from '@/lib/admin/invoices';

const toForm = (settings: CompanySettings): CompanyFormInput => ({
  companyName: settings.companyName,
  address: settings.address,
  phone: settings.phone,
  email: settings.email,
  taxId: settings.taxId,
  rccm: settings.rccm,
  legalNotice: settings.legalNotice,
  paymentTerms: settings.paymentTerms,
  dueDays: settings.dueDays === null ? '' : String(settings.dueDays),
});

function CompanyForm({ settings, onSaved }: { settings: CompanySettings; onSaved: () => void }) {
  const [form, setForm] = useState<CompanyFormInput>(toForm(settings));
  const [errors, setErrors] = useState<Partial<Record<keyof CompanyFormInput, string>>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => setForm(toForm(settings)), [settings]);
  const set = (key: keyof CompanyFormInput, value: string) => {
    setForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
  };

  async function submit() {
    if (busy) return;
    const parsed = companyFormSchema.safeParse(form);
    if (!parsed.success) {
      const next: Partial<Record<keyof CompanyFormInput, string>> = {};
      for (const issue of parsed.error.issues) next[issue.path[0] as keyof CompanyFormInput] ??= issue.message;
      return void setErrors(next);
    }
    setBusy(true);
    const result = await saveCompanySettings(parsed.data);
    setBusy(false);
    if (!result.ok) return void toast.error(result.message);
    toast.success('Informations de l’entreprise enregistrées. Elles seront figées sur les prochaines factures émises.');
    onSaved();
  }

  const field = (key: keyof CompanyFormInput, label: string, hint?: string) => (
    <div className="space-y-1.5">
      <Label htmlFor={`co-${key}`}>{label}</Label>
      <Input id={`co-${key}`} value={form[key]} onChange={(e) => set(key, e.target.value)} aria-invalid={!!errors[key]} />
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      {errors[key] && <p className="text-xs text-destructive">{errors[key]}</p>}
    </div>
  );
  const area = (key: keyof CompanyFormInput, label: string, hint: string) => (
    <div className="space-y-1.5">
      <Label htmlFor={`co-${key}`}>{label}</Label>
      <Textarea id={`co-${key}`} rows={3} value={form[key]} onChange={(e) => set(key, e.target.value)} aria-invalid={!!errors[key]} />
      <p className="text-xs text-muted-foreground">{hint}</p>
      {errors[key] && <p className="text-xs text-destructive">{errors[key]}</p>}
    </div>
  );

  return (
    <form noValidate className="space-y-4" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <div className="grid gap-4 sm:grid-cols-2">
        {field('companyName', 'Nom de l’entreprise *', 'Obligatoire pour émettre une facture.')}
        {field('phone', 'Téléphone')}
        {field('email', 'E-mail')}
        {field('dueDays', 'Délai de paiement (jours)', 'Vide : aucune échéance par défaut. Sinon, l’échéance = date d’émission + ce délai.')}
        {field('taxId', 'Numéro fiscal', 'À renseigner uniquement avec la valeur officielle.')}
        {field('rccm', 'RCCM', 'À renseigner uniquement avec la valeur officielle.')}
      </div>
      {area('address', 'Adresse', 'Imprimée sur les factures.')}
      {area('paymentTerms', 'Conditions de paiement', 'Texte libre imprimé sur les factures.')}
      {area('legalNotice', 'Mentions légales et fiscales', 'Texte libre à valider avant usage : aucune mention n’est ajoutée automatiquement.')}
      <Button type="submit" disabled={busy}>{busy ? 'Enregistrement…' : 'Enregistrer'}</Button>
    </form>
  );
}

export function CompanySettingsPanel() {
  const { state, reload } = useAdminQuery(fetchCompanySettings);
  return (
    <section aria-labelledby="company-title" className="space-y-4 rounded-lg border bg-card p-5">
      <Toaster position="top-center" richColors closeButton />
      <div className="space-y-1">
        <h3 id="company-title" className="font-sans text-base font-semibold">Entreprise et facturation</h3>
        <p className="text-sm text-muted-foreground">
          Ces informations sont copiées sur une facture au moment de son émission : les modifier n’altère jamais les factures déjà émises. Rien n’est pré-rempli.
        </p>
      </div>
      {state.status === 'loading' && <LoadingBlock label="Chargement…" />}
      {state.status === 'error' &&
        (isInvoiceModuleMissing(state.code) ? (
          <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">Le module de facturation n’est pas encore installé en base (migration-factures.sql).</p>
        ) : (
          <ErrorBlock code={state.code} onRetry={reload} />
        ))}
      {state.status === 'ready' &&
        (state.data === null ? (
          <p role="alert" className="text-sm text-muted-foreground">Les réglages sont illisibles : la ligne de configuration est absente ou votre compte n’a pas le droit de la lire.</p>
        ) : (
          <CompanyForm settings={state.data} onSaved={reload} />
        ))}
    </section>
  );
}
