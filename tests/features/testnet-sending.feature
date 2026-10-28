@testnet_send
Feature: Wallet-approved testnet payments never become simulated credits
  @happy
  Scenario: An approved Sepolia payment submits exact native units once
    Given a controlled connected Sepolia signer
    When I approve a one wei testnet payment
    Then the provider receives one native transaction and returns its hash
  @negative @edge
  Scenario: Account changes and lost replies do not cause automatic retransmission
    Given a controlled connected Sepolia signer
    Then an account change prevents the testnet payment
    And a lost submission reply remains uncertain without another payment
