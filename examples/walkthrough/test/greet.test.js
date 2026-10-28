import { test } from 'node:test';
import assert from 'node:assert/strict';
import { greet } from '../src/greet.js';
test('greets a name', () => assert.equal(greet('Ada'), 'Hello, Ada!'));
