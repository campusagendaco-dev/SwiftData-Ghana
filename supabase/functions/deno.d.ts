// Deno runtime ambient type declarations for Supabase Edge Functions in IDE
declare const Deno: any;

declare module "https://*" {
  const content: any;
  export default content;
  export const serve: any;
  export const createClient: any;
  export const corsHeaders: any;
  export const normalizePhone: any;
  export const getSmsConfig: any;
  export const sendPaymentSms: any;
  export const sendSmsViaTxtConnect: any;
  export const sendBulkSmsViaTxtConnect: any;
  export const formatTemplate: any;
  export const verifyAdmin: any;
  export const log: any;
  export const fetchViaDb: any;
}

declare module "http://*" {
  const content: any;
  export default content;
}

declare module "npm:*" {
  const content: any;
  export default content;
  export const HttpsProxyAgent: any;
}
