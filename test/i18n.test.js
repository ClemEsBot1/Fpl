import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LANGUAGES, makeT, pickLanguage, setDictionary, t, fmtNumber, isRtl } from '../src/lib/i18n.js';

test('language: saved choice, then browser, then English', () => {
  assert.equal(pickLanguage('fr', ['de-DE']), 'fr');
  assert.equal(pickLanguage('xx', ['pt-BR', 'en']), 'pt');
  assert.equal(pickLanguage(null, ['sv-SE', 'ko-KR']), 'ko');
  assert.equal(pickLanguage(null, ['sv-SE']), 'en');
  assert.equal(pickLanguage(null, undefined), 'en');
});

test('t: the English is the key, placeholders filled, missing falls back', () => {
  setDictionary('fr', { 'Hello {name}': 'Bonjour {name}' });
  assert.equal(t('Hello {name}', { name: 'Saka' }), 'Bonjour Saka');
  assert.equal(t('Not translated'), 'Not translated');
  assert.equal(t('{n} pts', { n: 4 }), '4 pts');
  assert.equal(t('{missing} stays'), '{missing} stays');
  assert.equal(fmtNumber(1234567), (1234567).toLocaleString('fr'));
  setDictionary('en', null);
  assert.equal(t('Hello {name}', { name: 'Saka' }), 'Hello Saka');
});

test('makeT translates with its own dictionary, leaving the global one alone', () => {
  const de = makeT({ Injured: 'Verletzt' });
  assert.equal(de('Injured'), 'Verletzt');
  assert.equal(t('Injured'), 'Injured');
});

test('only Arabic is right to left', () => {
  assert.deepEqual(LANGUAGES.filter(l => isRtl(l.code)).map(l => l.code), ['ar']);
});

test('ordinals and plurals', async () => {
  const { ordinal, plural } = await import('../src/lib/i18n.js');
  assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22, 112].map(n => ordinal(n, 'en')), ['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '112th']);
  assert.equal(ordinal(1, 'fr'), '1er');
  assert.equal(ordinal(3, 'ko'), '3위');
  assert.equal(ordinal(3, 'ar'), '3');
  assert.equal(plural(1, '1 goal', '{n} goals'), '1 goal');
  assert.equal(plural(3, '1 goal', '{n} goals'), '3 goals');
});
