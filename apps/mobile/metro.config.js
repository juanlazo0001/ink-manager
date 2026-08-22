// Monorepo Metro config for apps/mobile.
//
// Metro defaults to assuming the project is its own root with its own
// self-contained node_modules. Neither is true here: npm workspaces
// hoists most dependencies to the repo root, and the files Metro must
// watch live above apps/mobile.
//
// ---------------------------------------------------------------------
// Why exactly one React is a hard requirement here
// ---------------------------------------------------------------------
// This workspace genuinely needs two different Reacts:
//
//   apps/web    react ^19.2.7  -> hoisted to <root>/node_modules/react
//   apps/mobile react  19.1.0  -> nested at apps/mobile/node_modules/react
//
// The mobile pin is not arbitrary. react-native 0.81.5 (Expo SDK 54)
// ships a renderer generated against React 19.1.0. Its peer range
// (^19.1.0) would *permit* the root's 19.2.7 -- Expo SDK 57 was set up
// that way in the previous session -- but that build was never opened on
// a phone, and matching the SDK's own pin is the only combination Expo
// actually tests.
//
// npm resolves that conflict by hoisting react-native 0.81.5 to the ROOT
// (nothing else in the workspace uses it) while nesting React 19.1.0
// under apps/mobile. So ordinary Node resolution from inside react-native
// walks UP and finds the root's React 19.2.7, while application code in
// apps/mobile resolves the nested 19.1.0. Two Reacts in one bundle: hooks
// dispatch through the wrong internals and the app breaks at runtime, in
// ways no build step reports.
//
// resolveRequest below closes that: every request for `react` or
// `react-dom` -- whoever asks, application code or hoisted react-native
// -- is resolved against apps/mobile/node_modules only.
//
// Note what this deliberately does NOT do: set
// resolver.disableHierarchicalLookup globally. That was tried first and
// broke the build outright -- expo-router keeps @expo/metro-runtime in
// its OWN nested node_modules, which a global lookup ban makes invisible
// ("Unable to resolve module @expo/metro-runtime"). Pinning only the two
// packages that must be singletons keeps normal nested resolution intact
// for everything else.
//
// Verified, not assumed: the served dev bundle is grepped for React's own
// version constant and contains 19.1.0 with no 19.2.7.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');
const projectModules = path.resolve(projectRoot, 'node_modules');

const config = getDefaultConfig(projectRoot);

// What Metro reads and watches. Without the repo root, anything resolved
// out of the hoisted root node_modules sits outside the watched tree and
// fails to bundle.
config.watchFolders = [workspaceRoot];

// Where a bare import is looked up, app-local first.
config.resolver.nodeModulesPaths = [projectModules, path.resolve(workspaceRoot, 'node_modules')];

// Packages that must resolve to exactly one copy for the whole bundle.
// react-dom is here alongside react because react-native-web (pulled in
// by expo-router) reaches for it, and a react-dom built against a
// different React minor is the same class of bug.
const SINGLETONS = new Set(['react', 'react-dom']);

const defaultResolveRequest = config.resolver.resolveRequest;

config.resolver.resolveRequest = (context, moduleName, platform) => {
  const packageName = moduleName.startsWith('@')
    ? moduleName.split('/').slice(0, 2).join('/')
    : moduleName.split('/')[0];

  const resolve = defaultResolveRequest ?? context.resolveRequest;

  if (SINGLETONS.has(packageName)) {
    // Same resolver, but with the search path narrowed to apps/mobile's
    // own node_modules and the hierarchical walk switched off, so there
    // is no route by which the root copy can win. Subpath imports
    // (react/jsx-runtime, react/compiler-runtime) go through this too and
    // land in the same package, which is the point.
    return resolve(
      { ...context, nodeModulesPaths: [projectModules], disableHierarchicalLookup: true },
      moduleName,
      platform,
    );
  }

  return resolve(context, moduleName, platform);
};

module.exports = config;
