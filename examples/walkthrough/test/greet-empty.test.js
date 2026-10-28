import { test } from 'node:test';
import assert from 'node:assert/strict';
import { greet } from '../src/greet.js';
test('refuses an empty name', () => assert.throws(() => greet(''), /a name is required/));
