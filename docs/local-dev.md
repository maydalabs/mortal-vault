# Mortal Vault – Local Development (v1)

## 1. Prerequisites

- Node.js + npm installed.
- MetaMask installed in your browser.
- Repo cloned to your machine, e.g. `C:\dev\mortal-vault`.

## 2. Contracts – install and test

From `contracts/`:

```bash
cd contracts
npm install
npx hardhat compile
npx hardhat test
