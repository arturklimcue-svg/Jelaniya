#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.join(__dirname);
const scriptPath = path.join(root, 'public', 'script.js');
const htmlPath = path.join(root, 'public', 'index.html');
const cssPath = path.join(root, 'public', 'style.css');

const script = fs.readFileSync(scriptPath, 'utf8');
const html = fs.readFileSync(htmlPath, 'utf8');
const css = fs.readFileSync(cssPath, 'utf8');

let failures = 0;
function check(name, fn) {
  try { fn(); console.log('  ✓ ' + name); }
  catch (e) { failures++; console.error('  ✗ ' + name + ': ' + e.message); }
}

console.log('smoke: public/script.js');
check('файл парсится как JS', () => {
  new Function(script);
});
check('объявлены ключевые функции', () => {
  for (const fn of ['esc', 'render', 'boot', 'loadData', 'showNeedBot', 'applyTheme', 'swRegister', 'api', 'toast', 'openModal']) {
    assert.ok(new RegExp('function ' + fn + '\\b').test(script) || new RegExp('const ' + fn + '\\s*=').test(script), 'нет функции ' + fn);
  }
});

console.log('smoke: согласованность HTML/JS');
check('элементы интерфейса на месте', () => {
  for (const id of ['bgwall', 'main', 'tabbar', 'fab', 'modal-root', 'toast-root', 'confetti-root']) {
    assert.ok(html.includes('id="' + id + '"'), 'нет id="' + id + '"');
  }
});
check('все getElementById из JS есть в HTML', () => {
  const ids = [...script.matchAll(/getElementById\(['"]([^'"]+)['"]\)/g)].map(m => m[1]);
  for (const id of new Set(ids)) {
    assert.ok(html.includes('id="' + id + '"'), 'нет id="' + id + '"');
  }
});
check('авторизация передаёт initData на сервер', () => {
  assert.ok(script.includes('initData='), 'initData не передаётся в запросах');
  assert.ok(script.includes('showNeedBot'), 'нет экрана доступа');
});
check('бутстрап вызывается в конце', () => {
  assert.ok(/^boot\(\);?$/m.test(script), 'нет вызова boot()');
});

console.log('smoke: согласованность классов JS/CSS');
const classes = ['view', 'card', 'btn', 'chip', 'view-head', 'view-title', 'view-sub', 'tb-btn', 'row', 'tile', 'modal', 'toast', 'empty', 'divider', 'section-title', 'icon-small', 'ach-item', 'ach-ico', 'chips', 'small-link'];
check('классы интерфейса есть в style.css', () => {
  for (const c of classes) {
    assert.ok(css.includes('.' + c), 'нет стиля .' + c);
  }
});

if (failures) { console.error('\nПровалено: ' + failures); process.exit(1); }
console.log('\nВсе проверки пройдены ✅');
