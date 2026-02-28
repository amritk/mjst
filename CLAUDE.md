
Default to using Bun instead of Node.js.

- Use `bun <file>` instead of `node <file>` or `ts-node <file>`
- Use `bun test` instead of `jest` or `vitest`
- Use `bun build <file.html|file.ts|file.css>` instead of `webpack` or `esbuild`
- Use `bun install` instead of `npm install` or `yarn install` or `pnpm install`
- Use `bun run <script>` instead of `npm run <script>` or `yarn run <script>` or `pnpm run <script>`
- Use `bunx <package> <command>` instead of `npx <package> <command>`
- Bun automatically loads .env, so don't use dotenv.

## APIs

- `Bun.serve()` supports WebSockets, HTTPS, and routes. Don't use `express`.
- `bun:sqlite` for SQLite. Don't use `better-sqlite3`.
- `Bun.redis` for Redis. Don't use `ioredis`.
- `Bun.sql` for Postgres. Don't use `pg` or `postgres.js`.
- `WebSocket` is built-in. Don't use `ws`.
- Prefer `Bun.file` over `node:fs`'s readFile/writeFile
- Bun.$`ls` instead of execa.

## Testing

Use `bun test` to run tests.

```ts#index.test.ts
import { test, expect } from "bun:test";

test("hello world", () => {
  expect(1).toBe(1);
});
```

## Frontend

Use HTML imports with `Bun.serve()`. Don't use `vite`. HTML imports fully support React, CSS, Tailwind.

Server:

```ts#index.ts
import index from "./index.html"

Bun.serve({
  routes: {
    "/": index,
    "/api/users/:id": {
      GET: (req) => {
        return new Response(JSON.stringify({ id: req.params.id }));
      },
    },
  },
  // optional websocket support
  websocket: {
    open: (ws) => {
      ws.send("Hello, world!");
    },
    message: (ws, message) => {
      ws.send(message);
    },
    close: (ws) => {
      // handle close
    }
  },
  development: {
    hmr: true,
    console: true,
  }
})
```

HTML files can import .tsx, .jsx or .js files directly and Bun's bundler will transpile & bundle automatically. `<link>` tags can point to stylesheets and Bun's CSS bundler will bundle.

```html#index.html
<html>
  <body>
    <h1>Hello, world!</h1>
    <script type="module" src="./frontend.tsx"></script>
  </body>
</html>
```

With the following `frontend.tsx`:

```tsx#frontend.tsx
import React from "react";
import { createRoot } from "react-dom/client";

// import .css files directly and it works
import './index.css';

const root = createRoot(document.body);

export default function Frontend() {
  return <h1>Hello, world!</h1>;
}

root.render(<Frontend />);
```

Then, run index.ts

```sh
bun --hot ./index.ts
```

For more information, read the Bun API docs in `node_modules/bun-types/docs/**.mdx`.

## Writing TypeScript

You write TypeScript code that is clear, predictable, and easy to maintain. The goal is to make the codebase safer, more understandable, and easier to refactor without over-engineering.

### Principles

- Type safety over flexibility.
- Clarity over cleverness.
- Type inference where it makes sense.

### General Guidelines

- Always use `type` over `interface`.
- Explicit return types for functions.
- Avoid `any`. Use `unknown` when the type is unclear.
- Prefer primitive types over complex ones unless necessary.
- Always use `const` instead of `let`.
- Use `satisfies` instead of `as`.
- Always use arrow functions when possible.
- Import using package.json `imports` (subpath imports), e.g. `import x from "#markdown/generate-markdown"`.
- use bun for packages
- use one function per file
- do not use classes, use functional programming paradigms

### Naming Conventions

- Be descriptive.
- Use suffixes appropriately.

## Great Comments for All Types

Use comments to explain **why**, not **what**. Most of the time, the code explains what is happening. Comments should clarify why a type or function exists, why you made specific decisions, or why a workaround is necessary.

Write friendly comments that sound human. Comments should be clear and helpful, not robotic or overly formal. Aim for a tone that is friendly and supportive, like you are helping a teammate understand the code later.

**Good:**

```typescript
/**
 * We load the user here to make sure we have fresh data when the component mounts.
 * Without this, the user info could be stale.
 */
```

**Bad:**

```typescript
/**
 * Load user.
 */
```

### Comment Guidelines

