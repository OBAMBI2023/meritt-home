import type { InvoiceLine, InvoiceRow } from '@/lib/admin/invoices';
import { DISPLAY_LABELS } from '@/lib/admin/invoices';

/**
 * Génération d'une facture PDF A4 sans aucune dépendance : un fichier PDF 1.4 écrit à la main, avec les polices
 * standard Helvetica et Helvetica-Bold (aucune police à intégrer). Les montants viennent de la facture enregistrée en base.
 * Limites : texte latin (accents français pris en charge), pas d'image : le logo est rendu en texte.
 */

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 42;
const BRAND: [number, number, number] = [0.106, 0.298, 0.255];

type FontName = 'F1' | 'F2';

// Largeurs Helvetica (millièmes d'em), caractères 32 à 126.
const W1 = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
// Largeurs Helvetica-Bold.
const W2 = [278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584];

// Caractères hors Latin-1 qui existent dans l'encodage WinAnsi.
const WIN_ANSI: Record<number, number> = { 0x2019: 0x92, 0x2018: 0x91, 0x201c: 0x93, 0x201d: 0x94, 0x2013: 0x96, 0x2014: 0x97, 0x2026: 0x85, 0x20ac: 0x80, 0x0153: 0x9c, 0x0152: 0x8c };

/** Espaces insécables et fines : remplacés par une espace ordinaire (absentes de WinAnsi). */
const normalize = (value: string) => value.replace(/[   ]/g, ' ');

function charCode(char: string): number {
  const code = char.charCodeAt(0);
  return WIN_ANSI[code] ?? (code <= 255 ? code : 63);
}

function widthOf(text: string, size: number, font: FontName): number {
  const table = font === 'F2' ? W2 : W1;
  let total = 0;
  for (const char of normalize(text)) {
    const code = char.charCodeAt(0);
    total += code >= 32 && code <= 126 ? table[code - 32] : 556;
  }
  return (total * size) / 1000;
}

function wrap(text: string, maxWidth: number, size: number, font: FontName): string[] {
  const out: string[] = [];
  for (const paragraph of normalize(text).split(/\r?\n/)) {
    let line = '';
    for (const word of paragraph.split(' ')) {
      const candidate = line ? `${line} ${word}` : word;
      if (line && widthOf(candidate, size, font) > maxWidth) {
        out.push(line);
        line = word;
      } else {
        line = candidate;
      }
    }
    out.push(line);
  }
  return out;
}

const escapeText = (text: string) => {
  let out = '';
  for (const char of normalize(text)) {
    const byte = charCode(char);
    const c = String.fromCharCode(byte);
    out += c === '\\' || c === '(' || c === ')' ? `\\${c}` : c;
  }
  return out;
};

const num = (value: number) => value.toFixed(2).replace(/\.?0+$/, '') || '0';
const color = (rgb: [number, number, number]) => rgb.map((c) => num(c)).join(' ');

class PageBuilder {
  ops: string[] = [];
  text(x: number, yTop: number, value: string, size: number, font: FontName = 'F1', rgb: [number, number, number] = [0.1, 0.1, 0.1], spacing = 0) {
    // Tc (espacement des caractères) persiste d'un texte à l'autre : il est toujours réécrit, 0 par défaut.
    this.ops.push(`BT /${font} ${num(size)} Tf ${color(rgb)} rg ${num(spacing)} Tc 1 0 0 1 ${num(x)} ${num(PAGE_H - yTop)} Tm (${escapeText(value)}) Tj ET`);
  }
  rightText(xRight: number, yTop: number, value: string, size: number, font: FontName = 'F1', rgb?: [number, number, number]) {
    this.text(xRight - widthOf(value, size, font), yTop, value, size, font, rgb);
  }
  fill(x: number, yTop: number, w: number, h: number, rgb: [number, number, number]) {
    this.ops.push(`${color(rgb)} rg ${num(x)} ${num(PAGE_H - yTop - h)} ${num(w)} ${num(h)} re f`);
  }
  line(x1: number, y1: number, x2: number, y2: number, rgb: [number, number, number] = [0.8, 0.8, 0.8], width = 0.6) {
    this.ops.push(`${color(rgb)} RG ${num(width)} w ${num(x1)} ${num(PAGE_H - y1)} m ${num(x2)} ${num(PAGE_H - y2)} l S`);
  }
}

const money = (value: number) => `${normalize(value.toLocaleString('fr-FR'))} FCFA`;
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('fr-FR') : '—');

export function invoiceFileName(invoice: Pick<InvoiceRow, 'number' | 'orderReference'>): string {
  const base = invoice.number ?? `BROUILLON-${invoice.orderReference}`;
  return `${base.replace(/[^A-Za-z0-9._-]/g, '_')}.pdf`;
}

