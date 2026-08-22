# Ink Manager — mobile

Expo (SDK 57) / React Native client, built with Expo Router. Part of the
root npm workspace (`apps/*`), so install from the **repo root**, not here:

```powershell
npm install          # from C:\Users\User\Documents\GitHub\ink-manager
npm start --workspace=apps/mobile
```

## Which API does it talk to?

`EXPO_PUBLIC_API_URL`, falling back to the production Railway API
(`https://api.inkmanager.app`) when unset — see `src/lib/api.ts`. There is
no separate mobile backend: this is the same API `apps/web` uses, and the
same `POST /login` → JWT → `Authorization: Bearer <token>` contract.

To point a dev build at a local API instead, create `.env.local` here:

```
EXPO_PUBLIC_API_URL=http://192.168.1.50:4000
```

A phone can't reach `localhost` — that has to be the dev machine's LAN IP,
and the API must be listening on it.

## Monorepo notes

`metro.config.js` adds the repo root to `watchFolders` and lists both
node_modules directories in `resolver.nodeModulesPaths`; see the comments in
that file for why both are needed and why the order matters.

### `experiments.typedRoutes` is off, deliberately

Not a preference — it does not currently work in this workspace, and the
cause is upstream of anything in this app:

- `expo-router` depends on `react-is@^19.1.0`.
- The repo root already resolves `react-is@16.13.1` (pulled in through
  `apps/web`'s dependency tree).
- npm therefore cannot hoist `react-is@19` to the root, so it places it at
  `apps/mobile/node_modules/react-is` — and, to keep that copy visible,
  places `expo-router` itself at `apps/mobile/node_modules/expo-router`
  rather than at the root.
- `@expo/router-server` *does* hoist to the root, and its typed-route
  generator does a plain Node `require('expo-router/_ctx-shared')`, which
  cannot see into `apps/mobile/node_modules`. `npx expo start` crashes on
  startup with `Cannot find module 'expo-router/_ctx-shared'`.

Metro itself is unaffected (its resolution goes through
`resolver.nodeModulesPaths`, which lists both directories) — this breaks
only the CLI-side type generation, so turning the experiment off costs
route-string autocompletion and nothing else.

Fixing it properly means getting `react-is@19` to the workspace root, which
means changing `apps/web`'s dependency tree. Worth revisiting the next time
`apps/web`'s deps are touched anyway; not worth it on its own.
