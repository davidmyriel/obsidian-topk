// Vault path filters: include folders and exclude globs. Paths are vault-relative with "/".

/** Converts a glob to an anchored RegExp. Supports `**`, `*` and `?`. */
export function globToRegExp(glob: string): RegExp {
	let re = '';
	for (let i = 0; i < glob.length; i++) {
		const ch = glob.charAt(i);
		if (ch === '*') {
			if (glob.charAt(i + 1) === '*') {
				i++;
				if (glob.charAt(i + 1) === '/') {
					i++;
					re += '(?:.*/)?'; // "**/" matches zero or more folders
				} else {
					re += '.*';
				}
			} else {
				re += '[^/]*';
			}
		} else if (ch === '?') {
			re += '[^/]';
		} else {
			re += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
		}
	}
	return new RegExp(`^${re}$`);
}

export function normalizeFolder(folder: string): string {
	return folder.trim().replace(/^\/+|\/+$/g, '');
}

export interface PathFilter {
	includeFolders: string[];
	excludeGlobs: string[];
}

/** True when the path is inside an include folder (or none are set) and matches no exclude glob. */
export function compileFilter(filter: PathFilter): (path: string) => boolean {
	const folders = filter.includeFolders.map(normalizeFolder).filter((f) => f.length > 0);
	const excludes = filter.excludeGlobs
		.map((g) => g.trim())
		.filter((g) => g.length > 0)
		.map(globToRegExp);
	return (path) => {
		if (folders.length > 0 && !folders.some((f) => path === f || path.startsWith(`${f}/`))) {
			return false;
		}
		return !excludes.some((re) => re.test(path));
	};
}

/** Splits a settings textarea (one entry per line, commas allowed) into entries. */
export function parseList(text: string): string[] {
	return text
		.split(/[\n,]/)
		.map((s) => s.trim())
		.filter((s) => s.length > 0);
}
