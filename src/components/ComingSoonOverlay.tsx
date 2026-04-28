import React from 'react';
import { Sparkles, Clock, ArrowLeft, Rocket } from 'lucide-react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';

interface ComingSoonOverlayProps {
  title?: string;
  description?: string;
  showHomeButton?: boolean;
}

const ComingSoonOverlay: React.FC<ComingSoonOverlayProps> = ({ 
  title = "Airtime Top-up is Coming Soon!", 
  description = "We're currently fine-tuning our airtime engine to bring you the fastest and most reliable top-up experience in Ghana. Stay tuned!",
  showHomeButton = true
}) => {
  return (
    <div className="absolute inset-0 z-[60] flex items-center justify-center p-4">
      {/* Frosted Glass Background */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-md" />
      
      {/* Content Card */}
      <motion.div 
        initial={{ opacity: 0, scale: 0.9, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.5, ease: "easeOut" }}
        className="relative bg-zinc-900/90 border border-amber-500/30 p-8 md:p-12 rounded-[2.5rem] shadow-2xl max-w-lg w-full text-center overflow-hidden"
      >
        {/* Animated Background Glow */}
        <div className="absolute -top-24 -left-24 w-48 h-48 bg-amber-500/20 rounded-full blur-[80px] animate-pulse" />
        <div className="absolute -bottom-24 -right-24 w-48 h-48 bg-amber-600/20 rounded-full blur-[80px] animate-pulse" />

        {/* Icon */}
        <div className="flex justify-center mb-6">
          <div className="w-20 h-20 bg-amber-500/10 rounded-3xl border border-amber-500/20 flex items-center justify-center relative">
            <Clock className="w-10 h-10 text-amber-500 animate-pulse" />
            <div className="absolute -top-1 -right-1">
              <Sparkles className="w-6 h-6 text-amber-400 animate-bounce" />
            </div>
          </div>
        </div>

        {/* Text */}
        <h2 className="text-3xl md:text-4xl font-black text-white mb-4 tracking-tight leading-tight">
          {title}
        </h2>
        <p className="text-zinc-400 text-sm md:text-base leading-relaxed mb-8">
          {description}
        </p>

        {/* Progress Badge */}
        <div className="inline-flex items-center gap-2 px-4 py-2 bg-amber-500/10 border border-amber-500/20 rounded-full mb-8">
          <Rocket className="w-4 h-4 text-amber-500" />
          <span className="text-[10px] font-black uppercase tracking-widest text-amber-500">System Optimization in Progress</span>
        </div>

        {/* Actions */}
        {showHomeButton && (
          <Link 
            to="/" 
            className="flex items-center justify-center gap-2 w-full py-4 bg-amber-500 hover:bg-amber-400 text-black font-black rounded-2xl transition-all hover:scale-[1.02] active:scale-[0.98] shadow-lg shadow-amber-500/20"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Home
          </Link>
        )}
        
        <p className="mt-6 text-[10px] text-zinc-500 font-bold uppercase tracking-widest">
          Coming to SwiftData GH soon
        </p>
      </motion.div>
    </div>
  );
};

export default ComingSoonOverlay;
