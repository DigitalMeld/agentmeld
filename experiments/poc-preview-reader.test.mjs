import test from 'node:test';import assert from 'node:assert/strict';import {textMetrics} from '../apps/poc/public/preview-reader.js';
test('text metrics handle empty files, mixed newlines and Unicode code points',()=>{assert.deepEqual(textMetrics(''),{lines:0,words:0,characters:0});assert.deepEqual(textMetrics('a\r\nb\rc\n😀'),{lines:4,words:4,characters:8});});
