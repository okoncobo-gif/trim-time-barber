# TrimTime — Session Notes & Handoff

Last session: Sat 2026-11-07. Read this first when resuming.

## Where things live
| What | Where |
|---|---|
| Working folder (source of truth for docs) | `C:\Users\humbl\AI` on the owner's laptop (my2025elitebook) |
| Work tracker | `C:\Users\humbl\AI\TrimTime-Tracker.xlsx` (tickets, features, change log, open questions) |
| Requirements & decisions (BRD input) | `C:\Users\humbl\AI\TrimTime-Requirements-Log.md`; also in the "Barber App" project as `claude/TrimTime-Requirements-Log.md` |
| These notes | `C:\Users\humbl\AI\TrimTime-Session-Notes.md`; also in the project |
| Code | GitHub `okoncobo-gif/trim-time-barber`, branch `main` |
| Live app | https://trim-time-barber-582836466396.us-central1.run.app |
| GCP | project `project-2612a473-2c2c-4c6b-860`, Cloud Run service `trim-time-barber`, region `us-central1` |

## Working rules (owner's instructions)
- **Save every file to `C:\Users\humbl\AI`.** Text docs also go to the project.
- **Ignore `C:\Users\humbl\AI\Archives`** unless the owner asks to use it. Move files that are no longer needed there; never delete them.
- **The tracker on the laptop is the source of truth.** Before editing it:
  - load it from the folder and check for the owner's edits;
  - after saving, read it back and compare checksums.
  - Stage each save under a new file name, because reusing a name sent a stale copy on 2026-11-07.
- **Testing findings are logged only, not fixed,** until the owner says to fix them together for a planned release.
  - Log each one in the tracker as type Defect or Change request, with source "Testing" and a likely cause.
  - Leave the Release column blank until the release is planned.
- **Owner answers questions in the Open Questions sheet** (yellow Answer column). Record new assumptions there as new questions.
- **The admin password stays `admin`** for now, by owner decision (TT-019).

## How changes ship
1. Work on a feature branch and open a PR. The owner merges it.
2. Merging to `main` triggers Cloud Build trigger `deploy-main`, which deploys to Cloud Run (about 4 minutes).
3. Check the build result through the GitHub check-runs API on `main`.

**Note:** every deploy wipes all bookings and settings (TT-001), so the owner's test data is lost on each merge.

## Environment limits in Claude's workspace (as of 2026-11-07)
- **No GCP API access** (TT-009). The network blocks `*.googleapis.com`, so Claude can't inspect or change GCP directly.
  - The service account key `claude-deployer-key.json` is in the folder.
  - It has: run.admin, artifactregistry.admin, cloudbuild.builds.editor, iam.serviceAccountUser, storage.admin, logging.viewer, cloudsql.admin, logging.logWriter.
- **No package installs.** The UI can't be built or run locally. The server rules are tested with `npm test` (Node's built-in SQLite).
- **The live site can't be fetched from the workspace,** so the owner verifies the UI.

## Current state
- **Deployed:** PRs #1–#4. They cover booking, approvals, roles, SMS (logged only; Twilio not configured), attendance confirmation, auto-approve at 1h with 3h warnings, barber availability, premium requests, and the "text your barber" reminder.
- **Tests:** 16 passing.
- **Tracker:** 39 tickets. TT-036 to TT-039 are the testing findings, all Open.

## Next session
1. **Owner's answers:**
   - Q10, Q11, Q13, Q14, Q15.
   - TT-037 details: are all Sunday hours (7 AM–9 PM) premium? Do Mondays stay closed?
2. Keep logging testing findings.
3. When the owner says go, plan the release and fix the defects and change requests together in one PR.
4. **Launch blockers:**
   - TT-001: move data to Cloud SQL. Needs TT-009, network access to GCP.
   - TT-027 and TT-029: Twilio account and US SMS registration.
   - TT-028: Cloud Scheduler job.
