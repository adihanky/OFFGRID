@wallet
Feature: Own wallets, peers and balanced issuance
  Background:
    Given isolated transfer peers and a precision-2 asset

  @happy
  Scenario: W01 Own wallet and private peer projection
    Given Alice has "1000" base units
    And Bob has "250" base units
    When Alice reads the wallet
    Then the wallet balance is "10.00"
    When Alice looks up handle " BOB "
    Then only Bob's public peer identity is returned

  @edge
  Scenario: W02 Virtual zero wallet has no persistence effects
    When Alice reads the wallet
    Then the wallet balance is "0.00"
    And there are 0 stored accounts and 0 ledger entries

  @edge
  Scenario: W02 Empty catalogue returns an empty wallet
    Given the isolated asset catalogue is empty
    When Alice reads the wallet
    Then the accounts list is empty

  @negative
  Scenario Outline: W03 Invalid sessions protect all wallet routes
    Given Alice's transfer session is "<state>"
    When Alice requests protected wallet routes
    Then every protected response is unauthorized
    Examples:
      | state     |
      | anonymous |
      | expired   |
      | revoked   |
      | disabled  |

  @negative
  Scenario Outline: W04 Peer lookup does not enumerate unavailable peers
    Given Bob's identity is "<state>"
    When Alice looks up handle "<handle>"
    Then the transfer HTTP status is 404
    Examples:
      | state    | handle |
      | active   | bob_   |
      | active   | nobody |
      | disabled | bob    |

  @negative
  Scenario Outline: W04 Query injection is rejected
    When Alice reads wallet path "<path>"
    Then the transfer HTTP status is 400
    Examples:
      | path                              |
      | /api/accounts?userId=someoneelse   |
      | /api/peers?handle=bob&email=secret |
      | /api/peers?handle=bob&handle=alice |

  @happy @edge
  Scenario: W07 Repeated issuance has one balanced effect
    Given Alice has "1000" base units
    When the same Alice issuance is repeated
    Then there is one balanced demo issuance of "1000" units
    And ledger reconciliation is clean

  @negative
  Scenario: W08 Conflicting issuance key cannot add credit
    Given Alice has "1000" base units
    When the Alice issuance key is reused with "1001" units
    Then the operation fails
    And there is one balanced demo issuance of "1000" units

  @negative
  Scenario: W09 Reconciliation reports balance corruption without repair
    Given Alice has "1000" base units
    And Alice's stored balance is corrupted to "999"
    When ledger reconciliation runs
    Then ledger reconciliation reports a mismatch
    And Alice has "999" stored units

  @negative @edge
  Scenario: W11 Persistence rejects invalid balances and duplicate ownership
    Given Alice has "1000" base units
    Then account validators and unique indexes enforce ownership and exact integers

  @negative
  Scenario Outline: W08 Fixture target guard prevents unsafe writes
    When a demo fixture is requested for "<target>"
    Then the operation fails
    And there are 0 stored accounts and 0 ledger entries
    Examples:
      | target            |
      | production        |
      | remote            |
      | unapproved name   |

  @negative @edge
  Scenario: W08 Signed issuance system cannot underflow
    Given Alice has "9223372036854775807" base units
    And Bob has "1" base units
    When one more issuance unit is requested
    Then the operation fails
    And the issuance system remains at its signed minimum

  @negative
  Scenario: W09 Invalid journal pairs cannot be written
    When a journal uses the same debit and credit account
    Then the operation fails
    And there are 0 stored accounts and 0 ledger entries

  @negative
  Scenario: W09 Missing issuance journal is reported
    Given Alice has "1000" base units
    And the issuance journal is removed
    When ledger reconciliation runs
    Then ledger reconciliation reports a mismatch
