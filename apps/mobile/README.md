# Ink Manager — mobile

Expo / React Native client, built with Expo Router. Part of the root npm workspace
(`apps/*`), so install from the **repo root**, not here:

```powershell
npm install          # from the repo root
cd apps\mobile
npx expo start
```

## Pinned to Expo SDK 54 — on purpose. Do not upgrade casually.

`apps/mobile` targets **Expo SDK 54**, not the latest SDK. This is a hard product
constraint, not staleness:

- The only way to open this app on a real iPhone today is **Expo Go from the App Store**,
  and that build supports **SDK 54**. Apple has not approved Expo's newer Expo Go
  submissions, so a newer SDK produces an app the owner's phone physically cannot open.
- The alternative — a custom dev client (`eas build` / `eas go`) — needs a paid Apple
  Developer account, which this project does not have yet.

The app was first scaffolded on SDK 57 and re-pinned to 54 for exactly this reason. That
SDK 57 build was never opened on a phone.

**Revisit when either becomes true:** Apple approves a newer Expo Go, or the project gets
an Apple Developer account and can ship a dev build. Until then, treat the SDK version and
the pinned React version below as load-bearing — an `expo install --check` "fix" or a
routine dependency bump can quietly break the one way this app can currently be run.

## Which API does it talk to?

`EXPO_PUBLIC_API_URL`, falling back to the production Railway API
(`https://api.inkmanager.app`) when unset — see `src/lib/api.ts`. There is no separate
mobile backend: this is the same API `apps/web` uses, and the same `POST /login` → JWT →
`Authorization: Bearer <token>` contract. React Native's `fetch` is not subject to browser
CORS, so no API-side change was needed.

To point a dev build at a local API instead, create `.env.local` here:

```
EXPO_PUBLIC_API_URL=http://192.168.1.50:4000
```

A phone can't reach `localhost` — that has to be the dev machine's LAN IP, and the API must
be listening on it. `EXPO_PUBLIC_*` vars are inlined at **build** time, so changing this
needs a dev-server restart, not just a reload.

## Monorepo setup — the two things holding it together

Both are unusual, both are load-bearing, and both exist because this app lives in a
workspace alongside `apps/web`. Read this before touching `metro.config.js` or
`babel.config.js`.

### 1. Exactly one React (`metro.config.js`)

The workspace genuinely needs two different Reacts:

| | React | where npm puts it |
| --- | --- | --- |
| `apps/web` | `^19.2.7` | `<root>/node_modules/react` |
| `apps/mobile` | `19.1.0` | `apps/mobile/node_modules/react` |

The mobile pin matches what Expo SDK 54 ships: `react-native@0.81.5` carries a renderer
generated against React 19.1.0. Its peer range (`^19.1.0`) would *permit* the root's
19.2.7, but that combination is not what Expo tests.

npm resolves the conflict by hoisting `react-native` to the **root** (nothing else in the
workspace uses it) while nesting React under `apps/mobile`. Ordinary resolution from inside
`react-native` then walks up and finds the root's 19.2.7, while app code finds the nested
19.1.0 — two Reacts in one bundle, which breaks hooks at runtime with no build error.

This was measured, not assumed. Grepping the served dev bundle for React's own version
constant:

- default resolution → `19.1.0` **and** `19.2.7` both present
- with the `resolveRequest` pin in `metro.config.js` → `19.1.0` only

Note what the config deliberately does *not* do: set `resolver.disableHierarchicalLookup`
globally. That was tried first and broke the build — `expo-router` keeps
`@expo/metro-runtime` in its own nested `node_modules`, which a global lookup ban makes
invisible. Only `react` and `react-dom` are pinned.

### 2. The expo-router Babel plugin shim (`babel.config.js`)

`babel-preset-expo` adds the plugin that inlines `process.env.EXPO_ROUTER_APP_ROOT` only
when a bare `require.resolve('expo-router')` succeeds *from the preset's own directory*.

Because React must nest under `apps/mobile`, npm drags `expo-router` down with it, while
`babel-preset-expo` hoists to the repo root. Resolution from
`<root>/node_modules/babel-preset-expo/` never looks inside `apps/mobile/node_modules`, so
the preset concludes expo-router isn't installed and silently skips the plugin. The bundle
then fails with:

```
Invalid call at line 2: process.env.EXPO_ROUTER_APP_ROOT
First argument of `require.context` should be a string denoting the directory to require.
```

`babel.config.js` adds that plugin back. It is **conditional**: the moment an install puts
expo-router somewhere the preset can see, the shim stops adding anything on its own. There
is nothing to remember to undo.

### What is *not* a problem on SDK 54

The SDK 57 attempt had to disable `experiments.typedRoutes` and could not run
`expo start --web`, because `expo-router@57` depended on `react-is@^19.1.0` while the root
resolves `react-is@16.13.1` via `apps/web`. `expo-router@6.0.24` (SDK 54) has no `react-is`
dependency at all, so **typed routes are enabled** and that whole failure mode is gone.

## Layout

```
src/lib/api.ts           fetch wrapper, base URL, ApiError (fromApi discriminator)
src/lib/loginError.ts    maps a thrown error to a message a person can act on
src/lib/tokenStorage.ts  save/get/clear the JWT via expo-secure-store
src/context/auth.ts      context, types, useAuth()
src/context/AuthContext.tsx  login, logout, launch restore
src/app/_layout.tsx      splash gating + Stack.Protected route guards
src/app/login.tsx        login screen
src/app/index.tsx        placeholder home (name, role, studio, logout)
src/constants/theme.ts   the handful of colors this app needs so far
```
