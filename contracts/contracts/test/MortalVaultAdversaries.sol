// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {MortalVault} from "../MortalVault.sol";

contract ReentrantOwner {
    enum Attack {
        None,
        WithdrawAgain,
        CreateDuringClose
    }

    MortalVault public immutable vault;
    address public immutable beneficiary;
    Attack public attack;
    bool public reentryAttempted;
    bool public reentrySucceeded;

    constructor(MortalVault vault_, address beneficiary_) {
        vault = vault_;
        beneficiary = beneficiary_;
    }

    function create(uint64 timeout, uint64 claimDelay) external payable {
        vault.createVault{value: msg.value}(beneficiary, timeout, claimDelay);
    }

    function withdrawWithReentry(uint256 amount) external {
        attack = Attack.WithdrawAgain;
        vault.withdraw(amount);
        attack = Attack.None;
    }

    function closeWithReentry() external {
        attack = Attack.CreateDuringClose;
        vault.closeVault();
        attack = Attack.None;
    }

    receive() external payable {
        reentryAttempted = true;

        if (attack == Attack.WithdrawAgain) {
            try vault.withdraw(1) {
                reentrySucceeded = true;
            } catch {}
        } else if (attack == Attack.CreateDuringClose) {
            try vault.createVault{value: 1}(beneficiary, 1 days, 1 days) {
                reentrySucceeded = true;
            } catch {}
        }
    }
}

contract RejectingOwner {
    MortalVault public immutable vault;

    constructor(MortalVault vault_) {
        vault = vault_;
    }

    function create(address beneficiary, uint64 timeout, uint64 claimDelay) external payable {
        vault.createVault{value: msg.value}(beneficiary, timeout, claimDelay);
    }

    function withdraw(uint256 amount) external {
        vault.withdraw(amount);
    }

    function close() external {
        vault.closeVault();
    }

    receive() external payable {
        revert("reject transfer");
    }
}

contract BeneficiaryActor {
    MortalVault public immutable vault;
    address public claimOwner;
    bool public rejectTransfers;
    bool public attemptReentry;
    bool public reentryAttempted;
    bool public reentrySucceeded;

    constructor(MortalVault vault_) {
        vault = vault_;
    }

    function configureReceiver(bool rejectTransfers_, bool attemptReentry_) external {
        rejectTransfers = rejectTransfers_;
        attemptReentry = attemptReentry_;
    }

    function request(address owner) external {
        claimOwner = owner;
        vault.requestClaim(owner);
    }

    function execute(address owner) external {
        claimOwner = owner;
        vault.executeClaim(owner);
    }

    function executeTo(address owner, address payable recipient) external {
        claimOwner = owner;
        vault.executeClaimTo(owner, recipient);
    }

    receive() external payable {
        if (rejectTransfers) revert("reject transfer");

        if (attemptReentry) {
            reentryAttempted = true;
            try vault.executeClaim(claimOwner) {
                reentrySucceeded = true;
            } catch {}
        }
    }
}

contract ForceEther {
    constructor() payable {}

    function force(address payable recipient) external {
        selfdestruct(recipient);
    }
}
