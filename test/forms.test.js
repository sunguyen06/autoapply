import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { fillForms, submitForm } from '../src/forms.js';

test('autofill and submission honor missing answers and employer confirmation', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`<form onsubmit="event.preventDefault();document.body.innerHTML='Thank you for applying'">
      <label>First name<input required name="first"></label>
      <label>Email<input required type="email"></label>
      <label>Require sponsorship?<select required><option value="">Choose</option><option>Yes</option><option>No</option></select></label>
      <label>Agree to terms<input type="checkbox" required></label>
      <button type="submit">Submit application</button></form>`);
    const profile = { firstName: 'Jane', email: 'jane@example.com', answers: {} };
    const result = await fillForms(page, profile);
    assert.equal(result.filled.length, 2);
    assert.deepEqual(result.unresolved, ['Require sponsorship?', 'Agree to terms']);
    assert.equal((await submitForm(page, profile)).status, 'needs_review');
    profile.answers = { 'Require sponsorship?': 'Yes', 'Agree to terms': true };
    assert.deepEqual((await fillForms(page, profile)).errors, []);
    assert.equal((await submitForm(page, profile)).status, 'submitted');
  } finally { await browser.close(); }
});
