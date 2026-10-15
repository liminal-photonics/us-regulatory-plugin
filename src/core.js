import { ecfrStatus } from "./ecfr.js";
import { tsdrConfigured } from "./uspto.js";

export async function status() {
  let ecfr;
  try { ecfr = await ecfrStatus(); } catch (e) { ecfr = `unreachable: ${e.message}`; }
  return {
    ecfr,
    federalRegister: "no key needed",
    trademarkSearch: "no key needed (public USPTO Trademark Search endpoint)",
    trademarkStatus: tsdrConfigured() ? "configured (USPTO_TSDR_API_KEY)" : "missing USPTO_TSDR_API_KEY; trademark_status is disabled",
  };
}
