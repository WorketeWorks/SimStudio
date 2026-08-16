# Sim Studio architecture

Sim Studio is split by responsibility. `app/page.tsx` is the application
coordinator: it connects React, Three.js and Rapier, but shared data and
self-contained algorithms belong in the modules below.

## Main folders

- `app/catalog/`: catalog presentation data, colors and thumbnails.
- `app/components/`: reusable React controls without editor state.
- `app/editor/`: shared runtime types and, in future, editor commands.
- `app/physics/`: collider validation, gear topology, contact rules and
  simulation settings.
- `app/projects/`: project naming and project-manager helpers.
- `app/renderer/`: Three.js helpers that do not depend on React.
- `app/connection-maps.ts`: authored connection corrections.
- `app/collision-maps.ts`: authored normal and gear collision corrections.
- `app/connectors.ts`: automatic connection/collider analysis.
- `app/project-format.ts`: `.simstudio` validation, compression and IndexedDB.
- `app/ldraw.ts`, `app/ldraw-geometry.ts`, `app/studio-io.ts`: model formats.

## Runtime flow

1. The palette or importer requests a `CatalogPart`.
2. `page.tsx` loads its LDraw geometry and `connectors.ts` analyzes missing
   connection/collision data.
3. The editor stores placed `Piece` objects and their `Connection` graph.
4. Starting simulation converts fixed connection groups into Rapier rigid
   islands, creates colliders and creates moving joints.
5. The animation loop advances Rapier, applies gear/differential constraints
   and synchronizes Three.js objects.
6. Stopping simulation restores the editor snapshot from before step 4.

## Dependency rules

- Data modules must not import `page.tsx`.
- Renderer helpers may depend on Three.js, but not React or Rapier.
- Physics helpers may depend on editor types, Three.js and Rapier, but not UI.
- Components receive values and callbacks; they do not access `AppState`.
- Project files are validated by `project-format.ts` before reaching runtime.

These boundaries make future extraction from `page.tsx` incremental: input
controllers, scene lifecycle and the Rapier world lifecycle can be moved one
at a time without changing the saved project format.
