import { fetchInvoiceLines, type InvoiceRow } from '@/lib/admin/invoices';
import { buildInvoicePdf, invoiceFileName } from '@/lib/pdf/invoice-pdf';

/** Génère le PDF à partir des lignes ENREGISTRÉES de la facture, puis le télécharge sous le nom du numéro de facture. */
export async function downloadInvoicePdf(invoice: InvoiceRow): Promise<void> {
  const lines = await fetchInvoiceLines(invoice.id);
  if (lines.length === 0) throw new Error('lines');
  const bytes = buildInvoicePdf(invoice, lines);
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = invoiceFileName(invoice);
  link.click();
  URL.revokeObjectURL(url);
}
