# Direct Consideration internship application script

Finds 2027 internship links in Direct Consideration newsletters, keeps a local queue, opens employer applications in Chromium, and fills fields using your profile. `--submit` enables automatic submission of recognized single-page forms with a unique submit button and complete required answers. Other forms are marked for review. It cannot reliably apply to **every** employer: Workday-style multi-step flows, accounts, custom widgets, essays and CAPTCHA can require manual completion.

## Setup (PowerShell, Node.js 22+)

```powershell
cd C:\Users\nguye\autoapply
npm.cmd install
npm.cmd run install:browser
Copy-Item profile.example.json profile.json
```

Edit `profile.json`. Supply a full resume file path (escape backslashes in JSON, or use forward slashes), real contact information, and truthful answers. Empty answers are ignored. `answers` keys must match the displayed question exactly, ignoring case and punctuation. Checkbox answers must be JSON `true` or `false`. No answer is inferred about eligibility, sponsorship, demographics or consent. Relative resume paths are resolved from the command's working directory.

## Find and apply

```powershell
# Today's calculated issue, yesterday's, and issues found in the archive:
npm.cmd run discover -- --interactive

# Or catch up on a range:
npm.cmd run discover -- --from 1 --to 18 --interactive

# Autofill, review and finish each application in the browser:
npm.cmd run apply -- --interactive

# Attempt automatic submission where the form is supported:
npm.cmd run apply -- --submit --interactive

# Unattended run; blocked/unsupported applications go into the review queue:
npm.cmd run discover -- --headless
npm.cmd run apply -- --submit --headless

node src/cli.js status
```

The baseline is **issue 18 on October 29, 2026**, plus one per Toronto calendar day. Both `018` and `18` URL styles are tried. Archive discovery covers publication gaps, since historical issues were not daily. To force an issue, use `npm.cmd run discover -- --issue 18 --interactive`.

The site presented Cloudflare verification during development. Use `--interactive` to complete browser verification yourself; the script saves its separate browser session in `data/browser`. It does not solve CAPTCHA. Headless runs may still be blocked. Discovery errors appear in `data/jobs.json`; inaccessible pages are not treated as successfully scanned. Undated internship candidates must mention 2027 on the employer page before autofill.

`apply` processes only `pending` entries, at most 100 per run by default (`--limit 10` changes this). Review the `form`, `reason`, and `finalUrl` fields in `data/jobs.json`. Resolved employer URLs are also checked for duplicates. Successful submissions are retained. A submission attempt without confirmation becomes `submission_unconfirmed` and is never automatically retried. A crash leaves an `in_progress` record for inspection.

After checking an application yourself, change its state explicitly:

```powershell
node src/cli.js mark "https://employer.example/job/123" submitted
# Retry a review item after adding its answers or resolving a login:
node src/cli.js mark "https://employer.example/job/123" pending
```

Use the original `url` from `data/jobs.json` in these commands. Only mark a submission pending again after checking the employer did not already receive it. The browser closes when the run ends; use interactive mode to review before it closes.

## Custom employer fields

Exact selector overrides support custom fields. Add rules only after checking that employer's form. Rules apply to the top-level page on the exact hostname:

```json
{
  "host": "jobs.example.com",
  "fields": [
    { "selector": "#university", "value": "Your actual university" },
    { "selector": "#sponsorship", "kind": "select", "value": "Yes" }
  ],
  "submitSelector": "button#submit-application"
}
```

Put these objects in the profile's `siteRules` array. Select values use displayed option labels. Hidden, ambiguous or multi-step forms stay in review; this is a generic autofill assistant rather than an employer-specific integration for every ATS. Some employers validate fields only after submission, so an attempted submission may need manual correction.

## Run daily

The script runs once per invocation. To run daily, create a Windows Task Scheduler task with **Start in** set to `C:\Users\nguye\autoapply`, and action `powershell.exe` with arguments:

```text
-NoProfile -File "C:\Users\nguye\autoapply\run-daily.ps1"
```

`run-daily.ps1` discovers and autofills by default. Add `-Submit` to those arguments to enable automatic submission. Run the interactive commands first to configure your profile and browser session. No scheduled task is installed by this project.

Applicant details, resume uploads and browser cookies are private local data. `profile.json` and `data/` are gitignored. Run only one instance at a time; if a process crashes, verify it is stopped before deleting `data/run.lock`.

## Verification

```powershell
npm.cmd test
```

Tests cover Toronto issue numbering, publication links, local section/year filtering, exact answer matching, required fields, and a local browser form with a submission confirmation. Real employer submissions are not used in testing.
