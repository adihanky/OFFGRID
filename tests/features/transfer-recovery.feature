@transfer
Feature: Pending recovery, rollback and attempt fencing
  Background:
    Given isolated transfer peers and a precision-2 asset
    And Alice has "1000" base units

  @negative @recovery
  Scenario Outline: R01 Every failed transaction boundary rolls back
    Given execution fails after "<stage>"
    When Alice transfers "1.00" to Bob
    Then the transfer HTTP status is 202
    And the transfer is "PENDING"
    And Alice has "1000" and Bob has "0" stored units
    And no settlement effects exist
    When transfer recovery is allowed to run
    Then exactly 1 complete transfer effects exist
    And Alice has "900" and Bob has "100" stored units
    Examples:
      | stage  |
      | debit  |
      | credit |
      | ledger |
      | custody |
      | chain  |
      | status |
      | outbox |

  @happy @recovery
  Scenario: R02 R08 Durable recovery continues after caller signout
    Given execution fails after "claimed"
    When Alice transfers "1.00" to Bob
    Then the transfer is "PENDING"
    When Alice signs out after admission
    And the application restarts with the same isolated database
    And transfer recovery is allowed to run
    Then exactly 1 complete transfer effects exist
    And Alice has "900" and Bob has "100" stored units

  @negative @recovery
  Scenario: R03 Persistent execution failure remains pending
    Given execution fails after "debit"
    When Alice transfers "1.00" to Bob
    And recovery retries while the failure remains
    Then no settlement effects exist
    And the stored transfer remains pending with a future retry
    And the response contains no private transfer metadata

  @edge @concurrency @recovery
  Scenario: R04 Expired claim takeover fences a stale executor
    Given a pending transfer with an expired execution claim
    When a new executor takes over and commits
    And the stale executor tries rejection and execution
    Then exactly 1 complete transfer effects exist
    And the stored transfer is committed

  @edge @concurrency @recovery
  Scenario: R05 Duplicate recovery runs have one financial effect
    Given execution fails after "claimed"
    When Alice transfers "1.00" to Bob
    And two recovery runners resume the pending transfer
    Then exactly 1 complete transfer effects exist
    And Alice has "900" and Bob has "100" stored units

  @edge @recovery
  Scenario: R06 Lost commit acknowledgement returns the original outcome
    Given execution fails after "afterCommit"
    When Alice transfers "1.00" to Bob
    And Alice replays the last request with quantity "1.00"
    Then the transfer is "COMMITTED"
    And the original transfer identity is returned
    And exactly 1 complete transfer effects exist

  @edge @concurrency
  Scenario: R07 Driver retries an ambiguous commit acknowledgement
    Given the MongoDB commit acknowledgement is lost once after server commit
    When Alice transfers "1.00" to Bob
    Then the transfer is "COMMITTED"
    And the driver retried the same transaction commit
    And exactly 1 complete transfer effects exist
    When Alice replays the last request with quantity "1.00"
    Then the original transfer identity is returned
    And exactly 1 complete transfer effects exist

  @edge @concurrency
  Scenario: T12 Suspension ordered before eligibility fencing rejects settlement
    Given Bob is disabled at the claimed execution boundary
    When Alice transfers "1.00" to Bob
    Then the rejection reason is "RECIPIENT_UNAVAILABLE"
    And no settlement effects exist

  @negative @concurrency
  Scenario: O04 Wallet suspension ordered before settlement blocks the entire effect
    Given Bob's application wallet is suspended
    When Alice transfers "1.00" to Bob
    Then the rejection reason is "WALLET_UNAVAILABLE"
    And no settlement effects exist
