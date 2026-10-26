import React from "react";

// Iconos de trazo (20×20) para la navegación y las acciones
const P: Record<string, string> = {
  home: "M3 9.5L10 3l7 6.5V17H3V9.5zM8 17v-5h4v5",
  clock: "M10 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16zM10 5v5l3 2",
  "shield-check": "M10 2l7 3v5c0 4.7-2.8 7-7 9-4.2-2-7-4.3-7-9V5l7-3zM6.8 10l2.2 2.2 4.4-4.4",
  science: "M7 3h6M9 3v6l-5 7a2 2 0 0 0 1.7 2.5h8.6A2 2 0 0 0 16 16l-5-7V3M6.5 13h7",
  flow: "M3 4v12M4 5h11M4 8h7M4 11h13M4 14h5M16 5v3M12 12v4",
  lab: "M7 3h6M9 3v6l-5 7a2 2 0 0 0 1.7 2.5h8.6A2 2 0 0 0 16 16l-5-7V3M7 13h6",
  trade: "M5 4v12M5 7h-1.5v5H5M10 3v14M10 6H8.5v7H10M15 5v10M15 8h-1.5v4H15",
  market: "M3 15l4-5 3 3 4-6 3 4M3 17h14",
  journal: "M5 3h9a2 2 0 0 1 2 2v12H6a1 1 0 0 1-1-1V3zM5 14h11M8 7h5M8 10h4",
  stats: "M4 16V9M8 16V5M12 16v-6M16 16V7M3 16.5h14",
  strategies: "M10 3l7 4-7 4-7-4 7-4zM3 11l7 4 7-4M3 14.5l7 4 7-4",
  settings: "M4 6h8M15 6h1M4 10h2M9 10h7M4 14h6M13 14h3M12 4.5v3M6 8.5v3M10 12.5v3",
  info: "M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM10 9v5M10 6.2v.1",
  close: "M5 5l10 10M15 5L5 15",
  chevron: "M7 8l3 3 3-3",
  power: "M10 3v6M6 5.5a6 6 0 1 0 8 0",
  user: "M10 10a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM3.5 17a6.5 6.5 0 0 1 13 0",
  plus: "M10 4v12M4 10h12",
  edit: "M4 16l1-4 8-8 3 3-8 8-4 1zM11 6l3 3",
  trash: "M4 6h12M8 6V4h4v2M6 6l1 11h6l1-11",
  check: "M4 10l4 4 8-8",
  share: "M14 7a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM6 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM14 18a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM8.2 11.2l3.6 2.1M11.8 5.7L8.2 8.8",
  plug: "M7 3v4M13 3v4M5 7h10v3a5 5 0 0 1-10 0V7zM10 15v3",
  logout: "M8 4H4v12h4M12 6l4 4-4 4M16 10H8",
};

export function Icon({ name, size = 18, className }: { name: keyof typeof P | string; size?: number; className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={P[name] || ""} />
    </svg>
  );
}

/** Marca: un lingote visto de frente */
export function Logo({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <defs>
        <linearGradient id="lg-top" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#F6D27A" /><stop offset="1" stopColor="#D8A23C" /></linearGradient>
        <linearGradient id="lg-front" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#C8902C" /><stop offset="1" stopColor="#9A6B1C" /></linearGradient>
      </defs>
      <path d="M9 11h14l4 6H5z" fill="url(#lg-top)" />
      <path d="M5 17h22l-2 6H7z" fill="url(#lg-front)" />
      <path d="M11 13.5h10" stroke="#FFF3CF" strokeOpacity=".55" strokeWidth="1" strokeLinecap="round" />
    </svg>
  );
}
