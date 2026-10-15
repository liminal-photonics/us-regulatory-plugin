import { ecfrStatus } from "./ecfr.js";

export async function status() {
  let ecfr;
  try { ecfr = await ecfrStatus(); } catch (e) { ecfr = `unreachable: ${e.message}`; }
  return {
    ecfr,
    federalRegister: "no key needed",
    standards: "IBR lists from eCFR; links to IEC, ISO, UL, ANSI, ASTM, IEEE, NFPA, CIE, IES, NEMA (no standard text)",
    fccGrantees: "no key needed (FCC Open Data grantee registry, frozen since March 2021; no FCC ID grant lookup)",
  };
}
