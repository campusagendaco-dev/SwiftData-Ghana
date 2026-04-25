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
    <rect width="40" height="40" rx="9" fill="#E2001A"/>
    {/* Airtel-style arc swoosh */}
    <path d="M10 28 Q20 8 30 28" stroke="white" strokeWidth="4" fill="none" strokeLinecap="round"/>
    <path d="M13 28 Q20 13 27 28" stroke="white" strokeWidth="3" fill="none" strokeLinecap="round" opacity="0.5"/>
  </svg>
);

export const ECGLogo = ({ size = 40 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect width="40" height="40" rx="9" fill="#003882"/>
    {/* Lightning bolt */}
    <path d="M22 8L14 22H20L18 32L26 18H20L22 8Z" fill="#FFCB00"/>
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
  <svg width={size} height={size} viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect width="40" height="40" rx="9" fill="#003087"/>
    {/* Satellite dish */}
    <path d="M10 28C10 20 14 14 20 12" stroke="white" strokeWidth="2.5" fill="none" strokeLinecap="round"/>
    <path d="M13 31C13 21 17.5 15 22 13" stroke="white" strokeWidth="2" fill="none" strokeLinecap="round" opacity="0.55"/>
    <path d="M16 32C16 22 20 17 24 15" stroke="white" strokeWidth="1.5" fill="none" strokeLinecap="round" opacity="0.3"/>
    {/* Dish circle */}
    <circle cx="26" cy="15" r="5" fill="none" stroke="#00A0DC" strokeWidth="2.5"/>
    <circle cx="26" cy="15" r="2" fill="#00A0DC"/>
  </svg>
);

export const GOTVLogo = ({ size = 40 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect width="40" height="40" rx="9" fill="#00873D"/>
    {/* Bold "G" */}
    <path d="M26 15.5C24.4 13.5 22.4 12.5 20 12.5C15.8 12.5 12.5 15.8 12.5 20C12.5 24.2 15.8 27.5 20 27.5C22.8 27.5 25.2 26 26.5 23.5H19.5V20H28C28 24.9 24.4 31 20 31C13.9 31 9 26.1 9 20C9 13.9 13.9 9 20 9C23.1 9 25.9 10.2 28 12.2L26 15.5Z" fill="white"/>
  </svg>
);

export const StarTimesLogo = ({ size = 40 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect width="40" height="40" rx="9" fill="#D0021B"/>
    {/* Star shape */}
    <polygon
      points="20,8 22.9,16.8 32,16.8 24.5,22.1 27.6,31 20,25.6 12.4,31 15.5,22.1 8,16.8 17.1,16.8"
      fill="white"
    />
  </svg>
);
