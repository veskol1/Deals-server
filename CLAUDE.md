# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a **Firebase Cloud Functions** backend for an Amazon product deals API. Despite being in `AndroidStudioProjects`, this is a Node.js project. It exposes HTTP endpoints that return product deal data including Amazon affiliate links, coupon codes, discount percentages, and product metadata.

Firebase project ID: `deals-4d8ce`

## Commands

All commands run from the `functions/` directory or with `--prefix functions`:

```bash
npm --prefix functions run lint     # ESLint (also runs automatically before deploy)
npm --prefix functions run serve    # Start Firebase emulators for local testing
npm --prefix functions start        # Interactive Firebase functions shell
npm --prefix functions run deploy   # Deploy to Firebase
npm --prefix functions run logs     # View live Firebase logs
```

## Architecture

The project has a minimal single-file structure:

- **`functions/index.js`** — sole source file; exports the `main` HTTP Cloud Function (`onRequest`) that returns hardcoded JSON product deal data
- **`firebase.json`** — deployment config; enforces `npm run lint` as a pre-deploy hook
- **`functions/.eslintrc.js`** — Google style guide with double quotes, arrow callbacks, 1000-char line limit

**Data flow:** HTTP request → `main` function → returns hardcoded product array as JSON response

There is no database integration (firebase-admin is included as a dependency but unused), no routing layer, and no modules — all logic lives in `index.js`.

## Code Style

ESLint enforces the Google JS style guide. Key rules:
- Double quotes for strings
- Arrow callbacks preferred over `function` expressions
- Max line length: 1000 characters
- Restricted globals: `name`, `length`

Lint runs automatically before every `deploy`.
