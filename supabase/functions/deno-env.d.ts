declare const Deno: {
  env: {
    get(key: string): string | undefined;
    set(key: string, value: string): void;
    toObject(): Record<string, string>;
  };
  serve?: (handler: (req: Request) => Response | Promise<Response>) => void;
  [key: string]: any;
};

interface RequestInit {
  client?: any;
}

declare module "https://deno.land/std@0.168.0/http/server.ts" {
  export function serve(
    handler: (req: Request) => Response | Promise<Response>,
    options?: any
  ): Promise<void>;
}

declare module "https://deno.land/*" {
  const content: any;
  export default content;
  export const serve: any;
  export const createClient: any;
  export const crypto: any;
  export const encode: any;
  export const decode: any;
}

declare module "https://esm.sh/@supabase/supabase-js@2" {
  export function createClient(supabaseUrl: string, supabaseKey: string, options?: any): any;
  export type SupabaseClient = any;
}

declare module "https://esm.sh/@supabase/supabase-js@2.39.7" {
  export function createClient(supabaseUrl: string, supabaseKey: string, options?: any): any;
  export type SupabaseClient = any;
}

declare module "https://esm.sh/*" {
  const content: any;
  export default content;
  export function createClient(...args: any[]): any;
  export const WebPushError: any;
  export const sendNotification: any;
  export const setVapidDetails: any;
}

declare module "npm:*" {
  const content: any;
  export default content;
  export const HttpsProxyAgent: any;
  export const createClient: any;
}

declare module "node:*" {
  const content: any;
  export default content;
  export const Buffer: any;
  export const createHmac: any;
  export const timingSafeEqual: any;
  export const request: any;
}
