#!/usr/bin/env node
import { main } from './cli.mjs';

process.exitCode = await main(process.argv.slice(2), { stdin: process.stdin, stdout: process.stdout, stderr: process.stderr });
