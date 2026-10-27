@wallet_delivery
Feature: Deliver the demo wallet overhaul with durable data and authorization
  @happy @edge @migration_rehearsal
  Scenario: A synthetic legacy backup restores and migrates on a separate rehearsal target
    Given an isolated legacy wallet with issuance and a committed transfer
    When its serialized backup is restored into a separate guarded rehearsal database
    Then rehearsal migration preserves financial evidence and reconciles custody
    And the original legacy database remains unchanged

  @happy @edge
  Scenario: Legacy financial evidence survives migration and a repeat cutover
    Given an isolated legacy wallet with issuance and a committed transfer
    When the legacy wallets are migrated with the explicit provenance policy
    Then balances, transfer IDs, journal and old chain hashes are preserved
    And migrated custody is labeled and reconciled
    When migration runs again after a new v2 payment
    Then no migration or payment is duplicated

  @negative
  Scenario: Corrupt evidence prevents any migration writes
    Given an isolated legacy wallet with issuance and a committed transfer
    When a legacy balance is corrupted and migration is attempted
    Then migration leaves wallets, assets and custody untouched

  @negative @edge
  Scenario: A custody failure rolls back the complete cutover
    Given an isolated legacy wallet with issuance and a committed transfer
    When custody reconstruction fails halfway through migration
    Then migration leaves wallets, assets and custody untouched

  @happy @negative @edge
  Scenario: Administration requires explicit setup and enforces asset lifecycle and supply
    Given an isolated administration fixture
    When an ordinary user tries asset administration and invalid setup
    Then no asset or privilege is created
    When the administrator completes setup and creates a draft asset
    Then the draft cannot receive issuance before activation
    When the administrator activates the asset and issues 10.00 units
    Then the wallet has 10.00 units with an issuance custody root
    And stale edits, cap overflow, forged CSRF and repeat setup are rejected
    And the last access administrator cannot be removed

  @happy @edge
  Scenario: Demo seed replay preserves later spending
    Given an isolated administration fixture
    When the administrator runs the default demo profile
    Then four synthetic wallets have the expected exact DEMO and DETH balances
    When a synthetic peer spends and the same seed profile runs again
    Then spending is preserved with no duplicate financial effects

  @edge
  Scenario: An interrupted seed run resumes after restart with the original operation identities
    Given an isolated administration fixture
    When a seed acknowledgement is lost after a committed transfer
    And the service restarts and resumes the original seed run
    Then four synthetic wallets have the expected exact DEMO and DETH balances
    And each seed issuance and transfer exists exactly once

  @edge
  Scenario: A recovery-worker claim is reconciled without stopping or duplicating the seed run
    Given an isolated administration fixture
    When a seed transfer is reported pending after another executor commits it
    Then four synthetic wallets have the expected exact DEMO and DETH balances
    And each seed issuance and transfer exists exactly once

  @negative
  Scenario: Seed conflicts and revoked roles cannot mutate data
    Given an isolated administration fixture
    When a seed identity conflicts and an operator without a role tries to seed
    Then seed operations are rejected without issuing units

  @happy @negative @edge
  Scenario: Custody views are scoped, paginated and redact other owners
    Given an isolated administration fixture
    When issuance and a transfer create participant custody activity
    Then participants can inspect their event graph but strangers cannot
    And activity pagination returns each event once without exposing other identities
