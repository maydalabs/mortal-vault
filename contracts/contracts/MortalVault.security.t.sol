// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {MortalVault} from "./MortalVault.sol";
import {
    BeneficiaryActor,
    ForceEther,
    ReentrantOwner,
    RejectingOwner
} from "./test/MortalVaultAdversaries.sol";

contract MortalVaultSecurityTest is Test {
    uint64 private constant MIN_TIMEOUT = 1 days;
    uint64 private constant MAX_TIMEOUT = 5 * 365 days;
    uint64 private constant MIN_CLAIM_DELAY = 1 days;
    uint64 private constant MAX_CLAIM_DELAY = 180 days;

    MortalVault private vault;
    address private owner;
    address private beneficiary;
    address private recipient;

    function setUp() public {
        vault = new MortalVault();
        owner = makeAddr("owner");
        beneficiary = makeAddr("beneficiary");
        recipient = makeAddr("recipient");
        vm.deal(owner, 1_000 ether);
    }

    function test_ReentrantOwnerCannotWithdrawTwice() public {
        ReentrantOwner attacker = new ReentrantOwner(vault, beneficiary);
        attacker.create{value: 2 ether}(MIN_TIMEOUT, MIN_CLAIM_DELAY);

        attacker.withdrawWithReentry(1 ether);

        (, , , , , , uint256 balance, MortalVault.VaultStatus status, , ) = vault.getVault(
            address(attacker)
        );
        assertTrue(attacker.reentryAttempted());
        assertFalse(attacker.reentrySucceeded());
        assertEq(balance, 1 ether);
        assertEq(uint256(status), uint256(MortalVault.VaultStatus.Active));
    }

    function test_ReentrantOwnerCannotCreateDuringClose() public {
        ReentrantOwner attacker = new ReentrantOwner(vault, beneficiary);
        attacker.create{value: 1 ether}(MIN_TIMEOUT, MIN_CLAIM_DELAY);

        attacker.closeWithReentry();

        (, , , , , uint256 requestedAt, uint256 balance, MortalVault.VaultStatus status, , ) =
            vault.getVault(address(attacker));
        assertTrue(attacker.reentryAttempted());
        assertFalse(attacker.reentrySucceeded());
        assertEq(requestedAt, 0);
        assertEq(balance, 0);
        assertEq(uint256(status), uint256(MortalVault.VaultStatus.Closed));
    }

    function test_ReentrantBeneficiaryCannotClaimTwice() public {
        BeneficiaryActor actor = new BeneficiaryActor(vault);
        actor.configureReceiver(false, true);
        _createVault(address(actor), 1 ether, MIN_TIMEOUT, MIN_CLAIM_DELAY);
        _requestClaim(actor, MIN_TIMEOUT);
        vm.warp(block.timestamp + MIN_CLAIM_DELAY);

        actor.execute(owner);

        (, , , , , uint256 requestedAt, uint256 balance, MortalVault.VaultStatus status, , ) =
            vault.getVault(owner);
        assertTrue(actor.reentryAttempted());
        assertFalse(actor.reentrySucceeded());
        assertEq(address(actor).balance, 1 ether);
        assertEq(requestedAt, 0);
        assertEq(balance, 0);
        assertEq(uint256(status), uint256(MortalVault.VaultStatus.Claimed));
    }

    function test_FailedOwnerTransfersRollBackState() public {
        RejectingOwner rejectingOwner = new RejectingOwner(vault);
        rejectingOwner.create{value: 1 ether}(beneficiary, MIN_TIMEOUT, MIN_CLAIM_DELAY);

        vm.expectRevert(MortalVault.TransferFailed.selector);
        rejectingOwner.withdraw(0.25 ether);
        _assertActiveBalance(address(rejectingOwner), 1 ether);

        vm.expectRevert(MortalVault.TransferFailed.selector);
        rejectingOwner.close();
        _assertActiveBalance(address(rejectingOwner), 1 ether);
    }

    function test_RejectingBeneficiaryCanSelectSafeRecipient() public {
        BeneficiaryActor actor = new BeneficiaryActor(vault);
        actor.configureReceiver(true, false);
        _createVault(address(actor), 1 ether, MIN_TIMEOUT, MIN_CLAIM_DELAY);
        _requestClaim(actor, MIN_TIMEOUT);
        vm.warp(block.timestamp + MIN_CLAIM_DELAY);

        vm.expectRevert(MortalVault.TransferFailed.selector);
        actor.execute(owner);

        (, , , , , uint256 requestedAt, uint256 balance, MortalVault.VaultStatus status, , ) =
            vault.getVault(owner);
        assertGt(requestedAt, 0);
        assertEq(balance, 1 ether);
        assertEq(uint256(status), uint256(MortalVault.VaultStatus.ClaimRequested));

        vm.expectRevert(MortalVault.InvalidRecipient.selector);
        actor.executeTo(owner, payable(address(0)));

        uint256 recipientBefore = recipient.balance;
        actor.executeTo(owner, payable(recipient));
        assertEq(recipient.balance, recipientBefore + 1 ether);

        (, , , , , requestedAt, balance, status, , ) = vault.getVault(owner);
        assertEq(requestedAt, 0);
        assertEq(balance, 0);
        assertEq(uint256(status), uint256(MortalVault.VaultStatus.Claimed));
    }

    function test_OnlyBeneficiaryCanSelectClaimRecipient() public {
        _createVault(beneficiary, 1 ether, MIN_TIMEOUT, MIN_CLAIM_DELAY);
        vm.warp(block.timestamp + MIN_TIMEOUT + 1);
        vm.prank(beneficiary);
        vault.requestClaim(owner);
        vm.warp(block.timestamp + MIN_CLAIM_DELAY);

        vm.expectRevert(MortalVault.NotBeneficiary.selector);
        vm.prank(recipient);
        vault.executeClaimTo(owner, payable(recipient));
    }

    function test_ClaimRequestGuardBranches() public {
        vm.expectRevert(MortalVault.NoVault.selector);
        vm.prank(beneficiary);
        vault.requestClaim(owner);

        _createVault(beneficiary, 1 ether, MIN_TIMEOUT, MIN_CLAIM_DELAY);
        vm.expectRevert(MortalVault.NoEthSent.selector);
        vm.prank(owner);
        vault.deposit();

        vm.warp(block.timestamp + MIN_TIMEOUT + 1);
        vm.prank(beneficiary);
        vault.requestClaim(owner);

        vm.expectRevert(MortalVault.VaultNotMutable.selector);
        vm.prank(beneficiary);
        vault.requestClaim(owner);
    }

    function test_EmptyActiveVaultCannotBeClaimed() public {
        _createVault(beneficiary, 1 ether, MIN_TIMEOUT, MIN_CLAIM_DELAY);
        vm.prank(owner);
        vault.withdraw(1 ether);
        vm.warp(block.timestamp + MIN_TIMEOUT + 1);

        vm.expectRevert(MortalVault.EmptyVault.selector);
        vm.prank(beneficiary);
        vault.requestClaim(owner);
    }

    function test_ViewHelpersFollowLifecycleBoundaries() public {
        _createVault(beneficiary, 1 ether, MIN_TIMEOUT, MIN_CLAIM_DELAY);
        assertFalse(vault.isInactive(owner));
        assertFalse(vault.isClaimable(owner));

        vm.warp(block.timestamp + MIN_TIMEOUT + 1);
        assertTrue(vault.isInactive(owner));
        vm.prank(beneficiary);
        vault.requestClaim(owner);
        assertFalse(vault.isClaimable(owner));

        vm.warp(block.timestamp + MIN_CLAIM_DELAY);
        assertTrue(vault.isClaimable(owner));
    }

    function test_ForcedEtherDoesNotInflateTrackedVaultBalance() public {
        _createVault(beneficiary, 1 ether, MIN_TIMEOUT, MIN_CLAIM_DELAY);
        ForceEther forceEther = new ForceEther{value: 2 ether}();

        forceEther.force(payable(address(vault)));

        (, , , , , , uint256 trackedBalance, , , ) = vault.getVault(owner);
        assertEq(trackedBalance, 1 ether);
        assertEq(address(vault).balance, 3 ether);

        vm.prank(owner);
        vault.withdraw(1 ether);
        assertEq(address(vault).balance, 2 ether);
    }

    function testFuzz_DepositWithdrawPreservesAccounting(
        uint96 initialSeed,
        uint96 topUpSeed,
        uint96 withdrawalSeed
    ) public {
        uint256 initial = bound(uint256(initialSeed), 1, 100 ether);
        uint256 topUp = bound(uint256(topUpSeed), 1, 100 ether);
        uint256 total = initial + topUp;
        uint256 withdrawal = bound(uint256(withdrawalSeed), 1, total);

        _createVault(beneficiary, initial, MIN_TIMEOUT, MIN_CLAIM_DELAY);
        vm.prank(owner);
        vault.deposit{value: topUp}();
        vm.prank(owner);
        vault.withdraw(withdrawal);

        (, , , , , , uint256 trackedBalance, MortalVault.VaultStatus status, , ) =
            vault.getVault(owner);
        assertEq(trackedBalance, total - withdrawal);
        assertEq(address(vault).balance, trackedBalance);
        assertEq(uint256(status), uint256(MortalVault.VaultStatus.Active));
    }

    function testFuzz_ClaimBoundaryIsStrictAndDelayIsInclusive(
        uint64 timeoutSeed,
        uint64 claimDelaySeed,
        uint96 amountSeed
    ) public {
        uint64 timeout = uint64(bound(timeoutSeed, MIN_TIMEOUT, MAX_TIMEOUT));
        uint64 claimDelay = uint64(
            bound(claimDelaySeed, MIN_CLAIM_DELAY, MAX_CLAIM_DELAY)
        );
        uint256 amount = bound(uint256(amountSeed), 1, 100 ether);
        _createVault(beneficiary, amount, timeout, claimDelay);
        (, , , , uint256 heartbeat, , , , , ) = vault.getVault(owner);

        vm.warp(heartbeat + timeout);
        vm.expectRevert(MortalVault.OwnerStillActive.selector);
        vm.prank(beneficiary);
        vault.requestClaim(owner);

        vm.warp(heartbeat + timeout + 1);
        vm.prank(beneficiary);
        vault.requestClaim(owner);
        (, , , , , uint256 requestedAt, , , , ) = vault.getVault(owner);

        vm.warp(requestedAt + claimDelay - 1);
        vm.expectRevert(MortalVault.ClaimDelayActive.selector);
        vm.prank(beneficiary);
        vault.executeClaim(owner);

        vm.warp(requestedAt + claimDelay);
        vm.prank(beneficiary);
        vault.executeClaim(owner);

        uint256 balance;
        MortalVault.VaultStatus status;
        (, , , , , requestedAt, balance, status, , ) = vault.getVault(owner);
        assertEq(requestedAt, 0);
        assertEq(balance, 0);
        assertEq(uint256(status), uint256(MortalVault.VaultStatus.Claimed));
    }

    function _createVault(
        address configuredBeneficiary,
        uint256 amount,
        uint64 timeout,
        uint64 claimDelay
    ) private {
        vm.prank(owner);
        vault.createVault{value: amount}(configuredBeneficiary, timeout, claimDelay);
    }

    function _requestClaim(BeneficiaryActor actor, uint64 timeout) private {
        vm.warp(block.timestamp + timeout + 1);
        actor.request(owner);
    }

    function _assertActiveBalance(address vaultOwner, uint256 expectedBalance) private view {
        (, , , , , , uint256 balance, MortalVault.VaultStatus status, , ) = vault.getVault(
            vaultOwner
        );
        assertEq(balance, expectedBalance);
        assertEq(uint256(status), uint256(MortalVault.VaultStatus.Active));
    }
}

