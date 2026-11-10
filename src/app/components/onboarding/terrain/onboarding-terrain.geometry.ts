// Retained from the original terrain: fictional homepage training fixture.
// Smoothing, compression and broad ridge envelopes make this an illustration,
// not a chart from which daily values should be read.
const loads = [
  [0, 74, 49, 86, 29, 123, 49],
  [48, 101, 0, 67, 82, 130, 53],
  [0, 85, 107, 45, 0, 215, 113],
  [51, 0, 147, 77, 102, 0, 262],
  [0, 54, 36, 63, 21, 90, 36],
  [45, 95, 0, 63, 77, 122, 50],
  [0, 83, 105, 44, 0, 209, 110],
  [53, 0, 152, 79, 106, 0, 271],
  [0, 131, 88, 153, 51, 219, 88],
  [36, 76, 0, 50, 61, 97, 40],
  [0, 75, 95, 40, 0, 190, 100],
  [38, 112, 64, 0, 94, 186, 78]
];
const smoothLoads = loads.map((row, u) =>
  row.map((_, v) => {
    let value = 0,
      weight = 0;
    for (let du = -2; du <= 2; du++)
      for (let dv = -2; dv <= 2; dv++) {
        const w = Math.exp(-((du * du) / 0.95 + (dv * dv) / 1.5));
        value +=
          loads[Math.max(0, Math.min(11, u + du))][
            Math.max(0, Math.min(6, v + dv))
          ] * w;
        weight += w;
      }
    return value / weight;
  })
);
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
const smooth = (t: number) => t * t * (3 - 2 * t);
function sample(u: number, v: number) {
  u = clamp(u, 0, 11);
  v = clamp(v, 0, 6);
  const i = Math.min(10, Math.floor(u)),
    j = Math.min(5, Math.floor(v)),
    a = smooth(u - i),
    b = smooth(v - j);
  return (
    ((1 - a) * ((1 - b) * smoothLoads[i][j] + b * smoothLoads[i][j + 1]) +
      a * ((1 - b) * smoothLoads[i + 1][j] + b * smoothLoads[i + 1][j + 1])) /
    210
  );
}
const gaussian = (d: number, s: number) => Math.exp((-d * d) / (s * s));
const hash = (x: number, z: number) => {
  const n = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return n - Math.floor(n);
};
function noise(x: number, z: number) {
  const i = Math.floor(x),
    j = Math.floor(z),
    a = smooth(x - i),
    b = smooth(z - j);
  return (
    (1 - a) * ((1 - b) * hash(i, j) + b * hash(i, j + 1)) +
    a * ((1 - b) * hash(i + 1, j) + b * hash(i + 1, j + 1))
  );
}
function height(x: number, z: number) {
  const data = sample(((x + 18) / 36) * 11, ((z + 29) / 42) * 6);
  const horizon =
    gaussian(z + 47 - Math.sin(x * 0.18) * 2, 7.5) *
    (4.1 + Math.sin(x * 0.21 + 1.3) * 1.3 + Math.sin(x * 0.43) * 0.55);
  const back =
    gaussian(z + 29 + Math.sin(x * 0.14) * 3, 6) *
    (1.8 + Math.sin(x * 0.23) * 0.7);
  const crestA = gaussian(x + 7, 7) * gaussian(z + 19, 5.5) * 7.4;
  const crestB = gaussian(x - 11, 8) * gaussian(z + 29, 6) * 8.8;
  const crestC = gaussian(x + 24, 10) * gaussian(z + 31, 7) * 6.2;
  const middle =
    gaussian(z + 9 - Math.sin(x * 0.16) * 4, 5) * (1.2 + data * 2.3);
  const shoulder = gaussian(x - 14, 6) * gaussian(z + 7, 6) * 3.3;
  const front =
    gaussian(z - 3 + Math.sin(x * 0.15 + 1) * 3, 8) * (0.35 + data * 0.8);
  const macro =
    horizon + back + crestA + crestB + crestC + middle + shoulder + front;
  const ridged = 1 - Math.abs(noise(x * 0.26, z * 0.26) * 2 - 1);
  const fine = noise(x * 0.71, z * 0.71) - 0.5;
  return (
    -0.85 +
    macro * (0.83 + data * 0.22) +
    (ridged - 0.45) * (0.25 + macro * 0.17) +
    fine * (0.12 + macro * 0.035)
  );
}

