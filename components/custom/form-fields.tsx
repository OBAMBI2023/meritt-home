'use client';

import type { ReactNode } from 'react';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import type { Option } from '@/lib/custom-requests';

/** Champ avec libellé, aide et message d'erreur relié par aria-describedby. */
export function Field({
  id,
  label,
  required,
  hint,
  error,
  children,
  className,
}: {
  id: string;
  label: string;
  required?: boolean;
  hint?: string;
  error?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <Label htmlFor={id} className="text-sm font-semibold">
        {label}
        {required ? <span aria-hidden className="text-destructive"> *</span> : <span className="font-normal text-muted-foreground"> (facultatif)</span>}
      </Label>
      {children}
      {hint && !error && (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} role="alert" className="text-sm font-medium text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

export const describedBy = (id: string, hint?: string, error?: string) => (error ? `${id}-error` : hint ? `${id}-hint` : undefined);

/** Choix unique présenté en pastilles ; de vrais boutons radio (clavier et lecteurs d'écran) sont conservés. */
export function ChoiceGroup({
  name,
  legend,
  options,
  value,
  onChange,
  error,
  required,
  columns = 'sm:grid-cols-2',
}: {
  name: string;
  legend: string;
  options: Option[];
  value: string;
  onChange: (value: string) => void;
  error?: string;
  required?: boolean;
  columns?: string;
}) {
  return (
    <fieldset className="space-y-2" aria-describedby={error ? `${name}-error` : undefined}>
      <legend className="text-sm font-semibold">
        {legend}
        {required && <span aria-hidden className="text-destructive"> *</span>}
      </legend>
      <div className={cn('grid gap-2', columns)}>
        {options.map((option) => (
          <label key={option.value} className="relative block cursor-pointer">
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
              className="peer sr-only"
            />
            <span className="flex min-h-[3rem] items-center rounded-[13px] border border-input bg-background px-4 py-2.5 text-sm font-medium transition-colors hover:bg-muted peer-checked:border-primary peer-checked:bg-accent peer-checked:text-accent-foreground peer-checked:ring-1 peer-checked:ring-primary peer-focus-visible:ring-2 peer-focus-visible:ring-ring">
              {option.label}
            </span>
          </label>
        ))}
      </div>
      {error && (
        <p id={`${name}-error`} role="alert" className="text-sm font-medium text-destructive">
          {error}
        </p>
      )}
    </fieldset>
  );
}