contract MortalVaultHandler is Test {
    MortalVault public immutable vault;
    address public immutable beneficiary;
    uint256 public expectedBalance;

    constructor(MortalVault vault_) {
        vault = vault_;
        beneficiary = address(0xBEEF);
    }

    receive() external payable {}

    function bootstrap() external {
        require(expectedBalance == 0, "already bootstrapped");
        expectedBalance = 10 ether;
        vault.createVault{value: expectedBalance}(beneficiary, 30 days, 7 days);
    }

    function deposit(uint96 amountSeed) external {
        (, , , , , , , MortalVault.VaultStatus status, , ) = vault.getVault(address(this));
        if (!_isMutable(status)) return;
        uint256 amount = bound(uint256(amountSeed), 1, 10 ether);
        vault.deposit{value: amount}();
        expectedBalance += amount;
    }

    function withdraw(uint96 amountSeed) external {
        (, , , , , , uint256 balance, MortalVault.VaultStatus status, , ) = vault.getVault(
            address(this)
        );
        if (!_isMutable(status) || balance == 0) return;
        uint256 amount = bound(uint256(amountSeed), 1, balance);
        vault.withdraw(amount);
        expectedBalance -= amount;
    }

    function heartbeat() external {
        (, , , , , , , MortalVault.VaultStatus status, , ) = vault.getVault(address(this));
        if (_isMutable(status)) vault.heartbeat();
    }

    function update(uint64 timeoutSeed, uint64 claimDelaySeed) external {
        (, , , , , , , MortalVault.VaultStatus status, , ) = vault.getVault(address(this));
        if (!_isMutable(status)) return;
        uint64 timeout = uint64(bound(timeoutSeed, 1 days, 5 * 365 days));
        uint64 claimDelay = uint64(bound(claimDelaySeed, 1 days, 180 days));
        vault.updateVault(beneficiary, timeout, claimDelay);
    }

    function requestClaim(uint32 extraTimeSeed) external {
        (, , uint256 timeout, , uint256 heartbeatAt, , uint256 balance, MortalVault.VaultStatus status, , ) =
            vault.getVault(address(this));
        if (status != MortalVault.VaultStatus.Active || balance == 0) return;
        vm.warp(heartbeatAt + timeout + 1 + bound(extraTimeSeed, 0, 1 days));
        vm.prank(beneficiary);
        vault.requestClaim(address(this));
    }

    function executeClaim(uint32 extraTimeSeed) external {
        (, , , uint256 claimDelay, , uint256 requestedAt, , MortalVault.VaultStatus status, , ) =
            vault.getVault(address(this));
        if (status != MortalVault.VaultStatus.ClaimRequested) return;
        vm.warp(requestedAt + claimDelay + bound(extraTimeSeed, 0, 1 days));
        vm.prank(beneficiary);
        vault.executeClaim(address(this));
        expectedBalance = 0;
    }

    function close() external {
        (, , , , , , , MortalVault.VaultStatus status, , ) = vault.getVault(address(this));
        if (!_isMutable(status)) return;
        vault.closeVault();
        expectedBalance = 0;
    }

    function recreate(uint96 amountSeed) external {
        (, , , , , , , MortalVault.VaultStatus status, , ) = vault.getVault(address(this));
        if (status != MortalVault.VaultStatus.Claimed && status != MortalVault.VaultStatus.Closed) {
            return;
        }
        uint256 amount = bound(uint256(amountSeed), 1, 10 ether);
        vault.createVault{value: amount}(beneficiary, 30 days, 7 days);
        expectedBalance = amount;
    }

    function _isMutable(MortalVault.VaultStatus status) private pure returns (bool) {
        return status == MortalVault.VaultStatus.Active
            || status == MortalVault.VaultStatus.ClaimRequested;
    }
}

