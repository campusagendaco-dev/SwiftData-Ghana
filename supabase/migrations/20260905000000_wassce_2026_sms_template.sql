-- Migration: Add WASSCE 2026 Results & Checkers SMS Template
INSERT INTO public.sms_templates (key, label, body, is_active)
VALUES (
  'wassce_2026_results_in_stock',
  'WASSCE 2026 Results & Checkers In Stock',
  '🎓 WASSCE 2026 Results are OUT! WAEC Results Checker serials & PINs are now IN STOCK at wholesale rates. Buy & check instantly at https://swiftdatagh.shop or sell to students for quick profit! 📲 Support: 0540309637',
  true
)
ON CONFLICT (key) DO UPDATE
SET label = EXCLUDED.label,
    body = EXCLUDED.body,
    updated_at = now();
