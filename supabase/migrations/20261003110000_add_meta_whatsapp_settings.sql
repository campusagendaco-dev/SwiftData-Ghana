-- Add Meta Official WhatsApp Cloud API configuration columns to system_settings
ALTER TABLE public.system_settings
  ADD COLUMN IF NOT EXISTS meta_whatsapp_access_token     text DEFAULT '' NOT NULL,
  ADD COLUMN IF NOT EXISTS meta_whatsapp_phone_number_id text DEFAULT '' NOT NULL;

-- Update with provided default Meta Access Token
UPDATE public.system_settings
SET 
  meta_whatsapp_access_token = 'EAAUiG1CZBGlIBSgZCxTy0PYwDGJwZBOUrN2l2gZCMWkndV3DpNAAMJ0emlP8X9toY8YDCiVeHtgn4YEr13Fxu1w4Yn1qFDCP68Sj4wNgAZB6TWqu2mCZBIdPPSW8JX3Jy4oLfKvFl579qerRfUcDZC1aOjlhgZBuqbqHW7fcftnz8Kofuox3eUKNtm0VkzfsXytzPkvMVISA1V9t021MJfc4SvSM9dbFVuhX0b8qZCAIOSpgU70Je8jDw3ri91Gs7BrVuG1ZAXpZBGNpDIglp5C5IdLnczCPAZDZD'
WHERE id = 1;
