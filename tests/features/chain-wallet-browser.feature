@chain_wallet_browser
Feature: The browser wallet operates real test contracts end to end
  @happy @edge
  Scenario: Deploy a test token, import it, send it and reload its indexed receipt
    Given a browser connected to an isolated real EVM and API
    When I deploy a faucet token and import it through the wallet UI
    And I transfer test tokens through the browser wallet
    Then the actual token balance and indexed transfer survive browser reload
