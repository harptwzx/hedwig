// tools/gen_terrain.mjs — 生成 /tscn2 的程序化地形高度图（二进制，供网页加载）
// 用法：node tools/gen_terrain.mjs
// 输出：public/tscn2/assets/terrain.bin
// 格式：256x256 的 Uint16 小端，行主序（先 x 后 z），
//       h = H_MIN + v / 65535 * (H_MAX - H_MIN)
//       ix = round((x + SIZE/2) / SIZE * (N-1))，iz 同理
// 修改地形请同时更新本文件和 public/tscn2/index.html 里的同名参数。

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const TERRAIN = {
  seed: 20240517,
  size: 400,
  grid: 256,
  mountainHeight: 58,
  hills: [
    { x: -140, z: -70, r: 95, h: 26 },
    { x: -40, z: -140, r: 120, h: 30 },
    { x: 150, z: -90, r: 105, h: 24 },
    { x: 165, z: 120, r: 125, h: 18 },
    { x: -160, z: 130, r: 135, h: 16 },
    { x: -20, z: 150, r: 110, h: 14 },
  ],
  lake: { x: -58, z: 30, r: 54 },
  village: { x: 40, z: 22, r: 42, y: 5.5 },
  waterLevel: 2.2,
  H_MIN: -15,
  H_MAX: 95,
};

function hash2(ix, iz, seed) {
  let h = (ix * 374761393 + iz * 668265263 + seed * 5011) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const smooth = t => t * t * (3 - 2 * t);
function valueNoise(x, z, seed) {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = x - ix, fz = z - iz;
  const a = hash2(ix, iz, seed), b = hash2(ix + 1, iz, seed);
  const c = hash2(ix, iz + 1, seed), d = hash2(ix + 1, iz + 1, seed);
  const u = smooth(fx), v = smooth(fz);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, z, seed, oct = 4) {
  let s = 0, amp = 0.5, f = 1, n = 0;
  for (let i = 0; i < oct; i++) { s += valueNoise(x * f, z * f, seed + i * 101) * amp; n += amp; amp *= 0.5; f *= 2.03; }
  return s / n;
}

export function makeHeightAt(cfg = TERRAIN) {
  return function heightAt(x, z) {
    const nx = x / cfg.size, nz = z / cfg.size;
    let h = fbm(nx * 2.4 + 11.3, nz * 2.4 + 5.7, cfg.seed, 4) * 4.5;
    h += fbm(nx * 6.0 + 3.1, nz * 6.0 + 9.9, cfg.seed + 77, 3) * 2.0;
    h += fbm(nx * 13.0 + 1.7, nz * 13.0 + 4.3, cfg.seed + 200, 2) * 0.8;
    for (const hi of cfg.hills) {
      const d = Math.hypot(x - hi.x, z - hi.z) / hi.r;
      h += hi.h * Math.max(0, 1 - d * d) ** 1.6;
    }
    const mnt = smooth(Math.min(Math.max((-z - 60) / 190, 0), 1));
    const ridge = 1 - Math.abs(2 * fbm(nx * 2.2 + 21.0, nz * 2.2 + 4.0, cfg.seed + 555, 4) - 1);
    h += mnt * (ridge * ridge * cfg.mountainHeight * 0.75 + fbm(nx * 4 + 2, nz * 4 + 8, cfg.seed + 9, 3) * cfg.mountainHeight * 0.35);
    const dl = Math.hypot(x - cfg.lake.x, z - cfg.lake.z);
    const lakeT = smooth(Math.min(Math.max((dl - cfg.lake.r * 0.55) / (cfg.lake.r * 0.75), 0), 1));
    h = h * lakeT + (cfg.waterLevel - 4.0) * (1 - lakeT);
    const dv = Math.hypot(x - cfg.village.x, z - cfg.village.z);
    const vT = smooth(Math.min(Math.max((dv - cfg.village.r * 0.55) / 22, 0), 1));
    h = h * vT + cfg.village.y * (1 - vT);
    return h;
  };
}

export function generateBuffer(cfg = TERRAIN) {
  const N = cfg.grid;
  const heightAt = makeHeightAt(cfg);
  const out = Buffer.alloc(N * N * 2);
  let k = 0;
  for (let iz = 0; iz < N; iz++) {
    const z = -cfg.size / 2 + (iz / (N - 1)) * cfg.size;
    for (let ix = 0; ix < N; ix++) {
      const x = -cfg.size / 2 + (ix / (N - 1)) * cfg.size;
      const h = heightAt(x, z);
      const v = Math.max(0, Math.min(65535, Math.round((h - cfg.H_MIN) / (cfg.H_MAX - cfg.H_MIN) * 65535)));
      out.writeUInt16LE(v, k); k += 2;
    }
  }
  return out;
}

function main() {
  const root = path.resolve(__dirname, '..');
  const outPath = path.join(root, 'public/tscn2/assets/terrain.bin');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const buf = generateBuffer();
  fs.writeFileSync(outPath, buf);
  console.log('wrote', outPath, (buf.length / 1024).toFixed(0) + 'KB');
}

if (process.argv[1] && process.argv[1].endsWith('gen_terrain.mjs')) main();
