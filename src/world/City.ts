import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import type { QualitySettings } from '../core/Quality';
import { makeGroundTextures } from '../effects/textures';
import { RoadGrid } from './city/RoadGrid';
import { buildBuildings } from './city/buildings';
import { Occupancy, buildProps } from './city/props';
import { buildRoads, drawMiniMap } from './city/roads';
import { buildStreetLife } from './city/streetlife';
import { Traffic } from './city/traffic';
import type { CityDefinition, CityMap } from './city/types';
import { makeSky, makeTowerMaterial } from './materials';
import type { World } from './TestTrack';

const UP = new THREE.Vector3(0, 1, 0);

/** Builds a whole drivable city from a CityDefinition + its OpenStreetMap-derived map.json. */
export async function buildCity(world: RAPIER.World, quality: QualitySettings, def: CityDefinition): Promise<World> {
  const map: CityMap = await (await fetch(def.map)).json();
  const group = new THREE.Group();
  const fogColor = new THREE.Color(def.fog.color);
  const fogDensity = def.fog.density;
  const grid = new RoadGrid(map.roads);
  const animators: ((t: number) => void)[] = [];
  const [HX, HZ] = map.half;

  // ---------------------------------------------------------------- ground
  const G = Math.max(HX, HZ) * 2 + 1400;
  const gt = makeGroundTextures();
  gt.map.repeat.set(G / 20, G / 20);
  gt.roughnessMap.repeat.set(G / 70, G / 70);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(G, G),
    new THREE.MeshStandardMaterial({
      map: gt.map, color: 0x5a5046, roughness: 0.95, metalness: 0, envMapIntensity: 0.15,
    }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.renderOrder = -9;
  group.add(ground);
  world.createCollider(RAPIER.ColliderDesc.cuboid(G / 2, 1, G / 2).setTranslation(0, -1, 0).setFriction(0.9));
  // invisible city limits
  for (const [x, z, sx, sz] of [[0, -HZ - 60, HX + 80, 2], [0, HZ + 60, HX + 80, 2], [-HX - 60, 0, 2, HZ + 80], [HX + 60, 0, 2, HZ + 80]])
    world.createCollider(RAPIER.ColliderDesc.cuboid(sx, 30, sz).setTranslation(x, 30, z));

  // ---------------------------------------------------------------- landmarks (may add footprints, so before buildings)
  for (const lm of map.landmarks) {
    const build = def.landmarks[lm.id];
    if (!build) continue;
    // align to the nearest street
    let yaw = 0;
    let best = Infinity;
    for (let a = 0; a < 16; a++)
      for (const r of [40, 70, 100]) {
        const hit = grid.nearest(lm.x + Math.cos(a * 0.39) * r, lm.z + Math.sin(a * 0.39) * r, 4, -1, 3);
        if (hit && r + hit.road.c * 5 < best) {
          best = r + hit.road.c * 5;
          yaw = Math.atan2(-hit.dx, -hit.dz);
        }
      }
    const lg = new THREE.Group();
    lg.position.set(lm.x, 0, lm.z);
    lg.rotation.y = yaw;
    group.add(lg);
    const q = new THREE.Quaternion().setFromAxisAngle(UP, yaw);
    const cos = Math.cos(yaw), sin = Math.sin(yaw);
    const toWorld = (lx: number, lz: number): [number, number] => [lm.x + lx * cos + lz * sin, lm.z - lx * sin + lz * cos];
    build({
      x: lm.x,
      z: lm.z,
      yaw,
      group: lg,
      addFootprint(points, height, style) {
        const p = points.map(([x, z]) => toWorld(x, z));
        let area = 0;
        for (let i = 0, j = p.length - 1; i < p.length; j = i++) area += p[j][0] * p[i][1] - p[i][0] * p[j][1];
        if (area < 0) p.reverse();
        map.buildings.push({ s: style, h: height, p: p.flat(), n: lm.name });
      },
      addBoxCollider(pos, size) {
        const [wx, wz] = toWorld(pos.x, pos.z);
        world.createCollider(
          RAPIER.ColliderDesc.cuboid(size.x / 2, size.y / 2, size.z / 2).setTranslation(wx, pos.y, wz).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }),
        );
      },
      addHullCollider(points) {
        const desc = RAPIER.ColliderDesc.convexHull(points);
        if (desc) world.createCollider(desc.setTranslation(lm.x, 0, lm.z).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }).setFriction(0.9));
      },
      animate: (fn) => animators.push(fn),
    });
  }

  def.ambient?.({ group, animate: (fn) => animators.push(fn), half: map.half });

  // ---------------------------------------------------------------- streets, buildings, street life
  const roadGroup = buildRoads(map.roads, grid);
  group.add(roadGroup);
  const roadMats: THREE.MeshStandardMaterial[] = [];
  roadGroup.traverse((o) => {
    const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
    if (m && m.isMeshStandardMaterial && !roadMats.includes(m)) roadMats.push(m);
  });
  const dry = roadMats.map((m) => ({ r: m.roughness, e: m.envMapIntensity }));
  const buildings = buildBuildings(map.buildings, def, world, fogColor, fogDensity);
  group.add(buildings.group);
  const occ = new Occupancy(map);
  const props = buildProps(map, def, grid, occ, quality, fogColor, fogDensity);
  group.add(props.group);
  const traffic = new Traffic(map.roads, def, world, Math.round(90 * Math.min(1.3, quality.particles + 0.25)));
  group.add(traffic.group);
  const life = buildStreetLife(map, grid, occ, world, quality, def.streetLight);
  group.add(life.group);

  // ---------------------------------------------------------------- far skyline + sky + light
  const towerMat = makeTowerMaterial(fogColor, fogDensity * 0.3);
  const towers = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), towerMat, quality.skyline);
  const tints = [0x00f0ff, 0xff2bd6, 0x7a5cff, 0xffa630, 0x39a0ff];
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const m4 = new THREE.Matrix4();
  const R0 = Math.hypot(HX, HZ) + 120;
  for (let i = 0; i < quality.skyline; i++) {
    const a = rnd() * Math.PI * 2;
    const r = R0 + rnd() * 900;
    const h = 90 + Math.pow(rnd(), 2) * 520;
    const w = 40 + rnd() * 70;
    m4.compose(
      new THREE.Vector3(Math.cos(a) * r, h / 2 - 2, Math.sin(a) * r),
      new THREE.Quaternion().setFromAxisAngle(UP, rnd() * 3),
      new THREE.Vector3(w, h, w * (0.7 + rnd() * 0.6)),
    );
    towers.setMatrixAt(i, m4);
    towers.setColorAt(i, new THREE.Color(tints[Math.floor(rnd() * tints.length)]));
  }
  towers.frustumCulled = false;
  group.add(towers);
  const sky = makeSky(new THREE.Color(def.sky.horizon), new THREE.Color(def.sky.zenith));
  group.add(sky);
  group.add(new THREE.HemisphereLight(0x4a50c8, 0x2a1408, 0.38));
  const moon = new THREE.DirectionalLight(0x8f88d8, 0.28);
  moon.position.set(-120, 200, 80);
  group.add(moon);
  // warm haze from the street lights
  group.add(new THREE.AmbientLight(def.streetLight, 0.3));

  // ---------------------------------------------------------------- spawn on the nearest main road
  let sp = { d: Infinity, x: 0, z: 0, yaw: 0 };
  for (const r of map.roads) {
    if (r.c > 2 || r.p.length < 4) continue;
    for (let i = 0; i + 3 < r.p.length; i += 2) {
      const mx = (r.p[i] + r.p[i + 2]) / 2, mz = (r.p[i + 1] + r.p[i + 3]) / 2;
      const d = Math.hypot(mx - def.spawnNear[0], mz - def.spawnNear[1]);
      if (d < sp.d) sp = { d, x: mx, z: mz, yaw: Math.atan2(-(r.p[i + 2] - r.p[i]), -(r.p[i + 3] - r.p[i + 1])) };
    }
  }

  const minimap = drawMiniMap(map.roads, map.half, map.landmarks);
  console.info(
    `[city] ${def.name}: ${map.roads.length} roads, ${map.buildings.length} buildings, ${buildings.triangles} building tris. ${map.attribution}`,
  );

  return {
    group,
    spawn: { position: new THREE.Vector3(sp.x, 0.6, sp.z), yaw: sp.yaw },
    fogColor,
    fogDensity,
    minimap,
    attribution: map.attribution,
    routes: map.routes ?? [],
    roadNameAt: (x, z) => grid.nearest(x, z, 3)?.road.n ?? '',
    setWet(k) {
      roadMats.forEach((m, i) => {
        m.roughness = THREE.MathUtils.lerp(dry[i].r, 0.16, k);
        m.envMapIntensity = THREE.MathUtils.lerp(dry[i].e, 0.8, k);
      });
    },
    update(dt, time, focus, player) {
      buildings.material.uniforms.uTime.value = time;
      towerMat.uniforms.uTime.value = time;
      (sky.material as THREE.ShaderMaterial).uniforms.uTime.value = time;
      sky.position.copy(focus);
      props.update(time);
      traffic.update(dt, player ?? focus);
      life.update(dt, time, player ?? focus);
      for (const a of animators) a(time);
    },
  };
}
