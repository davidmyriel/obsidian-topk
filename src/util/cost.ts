// Cost estimate shown before uploading. Prices are TopK's published list prices (topk.io/pricing
// and the topk-embed-v1 announcement), read 2026-10-30; see docs/spikes/E-topk-embed-v1.md.

export const PRICES = {
	/** Image embedding, production topk-embed-v1, per image. */
	embedPerImage: 0.075 / 1000,
	/** Write data, per GiB written. */
	writePerGiB: 0.5,
	/** Write requests, per request. */
	writePerRequest: 0.01 / 1000,
	/** Storage, per GiB-month. */
	storagePerGiBMonth: 0.1,
} as const;

/**
 * Average upload per page at the full pixel budget, measured in Spike E: slides 29–49 KB, dense
 * text pages about 190 KB. A middle value; the estimate is labelled "about".
 */
export const AVG_PAGE_BYTES = 120 * 1024;

const GiB = 1024 ** 3;

export interface CostEstimate {
	oneTime: number;
	perMonth: number;
}

export function estimateCost(
	pages: number,
	options: { avgPageBytes?: number; batchBytes?: number } = {},
): CostEstimate {
	const bytes = pages * (options.avgPageBytes ?? AVG_PAGE_BYTES);
	const requests = Math.ceil(bytes / (options.batchBytes ?? 4 * 1024 * 1024));
	return {
		oneTime:
			pages * PRICES.embedPerImage +
			(bytes / GiB) * PRICES.writePerGiB +
			requests * PRICES.writePerRequest,
		perMonth: (bytes / GiB) * PRICES.storagePerGiBMonth,
	};
}

/** "$0.12", or "less than $0.01" for tiny amounts. */
export function formatUsd(amount: number): string {
	if (amount < 0.01) return 'less than $0.01';
	return `$${amount.toFixed(2)}`;
}

/** One sentence for a confirmation dialog. */
export function costSentence(pages: number): string {
	const { oneTime, perMonth } = estimateCost(pages);
	const index =
		oneTime < 0.01 ? 'less than a cent to index' : `about ${formatUsd(oneTime)} to index`;
	const store =
		perMonth < 0.01
			? 'under a cent a month to store'
			: `about ${formatUsd(perMonth)} a month to store`;
	return `Estimated TopK cost: ${index}, ${store}.`;
}
