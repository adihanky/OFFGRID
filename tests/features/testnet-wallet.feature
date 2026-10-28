@testnet_wallet @wallet_setup
Feature: A unified testnet wallet has no circular network prerequisite
  @happy @edge
  Scenario: An ordinary user enables Sepolia before linking an address
    Given an isolated wallet setup fixture
    When an ordinary user enables the canonical Sepolia preset twice
    Then exactly one active Sepolia network exists without granting administration

  @negative @edge
  Scenario: A user cannot resume a paused preset or select an arbitrary provider
    Given an isolated wallet setup fixture
    When an ordinary user enables the canonical Sepolia preset twice
    Then paused networks and arbitrary preset inputs are rejected

  @negative @edge
  Scenario: A provider with an incorrect or malformed Sepolia checkpoint is rejected
    Given an isolated wallet setup fixture
    When a user enables Sepolia with invalid checkpoint responses
    Then no Sepolia network is saved

  @happy @negative @edge
  Scenario: Verified owners see exact on-chain balances without demo issuance
    Given an isolated wallet setup fixture
    When a user signs and verifies the server ownership challenge
    Then the linked owner sees the exact native balance while other users cannot