export function buildInvoicePdf(invoice: InvoiceRow, lines: InvoiceLine[]): Uint8Array {
  const pages: PageBuilder[] = [];
  let page = new PageBuilder();
  pages.push(page);
  const company = invoice.company;
  const title = invoice.number ?? 'BROUILLON';
  const right = PAGE_W - MARGIN;

  // ---- En-tête
  page.fill(0, 0, PAGE_W, 74, BRAND);
  page.text(MARGIN, 44, 'MERITT', 22, 'F2', [1, 1, 1], 3);
  page.text(MARGIN + 112, 44, 'HOME', 9, 'F1', [1, 1, 1], 4);
  page.rightText(right, 38, 'FACTURE', 20, 'F2', [1, 1, 1]);
  page.rightText(right, 56, title, 11, 'F1', [1, 1, 1]);
  let y = 100;
  if (invoice.status === 'draft') page.text(MARGIN, y, 'BROUILLON : document non valable tant que la facture n’est pas émise', 9, 'F2', [0.75, 0.15, 0.15]);
  if (invoice.status === 'cancelled') page.text(MARGIN, y, `FACTURE ANNULÉE le ${day(invoice.cancelledAt)}${invoice.cancelReason ? ` : ${invoice.cancelReason}` : ''}`.slice(0, 110), 9, 'F2', [0.75, 0.15, 0.15]);
  y = 122;

  // ---- Émetteur et client
  const colW = (PAGE_W - 2 * MARGIN - 24) / 2;
  const block = (x: number, heading: string, rows: { text: string; bold?: boolean }[]) => {
    page.text(x, y, heading.toUpperCase(), 8, 'F2', [0.45, 0.45, 0.45], 0.6);
    let cy = y + 15;
    for (const row of rows) {
      for (const part of wrap(row.text, colW, 10, row.bold ? 'F2' : 'F1')) {
        page.text(x, cy, part, 10, row.bold ? 'F2' : 'F1');
        cy += 13;
      }
    }
    return cy;
  };
  const issuer: { text: string; bold?: boolean }[] = company?.company_name
    ? [{ text: company.company_name, bold: true }, ...(company.address ? [{ text: company.address }] : []), ...(company.phone ? [{ text: `Tél. : ${company.phone}` }] : []), ...(company.email ? [{ text: company.email }] : []), ...(company.tax_id ? [{ text: `N° fiscal : ${company.tax_id}` }] : []), ...(company.rccm ? [{ text: `RCCM : ${company.rccm}` }] : [])]
    : [{ text: 'Coordonnées de l’entreprise figées à l’émission.' }];
  const buyer: { text: string; bold?: boolean }[] = [
    { text: invoice.customerName, bold: true },
    ...(invoice.billingAddress ? [{ text: invoice.billingAddress }] : []),
    ...(invoice.customerPhone ? [{ text: `Tél. : ${invoice.customerPhone}` }] : []),
    ...(invoice.customerEmail ? [{ text: invoice.customerEmail }] : []),
  ];
  const endLeft = block(MARGIN, 'Émetteur', issuer);
  const endRight = block(MARGIN + colW + 24, 'Facturé à', buyer);
  y = Math.max(endLeft, endRight) + 10;

  // ---- Informations de facture
  page.line(MARGIN, y - 4, right, y - 4);
  const info: [string, string][] = [
    ['Date d’émission', day(invoice.issuedAt)],
    ['Échéance', day(invoice.dueAt)],
    ['Commande', invoice.orderReference],
    ['Réception', invoice.fulfillmentMethod === 'pickup' ? 'Retrait sur place' : 'Livraison à domicile'],
  ];
  const cell = (PAGE_W - 2 * MARGIN) / info.length;
  info.forEach(([label, value], index) => {
    page.text(MARGIN + index * cell, y + 10, label.toUpperCase(), 7, 'F2', [0.45, 0.45, 0.45], 0.5);
    page.text(MARGIN + index * cell, y + 24, value, 10, 'F2');
  });
  y += 46;
  if (invoice.replacesNumber) {
    page.text(MARGIN, y - 8, `Remplace la facture annulée ${invoice.replacesNumber}.`, 8, 'F1', [0.4, 0.4, 0.4]);
    y += 8;
  }

  // ---- Tableau des articles
  const X = { desc: MARGIN + 6, qty: 372, unit: 462, amount: right - 6 };
  const tableHeader = () => {
    page.fill(MARGIN, y, PAGE_W - 2 * MARGIN, 20, [0.93, 0.95, 0.94]);
    page.text(X.desc, y + 14, 'Désignation', 9, 'F2');
    page.rightText(X.qty, y + 14, 'Qté', 9, 'F2');
    page.rightText(X.unit, y + 14, 'Prix unitaire', 9, 'F2');
    page.rightText(X.amount, y + 14, 'Montant', 9, 'F2');
    y += 20;
  };
  const newPage = () => {
    page = new PageBuilder();
    pages.push(page);
    y = 50;
    page.text(MARGIN, y, `Facture ${title} (suite)`, 10, 'F2', BRAND);
    y += 18;
  };
  tableHeader();
  for (const row of lines) {
    const parts = wrap(row.description, X.qty - X.desc - 50, 10, 'F1');
    const height = parts.length * 13 + 8;
    if (y + height > PAGE_H - 120) {
      newPage();
      tableHeader();
    }
    parts.forEach((part, index) => page.text(X.desc, y + 15 + index * 13, part, 10));
    page.rightText(X.qty, y + 15, String(row.quantity), 10);
    page.rightText(X.unit, y + 15, money(row.unitPrice), 10);
    page.rightText(X.amount, y + 15, money(row.lineTotal), 10);
    y += height;
    page.line(MARGIN, y, right, y, [0.88, 0.88, 0.88], 0.4);
  }

  // ---- Totaux
  const issued = invoice.status === 'issued';
  const totals: [string, string, boolean][] = [
    ['Sous-total', money(invoice.subtotal), false],
    [invoice.fulfillmentMethod === 'pickup' ? 'Retrait sur place' : 'Frais de livraison', money(invoice.deliveryFee), false],
    ['Total', money(invoice.total), true],
    ...(issued ? ([['Déjà encaissé', money(invoice.paid), false], ['Solde restant', money(Math.max(invoice.balance, 0)), true]] as [string, string, boolean][]) : []),
  ];
  if (y + totals.length * 18 + 140 > PAGE_H - 60) newPage();
  y += 14;
  for (const [label, value, bold] of totals) {
    if (label === 'Total') page.line(300, y - 4, right, y - 4, BRAND, 0.8);
    page.text(300, y + 10, label, bold ? 11 : 10, bold ? 'F2' : 'F1');
    page.rightText(right - 6, y + 10, value, bold ? 11 : 10, bold ? 'F2' : 'F1');
    y += 18;
  }
  y += 10;
  page.text(MARGIN, y, `Statut : ${DISPLAY_LABELS[invoice.displayStatus]}`, 10, 'F2', BRAND);
  y += 22;

  // ---- Conditions et mentions
  const footerBlock = (heading: string, value: string | null | undefined, size: number) => {
    if (!value) return;
    const parts = wrap(value, PAGE_W - 2 * MARGIN, size, 'F1');
    if (y + 16 + parts.length * (size + 3) > PAGE_H - 50) newPage();
    page.text(MARGIN, y, heading.toUpperCase(), 7, 'F2', [0.45, 0.45, 0.45], 0.5);
    y += 12;
    for (const part of parts) {
      page.text(MARGIN, y, part, size, 'F1', [0.25, 0.25, 0.25]);
      y += size + 3;
    }
    y += 8;
  };
  footerBlock('Conditions de paiement', company?.payment_terms, 9);
  footerBlock('Note', invoice.notes, 9);
  footerBlock('Mentions légales', company?.legal_notice, 8);

  // ---- Pieds de page
  pages.forEach((p, index) => {
    p.line(MARGIN, PAGE_H - 36, right, PAGE_H - 36, [0.85, 0.85, 0.85], 0.4);
    p.text(MARGIN, PAGE_H - 24, `${company?.company_name ?? 'Meritt Home'}${invoice.number ? ` — Facture ${invoice.number}` : ''}`, 7.5, 'F1', [0.5, 0.5, 0.5]);
    p.rightText(right, PAGE_H - 24, `Page ${index + 1} / ${pages.length}`, 7.5, 'F1', [0.5, 0.5, 0.5]);
  });

  return assemble(pages);
}

/** Assemble le fichier : catalogue, pages, polices, flux de contenu, table des références croisées. */
function assemble(pages: PageBuilder[]): Uint8Array {
  const objects: string[] = [];
  const pageIds = pages.map((_, index) => 5 + index * 2);
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`;
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
  objects[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';
  pages.forEach((builder, index) => {
    const pageId = pageIds[index];
    const stream = builder.ops.join('\n');
    objects[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(PAGE_W)} ${num(PAGE_H)}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${pageId + 1} 0 R >>`;
    objects[pageId + 1] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  });

  let body = '%PDF-1.4\n%âãÏÓ\n';
  const offsets: number[] = [];
  for (let id = 1; id < objects.length; id += 1) {
    offsets[id] = body.length;
    body += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xref = body.length;
  body += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id += 1) body += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;

  // Chaque caractère est un octet (Latin-1) : la longueur en caractères est la longueur en octets.
  const bytes = new Uint8Array(body.length);
  for (let index = 0; index < body.length; index += 1) bytes[index] = body.charCodeAt(index) & 0xff;
  return bytes;
}
