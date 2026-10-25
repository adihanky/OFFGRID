Feature: Wallet overhaul migration preflight
  Assess legacy data without granting roles, provisioning wallets or changing money.

  Scenario: O10 Funded legacy data needs an explicit provenance policy
    Given an isolated legacy wallet assessment fixture
    When the read-only wallet migration assessment runs
    Then the assessment requires a migrated provenance policy with exact supply
    And the assessment has not changed the database

  Scenario: O10 Missing ledger evidence blocks migration
    Given an isolated legacy wallet assessment fixture
    And its issuance credit journal entry is missing
    When the read-only wallet migration assessment runs
    Then the assessment is blocked by "JOURNAL_PAIR_INVALID"
    And the assessment has not changed the database

  Scenario: O10 An unsettled transfer blocks cutover
    Given an isolated legacy wallet assessment fixture
    And a durable pending transfer exists for assessment
    When the read-only wallet migration assessment runs
    Then the assessment is blocked by "PENDING_TRANSFER"
    And the assessment has not changed the database

  Scenario: O10 Repeated assessments preserve IDs balances and chain hashes
    Given an isolated legacy wallet assessment fixture
    When the read-only wallet migration assessment runs twice
    Then the assessment requires a migrated provenance policy with exact supply
    And the assessment has not changed the database

  Scenario: O-DATA Strict contracts reject caller selected sender identities
    Given an overhaul send request with a caller selected sender
    When the overhaul contract is validated
    Then the overhaul request is rejected before persistence

  Scenario: O-DATA Chain quantity retains the smallest precision eighteen unit
    Given an overhaul chain quantity of "0.000000000000000001"
    When the chain quantity is parsed at precision eighteen
    Then the chain quantity is exactly one base unit

  Scenario: O-DATA Chain quantity cannot exceed uint256
    Given an overhaul chain quantity of "115792089237316195423570985008687907853269984665640564039457584007913129639936"
    When the chain quantity is parsed at precision eighteen
    Then the overhaul request is rejected before persistence
