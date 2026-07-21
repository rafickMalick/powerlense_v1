import { useEffect, useRef, useCallback, useState } from 'react';
import { View, Text, Pressable, ScrollView, useWindowDimensions } from 'react-native';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useMeasurementsStore } from '@/store/measurementsStore';
import { useActiveBuilding } from '@/store/buildingStore';
import * as zonesService from '@/services/zones';
import { TWIN_CONFIG } from './twin.config';
import { useScreenViewLogging } from '@/hooks/useScreenViewLogging';
import { palette, ratioToColor, RATIO_LEGEND } from '@/theme/colors';
import { Card } from '@/components/ui';

// ─── helpers ──────────────────────────────────────────────────────────────

function powerRatio(power: number, max: number) {
  return Math.min(1, Math.max(0, power / max));
}
function ratioToHex(ratio: number): number {
  return parseInt(ratioToColor(ratio).slice(1), 16);
}
function ratioToCSS(ratio: number): string {
  return ratioToColor(ratio);
}
function fmt(w: number) {
  return w >= 1000 ? `${(w / 1000).toFixed(1)} kW` : `${Math.round(w)} W`;
}
function smoothstep(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}

// ─── figurine humaine (présence) ────────────────────────────────────────────

/** Silhouette low-poly stylisée, cohérente avec l'esthétique filaire/flat de la scène. */
function createHuman(): THREE.Group {
  const group = new THREE.Group();
  const skin = new THREE.MeshStandardMaterial({ color: 0xf59e0b, roughness: 0.6, emissive: 0x78350f, emissiveIntensity: 0.25 });

  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 0.55, 4, 8), skin);
  body.position.y = 0.16 + 0.55 / 2;
  body.castShadow = true;
  group.add(body);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.14, 12, 12), skin);
  head.position.y = 0.16 + 0.55 + 0.14;
  head.castShadow = true;
  group.add(head);

  group.userData.baseY = 0;
  return group;
}

// ─── door builder ─────────────────────────────────────────────────────────

/**
 * Crée un cadre de porte + panneau semi-ouvert.
 * wallX  : position X du mur (face donnant sur le couloir)
 * side   : 'left' (porte s'ouvre vers gauche) ou 'right'
 */
function buildDoor(scene: THREE.Scene, wallX: number, z: number, side: 'left' | 'right') {
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.6, metalness: 0.3 });
  const doorMat  = new THREE.MeshStandardMaterial({
    color: 0x0ea5e9,
    transparent: true,
    opacity: 0.35,
    roughness: 0.1,
    metalness: 0.5,
    side: THREE.DoubleSide,
  });

  const doorW = 0.85;
  const doorH = 2.1;
  const frameT = 0.08;

  const parts: THREE.Mesh[] = [];

  // Pilier gauche
  const pillarL = new THREE.Mesh(new THREE.BoxGeometry(frameT, doorH + frameT, frameT), frameMat);
  pillarL.position.set(wallX, (doorH + frameT) / 2, z - doorW / 2);
  parts.push(pillarL);

  // Pilier droit
  const pillarR = new THREE.Mesh(new THREE.BoxGeometry(frameT, doorH + frameT, frameT), frameMat);
  pillarR.position.set(wallX, (doorH + frameT) / 2, z + doorW / 2);
  parts.push(pillarR);

  // Linteau (dessus)
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(frameT, frameT, doorW + frameT * 2), frameMat);
  lintel.position.set(wallX, doorH + frameT / 2, z);
  parts.push(lintel);

  // Seuil
  const sill = new THREE.Mesh(new THREE.BoxGeometry(frameT, 0.04, doorW), frameMat);
  sill.position.set(wallX, 0.02, z);
  parts.push(sill);

  parts.forEach((p) => { p.castShadow = true; scene.add(p); });

  // Panneau de porte semi-ouvert (pivoté ~65° autour de l'axe Y)
  const panelGeo = new THREE.BoxGeometry(doorW * 0.9, doorH - 0.05, 0.04);
  const panel = new THREE.Mesh(panelGeo, doorMat);
  // Pivot au bord (z ± doorW/2), on translate + on tourne
  const pivotZ = z + (side === 'left' ? -doorW / 2 + 0.04 : doorW / 2 - 0.04);
  panel.position.set(
    wallX + (side === 'left' ? -(doorW * 0.9) / 2 * Math.sin(1.1) : (doorW * 0.9) / 2 * Math.sin(1.1)),
    doorH / 2,
    pivotZ + (side === 'left' ? (doorW * 0.9) / 2 * Math.cos(1.1) : -(doorW * 0.9) / 2 * Math.cos(1.1)),
  );
  panel.rotation.y = side === 'left' ? -1.1 : 1.1;
  panel.castShadow = true;
  scene.add(panel);

  // Poignée
  const handleGeo = new THREE.SphereGeometry(0.04, 8, 8);
  const handleMat = new THREE.MeshStandardMaterial({ color: 0xfbbf24, metalness: 0.9, roughness: 0.1 });
  const handle = new THREE.Mesh(handleGeo, handleMat);
  handle.position.set(
    panel.position.x + (side === 'left' ? 0.12 : -0.12),
    doorH * 0.55,
    panel.position.z,
  );
  scene.add(handle);
}

