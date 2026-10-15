import { ecfrStatus } from "./ecfr.js";

export async function status() {
  let ecfr;
  try { ecfr = await ecfrStatus(); } catch (e) { ecfr = `unreachable: ${e.message}`; }
  return {
    ecfr,
    federalRegister: "no key needed",
    fccGrantees: "no key needed (FCC Open Data grantee registry, frozen since March 2021; no FCC ID grant lookup)",
  };
}
