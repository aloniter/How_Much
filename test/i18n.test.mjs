import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { t, setLang } from '../public/js/i18n.js';
import { LINES } from '../public/js/roast-lines.js';
import { defaultCurrency, CURRENCIES } from '../public/js/currency.js';

/** Flatten a dictionary into [path, value] pairs, calling function entries with sample values. */
function strings(lang) {
  setLang(lang);
  const sample = new Proxy({}, { get: (_, k) => (k === Symbol.toPrimitive ? () => 2 : typeof k === 'string' ? 2 : undefined) }); // any placeholder gets a value
  const out = [];
  const walk = (key) => {
    const v = t(key, sample);
    if (typeof v === 'string') out.push([key, v]);
    else if (Array.isArray(v)) v.forEach((x, i) => out.push([`${key}[${i}]`, typeof x === 'string' ? x : x.join(' ')]));
    else if (v && typeof v === 'object') for (const k of Object.keys(v)) walk(`${key}.${k}`);
  };
  const src = readFileSync(new URL('../public/js/i18n.js', import.meta.url), 'utf8');
  const enBlock = src.slice(src.indexOf('const en = {'), src.indexOf('const he = {'));
  const keys = [...enBlock.matchAll(/^ {2}([a-zA-Z0-9]+):/gm)].map(m => m[1]).filter(k => k !== 'dir');
  for (const k of keys) walk(k);
  return out;
}

test('every English key has a Hebrew version (and vice versa)', () => {
  const en = new Map(strings('en'));
  const he = new Map(strings('he'));
  for (const k of en.keys()) assert.ok(he.has(k), `missing Hebrew for ${k}`);
  for (const k of he.keys()) assert.ok(en.has(k), `missing English for ${k}`);
  for (const [k, v] of he) {
    if (/^(switchTo|switchAria|backArrow|sec|minSec|formW|formL|tipGuess|histWinner|imgRank|shareHeader)$/.test(k)) continue;
    if (/[a-z]{4,}/.test(v.replace(/CheckMate|English|QR|Switch to English/g, '')) && !/[֐-׿]/.test(v)) assert.fail(`${k} looks untranslated: ${v}`);
  }
});

test('Hebrew copy avoids gender slash forms and never translates the brand', () => {
  const slash = /[֐-׿]\/[֐-׿]/;
  for (const [k, v] of strings('he')) {
    assert.doesNotMatch(v, slash, `${k}: "${v}"`);
    assert.doesNotMatch(v, /שח-?מט/, `${k} translates the brand`);
    if (k !== 'minSec') assert.doesNotMatch(v, /undefined|\{\w+\}/, `${k} has an unfilled placeholder: ${v}`); // minSec takes (m, s)
  }
  for (const [angle, lines] of Object.entries(LINES.he)) {
    const all = Array.isArray(lines) ? lines : Object.values(lines).flat();
    for (const line of all) {
      assert.doesNotMatch(line, slash, `roast ${angle}: "${line}"`);
      assert.doesNotMatch(line, /שח-?מט/);
    }
  }
  setLang('he');
  assert.match(t('checkmateWins', { who: '🍕 בן' }), /CheckMate/);
  assert.match(t('inviteText', { code: 'ABCD' }), /CheckMate/);
  assert.match(t('shareHeader', { title: 'x', label: 'y' }), /CheckMate/);
});

test('Hebrew jokes are original, not copies of the English ones', () => {
  // the user's own examples are in the library
  const he = Object.values(LINES.he).flatMap(v => (Array.isArray(v) ? v : Object.values(v).flat()));
  for (const s of ['אחי, אכלנו במסעדה, לא קנינו אותה.', 'מישהו פה עדיין חי במחירים של 2005.', 'במחיר הזה המלצר אמור להגיע איתנו הביתה.',
    'כל הזמן הזה בשביל לטעות ככה?', 'אפילו המחשבון התבייש.', 'נראה שמישהו שכח שהזמנו גם יין.', 'המשפחה דורשת בדיקת רואה חשבון.']) {
    assert.ok(he.includes(s), `missing: ${s}`);
  }
  assert.ok(he.length >= 130);
});

test('currency defaults: ILS for Israeli users, regional otherwise', () => {
  assert.equal(defaultCurrency({ languages: ['he-IL'] }), '₪');
  assert.equal(defaultCurrency({ languages: ['he'] }), '₪');
  assert.equal(defaultCurrency({ languages: ['en-IL'] }), '₪');
  assert.equal(defaultCurrency({ languages: ['en-US'], timeZone: 'Asia/Jerusalem' }), '₪');
  assert.equal(defaultCurrency({ languages: ['ar-IL'] }), '₪');
  assert.equal(defaultCurrency({ languages: ['en-US'], timeZone: 'America/New_York' }), '$');
  assert.equal(defaultCurrency({ languages: ['en-GB'] }), '£');
  assert.equal(defaultCurrency({ languages: ['fr-FR'] }), '€');
  assert.equal(defaultCurrency({ languages: ['ja-JP'] }), '¥');
  assert.equal(defaultCurrency({ languages: ['en'] }), '$');
  assert.equal(CURRENCIES[0].code, 'ILS');
});
