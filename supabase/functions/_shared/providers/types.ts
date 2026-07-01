export interface ProviderResponse {
  ok: boolean;
  reason?: string;
  id?: string;
  status?: string;
}

export interface PurchaseData {
  recipient: string;
  amount: number;
  reference: string;
  networkRaw: string;
  networkKey: string;
  package_size?: string;
  plan?: string;
  [key: string]: any;
}

export interface ProviderAdapter {
  purchase(
    supabaseAdmin: any,
    provider: any,
    data: PurchaseData
  ): Promise<ProviderResponse>;
  
  checkStatus(
    supabaseAdmin: any,
    provider: any,
    providerOrderId: string,
    reference: string
  ): Promise<ProviderResponse>;
  
  mapNetwork(rawNetwork: string): string;
}