// ─── label CSS2D ───────────────────────────────────────────────────────────

function createRoomLabel(zoneName: string, zoneId: string): { obj: CSS2DObject; update: (power: number, max: number, alert: boolean) => void } {
  const wrapper = document.createElement('div');
  wrapper.style.cssText = `
    pointer-events: none;
    user-select: none;
    transform: translateX(-50%);
  `;

  const card = document.createElement('div');
  card.style.cssText = `
    background: rgba(255, 255, 255, 0.96);
    border: 1.5px solid ${palette.navy700};
    border-radius: 8px;
    padding: 5px 10px;
    text-align: center;
    min-width: 110px;
    font-family: 'Inter', system-ui, -apple-system, sans-serif;
    box-shadow: 0 4px 16px rgba(15,23,42,0.25);
  `;

  const nameEl = document.createElement('div');
  nameEl.style.cssText = `color: ${palette.gray900}; font-size: 10px; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; margin-bottom: 2px;`;
  nameEl.textContent = zoneName;

  const powerEl = document.createElement('div');
  powerEl.style.cssText = `color: ${palette.navy700}; font-size: 14px; font-weight: 800; font-variant-numeric: tabular-nums;`;
  powerEl.textContent = '— W';

  const barContainer = document.createElement('div');
  barContainer.style.cssText = `background: ${palette.gray200}; border-radius: 3px; height: 4px; margin-top: 4px; overflow: hidden;`;
  const bar = document.createElement('div');
  bar.style.cssText = `height: 100%; border-radius: 3px; transition: width 0.5s ease; background: ${palette.navy700}; width: 0%;`;
  barContainer.appendChild(bar);

  const alertEl = document.createElement('div');
  // Orange plus foncé que palette.warning pour rester lisible en texte sur fond blanc (contraste AA).
  alertEl.style.cssText = 'display: none; color: #C2410C; font-size: 10px; font-weight: 700; margin-top: 3px;';
  alertEl.textContent = '⚠ Alerte';

  card.appendChild(nameEl);
  card.appendChild(powerEl);
  card.appendChild(barContainer);
  card.appendChild(alertEl);

  // Ligne de connexion (stem)
  const stem = document.createElement('div');
  stem.style.cssText = `width: 1px; height: 16px; background: ${palette.navy700}; margin: 0 auto; opacity: 0.7;`;

  wrapper.appendChild(card);
  wrapper.appendChild(stem);

  const obj = new CSS2DObject(wrapper);

  const update = (power: number, max: number, alert: boolean) => {
    const ratio = Math.min(1, power / max);
    const color = ratioToCSS(ratio);
    card.style.borderColor = color;
    powerEl.style.color = color;
    powerEl.textContent = fmt(power);
    bar.style.background = color;
    bar.style.width = `${Math.round(ratio * 100)}%`;
    stem.style.background = color;
    alertEl.style.display = alert ? 'block' : 'none';
  };

  return { obj, update };
}

// ─── sign mural ─────────────────────────────────────────────────────────────

function buildWallSign(scene: THREE.Scene, x: number, y: number, z: number, zoneName: string): CSS2DObject {
  const div = document.createElement('div');
  div.style.cssText = `
    background: ${palette.white};
    border: 1px solid ${palette.navy700};
    border-radius: 4px;
    padding: 3px 7px;
    color: ${palette.navy700};
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    pointer-events: none;
    white-space: nowrap;
    font-family: 'Inter', system-ui, sans-serif;
    box-shadow: 0 2px 8px rgba(15,23,42,0.2);
  `;
  div.textContent = `🚪 ${zoneName}`;
  const sign = new CSS2DObject(div);
  sign.position.set(x, y, z);
  scene.add(sign);
  return sign;
}

// ─── construction de la scène ─────────────────────────────────────────────

