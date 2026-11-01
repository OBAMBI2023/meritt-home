'use client';

import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Banknote, Boxes, ClipboardList, ExternalLink, FileText, LayoutDashboard, LogOut, Menu, PackageCheck, Palette, Settings, Tags } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { useAdmin } from '@/components/admin/admin-context';
import { BrandLogo } from '@/components/shop/brand-logo';
import { cn } from '@/lib/utils';

const NAV = [
  { href: '/admin', label: 'Vue d’ensemble', icon: LayoutDashboard },
  { href: '/admin/produits', label: 'Produits', icon: PackageCheck },
  { href: '/admin/categories', label: 'Catégories', icon: Tags },
  { href: '/admin/stocks', label: 'Stocks', icon: Boxes },
  { href: '/admin/commandes', label: 'Commandes', icon: ClipboardList },
  { href: '/admin/encaissements', label: 'Encaissements', icon: Banknote },
  { href: '/admin/factures', label: 'Factures', icon: FileText },
  { href: '/admin/bannieres', label: 'Bannières', icon: Palette },
  { href: '/admin/parametres', label: 'Paramètres', icon: Settings },
] as const;

function NavLinks({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  return (
    <nav aria-label="Administration" className="space-y-1">
      {NAV.map(({ href, label, icon: Icon }) => {
        const active = href === '/admin' ? pathname === '/admin' : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex min-h-[2.75rem] items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors',
              active ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent hover:text-foreground'
            )}
          >
            <Icon className="h-4 w-4" aria-hidden />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

function SidebarFooter({ onSignOut }: { onSignOut: () => void }) {
  return (
    <div className="mt-auto space-y-2">
      <Button asChild variant="ghost" className="w-full justify-start">
        <Link href="/">
          <ExternalLink className="mr-2 h-4 w-4" aria-hidden />
          Voir la boutique
        </Link>
      </Button>
      <Button type="button" variant="outline" className="w-full justify-start" onClick={onSignOut}>
        <LogOut className="mr-2 h-4 w-4" aria-hidden />
        Déconnexion
      </Button>
    </div>
  );
}

export function AdminShell({ children }: { children: ReactNode }) {
  const { user, signOut } = useAdmin();
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const current = NAV.find(({ href }) => (href === '/admin' ? pathname === '/admin' : pathname.startsWith(href))) ?? NAV[0];

  return (
    <div className="flex min-h-screen bg-muted/40 print:block print:bg-white">
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col gap-6 border-r bg-card p-5 md:flex print:!hidden">
        <div className="space-y-1">
          <BrandLogo />
          <p className="text-xs uppercase tracking-wider text-muted-foreground">Administration</p>
        </div>
        <NavLinks pathname={pathname} />
        <SidebarFooter onSignOut={() => void signOut()} />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b bg-card/95 px-4 py-3 backdrop-blur sm:px-6 print:!hidden">
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="md:hidden"
            onClick={() => setMenuOpen(true)}
            aria-label="Ouvrir le menu d’administration"
          >
            <Menu className="h-5 w-5" aria-hidden />
          </Button>
          <h1 className="min-w-0 flex-1 truncate font-display text-xl font-semibold">{current.label}</h1>
          <div className="min-w-0 text-right text-sm">
            <p className="truncate font-medium" title={user.email ?? undefined}>
              {user.email ?? 'Administrateur'}
            </p>
            <p className="text-xs text-muted-foreground">Administrateur</p>
          </div>
        </header>

        <main className="flex-1 space-y-6 p-4 sm:p-6">{children}</main>
      </div>

      <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
        <SheetContent side="left" className="flex w-72 flex-col gap-6 p-5">
          <div className="space-y-1">
            <SheetTitle className="sr-only">Menu d’administration</SheetTitle>
            <SheetDescription className="sr-only">Navigation entre les modules d’administration</SheetDescription>
            <BrandLogo />
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Administration</p>
          </div>
          <NavLinks pathname={pathname} onNavigate={() => setMenuOpen(false)} />
          <SidebarFooter onSignOut={() => void signOut()} />
        </SheetContent>
      </Sheet>
    </div>
  );
}
