# JCIM

Desktop application built with Electron, React, and TypeScript.

## Development

Requires Node 24 (see `.nvmrc`), which ships npm 11. npm 10 crashes when adding some of the dev dependencies (`Cannot read properties of null (reading 'edgesOut')`).

```sh
nvm use
npm ci
npm run dev
```

| Script                | Purpose                                                  |
| --------------------- | -------------------------------------------------------- |
| `npm run dev`         | Run the app with hot reload                              |
| `npm run lint`        | ESLint (type-aware)                                      |
| `npm run format`      | Format everything with Prettier                          |
| `npm run typecheck`   | Type-check main, preload, renderer, and e2e tests        |
| `npm test`            | Unit tests (Vitest + Testing Library)                    |
| `npm run test:e2e`    | Launch the app and test it end to end (Playwright)       |
| `npm run build`       | Compile to `out/`                                        |
| `npm run dist:mac`    | Build the macOS `.dmg` (must run on macOS)               |
| `npm run dist:docker` | Build the Windows installer and Linux AppImage in Docker |

`dist:docker` is the reproducible build: it needs only Docker, and CI uses the same `Dockerfile`. Output lands in `release/`.

## Testing

- **Unit tests** live next to the code as `*.test.tsx`. Renderer tests replace `window.api` with a mock, so they don't need Electron.
- **End-to-end tests** in `tests/e2e/` launch the real app. By default they run the compiled `out/` (run `npm run build` first). Set `JCIM_EXECUTABLE` to test a packaged build instead:

  ```sh
  npm run dist:mac
  JCIM_EXECUTABLE=release/mac-universal/JCIM.app/Contents/MacOS/JCIM npm run test:e2e
  ```

CI runs the end-to-end suite against every artifact it ships. The Windows installer is silently installed and its Desktop and Start Menu shortcuts are checked before the installed app is tested.

Dependency install scripts are denied through `allowScripts` in `package.json`. When a new dependency needs its script to run, approve it with `npm install-scripts approve <pkg>`.

## Project layout

```
src/
  main/       Electron main process (window, app lifecycle, IPC handlers)
  preload/    Bridge that exposes a typed `window.api` to the renderer
  renderer/   React UI
  shared/     Types and IPC channel names used by both sides
```

The renderer runs sandboxed with no Node access. Anything that needs Node or the OS (files, databases, etc.) goes in `main`, gets an IPC channel in `shared/api.ts`, and is exposed through `preload`.

## Releases

`.github/workflows/build.yml` runs:

- **Push to any branch:** formatting, lint, typecheck, unit tests.
- **Pull request:** builds for all three platforms, plus the end-to-end tests against each build.
- **Push to `main`:** all of the above, then publishes a GitHub Release tagged `v<version>-build.<run>`.

The latest installers are always at **Releases → Latest**:

- Windows: `JCIM-Setup-<version>.exe`. Double-click it and the app installs for the current user, with no admin rights needed. It adds Desktop and Start Menu shortcuts and then launches.
- macOS: `JCIM-<version>-mac.dmg` (universal: Apple Silicon + Intel)
- Linux: `JCIM-<version>-linux.AppImage`

### Unsigned builds

The builds are not code-signed yet, so:

- **Windows** SmartScreen shows "Windows protected your PC". Click _More info → Run anyway_.
- **macOS** blocks the first launch. Open _System Settings → Privacy & Security_ and click _Open Anyway_.

### Local build note

Building the `.dmg` inside an iCloud-synced folder (e.g. `~/Desktop`, `~/Documents`) fails with `resource fork, Finder information, or similar detritus not allowed`. Clone the repo somewhere iCloud doesn't sync.
