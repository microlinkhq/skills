---
name: use-pnpm
description: Use pnpm for installs, adds, removals, scripts, dlx, and frozen lockfile workflows instead of npm or yarn.
---

# Use pnpm

Always use `pnpm` instead of `npm` or `yarn` for all package management operations.

## Command mapping

| Instead of | Use |
|---|---|
| `npm install` | `pnpm install` |
| `npm install <pkg>` | `pnpm add <pkg>` |
| `npm install -D <pkg>` | `pnpm add -D <pkg>` |
| `npm uninstall <pkg>` | `pnpm remove <pkg>` |
| `npm run <script>` | `pnpm run <script>` |
| `npx <cmd>` | `pnpm dlx <cmd>` |
| `npm ci` | `pnpm install --frozen-lockfile` |
