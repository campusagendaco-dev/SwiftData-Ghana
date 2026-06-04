import React, { useRef, useState } from "react";
import { motion, useMotionValue, useSpring, useTransform } from "framer-motion";

interface CardTiltProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  className?: string;
  glowColor?: string; // Optional custom HSL glow color override (e.g. "48 96% 53%")
}

export function CardTilt({ children, className = "", glowColor = "var(--primary)", ...props }: CardTiltProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [hovering, setHovering] = useState(false);

  const x = useMotionValue(0);
  const y = useMotionValue(0);

  // Config spring animation settings for smooth return/tilt dynamics
  const springConfig = { damping: 25, stiffness: 200, mass: 0.5 };
  const rotateX = useSpring(useTransform(y, [-100, 100], [10, -10]), springConfig);
  const rotateY = useSpring(useTransform(x, [-100, 100], [-10, 10]), springConfig);

  // Shiny overlay reflection coordinates
  const shinyX = useTransform(x, [-100, 100], ["0%", "100%"]);
  const shinyY = useTransform(y, [-100, 100], ["0%", "100%"]);

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!el) return;

    const rect = el.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;
    const mouseX = e.clientX - rect.left - width / 2;
    const mouseY = e.clientY - rect.top - height / 2;

    x.set(mouseX);
    y.set(mouseY);
  };

  const handleMouseEnter = () => {
    setHovering(true);
  };

  const handleMouseLeave = () => {
    setHovering(false);
    x.set(0);
    y.set(0);
  };

  // Convert "var(--primary)" or HSL string into proper inline style value
  const resolvedGlowColor = glowColor.startsWith("var") ? `var(${glowColor.replace(/var\(|\)/g, "")})` : `hsl(${glowColor})`;

  return (
    <div
      ref={ref}
      onMouseMove={handleMouseMove}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      className={`relative ${className}`}
      style={{ perspective: "1000px" }}
      {...props}
    >
      <motion.div
        style={{
          rotateX: rotateX,
          rotateY: rotateY,
          transformStyle: "preserve-3d",
        }}
        className="w-full h-full rounded-[inherit] transition-shadow duration-300"
      >
        {children}

        {/* Glossy Reflection overlay */}
        {hovering && (
          <motion.div
            style={{
              background: `radial-gradient(circle 120px at ${shinyX} ${shinyY}, rgba(255, 255, 255, 0.12), transparent 80%)`,
            }}
            className="absolute inset-0 rounded-[inherit] pointer-events-none z-30 mix-blend-overlay"
          />
        )}

        {/* Accent hover glow shadow */}
        {hovering && (
          <div
            style={{
              boxShadow: `0 20px 40px -15px ${resolvedGlowColor}`,
            }}
            className="absolute inset-0 rounded-[inherit] pointer-events-none -z-10 transition-all duration-300"
          />
        )}
      </motion.div>
    </div>
  );
}
