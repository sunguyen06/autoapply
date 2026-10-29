import test from 'node:test';
import assert from 'node:assert/strict';
import { issueNumber, issueUrls, extractJobs, archiveUrls, canonical, answerFor } from '../src/core.js';

test('daily numbering follows Toronto calendar across DST', () => {
  assert.equal(issueNumber(new Date('2026-10-29T16:00:00Z')), 18);
  assert.equal(issueNumber(new Date('2026-10-30T02:00:00Z')), 18);
  assert.equal(issueNumber(new Date('2026-10-30T16:00:00Z')), 19);
  assert.equal(issueNumber(new Date('2026-11-02T16:00:00Z')), 22);
  assert.deepEqual(issueUrls(18), [
    'https://directconsideration.com/p/direct-consideration-018',
    'https://directconsideration.com/p/direct-consideration-18'
  ]);
});
test('extracts local internship sections without borrowing another section year', () => {
  const html = `<article><h1>Newsletter 2027</h1>
    <h2>Example SWE Summer 2027 Internship</h2><p>Cohort: Internship</p>
    <p><a href="https://jobs.example/1?utm_source=dc">Apply to Example →</a></p>
    <h2>Other Intern</h2><p>Cohort: Internship</p><a href="https://jobs.example/2">Apply →</a>
    <h2>Fall 2026 Intern</h2><p>Cohort: Internship</p><a href="https://jobs.example/3">Apply →</a>
    <h2>2027 SWE New Grad</h2><p>Cohort: New Grad</p><a href="https://jobs.example/4">Apply →</a>
    <h2>2027 internship information session</h2><a href="https://events.example/5">Register →</a>
    </article>`;
  const jobs = extractJobs(html, 'https://directconsideration.com/p/direct-consideration-018');
  assert.equal(jobs.length, 2);
  assert.equal(jobs[0].url, 'https://jobs.example/1');
  assert.equal(jobs[0].yearConfirmed, true);
  assert.equal(jobs[1].yearConfirmed, false);
});
test('archive and canonical URLs retain job identifiers', () => {
  assert.deepEqual(archiveUrls('<a href="/p/direct-consideration-018">18</a><a href="https://evil.example/p/direct-consideration-19">x</a>'), ['https://directconsideration.com/p/direct-consideration-018']);
  assert.equal(canonical('https://jobs.example/apply?utm_source=dc&job=42#form'), 'https://jobs.example/apply?job=42');
});
test('answers use exact matching; no invented sponsorship or consent', () => {
  const profile = { firstName: 'Jane', lastName: 'Doe', email: 'jane@example.com', answers: { 'Require sponsorship?': 'Yes' } };
  assert.equal(answerFor({ label: 'First name' }, profile), 'Jane');
  assert.equal(answerFor({ label: 'Full name' }, profile), 'Jane Doe');
  assert.equal(answerFor({ label: 'Require sponsorship?' }, profile), 'Yes');
  assert.equal(answerFor({ label: 'Do you require sponsorship?' }, profile), undefined);
  assert.equal(answerFor({ label: 'Agree to terms' }, profile), undefined);
});
