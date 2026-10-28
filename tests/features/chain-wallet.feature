@chain_wallet
Feature: Real EVM token execution and durable chain indexing
  @happy @edge
  Scenario: Deploy, import, transfer and index a real ERC-20 contract
    Given an isolated real EVM wallet fixture
    When I deploy and import the test token through the chain API
    And I send native ETH and ERC-20 tokens on the EVM
    Then balances and indexed receipts reflect executed transfers without demo issuance
    And repeated indexing is idempotent and other users cannot read the address history

  @negative @edge
  Scenario: Invalid contracts, forged ownership and overspending cannot produce token plans
    Given an isolated real EVM wallet fixture
    When I deploy and import the test token through the chain API
    Then invalid token operations are rejected without broadcasting

  @negative @edge
  Scenario: Reverted transactions and chain reorganizations change the indexed evidence
    Given an isolated real EVM wallet fixture
    When I deploy and import the test token through the chain API
    Then a real reverted transaction is indexed as reverted
    And an EVM rollback removes provisional transfer evidence