contract MortalVaultInvariantTest is Test {
    uint256 private constant MIN_TIMEOUT = 1 days;
    uint256 private constant MAX_TIMEOUT = 5 * 365 days;
    uint256 private constant MIN_CLAIM_DELAY = 1 days;
    uint256 private constant MAX_CLAIM_DELAY = 180 days;

    MortalVault private vault;
    MortalVaultHandler private handler;

    function setUp() public {
        vault = new MortalVault();
        handler = new MortalVaultHandler(vault);
        vm.deal(address(handler), 100_000 ether);
        handler.bootstrap();

        bytes4[] memory selectors = new bytes4[](8);
        selectors[0] = handler.deposit.selector;
        selectors[1] = handler.withdraw.selector;
        selectors[2] = handler.heartbeat.selector;
        selectors[3] = handler.update.selector;
        selectors[4] = handler.requestClaim.selector;
        selectors[5] = handler.executeClaim.selector;
        selectors[6] = handler.close.selector;
        selectors[7] = handler.recreate.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
        targetContract(address(handler));
    }

    function invariant_TrackedBalanceMatchesModel() public view {
        (, , , , , , uint256 balance, , , ) = vault.getVault(address(handler));
        assertEq(balance, handler.expectedBalance());
    }

    function invariant_ContractRemainsSolvent() public view {
        (, , , , , , uint256 balance, , , ) = vault.getVault(address(handler));
        assertGe(address(vault).balance, balance);
    }

    function invariant_StatusFieldsRemainConsistent() public view {
        (, , , , , uint256 requestedAt, uint256 balance, MortalVault.VaultStatus status, , ) =
            vault.getVault(address(handler));

        if (status == MortalVault.VaultStatus.Active) {
            assertEq(requestedAt, 0);
        } else if (status == MortalVault.VaultStatus.ClaimRequested) {
            assertGt(requestedAt, 0);
            assertGt(balance, 0);
        } else {
            assertTrue(
                status == MortalVault.VaultStatus.Claimed
                    || status == MortalVault.VaultStatus.Closed
            );
            assertEq(requestedAt, 0);
            assertEq(balance, 0);
        }
    }

    function invariant_IdentityAndConfigurationRemainValid() public view {
        (address storedOwner, address storedBeneficiary, uint256 timeout, uint256 claimDelay, , , , , , ) =
            vault.getVault(address(handler));
        assertEq(storedOwner, address(handler));
        assertEq(storedBeneficiary, handler.beneficiary());
        assertGe(timeout, MIN_TIMEOUT);
        assertLe(timeout, MAX_TIMEOUT);
        assertGe(claimDelay, MIN_CLAIM_DELAY);
        assertLe(claimDelay, MAX_CLAIM_DELAY);
    }
}
