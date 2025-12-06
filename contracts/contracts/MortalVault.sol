// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title MortalVault - simple dead-man-switch ETH vault
/// @notice Owner can deposit and withdraw while "alive".
///         If owner is inactive longer than `timeout`, beneficiary can claim everything.
contract MortalVault {
    struct Vault {
        address owner;
        address beneficiary;
        uint256 timeout;        // seconds of allowed inactivity
        uint256 lastHeartbeat;  // last time owner proved they're alive
        uint256 balance;        // ETH locked for this vault
        bool exists;
        bool claimed;           // true once beneficiary has claimed
    }

    mapping(address => Vault) private vaults;

    event VaultCreated(address indexed owner, address indexed beneficiary, uint256 timeout, uint256 amount);
    event Deposited(address indexed owner, uint256 amount);
    event Heartbeat(address indexed owner, uint256 timestamp);
    event Withdrawn(address indexed owner, uint256 amount);
    event Claimed(address indexed owner, address indexed beneficiary, uint256 amount);

    /// @notice Create a new vault for the caller and deposit initial ETH.
    /// @param _beneficiary Address that can claim funds after inactivity.
    /// @param _timeout Inactivity period in seconds before beneficiary can claim.
    function createVault(address _beneficiary, uint256 _timeout) external payable {
        require(_beneficiary != address(0), "Invalid beneficiary");
        require(_timeout > 0, "Timeout must be > 0");
        Vault storage v = vaults[msg.sender];
        // allow re-creating only if no vault yet or previous one fully claimed
        require(!v.exists || v.claimed, "Vault already exists");
        require(msg.value > 0, "Must deposit some ETH");

        vaults[msg.sender] = Vault({
            owner: msg.sender,
            beneficiary: _beneficiary,
            timeout: _timeout,
            lastHeartbeat: block.timestamp,
            balance: msg.value,
            exists: true,
            claimed: false
        });

        emit VaultCreated(msg.sender, _beneficiary, _timeout, msg.value);
    }

    /// @notice Deposit more ETH into your existing vault.
    function deposit() external payable {
        Vault storage v = vaults[msg.sender];
        require(v.exists, "No vault");
        require(!v.claimed, "Vault already claimed");
        require(msg.value > 0, "No ETH sent");
        require(!_isExpired(v), "Vault expired");

        v.balance += msg.value;
        // deposit counts as activity
        v.lastHeartbeat = block.timestamp;

        emit Deposited(msg.sender, msg.value);
    }

    /// @notice Refresh your heartbeat to prove you're still active.
    function heartbeat() external {
        Vault storage v = vaults[msg.sender];
        require(v.exists, "No vault");
        require(!v.claimed, "Vault already claimed");
        require(!_isExpired(v), "Vault expired");

        v.lastHeartbeat = block.timestamp;
        emit Heartbeat(msg.sender, block.timestamp);
    }

    /// @notice Withdraw some ETH while you are still considered alive.
    /// @param amount Amount of ETH (in wei) to withdraw.
    function withdraw(uint256 amount) external {
        Vault storage v = vaults[msg.sender];
        require(v.exists, "No vault");
        require(!v.claimed, "Vault already claimed");
        require(!_isExpired(v), "Vault expired");
        require(amount > 0, "Amount must be > 0");
        require(amount <= v.balance, "Insufficient vault balance");

        v.balance -= amount;

        (bool ok, ) = msg.sender.call{value: amount}("");
        require(ok, "Transfer failed");

        emit Withdrawn(msg.sender, amount);
    }

    /// @notice Claim all ETH from an expired vault as the beneficiary.
    /// @param ownerAddr The owner address whose vault you are claiming.
    function claim(address ownerAddr) external {
        Vault storage v = vaults[ownerAddr];
        require(v.exists, "No vault");
        require(!v.claimed, "Already claimed");
        require(msg.sender == v.beneficiary, "Not beneficiary");
        require(_isExpired(v), "Vault not expired");

        uint256 amount = v.balance;
        v.balance = 0;
        v.claimed = true;

        (bool ok, ) = msg.sender.call{value: amount}("");
        require(ok, "Transfer failed");

        emit Claimed(ownerAddr, msg.sender, amount);
    }

    /// @notice View vault details for an owner.
    function getVault(address ownerAddr)
        external
        view
        returns (
            address owner,
            address beneficiary,
            uint256 timeout,
            uint256 lastHeartbeat,
            uint256 balance,
            bool exists,
            bool claimed,
            bool expired
        )
    {
        Vault storage v = vaults[ownerAddr];
        return (
            v.owner,
            v.beneficiary,
            v.timeout,
            v.lastHeartbeat,
            v.balance,
            v.exists,
            v.claimed,
            v.exists && _isExpired(v)
        );
    }

    /// @notice Returns true if the owner's vault is expired (inactivity > timeout).
    function isExpired(address ownerAddr) external view returns (bool) {
        Vault storage v = vaults[ownerAddr];
        if (!v.exists || v.claimed) return false;
        return _isExpired(v);
    }

    function _isExpired(Vault storage v) internal view returns (bool) {
        return block.timestamp > v.lastHeartbeat + v.timeout;
    }
}
