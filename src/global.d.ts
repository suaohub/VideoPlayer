/// <reference types="vite/client" />

import 'react';

declare module '*.css' {
  const stylesheet: string;
  export default stylesheet;
}

declare module 'react' {
  interface CSSProperties {
    WebkitAppRegion?: 'drag' | 'no-drag';
  }
}
