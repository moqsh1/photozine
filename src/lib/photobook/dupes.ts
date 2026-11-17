export async function imageHash(blob: Blob): Promise<string> {
  const bitmap = await createImageBitmap(blob);
  try {
    const width = 9;
    const height = 8;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("Could not read the photo.");
    ctx.drawImage(bitmap, 0, 0, width, height);
    const data = ctx.getImageData(0, 0, width, height).data;
    let bits = "";
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width - 1; x += 1) {
        const left = y * width + x;
        const right = left + 1;
        const tone = (index: number) => data[index * 4] * 0.299 + data[index * 4 + 1] * 0.587 + data[index * 4 + 2] * 0.114;
        bits += tone(left) < tone(right) ? "1" : "0";
      }
    }
    return bits;
  } finally {
    bitmap.close();
  }
}

function hamming(a: string, b: string): number {
  let count = 0;
  const length = Math.min(a.length, b.length);
  for (let i = 0; i < length; i += 1) if (a[i] !== b[i]) count += 1;
  return count + Math.abs(a.length - b.length);
}

export type DupeItem = { id: string; hash: string; placed: boolean; seq: number };

export function duplicateIds(items: DupeItem[], maxDistance = 4): { loose: string[]; groups: string[][] } {
  const parent = items.map((_, index) => index);
  const find = (index: number): number => (parent[index] === index ? index : (parent[index] = find(parent[index])));
  const join = (a: number, b: number) => {
    const left = find(a);
    const right = find(b);
    if (left !== right) parent[left] = right;
  };
  for (let i = 0; i < items.length; i += 1) {
    for (let j = i + 1; j < items.length; j += 1) {
      if (hamming(items[i].hash, items[j].hash) <= maxDistance) join(i, j);
    }
  }
  const grouped = new Map<number, DupeItem[]>();
  items.forEach((item, index) => {
    const key = find(index);
    const list = grouped.get(key);
    if (list) list.push(item);
    else grouped.set(key, [item]);
  });
  const loose: string[] = [];
  const groups: string[][] = [];
  for (const group of grouped.values()) {
    if (group.length < 2) continue;
    groups.push(group.map((item) => item.id));
    const placed = group.filter((item) => item.placed).sort((a, b) => a.seq - b.seq);
    const keep = new Set(placed.map((item) => item.id));
    if (keep.size === 0) {
      const first = group.slice().sort((a, b) => a.seq - b.seq)[0];
      if (first) keep.add(first.id);
    }
    for (const item of group) if (!keep.has(item.id)) loose.push(item.id);
  }
  return { loose, groups };
}