function buildScene(container: HTMLDivElement) {
  const W = container.clientWidth;
  const H = container.clientHeight;

  // ── Renderer WebGL ───────────────────────────────────────────────────
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;';
  container.appendChild(canvas);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderer.setSize(W, H, false);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;

  // ── Renderer CSS2D (labels HTML) ─────────────────────────────────────
  const labelRenderer = new CSS2DRenderer();
  labelRenderer.setSize(W, H);
  labelRenderer.domElement.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;overflow:hidden;';
  container.appendChild(labelRenderer.domElement);

  // ── Scène ────────────────────────────────────────────────────────────
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0f172a);
  scene.fog = new THREE.FogExp2(0x0f172a, 0.038);

  // ── Caméra ───────────────────────────────────────────────────────────
  const camera = new THREE.PerspectiveCamera(42, W / H, 0.1, 100);
  camera.position.set(6, 7, 11);
  camera.lookAt(0, 1, 0);

  // ── Controls ─────────────────────────────────────────────────────────
  const controls = new OrbitControls(camera, container);
  controls.enableDamping = true;
  controls.dampingFactor = 0.07;
  controls.minDistance = 5;
  controls.maxDistance = 20;
  controls.maxPolarAngle = Math.PI / 2.05;
  controls.target.set(0, 1, 0);
  controls.autoRotate = true;
  controls.autoRotateSpeed = 0.5;

  // ── Lumières ─────────────────────────────────────────────────────────
  scene.add(new THREE.AmbientLight(0x334155, 5));

  const sun = new THREE.DirectionalLight(0xffffff, 3);
  sun.position.set(8, 14, 8);
  sun.castShadow = true;
  Object.assign(sun.shadow.mapSize, { width: 2048, height: 2048 });
  Object.assign(sun.shadow.camera, { near: 0.5, far: 40, left: -12, right: 12, top: 12, bottom: -12 });
  scene.add(sun);

  const fill = new THREE.DirectionalLight(0x1e40af, 1);
  fill.position.set(-6, 4, -6);
  scene.add(fill);

  // ── Sol ──────────────────────────────────────────────────────────────
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(16, 12),
    new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.9, metalness: 0.05 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);
  scene.add(new THREE.GridHelper(16, 16, 0x334155, 0x1e293b));

  // ── Layout (salles ajustées contre le couloir) ────────────────────────
  // Couloir : x ∈ [-0.65, 0.65], width = 1.3
  // Salle 1 : droite du couloir → gauche (right wall at x=-0.65)
  //   width=5.2 → center at x = -0.65 - 5.2/2 = -3.25
  // Salle 2 : gauche du couloir → droite (left wall at x=+0.65)
  //   width=3.8 → center at x = 0.65 + 3.8/2 = 2.55
  const CORRIDOR_HALF = 0.65;
  const ROOM_H = 3.2;
  const ROOM_DEPTH = 7; // Z
  const r1W = 5.2;
  const r2W = 3.8;
  const r1X = -(CORRIDOR_HALF + r1W / 2);
  const r2X =  (CORRIDOR_HALF + r2W / 2);

  // ── Plafond bâtiment ─────────────────────────────────────────────────
  const roofGeo = new THREE.PlaneGeometry(r1W + r2W + CORRIDOR_HALF * 2, ROOM_DEPTH);
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, transparent: true, opacity: 0.2, side: THREE.DoubleSide });
  const roof = new THREE.Mesh(roofGeo, roofMat);
  roof.rotation.x = -Math.PI / 2;
  roof.position.set((r1X + r2X) / 2, ROOM_H, 0);
  scene.add(roof);

  // Arête du bâtiment
  const buildW = r1W + CORRIDOR_HALF * 2 + r2W;
  const buildEdges = new THREE.EdgesGeometry(new THREE.BoxGeometry(buildW, ROOM_H, ROOM_DEPTH));
  const buildWire = new THREE.LineSegments(buildEdges, new THREE.LineBasicMaterial({ color: 0x1e40af }));
  buildWire.position.set((r1X + r2X) / 2, ROOM_H / 2, 0);
  scene.add(buildWire);

  // ── Couloir ───────────────────────────────────────────────────────────
  const corridorFloor = new THREE.Mesh(
    new THREE.PlaneGeometry(CORRIDOR_HALF * 2, ROOM_DEPTH),
    new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.95 }),
  );
  corridorFloor.rotation.x = -Math.PI / 2;
  corridorFloor.position.set(0, 0.01, 0);
  corridorFloor.receiveShadow = true;
  scene.add(corridorFloor);

  // Lignes de couloir au sol
  const corridorGrid = new THREE.GridHelper(ROOM_DEPTH, 7, 0x1e40af, 0x1e293b);
  corridorGrid.position.set(0, 0.02, 0);
  scene.add(corridorGrid);

  // Lumière de couloir (néon) — références conservées pour refléter la charge live (setCorridor/updatePower)
  const corridorNeons: { light: THREE.PointLight; tube: THREE.Mesh }[] = [];
  for (let z = -2.5; z <= 2.5; z += 2.5) {
    const neon = new THREE.PointLight(0xbfdbfe, 1.5, 3);
    neon.position.set(0, ROOM_H - 0.3, z);
    scene.add(neon);
    // Géométrie du néon
    const tube = new THREE.Mesh(
      new THREE.CylinderGeometry(0.04, 0.04, 1, 6),
      new THREE.MeshStandardMaterial({ color: 0xdbeafe, emissive: 0x93c5fd, emissiveIntensity: 2 }),
    );
    tube.rotation.x = Math.PI / 2;
    tube.position.set(0, ROOM_H - 0.35, z);
    scene.add(tube);
    corridorNeons.push({ light: neon, tube });
  }

  // Zone couloir live — résolue de façon asynchrone (setCorridor), zoneId réel inconnu au montage.
  let corridorZoneId: string | null = null;
  let corridorMaxPower = 1000;
  let corridorLabel: { obj: CSS2DObject; update: (power: number, max: number, alert: boolean) => void } | null = null;

  // ── Salles ───────────────────────────────────────────────────────────
  interface RoomMeshInfo {
    zoneId: string; mesh: THREE.Mesh; roomLight: THREE.PointLight;
    maxPower: number; labelUpdate: (p: number, max: number, alert: boolean) => void;
  }

  // Présence → figurine humaine par zone (peuplé/vidé par updatePresence).
  const humans = new Map<string, THREE.Group>();
  const humanSpots = new Map<string, THREE.Vector3>();
  const roomMeshes: RoomMeshInfo[] = [];

  const roomDefs = [
    { cfg: TWIN_CONFIG.zones[0], x: r1X, w: r1W, doorSide: 'right' as const, doorWallX: -CORRIDOR_HALF, doorZ: -0.5 },
    { cfg: TWIN_CONFIG.zones[1], x: r2X, w: r2W, doorSide: 'left'  as const, doorWallX:  CORRIDOR_HALF, doorZ:  0.5 },
  ];

  roomDefs.forEach(({ cfg, x, w, doorSide, doorWallX, doorZ }) => {
    // Boîte de salle
    const mat = new THREE.MeshStandardMaterial({
      color: 0x3b82f6, emissive: 0x1e3a5f, emissiveIntensity: 0.4,
      roughness: 0.45, metalness: 0.15, transparent: true, opacity: 0.88,
    });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, ROOM_H, ROOM_DEPTH), mat);
    mesh.position.set(x, ROOM_H / 2, 0);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData = { zoneId: cfg.zoneId, zoneName: cfg.zoneName };
    scene.add(mesh);

    // Bords de la salle
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(w, ROOM_H, ROOM_DEPTH)),
      new THREE.LineBasicMaterial({ color: 0x60a5fa }),
    );
    edges.position.copy(mesh.position);
    scene.add(edges);
    mesh.userData.edges = edges;

    // Lumière intérieure
    const roomLight = new THREE.PointLight(0x3b82f6, 3, w * 1.5);
    roomLight.position.set(x, ROOM_H * 0.7, 0);
    scene.add(roomLight);

    // Porte
    buildDoor(scene, doorWallX, doorZ, doorSide);

    // Panneau mural près de la porte
    buildWallSign(scene, doorWallX + (doorSide === 'right' ? -0.3 : 0.3), 2.4, doorZ + 0.7, cfg.zoneName);

    // Label CSS2D au-dessus de la salle
    const { obj: label, update: labelUpdate } = createRoomLabel(cfg.zoneName, cfg.zoneId);
    label.position.set(x, ROOM_H + 0.6, 0);
    scene.add(label);

    roomMeshes.push({ zoneId: cfg.zoneId, mesh, roomLight, maxPower: cfg.maxPowerWatt, labelUpdate });

    // Emplacement de la figurine : à l'écart de la porte, côté fond de la salle.
    const spotX = x + (doorSide === 'right' ? w * 0.2 : -w * 0.2);
    const spotZ = doorZ > 0 ? -ROOM_DEPTH * 0.25 : ROOM_DEPTH * 0.25;
    humanSpots.set(cfg.zoneId, new THREE.Vector3(spotX, 0, spotZ));
  });

  // ── Raycaster ────────────────────────────────────────────────────────
  const raycaster = new THREE.Raycaster();
  const mouse = new THREE.Vector2();
  let onClickCb: ((id: string) => void) | null = null;

  function onClick(e: MouseEvent) {
    const rect = container.getBoundingClientRect();
    mouse.x =  ((e.clientX - rect.left)  / rect.width)  * 2 - 1;
    mouse.y = -((e.clientY - rect.top)   / rect.height) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);
    const clickable = corridorZoneId ? [...roomMeshes.map((r) => r.mesh), corridorFloor] : roomMeshes.map((r) => r.mesh);
    const hits = raycaster.intersectObjects(clickable);
    if (hits.length === 0) return;
    const hit = hits[0].object;
    const zoneId = hit === corridorFloor ? corridorZoneId : (hit.userData.zoneId as string);
    if (zoneId) onClickCb?.(zoneId);
  }
  container.addEventListener('click', onClick);

  // ── Visite guidée (tour) ─────────────────────────────────────────────
  // Parcours scripté : couloir → salle 1 → couloir → salle 2 → vue d'ensemble.
  // La caméra "marche" (hauteur d'yeux ~1.7) le long du couloir réel puis
  // franchit chaque porte — mêmes coordonnées que la géométrie ci-dessus.
  interface TourWaypoint { pos: THREE.Vector3; look: THREE.Vector3; label: string; duration: number }
  function buildWaypoints(): TourWaypoint[] {
    const EYE_H = 1.7;
    const [d1, d2] = roomDefs; // Salle de Réunion, Open Space
    return [
      { pos: new THREE.Vector3(0, EYE_H, ROOM_DEPTH / 2 - 0.5), look: new THREE.Vector3(0, EYE_H, 0), label: 'Couloir', duration: 1800 },
      { pos: new THREE.Vector3(0, EYE_H, d1.doorZ), look: new THREE.Vector3(d1.doorWallX, EYE_H, d1.doorZ), label: `Vers ${d1.cfg.zoneName}`, duration: 1400 },
      { pos: new THREE.Vector3(d1.x * 0.35, EYE_H, d1.doorZ), look: new THREE.Vector3(d1.x, EYE_H, d1.doorZ), label: d1.cfg.zoneName, duration: 1400 },
      { pos: new THREE.Vector3(d1.x, EYE_H, -ROOM_DEPTH * 0.25), look: new THREE.Vector3(d1.x, EYE_H, ROOM_DEPTH * 0.25), label: d1.cfg.zoneName, duration: 2400 },
      { pos: new THREE.Vector3(d1.x * 0.35, EYE_H, d1.doorZ), look: new THREE.Vector3(0, EYE_H, d1.doorZ), label: 'Couloir', duration: 1400 },
      { pos: new THREE.Vector3(0, EYE_H, d2.doorZ), look: new THREE.Vector3(d2.doorWallX, EYE_H, d2.doorZ), label: `Vers ${d2.cfg.zoneName}`, duration: 1400 },
      { pos: new THREE.Vector3(d2.x * 0.35, EYE_H, d2.doorZ), look: new THREE.Vector3(d2.x, EYE_H, d2.doorZ), label: d2.cfg.zoneName, duration: 1400 },
      { pos: new THREE.Vector3(d2.x, EYE_H, ROOM_DEPTH * 0.25), look: new THREE.Vector3(d2.x, EYE_H, -ROOM_DEPTH * 0.25), label: d2.cfg.zoneName, duration: 2400 },
      { pos: new THREE.Vector3(0, EYE_H, d2.doorZ), look: new THREE.Vector3(0, EYE_H, 0), label: 'Couloir', duration: 1400 },
      { pos: new THREE.Vector3(6, 7, 11), look: new THREE.Vector3(0, 1, 0), label: "Vue d'ensemble", duration: 2000 },
    ];
  }

  interface TourState {
    waypoints: TourWaypoint[]; index: number; segStart: number;
    fromPos: THREE.Vector3; fromLook: THREE.Vector3; currentLook: THREE.Vector3;
    onWaypoint?: (label: string, index: number, total: number) => void;
    onEnd?: () => void;
  }
  let tour: TourState | null = null;

  function startTour(onWaypoint?: (label: string, index: number, total: number) => void, onEnd?: () => void) {
    const waypoints = buildWaypoints();
    controls.enabled = false;
    controls.autoRotate = false;
    tour = {
      waypoints, index: 0, segStart: performance.now(),
      fromPos: camera.position.clone(), fromLook: controls.target.clone(), currentLook: controls.target.clone(),
      onWaypoint, onEnd,
    };
    onWaypoint?.(waypoints[0].label, 0, waypoints.length);
  }

  function stopTour() {
    if (!tour) return;
    controls.target.copy(tour.currentLook);
    controls.enabled = true;
    tour.onEnd?.();
    tour = null;
  }

  // ── Boucle de rendu ──────────────────────────────────────────────────
  let animId = 0;
  function animate() {
    animId = requestAnimationFrame(animate);

    if (tour) {
      const now = performance.now();
      const wp = tour.waypoints[tour.index];
      const t = Math.min(1, (now - tour.segStart) / wp.duration);
      const eased = smoothstep(t);
      camera.position.lerpVectors(tour.fromPos, wp.pos, eased);
      tour.currentLook.lerpVectors(tour.fromLook, wp.look, eased);
      camera.lookAt(tour.currentLook);

      if (t >= 1) {
        if (tour.index >= tour.waypoints.length - 1) {
          controls.target.copy(tour.currentLook);
          controls.enabled = true;
          tour.onEnd?.();
          tour = null;
        } else {
          tour.fromPos.copy(wp.pos);
          tour.fromLook.copy(wp.look);
          tour.index += 1;
          tour.segStart = now;
          tour.onWaypoint?.(tour.waypoints[tour.index].label, tour.index, tour.waypoints.length);
        }
      }
    } else {
      controls.update();
    }

    // Léger balancement des figurines humaines (présence)
    const bobT = performance.now() * 0.002;
    humans.forEach((human) => {
      human.position.y = Math.sin(bobT + (human.userData.baseY as number)) * 0.02;
    });

    renderer.render(scene, camera);
    labelRenderer.render(scene, camera);
  }
  animate();

  // ── Resize ──────────────────────────────────────────────────────────
  function onResize() {
    const w = container.clientWidth;
    const h = container.clientHeight;
    renderer.setSize(w, h, false);
    labelRenderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', onResize);

  return {
    setOnClick: (cb: (id: string) => void) => { onClickCb = cb; },
    /** Résout la zone couloir live (appelé une fois `/zones?type=CORRIDOR` répondu — géométrie déjà en place, seule la donnée est différée). */
    setCorridor: (info: { zoneId: string; zoneName: string; maxPowerWatt: number }) => {
      corridorZoneId = info.zoneId;
      corridorMaxPower = info.maxPowerWatt;
      corridorFloor.userData = { zoneId: info.zoneId };
      if (!corridorLabel) {
        const { obj, update } = createRoomLabel(info.zoneName, info.zoneId);
        obj.position.set(0, ROOM_H * 0.55, ROOM_DEPTH / 2 - 0.8);
        scene.add(obj);
        corridorLabel = { obj, update };
      }
      // Emplacement de la figurine du couloir — décalé du centre pour ne pas
      // gêner le trajet de la visite guidée (qui marche le long de x=0).
      if (!humanSpots.has(info.zoneId)) {
        humanSpots.set(info.zoneId, new THREE.Vector3(0.25, 0, 0));
      }
    },
    updatePower: (powerByZone: Record<string, number>) => {
      roomMeshes.forEach(({ zoneId, mesh, roomLight, maxPower, labelUpdate }) => {
        const power = powerByZone[zoneId] ?? 0;
        const ratio = powerRatio(power, maxPower);
        const color = new THREE.Color(ratioToHex(ratio));
        const mat = mesh.material as THREE.MeshStandardMaterial;
        mat.color.set(color);
        mat.emissive.set(color);
        mat.emissiveIntensity = 0.2 + ratio * 0.7;
        roomLight.color.set(color);
        roomLight.intensity = 2 + ratio * 5;
        (mesh.userData.edges as THREE.LineSegments).material = new THREE.LineBasicMaterial({ color });
        labelUpdate(power, maxPower, ratio > 0.85);
      });

      if (corridorZoneId && corridorLabel) {
        const power = powerByZone[corridorZoneId] ?? 0;
        const ratio = powerRatio(power, corridorMaxPower);
        const color = new THREE.Color(ratioToHex(ratio));
        corridorNeons.forEach(({ light, tube }) => {
          light.color.set(color);
          light.intensity = 1 + ratio * 4;
          (tube.material as THREE.MeshStandardMaterial).emissive.set(color);
        });
        corridorLabel.update(power, corridorMaxPower, ratio > 0.85);
      }
    },
    /** Ajoute/retire la figurine humaine d'une salle selon `EnergyMeasurement.presence`. */
    updatePresence: (presenceByZone: Record<string, boolean>) => {
      humanSpots.forEach((spot, zoneId) => {
        const present = !!presenceByZone[zoneId];
        const existing = humans.get(zoneId);
        if (present && !existing) {
          const human = createHuman();
          human.position.copy(spot);
          human.userData.baseY = Math.random() * Math.PI * 2;
          scene.add(human);
          humans.set(zoneId, human);
        } else if (!present && existing) {
          scene.remove(existing);
          existing.traverse((obj) => {
            if (obj instanceof THREE.Mesh) {
              obj.geometry.dispose();
              (obj.material as THREE.Material).dispose();
            }
          });
          humans.delete(zoneId);
        }
      });
    },
    startTour,
    stopTour,
    isTouring: () => tour !== null,
    /**
     * Remappe les zoneId des salles (géométrie fixe, cf. twin.config.ts) vers
     * les zoneId réels du bâtiment courant — résolus dynamiquement comme le
     * couloir (setCorridor), car les UUID en dur dans TWIN_CONFIG se
     * périment dès que le bâtiment est reseedé.
     */
    setRoomZoneIds: (ids: [string, string]) => {
      roomMeshes.forEach((room, i) => {
        const newId = ids[i];
        if (!newId || newId === room.zoneId) return;
        const oldId = room.zoneId;
        room.mesh.userData.zoneId = newId;
        const spot = humanSpots.get(oldId);
        if (spot) { humanSpots.delete(oldId); humanSpots.set(newId, spot); }
        const human = humans.get(oldId);
        if (human) { humans.delete(oldId); humans.set(newId, human); }
        room.zoneId = newId;
      });
    },
    dispose: () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', onResize);
      container.removeEventListener('click', onClick);
      humans.forEach((human) => {
        human.traverse((obj) => {
          if (obj instanceof THREE.Mesh) {
            obj.geometry.dispose();
            (obj.material as THREE.Material).dispose();
          }
        });
      });
      controls.dispose();
      renderer.dispose();
      container.innerHTML = '';
    },
  };
}

