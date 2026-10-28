@wallet_setup_browser
Feature: Wallet and asset setup are visible in the real browser UI
  @happy @edge
  Scenario: A new ordinary user configures an application wallet and links an external address
    Given a real wallet setup browser for a "new user"
    When I register and open wallet setup from the main navigation
    And I save my wallet name and default asset in the browser
    And I connect and sign with a controlled external wallet provider
    Then wallet preferences and verified ownership survive a browser reload

  @happy
  Scenario: An asset administrator configures assets and verified networks from the UI
    Given a real wallet setup browser for an "asset administrator"
    When I open asset configuration and create and activate a new demo asset
    And I add a verified local EVM network through the network form
    Then the asset and network configurations are persisted and visible in the browser

  @negative
  Scenario: A new user without a browser wallet gets a clear setup path without elevated asset access
    Given a real wallet setup browser for a "new user"
    When I register and open wallet setup from the main navigation
    And no external wallet provider is available in the browser
    Then the UI explains manual linking and administrator-only asset configuration

  @testnet_wallet @happy @edge
  Scenario: The unified wallet displays actual RPC balances without configuring demo assets
    Given a real wallet setup browser for a "new user"
    When I register and open wallet setup from the main navigation
    And I connect and sign with a controlled external wallet provider
    Then the unified wallet shows the verified native balance and survives reload

  @testnet_wallet @happy @edge
  Scenario: A native payment uses the wallet provider and preserves its submitted hash on reload
    Given a real wallet setup browser for a "new user"
    When the controlled local network uses the Sepolia chain ID
    And I register and open wallet setup from the main navigation
    And I connect and sign with a controlled external wallet provider
    And I submit one wei using the unified wallet send form
    Then the wallet submission is shown as pending and retained across reload without duplicate sending
