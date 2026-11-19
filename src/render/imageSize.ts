// Width and height from an image's header, without decoding it. Planning uses this to count the
// tiles of tall images up front, so the cost preview and progress are right (beta 1 F6).

export interface ImageSize {
	width: number;
	height: number;
}

/** PNG, JPEG or WebP dimensions as stored, or null when the header is not recognised. */
export function imageSize(bytes: Uint8Array): ImageSize | null {
	return pngSize(bytes) ?? jpegSize(bytes) ?? webpSize(bytes);
}

const u16be = (b: Uint8Array, i: number): number => ((b[i] ?? 0) << 8) | (b[i + 1] ?? 0);
const u16le = (b: Uint8Array, i: number): number => (b[i] ?? 0) | ((b[i + 1] ?? 0) << 8);
const u24le = (b: Uint8Array, i: number): number => u16le(b, i) | ((b[i + 2] ?? 0) << 16);
const u32be = (b: Uint8Array, i: number): number => u16be(b, i) * 0x10000 + u16be(b, i + 2);
const text = (b: Uint8Array, from: number, to: number): string =>
	String.fromCharCode(...b.subarray(from, to));

const valid = (width: number, height: number): ImageSize | null =>
	width > 0 && height > 0 ? { width, height } : null;

function pngSize(b: Uint8Array): ImageSize | null {
	if (b.length < 24 || b[0] !== 0x89 || text(b, 1, 4) !== 'PNG' || text(b, 12, 16) !== 'IHDR')
		return null;
	return valid(u32be(b, 16), u32be(b, 20));
}

function jpegSize(b: Uint8Array): ImageSize | null {
	if (b[0] !== 0xff || b[1] !== 0xd8) return null;
	let i = 2;
	while (i + 9 < b.length) {
		if (b[i] !== 0xff) return null;
		const marker = b[i + 1] ?? 0;
		if (marker === 0xff) {
			i++; // fill byte
			continue;
		}
		// SOF0..SOF15, except DHT (C4), JPG (C8) and DAC (CC), carry the frame size.
		if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
			return valid(u16be(b, i + 7), u16be(b, i + 5));
		}
		if (marker === 0xd9 || marker === 0xda) return null; // end of image or start of scan
		i += 2 + u16be(b, i + 2);
	}
	return null;
}

function webpSize(b: Uint8Array): ImageSize | null {
	if (b.length < 30 || text(b, 0, 4) !== 'RIFF' || text(b, 8, 12) !== 'WEBP') return null;
	const chunk = text(b, 12, 16);
	if (chunk === 'VP8 ') return valid(u16le(b, 26) & 0x3fff, u16le(b, 28) & 0x3fff);
	if (chunk === 'VP8L') {
		const bits =
			(b[21] ?? 0) | ((b[22] ?? 0) << 8) | ((b[23] ?? 0) << 16) | ((b[24] ?? 0) << 24);
		return valid((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1);
	}
	if (chunk === 'VP8X') return valid(u24le(b, 24) + 1, u24le(b, 27) + 1);
	return null;
}
