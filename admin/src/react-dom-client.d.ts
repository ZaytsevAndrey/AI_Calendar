// The repo root has no @types/react-dom (it lives only in frontend/), so the one
// entry point this app uses is declared here instead of adding a dependency.
declare module 'react-dom/client' {
  import type { ReactNode } from 'react';
  export interface Root {
    render(children: ReactNode): void;
    unmount(): void;
  }
  export function createRoot(container: Element | DocumentFragment): Root;
}
