export async function loadBundledAsset(url) {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`Failed to load bundled asset ${url}: HTTP ${resp.status}`);
    return new Uint8Array(await resp.arrayBuffer());
}
