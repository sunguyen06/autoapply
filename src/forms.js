import { resolve } from 'node:path';
import { access } from 'node:fs/promises';
import { answerFor } from './core.js';

export async function fillForms(page, profile) {
  const filled = [], unresolved = [], errors = [];
  for (const frame of page.frames()) {
    const controls = frame.locator('input,select,textarea');
    const count = await controls.count();
    for (let i = 0; i < count; i++) {
      const control = controls.nth(i);
      if (!(await control.isVisible()) || !(await control.isEnabled())) continue;
      const field = await control.evaluate(el => ({
        type: el.type, name: el.name, tag: el.tagName.toLowerCase(),
        label: [...(el.labels || [])].map(l => {
          const copy = l.cloneNode(true);
          copy.querySelectorAll('input,select,textarea,button').forEach(n => n.remove());
          return copy.textContent;
        }).join(' ').trim().replace(/\s*\*\s*$/, '') || el.getAttribute('aria-label') || '',
        placeholder: el.getAttribute('placeholder') || '', required: el.required || el.getAttribute('aria-required') === 'true',
        value: el.value, checked: el.checked
      }));
      const label = field.label || field.name || field.placeholder || `field ${i}`;
      if (['submit', 'button', 'reset', 'hidden', 'password'].includes(field.type)) {
        if (field.type === 'password') unresolved.push(`${label} (login)`);
        continue;
      }
      try {
        if (field.type === 'file') {
          if (/resume|\bcv\b/i.test(label) && profile.resume) {
            const path = resolve(profile.resume);
            await access(path);
            await control.setInputFiles(path);
            filled.push(label);
          } else if (field.required) unresolved.push(label);
          continue;
        }
        const answer = answerFor(field, profile);
        if (answer === undefined) {
          if (field.required && (!field.value || ['checkbox', 'radio'].includes(field.type) && !field.checked)) unresolved.push(label);
          continue;
        }
        if (field.tag === 'select') await control.selectOption({ label: String(answer) });
        else if (field.type === 'checkbox') {
          if (typeof answer !== 'boolean') throw new Error('Checkbox answers must be true or false');
          await control.setChecked(answer);
        } else if (field.type === 'radio') {
          if (String(answer) === field.value) await control.check();
        } else await control.fill(String(answer));
        filled.push(label);
      } catch (error) { errors.push(`${label}: ${error.message.split('\n')[0]}`); }
    }
  }
  // Optional exact site mappings support custom widgets and ambiguous fields.
  for (const rule of profile.siteRules || []) {
    if (new URL(page.url()).hostname !== rule.host) continue;
    for (const mapping of rule.fields || []) {
      try {
        const control = page.locator(mapping.selector);
        if (mapping.kind === 'check') await control.setChecked(mapping.value === true);
        else if (mapping.kind === 'select') await control.selectOption({ label: String(mapping.value) });
        else await control.fill(String(mapping.value));
        filled.push(mapping.selector);
      } catch (error) { errors.push(`${mapping.selector}: ${error.message.split('\n')[0]}`); }
    }
  }
  return { filled, unresolved, errors };
}

export async function submitForm(page, profile) {
  // Require a single visible form with an unambiguous application-submit control.
  const rule = (profile.siteRules || []).find(r => r.host === new URL(page.url()).hostname);
  const candidates = [];
  for (const frame of page.frames()) {
    const buttons = rule?.submitSelector && frame === page.mainFrame()
      ? frame.locator(rule.submitSelector)
      : frame.getByRole('button', { name: /^(submit application|send application|apply now|submit)$/i });
    for (let i = 0; i < await buttons.count(); i++) {
      const button = buttons.nth(i);
      if (await button.isVisible() && await button.isEnabled()) candidates.push(button);
    }
  }
  if (candidates.length !== 1) return { status: 'needs_review', reason: 'No unique submission button; finish this form manually.' };
  const button = candidates[0];
  const valid = await button.evaluate(el => {
    const form = el.closest('form');
    return !!form && form.querySelectorAll('input:not([type=hidden]),textarea,select').length > 0 && form.checkValidity();
  });
  if (!valid) return { status: 'needs_review', reason: 'Form is missing required answers, has custom validation, or uses an unsupported layout.' };
  // No retries after click: a timeout may still mean the employer received it.
  try {
    await button.click({ timeout: 15000 });
    await page.waitForFunction(() => /application (?:has been |was )?(?:successfully )?(?:submitted|received)|thank you for applying|thanks for applying/i.test(document.body.innerText), { }, { timeout: 15000 });
    return { status: 'submitted', reason: 'Employer displayed an application confirmation.' };
  } catch {
    return { status: 'submission_unconfirmed', reason: 'Submission attempted; check employer confirmation before retrying.' };
  }
}
