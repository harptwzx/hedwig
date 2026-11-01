// tools/gen_terrain.mjs — 生成 /tscn2 的地形预设
// 用法：node tools/gen_terrain.mjs
// 输出：
//   public/tscn2/assets/presets.json         （网页读取，含调色板/湖泊/村庄/植被等参数）
//   public/tscn2/assets/terrain-<id>.bin     （每套预设的高度图：256x256 Uint16 小端，行主序先 x 后 z）
//       h = H_MIN + v / 65535 * (H_MAX - H_MIN)
//       ix = round((x + SIZE/2) / SIZE * (grid-1))，iz 同理
// 修改地形/新增预设后重跑本脚本，并提交生成物。

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const H_MIN = -15;
export const H_MAX = 110;
export const GRID = 256;

// ---------------------------------------------------------------
// 预设定义
// ---------------------------------------------------------------
export const PRESETS = [
  {
    id: 'lakeside',
    name: '湖畔村庄',
    seed: 20240517,
    size: 400,
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
    sandBand: 0.35,
    snowStart: 0.78,
    palette: { grass: 0x6d9a4a, grass2: 0x557f3a, rock: 0x9aa0a2, sand: 0xc9b184, snow: 0xe8eef2, water: 0x4f9fd4 },
    skyTop: 0x5b93d1, skyHorizon: 0xbcd9f0, fogNear: 150, fogFar: 460,
    groves: 70, treeDensity: 1.0, rockCount: 60,
    treeMix: { 'tree-high': 0.45, 'tree': 0.35, 'tree-high-crooked': 0.20 },
  },
  {
    id: 'alpine',
    name: '高山松林',
    seed: 917311,
    size: 400,
    mountainHeight: 92,
    hills: [
      { x: -120, z: -90, r: 110, h: 44 },
      { x: 30, z: -150, r: 130, h: 52 },
      { x: 150, z: -70, r: 115, h: 40 },
      { x: 170, z: 120, r: 130, h: 26 },
      { x: -170, z: 120, r: 140, h: 30 },
      { x: -30, z: 140, r: 120, h: 22 },
    ],
    lake: { x: -30, z: 60, r: 44 },
    village: { x: 70, z: 70, r: 40, y: 9 },
    waterLevel: 2.4,
    sandBand: 0.5,
    snowStart: 0.55,
    palette: { grass: 0x5f8f52, grass2: 0x446c3f, rock: 0x8f979c, sand: 0xbdb08d, snow: 0xf0f4f7, water: 0x3f86b8 },
    skyTop: 0x4a86c8, skyHorizon: 0xc3d7e8, fogNear: 160, fogFar: 520,
    groves: 90, treeDensity: 1.25, rockCount: 95,
    treeMix: { 'tree-high': 0.55, 'tree-high-crooked': 0.3, 'tree': 0.15 },
  },
  {
    id: 'island',
    name: '热带海岛',
    seed: 420777,
    size: 400,
    mountainHeight: 42,
    coast: { r: 140, depth: 16 },
    hills: [
      { x: 0, z: 0, r: 150, h: 30 },
      { x: -70, z: -60, r: 60, h: 7 },
      { x: 75, z: -35, r: 55, h: 6 },
    ],
    village: { x: 0, z: 0, r: 30, y: 26 },
    waterLevel: 4.0,
    sandBand: 1.0,
    snowStart: 2,
    palette: { grass: 0x7ba84e, grass2: 0x5c8c3c, rock: 0xa09a8c, sand: 0xe4d49c, snow: 0xffffff, water: 0x2eb3c8 },
    skyTop: 0x3fa4cf, skyHorizon: 0xd2efe9, fogNear: 170, fogFar: 560,
    groves: 30, treeDensity: 0.55, rockCount: 34,
    treeMix: { 'tree': 0.5, 'tree-high': 0.3, 'tree-high-crooked': 0.2 },
  },
  {
    id: 'autumn',
    name: '秋日丘陵',
    seed: 555001,
    size: 400,
    mountainHeight: 50,
    hills: [
      { x: -130, z: -80, r: 100, h: 26 },
      { x: 0, z: -150, r: 125, h: 30 },
      { x: 140, z: -80, r: 100, h: 22 },
      { x: 150, z: 120, r: 120, h: 20 },
      { x: -150, z: 120, r: 130, h: 20 },
      { x: -10, z: 150, r: 115, h: 16 },
    ],
    lake: { x: -70, z: 40, r: 46 },
    village: { x: 45, z: 30, r: 40, y: 6.5 },
    waterLevel: 2.2,
    sandBand: 0.6,
    snowStart: 0.85,
    palette: { grass: 0xa79b52, grass2: 0x7d7a3c, rock: 0x94897c, sand: 0xcdb98a, snow: 0xf2eee6, water: 0x4a8fb0 },
    skyTop: 0xd09a5a, skyHorizon: 0xf2e2c4, fogNear: 150, fogFar: 470,
    groves: 85, treeDensity: 1.3, rockCount: 55,
    treeMix: { 'tree': 0.5, 'tree-high-crooked': 0.3, 'tree-high': 0.2 },
  },
];

