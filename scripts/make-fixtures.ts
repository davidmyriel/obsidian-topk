// Generates the fixture vault deterministically. All content is drawn here, so it is ours to
// redistribute (CC0). Usage: npx tsx scripts/make-fixtures.ts
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createCanvas } from '@napi-rs/canvas';
import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from 'pdf-lib';

const vault = join(import.meta.dirname, '..', 'tests', 'fixtures', 'vault');
mkdirSync(join(vault, 'Talks'), { recursive: true });

// 16:9 slides, 960 x 540 pt.
const W = 960;
const H = 540;

function title(page: PDFPage, font: PDFFont, text: string): void {
	page.drawText(text, { x: 60, y: H - 90, size: 36, font, color: rgb(0.1, 0.1, 0.2) });
}

function box(page: PDFPage, font: PDFFont, x: number, y: number, label: string): void {
	page.drawRectangle({
		x,
		y,
		width: 160,
		height: 70,
		borderColor: rgb(0.2, 0.3, 0.6),
		borderWidth: 3,
		color: rgb(0.9, 0.93, 1),
	});
	page.drawText(label, { x: x + 14, y: y + 28, size: 16, font, color: rgb(0.1, 0.1, 0.2) });
}

function arrow(page: PDFPage, x1: number, x2: number, y: number): void {
	page.drawLine({
		start: { x: x1, y },
		end: { x: x2, y },
		thickness: 3,
		color: rgb(0.2, 0.2, 0.2),
	});
	page.drawLine({ start: { x: x2, y }, end: { x: x2 - 12, y: y + 8 }, thickness: 3 });
	page.drawLine({ start: { x: x2, y }, end: { x: x2 - 12, y: y - 8 }, thickness: 3 });
}

async function talkPdf(): Promise<Uint8Array> {
	const doc = await PDFDocument.create();
	// Fixed dates keep the output byte-for-byte stable.
	doc.setCreationDate(new Date('2026-01-01T00:00:00Z'));
	doc.setModificationDate(new Date('2026-01-01T00:00:00Z'));
	doc.setProducer('obsidian-topk fixtures');
	doc.setCreator('scripts/make-fixtures.ts');
	const bold = await doc.embedFont(StandardFonts.HelveticaBold);
	const font = await doc.embedFont(StandardFonts.Helvetica);

	// Page 1: title slide.
	const p1 = doc.addPage([W, H]);
	p1.drawText('Search at Scale', {
		x: 60,
		y: 300,
		size: 54,
		font: bold,
		color: rgb(0.1, 0.1, 0.2),
	});
	p1.drawText('Lessons from building a retrieval engine', { x: 60, y: 250, size: 24, font });

	// Page 2: bar chart of quarterly revenue.
	const p2 = doc.addPage([W, H]);
	title(p2, bold, 'Quarterly revenue');
	const bars = [120, 180, 150, 260];
	bars.forEach((v, i) => {
		const x = 140 + i * 180;
		p2.drawRectangle({ x, y: 80, width: 100, height: v, color: rgb(0.2, 0.55, 0.35) });
		p2.drawText(`Q${i + 1}`, { x: x + 36, y: 55, size: 18, font });
	});
	p2.drawLine({ start: { x: 110, y: 80 }, end: { x: 880, y: 80 }, thickness: 2 });

	// Page 3: the hero page, a reranker architecture diagram.
	const p3 = doc.addPage([W, H]);
	title(p3, bold, 'Reranker architecture');
	const labels = ['Query encoder', 'Retriever', 'Reranker', 'Top results'];
	labels.forEach((label, i) => {
		const x = 40 + i * 230;
		box(p3, font, x, 230, label);
		if (i < labels.length - 1) arrow(p3, x + 165, x + 225, 265);
	});
	p3.drawText('First stage recalls 1,000 candidates; the cross-encoder reranks the top 100.', {
		x: 60,
		y: 140,
		size: 18,
		font,
	});

	return doc.save({ useObjectStreams: false });
}

