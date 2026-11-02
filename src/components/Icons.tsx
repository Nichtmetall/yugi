import type { ReactNode } from 'react';

const Svg = ({ children, size = 22 }: { children: ReactNode; size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {children}
  </svg>
);

type P = { size?: number };

export const IconBinder = (p: P) => (
  <Svg {...p}>
    <rect x="4" y="3" width="16" height="18" rx="2" />
    <path d="M9.3 3v18M14.7 3v18M4 9h16M4 15h16" />
  </Svg>
);
export const IconDecks = (p: P) => (
  <Svg {...p}>
    <rect x="7" y="3" width="12" height="16" rx="1.5" />
    <path d="M4.5 6.5v13a1.5 1.5 0 0 0 1.5 1.5h10" />
  </Svg>
);
export const IconCamera = (p: P) => (
  <Svg {...p}>
    <path d="M4 8h3l1.6-2.4h6.8L17 8h3v11H4z" />
    <circle cx="12" cy="13.2" r="3.4" />
  </Svg>
);
export const IconSearch = (p: P) => (
  <Svg {...p}>
    <circle cx="10.5" cy="10.5" r="6" />
    <path d="m15 15 5 5" />
  </Svg>
);
export const IconSettings = (p: P) => (
  <Svg {...p}>
    <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
    <circle cx="16" cy="7" r="2" />
    <circle cx="10" cy="17" r="2" />
  </Svg>
);
export const IconClose = (p: P) => (
  <Svg {...p}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Svg>
);
export const IconCheck = (p: P) => (
  <Svg {...p}>
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </Svg>
);
export const IconPlus = (p: P) => (
  <Svg {...p}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);
export const IconMinus = (p: P) => (
  <Svg {...p}>
    <path d="M5 12h14" />
  </Svg>
);
export const IconFlip = (p: P) => (
  <Svg {...p}>
    <path d="M4 12a8 8 0 0 1 13.7-5.6L20 8.7M20 4v4.7h-4.7M20 12a8 8 0 0 1-13.7 5.6L4 15.3M4 20v-4.7h4.7" />
  </Svg>
);
export const IconTilt = (p: P) => (
  <Svg {...p}>
    <rect x="7" y="3" width="10" height="18" rx="2" transform="rotate(-14 12 12)" />
    <path d="M11 18h2" transform="rotate(-14 12 12)" />
  </Svg>
);
export const IconTorch = (p: P) => (
  <Svg {...p}>
    <path d="M8 3h8l-1.5 5h-5zM9.5 8h5v13h-5z" />
    <path d="M12 12v3" />
  </Svg>
);
export const IconTrash = (p: P) => (
  <Svg {...p}>
    <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
  </Svg>
);
export const IconBack = (p: P) => (
  <Svg {...p}>
    <path d="M15 5l-7 7 7 7" />
  </Svg>
);
