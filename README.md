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

- **Unit tests** live next to the code as `*.test.ts` and `*.test.tsx`. Renderer tests replace `window.api` with a mock, so they don't need Electron. They cover navigation, import/export messages, employers, shared industry choices, wave and employer editors, drag-and-drop moves, conflict messages, approval, and local persistence. Exported workbooks are checked as OOXML packages by `src/main/xlsx-package.ts` (XML syntax, content types, relationships, element order, required attributes), because Excel repairs or discards parts that ExcelJS reads back without complaint. This runs with `npm test` on every push, so a pull request cannot merge a corrupt export.
- **End-to-end tests** in `tests/e2e/` launch the real app. By default they run the compiled `out/` (run `npm run build` first). Set `JCIM_EXECUTABLE` to test a packaged build instead:

  ```sh
  npm run dist:mac
  JCIM_EXECUTABLE=release/mac-universal/JCIM.app/Contents/MacOS/JCIM npm run test:e2e
  ```

CI runs the end-to-end suite against every artifact it ships. The Windows installer is silently installed and its Desktop and Start Menu shortcuts are checked before the installed app is tested.

The desktop UI tests assert the wave grid: students placed by school, limits per round, drag-and-drop moves with refusals and placement notes, readable chips, pinned employer headers and round labels while scrolling, and layout at smaller window sizes. They exercise real import/export IPC and verify the resulting Excel files, including scheduling settings and custom industries. Tests use a separate temporary workspace and a window that does not receive mouse clicks or take focus. Screenshots are captured only when a test fails; passing checks do not require manual screenshot review.

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

Use the persistent **Clear workspace**, **Import workbook**, and **Export workbook** actions at the top of every page. Import accepts `.xlsx` trackers containing **Student Good Fit** and **Employer Good Fit**, or a complete JCIM export. A successful import replaces the workspace; the app offers a reminder to export the current workspace first. Cancellation and failed imports leave the workspace unchanged. Clear workspace asks for confirmation, then removes everything saved on this computer so the app starts empty; imported and exported files are not touched.

- **Overview:** search students, filter interests, and inspect interview feedback. School and interest information is read from matching student survey rows when available. **New student** adds a student by hand; **Remove student** in a student's details removes them along with their feedback, scheduled interviews, and placement (a removed placement clears the matching so it can be regenerated).
- **Interview Schedule:** interviews run in **waves**, each with a number of rounds (3 by default), shown as a grid with employers across the top and the rounds of each wave down the side. Each cell lists the students interviewing with that employer in that round, colored by school. The coordinator creates waves with **New wave** and places schools and individual students in them (a student entry overrides the school), usually by distance; the pencil on a wave changes its name, rounds, and placements, or removes it. **Generate schedule** gives every student three interviews in their wave, one per round: for each student it picks the employers whose industry, role titles, or role tags best match the student's interests, then fills the rest with the least-booked employers so the load spreads evenly. It needs at least three active employers and three rounds per wave, and it adds a pending feedback row for each new student and employer pair so the employer's response can be recorded afterwards. If no wave exists yet, it creates Wave 1. The pencil next to an employer sets its **Students per round** limit (3 by default), which is separate from internship places. Turn on **Edit schedule** to drag students between rounds, employers, and waves, or use the pencil on a student to pick the wave and round exactly, add an interview, or remove one. A drop that would double-book a student or overfill an employer is refused with the reason. A student scheduled outside the wave their school or they were placed in is noted but allowed. Limit and round changes keep existing interviews and highlight conflicts; approval and export require resolving them. Generating a replacement schedule asks before replacing manual moves.
- **Final Matching:** generate placements using the latest interview round, employer approval, student preference (1–5, higher is better), and confirmed capacity. Students who declined an employer are excluded. Feedback and placements can be edited, then approved again. Employer feedback in the tracker is yes/no; the displayed stars are student preferences.
- **Employers:** add employers, edit industry and confirmed internship places, and turn participation on or off. Inactive employers and their feedback remain in the workspace and all exports. Changing participation clears previous proposals and approvals so they can be regenerated. Unconfirmed capacity is 0 until entered by the coordinator.

Changes are saved locally between sessions. An export is a new workbook containing a **Read me** tab and seven re-importable **JCIM** tabs for students, employers (including Active status and students per round), waves (rounds plus the schools and students placed in each), feedback, schedule (the wave and round of each interview), placements, and settings. Exports written before waves existed, with interview start times, are converted on import: each distinct start time within a wave becomes a round. The imported tracker's own worksheets are not copied into the export (copying them through ExcelJS produced files Excel had to repair), so the tracker remains the source of record for everything outside JCIM. Exporting over the imported file is allowed and replaces it with the JCIM workbook. Keep all JCIM tabs and their column headings when editing an export in Excel. Completed exports replace their destination only after the new workbook has been written successfully.

Import/export failures identify the failed operation, reason, and repair steps. Validation messages identify the worksheet and row/cell where relevant. Nonstandard yes/no answers in legacy trackers are imported as unknown with explicit notes; unmatched feedback is reported and retained in the original worksheets. Missing required tabs, invalid ratings/capacities, broken references, and invalid exported schedules or placements stop import instead of silently accepting bad data.

Students and employers share one industry bank, seeded from all imported employer industries and student survey interests (including records without interviews). Employer industry is a dropdown. Student industries are multiple-choice checkboxes in the student details. Choose **Other — add an industry** to enter a new name, which becomes an option for both after saving. Names are deduplicated without regard to case or extra spaces. The bank is saved locally and in the export settings, including industry options no longer assigned to anyone.
