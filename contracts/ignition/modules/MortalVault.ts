import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

const MortalVaultModule = buildModule("MortalVaultModule", (m) => {
  const maxVaultBalance = m.getParameter(
    "maxVaultBalance",
    1_000n * 10n ** 18n,
  );
  const mortalVault = m.contract("MortalVault", [maxVaultBalance]);

  return { mortalVault };
});

export default MortalVaultModule;
