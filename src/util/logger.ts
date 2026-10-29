// Debug logger that never prints secrets. Registered secrets are replaced verbatim, and anything
// shaped like an API key (a long mixed-case alphanumeric run) is masked as a fallback. Lowercase
// hex, such as content hashes, is left alone.

const KEY_SHAPED = /\b(?=[A-Za-z0-9]*[a-z])(?=[A-Za-z0-9]*[A-Z])[A-Za-z0-9_-]{32,}\b/g;
const BEARER = /(Bearer\s+)\S+/gi;

export function redact(text: string, secrets: Iterable<string> = []): string {
	let out = text;
	for (const secret of secrets) {
		if (secret.length >= 8) out = out.split(secret).join('[redacted]');
	}
	return out.replace(BEARER, '$1[redacted]').replace(KEY_SHAPED, '[redacted]');
}

export class Logger {
	private readonly secrets = new Set<string>();
	enabled = false;

	constructor(private readonly prefix = '[topk-visual-search]') {}

	addSecret(secret: string | null | undefined): void {
		if (secret) this.secrets.add(secret);
	}

	debug(message: string, ...details: unknown[]): void {
		if (!this.enabled) return;
		const text = [
			message,
			...details.map((d) => (typeof d === 'string' ? d : safeJson(d))),
		].join(' ');
		console.debug(this.prefix, redact(text, this.secrets));
	}
}

function safeJson(value: unknown): string {
	try {
		return JSON.stringify(value, (_k, v: unknown) =>
			typeof v === 'bigint' ? v.toString() : v,
		);
	} catch {
		return String(value);
	}
}