function piePng(): Buffer {
	const canvas = createCanvas(800, 600);
	const ctx = canvas.getContext('2d');
	ctx.fillStyle = '#ffffff';
	ctx.fillRect(0, 0, 800, 600);
	const slices = [
		[0.45, '#d9534f'],
		[0.3, '#5bc0de'],
		[0.25, '#f0ad4e'],
	] as const;
	let start = -Math.PI / 2;
	for (const [share, color] of slices) {
		const end = start + share * 2 * Math.PI;
		ctx.beginPath();
		ctx.moveTo(400, 320);
		ctx.arc(400, 320, 220, start, end);
		ctx.closePath();
		ctx.fillStyle = color;
		ctx.fill();
		start = end;
	}
	ctx.fillStyle = '#222222';
	ctx.font = 'bold 40px sans-serif';
	ctx.fillText('Market share', 270, 60);
	return canvas.toBuffer('image/png');
}

// A4 portrait handbook, one distinct visual per page. Keep in sync with tests/fixtures/labels.json.
async function handbookPdf(): Promise<Uint8Array> {
	const doc = await PDFDocument.create();
	doc.setCreationDate(new Date('2026-01-01T00:00:00Z'));
	doc.setModificationDate(new Date('2026-01-01T00:00:00Z'));
	doc.setProducer('obsidian-topk fixtures');
	doc.setCreator('scripts/make-fixtures.ts');
	const bold = await doc.embedFont(StandardFonts.HelveticaBold);
	const font = await doc.embedFont(StandardFonts.Helvetica);
	const mono = await doc.embedFont(StandardFonts.Courier);
	const PW = 595;
	const PH = 842;
	const ink = rgb(0.15, 0.15, 0.2);
	const accent = rgb(0.2, 0.4, 0.7);
	const add = (heading: string): PDFPage => {
		const page = doc.addPage([PW, PH]);
		page.drawText(heading, { x: 50, y: PH - 80, size: 26, font: bold, color: ink });
		return page;
	};
	const text = (
		page: PDFPage,
		value: string,
		x: number,
		y: number,
		size = 13,
		f: PDFFont = font,
	): void => {
		page.drawText(value, { x, y, size, font: f, color: ink });
	};

	// 1. Invoice table.
	let p = add('Invoice INV-2291');
	['Item', 'Qty', 'Price'].forEach((h, i) => text(p, h, 60 + i * 160, 680, 14, bold));
	[
		['Consulting', '12', '$1,800'],
		['Hosting', '1', '$240'],
		['Support', '3', '$450'],
	].forEach((row, r) => row.forEach((cell, c) => text(p, cell, 60 + c * 160, 650 - r * 30)));
	for (let r = 0; r <= 4; r++)
		p.drawLine({
			start: { x: 50, y: 700 - r * 30 },
			end: { x: 540, y: 700 - r * 30 },
			thickness: 1,
		});
	text(p, 'Total due: $2,490', 360, 520, 16, bold);

	// 2. Line chart.
	p = add('Monthly active users');
	const pts = [120, 160, 150, 210, 260, 300, 340];
	pts.forEach((v, i) => {
		const next = pts[i + 1];
		if (next !== undefined) {
			p.drawLine({
				start: { x: 80 + i * 70, y: 300 + v },
				end: { x: 150 + i * 70, y: 300 + next },
				thickness: 3,
				color: accent,
			});
		}
		p.drawCircle({ x: 80 + i * 70, y: 300 + v, size: 5, color: accent });
	});
	p.drawLine({ start: { x: 60, y: 400 }, end: { x: 560, y: 400 }, thickness: 1 });

	// 3. Timeline.
	p = add('Project timeline');
	p.drawLine({ start: { x: 60, y: 500 }, end: { x: 540, y: 500 }, thickness: 4, color: ink });
	['Kickoff', 'Design', 'Build', 'Launch'].forEach((m, i) => {
		p.drawCircle({ x: 80 + i * 150, y: 500, size: 10, color: accent });
		text(p, m, 60 + i * 150, 470);
		text(p, `Q${i + 1} 2026`, 60 + i * 150, 530, 11);
	});

	// 4. Org chart.
	p = add('Team org chart');
	const node = (label: string, x: number, y: number): void => {
		p.drawRectangle({ x, y, width: 140, height: 50, borderColor: accent, borderWidth: 2 });
		text(p, label, x + 12, y + 20);
	};
	node('CEO', 228, 620);
	['Engineering', 'Sales', 'Design'].forEach((label, i) => {
		node(label, 50 + i * 180, 480);
		p.drawLine({ start: { x: 298, y: 620 }, end: { x: 120 + i * 180, y: 530 }, thickness: 2 });
	});

	// 5. Code listing.
	p = add('Code: binary search');
	[
		'def binary_search(xs, target):',
		'    lo, hi = 0, len(xs) - 1',
		'    while lo <= hi:',
		'        mid = (lo + hi) // 2',
		'        if xs[mid] == target:',
		'            return mid',
		'        if xs[mid] < target:',
		'            lo = mid + 1',
		'        else:',
		'            hi = mid - 1',
		'    return -1',
	].forEach((line, i) => text(p, line, 60, 700 - i * 22, 13, mono));

	// 6. Venn diagram.
	p = add('Venn diagram: skills overlap');
	p.drawCircle({
		x: 240,
		y: 450,
		size: 130,
		borderColor: accent,
		borderWidth: 3,
		opacity: 0.4,
		color: rgb(0.7, 0.8, 1),
	});
	p.drawCircle({
		x: 360,
		y: 450,
		size: 130,
		borderColor: rgb(0.7, 0.3, 0.3),
		borderWidth: 3,
		opacity: 0.4,
		color: rgb(1, 0.8, 0.8),
	});
	text(p, 'Math', 160, 450, 16, bold);
	text(p, 'Code', 400, 450, 16, bold);

	// 7. Scatter plot.
	p = add('Scatter plot: latency vs load');
	for (let i = 0; i < 40; i++) {
		const x = 80 + ((i * 37) % 440);
		const y = 300 + ((i * i * 13) % 300);
		p.drawCircle({ x, y, size: 4, color: rgb(0.8, 0.3, 0.2) });
	}

	// 8. Network graph.
	p = add('Network graph of services');
	const nodes = [
		[150, 600],
		[400, 620],
		[280, 450],
		[120, 350],
		[450, 380],
	] as const;
	[
		[0, 1],
		[0, 2],
		[1, 2],
		[2, 3],
		[2, 4],
		[1, 4],
	].forEach(([a, b]) => {
		const na = nodes[a ?? 0];
		const nb = nodes[b ?? 0];
		if (na && nb)
			p.drawLine({
				start: { x: na[0], y: na[1] },
				end: { x: nb[0], y: nb[1] },
				thickness: 2,
			});
	});
	nodes.forEach(([x, y]) => p.drawCircle({ x, y, size: 22, color: rgb(0.3, 0.6, 0.4) }));

	// 9. Gantt chart.
	p = add('Gantt chart for the migration');
	[
		['Audit', 0, 2],
		['Schema', 1, 3],
		['Backfill', 3, 4],
		['Cutover', 6, 1],
	].forEach(([label, start, len], i) => {
		text(p, String(label), 50, 680 - i * 50);
		p.drawRectangle({
			x: 150 + Number(start) * 50,
			y: 675 - i * 50,
			width: Number(len) * 50,
			height: 22,
			color: accent,
		});
	});

	// 10. Checklist.
	p = add('Launch checklist');
	['Write the blog post', 'Record the demo GIF', 'Tag the release', 'Post to the forum'].forEach(
		(item, i) => {
			p.drawRectangle({
				x: 60,
				y: 676 - i * 40,
				width: 18,
				height: 18,
				borderColor: ink,
				borderWidth: 2,
			});
			if (i < 2) text(p, 'x', 64, 680 - i * 40, 14, bold);
			text(p, item, 95, 680 - i * 40, 15);
		},
	);

	// 11. Floor plan.
	p = add('Office floor plan');
	p.drawRectangle({ x: 60, y: 250, width: 470, height: 420, borderColor: ink, borderWidth: 4 });
	p.drawLine({ start: { x: 300, y: 250 }, end: { x: 300, y: 670 }, thickness: 3 });
	p.drawLine({ start: { x: 60, y: 450 }, end: { x: 300, y: 450 }, thickness: 3 });
	text(p, 'Kitchen', 120, 550);
	text(p, 'Meeting room', 110, 350);
	text(p, 'Open space', 370, 450);

	// 12. Equation.
	p = add('Attention equation');
	text(p, 'Attention(Q, K, V) = softmax(Q K^T / sqrt(d_k)) V', 60, 600, 16, mono);

	// 13. Stacked bars.
	p = add('Cloud cost by service');
	[
		[80, 40, 20],
		[100, 50, 30],
		[90, 70, 25],
	].forEach((stack, i) => {
		let y = 250;
		stack.forEach((h, j) => {
			p.drawRectangle({
				x: 120 + i * 140,
				y,
				width: 80,
				height: h * 2,
				color: [accent, rgb(0.9, 0.6, 0.2), rgb(0.5, 0.5, 0.5)][j] ?? ink,
			});
			y += h * 2;
		});
	});

	// 14. Sequence diagram.
	p = add('Login sequence diagram');
	['Browser', 'API', 'Database'].forEach((actor, i) => {
		text(p, actor, 80 + i * 180, 700, 14, bold);
		p.drawLine({
			start: { x: 110 + i * 180, y: 690 },
			end: { x: 110 + i * 180, y: 300 },
			thickness: 1,
			dashArray: [6, 4],
		});
	});
	[
		[0, 1, 'POST /login'],
		[1, 2, 'SELECT user'],
		[2, 1, 'row'],
		[1, 0, '200 token'],
	].forEach(([a, b, label], i) => {
		const y = 640 - i * 70;
		arrowBetween(p, 110 + Number(a) * 180, 110 + Number(b) * 180, y);
		text(p, String(label), 130 + Math.min(Number(a), Number(b)) * 180, y + 8, 11);
	});

	// 15. Plain prose (the text-only control).
	p = add('Meeting notes');
	[
		'We agreed to ship the beta to ten testers next week.',
		'Pricing stays unchanged until the benchmark is published.',
		'Follow up with the design team about the onboarding flow.',
	].forEach((line, i) => text(p, line, 50, 700 - i * 26));

	return doc.save({ useObjectStreams: false });
}

