const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const esbuild = require('esbuild');

const htmlPath = path.join(__dirname, 'tags-route-designs.html');
const html = fs.readFileSync(htmlPath, 'utf8');
const layouts = ['library', 'tabs', 'chips', 'gallery', 'picker', 'directory'];
function setup() {
  const errors = [];
  const controls = [];
  const dom = new JSDOM(html, { runScripts: 'dangerously', beforeParse(window) {
    window.addEventListener('error', event => errors.push(event.error));
    window.Tweak = class {
      constructor(options) { this.options = options; }
      addSelect(state, key, options) { controls.push({ stage: this.options.container, state, key, options, render: this.options.onChange }); }
      addToggle() {}
    };
  } });
  assert.deepEqual(errors, [], 'No runtime errors on initialization');
  return { dom, controls, root: dom.window.document.getElementById('qs-tags-designs') };
}
function selectTag(dom, stage, tag) {
  if (stage.dataset.layout === 'picker') {
    const select = stage.querySelector('.qs-tag-select');
    select.value = tag;
    select.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  } else {
    [...stage.querySelectorAll('[data-tag]')].find(button => button.dataset.tag === tag).click();
  }
}

test('Six complete designs preserve the proposed sidenav entry and unique accessible IDs', () => {
  const { dom, root } = setup();
  assert.equal(root.querySelectorAll(':scope > [data-variant]').length, 6);
  assert.equal(root.querySelectorAll(':scope > [data-variant]:not([hidden])').length, 1);
  const ids = [...dom.window.document.querySelectorAll('[id]')].map(element => element.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const layout of layouts) {
    const stage = root.querySelector(`[data-layout="${layout}"]`);
    assert.equal(stage.querySelector('[aria-current="page"]').textContent.trim(), 'Tags');
    assert.ok(stage.querySelector('table[aria-label="Tagged activities"]'));
  }
  dom.window.close();
});

for (const layout of layouts) {
  test(`${layout}: selection filters event membership, searches within the tag, and handles saved empty tags`, () => {
    const { dom, root } = setup();
    const stage = root.querySelector(`[data-layout="${layout}"]`);
    selectTag(dom, stage, 'Recovery');
    if (layout === 'directory') assert.equal(dom.window.document.activeElement.dataset.action, 'back');
    else if (layout === 'picker') assert.equal(dom.window.document.activeElement.className, 'qs-tag-select');
    else assert.equal(dom.window.document.activeElement.dataset.tag, 'Recovery');
    assert.deepEqual([...stage.querySelectorAll('tbody tr')].map(row => row.dataset.eventId), ['a3', 'a6']);
    assert.equal(stage.querySelector('.qs-result-count').textContent, '2 activities');
    const search = stage.querySelector('.qs-activity-search');
    search.value = 'POOL';
    search.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    assert.deepEqual([...stage.querySelectorAll('tbody tr')].map(row => row.dataset.eventId), ['a3']);
    search.value = 'Sunday';
    search.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    assert.equal(stage.querySelector('.qs-empty-title').textContent, 'No matching activities');
    stage.querySelector('[data-action="clear-search"]').click();
    assert.equal(stage.querySelectorAll('tbody tr').length, 2);
    if (layout === 'directory') stage.querySelector('[data-action="back"]').click();
    selectTag(dom, stage, 'Race day');
    assert.equal(stage.querySelectorAll('tbody tr').length, 0);
    assert.equal(stage.querySelector('.qs-empty-title').textContent, 'No activities tagged Race day');
    assert.equal(stage.querySelector('.qs-empty').hidden, false);
    assert.equal(stage.querySelector('.qs-select-all').disabled, true);
    assert.equal(stage.querySelector('[data-action="next"]').disabled, true);
    dom.window.close();
  });
}

test('Table pagination, sorting, selection and column controls work without leaking across variants', () => {
  const { dom, root } = setup();
  const stage = root.querySelector('[data-layout="library"]');
  selectTag(dom, stage, 'All activities');
  assert.equal(stage.querySelector('.qs-page-count').textContent, '1–5 of 12');
  stage.querySelector('.qs-select-all').checked = true;
  stage.querySelector('.qs-select-all').dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  assert.equal(stage.querySelector('.qs-selection-count').textContent, '5 selected');
  stage.querySelector('[data-action="next"]').click();
  assert.equal(stage.querySelector('.qs-page-count').textContent, '6–10 of 12');
  assert.equal(stage.querySelector('.qs-select-all').checked, false);
  selectTag(dom, stage, 'Recovery');
  assert.equal(stage.querySelector('.qs-selection-bar').hidden, true);
  stage.querySelector('[data-sort="distance"]').click();
  assert.equal(stage.querySelector('tbody tr').dataset.eventId, 'a6');
  stage.querySelector('[data-action="columns"]').click();
  assert.equal(stage.querySelector('.qs-column-menu').hidden, false);
  const checkbox = stage.querySelector('[data-column="distance"]');
  checkbox.checked = false;
  checkbox.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  assert.ok([...stage.querySelectorAll('[data-column-cell="distance"]')].every(cell => cell.hidden));
  assert.equal(root.querySelector('[data-layout="tabs"] .qs-result-title').textContent, 'Endurance');
  dom.window.close();
});

test('Directory drills into the table and returns to the tag list; activity preview closes with Escape', () => {
  const { dom, root } = setup();
  const stage = root.querySelector('[data-layout="directory"]');
  assert.equal(stage.querySelector('.qs-results').hidden, true);
  selectTag(dom, stage, 'Endurance');
  assert.equal(stage.querySelector('.qs-results').hidden, false);
  assert.equal(stage.querySelector('.qs-selector').hidden, true);
  const activity = stage.querySelector('[data-event="a1"]');
  activity.click();
  assert.equal(stage.querySelector('.qs-detail-overlay').hidden, false);
  assert.equal(stage.querySelector('.qs-detail-name').textContent, 'Sunday long run');
  assert.equal(stage.querySelector('.qs-main').inert, true);
  stage.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(stage.querySelector('.qs-detail-overlay').hidden, true);
  assert.equal(dom.window.document.activeElement, activity);
  stage.querySelector('[data-action="back"]').click();
  assert.equal(stage.querySelector('.qs-results').hidden, true);
  assert.equal(stage.querySelector('.qs-selector').hidden, false);
  dom.window.close();
});

test('Displayed metric fixtures exactly match the shared Sports Lib formatter in metric and imperial settings', () => {
  const bundled = esbuild.buildSync({ entryPoints: [path.join(__dirname, 'fixture-data.ts')], bundle: true, platform: 'node', format: 'cjs', write: false, nodePaths: (process.env.NODE_PATH || '').split(path.delimiter).filter(Boolean) }).outputFiles[0].text;
  const fixtureModule = { exports: {} };
  new Function('require', 'module', 'exports', bundled)(require, fixtureModule, fixtureModule.exports);
  const { dom, root, controls } = setup();
  const embedded = JSON.parse(dom.window.document.getElementById('qs-tags-fixture-data').textContent);
  assert.deepEqual(embedded.activities, fixtureModule.exports.buildDisplayFixtures());
  const control = controls.find(control => control.stage.dataset.layout === 'library');
  const stage = root.querySelector('[data-layout="library"]');
  for (const unit of ['Metric', 'Imperial']) {
    control.state.unit = unit;
    control.render();
    const expected = embedded.activities[0].display[unit].distance;
    assert.equal(stage.querySelector('[data-event-id="a1"] [data-column-cell="distance"]').textContent, expected.text);
  }
  dom.window.close();
});
