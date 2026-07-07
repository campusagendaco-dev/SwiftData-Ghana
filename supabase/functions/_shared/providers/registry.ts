import { ProviderAdapter } from "./types.ts";
import { KorbaAdapter } from "./korba.ts";
import { StandardAdapter } from "./standard.ts";
import { NewAggregatorAdapter } from "./newaggregator.ts";

const adapters: Record<string, ProviderAdapter> = {
  korba: new KorbaAdapter(),
  newaggregator: new NewAggregatorAdapter(),
  // Standard and generic reseller platforms share the dynamic StandardAdapter
  standard: new StandardAdapter(),
  skdataplug: new StandardAdapter(),
  superbdatafy: new StandardAdapter(),
  datahub: new StandardAdapter(),
  datamart: new StandardAdapter(),
  spendless: new StandardAdapter(),
  xcel: new StandardAdapter(),
  qhowmenzconsult: new StandardAdapter(),
  bossu: new StandardAdapter(),
};

/**
 * Resolves the appropriate provider adapter based on handler type.
 */
export function getProviderAdapter(handlerType: string | null | undefined): ProviderAdapter {
  const type = (handlerType || "standard").toLowerCase().trim();
  const adapter = adapters[type] || adapters.standard;
  return adapter;
}