function arrowBetween(page: PDFPage, x1: number, x2: number, y: number): void {
	const dir = x2 > x1 ? 1 : -1;
	page.drawLine({ start: { x: x1, y }, end: { x: x2, y }, thickness: 2 });
	page.drawLine({ start: { x: x2, y }, end: { x: x2 - dir * 10, y: y + 6 }, thickness: 2 });
	page.drawLine({ start: { x: x2, y }, end: { x: x2 - dir * 10, y: y - 6 }, thickness: 2 });
}

function sunsetWebp(): Buffer {
	const canvas = createCanvas(1200, 800);
	const ctx = canvas.getContext('2d');
	const sky = ctx.createLinearGradient(0, 0, 0, 800);
	sky.addColorStop(0, '#ff7e5f');
	sky.addColorStop(1, '#2b1055');
	ctx.fillStyle = sky;
	ctx.fillRect(0, 0, 1200, 800);
	ctx.fillStyle = '#ffd56b';
	ctx.beginPath();
	ctx.arc(600, 560, 140, 0, Math.PI * 2);
	ctx.fill();
	ctx.fillStyle = '#1b1b2f';
	ctx.beginPath();
	ctx.moveTo(0, 800);
	ctx.lineTo(300, 520);
	ctx.lineTo(560, 760);
	ctx.lineTo(850, 480);
	ctx.lineTo(1200, 800);
	ctx.closePath();
	ctx.fill();
	return canvas.toBuffer('image/webp');
}

writeFileSync(join(vault, 'Talks', 'talk.pdf'), await talkPdf());
mkdirSync(join(vault, 'Docs'), { recursive: true });
mkdirSync(join(vault, 'Photos'), { recursive: true });
writeFileSync(join(vault, 'Docs', 'handbook.pdf'), await handbookPdf());
writeFileSync(join(vault, 'Photos', 'sunset.webp'), sunsetWebp());
writeFileSync(join(vault, 'market-share.png'), piePng());
writeFileSync(
	join(vault, 'Welcome.md'),
	'# Fixture vault\n\nGenerated by `scripts/make-fixtures.ts`. See [[Talks/talk.pdf#page=3]].\n',
);
console.log('fixtures written to', vault);
