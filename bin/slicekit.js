#!/usr/bin/env node
import { runProcess } from '../src/cli/process.js';

await runProcess(process.argv.slice(2));
