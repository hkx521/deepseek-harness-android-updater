#!/usr/bin/env node
// dsh-agy CLI launcher (built output).
import { createProgram } from '../lib/cli/index.mjs'

const program = createProgram()
await program.parseAsync(process.argv)