- Avoid contractions in comments. Use "do not" instead of "don't", "it is" instead of "it's", etc. This makes comments easier to read, especially for non-native speakers.
- If you use contractions, make sure they have proper apostrophes. Sometimes contractions can make a comment more approachable. If you choose to use them, use proper punctuation.
- Comment on types when their purpose is not obvious. If a type models an external API, or has a non-obvious constraint, explain it.
- Explain relationships between types when they are not clear.

**Example:**

```typescript
/**
 * Maps UserStatus to a badge color used in the UI.
 * Should stay in sync with the theme color palette.
 */
export type StatusColorMap = {
  active: "green";
  inactive: "gray";
};
```

- Document the intent of utility types or generic types.

**Example:**

```typescript
/**
 * Represents a partial object where at least one property is required.
 * Useful when you want to enforce at least one field update in a PATCH request.
 */
export type AtLeastOne<T> = {
  [K in keyof T]: Partial<T> & Pick<T, K>;
}[keyof T];
```

- For complex function signatures or composables, describe the behavior and usage.

**Example:**

```typescript
/**
 * useUser composable for loading and managing user data.
 * Fetches the user from the API and exposes reactive state.
 *
 * Returns:
 * - user: Ref<User | null>
 * - isLoading: Ref<boolean>
 * - loadUser: Function to manually trigger user loading
 */
export function useUser() {
  /* ... */
}
```

- If the type is temporary or will change later, leave a TODO comment.

**Example:**

```typescript
/**
 * TODO: Replace with dynamic permissions from backend when available.
 */
export type Permissions = "read" | "write" | "admin";
```

- Use JSDoc style consistently for types and functions that are exported or public. This improves editor support (tooltips, autocompletion) and helps other developers understand your code faster.

**Example:**

```typescript
/**
 * A user in the system.
 * This type represents the internal data structure for application logic.
 * If you need to expose user data publicly, use PublicUser.
 */
export type User = {
  /** Unique identifier for the user (UUID). */
  id: string;
  /** The user's full name. */
  name: string;
  /** Email address. Must be validated before saving. */
  email: string;
  /** ISO date string of when the user signed up. */
  createdAt: string;
  /** Whether the user has verified their email. */
  isVerified: boolean;
};
```

## Writing Tests

You write tests that are clear, maintainable, and thorough. You optimize for readability and reliability. Tests should be easy to understand and cover both typical use cases and edge cases.

### Setup

- Use bun testing for most tests. bun is our primary testing framework.
- No globals. Always explicitly import `describe`, `it`, and `expect` from `bun` in every test file.
- File naming conventions:
  - Unit/integration test files end with `.test.ts`.
  - Each test file matches the name of the file it tests. Example: If the code is in `custom-function.ts`, the test file should be named `custom-function.test.ts`.
  - The test file is located in the same folder as the file under test. This keeps code and tests closely related, improving discoverability and maintainability.
- Minimize mocking. Only mock when absolutely necessary. Prefer refactoring the code under test to make mocking unnecessary. Aim for simpler, pure functions that are easier to test without mocks.
- Do not use stubs.
- Every test file has a single top-level `describe()`.
- The top-level `describe()` matches the file name under test. Example: `describe('custom-function')` for `custom-function.test.ts`.
- Do not use nested `describe()` blocks. Keep tests flat within the single `describe()`.
- Use `it()` for individual tests.
- Keep test descriptions concise and direct.
- Do not start test descriptions with "should."
  - ✅ `it('generates a slug from the title')`
  - ❌ `it('should generate a slug from the title')`

### Style & Best Practices

- Clarity first. Write tests that are easy to read and understand, even for someone unfamiliar with the code.
- Think like a QA engineer.
- Cover all important code paths.
- Test both the happy path and error handling.
- Add tests for edge cases and potential failure scenarios.
- Comments are welcome when they add value.
- Use comments to explain why a test exists, not what it is doing.
- Avoid repeating what the code already makes obvious.

### Example Test File Structure

```
/src
  /lib
    custom-lib.ts
    custom-lib.test.ts
```

```typescript
import { describe, expect, it } from "bun";
import { doSomething, generateSlug } from "./custom-lib";

describe("custom-lib", () => {
  it("generates a slug from the title", () => {
    const result = generateSlug("Hello World");
    expect(result).toBe("hello-world");
  });

  it("handles empty input gracefully", () => {
    const result = generateSlug("");
    expect(result).toBe("");
  });

  it("does something really well", () => {
    const result = doSomething("Hello World");
    expect(result).toBe("hello-world");
  });
});
```
