// Monorepo Metro config. Metro defaults to assuming the project is its own
// root with its own self-contained node_modules -- neither is true here:
// npm workspaces hoists most dependencies up to the repo root, and the
// files Metro must watch live above apps/mobile.
//
// Two settings, both required, and they do different jobs:
//   watchFolders -- what Metro will *read and watch for changes*. Without
//     the repo root here, anything resolved out of the hoisted root
//     node_modules is outside Metro's watched tree and fails to bundle.
//   resolver.nodeModulesPaths -- *where Metro looks up* a bare import.
//     Both paths are listed, app-local first, so a package npm chose to
//     nest inside apps/mobile (because the root already holds a different
//     version -- react/react-dom are the live example, since apps/web
//     tracks a different React than react-native pins) wins over the
//     hoisted one. Getting this order backwards is the classic monorepo
//     React Native failure: two copies of React loaded at once.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];

config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

// Hoisting means a package can be reachable by more than one path (root
// and app-local). Left alone, Metro would happily resolve and bundle both
// copies; this pins it to the paths above only.
config.resolver.disableHierarchicalLookup = true;

module.exports = config;
