// Inline SVG brand logos — no external assets needed

export const MTNLogo = ({ size = 40 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect width="40" height="40" rx="9" fill="#FFCB00"/>
    <text x="20" y="26.5" textAnchor="middle" fill="#000" fontSize="11.5" fontWeight="900"
      fontFamily="Arial Black, Arial, sans-serif" letterSpacing="0.5">MTN</text>
  </svg>
);

export const TelecelLogo = ({ size = 40 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect width="40" height="40" rx="9" fill="#E10A0A"/>
    {/* Vodafone-style speech-bubble / quotemark */}
    <circle cx="20" cy="20" r="10" fill="none" stroke="white" strokeWidth="3.5"/>
    <circle cx="20" cy="20" r="4" fill="white"/>
  </svg>
);

export const AirtelTigoLogo = ({ size = 40 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect width="40" height="40" rx="9" fill="#0055FF"/>
    {/* Airtel-style arc swoosh */}
    <path d="M10 28 Q20 8 30 28" stroke="white" strokeWidth="4" fill="none" strokeLinecap="round"/>
    <path d="M13 28 Q20 13 27 28" stroke="white" strokeWidth="3" fill="none" strokeLinecap="round" opacity="0.5"/>
  </svg>
);

export const ECGLogo = ({ size = 40 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
    {/* Outer Blue Ring */}
    <circle cx="50" cy="50" r="48" fill="#092d90" stroke="#061f65" strokeWidth="2"/>
    {/* Yellow Ring */}
    <circle cx="50" cy="50" r="40" fill="#fecb00" stroke="#092d90" strokeWidth="6"/>
    {/* Inner Blue Circle */}
    <circle cx="50" cy="50" r="28" fill="#0d3cb1"/>
    
    {/* Three Red Propeller/Arrows */}
    <g transform="translate(50, 50)">
      {/* Top Arrow */}
      <path d="M-8,-6 L0,-38 L8,-6 L14,-10 L0,12 L-14,-10 Z" fill="#e31e24" stroke="#ffeb00" strokeWidth="1.5" strokeLinejoin="round"/>
      {/* Right Arrow (rotated 120 deg) */}
      <g transform="rotate(120)">
        <path d="M-8,-6 L0,-38 L8,-6 L14,-10 L0,12 L-14,-10 Z" fill="#e31e24" stroke="#ffeb00" strokeWidth="1.5" strokeLinejoin="round"/>
      </g>
      {/* Left Arrow (rotated 240 deg) */}
      <g transform="rotate(240)">
        <path d="M-8,-6 L0,-38 L8,-6 L14,-10 L0,12 L-14,-10 Z" fill="#e31e24" stroke="#ffeb00" strokeWidth="1.5" strokeLinejoin="round"/>
      </g>
    </g>
  </svg>
);

export const NEDCOLogo = ({ size = 40 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect width="40" height="40" rx="9" fill="#007A3D"/>
    {/* Pylon / power tower */}
    <path d="M20 8L13 18H16L13 32H27L24 18H27L20 8Z" fill="white" opacity="0.9"/>
    <line x1="14" y1="18" x2="26" y2="18" stroke="white" strokeWidth="1.5"/>
    <line x1="13" y1="23" x2="27" y2="23" stroke="white" strokeWidth="1.5"/>
  </svg>
);

export const GhanaWaterLogo = ({ size = 40 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect width="40" height="40" rx="9" fill="#006DB8"/>
    {/* Water drop */}
    <path d="M20 8C20 8 11 19 11 24C11 28.4 15.1 32 20 32C24.9 32 29 28.4 29 24C29 19 20 8 20 8Z" fill="white"/>
    {/* Inner highlight */}
    <path d="M17 23C17 25 18.3 26.5 20 26.5" stroke="#006DB8" strokeWidth="1.5" strokeLinecap="round"/>
  </svg>
);

export const DSTVLogo = ({ size = 40 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect width="100" height="100" rx="22" fill="url(#dstvGradBg)"/>
    <text x="50" y="60" textAnchor="middle" fill="#FFFFFF" fontSize="28" fontFamily="Arial Black, Arial, sans-serif" fontWeight="900" letterSpacing="-1">DStv</text>
    <defs>
      <linearGradient id="dstvGradBg" x1="0" y1="0" x2="100" y2="100" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#0b246a"/>
        <stop offset="100%" stopColor="#0080ff"/>
      </linearGradient>
    </defs>
  </svg>
);

export const GOTVLogo = ({ size = 40 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect width="100" height="100" rx="22" fill="#FFFFFF" stroke="#EAEAEA" strokeWidth="2"/>
    <text x="50" y="48" textAnchor="middle" fontFamily="Arial Black, sans-serif" fontWeight="900" fontSize="30">
      <tspan fill="#E31E24">GO</tspan>
      <tspan fill="#008A3B">tv</tspan>
    </text>
    <text x="50" y="72" textAnchor="middle" fill="#222222" fontSize="9" fontFamily="Arial, sans-serif" fontWeight="bold" letterSpacing="0.2">Live it. Love it.</text>
  </svg>
);

export const StarTimesLogo = ({ size = 40 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect width="100" height="100" rx="22" fill="#F89C1E"/>
    <circle cx="50" cy="50" r="28" fill="#FFFFFF"/>
    <path d="M50 50 L50 25 A25 25 0 0 1 75 50 Z" fill="#F58220"/>
    <path d="M50 50 L75 50 A25 25 0 0 1 50 75 Z" fill="#00A0E9"/>
    <path d="M50 50 L50 75 A25 25 0 0 1 25 50 Z" fill="#E4007F"/>
    <path d="M50 50 L25 50 A25 25 0 0 1 50 25 Z" fill="#FFF100"/>
    <path d="M50 36 L53.5 45.5 L63.5 49 L53.5 52.5 L50 62 L46.5 52.5 L36.5 49 L46.5 45.5 Z" fill="#FFFFFF"/>
  </svg>
);

export const KweseTVLogo = ({ size = 40 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect width="100" height="100" rx="22" fill="#F5F5F7" stroke="#E5E5E7" strokeWidth="2"/>
    <text x="50" y="46" textAnchor="middle" fill="#4B2C82" fontSize="20" fontFamily="Arial Black, Impact, sans-serif" fontWeight="900">KWESÉ</text>
    <text x="50" y="74" textAnchor="middle" fill="#D80073" fontSize="24" fontFamily="Arial Black, sans-serif" fontWeight="900">TV</text>
  </svg>
);

export const GBCTVLogo = ({ size = 40 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="50" cy="50" r="48" fill="#5E35B1" stroke="#4527A0" strokeWidth="2"/>
    <rect x="25" y="24" width="50" height="24" rx="8" fill="#FFFFFF"/>
    <text x="50" y="41" textAnchor="middle" fill="#5E35B1" fontSize="14" fontFamily="Arial Black, sans-serif" fontWeight="900">GBC</text>
    <text x="50" y="80" textAnchor="middle" fill="#FFFFFF" fontSize="30" fontFamily="Arial, Helvetica, sans-serif" fontWeight="900" letterSpacing="1">TV</text>
  </svg>
);

export const WAECLogo = ({ size = 40, className = "" }: { size?: number; className?: string }) => (
  <img
    src="/assets/waec_logo.png"
    alt="WAEC Official Logo"
    width={size}
    height={size}
    className={`object-contain ${className}`}
    style={{ width: size, height: size }}
  />
);

export const BECELogo = ({ size = 40, className = "" }: { size?: number; className?: string }) => (
  <img
    src="/assets/waec_logo.png"
    alt="BECE / WAEC Logo"
    width={size}
    height={size}
    className={`object-contain ${className}`}
    style={{ width: size, height: size }}
  />
);
