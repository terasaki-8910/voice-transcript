#!/usr/bin/env node
import { main } from "./cli.js";

process.exit(
  await main(process.argv.slice(2), {
    env: { GROQ_API_KEY: process.env.GROQ_API_KEY },
  }),
);
