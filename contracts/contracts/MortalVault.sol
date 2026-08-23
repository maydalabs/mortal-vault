// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title MortalVault
/// @notice Self-custodial native-asset vault with inactivity-based inheritance.
/// @dev Inactivity permits a delayed claim request; it never transfers funds by itself.
contract MortalVault is ReentrancyGuard {
    enum VaultStatus {
        None,
        Active,
        ClaimRequested,
        Claimed,
        Closed
    }

    struct Vault {
        address owner;
        address beneficiary;
        uint64 timeout;
        uint64 claimDelay;
        uint64 lastHeartbeat;
        uint64 claimRequestedAt;
        uint256 balance;
        VaultStatus status;
    }

    uint64 public constant MIN_TIMEOUT = 1 days;
    uint64 public constant MAX_TIMEOUT = 5 * 365 days;
    uint64 public constant MIN_CLAIM_DELAY = 1 days;
    uint64 public constant MAX_CLAIM_DELAY = 180 days;

    mapping(address owner => Vault vault) private vaults;

    error InvalidBeneficiary();
    error BeneficiaryIsOwner();
    error InvalidTimeout();
    error InvalidClaimDelay();
    error MustDeposit();
    error VaultAlreadyActive();
    error NoVault();
    error VaultNotMutable();
    error NoEthSent();
    error AmountMustBePositive();
    error InsufficientBalance();
    error NotBeneficiary();
    error OwnerStillActive();
    error EmptyVault();
    error ClaimNotRequested();
    error ClaimDelayActive();
    error InvalidRecipient();
    error TransferFailed();

    event VaultCreated(
        address indexed owner,
        address indexed beneficiary,
        uint64 timeout,
        uint64 claimDelay,
        uint256 amount
    );
    event Deposited(address indexed owner, uint256 amount, uint256 newBalance);
    event Heartbeat(address indexed owner, uint64 timestamp);
    event VaultUpdated(
        address indexed owner,
        address indexed beneficiary,
        uint64 timeout,
        uint64 claimDelay
    );
    event Withdrawn(address indexed owner, uint256 amount, uint256 remainingBalance);
    event ClaimRequested(
        address indexed owner,
        address indexed beneficiary,
        uint64 requestedAt,
        uint256 executableAt
    );
    event ClaimCancelled(address indexed owner, uint64 timestamp);
    event Claimed(
        address indexed owner,
        address indexed beneficiary,
        address indexed recipient,
        uint256 amount
    );
    event VaultClosed(address indexed owner, uint256 amount);

    /// @notice Create a vault with an initial native-asset deposit.
    function createVault(
        address beneficiary,
        uint64 timeout,
        uint64 claimDelay
    ) external payable nonReentrant {
        _validateConfiguration(msg.sender, beneficiary, timeout, claimDelay);

        VaultStatus currentStatus = vaults[msg.sender].status;
        if (currentStatus == VaultStatus.Active || currentStatus == VaultStatus.ClaimRequested) {
            revert VaultAlreadyActive();
        }
        if (msg.value == 0) revert MustDeposit();

        uint64 timestamp = uint64(block.timestamp);
        vaults[msg.sender] = Vault({
            owner: msg.sender,
            beneficiary: beneficiary,
            timeout: timeout,
            claimDelay: claimDelay,
            lastHeartbeat: timestamp,
            claimRequestedAt: 0,
            balance: msg.value,
            status: VaultStatus.Active
        });

        emit VaultCreated(msg.sender, beneficiary, timeout, claimDelay, msg.value);
        emit Heartbeat(msg.sender, timestamp);
    }

    /// @notice Add native assets. Depositing also proves owner activity.
    function deposit() external payable nonReentrant {
        Vault storage vault = _getMutableVault(msg.sender);
        if (msg.value == 0) revert NoEthSent();

        vault.balance += msg.value;
        _recordOwnerActivity(vault);

        emit Deposited(msg.sender, msg.value, vault.balance);
    }

    /// @notice Prove owner activity and cancel any pending beneficiary claim.
    function heartbeat() external nonReentrant {
        Vault storage vault = _getMutableVault(msg.sender);
        _recordOwnerActivity(vault);
    }

    /// @notice Replace beneficiary and timing configuration while proving activity.
    function updateVault(
        address beneficiary,
        uint64 timeout,
        uint64 claimDelay
    ) external nonReentrant {
        Vault storage vault = _getMutableVault(msg.sender);
        _validateConfiguration(msg.sender, beneficiary, timeout, claimDelay);

        vault.beneficiary = beneficiary;
        vault.timeout = timeout;
        vault.claimDelay = claimDelay;
        _recordOwnerActivity(vault);

        emit VaultUpdated(msg.sender, beneficiary, timeout, claimDelay);
    }

    /// @notice Withdraw native assets while proving owner activity.
    function withdraw(uint256 amount) external nonReentrant {
        Vault storage vault = _getMutableVault(msg.sender);
        if (amount == 0) revert AmountMustBePositive();
        if (amount > vault.balance) revert InsufficientBalance();

        vault.balance -= amount;
        _recordOwnerActivity(vault);

        (bool ok, ) = msg.sender.call{value: amount}("");
        if (!ok) revert TransferFailed();

        emit Withdrawn(msg.sender, amount, vault.balance);
    }

    /// @notice Revoke the plan and return all remaining funds to the owner.
    function closeVault() external nonReentrant {
        Vault storage vault = _getMutableVault(msg.sender);
        uint256 amount = vault.balance;

        vault.balance = 0;
        vault.claimRequestedAt = 0;
        vault.status = VaultStatus.Closed;

        if (amount > 0) {
            (bool ok, ) = msg.sender.call{value: amount}("");
            if (!ok) revert TransferFailed();
        }

        emit VaultClosed(msg.sender, amount);
    }

    /// @notice Start the challenge period after the owner exceeds the timeout.
    function requestClaim(address owner) external nonReentrant {
        Vault storage vault = vaults[owner];
        if (vault.status == VaultStatus.None) revert NoVault();
        if (vault.status != VaultStatus.Active) revert VaultNotMutable();
        if (msg.sender != vault.beneficiary) revert NotBeneficiary();
        if (!_isInactive(vault)) revert OwnerStillActive();
        if (vault.balance == 0) revert EmptyVault();

        uint64 requestedAt = uint64(block.timestamp);
        vault.claimRequestedAt = requestedAt;
        vault.status = VaultStatus.ClaimRequested;

        emit ClaimRequested(
            owner,
            msg.sender,
            requestedAt,
            uint256(requestedAt) + vault.claimDelay
        );
    }

    /// @notice Transfer the full balance after a beneficiary request survives the delay.
    function executeClaim(address owner) external nonReentrant {
        _executeClaim(owner, payable(msg.sender));
    }

    /// @notice Transfer a matured claim to a recipient selected by the beneficiary.
    /// @dev Preserves liveness when a smart-contract beneficiary cannot receive ETH.
    function executeClaimTo(address owner, address payable recipient) external nonReentrant {
        _executeClaim(owner, recipient);
    }

    function _executeClaim(address owner, address payable recipient) internal {
        Vault storage vault = vaults[owner];
        if (vault.status != VaultStatus.ClaimRequested) revert ClaimNotRequested();
        if (msg.sender != vault.beneficiary) revert NotBeneficiary();
        if (!_isClaimable(vault)) revert ClaimDelayActive();
        if (recipient == address(0)) revert InvalidRecipient();

        uint256 amount = vault.balance;
        vault.balance = 0;
        vault.claimRequestedAt = 0;
        vault.status = VaultStatus.Claimed;

        (bool ok, ) = recipient.call{value: amount}("");
        if (!ok) revert TransferFailed();

        emit Claimed(owner, msg.sender, recipient, amount);
    }

    /// @notice Return the current vault plus computed inactivity and claimability.
    function getVault(address owner)
        external
        view
        returns (
            address vaultOwner,
            address beneficiary,
            uint256 timeout,
            uint256 claimDelay,
            uint256 lastHeartbeat,
            uint256 claimRequestedAt,
            uint256 balance,
            VaultStatus status,
            bool inactive,
            bool claimable
        )
    {
        Vault storage vault = vaults[owner];
        return (
            vault.owner,
            vault.beneficiary,
            vault.timeout,
            vault.claimDelay,
            vault.lastHeartbeat,
            vault.claimRequestedAt,
            vault.balance,
            vault.status,
            _isInactive(vault),
            _isClaimable(vault)
        );
    }

    function isInactive(address owner) external view returns (bool) {
        return _isInactive(vaults[owner]);
    }

    function isClaimable(address owner) external view returns (bool) {
        return _isClaimable(vaults[owner]);
    }

    function _getMutableVault(address owner) internal view returns (Vault storage vault) {
        vault = vaults[owner];
        if (vault.status == VaultStatus.None) revert NoVault();
        if (vault.status != VaultStatus.Active && vault.status != VaultStatus.ClaimRequested) {
            revert VaultNotMutable();
        }
    }

    function _validateConfiguration(
        address owner,
        address beneficiary,
        uint64 timeout,
        uint64 claimDelay
    ) internal pure {
        if (beneficiary == address(0)) revert InvalidBeneficiary();
        if (beneficiary == owner) revert BeneficiaryIsOwner();
        if (timeout < MIN_TIMEOUT || timeout > MAX_TIMEOUT) revert InvalidTimeout();
        if (claimDelay < MIN_CLAIM_DELAY || claimDelay > MAX_CLAIM_DELAY) {
            revert InvalidClaimDelay();
        }
    }

    function _recordOwnerActivity(Vault storage vault) internal {
        uint64 timestamp = uint64(block.timestamp);

        if (vault.status == VaultStatus.ClaimRequested) {
            vault.status = VaultStatus.Active;
            vault.claimRequestedAt = 0;
            emit ClaimCancelled(vault.owner, timestamp);
        }

        vault.lastHeartbeat = timestamp;
        emit Heartbeat(vault.owner, timestamp);
    }

    function _isInactive(Vault storage vault) internal view returns (bool) {
        if (vault.status != VaultStatus.Active && vault.status != VaultStatus.ClaimRequested) {
            return false;
        }
        return block.timestamp > uint256(vault.lastHeartbeat) + vault.timeout;
    }

    function _isClaimable(Vault storage vault) internal view returns (bool) {
        return vault.status == VaultStatus.ClaimRequested
            && block.timestamp >= uint256(vault.claimRequestedAt) + vault.claimDelay;
    }
}
