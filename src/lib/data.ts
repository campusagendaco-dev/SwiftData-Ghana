export const basePackages: Record<string, { size: string; price: number; validity: string; popular?: boolean }[]> = {
  MTN: [
    { size: "1GB", price: 4.00, validity: "Non-expiry" },
    { size: "2GB", price: 8.9, validity: "Non-expiry" },
    { size: "3GB", price: 13.1, validity: "Non-expiry" },
    { size: "4GB", price: 17.3, validity: "Non-expiry" },
    { size: "5GB", price: 21.2, validity: "Non-expiry", popular: true },
    { size: "6GB", price: 25.7, validity: "Non-expiry" },
    { size: "7GB", price: 29.6, validity: "Non-expiry" },
    { size: "8GB", price: 33.2, validity: "Non-expiry" },
    { size: "10GB", price: 42.5, validity: "Non-expiry" },
    { size: "15GB", price: 62.0, validity: "Non-expiry" },
    { size: "20GB", price: 80.2, validity: "Non-expiry" },
    { size: "25GB", price: 100.8, validity: "Non-expiry" },
    { size: "30GB", price: 124.0, validity: "Non-expiry" },
    { size: "40GB", price: 159.0, validity: "Non-expiry" },
    { size: "50GB", price: 199.3, validity: "Non-expiry" },
    { size: "100GB", price: 385.0, validity: "Non-expiry" },
  ],
  "MTN Mash Up": [
    { size: "511MB + 176 Mins", price: 14.00, validity: "MTN Mash Up", popular: true },
    { size: "1GB + 353 Mins", price: 24.77, validity: "MTN Mash Up" },
    { size: "2GB + 397 Mins", price: 35.54, validity: "MTN Mash Up" },
    { size: "3.5GB + 88 Mins", price: 40.93, validity: "MTN Mash Up" },
    { size: "4GB + 176 Mins", price: 46.31, validity: "MTN Mash Up", popular: true },
    { size: "3.5GB + 529 Mins", price: 57.08, validity: "MTN Mash Up", popular: true },
    { size: "5.5GB + 264 Mins", price: 62.47, validity: "MTN Mash Up" },
    { size: "6GB + 353 Mins", price: 67.85, validity: "MTN Mash Up" },
    { size: "7GB + 441 Mins", price: 84.01, validity: "MTN Mash Up" },
    { size: "6.5GB + 705 Mins", price: 89.39, validity: "MTN Mash Up" },
    { size: "8GB + 529 Mins", price: 94.78, validity: "MTN Mash Up" },
    { size: "8GB + 881 Mins", price: 110.93, validity: "MTN Mash Up" },
  ],
  Telecel: [
    { size: "5GB", price: 23.0, validity: "Non-expiry" },
    { size: "10GB", price: 41.8, validity: "Non-expiry", popular: true },
    { size: "12GB", price: 49.0, validity: "Non-expiry" },
    { size: "15GB", price: 58.99, validity: "Non-expiry" },
    { size: "18GB", price: 71.8, validity: "Non-expiry" },
    { size: "20GB", price: 78.5, validity: "Non-expiry" },
    { size: "22GB", price: 82.5, validity: "Non-expiry" },
    { size: "25GB", price: 102.0, validity: "Non-expiry" },
    { size: "30GB", price: 125.5, validity: "Non-expiry" },
    { size: "40GB", price: 166.0, validity: "Non-expiry" },
    { size: "50GB", price: 190.0, validity: "Non-expiry" },
  ],
  AirtelTigo: [
    { size: "1GB", price: 4.3, validity: "Non-expiry" },
    { size: "2GB", price: 8.2, validity: "Non-expiry" },
    { size: "3GB", price: 12.0, validity: "Non-expiry" },
    { size: "4GB", price: 15.8, validity: "Non-expiry" },
    { size: "5GB", price: 19.85, validity: "Non-expiry", popular: true },
    { size: "6GB", price: 23.49, validity: "Non-expiry" },
    { size: "7GB", price: 27.0, validity: "Non-expiry" },
    { size: "8GB", price: 30.59, validity: "Non-expiry" },
    { size: "9GB", price: 34.2, validity: "Non-expiry" },
  ],
};

// 12% markup for public/main website prices
export const PUBLIC_MARKUP = 1.12;

export function getPublicPrice(basePrice: number): number {
  return parseFloat((basePrice * PUBLIC_MARKUP).toFixed(2));
}

export const networks = [
  { name: "MTN", color: "#FFCC00" },
  { name: "MTN Mash Up", color: "#FFB300" },
  { name: "Telecel", color: "#E60000" },
  { name: "AirtelTigo", color: "#2196F3" },
];

export function generateSlug(storeName: string): string {
  return storeName
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}
