import * as THREE from "three";
import * as CANNON from "cannon-es";
import { GameAudio } from "./audio.js";
import { LEVELS, SHOWCASE } from "./levels.js";

const BALL_R = 0.45;
const SAVE_KEY = "ollie-the-ball-v1";
const STEP = 1 / 60;
const ROLL_FORCE = 11;
const AIR_FORCE = 5;
const JUMP_V = 8.2;
const SUPER_JUMP_V = 15.6;
const MAX_SPEED = 4.5;
const SLOW_MAX = 2.6;
const ROLL_DAMP = 0.52;
const SLOW_DAMP = 0.8;
const SLOW_TIME = 5;

const $ = (id) => document.getElementById(id);

function loadSave() {
  try {
    return {
      unlocked: 1,
      best: {},
      music: 0.55,
      sfx: 0.85,
      quality: "high",
      ...JSON.parse(localStorage.getItem(SAVE_KEY) || "{}"),
    };
  } catch {
    return { unlocked: 1, best: {}, music: 0.55, sfx: 0.85, quality: "high" };
  }
}

function writeSave(s) {
  localStorage.setItem(SAVE_KEY, JSON.stringify(s));
}

function v3(a) {
  return new THREE.Vector3(a[0], a[1], a[2]);
}

class Input {
  constructor() {
    this.keys = new Set();
    this.move = { x: 0, y: 0 };
    this.jumpQueued = false;
    this.look = { dx: 0, dy: 0 };
    this.pointer = { down: false, x: 0, y: 0, id: null };
    this.stickTouch = null;
    window.addEventListener("keydown", (e) => {
      const tag = (e.target && e.target.tagName) || "";
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      const k = e.key.toLowerCase();
      const isJump = k === " " || k === "spacebar" || e.code === "Space";
      if (isJump || ["arrowup", "arrowdown", "arrowleft", "arrowright"].includes(k)) {
        e.preventDefault();
      }
      this.keys.add(k);
      if (isJump) this.jumpQueued = true;
    });
    window.addEventListener("keyup", (e) => this.keys.delete(e.key.toLowerCase()));
  }

  sampleLook() {
    const d = { ...this.look };
    this.look.dx = 0;
    this.look.dy = 0;
    return d;
  }

  axes() {
    let x = 0;
    let y = 0;
    if (this.keys.has("a") || this.keys.has("arrowleft")) x -= 1;
    if (this.keys.has("d") || this.keys.has("arrowright")) x += 1;
    if (this.keys.has("s") || this.keys.has("arrowdown")) y -= 1;
    if (this.keys.has("w") || this.keys.has("arrowup")) y += 1;
    x += this.move.x;
    y += this.move.y;
    const m = Math.hypot(x, y);
    if (m > 1) {
      x /= m;
      y /= m;
    }
    return { x, y };
  }
}

export class Game {
  constructor() {
    this.save = loadSave();
    this.audio = new GameAudio();
    this.input = new Input();
    this.mode = "splash";
    this.levelIndex = 0;
    this.paused = false;
    this.won = false;
    this.dead = false;
    this.elapsed = 0;
    this.found = 0;
    this.total = 0;
    this.grounded = false;
    this.wasGrounded = false;
    this.coyote = 0;
    this.jumpBuf = 0;
    this.needCoinsT = 0;
    this.padCool = new Map();
    this.camYaw = 0.6;
    this.camPitch = 0.42;
    this.camDist = 9;
    this.showcaseT = 0;
    this.rain = null;
    this.clock = new THREE.Clock();
    this.acc = 0;
    this.tmp = new THREE.Vector3();
    this.fwd = new THREE.Vector3();
    this.right = new THREE.Vector3();
    this.ray = new CANNON.Ray();
    this.rayRes = new CANNON.RaycastResult();
    this.worldItems = [];
    this.coins = [];
    this.boosters = [];
    this.teleporters = [];
    this.movers = [];
    this.hazards = [];
    this.pickups = [];
    this.door = null;
    this.player = null;
    this.playerBody = null;
    this.level = null;
    this.superJumps = 0;
    this.slowT = 0;
    this.boostIgnoreCap = 0;

    this.canvas = $("gl");
    this.renderer = null;
    try {
      this.renderer = new THREE.WebGLRenderer({
        canvas: this.canvas,
        antialias: true,
        alpha: false,
        powerPreference: "high-performance",
        failIfMajorPerformanceCaveat: false,
      });
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;
      this.renderer.shadowMap.enabled = true;
      this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    } catch (err) {
      console.error(err);
      const btn = $("btn-enter");
      if (btn) btn.textContent = "WebGL required — open in Chrome or Safari";
    }
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(55, 1, 0.1, 400);
    this.camera.position.set(0, 8, 14);

    this.hemi = new THREE.HemisphereLight(0xcfe9ff, 0x3d4a28, 0.9);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff1c8, 1.35);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 90;
    this.sun.shadow.camera.left = -35;
    this.sun.shadow.camera.right = 35;
    this.sun.shadow.camera.top = 35;
    this.sun.shadow.camera.bottom = -35;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    this.world = null;
    this.ballMat = new CANNON.Material("ball");
    this.groundMat = new CANNON.Material("ground");

    this.textures = {};
    this.mats = {};
    this.geos = {
      sphere: new THREE.SphereGeometry(BALL_R, 32, 24),
      coin: new THREE.CylinderGeometry(0.38, 0.38, 0.09, 28),
      box: new THREE.BoxGeometry(1, 1, 1),
      cyl: new THREE.CylinderGeometry(1, 1, 1, 12),
      cone: new THREE.ConeGeometry(1, 1, 10),
      plane: new THREE.PlaneGeometry(1, 1, 1, 1),
      torus: new THREE.TorusGeometry(1.15, 0.12, 10, 28),
      orb: new THREE.SphereGeometry(0.34, 16, 12),
    };

