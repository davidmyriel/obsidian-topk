// Near-duplicate invoices for the benchmark (ADR-006): 20 one-page PDFs with the same layout that
// differ only in invoice number, customer, dates and amounts. They test what visual search finds
// hardest: telling apart pages that look the same. File names are neutral (invoice-01.pdf …) and
// unrelated to the invoice numbers, so file-name matching can't give the answer away.
//
// Deterministic: the same bytes on every machine, so corpus.json can record their SHA-256.
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

export const INVOICE_COUNT = 20;

const CUSTOMERS = [
	'Acme Robotics',
	'Northwind Traders',
	'Blue Harbor Labs',
	'Cedar & Finch',
	'Orbital Foods',
	'Kestrel Analytics',
	'Granite Peak Media',
	'Lumen Health',
	'Riverbend Studio',
	'Tidewater Supply',
];

const ITEMS = [
	'Consulting hours',
	'GPU compute (A10G)',
	'Data labelling',
	'Model evaluation',
	'Storage, 1 TB-month',
	'Support plan',
];

/** A small seeded generator, so amounts look varied but are reproducible. */
function rng(seed: number): () => number {
	let s = seed >>> 0;
	return () => {
		s = (s + 0x6d2b79f5) >>> 0;
		let t = s;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

export interface Invoice {
	/** File name under bench/corpus/invoices/. */
	file: string;
	number: string;
	customer: string;
	total: string;
	issued: string;
}

/** The invoice behind each file. File i holds invoice number INV-(2290 + order[i]). */
export function invoices(): Invoice[] {
	const random = rng(2291);
	// A fixed shuffle, so file order says nothing about invoice order.
	const order = Array.from({ length: INVOICE_COUNT }, (_, i) => i)
		.map((i) => ({ i, r: random() }))
		.sort((a, b) => a.r - b.r)
		.map((x) => x.i);
	return order.map((n, i) => {
		const r = rng(1000 + n);
		const total = 400 + Math.round(r() * 9000);
		return {
			file: `invoice-${String(i + 1).padStart(2, '0')}.pdf`,
			number: `INV-${2290 + n}`,
			customer: CUSTOMERS[n % CUSTOMERS.length] ?? 'Customer',
			total: `€${total.toLocaleString('en-US')}.00`,
			issued: `2026-${String(1 + (n % 9)).padStart(2, '0')}-${String(10 + n).padStart(2, '0')}`,
		};
	});
}

export async function invoicePdf(invoice: Invoice, index: number): Promise<Uint8Array> {
	const doc = await PDFDocument.create();
	// Fixed metadata, so the bytes do not depend on the clock.
	const epoch = new Date(Date.UTC(2026, 0, 1));
	doc.setCreationDate(epoch);
	doc.setModificationDate(epoch);
	doc.setProducer('obsidian-topk bench');
	doc.setCreator('obsidian-topk bench');
	const page = doc.addPage([595, 842]); // A4
	const font = await doc.embedFont(StandardFonts.Helvetica);
	const bold = await doc.embedFont(StandardFonts.HelveticaBold);
	const text = (s: string, x: number, y: number, size = 11, f = font): void =>
		page.drawText(s, { x, y, size, font: f, color: rgb(0.1, 0.1, 0.12) });

	page.drawRectangle({ x: 0, y: 772, width: 595, height: 70, color: rgb(0.16, 0.36, 0.72) });
	page.drawText('INVOICE', { x: 48, y: 796, size: 28, font: bold, color: rgb(1, 1, 1) });
	text('Lattice Systems GmbH', 380, 812, 11, bold);
	page.drawText('Torstrasse 12, 10119 Berlin', {
		x: 380,
		y: 796,
		size: 9,
		font,
		color: rgb(1, 1, 1),
	});

	text('Invoice number', 48, 730, 10);
	text(invoice.number, 160, 730, 12, bold);
	text('Issued', 48, 712, 10);
	text(invoice.issued, 160, 712);
	text('Billed to', 48, 694, 10);
	text(invoice.customer, 160, 694, 11, bold);

	page.drawRectangle({ x: 48, y: 640, width: 499, height: 22, color: rgb(0.92, 0.94, 0.97) });
	text('Description', 56, 647, 10, bold);
	text('Qty', 360, 647, 10, bold);
	text('Amount', 470, 647, 10, bold);
	const r = rng(5000 + index);
	let y = 620;
	for (const item of ITEMS) {
		const qty = 1 + Math.floor(r() * 9);
		const amount = 50 + Math.round(r() * 1500);
		text(item, 56, y);
		text(String(qty), 360, y);
		text(`€${amount.toLocaleString('en-US')}.00`, 470, y);
		y -= 22;
	}
	page.drawLine({ start: { x: 48, y: y + 8 }, end: { x: 547, y: y + 8 }, thickness: 1 });
	text('Total due', 360, y - 14, 12, bold);
	text(invoice.total, 470, y - 14, 12, bold);
	text('Payment within 30 days to IBAN DE00 0000 0000 0000 0000 00.', 48, 120, 9);
	text(`Please quote ${invoice.number} with your payment.`, 48, 104, 9);
	return doc.save({ useObjectStreams: false });
}
