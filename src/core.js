import { load } from 'cheerio';

export const BASE = 'https://directconsideration.com';
export function issueNumber(date = new Date(), anchor = '2026-10-29', start = 18) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
  return start + Math.round((Date.parse(today) - Date.parse(anchor)) / 86400000);
}
export function issueUrls(number) {
  return [...new Set([String(number).padStart(3, '0'), String(number)])].map(n => `${BASE}/p/direct-consideration-${n}`);
}
export function canonical(raw) {
  const url = new URL(raw);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Unsupported URL');
  for (const key of [...url.searchParams.keys()]) if (/^(utm_|gh_src|source$|ref$)/i.test(key)) url.searchParams.delete(key);
  url.hash = '';
  url.searchParams.sort();
  return url.href;
}
export function archiveUrls(html) {
  const $ = load(html);
  return [...new Set($('a[href]').map((_, a) => {
    try {
      const u = new URL($(a).attr('href'), BASE);
      return u.origin === BASE && /^\/p\/direct-consideration-\d+\/?$/.test(u.pathname) ? u.href : null;
    } catch { return null; }
  }).get().filter(Boolean))];
}
export function classify(text) {
  const internship = /\b(intern(?:ship)?s?|co[ -]?op|industrial placement)\b/i.test(text);
  const years = text.match(/\b20\d{2}\b/g) || [];
  return { internship, year2027: years.includes('2027'), otherYearOnly: years.length > 0 && !years.includes('2027') };
}
// A link's heading and following block belong together; page-wide years do not.
export function extractJobs(html, source) {
  const $ = load(html);
  $('script,style,nav,footer,header').remove();
  const root = $('article').first().length ? $('article').first() : $('main').first().length ? $('main').first() : $('body');
  let title = '', parts = [];
  const jobs = [];
  root.find('h1,h2,h3,h4,h5,p,li,a[href]').each((_, el) => {
    const tag = el.tagName.toLowerCase(), node = $(el);
    if (/^h[1-5]$/.test(tag)) { title = node.text().trim(); parts = []; }
    if (['p', 'li'].includes(tag)) parts.push(node.text().trim());
    if (tag !== 'a') return;
    const label = node.text().trim();
    if (!/\b(apply|explore (?:the )?(?:role|internships)|see (?:the )?job)\b/i.test(label)) return;
    let url;
    try { url = canonical(new URL(node.attr('href'), source).href); } catch { return; }
    if (new URL(url).origin === BASE) return;
    const context = `${title}\n${parts.join('\n')}\n${label}`;
    const info = classify(context);
    if (!info.internship || info.otherYearOnly) return;
    jobs.push({ url, title, context, source, status: 'pending', yearConfirmed: info.year2027 });
  });
  return [...new Map(jobs.map(job => [job.url, job])).values()];
}
export const normalize = s => s.toLowerCase().replace(/[^a-z0-9]/g, '');
export function answerFor(field, profile) {
  const key = normalize(field.label || field.name || field.placeholder || '');
  for (const [question, answer] of Object.entries(profile.answers || {})) {
    if (normalize(question) === key && answer !== '') return answer;
  }
  const aliases = {
    firstName: ['firstname', 'givenname'], lastName: ['lastname', 'familyname', 'surname'],
    email: ['email', 'emailaddress'], phone: ['phone', 'phonenumber', 'mobilephone', 'mobilephonenumber'],
    city: ['city'], country: ['country'], linkedin: ['linkedin', 'linkedinprofile', 'linkedinurl'],
    website: ['website', 'personalwebsite', 'portfolio', 'portfoliourl']
  };
  if (['fullname', 'name', 'yourname'].includes(key) && profile.firstName && profile.lastName) return `${profile.firstName} ${profile.lastName}`;
  for (const [prop, names] of Object.entries(aliases)) if (names.includes(key) && profile[prop]) return profile[prop];
  return undefined;
}
