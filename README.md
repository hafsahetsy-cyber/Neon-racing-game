# NEON CRUISE

A 3D open-world driving game for the browser. Cruise a cyberpunk version of real Karachi in
antique vehicles reimagined for 2099, alone or with up to eight friends, and race when you feel like it.

**Play:** https://neon-cruise-karachi.netlify.app

## Run it locally

```bash
npm install
npm run dev
```

Then open http://localhost:5173. Add `?world=test` for the handling test track, or `?net=local`
to make parties work between tabs of one browser without a server.

```bash
npm run build      # typecheck + production build into dist/
```

## Controls

| Key | Action |
| --- | --- |
| W A S D / arrows | Drive |
| Space | Handbrake / drift |
| Shift | Boost |
| E | Horn |
| C | Camera (chase, hood, cinematic) |
| P | Photo mode |
| T | Toggle rain |
| R | Reset car |
| Enter, 1–4 | Party chat, emotes |
| G, M, H | Graphics quality, mute, help |
| Esc | Pause |

Gamepad and touch controls are supported.

## Stack

Three.js, TypeScript and Vite; Rapier for collisions with a custom raycast vehicle model;
`postprocessing` for bloom and the speed effects; Web Audio for synthesised engines and a generated
soundtrack; Supabase Realtime for parties. Vehicle models are built in Blender.

## How it is organised

```
src/core        game loop, input, camera, quality presets, save data
src/vehicles    physics (Vehicle), rendering (VehicleVisual), one config per vehicle
src/world       city builder: roads, buildings, props, traffic, street life, landmarks
src/effects     post-processing, particles, trails, rain
src/net         party codes, transport, remote players
src/race        checkpoint races
src/ui          HUD and menus
tools           build-city.mjs turns an OpenStreetMap extract into a city map
```

### Add a vehicle

1. Export a `.glb` to `public/models/`. Forward is -Z, origin on the ground under the centre.
   Name wheel objects (`wheel_fl`, …) and use the material names `Paint`, `Neon`, `Accent`, `Holo`,
   `TailLight`, `HeadLight` so the garage can recolour them.
2. Copy a file in `src/vehicles/configs/`, point it at the model, and tune the numbers.
3. Add it to the list in `src/vehicles/registry.ts`.

### Add a city

1. Add an entry to `CITIES` in `tools/build-city.mjs` (bounding box, landmarks, race waypoints),
   download the extract with the Overpass query in that file's header, and run
   `node tools/build-city.mjs <city>`.
2. Write a `CityDefinition` in `src/world/cities/` (fog, palette, sign words, driving side, landmarks).
3. Add it to the list in `src/world/cities/index.ts`. It then appears on the City screen.

## Credits

Map data © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors, available under
the Open Database License. Vehicles, landmarks, music and sound are original to this project.
