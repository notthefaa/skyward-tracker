/** Custom SVG icons for nav tray items that lucide doesn't cover well */

interface IconProps {
  size?: number;
  color?: string;
  style?: React.CSSProperties;
  className?: string;
}

/** Tire icon — circle with tread pattern */
export function TireIcon({ size = 20, style, className }: IconProps) {
  const color = style?.color || 'currentColor';
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={style}
    >
      {/* Outer tire */}
      <circle cx="12" cy="12" r="10" />
      {/* Inner rim */}
      <circle cx="12" cy="12" r="5" />
      {/* Tread lines connecting rim to tire */}
      <line x1="12" y1="2" x2="12" y2="7" />
      <line x1="12" y1="17" x2="12" y2="22" />
      <line x1="2" y1="12" x2="7" y2="12" />
      <line x1="17" y1="12" x2="22" y2="12" />
      {/* Diagonal treads */}
      <line x1="5.05" y1="5.05" x2="8.46" y2="8.46" />
      <line x1="15.54" y1="15.54" x2="18.95" y2="18.95" />
    </svg>
  );
}

/** Howard icon — robot head with aviator goggles */
export function HowardIcon({ size = 20, style, className }: IconProps) {
  const color = style?.color || 'currentColor';
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={style}
    >
      {/* Robot head */}
      <rect x="4" y="6" width="16" height="14" rx="3" />
      {/* Antenna */}
      <line x1="12" y1="2" x2="12" y2="6" />
      <circle cx="12" cy="2" r="1" fill={color} />
      {/* Goggle strap */}
      <line x1="2" y1="12" x2="4" y2="12" />
      <line x1="20" y1="12" x2="22" y2="12" />
      {/* Left goggle lens */}
      <rect x="6" y="10" width="4" height="3.5" rx="1.5" />
      {/* Right goggle lens */}
      <rect x="14" y="10" width="4" height="3.5" rx="1.5" />
      {/* Goggle bridge */}
      <line x1="10" y1="11.75" x2="14" y2="11.75" />
      {/* Mouth */}
      <line x1="9" y1="17" x2="15" y2="17" />
    </svg>
  );
}
