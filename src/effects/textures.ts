import * as THREE from 'three';

const hex = (c: number) => '#' + c.toString(16).padStart(6, '0');

function canvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return { c, g: c.getContext('2d')! };
}

function finish(c: HTMLCanvasElement, srgb = true, repeat = false) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

/** Soft round sprite for particles and glow pools. */
export function makeGlowTexture(): THREE.Texture {
  const { c, g } = canvas(128, 128);
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  grad.addColorStop(0.6, 'rgba(255,255,255,0.12)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return finish(c, false);
}

/**
 * Original truck-art inspired hologram panel: layered borders, chevrons,
 * rosettes and a central sunburst, in the vehicle's neon palette.
 */
export function makeTruckArtTexture(neon: number, accent: number): THREE.Texture {
  const { c, g } = canvas(512, 256);
  const cols = [hex(neon), hex(accent), '#ffd23f', '#7dff5a', '#ff7a1a'];
  g.fillStyle = '#05010d';
  g.fillRect(0, 0, 512, 256);
  g.lineJoin = 'round';

  // borders
  for (let i = 0; i < 3; i++) {
    g.strokeStyle = cols[i % cols.length];
    g.lineWidth = 4;
    g.strokeRect(8 + i * 10, 8 + i * 10, 496 - i * 20, 240 - i * 20);
  }
  // chevron band top & bottom
  for (let x = 40; x < 480; x += 22) {
    g.strokeStyle = cols[(x / 22) % 2 < 1 ? 2 : 1];
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(x, 44); g.lineTo(x + 11, 56); g.lineTo(x + 22, 44);
    g.moveTo(x, 212); g.lineTo(x + 11, 200); g.lineTo(x + 22, 212);
    g.stroke();
  }
  // rosettes
  const rosette = (cx: number, cy: number, r: number, petals: number, col: string, col2: string) => {
    for (let i = 0; i < petals; i++) {
      const a = (i / petals) * Math.PI * 2;
      g.strokeStyle = i % 2 ? col : col2;
      g.lineWidth = 3;
      g.beginPath();
      g.ellipse(cx + Math.cos(a) * r * 0.55, cy + Math.sin(a) * r * 0.55, r * 0.45, r * 0.18, a, 0, Math.PI * 2);
      g.stroke();
    }
    g.fillStyle = col2;
    g.beginPath();
    g.arc(cx, cy, r * 0.16, 0, Math.PI * 2);
    g.fill();
  };
  rosette(110, 128, 54, 10, cols[0], cols[2]);
  rosette(402, 128, 54, 10, cols[0], cols[2]);
  // central sunburst + diamond
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    g.strokeStyle = cols[i % 2 ? 1 : 4];
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(256 + Math.cos(a) * 26, 128 + Math.sin(a) * 26);
    g.lineTo(256 + Math.cos(a) * 62, 128 + Math.sin(a) * 62);
    g.stroke();
  }
  g.strokeStyle = cols[3];
  g.lineWidth = 4;
  g.beginPath();
  g.moveTo(256, 96); g.lineTo(288, 128); g.lineTo(256, 160); g.lineTo(224, 128); g.closePath();
  g.stroke();
  g.fillStyle = cols[1];
  g.beginPath();
  g.arc(256, 128, 9, 0, Math.PI * 2);
  g.fill();
  // scanlines for the hologram feel
  g.fillStyle = 'rgba(0,0,0,0.28)';
  for (let y = 0; y < 256; y += 4) g.fillRect(0, y, 512, 1.5);
  return finish(c);
}

/** Road strip: wet asphalt with glowing edge lines and dashed centre. Returns colour + emissive maps. */
export function makeRoadTextures(edge: number, centre: number) {
  const mk = (emissive: boolean) => {
    const { c, g } = canvas(256, 512);
    if (emissive) {
      g.fillStyle = '#000';
      g.fillRect(0, 0, 256, 512);
    } else {
      g.fillStyle = '#0b0b12';
      g.fillRect(0, 0, 256, 512);
      for (let i = 0; i < 2600; i++) {
        const v = 10 + Math.random() * 22;
        g.fillStyle = `rgba(${v},${v},${v + 6},0.5)`;
        g.fillRect(Math.random() * 256, Math.random() * 512, 1.5, 1.5);
      }
    }
    g.fillStyle = hex(edge);
    g.fillRect(8, 0, 5, 512);
    g.fillRect(243, 0, 5, 512);
    g.fillStyle = hex(centre);
    g.fillRect(126, 0, 4, 220);
    // lane dashes
    g.globalAlpha = 0.55;
    g.fillStyle = '#ffffff';
    g.fillRect(66, 40, 2.5, 150);
    g.fillRect(188, 40, 2.5, 150);
    g.fillRect(66, 296, 2.5, 150);
    g.fillRect(188, 296, 2.5, 150);
    g.globalAlpha = 1;
    return finish(c, true, true);
  };
  return { map: mk(false), emissiveMap: mk(true) };
}

/** Tiling ground: dark tarmac with a puddle roughness map so reflections come in patches. */
export function makeGroundTextures() {
  const size = 512;
  const col = canvas(size, size);
  const rough = canvas(size, size);
  col.g.fillStyle = '#08080d';
  col.g.fillRect(0, 0, size, size);
  for (let i = 0; i < 9000; i++) {
    const v = 8 + Math.random() * 20;
    col.g.fillStyle = `rgba(${v},${v},${v + 8},0.55)`;
    col.g.fillRect(Math.random() * size, Math.random() * size, 2, 2);
  }
  // faint service grid
  col.g.strokeStyle = 'rgba(60,40,120,0.5)';
  col.g.lineWidth = 2;
  col.g.strokeRect(1, 1, size - 2, size - 2);

  rough.g.fillStyle = 'rgb(170,170,170)';
  rough.g.fillRect(0, 0, size, size);
  // puddles: smooth dark blobs (low roughness), drawn wrapped so the texture tiles
  for (let i = 0; i < 26; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const r = 24 + Math.random() * 70;
    for (const ox of [-size, 0, size])
      for (const oy of [-size, 0, size]) {
        const gr = rough.g.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r);
        gr.addColorStop(0, 'rgba(18,18,18,0.95)');
        gr.addColorStop(0.7, 'rgba(18,18,18,0.6)');
        gr.addColorStop(1, 'rgba(18,18,18,0)');
        rough.g.fillStyle = gr;
        rough.g.fillRect(x + ox - r, y + oy - r, r * 2, r * 2);
      }
  }
  return { map: finish(col.c, true, true), roughnessMap: finish(rough.c, false, true) };
}

/** Chevron arrows for ramps and boost pads. */
export function makeChevronTexture(color: number): THREE.Texture {
  const { c, g } = canvas(128, 128);
  g.fillStyle = '#000';
  g.fillRect(0, 0, 128, 128);
  g.strokeStyle = hex(color);
  g.lineWidth = 12;
  g.lineJoin = 'miter';
  for (const y of [100, 50]) {
    g.beginPath();
    g.moveTo(14, y + 14);
    g.lineTo(64, y - 26);
    g.lineTo(114, y + 14);
    g.stroke();
  }
  return finish(c, true, true);
}