// ─── composant React ──────────────────────────────────────────────────────

type SceneApi = ReturnType<typeof buildScene> | null;

interface CorridorInfo {
  zoneId: string;
  zoneName: string;
  maxPowerWatt: number;
}

export function TwinScreen() {
  useScreenViewLogging('Twin');
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef     = useRef<SceneApi>(null);
  const { width }    = useWindowDimensions();
  const canvasH      = Math.min(width * 0.7, 420);

  const latestByZone = useMeasurementsStore((s) => s.latestByZone);
  const subscribe     = useMeasurementsStore((s) => s.subscribe);
  const unsubscribe   = useMeasurementsStore((s) => s.unsubscribe);
  const building      = useActiveBuilding();
  const nav           = useNavigation<NativeStackNavigationProp<any>>();

  const [corridor, setCorridorInfo] = useState<CorridorInfo | null>(null);
  const [roomZoneIds, setRoomZoneIds] = useState<[string, string] | null>(null);

  // Le couloir 3D est une géométrie fixe (cf. twin.config.ts) mais sa donnée
  // reste live : on résout la première zone CORRIDOR du bâtiment via /zones,
  // comme le fait déjà TwinScreen.tsx (vue 2D).
  useEffect(() => {
    if (!building) return;
    let cancelled = false;

    zonesService.getZones({ buildingId: building.id, type: 'CORRIDOR' }).then(async (zones) => {
      const zone = zones[0];
      if (!zone) return;
      const circuits = await zonesService.getZoneCircuits(zone.id).catch(() => []);
      const maxPowerWatt = circuits.reduce((s, c) => s + (c.maxPowerWatt ?? 0), 0) || 1000;
      if (cancelled) return;
      setCorridorInfo({ zoneId: zone.id, zoneName: zone.name, maxPowerWatt });
    }).catch(() => {});

    return () => { cancelled = true; };
  }, [building?.id]);

  useEffect(() => {
    if (corridor) sceneRef.current?.setCorridor(corridor);
  }, [corridor]);

  // Même principe pour les salles : les UUID de TWIN_CONFIG.zones sont figés
  // dans le code mais se périment dès qu'un reseed régénère les zones — on
  // résout les vraies zoneId ROOM du bâtiment courant et on les fait
  // correspondre aux 2 emplacements fixes par nom.
  useEffect(() => {
    if (!building) return;
    let cancelled = false;

    zonesService.getZones({ buildingId: building.id, type: 'ROOM' }).then((zones) => {
      if (cancelled) return;
      const ids = TWIN_CONFIG.zones.map((cfg) => {
        const match = zones.find((z) => z.name === cfg.zoneName);
        return match?.id ?? cfg.zoneId;
      }) as [string, string];
      setRoomZoneIds(ids);
    }).catch(() => {});

    return () => { cancelled = true; };
  }, [building?.id]);

  useEffect(() => {
    if (roomZoneIds) sceneRef.current?.setRoomZoneIds(roomZoneIds);
  }, [roomZoneIds]);

  const [touring, setTouring] = useState(false);
  const [tourLabel, setTourLabel] = useState<string | null>(null);

  // zoneId réel = roomZoneIds[i] une fois résolu, sinon repli sur l'UUID figé de TWIN_CONFIG.
  const resolvedRoomId = (i: number) => roomZoneIds?.[i] ?? TWIN_CONFIG.zones[i].zoneId;

  const powerByZone: Record<string, number> = {};
  const presenceByZone: Record<string, boolean> = {};
  TWIN_CONFIG.zones.forEach((_z, i) => {
    const id = resolvedRoomId(i);
    powerByZone[id] = latestByZone[id]?.power ?? 0;
    presenceByZone[id] = latestByZone[id]?.presence ?? false;
  });
  if (corridor) {
    powerByZone[corridor.zoneId] = latestByZone[corridor.zoneId]?.power ?? 0;
    presenceByZone[corridor.zoneId] = latestByZone[corridor.zoneId]?.presence ?? false;
  }
  const totalPower = Object.values(powerByZone).reduce((s, v) => s + v, 0);
  const presentCount = Object.values(presenceByZone).filter(Boolean).length;

  const handleToggleTour = useCallback(() => {
    if (touring) {
      sceneRef.current?.stopTour();
      setTouring(false);
      setTourLabel(null);
      return;
    }
    setTouring(true);
    sceneRef.current?.startTour(
      (label) => setTourLabel(label),
      () => { setTouring(false); setTourLabel(null); },
    );
  }, [touring]);

  const handleZonePress = useCallback((zoneId: string) => {
    const zoneType = zoneId === corridor?.zoneId ? 'CORRIDOR' : 'ROOM';
    nav.navigate('Rooms', { screen: 'RoomDetail', params: { roomId: zoneId, zoneType } });
  }, [nav, corridor]);

  useEffect(() => {
    if (!containerRef.current) return;
    const api = buildScene(containerRef.current);
    sceneRef.current = api;
    api.setOnClick(handleZonePress);
    if (corridor) api.setCorridor(corridor);
    return () => { api.dispose(); sceneRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    sceneRef.current?.setOnClick(handleZonePress);
  }, [handleZonePress]);

  useEffect(() => {
    subscribe();
    return () => unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    sceneRef.current?.updatePower(powerByZone);
    sceneRef.current?.updatePresence(presenceByZone);
  }, [latestByZone, corridor]);

  return (
    <ScrollView className="flex-1 bg-surface-alt" contentContainerStyle={{ padding: 16, gap: 16 }}>

      <Card>
        <Text className="text-xs text-text-secondary font-medium mb-1">JUMEAU NUMÉRIQUE 3D</Text>
        <Text className="text-text-primary font-bold text-base" numberOfLines={1}>
          {building?.name ?? TWIN_CONFIG.buildingName}
        </Text>
        <Text className="text-xs text-text-muted mt-1">
          Glisser → pivoter • Scroll → zoom • Clic sur salle → détail
        </Text>
      </Card>

      <View className="flex-row gap-3">
        <Card className="flex-1">
          <Text className="text-xs text-text-secondary mb-1">Puissance totale</Text>
          <Text className="text-xl font-mono font-bold text-primary">{fmt(totalPower)}</Text>
        </Card>
        <Card className="flex-1">
          <Text className="text-xs text-text-secondary mb-1">Zones</Text>
          <Text className="text-xl font-mono font-bold text-success">
            {TWIN_CONFIG.zones.length + (corridor ? 1 : 0)}
          </Text>
        </Card>
        <Card className="flex-1">
          <Text className="text-xs text-text-secondary mb-1">Présence</Text>
          <Text className="text-xl font-mono font-bold text-amber-400">{presentCount}</Text>
        </Card>
      </View>

      {/* Conteneur 3D — panneau volontairement sombre (jumeau numérique "spotlight", cf. plan §4) */}
      <View
        className="rounded-xl overflow-hidden border border-border"
        style={{ height: canvasH, backgroundColor: palette.gray900 }}
      >
        <div
          ref={containerRef}
          style={{ width: '100%', height: '100%', position: 'relative', overflow: 'hidden' }}
        />
        {touring && tourLabel && (
          <View
            pointerEvents="none"
            className="absolute top-3 left-3 right-3 items-center"
          >
            <View className="bg-black/60 rounded-full px-4 py-1.5">
              <Text className="text-white text-xs font-medium">🎬 {tourLabel}</Text>
            </View>
          </View>
        )}
      </View>

      <Pressable onPress={handleToggleTour}>
        <Card className={touring ? 'bg-red-500/10 border-red-500/40' : ''}>
          <Text className={`text-center font-semibold text-sm ${touring ? 'text-red-400' : 'text-primary'}`}>
            {touring ? '⏹ Arrêter la visite guidée' : '🎬 Lancer la visite guidée'}
          </Text>
        </Card>
      </Pressable>

      {/* Liste salles + couloir */}
      <View className="gap-2">
        <Text className="text-xs text-text-secondary font-medium px-1">SALLES</Text>
        {TWIN_CONFIG.zones.map((zone, i) => {
          const zoneId = resolvedRoomId(i);
          const power = powerByZone[zoneId] ?? 0;
          const ratio = Math.min(1, power / zone.maxPowerWatt);
          const color = ratioToColor(ratio);
          return (
            <Pressable key={zoneId} onPress={() => handleZonePress(zoneId)}>
              <Card className="flex-row items-center gap-3">
                <View style={{ width: 10, height: 40, borderRadius: 5, backgroundColor: color }} />
                <View className="flex-1">
                  <Text className="text-text-primary font-medium text-sm">{zone.zoneName}</Text>
                  <Text className="text-text-secondary text-xs mt-0.5">
                    {Math.round(ratio * 100)}% capacité — max {fmt(zone.maxPowerWatt)}
                    {presenceByZone[zoneId] ? ' • 🧍 présence' : ''}
                  </Text>
                </View>
                <Text style={{ color }} className="font-mono font-bold text-base">{fmt(power)}</Text>
              </Card>
            </Pressable>
          );
        })}
        {corridor && (() => {
          const power = powerByZone[corridor.zoneId] ?? 0;
          const ratio = Math.min(1, power / corridor.maxPowerWatt);
          const color = ratioToColor(ratio);
          return (
            <Pressable onPress={() => handleZonePress(corridor.zoneId)}>
              <Card className="flex-row items-center gap-3">
                <View style={{ width: 10, height: 40, borderRadius: 5, backgroundColor: color }} />
                <View className="flex-1">
                  <Text className="text-text-primary font-medium text-sm">{corridor.zoneName}</Text>
                  <Text className="text-text-secondary text-xs mt-0.5">
                    {Math.round(ratio * 100)}% capacité — max {fmt(corridor.maxPowerWatt)}
                    {presenceByZone[corridor.zoneId] ? ' • 🧍 présence' : ''}
                  </Text>
                </View>
                <Text style={{ color }} className="font-mono font-bold text-base">{fmt(power)}</Text>
              </Card>
            </Pressable>
          );
        })()}
      </View>

      <Card>
        <Text className="text-xs text-text-secondary font-medium mb-3">LÉGENDE</Text>
        <View className="flex-row flex-wrap gap-3">
          {RATIO_LEGEND.map(({ color, label }) => (
            <View key={label} className="flex-row items-center gap-2">
              <View style={{ width: 12, height: 12, borderRadius: 3, backgroundColor: color }} />
              <Text className="text-xs text-text-secondary">{label}</Text>
            </View>
          ))}
        </View>
      </Card>
    </ScrollView>
  );
}
