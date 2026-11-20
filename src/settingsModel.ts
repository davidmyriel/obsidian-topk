// Plugin settings and their validation. No obsidian import, so it is unit-testable.

export const REGIONS = [
	{ id: 'aws-us-east-1-elastica', label: 'AWS us-east-1 (N. Virginia)' },
	{ id: 'aws-eu-central-1-monstera', label: 'AWS eu-central-1 (Frankfurt)' },
	{ id: 'gcp-us-east4-aloe', label: 'GCP us-east4 (N. Virginia)' },
] as const;

/** topk-embed-v1 sees at most 1,280 visual tokens of 32×32 px; larger images are downscaled. */
export const MODEL_MAX_PIXELS = 1_310_720;

export const PIXEL_BUDGETS = [
	{ value: MODEL_MAX_PIXELS, label: 'Full detail (1.3 MP, recommended)' },
	{ value: MODEL_MAX_PIXELS / 2, label: 'Smaller uploads (0.66 MP)' },
] as const;

export interface Settings {
	/** Name of the secret in Obsidian's secret storage that holds the TopK API key. */
	apiKeySecret: string;
	region: string;
	/** Optional origin override, e.g. a local mock for tests. Empty means the region's endpoint. */
	endpoint: string;
	collection: string;
	includeFolders: string[];
	excludeGlobs: string[];
	maxPagesPerFile: number;
	/** Upper bound on width × height of uploaded page images (ADR-003). */
	maxPixels: number;
	/** Upload requests in flight at once (1–8). */
	concurrency: number;
	/** Re-index in the background when files change and at startup (ADR-005). */
	autoIndex: boolean;
	/** Also upload Markdown notes and search them (ADR-007). Off unless the user opts in. */
	indexNotes: boolean;
	debugLog: boolean;
	/** Set once the user has confirmed the first-run upload dialog. */
	uploadConsent: boolean;
	/** Copy of the index state's vault id and key, so a corrupt state file keeps them (beta 1 F5). */
	vaultId: string;
	vaultKey: string;
}

export function defaultSettings(configDir: string): Settings {
	return {
		apiKeySecret: '',
		region: REGIONS[0].id,
		endpoint: '',
		collection: 'obsidian-visual-search',
		includeFolders: [],
		excludeGlobs: [`${configDir}/**`, '.trash/**'],
		maxPagesPerFile: 300,
		maxPixels: MODEL_MAX_PIXELS,
		concurrency: 4,
		autoIndex: true,
		indexNotes: false,
		debugLog: false,
		uploadConsent: false,
		vaultId: '',
		vaultKey: '',
	};
}

const COLLECTION_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

export function collectionNameError(name: string): string | null {
	if (!name) return 'Enter a collection name.';
	if (!COLLECTION_NAME.test(name)) {
		return 'Use letters, digits, "-" and "_" only, starting with a letter or digit.';
	}
	return null;
}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

/** "pages" → "pages-v2", "pages-v2" → "pages-v3": the collection that replaces an old one. */
export function nextCollectionName(name: string): string {
	const m = /^(.*)-v(\d+)$/.exec(name);
	const next = m ? `${m[1]}-v${Number(m[2]) + 1}` : `${name}-v2`;
	return next.length <= 128 ? next : `${next.slice(0, 120)}-v${Date.now() % 1000}`;
}

export function endpointError(endpoint: string): string | null {
	if (!endpoint) return null;
	try {
		const url = new URL(endpoint);
		if (url.protocol !== 'https:' && url.protocol !== 'http:')
			return 'Use an http or https URL.';
		// The API key travels in a header, so plain http is only allowed on this computer (F17).
		if (url.protocol === 'http:' && !LOOPBACK.has(url.hostname))
			return 'Use https. Plain http would send your API key unencrypted.';
		if (url.pathname !== '/' || url.search || url.hash)
			return 'Enter only the origin, e.g. https://host:443.';
		return null;
	} catch {
		return 'Enter a full URL, e.g. https://example.api.topk.io.';
	}
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
	typeof v === 'object' && v !== null && !Array.isArray(v);
const strings = (v: unknown): string[] | null =>
	Array.isArray(v) && v.every((x) => typeof x === 'string')
		? v.map((x) => x.trim()).filter(Boolean)
		: null;

/** Merges stored data over the defaults, dropping any field that is missing or invalid. */
export function loadSettings(raw: unknown, configDir: string): Settings {
	const s = defaultSettings(configDir);
	if (!isRecord(raw)) return s;
	if (typeof raw.apiKeySecret === 'string') s.apiKeySecret = raw.apiKeySecret;
	if (typeof raw.region === 'string' && REGIONS.some((r) => r.id === raw.region))
		s.region = raw.region;
	if (typeof raw.endpoint === 'string' && endpointError(raw.endpoint.trim()) === null)
		s.endpoint = raw.endpoint.trim();
	if (typeof raw.collection === 'string' && collectionNameError(raw.collection) === null)
		s.collection = raw.collection;
	s.includeFolders = strings(raw.includeFolders) ?? s.includeFolders;
	s.excludeGlobs = strings(raw.excludeGlobs) ?? s.excludeGlobs;
	if (
		typeof raw.maxPagesPerFile === 'number' &&
		Number.isInteger(raw.maxPagesPerFile) &&
		raw.maxPagesPerFile >= 1
	) {
		s.maxPagesPerFile = Math.min(raw.maxPagesPerFile, 10_000);
	}
	if (PIXEL_BUDGETS.some((b) => b.value === raw.maxPixels)) s.maxPixels = raw.maxPixels as number;
	if (
		typeof raw.concurrency === 'number' &&
		Number.isInteger(raw.concurrency) &&
		raw.concurrency >= 1
	) {
		s.concurrency = Math.min(raw.concurrency, 8);
	}
	if (typeof raw.autoIndex === 'boolean') s.autoIndex = raw.autoIndex;
	if (typeof raw.indexNotes === 'boolean') s.indexNotes = raw.indexNotes;
	if (typeof raw.debugLog === 'boolean') s.debugLog = raw.debugLog;
	if (typeof raw.uploadConsent === 'boolean') s.uploadConsent = raw.uploadConsent;
	if (typeof raw.vaultId === 'string') s.vaultId = raw.vaultId;
	if (typeof raw.vaultKey === 'string') s.vaultKey = raw.vaultKey;
	return s;
}
