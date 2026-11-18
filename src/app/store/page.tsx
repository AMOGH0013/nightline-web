import { readPremiumLuxurySeats, readProducts } from "@/lib/content";
import { readSettings } from "@/lib/passengers";
import { PremiumSeatSelector } from "@/components/premium-seat-selector";

export default async function StorePage() {
  const [products, settings, premiumSeats] = await Promise.all([
    readProducts().catch(() => null),
    readSettings().catch(() => null),
    readPremiumLuxurySeats().catch(() => null),
  ]);
  return (
    <div>
      <p className="kicker">Catalogue</p>
      <h1 className="display mt-2 text-5xl">Upgrades</h1>
      <p className="mt-3 max-w-2xl text-muted">
        Payments are {settings?.paymentsEnabled ? "configured but checkout remains unavailable" : "disabled"}. Nothing on this page can take money.
      </p>
      {premiumSeats ? <div className="mt-6"><PremiumSeatSelector seats={premiumSeats} /></div> : <p className="mt-6 text-danger">Luxury seat inventory is unavailable. Apply the passenger identity migration.</p>}
      <section className="panel mt-4 p-6">
        <p className="kicker">Other accommodation</p>
        <h2 className="display mt-2 text-2xl">Silver and Bronze upgrades</h2>
        <p className="mt-2 text-sm text-muted">Prices and capacities have not been approved, so these upgrades are not available. They will not change a passenger’s permanent number.</p>
      </section>
      <div className="mt-6 grid gap-4 md:grid-cols-2">
        {(products ?? []).filter((product) => !["standard", "luxury"].includes(product.key)).map((product) => {
          const comingSoon = product.key !== "standard" && (!product.enabled || !settings?.paymentsEnabled || product.quantity === null);
          return (
            <article key={product.key} className="panel p-6">
              <p className="kicker">{comingSoon ? "Coming soon" : "Available"}</p>
              <h2 className="display mt-2 text-3xl">{product.label}</h2>
              <p className="mt-3 text-2xl">{product.price_inr === 0 ? "Free" : `₹${product.price_inr}`}</p>
              <p className="mt-3 text-sm text-muted">{product.note}</p>
              <p className="mt-2 text-xs mono text-olive">
                Quantity: {product.quantity === null ? "not set" : product.quantity}
                {product.special_role ? ` · role ${product.special_role}` : ""}
              </p>
              <button className="btn mt-5" type="button" disabled>
                {product.key === "standard" ? "Issued at boarding" : "Payments disabled"}
              </button>
            </article>
          );
        })}
      </div>
      {!products && <p className="mt-6 text-danger">The catalogue could not be loaded from the database.</p>}
    </div>
  );
}
