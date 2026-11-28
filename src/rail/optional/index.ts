// R48: compile-time release boundary. No user, save or remote flag can enable these services.
export const OPTIONAL_SERVICES=Object.freeze({
 advertising:false,rewardedAds:false,billing:false,realMoneyPurchases:false,onlineAccounts:false,
 onlineAlliances:false,liveRankings:false,analytics:false,trackingConsent:false,
} as const);
export const OPTIONAL_SERVICE_REASON='Not enabled in the offline railway scope.';
export type OptionalService=keyof typeof OPTIONAL_SERVICES;
export function optionalServiceEnabled(service:unknown):false{
 if(typeof service!=='string'||!Object.hasOwn(OPTIONAL_SERVICES,service))throw Error('Unknown optional service');
 return false;
}
// Deliberately no SDK, callback handler, consent collection, reward or payment API.
