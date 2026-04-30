declare const Deno: any;
const PAYSTACK_SECRET_KEY = Deno.env.get("PAYSTACK_SECRET_KEY")!;
const orderId = "cef38ad8-e1d6-4b75-8297-ca96c4e23f82";

async function verify() {
  console.log(`Verifying order ${orderId}...`);
  const res = await fetch(`https://api.paystack.co/transaction/verify/${orderId}`, {
    headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}` },
  });
  const json = await res.json();
  console.log(JSON.stringify(json, null, 2));
}

verify();
