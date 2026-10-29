import { chromium } from 'playwright';
import { mkdir, readFile, writeFile, rename, open, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { parseArgs } from 'node:util';
import { BASE, issueNumber, issueUrls, archiveUrls, extractJobs, classify, canonical } from './core.js';
import { fillForms, submitForm } from './forms.js';

const { values: args, positionals } = parseArgs({ allowPositionals: true, options: {
  issue: { type: 'string' }, from: { type: 'string' }, to: { type: 'string' },
  profile: { type: 'string', default: 'profile.json' }, submit: { type: 'boolean', default: false },
  headless: { type: 'boolean', default: false }, interactive: { type: 'boolean', default: false },
  limit: { type: 'string', default: '100' }, help: { type: 'boolean', default: false }
} });
const command = positionals[0];
if (args.help || !['discover', 'apply', 'status', 'mark'].includes(command)) {
  console.log(`Direct Consideration 2027 internship assistant
  npm run discover -- [--issue 18 | --from 1 --to 18] [--interactive]
  npm run apply -- [--profile profile.json] [--submit] [--interactive] [--limit 100]
  node src/cli.js status
  node src/cli.js mark <job-url> submitted|pending|skipped
Browser is visible by default. --headless enables unattended operation.
Discovery scans today's expected issue, yesterday's, and the archive.
Without --submit, applications are filled and queued for review.
--interactive pauses for login/challenges and manual application review.`);
  process.exit(args.help ? 0 : 1);
}
const dataDir = resolve('data');
await mkdir(dataDir, { recursive: true });
let lock;
try { lock = await open(resolve(dataDir, 'run.lock'), 'wx'); }
catch { throw new Error('Another run is active. If a previous run crashed, remove data/run.lock after confirming it stopped.'); }
let context;
const rl = args.interactive ? createInterface({ input: stdin, output: stdout }) : null;
const dbPath = resolve(dataDir, 'jobs.json');
async function readDB() {
  try { return JSON.parse(await readFile(dbPath, 'utf8')); }
  catch (e) { if (e.code === 'ENOENT') return { jobs: [], issues: {} }; throw e; }
}
async function save(db) {
  await writeFile(`${dbPath}.tmp`, JSON.stringify(db, null, 2));
  await rename(`${dbPath}.tmp`, dbPath);
}
async function visit(page, url) {
  const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForTimeout(1500);
  let blocked = /just a moment|verify you are human|access denied|enable javascript and cookies/i.test(await page.title() + '\n' + (await page.locator('body').innerText()).slice(0, 1500));
  const initiallyBlocked = blocked;
  if (blocked && rl) {
    await rl.question('Complete the browser verification, then press Enter. ');
    blocked = /just a moment|verify you are human|access denied/i.test(await page.title());
  }
  if (blocked) throw new Error('Site verification required. Rerun with --interactive and complete it in the browser.');
  if (response && response.status() >= 400 && !initiallyBlocked) throw new Error(`HTTP ${response.status()}`);
  return page.content();
}
try {
  const db = await readDB();
  if (command === 'status') {
    console.table(db.jobs.map(({ title, status, url }) => ({ title, status, url })));
  } else if (command === 'mark') {
    const [, raw, status] = positionals;
    if (!raw || !['submitted', 'pending', 'skipped'].includes(status)) throw new Error('Usage: mark <job-url> submitted|pending|skipped');
    const job = db.jobs.find(j => j.url === canonical(raw));
    if (!job) throw new Error('URL not found in queue');
    job.status = status; job.updatedAt = new Date().toISOString(); await save(db);
  } else {
    let profile;
    if (command === 'apply') {
      profile = JSON.parse(await readFile(resolve(args.profile), 'utf8'));
      if (!profile.firstName || !profile.lastName || !profile.email || !profile.resume) throw new Error('Fill firstName, lastName, email and resume in profile.json before applying.');
      await readFile(resolve(profile.resume));
    }
    context = await chromium.launchPersistentContext(resolve(dataDir, 'browser'), { headless: args.headless, acceptDownloads: false });
    context.setDefaultTimeout(5000);
    const page = context.pages()[0] || await context.newPage();
    if (command === 'discover') {
      const urls = new Set();
      const current = issueNumber();
      if (args.issue) {
        if (!/^\d+$/.test(args.issue)) throw new Error('--issue must be a positive integer');
        issueUrls(Number(args.issue)).forEach(u => urls.add(u));
      } else if (args.from || args.to) {
        const from = Number(args.from), to = Number(args.to || current);
        if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to < from || to - from > 500) throw new Error('Provide a valid --from/--to range of at most 501 issues');
        for (let n = from; n <= to; n++) issueUrls(n).forEach(u => urls.add(u));
      } else {
        for (const n of [current, current - 1]) if (n > 0) issueUrls(n).forEach(u => urls.add(u));
        try { archiveUrls(await visit(page, `${BASE}/archive`)).forEach(u => urls.add(u)); }
        catch (e) { console.warn(`Archive: ${e.message}`); }
      }
      let added = 0;
      const seen = new Set(db.jobs.map(j => j.url));
      for (const url of urls) {
        console.log(`Reading ${url}`);
        try {
          const html = await visit(page, url);
          const jobs = extractJobs(html, url);
          db.issues[url] = { checkedAt: new Date().toISOString(), jobs: jobs.length };
          for (const job of jobs) if (!seen.has(job.url)) {
            db.jobs.push({ ...job, discoveredAt: new Date().toISOString() }); seen.add(job.url); added++;
          }
        } catch (e) { db.issues[url] = { error: e.message, checkedAt: new Date().toISOString() }; console.warn(e.message); }
        await save(db);
      }
      console.log(`Added ${added} internship candidates; ${db.jobs.length} total. See data/jobs.json. Undated listings are checked at the employer before filling.`);
      if (Object.values(db.issues).every(i => i.error)) process.exitCode = 2;
    } else {
      const limit = Number(args.limit);
      if (!Number.isInteger(limit) || limit < 1) throw new Error('--limit must be a positive integer');
      for (const job of db.jobs.filter(j => j.status === 'pending').slice(0, limit)) {
        console.log(`Opening ${job.title}: ${job.url}`);
        // Save before any employer interaction. A crash must not cause silent resubmission.
        job.status = 'in_progress'; await save(db);
        try {
          await visit(page, job.url);
          if (!await page.locator('input:not([type=hidden]),textarea,select').count()) {
            const apply = page.getByRole('link', { name: /^(apply|apply now|apply for this job|apply for this role)$/i });
            if (await apply.count() === 1) {
              const href = await apply.getAttribute('href');
              if (href) await visit(page, canonical(new URL(href, page.url()).href));
            }
          }
          if (rl) await rl.question('If needed, sign in or open the application form in this tab, then press Enter to autofill. ');
          const finalUrl = canonical(page.url());
          const previous = db.jobs.find(j => j !== job && (j.applicationUrl || j.finalUrl) === finalUrl && ['submitted', 'submission_unconfirmed', 'in_progress'].includes(j.status));
          if (previous) {
            job.status = 'skipped'; job.reason = `Duplicate employer URL already processed: ${previous.url}`;
            job.finalUrl = finalUrl; await save(db); continue;
          }
          job.finalUrl = finalUrl;
          job.applicationUrl = finalUrl;
          const description = await page.locator('body').innerText();
          const heading = await page.locator('h1').allTextContents();
          const eligibility = classify(`${heading.join(' ')}\n${description}`);
          if ((!job.yearConfirmed && (!eligibility.internship || !eligibility.year2027)) || eligibility.otherYearOnly) {
            job.status = 'needs_review'; job.reason = 'Could not confirm a 2027 internship at employer.';
          } else {
            const result = await fillForms(page, profile);
            job.form = result;
            job.status = 'needs_review';
            job.reason = 'Autofill complete; review and submit in the browser.';
            const hasCaptcha = await page.locator('iframe[src*="recaptcha"],iframe[src*="hcaptcha"],iframe[src*="challenges.cloudflare"],.g-recaptcha,.h-captcha,input[name="cf-turnstile-response"]').count() > 0;
            if (args.submit && result.filled.length && !result.unresolved.length && !result.errors.length && !hasCaptcha) {
              job.status = 'submission_unconfirmed'; job.reason = 'Submission may be attempted; verify before retrying.';
              await save(db);
              Object.assign(job, await submitForm(page, profile));
            } else if (args.submit) job.reason = 'Automatic submission blocked by unanswered fields, CAPTCHA, fill errors, or unsupported form.';
          }
          job.finalUrl = canonical(page.url());
          console.log(`${job.status}: ${job.reason}`);
          if (rl && job.status !== 'submitted') {
            const answer = await rl.question('Review now. Type submitted only if you completed it, skip to discard, or Enter to keep for review: ');
            if (answer.trim() === 'submitted') job.status = 'submitted';
            if (answer.trim() === 'skip') job.status = 'skipped';
          }
        } catch (e) { job.status = job.status === 'submission_unconfirmed' ? job.status : 'needs_review'; job.reason = e.message; console.warn(e.message); }
        job.updatedAt = new Date().toISOString(); await save(db);
      }
    }
  }
} finally {
  rl?.close();
  await context?.close();
  await lock.close();
  await unlink(resolve(dataDir, 'run.lock'));
}