export function createTerrainGeometry() {
  const nx = 240,
    nz = 280,
    vertices: number[] = [],
    indices: number[] = [];
  for (let j = 0; j <= nz; j++)
    for (let i = 0; i <= nx; i++) {
      const x = -35 + (i / nx) * 70,
        z = -73 + (j / nz) * 99;
      vertices.push(x, height(x, z), z);
    }
  for (let j = 0; j < nz; j++)
    for (let i = 0; i < nx; i++) {
      const a = j * (nx + 1) + i;
      indices.push(a, a + nx + 1, a + 1, a + 1, a + nx + 1, a + nx + 2);
    }
  // Terrain contours follow the actual displayed surface; no wire grid or cut walls.
  const contourVertices: number[] = [],
    accentSegments: number[][][] = [];
  for (let level = -0.3; level < 12; level += 0.38) {
    for (let t = 0; t < indices.length; t += 3) {
      const ids = [indices[t], indices[t + 1], indices[t + 2]],
        hits = [];
      for (let e = 0; e < 3; e++) {
        const a = ids[e],
          b = ids[(e + 1) % 3],
          da = vertices[a * 3 + 1] - level,
          db = vertices[b * 3 + 1] - level;
        if ((da < 0 && db >= 0) || (db < 0 && da >= 0)) {
          const f = da / (da - db);
          hits.push([
            vertices[a * 3] + (vertices[b * 3] - vertices[a * 3]) * f,
            level + 0.014,
            vertices[a * 3 + 2] +
              (vertices[b * 3 + 2] - vertices[a * 3 + 2]) * f
          ]);
        }
      }
      if (hits.length === 2) {
        contourVertices.push(...hits[0], ...hits[1]);
        if (Math.abs(level - 2.74) < 0.001) accentSegments.push(hits);
      }
    }
  }
  // Join an existing terrain contour. Only a short, feathered highlight travels
  // along it; no separate cross-section cuts across the mountain's contours.
  const nodes = new Map<string, { p: number[]; neighbors: Set<string> }>();
  const pointKey = (p: number[]) =>
    `${Math.round(p[0] * 1e5)},${Math.round(p[2] * 1e5)}`;
  for (const [a, b] of accentSegments) {
    const ka = pointKey(a),
      kb = pointKey(b);
    if (ka === kb) continue;
    if (!nodes.has(ka)) nodes.set(ka, { p: a, neighbors: new Set() });
    if (!nodes.has(kb)) nodes.set(kb, { p: b, neighbors: new Set() });
    nodes.get(ka).neighbors.add(kb);
    nodes.get(kb).neighbors.add(ka);
  }
  const edgeKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const used = new Set<string>(),
    paths: number[][][] = [];
  const starts = [...nodes.keys()].sort(
    (a, b) => nodes.get(a).neighbors.size - nodes.get(b).neighbors.size
  );
  for (const start of starts)
    for (const neighbor of nodes.get(start).neighbors) {
      if (used.has(edgeKey(start, neighbor))) continue;
      const points = [nodes.get(start).p];
      let previous = start,
        current = neighbor;
      while (current) {
        used.add(edgeKey(previous, current));
        points.push(nodes.get(current).p);
        if (current === start) break;
        const next = [...nodes.get(current).neighbors].find(
          (n) => !used.has(edgeKey(current, n))
        );
        previous = current;
        current = next;
      }
      if (points.length > 20) paths.push(points);
    }
  const distance = (p: number[]) => (p[0] + 7) ** 2 + (p[2] + 13) ** 2;
  paths.sort(
    (a, b) => Math.min(...a.map(distance)) - Math.min(...b.map(distance))
  );
  if (!paths.length) throw new Error('No connected terrain contour found.');
  const selected = paths[0],
    closed = pointKey(selected[0]) === pointKey(selected.at(-1));
  const distances = [0];
  let total = 0,
    closest = 0;
  for (let i = 1; i < selected.length; i++) {
    total += Math.hypot(
      selected[i][0] - selected[i - 1][0],
      selected[i][2] - selected[i - 1][2]
    );
    distances.push(total);
    if (distance(selected[i]) < distance(selected[closest])) closest = i;
  }
  const startProgress = distances[closest] / total;
  const openPhase = Math.acos(clamp((0.5 - startProgress) / 0.38, -1, 1));
  return {
    vertices: new Float32Array(vertices),
    indices: new Uint32Array(indices),
    contours: new Float32Array(contourVertices),
    highlight: new Float32Array(
      selected.flatMap((p) => [p[0], p[1] + 0.008, p[2]])
    ),
    progress: new Float32Array(distances.map((d) => d / total)),
    closed,
    startProgress,
    openPhase,
    span: Math.min(0.15, 5 / total)
  };
}
export type TerrainGeometry = ReturnType<typeof createTerrainGeometry>;
