import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

const MortalVaultModule = buildModule("MortalVaultModule", (m) => {
  const mortalVault = m.contract("MortalVault");

  return { mortalVault };
});

export default MortalVaultModule;
