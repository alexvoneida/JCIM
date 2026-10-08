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

- **Unit tests** live next to the code as `*.test.ts` and `*.test.tsx`. Renderer tests replace `window.api` with a mock, so they don't need Electron. They cover navigation, import/export messages, employers, shared industry choices, scheduling editors and overrides, conflict messages, approval, and local persistence.
- **End-to-end tests** in `tests/e2e/` launch the real app. By default they run the compiled `out/` (run `npm run build` first). Set `JCIM_EXECUTABLE` to test a packaged build instead:

  ```sh
  npm run dist:mac
  JCIM_EXECUTABLE=release/mac-universal/JCIM.app/Contents/MacOS/JCIM npm run test:e2e
  ```

CI runs the end-to-end suite against every artifact it ships. The Windows installer is silently installed and its Desktop and Start Menu shortcuts are checked before the installed app is tested.

The desktop UI tests assert timetable alignment across companies, side-by-side parallel interviews, readable cards, pinned headers and time labels while scrolling, and layout at smaller window sizes. They exercise real import/export IPC and verify the resulting Excel files, including scheduling settings and custom industries. Tests use a separate temporary workspace and a window that does not receive mouse clicks or take focus. Screenshots are captured only when a test fails; passing checks do not require manual screenshot review.

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

## Workbook workflow

Use the persistent **Import sheet** and **Export sheet** actions at the top of every page. Import accepts `.xlsx` trackers containing **Student Good Fit** and **Employer Good Fit**, or a complete JCIM export. A successful import replaces the workspace; the app offers a reminder to export the current workspace first. Cancellation and failed imports leave the workspace unchanged.

- **Overview:** search students, filter interests, and inspect interview feedback. School and interest information is read from matching student survey rows when available.
- **Interview Schedule:** view employers across the top and times down the left, with simultaneous interviews aligned. Edit the schedule window and default interview length (initially 30 minutes), or use the pencil next to an employer to set its own hours, interview length, and **Students at once** limit. This limit is separate from internship places. Use **Edit schedule** to add, move, remove, or change the length of individual interviews. Settings changes keep existing interviews and highlight conflicts; approval and export require resolving them. Generating a replacement schedule asks before replacing manual edits. Scheduling uses interview records linked to active employers, and students cannot attend overlapping interviews.
- **Final Matching:** generate placements using the latest interview round, employer approval, student preference (1–5, higher is better), and confirmed capacity. Students who declined an employer are excluded. Feedback and placements can be edited, then approved again. Employer feedback in the tracker is yes/no; the displayed stars are student preferences.
- **Employers:** add employers, edit industry and confirmed internship places, and turn participation on or off. Inactive employers and their feedback remain in the workspace and all exports. Changing participation clears previous proposals and approvals so they can be regenerated. Unconfirmed capacity is 0 until entered by the coordinator.

Changes are saved locally between sessions. Import also saves a local copy of the source workbook, so exports retain its original worksheets even if the selected source file moves. Exports add six re-importable **JCIM** tabs for students, employers (including Active status and company interview settings), feedback, schedule (including individual interview length overrides), placements, and settings (including the overall window and default interview length). Older JCIM exports without interview settings remain importable. The original input is never overwritten. Keep all JCIM tabs and their column headings when editing an export in Excel. Completed exports replace their destination only after the new workbook has been written successfully.

Import/export failures identify the failed operation, reason, and repair steps. Validation messages identify the worksheet and row/cell where relevant. Nonstandard yes/no answers in legacy trackers are imported as unknown with explicit notes; unmatched feedback is reported and retained in the original worksheets. Missing required tabs, invalid ratings/capacities, broken references, and invalid exported schedules or placements stop import instead of silently accepting bad data.

Students and employers share one industry bank, seeded from all imported employer industries and student survey interests (including records without interviews). Employer industry is a dropdown. Student industries are multiple-choice checkboxes in the student details. Choose **Other — add an industry** to enter a new name, which becomes an option for both after saving. Names are deduplicated without regard to case or extra spaces. The bank is saved locally and in the export settings, including industry options no longer assigned to anyone.
