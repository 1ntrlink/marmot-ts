# Agent Guidelines for MarmoTS Chat

This document provides guidelines for AI coding agents working in the chat application.

## Project Structure

This is a React + TypeScript + Vite application located in `/chat` of the marmot-ts monorepo:

- **`/src/components`**: React components (UI + custom)
  - `/ui`: shadcn/ui components
  - `/form`: Form-specific components
  - `/key-package`: Key package related components
- **`/src/hooks`**: Custom React hooks
- **`/src/lib`**: Utility libraries & core logic
- **`/src/pages`**: Route-based page components
- **`/public`**: Static assets

## Code Style Guidelines

### Imports

**Order**: External libraries first, then path alias imports, then relative imports

```typescript
// 1. External libraries
import { useState, useEffect } from "react";
import { EventStore } from "applesauce-core";
import { Link } from "react-router";

// 2. Path alias imports (@/*)
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";

// 3. Type-only imports
import type { ClassValue } from "clsx";
import type { NostrEvent } from "applesauce-core/helpers";
```

**Type imports**: Use `type` keyword for type-only imports

```typescript
import type { ReactNode } from "react";
import type { BreadcrumbItemType } from "@/components/page-header";
```

### Error Handling

**Throw errors with descriptive messages**:

```typescript
if (!isValidPubkey(pubkey)) {
  throw new Error("Invalid nostr public key, must be 64 hex characters");
}
```

**Use try-catch for expected failures**:

```typescript
try {
  const data = localStorage.getItem(key);
  if (data) {
    subject.next(JSON.parse(data));
  }
} catch {
  // Silent failure for localStorage (expected in some environments)
}
```

**Verify with try-catch for validation**:

```typescript
eventStore.verifyEvent = (e) => {
  try {
    nw.verifyEvent(e);
    return true;
  } catch {
    return false;
  }
};
```

### Documentation

**Use JSDoc** for exported functions and hooks

## React Patterns

### Component Structure

```typescript
interface ComponentProps {
  required: string;
  optional?: number;
}

export function Component({ required, optional = 42 }: ComponentProps) {
  // 1. Hooks first (always in same order)
  const [state, setState] = useState<string>("");
  const profile = use$(() => eventStore.profile(pubkey), [pubkey]);

  useEffect(() => {
    // Side effects
  }, [dependencies]);

  // 2. Early returns for loading/error states
  if (!profile) return <Skeleton />;
  if (error) return <ErrorMessage error={error} />;

  // 3. Event handlers
  const handleClick = () => {
    setState("new value");
  };

  // 4. Render
  return (
    <div>
      {required}
    </div>
  );
}
```

### Custom Hooks

- **Prefix with `use`**: `useDebounce`, `use$`, `useProfile`
- **Document with JSDoc** and examples
- **Export as named exports**
- **Return consistent types** (arrays, objects, or single values)

## State Management

### RxJS Observables

```typescript
import { BehaviorSubject } from "rxjs";

// Create observable
export const extraRelays$ = new BehaviorSubject<string[]>([]);

// Persist to localStorage
persist("extra-relays", extraRelays$);

// Subscribe in components
const relays = use$(() => extraRelays$, []);
```

### LocalStorage Persistence

BehaviorSubject can be persisted to localStorage using the `persist` function

## UI Framework

- **shadcn/ui** with Radix UI primitives
- **Tailwind CSS v4** with custom themes
- **Tabler Icons** (`@tabler/icons-react`)
- **JetBrains Mono** variable font

### shadcn/ui Components

Located in `src/components/ui/`:

- Import and use as React components
- Styled with Tailwind CSS
- Customizable via `className` prop

```typescript
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

<Button variant="outline" size="sm">Click me</Button>
```
