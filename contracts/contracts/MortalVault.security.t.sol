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
    uint256 private constant MAX_VAULT_BALANCE = 1_000 ether;

    MortalVault private vault;
    address private owner;
    address private beneficiary;
    address private recipient;

    function setUp() public {
        vault = new MortalVault(MAX_VAULT_BALANCE);
        owner = makeAddr("owner");
        beneficiary = makeAddr("beneficiary");
        recipient = makeAddr("recipient");
        vm.deal(owner, 2_000 ether);
    }

    function test_RejectsZeroVaultBalanceLimit() public {
        vm.expectRevert(MortalVault.InvalidMaxVaultBalance.selector);
        new MortalVault(0);
    }

    function test_EnforcesImmutableVaultBalanceLimit() public {
        assertEq(vault.MAX_VAULT_BALANCE(), MAX_VAULT_BALANCE);

        vm.expectRevert(MortalVault.VaultBalanceLimitExceeded.selector);
        vm.prank(owner);
        vault.createVault{value: MAX_VAULT_BALANCE + 1}(
            beneficiary,
            MIN_TIMEOUT,
            MIN_CLAIM_DELAY
        );

        _createVault(beneficiary, MAX_VAULT_BALANCE, MIN_TIMEOUT, MIN_CLAIM_DELAY);
        vm.expectRevert(MortalVault.VaultBalanceLimitExceeded.selector);
        vm.prank(owner);
        vault.deposit{value: 1}();
        _assertActiveBalance(owner, MAX_VAULT_BALANCE);
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

    /**
     * The invariant campaign runs with failOnRevert disabled, so a handler
     * guard that wrongly returns early would quietly shrink it to deposits and
     * withdrawals while still reporting a pass. Foundry reverts handler state
     * between runs, so that coverage cannot be asserted after the campaign
     * without flakiness — assert it here instead, deterministically, against
     * the mechanism that would actually break: the guards themselves.
     */
    function test_HandlerGuardsAdmitEveryLifecycleTransition() public {
        MortalVault isolated = new MortalVault(MAX_VAULT_BALANCE);
        MortalVaultHandler probe = new MortalVaultHandler(
            isolated,
            makeAddr("probeBeneficiary")
        );
        vm.deal(address(probe), 1_000 ether);
        probe.bootstrap();

        probe.deposit(1 ether);
        probe.withdraw(1);
        probe.heartbeat();
        probe.update(2 days, 2 days);

        probe.requestClaim(0);
        assertEq(probe.claimRequestedCount(), 1, "requestClaim guard rejected a valid request");

        probe.executeClaim(0);
        assertEq(probe.claimExecutedCount(), 1, "executeClaim guard rejected a valid execution");

        probe.recreate(1 ether);
        assertEq(probe.recreatedCount(), 1, "recreate guard rejected a valid recreation");

        probe.close();
        assertEq(probe.closedCount(), 1, "close guard rejected a valid close");

        probe.claimThrough(0);
        assertEq(probe.claimExecutedCount(), 1, "claimThrough ran against a closed vault");
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

        // A bystander holding funds in the same pooled contract balance. With
        // one owner, `contract balance == that owner's balance` holds even if
        // deposits and withdrawals cross between vaults; with two, it does not.
        address bystander = makeAddr("bystander");
        uint256 bystanderBalance = 25 ether;
        vm.deal(bystander, bystanderBalance);
        vm.prank(bystander);
        vault.createVault{value: bystanderBalance}(
            makeAddr("bystanderHeir"),
            MIN_TIMEOUT,
            MIN_CLAIM_DELAY
        );

        _createVault(beneficiary, initial, MIN_TIMEOUT, MIN_CLAIM_DELAY);
        vm.prank(owner);
        vault.deposit{value: topUp}();
        vm.prank(owner);
        vault.withdraw(withdrawal);

        (, , , , , , uint256 trackedBalance, MortalVault.VaultStatus status, , ) =
            vault.getVault(owner);
        (, , , , , , uint256 trackedBystander, , , ) = vault.getVault(bystander);

        assertEq(trackedBalance, total - withdrawal);
        assertEq(trackedBystander, bystanderBalance, "bystander's balance moved");
        assertEq(address(vault).balance, trackedBalance + trackedBystander);
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

    // Counted only on a completed call. With failOnRevert disabled a guard that
    // always returns early would silently shrink the campaign to deposits and
    // withdrawals while still reporting a pass, so afterInvariant() asserts on
    // these rather than trusting the run.
    uint256 public claimRequestedCount;
    uint256 public claimExecutedCount;
    uint256 public closedCount;
    uint256 public recreatedCount;

    constructor(MortalVault vault_, address beneficiary_) {
        vault = vault_;
        beneficiary = beneficiary_;
    }

    receive() external payable {}

    function bootstrap() external {
        require(expectedBalance == 0, "already bootstrapped");
        expectedBalance = 10 ether;
        vault.createVault{value: expectedBalance}(beneficiary, 30 days, 7 days);
    }

    /**
     * Several handlers share one clock. Each computes its deadlines from its
     * own heartbeat, so warping to an absolute time could move the chain
     * backwards for the others. Time only ever moves forward here; when the
     * target has already passed, the vault is simply more overdue than the
     * minimum, which satisfies the same precondition.
     */
    function _warpAtLeast(uint256 target) private {
        if (target > block.timestamp) vm.warp(target);
    }

    function deposit(uint96 amountSeed) external {
        (, , , , , , uint256 balance, MortalVault.VaultStatus status, , ) =
            vault.getVault(address(this));
        if (!_isMutable(status) || balance == vault.MAX_VAULT_BALANCE()) return;
        uint256 remaining = vault.MAX_VAULT_BALANCE() - balance;
        uint256 maximumDeposit = remaining < 10 ether ? remaining : 10 ether;
        uint256 amount = bound(uint256(amountSeed), 1, maximumDeposit);
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
        _warpAtLeast(heartbeatAt + timeout + 1 + bound(extraTimeSeed, 0, 1 days));
        vm.prank(beneficiary);
        vault.requestClaim(address(this));
        claimRequestedCount += 1;
    }

    function executeClaim(uint32 extraTimeSeed) external {
        (, , , uint256 claimDelay, , uint256 requestedAt, , MortalVault.VaultStatus status, , ) =
            vault.getVault(address(this));
        if (status != MortalVault.VaultStatus.ClaimRequested) return;
        _warpAtLeast(requestedAt + claimDelay + bound(extraTimeSeed, 0, 1 days));
        vm.prank(beneficiary);
        vault.executeClaim(address(this));
        expectedBalance = 0;
        claimExecutedCount += 1;
    }

    /**
     * The uninterrupted claim: silence, a request, the full delay, execution.
     *
     * Kept alongside the separate request and execute actions rather than
     * replacing them. Those explore the interesting case — an owner action
     * landing mid-claim and cancelling it — but because five of the eight
     * actions cancel, a claim almost never survives long enough for the
     * fuzzer to pick execute next, leaving the Claimed terminal state
     * unreached. This walks the path end to end so it is always covered.
     */
    function claimThrough(uint32 extraTimeSeed) external {
        (
            , , uint256 timeout, uint256 claimDelay, uint256 heartbeatAt, ,
            uint256 balance, MortalVault.VaultStatus status, ,
        ) = vault.getVault(address(this));
        if (status != MortalVault.VaultStatus.Active || balance == 0) return;

        _warpAtLeast(heartbeatAt + timeout + 1);
        vm.prank(beneficiary);
        vault.requestClaim(address(this));
        claimRequestedCount += 1;

        (, , , , , uint256 requestedAt, , , , ) = vault.getVault(address(this));
        _warpAtLeast(requestedAt + claimDelay + bound(extraTimeSeed, 0, 1 days));
        vm.prank(beneficiary);
        vault.executeClaim(address(this));
        expectedBalance = 0;
        claimExecutedCount += 1;
    }

    function close() external {
        (, , , , , , , MortalVault.VaultStatus status, , ) = vault.getVault(address(this));
        if (!_isMutable(status)) return;
        vault.closeVault();
        expectedBalance = 0;
        closedCount += 1;
    }

    function recreate(uint96 amountSeed) external {
        (, , , , , , , MortalVault.VaultStatus status, , ) = vault.getVault(address(this));
        if (status != MortalVault.VaultStatus.Claimed && status != MortalVault.VaultStatus.Closed) {
            return;
        }
        uint256 amount = bound(uint256(amountSeed), 1, 10 ether);
        vault.createVault{value: amount}(beneficiary, 30 days, 7 days);
        expectedBalance = amount;
        recreatedCount += 1;
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
    uint256 private constant MAX_VAULT_BALANCE = 1_000 ether;

    uint256 private constant OWNER_COUNT = 3;

    MortalVault private vault;
    MortalVaultHandler private handler;
    MortalVaultHandler[OWNER_COUNT] private handlers;

    function setUp() public {
        vault = new MortalVault(MAX_VAULT_BALANCE);

        // Every vault's ether sits in one pooled contract balance keyed by a
        // mapping, so the property that matters most cannot be observed with a
        // single owner: one owner's model is trivially consistent with any
        // amount of cross-vault leakage. Three independent owners, each with
        // its own beneficiary and its own expected balance, make the pool
        // divisible and the leak visible.
        for (uint256 i = 0; i < OWNER_COUNT; i++) {
            handlers[i] = new MortalVaultHandler(
                vault,
                address(uint160(0xBEEF0000 + i))
            );
            vm.deal(address(handlers[i]), 100_000 ether);
            handlers[i].bootstrap();
        }
        handler = handlers[0];

        for (uint256 i = 0; i < OWNER_COUNT; i++) {
            bytes4[] memory selectors = new bytes4[](9);
            selectors[0] = handlers[i].deposit.selector;
            selectors[1] = handlers[i].withdraw.selector;
            selectors[2] = handlers[i].heartbeat.selector;
            selectors[3] = handlers[i].update.selector;
            selectors[4] = handlers[i].requestClaim.selector;
            selectors[5] = handlers[i].executeClaim.selector;
            selectors[6] = handlers[i].close.selector;
            selectors[7] = handlers[i].recreate.selector;
            selectors[8] = handlers[i].claimThrough.selector;
            targetSelector(FuzzSelector({addr: address(handlers[i]), selectors: selectors}));
            targetContract(address(handlers[i]));
        }
    }

    /**
     * The property the product rests on: whatever any owner does to their own
     * vault, the contract still holds enough for everyone else. A bug that
     * paid one owner out of another's balance would leave the pool short of
     * the sum while each individual vault still looked fine.
     */
    function invariant_SumOfTrackedBalancesIsSolvent() public view {
        uint256 tracked;
        for (uint256 i = 0; i < OWNER_COUNT; i++) {
            (, , , , , , uint256 balance, , , ) = vault.getVault(address(handlers[i]));
            tracked += balance;
        }
        assertGe(address(vault).balance, tracked);
    }

    /** No owner's actions may move another owner's recorded balance or identity. */
    function invariant_EachVaultMatchesItsOwnModel() public view {
        for (uint256 i = 0; i < OWNER_COUNT; i++) {
            (address storedOwner, address storedBeneficiary, , , , , uint256 balance, , , ) =
                vault.getVault(address(handlers[i]));
            assertEq(balance, handlers[i].expectedBalance());
            assertEq(storedOwner, address(handlers[i]));
            assertEq(storedBeneficiary, handlers[i].beneficiary());
        }
    }


    function invariant_TrackedBalanceMatchesModel() public view {
        (, , , , , , uint256 balance, , , ) = vault.getVault(address(handler));
        assertEq(balance, handler.expectedBalance());
    }

    function invariant_ContractRemainsSolvent() public view {
        (, , , , , , uint256 balance, , , ) = vault.getVault(address(handler));
        assertGe(address(vault).balance, balance);
    }

    function invariant_TrackedBalanceNeverExceedsDeploymentLimit() public view {
        (, , , , , , uint256 balance, , , ) = vault.getVault(address(handler));
        assertLe(balance, MAX_VAULT_BALANCE);
        assertEq(vault.MAX_VAULT_BALANCE(), MAX_VAULT_BALANCE);
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
