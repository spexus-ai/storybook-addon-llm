import React from 'react';

interface InspectIconProps {
  size?: number;
}

/** Chrome DevTools-style "inspect element" icon: corner brackets + pointer arrow. */
export const InspectIcon: React.FC<InspectIconProps> = ({ size = 16 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M6.5 3H3v3.5" />
    <path d="M17.5 3H21v3.5" />
    <path d="M17.5 21H21v-3.5" />
    <path d="M6.5 21H3v-3.5" />
    <path
      d="M3.688 3.037a.497.497 0 0 0-.651.651l6.5 15.999a.501.501 0 0 0 .947-.062l1.569-6.083a2 2 0 0 1 1.448-1.479l6.124-1.579a.5.5 0 0 0 .063-.947z"
      fill="currentColor"
      stroke="none"
    />
  </svg>
);
