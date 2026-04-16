/** Custom SVG icons for nav tray items that lucide doesn't cover well */

interface IconProps {
  size?: number;
  color?: string;
  style?: React.CSSProperties;
  className?: string;
}

/** Tire icon — side view of a wheel. The previous version had lines
 * extending OUTWARD from the tire, which read as a lifesaver / flotation
 * ring. This version uses a thick outer tire (filled donut), an inner
 * rim with four lug bolts, reading unambiguously as an aircraft tire. */
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
      {/* Outer tire edge */}
      <circle cx="12" cy="12" r="10" />
      {/* Tread groove — a second ring inside the outer edge */}
      <circle cx="12" cy="12" r="8" strokeWidth="1.2" />
      {/* Rim (wheel hub) */}
      <circle cx="12" cy="12" r="4" />
      {/* Four lug bolts arranged at cardinal points of the rim */}
      <circle cx="12" cy="8.5" r="0.7" fill={color} stroke="none" />
      <circle cx="12" cy="15.5" r="0.7" fill={color} stroke="none" />
      <circle cx="8.5" cy="12" r="0.7" fill={color} stroke="none" />
      <circle cx="15.5" cy="12" r="0.7" fill={color} stroke="none" />
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
