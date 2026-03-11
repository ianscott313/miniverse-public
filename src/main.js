import { Miniverse, PropSystem, createStandardSpriteConfig } from '@miniverse/core';

const WORLD_ID = 'cozy-startup';
const basePath = `/worlds/${WORLD_ID}`;

function charSprites(name) {
  return {
    sheets: {
      walk: `/universal_assets/citizens/${name}_walk.png`,
      actions: `/universal_assets/citizens/${name}_actions.png`,
    },
    animations: {
      idle_down: { sheet: 'actions', row: 3, frames: 4, speed: 0.5 },
      idle_up: { sheet: 'actions', row: 3, frames: 4, speed: 0.5 },
      walk_down: { sheet: 'walk', row: 0, frames: 4, speed: 0.15 },
      walk_up: { sheet: 'walk', row: 1, frames: 4, speed: 0.15 },
      walk_left: { sheet: 'walk', row: 2, frames: 4, speed: 0.15 },
      walk_right: { sheet: 'walk', row: 3, frames: 4, speed: 0.15 },
      working: { sheet: 'actions', row: 0, frames: 4, speed: 0.3 },
      sleeping: { sheet: 'actions', row: 1, frames: 2, speed: 0.8 },
      talking: { sheet: 'actions', row: 2, frames: 4, speed: 0.15 },
    },
    frameWidth: 64,
    frameHeight: 64,
  };
}

function buildSceneConfig(cols, rows, floor, tiles) {
  const safeFloor = floor ?? Array.from({ length: rows }, () => Array(cols).fill(''));
  const walkable = [];
  for (let r = 0; r < rows; r++) {
    walkable[r] = [];
    for (let c = 0; c < cols; c++) walkable[r][c] = (safeFloor[r]?.[c] ?? '') !== '';
  }

  const resolvedTiles = { ...(tiles ?? {}) };
  for (const [key, src] of Object.entries(resolvedTiles)) {
    if (/^(blob:|data:|https?:\/\/)/.test(src)) continue;
    const clean = src.startsWith('/') ? src.slice(1) : src;
    resolvedTiles[key] = `${basePath}/${clean}`;
  }

  return {
    name: 'main',
    tileWidth: 32,
    tileHeight: 32,
    layers: [safeFloor],
    walkable,
    locations: {},
    tiles: resolvedTiles,
  };
}

const SPRITES = ['morty', 'dexter', 'nova', 'rio'];

async function main() {
  const container = document.getElementById('world');
  const sceneData = await fetch(`${basePath}/world.json`).then(r => r.json()).catch(() => null);

  const workAnchors = (sceneData?.props ?? [])
    .flatMap(f => (f.anchors ?? []).filter(a => a.type === 'work').map(a => a.name));

  const gridCols = sceneData?.gridCols ?? 16;
  const gridRows = sceneData?.gridRows ?? 12;
  const sceneConfig = buildSceneConfig(gridCols, gridRows, sceneData?.floor, sceneData?.tiles);
  const tileSize = 32;

  // Auto-discover agents from server
  const availableSprites = await fetch('/api/citizens')
    .then(r => r.json())
    .then(d => Array.isArray(d) ? d : SPRITES)
    .catch(() => SPRITES);
  const serverAgents = await fetch('/api/agents')
    .then(r => r.json())
    .then(d => d.agents ?? [])
    .catch(() => []);

  // WebSocket signal — use current host
  const wsProtocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${wsProtocol}//${location.host}/ws`;

  const spriteSheets = {
    ...Object.fromEntries(serverAgents.map((a, i) =>
      [a.agent, charSprites(availableSprites[i % availableSprites.length])]
    ))
  };

  const mv = new Miniverse({
    container,
    world: WORLD_ID,
    scene: 'main',
    signal: {
      type: 'websocket',
      url: wsUrl,
    },
    citizens: [
      ...serverAgents.map((a, i) => ({
        agentId: a.agent,
        name: a.name || a.agent,
        sprite: a.agent,
        position: workAnchors[i] ?? sceneData?.wanderPoints?.[i]?.name ?? 'wander_0',
      }))
    ],
    defaultSprites: availableSprites,
    scale: 2,
    width: gridCols * tileSize,
    height: gridRows * tileSize,
    sceneConfig,
    spriteSheets,
    objects: [],
  });

  // Props system
  const props = new PropSystem(tileSize, 2);

  const rawSpriteMap = sceneData?.propImages ?? {};
  await Promise.all(
    Object.entries(rawSpriteMap).map(([id, src]) => {
      const clean = src.startsWith('/') ? src : '/' + src;
      return props.loadSprite(id, `${basePath}${clean}`);
    }),
  );

  props.setLayout(sceneData?.props ?? []);
  if (sceneData?.wanderPoints) {
    props.setWanderPoints(sceneData.wanderPoints);
  }

  props.setDeadspaceCheck((col, row) => {
    const floor = mv.getFloorLayer();
    return floor?.[row]?.[col] === '';
  });

  const syncProps = () => {
    mv.setTypedLocations(props.getLocations());
    mv.updateWalkability(props.getBlockedTiles());
  };
  syncProps();
  props.onSave(syncProps);

  await mv.start();

  mv.addLayer({ order: 5, render: (ctx) => props.renderBelow(ctx) });
  mv.addLayer({ order: 15, render: (ctx) => props.renderAbove(ctx) });
}

main().catch(console.error);