// ---------------------------------------------------------------
// 噪声
// ---------------------------------------------------------------
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

// 返回某预设的高度函数（网页端使用同一份逻辑，见 index.html 的 makeHeightAt）
export function makeHeightAt(cfg, seedOverride) {
  const seed = seedOverride == null ? cfg.seed : seedOverride;
  return function heightAt(x, z) {
    const nx = x / cfg.size, nz = z / cfg.size;
    let h = fbm(nx * 2.4 + 11.3, nz * 2.4 + 5.7, seed, 4) * 4.5;
    h += fbm(nx * 6.0 + 3.1, nz * 6.0 + 9.9, seed + 77, 3) * 2.0;
    h += fbm(nx * 13.0 + 1.7, nz * 13.0 + 4.3, seed + 200, 2) * 0.8;
    for (const hi of cfg.hills) {
      const d = Math.hypot(x - hi.x, z - hi.z) / hi.r;
      h += hi.h * Math.max(0, 1 - d * d) ** 1.6;
    }
    const mnt = smooth(Math.min(Math.max((-z - 60) / 190, 0), 1));
    const ridge = 1 - Math.abs(2 * fbm(nx * 2.2 + 21.0, nz * 2.2 + 4.0, seed + 555, 4) - 1);
    h += mnt * (ridge * ridge * cfg.mountainHeight * 0.75 + fbm(nx * 4 + 2, nz * 4 + 8, seed + 9, 3) * cfg.mountainHeight * 0.35);
    if (cfg.lake) {
      const dl = Math.hypot(x - cfg.lake.x, z - cfg.lake.z);
      const lakeT = smooth(Math.min(Math.max((dl - cfg.lake.r * 0.55) / (cfg.lake.r * 0.75), 0), 1));
      h = h * lakeT + (cfg.waterLevel - 4.0) * (1 - lakeT);
    }
    if (cfg.coast) {
      const d = Math.hypot(x, z);
      const t = smooth(Math.min(Math.max((d - cfg.coast.r * 0.82) / (cfg.coast.r * 0.30), 0), 1));
      h = h * (1 - t) + (cfg.waterLevel - cfg.coast.depth) * t;
    }
    const dv = Math.hypot(x - cfg.village.x, z - cfg.village.z);
    const vT = smooth(Math.min(Math.max((dv - cfg.village.r * 0.55) / 22, 0), 1));
    h = h * vT + cfg.village.y * (1 - vT);
    return h;
  };
}

export function generateBuffer(cfg, seedOverride) {
  const N = GRID;
  const heightAt = makeHeightAt(cfg, seedOverride);
  const out = Buffer.alloc(N * N * 2);
  let k = 0;
  for (let iz = 0; iz < N; iz++) {
    const z = -cfg.size / 2 + (iz / (N - 1)) * cfg.size;
    for (let ix = 0; ix < N; ix++) {
      const x = -cfg.size / 2 + (ix / (N - 1)) * cfg.size;
      const h = heightAt(x, z);
      const v = Math.max(0, Math.min(65535, Math.round((h - H_MIN) / (H_MAX - H_MIN) * 65535)));
      out.writeUInt16LE(v, k); k += 2;
    }
  }
  return out;
}

function main() {
  const root = path.resolve(__dirname, '..');
  const outDir = path.join(root, 'public/tscn2/assets');
  fs.mkdirSync(outDir, { recursive: true });

  const meta = {
    grid: GRID, hMin: H_MIN, hMax: H_MAX,
    generated: 'node tools/gen_terrain.mjs',
    presets: [],
  };
  for (const cfg of PRESETS) {
    const buf = generateBuffer(cfg);
    const file = `terrain-${cfg.id}.bin`;
    fs.writeFileSync(path.join(outDir, file), buf);
    const { hills, lake, coast, village, palette, treeMix, ...rest } = cfg;
    meta.presets.push({
      ...rest,
      hills, lake: lake || null, coast: coast || null, village,
      palette, treeMix,
      file,
    });
    console.log('wrote', file, (buf.length / 1024).toFixed(0) + 'KB');
  }
  fs.writeFileSync(path.join(outDir, 'presets.json'), JSON.stringify(meta, null, 2));
  console.log('wrote presets.json', meta.presets.length, 'presets');
}

if (process.argv[1] && process.argv[1].endsWith('gen_terrain.mjs')) main();
