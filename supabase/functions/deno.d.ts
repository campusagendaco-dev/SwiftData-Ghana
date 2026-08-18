// Deno runtime ambient type declarations for Supabase Edge Functions in IDE
declare const Deno: any;

declare module "https://*" {
  const content: any;
  export default content;
  export const serve: any;
  export const createClient: any;
  export const corsHeaders: any;
}