    this.cheatBuf = "";
    this.bindUI();
    this.bindPointer();
    window.addEventListener("resize", () => this.resize());
    const resumeAudio = () => this.audio.ctx?.resume().catch(() => {});
    window.addEventListener("pointerdown", resumeAudio);
    window.addEventListener("keydown", resumeAudio);
    this.resize();
    this.applyQuality(this.save.quality);
  }

  bindUI() {
    $("btn-enter").addEventListener("click", () => this.enter());
    document.querySelectorAll("[data-action]").forEach((btn) => {
      btn.addEventListener("mouseenter", () => this.audio.play("select", { volume: 0.4 }));
      btn.addEventListener("click", () => {
        this.audio.play("selectDown", { volume: 0.7 });
        this.onAction(btn.dataset.action);
      });
    });
    $("btn-pause").addEventListener("click", () => this.setPaused(true));
    const queueJump = (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.input.jumpQueued = true;
    };
    $("btn-jump").addEventListener("pointerdown", queueJump);
    $("btn-jump").addEventListener("touchstart", queueJump, { passive: false });
    $("vol-music").value = this.save.music;
    $("vol-sfx").value = this.save.sfx;
    $("opt-quality").value = this.save.quality;
    $("vol-music").addEventListener("input", (e) => {
      this.save.music = Number(e.target.value);
      this.audio.setMusic(this.save.music);
      writeSave(this.save);
    });
    $("vol-sfx").addEventListener("input", (e) => {
      this.save.sfx = Number(e.target.value);
      this.audio.setSfx(this.save.sfx);
      writeSave(this.save);
    });
    $("opt-quality").addEventListener("change", (e) => {
      this.save.quality = e.target.value;
      this.applyQuality(this.save.quality);
      writeSave(this.save);
    });
    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && this.mode === "play") this.setPaused(!this.paused);
      this.noteCheatKey(e);
    });
    const cheat = $("cheat-code");
    if (cheat) {
      cheat.addEventListener("input", () => {
        if (cheat.value.trim().toLowerCase() === "ollie") {
          cheat.value = "";
          cheat.blur();
          this.unlockAllLevels();
        }
      });
      cheat.addEventListener("keydown", (e) => e.stopPropagation());
    }
  }

  noteCheatKey(e) {
    const tag = (e.target && e.target.tagName) || "";
    if (tag === "INPUT" || tag === "TEXTAREA") return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (!e.key || e.key.length !== 1) return;
    const ch = e.key.toLowerCase();
    if (ch < "a" || ch > "z") return;
    this.cheatBuf = (this.cheatBuf + ch).slice(-5);
    if (this.cheatBuf === "ollie") {
      this.cheatBuf = "";
      this.unlockAllLevels();
    }
  }

  unlockAllLevels() {
    this.save.unlocked = LEVELS.length;
    writeSave(this.save);
    this.audio.play("won", { volume: 0.55 });
    this.flashNeed("All levels unlocked.", 2.6, true);
    if (!$("screen-levels").classList.contains("hidden")) this.renderLevelGrid();
  }

  bindPointer() {
    const stick = $("stick");
    const knob = $("stick-knob");
    const setStick = (x, y) => {
      const r = 36;
      const m = Math.hypot(x, y) || 1;
      const s = Math.min(1, m / r);
      const nx = (x / m) * s;
      const ny = (y / m) * s;
      knob.style.transform = `translate(${nx * r}px, ${ny * r}px)`;
      this.input.move.x = nx;
      this.input.move.y = -ny;
    };
    const resetStick = () => {
      knob.style.transform = "";
      this.input.move.x = 0;
      this.input.move.y = 0;
      this.input.stickTouch = null;
    };
    stick.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      stick.setPointerCapture(e.pointerId);
      this.input.stickTouch = e.pointerId;
      const b = stick.getBoundingClientRect();
      setStick(e.clientX - (b.left + b.width / 2), e.clientY - (b.top + b.height / 2));
    });
    stick.addEventListener("pointermove", (e) => {
      if (this.input.stickTouch !== e.pointerId) return;
      const b = stick.getBoundingClientRect();
      setStick(e.clientX - (b.left + b.width / 2), e.clientY - (b.top + b.height / 2));
    });
    stick.addEventListener("pointerup", resetStick);
    stick.addEventListener("pointercancel", resetStick);

    this.canvas.addEventListener("pointerdown", (e) => {
      if (e.target.closest && e.target.closest("#touch")) return;
      this.input.pointer.down = true;
      this.input.pointer.x = e.clientX;
      this.input.pointer.y = e.clientY;
      this.input.pointer.id = e.pointerId;
      this.canvas.setPointerCapture(e.pointerId);
    });
    this.canvas.addEventListener("pointermove", (e) => {
      if (!this.input.pointer.down || this.input.pointer.id !== e.pointerId) return;
      this.input.look.dx += e.clientX - this.input.pointer.x;
      this.input.look.dy += e.clientY - this.input.pointer.y;
      this.input.pointer.x = e.clientX;
      this.input.pointer.y = e.clientY;
    });
    const up = () => {
      this.input.pointer.down = false;
    };
    this.canvas.addEventListener("pointerup", up);
    this.canvas.addEventListener("pointercancel", up);
    this.canvas.addEventListener("wheel", (e) => {
      this.camDist = THREE.MathUtils.clamp(this.camDist + e.deltaY * 0.01, 6, 16);
    }, { passive: true });
  }

  applyQuality(q) {
    if (!this.renderer) return;
    const dpr = window.devicePixelRatio || 1;
    if (q === "high") {
      this.renderer.setPixelRatio(Math.min(2, dpr));
      this.renderer.shadowMap.enabled = true;
      this.sun.castShadow = true;
      this.sun.shadow.mapSize.set(2048, 2048);
    } else if (q === "medium") {
      this.renderer.setPixelRatio(Math.min(1.25, dpr));
      this.renderer.shadowMap.enabled = true;
      this.sun.castShadow = true;
      this.sun.shadow.mapSize.set(1024, 1024);
    } else {
      this.renderer.setPixelRatio(1);
      this.renderer.shadowMap.enabled = false;
      this.sun.castShadow = false;
    }
    this.resize();
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
    this.renderer?.setSize(w, h, false);
  }

  async loadTextures() {
    const loader = new THREE.TextureLoader();
    const names = ["ollie", "grass", "wood", "stone", "sand", "brick", "forest", "crate"];
    const files = {
      ollie: "assets/textures/ollie.png",
      grass: "assets/textures/grass.jpg",
      wood: "assets/textures/wood.jpg",
      stone: "assets/textures/stone.jpg",
      sand: "assets/textures/sand.jpg",
      brick: "assets/textures/brick.jpg",
      forest: "assets/textures/forest.jpg",
      crate: "assets/textures/crate.jpg",
    };
    await Promise.all(names.map((n) => new Promise((resolve) => {
      loader.load(files[n], (t) => {
        t.colorSpace = THREE.SRGBColorSpace;
        t.anisotropy = 8;
        if (n !== "ollie") {
          t.wrapS = t.wrapT = THREE.RepeatWrapping;
        }
        this.textures[n] = t;
        resolve();
      }, undefined, () => resolve());
    })));
    const mk = (map, color, rough = 0.86, metal = 0.04) =>
      new THREE.MeshStandardMaterial({ map: map || null, color, roughness: rough, metalness: metal });
    this.mats.grass = mk(this.textures.grass, 0xffffff);
    this.mats.wood = mk(this.textures.wood, 0xffffff, 0.8, 0.02);
    this.mats.stone = mk(this.textures.stone, 0xffffff, 0.9, 0.08);
    this.mats.sand = mk(this.textures.sand, 0xffffff, 0.95, 0);
    this.mats.brick = mk(this.textures.brick, 0xffffff, 0.88, 0.02);
    this.mats.forest = mk(this.textures.forest, 0xffffff);
    this.mats.crate = mk(this.textures.crate, 0xffffff, 0.82, 0.02);
    this.mats.ollie = new THREE.MeshStandardMaterial({
      map: this.textures.ollie,
      roughness: 0.32,
      metalness: 0.08,
      emissive: 0x332200,
      emissiveIntensity: 0.12,
    });
    this.mats.gold = new THREE.MeshStandardMaterial({
      color: 0xffd24a,
      roughness: 0.28,
      metalness: 0.85,
      emissive: 0x553300,
      emissiveIntensity: 0.35,
    });
    this.mats.leaf = new THREE.MeshStandardMaterial({ color: 0x2f8a3a, roughness: 0.9 });
    this.mats.bark = new THREE.MeshStandardMaterial({ color: 0x6a3d1a, roughness: 0.95 });
    this.mats.water = new THREE.MeshStandardMaterial({
      color: 0x1d6aa5,
      transparent: true,
      opacity: 0.72,
      roughness: 0.15,
      metalness: 0.2,
    });
    this.mats.speed = new THREE.MeshStandardMaterial({
      color: 0x3de0ff,
      emissive: 0x1288aa,
      emissiveIntensity: 0.8,
      roughness: 0.4,
    });
    this.mats.jump = new THREE.MeshStandardMaterial({
      color: 0xff4ec8,
      emissive: 0x881166,
      emissiveIntensity: 0.8,
      roughness: 0.4,
    });
    this.mats.portal = new THREE.MeshStandardMaterial({
      color: 0x66f0ff,
      emissive: 0x22c4ff,
      emissiveIntensity: 1.2,
      roughness: 0.25,
      metalness: 0.4,
    });
    this.mats.roof = new THREE.MeshStandardMaterial({ color: 0x8a3a28, roughness: 0.85 });
    this.mats.pine = new THREE.MeshStandardMaterial({ color: 0x1f5c38, roughness: 0.9 });
    this.mats.rock = new THREE.MeshStandardMaterial({ color: 0x8a8680, roughness: 0.95, map: this.textures.stone || null });
    this.mats.bush = new THREE.MeshStandardMaterial({ color: 0x3f9a4a, roughness: 0.92 });
    this.mats.slow = new THREE.MeshStandardMaterial({
      color: 0x7fe8ff,
      emissive: 0x1488aa,
      emissiveIntensity: 0.95,
      roughness: 0.28,
      metalness: 0.35,
    });
    this.mats.super = new THREE.MeshStandardMaterial({
      color: 0xffc14a,
      emissive: 0xaa6600,
      emissiveIntensity: 0.95,
      roughness: 0.28,
      metalness: 0.4,
    });
  }

  newPhysics() {
    const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -26, 0) });
    world.broadphase = new CANNON.SAPBroadphase(world);
    world.allowSleep = true;
    world.defaultContactMaterial.friction = 0.45;
    world.defaultContactMaterial.restitution = 0.18;
    world.addContactMaterial(new CANNON.ContactMaterial(this.ballMat, this.groundMat, {
      friction: 0.7,
      restitution: 0.16,
    }));
    return world;
  }

  clearWorld() {
    if (this.world) {
      this.world.bodies.slice().forEach((b) => this.world.removeBody(b));
    }
    const sharedGeo = new Set(Object.values(this.geos));
    const sharedMat = new Set(Object.values(this.mats));
    this.worldItems.forEach((o) => {
      this.scene.remove(o);
      o.traverse?.((ch) => {
        if (ch.geometry && !sharedGeo.has(ch.geometry)) ch.geometry.dispose?.();
        const mats = ch.material ? (Array.isArray(ch.material) ? ch.material : [ch.material]) : [];
        for (const m of mats) {
          if (!m || sharedMat.has(m)) continue;
          if (m.map && !Object.values(this.textures).includes(m.map)) m.map.dispose?.();
          m.dispose?.();
        }
      });
    });
    this.worldItems = [];
    this.coins = [];
    this.boosters = [];
    this.teleporters = [];
    this.movers = [];
    this.hazards = [];
    this.pickups = [];
    this.door = null;
    this.player = null;
    this.playerBody = null;
    if (this.rain) {
      this.scene.remove(this.rain);
      this.rain.geometry.dispose();
      this.rain = null;
    }
  }

  addMesh(mesh, body) {
    this.scene.add(mesh);
    this.worldItems.push(mesh);
    if (body) {
      mesh.userData.body = body;
      this.world.addBody(body);
    }
    return mesh;
  }

  boxMesh(size, matName, pos, { kinematic = false, visible = true } = {}) {
    const mesh = new THREE.Mesh(this.geos.box, this.tiledMat(matName, size));
    mesh.scale.set(size[0], size[1], size[2]);
    mesh.position.set(pos[0], pos[1], pos[2]);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.visible = visible;
    const shape = new CANNON.Box(new CANNON.Vec3(size[0] / 2, size[1] / 2, size[2] / 2));
    const body = new CANNON.Body({
      mass: 0,
      material: this.groundMat,
      type: kinematic ? CANNON.Body.KINEMATIC : CANNON.Body.STATIC,
      shape,
      position: new CANNON.Vec3(pos[0], pos[1], pos[2]),
    });
    this.addMesh(mesh, body);
    return { mesh, body };
  }

  tiledMat(name, size) {
    const base = this.mats[name] || this.mats.grass;
    const mat = base.clone();
    if (mat.map) {
      mat.map = mat.map.clone();
      mat.map.needsUpdate = true;
      mat.map.wrapS = mat.map.wrapT = THREE.RepeatWrapping;
      const u = Math.max(1, size[0] / 4);
      const v = Math.max(1, size[2] / 4);
      mat.map.repeat.set(u, v);
    }
    return mat;
  }

  buildLevel(level, { showcase = false } = {}) {
    this.clearWorld();
    this.world = this.newPhysics();
    this.level = level;
    this.scene.background = new THREE.Color(level.sky);
    this.scene.fog = new THREE.Fog(level.fog, 28, 110);
    this.hemi.color.set(level.sky);
    this.sun.position.set(18, 28, 10);
    this.sun.target.position.set(20, 0, 0);

    for (const plat of level.platforms || []) this.boxMesh(plat.size, plat.mat, plat.pos);
    for (const w of level.walls || []) this.boxMesh(w.size, w.mat, w.pos);

    if (level.water) {
      const water = new THREE.Mesh(this.geos.plane, this.mats.water);
      water.rotation.x = -Math.PI / 2;
      water.scale.set(level.water.size, level.water.size, 1);
      water.position.set(20, level.water.y, 0);
      this.addMesh(water);
    }

    for (const m of level.movers || []) {
      const built = this.boxMesh(m.size, m.mat, m.pos, { kinematic: true });
      this.movers.push({
        ...m,
        mesh: built.mesh,
        body: built.body,
        dir: 1,
        waiting: false,
        waitLeft: 0,
        origin: m.pos.slice(),
      });
    }

    for (const c of level.coins || []) {
      const mesh = new THREE.Mesh(this.geos.coin, this.mats.gold);
      mesh.rotation.x = Math.PI / 2;
      mesh.position.set(c[0], c[1], c[2]);
      mesh.castShadow = true;
      this.addMesh(mesh);
      this.coins.push({ mesh, pos: c.slice(), taken: false });
    }

    for (const b of level.boosters || []) {
      const mesh = new THREE.Mesh(this.geos.box, b.type === "speed" ? this.mats.speed : this.mats.jump);
      mesh.scale.set(1.8, 0.12, 1.8);
      mesh.position.set(b.pos[0], b.pos[1], b.pos[2]);
      this.addMesh(mesh);
      this.boosters.push({ ...b, mesh, armed: true });
    }

    for (const t of level.teleporters || []) {
      this.teleporters.push({
        from: t.from,
        to: t.to,
        ringA: this.makeRing(t.from),
        ringB: this.makeRing(t.to, true),
        cool: 0,
      });
    }

    if (level.door) this.door = this.makeDoor(level.door);

    for (const d of level.decor || []) this.makeDecor(d);
    for (const h of level.hazards || []) this.hazards.push(h);
    for (const s of level.skills || []) this.makeSkill(s);
    if (level.waterfall) this.makeWaterfall(level.waterfall.pos);
    if (level.rain) this.makeRain();

    this.superJumps = 0;
    this.slowT = 0;
    this.updateSkillHud();

    this.spawnPlayer(level.spawn, { kinematic: showcase });
    this.found = 0;
    this.total = this.coins.filter((c) => !c.taken).length;
    this.elapsed = 0;
    this.won = false;
    this.dead = false;
    this.camYaw = 0.55;
    this.camPitch = 0.42;
  }

  makeRing(pos, dim = false) {
    const g = new THREE.Group();
    const torus = new THREE.Mesh(this.geos.torus, this.mats.portal);
    torus.rotation.x = Math.PI / 2;
    g.add(torus);
    g.position.set(pos[0], pos[1], pos[2]);
    g.scale.setScalar(dim ? 0.85 : 1);
    const light = new THREE.PointLight(0x66f0ff, 1.4, 8);
    g.add(light);
    this.addMesh(g);
    return g;
  }

  makeDoor(pos) {
    const g = new THREE.Group();
    const matStone = this.mats.stone;
    const colL = new THREE.Mesh(this.geos.box, matStone);
    colL.scale.set(0.55, 3.2, 0.55);
    colL.position.set(-1.1, 0.2, 0);
    const colR = colL.clone();
    colR.position.x = 1.1;
    const lintel = new THREE.Mesh(this.geos.box, matStone);
    lintel.scale.set(2.8, 0.45, 0.6);
    lintel.position.set(0, 1.85, 0);
    const gate = new THREE.Mesh(this.geos.torus, this.mats.portal);
    gate.scale.set(1.05, 1.25, 1);
    const swirl = new THREE.Mesh(
      new THREE.CircleGeometry(1.05, 24),
      new THREE.MeshBasicMaterial({ color: 0x8cf4ff, transparent: true, opacity: 0.45, side: THREE.DoubleSide }),
    );
    swirl.position.z = 0.05;
    g.add(colL, colR, lintel, gate, swirl);
    g.position.set(pos[0], pos[1], pos[2]);
    const light = new THREE.PointLight(0xffef8a, 2.2, 12);
    light.position.set(0, 1, 0.4);
    g.add(light);
    g.userData.swirl = swirl;
    g.userData.gate = gate;
    this.addMesh(g);
    colL.castShadow = colR.castShadow = true;
    return g;
  }

  makeDecor(d) {
    const g = new THREE.Group();
    g.position.set(d.pos[0], d.pos[1], d.pos[2]);
    if (d.type === "tree") {
      const trunk = new THREE.Mesh(this.geos.cyl, this.mats.bark);
      trunk.scale.set(0.28, 1.6, 0.28);
      trunk.position.y = 0.8;
      const leaf = new THREE.Mesh(this.geos.cone, this.mats.leaf);
      leaf.scale.set(1.4, 2.4, 1.4);
      leaf.position.y = 2.4;
      const leaf2 = leaf.clone();
      leaf2.scale.set(1.1, 1.8, 1.1);
      leaf2.position.y = 3.3;
      g.add(trunk, leaf, leaf2);
      this.boxMesh([0.8, 3.2, 0.8], "wood", [d.pos[0], d.pos[1] + 1.4, d.pos[2]], { visible: false });
    } else if (d.type === "crate") {
      const m = new THREE.Mesh(this.geos.box, this.mats.crate);
      m.scale.set(1.1, 1.1, 1.1);
      g.add(m);
      this.boxMesh([1.1, 1.1, 1.1], "crate", [d.pos[0], d.pos[1], d.pos[2]]);
      return;
    } else if (d.type === "barrel") {
      const m = new THREE.Mesh(this.geos.cyl, this.mats.wood);
      m.scale.set(0.5, 1.1, 0.5);
      g.add(m);
      this.boxMesh([0.9, 1.1, 0.9], "wood", d.pos);
      return;
    } else if (d.type === "house") {
      const body = new THREE.Mesh(this.geos.box, this.mats.brick);
      body.scale.set(4.2, 3.2, 3.4);
      body.position.y = 1.4;
      const roof = new THREE.Mesh(this.geos.cone, this.mats.roof);
      roof.scale.set(3.4, 2.2, 3.4);
      roof.position.y = 4.1;
      g.add(body, roof);
      this.boxMesh([4.2, 3.2, 3.4], "brick", [d.pos[0], d.pos[1] + 1.4, d.pos[2]], { visible: false });
    } else if (d.type === "buoy") {
      const s = new THREE.Mesh(this.geos.sphere, this.mats.jump);
      s.scale.set(0.7, 0.7, 0.7);
      const pole = new THREE.Mesh(this.geos.cyl, this.mats.wood);
      pole.scale.set(0.08, 1.4, 0.08);
      pole.position.y = 0.8;
      g.add(s, pole);
    } else if (d.type === "well") {
      const ring = new THREE.Mesh(this.geos.cyl, this.mats.stone);
      ring.scale.set(1.3, 0.5, 1.3);
      const hole = new THREE.Mesh(this.geos.cyl, new THREE.MeshBasicMaterial({ color: 0x111111 }));
      hole.scale.set(0.85, 0.52, 0.85);
      g.add(ring, hole);
    } else if (d.type === "pine") {
      const sc = d.scale || 1;
      const trunk = new THREE.Mesh(this.geos.cyl, this.mats.bark);
      trunk.scale.set(0.22 * sc, 1.8 * sc, 0.22 * sc);
      trunk.position.y = 0.9 * sc;
      const a = new THREE.Mesh(this.geos.cone, this.mats.pine);
      a.scale.set(1.5 * sc, 2.2 * sc, 1.5 * sc);
      a.position.y = 2.2 * sc;
      const b = a.clone();
      b.scale.set(1.15 * sc, 1.7 * sc, 1.15 * sc);
      b.position.y = 3.2 * sc;
      g.add(trunk, a, b);
      this.boxMesh([0.7 * sc, 3.4 * sc, 0.7 * sc], "wood", [d.pos[0], d.pos[1] + 1.5 * sc, d.pos[2]], { visible: false });
    } else if (d.type === "hut") {
      const body = new THREE.Mesh(this.geos.box, this.mats.wood);
      body.scale.set(2.6, 2.2, 2.4);
      body.position.y = 1.0;
      const roof = new THREE.Mesh(this.geos.cone, this.mats.roof);
      roof.scale.set(2.2, 1.5, 2.2);
      roof.position.y = 2.7;
      g.add(body, roof);
      this.boxMesh([2.6, 2.2, 2.4], "wood", [d.pos[0], d.pos[1] + 1.0, d.pos[2]], { visible: false });
    } else if (d.type === "tower") {
      const h = d.h || 5;
      const body = new THREE.Mesh(this.geos.box, this.mats.brick);
      body.scale.set(2.6, h, 2.6);
      body.position.y = h / 2;
      const roof = new THREE.Mesh(this.geos.cone, this.mats.roof);
      roof.scale.set(2.2, 1.6, 2.2);
      roof.position.y = h + 0.6;
      g.add(body, roof);
      this.boxMesh([2.6, h, 2.6], "brick", [d.pos[0], d.pos[1] + h / 2, d.pos[2]], { visible: false });
    } else if (d.type === "rock") {
      const sc = d.scale || 1;
      const m = new THREE.Mesh(this.geos.sphere, this.mats.rock);
      m.scale.set(1.1 * sc, 0.7 * sc, 1.2 * sc);
      g.add(m);
      this.boxMesh([1.6 * sc, 0.9 * sc, 1.6 * sc], "stone", [d.pos[0], d.pos[1], d.pos[2]], { visible: false });
    } else if (d.type === "bush") {
      const m = new THREE.Mesh(this.geos.sphere, this.mats.bush);
      m.scale.set(0.9, 0.7, 0.9);
      g.add(m);
    } else if (d.type === "lamp") {
      const pole = new THREE.Mesh(this.geos.cyl, this.mats.stone);
      pole.scale.set(0.08, 2.2, 0.08);
      pole.position.y = 1.1;
      const lamp = new THREE.Mesh(this.geos.sphere, this.mats.gold);
      lamp.scale.set(0.28, 0.28, 0.28);
      lamp.position.y = 2.3;
      g.add(pole, lamp);
    } else if (d.type === "container") {
      const m = new THREE.Mesh(this.geos.box, this.mats.crate);
      m.scale.set(d.len || 3.4, 1.6, 1.5);
      g.add(m);
      this.boxMesh([d.len || 3.4, 1.6, 1.5], "crate", d.pos);
      return;
    }
    g.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    this.addMesh(g);
  }

  makeSkill(s) {
    const mesh = new THREE.Mesh(this.geos.orb, s.type === "slow" ? this.mats.slow : this.mats.super);
    mesh.position.set(s.pos[0], s.pos[1], s.pos[2]);
    mesh.castShadow = true;
    this.addMesh(mesh);
    this.pickups.push({ mesh, type: s.type, pos: s.pos.slice(), taken: false });
  }

  makeWaterfall(pos) {
    const mat = new THREE.MeshStandardMaterial({
      color: 0xa8e7ff,
      transparent: true,
      opacity: 0.45,
      roughness: 0.2,
    });
    const sheet = new THREE.Mesh(this.geos.box, mat);
    sheet.scale.set(4, 8, 0.4);
    sheet.position.set(pos[0], pos[1], pos[2]);
    this.addMesh(sheet);
  }

  makeRain() {
    const count = 900;
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = Math.random() * 80 - 10;
      pos[i * 3 + 1] = Math.random() * 30;
      pos[i * 3 + 2] = Math.random() * 40 - 20;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    this.rain = new THREE.Points(geo, new THREE.PointsMaterial({
      color: 0xb9d7ee,
      size: 0.08,
      transparent: true,
      opacity: 0.7,
    }));
    this.scene.add(this.rain);
    this.worldItems.push(this.rain);
  }

  spawnPlayer(pos, { kinematic = false } = {}) {
    const mesh = new THREE.Mesh(this.geos.sphere, this.mats.ollie);
    mesh.castShadow = true;
    mesh.position.set(pos[0], pos[1], pos[2]);
    const body = new CANNON.Body({
      mass: kinematic ? 0 : 1.25,
      type: kinematic ? CANNON.Body.KINEMATIC : CANNON.Body.DYNAMIC,
      shape: new CANNON.Sphere(BALL_R),
      material: this.ballMat,
      position: new CANNON.Vec3(pos[0], pos[1], pos[2]),
      linearDamping: ROLL_DAMP,
      angularDamping: 0.22,
      allowSleep: false,
      collisionFilterGroup: 2,
      collisionFilterMask: 1,
    });
    this.addMesh(mesh, body);
    this.player = mesh;
    this.playerBody = body;
  }

  async enter() {
    if (!this.renderer) return;
    await this.audio.unlock();
    this.audio.setMusic(this.save.music);
    this.audio.setSfx(this.save.sfx);
    if (!this.textures.ollie) await this.loadTextures();
    this.showScreen("menu");
    this.buildLevel(SHOWCASE, { showcase: true });
    this.mode = "menu";
    this.audio.startMusic("day");
  }

  showScreen(name) {
    ["splash", "menu", "levels", "controls", "credits", "pause", "result"].forEach((n) => {
      $(`screen-${n}`).classList.toggle("hidden", n !== name);
    });
    const playing = name === null;
    $("hud").classList.toggle("hidden", !playing);
    const touch = navigator.maxTouchPoints > 0 || window.matchMedia("(pointer: coarse)").matches;
    $("touch").classList.toggle("hidden", !(playing && touch));
  }

  onAction(action) {
    if (action === "play") this.startLevel(0);
    if (action === "levels") {
      this.renderLevelGrid();
      this.showScreen("levels");
    }
    if (action === "controls") this.showScreen("controls");
    if (action === "credits") this.showScreen("credits");
    if (action === "menu") this.goMenu();
    if (action === "resume") this.setPaused(false);
    if (action === "retry") this.startLevel(this.levelIndex);
  }

  renderLevelGrid() {
    const grid = $("level-grid");
    grid.innerHTML = "";
    LEVELS.forEach((lv, i) => {
      const locked = i + 1 > this.save.unlocked;
      const btn = document.createElement("button");
      btn.className = "level-card";
      btn.disabled = locked;
      const best = this.save.best[lv.id];
      btn.innerHTML = `<div class="num">${lv.name}</div><div>${locked ? "Locked" : lv.title}</div>
        <div class="best">${locked ? "Clear earlier stages" : `${lv.blurb || ""}${best ? ` · Best ${best.toFixed(1)}s` : ""}`}</div>`;
      btn.addEventListener("click", () => {
        if (!locked) this.startLevel(i);
      });
      grid.appendChild(btn);
    });
  }

  goMenu() {
    this.paused = false;
    this.mode = "menu";
    this.showScreen("menu");
    this.buildLevel(SHOWCASE, { showcase: true });
    this.audio.startMusic("day");
  }

  startLevel(index) {
    this.levelIndex = index;
    const lv = LEVELS[index];
    this.paused = false;
    this.mode = "play";
    this.padCool.clear();
    this.input.jumpQueued = false;
    this.wasGrounded = true;
    this.coyote = 0;
    this.jumpBuf = 0;
    this.superJumps = 0;
    this.slowT = 0;
    this.boostIgnoreCap = 0;
    this.showScreen(null);
    this.buildLevel(lv);
    $("hud-level").textContent = `${lv.name} · ${lv.title}`;
    this.updateCoinsHud();
    this.updateSkillHud();
    this.audio.startMusic(lv.theme);
    const intro = lv.story || lv.hint;
    if (intro) this.flashNeed(intro, 5.2, true);
  }

  setPaused(p) {
    if (this.mode !== "play" || this.won || this.dead) return;
    this.paused = p;
    this.input.jumpQueued = false;
    if (p) {
      this.audio.pauseMusic();
      this.showScreen("pause");
    } else {
      this.audio.resumeMusic();
      this.showScreen(null);
    }
  }

  updateCoinsHud() {
    $("hud-coins").textContent = `${this.found} / ${this.total}`;
  }

  updateSkillHud() {
    const sup = $("hud-super");
    const slow = $("hud-slow");
    if (sup) {
      sup.classList.toggle("hidden", this.superJumps <= 0);
      sup.textContent = this.superJumps > 0 ? `Super Jump ×${this.superJumps}` : "";
    }
    if (slow) {
      slow.classList.toggle("hidden", this.slowT <= 0);
      slow.textContent = this.slowT > 0 ? `Slow ${this.slowT.toFixed(1)}s` : "";
    }
  }

  flashNeed(text, dur = 3, ok = false) {
    const el = $("toast");
    el.textContent = text;
    el.classList.toggle("ok", !!ok);
    el.classList.remove("hidden");
    this.needCoinsT = dur;
  }

  groundedNow() {
    const body = this.playerBody;
    if (!body || !this.world) return false;
    const contacts = this.world.contacts;
    for (let i = 0; i < contacts.length; i++) {
      const c = contacts[i];
      if (c.bi !== body && c.bj !== body) continue;
      let ny = c.ni.y;
      if (c.bi === body) ny = -ny;
      if (ny > 0.35) return true;
    }
    this.rayRes.reset();
    const p = body.position;
    this.ray.from.set(p.x, p.y, p.z);
    this.ray.to.set(p.x, p.y - BALL_R - 0.35, p.z);
    this.world.raycastClosest(this.ray.from, this.ray.to, {
      skipBackfaces: false,
      collisionFilterGroup: 1,
      collisionFilterMask: 1,
    }, this.rayRes);
    return this.rayRes.hasHit && this.rayRes.body !== body && this.rayRes.hitNormalWorld.y > 0.35;
  }

  physics(dt) {
    if (!this.playerBody || this.mode !== "play" || this.paused || this.won || this.dead) {
      if (this.paused || this.mode !== "play") {
        this.input.jumpQueued = false;
        this.jumpBuf = 0;
      }
      if (this.mode === "menu") this.world?.step(dt);
      return;
    }

    this.updateMovers(dt);

    const axes = this.input.axes();
    this.fwd.set(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.camYaw);
    this.fwd.y = 0;
    this.fwd.normalize();
    this.right.crossVectors(this.fwd, new THREE.Vector3(0, 1, 0)).normalize();

    this.grounded = this.groundedNow();
    if (this.grounded) this.coyote = 0.16;
    else this.coyote -= dt;

    if (this.slowT > 0) {
      this.slowT = Math.max(0, this.slowT - dt);
      this.updateSkillHud();
    }
    this.playerBody.linearDamping = this.slowT > 0 ? SLOW_DAMP : ROLL_DAMP;

    const force = (this.grounded ? ROLL_FORCE : AIR_FORCE) * (this.slowT > 0 ? 0.55 : 1);
    const fx = this.fwd.x * axes.y * force + this.right.x * axes.x * force;
    const fz = this.fwd.z * axes.y * force + this.right.z * axes.x * force;
    this.playerBody.applyForce(new CANNON.Vec3(fx, 0, fz), this.playerBody.position);

    if (this.boostIgnoreCap > 0) this.boostIgnoreCap -= dt;
    const hv = Math.hypot(this.playerBody.velocity.x, this.playerBody.velocity.z);
    const cap = this.slowT > 0 ? SLOW_MAX : MAX_SPEED;
    if (this.boostIgnoreCap <= 0 && hv > cap) {
      const s = cap / hv;
      this.playerBody.velocity.x *= s;
      this.playerBody.velocity.z *= s;
    }

    if (this.input.jumpQueued) {
      this.jumpBuf = 0.16;
      this.input.jumpQueued = false;
    }
    this.jumpBuf -= dt;
    if (this.jumpBuf > 0 && this.coyote > 0) {
      this.jumpBuf = 0;
      this.coyote = 0;
      const superJump = this.superJumps > 0;
      if (superJump) {
        this.superJumps -= 1;
        this.updateSkillHud();
        this.playerBody.velocity.y = Math.max(this.playerBody.velocity.y, SUPER_JUMP_V);
        this.audio.play("jumpBooster", { volume: 0.85 });
      } else {
        this.playerBody.velocity.y = Math.max(this.playerBody.velocity.y, JUMP_V);
        this.audio.play("jump", { volume: 0.8 });
      }
    }

    if (this.grounded && !this.wasGrounded && this.elapsed > 0.35) this.audio.play("hit", { volume: 0.35 });
    this.wasGrounded = this.grounded;

    this.world.step(dt);

    this.collect();
    this.touchPads(dt);
    this.checkDoor();
    this.checkDeath();
    this.elapsed += dt;
  }

  updateMovers(dt) {
    for (const m of this.movers) {
      if (m.waiting) {
        m.waitLeft -= dt;
        m.body.velocity.set(0, 0, 0);
        if (m.waitLeft <= 0) {
          m.waiting = false;
          m.dir *= -1;
        }
        continue;
      }
      const axis = m.axis;
      const idx = axis === "x" ? 0 : axis === "y" ? 1 : 2;
      const pos = m.body.position;
      const val = pos[axis];
      if (val >= m.max) {
        pos[axis] = m.max;
        m.waiting = true;
        m.waitLeft = m.wait;
        m.body.velocity.set(0, 0, 0);
      } else if (val <= m.min) {
        pos[axis] = m.min;
        m.waiting = true;
        m.waitLeft = m.wait;
        m.body.velocity.set(0, 0, 0);
      } else {
        const v = m.dir * m.speed;
        m.body.velocity.set(idx === 0 ? v : 0, idx === 1 ? v : 0, idx === 2 ? v : 0);
      }
    }
  }

  collect() {
    const p = this.playerBody.position;
    for (const c of this.coins) {
      if (c.taken) continue;
      const d = Math.hypot(p.x - c.pos[0], p.y - c.pos[1], p.z - c.pos[2]);
      if (d < 0.95) {
        c.taken = true;
        c.mesh.visible = false;
        this.found++;
        this.audio.play("coin", { volume: 0.9, playbackRate: 0.95 + Math.random() * 0.1 });
        this.updateCoinsHud();
      }
    }
    for (const s of this.pickups) {
      if (s.taken) continue;
      const d = Math.hypot(p.x - s.pos[0], p.y - s.pos[1], p.z - s.pos[2]);
      if (d < 1.05) {
        s.taken = true;
        s.mesh.visible = false;
        if (s.type === "slow") {
          this.slowT = SLOW_TIME;
          this.playerBody.velocity.x *= 0.4;
          this.playerBody.velocity.z *= 0.4;
          this.audio.play("teleporter", { volume: 0.7 });
          this.flashNeed("Slowdown! Ollie eases up for a few seconds.", 2.2, true);
        } else {
          this.superJumps = Math.min(2, this.superJumps + 1);
          this.audio.play("jumpBooster", { volume: 0.7 });
          this.flashNeed("Super Jump ready — your next hop soars.", 2.2, true);
        }
        this.updateSkillHud();
      }
    }
  }

  touchPads(dt) {
    const p = this.playerBody.position;
    for (const [k, t] of this.padCool) this.padCool.set(k, t - dt);
    this.boosters.forEach((b, i) => {
      const d = Math.hypot(p.x - b.pos[0], p.z - b.pos[2]);
      const yok = Math.abs(p.y - b.pos[1]) < 1.2;
      if (d < 1.15 && yok && (this.padCool.get("b" + i) || 0) <= 0) {
        this.padCool.set("b" + i, 0.85);
        if (b.type === "speed") {
          this.boostIgnoreCap = 0.9;
          this.playerBody.velocity.x += b.dir[0] * b.force * 0.55;
          this.playerBody.velocity.y += (b.dir[1] || 0) * b.force * 0.35;
          this.playerBody.velocity.z += b.dir[2] * b.force * 0.55;
          this.audio.play("speedBooster");
        } else {
          this.playerBody.velocity.y = Math.max(this.playerBody.velocity.y, b.force);
          this.audio.play("jumpBooster");
        }
      }
    });
    for (const t of this.teleporters) {
      t.cool -= dt;
      const d = Math.hypot(p.x - t.from[0], p.y - t.from[1], p.z - t.from[2]);
      if (d < 1.2 && t.cool <= 0) {
        this.playerBody.position.set(t.to[0], t.to[1], t.to[2]);
        this.playerBody.velocity.set(0, 0, 0);
        this.playerBody.angularVelocity.set(0, 0, 0);
        t.cool = 1.2;
        this.audio.play("teleporter");
      }
    }
  }

  checkDoor() {
    if (!this.door || this.won) return;
    const p = this.playerBody.position;
    const d = this.door.position;
    if (Math.hypot(p.x - d.x, p.z - d.z) < 1.55 && Math.abs(p.y - d.y) < 2.2) {
      if (this.found >= this.total) this.win();
      else if (this.needCoinsT <= 0) this.flashNeed("You need to find all the coins before you can proceed.");
    }
  }

  checkDeath() {
    const p = this.playerBody.position;
    if (p.y < (this.level.killY ?? -8)) {
      this.die();
      return;
    }
    if (this.level.water && p.y < this.level.water.y + 0.35) {
      this.die();
      return;
    }
    for (const h of this.hazards) {
      if (Math.abs(p.x - h.pos[0]) < h.size[0] / 2 && Math.abs(p.z - h.pos[2]) < h.size[2] / 2 && p.y < h.pos[1] + 1.2) {
        this.die();
        return;
      }
    }
  }

  win() {
    this.won = true;
    this.audio.play("won");
    this.audio.stopMusic();
    const t = this.elapsed;
    const prev = this.save.best[this.level.id];
    if (!prev || t < prev) this.save.best[this.level.id] = t;
    this.save.unlocked = Math.max(this.save.unlocked, this.level.id + 1);
    writeSave(this.save);
    $("result-title").textContent = "You Win!";
    $("result-sub").textContent = `${this.level.title} cleared in ${t.toFixed(1)}s`;
    const nav = $("result-actions");
    nav.innerHTML = "";
    const next = this.levelIndex + 1 < LEVELS.length;
    if (next) {
      const b = document.createElement("button");
      b.className = "btn primary";
      b.textContent = "Proceed to Next Level";
      b.addEventListener("click", () => this.startLevel(this.levelIndex + 1));
      nav.appendChild(b);
    }
    const again = document.createElement("button");
    again.className = "btn";
    again.textContent = next ? "Replay" : "Play Again";
    again.addEventListener("click", () => this.startLevel(this.levelIndex));
    nav.appendChild(again);
    const menu = document.createElement("button");
    menu.className = "btn";
    menu.textContent = "Main Menu";
    menu.addEventListener("click", () => this.goMenu());
    nav.appendChild(menu);
    this.showScreen("result");
  }

  die() {
    if (this.dead || this.won) return;
    this.dead = true;
    this.audio.play("destroy");
    this.audio.play("gameover", { volume: 0.7 });
    $("result-title").textContent = "Ollie is Dead!";
    $("result-sub").textContent = "The coins are still out there.";
    const nav = $("result-actions");
    nav.innerHTML = "";
    const again = document.createElement("button");
    again.className = "btn primary";
    again.textContent = "Try Level Again";
    again.addEventListener("click", () => this.startLevel(this.levelIndex));
    nav.appendChild(again);
    const menu = document.createElement("button");
    menu.className = "btn";
    menu.textContent = "Main Menu";
    menu.addEventListener("click", () => this.goMenu());
    nav.appendChild(menu);
    this.showScreen("result");
  }

  syncMeshes() {
    for (const o of this.worldItems) {
      const b = o.userData.body;
      if (!b) continue;
      o.position.set(b.position.x, b.position.y, b.position.z);
      o.quaternion.set(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w);
    }
  }

  updateCamera(dt) {
    const look = this.input.sampleLook();
    this.camYaw -= look.dx * 0.0055;
    this.camPitch = THREE.MathUtils.clamp(this.camPitch + look.dy * 0.004, 0.12, 1.15);

    if (this.mode === "menu") {
      this.showcaseT += dt;
      this.camYaw = this.showcaseT * 0.22;
      this.camPitch = 0.4;
      this.camDist = 12;
    }

    const target = this.player ? this.player.position : new THREE.Vector3();
    const cp = Math.cos(this.camPitch);
    const ox = Math.sin(this.camYaw) * cp * this.camDist;
    const oz = Math.cos(this.camYaw) * cp * this.camDist;
    const oy = Math.sin(this.camPitch) * this.camDist + 1.2;
    const desired = this.tmp.set(target.x + ox, target.y + oy, target.z + oz);
    this.camera.position.lerp(desired, this.mode === "menu" ? 0.04 : 0.12);
    this.camera.lookAt(target.x, target.y + 0.6, target.z);
    this.sun.position.set(target.x + 16, target.y + 26, target.z + 10);
    this.sun.target.position.copy(target);
    this.sun.target.updateMatrixWorld();
  }

  animateVisuals(t, dt) {
    for (const c of this.coins) {
      if (c.taken) continue;
      c.mesh.rotation.z = t * 2.4;
      c.mesh.position.y = c.pos[1] + Math.sin(t * 3 + c.pos[0]) * 0.12;
    }
    for (const s of this.pickups) {
      if (s.taken) continue;
      s.mesh.rotation.y = t * 2.2;
      s.mesh.position.y = s.pos[1] + Math.sin(t * 3.4 + s.pos[0]) * 0.16;
    }
    if (this.door) {
      const pulse = 0.9 + Math.sin(t * 3) * 0.08;
      this.door.userData.gate.scale.set(pulse, pulse * 1.15, pulse);
      this.door.userData.swirl.rotation.z = t * 1.5;
      this.door.userData.swirl.material.opacity = this.found >= this.total ? 0.7 : 0.28;
    }
    for (const tp of this.teleporters) {
      tp.ringA.rotation.y = t * 1.6;
      tp.ringB.rotation.y = -t * 1.6;
    }
    if (this.rain) {
      const arr = this.rain.geometry.attributes.position.array;
      for (let i = 0; i < arr.length; i += 3) {
        arr[i + 1] -= dt * 18;
        if (arr[i + 1] < 0) arr[i + 1] = 22;
      }
      this.rain.geometry.attributes.position.needsUpdate = true;
    }
    if (this.mode === "menu" && this.playerBody) {
      this.playerBody.position.set(Math.sin(t * 0.4) * 4, 1.2, Math.cos(t * 0.35) * 4);
      this.player.position.copy(this.playerBody.position);
      this.player.rotation.z = t * 1.5;
      this.player.rotation.x = t * 0.8;
    }
    if (this.needCoinsT > 0) {
      this.needCoinsT -= dt;
      if (this.needCoinsT <= 0) $("toast").classList.add("hidden");
    }
  }

  loop = () => {
    const dt = Math.min(0.05, this.clock.getDelta());
    this.acc += dt;
    while (this.acc >= STEP) {
      this.physics(STEP);
      this.acc -= STEP;
    }
    if (this.mode === "play" && !this.paused && !this.won && !this.dead) this.syncMeshes();
    else if (this.mode === "menu") this.syncMeshes();
    this.updateCamera(dt);
    this.animateVisuals(this.clock.elapsedTime, dt);
    if (this.mode === "play" && !this.paused) $("hud-time").textContent = this.elapsed.toFixed(1);
    this.renderer?.render(this.scene, this.camera);
    requestAnimationFrame(this.loop);
  };

  start() {
    this.loop();
  }
}

const game = new Game();
game.start();
window.OllieGame = game;
{
  const params = new URLSearchParams(location.search);
  if (params.get("unlock") === "1") game.unlockAllLevels();
  const play = params.get("play");
  if (play) {
    game.enter().then(() => {
      const n = Number(play);
      if (Number.isFinite(n) && n >= 1) game.startLevel(Math.min(LEVELS.length, Math.max(1, n)) - 1);
    }).catch((err) => console.error(err));
  }
}
