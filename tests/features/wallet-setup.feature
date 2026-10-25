@wallet_setup
Feature: Registered users configure wallets and prove ownership of external addresses
  @happy @edge
  Scenario: A new user saves wallet preferences without creating value or another wallet
    Given an isolated wallet setup fixture
    When an ordinary user saves a wallet name and preferred asset
    Then those settings survive reload with one wallet and unchanged balances
    And stale settings, forged CSRF and administrator-only configuration are rejected

  @happy @edge
  Scenario: Link, revoke and reverify an owned external address
    Given an isolated wallet setup fixture
    When a user signs and verifies the server ownership challenge
    Then the user has one verified binding without exposing signatures or private keys
    When the user revokes and reverifies the same address
    Then ownership history and address uniqueness are preserved

  @negative
  Scenario: Forged, altered, expired and session-switched proofs are rejected
    Given an isolated wallet setup fixture
    When invalid ownership proofs are submitted
    Then no invalid external binding is persisted

  @negative @edge
  Scenario: Replay and competing owners cannot claim the same address
    Given an isolated wallet setup fixture
    When two registered wallets concurrently claim the same external address
    Then exactly one owner is verified and replay cannot claim it again

  @negative
  Scenario: Provider and permission checks protect network configuration and linking
    Given an isolated wallet setup fixture
    When unsafe providers, wrong chain identity and contract wallets are requested
    Then the network and wallet registry contain no invalid new records
